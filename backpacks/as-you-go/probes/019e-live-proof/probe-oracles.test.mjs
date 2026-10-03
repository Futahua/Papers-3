/**
 * 019E oracle unit tests (Winter). Runs with `node --test` and creates NO temp
 * project, process, window, Electron instance or global input. Pure helpers
 * only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isWidgetTarget,
  widgetMatches,
  selectLiveOverlay,
  selectOverlayContaining,
  everyPresent,
  memberSetEqual,
  membersEqualWithout,
  stagedPickPassed,
  oracleSelfTest,
} from './probe-oracles.mjs';

const WIDGET_URL = 'papers-backpack://bp/_papers-open/a/public/index.html?papers-surface=compact-widget&papers-layout-key=window-layout-abc';
const HOST_URL = '/out/renderer/index.html';
const WORKSPACE_URL = 'papers-backpack://bp/_papers-open/a/public/index.html';

function fakeClient(bridgeType, closed = { value: false }) {
  return {
    evaluate: async () => bridgeType,
    close: () => { closed.value = true; },
    closed,
  };
}

test('oracleSelfTest passes for the pure predicates', () => {
  assert.equal(oracleSelfTest(), true);
});

test('widget predicate is a synchronous boolean', () => {
  const value = isWidgetTarget({ url: WIDGET_URL }, 'window-layout-abc');
  assert.equal(typeof value, 'boolean');
  assert.equal(value, true);
});

test('widget predicate rejects host and workspace URLs', () => {
  assert.equal(isWidgetTarget({ url: HOST_URL }, 'window-layout-abc'), false);
  assert.equal(isWidgetTarget({ url: WORKSPACE_URL }, 'window-layout-abc'), false);
  assert.equal(isWidgetTarget(null, 'window-layout-abc'), false);
  assert.equal(isWidgetTarget({}, 'window-layout-abc'), false);
});

test('widget predicate accepts only the exact marker plus the exact layout key', () => {
  assert.equal(isWidgetTarget({ url: WIDGET_URL }, 'window-layout-abc'), true);
  assert.equal(isWidgetTarget({ url: WIDGET_URL }, 'window-layout-other'), false);
  assert.equal(isWidgetTarget({ url: WIDGET_URL.replace('papers-surface=compact-widget', 'papers-surface=other') }, 'window-layout-abc'), false);
});

test('widgetMatches returns exactly one match from the three real URL shapes', () => {
  const matches = widgetMatches([{ url: WIDGET_URL }, { url: HOST_URL }, { url: WORKSPACE_URL }], 'window-layout-abc');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].url, WIDGET_URL);
});

test('overlay resolver rejects a data target whose bridge is undefined and closes it', async () => {
  const closed = { value: false };
  const client = fakeClient('undefined', closed);
  const candidates = [{ url: 'data:text/html,first', id: 'a' }];
  const result = await selectLiveOverlay(candidates, async () => client);
  assert.equal(result, null);
  assert.equal(closed.value, true, 'the rejected client must be closed');
});

test('overlay resolver accepts the live target whose bridge is object and does not close it', async () => {
  const closed = { value: false };
  const live = fakeClient('object', closed);
  const candidates = [
    { url: 'data:text/html,dead', id: 'a' },
    { url: 'data:text/html,live', id: 'b' },
  ];
  const result = await selectLiveOverlay(candidates, async (candidate) => {
    if (candidate.id === 'a') {
      const rejected = fakeClient('undefined');
      rejected._id = 'a';
      return rejected;
    }
    return live;
  });
  assert.equal(result, live);
  assert.equal(closed.value, false, 'the accepted client stays open');
});

test('overlay resolver skips a target whose connect throws', async () => {
  const live = fakeClient('object');
  const candidates = [{ url: 'data:text/html,dead', id: 'a' }, { url: 'data:text/html,live', id: 'b' }];
  const result = await selectLiveOverlay(candidates, async (candidate) => {
    if (candidate.id === 'a') throw new Error('connect failed');
    return live;
  });
  assert.equal(result, live);
});

test('overlay containing selector picks the overlay whose screen bounds contain the point and closes the rest (019HR)', async () => {
  const closed = [];
  const overlays = [
    { id: 'a', bounds: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 'b', bounds: { x: 1920, y: 0, width: 1920, height: 1040 } },
  ];
  const result = await selectOverlayContaining(
    overlays,
    async (candidate) => {
      const client = fakeClient('object');
      client._id = candidate.id;
      client.close = () => { closed.push(candidate.id); };
      return client;
    },
    { x: 2200, y: 500 },
    async (client) => overlays.find((o) => o.id === client._id).bounds,
  );
  assert.equal(result.bounds.x, 1920, 'the overlay containing the point is selected');
  assert.deepEqual(closed.sort(), ['a'], 'the non-containing live overlay is closed');
});

test('overlay containing selector returns null when no overlay contains the point and closes all (019HR)', async () => {
  const closed = [];
  const candidates = [{ id: 'a', bounds: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const result = await selectOverlayContaining(
    candidates,
    async (candidate) => {
      const client = fakeClient('object');
      client._id = candidate.id;
      client.close = () => { closed.push(candidate.id); };
      return client;
    },
    { x: 9000, y: 9000 },
    async () => candidates[0].bounds,
  );
  assert.equal(result, null);
  assert.deepEqual(closed, ['a'], 'every candidate is closed when none contains the point');
});

test('overlay containing selector skips a non-live bridge and a throwing read (019HR)', async () => {
  const live = fakeClient('object');
  const candidates = [{ url: 'data:text/html,dead', id: 'a' }, { url: 'data:text/html,live', id: 'b' }];
  const result = await selectOverlayContaining(
    candidates,
    async (candidate) => (candidate.id === 'a' ? fakeClient('undefined') : live),
    { x: 10, y: 10 },
    async (client) => {
      if (client === live) return { x: 0, y: 0, width: 100, height: 100 };
      throw new Error('read failed');
    },
  );
  assert.equal(result.client, live);
  assert.equal(result.bounds.x, 0);
});

test('everyPresent requires every pre-event member to remain (019HR2)', () => {
  assert.equal(everyPresent(['A', 'B', 'C'], ['A', 'B', 'C']), true);
  assert.equal(everyPresent(['A', 'B', 'C'], ['A', 'B']), false);
  assert.equal(everyPresent(['A', 'B', 'C'], ['A', 'B', 'C', 'D']), true);
  assert.equal(everyPresent(null, ['A']), true);
  assert.equal(everyPresent(['A'], null), false);
});

test('memberSetEqual is exact, order-insensitive and duplicate-safe; rejects missing AND extra titles (019HR3)', () => {
  assert.equal(memberSetEqual(['A', 'B', 'C'], ['C', 'A', 'B']), true, 'order is irrelevant');
  assert.equal(memberSetEqual(['A', 'B', 'C'], ['A', 'B', 'C']), true);
  assert.equal(memberSetEqual(['A', 'B', 'C'], ['A', 'B']), false, 'a missing title fails');
  assert.equal(memberSetEqual(['A', 'B', 'C'], ['A', 'B', 'C', 'D']), false, 'an unexpected EXTRA title fails');
  assert.equal(memberSetEqual(['A', 'B', 'B'], ['A', 'B']), false, 'a duplicate-count mismatch fails');
  assert.equal(memberSetEqual(['A', 'B', 'B'], ['B', 'A', 'B']), true, 'duplicate-safe order-insensitive');
  assert.equal(memberSetEqual(null, ['A']), false);
  assert.equal(memberSetEqual(['A'], null), false);
});

test('membersEqualWithout is exact: pre-kill set minus the closed member (019HR2)', () => {
  assert.equal(membersEqualWithout(['A', 'B', 'C', 'D'], 'B', ['A', 'C', 'D']), true);
  assert.equal(membersEqualWithout(['A', 'B', 'C'], 'B', ['A', 'C']), true);
  assert.equal(membersEqualWithout(['A', 'B', 'C'], 'B', ['A', 'C', 'D']), false, 'an added D is not an exact minus-B result');
  assert.equal(membersEqualWithout(['A', 'B', 'C'], 'B', ['A', 'B', 'C']), false, 'B must be gone');
  assert.equal(membersEqualWithout(['A', 'B', 'C'], 'X', ['A', 'B', 'C']), true, 'a non-member close title is a no-op for the set');
});

test('stagedPickPassed requires the outcome flag, no error, and exact hover/staged (019HR2)', () => {
  const addEvidence = { hover: { kind: 'add', x: 0, y: 0, width: 10, height: 10 }, staged: [{ kind: 'add' }] };
  const removeEvidence = { hover: { kind: 'remove' }, staged: [{ kind: 'remove' }] };
  assert.equal(stagedPickPassed({ evidence: addEvidence, expectedKind: 'add', committed: true }), true);
  assert.equal(stagedPickPassed({ evidence: removeEvidence, expectedKind: 'remove', byteZero: true }), true);
  // Byte-zero alone must not pass a cancel row that never staged a removal.
  assert.equal(stagedPickPassed({ evidence: { hover: null, staged: [] }, expectedKind: 'remove', byteZero: true }), false);
  assert.equal(stagedPickPassed({ evidence: { hover: { kind: 'add' }, staged: [] }, expectedKind: 'remove', byteZero: true }), false, 'a wrong-kind hover fails');
  assert.equal(stagedPickPassed({ evidence: { hover: { kind: 'remove' }, staged: [], error: 'boom' }, expectedKind: 'remove', byteZero: true }), false, 'a swallowed error fails');
  assert.equal(stagedPickPassed({ evidence: addEvidence, expectedKind: 'add', committed: false }), false, 'a commit row must actually commit');
  assert.equal(stagedPickPassed({ evidence: addEvidence, expectedKind: 'add', byteZero: false }), false, 'a cancel row must be byte-zero');
  assert.equal(stagedPickPassed({ evidence: null, expectedKind: 'add', committed: true }), false, 'missing evidence fails');
});
