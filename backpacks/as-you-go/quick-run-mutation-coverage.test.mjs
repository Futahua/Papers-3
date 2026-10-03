// Mutation coverage for the universe: every mutation the contract lists for folders, shortcuts, links and
// placements, and what the index must do about each one.
//
// These are the sections that say a change *does* rebuild, so the test is always the same shape - mutate
// the state, reopen, look at the universe - and the interesting part is the expected effect: which rows
// appear, which disappear, which keep their identity and which change it. A shortcut with no placement is
// deliberately part of the fixture, because it must produce no row at all: the occurrence is the placement,
// not the record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession } from './public/app/quick-run/quick-run-session.js';

const base = {
  groups: [
    { id: 'root', parentId: null, name: 'Workspace' },
    { id: 'g-1', parentId: 'root', name: 'Alpha' },
    { id: 'g-2', parentId: 'root', name: 'Beta' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Editor',
      target: 'C:/editor.exe',
      placements: [
        { id: 'p-1', parentId: 'g-1', order: 1 },
        { id: 'p-2', parentId: 'g-2', order: 1 },
      ],
    },
    // No placement anywhere: a record without an occurrence is not in the universe.
    { id: 's-orphan', name: 'Unplaced', target: 'C:/unplaced.exe', placements: [] },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-1',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
    },
  ],
};

const reopened = (state) => openQuickRunSession(state).allRows;
const keys = (state) => reopened(state).map((row) => row.resultKey).sort();
const rowFor = (state, key) => reopened(state).find((row) => row.resultKey === key) ?? null;
const withGroups = (groups) => ({ ...base, groups });
const withShortcuts = (shortcuts) => ({ ...base, shortcuts });
const withLayouts = (windowLayouts) => ({ ...base, windowLayouts });

test('the fixture is the one the cases assume', () => {
  assert.deepEqual(keys(base), ['folder:g-1', 'folder:g-2', 'layout-member:l-1:m-1', 'shortcut:p-1', 'shortcut:p-2']);
  assert.equal(rowFor(base, 'shortcut:p-orphan'), null, 'an unplaced record is not an occurrence');
});

test('create folder: the new folder is a row, and a childless one is only itself', () => {
  const created = withGroups([...base.groups, { id: 'g-3', parentId: 'g-2', name: 'Gamma' }]);
  assert.equal(rowFor(created, 'folder:g-3').breadcrumb, 'Workspace › Beta');
  assert.deepEqual(keys(created).filter((key) => key === 'folder:g-3'), ['folder:g-3']);
});

test('delete or permanently remove folder: it takes its descendants with it', () => {
  const deleted = withGroups(base.groups.filter((group) => group.id !== 'g-2'));
  assert.equal(rowFor(deleted, 'folder:g-2'), null);
  assert.equal(rowFor(deleted, 'shortcut:p-2'), null, 'the placement inside it went too');
  assert.deepEqual(keys(deleted), ['folder:g-1', 'layout-member:l-1:m-1', 'shortcut:p-1']);
});

test('bin folder: same disappearance as deletion, and restore brings it back', () => {
  const binned = withGroups(base.groups.map((group) => (
    group.id === 'g-2' ? { ...group, bin: { at: '2026-09-12T08:00:00+07:00' } } : group
  )));
  assert.equal(rowFor(binned, 'folder:g-2'), null);
  assert.equal(rowFor(binned, 'shortcut:p-2'), null);
  const restored = withGroups(binned.groups.map((group) => (
    group.id === 'g-2' ? { ...group, bin: undefined } : group
  )));
  assert.deepEqual(keys(restored), keys(base), 'restoring returns exactly the universe that was there');
});

test('any mutation changing a parent: a moved layout takes its members with it', () => {
  const moved = withLayouts(base.windowLayouts.map((layout) => ({ ...layout, parentId: 'g-2' })));
  assert.equal(rowFor(moved, 'layout-member:l-1:m-1').breadcrumb, 'Workspace › Beta › Focus');
});

test('create shortcut: the record is nothing until it is placed', () => {
  const created = withShortcuts([
    ...base.shortcuts,
    { id: 's-2', name: 'Bare record', target: 'C:/bare.exe', placements: [] },
  ]);
  assert.deepEqual(keys(created), keys(base), 'a new record with no placement adds no row');
  const placed = withShortcuts(created.shortcuts.map((shortcut) => (
    shortcut.id === 's-2' ? { ...shortcut, placements: [{ id: 'p-3', parentId: 'g-2', order: 2 }] } : shortcut
  )));
  assert.equal(rowFor(placed, 'shortcut:p-3').name, 'Bare record', 'and it becomes a row the moment it is placed');
});

test('create link: the same creation path, classified by target', () => {
  const created = withShortcuts([
    ...base.shortcuts,
    {
      id: 's-3',
      name: 'Handbook',
      target: 'https://example.com/handbook',
      placements: [{ id: 'p-4', parentId: 'g-1', order: 3 }],
    },
  ]);
  assert.equal(rowFor(created, 'link:p-4').type, 'link');
  assert.equal(rowFor(created, 'link:p-4').breadcrumb, 'Workspace › Alpha');
});

test('delete the shared shortcut record: every placement goes with it', () => {
  const deleted = withShortcuts(base.shortcuts.filter((shortcut) => shortcut.id !== 's-1'));
  assert.equal(rowFor(deleted, 'shortcut:p-1'), null);
  assert.equal(rowFor(deleted, 'shortcut:p-2'), null);
  assert.deepEqual(keys(deleted), ['folder:g-1', 'folder:g-2', 'layout-member:l-1:m-1']);
});

test('target change: the row carries the new target and keeps its occurrence identity', () => {
  const retargeted = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1' ? { ...shortcut, target: 'C:/editor-2.exe' } : shortcut
  )));
  assert.equal(rowFor(retargeted, 'shortcut:p-1').target, 'C:/editor-2.exe');
  assert.deepEqual(keys(retargeted), keys(base), 'a non-web retarget does not change the key');
});

test('create placement: a second occurrence of the same record, with its own breadcrumb', () => {
  const created = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1'
      ? { ...shortcut, placements: [...shortcut.placements, { id: 'p-5', parentId: 'g-2', order: 2 }] }
      : shortcut
  )));
  assert.equal(rowFor(created, 'shortcut:p-5').breadcrumb, 'Workspace › Beta');
  assert.equal(rowFor(created, 'shortcut:p-5').shortcutId, 's-1', 'one record, three occurrences');
});

test('remove placement: the row leaves and the record stays', () => {
  const removed = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1'
      ? { ...shortcut, placements: shortcut.placements.filter((placement) => placement.id !== 'p-2') }
      : shortcut
  )));
  assert.equal(rowFor(removed, 'shortcut:p-2'), null);
  assert.equal(rowFor(removed, 'shortcut:p-1').shortcutId, 's-1');
});

test('bin and restore a placement: only that occurrence disappears', () => {
  const binned = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1'
      ? {
        ...shortcut,
        placements: shortcut.placements.map((placement) => (
          placement.id === 'p-2' ? { ...placement, bin: { at: '2026-09-12T08:00:00+07:00' } } : placement
        )),
      }
      : shortcut
  )));
  assert.equal(rowFor(binned, 'shortcut:p-2'), null);
  assert.equal(rowFor(binned, 'shortcut:p-1').name, 'Editor', 'the sibling occurrence is untouched');
  const restored = withShortcuts(binned.shortcuts.map((shortcut) => (
    shortcut.id === 's-1'
      ? {
        ...shortcut,
        placements: shortcut.placements.map((placement) => (
          placement.id === 'p-2' ? { ...placement, bin: undefined } : placement
        )),
      }
      : shortcut
  )));
  assert.deepEqual(keys(restored), keys(base));
});

test('fork placement: the fork is a new occurrence with a new identity', () => {
  // A fork produces a placement of the same record somewhere else, which is what a new placement id is.
  const forked = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1'
      ? { ...shortcut, placements: [...shortcut.placements, { id: 'p-fork', parentId: 'g-1', order: 9 }] }
      : shortcut
  )));
  assert.equal(rowFor(forked, 'shortcut:p-fork').shortcutId, 's-1');
  assert.notEqual(rowFor(forked, 'shortcut:p-fork').resultKey, rowFor(forked, 'shortcut:p-1').resultKey);
  assert.equal(rowFor(forked, 'shortcut:p-1').breadcrumb, rowFor(forked, 'shortcut:p-fork').breadcrumb);
});

test('collapse placements: the occurrences that were collapsed leave the universe', () => {
  const collapsed = withShortcuts(base.shortcuts.map((shortcut) => (
    shortcut.id === 's-1' ? { ...shortcut, placements: [shortcut.placements[0]] } : shortcut
  )));
  assert.equal(rowFor(collapsed, 'shortcut:p-2'), null);
  assert.deepEqual(keys(collapsed), ['folder:g-1', 'folder:g-2', 'layout-member:l-1:m-1', 'shortcut:p-1']);
});

// The window-layout half of the same question. A layout contributes its members to the universe under a
// breadcrumb that includes the layout name, so every layout mutation is a member-row mutation with one
// extra thing to check: which of the member's identity survives, and which of it is the layout's.
const layout = (overrides = {}) => ({
  id: 'l-1',
  parentId: 'g-1',
  name: 'Focus',
  arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
  ...overrides,
});

test('create layout: its members become searchable, under the layout name', () => {
  const created = withLayouts([...base.windowLayouts, layout({ id: 'l-2', name: 'Second' })]);
  assert.equal(rowFor(created, 'layout-member:l-2:m-1').breadcrumb, 'Workspace › Alpha › Second');
  assert.equal(rowFor(created, 'layout-member:l-1:m-1').breadcrumb, 'Workspace › Alpha › Focus');
});

test('delete layout: its members leave, and the other layout is untouched', () => {
  const two = withLayouts([...base.windowLayouts, layout({ id: 'l-2', name: 'Second' })]);
  const deleted = withLayouts(two.windowLayouts.filter((entry) => entry.id !== 'l-2'));
  assert.equal(rowFor(deleted, 'layout-member:l-2:m-1'), null, 'the deleted layout took its member with it');
  assert.equal(rowFor(deleted, 'layout-member:l-1:m-1').name, 'Chrome', 'and the other layout is untouched');
});

test('bin and restore layout: members disappear and come back exactly', () => {
  const binned = withLayouts(base.windowLayouts.map((entry) => (
    entry.id === 'l-1' ? { ...entry, bin: { at: '2026-09-12T08:00:00+07:00' } } : entry
  )));
  assert.equal(rowFor(binned, 'layout-member:l-1:m-1'), null);
  const restored = withLayouts(binned.windowLayouts.map((entry) => ({ ...entry, bin: undefined })));
  assert.deepEqual(keys(restored), keys(base));
});

test('a member descriptor fingerprint change keeps the occurrence identity', () => {
  const refingerprinted = withLayouts(base.windowLayouts.map((entry) => ({
    ...entry,
    arrangement: {
      members: entry.arrangement.members.map((member) => (
        member.id === 'm-1'
          ? { ...member, descriptor: { ...member.descriptor, executable: 'chrome.exe', fingerprint: 'sha256:abc' } }
          : member
      )),
    },
  })));
  assert.equal(rowFor(refingerprinted, 'layout-member:l-1:m-1').name, 'Chrome', 'the display name is unchanged');
  assert.deepEqual(keys(refingerprinted), keys(base), 'and the occurrence is the same one');
});

test('descriptor replacement keeps the member id and takes the new title', () => {
  const rebound = withLayouts(base.windowLayouts.map((entry) => ({
    ...entry,
    arrangement: {
      members: entry.arrangement.members.map((member) => (
        member.id === 'm-1' ? { ...member, descriptor: { title: 'Firefox' } } : member
      )),
    },
  })));
  assert.equal(rowFor(rebound, 'layout-member:l-1:m-1').name, 'Firefox');
  assert.equal(rowFor(rebound, 'layout-member:l-1:m-1').resultKey, 'layout-member:l-1:m-1', 'rebinding is not a new occurrence');
});
