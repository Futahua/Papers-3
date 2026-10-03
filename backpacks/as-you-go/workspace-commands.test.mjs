import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';
// The real one, not a stub: these tests exist to prove the set commands reach
// the store, and a stubbed writer would pass whether or not they did.
import { setItemSets } from './public/workspace-model-20260730b.js';

function createHarness({ groups = [], shortcuts = [], model = {} } = {}) {
  let state = { groups, shortcuts, view: { currentGroupId: 'root' } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = {
    sync: 0, saves: 0, close: 0, render: 0, destroyGraph: 0,
    launch: [], openWeb: [], reveal: [], status: [],
  };
  const base = {
    group: (id) => groups.find((candidate) => candidate.id === id) ?? null,
    shortcut: (id) => shortcuts.find((candidate) => candidate.id === id) ?? null,
    item: (id) => (
      groups.find((candidate) => candidate.id === id)
      ?? shortcuts.find((candidate) => candidate.id === id)
      ?? null
    ),
    isWebLink: (candidate) => candidate?.target?.startsWith('https://'),
    visiblePlacementIdFor: (id) => `p-${id}`,
    visibleParentCountFor: () => 1,
    allActivePlacementIds: (id) => [`p-${id}`],
    anyActivePlacementId: (id) => `p-${id}`,
    moveSelection: (s, ids, parentId) => ({ ...s, moved: [...ids, parentId] }),
    copySelection: (s, ids, parentId) => ({
      ...s,
      pastes: [...(s.pastes ?? []), { ids, parentId }],
    }),
    collapsePlacements: (s, id, parentId) => ({ ...s, collapsed: [id, parentId] }),
    binSelection: (s, ids) => ({ ...s, binned: ids }),
    resolveBinTargets: (ids) => ids,
    graphContextId: () => 'ctx',
    removeGraphPositions: (s, ctxId, ids) => ({ ...s, positionsRemoved: ids }),
    removeGraphRestPositions: (s, ctxId, ids) => ({ ...s, restPositionsRemoved: ids }),
    setGraphPositions: (s, ctxId, positions) => ({ ...s, pinned: positions }),
    createWebLink: (s, input) => ({ ...s, webLink: input }),
    createDroppedShortcuts: (s, targets, destination) => ({
      ...s,
      dropped: { targets, destination },
      shortcuts: [...s.shortcuts, ...targets],
    }),
    setItemSets,
  };
  Object.assign(base, model);
  const host = {
    launchShortcut: async (id) => { effects.launch.push(id); },
    openWebLink: async (url) => { effects.openWeb.push(url); },
    revealShortcut: async (id) => { effects.reveal.push(id); },
    resolveWebIcon: async (url) => ({ title: 'Site', icon: 'data:icon' }),
    resolveDroppedTargets: async (files) => files.map((f) => ({ name: f.name, target: f.name })),
    fileCapability: async () => ({ ok: false }),
  };
  if (model.host) Object.assign(host, model.host);
  const graphNodes = new Map();
  const commands = createWorkspaceCommands({
    store,
    host,
    graph: {
      destroyGraphView: () => { effects.destroyGraph += 1; },
      _getNode: (id) => graphNodes.get(id) ?? null,
      reheat: () => { effects.reheat = (effects.reheat ?? 0) + 1; },
    },
    ...base,
    scopeRootId: model.scopeRootId ?? null,
    syncSelection: () => { effects.sync += 1; },
    saveWorkspaceView: () => { effects.saves += 1; },
    closeMenu: () => { effects.close += 1; },
    render: () => { effects.render += 1; },
    setStatus: (text) => { effects.status.push(text); },
  });
  return { store, commands, effects, base, graphNodes };
}

test('selectItem without modifiers selects just the item and sets the anchor', () => {
  const h = createHarness();  h.commands.selectItem('b', { shiftKey: false, ctrlKey: false, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['b']);
  assert.equal(h.store.getSession().selectionAnchor, 'b');
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

test('selectItem ctrl-click toggles an item and updates the anchor', () => {
  const h = createHarness();
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  h.commands.selectItem('c', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['a', 'c']);
  assert.equal(h.store.getSession().selectionAnchor, 'c');
  // ctrl-clicking a selected item removes it.
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['c']);
});

test('selectItem shift-click selects the range from the anchor', () => {
  const h = createHarness();
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: false, visibleItemIds: ['a', 'b', 'c', 'd'] });
  h.commands.selectItem('c', { shiftKey: true, ctrlKey: false, visibleItemIds: ['a', 'b', 'c', 'd'] });
  assert.deepEqual([...h.store.getSession().selected], ['a', 'b', 'c']);
});

test('selectItem shift-click extends the range without clearing prior ctrl selection', () => {
  const h = createHarness();
  h.commands.selectItem('b', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c', 'd'] });
  h.commands.selectItem('d', { shiftKey: true, ctrlKey: true, visibleItemIds: ['a', 'b', 'c', 'd'] });
  assert.deepEqual([...h.store.getSession().selected], ['b', 'c', 'd']);
});

test('undo and redo run through the store history', async () => {
  const h = createHarness();
  await h.store.commit({ groups: [], shortcuts: [], view: { currentGroupId: 'g1' } });
  await h.store.commit({ groups: [], shortcuts: [], view: { currentGroupId: 'g2' } });
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g2');

  await h.commands.undo();
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g1');
  await h.commands.redo();
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g2');
});

test('activateItem navigates into an explorer folder', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'Things' }] });
  h.store.setSelection(['g1']);
  h.commands.activateItem('g1');
  assert.equal(h.store.getSession().currentId, 'g1');
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.effects.destroyGraph, 1);
  assert.equal(h.effects.close, 1);
  assert.equal(h.effects.render, 1);
  assert.equal(h.effects.saves, 1);
});

test('activateItem on a folder in Bin mode drills within the Bin', () => {
  const h = createHarness({ groups: [{ id: 'bin-folder', parentId: 'root', name: 'Nested', bin: true }] });
  h.store.setNavigation({ binMode: true });
  h.commands.activateItem('bin-folder');
  assert.equal(h.store.getSession().binCurrentId, 'bin-folder');
  assert.equal(h.store.getSession().currentId, null);
});

test('activateItem launches a shortcut and opens a web link', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 's1', name: 'App', target: 'C:\\app.exe' },
      { id: 's2', name: 'Site', target: 'https://example.com' },
    ],
  });
  await h.commands.activateItem('s1');
  assert.deepEqual(h.effects.launch, ['s1']);
  await h.commands.activateItem('s2');
  assert.deepEqual(h.effects.openWeb, ['https://example.com']);
});

test('revealSelection reveals each unique directory once', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 'a', name: 'A', target: 'D:\\work\\a.txt' },
      { id: 'b', name: 'B', target: 'D:\\work\\b.txt' },
      { id: 'c', name: 'C', target: 'D:\\other\\c.txt' },
    ],
  });
  h.store.setSelection(['a', 'b', 'c']);
  await h.commands.revealSelection();
  assert.deepEqual(h.effects.reveal, ['a', 'c']);
});

test('activateSelection launches every selected shortcut', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 'a', name: 'A', target: 'C:\\a.exe' },
      { id: 'b', name: 'B', target: 'https://example.com' },
    ],
  });
  h.store.setSelection(['a', 'b']);
  await h.commands.activateSelection();
  assert.deepEqual(h.effects.launch, ['a']);
  assert.deepEqual(h.effects.openWeb, ['https://example.com']);
});

test('copySelection stores a copy clipboard with ids and placement ids', () => {
  const h = createHarness({ shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }] });
  h.store.setSelection(['s1']);
  h.commands.copySelection();
  const clipboard = h.store.getSession().clipboard;
  assert.equal(clipboard.mode, 'copy');
  assert.deepEqual(clipboard.ids, ['s1']);
  assert.equal(clipboard.placementIds.get('s1'), 'p-s1');
  assert.equal(h.effects.close, 1);
});

test('cutSelection marks a linked shortcut for whole collapse', () => {
  const h = createHarness({
    shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }],
    model: { visibleParentCountFor: () => 2 },
  });
  h.store.setSelection(['s1']);
  h.commands.cutSelection();
  assert.equal(h.store.getSession().clipboard.mode, 'cut');
  assert.ok(h.store.getSession().clipboard.collapseWhole.has('s1'));
});

test('pasteInto copy links into each destination and keeps the clipboard', async () => {
  const h = createHarness();
  h.store.setClipboard({ mode: 'copy', ids: ['s1'], placementIds: new Map([['s1', 'p-s1']]), collapseWhole: new Set() });
  await h.commands.pasteInto(['g1', 'g2']);
  assert.deepEqual(h.store.getSnapshot().pastes, [
    { ids: ['p-s1'], parentId: 'g1' },
    { ids: ['p-s1'], parentId: 'g2' },
  ]);
  assert.ok(h.store.getSession().clipboard);
});

test('pasteInto cut moves to the first destination and clears the clipboard', async () => {
  const h = createHarness();
  h.store.setClipboard({ mode: 'cut', ids: ['s1'], placementIds: new Map([['s1', 'p-s1']]), collapseWhole: new Set() });
  await h.commands.pasteInto(['g1', 'g2']);
  assert.deepEqual(h.store.getSnapshot().moved, ['p-s1', 'g1']);
  assert.equal(h.store.getSession().clipboard, null);
});

test('external clipboard file paste reuses dropped-file resolution', async () => {
  const h = createHarness();
  await h.commands.pasteExternalClipboard({ files: [{ name: 'model.rvt' }], text: '' }, ['root']);
  assert.equal(h.store.getSnapshot().dropped.destination, 'root');
  assert.deepEqual(h.store.getSnapshot().dropped.targets, [{ name: 'model.rvt', target: 'model.rvt' }]);
});

test('external clipboard text resolves an existing machine path before treating it as a link', async () => {
  const h = createHarness({
    model: {
      host: {
        fileCapability: async (operation, params) => operation === 'stat'
          ? { ok: true, entry: { path: params.path, name: 'plan.dwg', kind: 'file' } }
          : { ok: false },
      },
    },
  });
  await h.commands.pasteExternalClipboard({ text: '"D:\\work\\plan.dwg"' }, ['root']);
  assert.equal(h.store.getSnapshot().dropped.targets[0].target, 'D:\\work\\plan.dwg');
  assert.equal(h.store.getSnapshot().webLink, undefined);
});

test('external clipboard text falls back to the existing web-link path when no file exists', async () => {
  const h = createHarness();
  await h.commands.pasteExternalClipboard({ text: 'example.com' }, ['root']);
  assert.equal(h.store.getSnapshot().webLink.target, 'example.com');
  assert.equal(h.store.getSnapshot().webLink.parentId, 'root');
});

test('pasteClipboard keeps internal AYG copy when the Windows clipboard is unchanged', async () => {
  const snapshots = [
    { ok: true, kind: 'text', text: 'old clipboard', fingerprint: 'same' },
    { ok: true, kind: 'text', text: 'old clipboard', fingerprint: 'same' },
  ];
  const h = createHarness({
    shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }],
    model: { host: { fileCapability: async (operation) => operation === 'clipboard-read' ? snapshots.shift() : { ok: false } } },
  });
  h.store.setSelection(['s1']);
  h.commands.copySelection();
  await new Promise((resolve) => setImmediate(resolve));

  await h.commands.pasteClipboard({ text: 'old clipboard' }, ['g1']);

  assert.deepEqual(h.store.getSnapshot().pastes, [{ ids: ['p-s1'], parentId: 'g1' }]);
  assert.equal(h.store.getSnapshot().webLink, undefined);
});

test('pasteClipboard lets a newer system clipboard override stale internal AYG copy data', async () => {
  const snapshots = [
    { ok: true, kind: 'text', text: 'before', fingerprint: 'before' },
    { ok: true, kind: 'text', text: 'example.com', fingerprint: 'after' },
  ];
  const h = createHarness({
    shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }],
    model: { host: { fileCapability: async (operation) => operation === 'clipboard-read' ? snapshots.shift() : { ok: false } } },
  });
  h.store.setSelection(['s1']);
  h.commands.copySelection();
  await new Promise((resolve) => setImmediate(resolve));

  await h.commands.pasteClipboard({ text: 'example.com' }, ['root']);

  assert.equal(h.store.getSnapshot().webLink.target, 'example.com');
  assert.equal(h.store.getSnapshot().pastes, undefined);
});

test('pasteClipboard uses Papers native clipboard fallback when Chromium exposes no payload', async () => {
  const target = { target: 'D:\\phone\\photo.jpg', name: 'photo.jpg', kind: 'file' };
  const h = createHarness({
    model: {
      host: {
        fileCapability: async (operation) => operation === 'clipboard-read'
          ? { ok: true, kind: 'files', targets: [target], fingerprint: 'phone-file' }
          : { ok: false },
      },
    },
  });

  await h.commands.pasteClipboard({}, ['root']);

  assert.equal(h.store.getSnapshot().dropped.destination, 'root');
  assert.deepEqual(h.store.getSnapshot().dropped.targets, [target]);
});

test('moveSelectionToBin bins the resolved targets and commits', async () => {
  const h = createHarness({
    model: {
      resolveBinTargets: (ids) => ids.flatMap((id) => (id === 's1' ? ['p-s1', 'p-s1b'] : [id])),
    },
  });
  h.store.setSelection(['g1', 's1']);
  await h.commands.moveSelectionToBin();
  assert.deepEqual(h.store.getSnapshot().binned, ['g1', 'p-s1', 'p-s1b']);
  assert.equal(h.store.getSession().selected.size, 0);
});

test('scoped Bin protects only the project root and normalizes boundary drops', async () => {
  const h = createHarness({
    groups: [
      { id: 'project-root', parentId: 'root', name: 'Project' },
      { id: 'child', parentId: 'project-root', name: 'Child' },
    ],
    model: { scopeRootId: 'project-root' },
  });
  h.store.setSelection(['project-root', 'child']);
  await h.commands.moveSelectionToBin();
  assert.deepEqual(h.store.getSnapshot().binned, ['child']);
  await h.commands.dropFiles([{ name: 'note.txt' }], 'root');
  assert.equal(h.store.getSnapshot().dropped.destination, 'project-root');
  h.store.setSelection(['project-root']);
  await h.commands.moveSelectionToBin();
  assert.equal(h.effects.status.at(-1), 'The project folder cannot be moved to the Bin.');
});

test('selectedPasteDestinations uses selected folders or the current folder', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'G' }] });
  h.store.setSelection(['g1', 's1']);
  assert.deepEqual(h.commands.selectedPasteDestinations(), ['g1']);
  h.store.setSelection(['s1']);
  h.store.setNavigation({ currentId: 'root' });
  assert.deepEqual(h.commands.selectedPasteDestinations(), ['root']);
});

test('resetGraphPositions removes saved positions, resets nodes, reheats, and saves', () => {
  const node = { fx: 10, fy: 10, positioned: true, vx: 1, vy: 1 };
  const h = createHarness({
    model: {
      graphContextId: () => 'ctx-1',
      removeGraphPositions: (s, ctxId, ids) => ({ ...s, positionsRemoved: { ctxId, ids } }),
      removeGraphRestPositions: (s, ctxId, ids) => ({ ...s, restPositionsRemoved: { ctxId, ids } }),
    },
  });
  h.graphNodes.set('s1', node);
  h.store.setSelection(['s1']);
  h.commands.resetGraphPositions();
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, { ctxId: 'ctx-1', ids: ['s1'] });
  assert.equal(node.fx, null);
  assert.equal(node.fy, null);
  assert.equal(node.positioned, false);
  assert.equal(node.vx, 0);
  assert.equal(node.vy, 0);
  assert.equal(h.effects.reheat, 1);
  assert.equal(h.effects.close, 1);
  assert.equal(h.effects.saves, 1);
});

test('clearSelection clears the selection and saves the view', () => {
  const h = createHarness();
  h.store.setSelection(['a', 'b']);
  h.commands.clearSelection();
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

test('selectAllVisible selects every visible item and clears the anchor', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.commands.selectAllVisible(['a', 'b', 'c']);
  assert.deepEqual([...h.store.getSession().selected], ['a', 'b', 'c']);
  assert.equal(h.store.getSession().selectionAnchor, null);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

test('beginMarqueeSelection without preserve clears and returns no base', () => {
  const h = createHarness();
  h.store.setSelection(['a', 'b']);
  const base = h.commands.beginMarqueeSelection({ preserveSelection: false });
  assert.deepEqual(base, []);
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.store.getSession().selectionAnchor, null);
  assert.equal(h.effects.sync, 1);
});

test('beginMarqueeSelection with preserve keeps the selection as the base', () => {
  const h = createHarness();
  h.store.setSelection(['a', 'b']);
  const base = h.commands.beginMarqueeSelection({ preserveSelection: true });
  assert.deepEqual(base, ['a', 'b']);
  assert.deepEqual([...h.store.getSession().selected], ['a', 'b']);
  assert.equal(h.effects.sync, 0);
});

test('updateMarqueeSelection replaces the transient selection and syncs', () => {
  const h = createHarness();
  h.commands.updateMarqueeSelection(['x', 'y']);
  assert.deepEqual([...h.store.getSession().selected], ['x', 'y']);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 0);
});

test('finishMarqueeSelection saves only when the gesture moved', () => {
  const h = createHarness();
  h.commands.finishMarqueeSelection({ moved: true });
  assert.equal(h.effects.saves, 1);
  const h2 = createHarness();
  h2.commands.finishMarqueeSelection({ moved: false });
  assert.equal(h2.effects.saves, 0);
});

test('dropUrl resolves the web icon, creates a web link, and commits', async () => {
  const h = createHarness({
    model: {
      host: {
        resolveWebIcon: async (url) => ({ title: 'Docs', icon: 'data:docs' }),
      },
    },
  });
  await h.commands.dropUrl('https://docs.example.com', 'g1');
  assert.deepEqual(h.store.getSnapshot().webLink, {
    name: 'Docs',
    target: 'https://docs.example.com',
    icon: 'data:docs',
    parentId: 'g1',
  });
  assert.equal(h.effects.status.length, 0);
});

test('dropFiles resolves targets, creates shortcuts, and commits', async () => {
  const h = createHarness();
  await h.commands.dropFiles([{ name: 'a.txt' }, { name: 'b.txt' }], 'g1');
  assert.deepEqual(h.store.getSnapshot().dropped, {
    targets: [
      { name: 'a.txt', target: 'a.txt' },
      { name: 'b.txt', target: 'b.txt' },
    ],
    destination: 'g1',
  });
  assert.equal(h.effects.status.length, 0);
});

test('dropFiles reports when shortcuts already exist without committing', async () => {
  const h = createHarness({
    model: {
      createDroppedShortcuts: (s) => s,
    },
  });
  await h.commands.dropFiles([{ name: 'a.txt' }], 'g1');
  assert.equal(h.effects.status[0], 'Those shortcuts already exist here.');
  assert.equal(h.store.getSnapshot().dropped, undefined);
});

test('dragDropToBin bins resolved targets and clears positions', async () => {
  const h = createHarness({
    model: {
      resolveBinTargets: (ids) => ids.flatMap((id) => (id === 's1' ? ['p1', 'p1b'] : [id])),
    },
  });
  await h.commands.dragDropToBin({ itemIds: ['g1', 's1'] });
  assert.deepEqual(h.store.getSnapshot().binned, ['g1', 'p1', 'p1b']);
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, ['g1', 's1']);
  assert.deepEqual(h.store.getSnapshot().restPositionsRemoved, ['g1', 's1'],
    'a binned item must not keep the place it was remembered at');
});

test('dragDropToFolder moves groups and single placements into the folder', async () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'G' }] });
  await h.commands.dragDropToFolder({
    itemIds: ['g1', 's1'],
    placementIds: new Map([['s1', 'p-s1']]),
    folderId: 'dest',
  });
  assert.deepEqual(h.store.getSnapshot().moved, ['g1', 'p-s1', 'dest']);
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, ['g1', 's1']);
});

test('dragDropToFolder collapses whole linked shortcuts', async () => {
  const h = createHarness({
    model: {
      visibleParentCountFor: (id) => (id === 's1' ? 2 : 1),
    },
  });
  await h.commands.dragDropToFolder({
    itemIds: ['s1'],
    placementIds: new Map([['s1', 'p-s1']]),
    folderId: 'dest',
  });
  assert.deepEqual(h.store.getSnapshot().collapsed, ['s1', 'dest']);
});

test('pinDraggedNodes saves the pinned positions', () => {
  const h = createHarness();
  h.commands.pinDraggedNodes({ positions: { s1: { x: 10, y: 20 } } });
  assert.deepEqual(h.store.getSnapshot().pinned, { s1: { x: 10, y: 20 } });
  assert.equal(h.effects.saves, 1);
});

test('releaseDraggedNodes removes the positions and saves', () => {
  const h = createHarness();
  h.commands.releaseDraggedNodes({ itemIds: ['s1'] });
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, ['s1']);
  assert.equal(h.effects.saves, 1);
});

test('activateItem with revealDirectoryTarget reveals a directory shortcut', async () => {
  const h = createHarness({
    shortcuts: [{ id: 's-dir', name: 'D', target: 'D:\\Folder' }],
  });
  await h.commands.activateItem('s-dir', { revealDirectoryTarget: true });
  assert.deepEqual(h.effects.reveal, ['s-dir']);
  assert.deepEqual(h.effects.launch, []);
  assert.deepEqual(h.effects.openWeb, []);
  assert.equal(h.effects.close, 1);
});

test('activateItem reveal failure reports status', async () => {
  const h = createHarness({
    shortcuts: [{ id: 's-dir', name: 'D', target: 'D:\\Folder' }],
    model: {
      host: { revealShortcut: async () => { throw new Error('boom'); } },
    },
  });
  await h.commands.activateItem('s-dir', { revealDirectoryTarget: true });
  assert.match(h.effects.status[0], /boom/);
});

test('activateItem launches a normal shortcut without the reveal flag', async () => {
  const h = createHarness({
    shortcuts: [{ id: 's-file', name: 'F', target: 'C:\\app.exe' }],
  });
  await h.commands.activateItem('s-file');
  assert.deepEqual(h.effects.launch, ['s-file']);
  assert.deepEqual(h.effects.reveal, []);
});

test('activateItem opens a web link even with revealDirectoryTarget', async () => {
  const h = createHarness({
    shortcuts: [{ id: 's-web', name: 'W', target: 'https://example.com' }],
  });
  await h.commands.activateItem('s-web', { revealDirectoryTarget: true });
  assert.deepEqual(h.effects.openWeb, ['https://example.com']);
  assert.deepEqual(h.effects.reveal, []);
  assert.deepEqual(h.effects.launch, []);
});

// ===========================================================================
// Sets. These assert on committed state rather than on a spy, because the
// failure they exist to catch is a command that throws and looks like an
// unbound key.
// ===========================================================================

test('G groups the selection into a set that reaches the store', () => {
  const h = createHarness({
    groups: [{ id: 'g1', parentId: 'root', name: 'A' }, { id: 'g2', parentId: 'root', name: 'B' }],
  });
  h.store.setSelection(['g1', 'g2']);

  return h.commands.groupSelectionIntoSet().then(() => {
    const sets = h.store.getSnapshot().view.itemSets;
    assert.equal(sets.length, 1, 'one set was created');
    assert.deepEqual(sets[0].memberIds, ['g1', 'g2'], 'holding exactly the selection');
  });
});

test('G reports what it did in the status line', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'A' }] });
  h.store.setSelection(['g1']);
  return h.commands.groupSelectionIntoSet().then(() => {
    // A successful group and a silently failed one look identical until the
    // outline happens to render, and the outline is the likeliest thing to be
    // broken, so the confirmation carries the count.
    assert.match(h.effects.status.at(-1), /Grouped 1 item \(1 set\)/);
  });
});

test('G with nothing selected creates no set and says why', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'A' }] });
  return h.commands.groupSelectionIntoSet().then(() => {
    assert.equal(h.store.getSnapshot().view?.itemSets, undefined, 'nothing committed');
    assert.match(h.effects.status.at(-1), /Select items first/);
  });
});

test('grouping twice makes two sets rather than replacing the first', () => {
  const h = createHarness({
    groups: [{ id: 'g1', parentId: 'root', name: 'A' }, { id: 'g2', parentId: 'root', name: 'B' }],
  });
  h.store.setSelection(['g1']);
  return h.commands.groupSelectionIntoSet().then(() => {
    h.store.setSelection(['g2']);
    return h.commands.groupSelectionIntoSet();
  }).then(() => {
    const sets = h.store.getSnapshot().view.itemSets;
    assert.equal(sets.length, 2, 'both sets survive');
    assert.deepEqual(sets.map((s) => s.memberIds), [['g1'], ['g2']]);
  });
});

test('a failing commit reaches the status bar instead of vanishing', () => {
  // The lesson from the last attempt: a throw inside a command whose promise
  // the caller drops is indistinguishable from a key that was never bound. The
  // failure has to arrive somewhere the user can see.
  const h = createHarness({
    groups: [{ id: 'g1', parentId: 'root', name: 'A' }],
    model: { setItemSets: () => { throw new Error('disk on fire'); } },
  });
  h.store.setSelection(['g1']);
  return h.commands.groupSelectionIntoSet().then(() => {
    assert.match(h.effects.status.at(-1), /disk on fire/);
  });
});

test('selecting sets leaves the item selection alone', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'A' }] });
  h.store.setSelection(['g1']);
  h.commands.selectSets(['s1']);
  assert.deepEqual([...h.store.getSession().selectedSets], ['s1']);
  assert.deepEqual([...h.store.getSession().selected], ['g1'], 'items untouched');

  h.commands.selectSets(['s2'], { additive: true });
  assert.deepEqual([...h.store.getSession().selectedSets].sort(), ['s1', 's2']);
});

test('deleting a set removes the grouping and keeps every item', () => {
  const h = createHarness({
    groups: [{ id: 'g1', parentId: 'root', name: 'A' }, { id: 'g2', parentId: 'root', name: 'B' }],
  });
  h.store.setSelection(['g1', 'g2']);
  return h.commands.groupSelectionIntoSet().then(() => {
    const [created] = h.store.getSnapshot().view.itemSets;
    h.commands.selectSets([created.id]);
    return h.commands.deleteSelectedSets();
  }).then(() => {
    const snapshot = h.store.getSnapshot();
    assert.deepEqual(snapshot.view.itemSets, [], 'the grouping is gone');
    assert.deepEqual(
      snapshot.groups.map((entry) => entry.id), ['g1', 'g2'],
      'and both items are untouched — this is the whole distinction from Delete on items',
    );
    assert.match(h.effects.status.at(-1), /items are unchanged/);
    assert.equal(h.store.getSession().selectedSets.size, 0, 'selection cleared');
  });
});

test('deleting with no set selected does nothing at all', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'A' }] });
  return h.commands.deleteSelectedSets().then(() => {
    assert.equal(h.effects.status.length, 0, 'no status, no commit');
  });
});

test('the Ctrl+G picker reaches the store and leaves untouched sets alone', async () => {
  // End to end through the real picker, command and model. The module's own
  // tests use a stubbed committer, so this is what proves the wiring carries a
  // membership decision all the way to persisted state.
  const { createSetMembershipMode } = await import('./public/app/components/set-membership-mode.js');
  const h = createHarness({
    groups: [{ id: 'i1', parentId: 'root', name: 'A' }, { id: 'i2', parentId: 'root', name: 'B' }],
  });
  await h.store.commit({
    ...h.store.getSnapshot(),
    view: {
      ...h.store.getSnapshot().view,
      itemSets: [
        { id: 'A', type: 'set', title: 'A', memberIds: ['i1'], excludedIds: [] },
        { id: 'B', type: 'set', title: 'B', memberIds: ['i2'], excludedIds: [] },
      ],
    },
  });
  h.store.setSelection(['i1', 'i2']);

  const mode = createSetMembershipMode({
    getSets: () => h.store.getSnapshot().view?.itemSets ?? [],
    getSelectedIds: () => [...h.store.getSession().selected],
    shareSelectionWithSets: (desired, ids, before) =>
      h.commands.shareSelectionWithSets(desired, ids, before),
    render: () => {},
    setStatus: () => {},
  });

  mode.begin();
  // i1 is only in A and i2 only in B, so neither set covers the whole
  // selection and neither may be pre-chosen.
  assert.deepEqual(mode.chosenSetIds(), [], 'nothing is wholly chosen on open');
  assert.deepEqual(mode.mixedSetIds().sort(), ['A', 'B'], 'both are partial');

  mode.toggleFromItem('i1');
  assert.deepEqual(mode.chosenSetIds(), ['A'], 'clicking resolves A to all');

  await mode.confirm();
  const sets = h.store.getSnapshot().view.itemSets;
  assert.deepEqual(sets.find((s) => s.id === 'A').memberIds, ['i1', 'i2'], 'A took the selection');
  assert.deepEqual(
    sets.find((s) => s.id === 'B').memberIds, ['i2'],
    'B was left partial and is untouched — no cross-set contamination',
  );
});

test('renaming a set round-trips its title without changing membership', async () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'A' }] });
  const original = { id: 'set-a', type: 'set', title: '', memberIds: ['g1'], excludedIds: [] };
  h.store.replace({ ...h.store.getSnapshot(), view: { ...h.store.getSnapshot().view, itemSets: [original] } });
  assert.equal(await h.commands.renameSet('set-a', ' Ideas '), true);
  assert.deepEqual(h.store.getSnapshot().view.itemSets[0], { ...original, title: 'Ideas' });
  assert.equal(await h.commands.renameSet('set-a', '   '), true);
  assert.equal(h.store.getSnapshot().view.itemSets[0].title, '');
  assert.deepEqual(h.store.getSnapshot().view.itemSets[0].memberIds, ['g1']);
});

test('opening the picker and confirming immediately commits nothing', async () => {
  const { createSetMembershipMode } = await import('./public/app/components/set-membership-mode.js');
  const h = createHarness({
    groups: [{ id: 'i1', parentId: 'root', name: 'A' }, { id: 'i2', parentId: 'root', name: 'B' }],
  });
  const itemSets = [
    { id: 'A', type: 'set', title: 'A', memberIds: ['i1'], excludedIds: [] },
    { id: 'B', type: 'set', title: 'B', memberIds: ['i2'], excludedIds: [] },
  ];
  await h.store.commit({
    ...h.store.getSnapshot(),
    view: { ...h.store.getSnapshot().view, itemSets },
  });
  h.store.setSelection(['i1', 'i2']);

  const mode = createSetMembershipMode({
    getSets: () => h.store.getSnapshot().view?.itemSets ?? [],
    getSelectedIds: () => [...h.store.getSession().selected],
    shareSelectionWithSets: (desired, ids, before) =>
      h.commands.shareSelectionWithSets(desired, ids, before),
    render: () => {},
    setStatus: () => {},
  });
  mode.begin();
  await mode.confirm();

  // The union pre-choose this replaces would have added each item to the
  // other's set here, which is a silent edit of membership nobody asked to
  // change.
  const after = h.store.getSnapshot().view.itemSets;
  assert.deepEqual(after.find((s) => s.id === 'A').memberIds, ['i1']);
  assert.deepEqual(after.find((s) => s.id === 'B').memberIds, ['i2']);
});

// ===========================================================================
// Ancestor guards (Assignment 003): ancestors of the current folder are part
// of the path here — the drag-drop commands refuse to bin or move them.
// ===========================================================================

test('dragDropToBin with only ancestor ids bins nothing and reports', async () => {
  const h = createHarness({
    groups: [{ id: 'anc-f1', parentId: 'root', name: 'F1' }],
    model: { isAncestorItem: (id) => id.startsWith('anc-') },
  });
  await h.commands.dragDropToBin({ itemIds: ['anc-f1'] });
  assert.deepEqual(h.effects.status.at(-1), 'The path to this folder cannot be deleted.');
  assert.deepEqual(h.store.getSnapshot().binned, undefined, 'nothing was binned');
});

test('dragDropToBin with mixed ids bins only the non-ancestor ids', async () => {
  const h = createHarness({
    groups: [{ id: 'anc-f1', parentId: 'root', name: 'F1' }],
    model: { isAncestorItem: (id) => id.startsWith('anc-') },
  });
  await h.commands.dragDropToBin({ itemIds: ['anc-f1', 's1'] });
  assert.deepEqual(h.store.getSnapshot().binned, ['s1']);
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, ['s1']);
});

test('dragDropToFolder with only ancestor ids moves nothing and reports', async () => {
  const h = createHarness({
    groups: [{ id: 'anc-f1', parentId: 'root', name: 'F1' }],
    model: { isAncestorItem: (id) => id.startsWith('anc-') },
  });
  await h.commands.dragDropToFolder({ itemIds: ['anc-f1'], placementIds: new Map(), folderId: 'dest' });
  assert.deepEqual(h.effects.status.at(-1), 'The path to this folder cannot be moved into another folder.');
  assert.deepEqual(h.store.getSnapshot().moved, undefined, 'nothing was moved');
});

test('dragDropToFolder with mixed ids moves only the non-ancestor ids', async () => {
  const h = createHarness({
    groups: [{ id: 'anc-f1', parentId: 'root', name: 'F1' }],
    model: { isAncestorItem: (id) => id.startsWith('anc-') },
  });
  await h.commands.dragDropToFolder({ itemIds: ['anc-f1', 'g2'], placementIds: new Map(), folderId: 'dest' });
  assert.deepEqual(h.store.getSnapshot().moved, ['p-g2', 'dest']);
});
