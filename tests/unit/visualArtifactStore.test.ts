import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createVisualArtifactStore } from '../../src/main/visual/visualArtifactStore';

describe('opaque visual artifact store', () => {
  it('atomically stores bounded bytes and reconstructs them through ID-only chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-artifacts-'));
    const store = createVisualArtifactStore(root, { ttlMs: 60_000 });
    const source = new TextEncoder().encode('visual evidence bytes');
    const metadata = await store.put(source, 'image/png');
    expect(metadata.artifactId).toMatch(/^va-/);
    expect(metadata.size).toBe(source.byteLength);
    expect(metadata.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(Object.keys(metadata)).not.toContain('filePath');

    const first = await store.read(metadata.artifactId, 0, 7);
    const second = await store.read(metadata.artifactId, first.nextOffset, 1024);
    const reconstructed = new Uint8Array([...first.bytes, ...second.bytes]);
    expect(new TextDecoder().decode(reconstructed)).toBe('visual evidence bytes');
    expect(second.done).toBe(true);
    expect(createHash('sha256').update(reconstructed).digest('hex')).toBe(metadata.sha256);
    expect(await readdir(root)).toEqual([`${metadata.artifactId}.bin`]);
  });

  it('removes incomplete temporary files and rejects arbitrary or oversized reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-artifacts-'));
    const store = createVisualArtifactStore(root);
    await expect(store.read('../outside', 0, 1)).rejects.toThrow(/artifact id is invalid/);
    await expect(store.read('va-00000000-0000-4000-8000-000000000000', 0, 1)).rejects.toThrow(/unavailable/);
    await expect(store.put(new Uint8Array(16 * 1024 * 1024 + 1), 'image/png')).rejects.toThrow(/outside/);
    await expect(readFile(join(root, 'does-not-exist.bin'))).rejects.toThrow();
  });

  it('expires artifacts and leaves no stale metadata available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-artifacts-'));
    let current = new Date('2026-09-02T00:00:00.000Z');
    const store = createVisualArtifactStore(root, { now: () => current, ttlMs: 10 });
    const metadata = await store.put(new Uint8Array([1, 2, 3]), 'application/octet-stream');
    current = new Date(current.getTime() + 11);
    await store.cleanup();
    await expect(store.read(metadata.artifactId, 0, 1)).rejects.toThrow(/unavailable/);
    expect(await store.delete(metadata.artifactId)).toBe(false);
  });
});
