import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compareVisualImages, createVisualBaselineStore, hashSemanticSnapshot } from '../../src/main/visual/visualBaseline';

const key = { fixtureId: 'neutral.visual.fixture', captureTarget: 'surface:primary', visualProfileVersion: 1, platform: 'win32', electronVersion: '43.1' } as const;

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
    const first = await store.update({ key, png: new Uint8Array([1]), width: 1, height: 1, semanticSnapshot: { a: 1 }, createdFromCommit: 'abc', allowUpdate: true });
    await expect(store.update({ key, png: new Uint8Array([2]), width: 1, height: 1, semanticSnapshot: { a: 2 }, createdFromCommit: 'def', allowUpdate: true })).resolves.toMatchObject({ previous: first.current });
    expect((await store.read(key))?.manifest.pngSha256).not.toBe(first.current.pngSha256);
  });
});
