// Section 3.4: the mutations that MUST NOT rebuild the index.
//
// The section says why the list is explicit - high-frequency false invalidation is a known performance
// risk - and the list is exactly the state that changes constantly while a reader works: graph physics,
// selection, hover, window observation, usage metadata. None of it is searchable semantics, so none of it
// may invalidate a query.
//
// The property is therefore two things, and both are asserted per mutation: the open session is a
// snapshot and cannot change under the reader's hands at all, and a *fresh* open over the mutated state
// finds the same universe, because none of these values is an index input. Rows are compared as a set of
// stable keys: a mutation that legitimately reorders occurrences (member order) may reorder rows on
// reopen, and claiming otherwise would be asserting something the contract does not say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';

const base = {
  groups: [
    { id: 'root', parentId: null, name: 'Workspace' },
    { id: 'g-1', parentId: 'root', name: 'Alpha' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Editor',
      target: 'C:/editor.exe',
      icon: null,
      placements: [{ id: 'p-1', parentId: 'g-1', order: 1 }],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-1',
      name: 'Focus',
      cardSize: 'medium',
      arrangement: {
        members: [
          { id: 'm-1', descriptor: { title: 'Chrome' }, state: 'normal', bounds: { x: 0, y: 0, width: 800, height: 600 } },
          { id: 'm-2', descriptor: { title: 'Notes' }, state: 'normal', bounds: { x: 810, y: 0, width: 400, height: 600 } },
        ],
      },
    },
  ],
  view: { currentGroupId: 'root', theme: 'dark', iconSize: 96 },
  activeWindowLayoutId: 'l-1',
  graphPositions: {},
  hovered: null,
  preview: null,
  usage: {},
};

/** Every entry of section 3.4's list, as the state change it names. */
const mutations = [
  ['graph x/y positions', (s) => ({ ...s, graphPositions: { 'g-1': { x: 120, y: 40 } } })],
  ['graph rest positions', (s) => ({ ...s, graphRestPositions: { 'g-1': { x: 1, y: 2 } } })],
  ['graph physics ticks', (s) => ({ ...s, graphTick: (s.graphTick ?? 0) + 1 })],
  ['graph simulation cooling/heating', (s) => ({ ...s, graphAlpha: 0.3 })],
  ['toolbar position', (s) => ({ ...s, toolbarPosition: { x: 12, y: 12 } })],
  ['workspace selection', (s) => ({ ...s, selection: ['g-1'] })],
  ['selection anchor', (s) => ({ ...s, selectionAnchor: 'g-1' })],
  ['current folder navigation', (s) => ({ ...s, view: { ...s.view, currentGroupId: 'g-1' } })],
  ['breadcrumb navigation', (s) => ({ ...s, breadcrumbPath: ['root', 'g-1'] })],
  ['graph-expanded folder state', (s) => ({ ...s, expandedFolders: ['g-1'] })],
  ['trail-expanded folder state', (s) => ({ ...s, trailExpanded: ['g-1'] })],
  ['Bin mode view toggle by itself', (s) => ({ ...s, binMode: true })],
  ['icon-size preference', (s) => ({ ...s, view: { ...s.view, iconSize: 176 } })],
  ['theme/preferences unrelated to Quick Run hotkey', (s) => ({ ...s, view: { ...s.view, theme: 'light' } })],
  ['prompt-library changes', (s) => ({ ...s, promptLibrary: [{ id: 'pr-1', name: 'A prompt' }] })],
  ['Set membership changes while Sets remain excluded', (s) => ({ ...s, sets: [{ id: 'set-1', name: 'A set' }] })],
  ['Set rename/creation while Sets remain excluded', (s) => ({ ...s, sets: [{ id: 'set-2', name: 'Renamed' }] })],
  ['activeWindowLayoutId', (s) => ({ ...s, activeWindowLayoutId: null })],
  ['window-layout member state normal/minimized', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: layout.arrangement.members.map((m) => ({ ...m, state: m.id === 'm-1' ? 'minimized' : m.state })) },
    })),
  })],
  ['window-layout member bounds', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: layout.arrangement.members.map((m) => ({ ...m, bounds: { ...m.bounds, x: m.bounds.x + 500 } })) },
    })),
  })],
  ['window-layout card size', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({ ...layout, cardSize: 'large' })),
  })],
  ['window-layout member order', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: [...layout.arrangement.members].reverse() },
    })),
  })],
  ['capability cache changes', (s) => ({ ...s, capabilities: new Map([['l-1\u0000m-1', { hwnd: 1 }]]) })],
  ['helper restart by itself', (s) => ({ ...s, helperGeneration: (s.helperGeneration ?? 0) + 1 })],
  ['hover', (s) => ({ ...s, hovered: 'shortcut:p-1' })],
  ['preview state', (s) => ({ ...s, preview: { layoutId: 'l-1' } })],
  ['thumbnail result', (s) => ({ ...s, thumbnails: { 'l-1\u0000m-1': 'data:image/png;base64,AA' } })],
  ['icon hydration alone', (s) => ({
    ...s,
    shortcuts: s.shortcuts.map((shortcut) => ({ ...shortcut, icon: 'data:image/png;base64,AA' })),
  })],
  ['widget open/close', (s) => ({ ...s, widgetOpen: true })],
  ['detached/attached presentation state', (s) => ({ ...s, detached: ['l-1'] })],
  ['recency/frequency usage metadata', (s) => ({ ...s, usage: { 'shortcut:p-1': { uses: 12, lastUsedAt: '2026-09-12T08:00:00+07:00' } } })],
];

// The universe a session captured, and what a query over a state resolves to: the snapshot is `allRows`
// because an open-but-empty line deliberately shows no rows at all (section 1.1).
const keysOf = (session) => session.allRows.map((row) => row.resultKey).sort();
const queried = (state) => quickRunSessionWithQuery(openQuickRunSession(state), 'e')
  .rows.map((row) => row.resultKey).sort();

// A peer writing to the workspace document is the case that made this box hard to state: the change
// arrives in the state, not in a message Quick Run listens for. The answer the contract implies is the one
// asserted here - a new search sees it, because a session reads the workspace when it opens and never
// again, and the session already open is deliberately untouched, because section 3.4 forbids rebuilding
// under a reader's hands.
test('a peer document semantic change is reflected on the next open, and not mid-session', () => {
  const before = openQuickRunSession(base);
  const namesBefore = before.allRows.map((row) => row.name).sort();

  const peerWrote = {
    ...base,
    groups: base.groups.map((group) => (group.id === 'g-1' ? { ...group, name: 'Alpha (renamed by peer)' } : group)),
    windowLayouts: base.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: {
        members: [...layout.arrangement.members, { id: 'm-peer', descriptor: { title: 'Added by peer' } }],
      },
    })),
  };

  assert.deepEqual(
    before.allRows.map((row) => row.name).sort(),
    namesBefore,
    'the open session keeps the snapshot it was opened with',
  );
  const nextOpen = openQuickRunSession(peerWrote).allRows.map((row) => row.name).sort();
  assert.deepEqual(
    nextOpen,
    ['Added by peer', 'Alpha (renamed by peer)', 'Chrome', 'Editor', 'Notes'],
    'and the next open is built from the document as the peer left it',
  );
});

test('the section 3.4 list is the whole list, and every entry is exercised', () => {
  assert.equal(mutations.length, 31, 'every mutation the section names has a case here');
  assert.deepEqual(
    mutations.map(([label]) => label),
    [...new Set(mutations.map(([label]) => label))],
    'and no case is duplicated',
  );
});

// An observation storm rather than a single update: the live window observer reports bounds and
// minimize/restore continuously, so the rule has to hold for a run of them, not just for one.
test('a storm of layout bounds and state updates rebuilds nothing (Performance)', () => {
  const session = openQuickRunSession(base);
  const opened = keysOf(session);
  const baseQuery = queried(base);

  let state = base;
  for (let tick = 0; tick < 200; tick += 1) {
    state = {
      ...state,
      windowLayouts: state.windowLayouts.map((layout) => ({
        ...layout,
        arrangement: {
          members: layout.arrangement.members.map((member) => ({
            ...member,
            state: tick % 2 === 0 ? 'minimized' : 'normal',
            bounds: { ...member.bounds, x: tick, width: 800 + tick },
          })),
        },
      })),
    };
  }

  assert.deepEqual(keysOf(session), opened, 'two hundred observations cannot move the open session');
  assert.deepEqual(keysOf(openQuickRunSession(state)), opened, 'nor the universe a fresh open sees');
  assert.deepEqual(queried(state), baseQuery, 'nor the rows a query resolves to');
});

// The control that keeps the thirty-one cases honest: a change that *is* an index input does move the
// universe, so the assertions above are measuring something rather than always being true.
test('a source change is not on this list: renaming a folder does change the universe', () => {
  const renamed = {
    ...base,
    groups: base.groups.map((group) => (group.id === 'g-1' ? { ...group, name: 'Renamed alpha' } : group)),
  };
  assert.deepEqual(keysOf(openQuickRunSession(renamed)), keysOf(openQuickRunSession(base)), 'the row keys are stable');
  assert.deepEqual(
    openQuickRunSession(renamed).allRows.map((row) => row.name).sort(),
    ['Chrome', 'Editor', 'Notes', 'Renamed alpha'],
    'but the row content is rebuilt from the new name, which is what makes it a source',
  );
});

for (const [label, mutate] of mutations) {
  test(`${label} does not rebuild the index (section 3.4)`, () => {
    const session = openQuickRunSession(base);
    const opened = keysOf(session);
    const baseQuery = queried(base);
    assert.equal(opened.length, 4, 'the fixture indexes: one folder, one placement and two layout members');
    assert.equal(baseQuery.length, 3, 'and the query the comparisons use resolves to three of them');

    const mutated = mutate(base);

    assert.deepEqual(keysOf(session), opened, 'the open session cannot change under the reader at all');
    assert.equal(session.open, true);
    assert.equal(session.rows.length, 0, 'an empty query still shows nothing after the mutation');
    assert.deepEqual(
      keysOf(openQuickRunSession(mutated)),
      opened,
      'and a fresh open over the mutated state finds the same universe, because none of this is an index input',
    );
    assert.deepEqual(
      queried(mutated),
      baseQuery,
      'the same query over the mutated state resolves to the same rows, so nothing was rebuilt',
    );
  });
}

// The other half of the Invalidation list: these changes *are* index inputs, so a reopen has to show
// them. Each case names what the index is supposed to do about it, which is what makes the "does not
// rebuild" cases above meaningful rather than a description of a dead index.
const reopened = (state) => openQuickRunSession(state).allRows;
const rowFor = (state, key) => reopened(state).find((row) => row.resultKey === key) ?? null;

test('folder rename rebuilds (Invalidation)', () => {
  const renamed = {
    ...base,
    groups: base.groups.map((group) => (group.id === 'g-1' ? { ...group, name: 'Renamed alpha' } : group)),
  };
  assert.equal(rowFor(renamed, 'folder:g-1').name, 'Renamed alpha');
  assert.equal(rowFor(renamed, 'shortcut:p-1').breadcrumb, 'Workspace › Renamed alpha', 'and its children follow');
});

test('folder move rebuilds, breadcrumbs and all (Invalidation)', () => {
  const moved = {
    ...base,
    groups: [
      { id: 'root', parentId: null, name: 'Workspace' },
      { id: 'g-2', parentId: 'root', name: 'Beta' },
      { id: 'g-1', parentId: 'g-2', name: 'Alpha' },
    ],
  };
  assert.equal(rowFor(moved, 'folder:g-1').breadcrumb, 'Workspace › Beta');
  assert.equal(rowFor(moved, 'shortcut:p-1').breadcrumb, 'Workspace › Beta › Alpha');
});

test('shortcut rename rebuilds', () => {
  const renamed = {
    ...base,
    shortcuts: base.shortcuts.map((shortcut) => ({ ...shortcut, name: 'Renamed editor' })),
  };
  assert.equal(rowFor(renamed, 'shortcut:p-1').name, 'Renamed editor');
});

test('shortcut target classification change rebuilds, including the stable key', () => {
  const reclassified = {
    ...base,
    shortcuts: base.shortcuts.map((shortcut) => ({ ...shortcut, target: 'https://example.com/editor' })),
  };
  assert.equal(rowFor(reclassified, 'shortcut:p-1'), null, 'the prefix is the type, so the key moves with it');
  assert.equal(rowFor(reclassified, 'link:p-1').type, 'link');
  assert.equal(rowFor(reclassified, 'link:p-1').name, 'Editor', 'the occurrence is the same one');
});

test('placement move rebuilds its breadcrumb and nobody else', () => {
  const moved = {
    ...base,
    groups: [...base.groups, { id: 'g-2', parentId: 'root', name: 'Beta' }],
    shortcuts: base.shortcuts.map((shortcut) => ({
      ...shortcut,
      placements: shortcut.placements.map((placement) => ({ ...placement, parentId: 'g-2' })),
    })),
  };
  assert.equal(rowFor(moved, 'shortcut:p-1').breadcrumb, 'Workspace › Beta');
  assert.equal(rowFor(moved, 'folder:g-1').breadcrumb, 'Workspace', 'the folder it left is untouched');
});

test('layout member add and remove rebuild the member rows (Invalidation)', () => {
  const withExtra = {
    ...base,
    windowLayouts: base.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: {
        members: [...layout.arrangement.members, { id: 'm-3', descriptor: { title: 'Terminal' } }],
      },
    })),
  };
  assert.deepEqual(
    reopened(withExtra).map((row) => row.resultKey).sort(),
    ['folder:g-1', 'layout-member:l-1:m-1', 'layout-member:l-1:m-2', 'layout-member:l-1:m-3', 'shortcut:p-1'],
  );
  const withoutOne = {
    ...base,
    windowLayouts: base.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: layout.arrangement.members.filter((member) => member.id !== 'm-1') },
    })),
  };
  assert.equal(rowFor(withoutOne, 'layout-member:l-1:m-1'), null, 'a removed member leaves the universe');
});

test('descriptor change rebuilds the member name (Invalidation)', () => {
  const renamed = {
    ...base,
    windowLayouts: base.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: {
        members: layout.arrangement.members.map((member) => (
          member.id === 'm-1' ? { ...member, descriptor: { title: 'Chrome Canary' } } : member
        )),
      },
    })),
  };
  assert.equal(rowFor(renamed, 'layout-member:l-1:m-1').name, 'Chrome Canary');
  assert.equal(rowFor(renamed, 'layout-member:l-1:m-2').name, 'Notes', 'and only the changed member moves');
});

test('layout name change rebuilds member breadcrumbs (Invalidation)', () => {
  const renamed = {
    ...base,
    windowLayouts: base.windowLayouts.map((layout) => ({ ...layout, name: 'Deep focus' })),
  };
  for (const key of ['layout-member:l-1:m-1', 'layout-member:l-1:m-2']) {
    assert.equal(rowFor(renamed, key).breadcrumb, 'Workspace › Alpha › Deep focus');
  }
});
