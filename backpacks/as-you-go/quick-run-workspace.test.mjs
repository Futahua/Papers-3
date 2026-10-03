// Quick Run's Definition-of-Done Actions boxes, driven the way a person drives them.
//
// The four boxes below stayed open because their STAGE 17 twins could only be asserted two ways: a test
// that re-implemented the entry file's steps against the real command object, and a source-shape assertion
// that the entry still contained those steps. Neither is acceptance - the first proves the copy, the second
// proves a string. What was missing is a seam the test can drive, so `quick-run-workspace.js` now owns the
// composition and this file drives *that*: production markup ids, a real store, the real
// `createWorkspaceCommands`, DOM input, and a keypress.
//
// What is deliberately not real here, and why: the graph, the render and the host. Navigation calls
// `graph.destroyGraphView()` and `render()`, and neither is what these boxes claim; the host is a recording
// stub precisely so "Shortcut launches and nothing is revealed" is an assertion about which effect ran
// rather than about a launch that cannot happen in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';
import { bindQuickRunWorkspace } from './public/app/quick-run/quick-run-workspace.js';

/** The six elements the production markup declares and the binding paints. */
const MARKUP_IDS = ['quick-run-layer', 'quick-run-input', 'quick-run-chips', 'quick-run-results', 'quick-run-notice', 'quick-run-cap'];

function fakeElement(tag = 'div') {
  return {
    tag, hidden: false, value: '', textContent: '', className: '', dataset: {}, children: [],
    listeners: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
    fire(type, event = {}) { for (const handler of this.listeners[type] ?? []) handler(event); },
    focus() {},
  };
}

/**
 * The elements, keyed by the ids the *production markup* declares.
 *
 * Read rather than invented, for the same reason `quick-run-entry.test.mjs` reads it: a harness that builds
 * its own ids would keep passing after the markup renamed or dropped an element, which is exactly the failure
 * an app run would find and a test should.
 */
async function productionElements() {
  const markup = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');
  const ids = [...markup.matchAll(/id="(quick-run-[a-z-]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids, [...MARKUP_IDS].sort(), 'the markup declares exactly the six Quick Run elements');
  // Built from the markup's own ids rather than from a second list here: a renamed element has to make the
  // binding fail, not make this harness quietly agree with itself.
  const byId = new Map(ids.map((id) => [id, fakeElement()]));
  const take = (id) => {
    const element = byId.get(id);
    assert.ok(element, `${id} is declared by the production markup`);
    return element;
  };
  return {
    layer: take('quick-run-layer'),
    input: take('quick-run-input'),
    chips: take('quick-run-chips'),
    results: take('quick-run-results'),
    notice: take('quick-run-notice'),
    cap: take('quick-run-cap'),
  };
}

/** A state a creator could have: two folders, an https link, a program shortcut placed twice, and a layout. */
function initialState() {
  return {
    groups: [
      { id: 'g-root', parentId: 'root', name: 'Workspace' },
      { id: 'g-a', parentId: 'g-root', name: 'Alpha' },
      { id: 'g-b', parentId: 'g-root', name: 'Beta' },
    ],
    shortcuts: [
      { id: 's-link', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-link', parentId: 'g-a', order: 1 }] },
      { id: 's-app', name: 'Editor', target: 'C:/Program Files/Editor/editor.exe', placements: [
        { id: 'p-a', parentId: 'g-a', order: 2 },
        { id: 'p-b', parentId: 'g-b', order: 1 },
      ] },
    ],
    windowLayouts: [],
    view: { currentGroupId: 'root' },
  };
}

function createHarness(options = {}) {
  let state = initialState();
  const effects = { launch: [], openWeb: [], reveal: [], copied: [], status: [], renders: 0 };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (candidate) => candidate,
    setStatus: (text) => { effects.status.push(text); },
  });
  const commands = createWorkspaceCommands({
    store,
    host: {
      launchShortcut: async (id) => { effects.launch.push(id); },
      openWebLink: async (url) => {
        effects.openWeb.push(url);
        if (options.openWebError) throw new Error(options.openWebError);
      },
      revealShortcut: async (id) => { effects.reveal.push(id); },
      copyText: async (text) => { effects.copied.push(text); },
    },
    graph: { destroyGraphView: () => {}, _getNode: () => null },
    group: (id) => state.groups.find((candidate) => candidate.id === id) ?? null,
    windowLayout: (id) => state.windowLayouts.find((candidate) => candidate.id === id) ?? null,
    shortcut: (id) => state.shortcuts.find((candidate) => candidate.id === id) ?? null,
    item: (id) => (
      state.groups.find((candidate) => candidate.id === id)
      ?? state.shortcuts.find((candidate) => candidate.id === id)
      ?? null
    ),
    isWebLink: (candidate) => candidate?.target?.startsWith('https://') ?? false,
    visiblePlacementIdFor: (id) => `p-${id}`,
    visibleParentCountFor: () => 1,
    allActivePlacementIds: (id) => [`p-${id}`],
    anyActivePlacementId: (id) => `p-${id}`,
    moveSelection: (candidate) => candidate,
    copySelection: (candidate) => candidate,
    collapsePlacements: (candidate) => candidate,
    binSelection: (candidate) => candidate,
    resolveBinTargets: (ids) => ids,
    graphContextId: () => 'ctx',
    removeGraphPositions: (candidate) => candidate,
    removeGraphRestPositions: (candidate) => candidate,
    setGraphPositions: (candidate) => candidate,
    createWebLink: (candidate) => candidate,
    createDroppedShortcuts: (candidate) => candidate,
    syncSelection: () => {},
    saveWorkspaceView: () => {},
    closeMenu: () => {},
    render: () => { effects.renders += 1; },
    setStatus: (text) => { effects.status.push(text); },
  });
  return {
    store, commands, effects,
    state: () => state,
    mutate: (change) => { state = change(state); },
  };
}

/** The real binding, on the production markup's elements, over the harness's store and commands. */
async function boot(options = {}) {
  const harness = createHarness(options);
  const elements = await productionElements();
  const surface = bindQuickRunWorkspace({
    document: { createElement: (tag) => fakeElement(tag) },
    elements,
    commands: harness.commands,
    getState: harness.state,
    getVisibleItemIds: () => [],
    setStatus: (text) => { harness.effects.status.push(text); },
    commandSurface: options.commandSurface === true,
    openFolderSurface: options.openFolderSurface,
    dismissCommandSurface: options.dismissCommandSurface,
    activateLayoutMember: options.activateLayoutMember,
    copyText: (text) => harness.effects.copied.push(text),
  });
  const type = (query) => {
    elements.input.value = query;
    elements.input.fire('input');
  };
  const key = (name, modifiers = {}) => {
    elements.layer.fire('keydown', { key: name, preventDefault() {}, ...modifiers });
  };
  return { ...harness, elements, surface, type, key };
}

const rowKeys = (elements) => elements.results.children.map((row) => row.dataset.quickRunKey);
const highlighted = (elements) => elements.results.children.find((row) => row.dataset.quickRunHighlighted === 'true')?.dataset.quickRunKey ?? null;
const isOpen = (elements) => elements.layer.hidden === false;

test('Folder Enter navigates the workspace and closes Quick Run (Definition of Done: Actions)', async () => {
  const h = await boot();
  h.surface.open();
  h.type('alpha');
  assert.deepEqual(rowKeys(h.elements), ['folder:g-a'], 'the input drew the folder as a real ranked row');
  assert.equal(h.elements.results.children[0].dataset.quickRunKey, 'folder:g-a');

  h.key('Enter');

  assert.equal(h.store.getSession().currentId, 'g-a', 'the workspace is now in the folder that was searched for');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful navigate closes the layer');
  assert.deepEqual(h.effects.status, ['Quick Run: opening Alpha [folder]…'], 'opening the folder is announced');
  assert.deepEqual(h.effects.launch, [], 'a folder is navigated into, never launched');
});

test('Folder Enter from the global launcher opens a normal project surface at that folder', async () => {
  const opened = [];
  const h = await boot({
    commandSurface: true,
    openFolderSurface: async (groupId) => { opened.push(groupId); },
  });
  h.surface.open();
  h.type('alpha');

  h.key('Enter');
  await Promise.resolve();

  assert.deepEqual(opened, ['g-a'], 'the launcher hands the folder to the visible project surface');
  assert.deepEqual(h.effects.status, ['Quick Run: opening Alpha [folder]…'], 'the launcher announces the hand-off');
  assert.equal(h.store.getSession().currentId, null, 'the private launcher session does not pretend it navigated');
  assert.equal(isOpen(h.elements), true, 'the native launcher owns dismissal when the new surface takes focus');
});

test('Shortcut Enter launches that record and closes Quick Run (Definition of Done: Actions)', async () => {
  const h = await boot();
  h.surface.open();
  h.type('editor');
  assert.deepEqual(rowKeys(h.elements), ['shortcut:p-a', 'shortcut:p-b'], 'one row per placement');

  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.launch, ['s-app'], 'the shared record id reached the launcher');
  assert.deepEqual(h.effects.openWeb, [], 'a program shortcut is launched, not opened as a link');
  assert.deepEqual(h.effects.reveal, [], 'launching is not revealing (section 1.6)');
  assert.deepEqual(h.effects.status, ['Quick Run: opening Editor [C:/Program Files/Editor/editor.exe]…'], 'launching is announced');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful launch closes the layer');
  assert.equal(h.store.getSession().currentId, null, 'a launch does not navigate');
});

test('global command-surface Shortcut Enter keeps the launched app in front', async () => {
  const dismissed = [];
  const h = await boot({ commandSurface: true, dismissCommandSurface: async (request) => { dismissed.push(request); } });
  h.surface.open();
  h.type('editor');
  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.launch, ['s-app']);
  assert.deepEqual(dismissed, [{ destination: 'external' }]);
  assert.equal(isOpen(h.elements), true, 'the native command-surface host owns dismissal');
});

test('Link Enter opens that URL and closes Quick Run (Definition of Done: Actions)', async () => {
  const h = await boot();
  h.surface.open();
  h.type('docs');
  assert.deepEqual(rowKeys(h.elements), ['link:p-link'], 'an https target is indexed as a Link');

  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.openWeb, ['https://example.com/docs'], 'the URL reached the host opener');
  assert.deepEqual(h.effects.launch, [], 'a link is opened, not launched as a program');
  assert.deepEqual(h.effects.reveal, [], 'and not revealed through the file manager either');
  assert.deepEqual(h.effects.status, ['Quick Run: opening Docs [https://example.com/docs]…'], 'opening the link is announced');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful open closes the layer');
});

test('Ctrl+Enter navigates to the occurrence that was asked for and selects it (Definition of Done: Actions)', async () => {
  const h = await boot();
  h.surface.open();
  h.type('editor');
  // The two placements of one shortcut are two occurrences: g-a holds p-a and g-b holds p-b. The highlight
  // starts on the first, and the arrow key is how a reader asks for the second.
  assert.equal(highlighted(h.elements), 'shortcut:p-a');
  h.key('ArrowDown');
  assert.equal(highlighted(h.elements), 'shortcut:p-b', 'the reader asked for the second occurrence');

  h.key('Enter', { ctrlKey: true });

  assert.equal(h.store.getSession().currentId, 'g-b', 'the folder navigated to is the occurrence\'s own, not the first placement\'s');
  assert.equal(h.store.getSession().selected.has('s-app'), true, 'the shared record is selected, so the reader sees which record was meant');
  assert.equal(h.store.getSession().selectionAnchor, 's-app');
  assert.deepEqual(h.effects.reveal, [], 'section 1.6: Ctrl+Enter never invokes the OS reveal');
  assert.deepEqual(h.effects.launch, [], 'and never launches the target');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful reveal closes the layer');
});

test('global command-surface Link Enter uses the same opener and stays host-owned after success', async () => {
  const dismissed = [];
  const h = await boot({ commandSurface: true, dismissCommandSurface: async (request) => { dismissed.push(request); } });
  h.surface.open();
  h.type('docs');
  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.openWeb, ['https://example.com/docs']);
  assert.deepEqual(h.effects.status, ['Quick Run: opening Docs [https://example.com/docs]…']);
  assert.deepEqual(dismissed, [{ destination: 'external' }], 'successful link handoff dismisses without restoring over the browser');
  assert.equal(isOpen(h.elements), true, 'the native command-surface host owns dismissal');
});

test('global command-surface Folder Enter opens Papers and requests a Papers-window handoff', async () => {
  const opened = [];
  const dismissed = [];
  const h = await boot({
    commandSurface: true,
    openFolderSurface: async (groupId) => { opened.push(groupId); },
    dismissCommandSurface: async (request) => { dismissed.push(request); },
  });
  h.surface.open();
  h.type('alpha');
  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(opened, ['g-a']);
  assert.deepEqual(dismissed, [{ destination: 'papers' }]);
  assert.equal(isOpen(h.elements), true, 'the native command-surface host owns dismissal');
});

test('global command-surface Link Enter keeps the surface alive when opening fails', async () => {
  const h = await boot({ commandSurface: true, openWebError: 'browser refused the URL' });
  h.surface.open();
  h.type('docs');
  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.openWeb, ['https://example.com/docs']);
  assert.deepEqual(h.effects.status, [
    'Quick Run: opening Docs [https://example.com/docs]…',
    'browser refused the URL',
  ]);
  assert.equal(isOpen(h.elements), true, 'a failed activation must not dismiss the global surface');
});

test('Ctrl+Shift+C copies a shortcut target path and does not reveal or launch it', async () => {
  const h = await boot();
  h.surface.open();
  h.type('editor');
  assert.deepEqual(rowKeys(h.elements), ['shortcut:p-a', 'shortcut:p-b']);

  h.key('c', { ctrlKey: true, shiftKey: true });
  await Promise.resolve();

  assert.deepEqual(h.effects.copied, ['C:/Program Files/Editor/editor.exe']);
  assert.deepEqual(h.effects.status, ['Quick Run: copied Editor [C:/Program Files/Editor/editor.exe].']);
  assert.deepEqual(h.effects.reveal, []);
  assert.deepEqual(h.effects.launch, []);
  assert.equal(h.store.getSession().currentId, null, 'copying does not navigate inside As you Go');
  assert.equal(isOpen(h.elements), false, 'a successful copy closes Quick Run');
});

test('Ctrl+Shift+C copies a web link and leaves folders/layout items alone', async () => {
  const h = await boot();
  h.surface.open();
  h.type('docs');
  assert.deepEqual(rowKeys(h.elements), ['link:p-link']);
  h.key('c', { ctrlKey: true, shiftKey: true });
  await Promise.resolve();
  assert.deepEqual(h.effects.copied, ['https://example.com/docs']);
  assert.deepEqual(h.effects.status, ['Quick Run: copied Docs [https://example.com/docs].']);
  assert.equal(isOpen(h.elements), false);

  const folder = await boot();
  folder.surface.open();
  folder.type('alpha');
  folder.key('c', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(folder.effects.copied, []);
  assert.equal(isOpen(folder.elements), true);
});

test('a row that moved or vanished between render and keypress is re-read, not executed', async () => {
  const h = await boot();
  h.surface.open();
  h.type('editor');
  assert.deepEqual(rowKeys(h.elements), ['shortcut:p-a', 'shortcut:p-b'], 'the rows are drawn from the index');

  // The workspace moves on *after* the rows were drawn: the record is gone. The layer is not repainted, so
  // the key is pressed against a stale index, which is the race section 5 is about.
  h.mutate((state) => ({ ...state, shortcuts: state.shortcuts.filter((shortcut) => shortcut.id !== 's-app') }));
  h.key('Enter');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(h.effects.launch, [], 'the stale payload was not launched');
  assert.equal(isOpen(h.elements), true, 'section 16.2: a failure does not silently close the layer');
  assert.deepEqual(h.effects.status, ['Quick Run: that result is no longer in the workspace. The list now shows the current matches.']);
  // And the dead row is replaced rather than left on screen to be hit again: both rows came from the record
  // that no longer exists, so the refreshed list is empty and says so instead of offering them twice.
  assert.deepEqual(rowKeys(h.elements), [], 'the vanished rows are gone from the list, not just refused');
  assert.equal(h.elements.notice.hidden, false, 'and the layer says the query now matches nothing');

  // And the same key on a row that is still there runs the *current* row rather than refusing everything:
  // a rename moves the name the index carried and not the occurrence identity.
  const h2 = await boot();
  h2.surface.open();
  h2.type('editor');
  h2.mutate((state) => ({
    ...state,
    shortcuts: state.shortcuts.map((shortcut) => (shortcut.id === 's-app' ? { ...shortcut, name: 'Renamed editor' } : shortcut)),
  }));
  h2.key('Enter');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h2.effects.launch, ['s-app'], 'the current row was executed, by its stable key');
  assert.equal(isOpen(h2.elements), false);
});

test('Ctrl+Enter on a root-level occurrence navigates back to the root (section 1.6)', async () => {
  // The defect this holds: navigation used to be the last entry of the persisted breadcrumb chain, and a
  // root-level occurrence has no ancestors - so revealing one from inside another folder navigated nowhere
  // and the reader stayed where they were, with the occurrence they asked for off screen.
  const h = await boot();
  h.mutate((state) => ({
    ...state,
    shortcuts: [...state.shortcuts, {
      id: 's-top',
      name: 'Rooftop note',
      target: 'C:/notes/rooftop.md',
      // Placed at the workspace root itself, which is where a breadcrumb chain is empty: the occurrence has
      // no ancestor folder to be sent to, and the root has no group record for activateItem to match.
      placements: [{ id: 'p-top', parentId: 'root', order: 9 }],
    }],
  }));
  h.store.setNavigation({ currentId: 'g-a' });
  h.surface.open();
  h.type('rooftop');
  assert.deepEqual(rowKeys(h.elements), ['shortcut:p-top'], 'the root-level placement is one row');

  h.key('Enter', { ctrlKey: true });

  assert.equal(h.store.getSession().currentId, 'root', 'the reveal goes to the folder the occurrence lives in');
  assert.equal(h.store.getSession().selected.has('s-top'), true, 'and selects the record that was asked for');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful reveal closes the layer');
});

test('Ctrl+Enter on a Layout Item goes to the folder holding the layout, not to the layout id (section 1.6)', async () => {
  // The second half of the same defect: a layout member's breadcrumb chain ends with the layout id, which
  // the workspace's open-selection command does not understand - it knows groups and shortcuts - so handing
  // it over navigated nowhere and Quick Run closed as if it had revealed something.
  const h = await boot();
  h.mutate((state) => ({
    ...state,
    windowLayouts: [{
      id: 'wl-1',
      parentId: 'g-b',
      name: 'Desk',
      order: 3,
      arrangement: {
        version: 2,
        members: [{
          id: 'm-console',
          descriptor: { version: 1, title: 'Console 0', executableFingerprint: 'b7c1'.repeat(16) },
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          state: 'normal',
        }],
      },
    }],
  }));
  h.store.setNavigation({ currentId: 'g-a' });
  h.surface.open();
  h.type('console');
  assert.deepEqual(rowKeys(h.elements), ['layout-member:wl-1:m-console'], 'the member is one row');

  h.key('Enter', { ctrlKey: true });

  assert.equal(h.store.getSession().currentId, 'g-b', 'the folder that holds the layout, where it can be seen');
  assert.notEqual(h.store.getSession().currentId, 'wl-1', 'a layout id is not a destination the command knows');
  assert.equal(h.store.getSession().selected.has('wl-1'), true, 'and the layout record is what gets selected');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful reveal closes the layer');
});

test('Enter on a Layout Item uses the host activation seam and closes after success', async () => {
  const activated = [];
  const h = await boot({
    activateLayoutMember: async (layoutId, memberId) => {
      activated.push([layoutId, memberId]);
      return { outcome: 'success' };
    },
  });
  h.mutate((state) => ({
    ...state,
    windowLayouts: [{
      id: 'wl-1', parentId: 'g-b', name: 'Desk', order: 3,
      arrangement: { version: 2, members: [{
        id: 'm-console',
        descriptor: { version: 1, title: 'Console 0', executableFingerprint: 'b7c1'.repeat(16) },
        bounds: { x: 0, y: 0, width: 800, height: 600 }, state: 'normal',
      }] },
    }],
  }));
  h.surface.open();
  h.type('console');
  h.key('Enter');
  await Promise.resolve();
  assert.deepEqual(activated, [['wl-1', 'm-console']]);
  assert.equal(isOpen(h.elements), false, 'a successful native activation closes Quick Run');
});

test('Ctrl+Enter reveals in the active workspace even while the Bin is open (section 1.6)', async () => {
  // Quick Run's universe excludes Bin contents, so every result belongs to the active workspace. The
  // navigation used to follow the Bin whenever it was open - setting the Bin's own drill-down id - so a
  // reveal from the Bin left the reader inside the Bin looking at an empty view while the layer closed as
  // if it had gone somewhere.
  const h = await boot();
  h.mutate((state) => ({
    ...state,
    shortcuts: [...state.shortcuts, {
      id: 's-top',
      name: 'Rooftop note',
      target: 'C:/notes/rooftop.md',
      placements: [{ id: 'p-top', parentId: 'root', order: 9 }],
    }],
  }));
  h.store.setNavigation({ binMode: true, binCurrentId: 'bin' });
  h.surface.open();
  h.type('rooftop');
  assert.deepEqual(rowKeys(h.elements), ['shortcut:p-top'], 'the active-workspace occurrence is one row');

  h.key('Enter', { ctrlKey: true });

  assert.equal(h.store.getSession().binMode, false, 'the reveal leaves the Bin rather than drilling inside it');
  assert.equal(h.store.getSession().currentId, 'root', 'and shows the folder the occurrence actually lives in');
  assert.equal(h.store.getSession().selected.has('s-top'), true, 'with the record selected');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful reveal closes the layer');
});

test('Folder Enter navigates the active workspace even while the Bin is open (section 1.5)', async () => {
  // The same defect on the other key: activateItem() reaches the Bin-following navigation, so Enter on a
  // folder Quick Run can only have found in the active workspace drilled into the Bin instead.
  const h = await boot();
  h.store.setNavigation({ binMode: true, binCurrentId: 'bin' });
  h.surface.open();
  h.type('alpha');
  assert.deepEqual(rowKeys(h.elements), ['folder:g-a'], 'Alpha is an active-workspace folder row');

  h.key('Enter');

  assert.equal(h.store.getSession().binMode, false, 'Enter leaves the Bin rather than drilling inside it');
  assert.equal(h.store.getSession().currentId, 'g-a', 'and lands in the folder that was searched for');
  assert.equal(isOpen(h.elements), false, 'section 16.1: a successful navigate closes the layer');
});
