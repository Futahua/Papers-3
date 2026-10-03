/** Pure, temporary prompt-tree row-selection logic. This module must not
 * touch the DOM, clipboard, store, or host. Every operation returns a new
 * selection object and never mutates its inputs.
 *
 * A selection is: { selectedIds: Set, anchorId: string|null, focusedId:
 * string|null }. */
import { selectedRootIds } from '../../prompt-library-model.js';

export function createTreeSelection() {
  return { selectedIds: new Set(), anchorId: null, focusedId: null };
}

/** Selects only `id`, making it the anchor and focused row. */
export function selectOnly(selection, id) {
  return { selectedIds: new Set([id]), anchorId: id, focusedId: id };
}

/** Toggles `id` in the selection without discarding the rest. */
export function toggleSelected(selection, id) {
  const selectedIds = new Set(selection.selectedIds);
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  return { selectedIds, anchorId: id, focusedId: id };
}

function rangeAround(selection, clickedId, visibleIds, additive) {
  const index = visibleIds.indexOf(clickedId);
  if (index === -1) return null;
  const anchorIndex = visibleIds.indexOf(selection.anchorId);
  if (selection.anchorId == null || anchorIndex === -1) return null;
  const from = Math.min(anchorIndex, index);
  const to = Math.max(anchorIndex, index);
  const range = visibleIds.slice(from, to + 1);
  const selectedIds = additive ? new Set(selection.selectedIds) : new Set();
  for (const id of range) selectedIds.add(id);
  return { selectedIds, anchorId: selection.anchorId, focusedId: clickedId };
}

/** Replaces the selection with the visible range between the anchor and
 * `clickedId`; behaves like an ordinary click when there is no anchor. */
export function selectVisibleRange(selection, clickedId, visibleIds) {
  const range = rangeAround(selection, clickedId, visibleIds, false);
  return range ?? selectOnly(selection, clickedId);
}

/** Adds the visible range between the anchor and `clickedId` to the current
 * selection. */
export function addVisibleRange(selection, clickedId, visibleIds) {
  const range = rangeAround(selection, clickedId, visibleIds, true);
  return range ?? selectOnly(selection, clickedId);
}

export function clearSelection() {
  return createTreeSelection();
}

/** Selects every currently visible row. */
export function selectAllVisible(selection, visibleIds) {
  return {
    selectedIds: new Set(visibleIds),
    anchorId: visibleIds[0] ?? selection.anchorId,
    focusedId: selection.focusedId,
  };
}

/** Visible row ids in depth-first order: a folder's children are only included
 * while the folder is expanded. */
export function visibleDepthFirstIds(nodes, expandedFolderIds) {
  const ids = [];
  const walk = (list) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.type === 'folder' && expandedFolderIds?.has(node.id)) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** Removes selections hidden by a folder collapse and moves focus/anchor to the
 * collapsed folder when they were inside the hidden subtree. */
export function repairSelectionAfterCollapse(selection, collapsedFolderId, visibleIds) {
  const visible = new Set(visibleIds);
  const selectedIds = new Set([...selection.selectedIds].filter((id) => visible.has(id)));
  const anchorId = selection.anchorId != null && visible.has(selection.anchorId)
    ? selection.anchorId
    : collapsedFolderId;
  const focusedId = selection.focusedId != null && visible.has(selection.focusedId)
    ? selection.focusedId
    : collapsedFolderId;
  return { selectedIds, anchorId, focusedId };
}

/** General repair after any tree change: drops ids no longer visible and
 * clears an anchor/focus that disappeared. */
export function repairSelectionAfterTreeChange(selection, visibleIds) {
  const visible = new Set(visibleIds);
  const selectedIds = new Set([...selection.selectedIds].filter((id) => visible.has(id)));
  const anchorId = selection.anchorId != null && visible.has(selection.anchorId)
    ? selection.anchorId
    : null;
  const focusedId = selection.focusedId != null && visible.has(selection.focusedId)
    ? selection.focusedId
    : null;
  return { selectedIds, anchorId, focusedId };
}

export { selectedRootIds };
