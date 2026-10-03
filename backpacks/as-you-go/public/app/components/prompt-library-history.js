/** Pure, dialog-local undo/redo for the prompt-library draft. This module must
 * not access the DOM, store, host, clipboard, context menus, or persistence.
 *
 * A history object is:
 *   { past: [trees], present: tree, future: [trees], transaction: {baseline,
 *     label} | null, limit: number, lastLabel: string|null }
 *
 * Trees are the immutable arrays produced by prompt-library-model helpers, so
 * reference equality distinguishes "no change" from a real edit. Every
 * operation returns a new history object and never mutates its inputs. */

const DEFAULT_LIMIT = 100;

export function createPromptLibraryHistory(initialLibrary, options = {}) {
  return {
    past: [],
    present: initialLibrary,
    future: [],
    transaction: null,
    limit: typeof options.limit === 'number' ? options.limit : DEFAULT_LIMIT,
    lastLabel: null,
  };
}

export function canUndoPromptLibrary(history) {
  return history.past.length > 0;
}

export function canRedoPromptLibrary(history) {
  return history.future.length > 0;
}

/**
 * Records a completed draft-data mutation. No-op trees (same reference as
 * present) create no entry. Pushes present onto past (bounded by the limit),
 * sets present to next, and clears future. Any active edit transaction is
 * discarded. `label` is used for local undo/redo feedback.
 */
export function recordPromptLibraryChange(history, nextLibrary, label) {
  if (nextLibrary === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > history.limit) past.shift();
  return {
    ...history,
    past,
    present: nextLibrary,
    future: [],
    transaction: null,
    lastLabel: label ?? null,
  };
}

/** Replaces present without creating a history entry (used while an edit
 * transaction is active). */
export function replacePromptLibraryPresent(history, nextLibrary) {
  return { ...history, present: nextLibrary };
}

/** Moves one step back: present goes to future, newest past entry becomes
 * present. No-op when there is nothing to undo. */
export function undoPromptLibrary(history) {
  if (history.past.length === 0) return history;
  const past = history.past.slice();
  const previous = past.pop();
  return {
    ...history,
    past,
    present: previous,
    future: [history.present, ...history.future],
    transaction: null,
  };
}

/** Moves one step forward: present goes to past, newest future entry becomes
 * present. No-op when there is nothing to redo. */
export function redoPromptLibrary(history) {
  if (history.future.length === 0) return history;
  const future = history.future.slice();
  const next = future.shift();
  return {
    ...history,
    past: [...history.past, history.present],
    present: next,
    future,
    transaction: null,
  };
}

/** Starts a text-editing transaction, capturing the current tree as the edit
 * baseline. An existing transaction is left untouched so repeated begin calls
 * during one editing session do not re-baseline. */
export function beginPromptLibraryTransaction(history, label) {
  if (history.transaction) return history;
  return { ...history, transaction: { baseline: history.present, label: label ?? null } };
}

/** Ends the editing transaction. When the final tree differs from the baseline
 * a single undo entry (the baseline) is recorded and redo is cleared; otherwise
 * no entry is created and redo is untouched. */
export function commitPromptLibraryTransaction(history, finalLibrary) {
  if (!history.transaction) return history;
  const baseline = history.transaction.baseline;
  const label = history.transaction.label;
  const present = finalLibrary === undefined ? history.present : finalLibrary;
  const next = { ...history, present, transaction: null };
  if (present === baseline) return next;
  const past = [...history.past, baseline];
  if (past.length > history.limit) past.shift();
  return { ...next, past, future: [], lastLabel: label };
}

/** Cancels the editing transaction, restoring the baseline tree and creating no
 * history entry. */
export function cancelPromptLibraryTransaction(history) {
  if (!history.transaction) return history;
  return { ...history, present: history.transaction.baseline, transaction: null };
}
