/**
 * Bringing a Papers window to the front, and being honest about it.
 *
 * "Bring to front" is not one call on Windows, and the three situations the
 * creator will actually hit behave differently:
 *
 *   - MINIMISED: `focus()` alone does not restore. The window must be restored
 *     first. Measured on Electron 43.1.1 (probes/electron-front-probe.mjs):
 *     after `minimize()`, `show()+focus()` returns isMinimized=false and
 *     isVisible=true, while `focus()` by itself leaves isMinimized=true.
 *   - HIDDEN: `show()` is required; a hidden window cannot receive focus.
 *   - ALREADY VISIBLE, BEHIND ANOTHER APPLICATION: `show()` is a no-op and
 *     `focus()` raises it. `moveTop()` re-stacks it without pinning it.
 *
 * `moveTop` is deliberately a plain re-stack and never `setAlwaysOnTop`. The
 * creator asked for Papers to come forward, not to stay above everything
 * afterwards; a permanent topmost pin would change how every other application
 * behaves for the rest of the session.
 *
 * NOT VERIFIED HERE, and deliberately not faked: a window on ANOTHER VIRTUAL
 * DESKTOP, and a window behind a FULLSCREEN application. Electron exposes no
 * API to move a window between virtual desktops, and whether a synthesized
 * focus steals focus from an exclusive-fullscreen application depends on the
 * foreground-lock rules of the other process. Both need a human at the machine.
 * This module attempts the same honest sequence and reports what it observed
 * afterwards rather than claiming either situation succeeded.
 */

/** The window operations this needs. Structural, so the real BaseWindow fits
 * and a test double needs no Electron. */
export interface FrontableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  moveTop(): void;
  isFocused?(): boolean;
  getNativeWindowHandle?(): Buffer;
}

export interface NativeForegroundActivation {
  setForegroundWindow(handle: number): Promise<boolean>;
  isForegroundWindow(handle: number): Promise<boolean>;
}

export interface BringWindowToFrontOptions {
  platform?: string;
  nativeForeground?: NativeForegroundActivation;
  nativeActivationAttempts?: number;
  nativeActivationRetryDelayMs?: number;
}

export async function bringFirstWindowToFront(
  windows: FrontableWindow[],
  options: BringWindowToFrontOptions = {},
): Promise<BringToFrontResult> {
  let last: BringToFrontResult | undefined;
  for (const window of windows) {
    last = await bringWindowToFront(window, options);
    if (last.ok) return last;
  }
  return last ?? {
    ok: false,
    detail: 'no live Papers window is available',
    observed: { wasMinimized: false, wasVisible: false, restored: false, shown: false, focused: false, raised: false },
  };
}

export interface BringToFrontResult {
  ok: boolean;
  /** Creator-readable and bounded. Empty only when nothing needed explaining. */
  detail: string;
  /** Which situations the native calls actually reported, so a caller can see
   * what was handled instead of trusting a single boolean. */
  observed: {
    wasMinimized: boolean;
    wasVisible: boolean;
    restored: boolean;
    shown: boolean;
    focused: boolean;
    raised: boolean;
  };
}

export async function bringWindowToFront(
  window: FrontableWindow | null | undefined,
  options: BringWindowToFrontOptions = {},
): Promise<BringToFrontResult> {
  const observed = {
    wasMinimized: false,
    wasVisible: false,
    restored: false,
    shown: false,
    focused: false,
    raised: false,
  };

  if (!window || window.isDestroyed()) {
    return { ok: false, detail: 'that Papers window no longer exists', observed };
  }

  observed.wasMinimized = window.isMinimized();
  observed.wasVisible = window.isVisible();

  if (observed.wasMinimized) {
    window.restore();
    observed.restored = true;
  }
  if (!observed.wasVisible) {
    window.show();
    observed.shown = true;
  }
  window.focus();
  // Re-stack without pinning. A window can report itself focused while another
  // application is still drawn over it.
  window.moveTop();
  observed.raised = true;

  if (options.platform === 'win32' && options.nativeForeground && window.getNativeWindowHandle) {
    const bytes = window.getNativeWindowHandle();
    const rawHandle = bytes.length >= 8 ? bytes.readBigUInt64LE(0) : bytes.length >= 4 ? BigInt(bytes.readUInt32LE(0)) : 0n;
    const handle = rawHandle <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rawHandle) : 0;
    if (handle > 0) {
      // Foreground eligibility can change around the second-instance event.
      // Retry briefly, verifying the exact HWND each time; retries cannot
      // override a Windows foreground-lock refusal.
      const attempts = Math.max(1, options.nativeActivationAttempts ?? 8);
      const delayMs = Math.max(0, options.nativeActivationRetryDelayMs ?? 50);
      for (let attempt = 0; attempt < attempts && !observed.focused; attempt++) {
        try {
          await options.nativeForeground.setForegroundWindow(handle);
          observed.focused = await options.nativeForeground.isForegroundWindow(handle);
        } catch {
          observed.focused = false;
        }
        if (!observed.focused && attempt + 1 < attempts && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  } else {
    observed.focused = window.isFocused?.() ?? false;
  }

  const visible = !window.isDestroyed() && window.isVisible() && !window.isMinimized();
  if (!observed.focused || !visible) {
    return { ok: false, detail: !visible ? 'the window is not visible after the activation attempt' : 'Windows did not grant Papers the foreground', observed };
  }

  const detail = observed.wasMinimized
    ? 'restored from minimised, shown and focused'
    : observed.wasVisible
      ? 'focused and raised'
      : 'shown and focused';
  return { ok: true, detail, observed };
}
