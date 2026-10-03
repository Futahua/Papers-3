import {
  HOTKEY_CATALOG,
  HOTKEY_SCOPE_WORKSPACE,
  canonicalizeBinding,
  effectiveBindings,
} from '../hotkeys-model.js';

/**
 * Quick Run — type-to-run: the third way in, and the cheapest one.
 *
 * The creator's ruling: once they are inside the Papers canvas, typing is enough. A printable character
 * pressed on the canvas opens the palette with that character **already in the line** — the character that
 * opened it is the first thing in the query, exactly once. The chord stays for reaching Quick Run from
 * elsewhere, and the globally wired chords stay too; this is only for the reader who is already looking at
 * the canvas.
 *
 * Two rules give the feature its shape.
 *
 * **The bindings in force win, always.** This module never carries a list of today's keys. It asks the
 * hotkey model what is bound *including the creator's overrides* - `effectiveBindings` already answers
 * that - and a printable character that any workspace binding claims belongs to that binding and does its
 * action. It keeps working the day a shortcut is moved back onto a bare letter, because nothing here was
 * written down: the answer comes from state.
 *
 * **Typing means typing.** Four states keep their keys: a focused field, a live inline editor (the graph's
 * set-name editor is a `.set-name-editor`), an open dialog, and an IME composition. The first three are
 * the states where a character is already going somewhere; the fourth is the one that can destroy work,
 * and it is refused rather than served - see the note on composing below.
 *
 * This module decides, and nothing else: it reads an event-like object and the facts the caller already
 * has, and answers `open` with the seed or `pass` with the reason. It does not touch the DOM, the session
 * or the state.
 */

/** Why a keystroke was left alone. Every answer is named, so a caller can say what happened. */
export const QUICK_RUN_TYPE_TO_RUN_PASS = Object.freeze({
  /** A dialog (the editor, the confirmation, the link editor, the prompt library) is up. */
  modal: 'a-dialog-is-open',
  /** The palette is already up: its own line owns the keyboard, including the next characters typed. */
  paletteOpen: 'quick-run-is-already-open',
  /** Focus is in a field, or a rename/set-name editor is live. */
  field: 'focus-is-in-a-field',
  /** Ctrl, Alt or Meta is held - which includes AltGr, see the note below. */
  modifiers: 'a-modifier-key-is-held',
  /** An IME is composing. */
  composing: 'an-ime-composition-is-in-progress',
  /** The key is being held down: the first keydown already opened the palette. */
  repeat: 'the-key-is-auto-repeating',
  /** Space is not an opening character, on purpose. */
  space: 'space-is-an-activation-key-elsewhere',
  /** Not one printable character: Enter, Delete, F2, Escape, the arrows, Tab, a dead key, a bare modifier. */
  notPrintable: 'not-a-printable-character',
  /** A binding in force claims this key, so the key does its action and does not type. */
  bound: 'an-effective-binding-claims-the-key',
});

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * One printable character, and nothing else.
 *
 * Length in code points rather than UTF-16 units, so a Vietnamese letter outside the BMP is still one
 * character; `Dead`, `Process`, `Unidentified`, `F2`, `ArrowDown`, `Shift` and the empty string are all
 * longer than one and are left alone by the same test.
 */
function printableCharacter(key) {
  return typeof key === 'string' && [...key].length === 1 && !CONTROL_OR_FORMAT.test(key);
}

function modifierHeld(event) {
  return event.ctrlKey === true || event.altKey === true || event.metaKey === true;
}

/**
 * Whether an IME is mid-composition.
 *
 * `isComposing` is the standard signal; 229 is the keyCode Chromium reports for a key the IME processed,
 * and `key === 'Process'` is the same thing named instead of numbered. All three are checked because which
 * one arrives depends on the platform and the IME.
 *
 * A composing keystroke never opens the palette, and that is the deliberate choice the creator asked for:
 * opening would move focus out from under the composition, and a half-composed character committed into a
 * line that has just replaced its owner is worse than a gesture that did not fire. The cost is real and is
 * recorded rather than hidden: with nothing focused on the canvas there is no text field for a composition
 * to belong to, so a character composed there is lost either way - but it is not mangled, and the palette
 * does not appear in the middle of the creator's word.
 *
 * Not verifiable in this repository's disposable host: a real OS-level Vietnamese IME (UniKey, or the
 * Windows Telex layout) drives composition through the platform's text services, which no headless run can
 * install or press. What is verified is the browser's own composition path, driven through Chromium's IME
 * entry point; see the host probe.
 */
function composing(event) {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process';
}

/**
 * Whether an effective binding claims this keystroke.
 *
 * Only the workspace scope is consulted, because that is the scope in force on the canvas: the prompt
 * library's own entries are live inside that dialog, which is a modal this path never reaches, so an entry
 * there must not silently disable typing out here. `canonicalizeBinding` is the model's own converter, so
 * Shift is part of the question - a bare `G` and a `Shift+G` are different bindings and either can be the
 * one that is held.
 */
function bindingClaimsKey(event, preferences, catalog, blockedBindings = null) {
  const binding = canonicalizeBinding(event);
  if (binding === null) return false;
  // A supplied list is the owning workspace's complete effective binding set,
  // not an additive deny-list. The compact widget cannot reconstruct creator
  // overrides from its intentionally partial snapshot.
  if (Array.isArray(blockedBindings)) return blockedBindings.includes(binding);
  for (const action of catalog) {
    if (action.scope !== HOTKEY_SCOPE_WORKSPACE) continue;
    if (effectiveBindings(action.id, preferences, catalog).includes(binding)) return true;
  }
  return false;
}

/**
 * The decision. `{ kind: 'open', seed }` to open the palette on that character, `{ kind: 'pass', reason }`
 * to leave the keystroke exactly as it was.
 *
 * @param event a KeyboardEvent-like object: key, the four modifier flags, isComposing, keyCode, repeat
 * @param context preferences (the stored hotkeys object, overrides included), catalog, and the four states
 */
export function planQuickRunTypeToRun(event, context = {}) {
  const {
    preferences = {},
    catalog = HOTKEY_CATALOG,
    modalOpen = false,
    paletteOpen = false,
    editingTarget = false,
    renameLive = false,
    blockedBindings = null,
    opening = false,
  } = context ?? {};
  const pass = (reason) => ({ kind: 'pass', reason });
  if (!event || typeof event !== 'object') return pass(QUICK_RUN_TYPE_TO_RUN_PASS.notPrintable);

  if (modalOpen) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.modal);
  if (paletteOpen) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.paletteOpen);
  if (editingTarget || renameLive) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.field);
  // Modifiers first, so the reason names the modifier rather than the binding it happens to match. On
  // Windows Chromium reports AltGr as Ctrl+Alt, so a character typed with AltGr arrives here and passes:
  // it is a layout character, not the creator's search, and this is the one class of printable input that
  // cannot open the palette. Recorded as a limitation rather than guessed around.
  if (modifierHeld(event)) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.modifiers);
  if (composing(event)) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.composing);
  if (event.repeat === true) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.repeat);
  if (opening && printableCharacter(event.key)) return { kind: 'append', text: event.key };
  // Narrower than "printable", and the only place this module is: Space is already an activation key in
  // the window-picking flow, whose handler is on the same document, and a one-space query normalises to
  // nothing - so opening on it would take a live gesture to show an empty palette.
  if (event.key === ' ') return pass(QUICK_RUN_TYPE_TO_RUN_PASS.space);
  if (!printableCharacter(event.key)) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.notPrintable);
  if (bindingClaimsKey(event, preferences, catalog, blockedBindings)) return pass(QUICK_RUN_TYPE_TO_RUN_PASS.bound);

  // The seed is the character itself, so Shift has already done its work: `key` is the capital the reader
  // asked for. Exactly one character goes into the line, and the caller prevents the browser's own
  // insertion so it cannot arrive a second time.
  return { kind: 'open', seed: event.key };
}
