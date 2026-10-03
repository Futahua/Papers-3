import assert from 'node:assert/strict';
import test from 'node:test';

import { openWindowLayoutPickerSession, toWindowLayoutPickerRows } from './public/app/window-layout-picker-session.js';

test('picker rows preserve the window icon and current-member marker', () => {
  const icon = 'data:image/png;base64,abc';
  const candidates = [
    { id: 'member', title: 'Window A', icon },
    { id: 'new', title: 'Window B' },
  ];
  const rows = toWindowLayoutPickerRows(candidates, [{ id: 'persisted' }], (members, candidate) => candidate.id === 'member' && members.length === 1);
  assert.deepEqual(rows, [
    { id: 'member', title: 'Window A', icon, current: true },
    { id: 'new', title: 'Window B', icon: null, current: false },
  ]);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('picker shell opens before enumeration and gets updated rows without replacing its action promise', async () => {
  const order = [];
  const list = deferred();
  const action = deferred();
  let updatedRows;
  const pending = openWindowLayoutPickerSession({
    pickerId: 'picker-a',
    openPicker: (id) => { order.push(`open:${id}`); return action.promise; },
    loadCandidates: () => { order.push('list'); return list.promise; },
    updatePicker: async (rows, id) => { order.push(`update:${id}`); updatedRows = rows; return { outcome: 'success', delivery: 'applied' }; },
  });
  assert.deepEqual(order, ['open:picker-a', 'list']);

  const candidates = [{ id: 'candidate-a', title: 'Window A' }];
  list.resolve({ outcome: 'success', candidates });
  const session = await pending;
  assert.equal(session.outcome, 'success');
  assert.deepEqual(session.candidates, candidates);
  assert.deepEqual(updatedRows, candidates);
  assert.deepEqual(order, ['open:picker-a', 'list', 'update:picker-a']);

  action.resolve({ action: 'select', candidateId: 'candidate-a' });
  assert.deepEqual(await session.actionPromise, { action: 'select', candidateId: 'candidate-a' });
});

test('closing the loading shell before enumeration prevents a stale row update', async () => {
  const list = deferred();
  const updates = [];
  const sessionPromise = openWindowLayoutPickerSession({
    pickerId: 'picker-old',
    openPicker: async () => ({ action: 'cancel' }),
    loadCandidates: () => list.promise,
    updatePicker: async (rows, id) => { updates.push({ rows, id }); return { outcome: 'success', delivery: 'applied' }; },
  });
  const session = await sessionPromise;
  assert.equal(session.outcome, 'action');
  assert.deepEqual(session.action, { action: 'cancel' });
  list.resolve({ outcome: 'success', candidates: [{ id: 'late' }] });
  await Promise.resolve();
  assert.deepEqual(updates, []);
});

test('enumeration failure clears the loading rows and returns the failure to the caller', async () => {
  const updates = [];
  const action = deferred();
  const pending = openWindowLayoutPickerSession({
    pickerId: 'picker-error',
    openPicker: () => action.promise,
    loadCandidates: async () => ({ outcome: 'helper-unavailable', error: 'offline' }),
    updatePicker: async (rows, id) => { updates.push({ rows, id }); return { outcome: 'success', delivery: 'buffered' }; },
  });
  const session = await pending;
  assert.equal(session.outcome, 'list-error');
  assert.deepEqual(session.error, 'offline');
  assert.deepEqual(updates, [{ rows: [], id: 'picker-error' }]);
  action.resolve({ action: 'cancel' });
  await session.actionPromise;
});

test('a rejected or stale row update is reported instead of leaving a loading shell as success', async () => {
  const action = deferred();
  const session = await openWindowLayoutPickerSession({
    pickerId: 'picker-stale',
    openPicker: () => action.promise,
    loadCandidates: async () => ({ outcome: 'success', candidates: [{ id: 'candidate-a' }] }),
    updatePicker: async () => ({ outcome: 'stale' }),
  });
  assert.equal(session.outcome, 'update-error');
  assert.equal(session.error, 'stale');
  action.resolve({ action: 'cancel' });
  await session.actionPromise;
});
