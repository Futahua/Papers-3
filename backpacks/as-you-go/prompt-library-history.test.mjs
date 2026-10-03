import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPromptLibraryHistory,
  canUndoPromptLibrary,
  canRedoPromptLibrary,
  recordPromptLibraryChange,
  replacePromptLibraryPresent,
  undoPromptLibrary,
  redoPromptLibrary,
  beginPromptLibraryTransaction,
  commitPromptLibraryTransaction,
  cancelPromptLibraryTransaction,
} from './public/app/components/prompt-library-history.js';

const tree = (name) => [{ id: 'prompt-x', type: 'prompt', title: name, text: 'body', includeInBatch: true }];
const treeA = tree('A');
const treeB = tree('B');

test('initial present matches the supplied tree and stacks are empty', () => {
  const h = createPromptLibraryHistory(treeA);
  assert.equal(h.present, treeA);
  assert.deepEqual(h.past, []);
  assert.deepEqual(h.future, []);
  assert.equal(canUndoPromptLibrary(h), false);
  assert.equal(canRedoPromptLibrary(h), false);
});

test('recording a change enables undo and undo/redo restore exact trees', () => {
  let h = createPromptLibraryHistory(treeA);
  h = recordPromptLibraryChange(h, treeB, 'edit');
  assert.equal(canUndoPromptLibrary(h), true);
  assert.equal(canRedoPromptLibrary(h), false);
  h = undoPromptLibrary(h);
  assert.equal(h.present, treeA);
  assert.equal(canRedoPromptLibrary(h), true);
  h = redoPromptLibrary(h);
  assert.equal(h.present, treeB);
});

test('a new mutation after undo clears redo', () => {
  let h = createPromptLibraryHistory(treeA);
  h = recordPromptLibraryChange(h, treeB);
  h = undoPromptLibrary(h);
  h = recordPromptLibraryChange(h, tree('C'));
  assert.equal(canRedoPromptLibrary(h), false);
  assert.equal(h.present[0].title, 'C');
});

test('a no-op mutation creates no history entry', () => {
  let h = createPromptLibraryHistory(treeA);
  const before = h;
  h = recordPromptLibraryChange(h, treeA);
  assert.equal(h, before, 'same reference means no entry');
  assert.equal(h.past.length, 0);
});

test('the history limit is enforced', () => {
  let h = createPromptLibraryHistory([], { limit: 2 });
  const trees = [tree('1'), tree('2'), tree('3')];
  for (const t of trees) h = recordPromptLibraryChange(h, t);
  assert.equal(h.past.length, 2);
  assert.equal(h.present[0].title, '3');
  h = undoPromptLibrary(h);
  assert.equal(h.present[0].title, '2');
});

test('begin/commit transaction produces exactly one entry', () => {
  let h = createPromptLibraryHistory(treeA);
  h = beginPromptLibraryTransaction(h, 'edit');
  h = replacePromptLibraryPresent(h, treeB);
  h = commitPromptLibraryTransaction(h, h.present);
  assert.equal(h.past.length, 1);
  assert.equal(h.lastLabel, 'edit');
  h = undoPromptLibrary(h);
  assert.equal(h.present, treeA);
});

test('an unchanged transaction produces no entry and keeps redo', () => {
  let h = createPromptLibraryHistory(treeA);
  h = recordPromptLibraryChange(h, treeB);
  h = undoPromptLibrary(h);
  h = beginPromptLibraryTransaction(h, 'edit');
  h = commitPromptLibraryTransaction(h, h.present);
  assert.equal(h.past.length, 0);
  assert.equal(canRedoPromptLibrary(h), true, 'redo untouched by unchanged transaction');
});

test('cancel transaction restores the baseline and creates no entry', () => {
  let h = createPromptLibraryHistory(treeA);
  h = beginPromptLibraryTransaction(h, 'edit');
  h = replacePromptLibraryPresent(h, treeB);
  h = cancelPromptLibraryTransaction(h);
  assert.equal(h.present, treeA);
  assert.equal(h.past.length, 0);
});

test('repeated begin during one session does not re-baseline', () => {
  let h = createPromptLibraryHistory(treeA);
  h = beginPromptLibraryTransaction(h, 'edit');
  h = replacePromptLibraryPresent(h, treeB);
  h = beginPromptLibraryTransaction(h, 'edit');
  h = replacePromptLibraryPresent(h, tree('C'));
  h = cancelPromptLibraryTransaction(h);
  assert.equal(h.present, treeA, 'baseline stayed the original pre-edit tree');
});

test('history functions never mutate their inputs', () => {
  const h = createPromptLibraryHistory(treeA);
  recordPromptLibraryChange(h, treeB);
  undoPromptLibrary(h);
  redoPromptLibrary(h);
  beginPromptLibraryTransaction(h, 'edit');
  replacePromptLibraryPresent(h, treeB);
  commitPromptLibraryTransaction(h, treeB);
  cancelPromptLibraryTransaction(h);
  assert.equal(h.present, treeA);
  assert.deepEqual(h.past, []);
  assert.deepEqual(h.future, []);
});
