import assert from 'node:assert/strict';
import test from 'node:test';
import { createHotkeyCatalog } from './public/app/hotkeys-model.js';
import { planQuickRunTypeToRun, QUICK_RUN_TYPE_TO_RUN_PASS } from './public/app/quick-run/quick-run-type-to-run.js';

/**
 * Type-to-run: the creator's third way into Quick Run, and the cheapest one - on the canvas, a printable
 * character opens the palette with that character already in the line.
 *
 * These tests are about the DECISION, so the module takes the facts it must not invent: the bindings in
 * force (preferences plus catalog), and the four states in which typing means typing. Nothing here
 * re-lists today's keys: every binding case goes through the model, which is what keeps the feature
 * correct after the creator moves a shortcut.
 */

/** The creator's live `view.preferences.hotkeys`, copied from their state.json. */
const CREATOR_PREFERENCES = {
  overrides: {
    'workspace.group-selection': ['Ctrl+G'],
    'workspace.edit-set-membership': ['Shift+G'],
  },
};

function press(event = {}) {
  return {
    key: event.key ?? 'a',
    ctrlKey: event.ctrlKey ?? false,
    altKey: event.altKey ?? false,
    metaKey: event.metaKey ?? false,
    shiftKey: event.shiftKey ?? false,
    isComposing: event.isComposing ?? false,
    keyCode: event.keyCode ?? 0,
    repeat: event.repeat ?? false,
  };
}

const decide = (event = {}, context = {}) => planQuickRunTypeToRun(press(event), context);

test('a printable character on an empty canvas opens Quick Run seeded with that character', () => {
  assert.deepEqual(decide({ key: 'a' }), { kind: 'open', seed: 'a' });
  assert.deepEqual(decide({ key: 'k' }), { kind: 'open', seed: 'k' });
  assert.deepEqual(decide({ key: '7' }), { kind: 'open', seed: '7' });
  assert.deepEqual(decide({ key: 'ơ' }), { kind: 'open', seed: 'ơ' }, 'a Vietnamese letter is a printable character');
});

test('the seed is one character, never two and never none', () => {
  // The failure the creator expects first: a dropped or doubled opening letter. One keystroke is one
  // character in the line, whatever the surface then does with it.
  for (const key of ['a', 'z', 'L', 'ơ', 'Đ', 'ế', '5']) {
    const plan = decide({ key });
    assert.equal(plan.kind, 'open');
    assert.equal([...plan.seed].length, 1, `${key} seeds exactly one character`);
    assert.equal(plan.seed, key, 'and it is the character that was pressed');
  }
});

test('Shift plus a letter is a capital letter and types, not a chord', () => {
  assert.deepEqual(decide({ key: 'L', shiftKey: true }), { kind: 'open', seed: 'L' });
  assert.deepEqual(decide({ key: 'Ơ', shiftKey: true }), { kind: 'open', seed: 'Ơ' });
});

test('a letter an effective binding claims does the action instead of opening', () => {
  // The catalog's own bare-letter default: G groups the selection. Type-to-run must not shadow it.
  assert.deepEqual(decide({ key: 'g' }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.bound });
  assert.deepEqual(decide({ key: 'G' }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.bound });
});

test("the creator's own overrides decide, not the defaults: plain G is free now", () => {
  // Measured in their state.json: they rebound group-selection to Ctrl+G so that plain letters are free.
  const context = { preferences: CREATOR_PREFERENCES };
  assert.deepEqual(decide({ key: 'g' }, context), { kind: 'open', seed: 'g' }, 'the freed letter types');
  assert.deepEqual(
    decide({ key: 'G', shiftKey: true }, context),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.bound },
    'Shift+G is their edit-set-membership chord, and a chord wins over typing',
  );
  assert.deepEqual(
    decide({ key: 'g', ctrlKey: true }, context),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modifiers },
    'Ctrl+G is theirs',
  );
});

test('every modifier keeps the key for whatever already owns it', () => {
  assert.deepEqual(decide({ key: 'a', ctrlKey: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modifiers });
  assert.deepEqual(decide({ key: 'a', altKey: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modifiers });
  assert.deepEqual(decide({ key: 'a', metaKey: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modifiers });
});

test('AltGr is a modifier press, not a letter to open with', () => {
  // On Windows Chromium reports AltGr as Ctrl+Alt, and the character it produces is the layout's, not the
  // creator's search. Recorded as a limitation in the module note rather than guessed at here.
  assert.deepEqual(
    decide({ key: 'ł', ctrlKey: true, altKey: true }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modifiers },
  );
});

test('non-printable keys keep their current behaviour untouched', () => {
  for (const key of ['Enter', 'Delete', 'Backspace', 'F2', 'F5', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab', 'Home', 'End', 'PageDown', 'Shift', 'Control', 'Alt', 'Unidentified']) {
    assert.deepEqual(
      decide({ key }),
      { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.notPrintable },
      `${key} does not open Quick Run`,
    );
  }
});

test('Space is deliberately not an opening character', () => {
  // Narrower than "printable", and the only place this module is. Space is already an activation key in the
  // window-picking flow (workspace-20260730b.js `pickWindowStage`), the canvas handler for it runs on the
  // same document, and a query that is one space normalises to nothing - so opening on it would take a live
  // gesture to show an empty palette.
  assert.deepEqual(decide({ key: ' ' }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.space });
  assert.deepEqual(decide({ key: 'Spacebar' }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.notPrintable });
});

test('an IME composition is never interrupted, even by a printable key', () => {
  // The creator writes Vietnamese. A composition that opened the palette would be worse than not opening:
  // the marked text would be committed or dropped into a provider that has just been replaced.
  assert.deepEqual(
    decide({ key: 'a', isComposing: true }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.composing },
  );
  assert.deepEqual(
    decide({ key: 'a', keyCode: 229 }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.composing },
    'Chromium reports 229 for a key the IME processed',
  );
  assert.deepEqual(
    decide({ key: 'Process' }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.composing },
  );
  assert.deepEqual(
    decide({ key: 'Dead' }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.notPrintable },
    'a dead key is half a character and must be finished where it was started',
  );
});

test('a field, a live rename and an open dialog each keep their own typing', () => {
  assert.deepEqual(decide({ key: 'a' }, { editingTarget: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.field });
  assert.deepEqual(decide({ key: 'a' }, { renameLive: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.field });
  assert.deepEqual(decide({ key: 'a' }, { modalOpen: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.modal });
});

test('an open palette keeps the keys for itself', () => {
  assert.deepEqual(
    decide({ key: 'a' }, { paletteOpen: true }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.paletteOpen },
  );
});

test('holding a key down does not seed a second character', () => {
  assert.deepEqual(decide({ key: 'a', repeat: true }), { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.repeat });
});

test('a binding added to the catalog tomorrow wins without touching this module', () => {
  // The "do not hard-code today's key list" requirement, tested the only way that proves it: bind a letter
  // this module has never heard of, then free it again with an override.
  const catalog = createHotkeyCatalog([
    { id: 'probe.quiet', label: 'Quiet', group: 'Probe', scope: 'workspace', defaults: ['Q'] },
  ]);
  assert.deepEqual(
    decide({ key: 'q' }, { catalog }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.bound },
    'the new binding claims the key',
  );
  assert.deepEqual(
    decide({ key: 'q' }, { catalog, preferences: { overrides: { 'probe.quiet': ['Ctrl+Q'] } } }),
    { kind: 'open', seed: 'q' },
    'and an override that frees the letter gives it back to typing',
  );
});

test('a binding from another scope is not in force on the canvas', () => {
  // The prompt library's own keys are catalog entries too. Its scope is only live inside that dialog,
  // which is a modal the keyboard path never reaches - so an entry there must not block typing here.
  const catalog = createHotkeyCatalog([
    { id: 'probe.prompt-marker', label: 'Marker', group: 'Probe', scope: 'copy-prompts', defaults: ['X'] },
  ]);
  assert.deepEqual(decide({ key: 'x' }, { catalog }), { kind: 'open', seed: 'x' });
});

test('a native hover policy blocks only its effective bare-key bindings', () => {
  assert.deepEqual(
    planQuickRunTypeToRun(press({ key: 'g' }), { blockedBindings: ['G', 'Shift+X'] }),
    { kind: 'pass', reason: QUICK_RUN_TYPE_TO_RUN_PASS.bound },
  );
  assert.deepEqual(
    planQuickRunTypeToRun(press({ key: 'x' }), { blockedBindings: ['G', 'Shift+X'] }),
    { kind: 'open', seed: 'x' },
  );
  assert.deepEqual(
    planQuickRunTypeToRun(press({ key: 'g' }), { blockedBindings: [] }),
    { kind: 'open', seed: 'g' },
    'an authoritative widget policy can free a default letter through a creator override',
  );
});

test('while a seeded surface is opening, ordinary printable characters append before shortcut arbitration', () => {
  assert.deepEqual(
    planQuickRunTypeToRun(press({ key: 'g' }), { opening: true, blockedBindings: ['G'] }),
    { kind: 'append', text: 'g' },
  );
  assert.deepEqual(
    planQuickRunTypeToRun(press({ key: ' ' }), { opening: true }),
    { kind: 'append', text: ' ' },
  );
  assert.equal(planQuickRunTypeToRun(press({ key: 'g', altKey: true }), { opening: true }).kind, 'pass');
  assert.equal(planQuickRunTypeToRun(press({ key: 'g', repeat: true }), { opening: true }).kind, 'pass');
  assert.equal(planQuickRunTypeToRun(press({ key: 'g', isComposing: true }), { opening: true }).kind, 'pass');
});

test('the decision reads the event and changes nothing', () => {
  const event = press({ key: 'a' });
  const before = JSON.stringify(event);
  const first = planQuickRunTypeToRun(event, { preferences: CREATOR_PREFERENCES });
  const second = planQuickRunTypeToRun(event, { preferences: CREATOR_PREFERENCES });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(event), before, 'the planner is a decision, not an edit');
});

test('a missing or unusable event passes rather than throwing', () => {
  for (const event of [undefined, null, {}, { key: '' }, { key: 7 }]) {
    const plan = planQuickRunTypeToRun(event, {});
    assert.equal(plan.kind, 'pass');
  }
});
