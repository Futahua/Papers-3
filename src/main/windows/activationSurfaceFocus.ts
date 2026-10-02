export const COMPACT_WIDGET_TOPMOST_LEVEL = 'screen-saver';

export interface ActivationSurfaceWindow {
  isDestroyed(): boolean;
  isFocusable(): boolean;
  isAlwaysOnTop(): boolean;
  setFocusable(flag: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  focus(): void;
  moveTop(): void;
}

function restoreSurface(
  owner: ActivationSurfaceWindow,
  wasFocusable: boolean,
  wasAlwaysOnTop: boolean,
  topmostLevel: string,
): void {
  if (owner.isDestroyed()) return;
  owner.setFocusable(wasFocusable);
  if (wasAlwaysOnTop) {
    // On Windows, switching a BrowserWindow back to non-focusable/NOACTIVATE can
    // clear or demote its TOPMOST state. Reassert both the flag and its position
    // within the SAME topmost band after the foreign target has taken foreground.
    owner.setAlwaysOnTop(true, topmostLevel);
    owner.moveTop();
  }
}

function reassertTopmost(owner: ActivationSurfaceWindow, wasAlwaysOnTop: boolean, topmostLevel: string): void {
  if (!wasAlwaysOnTop || owner.isDestroyed()) return;
  try {
    owner.setAlwaysOnTop(true, topmostLevel);
    owner.moveTop();
  } catch {
    /* best effort: activation already succeeded */
  }
}

/**
 * Temporarily let one Papers surface take foreground eligibility for a foreign
 * activation. The returned release restores the surface's original activation
 * policy and, if it was topmost, restores that z-order contract too. Callers
 * that own a stronger persistent topmost band must pass it explicitly so the
 * temporary focusability transition cannot silently downgrade that contract.
 */
export async function focusSurfaceForForeignActivation(
  owner: ActivationSurfaceWindow,
  topmostLevel = 'floating',
): Promise<(() => void) | null> {
  if (owner.isDestroyed()) return null;

  const wasFocusable = owner.isFocusable();
  const wasAlwaysOnTop = owner.isAlwaysOnTop();
  let changed = false;

  try {
    owner.setFocusable(true);
    changed = true;
    owner.focus();
  } catch {
    if (changed) {
      try { restoreSurface(owner, wasFocusable, wasAlwaysOnTop, topmostLevel); } catch { /* best effort */ }
    }
    return null;
  }

  return () => {
    try { restoreSurface(owner, wasFocusable, wasAlwaysOnTop, topmostLevel); } catch { /* best effort */ }
    if (!wasAlwaysOnTop) return;

    // A fullscreen app can promote/re-stack its own topmost presentation window
    // shortly AFTER SetForegroundWindow returns. The immediate restore above is
    // therefore necessary but not sufficient: the target can still overtake the
    // widget on the next compositor/window-manager turn. Reassert twice inside a
    // short bounded settle window; neither call takes focus.
    setTimeout(() => reassertTopmost(owner, wasAlwaysOnTop, topmostLevel), 120);
    setTimeout(() => reassertTopmost(owner, wasAlwaysOnTop, topmostLevel), 360);
  };
}
