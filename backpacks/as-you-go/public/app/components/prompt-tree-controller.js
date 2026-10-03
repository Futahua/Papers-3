/** Owns prompt-tree DOM interaction: row selection, keyboard navigation,
 * double-click, context-menu requests, and pointer drag planning. Translates
 * events into plain intents via injected callbacks; never calls the host,
 * persists state, or owns save/close. Tree traversal comes from the pure
 * prompt-library-model and prompt-tree-selection modules. */
import {
  createTreeSelection,
  selectOnly,
  toggleSelected,
  selectVisibleRange,
  clearSelection,
  selectAllVisible,
  visibleDepthFirstIds,
} from './prompt-tree-selection.js';
import { selectedRootIds } from '../../prompt-library-model.js';
import { HOTKEY_CATALOG, bindingMatchesAction } from '../hotkeys-model.js';

const DRAG_THRESHOLD = 6;

/** True when keyboard focus is inside an editable control, where native text
 * editing (selection, copy/cut/paste, caret movement) must be left alone. */
function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

export function createPromptTreeController({
  document,
  list,
  // Root pointer target: the scrollable area that also contains the blank
  // surface under the last row. Defaults to the row list for callers that do
  // not wrap it.
  viewport = list,
  // Keyboard scope for tree-level shortcuts. Must contain the tree, the add
  // buttons, Close, the context menu, and the editors so Ctrl+Z/Y/C/X/V
  // work from anywhere non-editable in the modal. Defaults to the viewport.
  keyboardTarget = viewport,
  getTree,
  getExpandedFolders,
  isPromptEditorOpen,
  getRenamingFolderId,
  getHotkeyPreferences = () => ({}),
  isKeyboardActive = () => true,
  intents,
}) {
  let abortController = null;
  let selection = createTreeSelection();
  let drag = null;
  let suppressClickOnce = false;

  function visibleIds() {
    return visibleDepthFirstIds(getTree(), getExpandedFolders());
  }

  function rows() {
    return list.querySelectorAll('.prompt-tree-row');
  }

  function rowFor(id) {
    for (const row of rows()) {
      if (row.dataset.nodeId === id) return row;
    }
    return null;
  }

  function getSelection() {
    return selection;
  }

  /** The single path every selection change travels, pointer-driven or
   * programmatic. Notifying by default is what keeps the dialog's destination
   * state from drifting away from the visible selection. */
  function setSelection(next, { notify = true } = {}) {
    selection = next;
    refreshRowStates();
    if (notify) intents.onSelectionChange?.(selection);
  }

  /** Moves real browser focus to a row. Setting tabindex alone does not. */
  function focusRow(id) {
    rowFor(id)?.focus?.({ preventScroll: true });
  }

  /** Focuses the root surface so tree shortcuts keep a live keyboard target
   * when no row is focused. */
  function focusRoot() {
    viewport?.focus?.({ preventScroll: true });
  }

  function refreshRowStates() {
    for (const row of rows()) {
      const id = row.dataset.nodeId;
      const selected = selection.selectedIds.has(id);
      row.classList.toggle('prompt-selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.setAttribute('tabindex', selection.focusedId === id ? '0' : '-1');
    }
  }

  // ------------------------------------------------------------------ clicks

  function onRowClick(event) {
    if (suppressClickOnce) {
      suppressClickOnce = false;
      return;
    }
    if (event.target.closest('.prompt-checkbox')) return;
    if (event.target.closest('.prompt-card-toggle')) {
      const row = event.target.closest('.prompt-tree-row');
      if (row?.dataset.nodeId) intents.onTogglePromptEditor(row.dataset.nodeId);
      return;
    }
    if (event.target.closest('.prompt-folder-toggle')) {
      const row = event.target.closest('.prompt-tree-row');
      if (row?.dataset.nodeId) intents.onToggleFolder(row.dataset.nodeId);
      return;
    }
    if (event.target.closest('.prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;

    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      // Blank root space: clear rows, target root, and take focus so the next
      // Ctrl+V has a live keyboard target. The clipboard is deliberately kept.
      setSelection(clearSelection());
      intents.onBlankClick?.();
      focusRoot();
      return;
    }
    const id = row.dataset.nodeId;
    if (event.ctrlKey || event.metaKey) {
      setSelection(toggleSelected(selection, id));
    } else if (event.shiftKey) {
      setSelection(selectVisibleRange(selection, id, visibleIds()));
    } else {
      setSelection(selectOnly(selection, id));
    }
    focusRow(selection.focusedId ?? id);
  }

  function onRowDoubleClick(event) {
    if (event.target.closest('.prompt-checkbox, .prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    const id = row.dataset.nodeId;
    if (row.dataset.nodeType === 'prompt') intents.onCopyPrompt(id);
    else intents.onToggleFolder(id);
  }

  function onContextMenu(event) {
    event.preventDefault();
    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      // Same root targeting as a blank left-click, then open the root menu.
      setSelection(clearSelection());
      intents.onBlankClick?.();
      focusRoot();
      intents.onOpenRootContextMenu?.(event.clientX, event.clientY);
      return;
    }
    const id = row.dataset.nodeId;
    if (!selection.selectedIds.has(id)) {
      setSelection(selectOnly(selection, id));
    }
    focusRow(id);
    intents.onOpenContextMenu(event.clientX, event.clientY, id);
  }

  // ---------------------------------------------------------------- keyboard

  function onKeyDown(event) {
    if (!isKeyboardActive()) return;
    // Editable controls keep native text editing: never preventDefault here.
    if (isEditableTarget(event.target)) return;
    const accel = event.ctrlKey || event.metaKey;
    const matches = (actionId) => bindingMatchesAction(
      actionId,
      event,
      getHotkeyPreferences(),
      HOTKEY_CATALOG,
    );
    // The context menu owns its own arrow/Enter/Escape navigation. Let its keys
    // through untouched, but still allow the accelerators below to reach the
    // tree — those close the menu first so the operation applies to the tree.
    const inMenu = Boolean(event.target?.closest?.('[role="menu"]'));
    if (inMenu && !accel) return;
    if (inMenu && accel) intents.onCloseContextMenu?.();
    if (matches('copy-prompts.focus-down') || matches('copy-prompts.focus-up')) {
      const ids = visibleIds();
      const index = ids.indexOf(selection.focusedId);
      const target = matches('copy-prompts.focus-down')
        ? ids[Math.min(ids.length - 1, index + 1)]
        : ids[Math.max(0, index - 1)];
      if (!target) return;
      event.preventDefault();
      if (event.shiftKey) {
        const range = selectVisibleRange({ ...selection, focusedId: selection.focusedId }, target, ids);
        selection = { ...range, focusedId: target };
        refreshRowStates();
      } else {
        selection = { ...selection, focusedId: target };
        refreshRowStates();
      }
      focusRow(target);
      return;
    }
    if (matches('copy-prompts.navigate-right') || matches('copy-prompts.navigate-left')) {
      const id = selection.focusedId;
      if (!id) return;
      const node = findPromptNodeAt(getTree(), id);
      if (!node) return;
      event.preventDefault();
      if (matches('copy-prompts.navigate-right')) {
        if (node.type === 'folder') {
          if (getExpandedFolders().has(id)) {
            const ids = visibleIds();
            const childIndex = ids.indexOf(id) + 1;
            const firstChild = ids[childIndex];
            if (firstChild) {
              selection = { ...selection, focusedId: firstChild };
              refreshRowStates();
              focusRow(firstChild);
            }
          } else {
            intents.onExpandFolder(id);
          }
        } else {
          intents.onOpenPrompt(id);
        }
      } else if (node.type === 'folder') {
        if (getExpandedFolders().has(id)) {
          intents.onCollapseFolder(id);
        } else {
          moveFocusToVisibleParent(id);
        }
      } else if (isPromptEditorOpen(id)) {
        intents.onCollapsePromptEditor(id);
      } else {
        moveFocusToVisibleParent(id);
      }
      return;
    }
    if (matches('copy-prompts.open-or-toggle')) {
      const id = selection.focusedId;
      if (!id) return;
      const node = findPromptNodeAt(getTree(), id);
      if (!node) return;
      event.preventDefault();
      if (node.type === 'prompt') intents.onOpenPrompt(id);
      else intents.onToggleFolder(id);
      return;
    }
    if (matches('copy-prompts.edit-or-rename')) {
      event.preventDefault();
      const id = selection.focusedId;
      if (id) {
        const node = findPromptNodeAt(getTree(), id);
        if (node.type === 'folder') intents.onBeginRename(id);
        else intents.onOpenPrompt(id);
      }
      return;
    }
    if (matches('copy-prompts.delete')) {
      if (selection.selectedIds.size === 0) return;
      event.preventDefault();
      intents.onDelete([...selectedRootIds(getTree(), [...selection.selectedIds])]);
      return;
    }
    if (matches('copy-prompts.redo')) {
      event.preventDefault();
      intents.onRedo();
      return;
    }
    if (matches('copy-prompts.undo')) {
      event.preventDefault();
      intents.onUndo();
      return;
    }
    if (matches('copy-prompts.copy')) {
      event.preventDefault();
      if (selection.selectedIds.size > 0) {
        intents.onCopyNodes([...selectedRootIds(getTree(), [...selection.selectedIds])]);
      }
      return;
    }
    if (matches('copy-prompts.cut')) {
      event.preventDefault();
      if (selection.selectedIds.size > 0) {
        intents.onCutNodes([...selectedRootIds(getTree(), [...selection.selectedIds])]);
      }
      return;
    }
    if (matches('copy-prompts.paste')) {
      event.preventDefault();
      intents.onPaste();
      return;
    }
    if (matches('copy-prompts.select-all')) {
      event.preventDefault();
      setSelection(selectAllVisible(selection, visibleIds()));
      return;
    }
    if (matches('copy-prompts.escape')) {
      intents.onEscape?.();
    }
  }

  function findPromptNodeAt(tree, id) {
    for (const node of tree) {
      if (node.id === id) return node;
      if (node.type === 'folder') {
        const found = findPromptNodeAt(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function moveFocusToVisibleParent(id) {
    const row = rowFor(id);
    const parentId = row?.dataset.parentId;
    if (parentId) {
      selection = { ...selection, focusedId: parentId };
      refreshRowStates();
      focusRow(parentId);
    }
  }

  // ------------------------------------------------------------------- drag

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.prompt-checkbox, .prompt-card-toggle, .prompt-folder-toggle, .prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    // Record a possible drag candidate only. Ordinary click selection is left
    // to the click handler so Ctrl/Meta and Shift selection keep their anchors.
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rowId: row.dataset.nodeId,
      rowSelected: selection.selectedIds.has(row.dataset.nodeId),
      moved: false,
      draggedIds: null,
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      // Start dragging exactly once: an already-selected row drags the whole
      // selection; an unselected row is selected first and then dragged.
      if (!drag.rowSelected) {
        setSelection(selectOnly(selection, drag.rowId));
      }
      drag.draggedIds = [...selectedRootIds(getTree(), [...selection.selectedIds])];
      setDraggingVisual(drag.draggedIds);
      intents.onDragStart?.(drag.draggedIds);
    }
    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      // Anywhere inside the viewport but not on a row — including the blank
      // surface below the last top-level row — drops at root.
      if (viewport.contains?.(event.target) ?? event.target.closest('.prompt-tree-viewport, .prompt-tree-list')) {
        setRootDrop(true);
      } else {
        clearDropIndicators();
      }
      return;
    }
    setRootDrop(false);
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const plan = resolveDropPlan(row, event.clientY - rect.top, rect.height);
    clearDropIndicators();
    if (!plan) return;
    if (plan.zone === 'before') row.classList.add('prompt-drop-before');
    else if (plan.zone === 'inside') row.classList.add('prompt-drop-inside');
    else row.classList.add('prompt-drop-after');
    row.dataset.dropParent = plan.destinationParentId ?? '';
    row.dataset.dropBefore = plan.beforeId ?? '';
  }

  function resolveDropPlan(row, y, height) {
    const targetType = row.dataset.nodeType;
    const parentId = row.dataset.parentId || null;
    const nextId = row.dataset.nextId || null;
    const targetId = row.dataset.nodeId;
    if (targetType === 'folder') {
      if (y < height * 0.25) return { zone: 'before', destinationParentId: parentId, beforeId: targetId };
      if (y > height * 0.75) return { zone: 'after', destinationParentId: parentId, beforeId: nextId };
      return { zone: 'inside', destinationParentId: targetId, beforeId: null };
    }
    return y < height / 2
      ? { zone: 'before', destinationParentId: parentId, beforeId: targetId }
      : { zone: 'after', destinationParentId: parentId, beforeId: nextId };
  }

  function clearDropIndicators() {
    for (const row of rows()) {
      row.classList.remove('prompt-drop-before', 'prompt-drop-inside', 'prompt-drop-after');
      delete row.dataset.dropParent;
      delete row.dataset.dropBefore;
    }
    setRootDrop(false);
  }

  function setRootDrop(active) {
    viewport.classList.toggle('prompt-drop-root', active);
    if (drag) drag.rootDrop = active;
  }

  function setDraggingVisual(ids) {
    const set = new Set(ids);
    for (const row of rows()) {
      row.classList.toggle('prompt-dragging', set.has(row.dataset.nodeId));
    }
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasMoved = drag.moved;
    const draggedIds = drag.draggedIds ?? [];
    const row = event.target.closest('.prompt-tree-row');
    let plan = null;
    if (drag.rootDrop) {
      plan = { destinationParentId: null, beforeId: null };
    } else if (row) {
      const destinationParentId = row.dataset.dropParent === '' ? null : row.dataset.dropParent;
      const beforeId = row.dataset.dropBefore === '' ? null : row.dataset.dropBefore;
      plan = { destinationParentId, beforeId };
    }
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
    intents.onDragEnd?.(draggedIds);
    if (wasMoved && plan) {
      intents.onMove?.(draggedIds, plan.destinationParentId, plan.beforeId);
      // A real drag suppresses the synthetic click that follows pointerup so
      // it cannot also toggle selection.
      suppressClickOnce = true;
    }
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
    intents.onDragEnd?.([]);
  }

  function cancelDrag() {
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
  }

  // ------------------------------------------------------------------- mount

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    // Pointer interaction is bound to the viewport so blank space under the
    // last row counts as the root target.
    viewport.addEventListener('click', onRowClick, { signal });
    viewport.addEventListener('dblclick', onRowDoubleClick, { signal });
    viewport.addEventListener('contextmenu', onContextMenu, { signal });
    viewport.addEventListener('pointerdown', onPointerDown, { signal });
    viewport.addEventListener('pointermove', onPointerMove, { signal });
    viewport.addEventListener('pointerup', onPointerUp, { signal });
    viewport.addEventListener('pointercancel', onPointerCancel, { signal });
    // Keyboard is bound to the whole modal so tree shortcuts work from the add
    // buttons, Close, and blank dialog background — not just the rows.
    if (keyboardTarget !== viewport) {
      keyboardTarget.addEventListener('keydown', onKeyDown, { signal });
    } else {
      viewport.addEventListener('keydown', onKeyDown, { signal });
    }
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    cancelDrag();
  }

  return { mount, destroy, getSelection, setSelection, refreshRowStates, cancelDrag, focusRow, focusRoot };
}
