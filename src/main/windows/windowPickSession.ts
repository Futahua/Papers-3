/**
 * Papers-owned direct-onscreen PICK SESSION (Assignment 016 + 019B + 021).
 *
 * One bounded global session that lets the creator pick windows with the
 * pointer: while active, a main-owned thin overlay draws green perimeters
 * around the picking layout's resolved (unstaged) members plus a blue/red wash
 * over the hovered eligible window. 021: the overlay is ALWAYS click-through
 * (setIgnoreMouseEvents(true,{forward:true})), never focused and never captures
 * input, and is sized to the current visible painted (target/member) union, so
 * it can never block the desktop. Live hover is driven by polling the
 * cursor-screen seam into the pointer-move pipeline (SlopTop-style); staging is
 * a click/keyboard toggle and Enter commits the complete staged set in ONE typed
 * result; Escape cancels with zero mutation. Keyboard flow lives on the
 * launching workspace page (Enter/Escape/Space routed through the pick bridges).
 * The Backpack never receives, supplies or persists HWND, PID, process path,
 * native coordinates as authority, raw protocol commands or overlay window
 * identity.
 *
 * Ownership and safety:
 * - Hover resolution, eligibility and the highlight surface are
 *   Papers-owned (helper-side task-worthiness; overlay windows owned here).
 * - ONE session is global: a second begin replaces/cancels the first
 *   deterministically. Shutdown, project leave, display change and helper
 *   failure always clear the overlay, staged state and hover.
 * - A click/stage is authorized only for the exact currently highlighted
 *   host-issued candidate and stages it without a helper round-trip.
 * - No target window or member list is ever mutated in Papers: the typed
 *   committed result lets As You Go apply the staged add/remove sets.
 * - Visual safety: affected area is thin perimeters plus the hovered window's
 *   interior wash and faint persistent staged markers; colour/opacity are
 *   static; nothing animates or pulses.
 */

import type {
  PersistedWindowMemberDescriptor,
  WindowBindResult,
  WindowCandidate,
  WindowCapabilityService,
  WindowHoverResult,
  WindowRuntimeCapability,
} from './windowCapabilityService';
import type { WindowBounds } from './windowCapabilityTypes';

export const WINDOW_PICK_MAX_MEMBERS = 32;
/** Overlay click/pointer screen points are bounded to a sane multi-monitor
 * range and must be finite integers - an unbounded or fractional coordinate
 * never reaches session/helper logic (016R). */
export const WINDOW_PICK_POINT_RANGE = 65536;
/** 021: live-hover cursor poll interval. The overlay is click-through and
 * never focused, so hover is driven by polling the existing cursor-screen
 * seam and feeding the same pointer-move pipeline (SlopTop-style). */
export const WINDOW_PICK_CURSOR_POLL_MS = 60;
/** 021: the per-target overlay is never smaller than this (a 1x1 transparent
 * pixel when there is nothing painted on a display). */
export const WINDOW_PICK_MIN_OVERLAY_SIZE = 1;

/** Strict validation of the overlay's pick:click payload: exactly {x, y},
 * both finite safe integers within the bounded range, no extra keys, no
 * NaN/Infinity/fractions. Returns null for anything malformed. */
export function parseOverlayClick(raw: unknown): { x: number; y: number } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw as Record<string, unknown>).sort();
  if (keys.length !== 2 || keys[0] !== 'x' || keys[1] !== 'y') return null;
  const x = (raw as Record<string, unknown>)['x'];
  const y = (raw as Record<string, unknown>)['y'];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  if (Math.abs(x) > WINDOW_PICK_POINT_RANGE || Math.abs(y) > WINDOW_PICK_POINT_RANGE) return null;
  return { x, y };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(raw).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** A bounds object is only acceptable when it is exactly {x, y, width,
 * height} of finite numbers within the bounded coordinate range. */
function sanitizeBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ['x', 'y', 'width', 'height'])) return null;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > WINDOW_PICK_POINT_RANGE) {
      return null;
    }
  }
  if ((raw['width'] as number) <= 0 || (raw['height'] as number) <= 0) return null;
  return {
    x: raw['x'] as number,
    y: raw['y'] as number,
    width: raw['width'] as number,
    height: raw['height'] as number,
  };
}

/** Strict validation of the overlay draw state (019B): exact keys only,
 * finite bounded numbers, hover.kind present only on the hover object, a
 * bounded green list and a bounded staged list. Malformed state is rejected as
 * a whole - the renderer is never shown a partial or invalid frame. */
export function sanitizeOverlayState(raw: unknown): PickOverlayState | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ['green', 'hover', 'staged', 'display'])) return null;
  if (!Array.isArray(raw['green']) || raw['green'].length > 64) return null;
  const green: WindowBounds[] = [];
  for (const item of raw['green']) {
    const bounds = sanitizeBounds(item);
    if (!bounds) return null;
    green.push(bounds);
  }
  let hover: (WindowBounds & { kind: 'add' | 'remove' }) | null = null;
  if (raw['hover'] !== null) {
    if (!isPlainObject(raw['hover']) || !exactKeys(raw['hover'], ['x', 'y', 'width', 'height', 'kind'])) return null;
    if (raw['hover']['kind'] !== 'add' && raw['hover']['kind'] !== 'remove') return null;
    const bounds = sanitizeBounds({
      x: raw['hover']['x'],
      y: raw['hover']['y'],
      width: raw['hover']['width'],
      height: raw['hover']['height'],
    });
    if (!bounds) return null;
    hover = { ...bounds, kind: raw['hover']['kind'] };
  }
  if (!Array.isArray(raw['staged']) || raw['staged'].length > 64) return null;
  const staged: Array<WindowBounds & { kind: 'add' | 'remove' }> = [];
  for (const item of raw['staged']) {
    if (!isPlainObject(item) || !exactKeys(item, ['x', 'y', 'width', 'height', 'kind'])) return null;
    if (item['kind'] !== 'add' && item['kind'] !== 'remove') return null;
    const bounds = sanitizeBounds({
      x: item['x'],
      y: item['y'],
      width: item['width'],
      height: item['height'],
    });
    if (!bounds) return null;
    staged.push({ ...bounds, kind: item['kind'] });
  }
  const display = sanitizeBounds(raw['display']);
  if (!display) return null;
  return { green, hover, staged, display };
}

export interface PickCommittedAdd {
  descriptor: PersistedWindowMemberDescriptor;
  capability: WindowRuntimeCapability;
  candidate: WindowCandidate;
}

export interface PickCommittedRemove {
  descriptor: PersistedWindowMemberDescriptor;
}

/** 019B: the pick session now returns ONE typed committed set (Enter) or a
 * zero-mutation cancel (Escape). Papers never mutates a target window or the
 * member list; As You Go applies the staged add/remove sets itself. */
export type WindowPickResult =
  | { outcome: 'committed'; adds: PickCommittedAdd[]; removes: PickCommittedRemove[] }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; error?: string };

export interface PickOverlayState {
  green: WindowBounds[];
  hover: (WindowBounds & { kind: 'add' | 'remove' }) | null;
  /** Persistent staged markers (019B): blue for staged adds, red for staged
   * removes, drawn even after the pointer leaves the window. */
  staged: Array<WindowBounds & { kind: 'add' | 'remove' }>;
  /** The overlay's own display bounds in screen coordinates; the overlay
   * renderer offsets screen-space rects by this origin. */
  display: { x: number; y: number; width: number; height: number };
}

export interface PickOverlayWindow {
  sendState(state: PickOverlayState): void;
  show(): void;
  /** 021: reposition/resize the overlay to the current visible painted
   * (target/member) union so the thin highlight never covers the desktop. */
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  close(): void;
}

export interface PickOverlayNativeWindow {
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  showInactive(): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface PickOverlayDesiredState {
  shown: boolean;
}

/** 021: reapply native ownership in the only safe order after a BrowserWindow
 * rebuild: the overlay is ALWAYS click-through (forwarding) and NEVER takes
 * focus, so the desktop beneath keeps every real mouse/keyboard event; the
 * highlight window is shown inactive only. This runs synchronously before
 * preload readiness is checked. */
export function applyPickOverlayDesiredState(
  window: PickOverlayNativeWindow,
  desired: PickOverlayDesiredState,
): void {
  window.setIgnoreMouseEvents(true, { forward: true });
  if (desired.shown) window.showInactive();
}

export interface PickDisplay {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowPickScreen {
  getCursorScreenPoint(): { x: number; y: number };
  getAllDisplays(): PickDisplay[];
  onDisplayChange(callback: () => void): () => void;
}

export interface WindowPickSessionDependencies {
  service: PickService;
  screen: WindowPickScreen;
  createOverlay: (display: PickDisplay, handlers: {
    onClick(x: number, y: number): void;
    onCancel(): void;
    onPointerMove(x: number, y: number): void;
    onCommit(): void;
  }) => PickOverlayWindow;
  maxMembers?: number;
}

/** The narrow service surface the session needs. */
export interface PickService {
  hoverAt(x: number, y: number): Promise<WindowHoverResult>;
  pickAt(x: number, y: number, candidateId: string): Promise<WindowBindResult & { candidate?: WindowCandidate }>;
  resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<
    | { outcome: 'success'; capability: WindowRuntimeCapability; descriptor: PersistedWindowMemberDescriptor }
    | { outcome: 'missing' | 'ambiguous' | 'helper-unavailable' | 'timeout'; error?: string }
  >;
  observeCapability(capability: WindowRuntimeCapability): Promise<
    | { outcome: 'success'; observation: { bounds: WindowBounds | null } }
    | { outcome: 'missing' | 'ambiguous' | 'denied' | 'malformed' | 'helper-unavailable' | 'timeout'; error?: string }
  >;
}

export interface WindowPickSession {
  begin(options: {
    memberDescriptors: PersistedWindowMemberDescriptor[];
    onResult: (result: WindowPickResult) => void;
  }): Promise<{ outcome: 'started' } | { outcome: 'failed'; error?: string }>;
  /** 021: toggle-stage the currently hovered candidate (workspace-page key,
   * e.g. Space). No helper round-trip; nothing mutates until commit. */
  stage(): void;
  /** 021: commit the complete staged set exactly once (workspace-page Enter). */
  commit(): Promise<void>;
  cancel(): Promise<void>;
  readonly active: boolean;
}

function isDescriptor(d: unknown): d is PersistedWindowMemberDescriptor {
  if (!d || typeof d !== 'object') return false;
  const record = d as Record<string, unknown>;
  return record['version'] === 1
    && typeof record['title'] === 'string'
    && /^[a-f0-9]{64}$/i.test(String(record['executableFingerprint'] ?? ''));
}

export function createWindowPickSession({
  service,
  screen,
  createOverlay,
  maxMembers = WINDOW_PICK_MAX_MEMBERS,
}: WindowPickSessionDependencies): WindowPickSession {
  let active = false;
  let onResult: ((result: WindowPickResult) => void) | null = null;
  let memberDescriptors: PersistedWindowMemberDescriptor[] = [];
  // 019B: green = current (unstaged) members' resolved bounds, keyed by
  // descriptor so a staged removal drops its ring.
  let greenMembers: Array<{ bounds: WindowBounds; descriptor: PersistedWindowMemberDescriptor }> = [];
  // 019B: pointer-move driven hover. latestPoint is the most recent forwarded
  // point; pendingPoint holds the newest point while a resolve is in flight;
  // lastResolvedPoint dedups; lastCandidate is the resolved window at the last
  // painted point.
  let latestPoint: { x: number; y: number } | null = null;
  let pendingPoint: { x: number; y: number } | null = null;
  let resolveInFlight = false;
  let lastResolvedPoint: { x: number; y: number } | null = null;
  let lastCandidate: {
    candidate: WindowCandidate;
    bounds: WindowBounds;
    descriptor: PersistedWindowMemberDescriptor;
    kind: 'add' | 'remove';
  } | null = null;
  // Staged multi-toggle (019B): blue staged adds and red staged removes
  // persist after the pointer leaves; nothing mutates until Enter.
  const stagedAdds = new Map<string, {
    descriptor: PersistedWindowMemberDescriptor;
    candidate: WindowCandidate;
    bounds: WindowBounds;
  }>();
  const stagedRemovals = new Map<string, PersistedWindowMemberDescriptor>();
  const overlays: Array<{ overlay: PickOverlayWindow; display: PickDisplay }> = [];
  let displayUnsubscribe: (() => void) | null = null;
  // 021: live-hover cursor poll. The overlay is click-through and never
  // focused, so hover is resolved from the cursor-screen seam on a short
  // timer instead of overlay mouse events.
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function descriptorKey(descriptor: PersistedWindowMemberDescriptor): string {
    return `${descriptor.executableFingerprint}|${descriptor.title}`;
  }

  function endSession(): void {
    active = false;
    onResult = null;
    memberDescriptors = [];
    greenMembers = [];
    latestPoint = null;
    pendingPoint = null;
    resolveInFlight = false;
    lastResolvedPoint = null;
    lastCandidate = null;
    stagedAdds.clear();
    stagedRemovals.clear();
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const { overlay } of overlays) {
      try { overlay.close(); } catch { /* best-effort */ }
    }
    overlays.length = 0;
    if (displayUnsubscribe) {
      try { displayUnsubscribe(); } catch { /* best-effort */ }
      displayUnsubscribe = null;
    }
  }

  function endWith(result: WindowPickResult): void {
    console.error(`[016r-diag] endWith ${result.outcome}${'error' in result ? ` ${result.error}` : ''}`);
    const callback = onResult;
    endSession();
    if (callback) callback(result);
  }

  function isMemberOfPickingLayout(descriptor: PersistedWindowMemberDescriptor | null): boolean {
    if (!descriptor) return false;
    return memberDescriptors.some((member) =>
      member.title === descriptor.title
      && member.executableFingerprint === descriptor.executableFingerprint);
  }

  /** 021: the thin overlay covers EXACTLY the union of the painted rects on
   * this display (green members + hovered window + staged markers), clamped to
   * the display work area. An empty union degrades to a 1x1 transparent pixel
   * so the overlay never covers the desktop. */
  function overlayUnion(display: PickDisplay, rects: WindowBounds[]): { x: number; y: number; width: number; height: number } {
    const onDisplay = rects.filter((rect) => rectOnDisplay(rect, display));
    if (onDisplay.length === 0) {
      return { x: display.x, y: display.y, width: WINDOW_PICK_MIN_OVERLAY_SIZE, height: WINDOW_PICK_MIN_OVERLAY_SIZE };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of onDisplay) {
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    left = Math.max(left, display.x);
    top = Math.max(top, display.y);
    right = Math.min(right, display.x + display.width);
    bottom = Math.min(bottom, display.y + display.height);
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.max(WINDOW_PICK_MIN_OVERLAY_SIZE, Math.round(right - left)),
      height: Math.max(WINDOW_PICK_MIN_OVERLAY_SIZE, Math.round(bottom - top)),
    };
  }

  function pushState(): void {
    // Green remains current, unstaged membership (019B): a staged removal
    // drops its ring; staged adds/removes draw persistent blue/red markers.
    const green = greenMembers
      .filter((entry) => !stagedRemovals.has(descriptorKey(entry.descriptor)))
      .map((entry) => entry.bounds);
    const staged: Array<WindowBounds & { kind: 'add' | 'remove' }> = [];
    for (const stagedAdd of stagedAdds.values()) {
      staged.push({ ...stagedAdd.bounds, kind: 'add' });
    }
    for (const descriptor of stagedRemovals.values()) {
      const member = greenMembers.find((entry) => descriptorKey(entry.descriptor) === descriptorKey(descriptor));
      if (member) staged.push({ ...member.bounds, kind: 'remove' });
    }
    for (const { overlay, display } of overlays) {
      const hover = lastCandidate && rectOnDisplay(lastCandidate.bounds, display)
        ? { ...lastCandidate.bounds, kind: lastCandidate.kind }
        : null;
      const painted: WindowBounds[] = [...green];
      if (hover) painted.push(hover);
      for (const marker of staged) {
        if (rectOnDisplay(marker, display)) painted.push(marker);
      }
      const union = overlayUnion(display, painted);
      overlay.setBounds(union);
      const state = sanitizeOverlayState({
        green,
        hover,
        staged,
        display: union,
      });
      if (!state) continue;
      overlay.sendState(state);
    }
  }

  function rectOnDisplay(rect: WindowBounds, display: PickDisplay): boolean {
    return rect.x < display.x + display.width
      && rect.x + rect.width > display.x
      && rect.y < display.y + display.height
      && rect.y + rect.height > display.y;
  }

  /** 019B: pointer-move driven hover with latest-point coalescing and dedup.
   * A move while a resolve is in flight only records the newest point; when
   * that resolve returns, a newer point present means the stale result must
   * NOT repaint (the finally re-runs for the newest point). */
  function onPointerMove(x: number, y: number): void {
    if (!active) return;
    latestPoint = { x, y };
    if (resolveInFlight) {
      pendingPoint = { x, y };
      return;
    }
    if (lastResolvedPoint && lastResolvedPoint.x === x && lastResolvedPoint.y === y) return;
    void resolveHover();
  }

  async function resolveHover(): Promise<void> {
    const point = pendingPoint ?? latestPoint;
    if (!point) return;
    pendingPoint = null;
    resolveInFlight = true;
    try {
      const result = await service.hoverAt(point.x, point.y);
      if (!active) return;
      const newest = pendingPoint ?? latestPoint;
      if (newest && (newest.x !== point.x || newest.y !== point.y)) return;
      lastResolvedPoint = point;
      if (result.outcome === 'success' && result.candidate && result.bounds && result.descriptor) {
        lastCandidate = {
          candidate: result.candidate,
          bounds: result.bounds,
          descriptor: result.descriptor,
          kind: isMemberOfPickingLayout(result.descriptor) ? 'remove' : 'add',
        };
      } else {
        // Blank or transient failure: never strand an old highlight.
        lastCandidate = null;
      }
      pushState();
    } catch {
      if (active) {
        lastCandidate = null;
        pushState();
      }
    } finally {
      resolveInFlight = false;
      if (pendingPoint) void resolveHover();
    }
  }

  /** 019B: click STAGES the last resolved candidate without any helper
   * round-trip and without mutating anything. A click only applies when it
   * lands inside the last resolved candidate's bounds. */
  function onStageClick(x: number, y: number): void {
    if (!active || !lastCandidate) return;
    const bounds = lastCandidate.bounds;
    if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) return;
    if (lastCandidate.kind === 'add') {
      if (stagedAdds.has(lastCandidate.candidate.id)) {
        stagedAdds.delete(lastCandidate.candidate.id);
      } else {
        stagedAdds.set(lastCandidate.candidate.id, {
          descriptor: lastCandidate.descriptor,
          candidate: lastCandidate.candidate,
          bounds: { ...lastCandidate.bounds },
        });
      }
    } else {
      const key = descriptorKey(lastCandidate.descriptor);
      if (stagedRemovals.has(key)) stagedRemovals.delete(key);
      else stagedRemovals.set(key, lastCandidate.descriptor);
    }
    pushState();
  }

  /** 019B: Enter commits the complete staged set exactly once. Candidate
   * resolution/binding happens here (Paper-owned); no target window or member
   * list is mutated - the typed result lets As You Go apply the sets. */
  async function onCommit(): Promise<void> {
    if (!active) return;
    const adds: PickCommittedAdd[] = [];
    const removes: PickCommittedRemove[] = [];
    for (const staged of stagedAdds.values()) {
      const cx = staged.bounds.x + Math.floor(staged.bounds.width / 2);
      const cy = staged.bounds.y + Math.floor(staged.bounds.height / 2);
      const bound = await service.pickAt(cx, cy, staged.candidate.id).catch(() => null);
      if (!active) return;
      if (bound && bound.outcome === 'success' && bound.capability && bound.descriptor) {
        adds.push({
          descriptor: bound.descriptor,
          capability: bound.capability,
          candidate: bound.candidate ?? staged.candidate,
        });
      }
      // A failed staged add is skipped (typed partial semantics).
    }
    for (const descriptor of stagedRemovals.values()) removes.push({ descriptor });
    endWith({ outcome: 'committed', adds, removes });
  }

  function onCancel(): void {
    // 019B: Escape / right-click cancels with zero mutation.
    if (active) {
      console.error('[016r-diag] onCancel received');
      endWith({ outcome: 'cancelled' });
    }
  }

  async function resolveGreenRects(): Promise<Array<{ bounds: WindowBounds; descriptor: PersistedWindowMemberDescriptor }>> {
    const rects: Array<{ bounds: WindowBounds; descriptor: PersistedWindowMemberDescriptor }> = [];
    const seen = new Set<string>();
    for (const descriptor of memberDescriptors) {
      const key = descriptorKey(descriptor);
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = await service.resolvePersisted(descriptor).catch(() => null);
      if (!resolved || resolved.outcome !== 'success') continue;
      const observed = await service.observeCapability(resolved.capability).catch(() => null);
      if (!observed || observed.outcome !== 'success' || !observed.observation?.bounds) continue;
      rects.push({ bounds: observed.observation.bounds, descriptor });
    }
    return rects;
  }

  /** 019B: green member rects resolve in the background; begin() never waits
   * on them, so the overlay is live the moment it is shown. */
  async function refreshGreenRects(): Promise<void> {
    if (!active) return;
    greenMembers = await resolveGreenRects();
    if (!active) return;
    pushState();
  }

  async function begin(options: {
    memberDescriptors: PersistedWindowMemberDescriptor[];
    onResult: (result: WindowPickResult) => void;
  }): Promise<{ outcome: 'started' } | { outcome: 'failed'; error?: string }> {
    console.error(`[016r-diag] begin called members=${options.memberDescriptors.length}`);
    // A second request replaces/cancels the first deterministically.
    if (active) {
      const previous = onResult;
      endSession();
      if (previous) previous({ outcome: 'cancelled' });
    }
    if (!Array.isArray(options.memberDescriptors) || options.memberDescriptors.length > maxMembers
      || !options.memberDescriptors.every(isDescriptor)) {
      return { outcome: 'failed', error: 'member list is malformed or exceeds the bound' };
    }
    memberDescriptors = [...options.memberDescriptors];
    onResult = options.onResult;
    active = true;
    try {
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        overlays.push({ overlay: createOverlay(display, { onClick: onStageClick, onCancel, onPointerMove, onCommit }), display });
      }
      if (overlays.length === 0) {
        endSession();
        return { outcome: 'failed', error: 'no display is available for picking' };
      }
      // 021: the overlay is ALWAYS click-through and NEVER takes focus or
      // captures input - the desktop keeps every real mouse/keyboard event.
      // Hover is driven by the cursor poll below, not by overlay events.
      for (const { overlay } of overlays) overlay.show();
      displayUnsubscribe = screen.onDisplayChange(() => {
        if (active) endWith({ outcome: 'cancelled' });
      });
      pushState();
      // 021: live hover from the cursor-screen seam (SlopTop-style 60 ms poll).
      pollTimer = setInterval(() => {
        if (!active) return;
        const point = screen.getCursorScreenPoint();
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
          onPointerMove(Math.round(point.x), Math.round(point.y));
        }
      }, WINDOW_PICK_CURSOR_POLL_MS);
      // Green rects resolve in the background (no startup blockade).
      void refreshGreenRects();
      return { outcome: 'started' };
    } catch {
      endSession();
      return { outcome: 'failed', error: 'could not start the pick overlay' };
    }
  }

  async function cancel(): Promise<void> {
    if (active) endWith({ outcome: 'cancelled' });
  }

  /** 021: workspace-page toggle (e.g. Space) stages the currently hovered
   * candidate; no helper round-trip, nothing mutates until commit. */
  function stage(): void {
    if (!active || !lastCandidate) return;
    const cx = lastCandidate.bounds.x + Math.floor(lastCandidate.bounds.width / 2);
    const cy = lastCandidate.bounds.y + Math.floor(lastCandidate.bounds.height / 2);
    onStageClick(cx, cy);
  }

  /** 021: workspace-page Enter commits the complete staged set exactly once. */
  function commit(): Promise<void> {
    return onCommit();
  }

  return {
    begin,
    stage,
    commit,
    cancel,
    get active() {
      return active;
    },
  };
}

/** Production wiring (index.ts). Follows the accepted pattern of pulling
 * electron lazily so the pure module stays unit-testable under vitest. */
export function createPickSessionFromService(service: WindowCapabilityService): WindowPickSession {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { screen, BrowserWindow, ipcMain } = require('electron') as {
    screen: {
      getCursorScreenPoint(): { x: number; y: number };
      getAllDisplays(): Array<{ id: number; bounds: { x: number; y: number; width: number; height: number } }>;
      on(event: string, callback: () => void): void;
      removeListener(event: string, callback: () => void): void;
    };
    BrowserWindow: new (options: Record<string, unknown>) => {
      readonly webContents: {
        id: number;
        send(channel: string, payload: unknown): Promise<void>;
        executeJavaScript(script: string): Promise<unknown>;
      };
      setAlwaysOnTop(flag: boolean, level: string): void;
      setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
      setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
      focus(): void;
      showInactive(): void;
      isDestroyed(): boolean;
      destroy(): void;
      loadURL(url: string): Promise<void>;
      on(event: 'ready-to-show', callback: () => void): void;
    };
    ipcMain: {
      on(channel: string, handler: (event: unknown, payload?: unknown) => void): void;
      removeListener(channel: string, handler: (event: unknown, payload?: unknown) => void): void;
    };
  };
  const path = require('node:path') as typeof import('node:path');
  const preloadPath = path.join(__dirname, '..', 'preload', 'pickOverlay.cjs');
  const overlayHtml = buildOverlayHtml();

  function createOverlay(display: PickDisplay, handlers: {
    onClick(x: number, y: number): void;
    onCancel(): void;
    onPointerMove(x: number, y: number): void;
    onCommit(): void;
  }): PickOverlayWindow {
    // The overlay renderer is sandboxed; Electron intermittently fails the
    // very first sandboxed-renderer preload startup ("binding.startupData
    // is null" race), which leaves window.pickOverlay undefined. Verified
    // at first paint; a single rebuild deterministically recovers without
    // weakening the sandbox.
    let retried = false;
    let shown = false;
    let live: {
      window: InstanceType<typeof BrowserWindow>;
      webContentsId: number;
      onClickHandler: (event: unknown, payload?: unknown) => void;
      onCancelHandler: (event: unknown) => void;
      onPointerMoveHandler: (event: unknown, payload?: unknown) => void;
      onCommitHandler: (event: unknown) => void;
    } | null = null;
    const build = (): void => {
      const window = new BrowserWindow({
        x: display.x,
        y: display.y,
        width: WINDOW_PICK_MIN_OVERLAY_SIZE,
        height: WINDOW_PICK_MIN_OVERLAY_SIZE,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        // 021: the overlay never takes focus or captures input - the desktop
        // beneath keeps every real mouse/keyboard event. It is sized per-target
        // by the session and ALWAYS click-through.
        focusable: false,
        hasShadow: false,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.setAlwaysOnTop(true, 'screen-saver');
      const webContentsId = window.webContents.id;
      const onClickHandler = (event: unknown, payload?: unknown): void => {
        const sender = (event as { sender?: { id?: number } }).sender;
        if (!sender || sender.id !== webContentsId) return;
        const point = parseOverlayClick(payload);
        if (point) handlers.onClick(point.x, point.y);
      };
      const onPointerMoveHandler = (event: unknown, payload?: unknown): void => {
        const sender = (event as { sender?: { id?: number } }).sender;
        if (!sender || sender.id !== webContentsId) return;
        const point = parseOverlayClick(payload);
        if (point) handlers.onPointerMove(point.x, point.y);
      };
      const onCommitHandler = (event: unknown): void => {
        const sender = (event as { sender?: { id?: number } }).sender;
        if (!sender || sender.id !== webContentsId) return;
        handlers.onCommit();
      };
      const onCancelHandler = (event: unknown): void => {
        const sender = (event as { sender?: { id?: number } }).sender;
        if (!sender || sender.id !== webContentsId) return;
        handlers.onCancel();
      };
      ipcMain.on('pick:click', onClickHandler);
      ipcMain.on('pick:cancel', onCancelHandler);
      ipcMain.on('pick:pointer-move', onPointerMoveHandler);
      ipcMain.on('pick:commit', onCommitHandler);
      live = { window, webContentsId, onClickHandler, onCancelHandler, onPointerMoveHandler, onCommitHandler };
      applyPickOverlayDesiredState(window, { shown });
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`);
      // 021: the overlay is ALWAYS click-through and never focused; it is shown
      // inactive for visibility only. Keyboard flow lives on the launching
      // workspace page (Enter/Escape/Space routed through the pick bridges).
      window.on('ready-to-show', () => {
        if (window.isDestroyed()) return;
        void window.webContents.executeJavaScript('typeof window.pickOverlay').then((bridgeType) => {
          if (window.isDestroyed()) return;
          if (bridgeType === 'object') {
            // 021: shown inactive only - the overlay never takes focus, so the
            // launching workspace page keeps the keyboard.
            window.showInactive();
            return;
          }
          if (retried) return;
          retried = true;
          ipcMain.removeListener('pick:click', onClickHandler);
          ipcMain.removeListener('pick:cancel', onCancelHandler);
          window.destroy();
          build();
        }).catch(() => {
          // executeJavaScript raced the destroy; the window is already gone.
        });
      });
    };
    build();
    return {
      sendState: (state) => {
        if (live && !live.window.isDestroyed()) {
          void live.window.webContents.send('pick:state', state);
        }
      },
      show: () => {
        shown = true;
        if (live && !live.window.isDestroyed()) {
          applyPickOverlayDesiredState(live.window, { shown });
        }
      },
      setBounds: (bounds) => {
        if (live && !live.window.isDestroyed()) {
          live.window.setBounds(bounds);
        }
      },
      close: () => {
        if (live) {
          ipcMain.removeListener('pick:click', live.onClickHandler);
          ipcMain.removeListener('pick:cancel', live.onCancelHandler);
          ipcMain.removeListener('pick:pointer-move', live.onPointerMoveHandler);
          ipcMain.removeListener('pick:commit', live.onCommitHandler);
          if (!live.window.isDestroyed()) live.window.destroy();
          live = null;
        }
      },
    };
  }

  const pickService: PickService = {
    hoverAt: (x, y) => service.hoverAt(x, y),
    pickAt: (x, y, candidateId) => service.pickAt(x, y, candidateId),
    resolvePersisted: (descriptor) => service.resolvePersisted(descriptor),
    observeCapability: (capability) => service.observeCapability(capability).then((result) => {
      if (result.outcome === 'success' && result.observation) {
        return { outcome: 'success' as const, observation: { bounds: result.observation.bounds } };
      }
      if (result.outcome === 'success') {
        return { outcome: 'missing' as const, error: 'observation unavailable' };
      }
      return { outcome: result.outcome as 'missing' | 'ambiguous' | 'denied' | 'malformed' | 'helper-unavailable' | 'timeout', ...(result.error !== undefined ? { error: result.error } : {}) };
    }),
  };

  return createWindowPickSession({
    service: pickService,
    screen: {
      getCursorScreenPoint: () => screen.getCursorScreenPoint(),
      getAllDisplays: () => screen.getAllDisplays().map((display) => ({
        id: display.id,
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      })),
      onDisplayChange: (callback) => {
        // 016R: any display lifecycle change (metrics, added or removed)
        // cancels the session and destroys every overlay/capture.
        const events = ['display-metrics-changed', 'display-added', 'display-removed'];
        for (const event of events) {
          screen.on(event, callback);
        }
        return () => {
          for (const event of events) {
            screen.removeListener(event, callback);
          }
        };
      },
    },
    createOverlay,
  });
}

/** 021: exported for the noninteractive rendered-tint proof (the overlay page
 * must draw an OPAQUE border fallback plus the translucent blue/red/green wash).
 * Used by createPickSessionFromService for the data: overlay URL. */
export function buildOverlayHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let state = null;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    draw();
  }
  function offsetRect(rect) {
    const ox = (state && state.display && state.display.x) || 0;
    const oy = (state && state.display && state.display.y) || 0;
    return { x: rect.x - ox, y: rect.y - oy, w: rect.width, h: rect.height };
  }
  function onScreen(rect) {
    return rect.x + rect.w > 0 && rect.y + rect.h > 0
      && rect.x < window.innerWidth && rect.y < window.innerHeight;
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 021: borders are FULLY OPAQUE so the highlight is visible even where
    // transparent-window compositing cannot prove pixels; the interior wash
    // stays translucent.
    for (const g of state.green || []) {
      const r = offsetRect(g);
      if (!onScreen(r)) continue;
      ctx.strokeStyle = 'rgb(76, 175, 80)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    const h = state.hover;
    if (h) {
      const r = offsetRect(h);
      if (onScreen(r)) {
        const add = h.kind === 'add';
        ctx.fillStyle = add ? 'rgba(33, 150, 243, 0.22)' : 'rgba(244, 67, 54, 0.22)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = add ? 'rgb(33, 150, 243)' : 'rgb(244, 67, 54)';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }
    // 019B: persistent staged markers - blue stays staged-add, red stays
    // staged-remove even after the pointer leaves the window.
    for (const s of state.staged || []) {
      const r = offsetRect(s);
      if (!onScreen(r)) continue;
      const add = s.kind === 'add';
      ctx.fillStyle = add ? 'rgba(33, 150, 243, 0.10)' : 'rgba(244, 67, 54, 0.10)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = add ? 'rgb(33, 150, 243)' : 'rgb(244, 67, 54)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);
  window.pickOverlay.onState((next) => { state = next; draw(); });
  // 021: the overlay is ALWAYS click-through and never focused, so these page
  // handlers are a fallback only; the primary input path is the launching
  // workspace page, which routes Enter/Escape/Space through the pick bridges.
  window.addEventListener('mousemove', (event) => {
    const ox = (state && state.display && state.display.x) || 0;
    const oy = (state && state.display && state.display.y) || 0;
    window.pickOverlay.pointerMove(Math.round(event.clientX + ox), Math.round(event.clientY + oy));
  });
  window.addEventListener('click', (event) => {
    if (event.button === 0) {
      const ox = (state && state.display && state.display.x) || 0;
      const oy = (state && state.display && state.display.y) || 0;
      window.pickOverlay.click(Math.round(event.clientX + ox), Math.round(event.clientY + oy));
    }
  });
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.pickOverlay.cancel();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.pickOverlay.cancel();
    else if (event.key === 'Enter') window.pickOverlay.commit();
  });
</script>
</body>
</html>`;
}
