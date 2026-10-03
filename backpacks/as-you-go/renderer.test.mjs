import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOT_ID,
  createGroup,
  createShortcut,
  binSelection,
  restoreSelection,
  permanentlyDelete,
  emptyState,
  normalizeState,
  updateWorkspaceView,
  setGraphPositions,
  removeGraphPositions,
  getGraphPosition,
  graphContextId,
  moveSelection,
  copySelection,
  forkPlacement,
} from './model.mjs';

/** Mirrors the renderer's visiblePlacementIdFor(): resolves the placement
 * matching the shortcut's currently visible parent (per the graph node
 * on screen for it), falling back to any active placement. Reimplemented
 * here against the plain model/graph-model layer so the copy/cut/fork
 * placement-resolution bug can be regression-tested without a DOM. */
function visiblePlacementIdForNode(state, shortcutId, node) {
  const record = state.shortcuts.find((candidate) => candidate.id === shortcutId);
  const visibleParentId = node?.parentIds?.[0];
  const match = record?.placements.find((placement) =>
    !placement.bin && (!visibleParentId || placement.parentId === visibleParentId));
  return match?.id ?? record?.placements.find((placement) => !placement.bin)?.id ?? null;
}

import {
  visibleGraphItems,
  directSetMemberIdsVisible,
  inheritedSetMemberIdsVisible,
  graphEdges,
  binOriginEdges,
  seedPosition,
  allFinite,
  allUniquePositions,
  assignSpatialFolderHues,
  hueDistance,
  MIN_HUE_SEPARATION,
} from './public/graph-model-20260730b.js';
import { belongsToSet } from './public/sets-model.js';

function makeFixtureState() {
  let state = createGroup(emptyState(), 'News');
  state = createGroup(state, 'Letters');
  const letters = state.groups[1];
  state = createGroup(state, 'Real');
  state = createGroup(state, 'Things');
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.bat', parentId: letters.id });
  state = createShortcut(state, { name: 'CAD', target: 'C:\\cad.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'SKP', target: 'C:\\skp.exe', parentId: letters.id });
  state = createShortcut(state, { name: '3DS', target: 'C:\\3ds.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'Books', target: 'C:\\books.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'W', target: 'C:\\w.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'Claude', target: 'C:\\claude.exe', parentId: letters.id });
  return state;
}

test('graph model produces four root nodes with finite unique coordinates', () => {
  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.equal(items.filter((i) => i.depth === 0).length, 4);

  const roots = items.filter((i) => i.depth === 0);
  const seeds = roots.map((vi) =>
    seedPosition(vi.id, null, vi.siblingIndex, vi.siblingCount, 400, 300));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));
});

test('expanding Letters produces seven uniquely positioned children and seven edges', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const items = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const lettersChildren = items.filter((i) => i.parentId === letters.id);
  assert.equal(lettersChildren.length, 7);

  const parent = { x: 200, y: 200 };
  const childSeeds = lettersChildren.map((vi) =>
    seedPosition(vi.id, parent, vi.siblingIndex, vi.siblingCount));
  assert.ok(allFinite(childSeeds));
  assert.ok(allUniquePositions(childSeeds));

  const edges = graphEdges(items);
  assert.equal(edges.length, 7);
  assert.ok(edges.every((e) => e.source === letters.id));
});

test('one shortcut record with three placements renders once with three edges', () => {
  let state = createGroup(emptyState(), 'A');
  const a = state.groups[0];
  state = createGroup(state, 'B');
  const b = state.groups[1];
  state = createGroup(state, 'C');
  const c = state.groups[2];
  state = createShortcut(state, { name: 'Shared', target: 'C:\\x.exe', parentId: a.id });
  const placementId = state.shortcuts[0].placements[0].id;
  // Link the same shortcut record into B and C (linked placements, no clone).
  state = copySelection(state, [placementId], b.id);
  state = copySelection(state, [placementId], c.id);
  assert.equal(state.shortcuts.length, 1, 'one canonical shortcut record');
  assert.equal(state.shortcuts[0].placements.length, 3);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id, c.id]), false);
  const shared = items.filter((i) => i.kind === 'shortcut');
  assert.equal(shared.length, 1, 'one graph node for a linked shortcut');
  assert.equal(shared[0].id, state.shortcuts[0].id, 'graph identity is the shortcut id');
  assert.deepEqual([...shared[0].parentIds].sort(), [a.id, b.id, c.id].sort(), 'all three parents recorded');
  const edges = graphEdges(items).filter((e) => e.target === state.shortcuts[0].id);
  assert.equal(edges.length, 3, 'three incoming membership edges');
});

test('two distinct shortcut records stay two nodes even when names match', () => {
  let state = createShortcut(emptyState(), { name: 'Apps', target: 'C:\\one.exe', parentId: ROOT_ID });
  state = createShortcut(state, { name: 'Apps', target: 'C:\\two.exe', parentId: ROOT_ID });
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false).filter((i) => i.kind === 'shortcut');
  assert.equal(items.length, 2, 'graph identity is not name-based');
  assert.notEqual(items[0].id, items[1].id);
});

test('workspace folder copy intentionally clones the subtree as independent records', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Run', letters.id);
  const run = state.groups[1];
  state = createShortcut(state, { name: 'slop', target: 'C:\\slop', parentId: run.id });
  const groupCount = state.groups.length;
  const shortcutCount = state.shortcuts.length;
  const copied = copySelection(state, [letters.id], ROOT_ID);
  assert.ok(copied.groups.length > groupCount, 'copying a folder clones its subtree (folders are not synced aliases)');
  const newGroups = copied.groups.slice(groupCount);
  assert.ok(newGroups.some((g) => g.name === 'Letters'), 'a new Letters group was created');
  assert.ok(newGroups.some((g) => g.name === 'Run'), 'a new Run group was created');
  assert.equal(copied.shortcuts.length, shortcutCount, 'shortcut records stay canonical; placements remain linked');
});

test('graph model can be built with no Explorer DOM mounted', () => {  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.kind === 'group' || i.kind === 'shortcut'));
});

test('switching modes does not alter the underlying item state', () => {
  const state = makeFixtureState();
  const before = JSON.stringify(state);
  visibleGraphItems(state, ROOT_ID, new Set(), false);
  visibleGraphItems(state, ROOT_ID, new Set([state.groups[1].id]), false);
  assert.equal(JSON.stringify(state), before);
});

test('rebuilding the graph model with unchanged items is stable', () => {
  const state = makeFixtureState();
  const a = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const b = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.deepEqual(a, b);
});

test('retained nodes preserve kind after repeated visibility cycles', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const recollapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);

  for (const root of collapsed.filter((i) => i.depth === 0)) {
    const again = recollapsed.find((i) => i.id === root.id);
    assert.ok(again);
    assert.equal(again.kind, root.kind);
  }
});

test('Bin graph mode shows only binned items as flat roots', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const binned = binSelection(state, [letters.id], '2026-07-30T00:00:00.000Z');
  const binItems = visibleGraphItems(binned, ROOT_ID, new Set(), true);
  assert.ok(binItems.length > 0);
  assert.ok(binItems.every((i) => i.depth === 0));
  assert.ok(binItems.every((i) => i.parentId === 'bin'));
  assert.equal(graphEdges(binItems).length, 0);
});

test('a bin graph node id is the placement id, so restoring or deleting it actually works', () => {
  // Regression test: visibleGraphItems()'s bin branch used to dedupe by
  // shared shortcut identity (like the normal graph does), so a shortcut's
  // bin tile carried the shortcut's shared record id instead of its
  // placement id. restoreSelection/permanentlyDelete both match against
  // placement ids, so passing the tile's id straight through (as the
  // renderer does) silently matched nothing — restore/delete were no-ops
  // for every shortcut in the Bin.
  let state = createGroup(emptyState(), 'A');
  const [a] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  const placementId = original.placements[0].id;

  state = binSelection(state, [placementId], '2026-07-30T00:00:00.000Z');
  const binItems = visibleGraphItems(state, ROOT_ID, new Set(), true);
  const tile = binItems.find((i) => i.kind === 'shortcut');
  assert.ok(tile);
  assert.equal(tile.id, placementId, 'the bin tile id must be the placement id, not the shared shortcut id');

  state = restoreSelection(state, [tile.id]);
  const restored = state.shortcuts.find((candidate) => candidate.id === original.id);
  const restoredPlacement = restored.placements.find((p) => p.id === placementId);
  assert.ok(restoredPlacement, 'restore must find the placement by the tile id');
  assert.equal(restoredPlacement.bin, undefined, 'the placement is no longer binned');
  assert.equal(restoredPlacement.parentId, a.id, 'restored to its original folder');
});

test('two placements of the same linked shortcut binned separately show as two distinct, independently restorable bin tiles', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  const linked = state.shortcuts.find((candidate) => candidate.id === original.id);
  const [placementA, placementB] = linked.placements;

  state = binSelection(state, [placementA.id, placementB.id], '2026-07-30T00:00:00.000Z');
  const binItems = visibleGraphItems(state, ROOT_ID, new Set(), true);
  const shortcutTiles = binItems.filter((i) => i.kind === 'shortcut');
  assert.equal(shortcutTiles.length, 2, 'both placements appear as separate tiles, not deduped into one');
  assert.deepEqual(new Set(shortcutTiles.map((t) => t.id)), new Set([placementA.id, placementB.id]));

  state = restoreSelection(state, [placementA.id]);
  const afterRestore = state.shortcuts.find((candidate) => candidate.id === original.id);
  assert.equal(afterRestore.placements.find((p) => p.id === placementA.id).bin, undefined, 'placement A restored');
  assert.ok(afterRestore.placements.find((p) => p.id === placementB.id).bin, 'placement B stays binned');
});

test('expanding a binned folder in the Bin reveals its still-intact contents beneath it', () => {
  let state = createGroup(emptyState(), 'Archive');
  const [archive] = state.groups;
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: archive.id });
  const inside = state.shortcuts[0];
  state = binSelection(state, [archive.id], '2026-07-30T00:00:00.000Z');

  const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), true);
  assert.equal(collapsed.length, 1, 'only the binned folder itself shows, collapsed');
  assert.equal(collapsed[0].id, archive.id);

  const expanded = visibleGraphItems(state, ROOT_ID, new Set([archive.id]), true);
  const child = expanded.find((i) => i.id === inside.placements[0].id);
  assert.ok(child, 'the shortcut inside the binned folder now shows as its own tile');
  assert.equal(child.parentId, archive.id, 'nested under the binned folder, not a flat root');
  assert.equal(child.depth, 1);

  const edges = graphEdges(expanded);
  assert.equal(edges.length, 1, 'an edge is drawn from the binned folder to its revealed child');
  assert.equal(edges[0].source, archive.id);
});

test('restoring one item nested inside a binned folder lands it under the nearest still-active ancestor', () => {
  // Spec from the creator: chain 1>2>3>4>5 — binning 3 hides 4 and 5 (still
  // intact, just invisible). Restoring 5 alone must NOT un-bin 3 — it should
  // reparent 5 directly under 2, the nearest ancestor that's still active.
  let state = createGroup(emptyState(), '1');
  state = createGroup(state, '2', state.groups[0].id);
  state = createGroup(state, '3', state.groups[1].id);
  state = createGroup(state, '4', state.groups[2].id);
  const [g1, g2, g3, g4] = state.groups;
  state = createShortcut(state, { name: '5', target: 'C:\\five.exe', parentId: g4.id });
  const five = state.shortcuts[0];

  state = binSelection(state, [g3.id], '2026-07-30T00:00:00.000Z');
  state = restoreSelection(state, [five.placements[0].id]);

  const restoredFive = state.shortcuts[0].placements[0];
  assert.equal(restoredFive.parentId, g2.id, 'restored directly under 2, skipping the still-binned 3 and 4');
  assert.ok(!restoredFive.bin, 'no longer hidden');

  const stillBinned = state.groups.find((candidate) => candidate.id === g3.id);
  assert.ok(stillBinned.bin, '3 itself is still in the Bin');
  const g4After = state.groups.find((candidate) => candidate.id === g4.id);
  assert.ok(!g4After.bin, '4 was never itself binned, just hidden under 3');
  assert.equal(g4After.parentId, g3.id, '4 stays right where it was, still nested under the binned 3');
});

test('permanently deleting one item nested inside a binned folder removes only that item', () => {
  let state = createGroup(emptyState(), 'Archive');
  const [archive] = state.groups;
  state = createShortcut(state, { name: 'Keep', target: 'C:\\keep.exe', parentId: archive.id });
  state = createShortcut(state, { name: 'Drop', target: 'C:\\drop.exe', parentId: archive.id });
  const keep = state.shortcuts.find((s) => s.name === 'Keep');
  const drop = state.shortcuts.find((s) => s.name === 'Drop');
  state = binSelection(state, [archive.id], '2026-07-30T00:00:00.000Z');

  state = permanentlyDelete(state, [drop.placements[0].id]);

  assert.ok(!state.shortcuts.some((s) => s.name === 'Drop'), 'Drop is gone');
  assert.ok(state.shortcuts.some((s) => s.name === 'Keep'), 'Keep is untouched');
  assert.ok(state.groups.some((g) => g.id === archive.id && g.bin), 'the folder itself is still in the Bin');
});

test('drilling into a binned folder shows only its direct children, not the whole Bin', () => {
  let state = createGroup(emptyState(), 'Archive');
  const [archive] = state.groups;
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: archive.id });
  const inside = state.shortcuts[0];
  state = createShortcut(state, { name: 'Elsewhere', target: 'C:\\elsewhere.exe', parentId: ROOT_ID });
  const elsewhere = state.shortcuts.find((s) => s.name === 'Elsewhere');
  state = binSelection(state, [archive.id, elsewhere.placements[0].id], '2026-07-30T00:00:00.000Z');

  const topLevel = visibleGraphItems(state, ROOT_ID, new Set(), true, 'bin');
  assert.equal(topLevel.length, 2, 'Archive and Elsewhere both show at the top of the Bin');

  const drilledIn = visibleGraphItems(state, ROOT_ID, new Set(), true, archive.id);
  assert.equal(drilledIn.length, 1, 'only Archive\'s own child shows once drilled in');
  assert.equal(drilledIn[0].id, inside.placements[0].id);
  assert.equal(drilledIn[0].depth, 0, 'a drilled-in view treats its own contents as roots');
});

test('an ordinary (never-linked) binned shortcut gets no origin edge — only linked ones need one', () => {
  let state = createGroup(emptyState(), 'Archive');
  const [archive] = state.groups;
  state = createShortcut(state, { name: 'Solo', target: 'C:\\solo.exe', parentId: archive.id });
  const solo = state.shortcuts[0];
  state = binSelection(state, [solo.placements[0].id], '2026-07-30T00:00:00.000Z');

  const binItems = visibleGraphItems(state, ROOT_ID, new Set(), true, 'bin');
  const edges = binOriginEdges(binItems);
  assert.equal(edges.length, 0, 'a single-placement shortcut has nothing to distinguish, so no ghost/edge');
});

test('a binned shortcut linked into several folders at once gets an origin edge back to each folder it came from', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  const linked = state.shortcuts.find((candidate) => candidate.id === original.id);
  const [placementA, placementB] = linked.placements;
  state = binSelection(state, [placementA.id, placementB.id], '2026-07-30T00:00:00.000Z');

  const binItems = visibleGraphItems(state, ROOT_ID, new Set(), true, 'bin');
  const edges = binOriginEdges(binItems);
  assert.equal(edges.length, 2, 'one origin edge per binned placement');

  const edgeToA = edges.find((e) => e.target === placementA.id);
  const edgeToB = edges.find((e) => e.target === placementB.id);
  assert.ok(edgeToA.ghost, 'folder A is not itself in the Bin, so its edge targets a ghost node');
  assert.equal(edgeToA.source, `bin-origin:${a.id}`);
  assert.ok(edgeToB.ghost);
  assert.equal(edgeToB.source, `bin-origin:${b.id}`);
});

test('a binned shortcut origin edge targets the real folder tile when that folder is also visible in the Bin', () => {
  let state = createGroup(emptyState(), 'Archive');
  state = createGroup(state, 'Other');
  const [archive, other] = state.groups;
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: archive.id });
  const insideOriginal = state.shortcuts[0];
  // Link it into a second folder so it has more than one placement total —
  // otherwise there's nothing to distinguish and no origin edge is drawn.
  state = copySelection(state, [insideOriginal.placements[0].id], other.id);
  const inside = state.shortcuts.find((candidate) => candidate.id === insideOriginal.id);
  const placementInArchive = inside.placements.find((p) => p.parentId === archive.id);
  // Bin the shortcut's own placement first, as its own independent top-level
  // Bin root — then separately bin its (now-empty-of-active-children)
  // origin folder too, so both end up as independent top-level Bin roots
  // at once, rather than the folder implicitly covering the shortcut.
  state = binSelection(state, [placementInArchive.id], '2026-07-30T00:00:00.000Z');
  state = binSelection(state, [archive.id], '2026-07-30T00:00:01.000Z');

  const binItems = visibleGraphItems(state, ROOT_ID, new Set(), true, 'bin');
  const edges = binOriginEdges(binItems);
  const edgeToInside = edges.find((e) => e.target === placementInArchive.id);
  assert.ok(edgeToInside);
  assert.ok(!edgeToInside.ghost, 'Archive is itself visible in the Bin, so no ghost is needed');
  assert.equal(edgeToInside.source, archive.id);
});

test('persisted layout=graph loads directly into graph mode', () => {
  const state = updateWorkspaceView(makeFixtureState(), { layout: 'graph' });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.view.layout, 'graph');
  const items = visibleGraphItems(restored, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
});

test('persisted layout=explorer loads directly into explorer mode', () => {
  const state = updateWorkspaceView(makeFixtureState(), { layout: 'explorer' });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.view.layout, 'explorer');
});

test('zero-dimension recovery does not permanently abort model construction', () => {
  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
  const seeds = items
    .filter((i) => i.depth === 0)
    .map((vi) => seedPosition(vi.id, null, vi.siblingIndex, vi.siblingCount, 0, 0));
  assert.ok(allFinite(seeds));
});

test('every visible graph node has a defined kind', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const items = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  assert.ok(items.every((i) => i.kind === 'group' || i.kind === 'shortcut'));
});

test('repeated visibility cycling is stable and complete', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  for (let i = 0; i < 10; i += 1) {
    const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
    assert.equal(collapsed.filter((n) => n.depth === 0).length, 4);
    const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
    assert.equal(expanded.filter((n) => n.parentId === letters.id).length, 7);
  }
});

test('independent expansion states do not leak between views', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];

  const explorerExpanded = new Set([letters.id]);
  const graphExpanded = new Set();

  const explorerItems = visibleGraphItems(state, ROOT_ID, explorerExpanded, false);
  assert.ok(explorerItems.some((i) => i.id === state.shortcuts[0].id));

  let items = visibleGraphItems(state, ROOT_ID, graphExpanded, false);
  assert.ok(!items.some((i) => i.parentId === letters.id));
  assert.equal(items.length, 4);
});

test('graph positions persist through state serialization round-trip', () => {
  let state = setGraphPositions(makeFixtureState(), ROOT_ID, {
    shortcut1: { x: 100, y: 200 },
    shortcut2: { x: 300, y: 400 },
  });

  const serialized = JSON.parse(JSON.stringify(state));
  const restored = normalizeState(serialized);

  assert.deepEqual(getGraphPosition(restored, ROOT_ID, 'shortcut1'), { x: 100, y: 200 });
  assert.deepEqual(getGraphPosition(restored, ROOT_ID, 'shortcut2'), { x: 300, y: 400 });
});

test('graph positions are independent across different contexts', () => {
  let state = makeFixtureState();
  const letters = state.groups[1];

  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
  });
  state = setGraphPositions(state, letters.id, {
    item1: { x: 50, y: 60 },
  });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, letters.id, 'item1'), { x: 50, y: 60 });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
  assert.deepEqual(getGraphPosition(state, letters.id, 'item1'), { x: 50, y: 60 });
});

test('removing graph positions only affects the target context', () => {
  let state = setGraphPositions(makeFixtureState(), ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = setGraphPositions(state, 'bin', {
    item1: { x: 100, y: 200 },
  });

  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 100, y: 200 });
});

test('moving selection between folders clears source context positions', () => {
  let state = makeFixtureState();
  const letters = state.groups[1];
  const things = state.groups[3];

  state = setGraphPositions(state, ROOT_ID, {
    [letters.id]: { x: 100, y: 200 },
  });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, letters.id), { x: 100, y: 200 });

  state = moveSelection(state, [letters.id], things.id);

  assert.equal(state.groups[1].parentId, things.id);
});

test('layout and expansion are independently persisted across view changes', () => {
  let state = updateWorkspaceView(makeFixtureState(), {
    expandedGroupIds: ['group-a'],
    graphExpandedGroupIds: ['group-b'],
    layout: 'graph',
    binMode: true,
  });

  state = updateWorkspaceView(state, { layout: 'explorer', binMode: false });
  assert.deepEqual(state.view.expandedGroupIds, ['group-a']);
  assert.deepEqual(state.view.graphExpandedGroupIds, ['group-b']);
  assert.equal(state.view.layout, 'explorer');
  assert.equal(state.view.binMode, false);
});

test('graph context ID properly distinguishes bin from normal contexts', () => {
  assert.equal(graphContextId(ROOT_ID, false), ROOT_ID);
  assert.equal(graphContextId(ROOT_ID, true), 'bin');
  assert.equal(graphContextId('some-group-id', false), 'some-group-id');
  assert.equal(graphContextId('some-group-id', true), 'bin');
});

test('a shortcut linked into two simultaneously expanded folders appears once with two edges', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  const originalPlacementId = original.placements[0].id;
  state = copySelection(state, [originalPlacementId], b.id);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id]), false);
  const sharedNodes = items.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1, 'the shared shortcut collapses to exactly one node');
  assert.deepEqual(new Set(sharedNodes[0].parentIds), new Set([a.id, b.id]));

  const edges = graphEdges(items);
  const edgesToShared = edges.filter((e) => e.target === original.id);
  assert.equal(edgesToShared.length, 2, 'one edge from each folder that has it placed');
  assert.deepEqual(new Set(edgesToShared.map((e) => e.source)), new Set([a.id, b.id]));
});

test('a linked shortcut visible from only one expanded folder still shows and links normally', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);

  // Only A expanded: the shared shortcut appears once, with one edge from A.
  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id]), false);
  const sharedNodes = items.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1);
  assert.deepEqual(sharedNodes[0].parentIds, [a.id]);
  const edges = graphEdges(items);
  assert.equal(edges.filter((e) => e.target === original.id).length, 1);
});

test('forking a placement out of the graph removes only that one edge, not the shared node elsewhere', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);

  const bPlacementId = state.shortcuts
    .find((candidate) => candidate.id === original.id).placements
    .find((placement) => placement.parentId === b.id).id;
  state = forkPlacement(state, bPlacementId);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id]), false);
  const originalNodes = items.filter((i) => i.id === original.id);
  assert.equal(originalNodes.length, 1);
  assert.deepEqual(originalNodes[0].parentIds, [a.id]);

  const forked = state.shortcuts.find((candidate) => candidate.id !== original.id);
  const forkedNodes = items.filter((i) => i.id === forked.id);
  assert.equal(forkedNodes.length, 1);
  assert.deepEqual(forkedNodes[0].parentIds, [b.id]);
});

test('copying a shortcut into a folder selected by a single click produces a second placement and two visible edges', () => {
  // Regression test for the clipboard placement-resolution bug: the
  // clipboard only remembers the shortcut's shared identity id, so at
  // paste time the renderer must resolve which specific placement was
  // actually visible/selected, not an arbitrary active one. This is the
  // exact "copy into a single-click-selected folder" scenario the
  // original PR review could not get to pass manually.
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createGroup(state, 'C');
  const [a, b, c] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];

  // Only A is expanded/visible when the user copies — the node's visible
  // parent is A, so the clipboard must capture A's placement id.
  const visibleItems = visibleGraphItems(state, ROOT_ID, new Set([a.id]), false);
  const node = visibleItems.find((i) => i.id === original.id);
  assert.deepEqual(node.parentIds, [a.id]);

  const placementId = visiblePlacementIdForNode(state, original.id, node);
  const expectedPlacementId = original.placements.find((p) => p.parentId === a.id).id;
  assert.equal(placementId, expectedPlacementId);

  // Paste (copy) into folder C, which the user selected with a single click.
  state = copySelection(state, [placementId], c.id);

  const record = state.shortcuts.find((candidate) => candidate.id === original.id);
  assert.equal(record.placements.filter((p) => !p.bin).length, 2, 'a second placement now exists');
  assert.ok(record.placements.some((p) => p.parentId === a.id));
  assert.ok(record.placements.some((p) => p.parentId === c.id));

  const itemsBothExpanded = visibleGraphItems(state, ROOT_ID, new Set([a.id, c.id]), false);
  const sharedNodes = itemsBothExpanded.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1, 'still one shared node');
  assert.deepEqual(new Set(sharedNodes[0].parentIds), new Set([a.id, c.id]));

  const edgesToShared = graphEdges(itemsBothExpanded).filter((e) => e.target === original.id);
  assert.equal(edgesToShared.length, 2, 'both folders show an edge to the shared shortcut');
});

test('pasting into multiple selected folders links a placement into every one of them', () => {
  // Regression test for batch linking: the renderer's pasteInto() loops
  // copySelection() once per selected destination folder when pasting a
  // copy (not a cut, which can only ever move to one place). Mirrors that
  // loop directly against the model layer.
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createGroup(state, 'C');
  state = createGroup(state, 'D');
  const [a, b, c, d] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  const placementId = original.placements[0].id;

  // User selects folders B, C, and D (all with a single click, not entered)
  // then pastes — every selected folder should receive a new placement.
  for (const destinationId of [b.id, c.id, d.id]) {
    state = copySelection(state, [placementId], destinationId);
  }

  const record = state.shortcuts.find((candidate) => candidate.id === original.id);
  assert.equal(record.placements.filter((p) => !p.bin).length, 4, 'original plus 3 new placements');
  for (const destination of [a, b, c, d]) {
    assert.ok(record.placements.some((p) => p.parentId === destination.id), `linked into ${destination.name}`);
  }

  const itemsAllExpanded = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id, c.id, d.id]), false);
  const sharedNodes = itemsAllExpanded.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1, 'still one shared node');
  assert.deepEqual(new Set(sharedNodes[0].parentIds), new Set([a.id, b.id, c.id, d.id]));

  const edgesToShared = graphEdges(itemsAllExpanded).filter((e) => e.target === original.id);
  assert.equal(edgesToShared.length, 4, 'all four folders show an edge to the shared shortcut');
});

test('forking from a placement in folder B (not the placement in folder A) forks the correct one', () => {
  // Regression test for "Fork this one" forking an arbitrary placement
  // instead of the one the editor was actually opened on. Here the editor
  // represents the shortcut as seen from folder B, so the fork must land
  // in B while the original stays correctly placed in A.
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);

  // The user opens the editor on the tile visible under B specifically.
  const itemsUnderB = visibleGraphItems(state, ROOT_ID, new Set([b.id]), false);
  const nodeInB = itemsUnderB.find((i) => i.id === original.id);
  assert.deepEqual(nodeInB.parentIds, [b.id]);

  const representedPlacementId = visiblePlacementIdForNode(state, original.id, nodeInB);
  const expectedBPlacementId = state.shortcuts
    .find((candidate) => candidate.id === original.id).placements
    .find((placement) => placement.parentId === b.id).id;
  assert.equal(representedPlacementId, expectedBPlacementId);

  state = forkPlacement(state, representedPlacementId);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id]), false);
  const originalNodes = items.filter((i) => i.id === original.id);
  assert.equal(originalNodes.length, 1);
  assert.deepEqual(originalNodes[0].parentIds, [a.id], 'the original stays in A');

  const forked = state.shortcuts.find((candidate) => candidate.id !== original.id);
  const forkedNodes = items.filter((i) => i.id === forked.id);
  assert.equal(forkedNodes.length, 1);
  assert.deepEqual(forkedNodes[0].parentIds, [b.id], 'the fork lands in B');
});

const folderCenter = { cx: 0, cy: 0 };

function positionHueAt(x, y) {
  const colors = new Map();
  assignSpatialFolderHues([{ id: 'position', x, y }], colors, folderCenter);
  return colors.get('position');
}

function setPositionHueAt(x, y) {
  const colors = new Map();
  assignSpatialFolderHues([{ id: 'set:position', x, y }], colors, folderCenter, new Map());
  return colors.get('set:position');
}

function assertPairInvariant(colors, folders) {
  for (let i = 0; i < folders.length; i += 1) {
    for (let j = i + 1; j < folders.length; j += 1) {
      const a = folders[i];
      const b = folders[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) >= 220) continue;
      assert.ok(
        hueDistance(colors.get(a.id), colors.get(b.id)) >= MIN_HUE_SEPARATION - 1e-6,
        `near pair ${a.id}/${b.id} is at least ${MIN_HUE_SEPARATION}° apart`,
      );
    }
  }
}

function cluster(n, radius = 40) {
  const folders = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2;
    folders.push({
      id: `F${String(i).padStart(2, '0')}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return folders;
}

test('folders retain the original angular mapping and easing', () => {
  const colors = new Map();
  assignSpatialFolderHues([{ id: 'F', x: 300, y: 0 }], colors, folderCenter);
  assert.equal(colors.get('F'), 72, 'east folder matches the recovered original value');
  assignSpatialFolderHues([{ id: 'F', x: 0, y: 300 }], colors, folderCenter);
  assert.ok(hueDistance(colors.get('F'), 85.5) < 1e-6, 'folder moves 15% from 72° toward the original 162° base');
  for (let frame = 0; frame < 300; frame += 1) {
    assignSpatialFolderHues([{ id: 'F', x: 0, y: 300 }], colors, folderCenter);
  }
  assert.ok(hueDistance(colors.get('F'), 162) < 1, 'converges onto the original folder base');
});

test('set draw eligibility is direct-at-level while inherited membership remains intact', () => {
  let state = createGroup(emptyState(), 'Feed');
  const feed = state.groups[0];
  state = createShortcut(state, { name: 'Inside feed', target: 'C:\\inside.exe', parentId: feed.id });
  const inside = state.shortcuts[0];
  const set = { id: 'letters', memberIds: [feed.id], excludedIds: [] };
  const rootItems = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const nestedItems = visibleGraphItems(state, feed.id, new Set(), false);
  assert.deepEqual(directSetMemberIdsVisible(set, rootItems.map((item) => item.id)), [feed.id]);
  assert.deepEqual(directSetMemberIdsVisible(set, nestedItems.map((item) => item.id)), []);
  assert.equal(belongsToSet(set, inside.id, () => [feed.id]), true, 'descendants still belong to the set');
  assert.deepEqual(
    inheritedSetMemberIdsVisible(set, [feed.id, inside.id], (id) => id === inside.id ? [feed.id] : []),
    [feed.id, inside.id],
    'the ring member list includes the folder and its inherited child',
  );
});

test('inherited ring members keep exclusions while direct eligibility stays level-scoped', () => {
  const set = { id: 'letters', memberIds: ['folder'], excludedIds: ['child-excluded'] };
  const ids = inheritedSetMemberIdsVisible(
    set,
    ['folder', 'child-kept', 'child-excluded'],
    (id) => id.startsWith('child-') ? ['folder'] : [],
  );
  assert.deepEqual(ids, ['folder', 'child-kept']);
  assert.deepEqual(directSetMemberIdsVisible(set, ['child-kept', 'child-excluded']), []);
  assert.deepEqual(directSetMemberIdsVisible(set, ['folder', 'child-kept']), ['folder']);
});

test('direct members in separate folders draw at each owning level', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'A item', target: 'C:\\a.exe', parentId: a.id });
  const aItem = state.shortcuts[0];
  state = createShortcut(state, { name: 'B item', target: 'C:\\b.exe', parentId: b.id });
  const bItem = state.shortcuts[1];
  const set = { id: 'split', memberIds: [aItem.id, bItem.id], excludedIds: [] };
  assert.deepEqual(directSetMemberIdsVisible(set, visibleGraphItems(state, a.id, new Set(), false).map((item) => item.id)), [aItem.id]);
  assert.deepEqual(directSetMemberIdsVisible(set, visibleGraphItems(state, b.id, new Set(), false).map((item) => item.id)), [bItem.id]);
});

test('set hues seed independently at the same position and hold while stationary', () => {
  const colors = new Map();
  const state = new Map();
  const samePlace = [{ id: 'set:alpha', x: 120, y: 80 }, { id: 'set:beta', x: 120, y: 80 }];
  assignSpatialFolderHues(samePlace, colors, folderCenter, state);
  assert.ok(hueDistance(colors.get('set:alpha'), colors.get('set:beta')) > 1, 'same-position sets have distinct seeds');
  const before = new Map(colors);
  for (let frame = 0; frame < 30; frame += 1) assignSpatialFolderHues(samePlace, colors, folderCenter, state);
  assert.equal(colors.get('set:alpha'), before.get('set:alpha'), 'stationary alpha holds its hue');
  assert.equal(colors.get('set:beta'), before.get('set:beta'), 'stationary beta holds its hue');
});

test('set hue drift follows travelled distance, not direction or absolute position', () => {
  const run = (points) => {
    const colors = new Map();
    const state = new Map();
    assignSpatialFolderHues([{ id: 'set:drift', ...points[0] }], colors, folderCenter, state);
    const seed = colors.get('set:drift');
    for (const point of points.slice(1)) assignSpatialFolderHues([{ id: 'set:drift', ...point }], colors, folderCenter, state);
    return { seed, hue: colors.get('set:drift') };
  };
  const east = run([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const west = run([{ x: 400, y: 300 }, { x: 300, y: 300 }]);
  assert.ok(hueDistance(east.seed, east.hue) > 0, 'travel changes hue');
  assert.ok(Math.abs(hueDistance(east.seed, east.hue) - hueDistance(west.seed, west.hue)) < 0.1, 'equal distance changes equally');
  const returned = run([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }]);
  assert.ok(hueDistance(returned.seed, returned.hue) > 1, 'returning does not undo free drift');
});

test('seeded set hues spread across a realistic collection and projection still separates pairs', () => {
  const sets = Array.from({ length: 12 }, (_, index) => ({ id: `set:S${index}`, x: 200, y: 180 }));
  const colors = new Map();
  assignSpatialFolderHues(sets, colors, folderCenter, new Map());
  let minimum = 360;
  for (let i = 0; i < sets.length; i += 1) for (let j = i + 1; j < sets.length; j += 1) {
    minimum = Math.min(minimum, hueDistance(colors.get(sets[i].id), colors.get(sets[j].id)));
  }
  assert.ok(minimum >= 360 / 12 - 1e-6, `seeded/projection collection minimum is ${minimum}°`);
  assert.ok(new Set(sets.map(({ id }) => Math.round(colors.get(id))).values()).size >= 8, 'seeds cover the wheel');
});

test('assignSpatialFolderHues responds to a small drag (no rounding dead zone)', () => {
  const colors = new Map();
  const state = new Map();
  assignSpatialFolderHues([{ id: 'set:F', x: 300, y: 0 }], colors, folderCenter, state);
  const before = colors.get('set:F');
  assignSpatialFolderHues([{ id: 'set:F', x: 320, y: 0 }], colors, folderCenter, state);
  const after = colors.get('set:F');
  assert.notEqual(after, before, 'a 20px radial move changes the hue');
  assert.ok(Math.abs(after - before) > 0, 'nonzero floating-point change');
});

test('assignSpatialFolderHues enforces the invariant for clusters', () => {
  // 8 folders is exactly feasible: 360 / 8 = 45° per slot.
  for (const n of [3, 6, 8]) {
    const folders = cluster(n);
    const colors = new Map();
    for (let frame = 0; frame < 10; frame += 1) {
      assignSpatialFolderHues(folders, colors, folderCenter);
    }
    assertPairInvariant(colors, folders);
  }
});

test('assignSpatialFolderHues converges for unchanged positions', () => {
  const folders = cluster(6);
  const colors = new Map();
  let lastChange = Infinity;
  for (let frame = 0; frame < 80; frame += 1) {
    const previous = new Map(colors);
    assignSpatialFolderHues(folders, colors, folderCenter);
    let change = 0;
    for (const [id, hue] of colors) {
      change = Math.max(change, Math.abs(hue - (previous.get(id) ?? hue)));
    }
    if (frame >= 60) lastChange = Math.min(lastChange, change);
  }
  assert.ok(lastChange < 1e-6, 'frames settle instead of oscillating');
});

test('assignSpatialFolderHues is independent of input order', () => {
  const folders = cluster(6);
  const forward = new Map();
  const reversed = new Map();
  for (let frame = 0; frame < 10; frame += 1) {
    assignSpatialFolderHues(folders, forward, folderCenter);
    assignSpatialFolderHues([...folders].reverse(), reversed, folderCenter);
  }
  for (const folder of folders) {
    assert.equal(forward.get(folder.id), reversed.get(folder.id));
  }
});

test('assignSpatialFolderHues handles the 359°/0° wraparound', () => {
  const nearOrigin = (deg) => {
    const radians = (deg * Math.PI) / 180;
    return { x: Math.cos(radians) * 4, y: Math.sin(radians) * 4 };
  };
  const folders = [
    { id: 'A', ...nearOrigin(355) },
    { id: 'B', ...nearOrigin(5) },
  ];
  const colors = new Map();
  for (let frame = 0; frame < 10; frame += 1) {
    assignSpatialFolderHues(folders, colors, folderCenter);
  }
  assertPairInvariant(colors, folders);
});

test('assignSpatialFolderHues separates identical positions deterministically', () => {
  const folders = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 0, y: 0 },
  ];
  const colors = new Map();
  assignSpatialFolderHues(folders, colors, folderCenter);
  assertPairInvariant(colors, folders);
  const again = new Map();
  assignSpatialFolderHues([...folders].reverse(), again, folderCenter);
  assert.equal(again.get('A'), colors.get('A'));
  assert.equal(again.get('B'), colors.get('B'));
});

test('assignSpatialFolderHues falls back for infeasibly dense neighborhoods', () => {
  const folders = cluster(13);
  const colors = new Map();
  for (let frame = 0; frame < 10; frame += 1) {
    assignSpatialFolderHues(folders, colors, folderCenter);
  }
  let minSeparation = 360;
  for (let i = 0; i < folders.length; i += 1) {
    for (let j = i + 1; j < folders.length; j += 1) {
      minSeparation = Math.min(
        minSeparation,
        hueDistance(colors.get(folders[i].id), colors.get(folders[j].id)),
      );
    }
  }
  assert.ok(minSeparation >= 360 / 13 - 1e-6, 'falls back to the 360/13 slot gap');
  assert.ok(minSeparation < MIN_HUE_SEPARATION, '13 near folders cannot keep 45°');
});

test('assignSpatialFolderHues produces a valid hue for every folder', () => {
  const colors = new Map();
  assignSpatialFolderHues([
    { id: 'A', x: -200, y: 100 },
    { id: 'B', x: 200, y: 300 },
    { id: 'C', x: 0, y: -100 },
  ], colors, { cx: 0, cy: 0 });
  for (const id of ['A', 'B', 'C']) {
    const hue = colors.get(id);
    assert.ok(hue >= 0 && hue <= 360);
  }
});

test('folder and set namespaces remain separated, with folder position and set drift', () => {
  const nodes = [
    { id: 'folder:shared', x: 20, y: 0 },
    { id: 'set:shared', x: 20, y: 0 },
  ];
  const colors = new Map();
  const state = new Map();
  for (let frame = 0; frame < 80; frame += 1) assignSpatialFolderHues(nodes, colors, folderCenter, state);
  assert.ok(hueDistance(colors.get('folder:shared'), colors.get('set:shared')) >= MIN_HUE_SEPARATION);
  const settled = new Map(colors);
  for (let frame = 0; frame < 20; frame += 1) assignSpatialFolderHues([...nodes].reverse(), colors, folderCenter, state);
  assert.ok(Math.abs(colors.get('folder:shared') - settled.get('folder:shared')) < 1e-6);
  assert.ok(Math.abs(colors.get('set:shared') - settled.get('set:shared')) < 1e-6);
  assignSpatialFolderHues([{ id: 'set:shared', x: 320, y: 0 }, { id: 'folder:shared', x: 20, y: 0 }], colors, folderCenter, state);
  assert.notEqual(colors.get('set:shared'), settled.get('set:shared'));
});
