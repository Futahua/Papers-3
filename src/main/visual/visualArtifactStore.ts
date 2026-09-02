import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const VISUAL_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const VISUAL_ARTIFACT_MAX_READ_BYTES = 1024 * 1024;
export const VISUAL_ARTIFACT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const VISUAL_ARTIFACT_TTL_MS = 60 * 60 * 1000;

export interface VisualArtifactMetadata {
  artifactId: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export interface VisualArtifactChunk {
  metadata: VisualArtifactMetadata;
  offset: number;
  nextOffset: number;
  done: boolean;
  bytes: Uint8Array;
}

export interface VisualArtifactStore {
  put(bytes: Uint8Array, mimeType: string): Promise<VisualArtifactMetadata>;
  read(artifactId: string, offset: number, length: number): Promise<VisualArtifactChunk>;
  delete(artifactId: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

interface StoredArtifact extends VisualArtifactMetadata {
  filePath: string;
}

function publicMetadata(entry: StoredArtifact): VisualArtifactMetadata {
  const { filePath: _filePath, ...metadata } = entry;
  return metadata;
}

const artifactIdPattern = /^va-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const artifactFilePattern = /^va-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/i;

function assertMimeType(mimeType: string): void {
  if (!/^[-\w.+]+\/[-\w.+]+$/.test(mimeType) || mimeType.length > 128) {
    throw new Error('artifact MIME type is invalid');
  }
}

function assertArtifactId(artifactId: string): void {
  if (!artifactIdPattern.test(artifactId)) throw new Error('artifact id is invalid');
}

function assertReadRange(offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('artifact offset is invalid');
  if (!Number.isSafeInteger(length) || length < 1 || length > VISUAL_ARTIFACT_MAX_READ_BYTES) {
    throw new Error('artifact read length is invalid');
  }
}

export function createVisualArtifactStore(
  rootDir: string,
  options: { now?: () => Date; ttlMs?: number; maxBytes?: number } = {},
): VisualArtifactStore {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? VISUAL_ARTIFACT_TTL_MS;
  const maxBytes = options.maxBytes ?? VISUAL_ARTIFACT_MAX_TOTAL_BYTES;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error('artifact TTL is invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > VISUAL_ARTIFACT_MAX_TOTAL_BYTES) {
    throw new Error('artifact store bound is invalid');
  }

  const entries = new Map<string, StoredArtifact>();
  let queue: Promise<void> = Promise.resolve();

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const filePathFor = (artifactId: string): string => path.join(rootDir, `${artifactId}.bin`);

  const cleanupExpired = async (): Promise<void> => {
    const timestamp = now().getTime();
    for (const [artifactId, entry] of entries) {
      if (Date.parse(entry.expiresAt) <= timestamp) {
        entries.delete(artifactId);
        await unlink(entry.filePath).catch(() => undefined);
      }
    }
    const names = await readdir(rootDir).catch(() => [] as string[]);
    await Promise.all(names
      .filter((name) => name.endsWith('.tmp'))
      .map((name) => rm(path.join(rootDir, name), { force: true })));
    // Artifacts are deliberately process-ephemeral. A fresh Papers process
    // has no trusted metadata for files from an older process, so remove
    // those bounded binary artifacts instead of allowing them to accumulate
    // outside the in-memory capacity accounting.
    await Promise.all(names
      .filter((name) => artifactFilePattern.test(name) && !entries.has(name.slice(0, -4)))
      .map((name) => rm(path.join(rootDir, name), { force: true })));
  };

  const totalBytes = (): number => [...entries.values()].reduce((total, entry) => total + entry.size, 0);

  return {
    put: (bytes, mimeType) => runExclusive(async () => {
      assertMimeType(mimeType);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > VISUAL_ARTIFACT_MAX_BYTES) {
        throw new Error('artifact size is outside the allowed bound');
      }
      await mkdir(rootDir, { recursive: true });
      await cleanupExpired();
      if (totalBytes() + bytes.byteLength > maxBytes) throw new Error('artifact store capacity is exhausted');
      const artifactId = `va-${randomUUID()}`;
      const filePath = filePathFor(artifactId);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      const hash = createHash('sha256').update(bytes).digest('hex');
      const createdAt = now();
      const metadata: StoredArtifact = {
        artifactId,
        mimeType,
        size: bytes.byteLength,
        sha256: hash,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        filePath,
      };
      try {
        await writeFile(tempPath, bytes, { flag: 'wx' });
        await rename(tempPath, filePath);
        entries.set(artifactId, metadata);
        const confirmed = await stat(filePath);
        if (confirmed.size !== bytes.byteLength) throw new Error('artifact finalize size mismatch');
        return publicMetadata(metadata);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        await rm(filePath, { force: true }).catch(() => undefined);
        entries.delete(artifactId);
        throw error;
      }
    }),
    read: (artifactId, offset, length) => runExclusive(async () => {
      assertArtifactId(artifactId);
      assertReadRange(offset, length);
      await mkdir(rootDir, { recursive: true });
      await cleanupExpired();
      const entry = entries.get(artifactId);
      if (!entry) throw new Error('artifact is unavailable');
      if (offset >= entry.size) {
        return { metadata: publicMetadata(entry), offset, nextOffset: offset, done: true, bytes: new Uint8Array() };
      }
      const raw = await readFile(entry.filePath);
      const end = Math.min(entry.size, offset + length);
      return {
        metadata: publicMetadata(entry),
        offset,
        nextOffset: end,
        done: end >= entry.size,
        bytes: new Uint8Array(raw.subarray(offset, end)),
      };
    }),
    delete: (artifactId) => runExclusive(async () => {
      assertArtifactId(artifactId);
      const entry = entries.get(artifactId);
      if (!entry) return false;
      entries.delete(artifactId);
      await unlink(entry.filePath).catch(() => undefined);
      return true;
    }),
    cleanup: () => runExclusive(async () => {
      await mkdir(rootDir, { recursive: true });
      await cleanupExpired();
    }),
  };
}
