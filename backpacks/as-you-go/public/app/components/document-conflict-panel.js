/**
 * 0B: what the creator sees when a save was refused.
 *
 * The board changed somewhere else before this surface's change could save.
 * Both versions exist and only the creator can say which should survive, so
 * this panel states that plainly and offers exactly two ways out. It is
 * deliberately NOT modal: the conflict is not an interruption to dismiss, it is
 * a state the surface stays in, and reading, navigating and copying remain
 * available while it is up.
 *
 * The confirmation belongs on "Keep my version" alone, because that is the one
 * action that can erase work saved elsewhere. Choosing the latest version only
 * discards this surface's unsaved change, which is the creator's own and is
 * still on screen in front of them.
 *
 * No JSON, no revisions and no code are shown. The creator does not resolve
 * this by reading a document.
 */

export const CONFLICT_PANEL_CLASS = 'document-conflict-panel';

const CONFLICT_MESSAGE =
  'This board changed somewhere else before your last change could save. Your version is still here, but it is not saved.';

const KEEP_MINE_CONFIRMATION = 'This will replace changes saved elsewhere.';

/** Lightweight, transient feedback for an ordinary view — not this panel. A
 * blocked edit in a plain view is normal and expected, not a conflict. */
export const VIEW_BLOCKED_MESSAGE = 'Another view is currently editing this board.';

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {() => Promise<unknown>} options.onUseLatest
 * @param {() => Promise<unknown>} options.onKeepMine  Called only after the
 *        creator confirms the destructive choice.
 * @param {(message: string) => Promise<boolean>} options.confirm  The project's
 *        existing confirmation dialog.
 */
export function createDocumentConflictPanel({ document, onUseLatest, onKeepMine, confirm }) {
  let element = null;
  let busy = false;

  function build() {
    const panel = document.createElement('section');
    panel.className = CONFLICT_PANEL_CLASS;
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');

    const message = document.createElement('p');
    message.className = `${CONFLICT_PANEL_CLASS}__message`;
    message.textContent = CONFLICT_MESSAGE;
    panel.appendChild(message);

    const actions = document.createElement('div');
    actions.className = `${CONFLICT_PANEL_CLASS}__actions`;

    const useLatest = document.createElement('button');
    useLatest.type = 'button';
    useLatest.className = `${CONFLICT_PANEL_CLASS}__use-latest`;
    useLatest.textContent = 'Use latest version';
    useLatest.addEventListener('click', () => { void run(onUseLatest); });

    const keepMine = document.createElement('button');
    keepMine.type = 'button';
    keepMine.className = `${CONFLICT_PANEL_CLASS}__keep-mine`;
    keepMine.textContent = 'Keep my version';
    keepMine.addEventListener('click', () => {
      void run(async () => {
        const confirmed = await confirm(KEEP_MINE_CONFIRMATION);
        if (!confirmed) return undefined;
        return onKeepMine();
      });
    });

    actions.appendChild(useLatest);
    actions.appendChild(keepMine);
    panel.appendChild(actions);
    return panel;
  }

  /** Both recovery actions talk to disk, so the pair is disabled while one is
   * in flight. Double-clicking "Keep my version" must not race itself. */
  async function run(action) {
    if (busy) return;
    busy = true;
    setDisabled(true);
    try {
      await action();
    } finally {
      busy = false;
      setDisabled(false);
    }
  }

  function setDisabled(disabled) {
    if (!element) return;
    for (const button of element.querySelectorAll('button')) button.disabled = disabled;
  }

  return {
    get element() { return element; },
    get visible() { return element !== null; },

    show(host) {
      if (element) return element;
      element = build();
      host.appendChild(element);
      return element;
    },

    hide() {
      if (!element) return;
      element.remove();
      element = null;
      busy = false;
    },

    /** Follow the coordinator: CONFLICT shows the panel, any other role
     * removes it. Recovery therefore clears the panel through the same path
     * that changed the role, with no second source of truth. */
    syncToRole(role, host) {
      if (role === 'conflict') return this.show(host);
      this.hide();
      return null;
    },
  };
}
