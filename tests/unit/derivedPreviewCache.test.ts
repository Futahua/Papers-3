import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getOrCreateDerivedArtifact, pruneDerivedPreviewCache } from '../../src/main/backpacks/derivedPreviewCache';

let root: string;
let source: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-derived-cache-'));
  source = path.join(root, 'source.bin');
  await fs.writeFile(source, 'source-v1');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('derived preview cache', () => {
  it('reuses the same provider/source artifact and invalidates when the source changes', async () => {
    const create = vi.fn(async (target: string) => {
      await fs.writeFile(target, 'artifact');
    });

    const first = await getOrCreateDerivedArtifact({
      cacheDirectory: root,
      source,
      providerKey: 'provider-v1',
      extension: '.dat',
      create,
    });
    expect(first.cached).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);

    const second = await getOrCreateDerivedArtifact({
      cacheDirectory: root,
      source,
      providerKey: 'provider-v1',
      extension: '.dat',
      create,
    });
    expect(second.cached).toBe(true);
    expect(second.filePath).toBe(first.filePath);
    expect(create).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await fs.writeFile(source, 'source-v2-expanded');
    const third = await getOrCreateDerivedArtifact({
      cacheDirectory: root,
      source,
      providerKey: 'provider-v1',
      extension: '.dat',
      create,
    });
    expect(third.cached).toBe(false);
    expect(third.filePath).not.toBe(first.filePath);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('prunes the least recently used artifacts toward the target budget', async () => {
    const directory = path.join(root, 'derived-previews');
    await fs.mkdir(directory, { recursive: true });
    const oldest = path.join(directory, 'old.bin');
    const middle = path.join(directory, 'mid.bin');
    const newest = path.join(directory, 'new.bin');
    await fs.writeFile(oldest, Buffer.alloc(10, 1));
    await fs.writeFile(middle, Buffer.alloc(10, 2));
    await fs.writeFile(newest, Buffer.alloc(10, 3));
    const now = Date.now();
    await fs.utimes(oldest, new Date(now - 30_000), new Date(now - 30_000));
    await fs.utimes(middle, new Date(now - 20_000), new Date(now - 20_000));
    await fs.utimes(newest, new Date(now - 10_000), new Date(now - 10_000));

    await pruneDerivedPreviewCache({
      directory,
      maxBytes: 25,
      targetBytes: 15,
      maxEntries: 3,
    });

    await expect(fs.stat(oldest)).rejects.toThrow();
    await expect(fs.stat(middle)).rejects.toThrow();
    expect((await fs.stat(newest)).size).toBe(10);
  });
});
