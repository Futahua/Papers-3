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
): void {
  if (owner.isDestroyed()) return;
  owner.setFocusable(wasFocusable);
  if (wasAlwaysOnTop) {
    // On Windows, switching a BrowserWindow back to non-focusable/NOACTIVATE can
    // clear or demote its TOPMOST state. Reassert both the flag and its position
    // within the topmost band after the foreign target has taken foreground.
    owner.setAlwaysOnTop(true, 'floating');
    owner.moveTop();
  }
}

function reassertTopmost(owner: ActivationSurfaceWindow, wasAlwaysOnTop: boolean): void {
  if (!wasAlwaysOnTop || owner.isDestroyed()) return;
  try {
    owner.setAlwaysOnTop(true, 'floating');
    owner.moveTop();
  } catch {
    /* best effort: activation already succeeded */
  }
}

/**
 * Temporarily let one Papers surface take foreground eligibility for a foreign
 * activation. The returned release restores the surface's original activation
 * policy and, if it was topmost, restores that z-order contract too.
 */
export async function focusSurfaceForForeignActivation(
  owner: ActivationSurfaceWindow,
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
      try { restoreSurface(owner, wasFocusable, wasAlwaysOnTop); } catch { /* best effort */ }
    }
    return null;
  }

  return () => {
    try { restoreSurface(owner, wasFocusable, wasAlwaysOnTop); } catch { /* best effort */ }
    if (!wasAlwaysOnTop) return;

    // A fullscreen app can promote/re-stack its own topmost presentation window
    // shortly AFTER SetForegroundWindow returns. The immediate restore above is
    // therefore necessary but not sufficient: the target can still overtake the
    // widget on the next compositor/window-manager turn. Reassert twice inside a
    // short bounded settle window; neither call takes focus.
    setTimeout(() => reassertTopmost(owner, wasAlwaysOnTop), 120);
    setTimeout(() => reassertTopmost(owner, wasAlwaysOnTop), 360);
  };
}
