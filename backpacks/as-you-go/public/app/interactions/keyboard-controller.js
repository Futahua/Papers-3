import { HOTKEY_CATALOG, bindingMatchesAction } from '../hotkeys-model.js';
import { planQuickRunTypeToRun } from '../quick-run/quick-run-type-to-run.js';

/** A control that owns the keyboard while it has focus: a workspace key must not be taken from it. */
export const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"], .set-name-editor';

/**
 * A control that TYPING goes into - the narrower question type-to-run has to ask.
 *
 * The two are not the same, and the difference was measured rather than assumed: `#backdrop-opacity-slider`
 * is an `input[type=range]`, it matches the editable selector, and with it focused a letter did nothing at
 * all - not the slider's, and (before this) not type-to-run's either. A slider takes no text, so it is not a
 * place where typing means typing, and the feature has to keep working there.
 *
 * The exclusions are the input types that cannot hold text, and the list is written as exclusions on
 * purpose: an input type not named here still counts as a text control, so an unfamiliar one fails towards
 * "refuse to open" rather than towards stealing a keystroke from a field. The wider EDITABLE_SELECTOR is
 * unchanged, so every other workspace key behaves exactly as it did.
 *
 * It is one plain string, and that matters: this selector is only checked by a CSS engine, and the node
 * harness has none. Two wrong shapes were built here first - a bare `:not(...)` list item, which also
 * matches body and so treated every keystroke as typing, and an array joined with the empty string, which
 * fused `textarea` onto the end of the last `:not()` and made the whole list invalid. `Element.matches()`
 * throws on an invalid selector, which kills the keydown handler quietly: in the host the feature simply
 * never appeared. Do not build this string; keep it literal, and keep the shape test below honest.
 */
export const TEXT_ENTRY_SELECTOR = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, [contenteditable="true"], .set-name-editor';

const isOneOf = (target, selector) => Boolean(target?.matches?.(selector));

/** Translates keyboard events into plain command inputs. The controller only
 * reads session state and DOM, then delegates session/persistence/host work
 * to the command layer — it never mutates document or session state itself. */
export function createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds,
  confirmDialog,
  // Ctrl+G membership picking. Optional so the controller still mounts in
  // tests and contexts that have no set support.
  beginSetMembershipEdit = () => false,
  setMembershipMode = null,
  setStatus = () => {},
  beginSetRename = () => false,
  commandSurface = false,
  // Quick Run (STAGE 5). The controller reports the chord and nothing more: opening the
  // surface is the entry file's job, so this stays inert until something passes a callback.
  openQuickRun = () => false,
  toggleSidePanes = () => false,
}) {
  let abortController = null;

  function mount() {
    abortController = new AbortController();
    document.addEventListener('keydown', (event) => {
      // A picker can claim a keydown earlier on this same document. preventDefault
      // does not stop other listeners on the target, and stopPropagation only
      // affects later targets, so do not also route that key into the workspace.
      if (event.defaultPrevented) return;
      // Alt+A is owned by the Papers host while this renderer is the global
      // command surface. The native accelerator opened this page and the
      // Quick Run surface is already visible; letting the same keydown reach
      // the workspace controller would toggle it closed immediately.
      if (commandSurface) return;
      const session = store.getSession();
      const preferences = store.getSnapshot?.()?.view?.preferences?.hotkeys ?? {};
      const matches = (actionId) => bindingMatchesAction(actionId, event, preferences, HOTKEY_CATALOG);
      // Any modal layer (including the prompt library) takes over keyboard handling: while the prompt
      // library is open the tree controller owns tree shortcuts and editable controls keep native text
      // behavior.
      //
      // The Quick Run chord is the one key that punches through, at the reviewer's ruling: the creator asked
      // for it to work from inside other applications entirely, so refusing it inside Papers' own dialogs is
      // incoherent. Quick Run is a transient interruption, not a modal resolution - opening it must not save,
      // discard or close anything underneath, and it leaves the underlying control's buffer exactly as it
      // found it. Everything else still belongs to the dialog.
      const modalOpen = !elements.editorLayer.hidden || !elements.confirmLayer.hidden
        || !elements.linkEditLayer.hidden || !elements.promptLayer.hidden;
      if (modalOpen && !matches('workspace.quick-run')) return;
      // The Quick Run palette owns the keyboard while it is up, exactly as the modal layers above do. Its
      // own handler consumes Escape, Tab, Enter and the arrows and calls preventDefault on them — but it
      // does not stop them propagating, so without this guard every one of those keys ALSO did its
      // workspace job. Measured on the canvas: one Escape closed the palette and cleared the selection
      // behind it, which is two things undone by one keystroke and the reader returned somewhere they never
      // were. Ctrl+A in the search line selected every item behind it for the same reason. The chord is
      // exempt because it has to be able to dismiss the palette it opened.
      if (elements.quickRunLayer?.hidden === false && !matches('workspace.quick-run')) return;
      // An editable control owns its keys: while a field has focus, Enter, Escape, the arrows and the
      // clipboard chords are the field's own and must not reach the workspace. The one exception is the Quick
      // Run chord, an explicit Alt+Shift accelerator that types nothing into a field - measured on the live
      // machine, this guard swallowed it whenever any input had focus, so the palette could not be reopened,
      // or dismissed with its own chord, until the creator clicked somewhere else.
      const editingTarget = isOneOf(event.target, EDITABLE_SELECTOR)
        || isOneOf(document.activeElement, EDITABLE_SELECTOR);
      // The same question asked narrowly: is this a control that TEXT goes into? The two differ for the
      // controls that take no text at all - an `input[type=range]`, which is the opacity sliders - and
      // type-to-run is offered there. See TEXT_ENTRY_SELECTOR.
      const typingTarget = isOneOf(event.target, TEXT_ENTRY_SELECTOR)
        || isOneOf(document.activeElement, TEXT_ENTRY_SELECTOR);
      // One call site, used from both places below, so the two paths cannot drift apart. Type-to-run is the
      // creator's third way in, and the cheapest: a printable character that nothing claims opens the
      // palette with that character already in the line. The decision, including every reason to stay out of
      // an IME's or a field's way, is in quick-run/quick-run-type-to-run.js.
      const openOnTypedCharacter = () => {
        const typed = planQuickRunTypeToRun(event, { preferences, editingTarget: typingTarget });
        if (typed.kind !== 'open') return false;
        // The browser's own insertion is suppressed so the character cannot arrive twice - once by the
        // default action, once by the seeded line - and the palette is opened on it.
        event.preventDefault();
        openQuickRun(typed.seed);
        return true;
      };
      if (editingTarget && !matches('workspace.quick-run')) {
        // A control that holds text owns the letters; a control that cannot hold text owns nothing of the
        // sort, so a letter goes to type-to-run rather than nowhere. Measured in the host: with an opacity
        // slider focused, a letter did nothing at all before this line existed.
        if (!typingTarget) openOnTypedCharacter();
        return;
      }
      if (
        event.key === 'Tab'
        && !event.shiftKey
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && toggleSidePanes()
      ) {
        event.preventDefault();
        return;
      }

      // In Bin mode, cut/copy/paste must not reach the host's clipboard.
      if (session.binMode && (
        matches('workspace.copy') || matches('workspace.cut') || matches('workspace.paste')
      )) {
        event.preventDefault();
        return;
      }
      if (matches('workspace.escape')) {
        // Close the menu before clearing/syncing/saving, matching the
        // original handler's sequence.
        closeMenu();
        // A live set selection is dismissed first and on its own. Clearing
        // both at once would make one Escape undo two different things.
        if (setMembershipMode?.isActive()) {
          setMembershipMode.cancel();
          return;
        }
        if (session.selectedSets.size > 0) {
          commands.clearSetSelection();
          return;
        }
        commands.clearSelection();
        return;
      }
      if (matches('workspace.quick-run')) {
        event.preventDefault();
        openQuickRun();
        return;
      }
      // Plain G groups. No modifier, so it must not fire while the user is
      // typing — the guard above already returned for editable layers.
      if (matches('workspace.group-selection')) {
        event.preventDefault();
        void commands.groupSelectionIntoSet();
        return;
      }
      if (matches('sets.rename-selected')) {
        event.preventDefault();
        beginSetRename();
        return;
      }
      if (matches('workspace.edit-set-membership')) {
        event.preventDefault();
        if (!beginSetMembershipEdit()) {
          setStatus('Select items first, then press Ctrl+G to change their sets.');
        }
        return;
      }
      if (setMembershipMode?.isActive() && matches('workspace.open-selection')) {
        event.preventDefault();
        void setMembershipMode.confirm();
        return;
      }
      if (matches('workspace.select-all')) {
        event.preventDefault();
        commands.selectAllVisible(getVisibleItemIds());
        return;
      }
      if (matches('workspace.copy')) {
        event.preventDefault();
        commands.copySelection();
        return;
      }
      if (matches('workspace.cut')) {
        event.preventDefault();
        commands.cutSelection();
        return;
      }
      if (matches('workspace.paste')) {
        return;
      }
      if (matches('workspace.undo')) {
        event.preventDefault();
        commands.undo();
        return;
      }
      if (matches('workspace.redo')) {
        event.preventDefault();
        commands.redo();
        return;
      }
      // Checked before the item branch: with a set selected, Delete removes
      // the grouping and leaves the items alone. Binning a set's contents
      // because a set was selected would be a bad surprise, and the two
      // selections are separate precisely so this choice can be made.
      if (matches('workspace.delete') && session.selectedSets.size > 0) {
        event.preventDefault();
        void commands.deleteSelectedSets();
        return;
      }
      if (matches('workspace.delete') && session.selected.size > 0) {
        event.preventDefault();
        if (session.binMode) confirmDialog.askPermanentDelete();
        else commands.moveSelectionToBin();
        return;
      }
      if (matches('workspace.reveal-selection') && session.selected.size > 0 && !session.binMode) {
        event.preventDefault();
        commands.revealSelection();
        return;
      }
      if (matches('workspace.open-selection') && session.selected.size === 1 && !session.binMode) {
        event.preventDefault();
        commands.activateItem([...session.selected][0]);
        return;
      }
      if (matches('workspace.open-selection') && session.selected.size > 1 && !session.binMode) {
        event.preventDefault();
        commands.activateSelection();
        return;
      }
      // Type-to-run's last chance, and it is LAST on purpose: every branch above has already had its turn,
      // so a key that a binding in force claims does its action and never types, by construction rather than
      // by a list kept in step by hand.
      openOnTypedCharacter();
    }, { signal: abortController.signal });

    document.addEventListener('paste', (event) => {
      if (event.defaultPrevented || commandSurface) return;
      const session = store.getSession();
      if (session.binMode) return;
      const modalOpen = !elements.editorLayer.hidden || !elements.confirmLayer.hidden
        || !elements.linkEditLayer.hidden || !elements.promptLayer.hidden;
      if (modalOpen || elements.quickRunLayer?.hidden === false) return;
      const editingTarget = isOneOf(event.target, EDITABLE_SELECTOR)
        || isOneOf(document.activeElement, EDITABLE_SELECTOR);
      if (editingTarget) return;

      const clipboardData = event.clipboardData;
      const files = clipboardData ? [...clipboardData.files] : [];
      const text = clipboardData?.getData?.('text/plain') ?? '';

      event.preventDefault();
      void commands.pasteClipboard(
        { files, text },
        commands.selectedPasteDestinations(),
      );
    }, { signal: abortController.signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy };
}
