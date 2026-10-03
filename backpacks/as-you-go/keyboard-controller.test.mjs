import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createKeyboardController, EDITABLE_SELECTOR, TEXT_ENTRY_SELECTOR } from './public/app/interactions/keyboard-controller.js';

function fakeNode() {
  return { hidden: true };
}

function createHarness({ binMode = false, initialState = null, membershipMode = null, activeElement = null, commandSurface = false, beforeMount = null, afterMount = null } = {}) {
  const listeners = [];
  const documentMock = new EventTarget();
  documentMock.activeElement = activeElement;
  const addEventListener = documentMock.addEventListener.bind(documentMock);
  documentMock.addEventListener = (type, handler, options) => {
    const entry = { type, handler, options };
    listeners.push(entry);
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        const index = listeners.indexOf(entry);
        if (index >= 0) listeners.splice(index, 1);
      });
    }
    addEventListener(type, handler, options);
  };
  const elements = {
    editorLayer: fakeNode(), confirmLayer: fakeNode(), linkEditLayer: fakeNode(), promptLayer: fakeNode(),
    // Quick Run's own layer is part of the same vocabulary: `hidden` is the DOM's answer to "is the palette
    // up", and the controller already reads every other layer this way.
    quickRunLayer: fakeNode(),
  };
  const store = createWorkspaceStore({
    getState: () => initialState ?? {},
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const called = {
  quickRun: 0, quickRunSeeds: [],
    close: 0, permanentDelete: 0, beginPicker: 0, beginRename: 0, pickerOpens: true, status: [], paneToggles: 0,
  };
  const commandSpies = {};
  for (const name of [
    'clearSelection', 'selectAllVisible', 'copySelection', 'cutSelection',
    'pasteInto', 'pasteExternalClipboard', 'pasteClipboard', 'undo', 'redo', 'moveSelectionToBin', 'revealSelection',
    'activateItem', 'activateSelection', 'selectedPasteDestinations',
    'groupSelectionIntoSet', 'clearSetSelection', 'deleteSelectedSets',
  ]) {
    commandSpies[`${name}:calls`] = 0;
    commandSpies[`${name}:args`] = [];
    commandSpies[name] = (...args) => {
      commandSpies[`${name}:calls`] += 1;
      commandSpies[`${name}:args`].push(args);
    };
  }
  commandSpies.selectedPasteDestinations = () => ['dest'];
  const controller = createKeyboardController({
    document: documentMock,
    elements,
    store,
    commands: commandSpies,
    closeMenu: () => { called.close += 1; },
    getVisibleItemIds: () => ['a', 'b', 'c'],
    confirmDialog: { askPermanentDelete: () => { called.permanentDelete += 1; } },
    beginSetMembershipEdit: () => { called.beginPicker += 1; return called.pickerOpens; },
    setMembershipMode: membershipMode,
    setStatus: (text) => { called.status.push(text); },
    beginSetRename: () => { called.beginRename += 1; return true; },
    commandSurface,
    openQuickRun: (seed) => { called.quickRun += 1; called.quickRunSeeds.push(seed); return true; },
    toggleSidePanes: () => { called.paneToggles += 1; return true; },
  });
  beforeMount?.(documentMock);
  controller.mount();
  afterMount?.(documentMock);
  return { controller, store, elements, commandSpies, called, listeners, document: documentMock };
}

function key(event) {
  return {
    key: event.key ?? '',
    ctrlKey: event.ctrlKey ?? false,
    shiftKey: event.shiftKey ?? false,
    altKey: event.altKey ?? false,
    metaKey: event.metaKey ?? false,
    // The three fields type-to-run has to read to stay out of an IME's way. Absent in most tests, and
    // absent means "not composing", which is what a plain keydown from a plain keyboard looks like.
    isComposing: event.isComposing ?? false,
    keyCode: event.keyCode ?? 0,
    repeat: event.repeat ?? false,
    preventDefault() {},
  };
}

test('Escape clears the selection and closes the menu', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['clearSelection:calls'], 1);
  assert.equal(h.called.close, 1);
});

test('Ctrl+A selects all visible items', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 1);
});

test('Ctrl+C and Ctrl+X stay internal while Ctrl+V defers to the paste event', () => {
  const h = createHarness();
  const keydown = h.listeners.find((entry) => entry.type === 'keydown');
  keydown.handler(key({ key: 'c', ctrlKey: true }));
  keydown.handler(key({ key: 'x', ctrlKey: true }));
  keydown.handler(key({ key: 'v', ctrlKey: true }));
  assert.equal(h.commandSpies['copySelection:calls'], 1);
  assert.equal(h.commandSpies['cutSelection:calls'], 1);
  assert.equal(h.commandSpies['pasteInto:calls'], 0);
  assert.equal(h.commandSpies['pasteClipboard:calls'], 0);
});

test('paste event forwards browser clipboard files and text to clipboard arbitration', () => {
  const h = createHarness();
  let prevented = false;
  const pastedFile = { name: 'drawing.rvt' };
  const paste = h.listeners.find((entry) => entry.type === 'paste');
  paste.handler({
    defaultPrevented: false,
    target: { matches: () => false },
    clipboardData: {
      files: [pastedFile],
      getData: () => 'D:\\ignored-when-file-exists.txt',
    },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(h.commandSpies['pasteClipboard:calls'], 1);
  assert.deepEqual(h.commandSpies['pasteClipboard:args'][0], [
    { files: [pastedFile], text: 'D:\\ignored-when-file-exists.txt' },
    ['dest'],
  ]);
});

test('Ctrl+Z and Ctrl+Y route to undo/redo', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'z', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'y', ctrlKey: true }));
  assert.equal(h.commandSpies['undo:calls'], 1);
  assert.equal(h.commandSpies['redo:calls'], 1);
});

test('Delete moves to Bin outside Bin mode and asks permanent delete inside', () => {
  const explorer = createHarness({ binMode: false });
  explorer.store.setSelection(['a']);
  explorer.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(explorer.commandSpies['moveSelectionToBin:calls'], 1);

  const bin = createHarness({ binMode: true });
  bin.store.setSelection(['a']);
  bin.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(bin.called.permanentDelete, 1);
});

test('Enter activates a single selection or launches multiple', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['activateItem:calls'], 1);
  h.store.setSelection(['a', 'b']);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['activateSelection:calls'], 1);
});

test('Ctrl+Enter reveals the selection', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Enter', ctrlKey: true }));
  assert.equal(h.commandSpies['revealSelection:calls'], 1);
});

test('plain Tab toggles the paired Navigator and Preview panes only from workspace chrome', () => {
  const h = createHarness();
  let prevented = false;
  const event = key({ key: 'Tab' });
  event.preventDefault = () => { prevented = true; };
  h.listeners[0].handler(event);
  assert.equal(h.called.paneToggles, 1);
  assert.equal(prevented, true);

  const editing = createHarness({ activeElement: { matches: (selector) => selector.includes('input') } });
  editing.listeners[0].handler(key({ key: 'Tab' }));
  assert.equal(editing.called.paneToggles, 0, 'Tab remains native while an editable control owns focus');

  h.listeners[0].handler(key({ key: 'Tab', shiftKey: true }));
  assert.equal(h.called.paneToggles, 1, 'Shift+Tab remains native reverse focus');
});

test('Bin mode suppresses copy/cut/paste and destroys the listener', () => {
  const h = createHarness({ binMode: true });
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.ok(h.listeners.length > 0);
  h.controller.destroy();
  assert.equal(h.listeners.length, 0);
});

test('a visible dialog layer suppresses all workspace shortcuts', () => {
  const h = createHarness();
  h.elements.editorLayer.hidden = false;
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Delete' }));
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.equal(h.commandSpies['clearSelection:calls'], 0);
});

test('the visible prompt library suppresses all workspace shortcuts', () => {
  const h = createHarness();
  h.elements.promptLayer.hidden = false;
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'x', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'v', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'Delete' }));
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 0);
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.equal(h.commandSpies['cutSelection:calls'], 0);
  assert.equal(h.commandSpies['pasteInto:calls'], 0);
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.commandSpies['activateItem:calls'], 0);
  assert.equal(h.commandSpies['clearSelection:calls'], 0, 'workspace Escape is ignored while the library is open');
});

test('prompt modal shortcuts leave the workspace store state completely unchanged', () => {
  const initialState = {
    groups: [
      { id: 'g-letters', name: 'Letters', parentId: 'root', order: 0 },
      { id: 'g-run', name: 'Run', parentId: 'g-letters', order: 0 },
    ],
    shortcuts: [
      { id: 's-slop', name: 'slop', target: 'C:\\slop', placements: [{ id: 'p1', parentId: 'g-run', order: 0 }] },
    ],
    view: { iconSize: 96 },
  };
  const h = createHarness({ initialState });
  h.elements.promptLayer.hidden = false;
  h.store.setSelection(['g-letters']);
  const before = structuredClone(h.store.getSnapshot());
  for (const event of [
    key({ key: 'a', ctrlKey: true }),
    key({ key: 'c', ctrlKey: true }),
    key({ key: 'x', ctrlKey: true }),
    key({ key: 'v', ctrlKey: true }),
    key({ key: 'Delete' }),
    key({ key: 'Enter' }),
    key({ key: 'Escape' }),
  ]) {
    h.listeners[0].handler(event);
  }
  assert.deepEqual(h.store.getSnapshot(), before, 'no workspace record, placement, selection, or view changed');
});

test('Ctrl+Shift+Z routes only to redo', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'z', ctrlKey: true, shiftKey: true }));
  assert.equal(h.commandSpies['redo:calls'], 1);
  assert.equal(h.commandSpies['undo:calls'], 0);
});

test('paste event passes selected destinations even when AYG has an internal clipboard', () => {
  const h = createHarness();
  h.store.setClipboard({ mode: 'copy', ids: ['a'], collapseWhole: new Set(), placementIds: new Map() });
  h.listeners.find((entry) => entry.type === 'paste').handler({
    defaultPrevented: false,
    target: { matches: () => false },
    clipboardData: { files: [], getData: () => '' },
    preventDefault() {},
  });
  assert.deepEqual(h.commandSpies['pasteClipboard:args'][0], [{ files: [], text: '' }, ['dest']]);
});

// ===========================================================================
// Sets. The ordering rules matter more than the bindings: with a set selected,
// Delete and Escape must act on the set, not on the items inside it.
// ===========================================================================

test('G groups the selection', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'g' }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 1);
});

test('custom workspace bindings replace defaults and clearing disables the default', () => {
  const h = createHarness({ initialState: {
    view: { preferences: { hotkeys: { overrides: {
      'workspace.group-selection': ['Ctrl+Shift+K'],
      'workspace.copy': [],
    } } } },
  } });
  h.listeners[0].handler(key({ key: 'g' }));
  h.listeners[0].handler(key({ key: 'k', ctrlKey: true, shiftKey: true }));
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 1);
  assert.equal(h.commandSpies['copySelection:calls'], 0);
});

test('set rename stays on the catalog action and does not use the old default after remapping', () => {
  const h = createHarness({ initialState: {
    view: { preferences: { hotkeys: { overrides: { 'sets.rename-selected': ['Ctrl+R'] } } } },
  } });
  h.listeners[0].handler(key({ key: 'F2' }));
  h.listeners[0].handler(key({ key: 'r', ctrlKey: true }));
  assert.equal(h.called.beginRename, 1);
});

test('rename editor keeps workspace hotkeys and native editing keys inert', () => {
  const activeElement = { matches: (selector) => selector.includes('.set-name-editor') };
  const h = createHarness({ activeElement });
  const events = ['g', 'Delete', 'F2'].map((keyName) => {
    let prevented = false;
    const event = key({ key: keyName });
    event.preventDefault = () => { prevented = true; };
    h.listeners[0].handler(event);
    return prevented;
  });
  assert.deepEqual(events, [false, false, false]);
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 0);
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.called.beginRename, 0);
});

test('the Quick Run chord is not swallowed by the editable guard (measured on the live machine)', () => {
  // Reported from the real machine: the chord did nothing at all while any input had focus, so the palette
  // could not be reopened - or dismissed with its own chord - until the creator clicked somewhere else. The
  // chord is an explicit Alt accelerator that types nothing into a text field, so a focused input is no
  // reason to ignore it. The second half holds the guard's actual job: text editing still owns its own keys.
  const h = createHarness({ activeElement: { matches: (selector) => selector.includes('input') } });
  h.listeners[0].handler(key({ key: 'a', altKey: true }));
  assert.equal(h.called.quickRun, 1, 'the chord reaches the surface even though an input has focus');

  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 0, 'Ctrl+A in a text field is still the field\'s own');

  // And the same chord arriving from the field itself, which is what a keypress inside the palette looks like.
  const typed = createHarness();
  const event = key({ key: 'a', altKey: true });
  event.target = { matches: (selector) => selector.includes('input') };
  typed.listeners[0].handler(event);
  assert.equal(typed.called.quickRun, 1, 'the chord works from inside the input it is typed into');
});

test('the bare-letter chord reaches Quick Run from inside a field and types nothing (Alt+A)', () => {
  // Alt+A is one modifier and one letter, so the exemption this chord gets from the editable guard matters
  // far more than it did for Alt+Shift+X: this is exactly the case where a workspace chord could steal an
  // ordinary keystroke from a field the creator is typing in.
  const h = createHarness({ activeElement: { matches: (selector) => selector.includes('input') } });
  let prevented = false;
  const event = key({ key: 'a', altKey: true });
  event.preventDefault = () => { prevented = true; };

  h.listeners[0].handler(event);

  assert.equal(h.called.quickRun, 1, 'the chord opens Quick Run even though a field has focus');
  assert.equal(prevented, true, 'and the letter never reaches that field: the default is prevented');
});

test('the chord Alt+A replaced no longer opens Quick Run', () => {
  const h = createHarness();
  let prevented = false;
  const event = key({ key: 'X', altKey: true, shiftKey: true });
  event.preventDefault = () => { prevented = true; };

  h.listeners[0].handler(event);

  assert.equal(h.called.quickRun, 0, 'Alt+Shift+X is bound to nothing now');
  assert.equal(prevented, false, 'and it is left alone rather than swallowed');
});

test('G is a plain key, so Ctrl+G does not also group', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'g', ctrlKey: true }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 0, 'grouping did not fire');
  assert.equal(h.called.beginPicker, 1, 'the picker did');
});

test('Ctrl+G with nothing selected says so rather than failing silently', () => {
  const h = createHarness();
  h.called.pickerOpens = false;
  h.listeners[0].handler(key({ key: 'g', ctrlKey: true }));
  assert.match(h.called.status.at(-1), /Select items first/);
});

test('Delete with a set selected removes the grouping, not the items', () => {
  const h = createHarness();
  h.store.setSelection(['a', 'b']);
  h.store.setSelectedSets(['s1']);
  h.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(h.commandSpies['deleteSelectedSets:calls'], 1);
  assert.equal(
    h.commandSpies['moveSelectionToBin:calls'], 0,
    'binning a set contents because a set was selected would be a bad surprise',
  );
});

test('Delete with no set selected still bins the item selection', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 1);
  assert.equal(h.commandSpies['deleteSelectedSets:calls'], 0);
});

test('Escape dismisses a set selection before touching the items', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.store.setSelectedSets(['s1']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['clearSetSelection:calls'], 1);
  assert.equal(
    h.commandSpies['clearSelection:calls'], 0,
    'one Escape undoes one thing',
  );
});

test('Escape cancels the picker before either selection', () => {
  let cancelled = 0;
  const h = createHarness({
    membershipMode: { isActive: () => true, cancel: () => { cancelled += 1; }, confirm: async () => {} },
  });
  h.store.setSelectedSets(['s1']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(cancelled, 1);
  assert.equal(h.commandSpies['clearSetSelection:calls'], 0);
});

test('Enter confirms the picker while it is open', () => {
  let confirmed = 0;
  const h = createHarness({
    membershipMode: { isActive: () => true, cancel: () => {}, confirm: async () => { confirmed += 1; } },
  });
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(confirmed, 1);
});

test('the Quick Run chord reaches the callback the entry file supplies', () => {
  const h = createHarness();
  let prevented = 0;
  h.listeners[0].handler({
    key: 'a',
    code: 'KeyA',
    altKey: true,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() { prevented += 1; },
  });
  assert.equal(h.called.quickRun, 1, 'the chord must reach the callback');
  assert.equal(prevented, 1, 'and the key must not also do whatever it otherwise would');
  // The rest of the workspace is untouched by it.
  assert.equal(h.commandSpies['clearSelection:calls'], 0);
  assert.equal(h.called.close, 0);
});

/* Type-to-run: on the canvas, a printable character that no binding claims opens the palette with that
   character already in the line. The creator's ruling, and the third way in beside the chord and whatever
   Lane 4 is wiring globally. These tests are about the wiring: which events reach the callback, with what,
   and which states keep their keys. The decision itself is held in quick-run-type-to-run.test.mjs. */
test('a printable character on the canvas opens Quick Run seeded with that character, once', () => {
  const h = createHarness();
  let prevented = 0;
  const event = key({ key: 'l' });
  event.preventDefault = () => { prevented += 1; };
  h.listeners[0].handler(event);

  assert.equal(h.called.quickRun, 1, 'the letter reaches the callback');
  assert.deepEqual(h.called.quickRunSeeds, ['l'], 'and it carries the character that opened it, as the seed');
  assert.equal(prevented, 1, 'the default is prevented, so the browser cannot insert a second copy of it');
  assert.equal(h.commandSpies['activateItem:calls'], 0, 'and nothing else in the workspace ran');
});

test('the binding in force wins over type-to-run, read through the model rather than a key list', () => {
  // The catalog's bare-letter default: G groups the selection. Type-to-run must yield to it, and the
  // evidence that it did is that the command ran and the palette did not open.
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'g' }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 1, 'the bound key did its action');
  assert.equal(h.called.quickRun, 0, 'and did not open the palette');
});

test("the creator's own overrides are what decides it: plain G opens once group-selection is Ctrl+G", () => {
  // Their live state.json, verbatim. This is the authority for the feature: they moved the one bare-letter
  // default off a plain letter themselves, so plain letters are free on their machine.
  const h = createHarness({
    initialState: {
      view: {
        preferences: {
          hotkeys: {
            overrides: {
              'workspace.group-selection': ['Ctrl+G'],
              'workspace.edit-set-membership': ['Shift+G'],
            },
          },
        },
      },
    },
  });
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'g' }));
  assert.equal(h.called.quickRun, 1, 'the freed letter types');
  assert.deepEqual(h.called.quickRunSeeds, ['g']);
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 0, 'and the old default no longer groups');

  // Shift+G is theirs now, so it is a chord even though Shift plus a letter is otherwise a capital.
  h.listeners[0].handler(key({ key: 'G', shiftKey: true }));
  assert.equal(h.called.beginPicker, 1, 'their rebound chord runs its action');
  assert.equal(h.called.quickRun, 1, 'and is not a second type-to-run');
});

test('Shift plus a letter types a capital when nothing claims it', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'L', shiftKey: true }));
  assert.deepEqual(h.called.quickRunSeeds, ['L'], 'the capital the reader asked for, not a lowercase l');
});

test('typing in a field, in a rename or under a dialog stays typing', () => {
  const inField = createHarness({ activeElement: { matches: (selector) => selector.includes('input') } });
  inField.listeners[0].handler(key({ key: 'l' }));
  assert.equal(inField.called.quickRun, 0, 'a focused field owns its letters');

  const renaming = createHarness();
  const event = key({ key: 'l' });
  event.target = { matches: (selector) => selector.includes('.set-name-editor') };
  renaming.listeners[0].handler(event);
  assert.equal(renaming.called.quickRun, 0, 'a live set-name editor owns its letters');

  const modal = createHarness();
  modal.elements.editorLayer.hidden = false;
  modal.listeners[0].handler(key({ key: 'l' }));
  assert.equal(modal.called.quickRun, 0, 'an open dialog owns every key');
});

test('a composing keystroke never opens the palette', () => {
  // The creator writes Vietnamese. Opening on the first half of a composed character would move focus out
  // from under the composition, so the composition is left alone - it is worth more than the gesture.
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'l', isComposing: true }));
  h.listeners[0].handler(key({ key: 'l', keyCode: 229 }));
  assert.equal(h.called.quickRun, 0);
});

test('the open palette keeps its own keys: Escape is not also a workspace Escape', () => {
  // Measured risk, not a hypothetical: the palette's own handler preventDefaults Escape but does not stop
  // it propagating, so before this guard one Escape closed the palette and cleared the selection behind it -
  // two things undone by one keystroke, and the reader returned somewhere they never were.
  const h = createHarness();
  h.elements.quickRunLayer.hidden = false;
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['clearSelection:calls'], 0, 'Escape closing the palette must not also clear the selection');
  assert.equal(h.called.close, 0, 'and must not close the menu behind it either');
  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 0, 'Ctrl+A belongs to the search line while it is open');
  h.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0, 'and Delete must not bin anything behind the palette');
  h.listeners[0].handler(key({ key: 'a', altKey: true }));
  assert.equal(h.called.quickRun, 1, 'but the chord it was opened with still reaches it, so it can be dismissed');
});

test('the chord punches through every modal layer, and nothing else does', () => {
  // The reviewer's ruling: the creator asked for this chord to work from inside other applications
  // entirely, so blocking it inside Papers' own dialogs is incoherent. Quick Run is a transient
  // interruption, not a modal resolution - opening it resolves nothing underneath.
  for (const layer of ['editorLayer', 'confirmLayer', 'linkEditLayer', 'promptLayer']) {
    const h = createHarness();
    h.elements[layer].hidden = false;
    h.store.setSelection(['a']);
    let prevented = 0;
    const event = key({ key: 'a', altKey: true });
    event.preventDefault = () => { prevented += 1; };
    h.listeners[0].handler(event);
    assert.equal(h.called.quickRun, 1, `the chord reaches the surface through an open ${layer}`);
    assert.equal(prevented, 1, 'and the key does not also do whatever it otherwise would');
    // Everything the modal owns stays the modal's. If any of these fired, the chord would not be a
    // transient interruption but a resolution of the thing underneath it.
    for (const other of [key({ key: 'Escape' }), key({ key: 'Delete' }), key({ key: 'c', ctrlKey: true }), key({ key: 'Enter' })]) {
      h.listeners[0].handler(other);
    }
    assert.equal(h.commandSpies['clearSelection:calls'], 0, `${layer}: Escape still belongs to the dialog`);
    assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0, `${layer}: Delete still belongs to the dialog`);
    assert.equal(h.commandSpies['copySelection:calls'], 0, `${layer}: Ctrl+C still belongs to the dialog`);
    assert.equal(h.commandSpies['activateItem:calls'], 0, `${layer}: Enter still belongs to the dialog`);
    assert.equal(h.called.close, 0, `${layer}: the menu is not closed behind it`);
    assert.equal(h.called.quickRun, 1, `${layer}: and no second open happened`);
  }
});

test('the chord punches through, and a printable character does not', () => {
  // The counterpart of the ruling, in the same state: the chord is a deliberate accelerator, while a letter
  // typed under a dialog belongs to whatever the dialog is doing - and to the field the reader is in.
  const h = createHarness();
  h.elements.promptLayer.hidden = false;
  h.listeners[0].handler(key({ key: 'l' }));
  assert.equal(h.called.quickRun, 0, 'a letter does not open Quick Run from under a dialog');
});

test('the two editable selectors are the shapes they claim to be', () => {
  // This is here because the host caught what the harness could not: the node mock answers `matches()` by
  // looking for a substring, so an INVALID CSS selector passes every test in this file and then throws in
  // Chromium - where `Element.matches()` throws on a bad selector, the keydown handler dies quietly, and
  // type-to-run simply never appears. Two wrong shapes were written before this test existed: a bare
  // `:not(...)` selector-list item (which also matches body, so every keystroke looked like typing) and an
  // array joined with '' (which fused `textarea` onto the last `:not()`). Neither had a comma problem the
  // node tests could see, so the shape is pinned here instead.
  assert.match(TEXT_ENTRY_SELECTOR, /^input:not\(\[type="range"\]\)/, 'the text-entry test starts at the input type');
  assert.match(TEXT_ENTRY_SELECTOR, /, textarea, \[contenteditable="true"\], \.set-name-editor$/, 'and the other subjects are separate list items, after commas');
  assert.equal(TEXT_ENTRY_SELECTOR.includes(')textarea'), false, 'no compound was fused together');
  assert.equal(TEXT_ENTRY_SELECTOR.split(',').length, 4, 'four subjects, four items');
  for (const excluded of ['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit', 'reset', 'image']) {
    assert.equal(TEXT_ENTRY_SELECTOR.includes(`[type="${excluded}"]`), true, `${excluded} is excluded`);
  }
  assert.equal(EDITABLE_SELECTOR, 'input, textarea, [contenteditable="true"], .set-name-editor', 'the wider guard is unchanged');
});

test('a claimed picker Delete keydown is not also dispatched as a workspace delete', () => {
  let pickerCommits = 0;
  let sameTargetListenerRanAfterPicker = false;
  const h = createHarness({
    beforeMount(document) {
      // The picker listener is registered on the same document before the
      // workspace controller. stopPropagation must not suppress later listeners
      // on this target, so the controller must honor defaultPrevented itself.
      document.addEventListener('keydown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pickerCommits += 1;
      });
    },
    afterMount(document) {
      document.addEventListener('keydown', () => { sameTargetListenerRanAfterPicker = true; });
    },
  });
  h.store.setSelection(['a']);
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, {
    key: { value: 'Delete' },
    ctrlKey: { value: false },
    shiftKey: { value: false },
    altKey: { value: false },
    metaKey: { value: false },
    isComposing: { value: false },
    keyCode: { value: 0 },
    repeat: { value: false },
  });

  h.document.dispatchEvent(event);

  assert.equal(pickerCommits, 1, 'picker owns the key once');
  assert.equal(sameTargetListenerRanAfterPicker, true, 'stopPropagation does not stop same-document listeners');
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.called.permanentDelete, 0);
  assert.equal(h.commandSpies['deleteSelectedSets:calls'], 0);
});

test('the global command surface does not let the host Alt+A keydown toggle Quick Run closed', () => {
  const h = createHarness({ commandSurface: true });
  h.listeners[0].handler(key({ key: 'a', altKey: true }));
  assert.equal(h.called.quickRun, 0);
});
