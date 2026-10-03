/** The Ctrl+G membership picker.
 *
 * A dialog-free mode over the canvas: while it is open, clicking any item
 * toggles the set that item belongs to, so sets are chosen by pointing at
 * their contents rather than by reading a list of names. Enter commits the
 * chosen sets onto the selection that opened the mode; Escape abandons it.
 *
 * The mode owns only transient picking state — which sets are currently
 * chosen, and which items it opened over. Deciding what membership results
 * belongs to the pure model, and persisting it to the command layer. */
import { setsContaining, membershipMatrix } from '../../sets-model.js';

/** What clicking a set does to its state.
 *
 * 'mixed' can be left alone but never chosen: the user cannot ask for "some
 * of these", only leave a partial set as it was. Clicking a mixed set
 * therefore resolves it — to 'all' first, since including is the likelier
 * intent when you point at a set. */
function nextState(state) {
  if (state === 'all') return 'none';
  return 'all';
}

export function createSetMembershipMode({
  getSets,
  getSelectedIds,
  shareSelectionWithSets,
  render,
  setStatus,
  ancestorsOf = null,
}) {
  let active = false;
  let itemIds = [];
  // The membership each set had when the mode opened, so an untouched set can
  // be told apart from one the user deliberately emptied.
  let original = new Map();
  let current = new Map();

  function isActive() {
    return active;
  }

  /** Sets currently wholly chosen, for the renderer to light up. */
  function chosenSetIds() {
    return [...current].filter(([, state]) => state === 'all').map(([setId]) => setId);
  }

  /** Sets only some of the subjects belong to, so the renderer can show them
   * as partial rather than pretending they are in or out. */
  function mixedSetIds() {
    return [...current].filter(([, state]) => state === 'mixed').map(([setId]) => setId);
  }

  /** The items the mode is editing, so the renderer can keep showing them as
   * the subjects while the selection itself is not being changed. */
  function subjectIds() {
    return [...itemIds];
  }

  /** Opens the mode over the current selection, capturing what each set's
   * membership is right now.
   *
   * The capture is the point: it previously pre-chose the union of the
   * selection's sets, which reads as "these are your sets" but means that
   * confirming immediately adds every item to every set any one of them was
   * in. Recording the real per-set state instead lets an untouched set be
   * left alone. */
  function begin() {
    const ids = getSelectedIds();
    if (ids.length === 0) return false;
    active = true;
    itemIds = [...ids];
    original = membershipMatrix(getSets(), itemIds, ancestorsOf);
    current = new Map(original);
    describe();
    render();
    return true;
  }

  /** Clicking an item cycles the state of the sets it belongs to. A setless
   * item has no set to cycle and is reported rather than silently ignored. */
  function toggleFromItem(itemId) {
    if (!active) return;
    const sets = setsContaining(getSets(), itemId, ancestorsOf);
    if (sets.length === 0) {
      setStatus('That item is in no set. Click an item inside the set you want.', { persistent: true, level: 'info' });
      return;
    }
    for (const set of sets) {
      current.set(set.id, nextState(current.get(set.id) ?? 'none'));
    }
    describe();
    render();
  }

  function describe() {
    const chosenCount = chosenSetIds().length;
    const mixedCount = mixedSetIds().length;
    const subject = itemIds.length === 1 ? '1 item' : `${itemIds.length} items`;
    if (chosenCount === 0 && mixedCount === 0) {
      setStatus(`${subject}: no sets chosen — Enter removes them from every set, Escape cancels.`, { persistent: true, level: 'info' });
      return;
    }
    const parts = [];
    if (chosenCount > 0) parts.push(`in ${chosenCount} ${chosenCount === 1 ? 'set' : 'sets'}`);
    // Naming the partial sets matters: they are the ones Enter will leave
    // alone, which is not obvious from an outline that is neither lit nor dark.
    if (mixedCount > 0) parts.push(`${mixedCount} partly, left unchanged`);
    setStatus(`${subject} ${parts.join(', ')} — Enter confirms, Escape cancels.`, { persistent: true, level: 'info' });
  }

  /** Enter: applies only the states the user actually changed. Setting every
   * set to none is meaningful — it is how items are returned to setless — so
   * it commits rather than cancelling. */
  async function confirm() {
    if (!active) return;
    const before = new Map(original);
    const after = new Map(current);
    const subjects = [...itemIds];
    close();
    await shareSelectionWithSets(after, subjects, before);
  }

  function cancel() {
    if (!active) return;
    close();
  }

  function close() {
    active = false;
    itemIds = [];
    original = new Map();
    current = new Map();
    // The only persistent workspace status belongs to this active mode. It
    // must disappear on both Enter and Escape, including a no-op confirm that
    // never reaches a store commit (and therefore has no later status clear).
    setStatus('');
    render();
  }

  return {
    isActive, begin, toggleFromItem, confirm, cancel,
    chosenSetIds, mixedSetIds, subjectIds,
  };
}
