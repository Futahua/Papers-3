import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmationDialog } from './public/app/components/confirmation-dialog.js';

function createHarness() {
  const committed = [];
  const elements = {};
  for (const key of [
    'confirmTitle', 'confirmCopy', 'confirmDelete', 'confirmRestore',
    'confirmLayer', 'cancelConfirm',
  ]) {
    const node = {
      hidden: null,
      textContent: '',
      style: {},
      _listeners: [],
      addEventListener(type, handler, options) {
        const entry = { type, handler, options };
        node._listeners.push(entry);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const index = node._listeners.indexOf(entry);
            if (index >= 0) node._listeners.splice(index, 1);
          });
        }
      },
      _dispatch(type, event) {
        for (const entry of [...node._listeners]) {
          if (entry.type === type) entry.handler(event);
        }
      },
    };
    elements[key] = node;
  }

  let state = { marker: 'current' };
  let selectedIds = [];
  const dialog = createConfirmationDialog({
    elements,
    getState: () => state,
    getSelectedIds: () => [...selectedIds],
    binItemName: (id) => (id === 'bin-item-1' ? 'First Item' : null),
    permanentlyDelete: (s, ids) => ({ ...s, deleted: [...ids] }),
    restoreSelection: (s, ids) => ({ ...s, restored: [...ids] }),
    commit: async (next, message) => { committed.push({ next, message }); },
  });

  return {
    dialog, elements, committed,
    setSelected: (ids) => { selectedIds = ids; },
    setState: (next) => { state = next; },
    getState: () => state,
  };
}

test('askPermanentDelete shows single-item copy and hides restore', () => {
  const h = createHarness();
  h.dialog.askPermanentDelete(['bin-item-1'], false);
  assert.equal(h.elements.confirmTitle.textContent, 'Delete permanently?');
  assert.match(h.elements.confirmCopy.textContent, /“First Item” permanently/);
  assert.equal(h.elements.confirmDelete.hidden, false);
  assert.equal(h.elements.confirmRestore.hidden, true);
  assert.equal(h.elements.confirmLayer.hidden, false);
});

test('askRestoreConfirm shows batch copy', () => {
  const h = createHarness();
  h.dialog.askRestoreConfirm(['a', 'b', 'c'], false);
  assert.equal(h.elements.confirmTitle.textContent, 'Restore?');
  assert.equal(h.elements.confirmCopy.textContent, 'Restore these 3 items?');
  assert.equal(h.elements.confirmDelete.hidden, true);
  assert.equal(h.elements.confirmRestore.hidden, false);
});

test('askPermanentDelete defaults to the current selection', () => {
  const h = createHarness();
  h.setSelected(['x', 'y']);
  h.dialog.askPermanentDelete();
  assert.equal(h.elements.confirmCopy.textContent, 'Delete these 2 items permanently? This cannot be undone.');
});

test('confirm-delete commits the permanentlyDelete result', async () => {
  const h = createHarness();
  h.dialog.askPermanentDelete(['bin-item-1']);
  h.dialog.mount();
  await h.elements.confirmDelete._dispatch('click', {});
  assert.deepEqual(h.committed, [{
    next: { marker: 'current', deleted: ['bin-item-1'] },
    message: 'Deleted permanently.',
  }]);
  assert.equal(h.elements.confirmLayer.hidden, true);
});

test('confirm-restore commits the restoreSelection result', async () => {
  const h = createHarness();
  h.dialog.askRestoreConfirm(['a']);
  h.dialog.mount();
  await h.elements.confirmRestore._dispatch('click', {});
  assert.deepEqual(h.committed, [{
    next: { marker: 'current', restored: ['a'] },
    message: 'Restored.',
  }]);
});

test('cancel clears pending ids and hides the layer without committing', () => {
  const h = createHarness();
  h.dialog.askPermanentDelete(['bin-item-1']);
  h.dialog.mount();
  h.elements.cancelConfirm._dispatch('click', {});
  assert.equal(h.elements.confirmLayer.hidden, true);
  assert.equal(h.committed.length, 0);
});

test('destroy removes confirm button listeners', () => {
  const h = createHarness();
  h.dialog.mount();
  const before = h.elements.confirmDelete._listeners.length
    + h.elements.confirmRestore._listeners.length
    + h.elements.cancelConfirm._listeners.length;
  assert.ok(before > 0);
  h.dialog.destroy();
  const after = h.elements.confirmDelete._listeners.length
    + h.elements.confirmRestore._listeners.length
    + h.elements.cancelConfirm._listeners.length;
  assert.equal(after, 0);
});

test('0B: a generic question resolves true only when confirmed', async () => {
  const h = createHarness();
  h.dialog.mount();
  const answer = h.dialog.askConfirm({ title: 'Keep your version?', copy: 'This will replace changes saved elsewhere.', confirmLabel: 'Keep my version' });

  assert.equal(h.elements.confirmTitle.textContent, 'Keep your version?');
  assert.equal(h.elements.confirmCopy.textContent, 'This will replace changes saved elsewhere.');
  assert.equal(h.elements.confirmDelete.textContent, 'Keep my version');
  assert.equal(h.elements.confirmLayer.hidden, false);

  await h.elements.confirmDelete._dispatch('click', {});
  assert.equal(await answer, true);
  assert.equal(h.elements.confirmLayer.hidden, true);
  assert.equal(h.committed.length, 0, 'a generic question must never fall through into a delete');
});

test('0B: cancelling a generic question answers false rather than hanging', async () => {
  const h = createHarness();
  h.dialog.mount();
  const answer = h.dialog.askConfirm({ title: 'Keep your version?', copy: 'copy' });
  await h.elements.cancelConfirm._dispatch('click', {});
  assert.equal(await answer, false);
});

test('0B: the confirm button label is restored for the next ordinary confirmation', async () => {
  const h = createHarness();
  h.dialog.mount();
  const original = h.elements.confirmDelete.textContent;
  const answer = h.dialog.askConfirm({ title: 't', copy: 'c', confirmLabel: 'Keep my version' });
  await h.elements.cancelConfirm._dispatch('click', {});
  await answer;
  assert.equal(h.elements.confirmDelete.textContent, original);
});

test('0B: destroying while a question is pending answers false', async () => {
  const h = createHarness();
  h.dialog.mount();
  const answer = h.dialog.askConfirm({ title: 't', copy: 'c' });
  h.dialog.destroy();
  assert.equal(await answer, false);
});
