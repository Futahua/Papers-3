import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeState } from './public/workspace-model-20260730b.js';
import { hydrationSummaryDisagrees, semanticKeyForItem, workspaceVisualSummary } from './public/app/visual-observability.js';
import { VISUAL_FIXTURE_KEYS, VISUAL_PROFILE, assertFixtureGeometry, fixtureGeometryPasses } from './public/app/visual-fixture-contract.js';
import { baselineUpdateEnabled, sha256, validateBaselineManifest } from './public/app/visual-baseline.js';

const FIXTURE = new URL('./test-fixtures/visual/non-empty-state.json', import.meta.url);

test('synthetic visual fixture is non-empty, semantically keyed and read-only', async () => {
  const before = await readFile(FIXTURE);
  const source = JSON.parse(before);
  const installed = normalizeState(source.state);
  assert.equal(source.revision, 'fixture-visual-non-empty-v1');
  assert.deepEqual(workspaceVisualSummary(installed), { groups: 1, shortcuts: 1, windowLayouts: 0 });
  assert.equal(hydrationSummaryDisagrees(source.state, installed), false);
  assert.equal(semanticKeyForItem({ ...installed.groups[0], kind: 'group' }), 'group.fixture-group');
  assert.equal(semanticKeyForItem({ ...installed.shortcuts[0], kind: 'shortcut' }), 'shortcut.fixture-shortcut');
  const after = await readFile(FIXTURE);
  assert.equal(createHash('sha256').update(before).digest('hex'), createHash('sha256').update(after).digest('hex'));
});

test('deterministic profile and semantic geometry contract are explicit', () => {
  assert.deepEqual(VISUAL_PROFILE, {
    visualProfileVersion: 1,
    window: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    theme: 'light',
    transparency: false,
    animations: 'disabled',
    reducedMotion: false,
    locale: 'en-US',
    fixtureFont: 'Segoe UI',
  });
  const observations = VISUAL_FIXTURE_KEYS.map((key, index) => ({
    key,
    visible: true,
    boundsCss: { x: index * 10, y: index * 10, width: 100, height: 40 },
  }));
  assert.equal(fixtureGeometryPasses(observations), true);
  assert.deepEqual(assertFixtureGeometry(observations).map(({ key, visible, bounded }) => ({ key, visible, bounded })), VISUAL_FIXTURE_KEYS.map((key) => ({ key, visible: true, bounded: true })));
  assert.equal(fixtureGeometryPasses(observations.slice(1)), false);
});

test('baseline updates require explicit opt-in and preserve content-addressed integrity', () => {
  const png = Buffer.from('synthetic-png-fixture');
  const manifest = {
    fixtureId: 'as-you-go-non-empty-v1', captureTarget: 'surface', visualProfileVersion: 1,
    dimensions: { width: 1280, height: 800 }, pngSha256: sha256(png),
  };
  assert.equal(validateBaselineManifest(manifest, VISUAL_PROFILE), true);
  assert.equal(baselineUpdateEnabled({}), false);
  assert.equal(baselineUpdateEnabled({ UPDATE_VISUAL_BASELINES: '1' }), true);
  assert.notEqual(sha256(png), sha256(Buffer.from('changed')));
});
