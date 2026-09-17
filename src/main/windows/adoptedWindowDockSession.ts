/**
 * Adopted-window dock session: the fastest genuinely usable foreign-window
 * slice that touches no shared seam.
 *
 * Interaction: the creator hovers any ordinary application window, presses
 * the dock chord, and that window tiles immediately right of the focused
 * Papers window and follows it across moves and resizes. Pressing the chord
 * again (or closing the Papers window) releases it back to exactly where it
 * was. One adoption at a time.
 *
 * Safety properties, all covered by unit tests:
 * - geometry only, through the existing non-activating `apply` path. No
 *   Z-order write, no hide, no minimize, no close. A crash leaves a visible,
 *   draggable window behind, never a stranded one.
 * - Papers never adopts itself: a pick resolving to our own PID is refused.
 * - only a `normal`-state window is adopted; minimized/maximized windows are
 *   refused rather than un-maximized on the creator's behalf.
 * - every follow revalidates identity inside the follower; doubt is terminal.
 * - Electron speaks DIP, the helper speaks physical pixels. The conversion
 *   uses the scale factor of the display Papers is on, recomputed on every
 *   trigger, so a cross-monitor drag cannot accumulate drift.
 */

import { createAdoptedWindowFollower } from './adoptedWindowFollower';
import type { WindowBounds } from './windowCapabilityTypes';
import type {
  WindowBindResult,
  WindowHoverResult,
  WindowRuntimeCapability,
} from './windowCapabilityService';
import type { WindowCapabilityResult } from './windowCapabilityTypes';

export const ADOPT_DOCK_GAP_DIP = 8;
export const ADOPT_DOCK_FOLLOW_DELAY_MS = 100;
export const ADOPT_DOCK_MIN_WIDTH_DIP = 240;

export interface DockPoint {
  x: number;
  y: number;
}

export interface DockRect extends DockPoint {
  width: number;
  height: number;
}

export interface DockPapersWindow {
  readonly id: number;
  getBounds(): DockRect;
  isDestroyed(): boolean;
  on(event: 'move' | 'resize' | 'restore' | 'closed', callback: () => void): void;
  removeListener(event: 'move' | 'resize' | 'restore' | 'closed', callback: () => void): void;
}

export interface DockDisplay {
  scaleFactor: number;
  workArea: DockRect;
}

export interface DockScreen {
  getCursorScreenPoint(): DockPoint;
  getDisplayMatching(bounds: DockRect): DockDisplay;
}

export interface DockShortcut {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/** Structural subset of the window-capability service this session needs. */
export interface DockCapabilityService {
  hoverAt(x: number, y: number): Promise<WindowHoverResult>;
  pickAt(x: number, y: number, candidateId: string): Promise<WindowBindResult & { candidate?: unknown }>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  applyCapability(capability: WindowRuntimeCapability, bounds: WindowBounds): Promise<WindowCapabilityResult>;
}

export interface AdoptedWindowDockDependencies {
  service: DockCapabilityService;
  screen: DockScreen;
  shortcut: DockShortcut;
  currentPid?: number;
  accelerator?: string;
  followDelayMs?: number;
  now?: () => number;
}

export type DockToggleOutcome =
  | { outcome: 'docked'; title: string; detail: string }
  | { outcome: 'released'; title: string; detail: string }
  | { outcome: 'refused'; detail: string };

/**
 * Pure tile math (DIP): glue `adoptedWidthDip` right of `papers`, same top
 * and height, clamped into `workArea`. Returns null when not even the
 * minimum width fits, so the caller refuses instead of parking the window
 * half off-screen.
 */
export function tileRightOf(papers: DockRect, adoptedWidthDip: number, workArea: DockRect): DockRect | null {
  const width = Math.min(adoptedWidthDip, workArea.width);
  if (width < ADOPT_DOCK_MIN_WIDTH_DIP) return null;
  const height = Math.min(papers.height, workArea.height);
  let x = papers.x + papers.width + ADOPT_DOCK_GAP_DIP;
  if (x + width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - width;
  }
  if (x < workArea.x) x = workArea.x;
  const y = Math.max(workArea.y, Math.min(papers.y, workArea.y + workArea.height - height));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function toPhysical(rect: DockRect, scaleFactor: number): WindowBounds {
  const scale = scaleFactor > 0 && Number.isFinite(scaleFactor) ? scaleFactor : 1;
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

export interface AdoptedWindowDock {
  register(hooks: {
    focusedWindow(): DockPapersWindow | null;
    notify(outcome: DockToggleOutcome): void;
  }): { registered: boolean; accelerator: string; detail: string };
  release(): void;
  toggle(focused: DockPapersWindow | null): Promise<DockToggleOutcome>;
  readonly active: boolean;
  readonly adoptedTitle: string | null;
}

export function createAdoptedWindowDock(dependencies: AdoptedWindowDockDependencies): AdoptedWindowDock {
  const {
    service,
    screen,
    shortcut,
    currentPid = process.pid,
    accelerator = 'CommandOrControl+Alt+D',
    followDelayMs = ADOPT_DOCK_FOLLOW_DELAY_MS,
  } = dependencies;

  const followerHolder: { current: ReturnType<typeof createAdoptedWindowFollower> } = {
    current: createAdoptedWindowFollower(service),
  };
  // The follower is single-adoption: after a terminal state a fresh one is
  // needed, or the next adoption refuses as "already adopted".
  function freshFollower(): void {
    const state = followerHolder.current.state;
    if (state === 'released' || state === 'identity-lost') {
      followerHolder.current = createAdoptedWindowFollower(service);
    }
  }
  let papersWindow: DockPapersWindow | null = null;
  let adoptedTitle: string | null = null;
  let adoptedWidthDip = 0;
  let followTimer: ReturnType<typeof setTimeout> | null = null;
  let toggling = false;

  function displayFor(window: DockPapersWindow): DockDisplay {
    try {
      return screen.getDisplayMatching(window.getBounds());
    } catch {
      return { scaleFactor: 1, workArea: { x: 0, y: 0, width: 4096, height: 4096 } };
    }
  }

  async function followNow(): Promise<void> {
    const window = papersWindow;
    if (!window || window.isDestroyed() || followerHolder.current.state !== 'following') return;
    let papers: DockRect;
    try {
      papers = window.getBounds();
    } catch {
      return;
    }
    const display = displayFor(window);
    const target = tileRightOf(papers, adoptedWidthDip, display.workArea);
    if (!target) return;
    await followerHolder.current.follow(toPhysical(target, display.scaleFactor)).catch(() => undefined);
  }

  function scheduleFollow(): void {
    if (followTimer !== null) {
      clearTimeout(followTimer);
      followTimer = null;
    }
    followTimer = setTimeout(() => {
      followTimer = null;
      void followNow();
    }, followDelayMs);
    // A stuck timer must never hold the loop open.
    (followTimer as { unref?: () => void }).unref?.();
  }

  function detach(): void {
    if (followTimer !== null) {
      clearTimeout(followTimer);
      followTimer = null;
    }
    const window = papersWindow;
    papersWindow = null;
    if (window && !window.isDestroyed()) {
      try {
        window.removeListener('move', scheduleFollow);
        window.removeListener('resize', scheduleFollow);
        window.removeListener('restore', scheduleFollow);
        window.removeListener('closed', onPapersClosed);
      } catch {
        /* listeners are best effort on teardown */
      }
    }
  }

  function onPapersClosed(): void {
    // The Papers window is gone: restore the adopted window, then forget it.
    const title = adoptedTitle;
    adoptedTitle = null;
    const window = papersWindow;
    papersWindow = null;
    void followerHolder.current.release().catch(() => undefined).finally(() => {
      if (window && !window.isDestroyed()) {
        try {
          window.removeListener('move', scheduleFollow);
          window.removeListener('resize', scheduleFollow);
          window.removeListener('restore', scheduleFollow);
          window.removeListener('closed', onPapersClosed);
        } catch {
          /* best effort */
        }
      }
    });
    void title;
  }

  async function releaseSession(): Promise<DockToggleOutcome> {
    const title = adoptedTitle ?? 'window';
    detach();
    adoptedTitle = null;
    adoptedWidthDip = 0;
    const released = await followerHolder.current.release().catch(() => ({ outcome: 'helper-unavailable' as const }));
    if (released.outcome === 'released') {
      return { outcome: 'released', title, detail: `'${title}' is back where it was.` };
    }
    return { outcome: 'released', title, detail: `'${title}' was forgotten, but its original position could not be restored (${released.outcome}). Drag it back by hand.` };
  }

  async function adopt(focused: DockPapersWindow): Promise<DockToggleOutcome> {
    freshFollower();
    let point: DockPoint;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return { outcome: 'refused', detail: 'the cursor position could not be read.' };
    }
    const hovered = await service.hoverAt(point.x, point.y).catch(() => null);
    if (!hovered || hovered.outcome !== 'success' || !hovered.candidate) {
      return { outcome: 'refused', detail: 'no adoptable window is under the cursor. Hover an ordinary application window and try again.' };
    }
    const picked = await service.pickAt(point.x, point.y, hovered.candidate.id).catch(() => null);
    if (!picked || picked.outcome !== 'success' || !('capability' in picked) || !picked.capability) {
      return { outcome: 'refused', detail: 'that window could not be bound. It may have closed in the meantime.' };
    }
    const capability = picked.capability as WindowRuntimeCapability;
    const observed = await service.observeCapability(capability).catch(() => null);
    const current = observed && observed.outcome === 'success' ? observed.observation ?? null : null;
    if (!current || !current.bounds) {
      return { outcome: 'refused', detail: 'that window could not be read.' };
    }
    if (current.processId !== null && current.processId === currentPid) {
      return { outcome: 'refused', detail: 'that is a Papers window. Hover an ordinary application window instead.' };
    }
    if (current.state !== 'normal') {
      return { outcome: 'refused', detail: `that window is ${current.state}. Restore it to a normal window first.` };
    }
    const adopted = await followerHolder.current.adopt(capability);
    if (adopted.outcome !== 'adopted') {
      const reason = 'error' in adopted && adopted.error ? ` ${adopted.error}` : '';
      return { outcome: 'refused', detail: `adoption failed (${adopted.outcome}).${reason}` };
    }
    let papers: DockRect;
    try {
      papers = focused.getBounds();
    } catch {
      await followerHolder.current.release().catch(() => undefined);
      return { outcome: 'refused', detail: 'the Papers window could not be read.' };
    }
    const display = displayFor(focused);
    adoptedWidthDip = Math.max(ADOPT_DOCK_MIN_WIDTH_DIP, Math.round(current.bounds.width / (display.scaleFactor || 1)));
    const target = tileRightOf(papers, adoptedWidthDip, display.workArea);
    if (!target) {
      await followerHolder.current.release().catch(() => undefined);
      adoptedWidthDip = 0;
      return { outcome: 'refused', detail: 'there is no room beside Papers on this display.' };
    }
    const placed = await followerHolder.current.follow(toPhysical(target, display.scaleFactor));
    if (placed.outcome !== 'applied') {
      await followerHolder.current.release().catch(() => undefined);
      adoptedWidthDip = 0;
      const reason = 'error' in placed && placed.error ? ` ${placed.error}` : '';
      return { outcome: 'refused', detail: `the window would not move (${placed.outcome}).${reason} Nothing was changed.` };
    }
    papersWindow = focused;
    adoptedTitle = current.title || 'window';
    try {
      focused.on('move', scheduleFollow);
      focused.on('resize', scheduleFollow);
      focused.on('restore', scheduleFollow);
      focused.on('closed', onPapersClosed);
    } catch {
      /* a window that cannot be watched can still be followed once */
    }
    return {
      outcome: 'docked',
      title: adoptedTitle,
      detail: `'${adoptedTitle}' now sits right of Papers and follows it. Press ${accelerator} again to put it back.`,
    };
  }

  async function toggle(focused: DockPapersWindow | null): Promise<DockToggleOutcome> {
    if (toggling) return { outcome: 'refused', detail: 'a dock action is already running.' };
    toggling = true;
    try {
      if (papersWindow || followerHolder.current.state === 'following') {
        return await releaseSession();
      }
      if (!focused || focused.isDestroyed()) {
        return { outcome: 'refused', detail: 'no Papers window is focused. Open Papers first.' };
      }
      return await adopt(focused);
    } finally {
      toggling = false;
    }
  }

  return {
    register(hooks) {
      let registered = false;
      try {
        registered = shortcut.register(accelerator, () => {
          toggle(hooks.focusedWindow()).then(hooks.notify).catch(() => undefined);
        });
      } catch {
        registered = false;
      }
      return {
        registered,
        accelerator,
        detail: registered
          ? `${accelerator} toggles the window-dock.`
          : `${accelerator} could not be registered (taken or unusable). Window-dock is unavailable.`,
      };
    },

    release() {
      try {
        shortcut.unregister(accelerator);
      } catch {
        /* releasing must never throw */
      }
      if (papersWindow) {
        void releaseSession().catch(() => undefined);
      } else {
        detach();
      }
    },

    toggle,

    get active() {
      return papersWindow !== null || followerHolder.current.state === 'following';
    },

    get adoptedTitle() {
      return adoptedTitle;
    },
  };
}
