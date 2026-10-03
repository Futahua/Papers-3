/** Pure data for item sets: named groupings over workspace items.
 *
 * A set is a record with an id, a title, and a member id list. An item may
 * belong to several sets (they overlap, forming a Venn) or to none. Sets are
 * independent of folder location — moving an item between folders never
 * changes what it belongs to.
 *
 * Sets have no stored position or size. Their outline is derived from where
 * their members happen to be, so nothing can desync: the shape is recomputed
 * from the members' current positions each time it is drawn. Spatially, a
 * non-member may not be dropped inside a set's region, and an item belonging
 * to several sets lives in their intersection — it cannot sit in the part of
 * one set the others do not cover, which is what keeps a Venn overlap
 * meaningful.
 *
 * A member id always refers to a workspace item, never to another set, so
 * there is no set-of-sets to traverse and no cycle to guard against. One set's
 * members can still all sit inside another's, which reads as nesting on
 * screen; that is just a total overlap, and falls out of allowing overlap at
 * all. Nothing in this module treats it specially.
 *
 * Membership is inherited through folders: a folder's contents belong to
 * whatever the folder belongs to, at any depth. Only the folder is stored, so
 * items added to it later join its sets automatically.
 *
 * A set therefore carries two lists. `memberIds` is what it contains;
 * `excludedIds` is what has been taken back out of an inherited subtree.
 * Without the second, "remove this item from the set" cannot be honoured for
 * an inherited item at all — the folder is the only thing stored, so the only
 * alternative would be expanding it into its contents, which loses the
 * property that makes inheritance worth having.
 *
 * No DOM, host, store, or browser events. */

let setSequence = 0;

function createId() {
  setSequence += 1;
  return `set-${Date.now().toString(36)}-${setSequence.toString(36)}`;
}

/** Creates a set over the given member ids, discarding duplicates and
 * preserving first-seen order. */
export function createItemSet(memberIds, overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId(),
    type: 'set',
    title: normalizeSetTitle(overrides.title),
    memberIds: uniqueIds(memberIds),
    excludedIds: uniqueIds(overrides.excludedIds),
  };
}

/** Untitled sets are represented by an empty title. The old placeholder was
 * presentation text, not user data, so it migrates to the same empty value. */
export function normalizeSetTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title === 'New set' ? '' : title;
}

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Normalizes persisted sets, dropping malformed records and duplicate ids.
 * Members that no longer exist are pruned when `knownItemIds` is supplied, so
 * a deleted item never lingers in a set. */
export function normalizeItemSets(raw, knownItemIds = null) {
  const known = knownItemIds ? new Set(knownItemIds) : null;
  const setIds = new Set(
    (Array.isArray(raw) ? raw : [])
      .map((record) => (record && typeof record === 'object' ? record.id : null))
      .filter((id) => typeof id === 'string' && id),
  );
  const seen = new Set();
  const sets = [];
  for (const record of Array.isArray(raw) ? raw : []) {
    if (!record || typeof record !== 'object') continue;
    const id = typeof record.id === 'string' && record.id ? record.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const memberIds = uniqueIds(record.memberIds)
      // Sets are flat: a member naming another set is malformed data, not a
      // nested set, so it is dropped rather than traversed.
      .filter((memberId) => !setIds.has(memberId))
      .filter((memberId) => (known ? known.has(memberId) : true));
    const excludedIds = uniqueIds(record.excludedIds)
      .filter((excludedId) => !setIds.has(excludedId))
      .filter((excludedId) => (known ? known.has(excludedId) : true));
    const legacyTitle = typeof record.title === 'string'
      ? record.title
      : typeof record.name === 'string' ? record.name : '';
    sets.push({
      id,
      type: 'set',
      title: normalizeSetTitle(legacyTitle),
      memberIds,
      excludedIds,
    });
  }
  return sets;
}

/** Whether one item belongs to one set, accounting for inheritance and
 * exclusions.
 *
 * Membership is inherited: a folder's contents belong to whatever the folder
 * belongs to, at any depth. `ancestorsOf` maps an item to its chain of
 * containing folders — omit it and only direct membership counts.
 *
 * `excludedIds` is what makes inherited membership editable. Without it there
 * is no way to take one child out of a set it inherits from its parent folder:
 * the folder is the only thing stored, so removing the child would mean
 * expanding the folder into its contents and losing the very property that
 * makes inheritance worth having — that items added to the folder later join
 * automatically. An exclusion is checked over the same ancestor chain, so
 * excluding a folder excludes its whole subtree. */
export function belongsToSet(set, itemId, ancestorsOf = null) {
  if (!set) return false;
  const chain = [itemId, ...(ancestorsOf ? ancestorsOf(itemId) : [])];
  const included = chain.some((id) => set.memberIds.includes(id));
  if (!included) return false;
  return !chain.some((id) => (set.excludedIds ?? []).includes(id));
}

/** Every set the item belongs to, in stored order. */
export function setsContaining(sets, itemId, ancestorsOf = null) {
  const list = Array.isArray(sets) ? sets : [];
  return list.filter((set) => belongsToSet(set, itemId, ancestorsOf));
}

/** Every item a set covers on screen: its stored members plus everything
 * inside any member folder. Used for hit-testing and outlines, never for
 * storage — the stored member list stays just the folder. */
export function coveredItemIds(set, candidateIds, ancestorsOf = null) {
  return (Array.isArray(candidateIds) ? candidateIds : [])
    .filter((id) => belongsToSet(set, id, ancestorsOf));
}

/** True when the item belongs to no set at all. */
export function isSetless(sets, itemId, ancestorsOf = null) {
  return setsContaining(sets, itemId, ancestorsOf).length === 0;
}

/** The set a gesture currently acts on, derived from the last clicked item
 * rather than stored separately, so it can never disagree with the view. An
 * item in several sets picks the first it belongs to; a setless item (or no
 * item at all) yields null, meaning "no set is picked". */
export function pickedSetId(sets, lastClickedItemId, ancestorsOf = null) {
  if (!lastClickedItemId) return null;
  return setsContaining(sets, lastClickedItemId, ancestorsOf)[0]?.id ?? null;
}

/** The ids Ctrl+A should select: the picked set's members when a set is
 * picked, otherwise every candidate that belongs to no set.
 *
 * Restricting the setless case to setless items is what makes sets feel like
 * containers — Ctrl+A outside a set never reaches inside one. `candidateIds`
 * is the visible universe, so the result never includes something off screen.
 */
export function selectAllScope(sets, candidateIds, lastClickedItemId, ancestorsOf = null) {
  const candidates = Array.isArray(candidateIds) ? candidateIds : [];
  const setId = pickedSetId(sets, lastClickedItemId, ancestorsOf);
  if (setId == null) {
    return candidates.filter((id) => isSetless(sets, id, ancestorsOf));
  }
  // Covered, not stored: selecting inside a set reaches the contents of a
  // member folder, not just the folder itself.
  const covered = new Set(coveredItemIds(findItemSet(sets, setId), candidates, ancestorsOf));
  return candidates.filter((id) => covered.has(id));
}

/** The complement of the current selection within the select-all scope: what
 * Alt+click acts on. Selecting everything, deselecting a few, then acting is
 * the workflow this collapses into one gesture. */
export function inverseScope(sets, candidateIds, lastClickedItemId, selectedIds, ancestorsOf = null) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return selectAllScope(sets, candidateIds, lastClickedItemId, ancestorsOf)
    .filter((id) => !selected.has(id));
}

export function findItemSet(sets, setId) {
  return (Array.isArray(sets) ? sets : []).find((set) => set.id === setId) ?? null;
}

/** Adds a set over the given members. Returns the same array when there is
 * nothing to group, so callers can skip recording history. */
export function addItemSet(sets, memberIds, overrides = {}) {
  const members = uniqueIds(memberIds);
  if (members.length === 0) return sets;
  return [...sets, createItemSet(members, overrides)];
}

export function removeItemSet(sets, setId) {
  const next = sets.filter((set) => set.id !== setId);
  return next.length === sets.length ? sets : next;
}

/** Replaces which sets the given items belong to. An empty `setIds` removes
 * them from every set, which is how an item is returned to setless. This is
 * the one membership-editing path (Ctrl+G); dragging never changes it.
 *
 * Removal has two shapes, and picking the wrong one silently does nothing:
 *
 * - direct membership is removed by dropping the id from `memberIds`;
 * - inherited membership can only be removed by *adding* an exclusion, since
 *   the stored member is the ancestor folder, not this item.
 *
 * `ancestorsOf` is what distinguishes them. Without it, removing an inherited
 * item filters a list the item was never in and the item stays in the set.
 *
 * Adding is the mirror: an exclusion is lifted first, so re-adding an item
 * that was excluded from an inherited set restores it rather than stacking a
 * member on top of a still-live exclusion.
 *
 * Sets left with no members are dropped, since an empty outline has nothing
 * to enclose. */
export function setMembership(sets, itemIds, setIds, ancestorsOf = null) {
  const items = uniqueIds(itemIds);
  if (items.length === 0) return sets;
  const target = new Set(Array.isArray(setIds) ? setIds : []);
  const itemSet = new Set(items);
  let changed = false;
  const next = [];
  for (const set of sets) {
    const shouldContain = target.has(set.id);
    const previousExcluded = set.excludedIds ?? [];

    // Adding always clears any exclusion on the item itself; removing keeps
    // the others untouched.
    let excludedIds = previousExcluded.filter((id) => !itemSet.has(id));
    const without = set.memberIds.filter((id) => !itemSet.has(id));
    let memberIds = shouldContain ? [...without, ...items] : without;

    if (!shouldContain) {
      // Anything still reaching this set through an ancestor needs an explicit
      // exclusion — dropping it from memberIds above cannot have removed it.
      const stillInherited = items.filter(
        (id) => belongsToSet({ ...set, memberIds, excludedIds }, id, ancestorsOf),
      );
      if (stillInherited.length > 0) excludedIds = [...excludedIds, ...stillInherited];
    }

    const membersChanged = memberIds.length !== set.memberIds.length
      || memberIds.some((id, index) => id !== set.memberIds[index]);
    const exclusionsChanged = excludedIds.length !== previousExcluded.length
      || excludedIds.some((id, index) => id !== previousExcluded[index]);
    if (membersChanged || exclusionsChanged) changed = true;

    if (memberIds.length === 0) {
      changed = true;
      continue;
    }
    next.push({ ...set, memberIds, excludedIds });
  }
  return changed ? next : sets;
}

/** Drops an item from every set it belongs to — used when the item itself is
 * deleted, so no set keeps a dangling member. */
export function forgetItems(sets, itemIds) {
  return setMembership(sets, itemIds, []);
}

/** How a set relates to a group of items: 'all', 'none', or 'mixed'.
 *
 * A picker that only knows chosen/not-chosen has to collapse 'mixed' into one
 * of the other two, and either choice silently edits items the user never
 * touched — the union pre-chooses a set that only some of the selection is in,
 * so confirming adds the rest to it. Keeping mixed as its own state is what
 * lets an untouched set be left exactly as it was. */
export function membershipState(set, itemIds, ancestorsOf = null) {
  const items = uniqueIds(itemIds);
  if (items.length === 0) return 'none';
  let members = 0;
  for (const itemId of items) {
    if (belongsToSet(set, itemId, ancestorsOf)) members += 1;
  }
  if (members === 0) return 'none';
  return members === items.length ? 'all' : 'mixed';
}

/** The membership matrix for a selection, captured when a picker opens so it
 * can tell an untouched set from one the user deliberately set to 'none'. */
export function membershipMatrix(sets, itemIds, ancestorsOf = null) {
  const matrix = new Map();
  for (const set of Array.isArray(sets) ? sets : []) {
    matrix.set(set.id, membershipState(set, itemIds, ancestorsOf));
  }
  return matrix;
}

/** Applies only the states the user actually changed.
 *
 * `original` is the matrix captured on open; `current` is the matrix after
 * their clicks. A set whose state is unchanged is skipped entirely — including
 * a still-'mixed' one, which is what makes opening the picker and pressing
 * Enter immediately a true no-op instead of a silent edit.
 *
 * Returns the same array when nothing changed, so callers can skip recording
 * history. */
export function applyMembershipChanges(sets, itemIds, original, current, ancestorsOf = null) {
  const items = uniqueIds(itemIds);
  if (items.length === 0) return sets;
  let next = sets;
  for (const set of Array.isArray(sets) ? sets : []) {
    const before = original?.get(set.id) ?? 'none';
    const after = current?.get(set.id) ?? before;
    // Skipping an unchanged set is mostly an optimisation — reapplying 'all'
    // to a set that already holds exactly these items is idempotent.
    if (after === before) continue;
    // This one is not. 'mixed' is a state a set can be left in but never asked
    // for, and without this it would fall through to the removal branch below
    // and empty the set — silently destroying a grouping nobody was editing.
    if (after === 'mixed') continue;
    next = setMembershipForOneSet(next, items, set.id, after === 'all', ancestorsOf);
  }
  return next;
}

/** Adds or removes one set's membership, touching no other set.
 *
 * Deliberately not routed through setMembership(): that replaces an item's
 * whole set list at once, so editing one set through it would rewrite every
 * other set the selection touches — reintroducing the union bug this tri-state
 * path exists to fix. Editing one record in place is the only way an untouched
 * set can genuinely stay untouched. */
function setMembershipForOneSet(sets, itemIds, setId, shouldContain, ancestorsOf) {
  const items = new Set(itemIds);
  let changed = false;
  const next = [];
  for (const set of sets) {
    if (set.id !== setId) { next.push(set); continue; }

    const previousExcluded = set.excludedIds ?? [];
    // Adding clears any exclusion standing in the way; removing drops direct
    // membership and excludes whatever still arrives through an ancestor.
    let excludedIds = previousExcluded.filter((id) => !items.has(id));
    let memberIds = set.memberIds.filter((id) => !items.has(id));

    if (shouldContain) {
      memberIds = [...memberIds, ...itemIds];
    } else {
      const stillInherited = [...items].filter(
        (id) => belongsToSet({ ...set, memberIds, excludedIds }, id, ancestorsOf),
      );
      excludedIds = [...excludedIds, ...stillInherited];
    }

    const membersChanged = memberIds.length !== set.memberIds.length
      || memberIds.some((id, index) => id !== set.memberIds[index]);
    const exclusionsChanged = excludedIds.length !== previousExcluded.length
      || excludedIds.some((id, index) => id !== previousExcluded[index]);
    if (membersChanged || exclusionsChanged) changed = true;

    // A set emptied of members has nothing left to enclose.
    if (memberIds.length === 0) { changed = true; continue; }
    next.push({ ...set, memberIds, excludedIds });
  }
  return changed ? next : sets;
}
