import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePromptLibrary,
  createPromptNode,
  createPromptFolder,
  effectivePromptLibrary,
  findPromptNode,
  updatePromptNode,
  removePromptNode,
  movePromptNode,
  movePromptNodes,
  descendantPromptIds,
  countPromptNodes,
  collectIncludedPrompts,
  selectedRootIds,
  collectPromptsFromSelectedRoots,
  clonePromptNodesForPaste,
  insertPromptNodes,
  buildBatchPromptText,
  formatCopyConfirmation,
  validatePromptLibrary,
  resolveCopierAction,
} from './public/prompt-library-model.js';

/**
 * Why the copy-prompt button does not open the library on a fresh workspace - measured in the host first, then
 * pinned here. effectivePromptLibrary() substitutes an INCLUDED fallback prompt whenever the stored library is
 * empty, so the batch text is never empty and resolveCopierAction always answers 'copy'. The dialog's `open`
 * branch, which is the only entry point to the hotkey settings page, is reachable only when every prompt is
 * excluded from the batch.
 *
 * This is a characterization test rather than an endorsement: it records the condition so that changing the
 * seeding, or giving the settings page an entry point of its own, shows up here instead of in a creator's
 * silent click.
 */
test('the prompt library opens only when the batch is empty, which the fallback prompt prevents', () => {
  const fallback = 'PICKUP PROMPT TEXT';

  const absent = effectivePromptLibrary({}, fallback);
  assert.equal(buildBatchPromptText(absent), fallback, 'an empty library is replaced by an included fallback prompt');
  assert.equal(resolveCopierAction([], absent).kind, 'copy', 'so the button copies rather than opening the dialog');

  const excluded = effectivePromptLibrary({ promptLibrary: [prompt('p1', 'T', 'hello', false)] }, fallback);
  assert.equal(buildBatchPromptText(excluded), '', 'nothing included means nothing to copy');
  assert.equal(resolveCopierAction([], excluded).kind, 'open', 'which is the one condition that opens the dialog');

  const included = effectivePromptLibrary({ promptLibrary: [prompt('p1', 'T', 'hello', true)] }, fallback);
  assert.equal(resolveCopierAction([], included).kind, 'copy', 'an included prompt is copied, not shown');
});

const prompt = (id, title, text, includeInBatch) => ({
  id, type: 'prompt', title, text, includeInBatch,
});

test('flat legacy promptCards migrate to root prompt nodes', () => {
  const library = normalizePromptLibrary(undefined, [
    { id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true },
    { id: 'prompt-b', title: 'Two', text: 'second', includeInBatch: false },
  ], undefined);
  assert.deepEqual(library, [
    prompt('prompt-a', 'One', 'first', true),
    prompt('prompt-b', 'Two', 'second', false),
  ]);
});

test('a legacy pickupPrompt migrates to one root prompt node', () => {
  const library = normalizePromptLibrary(undefined, undefined, 'legacy prompt');
  assert.equal(library.length, 1);
  assert.equal(library[0].type, 'prompt');
  assert.equal(library[0].text, 'legacy prompt');
  assert.equal(library[0].includeInBatch, true);
});

test('nested normalization keeps folders, prompts, and order, dropping bad records', () => {
  const library = normalizePromptLibrary([
    {
      id: 'folder-dev',
      type: 'folder',
      title: 'Dev',
      children: [
        prompt('prompt-a', 'A', 'one', true),
        { id: 'prompt-b', type: 'prompt', title: 'B', text: 'two', includeInBatch: false },
        { id: '', type: 'prompt', title: 'no id' },
      ],
    },
    { id: 'prompt-root', type: 'prompt', title: 'Root', text: 'r', includeInBatch: true },
    'junk',
  ], undefined, undefined);
  assert.equal(library.length, 2);
  assert.equal(library[0].children.length, 2);
  assert.equal(library[1].type, 'prompt');
});

test('duplicate ids keep the first occurrence', () => {
  const library = normalizePromptLibrary([
    prompt('a', 'A', 'one', true),
    prompt('a', 'B', 'two', false),
  ], undefined, undefined);
  assert.equal(library.length, 1);
  assert.equal(library[0].title, 'A');
});

test('prompt editor height round-trips within safe bounds', () => {
  const library = normalizePromptLibrary([
    { ...prompt('a', 'A', 'one', true), editorHeight: 318.6 },
    { ...prompt('b', 'B', 'two', false), editorHeight: 99999 },
    { ...prompt('c', 'C', 'three', false), editorHeight: 'invalid' },
  ]);
  assert.equal(library[0].editorHeight, 319);
  assert.equal(library[1].editorHeight, 1200);
  assert.equal('editorHeight' in library[2], false);
});

test('batch text is depth-first and ignores folder titles', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [
        prompt('p1', 'One', 'first', true),
        {
          id: 'folder-inner', type: 'folder', title: 'Inner',
          children: [prompt('p2', 'Two', 'second', true)],
        },
      ],
    },
    prompt('p3', 'Three', 'third', true),
  ];
  assert.equal(buildBatchPromptText(library), 'first\n\nsecond\n\nthird');
});

test('collapsed folders have no effect on copying (batch traverses the tree)', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'One', 'inside', true)],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'inside');
});

test('folder includeAll round-trips and folders lacking it normalize to false', () => {
  const library = normalizePromptLibrary([
    { id: 'folder-a', type: 'folder', title: 'A', includeAll: true, children: [prompt('p1', 'P', 'x', true)] },
    { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p2', 'Q', 'y', false)] },
  ], undefined, undefined);
  assert.equal(library[0].includeAll, true);
  assert.equal(library[1].includeAll, false, 'missing includeAll normalizes to false');
  assert.equal(library[0].children[0].includeInBatch, true);
});

test('batch inclusion: unchecked folder defers to child choices', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: false,
      children: [
        prompt('p1', 'A', 'one', true),
        prompt('p2', 'B', 'two', false),
        prompt('p3', 'C', 'three', true),
      ],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'one\n\nthree');
});

test('batch inclusion: checked folder includes every descendant', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: true,
      children: [
        prompt('p1', 'A', 'one', true),
        prompt('p2', 'B', 'two', false),
        prompt('p3', 'C', 'three', false),
      ],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'one\n\ntwo\n\nthree');
});

test('batch inclusion: checked outer folder overrides unchecked nested prompts', () => {
  const library = [
    {
      id: 'folder-outer', type: 'folder', title: 'Outer', includeAll: true,
      children: [
        prompt('p1', 'A', 'one', false),
        {
          id: 'folder-inner', type: 'folder', title: 'Inner', includeAll: false,
          children: [prompt('p2', 'B', 'two', false)],
        },
      ],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'one\n\ntwo');
});

test('batch inclusion: unchecked outer folder honors checked nested folder', () => {
  const library = [
    {
      id: 'folder-outer', type: 'folder', title: 'Outer', includeAll: false,
      children: [
        prompt('p1', 'A', 'one', false),
        {
          id: 'folder-inner', type: 'folder', title: 'Inner', includeAll: true,
          children: [prompt('p2', 'B', 'two', false)],
        },
      ],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'two');
});

test('toggling a folder does not rewrite child includeInBatch values', () => {
  let library = normalizePromptLibrary([
    {
      id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: false,
      children: [
        prompt('p1', 'A', 'one', true),
        prompt('p2', 'B', 'two', false),
      ],
    },
  ], undefined, undefined);
  library = updatePromptNode(library, 'folder-dev', (node) => ({ ...node, includeAll: true }));
  assert.equal(findPromptNode(library, 'p1').includeInBatch, true, 'child state remembered while folder checked');
  assert.equal(findPromptNode(library, 'p2').includeInBatch, false);
  library = updatePromptNode(library, 'folder-dev', (node) => ({ ...node, includeAll: false }));
  assert.equal(findPromptNode(library, 'p2').includeInBatch, false, 'child state returns after folder unchecked');
});

test('selectedRootIds reduces to selected roots in depth-first order', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A', includeAll: false,
      children: [prompt('p1', 'A', 'one', true), prompt('p2', 'B', 'two', false)],
    },
    prompt('p3', 'C', 'three', true),
  ];
  assert.deepEqual(selectedRootIds(library, ['p1', 'p2', 'folder-a']), ['folder-a']);
  assert.deepEqual(selectedRootIds(library, ['p1', 'p3']), ['p1', 'p3']);
  assert.deepEqual(selectedRootIds(library, []), []);
});

test('collectPromptsFromSelectedRoots copies explicit selection without duplicates', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A', includeAll: false,
      children: [prompt('p1', 'A', 'one', false), prompt('p2', 'B', 'two', false)],
    },
    prompt('p3', 'C', 'three', true),
  ];
  // Folder plus its descendant selected: descendant is not duplicated.
  assert.equal(collectPromptsFromSelectedRoots(library, ['folder-a', 'p1', 'p3']), 'one\n\ntwo\n\nthree');
  assert.equal(collectPromptsFromSelectedRoots(library, ['p3']), 'three');
  assert.equal(collectPromptsFromSelectedRoots(library, ['folder-a']), 'one\n\ntwo');
  // Explicit copy ignores batch checkbox filtering (p1/p2 unchecked but copied).
});

test('moving before, after, and inside a folder', () => {
  const library = [
    prompt('a', 'A', 'one', true),
    prompt('b', 'B', 'two', true),
    prompt('c', 'C', 'three', true),
    { id: 'folder-x', type: 'folder', title: 'X', children: [] },
  ];
  const before = movePromptNode(library, { nodeId: 'c', destinationParentId: null, beforeId: 'a' });
  assert.deepEqual(before.map((n) => n.id), ['c', 'a', 'b', 'folder-x']);
  const after = movePromptNode(library, { nodeId: 'a', destinationParentId: null, beforeId: 'c' });
  assert.deepEqual(after.map((n) => n.id), ['b', 'a', 'c', 'folder-x']);
  const inside = movePromptNode(library, { nodeId: 'a', destinationParentId: 'folder-x', beforeId: null });
  assert.deepEqual(inside.map((n) => n.id), ['b', 'c', 'folder-x']);
  assert.deepEqual(findPromptNode(inside, 'folder-x').children.map((n) => n.id), ['a']);
});

test('moving a nested node back to root', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'A', 'one', true), prompt('p2', 'B', 'two', true)],
    },
  ];
  const moved = movePromptNode(library, { nodeId: 'p2', destinationParentId: null, beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['folder-dev', 'p2']);
  assert.deepEqual(findPromptNode(moved, 'folder-dev').children.map((n) => n.id), ['p1']);
});

test('folder-to-descendant cycles are rejected', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p1', 'One', 'one', true)] },
      ],
    },
  ];
  const result = movePromptNode(library, { nodeId: 'folder-a', destinationParentId: 'folder-b', beforeId: null });
  assert.equal(result, library, 'cycle rejected without mutation');
  const intoSelf = movePromptNode(library, { nodeId: 'folder-a', destinationParentId: 'folder-a', beforeId: null });
  assert.equal(intoSelf, library);
});

test('movePromptNode rejects unknown ids, non-folder destinations, bad beforeId', () => {
  const library = [prompt('a', 'A', 'one', true), { id: 'folder-x', type: 'folder', title: 'X', children: [] }];
  assert.equal(movePromptNode(library, { nodeId: 'zz', destinationParentId: null, beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: 'a', beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: 'zz', beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: null, beforeId: 'zz' }), library);
});

test('movePromptNode and update are non-mutating', () => {
  const library = [prompt('a', 'A', 'one', true), { id: 'folder-x', type: 'folder', title: 'X', children: [] }];
  movePromptNode(library, { nodeId: 'a', destinationParentId: 'folder-x', beforeId: null });
  updatePromptNode(library, 'a', (node) => ({ ...node, title: 'changed' }));
  removePromptNode(library, 'folder-x');
  assert.deepEqual(library.map((n) => n.id), ['a', 'folder-x']);
  assert.equal(findPromptNode(library, 'a').title, 'A');
});

test('movePromptNodes moves multiple siblings before another sibling', () => {
  const library = [prompt('a', 'A', 'one', true), prompt('b', 'B', 'two', true), prompt('c', 'C', 'three', true), prompt('d', 'D', 'four', true)];
  const moved = movePromptNodes(library, { nodeIds: ['c', 'a'], destinationParentId: null, beforeId: 'b' });
  assert.deepEqual(moved.map((n) => n.id), ['a', 'c', 'b', 'd'], 'relative visual order preserved');
});

test('movePromptNodes moves multiple siblings after another sibling', () => {
  const library = [prompt('a', 'A', 'one', true), prompt('b', 'B', 'two', true), prompt('c', 'C', 'three', true)];
  const moved = movePromptNodes(library, { nodeIds: ['a', 'c'], destinationParentId: null, beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['b', 'a', 'c']);
});

test('movePromptNodes moves nodes from different parents into one folder preserving order', () => {
  const library = [
    { id: 'folder-x', type: 'folder', title: 'X', children: [prompt('a', 'A', 'one', true), prompt('b', 'B', 'two', true)] },
    prompt('c', 'C', 'three', true),
  ];
  const moved = movePromptNodes(library, { nodeIds: ['c', 'a'], destinationParentId: 'folder-x', beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['folder-x']);
  assert.deepEqual(findPromptNode(moved, 'folder-x').children.map((n) => n.id), ['b', 'a', 'c']);
});

test('movePromptNodes preserves relative visual order and selected folder subtree', () => {
  const library = [
    { id: 'folder-a', type: 'folder', title: 'A', children: [prompt('p1', 'P', 'one', true)] },
    prompt('b', 'B', 'two', true),
    prompt('c', 'C', 'three', true),
  ];
  const moved = movePromptNodes(library, { nodeIds: ['p1', 'folder-a', 'c'], destinationParentId: null, beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['b', 'folder-a', 'c']);
  assert.deepEqual(findPromptNode(moved, 'folder-a').children.map((n) => n.id), ['p1'], 'subtree intact');
});

test('movePromptNodes suppresses selected descendants under a selected folder', () => {
  const library = [
    { id: 'folder-a', type: 'folder', title: 'A', children: [prompt('p1', 'P', 'one', true)] },
    prompt('b', 'B', 'two', true),
  ];
  const moved = movePromptNodes(library, { nodeIds: ['folder-a', 'p1'], destinationParentId: null, beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['b', 'folder-a']);
  assert.equal(countPromptNodes(moved), 2, 'no nodes lost');
});

test('movePromptNodes rejects cycles and invalid destinations', () => {
  const library = [
    { id: 'folder-a', type: 'folder', title: 'A', children: [{ id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p1', 'P', 'one', true)] }] },
  ];
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: 'folder-b', beforeId: null }), library, 'into descendant rejected');
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: 'folder-a', beforeId: null }), library, 'into itself rejected');
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: 'zz', beforeId: null }), library, 'invalid parent rejected');
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: 'p1', beforeId: null }), library, 'non-folder parent rejected');
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: null, beforeId: 'zz' }), library, 'invalid beforeId rejected');
  assert.equal(movePromptNodes(library, { nodeIds: ['folder-a'], destinationParentId: null, beforeId: 'p1' }), library, 'beforeId of removed descendant rejected');
});

test('movePromptNodes fails safely without node loss', () => {
  const library = [prompt('a', 'A', 'one', true), prompt('b', 'B', 'two', true)];
  assert.equal(movePromptNodes(library, { nodeIds: ['a', 'zz'], destinationParentId: null, beforeId: null }), library, 'unknown id rejected');
  assert.equal(movePromptNodes(library, { nodeIds: [], destinationParentId: null, beforeId: null }), library);
  assert.deepEqual(movePromptNodes(library, { nodeIds: ['a'], destinationParentId: null, beforeId: 'b' }).map((n) => n.id), ['a', 'b'], 'same-position move is a no-op');
  assert.equal(countPromptNodes(library), 2, 'original tree untouched');
  assert.deepEqual(library.map((n) => n.id), ['a', 'b']);
});

test('subtree deletion removes the folder and its descendants', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        prompt('p1', 'One', 'one', true),
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p2', 'Two', 'two', true)] },
      ],
    },
    prompt('p3', 'Three', 'three', true),
  ];
  const removed = removePromptNode(library, 'folder-a');
  assert.deepEqual(removed.map((n) => n.id), ['p3']);
  assert.equal(countPromptNodes(removed), 1);
  assert.equal(descendantPromptIds(library, 'folder-a').length, 2);
});

test('descendantPromptIds is depth-first', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        prompt('p1', 'One', 'one', true),
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p2', 'Two', 'two', true)] },
      ],
    },
  ];
  assert.deepEqual(descendantPromptIds(library, 'folder-a'), ['p1', 'p2']);
});

test('validation covers prompts, titles, text, ids, types, and folders', () => {
  assert.ok(validatePromptLibrary([]), 'at least one prompt required');
  assert.ok(validatePromptLibrary([prompt('a', ' ', 'one', true)]), 'prompt title required');
  assert.ok(validatePromptLibrary([prompt('a', 'A', '  ', true)]), 'prompt text required');
  assert.ok(validatePromptLibrary([
    prompt('a', 'A', 'one', true),
    prompt('a', 'B', 'two', true),
  ]), 'ids must be unique');
  assert.ok(validatePromptLibrary([{ id: 'x', type: 'bogus' }]), 'unknown types rejected');
  assert.ok(validatePromptLibrary([
    { id: 'folder-a', type: 'folder', title: '  ', children: [] },
  ]), 'folder title required');
  assert.ok(validatePromptLibrary([
    { id: 'folder-a', type: 'folder', title: 'A', children: [prompt('p', 'P', 't', true)] },
  ]) === null, 'a valid tree passes');
});

test('effectivePromptLibrary resolves to a virtual fallback prompt when empty', () => {
  const library = effectivePromptLibrary({ promptLibrary: [] }, 'FALLBACK');
  assert.equal(library.length, 1);
  assert.equal(library[0].type, 'prompt');
  assert.equal(library[0].text, 'FALLBACK');
  assert.equal(library[0].includeInBatch, true);
});

test('created prompt and folder nodes have unique ids and correct types', () => {
  const ids = new Set();
  for (let i = 0; i < 40; i += 1) {
    ids.add(createPromptNode().id);
    ids.add(createPromptFolder().id);
  }
  assert.equal(ids.size, 80);
  assert.ok(createPromptNode().type === 'prompt');
  assert.ok(createPromptFolder().type === 'folder');
  assert.deepEqual(createPromptFolder().children, []);
  assert.equal(createPromptNode().includeInBatch, false);
  assert.equal(createPromptFolder().includeAll, false);
});

test('clonePromptNodesForPaste regenerates every id recursively', () => {
  const nodes = [
    {
      id: 'folder-a', type: 'folder', title: 'A', includeAll: true,
      children: [prompt('p1', 'P', 'one', true)],
    },
  ];
  const clones = clonePromptNodesForPaste(nodes);
  assert.notEqual(clones[0].id, 'folder-a');
  assert.notEqual(clones[0].children[0].id, 'p1');
  assert.equal(clones[0].title, 'A');
  assert.equal(clones[0].includeAll, true);
  assert.equal(clones[0].children[0].title, 'P');
  assert.equal(clones[0].children[0].text, 'one');
  assert.equal(clones[0].children[0].includeInBatch, true);
  const all = new Set([nodes[0].id, nodes[0].children[0].id, clones[0].id, clones[0].children[0].id]);
  assert.equal(all.size, 4, 'source and clone ids are all distinct');
});

test('insertPromptNodes inserts inside a folder or before a sibling', () => {
  const library = [
    { id: 'folder-x', type: 'folder', title: 'X', includeAll: false, children: [prompt('a', 'A', 'one', true)] },
    prompt('b', 'B', 'two', true),
  ];
  const inside = insertPromptNodes(library, 'folder-x', null, [prompt('c', 'C', 'three', true)]);
  assert.deepEqual(findPromptNode(inside, 'folder-x').children.map((n) => n.id), ['a', 'c']);
  const before = insertPromptNodes(library, null, 'b', [prompt('d', 'D', 'four', true)]);
  assert.deepEqual(before.map((n) => n.id), ['folder-x', 'd', 'b']);
  assert.equal(insertPromptNodes(library, 'folder-x', 'zz', [prompt('e', 'E', 'five', true)]), library, 'invalid beforeId returns original');
  assert.equal(insertPromptNodes(library, 'zz', null, [prompt('e', 'E', 'five', true)]), library, 'invalid parent returns original');
  assert.equal(insertPromptNodes(library, 'folder-x', null, []), library, 'empty insert returns original');
});

test('resolveCopierAction keeps selected-target precedence', () => {
  const library = [prompt('a', 'A', 'prompt body', true)];
  assert.deepEqual(
    resolveCopierAction(['C:\\target'], library),
    { kind: 'copy', text: 'C:\\target', copied: 'paths', count: 1 },
  );
  assert.deepEqual(
    resolveCopierAction(['a', 'b'], library),
    { kind: 'copy', text: 'a\nb', copied: 'paths', count: 2 },
  );
  assert.deepEqual(
    resolveCopierAction([], library),
    { kind: 'copy', text: 'prompt body', copied: 'prompts', count: 1 },
  );
});

test('resolveCopierAction opens the library when nothing is checked', () => {
  const library = [prompt('a', 'A', 'body', false)];
  assert.deepEqual(resolveCopierAction([], library), { kind: 'open' });
});

test('resolveCopierAction reports what it copied and how many', () => {
  const library = [
    prompt('a', 'A', 'first', true),
    prompt('b', 'B', 'second', true),
    prompt('c', 'C', 'excluded', false),
  ];
  // Paths are newline-joined, prompts blank-line-joined, so the count cannot be
  // re-derived from the text with one separator. The caller reads count/copied.
  const paths = resolveCopierAction(['C:\one', 'C:\two', 'C:\three'], library);
  assert.equal(paths.copied, 'paths');
  assert.equal(paths.count, 3, 'counts selected targets, not text blocks');

  const prompts = resolveCopierAction([], library);
  assert.equal(prompts.copied, 'prompts');
  assert.equal(prompts.count, 2, 'counts included prompts only');
});

test('resolveCopierAction counts a single path as one path', () => {
  const library = [prompt('a', 'A', 'body', true)];
  const outcome = resolveCopierAction(['C:\only'], library);
  assert.equal(outcome.copied, 'paths');
  assert.equal(outcome.count, 1, 'a lone path is not reported as a prompt');
});

test('formatCopyConfirmation names the copied paths or prompts and bounds long lists', () => {
  assert.equal(
    formatCopyConfirmation({ kind: 'copy', copied: 'paths', count: 1 }, ['Obsidia']),
    'Copied 1 path: Obsidia.',
  );
  assert.equal(
    formatCopyConfirmation({ kind: 'copy', copied: 'prompts', count: 2 }, ['Alpha', 'Beta']),
    'Copied 2 prompts: Alpha, Beta.',
  );
  assert.equal(
    formatCopyConfirmation({ kind: 'copy', copied: 'paths', count: 6 }, ['A', 'B', 'C', 'D', 'E', 'F']),
    'Copied 6 paths: A, B, C, D, +2 more.',
  );
});
