// The searchable universe: what Quick Run may show, and what it may never show.
//
// Section 2.1 fixes the sources - active folders, active shortcut placements, layout members - and
// section 6 lists what v1 must not search: whole window layouts, prompts, bin contents (including items
// under a binned folder, binned placements, and binned layouts with their members), and Sets. The Sets
// exclusion is the recorded product decision, not an oversight: the creator settled it on 2026-09-08 -
// "Sets are OUT for v1, keeping exactly the five chips All, Folders, Shortcuts, Links, Layout Items" -
// so there is nothing pending about it.
//
// Folders and placements arrive through the model's itemsIn, which already applies the model's active
// rule; layout members are reached through their layout, so that loop has to ask the same rule itself.
// These tests hold both halves: the exclusions, and that the exclusions are not vacuous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quickRunRows } from './public/app/quick-run/quick-run-search.js';

const state = {
  groups: [
    { id: 'root', parentId: null, name: 'Workspace' },
    { id: 'g-1', parentId: 'root', name: 'Active folder' },
    { id: 'g-2', parentId: 'root', name: 'Second folder' },
    { id: 'g-3', parentId: 'root', name: 'Third folder' },
    { id: 'g-bin', parentId: 'root', name: 'Binned folder', bin: { at: '2026-09-01T00:00:00+07:00' } },
    { id: 'g-under-bin', parentId: 'g-bin', name: 'Inside the bin' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Editor',
      target: 'C:/Program Files/Editor/editor.exe',
      placements: [{ id: 'p-1', parentId: 'g-1', order: 1 }],
    },
    {
      id: 's-2',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [{ id: 'p-2', parentId: 'g-1', order: 2 }],
    },
    {
      id: 's-3',
      name: 'Three places',
      target: 'C:/three.exe',
      placements: [
        { id: 'p-3a', parentId: 'g-1', order: 5 },
        { id: 'p-3b', parentId: 'g-2', order: 1 },
        { id: 'p-3c', parentId: 'g-3', order: 1 },
      ],
    },
    {
      id: 's-4',
      name: 'Plain',
      target: 'http://example.com/plain',
      placements: [{ id: 'p-4', parentId: 'g-1', order: 6 }],
    },
    {
      id: 's-bin',
      name: 'Binned shortcut',
      target: 'C:/binned.exe',
      placements: [
        { id: 'p-bin', parentId: 'g-1', order: 3, bin: { at: '2026-09-01T00:00:00+07:00' } },
        { id: 'p-in-bin', parentId: 'g-bin', order: 4 },
      ],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-1',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
    },
    {
      id: 'l-2',
      parentId: 'g-1',
      name: 'Second layout',
      arrangement: { members: [{ id: 'm-dup', descriptor: { title: 'Chrome' } }] },
    },
    {
      id: 'l-bin',
      parentId: 'g-1',
      name: 'Binned layout',
      bin: { at: '2026-09-01T00:00:00+07:00' },
      arrangement: { members: [{ id: 'm-2', descriptor: { title: 'Binned window' } }] },
    },
    {
      id: 'l-under-bin',
      parentId: 'g-bin',
      name: 'Layout under the bin',
      arrangement: { members: [{ id: 'm-3', descriptor: { title: 'Hidden window' } }] },
    },
  ],
  // Not sources at all, and present here so their absence is asserted rather than assumed.
  promptLibrary: [{ id: 'pr-1', name: 'A prompt' }],
  sets: [{ id: 'set-1', name: 'A set' }],
};

const rows = quickRunRows(state);
const names = rows.map((row) => row.name);
const keys = rows.map((row) => row.resultKey);
const rowFor = (key) => rows.find((row) => row.resultKey === key);

test('the active tree is searched: folders, placements and layout members (section 2.1)', () => {
  assert.deepEqual(
    [...names].sort(),
    [
      'Active folder',
      'Chrome',
      'Chrome',
      'Docs',
      'Editor',
      'Plain',
      'Second folder',
      'Third folder',
      'Three places',
      'Three places',
      'Three places',
    ].sort(),
  );
  assert.deepEqual(
    [...new Set(rows.map((row) => row.type))].sort(),
    ['folder', 'layout-item', 'link', 'shortcut'],
  );
  assert.deepEqual(
    [...keys].sort(),
    [
      'folder:g-1',
      'folder:g-2',
      'folder:g-3',
      'layout-member:l-1:m-1',
      'layout-member:l-2:m-dup',
      'link:p-2',
      'link:p-4',
      'shortcut:p-1',
      'shortcut:p-3a',
      'shortcut:p-3b',
      'shortcut:p-3c',
    ],
  );
});

test('a shortcut with three placements is three results with independent breadcrumbs (section 0.3)', () => {
  const placements = ['shortcut:p-3a', 'shortcut:p-3b', 'shortcut:p-3c'].map(rowFor);
  assert.deepEqual(placements.map((row) => row.name), ['Three places', 'Three places', 'Three places']);
  assert.deepEqual(
    placements.map((row) => row.breadcrumb),
    ['Workspace › Active folder', 'Workspace › Second folder', 'Workspace › Third folder'],
  );
  assert.equal(new Set(placements.map((row) => row.shortcutId)).size, 1, 'one shared record, three occurrences');
});

test('http and https are Links, and anything else is a Shortcut (section 2.1)', () => {
  assert.equal(rowFor('link:p-4').type, 'link', 'http is a web target like https');
  assert.equal(rowFor('link:p-2').type, 'link');
  assert.equal(rowFor('shortcut:p-1').type, 'shortcut', 'a filesystem target is not a link');
});

test('the same descriptor in two layouts is two results, one per occurrence (section 0.3)', () => {
  const chrome = rows.filter((row) => row.name === 'Chrome');
  assert.equal(chrome.length, 2);
  assert.deepEqual(
    chrome.map((row) => row.resultKey).sort(),
    ['layout-member:l-1:m-1', 'layout-member:l-2:m-dup'],
  );
  assert.deepEqual(
    chrome.map((row) => row.breadcrumb).sort(),
    ['Workspace › Active folder › Focus', 'Workspace › Active folder › Second layout'],
  );
});

test('the bin is not searched: a binned folder takes its descendants with it (section 6)', () => {
  assert.equal(keys.includes('folder:g-bin'), false);
  assert.equal(keys.includes('folder:g-under-bin'), false);
  assert.equal(names.includes('Inside the bin'), false);
  assert.equal(keys.includes('shortcut:p-in-bin'), false, 'a placement under a binned folder goes with it');
});

test('a binned placement is not searched, and neither is its shortcut (section 6)', () => {
  assert.equal(keys.includes('shortcut:p-bin'), false);
  assert.equal(names.includes('Binned shortcut'), false);
});

test('a binned layout takes its members with it, however it was binned (section 6)', () => {
  assert.equal(keys.includes('layout-member:l-bin:m-2'), false);
  assert.equal(names.includes('Binned window'), false);
  assert.equal(
    keys.includes('layout-member:l-under-bin:m-3'),
    false,
    'a layout under a binned folder is out of the universe just as a binned one is',
  );
  assert.equal(names.includes('Hidden window'), false);
});

test('a layout is not itself a result, and prompts and Sets are not sources at all (section 6)', () => {
  for (const layoutName of ['Focus', 'Second layout', 'Binned layout', 'Layout under the bin']) {
    assert.equal(names.includes(layoutName), false, 'the layout is the breadcrumb, never a row');
  }
  assert.equal(names.includes('A prompt'), false);
  assert.equal(names.includes('A set'), false, 'Sets are out for v1 by the recorded decision');
  for (const row of rows) {
    assert.equal(['layout', 'prompt', 'set', 'bin'].includes(row.type), false);
  }
});
