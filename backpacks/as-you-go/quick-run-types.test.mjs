import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_RUN_FILTERS,
  QUICK_RUN_RESULT_KINDS,
  isQuickRunFilter,
  normaliseFilter,
  nextAvailableFilter,
  nextFilter,
  rowsForFilter,
  resolveFilter,
  chipsFor,
} from './public/app/quick-run/quick-run-types.js';

test('Tab steps only through the chips on offer, in canonical order (AUTHOR ruling, 2026-09-12)', () => {
  const offered = ['All', 'Folders', 'Links'];
  assert.equal(nextAvailableFilter('All', 1, offered), 'Folders');
  assert.equal(
    nextAvailableFilter('Folders', 1, offered),
    'Links',
    'Shortcuts and Layout Items are not offered, so they are skipped rather than landed on',
  );
  assert.equal(nextAvailableFilter('Links', 1, offered), 'All', 'and the step wraps inside the offered set');
  assert.equal(nextAvailableFilter('All', -1, offered), 'Links', 'backwards is the same subset, reversed');
  assert.equal(nextAvailableFilter('Folders', -1, offered), 'All');
  assert.equal(
    nextAvailableFilter('Shortcuts', 1, offered),
    'All',
    'a filter that is not on offer starts from the first offered one instead of guessing',
  );
  assert.equal(nextAvailableFilter('Folders', 1, []), 'Folders', 'nothing on offer means nothing moves');
  assert.equal(nextAvailableFilter('All', 1, ['All']), 'All', 'All alone is a fixed point');
  assert.equal(
    nextAvailableFilter('Folders', 1, ['All']),
    'All',
    'and a filter that is not on offer lands on the only chip there is rather than nowhere',
  );
  assert.equal(
    nextAvailableFilter('Links', 1, ['All', 'Folders', 'Links']),
    'All',
    'the offered set keeps the canonical order whatever order the caller lists it in',
  );
});

const rows = [
  { type: 'folder', name: 'A folder' },
  { type: 'shortcut', name: 'A shortcut' },
  { type: 'link', name: 'A link' },
  { type: 'layout-item', name: 'A layout item' },
];

test('the cycle is the contract order, and it wraps in both directions', () => {
  assert.deepEqual([...QUICK_RUN_FILTERS], ['All', 'Folders', 'Shortcuts', 'Links', 'Layout Items']);
  assert.equal(nextFilter('All'), 'Folders');
  assert.equal(nextFilter('Layout Items'), 'All');
  assert.equal(nextFilter('All', -1), 'Layout Items');
  assert.equal(nextFilter('Folders', -1), 'All');
});

test('an unknown or missing filter is All rather than a hidden result set', () => {
  assert.equal(isQuickRunFilter('Folders'), true);
  assert.equal(isQuickRunFilter('folders'), false);
  assert.equal(normaliseFilter('Nope'), 'All');
  assert.equal(normaliseFilter(undefined), 'All');
  assert.equal(nextFilter('Nope'), 'Folders');
});

test('a filter shows its own kind, and All keeps the ranked order', () => {
  assert.deepEqual(rowsForFilter(rows, 'Links').map((row) => row.name), ['A link']);
  assert.deepEqual(rowsForFilter(rows, 'All').map((row) => row.name), rows.map((row) => row.name));
  assert.equal(rowsForFilter(rows, 'Links').length, 1);
});

test('a filter that loses its matches falls back to All, and says that it did', () => {
  const onlyFolders = [{ type: 'folder', name: 'A folder' }];
  const resolved = resolveFilter(onlyFolders, 'Shortcuts');
  assert.equal(resolved.filter, 'All');
  assert.equal(resolved.fellBack, true);
  assert.deepEqual(resolved.rows.map((row) => row.name), ['A folder']);

  const kept = resolveFilter(onlyFolders, 'Folders');
  assert.equal(kept.filter, 'Folders');
  assert.equal(kept.fellBack, false);
  assert.deepEqual(kept.rows.map((row) => row.name), ['A folder']);
});

test('chips name All plus only the types that have a match, and nothing at all without results', () => {
  assert.deepEqual(chipsFor([]), []);
  assert.deepEqual(chipsFor([{ type: 'link' }]), ['All', 'Links']);
  assert.deepEqual(chipsFor(rows), ['All', 'Folders', 'Shortcuts', 'Links', 'Layout Items']);
  assert.deepEqual(chipsFor([{ type: 'layout-item' }, { type: 'layout-item' }]), ['All', 'Layout Items']);
});

test('the kind vocabulary is the universe the search module must produce', () => {
  assert.deepEqual([...QUICK_RUN_RESULT_KINDS], ['folder', 'shortcut', 'link', 'layout-item']);
});