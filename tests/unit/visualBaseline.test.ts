import { mkdtemp, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compareVisualImages, createVisualBaselineStore, hashSemanticSnapshot } from '../../src/main/visual/visualBaseline';

const key = { fixtureId: 'neutral.visual.fixture', captureTarget: 'surface:primary', visualProfileVersion: 1, platform: 'win32', electronVersion: '43.1' } as const;
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const png2 = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

describe('deterministic visual baselines', () => {
  it('separates identical pixels from changed semantic geometry', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(compareVisualImages({ width: 2, height: 1, rgba }, { width: 2, height: 1, rgba: new Uint8Array(rgba) }, hashSemanticSnapshot({ x: 1 }), hashSemanticSnapshot({ x: 2 }))).toMatchObject({
      dimensionsMatch: true, changedPixelCount: 0, changedPixelPercent: 0, perceptualScore: 1, semanticChanged: true,
    });
  });

  it('reports a deterministic changed-pixel rectangle', () => {
    const expected = new Uint8Array(4 * 4 * 4); const actual = new Uint8Array(expected);
    actual[(2 * 4 + 1) * 4] = 255;
    expect(compareVisualImages({ width: 4, height: 4, rgba: expected }, { width: 4, height: 4, rgba: actual }, 'a'.repeat(64), 'a'.repeat(64))).toMatchObject({
      changedPixelCount: 1, changedPixelPercent: 6.25, maxBoundingDiffRect: { x: 1, y: 2, width: 1, height: 1 }, semanticChanged: false,
    });
  });

  it('requires opt-in and preserves the previous manifest after a failed replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-baseline-'));
    const store = createVisualBaselineStore(root, { now: () => new Date('2026-09-02T00:00:00.000Z') });
    await expect(store.update({ key, png: new Uint8Array([1]), width: 1, height: 1, semanticSnapshot: { a: 1 }, createdFromCommit: 'abc', allowUpdate: false })).rejects.toThrow(/explicit opt-in/);
    const first = await store.update({ key, png, width: 1, height: 1, semanticSnapshot: { a: 1 }, createdFromCommit: 'abc', allowUpdate: true });
    const broken = createVisualBaselineStore(root, { publishManifest: async () => { throw new Error('interrupted'); } });
    await expect(broken.update({ key, png: png2, width: 1, height: 1, semanticSnapshot: { a: 2 }, createdFromCommit: 'def', allowUpdate: true })).rejects.toThrow(/interrupted/);
    expect((await store.read(key))?.manifest.semanticSnapshotSha256).toBe(first.current.semanticSnapshotSha256);
    await store.update({ key, png: png2, width: 1, height: 1, semanticSnapshot: { a: 2 }, createdFromCommit: 'def', allowUpdate: true });
    expect((await readdir(root)).filter((name) => name.endsWith('.png'))).toHaveLength(1);
    await expect(store.update({ key, png: new Uint8Array([2]), width: 1, height: 1, semanticSnapshot: { a: 3 }, createdFromCommit: 'ghi', allowUpdate: true })).rejects.toThrow(/not a PNG/);
  });

  it('serializes read cleanup behind an in-progress update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-baseline-race-'));
    const seed = createVisualBaselineStore(root);
    await seed.update({ key, png, width: 1, height: 1, semanticSnapshot: { a: 1 }, createdFromCommit: 'abc', allowUpdate: true });
    let publishStarted!: () => void;
    let releasePublish!: () => void;
    const publishing = new Promise<void>((resolve) => { publishStarted = resolve; });
    const publishGate = new Promise<void>((resolve) => { releasePublish = resolve; });
    const store = createVisualBaselineStore(root, {
      publishManifest: async (temporary, finalPath) => {
        publishStarted();
        await publishGate;
        await rename(temporary, finalPath);
      },
    });
    const updatePromise = store.update({ key, png: png2, width: 1, height: 1, semanticSnapshot: { a: 2 }, createdFromCommit: 'def', allowUpdate: true });
    await publishing;
    let readFinished = false;
    const readPromise = store.read(key).then((result) => { readFinished = true; return result; });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    releasePublish();
    await updatePromise;
    expect((await readPromise)?.png).toEqual(png2);
    expect((await readdir(root)).filter((name) => name.endsWith('.png'))).toHaveLength(1);
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  });
});
