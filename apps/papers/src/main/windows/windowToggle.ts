/**
 * Alt+Shift+A as a TOGGLE.
 *
 * THE RULE, in one sentence, chosen to be the one a person would predict without
 * reading anything:
 *
 *   If the window you are looking at is Papers, the chord minimises it;
 *   otherwise the chord brings Papers forward.
 *
 * WHY IT IS FOREGROUND AND NOT VISIBILITY
 * The creator's symmetry argues for a toggle, but the tempting shorthand - "can
 * they see Papers?" - is the wrong question, because visibility and foreground
 * come apart in cases they actually produce:
 *
 *   Papers visible but unfocused (they are typing in Chrome, Papers behind it)
 *     -> NOT foreground -> raise. They summoned it; it comes forward.
 *   Papers focused on another monitor
 *     -> foreground -> minimise. Which monitor is not part of the question.
 *   Papers partially covered but focused
 *     -> foreground -> minimise. It is in front; the chord dismisses it.
 *   Several Papers windows, one focused
 *     -> the FOCUSED one is toggled. The window they are looking at is the one
 *        the chord should act on, never merely the most recently used.
 *
 * If visibility were the test, the first case would minimise a window the
 * creator was in the middle of summoning - the chord would fight itself.
 *
 * THE PREFERENCE WHEN IT IS GENUINELY UNCERTAIN
 * Bring forward, never minimise. An unwanted raise costs one more keypress; an
 * unwanted minimise hides work the creator was looking at. Every uncertain path
 * below resolves to raising.
 *
 * WHERE FOCUS LANDS AFTER A MINIMISE
 * Windows does not always pick a sensible next window, so the toggle chooses
 * explicitly: the next window down the z-order from the one being minimised -
 * literally the window that was underneath it. If that cannot be determined or
 * focused, the minimise still stands and the outcome says plainly that focus was
 * not placed. A failed focus hand-off never undoes the minimise.
 */

export const TOGGLE_RULE =
  'If the window you are looking at is Papers, the chord minimises it; otherwise the chord brings Papers forward.';

export interface WindowToggleDependencies {
  /**
   * The Papers window that currently owns the foreground, or null when Papers
   * is not the foreground application. Implemented by comparing the native
   * foreground handle against every live Papers window.
   */
  foregroundPapersWindowId(): number | null;
  /** The window to raise when Papers does not own the foreground. */
  currentWindowId(): number | null;
  /** Whether the foreground application is Papers at all. May throw or be
   * unable to answer; both are treated as "not certain". */
  isForeground(): boolean;
  /** Minimise one live Papers window. Returns false when it did not happen. */
  minimize(windowId: number): boolean;
  bringToFront(windowId: number): { ok: boolean; detail: string } | Promise<{ ok: boolean; detail: string }>;
  /**
   * The next window down the z-order from the one being minimised - the window
   * that was underneath. Null when there is nothing usable underneath.
   */
  nextWindowInZOrder(): number | null | Promise<number | null>;
  /** Hand the foreground to a native window handle. Returns false when refused. */
  focusWindow(handle: number): boolean | Promise<boolean>;
  report?(report: { outcome: WindowToggleOutcome; detail: string }): void;
}

export type WindowToggleOutcome =
  /** Papers was in front and has been hidden. */
  | 'minimized'
  /** Papers was not in front and has been brought forward. */
  | 'brought-forward'
  /** There is no Papers window to act on at all. */
  | 'window-unavailable';

export interface WindowToggleResult {
  outcome: WindowToggleOutcome;
  detail: string;
  /** The native handle focus was handed to after a minimise, or null. */
  focusHandedTo: number | null;
}

export interface WindowToggle {
  invoke(): Promise<WindowToggleResult>;
}

export function createWindowToggle(dependencies: WindowToggleDependencies): WindowToggle {
  const emit = (outcome: WindowToggleOutcome, detail: string): void => {
    dependencies.report?.({ outcome, detail });
  };

  const raise = async (): Promise<WindowToggleResult> => {
    const windowId = dependencies.currentWindowId();
    if (windowId === null) {
      const detail = 'no Papers window is open';
      emit('window-unavailable', detail);
      return { outcome: 'window-unavailable', detail, focusHandedTo: null };
    }
    const result = await dependencies.bringToFront(windowId);
    const detail = result.detail;
    emit(result.ok ? 'brought-forward' : 'window-unavailable', detail);
    return {
      outcome: result.ok ? 'brought-forward' : 'window-unavailable',
      detail,
      focusHandedTo: null,
    };
  };

  const minimise = async (windowId: number): Promise<WindowToggleResult> => {
    const minimized = dependencies.minimize(windowId);
    if (!minimized) {
      // Prefer bringing forward over leaving the creator with nothing. A failed
      // minimise that reported success would be the worst outcome of all.
      return await raise();
    }

    let focusHandedTo: number | null = null;
    let detail = 'Papers is minimized';
    try {
      const underneath = await dependencies.nextWindowInZOrder();
      if (underneath === null) {
        detail = 'Papers is minimized; there was no window underneath to give focus to';
      } else if (await dependencies.focusWindow(underneath)) {
        focusHandedTo = underneath;
        detail = 'Papers is minimized and focus went to the window that was underneath it';
      } else {
        detail = 'Papers is minimized; the window underneath could not be given focus';
      }
    } catch (error) {
      detail = `Papers is minimized; choosing the next window failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    emit('minimized', detail);
    return { outcome: 'minimized', detail, focusHandedTo };
  };

  return {
    async invoke(): Promise<WindowToggleResult> {
      // Decide FIRST, then act. The whole judgement is this one question.
      let foreground: boolean;
      try {
        foreground = dependencies.isForeground();
      } catch {
        // Cannot tell: raise. Never hide work on an unknown answer.
        return await raise();
      }

      if (!foreground) return await raise();

      const windowId = dependencies.foregroundPapersWindowId();
      if (windowId === null) {
        // The foreground is Papers by the process check, but no live owned
        // window matches it. That is an uncertain state, so raise rather than
        // minimise something we cannot name.
        return await raise();
      }

      return minimise(windowId);
    },
  };
}
