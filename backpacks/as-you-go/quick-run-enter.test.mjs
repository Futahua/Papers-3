// What Enter does, end to end through the modules that can be imported here.
//
// The entry file cannot be imported (it boots the workspace from the document), so the chain is split
// where the code is: quick-run-entry.test.mjs asserts the entry wiring names these calls, and this file
// runs the calls themselves against the real workspace command object - the same activateItem workspace
// Enter uses - so "Folder Enter navigates" is a navigated folder rather than a matching string.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  planQuickRunActivation,
  quickRunWorkspaceItemId,
  revalidateQuickRunRow,
} from './public/app/quick-run/quick-run-activation.js';

function createHarness({ groups = [], shortcuts = [] } = {}) {
  let state = { groups, shortcuts, view: { currentGroupId: 'root' } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = { launch: [], openWeb: [], reveal: [], status: [] };
  const commands = createWorkspaceCommands({
    store,
    host: {
      launchShortcut: async (id) => { effects.launch.push(id); },
      openWebLink: async (url) => { effects.openWeb.push(url); },
      revealShortcut: async (id) => { effects.reveal.push(id); },
    },
    graph: { destroyGraphView: () => {}, _getNode: () => null },
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
    moveSelection: (s) => s,
    copySelection: (s) => s,
    collapsePlacements: (s) => s,
    binSelection: (s) => s,
    resolveBinTargets: (ids) => ids,
    graphContextId: () => 'ctx',
    removeGraphPositions: (s) => s,
    removeGraphRestPositions: (s) => s,
    setGraphPositions: (s) => s,
    createWebLink: (s) => s,
    createDroppedShortcuts: (s) => s,
    syncSelection: () => {},
    saveWorkspaceView: () => {},
    closeMenu: () => {},
    render: () => {},
    setStatus: (text) => { effects.status.push(text); },
  });
  return { store, commands, effects };
}

const state = {
  groups: [
    { id: 'g-root', parentId: 'root', name: 'Workspace' },
    { id: 'g-2', parentId: 'g-root', name: 'Writing' },
  ],
  shortcuts: [
    { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-2', order: 1 }] },
    { id: 's-2', name: 'Editor', target: 'C:/Program Files/Editor/editor.exe', placements: [{ id: 'p-2', parentId: 'g-2', order: 2 }] },
  ],
};

/** Exactly what the entry file's onActivate does, minus the status copy, for a query that highlights a row. */
function pressEnter(harness, query) {
  const session = quickRunSessionWithQuery(openQuickRunSession(state), query);
  const current = revalidateQuickRunRow(state, session.highlightKey);
  assert.equal(current.ok, true, `"${query}" highlights a row that still exists`);
  const plan = planQuickRunActivation(current.row);
  const itemId = quickRunWorkspaceItemId(plan);
  assert.notEqual(itemId, null, `"${query}" plans an action the workspace can take`);
  return { row: current.row, plan, done: harness.commands.activateItem(itemId) };
}

test('Folder Enter navigates (section 1.5)', () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'writing');
  assert.equal(row.type, 'folder');
  assert.equal(plan.command, 'workspace.open-selection');
  void done;
  assert.equal(harness.store.getSession().currentId, 'g-2', 'the folder is the one that was searched for');
});

test('Shortcut Enter launches (section 1.5)', async () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'editor');
  assert.equal(row.type, 'shortcut');
  assert.equal(plan.command, 'workspace.open-selection');
  await done;
  assert.deepEqual(harness.effects.launch, ['s-2']);
  assert.deepEqual(harness.effects.reveal, [], 'launching is not revealing (section 1.6)');
});

test('Link Enter opens its web URL (section 1.5)', async () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'docs');
  assert.equal(row.type, 'link', 'an https target is classified as a Link');
  assert.equal(plan.action, 'open-link');
  await done;
  assert.deepEqual(harness.effects.openWeb, ['https://example.com/docs']);
  assert.deepEqual(harness.effects.launch, [], 'a link is opened, not launched as a program');
});

// The races: the row was indexed, the workspace moved on before Enter arrived. The rule is the same in
// every case - the indexed payload is never executed - and what differs is the outcome: a rename is
// answered with the *current* row, while a deletion, a binning or a change that moves the stable key is
// answered with a reason and no action at all.
function pressEnterWith(harness, query, nextState) {
  const session = quickRunSessionWithQuery(openQuickRunSession(state), query);
  const indexedKey = session.highlightKey;
  const current = revalidateQuickRunRow(nextState, indexedKey);
  if (!current.ok) return { stale: true, reason: current.reason, indexedKey };
  const plan = planQuickRunActivation(current.row);
  return {
    stale: false,
    indexedKey,
    row: current.row,
    plan,
    done: harness.commands.activateItem(quickRunWorkspaceItemId(plan)),
  };
}

test('rename-before-Enter executes the current row, never the indexed one (stale-index execution)', () => {
  const harness = createHarness(state);
  const renamed = {
    ...state,
    shortcuts: state.shortcuts.map((shortcut) => (
      shortcut.id === 's-2' ? { ...shortcut, name: 'Renamed editor' } : shortcut
    )),
  };
  const { stale, row, indexedKey } = pressEnterWith(harness, 'editor', renamed);
  assert.equal(stale, false);
  assert.equal(row.name, 'Renamed editor', 'the current name, not the one the index carried');
  assert.equal(row.resultKey, indexedKey, 'the occurrence identity is unchanged, which is why a rename is safe');
});

test('delete-before-Enter does nothing and says why (stale-index execution)', () => {
  const harness = createHarness(state);
  const deleted = { ...state, shortcuts: state.shortcuts.filter((shortcut) => shortcut.id !== 's-2') };
  const { stale, reason } = pressEnterWith(harness, 'editor', deleted);
  assert.equal(stale, true);
  assert.equal(reason, 'the-result-is-no-longer-in-the-workspace');
  assert.deepEqual(harness.effects.launch, [], 'nothing was launched from the stale payload');
});

test('bin-before-Enter does nothing and says why (stale-index execution)', () => {
  const harness = createHarness(state);
  const binned = {
    ...state,
    shortcuts: state.shortcuts.map((shortcut) => (
      shortcut.id === 's-2'
        ? {
          ...shortcut,
          placements: shortcut.placements.map((placement) => (
            { ...placement, bin: { at: '2026-09-12T08:00:00+07:00' } }
          )),
        }
        : shortcut
    )),
  };
  const { stale } = pressEnterWith(harness, 'editor', binned);
  assert.equal(stale, true);
  assert.deepEqual(harness.effects.launch, []);
});

test('layout-member-remove-before-Enter does nothing and says why (stale-index execution)', () => {
  const withLayout = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [],
    windowLayouts: [
      {
        id: 'l-1',
        parentId: 'g-root',
        name: 'Focus',
        arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
      },
    ],
  };
  const withoutMember = {
    ...withLayout,
    windowLayouts: withLayout.windowLayouts.map((layout) => ({ ...layout, arrangement: { members: [] } })),
  };
  const harness = createHarness(withLayout);
  const session = quickRunSessionWithQuery(openQuickRunSession(withLayout), 'chrome');
  const indexedKey = session.highlightKey;
  assert.equal(indexedKey, 'layout-member:l-1:m-1');
  const current = revalidateQuickRunRow(withoutMember, indexedKey);
  assert.deepEqual(current, { ok: false, reason: 'the-result-is-no-longer-in-the-workspace' });
  assert.deepEqual(harness.effects.launch, [], 'and the deferred activation is not even planned');
});

test('a target edit that changes the classification cannot run the stale payload (stale-index execution)', () => {
  const harness = createHarness(state);
  // The row was indexed as a Link; by the time Enter arrives the record is a filesystem shortcut, so the
  // stable key itself has moved and the stale URL must not be opened.
  const retargeted = {
    ...state,
    shortcuts: state.shortcuts.map((shortcut) => (
      shortcut.id === 's-1' ? { ...shortcut, target: 'C:/Program Files/Docs/docs.exe' } : shortcut
    )),
  };
  const { stale, indexedKey } = pressEnterWith(harness, 'docs', retargeted);
  assert.equal(indexedKey, 'link:p-1', 'the index knew it as a Link');
  assert.equal(stale, true, 'and the current state has no such key any more');
  assert.deepEqual(harness.effects.openWeb, [], 'the stale URL was not opened');
});
