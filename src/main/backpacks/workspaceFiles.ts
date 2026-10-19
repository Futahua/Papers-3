import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { replaceFileAtomically } from './backpackProjectService';
import {evictCheckedFiles} from './workspaceCacheEviction';

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
  private readonly journals = new Map<string, { stamp: string; raw: string; revision: string }>();
  private storageReading: {at:number;value:Record<string,unknown>} | null = null;
  constructor(readonly root: string) {}
  private async journalStamp(target: string): Promise<string> {
    try {
      const s = await fs.lstat(target, { bigint: true });
      if (!s.isFile() || s.isSymbolicLink()) throw Error('Workspace journal was replaced.');
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
  }
  private async journalRead(target: string, fresh: boolean): Promise<{ raw: string; revision: string }> {
    const before = await this.journalStamp(target), cached = this.journals.get(target);
    if (!fresh && cached?.stamp === before) return cached;
    this.journals.delete(target);
    const raw = await fs.readFile(target, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    const revision = raw ? digest(raw) : 'absent';
    // A racing replacement may be returned as a snapshot but must never be cached.
    if (before === await this.journalStamp(target)) this.journals.set(target, { stamp: before, raw, revision });
    return { raw, revision };
  }
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
    if(['import','capture','publish','delete','content-tidy','cache-evict'].includes(String(request.operation)))return this.queue('cache-mutations',()=>this.dispatch(project,request));
    return this.dispatch(project,request);
  }
  private async dispatch(project: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Project identity is supplied by the verified host context, not the renderer.
    const projectKey = digest(project), operation = request.operation;
    if (operation === 'journal-load' || operation === 'journal-save') return this.queue('journal:' + projectKey, async () => {
      const directory = await this.safeDirectory('journals'), target = path.join(directory, projectKey + '.json');
      // Reads reuse bytes only while the file generation matches. Writes always
      // re-read and hash the durable file, preserving the existing CAS boundary.
      const { raw, revision } = await this.journalRead(target, operation === 'journal-save');
      // The page keeps its last copy: when it already holds this revision, nothing is parsed or sent.
      if (operation === 'journal-load' && typeof request.known === 'string' && request.known === revision) return { unchanged: true, revision };
      if (operation === 'journal-load') return { state: raw ? JSON.parse(raw) : null, revision };
      if (request.revision !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      if (!request.state || typeof request.state !== 'object') throw Error('Invalid workspace journal.');
      this.journals.delete(target);
      await this.atomic(target, request.state);
      return { ok: true, revision: digest(JSON.stringify(request.state)) };
    });
    if (operation === 'storage-status') {
      if(this.storageReading && Date.now()-this.storageReading.at<60000)return this.storageReading.value;
      const content=await this.safeDirectory('content'),volume=await fs.statfs(content);
      let syncBytes=0,syncFiles=0;
      for(const entry of await fs.readdir(content,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{64}$/.test(entry.name)){try{const s=await fs.lstat(path.join(content,entry.name));if(s.isFile()&&!s.isSymbolicLink()){syncBytes+=s.size;syncFiles++;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
      const value={at:Date.now(),volume:path.parse(content).root,totalBytes:volume.blocks*volume.bsize,freeBytes:volume.bavail*volume.bsize,syncBytes,syncFiles};
      this.storageReading={at:Date.now(),value};return value;
    }
    if(operation==='cache-list'){
      const folder=await this.safeDirectory('content'),items=[];
      for(const entry of await fs.readdir(folder,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{64}$/.test(entry.name)){try{const s=await fs.lstat(path.join(folder,entry.name));if(s.isFile()&&!s.isSymbolicLink())items.push({hash:entry.name,size:s.size,at:s.birthtimeMs||s.mtimeMs});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
      return {items};
    }
    if(operation==='cache-evict'){
      const hash=hashValue(request.hash),expected=Array.isArray(request.bindings)?request.bindings as Record<string,unknown>[]:[];
      const content=path.join(await this.safeDirectory('content'),hash),targets:string[]=[];
      for(const scope of await fs.readdir(this.root,{withFileTypes:true})){
        if(!scope.isDirectory()||scope.isSymbolicLink()||!await fs.lstat(path.join(this.root,scope.name,'entries')).then(s=>s.isDirectory()&&!s.isSymbolicLink(),()=>false))continue;
        for(const entry of await fs.readdir(path.join(this.root,scope.name,'entries'),{withFileTypes:true})){
          if(!entry.isDirectory()||entry.isSymbolicLink())continue;
          const binding=await this.binding(identity(scope.name),identity(entry.name));const record=binding.record;
          if(record?.pending?.hash===hash)return {ok:false,error:'An unfinished save is protected.'};
          if(record?.hash!==hash)continue;
          const wanted=expected.find(e=>e.workspaceId===scope.name&&e.entryId===entry.name&&e.versionId===record.versionId);
          if(!wanted||record.pending)return {ok:false,error:'A working copy is protected.'};
          const target=path.join(binding.directory,nameValue(record.name));
          try{const s=await fs.lstat(target);if(!s.isFile()||s.isSymbolicLink())return {ok:false,error:'File identity changed.'};targets.push(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        }
      }
      try{const s=await fs.lstat(content);if(!s.isFile()||s.isSymbolicLink())throw Error('Invalid content file');targets.push(content);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(!targets.length)return {ok:true,bytes:0};
      const result=await evictCheckedFiles(this.root,targets,hash);
      if(result.ok){this.verifiedContent.delete(hash);this.storageReading=null;}
      return result;
    }
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
