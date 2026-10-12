import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { RemoteFileEntry } from './remoteFileResources';

interface Connection { id: string; name: string; address: string; secret: string; deviceId: string }
interface SecretBox { seal: (value: string) => string; open: (value: string) => string }
export interface RemoteDownloadJob { id: string; ownerId: string; entry: RemoteFileEntry; phase: 'queued' | 'transferring' | 'verifying' | 'completed' | 'failed'; bytes: number; error?: string }
interface CachedFile { ownerId: string; entry: RemoteFileEntry; sha256: string; key: string }
function extension(name: string): string { const ext = path.extname(name); return /^\.[A-Za-z0-9]{1,15}$/.test(ext) ? ext : '.bin'; }
function address(value: string, allowLoopback: boolean): string {
  const url = new URL(value);
  const octets = url.hostname.split('.').map(Number);
  const privatePeer = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
  if (url.protocol !== 'http:' || (!privatePeer && !(allowLoopback && url.hostname === '127.0.0.1')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the private Tailscale address shown by the owner.');
  return url.origin;
}
function entry(value: unknown): RemoteFileEntry {
  const candidate = value as RemoteFileEntry;
  if (!candidate || !/^[a-f0-9-]{36}$/.test(candidate.id) || typeof candidate.name !== 'string' || !['file', 'folder'].includes(candidate.kind) || !Number.isSafeInteger(candidate.size) || candidate.size < 0 || !Number.isFinite(candidate.modifiedAt) || !/^[a-f0-9]{64}$/.test(candidate.version)) throw new Error('Invalid remote file metadata.');
  return candidate;
}

/** Receiver owns connections and transfer bytes; AYG chooses pins and presentation. */
export class RemoteFileClient {
  private connections: Connection[] = [];
  private readonly jobs = new Map<string, RemoteDownloadJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly transfers = new Map<string, Promise<void>>();
  private readonly store: AtomicJsonStore;
  private saveQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly secrets: SecretBox, private readonly allowLoopback = false) {
    this.store = new AtomicJsonStore(path.join(directory, 'connections.json'), { recoveryDir: path.join(directory, 'recovery') });
  }
  async initialize(): Promise<void> {
    const report = await this.store.load<{ version: 1; connections: Connection[] }>();
    if (report.value) {
      if (report.value.version !== 1 || !Array.isArray(report.value.connections)) throw new Error('Remote connection store needs recovery.');
      for (const connection of report.value.connections) {
        address(connection.address, this.allowLoopback);
        if (!/^[a-f0-9-]{36}$/.test(connection.id) || typeof connection.name !== 'string' || typeof connection.secret !== 'string') throw new Error('Remote connection store needs recovery.');
      }
      this.connections = report.value.connections;
    }
  }
  snapshot() { return { devices: this.connections.map(({ id, name, address }) => ({ id, name, address })), jobs: structuredClone([...this.jobs.values()]) }; }
  async pair(ownerAddress: string, code: string, name: string): Promise<void> {
    const base = address(ownerAddress, this.allowLoopback);
    const response = await fetch(`${base}/v1/devices/pair`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
    if (!response.ok) throw new Error('Pairing was refused. Generate a new code on the owner.');
    const paired = await response.json();
    if (!/^[a-f0-9-]{36}$/.test(paired.owner?.id) || typeof paired.owner?.name !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(paired.token) || !/^[a-f0-9-]{36}$/.test(paired.deviceId)) throw new Error('Invalid pairing response.');
    const secret = this.secrets.seal(paired.token);
    const next = this.saveQueue.then(async () => {
      const connections = [...this.connections.filter(item => item.id !== paired.owner.id), { id: paired.owner.id, name: paired.owner.name, address: base, secret, deviceId: paired.deviceId }];
      await this.store.save({ version: 1, connections });
      this.connections = connections;
    });
    this.saveQueue = next.catch(() => {});
    await next;
  }
  private connection(ownerId: string): Connection {
    const connection = this.connections.find(item => item.id === ownerId);
    if (!connection) throw new Error('Device is not connected.');
    return connection;
  }
  private async request(ownerId: string, route: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
    const connection = this.connection(ownerId);
    const response = await fetch(`${connection.address}${route}`, { redirect: 'error', headers: { Authorization: `Bearer ${this.secrets.open(connection.secret)}`, ...headers }, signal: signal ?? AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(response.status === 412 ? 'Source changed. Refresh before downloading.' : response.status === 401 ? 'Access was revoked. Pair this device again.' : `Remote operation failed (${response.status}).`);
    return response;
  }
  async browse(ownerId: string, resourceId?: string, offset = 0) {
    if (resourceId && !/^[a-f0-9-]{36}$/.test(resourceId)) throw new Error('Invalid file identity.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid listing page.');
    const route = resourceId ? `/v1/files/${resourceId}/list?offset=${offset}` : '/v1/files/shares';
    const key = createHash('sha256').update(JSON.stringify([ownerId, resourceId ?? '', offset])).digest('hex');
    const listing = new AtomicJsonStore(path.join(this.directory, 'listings', `${key}.json`), { recoveryDir: path.join(this.directory, 'recovery') });
    try {
      const response = await (await this.request(ownerId, route)).json();
      if (response.owner && response.owner.id !== ownerId) throw new Error('Owner identity changed; pair again.');
      if (!Array.isArray(response.entries)) throw new Error('Invalid listing.');
      const result = { entries: response.entries.map(entry), nextOffset: response.nextOffset ?? null };
      await listing.save(result);
      return { ...result, online: true };
    } catch (error) {
      const cached = await listing.load<{ entries: RemoteFileEntry[]; nextOffset: number | null }>();
      if (!cached.value) throw error;
      return { ...cached.value, online: false, error: error instanceof Error ? error.message : 'Owner unavailable.' };
    }
  }
  download(ownerId: string, raw: unknown): RemoteDownloadJob {
    const file = entry(raw);
    if (file.kind !== 'file') throw new Error('Choose a file to download.');
    this.connection(ownerId);
    const existing = [...this.jobs.values()].find(job => job.ownerId === ownerId && job.entry.id === file.id && job.entry.version === file.version && job.phase !== 'failed');
    if (existing) return structuredClone(existing);
    const job: RemoteDownloadJob = { id: randomUUID(), ownerId, entry: file, phase: 'queued', bytes: 0 };
    this.jobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const transfer = this.transfer(job, controller.signal).catch(error => { job.phase = 'failed'; job.error = error instanceof Error ? error.message : 'Transfer failed.'; }).finally(() => { this.controllers.delete(job.id); this.transfers.delete(job.id); });
    this.transfers.set(job.id, transfer);
    return structuredClone(job);
  }
  private async transfer(job: RemoteDownloadJob, signal: AbortSignal): Promise<void> {
    const headers = { 'If-Match': `"${job.entry.version}"` };
    const digest = await (await this.request(job.ownerId, `/v1/files/${job.entry.id}/digest`, headers, signal)).json();
    if (digest.version !== job.entry.version || digest.size !== job.entry.size || !/^[a-f0-9]{64}$/.test(digest.sha256)) throw new Error('Invalid source verification.');
    const key = createHash('sha256').update(JSON.stringify([job.ownerId, job.entry.id, job.entry.version])).digest('hex');
    const directory = path.join(this.directory, 'content');
    await fs.mkdir(directory, { recursive: true });
    const partial = path.join(directory, `${key}.partial`);
    const complete = path.join(directory, `${key}${extension(job.entry.name)}`);
    const metadata = new AtomicJsonStore(path.join(directory, `${key}.json`), { recoveryDir: path.join(this.directory, 'recovery') });
    let offset = await fs.stat(partial).then(stats => stats.size).catch(error => { if (error.code !== 'ENOENT') throw error; return 0; });
    if (offset > job.entry.size) { await fs.rename(partial, `${partial}.${randomUUID()}.invalid`); offset = 0; }
    job.phase = 'transferring'; job.bytes = offset;
    if (offset < job.entry.size) {
      const response = await this.request(job.ownerId, `/v1/files/${job.entry.id}/content`, { ...headers, ...(offset ? { Range: `bytes=${offset}-` } : {}) }, signal);
      if ((offset && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${job.entry.size - 1}/${job.entry.size}`)) || response.headers.get('etag') !== headers['If-Match']) throw new Error('Source cannot resume this version safely.');
      const progress = new Transform({ transform(chunk, _encoding, callback) { job.bytes += chunk.length; callback(null, chunk); } });
      if (!response.body) throw new Error('Remote file content is missing.');
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), progress, createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal });
    } else if (!offset) await fs.writeFile(partial, '');
    job.phase = 'verifying';
    const hash = createHash('sha256');
    await pipeline(createReadStream(partial), hash, { signal });
    if ((await fs.stat(partial)).size !== job.entry.size || hash.digest('hex') !== digest.sha256) {
      await fs.rename(partial, `${partial}.${randomUUID()}.invalid`);
      throw new Error('Download verification failed. Retry to retrieve a clean copy.');
    }
    await fs.rename(partial, complete);
    await metadata.save({ ownerId: job.ownerId, entry: job.entry, sha256: digest.sha256, key } satisfies CachedFile);
    job.bytes = job.entry.size; job.phase = 'completed';
  }
  async offline(ownerId: string): Promise<CachedFile[]> {
    const directory = path.join(this.directory, 'content');
    const names = await fs.readdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return [] as string[]; });
    const files: CachedFile[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const value = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as CachedFile;
      if (value.ownerId === ownerId && /^[a-f0-9]{64}$/.test(value.key) && (await fs.stat(path.join(directory, `${value.key}${extension(value.entry.name)}`)).catch(() => null))?.size === value.entry.size) files.push(value);
    }
    return files;
  }
  cancel(id: string): void { this.controllers.get(id)?.abort(); }
  async cachedPath(ownerId: string, key: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cached file identity.');
    const cached = (await this.offline(ownerId)).find(file => file.key === key);
    if (!cached) throw new Error('Offline file is unavailable.');
    const target = path.join(this.directory, 'content', `${key}${extension(cached.entry.name)}`);
    const hash = createHash('sha256');
    await pipeline(createReadStream(target), hash);
    if (hash.digest('hex') !== cached.sha256) throw new Error('Offline copy is damaged. Download a fresh copy.');
    return target;
  }
  async close(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.transfers.values()]);
    await this.saveQueue;
  }
}
