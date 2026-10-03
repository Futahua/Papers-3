import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVisualObservability,
  hydrationSummaryDisagrees,
  semanticKeyForItem,
  workspaceVisualSummary,
} from './public/app/visual-observability.js';

test('reports only the opaque revision and bounded model counters after hydration', () => {
  const calls = [];
  const visual = createVisualObservability({
    papersVisualDiagnosticBridgeV1: {
      reportStateHydrated: (...args) => calls.push(args),
    },
  });
  const state = {
    schemaVersion: 1,
    groups: [{ id: 'g1', secret: 'not-reported' }],
    shortcuts: [{ id: 's1', target: 'C:\\private\\file.txt' }],
    windowLayouts: [{ id: 'w1' }],
  };

  assert.equal(visual.hydrated(state, 'rev-opaque-1'), true);
  assert.deepEqual(calls, [['rev-opaque-1', { groups: 1, shortcuts: 1, windowLayouts: 1 }]]);
  assert.deepEqual(workspaceVisualSummary(null), { groups: 0, shortcuts: 0, windowLayouts: 0 });
});

test('reports structured hydration failure without error or state bytes', () => {
  const calls = [];
  const visual = createVisualObservability({
    papersVisualDiagnosticBridgeV1: {
      reportHydrationFailed: (...args) => calls.push(args),
    },
  });

  assert.equal(visual.hydrationFailed('install', 'model-install-failed', 'rev-2'), true);
  assert.deepEqual(calls, [['rev-2', 'install', 'model-install-failed']]);
});

test('is inert when Papers visual diagnostics are unavailable', () => {
  const visual = createVisualObservability({});
  assert.equal(visual.hydrated({}, 'rev-1'), false);
  assert.equal(visual.hydrationFailed('load', 'failed'), false);
});

test('project semantic keys remain stable opaque identities rather than selectors', () => {
  assert.equal(semanticKeyForItem({ kind: 'group', id: 'g-1' }), 'group.g-1');
  assert.equal(semanticKeyForItem({ kind: 'shortcut', id: 's-1' }), 'shortcut.s-1');
  assert.equal(semanticKeyForItem({ kind: 'window-layout', id: 'w-1' }), 'window-layout.w-1');
  assert.equal(semanticKeyForItem({ kind: 'group', id: 'not selector safe' }), null);
  assert.equal(semanticKeyForItem({ kind: 'unknown', id: 'x' }), null);
});

test('non-empty persisted source cannot be reported hydrated as an empty model', () => {
  assert.equal(hydrationSummaryDisagrees({ groups: [{ id: 'g1' }] }, { groups: [], shortcuts: [] }), true);
  assert.equal(hydrationSummaryDisagrees({ groups: [{ id: 'g1' }] }, { groups: [{ id: 'g1' }], shortcuts: [] }), false);
  assert.equal(hydrationSummaryDisagrees({ groups: [], shortcuts: [] }, { groups: [], shortcuts: [] }), false);
});
