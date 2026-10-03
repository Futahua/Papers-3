import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID, itemsIn } from './public/workspace-model-20260730b.js';
import { quickRunRows } from './public/app/quick-run/quick-run-search.js';
import { DESCRIPTOR_IDENTITY_FIELDS, descriptorIdentityKey } from './public/app/quick-run/quick-run-types.js';

const state = {
  groups: [
    { id: 'g-root', parentId: ROOT_ID, name: 'Workspace' },
    { id: 'g-a', parentId: 'g-root', name: 'Alpha' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [
        { id: 'p-1', parentId: 'g-a', order: 1 },
        { id: 'p-2', parentId: 'g-root', order: 2 },
        { id: 'p-3', parentId: 'g-a', order: 3, bin: true },
      ],
    },
    {
      id: 's-2',
      name: 'Local note',
      target: '/tmp/note.md',
      placements: [{ id: 'p-4', parentId: 'g-root', order: 4 }],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-a',
      name: 'Focus',
      arrangement: {
        members: [
          { id: 'm-1', descriptor: { title: 'Chrome' } },
          { id: 'm-2', descriptor: { title: 'Obsidian' } },
        ],
      },
    },
  ],
};

test('the universe is one row per active folder, placement and layout member', () => {
  const rows = quickRunRows(state);
  const keys = rows.map((row) => row.resultKey);
  assert.equal(new Set(keys).size, keys.length, 'every row carries a distinct stable key');
  assert.deepEqual(
    rows.filter((row) => row.type === 'folder').map((row) => row.name),
    ['Workspace', 'Alpha'],
  );
  // One row per placement, and the binned placement is not in the universe at all.
  const placements = rows.filter((row) => row.placementId).map((row) => row.placementId).sort();
  assert.deepEqual(placements, ['p-1', 'p-2', 'p-4']);
  // One row per member occurrence, named from the persisted descriptor.
  const members = rows.filter((row) => row.type === 'layout-item');
  assert.deepEqual(members.map((row) => row.name), ['Chrome', 'Obsidian']);
  assert.deepEqual(members.map((row) => row.resultKey), ['layout-member:l-1:m-1', 'layout-member:l-1:m-2']);
});

test('a link is a shortcut whose target the model classifies, not a second index', () => {
  const rows = quickRunRows(state);
  const docs = rows.filter((row) => row.shortcutId === 's-1');
  assert.ok(docs.length > 0);
  assert.deepEqual([...new Set(docs.map((row) => row.type))], ['link']);
  const local = rows.filter((row) => row.shortcutId === 's-2');
  assert.deepEqual([...new Set(local.map((row) => row.type))], ['shortcut']);
});

test('one shared shortcut in two folders is two rows that differ only by breadcrumb and key', () => {
  const rows = quickRunRows(state);
  const docs = rows.filter((row) => row.shortcutId === 's-1').sort((a, b) => a.resultKey.localeCompare(b.resultKey));
  assert.deepEqual(docs.map((row) => row.name), ['Docs', 'Docs']);
  assert.deepEqual(docs.map((row) => row.breadcrumb), ['Workspace › Alpha', 'Workspace']);
  assert.notEqual(docs[0].resultKey, docs[1].resultKey);
});

test('a layout member carries its containing layout in the breadcrumb', () => {
  const rows = quickRunRows(state);
  const member = rows.find((row) => row.resultKey === 'layout-member:l-1:m-1');
  assert.equal(member.breadcrumb, 'Workspace › Alpha › Focus');
  assert.equal(member.layoutId, 'l-1');
  assert.equal(member.memberId, 'm-1');
});

test('every row carries the folder that holds it, which is the only thing a reveal may navigate to', () => {
  const rows = quickRunRows(state);
  const rowFor = (key) => rows.find((row) => row.resultKey === key);
  assert.equal(rowFor('folder:g-a').containerId, 'g-root', 'a folder lives in its parent folder');
  assert.equal(rowFor('folder:g-root').containerId, 'root', 'a top-level folder lives at the root itself');
  assert.equal(rowFor('link:p-1').containerId, 'g-a', 'a placement lives in the folder it was placed in');
  assert.equal(rowFor('link:p-2').containerId, 'g-root', 'including one placed in the top-level folder');
  assert.equal(rowFor('shortcut:p-4').containerId, 'g-root', 'and so does a shortcut');
  // A layout member's container is the folder holding its layout - never the layout itself, whose id the
  // workspace's open-selection command does not accept as a destination.
  assert.equal(rowFor('layout-member:l-1:m-1').containerId, 'g-a');
  assert.notEqual(rowFor('layout-member:l-1:m-1').containerId, 'l-1');
  // Every row answers, so no caller has to decide what a missing container means.
  for (const row of rows) {
    assert.equal(typeof row.containerId, 'string', `${row.resultKey} carries a container id`);
    assert.notEqual(row.containerId, '');
  }
});

test('a row carries its item\'s own icon, passed through, and nothing when the item has none', () => {
  const withIcons = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace', icon: 'data:image/png;base64,ROOT' }],
    shortcuts: [
      { id: 's-art', name: 'Art', target: 'C:/art.exe', icon: 'data:image/webp;base64,ART', placements: [{ id: 'p-art', parentId: 'g-root', order: 1 }] },
      { id: 's-plain', name: 'Plain', target: 'C:/plain.exe', placements: [{ id: 'p-plain', parentId: 'g-root', order: 2 }] },
      { id: 's-broken', name: 'Broken', target: 'C:/broken.exe', icon: 7, placements: [{ id: 'p-broken', parentId: 'g-root', order: 3 }] },
    ],
    windowLayouts: [{
      id: 'l-1',
      parentId: 'g-root',
      name: 'Desk',
      arrangement: { version: 2, members: [{ id: 'm-1', descriptor: { version: 1, title: 'Console', executableFingerprint: 'a'.repeat(64) } }] },
    }],
  };
  const rows = quickRunRows(withIcons);
  const rowFor = (key) => rows.find((row) => row.resultKey === key);

  assert.equal(rowFor('folder:g-root').icon, 'data:image/png;base64,ROOT', 'a folder carries its own icon');
  assert.equal(rowFor('shortcut:p-art').icon, 'data:image/webp;base64,ART', 'the exact string, undecoded');
  assert.equal(rowFor('shortcut:p-plain').icon, null, 'an item with no icon carries null, not another item\'s');
  assert.equal(rowFor('shortcut:p-broken').icon, null, 'a value that is not a string is nothing to carry');
  assert.equal(rowFor('layout-member:l-1:m-1').icon, null, 'a layout member has no icon of its own (024)');
});

test('a layout row carries the identity its persisted descriptor declares', () => {
  const rows = quickRunRows(state);
  const member = rows.find((row) => row.resultKey === 'layout-member:l-1:m-1');
  assert.equal(member.descriptorKey, 'Chrome', 'the title alone, because that is all this member declares');
  // The vocabulary is the model's persisted pair, in the model's order, and it is shared rather than copied.
  assert.deepEqual([...DESCRIPTOR_IDENTITY_FIELDS], ['title', 'executableFingerprint']);
  assert.equal(Object.isFrozen(DESCRIPTOR_IDENTITY_FIELDS), true);
  assert.equal(
    descriptorIdentityKey({ title: 'Chrome', executableFingerprint: 'abc' }),
    'Chrome\u0000abc',
    'both declared fields make the key, so a fingerprint change is not the same identity',
  );
  assert.equal(descriptorIdentityKey({}), '', 'nothing declared is nothing to compare');
  assert.equal(descriptorIdentityKey(null), '');
  // Ordinary rows have no descriptor to be identified by.
  assert.equal(rows.find((row) => row.resultKey === 'folder:g-a').descriptorKey, undefined);
});

test('the walk reads the model seam rather than a private one', () => {
  // The rows come from itemsIn()'s emitted shape: a shortcut entry carries id = placement id.
  const emitted = itemsIn(state, 'g-a').filter((item) => item.kind === 'shortcut');
  assert.deepEqual(emitted.map((item) => item.id), ['p-1']);
  assert.equal(emitted[0].shortcutId, 's-1');
  assert.equal(emitted[0].placements, undefined);
});