/**
 * Adopted-window dock session: the fastest genuinely usable foreign-window
 * slice that touches no shared seam.
 *
 * Interaction: the creator hovers any ordinary application window, presses
 * the dock chord, and that window tiles immediately right of the focused
 * Papers window and follows it across moves and resizes. Pressing the chord
 * again while hovering an adopted window releases that window back to exactly
 * where it was. Multiple independent windows may be adopted at once.
 *
 * Safety properties, all covered by unit tests:
 * - geometry only, through the dedicated non-activating `place-adopted` path. No
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

import { randomUUID } from 'node:crypto';
import { createAdoptedWindowFollower } from './adoptedWindowFollower';
import type { ForeignWindowSurfaceController } from './foreignWindowSurfaceController';
import type { WindowBounds } from './windowCapabilityTypes';
import type {
  WindowBindResult,
  WindowHoverResult,
  PersistedWindowMemberDescriptor,
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
  /** Main-owned native host handle, encoded as a decimal string for the
   * helper. Optional keeps geometry-only test hosts and old embedders valid. */
  getNativeWindowHandle?(): Uint8Array;
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
  placeAdoptedCapability(capability: WindowRuntimeCapability, bounds: WindowBounds, hostWindow?: string): Promise<WindowCapabilityResult>;
}

export interface AdoptedWindowDockDependencies {
  service: DockCapabilityService;
  screen: DockScreen;
  shortcut: DockShortcut;
  surfaceController?: ForeignWindowSurfaceController;
  /** Durable recovery is armed before the first native placement. */
  recovery?: AdoptedWindowRecovery;
  currentPid?: number;
  accelerator?: string;
  followDelayMs?: number;
  now?: () => number;
}

export interface AdoptedWindowRecovery {
  arm(entry: {
    recoveryId: string;
    descriptor: PersistedWindowMemberDescriptor;
    originalBounds: WindowBounds;
    recordedAt: number;
  }): Promise<void>;
  clear(recoveryId: string): Promise<void>;
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

/** Tile one of several adopted windows in a vertical stack beside Papers.
 * The one-window case deliberately delegates to the original geometry so the
 * first adoption remains pixel-for-pixel compatible with the initial slice. */
export function tileRightOfMany(
  papers: DockRect,
  adoptedWidthDip: number,
  index: number,
  count: number,
  workArea: DockRect,
): DockRect | null {
  if (count <= 1) return tileRightOf(papers, adoptedWidthDip, workArea);
  if (index < 0 || index >= count) return null;
  const width = Math.min(adoptedWidthDip, workArea.width);
  if (width < ADOPT_DOCK_MIN_WIDTH_DIP) return null;
  const height = Math.min(papers.height, workArea.height);
  const gapTotal = ADOPT_DOCK_GAP_DIP * (count - 1);
  const slotHeight = Math.floor((height - gapTotal) / count);
  if (slotHeight <= 0) return null;
  let x = papers.x + papers.width + ADOPT_DOCK_GAP_DIP;
  if (x + width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - width;
  }
  if (x < workArea.x) x = workArea.x;
  const stackHeight = slotHeight * count + gapTotal;
  const stackY = Math.max(workArea.y, Math.min(papers.y, workArea.y + workArea.height - stackHeight));
  return {
    x: Math.round(x),
    y: Math.round(stackY + index * (slotHeight + ADOPT_DOCK_GAP_DIP)),
    width: Math.round(width),
    height: Math.round(slotHeight),
  };
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
  /** Await restoration of every active foreign window before its capability
   * service is torn down. Transient failures deliberately remain in the
   * adoption map so a later retry still has authority to restore them. */
  releaseAll(): Promise<void>;
  toggle(focused: DockPapersWindow | null): Promise<DockToggleOutcome>;
  readonly active: boolean;
  readonly adoptedTitle: string | null;
}

export function createAdoptedWindowDock(dependencies: AdoptedWindowDockDependencies): AdoptedWindowDock {
  const {
    service,
    screen,
    shortcut,
    surfaceController,
    recovery,
    currentPid = process.pid,
    accelerator = 'CommandOrControl+Alt+D',
    followDelayMs = ADOPT_DOCK_FOLLOW_DELAY_MS,
    now = Date.now,
  } = dependencies;

  interface Adoption {
    key: string;
    candidateId: string;
    title: string;
    widthDip: number;
    hostWindow: string | null;
    descriptor: PersistedWindowMemberDescriptor;
    recoveryId: string;
    papersWindow: DockPapersWindow;
    follower: ReturnType<typeof createAdoptedWindowFollower> | null;
    surfaceId: string | null;
  }

  function nativeHandleFor(window: DockPapersWindow): string | null {
    try {
      const raw = window.getNativeWindowHandle?.();
      if (!raw || raw.byteLength === 0) return null;
      const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      const value = bytes.byteLength >= 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0));
      return value > 0n ? value.toString(10) : null;
    } catch {
      return null;
    }
  }

  function stableAdoptionKey(candidateId: string, descriptor: PersistedWindowMemberDescriptor): string {
    return descriptor.windowInstanceId ? `window-instance:${descriptor.windowInstanceId}` : candidateId;
  }

  function existingAdoption(candidateId: string, descriptor: PersistedWindowMemberDescriptor | null): Adoption | null {
    if (adoptions.has(candidateId)) return adoptions.get(candidateId) ?? null;
    const instanceId = descriptor?.windowInstanceId;
    if (!instanceId) return null;
    return [...adoptions.values()].find((entry) => entry.descriptor.windowInstanceId === instanceId) ?? null;
  }

  const adoptions = new Map<string, Adoption>();
  const watchedPapers = new Map<number, { window: DockPapersWindow; onFollow: () => void; onClosed: () => void }>();
  let followTimer: ReturnType<typeof setTimeout> | null = null;
  let toggling = false;

  function displayFor(window: DockPapersWindow): DockDisplay {
    try {
      return screen.getDisplayMatching(window.getBounds());
    } catch {
      return { scaleFactor: 1, workArea: { x: 0, y: 0, width: 4096, height: 4096 } };
    }
  }

  async function followAdoption(
    adoption: Adoption,
    bounds: WindowBounds,
  ): Promise<{ outcome: string; error?: string }> {
    if (adoption.surfaceId && surfaceController) {
      let followed = await surfaceController.follow(adoption.surfaceId, bounds, adoption.hostWindow ?? undefined);
      if (followed.outcome === 'helper-unavailable' || followed.outcome === 'timeout') {
        const reconnected = await surfaceController.reconnect(adoption.surfaceId);
        if (reconnected.outcome === 'success') {
          followed = await surfaceController.follow(adoption.surfaceId, bounds, adoption.hostWindow ?? undefined);
        }
      }
      return followed.outcome === 'success' ? { outcome: 'applied' } : { outcome: followed.outcome, ...(followed.error ? { error: followed.error } : {}) };
    }
    if (!adoption.follower) return { outcome: 'missing', error: 'adoption has no runtime controller' };
    return adoption.follower.follow(bounds, adoption.hostWindow ?? undefined);
  }

  async function releaseAdoption(adoption: Adoption): Promise<{ outcome: string; error?: string }> {
    if (adoption.surfaceId && surfaceController) {
      const released = await surfaceController.release(adoption.surfaceId, adoption.hostWindow ?? undefined);
      return released.outcome === 'success'
        ? { outcome: 'released' }
        : { outcome: released.outcome, ...(released.error ? { error: released.error } : {}) };
    }
    if (!adoption.follower) return { outcome: 'missing', error: 'adoption has no runtime controller' };
    return adoption.follower.release(adoption.hostWindow ?? undefined);
  }

  function abandonAdoption(adoption: Adoption): void {
    if (adoption.surfaceId && surfaceController) {
      surfaceController.markDisconnected(adoption.surfaceId);
      surfaceController.retire(adoption.surfaceId);
    } else {
      adoption.follower?.abandon();
    }
  }

  async function followNow(): Promise<Map<string, { outcome: string; error?: string }>> {
    const results = new Map<string, { outcome: string; error?: string }>();
    const grouped = new Map<number, Adoption[]>();
    for (const adoption of adoptions.values()) {
      if (adoption.papersWindow.isDestroyed()) continue;
      const group = grouped.get(adoption.papersWindow.id) ?? [];
      group.push(adoption);
      grouped.set(adoption.papersWindow.id, group);
    }
    for (const group of grouped.values()) {
      const window = group[0]?.papersWindow;
      if (!window) continue;
      let papers: DockRect;
      try {
        papers = window.getBounds();
      } catch {
        continue;
      }
      const display = displayFor(window);
      for (let index = 0; index < group.length; index += 1) {
        const adoption = group[index]!;
        const target = tileRightOfMany(papers, adoption.widthDip, index, group.length, display.workArea);
        if (!target) {
          results.set(adoption.key, { outcome: 'malformed', error: 'there is no room beside Papers on this display.' });
          continue;
        }
        const result = await followAdoption(adoption, toPhysical(target, display.scaleFactor)).catch(() => ({ outcome: 'helper-unavailable' as const }));
        results.set(adoption.key, result);
        if (result.outcome === 'missing') {
          // Identity loss is terminal. Do not leave a dead capability or a
          // stale recovery record claiming ownership of a replacement window.
          adoptions.delete(adoption.key);
          await recovery?.clear(adoption.recoveryId).catch(() => undefined);
        }
      }
    }
    detachUnusedPapersListeners();
    return results;
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

  async function releaseForPapers(window: DockPapersWindow): Promise<void> {
    const entries = [...adoptions.values()].filter((entry) => entry.papersWindow.id === window.id);
    for (const entry of entries) {
      const released = await releaseAdoption(entry).catch(() => ({ outcome: 'helper-unavailable' as const }));
      if (released.outcome === 'released' || released.outcome === 'missing') {
        adoptions.delete(entry.key);
        await recovery?.clear(entry.recoveryId).catch(() => undefined);
      }
    }
    detachUnusedPapersListeners();
  }

  function watchPapersWindow(window: DockPapersWindow): void {
    if (watchedPapers.has(window.id)) return;
    const onFollow = scheduleFollow;
    const onClosed = () => {
      void releaseForPapers(window);
    };
    watchedPapers.set(window.id, { window, onFollow, onClosed });
    try {
      window.on('move', onFollow);
      window.on('resize', onFollow);
      window.on('restore', onFollow);
      window.on('closed', onClosed);
    } catch {
      /* a window that cannot be watched can still be followed once */
    }
  }

  function detachUnusedPapersListeners(): void {
    const used = new Set([...adoptions.values()].map((entry) => entry.papersWindow.id));
    for (const [id, watched] of watchedPapers) {
      if (used.has(id)) continue;
      watchedPapers.delete(id);
      if (watched.window.isDestroyed()) continue;
      try {
        watched.window.removeListener('move', watched.onFollow);
        watched.window.removeListener('resize', watched.onFollow);
        watched.window.removeListener('restore', watched.onFollow);
        watched.window.removeListener('closed', watched.onClosed);
      } catch {
        /* listeners are best effort on teardown */
      }
    }
  }

  function detach(): void {
    if (followTimer !== null) {
      clearTimeout(followTimer);
      followTimer = null;
    }
    for (const watched of watchedPapers.values()) {
      const window = watched.window;
      if (window && !window.isDestroyed()) {
        try {
          window.removeListener('move', watched.onFollow);
          window.removeListener('resize', watched.onFollow);
          window.removeListener('restore', watched.onFollow);
          window.removeListener('closed', watched.onClosed);
        } catch {
          /* listeners are best effort on teardown */
        }
      }
    }
    watchedPapers.clear();
  }

  async function releaseSession(key: string): Promise<DockToggleOutcome> {
    const entry = adoptions.get(key);
    if (!entry) return { outcome: 'refused', detail: 'that window is no longer adopted.' };
    const released = await releaseAdoption(entry).catch(() => ({ outcome: 'helper-unavailable' as const }));
    const title = entry.title || 'window';
    if (released.outcome === 'released') {
      // Retire the logical adoption only after the verified restore succeeds.
      // A transient helper/permission failure must leave the entry retryable;
      // deleting it here would strand the foreign window at its docked bounds
      // with no supported way to restore it from Papers.
      adoptions.delete(key);
      await recovery?.clear(entry.recoveryId).catch(() => undefined);
      detachUnusedPapersListeners();
      if (adoptions.size > 0) await followNow();
      return { outcome: 'released', title, detail: `'${title}' is back where it was.` };
    }
    if (released.outcome === 'missing') {
      // Identity loss is terminal by design: the follower has already refused
      // any unsafe restoration, so forgetting this dead adoption is correct.
      adoptions.delete(key);
      await recovery?.clear(entry.recoveryId).catch(() => undefined);
      detachUnusedPapersListeners();
      if (adoptions.size > 0) await followNow();
      return { outcome: 'released', title, detail: `'${title}' was no longer verifiable, so Papers stopped managing it.` };
    }
    const error = 'error' in released && released.error ? ` ${released.error}` : '';
    return {
      outcome: 'refused',
      detail: `Papers could not restore '${title}' (${released.outcome}).${error} The adoption is still active; try the release again.`,
    };
  }

  async function adopt(focused: DockPapersWindow, hovered: Extract<WindowHoverResult, { outcome: 'success' }>): Promise<DockToggleOutcome> {
    let point: DockPoint;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return { outcome: 'refused', detail: 'the cursor position could not be read.' };
    }
    if (!hovered.candidate) return { outcome: 'refused', detail: 'no adoptable window is under the cursor. Hover an ordinary application window and try again.' };
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
    let follower: ReturnType<typeof createAdoptedWindowFollower> | null = null;
    let surfaceId: string | null = null;
    let originalBounds = { ...current.bounds };
    if (surfaceController) {
      const created = surfaceController.create({
        descriptor: { ...picked.descriptor },
        title: current.title || hovered.candidate.title || 'window',
        hostWindowId: focused.id,
      });
      const resolved = await surfaceController.resolve(created.surfaceId).catch(() => ({ outcome: 'helper-unavailable' as const }));
      if (resolved.outcome !== 'success') {
        surfaceController.markDisconnected(created.surfaceId);
        surfaceController.retire(created.surfaceId);
        const reason = 'error' in resolved && resolved.error ? ` ${resolved.error}` : '';
        return { outcome: 'refused', detail: `adoption failed (${resolved.outcome}).${reason}` };
      }
      surfaceId = created.surfaceId;
      originalBounds = { ...(resolved.surface?.originalBounds ?? current.bounds) };
    } else {
      follower = createAdoptedWindowFollower(service);
      const adopted = await follower.adopt(capability);
      if (adopted.outcome !== 'adopted') {
        const reason = 'error' in adopted && adopted.error ? ` ${adopted.error}` : '';
        return { outcome: 'refused', detail: `adoption failed (${adopted.outcome}).${reason}` };
      }
      originalBounds = { ...adopted.originalBounds };
    }
    try {
      focused.getBounds();
    } catch {
      if (surfaceId && surfaceController) {
        surfaceController.markDisconnected(surfaceId);
        surfaceController.retire(surfaceId);
      } else {
        follower?.abandon();
      }
      return { outcome: 'refused', detail: 'the Papers window could not be read.' };
    }
    const display = displayFor(focused);
    const key = stableAdoptionKey(hovered.candidate.id, picked.descriptor);
    if (adoptions.has(key)) {
      if (surfaceId && surfaceController) {
        surfaceController.markDisconnected(surfaceId);
        surfaceController.retire(surfaceId);
      } else {
        follower?.abandon();
      }
      return { outcome: 'refused', detail: 'that window is already adopted. Hover it again to release it.' };
    }
    const entry: Adoption = {
      key,
      candidateId: key,
      title: current.title || hovered.candidate.title || 'window',
      widthDip: Math.max(ADOPT_DOCK_MIN_WIDTH_DIP, Math.round(current.bounds.width / (display.scaleFactor || 1))),
      hostWindow: nativeHandleFor(focused),
      descriptor: { ...picked.descriptor },
      recoveryId: randomUUID(),
      papersWindow: focused,
      follower,
      surfaceId,
    };
    try {
      await recovery?.arm({
        recoveryId: entry.recoveryId,
        descriptor: entry.descriptor,
        originalBounds,
        recordedAt: now(),
      });
    } catch {
      abandonAdoption(entry);
      return { outcome: 'refused', detail: 'recovery could not be armed, so the foreign window was not moved.' };
    }
    adoptions.set(key, entry);
    watchPapersWindow(focused);
    const placed = (await followNow()).get(key);
    if (!placed || placed.outcome !== 'applied') {
      adoptions.delete(key);
      const released = await releaseAdoption(entry).catch(() => ({ outcome: 'helper-unavailable' as const }));
      if (released.outcome === 'released' || released.outcome === 'missing') {
        await recovery?.clear(entry.recoveryId).catch(() => undefined);
      }
      detachUnusedPapersListeners();
      await followNow();
      const reason = placed && placed.error ? ` ${placed.error}` : '';
      return { outcome: 'refused', detail: `the window would not move (${placed?.outcome ?? 'unknown'}).${reason} Nothing was changed.` };
    }
    return {
      outcome: 'docked',
      title: entry.title,
      detail: `'${entry.title}' now sits beside Papers and follows it. Hover it and press ${accelerator} again to put it back.`,
    };
  }

  async function toggle(focused: DockPapersWindow | null): Promise<DockToggleOutcome> {
    if (toggling) return { outcome: 'refused', detail: 'a dock action is already running.' };
    toggling = true;
    try {
      if (!focused || focused.isDestroyed()) {
        return { outcome: 'refused', detail: 'no Papers window is focused. Open Papers first.' };
      }
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
      const existing = existingAdoption(hovered.candidate.id, hovered.descriptor);
      if (existing) return await releaseSession(existing.key);
      return await adopt(focused, hovered);
    } finally {
      toggling = false;
    }
  }

  async function releaseAll(): Promise<void> {
    if (followTimer !== null) {
      clearTimeout(followTimer);
      followTimer = null;
    }
    const entries = [...adoptions.values()];
    for (const entry of entries) {
      const released = await releaseAdoption(entry).catch(() => ({ outcome: 'helper-unavailable' as const }));
      if (released.outcome === 'released' || released.outcome === 'missing') {
        adoptions.delete(entry.key);
        await recovery?.clear(entry.recoveryId).catch(() => undefined);
      }
    }
    detach();
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

    releaseAll,

    release() {
      try {
        shortcut.unregister(accelerator);
      } catch {
        /* releasing must never throw */
      }
      void releaseAll();
    },

    toggle,

    get active() {
      return adoptions.size > 0;
    },

    get adoptedTitle() {
      return adoptions.values().next().value?.title ?? null;
    },
  };
}
