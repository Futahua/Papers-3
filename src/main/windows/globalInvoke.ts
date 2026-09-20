/**
 * Global invocation chords: two system-wide accelerators that work from inside
 * any other application while Papers is running.
 *
 * THE BOUNDARY THIS MODULE EXISTS TO KEEP
 * Papers is a generic host. It does not know what the creator's Backpack calls
 * its command surface, what that surface is for, or what happens when it opens.
 * The host registers the accelerator, brings the focused Papers window forward,
 * and asks "the focused project's command surface" to receive a neutral event.
 * The Backpack decides that the event means whatever it means. Nothing about a
 * particular Backpack's name, prompt, or actions may enter this file.
 *
 * WHY EVERY FAILURE IS TYPED
 * Electron's `globalShortcut.register` returns `false` when another application
 * already owns the chord, and it does not throw (measured on Electron 43.1.1).
 * `Alt+A` is a cheap chord that something else may well hold. A silent `false`
 * is this codebase's recurring bug: the creator presses the key, nothing
 * happens, and nothing anywhere says why. Every path out of this module is
 * therefore a typed, named outcome - including "Papers came forward but there
 * was nothing to open", which must never look like nothing happened.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * - It never substitutes a different chord. A taken chord is refused, not
 *   worked around.
 * - It never calls `unregisterAll`; that would release chords this module does
 *   not own.
 * - It does not persist or edit configuration. The chords arrive as an injected
 *   value so a real settings surface can supply them later; no settings UI is
 *   built here, and nothing makes one impossible.
 */

/** The chords the creator asked for, by name. Overridable through
 * `GlobalInvokeDependencies.accelerators`. */
export const DEFAULT_INVOKE_ACCELERATORS: GlobalInvokeAccelerators = {
  invoke: 'Alt+A',
  bringToFront: 'Alt+Shift+A',
};

export interface GlobalInvokeAccelerators {
  /**
   * Open the focused project's command surface as a TRANSIENT OVERLAY on top of
   * whatever the creator is doing. **Papers does NOT come forward.**
   *
   * This is a launcher, not a window switcher. The creator's sentence was "pop
   * the run anywhere even when im using a different program" - the popping is
   * the request. The application they were in keeps its place in the z-order
   * and gets focus back when the overlay closes.
   */
  invoke: string;
  /** Bring Papers to the front. Opens nothing. */
  bringToFront: string;
}

/** Why the overlay closed. It decides whether focus is handed back. */
export type OverlayCloseReason =
  /** Escape, or the chord pressed again. */
  | 'dismissed'
  /** The creator ran something; the application they came from takes focus back while it runs. */
  | 'action-run'
  /** The overlay lost focus to something else. The creator has moved on. */
  | 'focus-lost';

/** The subset of Electron's `globalShortcut` this module needs. */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered(accelerator: string): boolean;
}

export type GlobalInvokeFailureReason =
  | 'already-registered-by-another-application'
  | 'unusable-accelerator'
  | 'modifier-required'
  | 'invalid-accelerator';

export interface GlobalInvokeFailure {
  accelerator: string;
  chord: 'invoke' | 'bringToFront';
  reason: GlobalInvokeFailureReason;
  /** Creator-readable, names the chord, and says what is wrong with it. */
  message: string;
}

export interface GlobalInvokeRegistrationReport {
  ok: boolean;
  registered: string[];
  failures: GlobalInvokeFailure[];
}

export type GlobalInvokeOutcome =
  /** The command surface overlay opened over whatever the creator was doing. */
  | 'overlay-opened'
  /** The overlay could not open, and the reason is known and reported. */
  | 'overlay-unavailable'
  /** Papers came forward (the bring-to-front chord, when it was not in front). */
  | 'brought-forward'
  /** Papers was not running and its configured shortcut was launched. */
  | 'launched'
  /** Papers could not be brought forward at all. */
  | 'window-unavailable';

export interface GlobalInvokeReport {
  chord: 'invoke' | 'bringToFront';
  outcome: GlobalInvokeOutcome;
  /** Bounded, creator-readable detail. Empty when everything worked. */
  detail: string;
}

/** The launcher overlay, as this module needs to see it. */
export interface CommandSurfaceOverlay {
  /**
   * Show the overlay over the current foreground application and give it
   * keyboard focus. MUST NOT bring Papers forward.
   *
   * Resolves with the outcome, including the refusal case: no project open, no
   * command surface declared, or the surface failing to load. A refusal is
   * reported, never silent.
   */
  open(): Promise<{ ok: boolean; detail: string }>;
  /** Close it if it is open, handing focus back. Safe to call when closed. */
  close(reason: OverlayCloseReason): Promise<void>;
  isOpen(): boolean;
}

export interface GlobalInvokeDependencies {
  shortcut: GlobalShortcutLike;
  /** The focused Papers window, or null when there is none to bring forward. */
  currentWindowId(): number | null;
  bringToFront(windowId: number): { ok: boolean; detail: string };
  /**
   * Launch Papers when the host has no live window. This is necessarily a
   * best-effort fallback: a process-level global shortcut cannot receive a
   * keypress after the process has exited, but it can recover a live host that
   * has not created its first window yet.
   */
  launchIfUnavailable?(): Promise<{ ok: boolean; detail: string }>;
  /**
   * Ask the focused project's command surface to receive the neutral invoke.
   * `surfaceId` is whatever the project declared; the host never interprets it.
   */
  invokeCommandSurface(
    projectId: string,
    surfaceId: string,
    reason: 'global-accelerator',
  ): { ok: boolean; detail: string };
  /** Where the host resolves the focused project's declared command surface. */
  resolveCommandSurface?(): { projectId: string; surfaceId: string } | null;
  /**
   * The launcher overlay. When present, the invoke chord opens THIS and never
   * brings Papers forward. When absent the invoke chord reports that the
   * overlay is unavailable rather than silently falling back to raising Papers.
   */
  overlay?: CommandSurfaceOverlay;
  accelerators?: GlobalInvokeAccelerators;
  report?(report: GlobalInvokeReport): void;
}

export interface GlobalInvoke {
  register(): GlobalInvokeRegistrationReport;
  release(): void;
  /** For tests and for a future settings surface that changes the chords. */
  registeredAccelerators(): string[];
}

const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
]);

const NAMED_KEYS = new Set([
  'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete',
  'insert', 'return', 'enter', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup',
  'pagedown', 'escape', 'esc', 'printscreen', 'numadd', 'numsub', 'nummult', 'numdiv',
  'numdec', 'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause',
  'volumeup', 'volumedown', 'volumemute',
]);

const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/;
const PUNCTUATION = new Set([
  '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=', '+',
  '[', '{', ']', '}', '\\', '|', ';', ':', "'", '"', ',', '<', '.', '>', '/', '?', '`',
]);

/**
 * Validate an accelerator BEFORE handing it to the backend.
 *
 * Two measured reasons this is not redundant with the backend:
 *   1. Electron accepts `'A'` - a single key with no modifier - and returns
 *      true. Registered globally, that swallows every `A` the creator types in
 *      every application. A typo in a future settings value must not be able to
 *      do that, so a chord with no modifier is refused here.
 *   2. Electron's parser is permissive about some malformed input: measured,
 *      `'NotAKey+Q'` registered true and `'Super+A'` returned false without
 *      throwing. Both look like success or an unexplained refusal. Validating
 *      the token set turns them into a named reason.
 */
function validateAccelerator(accelerator: unknown): { ok: true; value: string } | { ok: false; reason: GlobalInvokeFailureReason } {
  if (typeof accelerator !== 'string') return { ok: false, reason: 'invalid-accelerator' };
  const trimmed = accelerator.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'invalid-accelerator' };

  const parts = trimmed.split('+').map((part) => part.trim());
  if (parts.length < 2) return { ok: false, reason: 'modifier-required' };

  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);

  if (key.length === 0) return { ok: false, reason: 'invalid-accelerator' };
  let keyValid = false;
  if (/^[a-z0-9]$/i.test(key)) keyValid = true;
  else if (NAMED_KEYS.has(key.toLowerCase())) keyValid = true;
  else if (FUNCTION_KEY.test(key.toLowerCase())) keyValid = true;
  else if (PUNCTUATION.has(key)) keyValid = true;
  if (!keyValid) return { ok: false, reason: 'invalid-accelerator' };

  if (modifiers.length === 0) return { ok: false, reason: 'modifier-required' };
  let hasRealModifier = false;
  for (const modifier of modifiers) {
    const normalized = modifier.toLowerCase();
    if (!MODIFIERS.has(normalized)) return { ok: false, reason: 'invalid-accelerator' };
    // AltGr is not a chord modifier; a chord must carry a real one.
    if (normalized !== 'altgr') hasRealModifier = true;
  }
  if (!hasRealModifier) return { ok: false, reason: 'modifier-required' };

  return { ok: true, value: trimmed };
}

function describeFailure(chord: 'invoke' | 'bringToFront', accelerator: string, reason: GlobalInvokeFailureReason): string {
  const what = chord === 'invoke' ? 'the command surface shortcut' : 'the bring-Papers-forward shortcut';
  switch (reason) {
    case 'already-registered-by-another-application':
      return `${accelerator} is already taken by another application, so ${what} could not be registered. Papers has not substituted a different key.`;
    case 'unusable-accelerator':
      return `${accelerator} is not a key combination the system accepts, so ${what} could not be registered.`;
    case 'modifier-required':
      return `${accelerator} has no modifier key. A shortcut without a modifier would capture that key in every application, so it was refused and ${what} is not registered.`;
    case 'invalid-accelerator':
    default:
      return `${accelerator} is not a recognised key combination, so ${what} could not be registered.`;
  }
}

export function createGlobalInvoke(dependencies: GlobalInvokeDependencies): GlobalInvoke {
  const accelerators = dependencies.accelerators ?? DEFAULT_INVOKE_ACCELERATORS;
  const held = new Set<string>();

  const handleBringToFront = (): { ok: boolean; detail: string } => {
    const windowId = dependencies.currentWindowId();
    if (windowId === null) {
      return { ok: false, detail: 'no Papers window is open' };
    }
    return dependencies.bringToFront(windowId);
  };

  const emit = (report: GlobalInvokeReport): void => {
    dependencies.report?.(report);
  };

  /** Alt+Shift+A always raises Papers; it never minimizes it. */
  const onBringToFront = (): void => {
    const windowId = dependencies.currentWindowId();
    if (windowId === null) {
      void (async () => {
        const launched = await dependencies.launchIfUnavailable?.() ?? {
          ok: false,
          detail: 'no Papers window is open',
        };
        emit({
          chord: 'bringToFront',
          outcome: launched.ok ? 'launched' : 'window-unavailable',
          detail: launched.detail,
        });
      })();
      return;
    }
    const result = dependencies.bringToFront(windowId);
    emit({
      chord: 'bringToFront',
      outcome: result.ok ? 'brought-forward' : 'window-unavailable',
      detail: result.detail,
    });
  };

  /**
   * The invoke chord opens a TRANSIENT OVERLAY and does not touch the window
   * order of Papers at all.
   *
   * Note what is deliberately absent: this path never calls `handleBringToFront`.
   * An earlier revision brought Papers forward here, which was an interpolation
   * of the request rather than the request itself. Papers stays exactly where it
   * was - minimised if it was minimised, behind whatever is in front of it.
   */
  const onInvoke = (): void => {
    const overlay = dependencies.overlay;
    if (!overlay) {
      emit({
        chord: 'invoke',
        outcome: 'overlay-unavailable',
        detail: 'the command surface overlay is not available in this build',
      });
      return;
    }

    // The chord is NOT a toggle. Pressing it again while the overlay is open
    // re-invokes the surface, so the creator lands on an empty, focused line;
    // dismissing is Escape's job. Closing here instead would leave the project
    // with no event to clear on, and merely refocusing the window - which is
    // what the overlay used to do - leaves it with no event at all.
    void overlay.open().then((opened) => {
      emit({
        chord: 'invoke',
        outcome: opened.ok ? 'overlay-opened' : 'overlay-unavailable',
        detail: opened.detail,
      });
    }).catch((error: unknown) => {
      emit({
        chord: 'invoke',
        outcome: 'overlay-unavailable',
        detail: `the command surface overlay failed to open: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
  };

  const registerOne = (
    chord: 'invoke' | 'bringToFront',
    accelerator: string,
    callback: () => void,
    report: GlobalInvokeRegistrationReport,
  ): void => {
    const validated = validateAccelerator(accelerator);
    if (!validated.ok) {
      report.failures.push({
        accelerator: String(accelerator),
        chord,
        reason: validated.reason,
        message: describeFailure(chord, String(accelerator), validated.reason),
      });
      return;
    }

    let accepted = false;
    try {
      accepted = dependencies.shortcut.register(validated.value, callback);
    } catch {
      // An unparseable accelerator throws rather than returning false. Both are
      // refusals and both must name the chord.
      report.failures.push({
        accelerator: validated.value,
        chord,
        reason: 'unusable-accelerator',
        message: describeFailure(chord, validated.value, 'unusable-accelerator'),
      });
      return;
    }

    if (!accepted) {
      report.failures.push({
        accelerator: validated.value,
        chord,
        reason: 'already-registered-by-another-application',
        message: describeFailure(chord, validated.value, 'already-registered-by-another-application'),
      });
      return;
    }

    held.add(validated.value);
    report.registered.push(validated.value);
  };

  return {
    register(): GlobalInvokeRegistrationReport {
      const report: GlobalInvokeRegistrationReport = { ok: true, registered: [], failures: [] };
      // Registration is attempted for both chords independently: one being taken
      // must not disarm the other.
      registerOne('bringToFront', accelerators.bringToFront, onBringToFront, report);
      registerOne('invoke', accelerators.invoke, onInvoke, report);
      report.ok = report.failures.length === 0;
      return report;
    },

    release(): void {
      // Unregister exactly what this module registered. `unregisterAll` would
      // release chords belonging to something else.
      for (const accelerator of [...held]) {
        try {
          dependencies.shortcut.unregister(accelerator);
        } catch {
          /* releasing must never throw on the way out */
        }
        held.delete(accelerator);
      }
    },

    registeredAccelerators(): string[] {
      return [...held];
    },
  };
}
