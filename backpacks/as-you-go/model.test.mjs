import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOT_ID,
  children,
  copySelection,
  createGroup,
  createShortcut,
  binSelection,
  permanentlyDelete,
  emptyState,
  itemsIntersectingMarquee,
  moveSelection,
  normalizeState,
  normalizeQuickRunCardSize,
  renameItem,
  reorderSelection,
  restoreSelection,
  updateGroup,
  updateShortcut,
  forkPlacement,
  collapsePlacements,
  updateWorkspaceView,
  createWebLink,
  isWebLink,
  webLinkIcon,
  createDroppedShortcuts,
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  getGraphRestPosition,
  setGraphRestPositions,
  removeGraphRestPositions,
  removeGraphPositions,
  normalizeGraphPositions,
  setPromptLibrary,
  trailContextKey,
  setTrailExpandedByContext,
  createWindowLayout,
  deleteWindowLayout,
  setWindowLayoutPill,
  addWindowLayoutMember,
  removeWindowLayoutMember,
  removeClosedWindowFromAllLayouts,
  reconcileWindowLayoutsAfterStartup,
  updateWindowLayoutMember,
  reorderWindowLayoutMember,
  setActiveWindowLayoutId,
  setWindowLayoutTracking,
  setWindowLayoutInstanceSuppressed,
  setWindowLayoutCardSize,
  setSurfaceLocation,
  surfaceLocationFor,
  itemsIn,
  binnedItems,
  setItemSets,
} from './model.mjs';

import {
  visibleGraphItems,
  graphEdges,
  seedPosition,
  allFinite,
  allUniquePositions,
  setEligibleItems,
  directSetMemberIdsVisible,
  breadcrumbNodeScale,
} from './public/graph-model-20260730b.js';

import { belongsToSet } from './public/sets-model.js';

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from './public/vendor/d3-force.js';

/** A freshly created shortcut has exactly one placement; this is that
 * placement's id, which is what selection/move/copy/bin operate on. */
function soloPlacementId(shortcut) {
  return shortcut.placements[0].id;
}

test('per-surface locations preserve independent last folders and bound untrusted keys', () => {
  let state = emptyState();
  state = setSurfaceLocation(state, 'surface-a', 'folder-a');
  state = setSurfaceLocation(state, 'surface-b', 'folder-b');
  assert.deepEqual(surfaceLocationFor(state, 'surface-a'), { currentGroupId: 'folder-a' });
  assert.deepEqual(surfaceLocationFor(state, 'surface-b'), { currentGroupId: 'folder-b' });
  assert.equal(surfaceLocationFor(state, 'x'.repeat(129)), null);
  const normalized = normalizeState({ view: { surfaceLocations: {
    valid: { currentGroupId: 'folder' }, malformed: { currentGroupId: 1 }, ['x'.repeat(129)]: { currentGroupId: 'nope' },
  } } });
  assert.deepEqual(normalized.view.surfaceLocations, { valid: { currentGroupId: 'folder' } });
});

test('window layouts stay durable but are not emitted as physics graph nodes', () => {
  let state = createWindowLayout(emptyState());
  const layout = state.windowLayouts[0];
  assert.equal(itemsIn(state, ROOT_ID).some((candidate) => candidate.id === layout.id), true);
  assert.equal(visibleGraphItems(state, ROOT_ID, new Set()).some((candidate) => candidate.id === layout.id), false);
  const normalized = normalizeState({
    ...state,
    windowLayoutPillIds: [layout.id, 'missing-layout'],
    view: {
      ...state.view,
      graphPositions: { root: { [layout.id]: { x: 90, y: 120 } } },
      graphRestPositions: { root: { [layout.id]: { x: 90, y: 120 } } },
    },
  });
  assert.deepEqual(normalized.windowLayoutPillIds, [layout.id]);
  assert.deepEqual(normalized.view.graphPositions, {});
  assert.deepEqual(normalized.view.graphRestPositions, {});
});

test('docking a layout is persisted and its widget X deletes directly, not to Bin', () => {
  let state = createWindowLayout(emptyState());
  const layoutId = state.windowLayouts[0].id;
  state = setWindowLayoutPill(state, layoutId, true);
  assert.deepEqual(state.windowLayoutPillIds, [layoutId]);
  const deleted = deleteWindowLayout({
    ...state,
    activeWindowLayoutId: layoutId,
    startupWindowLayoutId: layoutId,
  }, layoutId);
  assert.deepEqual(deleted.windowLayouts, []);
  assert.deepEqual(deleted.windowLayoutPillIds, []);
  assert.equal(deleted.activeWindowLayoutId, null);
  assert.equal(deleted.startupWindowLayoutId, null);
  assert.equal(binnedItems(deleted).some((candidate) => candidate.id === layoutId), false);
});

test('a drag marquee selects every visible item rectangle it crosses', () => {
  const tiles = [
    { id: 'one', left: 20, top: 20, right: 100, bottom: 100 },
    { id: 'two', left: 120, top: 20, right: 200, bottom: 100 },
    { id: 'three', left: 220, top: 20, right: 300, bottom: 100 },
  ];

  assert.deepEqual(
    itemsIntersectingMarquee(tiles, { left: 90, top: 10, right: 210, bottom: 110 }),
    ['one', 'two'],
  );
  assert.deepEqual(
    itemsIntersectingMarquee(tiles, { left: 210, top: 110, right: 90, bottom: 10 }),
    ['one', 'two'],
  );
});

test('groups and shortcuts form a nested explorer tree', () => {
  let state = createGroup(emptyState(), 'Projects');
  const projects = state.groups[0];
  state = createGroup(state, '2026', projects.id);
  const year = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'D:\\Programs\\CLIPS.bat', parentId: year.id });
  assert.equal(children(state, year.id).shortcuts[0].name, 'CLIPS');
  assert.equal(children(state, ROOT_ID).groups[0].name, 'Projects');
});

test('moving a selected folder and its visible children preserves the folder tree', () => {
  let state = createGroup(emptyState(), 'One');
  state = createGroup(state, 'Two');
  const [one, two] = state.groups;
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: one.id });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.bat', parentId: one.id });
  const [a, b] = state.shortcuts;
  state = moveSelection(state, [one.id, soloPlacementId(a), soloPlacementId(b)], two.id);
  assert.equal(state.groups.find((item) => item.id === one.id).parentId, two.id);
  assert.deepEqual(
    state.shortcuts.map((item) => item.placements[0].parentId),
    [one.id, one.id],
  );
});

test('copying a folder gives it a new identity but links its shortcuts as new placements of the same record', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  const copied = copySelection(state, [source.id], destination.id);

  assert.equal(copied.groups.length, 3);
  assert.notEqual(copied.groups[2].id, source.id);
  assert.equal(copied.groups[2].parentId, destination.id);

  // The shortcut itself is not duplicated — it's the same record, now with
  // a second placement inside the copied folder.
  assert.equal(copied.shortcuts.length, 1);
  assert.equal(copied.shortcuts[0].id, original.id);
  assert.equal(copied.shortcuts[0].placements.length, 2);
  assert.equal(children(copied, copied.groups[2].id).shortcuts[0].name, 'A');
  assert.equal(children(copied, source.id).shortcuts[0].name, 'A');
});

test('a selected shortcut copied from a nested expanded folder links rather than duplicates', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'Nested', target: 'C:\\nested.exe', parentId: source.id });
  const original = state.shortcuts[0];

  const copied = copySelection(state, [soloPlacementId(original)], destination.id);

  assert.equal(copied.shortcuts.length, 1);
  assert.equal(copied.shortcuts[0].placements.length, 2);
  assert.equal(children(copied, destination.id).shortcuts[0].name, 'Nested');
  assert.equal(children(copied, source.id).shortcuts[0].name, 'Nested');
});

test('editing a linked shortcut changes it in every folder it is placed in', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [soloPlacementId(original)], destination.id);

  state = updateShortcut(state, original.id, {
    name: 'Renamed',
    target: 'C:\\a.bat',
    description: '',
    icon: null,
  });

  assert.equal(children(state, source.id).shortcuts[0].name, 'Renamed');
  assert.equal(children(state, destination.id).shortcuts[0].name, 'Renamed');
});

test('forking a linked placement gives it an independent identity that no longer shares edits', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [soloPlacementId(original)], destination.id);
  const destinationPlacementId = children(state, destination.id).shortcuts[0].id;

  state = forkPlacement(state, destinationPlacementId);
  assert.equal(state.shortcuts.length, 2);
  const forked = state.shortcuts.find((candidate) => candidate.id !== original.id);
  assert.equal(forked.placements.length, 1);
  assert.equal(children(state, source.id).shortcuts[0].shortcutId, original.id);
  assert.equal(children(state, destination.id).shortcuts[0].shortcutId, forked.id);

  state = updateShortcut(state, original.id, {
    name: 'OnlySource',
    target: 'C:\\a.bat',
    description: '',
    icon: null,
  });
  assert.equal(children(state, source.id).shortcuts[0].name, 'OnlySource');
  assert.equal(children(state, destination.id).shortcuts[0].name, 'A');
});

test('collapsePlacements moves a linked shortcut entirely into one destination, dropping all other placements', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createGroup(state, 'C');
  const [a, b, c] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  assert.equal(state.shortcuts[0].placements.length, 2);

  state = collapsePlacements(state, original.id, c.id);

  assert.equal(state.shortcuts.length, 1);
  assert.equal(state.shortcuts[0].placements.length, 1);
  assert.equal(state.shortcuts[0].placements[0].parentId, c.id);
  assert.equal(children(state, a.id).shortcuts.length, 0);
  assert.equal(children(state, b.id).shortcuts.length, 0);
  assert.equal(children(state, c.id).shortcuts[0].name, 'Shared');
});

test('collapsePlacements leaves binned placements of the same shortcut untouched', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  const bPlacementId = state.shortcuts[0].placements.find((p) => p.parentId === b.id).id;
  state = binSelection(state, [bPlacementId], '2026-07-30T00:00:00.000Z');

  state = createGroup(state, 'C');
  const c = state.groups[2];
  state = collapsePlacements(state, original.id, c.id);

  const placements = state.shortcuts[0].placements;
  assert.equal(placements.length, 2);
  assert.ok(placements.some((p) => p.bin));
  assert.ok(placements.some((p) => p.parentId === c.id && !p.bin));
});

test('a group cannot move into itself or one of its descendants', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createGroup(state, 'Child', parent.id);
  const child = state.groups[1];
  assert.throws(() => moveSelection(state, [parent.id], child.id), /inside itself/);
});

test('a bound project root moves anywhere except the Bin, like any group', () => {
  let state = createGroup(emptyState(), 'Elsewhere');
  const other = state.groups[0];
  state = {
    ...state,
    groups: [...state.groups, { id: 'group-proxima-abc123', name: 'Bound', parentId: 'root', order: 1 }],
  };
  const moved = moveSelection(state, ['group-proxima-abc123'], other.id);
  assert.equal(moved.groups.find((group) => group.id === 'group-proxima-abc123').parentId, other.id);
});

test('rename applies to either a group or shortcut', () => {
  let state = createGroup(emptyState(), 'Old');
  const group = state.groups[0];
  state = renameItem(state, group.id, 'New');
  assert.equal(state.groups[0].name, 'New');
});

test('folders can use a custom image or return to the default folder icon', () => {
  let state = createGroup(
    emptyState(),
    'Pictures',
    ROOT_ID,
    'data:image/png;base64,folder',
  );
  const folder = state.groups[0];
  assert.equal(folder.icon, 'data:image/png;base64,folder');

  state = updateGroup(state, folder.id, { name: 'Pictures', icon: null });
  assert.equal(state.groups[0].icon, null);
});

test('editing a shortcut preserves its identity and folder while replacing every editable field', () => {
  let state = createGroup(emptyState(), 'Apps');
  const apps = state.groups[0];
  state = createShortcut(state, {
    name: 'Old',
    description: 'Generic',
    target: 'C:\\old.exe',
    icon: 'data:image/png;base64,old',
    parentId: apps.id,
  });
  const original = state.shortcuts[0];

  state = updateShortcut(state, original.id, {
    name: 'New',
    description: '',
    target: 'D:\\new.exe',
    icon: null,
  });

  assert.deepEqual(state.shortcuts[0], {
    ...original,
    name: 'New',
    description: '',
    target: 'D:\\new.exe',
    icon: null,
  });
});

test('legacy state receives stable manual order and a default icon size without losing items', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [{ id: 'g', parentId: ROOT_ID, name: 'Group' }],
    shortcuts: [
      { id: 'a', parentId: ROOT_ID, name: 'A', description: '', target: 'C:\\a.exe', icon: null },
      { id: 'b', parentId: ROOT_ID, name: 'B', description: '', target: 'C:\\b.exe', icon: null },
    ],
  });
  assert.deepEqual(state.shortcuts.map((item) => item.placements[0].order), [1, 2]);
  assert.equal(state.groups[0].order, 0);
  assert.equal(state.view.iconSize, 96);
  assert.equal(state.groups[0].icon, null);
});

test('the local project preserves its explorer working position', () => {
  let state = createGroup(emptyState(), 'Open');
  state = createShortcut(state, {
    name: 'Picked',
    target: 'C:\\picked.exe',
    parentId: state.groups[0].id,
  });

  state = updateWorkspaceView(state, {
    currentGroupId: state.groups[0].id,
    expandedGroupIds: [state.groups[0].id],
    selectedItemIds: [state.shortcuts[0].id],
    binMode: false,
  });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));

  assert.deepEqual(restored.view, {
    iconSize: 96,
    currentGroupId: state.groups[0].id,
    expandedGroupIds: [state.groups[0].id],
    graphExpandedGroupIds: [],
    selectedItemIds: [state.shortcuts[0].id],
    binMode: false,
    layout: 'explorer',
    graphPositions: {},
    // Remembered, not pinned: where an unpinned node last rested, so it seeds
    // from there instead of a generic ring on the next open.
    graphRestPositions: {},
    toolbarPositions: {},
    preferences: {},
    promptLibrary: [],
    itemSets: [],
    trailExpandedByContext: {},
  });
});

test('emptyState contains an empty prompt library', () => {
  assert.deepEqual(emptyState().view.promptLibrary, []);
});

test('a legacy pickupPrompt migrates to a root prompt node on normalize', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { pickupPrompt: 'legacy prompt' },
  });
  assert.deepEqual(state.view.promptLibrary, [
    {
      id: state.view.promptLibrary[0].id,
      type: 'prompt',
      title: 'Agent pickup prompt',
      text: 'legacy prompt',
      includeInBatch: true,
    },
  ]);
});

test('flat legacy promptCards migrate to root prompt nodes on normalize', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { promptCards: [{ id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true }] },
  });
  assert.deepEqual(state.view.promptLibrary, [
    { id: 'prompt-a', type: 'prompt', title: 'One', text: 'first', includeInBatch: true },
  ]);
});

test('promptLibrary round-trips through normalization and stays on other view updates', () => {
  let state = emptyState();
  const library = [
    {
      id: 'folder-dev',
      type: 'folder',
      title: 'Dev',
      includeAll: false,
      excludeAll: false,
      children: [
        { id: 'prompt-a', type: 'prompt', title: 'One', text: 'first', includeInBatch: true },
      ],
    },
  ];
  state = setPromptLibrary(state, library);
  assert.deepEqual(state.view.promptLibrary, library);
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.view.promptLibrary, library);
  const resized = updateWorkspaceView(state, { iconSize: 64 });
  assert.deepEqual(resized.view.promptLibrary, library);
  assert.deepEqual(updateWorkspaceView(state, { promptLibrary: [] }).view.promptLibrary, []);
});

test('setPromptLibrary does not mutate its input', () => {
  const state = emptyState();
  const library = [{ id: 'prompt-x', type: 'prompt', title: 'X', text: 'body', includeInBatch: true }];
  setPromptLibrary(state, library);
  assert.deepEqual(state.view.promptLibrary, []);
});

test('the explorer view mode defaults to explorer and persists as graph', () => {
  assert.equal(emptyState().view.layout, 'explorer');

  const graphed = updateWorkspaceView(emptyState(), { layout: 'graph' });
  assert.equal(graphed.view.layout, 'graph');
  const restored = normalizeState(JSON.parse(JSON.stringify(graphed)));
  assert.equal(restored.view.layout, 'graph');

  const explored = updateWorkspaceView(graphed, { layout: 'explorer' });
  assert.equal(explored.view.layout, 'explorer');

  const legacy = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  assert.equal(legacy.view.layout, 'explorer');

  const unknown = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [], view: { layout: 'unknown' } });
  assert.equal(unknown.view.layout, 'explorer');

  const preserved = updateWorkspaceView(graphed, { currentGroupId: ROOT_ID });
  assert.equal(preserved.view.layout, 'graph');
});

test('web links are http(s) shortcuts owned by the local project', () => {
  const linked = createWebLink(emptyState(), {
    name: 'Papers',
    target: 'https://github.com/Futahua/Papers-3',
  });
  assert.equal(linked.shortcuts.length, 1);
  assert.equal(isWebLink(linked.shortcuts[0]), true);
  assert.equal(
    webLinkIcon(linked.shortcuts[0]),
    'https://github.com/Futahua/Papers-3',
  );
  assert.throws(
    () => createWebLink(emptyState(), { name: 'Unsafe', target: 'javascript:alert(1)' }),
    /http or https/i,
  );
});

test('bare domain defaults to https', () => {
  const linked = createWebLink(emptyState(), {
    name: 'Example',
    target: 'example.com',
  });
  assert.equal(linked.shortcuts[0].target, 'https://example.com/');
});

test('Explorer drops create quick shortcuts in the exact destination without duplicates', () => {
  const grouped = createGroup(emptyState(), 'Dropped here');
  const destination = grouped.groups[0].id;
  const dropped = createDroppedShortcuts(grouped, [
    { name: 'notes.txt', target: 'D:\\Work\\notes.txt' },
    { name: 'Pictures', target: 'D:\\Pictures' },
    { name: 'notes.txt', target: 'D:\\Work\\notes.txt' },
  ], destination);

  assert.deepEqual(
    dropped.shortcuts.map(({ name, target, placements }) => ({ name, target, parentId: placements[0].parentId })),
    [
      { name: 'notes.txt', target: 'D:\\Work\\notes.txt', parentId: destination },
      { name: 'Pictures', target: 'D:\\Pictures', parentId: destination },
    ],
  );
});

test('manual reordering persists for multiple selected siblings', () => {
  let state = emptyState();
  state = createShortcut(state, { name: 'A', target: 'C:\\a.exe' });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.exe' });
  state = createShortcut(state, { name: 'C', target: 'C:\\c.exe' });
  const [a, b, c] = state.shortcuts;

  state = reorderSelection(state, [soloPlacementId(c), soloPlacementId(b)], ROOT_ID, soloPlacementId(a));

  assert.deepEqual(
    children(state, ROOT_ID).shortcuts.map((item) => item.name),
    ['B', 'C', 'A'],
  );
});

test('Delete bins items recoverably and permanent deletion is confined to the Bin', () => {
  let state = createGroup(emptyState(), 'Folder');
  const folder = state.groups[0];
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: folder.id });
  state = createShortcut(state, { name: 'Outside', target: 'C:\\outside.exe' });

  const binned = binSelection(state, [folder.id], '2026-07-30T00:00:00.000Z');
  assert.equal(children(binned, ROOT_ID).groups.length, 0);
  assert.equal(binned.groups[0].bin?.parentId, ROOT_ID);
  assert.equal(binned.shortcuts.length, 2);

  const restored = restoreSelection(binned, [folder.id]);
  assert.equal(children(restored, ROOT_ID).groups[0].name, 'Folder');
  assert.equal(children(restored, folder.id).shortcuts[0].name, 'Inside');

  const rebinned = binSelection(restored, [folder.id], '2026-07-30T00:00:01.000Z');
  const deleted = permanentlyDelete(rebinned, [folder.id]);
  assert.equal(deleted.groups.length, 0);
  assert.deepEqual(deleted.shortcuts.map((item) => item.name), ['Outside']);
  assert.throws(() => permanentlyDelete(restored, [folder.id]), /Bin/);
});

test('graph visibility includes every root item and only descendants of expanded folders', () => {
  let state = createGroup(emptyState(), 'News');
  state = createGroup(state, 'Letters');
  const letters = state.groups[1];
  state = createGroup(state, 'Real');
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.bat', parentId: letters.id });
  state = createShortcut(state, { name: 'HiddenChild', target: 'C:\\hidden.exe', parentId: state.groups[2].id });

  const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.deepEqual(collapsed.map((i) => i.id), state.groups.map((g) => g.id));
  assert.deepEqual(collapsed.map((i) => i.depth), [0, 0, 0]);

  const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const rootIds = state.groups.map((g) => g.id);
  assert.ok(expanded.some((i) => i.id === rootIds[0]));
  assert.ok(expanded.some((i) => i.id === rootIds[1]));
  assert.ok(expanded.some((i) => i.id === rootIds[2]));
  assert.ok(expanded.some((i) => i.id === state.shortcuts[0].id));
  assert.ok(!expanded.some((i) => i.id === state.shortcuts[1].id));
});

test('expanded folders create exactly their parent-child edges; collapsed folders omit hidden descendants', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createShortcut(state, { name: 's1', target: 'C:\\s1.exe', parentId: state.groups[0].id });
  state = createShortcut(state, { name: 's2', target: 'C:\\s2.exe', parentId: state.groups[1].id });

  const collapsedItems = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const collapsedEdges = graphEdges(collapsedItems);
  assert.equal(collapsedEdges.length, 0);

  const openItems = visibleGraphItems(state, ROOT_ID, new Set([state.groups[0].id]), false);
  const openEdges = graphEdges(openItems);
  assert.equal(openEdges.length, 1);
  assert.equal(openEdges[0].source, state.groups[0].id);
  assert.equal(openEdges[0].target, state.shortcuts[0].id);
});

test('child seed positions are finite and not all identical across siblings or rebuilds', () => {
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
  const parent = { x: 100, y: 50 };
  const seeds = ids.map((id, i) => seedPosition(id, parent, i, ids.length));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));

  const rebuilt = ids.map((id, i) => seedPosition(id, parent, i, ids.length));
  assert.deepEqual(rebuilt, seeds);
});

test('root seed positions are finite and distinct', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const seeds = ids.map((id, i) => seedPosition(id, null, i, ids.length));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));
});

test('graph visibility assigns unique sibling indices', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.exe', parentId: parent.id });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.exe', parentId: parent.id });
  state = createShortcut(state, { name: 'C', target: 'C:\\c.exe', parentId: parent.id });

  const items = visibleGraphItems(state, ROOT_ID, new Set([parent.id]), false);
  const children = items.filter((i) => i.parentId === parent.id);
  assert.deepEqual(children.map((i) => i.siblingIndex), [0, 1, 2]);
  assert.equal(children[0].siblingCount, 3);
});

test('graph edges include stable keys', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createShortcut(state, { name: 'Child', target: 'C:\\child.exe', parentId: parent.id });
  const items = visibleGraphItems(state, ROOT_ID, new Set([parent.id]), false);
  const edges = graphEdges(items);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].id, `${parent.id}->${state.shortcuts[0].id}`);
});

test('Bin graph mode shows binned items as flat roots with no edges', () => {
  let state = createGroup(emptyState(), 'Folder');
  const folder = state.groups[0];
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: folder.id });
  state = createShortcut(state, { name: 'Outside', target: 'C:\\outside.exe' });
  const binned = binSelection(state, [folder.id], '2026-07-30T00:00:00.000Z');

  const binItems = visibleGraphItems(binned, ROOT_ID, new Set(), true);
  assert.ok(binItems.every((i) => i.depth === 0));
  assert.ok(binItems.every((i) => i.parentId === 'bin'));
  const binEdges = graphEdges(binItems);
  assert.equal(binEdges.length, 0);
});

test('emptyState contains independent expansion fields and graphPositions', () => {
  const state = emptyState();
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
  assert.deepEqual(state.view.graphPositions, {});
});

test('legacy state without new fields preserves existing data and defaults new fields', () => {
  const legacy = { schemaVersion: 1, groups: [], shortcuts: [] };
  const state = normalizeState(legacy);
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
  assert.deepEqual(state.view.graphPositions, {});
  assert.equal(state.view.layout, 'explorer');
});

test('independent Explorer and Graph expansion do not interfere', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);

  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);

  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);
});

test('partial update preserves omitted view fields', () => {
  let state = updateWorkspaceView(emptyState(), {
    expandedGroupIds: ['g1'],
    graphExpandedGroupIds: ['g2'],
    layout: 'graph',
  });

  state = updateWorkspaceView(state, { layout: 'explorer' });
  assert.deepEqual(state.view.expandedGroupIds, ['g1']);
  assert.deepEqual(state.view.graphExpandedGroupIds, ['g2']);
  assert.equal(state.view.layout, 'explorer');

  state = updateWorkspaceView(state, { selectedItemIds: ['s1'] });
  assert.deepEqual(state.view.graphExpandedGroupIds, ['g2']);
  assert.deepEqual(state.view.expandedGroupIds, ['g1']);

  state = updateWorkspaceView(state, { binMode: true });
  assert.equal(state.view.currentGroupId, ROOT_ID);
  assert.equal(state.view.binMode, true);
});

test('position normalization accepts valid entries and discards invalid ones', () => {
  const raw = {
    root: {
      item1: { x: 100, y: 200 },
      item2: { x: 50.5, y: -30.2 },
      badNan: { x: NaN, y: 100 },
      badInf: { x: 100, y: Infinity },
      badMissingX: { y: 100 },
      badMissingY: { x: 100 },
      badString: { x: '100', y: '200' },
    },
    badContext: 42,
    emptyContext: {},
  };
  const result = normalizeGraphPositions(raw);
  assert.deepEqual(result.root.item1, { x: 100, y: 200 });
  assert.deepEqual(result.root.item2, { x: 50.5, y: -30.2 });
  assert.equal(result.root.badNan, undefined);
  assert.equal(result.root.badInf, undefined);
  assert.equal(result.root.badMissingX, undefined);
  assert.equal(result.root.badMissingY, undefined);
  assert.equal(result.root.badString, undefined);
  assert.equal(result.badContext, undefined);
  assert.equal(result.emptyContext, undefined);
});

test('independent graph position contexts are isolated', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = setGraphPositions(state, 'bin', { item1: { x: 30, y: 40 } });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 30, y: 40 });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 100, y: 200 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 30, y: 40 });
});

test('removeGraphPositions removes only selected entries in current context', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
    item3: { x: 50, y: 60 },
  });
  state = setGraphPositions(state, 'bin', { item1: { x: 70, y: 80 } });

  state = removeGraphPositions(state, ROOT_ID, ['item2']);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 70, y: 80 });
});

test('removeGraphPositions cleans up empty context', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

test('graphContextId returns bin for bin mode and currentGroupId otherwise', () => {
  assert.equal(graphContextId(ROOT_ID, false), ROOT_ID);
  assert.equal(graphContextId('group-1', false), 'group-1');
  assert.equal(graphContextId(ROOT_ID, true), 'bin');
});

test('updateWorkspaceView preserves graphPositions when not supplied', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = updateWorkspaceView(state, { layout: 'graph' });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('normalizeGraphPositions returns empty when given null/undefined/non-object', () => {
  assert.deepEqual(normalizeGraphPositions(null), {});
  assert.deepEqual(normalizeGraphPositions(undefined), {});
  assert.deepEqual(normalizeGraphPositions(42), {});
  assert.deepEqual(normalizeGraphPositions('string'), {});
  assert.deepEqual(normalizeGraphPositions([]), {});
});

test('setGraphPositions stores coordinates and getGraphPosition retrieves them (simulates shift-drag pin)', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  const pos = getGraphPosition(state, ROOT_ID, 'item1');
  assert.deepEqual(pos, { x: 100, y: 200 });
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
});

test('normal drag of an unpinned item removes saved positions (simulates release-without-shift from unpinned)', () => {
  let state = emptyState();
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

test('normal drag of a pinned item removes its saved coordinate and preserves other items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
});

test('shift-drag of a pinned item updates its saved coordinate', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
});

test('multi-selection shift-drag saves coordinates for all dragged items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
    item3: { x: 50, y: 60 },
  });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
});

test('multi-selection normal drag removes coordinates only for dragged items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = setGraphPositions(state, ROOT_ID, { item3: { x: 50, y: 60 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1', 'item2']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
});

test('folder drop always moves items and clears source context coordinates regardless of shift', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.exe', parentId: letters.id });
  const clips = state.shortcuts[0];
  const clipsPlacementId = soloPlacementId(clips);

  state = setGraphPositions(state, ROOT_ID, { [clipsPlacementId]: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, clipsPlacementId), { x: 100, y: 200 });

  const moved = moveSelection(state, [clipsPlacementId], things.id);
  state = removeGraphPositions(moved, ROOT_ID, [clipsPlacementId]);

  assert.equal(state.shortcuts[0].placements[0].parentId, things.id);
  assert.equal(getGraphPosition(state, ROOT_ID, clipsPlacementId), null);
});

test('free-space graph dragging never changes item parentId or order through setGraphPositions', () => {
  let state = createShortcut(emptyState(), { name: 'A', target: 'C:\\a.exe' });
  const item = state.shortcuts[0];
  const originalParentId = item.parentId;
  const originalOrder = item.order;

  state = setGraphPositions(state, ROOT_ID, { [item.id]: { x: 999, y: 888 } });

  assert.equal(state.shortcuts[0].parentId, originalParentId);
  assert.equal(state.shortcuts[0].order, originalOrder);
});

test('removeGraphPositions on a non-existent item is a safe no-op', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['nonexistent']);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('context separation: same itemId can have positions in different contexts, removing from one does not affect another', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { shared: { x: 10, y: 20 } });
  state = setGraphPositions(state, 'group-A', { shared: { x: 50, y: 60 } });

  state = removeGraphPositions(state, ROOT_ID, ['shared']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'shared'), null);
  assert.deepEqual(getGraphPosition(state, 'group-A', 'shared'), { x: 50, y: 60 });
});

test('Ctrl+click Explorer folder expands it without changing graph expansion', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
});

test('Ctrl+click Explorer folder again collapses it', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);
});

test('Ctrl+click Graph folder expands it without changing Explorer expansion', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: ['group-a'] });
  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, ['group-a']);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);
});

test('Ctrl+click does not change currentGroupId (does not navigate)', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.equal(state.view.currentGroupId, ROOT_ID);
});

test('Ctrl+click does not change layout or binMode', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = updateWorkspaceView(state, { layout: 'graph', binMode: true, expandedGroupIds: [letters.id] });

  assert.equal(state.view.layout, 'graph');
  assert.equal(state.view.binMode, true);
});

test('Ctrl+click does not modify graphPositions', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = createGroup(state, 'Letters');
  const letters = state.groups[0];
  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('Ctrl+click expansion persists through restore/reopen', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id], graphExpandedGroupIds: [letters.id] });
  const serialized = JSON.parse(JSON.stringify(state));
  const restored = normalizeState(serialized);

  assert.deepEqual(restored.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(restored.view.graphExpandedGroupIds, [letters.id]);
});

test('expansion toggle preserves unique IDs (duplicate toggle does not cause duplicate entries)', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id, letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
});

test('chevron works independently of Ctrl+click', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
});

test('normal click on a folder still activates it', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { currentGroupId: letters.id });
  assert.equal(state.view.currentGroupId, letters.id);
});

test('expansion sets remain independent after multiple Ctrl+click toggles', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id], graphExpandedGroupIds: [things.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [things.id]);

  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id, things.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id, things.id]);
});

test('drag starts without Shift, Shift pressed before release: node is pinned', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 100, y: 200 });
});

test('drag starts with Shift, Shift released before release: node is unpinned via removeGraphPositions', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
});

test('pointerup Shift state determines final outcome regardless of prior toggles during drag', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });

  state = removeGraphPositions(state, ROOT_ID, ['item2']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
});

test('folder drop overrides final Shift state on pointerup', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.exe', parentId: letters.id });
  const clips = state.shortcuts[0];
  const clipsPlacementId = soloPlacementId(clips);

  state = setGraphPositions(state, ROOT_ID, { [clipsPlacementId]: { x: 100, y: 200 } });

  const moved = moveSelection(state, [clipsPlacementId], things.id);
  state = removeGraphPositions(moved, ROOT_ID, [clipsPlacementId]);

  assert.equal(state.shortcuts[0].placements[0].parentId, things.id);
  assert.equal(getGraphPosition(state, ROOT_ID, clipsPlacementId), null);
});

test('removeGraphPositions on all entries cleans up context object', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

// =====================================================================
// Assignment 003: the trail as ordinary folder contents. The current
// folder's ancestors (pathTo minus the current folder's own entry) are
// prepended to its item list by collectVisible. They are ordinary group
// bodies flagged `ancestor: true`; the current folder never appears.
// =====================================================================

/** A chain of `depth` nested folders; returns { state, chain } with the
 * chain in root-to-leaf order, and every folder's id resolvable by name. */
function buildChain(depth, { childrenPerFolder = 2 } = {}) {
  let state = emptyState();
  const chain = [];
  let parentId = ROOT_ID;
  for (let d = 1; d <= depth; d += 1) {
    state = createGroup(state, `Folder ${d}`, parentId);
    chain.push(state.groups.at(-1).id);
    for (let c = 1; c <= childrenPerFolder; c += 1) {
      state = createGroup(state, `Folder ${d} child ${c}`, chain.at(-1));
    }
    parentId = chain.at(-1);
  }
  return { state, chain };
}

function pathShape(state, chain) {
  const names = new Map(state.groups.map((g) => [g.id, g.name]));
  return [
    { id: ROOT_ID, name: 'As you Go' },
    ...chain.map((id) => ({ id, name: names.get(id) })),
  ];
}

test('the ancestor chain is prepended as ordinary group entries marked ancestor', () => {
  const { state, chain } = buildChain(2);
  const ancestors = pathShape(state, chain).slice(0, -1);
  const items = visibleGraphItems(state, chain[1], new Set(), false, 'bin', ancestors);
  assert.equal(items.length, 2 + 2, 'two ancestors plus Folder 2 child 1 and child 2');
  assert.deepEqual(items.slice(0, 2).map((i) => i.id), [ROOT_ID, chain[0]]);
  assert.deepEqual(items.slice(0, 2).map((i) => i.kind), ['group', 'group']);
  assert.ok(items.slice(0, 2).every((i) => i.ancestor === true));
  assert.ok(items.slice(2).every((i) => i.ancestor !== true), 'view items are not ancestors');
  assert.deepEqual(items.slice(0, 2).map((i) => i.depth), [0, 1]);
  assert.equal(items[1].parentId, ROOT_ID, 'the second ancestor is parented to the first');
});

test('breadcrumb depth scales root 30%, midpoint 60%, and immediate parent 100%', () => {
  assert.equal(breadcrumbNodeScale(0, 3), 0.3);
  assert.equal(breadcrumbNodeScale(1, 3), 0.6);
  assert.equal(breadcrumbNodeScale(2, 3), 1);
  assert.equal(breadcrumbNodeScale(0, 1), 1, 'a lone immediate parent stays full size');
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => breadcrumbNodeScale(index, 5)),
    [0.3, 0.45, 0.6, 0.8, 1],
    'longer paths distribute smoothly through the three requested anchors',
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => breadcrumbNodeScale(index, 5, {
      rootScale: 0.4,
      middleScale: 0.7,
    })),
    [0.4, 0.55, 0.7, 0.85, 1],
    'creator-selected anchors drive both interpolation halves',
  );
  assert.equal(breadcrumbNodeScale(0, 3, { rootScale: 0.1, middleScale: 0.2 }), 0.3,
    '30% remains the hard minimum');
});

test('breadcrumb ancestors and everything expanded from each inherit that ancestor size', () => {
  const { state, chain } = buildChain(3);
  const rootChild = state.groups.find((group) => group.name === 'Folder 1 child 1').id;
  const middleChild = state.groups.find((group) => group.name === 'Folder 2 child 1').id;
  const items = visibleGraphItems(state, chain[2], new Set(), false, 'bin',
    pathShape(state, chain).slice(0, -1), new Set([ROOT_ID, chain[0], chain[1]]));
  const scaleOf = (id) => items.find((item) => item.id === id)?.trailScale;
  assert.equal(scaleOf(ROOT_ID), 0.3);
  assert.equal(scaleOf(chain[0]), 0.6);
  assert.equal(scaleOf(chain[1]), 1);
  assert.equal(scaleOf(rootChild), 0.6,
    'Folder 1 expanded children inherit Folder 1 rather than the root');
  assert.equal(scaleOf(middleChild), 1,
    'the immediate parent expanded children inherit full size');
  assert.ok(items.filter((item) => item.trail !== true).every((item) => item.trailScale === 1),
    'ordinary current-folder items stay at their existing size');
});

test('visible breadcrumb bodies consume the saved root and middle scale anchors', () => {
  const { state, chain } = buildChain(3);
  const items = visibleGraphItems(
    state,
    chain[2],
    new Set(),
    false,
    'bin',
    pathShape(state, chain).slice(0, -1),
    new Set(),
    { rootScale: 0.45, middleScale: 0.75 },
  );
  assert.deepEqual(items.slice(0, 3).map((item) => item.trailScale), [0.45, 0.75, 1]);
});

test('ordinary expansion decreases monotonically along only the expanded branch', () => {
  let state = emptyState();
  state = createGroup(state, 'Outer', ROOT_ID);
  const outer = state.groups.at(-1).id;
  state = createGroup(state, 'Unrelated', ROOT_ID);
  const unrelated = state.groups.at(-1).id;
  state = createGroup(state, 'Inner', outer);
  const inner = state.groups.at(-1).id;
  state = createGroup(state, 'Inner sibling', outer);
  const innerSibling = state.groups.at(-1).id;
  state = createGroup(state, 'Deep', inner);
  const deep = state.groups.at(-1).id;
  state = createShortcut(state, { name: 'Revealed file', target: 'C:\\file.txt', parentId: inner });
  const revealedFile = state.shortcuts.at(-1).id;
  const scales = { rootScale: 0.4, middleScale: 0.7 };
  const expanded = visibleGraphItems(
    state,
    ROOT_ID,
    new Set([outer, inner, deep]),
    false,
    'bin',
    [],
    new Set(),
    scales,
  );
  const scaleOf = (items, id) => items.find((item) => item.id === id)?.trailScale;
  assert.equal(scaleOf(expanded, outer), 1, 'the first folder remains the biggest');
  assert.equal(scaleOf(expanded, inner), 0.7,
    'the second expanded folder takes the middle slider value');
  assert.equal(scaleOf(expanded, deep), 0.4,
    'the newly revealed end of a three-folder chain takes the root slider value');
  assert.equal(scaleOf(expanded, unrelated), 1,
    'an unrelated root folder is not resized');
  assert.equal(scaleOf(expanded, innerSibling), 0.7,
    'folder children revealed at the same branch depth use the same monotonic size');
  assert.equal(scaleOf(expanded, revealedFile), 0.4,
    'non-folder icons inherit the same size as folders at their branch depth');
});

test('a long expanded branch never becomes small and then big again', () => {
  let state = emptyState();
  const ids = [];
  let parentId = ROOT_ID;
  for (let index = 0; index < 8; index += 1) {
    state = createGroup(state, `Folder ${index + 1}`, parentId);
    parentId = state.groups.at(-1).id;
    ids.push(parentId);
  }
  const items = visibleGraphItems(
    state,
    ROOT_ID,
    new Set(ids.slice(0, -1)),
    false,
    'bin',
    [],
    new Set(),
    { rootScale: 0.4, middleScale: 0.7 },
  );
  const values = ids.map((id) => items.find((item) => item.id === id)?.trailScale);
  assert.equal(values[0], 1);
  assert.equal(values.at(-1), 0.4);
  assert.ok(values.every((value, index) => index === 0 || value <= values[index - 1]),
    `expected a monotonically decreasing branch, got ${values.join(', ')}`);
});

test('the current folder never renders: dropped from the chain and never spawned', () => {
  const { state, chain } = buildChain(2);
  const ancestors = pathShape(state, chain).slice(0, -1);
  // Expanding an ancestor is a TRAIL action (Assignment 007): it lives in
  // the trail set for this view, never in ordinary expansion.
  const items = visibleGraphItems(state, chain[1], new Set(), false, 'bin', ancestors,
    new Set([chain[0]]));
  assert.ok(!items.some((i) => i.id === chain[1]),
    'expanding Folder 1 must not spawn the current folder (Folder 2)');
  const spawned = items.filter((i) => i.parentId === chain[0] && i.id !== chain[1]);
  assert.equal(spawned.length, 2, 'Folder 1 child 1 and child 2 spawn in place');
  assert.equal(spawned[0].depth, 2);
});

test('at root the ancestor list is empty and the view is unchanged', () => {
  const { state, chain } = buildChain(2);
  const plain = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const withAncestors = visibleGraphItems(state, ROOT_ID, new Set(), false, 'bin', []);
  assert.deepEqual(withAncestors, plain);
  assert.deepEqual(plain.map((i) => i.id), [chain[0]], 'the root view shows only root children');
});

test('ancestor chain edges draw between visible chain nodes; none at root', () => {
  const { state, chain } = buildChain(3);
  const mid = visibleGraphItems(state, chain[2], new Set(), false, 'bin', pathShape(state, chain).slice(0, -1));
  const edges = graphEdges(mid);
  assert.ok(edges.some((e) => e.source === ROOT_ID && e.target === chain[0]), 'root to Folder 1 edge draws');
  assert.ok(edges.some((e) => e.source === chain[0] && e.target === chain[1]), 'Folder 1 to Folder 2 edge draws');
  assert.ok(!edges.some((e) => e.target === chain[2]), 'no edge into the current folder');

  const atRoot = visibleGraphItems(state, ROOT_ID, new Set(), false, 'bin', []);
  assert.equal(graphEdges(atRoot).length, 0, 'no head edge when the head is not visible');
});

test('Bin ancestors: the Bin head and binned chain join a drilled Bin view; Bin top shows nothing', () => {
  let state = createGroup(emptyState(), 'Outer');
  const outer = state.groups[0];
  state = createGroup(state, 'Inner', outer.id);
  const inner = state.groups.at(-1);
  state = binSelection(state, [outer.id], '2026-07-30T00:00:00.000Z');

  const top = visibleGraphItems(state, ROOT_ID, new Set(), true, 'bin', []);
  assert.ok(!top.some((i) => i.ancestor === true), 'the Bin itself is the current folder — nothing prepended');

  const drilled = visibleGraphItems(state, ROOT_ID, new Set(), true, inner.id,
    [{ id: 'bin', name: 'Bin' }, { id: outer.id, name: 'Outer' }]);
  assert.deepEqual(drilled.slice(0, 2).map((i) => i.id), ['bin', outer.id]);
  assert.ok(drilled.slice(0, 2).every((i) => i.ancestor === true));
  assert.ok(!drilled.some((i) => i.id === inner.id), 'the drilled folder never appears');
  const binEdges = graphEdges(drilled);
  assert.ok(binEdges.some((e) => e.source === 'bin' && e.target === outer.id), 'Bin head to Outer edge draws');
});

// =============================================================================
// Assignment 005: trail provenance and the set-eligibility boundary. The whole
// derived trail branch (ancestors plus everything revealed beneath an expanded
// ancestor) carries `trail: true`; ordinary current-folder items do not; a
// merged shared shortcut resolves ordinary. Trail items are outside the set
// system for the view, while persisted sets stay byte-for-byte untouched.
// =============================================================================

test('ancestor bodies are trail; ordinary current-folder items are not', () => {
  const { state, chain } = buildChain(2);
  const items = visibleGraphItems(state, chain[1], new Set(), false, 'bin', pathShape(state, chain).slice(0, -1));
  assert.deepEqual(items.slice(0, 2).map((i) => i.id), [ROOT_ID, chain[0]]);
  assert.ok(items.slice(0, 2).every((i) => i.trail === true && i.ancestor === true),
    'every ancestor body is trail and ancestor');
  assert.ok(items.slice(2).every((i) => i.trail === false && i.ancestor !== true),
    'ordinary view items are not trail and not ancestor');
});

test('a child and grandchild revealed from an expanded ancestor are trail', () => {
  const { state, chain } = buildChain(3);
  const childA = state.groups.find((g) => g.name === 'Folder 2 child 1').id;
  let extended = createGroup(state, 'Folder 2 child 1 sub', childA);
  const subId = extended.groups.at(-1).id;
  // Expanded chain[1] (Folder 2) spawns childA; expanded childA spawns subId.
  // Both live in the trail expansion set for this view (Assignment 007).
  const items = visibleGraphItems(extended, chain[2], new Set(), false, 'bin',
    pathShape(extended, chain).slice(0, -1), new Set([chain[1], childA]));
  const childEntry = items.find((i) => i.id === childA);
  const subEntry = items.find((i) => i.id === subId);
  assert.ok(childEntry.trail === true && childEntry.ancestor !== true, 'expanded child is trail, not ancestor');
  assert.ok(subEntry.trail === true && subEntry.ancestor !== true, 'expanded grandchild is trail, not ancestor');
});

test('a shared shortcut visible through both the trail and ordinary paths resolves ordinary', () => {
  let state = createGroup(emptyState(), 'F1');
  const f1 = state.groups[0].id;
  state = createGroup(state, 'F2', f1);
  const f2 = state.groups.at(-1).id;
  state = createShortcut(state, { name: 'shared', target: 'C:\\x.exe', parentId: f1 });
  const placementId = state.shortcuts.at(-1).placements[0].id;
  state = copySelection(state, [placementId], f2);

  const items = visibleGraphItems(state, f2, new Set(), false, 'bin',
    [{ id: ROOT_ID, name: 'As you Go' }, { id: f1, name: 'F1' }], new Set([f1]));
  const sharedEntries = items.filter((i) => i.id === state.shortcuts[0].id);
  assert.equal(sharedEntries.length, 1, 'one merged body, not one per parent');
  assert.equal(sharedEntries[0].trail, false, 'real provenance wins over the trail path');
  assert.deepEqual(sharedEntries[0].parentIds.sort(), [f1, f2].sort(), 'both parents recorded');
});

test('Bin expanded-trail descendants carry the same provenance', () => {
  let state = createGroup(emptyState(), 'Outer');
  const outer = state.groups[0].id;
  state = createGroup(state, 'Inner', outer);
  const inner = state.groups.at(-1).id;
  state = createGroup(state, 'Sibling', outer);
  const sibling = state.groups.at(-1).id;
  state = binSelection(state, [outer], '2026-07-30T00:00:00.000Z');

  // Drilled into Inner; expanding the Outer ancestor reveals Sibling — a
  // trail expansion in the bin:<Inner> context (Assignment 007).
  const items = visibleGraphItems(state, ROOT_ID, new Set(), true, inner,
    [{ id: 'bin', name: 'Bin' }, { id: outer, name: 'Outer' }], new Set([outer]));
  const head = items.find((i) => i.id === 'bin');
  const outerEntry = items.find((i) => i.id === outer);
  const siblingEntry = items.find((i) => i.id === sibling);
  assert.ok(head.trail === true && head.ancestor === true);
  assert.ok(outerEntry.trail === true && outerEntry.ancestor === true);
  assert.ok(siblingEntry.trail === true && siblingEntry.ancestor !== true,
    'an expanded Bin-ancestor descendant is trail, not ancestor');
  assert.ok(!items.some((i) => i.id === inner), 'the drilled folder never appears');
});

test('setEligibleItems excludes trail bodies while ordinary members stay; persisted sets untouched', () => {
  const { state, chain } = buildChain(2);
  // Expanded chain[0] (Folder 1) makes Folder 1 child 1/2 trail via the
  // trail set; Folder 2's own children stay ordinary. Set A contains one
  // trail member and two ordinary members.
  const trailMember = state.groups.find((g) => g.name === 'Folder 1 child 1').id;
  const ordinaryA = state.groups.find((g) => g.name === 'Folder 2 child 1').id;
  const ordinaryB = state.groups.find((g) => g.name === 'Folder 2 child 2').id;
  const itemSets = [{
    id: 'set-a', type: 'set', title: 'A', memberIds: [trailMember, ordinaryA, ordinaryB], excludedIds: [],
  }];
  const withSets = { ...state, view: { ...state.view, itemSets } };
  const before = JSON.stringify(withSets.view.itemSets);

  const items = visibleGraphItems(withSets, chain[1], new Set(), false, 'bin',
    pathShape(state, chain).slice(0, -1), new Set([chain[0]]));
  const eligible = setEligibleItems(items);

  assert.deepEqual(eligible.map((i) => i.id), [ordinaryA, ordinaryB],
    'the trail member is not eligible; the ordinary members are');
  assert.ok(!eligible.some((i) => i.trail === true), 'no trail body is ever eligible');
  assert.equal(JSON.stringify(withSets.view.itemSets), before,
    'setEligibleItems never touches the persisted sets');
  assert.ok(belongsToSet(itemSets[0], trailMember, () => []),
    'the data still says the trail member belongs — the view simply ignores it');
  const direct = directSetMemberIdsVisible(itemSets[0], eligible.map((i) => i.id));
  assert.deepEqual(direct, [ordinaryA, ordinaryB],
    'the set still draws around its ordinary visible members in this view');
});

// =============================================================================
// Assignment 007: trail expansion is independent of ordinary expansion and
// remembered per view context. Each explicit context key
// (`folder:<id>` / `bin:<id>`) owns its own set, defaults to collapsed, and
// never seeds or mutates ordinary graphExpandedGroupIds.
// =============================================================================

test('ordinary expansion never seeds the trail: Apps expanded at root stays collapsed inside a trail', () => {
  let state = createGroup(emptyState(), 'Apps');
  const apps = state.groups[0].id;
  state = createGroup(state, 'Apps child', apps);
  const appsChild = state.groups.at(-1).id;
  state = createGroup(state, 'Real');
  const real = state.groups.at(-1).id;
  state = createGroup(state, 'A', real);
  const a = state.groups.at(-1).id;

  const ordinary = new Set([apps]);
  const ancestors = [{ id: ROOT_ID, name: 'As you Go' }, { id: real, name: 'Real' }];

  // Trail view of folder:A with only the head expanded: Apps is revealed but
  // COLLAPSED even though ordinary expansion at root has it open.
  const collapsed = visibleGraphItems(state, a, ordinary, false, 'bin', ancestors,
    new Set([ROOT_ID]));
  const appsEntry = collapsed.find((i) => i.id === apps);
  assert.ok(appsEntry?.trail === true, 'Apps is revealed inside the trail');
  assert.ok(!collapsed.some((i) => i.id === appsChild),
    'Apps starts collapsed in the trail regardless of its root expansion');

  // Explicitly expanding Apps IN THIS TRAIL context reveals its children.
  const expanded = visibleGraphItems(state, a, ordinary, false, 'bin', ancestors,
    new Set([ROOT_ID, apps]));
  assert.ok(expanded.some((i) => i.id === appsChild),
    'trail expansion reveals Apps children without touching ordinary expansion');
});

test('per-view trail expansion is remembered per context and survives normalize/reload', () => {
  const { state, chain } = buildChain(2);
  const childA = state.groups.find((g) => g.name === 'Folder 1 child 1').id;
  let withMap = setTrailExpandedByContext(state, 'folder:real', [chain[0], childA]);
  assert.deepEqual(withMap.view.trailExpandedByContext, { 'folder:real': [chain[0], childA] });

  const reloaded = normalizeState(JSON.parse(JSON.stringify(withMap)));
  assert.deepEqual(reloaded.view.trailExpandedByContext, { 'folder:real': [chain[0], childA] },
    'the choice survives a reload round-trip');
  assert.equal(reloaded.view.trailExpandedByContext['folder:other'], undefined,
    'a different view context has no saved choice and defaults collapsed');

  const same = visibleGraphItems(reloaded, chain[1], new Set(), false, 'bin',
    pathShape(reloaded, chain).slice(0, -1), new Set(reloaded.view.trailExpandedByContext['folder:real']));
  assert.ok(same.some((i) => i.id === childA), 'the restored context still reveals its choice');
});

test('malformed and stale trail expansion normalizes safely without losing unrelated view data', () => {
  const { state, chain } = buildChain(2);
  const raw = {
    ...JSON.parse(JSON.stringify(state)),
    view: {
      ...state.view,
      currentGroupId: chain[1],
      trailExpandedByContext: {
        'folder:root': [ROOT_ID, 'bin', 'no-such-folder', chain[0], chain[0], 42],
        'folder:real': 'malformed',
        42: [chain[0]],
        'bin:bin': [],
      },
    },
  };
  const normalized = normalizeState(raw);
  assert.deepEqual(normalized.view.trailExpandedByContext, {
    'folder:root': [ROOT_ID, 'bin', chain[0]],
  }, 'malformed entries dropped, stale ids pruned, pseudo heads kept, ids deduped');
  assert.equal(normalized.view.currentGroupId, chain[1], 'unrelated view data preserved');
});

test('trail and ordinary expansion never touch each other', () => {
  const { state, chain } = buildChain(2);
  const withTrail = setTrailExpandedByContext(state, 'folder:x', [chain[0]]);
  assert.deepEqual(withTrail.view.graphExpandedGroupIds, state.view.graphExpandedGroupIds,
    'writing trail expansion never changes ordinary expansion');

  const withOrdinary = updateWorkspaceView(withTrail, { graphExpandedGroupIds: [chain[1]] });
  assert.deepEqual(withOrdinary.view.trailExpandedByContext, { 'folder:x': [chain[0]] },
    'writing ordinary expansion never changes any trail context');

  // The two context keys stay distinct and independent at the walk level too.
  const ancestors = pathShape(state, chain).slice(0, -1);
  const a = visibleGraphItems(state, chain[1], new Set(), false, 'bin', ancestors,
    new Set([chain[0]]));
  const b = visibleGraphItems(state, chain[1], new Set(), false, 'bin', ancestors,
    new Set());
  const childA = state.groups.find((g) => g.name === 'Folder 1 child 1').id;
  assert.ok(a.some((i) => i.id === childA));
  assert.ok(!b.some((i) => i.id === childA), 'a collapsed context reveals nothing');
});

test('trail context keys separate explorer, root and Bin views', () => {
  assert.equal(trailContextKey('root', false, 'bin'), 'folder:root');
  assert.equal(trailContextKey(null, false, 'bin'), 'folder:root');
  assert.equal(trailContextKey('group-a', false, 'bin'), 'folder:group-a');
  assert.equal(trailContextKey('group-a', true, 'bin'), 'bin:bin');
  assert.equal(trailContextKey('group-a', true, 'group-b'), 'bin:group-b');
  assert.notEqual(trailContextKey('group-a', false, 'bin'), trailContextKey('group-a', true, 'group-b'));
});

// =============================================================================
// Assignment 008: the persisted window-layout item kind — a single-parent
// entity like a group, rendered with a static fixture miniature. Records
// normalize/prune, save/reload, move, duplicate independently, bin, restore
// and delete like any item; the graph and sets treat them generically.
// =============================================================================

test('window-layout records normalize, prune malformed entries and survive reload', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Studio', parentId: ROOT_ID });
  const raw = {
    ...JSON.parse(JSON.stringify(state)),
    windowLayouts: [
      state.windowLayouts[0],
      { name: 'no id' },
      { id: 'dup', name: 'Dup', parentId: 'root' },
      { id: 'dup', name: 'Dup again', parentId: 'root' },
      { id: 'bad-bin', name: 'Bad bin', parentId: 'root', bin: 'not-an-object' },
      { id: 'bad-arr', name: 'Bad arr', parentId: 'root', arrangement: { version: 2, members: [] } },
      {
        id: 'valid', name: ' Valid ', parentId: 'root', order: 5,
        bin: { parentId: 'root', order: 0, binnedAt: '2026-01-01T00:00:00.000Z' },
        arrangement: { version: 1, members: [] },
      },
    ],
  };
  const normalized = normalizeState(raw);
  assert.deepEqual(normalized.windowLayouts.map((w) => w.name), ['Studio', 'Dup', 'Bad bin', 'Bad arr', 'Valid']);
  assert.equal(normalized.windowLayouts.filter((w) => w.name === 'Dup').length, 1, 'duplicate ids pruned');
  assert.equal(normalized.windowLayouts.find((w) => w.name === 'Bad bin').bin, undefined, 'malformed bin dropped');
  assert.deepEqual(
    normalized.windowLayouts.find((w) => w.name === 'Bad arr').arrangement,
    { version: 2, members: [] },
    'a version-2 empty arrangement survives normalization',
  );
  assert.deepEqual(
    normalized.windowLayouts.find((w) => w.name === 'Valid').arrangement,
    { version: 2, members: [] },
    'legacy version-1 arrangement upgrades safely to the versioned empty shape',
  );
  assert.equal(normalized.windowLayouts.find((w) => w.name === 'Valid').name, 'Valid');
  assert.deepEqual(normalized.windowLayouts.find((w) => w.name === 'Valid').bin,
    { parentId: 'root', order: 0, binnedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(normalized.view.iconSize, state.view.iconSize, 'unrelated view data preserved');
  const reloaded = normalizeState(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(reloaded.windowLayouts, normalized.windowLayouts, 'save/reload round trip');
});

test('window layouts join itemsIn as a real item kind and duplicate independently', () => {
  let state = emptyState();
  state = createGroup(state, 'Folder');
  const folder = state.groups[0].id;
  state = createWindowLayout(state, { name: 'Studio', parentId: folder });
  const wl = state.windowLayouts[0];
  const inFolder = itemsIn(state, folder);
  assert.ok(inFolder.some((i) => i.kind === 'window-layout' && i.id === wl.id));

  const copied = copySelection(state, [wl.id], folder);
  assert.equal(copied.windowLayouts.length, 2, 'an independent duplicate is created');
  assert.notEqual(copied.windowLayouts[1].id, wl.id, 'a new record id — never a linked placement');
  assert.deepEqual(copied.windowLayouts.map((w) => w.parentId), [folder, folder]);
  assert.equal(itemsIn(copied, folder).filter((i) => i.kind === 'window-layout').length, 2);
});

test('window layouts move, bin, restore and delete like single-parent items', () => {
  let state = emptyState();
  state = createGroup(state, 'Folder');
  const folder = state.groups[0].id;
  state = createWindowLayout(state, { name: 'Studio', parentId: ROOT_ID });
  const wl = state.windowLayouts[0];

  state = moveSelection(state, [wl.id], folder);
  assert.equal(state.windowLayouts[0].parentId, folder, 'folder move updates the record');

  state = binSelection(state, [wl.id], '2026-01-01T00:00:00.000Z');
  assert.ok(state.windowLayouts[0].bin, 'bin metadata recorded');
  assert.ok(binnedItems(state).some((i) => i.kind === 'window-layout' && i.id === wl.id));

  state = restoreSelection(state, [wl.id]);
  assert.equal(state.windowLayouts[0].bin, undefined);
  assert.equal(state.windowLayouts[0].parentId, folder, 'restores to the original folder');

  state = binSelection(state, [wl.id], '2026-01-01T00:00:00.000Z');
  const deleted = permanentlyDelete(state, [wl.id]);
  assert.equal(deleted.windowLayouts.length, 0, 'permanent delete removes the record');
});

test('reorderWindowLayoutMember reorders the persisted member order only', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'W', parentId: ROOT_ID });
  const wl = state.windowLayouts[0];
  const m1 = { id: 'm1', descriptor: { version: 1, title: 'A', executableFingerprint: 'a'.repeat(64) }, bounds: null, state: 'normal' };
  const m2 = { id: 'm2', descriptor: { version: 1, title: 'B', executableFingerprint: 'b'.repeat(64) }, bounds: null, state: 'normal' };
  const m3 = { id: 'm3', descriptor: { version: 1, title: 'C', executableFingerprint: 'c'.repeat(64) }, bounds: null, state: 'normal' };
  state = addWindowLayoutMember(state, wl.id, m1);
  state = addWindowLayoutMember(state, wl.id, m2);
  state = addWindowLayoutMember(state, wl.id, m3);
  state = reorderWindowLayoutMember(state, wl.id, 'm1', 2);
  assert.deepEqual(state.windowLayouts[0].arrangement.members.map((m) => m.id), ['m2', 'm3', 'm1'], 'm1 moved to index 2');
  const unchanged = reorderWindowLayoutMember(state, wl.id, 'm1', 2);
  assert.equal(unchanged, state, 'same-index reorder is a no-op');
  state = reorderWindowLayoutMember(state, wl.id, 'm3', 0);
  assert.deepEqual(state.windowLayouts[0].arrangement.members.map((m) => m.id), ['m3', 'm2', 'm1'], 'm3 moved to the front');
  assert.throws(() => reorderWindowLayoutMember(state, wl.id, 'nope', 0), /member not found/);
  assert.throws(() => reorderWindowLayoutMember(state, 'nope', 'm1', 0), /not found/);
});
test('deleting a folder cleans up the window layouts inside it', () => {
  let state = emptyState();
  state = createGroup(state, 'Folder');
  const folder = state.groups[0].id;
  state = createWindowLayout(state, { name: 'Inside', parentId: folder });
  state = binSelection(state, [folder], '2026-01-01T00:00:00.000Z');
  const deleted = permanentlyDelete(state, [folder]);
  assert.equal(deleted.windowLayouts.length, 0, 'the nested layout died with its folder');
});

// 035: the shared attached/detached card geometry is one persisted value on the
// window-layout record; it survives reload and mirrors the widget resize.
test('035 setWindowLayoutCardSize persists the shared card geometry, bounded', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'W', parentId: ROOT_ID });
  const wl = state.windowLayouts[0];
  assert.equal(wl.cardSize, undefined, 'a fresh layout has no shared geometry yet');
  state = setWindowLayoutCardSize(state, wl.id, 260, 140);
  assert.deepEqual(state.windowLayouts[0].cardSize, { width: 260, height: 140 });
  const unchanged = setWindowLayoutCardSize(state, wl.id, 260, 140);
  assert.equal(unchanged, state, 'unchanged geometry is a no-op (same state reference)');
  assert.throws(() => setWindowLayoutCardSize(state, wl.id, 0, 140), /card size is invalid/);
  assert.throws(() => setWindowLayoutCardSize(state, wl.id, 'x', 140), /card size is invalid/);
  assert.throws(() => setWindowLayoutCardSize(state, 'nope', 260, 140), /not found/);
  // The detached widget's reported window content size is bounded to [1, 2000].
  state = setWindowLayoutCardSize(state, wl.id, 5000, 10);
  assert.deepEqual(state.windowLayouts[0].cardSize, { width: 2000, height: 10 });
});

test('035 normalizeState preserves a valid cardSize and drops a malformed one', () => {
  const raw = {
    ...emptyState(),
    windowLayouts: [
      { id: 'good', name: 'Good', parentId: 'root', cardSize: { width: 300.9, height: 82 } },
      { id: 'bad', name: 'Bad', parentId: 'root', cardSize: { width: 0, height: -4 } },
    ],
  };
  const normalized = normalizeState(raw);
  const good = normalized.windowLayouts.find((w) => w.id === 'good');
  assert.deepEqual(good.cardSize, { width: 301, height: 82 }, 'valid geometry is rounded and preserved');
  assert.equal(normalized.windowLayouts.find((w) => w.id === 'bad').cardSize, undefined, 'malformed geometry dropped');
  const reloaded = normalizeState(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(reloaded.windowLayouts, normalized.windowLayouts, 'save/reload round trip keeps cardSize');
});

// Assignment 015: one-member model/UI slice - ordered membership with a
// stable persisted descriptor and per-layout arrangement.
// =============================================================================

function memberFixture(overrides = {}) {
  return {
    id: 'member-1',
    descriptor: { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) },
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    state: 'normal',
    ...overrides,
  };
}

test('addWindowLayoutMember appends an ordered member with its persisted descriptor only', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Studio' });
  const layoutId = state.windowLayouts[0].id;
  const member = memberFixture();
  state = addWindowLayoutMember(state, layoutId, member);
  const layout = state.windowLayouts[0];
  assert.deepEqual(layout.arrangement, {
    version: 2,
    members: [{ id: 'member-1', descriptor: { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) }, bounds: { x: 10, y: 20, width: 300, height: 200 }, state: 'normal' }],
  });
  assert.ok(JSON.stringify(layout.arrangement).includes('Window A'), 'descriptor title persisted');
  assert.ok(!JSON.stringify(layout.arrangement).includes('runtime'), 'no runtime identity persisted');
  assert.ok(!JSON.stringify(layout.arrangement).includes('hwnd'), 'no HWND persisted');
  assert.ok(!JSON.stringify(layout.arrangement).includes('token'), 'no token persisted');
});

test('addWindowLayoutMember rejects duplicate members and invalid descriptors', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Studio' });
  const layoutId = state.windowLayouts[0].id;
  state = addWindowLayoutMember(state, layoutId, memberFixture());
  assert.throws(() => addWindowLayoutMember(state, layoutId, memberFixture()), /already a member/);
  assert.throws(() => addWindowLayoutMember(state, layoutId, memberFixture({ id: 'other', descriptor: { version: 2, title: 'X', executableFingerprint: 'a'.repeat(64) } })), /invalid/);
  assert.throws(() => addWindowLayoutMember(state, layoutId, memberFixture({ id: 'other', descriptor: { version: 1, title: '', executableFingerprint: 'a'.repeat(64) } })), /invalid/);
  assert.throws(() => addWindowLayoutMember(state, layoutId, memberFixture({ id: 'other', descriptor: { version: 1, title: 'X', executableFingerprint: 'bad' } })), /invalid/);
  assert.throws(() => addWindowLayoutMember(state, 'nope', memberFixture()), /not found/);
});

test('removeWindowLayoutMember unlinks data-only and updateWindowLayoutMember patches the arrangement', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Studio' });
  const layoutId = state.windowLayouts[0].id;
  state = addWindowLayoutMember(state, layoutId, memberFixture());
  state = updateWindowLayoutMember(state, layoutId, 'member-1', {
    bounds: { x: 40, y: 50, width: 400, height: 250 },
    state: 'minimized',
  });
  assert.deepEqual(state.windowLayouts[0].arrangement.members[0].bounds, { x: 40, y: 50, width: 400, height: 250 });
  assert.equal(state.windowLayouts[0].arrangement.members[0].state, 'minimized');
  assert.equal(state.windowLayouts[0].arrangement.members[0].descriptor.executableFingerprint, 'a'.repeat(64), 'descriptor untouched');

  state = removeWindowLayoutMember(state, layoutId, 'member-1');
  assert.deepEqual(state.windowLayouts[0].arrangement, { version: 2, members: [] });
  assert.throws(() => removeWindowLayoutMember(state, 'nope', 'member-1'), /not found/);
});

test('normalization rejects runtime identity and malformed members, preserving legacy upgrades', () => {
  const raw = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    windowLayouts: [{
      id: 'wl', name: 'Studio', parentId: 'root',
      arrangement: {
        version: 2,
        members: [
          memberFixture(),
          { id: 'leak', descriptor: { version: 1, title: 'Bad', executableFingerprint: 'b'.repeat(64) }, runtimeId: 'Tabc', hwnd: 12345, token: 'T123', bounds: null, state: 'normal' },
          { id: 'bad-bounds', descriptor: { version: 1, title: 'BB', executableFingerprint: 'c'.repeat(64) }, bounds: { x: 0, y: 0, width: -5, height: 10 }, state: 'normal' },
          { id: 'bad-state', descriptor: { version: 1, title: 'BS', executableFingerprint: 'd'.repeat(64) }, bounds: null, state: 'maximized' },
          { id: 'dup', descriptor: { version: 1, title: 'D', executableFingerprint: 'e'.repeat(64) }, bounds: null, state: 'normal' },
          { id: 'dup', descriptor: { version: 1, title: 'D2', executableFingerprint: 'f'.repeat(64) }, bounds: null, state: 'normal' },
        ],
      },
    }],
  };
  const normalized = normalizeState(raw);
  const members = normalized.windowLayouts[0].arrangement.members;
  assert.equal(members.length, 5, 'malformed member FIELDS are cleaned, duplicate ids removed; only invalid descriptors are dropped');
  assert.equal(members.filter((member) => member.id === 'dup').length, 1, 'duplicate member ids pruned');
  assert.deepEqual(members[0], memberFixture(), 'the valid member survives intact');
  const cleanedLeak = members.find((member) => member.descriptor.title === 'Bad');
  assert.ok(cleanedLeak, 'the member carrying runtime fields survives');
  assert.deepEqual(Object.keys(cleanedLeak).sort(), ['bounds', 'descriptor', 'id', 'state'],
    'runtimeId/hwnd/token fields are rejected and never persisted');
  assert.equal(members.find((member) => member.descriptor.title === 'BB').bounds, null, 'malformed bounds are dropped, not stored');
  assert.equal(members.find((member) => member.descriptor.title === 'BS').state, 'normal', 'unsupported state normalizes to normal');
  assert.ok(!JSON.stringify(normalized).includes('hwnd'), 'HWND never persists');
  assert.ok(!JSON.stringify(normalized).includes('runtimeId'), 'runtimeId never persists');
  const reloaded = normalizeState(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(reloaded.windowLayouts[0].arrangement, normalized.windowLayouts[0].arrangement, 'member save/reload round trip');
});

test('window-layout set membership remains durable but layouts are no longer spatial nodes', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Studio', parentId: ROOT_ID });
  const wl = state.windowLayouts[0];
  const withSets = setItemSets(state, [{
    id: 'set-s', type: 'set', title: 'S', memberIds: [wl.id], excludedIds: [],
  }]);
  assert.deepEqual(withSets.view.itemSets[0].memberIds, [wl.id], 'membership survives setItemSets');
  const reloaded = normalizeState(JSON.parse(JSON.stringify(withSets)));
  assert.deepEqual(reloaded.view.itemSets[0].memberIds, [wl.id], 'and survives reload');
  assert.ok(!visibleGraphItems(reloaded, ROOT_ID, new Set(), false)
    .some((i) => i.id === wl.id), 'a widget layout is absent from the spatial graph');

  // An item revealed beneath an expanded ancestor is a trail item, so 005
  // excludes it from the set system for that view only. Use a real graph body
  // here because widget layouts no longer participate in the spatial graph.
  let s2 = createGroup(emptyState(), 'F1');
  const f1 = s2.groups[0].id;
  s2 = createGroup(s2, 'Trail folder', f1);
  s2 = createGroup(s2, 'F2', f1);
  const f2 = s2.groups.at(-1).id;
  const trailItems = visibleGraphItems(s2, f2, new Set(), false, 'bin',
    [{ id: ROOT_ID, name: 'As you Go' }, { id: f1, name: 'F1' }], new Set([f1]));
  const trailGroup = trailItems.find((i) => i.id === s2.groups.find((g) => g.name === 'Trail folder')?.id);
  assert.ok(trailGroup?.trail === true, 'revealed under an expanded ancestor, it is trail');
  assert.ok(!setEligibleItems(trailItems).some((i) => i.id === trailGroup?.id),
    'and excluded from sets in that view');
});

test('the simulation collides with the rendered window-layout footprint', () => {
  // The footprint seam: node.width/height come from the measured shell
  // (offsetWidth/offsetHeight), so a wide window-layout shell makes the
  // existing collision treat it as wide. Two bodies dropped at the same
  // point separate to at least the sum of their measured radii.
  const wide = { id: 'wl', x: 400, y: 300, width: 220, height: 152, vx: 0, vy: 0 };
  const neighbor = { id: 'n', x: 400, y: 300, width: 124, height: 152, vx: 0, vy: 0 };
  settleScene([wide, neighbor], []);
  const radiusA = Math.max(wide.width, wide.height) / 2 + 20;
  const radiusB = Math.max(neighbor.width, neighbor.height) / 2 + 20;
  const distance = Math.hypot(wide.x - neighbor.x, wide.y - neighbor.y);
  assert.ok(distance >= radiusA + radiusB - 1,
    `separated by the measured footprints (${distance.toFixed(0)}px >= ${radiusA + radiusB}px)`);
});

// =============================================================================
// Safety (standing rule 2, Assignment 003 shape): the ancestors join the
// creator's real simulation as ordinary unpinned bodies. Pinned items are
// the creator's arrangement and cannot move by mechanism; unpinned items
// near the centre settle with the pack. This harness replicates the
// workspace graph's force configuration.
// =============================================================================

function settleScene(nodes, links, maxTicks = 800) {
  const simulation = forceSimulation()
    .force('cx', forceX(400).strength(0.05))
    .force('cy', forceY(300).strength(0.05))
    .force('charge', forceManyBody().strength(-280))
    .force('collide', forceCollide()
      .radius((n) => Math.max(n.width, n.height) / 2 + 20)
      .strength(0.9))
    .force('link', forceLink()
      .id((n) => n.id)
      .distance(145)
      .strength(0.14))
    .alphaDecay(0.028)
    .velocityDecay(0.32);
  simulation.nodes(nodes);
  simulation.force('link').links(links.map((link) => ({ source: link.source, target: link.target })));
  simulation.stop();
  for (let tick = 0; tick < maxTicks; tick += 1) {
    simulation.tick();
    if (simulation.alpha() <= simulation.alphaMin()) return tick + 1;
  }
  return maxTicks;
}

function settleNode(id, x, y, { pinned = false } = {}) {
  return {
    id, x, y, vx: 0, vy: 0, width: 124, height: 152,
    fx: pinned ? x : null, fy: pinned ? y : null,
  };
}

test('ancestors joining the folder view leave the arranged (pinned) items untouched', () => {
  const pinned = [
    settleNode('p1', 120, 100, { pinned: true }),
    settleNode('p2', 680, 120, { pinned: true }),
    settleNode('p3', 100, 500, { pinned: true }),
    settleNode('p4', 700, 480, { pinned: true }),
    settleNode('p5', 400, 60, { pinned: true }),
    settleNode('p6', 400, 540, { pinned: true }),
  ];
  const unpinned = [
    settleNode('u1', 300, 260),
    settleNode('u2', 500, 250),
    settleNode('u3', 320, 340),
    settleNode('u4', 480, 350),
  ];
  // The ancestors (Assignment 003): ordinary bodies seeded near the centre,
  // linked root-to-leaf like the chain the entry prepends.
  const ancestors = [
    settleNode('root', 400, 300),
    settleNode('f1', 420, 300),
    settleNode('f2', 440, 300),
  ];
  const ancestorLinks = [
    { source: 'root', target: 'f1' },
    { source: 'f1', target: 'f2' },
  ];

  const baselineUnpinned = unpinned.map((n) => ({ ...n }));
  settleScene([...pinned.map((n) => ({ ...n })), ...baselineUnpinned], []);
  const baseline = new Map(baselineUnpinned.map((n) => [n.id, { x: n.x, y: n.y }]));

  const ticks = settleScene([...pinned, ...unpinned, ...ancestors], ancestorLinks);

  for (const n of pinned) {
    assert.equal(n.x, n.fx, `${n.id} pinned x untouched`);
    assert.equal(n.y, n.fy, `${n.id} pinned y untouched`);
  }
  const displacements = unpinned.map((n) => {
    const start = baseline.get(n.id);
    return Math.hypot(n.x - start.x, n.y - start.y);
  });
  const maxDisplacement = Math.max(...displacements);
  assert.ok(ticks <= 800, `settled within 800 ticks (${ticks})`);
  assert.ok(maxDisplacement < 300,
    `the ancestors moved unpinned items at most ${maxDisplacement.toFixed(0)}px`);
  assert.ok([...pinned, ...unpinned, ...ancestors].every((n) =>
    Number.isFinite(n.x) && Number.isFinite(n.y)), 'all positions finite');
  console.log(`[ancestor-perturbation] settle ${ticks} ticks (${(ticks / 60).toFixed(2)}s @60Hz), ` +
    `pinned displacement 0px, unpinned displacement attributable to the ancestors: ` +
    `max ${maxDisplacement.toFixed(1)}px`);
});


// Assignment 017I1: persisted active-recording layout id (Winter model lane).
// =============================================================================

function activeFixtureState() {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'L1' });
  const l1 = state.windowLayouts[0].id;
  state = createWindowLayout(state, { name: 'L2' });
  const l2 = state.windowLayouts[1].id;
  return { state, l1, l2 };
}

test('017I1: activeWindowLayoutId defaults null and normalizes legacy/unknown/binned ids', () => {
  const legacy = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  assert.equal(legacy.activeWindowLayoutId, null, 'legacy state without the field defaults to null');

  const { state, l1 } = activeFixtureState();
  const stale = normalizeState({
    schemaVersion: 1, groups: [], shortcuts: [],
    windowLayouts: state.windowLayouts, activeWindowLayoutId: 'window-layout-gone',
  });
  assert.equal(stale.activeWindowLayoutId, null, 'unknown/stale active id normalizes to null');

  const valid = normalizeState({
    schemaVersion: 1, groups: [], shortcuts: [],
    windowLayouts: state.windowLayouts, activeWindowLayoutId: l1,
  });
  assert.equal(valid.activeWindowLayoutId, l1, 'existing non-binned active id is kept');

  const binned = binSelection(state, [l1], '2026-07-30T00:00:00.000Z');
  const binnedRaw = normalizeState({
    schemaVersion: 1, groups: [], shortcuts: [],
    windowLayouts: binned.windowLayouts, activeWindowLayoutId: l1,
  });
  assert.equal(binnedRaw.activeWindowLayoutId, null, 'binned active id normalizes to null');

  assert.equal(normalizeState({
    schemaVersion: 1, groups: [], shortcuts: [],
    windowLayouts: state.windowLayouts, activeWindowLayoutId: 5,
  }).activeWindowLayoutId, null, 'non-string active id normalizes to null');
});

test('removeClosedWindowFromAllLayouts retires one closed native window from every referencing layout', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'One' });
  state = createWindowLayout(state, { name: 'Two' });
  const [one, two] = state.windowLayouts.map((layout) => layout.id);
  const descriptor = { version: 1, title: 'Shared', executableFingerprint: 'a'.repeat(64) };
  state = addWindowLayoutMember(state, one, memberFixture({ id: 'one-shared', descriptor }));
  state = addWindowLayoutMember(state, two, memberFixture({ id: 'two-shared', descriptor }));
  state = addWindowLayoutMember(state, two, memberFixture({
    id: 'two-other',
    descriptor: { version: 1, title: 'Other', executableFingerprint: 'b'.repeat(64) },
  }));
  const next = removeClosedWindowFromAllLayouts(state, descriptor);
  assert.deepEqual(next.windowLayouts[0].arrangement.members, []);
  assert.deepEqual(next.windowLayouts[1].arrangement.members.map((member) => member.id), ['two-other']);
  assert.equal(removeClosedWindowFromAllLayouts(next, descriptor), next, 'an already-retired descriptor is byte-zero');
  assert.throws(() => removeClosedWindowFromAllLayouts(state, { title: 'Shared', executableFingerprint: 'bad' }), /invalid/);
});

test('exact instance-only retirement preserves same-title siblings', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Windows' });
  const [layoutId] = state.windowLayouts.map((layout) => layout.id);
  const shared = { version: 1, title: 'Shared', executableFingerprint: 'a'.repeat(64) };
  state = addWindowLayoutMember(state, layoutId, memberFixture({
    id: 'instance-a', descriptor: { ...shared, windowInstanceId: 'Waaaaaaaaaaaaaaaa' },
  }));
  state = addWindowLayoutMember(state, layoutId, memberFixture({
    id: 'instance-b', descriptor: { ...shared, windowInstanceId: 'Wbbbbbbbbbbbbbbbb' },
  }));

  const next = removeClosedWindowFromAllLayouts(state, { version: 1, windowInstanceId: 'Waaaaaaaaaaaaaaaa' });
  assert.deepEqual(next.windowLayouts[0].arrangement.members.map((member) => member.id), ['instance-b']);
});

test('Quick Run card geometry is bounded and survives state normalization', () => {
  assert.deepEqual(normalizeQuickRunCardSize({ width: 300, height: 120 }), { width: 420, height: 180 });
  assert.deepEqual(normalizeQuickRunCardSize({ width: 5000, height: 5000 }), { width: 1100, height: 800 });
  const normalized = normalizeState({ view: { quickRunCardSize: { width: 701.4, height: 333.6 } } });
  assert.deepEqual(normalized.view.quickRunCardSize, { width: 701, height: 334 });
  assert.equal(normalizeQuickRunCardSize({ width: 'wide', height: 300 }), null);
});

test('startup reconciliation removes dead members and deletes only empty untracked layouts', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Ordinary' });
  state = createWindowLayout(state, { name: 'Tracked' });
  const [ordinary, tracked] = state.windowLayouts;
  state = setWindowLayoutTracking(state, tracked.id, true);
  state = addWindowLayoutMember(state, ordinary.id, memberFixture({
    id: 'ordinary-dead',
    descriptor: { version: 1, title: 'Closed', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0123456789abcdef' },
  }));
  state = addWindowLayoutMember(state, tracked.id, memberFixture({
    id: 'tracked-dead',
    descriptor: { version: 1, title: 'Closed too', executableFingerprint: 'b'.repeat(64), windowInstanceId: 'Wfedcba9876543210' },
  }));
  state = { ...state, activeWindowLayoutId: ordinary.id };

  const next = reconcileWindowLayoutsAfterStartup(state, []);
  assert.equal(next.windowLayouts.some((layout) => layout.id === ordinary.id), false,
    'a populated non-tracking layout disappears once every exact member is gone');
  assert.equal(next.windowLayouts.find((layout) => layout.id === tracked.id).arrangement.members.length, 0,
    'the tracking owner persists as an empty durable layout');
  assert.equal(next.activeWindowLayoutId, null, 'deleting the active layout clears its runtime id');
  assert.equal(next.startupWindowLayoutId, tracked.id, 'the tracking owner remains the startup layout');
});

test('startup reconciliation preserves live and legacy members', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'Keep' });
  const layoutId = state.windowLayouts[0].id;
  state = addWindowLayoutMember(state, layoutId, memberFixture({
    id: 'live',
    descriptor: { version: 1, title: 'Live', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0123456789abcdef' },
  }));
  state = addWindowLayoutMember(state, layoutId, memberFixture({
    id: 'legacy',
    descriptor: { version: 1, title: 'Legacy', executableFingerprint: 'b'.repeat(64) },
  }));
  const next = reconcileWindowLayoutsAfterStartup(state, ['W0123456789abcdef']);
  assert.deepEqual(next.windowLayouts[0].arrangement.members.map((member) => member.id), ['live', 'legacy']);
});

test('017I1: activeWindowLayoutId round-trips through normalizeState', () => {
  const { state, l1 } = activeFixtureState();
  const set = setActiveWindowLayoutId(state, l1);
  const reloaded = normalizeState(JSON.parse(JSON.stringify(set)));
  assert.equal(reloaded.activeWindowLayoutId, l1, 'save/reload round-trip keeps the active id');
});

test('017I1: setActiveWindowLayoutId switches, clears and rejects unknown/binned ids', () => {
  const { state, l1, l2 } = activeFixtureState();
  assert.equal(setActiveWindowLayoutId(state, l1).activeWindowLayoutId, l1, 'set L1');
  assert.equal(setActiveWindowLayoutId(setActiveWindowLayoutId(state, l1), l2).activeWindowLayoutId, l2, 'switch L1 -> L2');
  assert.equal(setActiveWindowLayoutId(setActiveWindowLayoutId(state, l1), null).activeWindowLayoutId, null, 'null clears the id');
  assert.equal(setActiveWindowLayoutId(state, 'window-layout-unknown').activeWindowLayoutId, null, 'unknown id is rejected');
  assert.equal(setActiveWindowLayoutId(setActiveWindowLayoutId(state, l1), 'window-layout-unknown').activeWindowLayoutId, l1, 'rejected set keeps the current value');
  assert.equal(setActiveWindowLayoutId(state, '').activeWindowLayoutId, null, 'empty string is rejected');
  const binned = binSelection(state, [l1], '2026-07-30T00:00:00.000Z');
  assert.equal(setActiveWindowLayoutId(binned, l1).activeWindowLayoutId, null, 'binned id is rejected');
});

test('017I1: active id never selects a layout nested under a binned folder', () => {
  let state = emptyState();
  state = createGroup(state, 'Folder');
  const folder = state.groups[0].id;
  state = createWindowLayout(state, { name: 'L1', parentId: folder });
  const l1 = state.windowLayouts[0].id;
  const binned = binSelection(state, [folder], '2026-07-30T00:00:00.000Z');
  assert.equal(setActiveWindowLayoutId(binned, l1).activeWindowLayoutId, null, 'layout under a binned folder is rejected');
  assert.equal(normalizeState({
    schemaVersion: 1, groups: binned.groups, shortcuts: [],
    windowLayouts: binned.windowLayouts, activeWindowLayoutId: l1,
  }).activeWindowLayoutId, null, 'layout under a binned folder normalizes to null');
});

test('tracking has one durable owner and suppression survives reload', () => {
  let state = emptyState();
  state = createWindowLayout(state, { name: 'A' });
  state = createWindowLayout(state, { name: 'B' });
  const [a, b] = state.windowLayouts;
  state = setWindowLayoutTracking(state, a.id, true);
  assert.equal(state.startupWindowLayoutId, a.id);
  assert.equal(state.windowLayouts.find((entry) => entry.id === a.id).tracking.enabled, true);
  state = setWindowLayoutTracking(state, b.id, true);
  assert.equal(state.windowLayouts.find((entry) => entry.id === a.id).tracking.enabled, false);
  assert.equal(state.windowLayouts.find((entry) => entry.id === b.id).tracking.enabled, true);
  state = setWindowLayoutInstanceSuppressed(state, b.id, 'W0123456789abcdef', true);
  const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded.windowLayouts.find((entry) => entry.id === b.id).tracking.suppressedInstanceIds, ['W0123456789abcdef']);
  state = setWindowLayoutTracking(state, b.id, false);
  assert.equal(state.startupWindowLayoutId, null, 'disabling automatic tracking clears startup resume');
});

test('017I1: setActiveWindowLayoutId leaves every arrangement byte-stable', () => {
  const { state, l1 } = activeFixtureState();
  const member = {
    id: 'm1',
    descriptor: { version: 1, title: 'W', executableFingerprint: 'a'.repeat(64) },
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    state: 'normal',
  };
  const withMember = addWindowLayoutMember(state, l1, member);
  const before = JSON.stringify(withMember.windowLayouts);
  assert.equal(JSON.stringify(setActiveWindowLayoutId(withMember, l1).windowLayouts), before, 'setting the active id leaves arrangements byte-stable');
  assert.equal(JSON.stringify(setActiveWindowLayoutId(withMember, null).windowLayouts), before, 'clearing the active id leaves arrangements byte-stable');
});

test('017I1: binning or deleting the active layout clears it; restore never reactivates', () => {
  // Binning the active layout clears it immediately.
  const { state, l1 } = activeFixtureState();
  const set = setActiveWindowLayoutId(state, l1);
  const binned = binSelection(set, [l1], '2026-07-30T00:00:00.000Z');
  assert.equal(binned.activeWindowLayoutId, null, 'binning the active layout clears the id');
  const restored = restoreSelection(binned, [l1]);
  assert.equal(restored.activeWindowLayoutId, null, 'restore never reactivates the id implicitly');

  // Permanently deleting the active layout keeps it cleared.
  const binnedAgain = binSelection(restored, [l1], '2026-07-30T00:00:00.000Z');
  const deleted = permanentlyDelete(binnedAgain, [l1]);
  assert.equal(deleted.activeWindowLayoutId, null, 'deleting the active layout clears the id');
});

test('024 window-layout name/icon customization is removed (updateGroup rejects, group rename still works)', () => {
  let state = createWindowLayout(emptyState(), { name: 'Layout', parentId: ROOT_ID });
  const layout = state.windowLayouts[0];
  const before = JSON.stringify(state.windowLayouts);
  assert.throws(() => updateGroup(state, layout.id, { name: 'Renamed', icon: 'x' }),
    /not customizable/, 'renaming a window-layout throws');
  assert.equal(JSON.stringify(state.windowLayouts), before, 'the layout record is byte-unchanged after the rejected rename');
  state = createGroup(state, 'Folder');
  const folderId = state.groups.find((g) => g.name === 'Folder').id;
  state = updateGroup(state, folderId, { name: 'Renamed Folder', icon: 'x' });
  assert.equal(state.groups.find((g) => g.id === folderId).name, 'Renamed Folder', 'ordinary group rename still works');
});

// ===========================================================================
// Remembered resting positions. An unpinned node used to seed onto a generic
// ring, so the solver settled it somewhere new on every open and a workspace
// rearranged itself under the creator. It now seeds from where it last rested.
//
// The distinction that matters: remembered is NOT pinned. graphPositions is
// applied as fx/fy and freezes a node; graphRestPositions is only a starting
// point, and every force still moves the node afterwards.

test('a remembered resting position round-trips and is kept apart from pinning', () => {
  let state = emptyState();
  state = setGraphRestPositions(state, 'ctx', { 'item-a': { x: 12, y: 34 } });

  assert.deepEqual(getGraphRestPosition(state, 'ctx', 'item-a'), { x: 12, y: 34 });
  // Remembering must not pin: the pinned map stays empty, so nothing gains fx/fy.
  assert.equal(getGraphPosition(state, 'ctx', 'item-a'), null);
  assert.deepEqual(state.view.graphPositions, {});

  // And pinning must not write a resting place, so releasing a pin cannot leave
  // a stale coordinate behind that looks like one.
  let pinned = setGraphPositions(emptyState(), 'ctx', { 'item-b': { x: 5, y: 6 } });
  assert.deepEqual(getGraphPosition(pinned, 'ctx', 'item-b'), { x: 5, y: 6 });
  assert.equal(getGraphRestPosition(pinned, 'ctx', 'item-b'), null);
});

test('resting positions are scoped per context and survive unrelated view updates', () => {
  let state = emptyState();
  state = setGraphRestPositions(state, 'ctx-one', { shared: { x: 1, y: 1 } });
  state = setGraphRestPositions(state, 'ctx-two', { shared: { x: 99, y: 99 } });
  assert.deepEqual(getGraphRestPosition(state, 'ctx-one', 'shared'), { x: 1, y: 1 });
  assert.deepEqual(getGraphRestPosition(state, 'ctx-two', 'shared'), { x: 99, y: 99 });

  state = updateWorkspaceView(state, { binMode: true });
  assert.deepEqual(getGraphRestPosition(state, 'ctx-one', 'shared'), { x: 1, y: 1 });
  assert.equal(state.view.binMode, true);
});

test('a resting position can be dropped, and dropping the last one drops the context', () => {
  let state = setGraphRestPositions(emptyState(), 'ctx', {
    keep: { x: 1, y: 2 },
    drop: { x: 3, y: 4 },
  });
  state = removeGraphRestPositions(state, 'ctx', ['drop']);
  assert.deepEqual(getGraphRestPosition(state, 'ctx', 'keep'), { x: 1, y: 2 });
  assert.equal(getGraphRestPosition(state, 'ctx', 'drop'), null);

  state = removeGraphRestPositions(state, 'ctx', ['keep']);
  assert.deepEqual(state.view.graphRestPositions, {}, 'an empty context should not linger');
});

test('resting positions survive a save and reload, and reject malformed entries', () => {
  let state = setGraphRestPositions(emptyState(), 'ctx', { good: { x: 7, y: 8 } });
  const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(getGraphRestPosition(reloaded, 'ctx', 'good'), { x: 7, y: 8 });

  // Anything non-finite is discarded rather than seeding a node to NaN, which
  // would put it somewhere unrecoverable.
  const damaged = normalizeState({
    ...JSON.parse(JSON.stringify(state)),
    view: {
      ...state.view,
      graphRestPositions: {
        ctx: {
          good: { x: 7, y: 8 },
          nan: { x: Number.NaN, y: 3 },
          missing: { x: 1 },
          nonsense: 'over there',
        },
      },
    },
  });
  assert.deepEqual(getGraphRestPosition(damaged, 'ctx', 'good'), { x: 7, y: 8 });
  for (const id of ['nan', 'missing', 'nonsense']) {
    assert.equal(getGraphRestPosition(damaged, 'ctx', id), null, `${id} should be rejected`);
  }
});

test('a state file written before resting positions existed loads cleanly', () => {
  // Backwards compatibility: the key simply arrives empty rather than throwing
  // or leaving the view without it.
  const legacy = JSON.parse(JSON.stringify(emptyState()));
  delete legacy.view.graphRestPositions;
  const loaded = normalizeState(legacy);
  assert.deepEqual(loaded.view.graphRestPositions, {});
  assert.equal(getGraphRestPosition(loaded, 'ctx', 'anything'), null);
});

test('permanently deleting an item forgets where it rested, in every context', () => {
  // The leak this closes: a remembered position is keyed by item id, so an entry
  // for a deleted item is never read again and simply accumulates in a file the
  // creator keeps for years.
  let state = createGroup(emptyState(), 'Folder');
  const folderId = state.groups[0].id;
  state = createShortcut(state, { name: 'Doomed', target: 'C:\a.exe', parentId: folderId });
  const doomedId = state.shortcuts[0].id;

  // Remembered in two different contexts, plus an unrelated item that must stay.
  state = setGraphRestPositions(state, 'root', { [doomedId]: { x: 1, y: 2 }, keeper: { x: 9, y: 9 } });
  state = setGraphRestPositions(state, folderId, { [doomedId]: { x: 3, y: 4 } });
  assert.deepEqual(getGraphRestPosition(state, 'root', doomedId), { x: 1, y: 2 });
  assert.deepEqual(getGraphRestPosition(state, folderId, doomedId), { x: 3, y: 4 });

  state = binSelection(state, [state.shortcuts[0].placements[0].id]);
  state = permanentlyDelete(state, [state.shortcuts[0].placements[0].id]);

  assert.equal(getGraphRestPosition(state, 'root', doomedId), null, 'root context still remembers it');
  assert.equal(getGraphRestPosition(state, folderId, doomedId), null, 'folder context still remembers it');
  assert.deepEqual(getGraphRestPosition(state, 'root', 'keeper'), { x: 9, y: 9 },
    'an unrelated item lost its position');
});

test('deleting a folder forgets its descendants resting positions too', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parentId = state.groups[0].id;
  state = createGroup(state, 'Child', parentId);
  const childId = state.groups.find((g) => g.name === 'Child').id;

  state = setGraphRestPositions(state, 'root', { [parentId]: { x: 1, y: 1 }, [childId]: { x: 2, y: 2 } });
  state = binSelection(state, [parentId]);
  state = permanentlyDelete(state, [parentId]);

  assert.equal(getGraphRestPosition(state, 'root', parentId), null);
  assert.equal(getGraphRestPosition(state, 'root', childId), null,
    'a descendant deleted with its folder must be forgotten as well');
});

test('deleting nothing relevant leaves the remembered map untouched', () => {
  let state = createGroup(emptyState(), 'Folder');
  state = createShortcut(state, { name: 'Gone', target: 'C:\a.exe', parentId: state.groups[0].id });
  state = setGraphRestPositions(state, 'root', { survivor: { x: 5, y: 6 } });
  const before = state.view.graphRestPositions;

  state = binSelection(state, [state.shortcuts[0].placements[0].id]);
  state = permanentlyDelete(state, [state.shortcuts[0].placements[0].id]);

  // Nothing to prune means the same object, not a needless rebuild of the map.
  assert.equal(state.view.graphRestPositions, before);
  assert.deepEqual(getGraphRestPosition(state, 'root', 'survivor'), { x: 5, y: 6 });
});
