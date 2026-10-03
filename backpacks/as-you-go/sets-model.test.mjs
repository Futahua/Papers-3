import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createItemSet,
  normalizeItemSets,
  belongsToSet,
  membershipState,
  membershipMatrix,
  applyMembershipChanges,
  setsContaining,
  coveredItemIds,
  isSetless,
  pickedSetId,
  selectAllScope,
  inverseScope,
  findItemSet,
  addItemSet,
  removeItemSet,
  setMembership,
  forgetItems,
  normalizeSetTitle,
} from './public/sets-model.js';

const set = (id, memberIds, title = 'S') => ({ id, type: 'set', title, memberIds });

test('untitled sets use an empty title and migrate the legacy placeholder', () => {
  assert.equal(createItemSet(['a']).title, '');
  assert.equal(normalizeSetTitle(' New set '), '');
  assert.equal(normalizeItemSets([{ id: 's', name: 'New set', memberIds: [] }])[0].title, '');
  assert.equal(normalizeItemSets([{ id: 't', title: 'Ideas', memberIds: [] }])[0].title, 'Ideas');
});

test('createItemSet keeps first-seen order and drops duplicates', () => {
  const created = createItemSet(['b', 'a', 'b', '', null, 'c']);
  assert.deepEqual(created.memberIds, ['b', 'a', 'c']);
  assert.equal(created.type, 'set');
  assert.ok(created.id, 'gets an id');
});

test('createItemSet ids are unique across rapid creation', () => {
  const ids = new Set(Array.from({ length: 50 }, () => createItemSet(['a']).id));
  assert.equal(ids.size, 50, 'no collisions even when created in the same millisecond');
});

test('normalize drops malformed records and duplicate ids', () => {
  const sets = normalizeItemSets([
    set('a', ['i1']),
    'junk',
    null,
    { id: '', memberIds: ['i2'] },
    set('a', ['i3']),
  ]);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].memberIds, ['i1'], 'first occurrence wins');
});

test('normalize prunes members that no longer exist', () => {
  const sets = normalizeItemSets([set('a', ['i1', 'gone', 'i2'])], ['i1', 'i2']);
  assert.deepEqual(sets[0].memberIds, ['i1', 'i2'], 'deleted items leave no dangling members');
});

test('a member naming a set is dropped: members are items, not sets', () => {
  const sets = normalizeItemSets([
    set('outer', ['i1', 'inner']),
    set('inner', ['i2']),
  ]);
  assert.deepEqual(sets[0].memberIds, ['i1'], 'no set-of-sets to traverse');
  assert.deepEqual(sets[1].memberIds, ['i2']);
});

test('one set fully inside another is just a total overlap', () => {
  // Visually this reads as nesting; nothing in the model treats it specially.
  const sets = [set('outer', ['i1', 'i2', 'i3']), set('inner', ['i2'])];
  assert.deepEqual(setsContaining(sets, 'i2').map((s) => s.id), ['outer', 'inner']);
  assert.deepEqual(setsContaining(sets, 'i1').map((s) => s.id), ['outer']);
});

test('an item can belong to several overlapping sets', () => {
  const sets = [set('a', ['shared', 'i1']), set('b', ['shared', 'i2'])];
  assert.deepEqual(setsContaining(sets, 'shared').map((s) => s.id), ['a', 'b']);
  assert.equal(isSetless(sets, 'shared'), false);
  assert.equal(isSetless(sets, 'loose'), true);
});

test('the picked set comes from the last clicked item', () => {
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  assert.equal(pickedSetId(sets, 'i2'), 'b');
  assert.equal(pickedSetId(sets, 'i1'), 'a');
  assert.equal(pickedSetId(sets, 'loose'), null, 'a setless item picks no set');
  assert.equal(pickedSetId(sets, null), null, 'nothing clicked picks no set');
});

test('Ctrl+A inside a picked set selects only that set members', () => {
  const sets = [set('a', ['i1', 'i2']), set('b', ['i3'])];
  const visible = ['i1', 'i2', 'i3', 'loose'];
  assert.deepEqual(selectAllScope(sets, visible, 'i1'), ['i1', 'i2']);
  assert.deepEqual(selectAllScope(sets, visible, 'i3'), ['i3']);
});

test('Ctrl+A outside every set selects only setless items', () => {
  const sets = [set('a', ['i1', 'i2'])];
  const visible = ['i1', 'i2', 'loose1', 'loose2'];
  assert.deepEqual(
    selectAllScope(sets, visible, 'loose1'), ['loose1', 'loose2'],
    'select-all outside a set never reaches inside one',
  );
  assert.deepEqual(selectAllScope(sets, visible, null), ['loose1', 'loose2']);
});

test('Ctrl+A never selects something off screen', () => {
  const sets = [set('a', ['i1', 'offscreen'])];
  assert.deepEqual(
    selectAllScope(sets, ['i1'], 'i1'), ['i1'],
    'a member not among the candidates is not selected',
  );
});

test('the inverse scope is the select-all scope minus the selection', () => {
  const sets = [set('a', ['i1', 'i2', 'i3'])];
  const visible = ['i1', 'i2', 'i3', 'loose'];
  // Select all in the set, deselect i2, then act on the rest.
  assert.deepEqual(inverseScope(sets, visible, 'i1', ['i2']), ['i1', 'i3']);
  assert.deepEqual(inverseScope(sets, visible, 'i1', []), ['i1', 'i2', 'i3']);
  assert.deepEqual(inverseScope(sets, visible, 'i1', ['i1', 'i2', 'i3']), []);
});

test('the inverse scope outside a set covers setless items only', () => {
  const sets = [set('a', ['i1'])];
  assert.deepEqual(
    inverseScope(sets, ['i1', 'l1', 'l2'], 'l1', ['l1']), ['l2'],
    'set members stay out of the inverse when no set is picked',
  );
});

test('addItemSet ignores an empty grouping', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(addItemSet(sets, []), sets, 'same array, so no history entry');
  assert.equal(addItemSet(sets, ['i2']).length, 2);
});

test('sets may overlap: grouping shared items does not remove them from others', () => {
  let sets = [set('a', ['i1', 'i2'])];
  sets = addItemSet(sets, ['i2', 'i3'], { title: 'B' });
  assert.deepEqual(findItemSet(sets, 'a').memberIds, ['i1', 'i2'], 'original untouched');
  assert.deepEqual(sets[1].memberIds, ['i2', 'i3'], 'i2 is now in both');
});

test('setMembership shares items between chosen sets', () => {
  const sets = [set('a', ['i1', 'i2']), set('b', ['i3']), set('c', ['i4'])];
  const next = setMembership(sets, ['i1'], ['b', 'c']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i2'], 'left the old set');
  assert.ok(findItemSet(next, 'b').memberIds.includes('i1'));
  assert.ok(findItemSet(next, 'c').memberIds.includes('i1'));
});

test('setMembership with no sets regresses items to setless', () => {
  const sets = [set('a', ['i1', 'i2'])];
  const next = setMembership(sets, ['i1'], []);
  assert.equal(isSetless(next, 'i1'), true);
  assert.ok(findItemSet(next, 'a').memberIds.includes('i2'), 'others stay');
});

test('a set emptied by a membership change is dropped', () => {
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  const next = setMembership(sets, ['i1'], []);
  assert.equal(findItemSet(next, 'a'), null, 'an outline with nothing to enclose is removed');
  assert.equal(next.length, 1);
});

test('setMembership returns the same array when nothing changes', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(setMembership(sets, ['i1'], ['a']), sets, 'no-op is identity');
  assert.equal(setMembership(sets, [], ['a']), sets, 'no items is identity');
});

test('setless items can be grouped with Ctrl+G the same way', () => {
  const sets = [set('a', ['i1'])];
  const next = setMembership(sets, ['loose'], ['a']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i1', 'loose']);
});

test('forgetItems removes a deleted item from every set', () => {
  const sets = [set('a', ['i1', 'shared']), set('b', ['shared'])];
  const next = forgetItems(sets, ['shared']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i1']);
  assert.equal(findItemSet(next, 'b'), null, 'set left empty is dropped');
});

test('removeItemSet drops one set and is identity when absent', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(removeItemSet(sets, 'missing'), sets);
  assert.equal(removeItemSet(sets, 'a').length, 0);
});

// ===========================================================================
// Persistence: sets live in view state and survive a normalize round trip.
// ===========================================================================

test('sets round-trip through normalizeState', async () => {
  const { normalizeState, setItemSets, emptyState, createGroup } =
    await import('./public/workspace-model-20260730b.js');
  let state = emptyState();
  state = createGroup(state, { name: 'A' });
  state = createGroup(state, { name: 'B' });
  const [g1, g2] = state.groups.map((group) => group.id);

  state = setItemSets(state, [set('s1', [g1, g2], 'Mine')]);
  assert.deepEqual(state.view.itemSets[0].memberIds, [g1, g2]);

  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.view.itemSets, state.view.itemSets, 'survives a save/load cycle');
});

test('a set member deleted from the workspace is pruned on normalize', async () => {
  const { normalizeState, setItemSets, emptyState, createGroup } =
    await import('./public/workspace-model-20260730b.js');
  let state = emptyState();
  state = createGroup(state, { name: 'A' });
  const [g1] = state.groups.map((group) => group.id);
  state = setItemSets(state, [set('s1', [g1, 'ghost-item'], 'Mine')]);
  assert.deepEqual(
    state.view.itemSets[0].memberIds, [g1],
    'setItemSets refuses a member that is not a real item',
  );

  const restored = normalizeState(JSON.parse(JSON.stringify({
    ...state,
    view: { ...state.view, itemSets: [set('s1', [g1, 'ghost-item'], 'Mine')] },
  })));
  assert.deepEqual(restored.view.itemSets[0].memberIds, [g1], 'and normalize prunes it on load');
});

test('a state with no itemSets key normalizes to an empty list', async () => {
  const { normalizeState } = await import('./public/workspace-model-20260730b.js');
  const restored = normalizeState({ groups: [], shortcuts: [], view: {} });
  assert.deepEqual(restored.view.itemSets, [], 'older saved states migrate untouched');
});

// ===========================================================================
// Folder membership is inherited: G on a folder covers its whole subtree.
// ===========================================================================

/** Folder tree: f1 contains i1 and f2; f2 contains i2. */
const ancestors = (id) => ({
  i1: ['f1'],
  f2: ['f1'],
  i2: ['f2', 'f1'],
}[id] ?? []);

test('an item inside a member folder belongs to that folder set', () => {
  const sets = [set('a', ['f1'])];
  assert.deepEqual(setsContaining(sets, 'i1', ancestors).map((s) => s.id), ['a']);
  assert.equal(isSetless(sets, 'i1', ancestors), false, 'contents are not setless');
});

test('membership is inherited at any depth', () => {
  const sets = [set('a', ['f1'])];
  assert.deepEqual(
    setsContaining(sets, 'i2', ancestors).map((s) => s.id), ['a'],
    'a grandchild inherits too',
  );
});

test('only the folder is stored, so later additions join automatically', () => {
  const sets = [set('a', ['f1'])];
  assert.deepEqual(sets[0].memberIds, ['f1'], 'the subtree is not expanded into storage');
  // A brand new child of f1 inherits without touching the set.
  const laterChild = (id) => (id === 'newcomer' ? ['f1'] : ancestors(id));
  assert.deepEqual(setsContaining(sets, 'newcomer', laterChild).map((s) => s.id), ['a']);
});

test('coveredItemIds expands a member folder for hit testing', () => {
  const covered = coveredItemIds(set('a', ['f1']), ['f1', 'i1', 'f2', 'i2', 'outside'], ancestors);
  assert.deepEqual(covered, ['f1', 'i1', 'f2', 'i2'], 'the whole subtree, and nothing else');
});

test('Ctrl+A inside a folder set reaches the folder contents', () => {
  const sets = [set('a', ['f1'])];
  assert.deepEqual(
    selectAllScope(sets, ['f1', 'i1', 'i2', 'outside'], 'i1', ancestors),
    ['f1', 'i1', 'i2'],
    'selecting inside the set is not limited to the stored folder',
  );
});

test('without an ancestor lookup only direct membership counts', () => {
  const sets = [set('a', ['f1'])];
  assert.deepEqual(setsContaining(sets, 'i1'), [], 'inheritance is opt-in per call');
});

// ===========================================================================
// Exclusions: what makes inherited membership editable.
// ===========================================================================

test('a child can leave a set it inherits from its parent folder', () => {
  const sets = [set('a', ['f1'])];
  assert.equal(belongsToSet(sets[0], 'i1', ancestors), true, 'inherited to begin with');

  const next = setMembership(sets, ['i1'], [], ancestors);
  assert.equal(belongsToSet(next[0], 'i1', ancestors), false, 'the child left the set');
  assert.deepEqual(next[0].memberIds, ['f1'], 'the folder is still the stored member');
  assert.deepEqual(next[0].excludedIds, ['i1'], 'removal was recorded as an exclusion');
});

test('excluding one child leaves its siblings alone', () => {
  const sets = [set('a', ['f1'])];
  const next = setMembership(sets, ['i1'], [], ancestors);
  assert.equal(belongsToSet(next[0], 'f2', ancestors), true, 'sibling folder still in');
  assert.equal(belongsToSet(next[0], 'i2', ancestors), true, 'its contents still in');
});

test('excluding a folder excludes its whole subtree', () => {
  const sets = [set('a', ['f1'])];
  const next = setMembership(sets, ['f2'], [], ancestors);
  assert.equal(belongsToSet(next[0], 'f2', ancestors), false, 'the folder left');
  assert.equal(belongsToSet(next[0], 'i2', ancestors), false, 'and so did what it contains');
  assert.equal(belongsToSet(next[0], 'i1', ancestors), true, 'an unrelated child is untouched');
});

test('adding an excluded item back restores it', () => {
  const sets = [set('a', ['f1'])];
  const removed = setMembership(sets, ['i1'], [], ancestors);
  assert.deepEqual(removed[0].excludedIds, ['i1']);

  const restored = setMembership(removed, ['i1'], ['a'], ancestors);
  assert.equal(belongsToSet(restored[0], 'i1', ancestors), true, 'back in the set');
  assert.deepEqual(restored[0].excludedIds, [], 'the exclusion was lifted, not stacked against');
});

test('removing a directly stored member still drops it from memberIds', () => {
  // Exclusions are only for inherited membership. A direct member must not
  // accumulate an exclusion it does not need.
  const sets = [set('a', ['i1', 'i2'])];
  const next = setMembership(sets, ['i1'], []);
  assert.deepEqual(next[0].memberIds, ['i2'], 'dropped from storage');
  assert.deepEqual(next[0].excludedIds, [], 'no exclusion needed');
});

test('removal without an ancestor lookup cannot silently fail', () => {
  // Called without ancestorsOf, an inherited item is not seen as a member at
  // all, so nothing is stored and the item stays in the set. This documents
  // the trap: the ancestor lookup is required for removal to mean anything.
  const sets = [set('a', ['f1'])];
  const next = setMembership(sets, ['i1'], []);
  assert.equal(belongsToSet(next[0], 'i1', ancestors), true, 'still inherited');
});

test('persisted exclusions survive normalization and prune with their items', () => {
  const [restored] = normalizeItemSets(
    [{ id: 'a', memberIds: ['f1'], excludedIds: ['i1', 'gone'] }],
    ['f1', 'i1'],
  );
  assert.deepEqual(restored.memberIds, ['f1']);
  assert.deepEqual(restored.excludedIds, ['i1'], 'an exclusion naming a deleted item is dropped');
});

// ===========================================================================
// Tri-state membership: what makes Ctrl+G safe on a mixed selection.
// ===========================================================================

test('membershipState reports all, none, or mixed', () => {
  const s = set('a', ['i1', 'i2']);
  assert.equal(membershipState(s, ['i1', 'i2']), 'all');
  assert.equal(membershipState(s, ['i3', 'i4']), 'none');
  assert.equal(membershipState(s, ['i1', 'i3']), 'mixed');
});

test('membershipState follows inheritance and exclusions', () => {
  const inherited = set('a', ['f1']);
  assert.equal(membershipState(inherited, ['i1', 'i2'], ancestors), 'all', 'both inherit from f1');

  const withExclusion = { ...set('a', ['f1']), excludedIds: ['i1'] };
  assert.equal(membershipState(withExclusion, ['i1', 'i2'], ancestors), 'mixed', 'one is excluded');
});

test('opening the picker and confirming immediately changes nothing', () => {
  // The bug this replaces: the picker took the union across the selection, so
  // a set only some items belonged to was pre-chosen, and confirming added
  // the rest to it.
  const sets = [set('A', ['i1']), set('B', ['i2'])];
  const items = ['i1', 'i2'];
  const captured = membershipMatrix(sets, items);
  assert.deepEqual([...captured], [['A', 'mixed'], ['B', 'mixed']]);

  const unchanged = applyMembershipChanges(sets, items, captured, new Map(captured));
  assert.equal(unchanged, sets, 'the same array is returned, so no history is recorded');
});

test('a set reported as mixed is never resolved either way', () => {
  // 'mixed' is not a state anything can ask for — only one a set can be left
  // in. Without the guard it falls through to the removal branch and the set
  // is emptied and dropped, silently destroying a grouping the user was not
  // editing.
  const sets = [set('A', ['i1', 'i2'])];
  const next = applyMembershipChanges(
    sets, ['i1', 'i2'], new Map([['A', 'all']]), new Map([['A', 'mixed']]),
  );
  assert.ok(findItemSet(next, 'A'), 'the set still exists');
  assert.deepEqual(findItemSet(next, 'A').memberIds, ['i1', 'i2'], 'and is untouched');
});

test('changing one set leaves the others exactly as they were', () => {
  const sets = [set('A', ['i1']), set('B', ['i2'])];
  const items = ['i1', 'i2'];
  const captured = membershipMatrix(sets, items);

  const next = applyMembershipChanges(
    sets, items, captured, new Map(captured).set('A', 'all'),
  );
  const A = findItemSet(next, 'A');
  const B = findItemSet(next, 'B');
  assert.equal(belongsToSet(A, 'i1'), true);
  assert.equal(belongsToSet(A, 'i2'), true, 'A was set to all');
  assert.equal(belongsToSet(B, 'i1'), false, 'i1 was never added to B');
  assert.equal(belongsToSet(B, 'i2'), true, 'B is untouched');
});

test('a set left mixed keeps its partial membership', () => {
  const sets = [set('A', ['i1']), set('B', ['i2'])];
  const items = ['i1', 'i2'];
  const captured = membershipMatrix(sets, items);

  // Only B is touched; A stays mixed and must not be resolved either way.
  const next = applyMembershipChanges(
    sets, items, captured, new Map(captured).set('B', 'none'),
  );
  const A = findItemSet(next, 'A');
  assert.equal(belongsToSet(A, 'i1'), true, 'still in');
  assert.equal(belongsToSet(A, 'i2'), false, 'still out');
  assert.equal(findItemSet(next, 'B'), null, 'B emptied and was dropped');
});

test('setting a set to none removes the whole selection from it', () => {
  const sets = [set('A', ['i1', 'i2', 'i3'])];
  const captured = membershipMatrix(sets, ['i1', 'i2']);
  assert.equal(captured.get('A'), 'all');

  const next = applyMembershipChanges(
    sets, ['i1', 'i2'], captured, new Map(captured).set('A', 'none'),
  );
  assert.deepEqual(findItemSet(next, 'A').memberIds, ['i3']);
});

test('tri-state changes reach inherited members through exclusions', () => {
  const sets = [set('A', ['f1'])];
  const items = ['i1'];
  const captured = membershipMatrix(sets, items, ancestors);
  assert.equal(captured.get('A'), 'all', 'inherited from f1');

  const next = applyMembershipChanges(
    sets, items, captured, new Map(captured).set('A', 'none'), ancestors,
  );
  assert.equal(belongsToSet(findItemSet(next, 'A'), 'i1', ancestors), false, 'the child left');
  assert.deepEqual(findItemSet(next, 'A').memberIds, ['f1'], 'the folder is still stored');
});

test('a set with no excludedIds behaves exactly as before', () => {
  // Existing persisted data has no excludedIds at all.
  const [restored] = normalizeItemSets([{ id: 'a', memberIds: ['f1'] }], ['f1', 'i1']);
  assert.deepEqual(restored.excludedIds, [], 'normalized to empty rather than left undefined');
  assert.equal(belongsToSet(restored, 'i1', ancestors), true, 'inheritance still applies');
});
