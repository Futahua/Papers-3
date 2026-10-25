import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';

interface Upload { id: string; deviceId: string; sessionId: string; bytes: number; sha256: string; complete: boolean }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;

/** Owner-private streamed working copies, separate from source files and read caches.
 * Interrupted chunks remain resumable by their actual durable prefix. */
export class RemoteFileEditUploads {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly revoked = new Set<string>();
  private accepting = true;
  constructor(private readonly directory: string, private readonly maximumBytes = 64 * 1024 ** 3, private readonly maximumChunk = 8 * 1024 ** 2) {}
  private folder(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid working-copy identity.');
    return path.join(this.directory, id);
  }
  private store(id: string) {
    return new AtomicJsonStore(path.join(this.folder(id), 'upload.json'), { recoveryDir: path.join(this.folder(id), 'recovery') });
  }
  private available(deviceId: string) {
    if (!this.accepting || this.revoked.has(deviceId)) throw new Error('Device access is unavailable.');
  }
  private async read(deviceId: string, id: string): Promise<Upload> {
    this.available(deviceId);
    // Missing/corrupt metadata requires recovery, never guesses ownership from a path.
    const value: Upload = JSON.parse(await fs.readFile(path.join(this.folder(id), 'upload.json'), 'utf8'));
    if (value.id !== id || value.deviceId !== deviceId || !uuid.test(value.sessionId) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > this.maximumBytes || !sha.test(value.sha256) || typeof value.complete !== 'boolean') throw new Error('Working copy is unavailable.');
    return value;
  }
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(work);
    const settled = result.catch(() => {});
    this.queues.set(id, settled);
    void settled.then(() => { if (this.queues.get(id) === settled) this.queues.delete(id); });
    return result;
  }
  async begin(deviceId: string, sessionId: string, bytes: number, sha256: string): Promise<string> {
    this.available(deviceId);
    if (!deviceId || !uuid.test(sessionId) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maximumBytes || !sha.test(sha256)) throw new Error('A bounded verified working copy is required.');
    const id = randomUUID();
    return this.serial(id, async () => {
      this.available(deviceId);
      await fs.mkdir(this.folder(id), { recursive: true });
      const file = await fs.open(path.join(this.folder(id), 'working.bin'), 'wx');
      try { await file.sync(); } finally { await file.close(); }
      await this.store(id).save({ id, deviceId, sessionId, bytes, sha256, complete: false } satisfies Upload);
      return id;
    });
  }
  status(deviceId: string, id: string) {
    return this.serial(id, async () => {
      const value = await this.read(deviceId, id);
      const file = await fs.open(path.join(this.folder(id), 'working.bin'), 'r');
      try {
        const stats = await file.stat();
        if (!stats.isFile() || stats.size > value.bytes) throw new Error('Working-copy size is invalid.');
        const digest = createHash('sha256');
        for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk);
        const prefixSha256 = digest.digest('hex');
        if (value.complete && (stats.size !== value.bytes || prefixSha256 !== value.sha256)) throw new Error('Sealed working copy changed; retain it for recovery.');
        return { id, sessionId: value.sessionId, receivedBytes: stats.size, bytes: value.bytes, prefixSha256, sha256: value.sha256, complete: value.complete };
      } finally { await file.close(); }
    });
  }
  append(deviceId: string, id: string, offset: number, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<number> {
    return this.serial(id, async () => {
      const value = await this.read(deviceId, id);
      if (value.complete || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Working copy is sealed or offset is invalid.');
      const file = await fs.open(path.join(this.folder(id), 'working.bin'), 'r+');
      let received = 0;
      let checkedOffset = false;
      try {
        if ((await file.stat()).size !== offset) throw new Error('Resume offset changed. Check the retained prefix.');
        checkedOffset = true;
        for await (const chunk of chunks) {
          this.available(deviceId); signal?.throwIfAborted();
          if (!(chunk instanceof Uint8Array) || received + chunk.byteLength > this.maximumChunk || offset + received + chunk.byteLength > value.bytes) throw new Error('Upload exceeded its declared size or chunk limit.');
          let written = 0;
          while (written < chunk.byteLength) {
            const result = await file.write(chunk, written, chunk.byteLength - written, offset + received + written);
            if (!result.bytesWritten) throw new Error('Working-copy write made no progress.');
            written += result.bytesWritten;
          }
          received += chunk.byteLength;
        }
        this.available(deviceId); signal?.throwIfAborted();
        await file.sync();
        return offset + received;
      } catch (error) {
        // Only this chunk is undone; the previously confirmed prefix is retained.
        // A process crash instead leaves the actual prefix discoverable by status.
        if (checkedOffset && (received || (await file.stat()).size > offset)) { await file.truncate(offset); await file.sync(); }
        throw error;
      } finally { await file.close(); }
    });
  }
  seal(deviceId: string, id: string): Promise<void> {
    return this.serial(id, async () => {
      const value = await this.read(deviceId, id);
      const file = await fs.open(path.join(this.folder(id), 'working.bin'), 'r');
      try {
        if ((await file.stat()).size !== value.bytes) throw new Error('Working copy is incomplete.');
        const digest = createHash('sha256');
        for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk);
        if (digest.digest('hex') !== value.sha256) throw new Error('Working-copy verification failed; retained bytes are available for recovery.');
      } finally { await file.close(); }
      this.available(deviceId);
      value.complete = true;
      await this.store(id).save(value);
    });
  }
  /** Internal owner contract only. Never return this path to a remote client. */
  async checkedCopy(deviceId: string, id: string, sessionId: string, sha256: string): Promise<string> {
    const value = await this.read(deviceId, id);
    if (!value.complete || value.sessionId !== sessionId || value.sha256 !== sha256) throw new Error('A sealed working copy for this edit session is required.');
    return path.join(this.folder(id), 'working.bin');
  }
  revoke(deviceId: string) { this.revoked.add(deviceId); }
  async close() { this.accepting = false; await Promise.allSettled([...this.queues.values()]); }
}
