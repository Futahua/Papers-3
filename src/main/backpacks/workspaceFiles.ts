import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { replaceFileAtomically } from './backpackProjectService';

type Binding = { name: string; hash: string | null; versionId: string | null; pending?: { hash: string; versionId: string | null }; stamp?: string };
const identity = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value) || value.includes(':')) throw Error('Invalid workspace identity.');
  return value;
};
const hashValue = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Invalid workspace content hash.');
  return value;
};
const nameValue = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 220 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) || ['.', '..'].includes(value)) throw Error('Invalid workspace filename.');
  return value;
};
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(target: string): Promise<string> { const h = createHash('sha256'); await pipeline(createReadStream(target), h); return h.digest('hex'); }
async function fileStamp(target: string): Promise<string> { const s = await fs.lstat(target); if (!s.isFile() || s.isSymbolicLink()) throw Error('The working file was replaced.'); return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':'); }

/** Native local files only. Project-owned causal records never contain these paths.
 * The receiving journal is CAS checked; immutable bytes and pending publications
 * survive presentation closure and process restart. Existing remote uploads carry bytes. */
export class WorkspaceFiles {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly verifiedContent = new Map<string, string>();
  constructor(readonly root: string) {}
  private queue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const current = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.tails.set(key, current);
    void current.finally(() => { if (this.tails.get(key) === current) this.tails.delete(key); }).catch(() => {});
    return current;
  }
  private async safeDirectory(...parts: string[]): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw Error('Workspace storage was replaced.');
    let directory = this.root;
    for (const part of parts) {
      directory = path.join(directory, part);
      await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Workspace storage was replaced.');
    }
    return directory;
  }
  private async atomic(target: string, value: unknown): Promise<void> {
    const temp = target + '.tmp-' + randomUUID();
    try {
      const file = await fs.open(temp, 'wx');
      try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
      await replaceFileAtomically(temp, target);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  private async binding(scope: string, entryId: string): Promise<{ directory: string; record: Binding | null }> {
    const directory = await this.safeDirectory(scope, 'entries', entryId);
    let record: Binding | null;
    try { record = JSON.parse(await fs.readFile(path.join(directory, '.binding.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; record = null; }
    if (record) {
      nameValue(record.name); if (record.hash) hashValue(record.hash);
      if (record.pending) {
        const target = path.join(directory, record.name);
        if (record.pending.versionId === null && !await fs.lstat(target).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) {
          const hash = hashValue(record.pending.hash);
          if (await this.queue('content:' + hash, () => this.contentAvailable(hash))) {
            const temporary = target + '.import-' + randomUUID();
            try {
              await fs.copyFile(path.join(this.root, 'content', hash), temporary, fs.constants.COPYFILE_EXCL);
              const durable = await fs.open(temporary, 'r+'); try { await durable.sync(); } finally { await durable.close(); }
              await fs.link(temporary, target);
            } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
          }
        }
        if (await fileHash(target).catch(() => null) === record.pending.hash) {
          record = { ...record, hash: record.pending.hash, versionId: record.pending.versionId, stamp: await fileStamp(target) };
          delete record.pending; await this.atomic(path.join(directory, '.binding.json'), record);
        }
      }
    }
    return { directory, record };
  }
  private async snapshot(source: string): Promise<{ hash: string; size: number; stamp: string }> {
    const before = await fs.lstat(source);
    if (!before.isFile() || before.isSymbolicLink()) throw Error('Choose a regular file.');
    const directory = await this.safeDirectory('content'), temp = path.join(directory, '.capture-' + randomUUID()), h = createHash('sha256');
    try {
      await pipeline(createReadStream(source), new Transform({ transform(chunk, _encoding, done) { h.update(chunk); done(null, chunk); } }), createWriteStream(temp, { flags: 'wx' }));
      const durable = await fs.open(temp, 'r+'); try { await durable.sync(); } finally { await durable.close(); }
      const after = await fs.stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw Error('The file changed while it was being saved; retrying is safe.');
      const hash = h.digest('hex'), target = path.join(directory, hash);
      // Publish the already synced inode, rather than exposing a partial copy.
      await this.queue('content:' + hash, async () => {
        if (!await this.contentAvailable(hash)) await replaceFileAtomically(temp, target);
        this.verifiedContent.set(hash, await fileStamp(target));
      });
      return { hash, size: after.size, stamp: [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') };
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  private async contentAvailable(hash: string): Promise<boolean> {
    const target = path.join(await this.safeDirectory('content'), hash);
    const before = await fileStamp(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!before) { this.verifiedContent.delete(hash); return false; }
    if (this.verifiedContent.get(hash) === before) return true;
    const actual = await fileHash(target), after = await fileStamp(target);
    if (before !== after) throw Error('Workspace content changed while being checked.');
    if (actual !== hash) {
      await fs.rename(target, path.join(await this.safeDirectory('recovery'), hash + '-' + randomUUID()));
      this.verifiedContent.delete(hash); return false;
    }
    this.verifiedContent.set(hash, after); return true;
  }
  /** Two devices can push the same content at once; the transfer then keeps both, as "<hash> (2)".
   * A copy whose bytes match its hash is removed when the original is verified, or becomes the
   * original when that is missing. A copy whose bytes do not match moves to recovery, never deleted. */
  private async tidyContent(): Promise<Record<string, unknown>> {
    const directory = await this.safeDirectory('content'), result = { adopted: 0, removed: 0, quarantined: 0 };
    for (const name of await fs.readdir(directory)) {
      const match = /^([a-f0-9]{64}) \(\d+\)$/.exec(name); if (!match) continue;
      const hash = match[1], copy = path.join(directory, name);
      await this.queue('content:' + hash, async () => {
        const stat = await fs.lstat(copy).catch(() => null); if (!stat?.isFile() || stat.isSymbolicLink()) return;
        if (await fileHash(copy) !== hash) { await fs.rename(copy, path.join(await this.safeDirectory('recovery'), name + '-' + randomUUID())); result.quarantined++; return; }
        if (await this.contentAvailable(hash)) { await fs.rm(copy); result.removed++; return; }
        await replaceFileAtomically(copy, path.join(directory, hash)); this.verifiedContent.delete(hash);
        if (await this.contentAvailable(hash)) result.adopted++;
      });
    }
    return result;
  }
  async call(project: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Project identity is supplied by the verified host context, not the renderer.
    const projectKey = digest(project), operation = request.operation;
    if (operation === 'journal-load' || operation === 'journal-save') return this.queue('journal:' + projectKey, async () => {
      const directory = await this.safeDirectory('journals'), target = path.join(directory, projectKey + '.json');
      const raw = await fs.readFile(target, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
      const revision = raw ? digest(raw) : 'absent';
      if (operation === 'journal-load') return { state: raw ? JSON.parse(raw) : null, revision };
      if (request.revision !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      if (!request.state || typeof request.state !== 'object') throw Error('Invalid workspace journal.');
      await this.atomic(target, request.state);
      return { ok: true, revision: digest(JSON.stringify(request.state)) };
    });
    if (operation === 'content-root') return { path: await this.safeDirectory('content') };
    if (operation === 'incoming-root') return { path: await this.safeDirectory('incoming') };
    if (operation === 'enumerate') {
      const source = String(request.path);
      if (!path.isAbsolute(source)) throw Error('An absolute import source is required.');
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw Error('Symbolic links are not imported recursively.');
      if (stat.isFile()) return { kind: 'file', name: path.basename(source) };
      if (!stat.isDirectory()) throw Error('Choose a regular file or folder.');
      const entries = await fs.readdir(source, { withFileTypes: true });
      return { kind: 'folder', name: path.basename(source), entries: entries.filter(item => !item.isSymbolicLink() && (item.isFile() || item.isDirectory())).map(item => ({ path: path.join(source, item.name), name: item.name, kind: item.isDirectory() ? 'folder' : 'file' })) };
    }
    if (operation === 'content-tidy') return this.tidyContent();
    if (operation === 'content-check') {
      const hash = hashValue(request.hash), target = path.join(await this.safeDirectory('content'), hash);
      return this.queue('content:' + hash, async () => { const available = await this.contentAvailable(hash); return { available, ...(available ? { path: target, size: (await fs.stat(target)).size } : {}) }; });
    }
    const scope = identity(request.workspaceId), entryId = identity(request.entryId);
    return this.queue(scope + '/' + entryId, async () => {
      const { directory, record } = await this.binding(scope, entryId);
      const name = nameValue(record?.name ?? request.name), target = path.join(directory, record?.name ?? name);
      if (operation === 'capture' || operation === 'import') {
        const source = operation === 'import' && !record ? String(request.path) : target;
        if (!path.isAbsolute(source)) throw Error('An absolute local source is required.');
        const cached = record?.hash && record.stamp && record.stamp === await fileStamp(source) && await this.queue('content:' + record.hash, () => this.contentAvailable(record.hash!));
        const captured = cached ? { hash: record.hash!, size: (await fs.stat(source)).size, stamp: record.stamp! } : await this.snapshot(source);
        if (operation === 'import' && !record) {
          // Commit intent first. A restart can finish this import from immutable
          // content without rereading (or altering) the independent original.
          await this.atomic(path.join(directory, '.binding.json'), { name, hash: null, versionId: null, pending: { hash: captured.hash, versionId: null } });
          const temporary = target + '.import-' + randomUUID();
          try {
            await fs.copyFile(path.join(this.root, 'content', captured.hash), temporary, fs.constants.COPYFILE_EXCL);
            const durable = await fs.open(temporary, 'r+'); try { await durable.sync(); } finally { await durable.close(); }
            try { await fs.link(temporary, target); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await fileHash(target) !== captured.hash) throw error; }
          } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
          await this.atomic(path.join(directory, '.binding.json'), { name, hash: captured.hash, versionId: null, stamp: await fileStamp(target) });
        }
        return { ...captured, path: operation === 'import' ? path.join(directory, record?.name ?? name) : target, baseVersion: record?.versionId ?? null, baseHash: record?.hash ?? null };
      }
      if (operation === 'path') return { path: target, available: await fileStamp(target).then(() => true, () => false), versionId: record?.versionId ?? null, hash: record?.hash ?? null };
      const versionId = identity(request.versionId);
      if (operation === 'delete') {
        if (!record) return { ok: true };
        const actual = await fileHash(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (actual && actual !== record.hash) return { ok: false, localChange: await this.snapshot(target), baseVersion: record.versionId };
        if (actual) { const bin = await this.safeDirectory(scope, 'bin', entryId); await fs.rename(target, path.join(bin, versionId)).catch(async error => { if (error.code !== 'EEXIST') throw error; if (await fileHash(path.join(bin, versionId)) !== actual) throw error; }); }
        await this.atomic(path.join(directory, '.binding.json'), { ...record, versionId, hash: null });
        return { ok: true };
      }
      if (operation !== 'publish') throw Error('Unknown workspace file operation.');
      const hash = hashValue(request.hash), content = path.join(await this.safeDirectory('content'), hash);
      if (!await this.queue('content:' + hash, () => this.contentAvailable(hash))) throw Error('Workspace content is not available yet.');
      const originalStamp = await fileStamp(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      const actual = await fileHash(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (actual && actual !== record?.hash && actual !== hash) return { ok: false, localChange: await this.snapshot(target), baseVersion: record?.versionId ?? null };
      const pending: Binding = { name: record?.name ?? name, hash: record?.hash ?? null, versionId: record?.versionId ?? null, pending: { hash, versionId } };
      await this.atomic(path.join(directory, '.binding.json'), pending);
      if (actual !== hash) {
        const temporary = target + '.publish-' + randomUUID();
        try {
          await fs.copyFile(content, temporary, fs.constants.COPYFILE_EXCL);
          const durable = await fs.open(temporary, 'r+'); try { await durable.sync(); } finally { await durable.close(); }
          const latestStamp = await fileStamp(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
          if (latestStamp !== originalStamp) return { ok: false, localChange: latestStamp ? await this.snapshot(target) : true, baseVersion: record?.versionId ?? null };
          await replaceFileAtomically(temporary, target);
        }
        finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      }
      await this.atomic(path.join(directory, '.binding.json'), { name: pending.name, hash, versionId, stamp: await fileStamp(target) });
      return { ok: true, path: target, hash, versionId };
    });
  }
}
