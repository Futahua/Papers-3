import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_TARGET_BYTES = 3 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1_200;
const inFlight = new Map<string, Promise<DerivedArtifactResult>>();

export interface DerivedArtifactResult {
  filePath: string;
  key: string;
  cached: boolean;
}

function sameSourceVersion(a: { size: number; mtimeMs: number }, b: { size: number; mtimeMs: number }): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function sourceKey(source: string, providerKey: string): Promise<string> {
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error('Preview source is not a file.');
  return createHash('sha256')
    .update(path.resolve(source).toLocaleLowerCase('en-US'))
    .update('\0')
    .update(String(stats.size))
    .update('\0')
    .update(String(stats.mtimeMs))
    .update('\0')
    .update(providerKey)
    .digest('hex');
}

async function usable(target: string, validate?: (target: string) => Promise<boolean>): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    if (!stats.isFile() || stats.size <= 0) return false;
    if (validate && !await validate(target)) return false;
    const now = new Date();
    await fs.utimes(target, now, now).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function pruneDerivedPreviewCache(input: {
  directory: string;
  maxBytes?: number;
  targetBytes?: number;
  maxEntries?: number;
}): Promise<void> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const targetBytes = Math.min(input.targetBytes ?? DEFAULT_TARGET_BYTES, maxBytes);
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let names: string[];
  try {
    names = await fs.readdir(input.directory);
  } catch {
    return;
  }
  const entries = [];
  for (const name of names) {
    if (name.includes('.tmp-')) continue;
    const target = path.join(input.directory, name);
    try {
      const stats = await fs.stat(target);
      if (stats.isFile()) entries.push({ target, size: stats.size, usedAt: stats.mtimeMs });
    } catch {
      // Cache cleanup is best effort.
    }
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  let count = entries.length;
  if (total <= maxBytes && count <= maxEntries) return;
  entries.sort((a, b) => a.usedAt - b.usedAt || a.target.localeCompare(b.target));
  for (const entry of entries) {
    if (total <= targetBytes && count <= maxEntries) break;
    try {
      await fs.rm(entry.target, { force: true });
      total -= entry.size;
      count -= 1;
    } catch {
      // A live reader may hold a file; leave it for the next prune.
    }
  }
}

export async function getOrCreateDerivedArtifact(input: {
  cacheDirectory: string;
  source: string;
  providerKey: string;
  extension: string;
  create: (tempPath: string) => Promise<void>;
  validate?: (target: string) => Promise<boolean>;
}): Promise<DerivedArtifactResult> {
  const directory = path.join(input.cacheDirectory, 'derived-previews');
  await fs.mkdir(directory, { recursive: true });
  const key = await sourceKey(input.source, input.providerKey);
  const extension = input.extension.startsWith('.') ? input.extension : `.${input.extension}`;
  const target = path.join(directory, `${key}${extension}`);
  if (await usable(target, input.validate)) {
    void pruneDerivedPreviewCache({ directory });
    return { filePath: target, key, cached: true };
  }

  const existing = inFlight.get(target);
  if (existing) return existing;

  const work = (async (): Promise<DerivedArtifactResult> => {
    const temp = path.join(directory, `${key}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`);
    try {
      await input.create(temp);
      if (!await usable(temp, input.validate)) throw new Error('Derived preview provider did not create a valid artifact.');
      await fs.rename(temp, target).catch(async (error: NodeJS.ErrnoException) => {
        if ((error.code === 'EEXIST' || error.code === 'EPERM') && await usable(target, input.validate)) {
          await fs.rm(temp, { force: true });
          return;
        }
        throw error;
      });
      void pruneDerivedPreviewCache({ directory });
      return { filePath: target, key, cached: false };
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  })();
  inFlight.set(target, work);
  try {
    return await work;
  } finally {
    if (inFlight.get(target) === work) inFlight.delete(target);
  }
}

export async function getOrCreateSourceSnapshot(input: {
  cacheDirectory: string;
  source: string;
  maxAttempts?: number;
}): Promise<DerivedArtifactResult> {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 5));
  const extension = path.extname(input.source) || '.bin';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await fs.stat(input.source);
    if (!before.isFile()) throw new Error('Preview source is not a file.');
    const artifact = await getOrCreateDerivedArtifact({
      cacheDirectory: input.cacheDirectory,
      source: input.source,
      providerKey: 'source-snapshot-v1',
      extension,
      create: async (target) => {
        await fs.copyFile(input.source, target);
      },
    });
    const after = await fs.stat(input.source);
    if (sameSourceVersion(before, after)) return artifact;
  }
  throw new Error('Preview source changed while a safe snapshot was being created.');
}
