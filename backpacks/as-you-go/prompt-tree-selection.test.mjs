import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTreeSelection,
  selectOnly,
  toggleSelected,
  selectVisibleRange,
  addVisibleRange,
  clearSelection,
  selectAllVisible,
  visibleDepthFirstIds,
  repairSelectionAfterCollapse,
  repairSelectionAfterTreeChange,
  selectedRootIds,
} from './public/app/components/prompt-tree-selection.js';

const nodes = () => [
  { id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: false, children: [
    { id: 'prompt-a', type: 'prompt', title: 'A', text: 'x', includeInBatch: true },
    { id: 'folder-inner', type: 'folder', title: 'Inner', includeAll: false, children: [
      { id: 'prompt-b', type: 'prompt', title: 'B', text: 'y', includeInBatch: false },
    ] },
  ] },
  { id: 'prompt-root', type: 'prompt', title: 'Root', text: 'z', includeInBatch: true },
];

test('selectOnly selects one row and anchors it', () => {
  const next = selectOnly(createTreeSelection(), 'prompt-a');
  assert.deepEqual([...next.selectedIds], ['prompt-a']);
  assert.equal(next.anchorId, 'prompt-a');
  assert.equal(next.focusedId, 'prompt-a');
});

test('toggleSelected toggles without clearing the rest', () => {
  let s = selectOnly(createTreeSelection(), 'prompt-a');
  s = toggleSelected(s, 'prompt-root');
  assert.deepEqual([...s.selectedIds].sort(), ['prompt-a', 'prompt-root']);
  s = toggleSelected(s, 'prompt-a');
  assert.deepEqual([...s.selectedIds], ['prompt-root']);
});

test('selectVisibleRange uses the visible contiguous range', () => {
  const visible = visibleDepthFirstIds(nodes(), new Set(['folder-dev', 'folder-inner']));
  assert.deepEqual(visible, ['folder-dev', 'prompt-a', 'folder-inner', 'prompt-b', 'prompt-root']);
  let s = selectOnly(createTreeSelection(), 'prompt-a');
  s = selectVisibleRange(s, 'prompt-root', visible);
  assert.deepEqual([...s.selectedIds], ['prompt-a', 'folder-inner', 'prompt-b', 'prompt-root']);
  assert.equal(s.anchorId, 'prompt-a');
});

test('selectVisibleRange behaves like a click without a valid anchor', () => {
  const s = selectVisibleRange(createTreeSelection(), 'prompt-root', visibleDepthFirstIds(nodes(), new Set()));
  assert.deepEqual([...s.selectedIds], ['prompt-root']);
});

test('addVisibleRange adds the range to the existing selection', () => {
  const visible = visibleDepthFirstIds(nodes(), new Set(['folder-dev']));
  let s = selectOnly(createTreeSelection(), 'folder-dev');
  s = addVisibleRange(s, 'prompt-root', visible);
  assert.deepEqual([...s.selectedIds].sort(), ['folder-dev', 'folder-inner', 'prompt-a', 'prompt-root']);
});

test('collapsed descendants are absent from the visible order', () => {
  // A collapsed folder's own row stays visible; only its children are hidden.
  const visible = visibleDepthFirstIds(nodes(), new Set(['folder-dev']));
  assert.deepEqual(visible, ['folder-dev', 'prompt-a', 'folder-inner', 'prompt-root']);
  const collapsed = visibleDepthFirstIds(nodes(), new Set());
  assert.deepEqual(collapsed, ['folder-dev', 'prompt-root']);
});

test('selectAllVisible selects every visible row only', () => {
  const visible = visibleDepthFirstIds(nodes(), new Set());
  const s = selectAllVisible(createTreeSelection(), visible);
  assert.deepEqual([...s.selectedIds], ['folder-dev', 'prompt-root']);
});

test('repairSelectionAfterCollapse removes hidden ids and repairs focus', () => {
  const visible = visibleDepthFirstIds(nodes(), new Set(['folder-dev']));
  let s = selectOnly(createTreeSelection(), 'prompt-b');
  s = { ...s, selectedIds: new Set(['prompt-b', 'folder-dev']), anchorId: 'prompt-b' };
  const repaired = repairSelectionAfterCollapse(s, 'folder-inner', visible);
  assert.deepEqual([...repaired.selectedIds], ['folder-dev']);
  assert.equal(repaired.focusedId, 'folder-inner');
  assert.equal(repaired.anchorId, 'folder-inner');
});

test('repairSelectionAfterTreeChange drops missing ids', () => {
  const s = {
    selectedIds: new Set(['prompt-a', 'gone']),
    anchorId: 'gone',
    focusedId: 'prompt-a',
  };
  const repaired = repairSelectionAfterTreeChange(s, ['prompt-a']);
  assert.deepEqual([...repaired.selectedIds], ['prompt-a']);
  assert.equal(repaired.anchorId, null);
  assert.equal(repaired.focusedId, 'prompt-a');
});

test('operations never mutate their inputs', () => {
  const s = selectOnly(createTreeSelection(), 'prompt-a');
  const before = new Set(s.selectedIds);
  toggleSelected(s, 'prompt-root');
  selectVisibleRange(s, 'prompt-root', ['prompt-a', 'prompt-root']);
  assert.deepEqual(s.selectedIds, before);
});

test('selectedRootIds reduces to roots in depth-first order', () => {
  assert.deepEqual(selectedRootIds(nodes(), ['prompt-a', 'folder-dev']), ['folder-dev']);
  assert.deepEqual(selectedRootIds(nodes(), ['prompt-a', 'prompt-root']), ['prompt-a', 'prompt-root']);
});

test('clearSelection empties the selection', () => {
  const cleared = clearSelection();
  assert.equal(cleared.selectedIds.size, 0);
  assert.equal(cleared.anchorId, null);
  assert.equal(cleared.focusedId, null);
});
