import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';

export interface RemoteFileEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  modifiedAt: number;
  version: string;
}
export interface RemoteFileShare { id: string; name: string; directory: string }
type Resource = { shareId: string; target: string };
export class RemoteFileError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function version(stats: Awaited<ReturnType<FileHandle['stat']>>): string {
  return createHash('sha256').update([stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(':')).digest('hex');
}

const SKIPPABLE_ENTRY_ERRORS = new Set(['ENOENT', 'EPERM', 'EACCES', 'EBUSY', 'ELOOP', 'EINVAL', 'UNKNOWN']);

/** Session resources expose opaque identities, never accept a client-authored OS path. */
export class RemoteFileResources {
  private readonly resources = new Map<string, Resource>();
  private readonly identities = new Map<string, string>();
  private readonly roots = new Map<string, { name: string; directory: string }>();
  private constructor(private readonly identityKey: string) {}

  static async create(shares: RemoteFileShare[], identityKey: string = randomUUID()): Promise<RemoteFileResources> {
    const catalog = new RemoteFileResources(identityKey);
    for (const share of shares) {
      if (!share.id || catalog.roots.has(share.id) || !path.isAbsolute(share.directory)) {
        throw new RemoteFileError('SHARE_INVALID', 'Share identity and absolute directory are required.');
      }
      const directory = await fs.realpath(share.directory);
      if (!(await fs.stat(directory)).isDirectory()) throw new RemoteFileError('SHARE_INVALID', 'Share must be a directory.');
      catalog.roots.set(share.id, { name: share.name, directory });
    }
    return catalog;
  }

  private identify(shareId: string, target: string): string {
    const key = JSON.stringify([shareId, target]);
    const previous = this.identities.get(key);
    if (previous) return previous;
    if (this.resources.size >= 100_000) throw new RemoteFileError('RESOURCE_LIMIT', 'Reconnect to refresh the resource catalog.');
    const digest = createHmac('sha256', this.identityKey).update(key).digest('hex').slice(0, 32);
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${(8 | (parseInt(digest[16]!, 16) & 3)).toString(16)}${digest.slice(17, 20)}-${digest.slice(20)}`;
    this.resources.set(id, { shareId, target });
    this.identities.set(key, id);
    return id;
  }

  private async resolve(id: string): Promise<Resource> {
    const resource = this.resources.get(id);
    const root = resource && this.roots.get(resource.shareId);
    if (!resource || !root) throw new RemoteFileError('RESOURCE_UNKNOWN', 'Resource is unavailable in this session.');
    const target = await fs.realpath(resource.target);
    if (!contains(root.directory, target)) throw new RemoteFileError('RESOURCE_OUTSIDE_SHARE', 'Resource has left the shared directory.');
    return { ...resource, target };
  }

  private async describe(shareId: string, target: string, name = path.basename(target)): Promise<RemoteFileEntry> {
    const stats = await fs.stat(target);
    if (!stats.isDirectory() && !stats.isFile()) throw new RemoteFileError('RESOURCE_UNSUPPORTED', 'Resource is not a regular file or directory.');
    return { id: this.identify(shareId, target), name, kind: stats.isDirectory() ? 'folder' : 'file', size: stats.size, modifiedAt: stats.mtimeMs, version: version(stats) };
  }

  async shares(): Promise<RemoteFileEntry[]> {
    return Promise.all([...this.roots].map(([id, root]) => this.describe(id, root.directory, root.name)));
  }

  async list(id: string, offset = 0, limit = 200): Promise<{ entries: RemoteFileEntry[]; nextOffset: number | null }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RemoteFileError('PAGE_INVALID', 'Invalid listing page.');
    }
    const resource = await this.resolve(id);
    const root = this.roots.get(resource.shareId)!;
    const names = (await fs.readdir(resource.target)).sort((a, b) => a.localeCompare(b));
    const entries: RemoteFileEntry[] = [];
    for (const name of names.slice(offset, offset + limit)) {
      const target = path.join(resource.target, name);
      try {
        if (!contains(root.directory, await fs.realpath(target))) continue;
        entries.push(await this.describe(resource.shareId, target, name));
      } catch (error) {
        if (error instanceof RemoteFileError) continue;
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (code === 'ENOENT') continue;
        if (!SKIPPABLE_ENTRY_ERRORS.has(code)) throw error;
        // A real entry must not vanish because it was briefly locked (antivirus scans) or is
        // protected (DumpStack.log.tmp). An ordinary file or folder needs no link resolution to
        // stay inside the share, so list it from its own metadata. Unverifiable links stay out.
        const stats = await fs.lstat(target).catch(() => null);
        if (!stats || stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) continue;
        entries.push({ id: this.identify(resource.shareId, target), name, kind: stats.isDirectory() ? 'folder' : 'file', size: stats.size, modifiedAt: stats.mtimeMs, version: version(stats) });
      }
    }
    return { entries, nextOffset: offset + limit < names.length ? offset + limit : null };
  }

  async stat(id: string): Promise<RemoteFileEntry> {
    const resource = await this.resolve(id);
    return { ...await this.describe(resource.shareId, resource.target), id };
  }

  async checkedPath(id: string, expectedVersion: string, allowRoot = false): Promise<{ path: string; entry: RemoteFileEntry }> {
    const resource = await this.resolve(id);
    if ((await fs.lstat(this.resources.get(id)!.target)).isSymbolicLink()) throw new RemoteFileError('LINK_MUTATION_UNSUPPORTED', 'Changing symbolic links or junctions requires an explicit link policy.');
    const entry = await this.stat(id);
    if (entry.version !== expectedVersion) throw new RemoteFileError('VERSION_CHANGED', 'Resource changed; refresh before changing it.');
    if (!allowRoot && resource.target === this.roots.get(resource.shareId)!.directory) throw new RemoteFileError('SHARE_ROOT_PROTECTED', 'The shared root cannot be moved, renamed or deleted.');
    return { path: resource.target, entry };
  }

  async digest(id: string, expectedVersion: string): Promise<{ version: string; sha256: string; size: number }> {
    const lease = await this.open(id, expectedVersion);
    try {
      const hash = createHash('sha256');
      await pipeline(lease.handle.createReadStream({ autoClose: false }), hash);
      await lease.verify();
      return { version: lease.entry.version, sha256: hash.digest('hex'), size: lease.entry.size };
    } finally { await lease.handle.close(); }
  }

  /** Owner-only scope for checked edit providers. Never serialize OS paths to peers. */
  async checkedEditSource(id: string, expectedVersion: string): Promise<{ path: string; approvedRoot: string; entry: RemoteFileEntry }> {
    const source = await this.checkedPath(id, expectedVersion);
    if (source.entry.kind !== 'file') throw new RemoteFileError('RESOURCE_NOT_FILE', 'Choose a regular file to edit.');
    const resource = await this.resolve(id);
    return { ...source, approvedRoot: this.roots.get(resource.shareId)!.directory };
  }

  async open(id: string, expectedVersion: string): Promise<{ handle: FileHandle; entry: RemoteFileEntry; verify: () => Promise<void> }> {
    const resource = await this.resolve(id);
    const handle = await fs.open(resource.target, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new RemoteFileError('RESOURCE_NOT_FILE', 'Resource is not a file.');
      if (version(stats) !== expectedVersion) throw new RemoteFileError('VERSION_CHANGED', 'File changed; refresh before transferring.');
      // Recheck after opening: replacing a path with an external junction must not grant access.
      await this.resolve(id);
      const pathStats = await fs.stat(resource.target);
      if (version(pathStats) !== expectedVersion) throw new RemoteFileError('VERSION_CHANGED', 'File was replaced while opening.');
      const entry = { ...await this.describe(resource.shareId, resource.target), id };
      return { handle, entry, verify: async () => {
        if (version(await handle.stat()) !== expectedVersion) throw new RemoteFileError('VERSION_CHANGED', 'File changed during transfer.');
        const current = await this.stat(id);
        if (current.version !== expectedVersion) throw new RemoteFileError('VERSION_CHANGED', 'Source was replaced during transfer.');
      } };
    } catch (error) { await handle.close(); throw error; }
  }
}
