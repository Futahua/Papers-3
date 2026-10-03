import assert from 'node:assert/strict';
import test from 'node:test';
import { createSetMembershipMode } from './public/app/components/set-membership-mode.js';

const set = (id, memberIds, excludedIds = []) =>
  ({ id, type: 'set', title: id, memberIds, excludedIds });

function createHarness({ sets = [], selected = [], ancestorsOf = null } = {}) {
  const calls = { shared: [], renders: 0, statuses: [] };
  const mode = createSetMembershipMode({
    getSets: () => sets,
    getSelectedIds: () => selected,
    shareSelectionWithSets: async (desired, itemIds, before) => {
      calls.shared.push({ desired, itemIds, before });
    },
    ancestorsOf,
    render: () => { calls.renders += 1; },
    setStatus: (message) => { calls.statuses.push(message); },
  });
  return { mode, calls };
}

/** The set ids a committed call would wholly include. */
const includedIn = (call) =>
  [...call.desired].filter(([, state]) => state === 'all').map(([id]) => id).sort();

test('the mode does not open with nothing selected', () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: [] });
  assert.equal(h.mode.begin(), false);
  assert.equal(h.mode.isActive(), false);
});

test('opening a mixed selection marks its sets partial, not chosen', () => {
  // i1 is only in a, i2 is only in b. Neither set covers the whole selection,
  // so neither may be pre-chosen: doing so is what used to make an immediate
  // Enter add both items to both sets.
  const h = createHarness({
    sets: [set('a', ['i1']), set('b', ['i2']), set('c', ['i3'])],
    selected: ['i1', 'i2'],
  });
  h.mode.begin();
  assert.equal(h.mode.isActive(), true);
  assert.deepEqual(h.mode.chosenSetIds(), [], 'nothing is wholly chosen');
  assert.deepEqual(h.mode.mixedSetIds().sort(), ['a', 'b'], 'both are partial');
});

test('opening a uniform selection pre-chooses the set they all share', () => {
  const h = createHarness({
    sets: [set('a', ['i1', 'i2']), set('b', ['i3'])],
    selected: ['i1', 'i2'],
  });
  h.mode.begin();
  assert.deepEqual(h.mode.chosenSetIds(), ['a'], 'wholly in, so wholly chosen');
  assert.deepEqual(h.mode.mixedSetIds(), []);
});

test('opening and confirming immediately applies nothing', async () => {
  const h = createHarness({
    sets: [set('a', ['i1']), set('b', ['i2'])],
    selected: ['i1', 'i2'],
  });
  h.mode.begin();
  await h.mode.confirm();
  const call = h.calls.shared[0];
  // The state the picker reports back must be identical to what it captured,
  // so the command layer has nothing to apply.
  assert.deepEqual([...call.desired], [...call.before], 'no state changed');
  assert.equal(h.calls.statuses.at(-1), '', 'the persistent mode instruction closes with Enter');
});

test('the picker sees membership inherited through a folder', () => {
  const ancestors = (id) => (id === 'child' ? ['f1'] : []);
  const h = createHarness({
    sets: [set('a', ['f1'])],
    selected: ['child'],
    ancestorsOf: ancestors,
  });
  h.mode.begin();
  assert.deepEqual(h.mode.chosenSetIds(), ['a'], 'inherited membership is visible');
});

test('opening over setless items chooses nothing', () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: ['loose'] });
  h.mode.begin();
  assert.deepEqual(h.mode.chosenSetIds(), []);
});

test('clicking an item toggles the set that item belongs to', () => {
  const h = createHarness({ sets: [set('a', ['i1']), set('b', ['i2'])], selected: ['loose'] });
  h.mode.begin();
  h.mode.toggleFromItem('i1');
  assert.deepEqual(h.mode.chosenSetIds(), ['a'], 'chosen by pointing at its contents');
  h.mode.toggleFromItem('i2');
  assert.deepEqual(h.mode.chosenSetIds().sort(), ['a', 'b']);
  h.mode.toggleFromItem('i1');
  assert.deepEqual(h.mode.chosenSetIds(), ['b'], 'clicking again removes it');
});

test('clicking a setless item reports why nothing happened', () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: ['i1'] });
  h.mode.begin();
  const before = h.mode.chosenSetIds();
  h.mode.toggleFromItem('loose');
  assert.deepEqual(h.mode.chosenSetIds(), before, 'unchanged');
  assert.ok(
    h.calls.statuses.at(-1).includes('in no set'),
    'the click is explained rather than silently ignored',
  );
});

test('clicking an item in two sets toggles both', () => {
  const h = createHarness({
    sets: [set('a', ['shared']), set('b', ['shared'])],
    selected: ['loose'],
  });
  h.mode.begin();
  h.mode.toggleFromItem('shared');
  assert.deepEqual(h.mode.chosenSetIds().sort(), ['a', 'b']);
});

test('Enter commits the chosen sets onto the captured subjects', async () => {
  const h = createHarness({ sets: [set('a', ['i1']), set('b', ['i2'])], selected: ['i1'] });
  h.mode.begin();
  h.mode.toggleFromItem('i2');
  await h.mode.confirm();
  assert.equal(h.calls.shared.length, 1);
  assert.deepEqual(includedIn(h.calls.shared[0]), ['a', 'b']);
  assert.deepEqual(h.calls.shared[0].itemIds, ['i1'], 'acts on what it opened over');
  assert.equal(h.mode.isActive(), false, 'closes after confirming');
});

test('Enter with nothing chosen still commits, regressing items to setless', async () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: ['i1'] });
  h.mode.begin();
  h.mode.toggleFromItem('i1');
  assert.deepEqual(h.mode.chosenSetIds(), [], 'deselected its only set');
  await h.mode.confirm();
  const call = h.calls.shared[0];
  assert.equal(call.desired.get('a'), 'none', 'an empty choice is meaningful, not a cancel');
  assert.notDeepEqual([...call.desired], [...call.before], 'and it is a real change');
});

test('clicking a partial set resolves it to wholly in', async () => {
  // 'mixed' is a state the user can leave alone but never ask for, so the
  // first click has to commit to one side. Including is the likelier intent
  // when you point at a set.
  const h = createHarness({
    sets: [set('a', ['i1']), set('b', ['i2'])],
    selected: ['i1', 'i2'],
  });
  h.mode.begin();
  assert.deepEqual(h.mode.mixedSetIds().sort(), ['a', 'b']);
  h.mode.toggleFromItem('i1');
  assert.deepEqual(h.mode.chosenSetIds(), ['a'], 'resolved to all');
  assert.deepEqual(h.mode.mixedSetIds(), ['b'], 'the untouched one stays partial');

  await h.mode.confirm();
  const call = h.calls.shared[0];
  assert.equal(call.desired.get('a'), 'all');
  assert.equal(call.desired.get('b'), 'mixed', 'b is reported unchanged');
});

test('Escape abandons the edit without committing', () => {
  const h = createHarness({ sets: [set('a', ['i1']), set('b', ['i2'])], selected: ['i1'] });
  h.mode.begin();
  h.mode.toggleFromItem('i2');
  h.mode.cancel();
  assert.equal(h.calls.shared.length, 0, 'nothing was applied');
  assert.equal(h.mode.isActive(), false);
  assert.equal(h.calls.statuses.at(-1), '', 'the persistent mode instruction closes with Escape');
});

test('the subjects are captured at open, so clicking inside cannot change them', async () => {
  let selected = ['i1'];
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  const calls = { shared: [] };
  const mode = createSetMembershipMode({
    getSets: () => sets,
    getSelectedIds: () => selected,
    shareSelectionWithSets: async (setIds, itemIds) => { calls.shared.push({ setIds, itemIds }); },
    render: () => {},
    setStatus: () => {},
  });
  mode.begin();
  selected = ['i2', 'i3'];
  await mode.confirm();
  assert.deepEqual(calls.shared[0].itemIds, ['i1'], 'still the items it opened over');
});

test('confirm and cancel do nothing when the mode is closed', async () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: ['i1'] });
  await h.mode.confirm();
  h.mode.cancel();
  assert.equal(h.calls.shared.length, 0);
});

test('the status names how many sets are chosen', () => {
  const h = createHarness({ sets: [set('a', ['i1']), set('b', ['i2'])], selected: ['i1'] });
  h.mode.begin();
  assert.ok(h.calls.statuses.at(-1).includes('1 set'), 'singular');
  h.mode.toggleFromItem('i2');
  assert.ok(h.calls.statuses.at(-1).includes('2 sets'), 'plural');
  h.mode.toggleFromItem('i1');
  h.mode.toggleFromItem('i2');
  assert.ok(
    h.calls.statuses.at(-1).includes('no sets chosen'),
    'and warns that Enter would remove them from every set',
  );
});

test('the mode re-renders on every change so the outlines can light up', () => {
  const h = createHarness({ sets: [set('a', ['i1'])], selected: ['i1'] });
  h.mode.begin();
  const afterBegin = h.calls.renders;
  h.mode.toggleFromItem('i1');
  assert.ok(h.calls.renders > afterBegin, 'a toggle repaints');
  h.mode.cancel();
  assert.ok(h.calls.renders > afterBegin + 1, 'closing repaints too');
});
