/**
 * Papers-owned direct-onscreen PICK SESSION (Assignment 016).
 *
 * One bounded global session that lets the creator pick a window with the
 * pointer: while active, a main-owned overlay draws thin green perimeters
 * around the picking layout's resolved members plus a blue/red wash over the
 * hovered eligible window, and a click toggles that exact window into/out of
 * the layout. The Backpack never receives, supplies or persists HWND, PID,
 * process path, native coordinates as authority, raw protocol commands or
 * overlay window identity: it requests begin/cancel and receives one typed
 * result.
 *
 * Ownership and safety:
 * - Hover resolution, eligibility and the highlight surface are
 *   Papers-owned (helper-side task-worthiness; overlay windows owned here).
 * - ONE session is global: a second begin replaces/cancels the first
 *   deterministically. Shutdown, project leave, display change and helper
 *   failure always clear the overlay, capture, timer and hover candidate.
 * - A click is authorized only for the exact currently highlighted
 *   host-issued candidate and fails closed if it changes or vanishes.
 * - The target window never receives the selection click as a side effect:
 *   the overlay captures input only while a candidate is hovered.
 * - Visual safety: affected area is thin perimeters plus ONE hovered
 *   window's interior wash; colour/opacity are static between pick start,
 *   pointer re-entry, toggle and pick end; nothing animates or pulses.
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
export const WINDOW_PICK_SAMPLE_INTERVAL_MS = 80;
/** 016R gap 8: green member rects are re-resolved every N samples (~640 ms
 * at the default 80 ms cadence) so moved members keep their outlines on the
 * current bounds; bounded so a large layout never starves the hover path. */
export const WINDOW_PICK_GREEN_REFRESH_EVERY = 8;
/** Overlay click screen points are bounded to a sane multi-monitor range
 * and must be finite integers - an unbounded or fractional coordinate never
 * reaches session/helper logic (016R). */
export const WINDOW_PICK_POINT_RANGE = 65536;

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
  return {
    x: raw['x'] as number,
    y: raw['y'] as number,
    width: raw['width'] as number,
    height: raw['height'] as number,
  };
}

/** Strict validation of the overlay draw state (016R): exact keys only,
 * finite bounded numbers, hover.kind present only on the hover object, a
 * bounded green list. Malformed state is rejected as a whole - the renderer
 * is never shown a partial or invalid frame. */
export function sanitizeOverlayState(raw: unknown): PickOverlayState | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ['green', 'hover', 'display'])) return null;
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
  const display = sanitizeBounds(raw['display']);
  if (!display) return null;
  return { green, hover, display };
}

export interface WindowPickResult {
  outcome: 'picked' | 'cancelled' | 'failed';
  candidate?: WindowCandidate;
  capability?: WindowRuntimeCapability;
  descriptor?: PersistedWindowMemberDescriptor;
  error?: string;
}

export interface PickOverlayState {
  green: WindowBounds[];
  hover: (WindowBounds & { kind: 'add' | 'remove' }) | null;
  /** The overlay's own display bounds in screen coordinates; the overlay
   * renderer offsets screen-space rects by this origin. */
  display: { x: number; y: number; width: number; height: number };
}

export interface PickOverlayWindow {
  sendState(state: PickOverlayState): void;
  show(): void;
  setCapture(capture: boolean): void;
  focus(): void;
  close(): void;
}

export interface PickOverlayNativeWindow {
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  showInactive(): void;
  focus(): void;
}

export interface PickOverlayDesiredState {
  capture: boolean;
  shown: boolean;
  focused: boolean;
}

/** Reapply native ownership in the only safe order after a BrowserWindow
 * rebuild: capture, show, then focus. This runs synchronously before preload
 * readiness is checked. */
export function applyPickOverlayDesiredState(
  window: PickOverlayNativeWindow,
  desired: PickOverlayDesiredState,
): void {
  window.setIgnoreMouseEvents(!desired.capture, { forward: true });
  if (desired.shown) window.showInactive();
  if (desired.focused) window.focus();
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
  }) => PickOverlayWindow;
  sampleIntervalMs?: number;
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
  sampleIntervalMs = WINDOW_PICK_SAMPLE_INTERVAL_MS,
  maxMembers = WINDOW_PICK_MAX_MEMBERS,
}: WindowPickSessionDependencies): WindowPickSession {
  let active = false;
  let onResult: ((result: WindowPickResult) => void) | null = null;
  let memberDescriptors: PersistedWindowMemberDescriptor[] = [];
  let greenRects: WindowBounds[] = [];
  let highlighted: { id: string; descriptor: PersistedWindowMemberDescriptor | null } | null = null;
  let timer: NodeJS.Timeout | null = null;
  let sampleInFlight = false;
  // 016R gap 8: green member rects are re-resolved at a bounded cadence of
  // the sampling rate, so a selected window that moves during the session
  // keeps its outline on the CURRENT bounds - static, never animated.
  let greenRefreshCounter = 0;
  const overlays: Array<{ overlay: PickOverlayWindow; display: PickDisplay }> = [];
  let displayUnsubscribe: (() => void) | null = null;

  function deliver(result: WindowPickResult): void {
    if (onResult) {
      const callback = onResult;
      onResult = null;
      callback(result);
    }
  }

  function endSession(): void {
    active = false;
    onResult = null;
    memberDescriptors = [];
    greenRects = [];
    highlighted = null;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    sampleInFlight = false;
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

  function pushState(hovered: (WindowBounds & { kind: 'add' | 'remove' }) | null): void {
    for (const { overlay, display } of overlays) {
      const state = sanitizeOverlayState({
        green: greenRects,
        hover: hovered && rectOnDisplay(hovered, display) ? hovered : null,
        display: { x: display.x, y: display.y, width: display.width, height: display.height },
      });
      if (!state) continue;
      overlay.sendState(state);
    }
  }

  function setCapture(capture: boolean): void {
    for (const { overlay } of overlays) {
      overlay.setCapture(capture);
    }
  }

  function rectOnDisplay(rect: WindowBounds, display: PickDisplay): boolean {
    return rect.x < display.x + display.width
      && rect.x + rect.width > display.x
      && rect.y < display.y + display.height
      && rect.y + rect.height > display.y;
  }

  async function sample(): Promise<void> {
    if (!active || sampleInFlight) return;
    sampleInFlight = true;
    try {
      // 016R gap 8: refresh the green member rects at a bounded cadence so a
      // moved member keeps its outline on the current bounds.
      greenRefreshCounter += 1;
      if (greenRefreshCounter >= WINDOW_PICK_GREEN_REFRESH_EVERY) {
        greenRefreshCounter = 0;
        greenRects = await resolveGreenRects();
        if (!active) return;
      }
      const point = screen.getCursorScreenPoint();
      const result = await service.hoverAt(point.x, point.y);
      if (!active) return;
      if (result.outcome !== 'success') {
        endWith({ outcome: 'failed', error: result.error ?? 'window helper is unavailable' });
        return;
      }
      if (!result.candidate || !result.bounds || !result.descriptor) {
        highlighted = null;
        pushState(null);
        // Input stays OWED by the picker over blank/excluded areas: the
        // click-through state is never re-enabled mid-session.
        return;
      }
      highlighted = { id: result.candidate.id, descriptor: result.descriptor };
      const kind: 'add' | 'remove' = isMemberOfPickingLayout(result.descriptor) ? 'remove' : 'add';
      pushState({ ...result.bounds, kind });
    } catch {
      if (active) endWith({ outcome: 'failed', error: 'window helper is unavailable' });
    } finally {
      sampleInFlight = false;
    }
  }

  async function onClick(x: number, y: number): Promise<void> {
    console.error(`[016r-diag] onClick x=${x} y=${y} active=${active} highlighted=${highlighted ? highlighted.id : 'null'}`);
    if (!active) return;
    let candidateId = highlighted?.id ?? null;
    // The user may click before any sample completes: resolve at the click
    // point and authorize THAT candidate, exactly as a hover would have. A
    // blank click is owned by the picker and reported as a typed failure; it
    // never reaches the window beneath.
    if (!candidateId) {
      const fresh = await service.hoverAt(x, y).catch(() => null);
      if (!active) return;
      if (fresh?.outcome !== 'success' || !fresh.candidate || !fresh.bounds || !fresh.descriptor) {
        endWith({ outcome: 'failed', error: 'nothing eligible is under the pointer' });
        return;
      }
      highlighted = { id: fresh.candidate.id, descriptor: fresh.descriptor };
      candidateId = fresh.candidate.id;
    }
    const result = await service.pickAt(x, y, candidateId).catch(() => null);
    if (!active) return;
    if (result && result.outcome === 'success') {
      endWith({
        outcome: 'picked',
        candidate: result.candidate,
        capability: result.capability,
        descriptor: result.descriptor,
      });
      return;
    }
    endWith({ outcome: 'failed', error: result?.error ?? 'the hovered window changed before the click' });
  }

  function onCancel(): void {
    // 016R receipt instrumentation: real OS Escape/right-click arrive here
    // through the overlay page, the preload bridge, the sender-gated IPC and
    // the session; the app log records the receipt on the production path.
    if (active) {
      console.error('[016r-diag] onCancel received');
      endWith({ outcome: 'cancelled' });
    }
  }

  async function resolveGreenRects(): Promise<WindowBounds[]> {
    const rects: WindowBounds[] = [];
    const seen = new Set<string>();
    for (const descriptor of memberDescriptors) {
      const key = `${descriptor.executableFingerprint}|${descriptor.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = await service.resolvePersisted(descriptor).catch(() => null);
      if (!resolved || resolved.outcome !== 'success') continue;
      const observed = await service.observeCapability(resolved.capability).catch(() => null);
      if (!observed || observed.outcome !== 'success' || !observed.observation?.bounds) continue;
      rects.push(observed.observation.bounds);
    }
    return rects;
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
        overlays.push({ overlay: createOverlay(display, { onClick, onCancel }), display });
      }
      if (overlays.length === 0) {
        endSession();
        return { outcome: 'failed', error: 'no display is available for picking' };
      }
      // Input is OWNED by the picker from the first instant: capture and
      // focus before any sample, so an immediate click or an Escape/right
      // click over blank/excluded areas is never delivered to the window
      // beneath. Showing first is essential: a hidden native window cannot
      // own input. Hover still resolves THROUGH the Papers-owned overlays.
      setCapture(true);
      for (const { overlay } of overlays) overlay.show();
      overlays[0]!.overlay.focus();
      displayUnsubscribe = screen.onDisplayChange(() => {
        if (active) endWith({ outcome: 'cancelled' });
      });
      greenRects = await resolveGreenRects();
      pushState(null);
      timer = setInterval(() => { void sample(); }, sampleIntervalMs);
      return { outcome: 'started' };
    } catch {
      endSession();
      return { outcome: 'failed', error: 'could not start the pick overlay' };
    }
  }

  async function cancel(): Promise<void> {
    if (active) endWith({ outcome: 'cancelled' });
  }

  return {
    begin,
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

  function createOverlay(display: PickDisplay, handlers: { onClick(x: number, y: number): void; onCancel(): void }): PickOverlayWindow {
    // The overlay renderer is sandboxed; Electron intermittently fails the
    // very first sandboxed-renderer preload startup ("binding.startupData
    // is null" race), which leaves window.pickOverlay undefined. Verified
    // at first paint; a single rebuild deterministically recovers without
    // weakening the sandbox.
    let retried = false;
    let captureOn = false;
    let shown = false;
    let focused = false;
    let live: {
      window: InstanceType<typeof BrowserWindow>;
      webContentsId: number;
      onClickHandler: (event: unknown, payload?: unknown) => void;
      onCancelHandler: (event: unknown) => void;
    } | null = null;
    const build = (): void => {
      const window = new BrowserWindow({
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: true,
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
      const onCancelHandler = (event: unknown): void => {
        const sender = (event as { sender?: { id?: number } }).sender;
        if (!sender || sender.id !== webContentsId) return;
        handlers.onCancel();
      };
      ipcMain.on('pick:click', onClickHandler);
      ipcMain.on('pick:cancel', onCancelHandler);
      live = { window, webContentsId, onClickHandler, onCancelHandler };
      applyPickOverlayDesiredState(window, { capture: captureOn, shown, focused });
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`);
      // 016R: the overlay must OWN keyboard input once visible: showInactive
      // alone leaves keyboard focus on the window beneath, so Escape/right
      // click would never reach the picker. Capture was already enabled at
      // begin; focusing at first paint makes keyboard delivery reliable.
      window.on('ready-to-show', () => {
        if (window.isDestroyed()) return;
        void window.webContents.executeJavaScript('typeof window.pickOverlay').then((bridgeType) => {
          if (window.isDestroyed()) return;
          if (bridgeType === 'object') {
            window.showInactive();
            window.focus();
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
          applyPickOverlayDesiredState(live.window, { capture: captureOn, shown, focused });
        }
      },
      setCapture: (capture) => {
        captureOn = capture;
        if (live && !live.window.isDestroyed()) {
          applyPickOverlayDesiredState(live.window, { capture: captureOn, shown, focused });
        }
      },
      focus: () => {
        focused = true;
        if (live && !live.window.isDestroyed()) {
          applyPickOverlayDesiredState(live.window, { capture: captureOn, shown, focused });
        }
      },
      close: () => {
        if (live) {
          ipcMain.removeListener('pick:click', live.onClickHandler);
          ipcMain.removeListener('pick:cancel', live.onCancelHandler);
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

function buildOverlayHtml(): string {
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
    for (const g of state.green || []) {
      const r = offsetRect(g);
      if (!onScreen(r)) continue;
      ctx.strokeStyle = 'rgba(76, 175, 80, 0.9)';
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
        ctx.strokeStyle = add ? 'rgba(33, 150, 243, 0.95)' : 'rgba(244, 67, 54, 0.95)';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);
  window.pickOverlay.onState((next) => { state = next; draw(); });
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
  });
</script>
</body>
</html>`;
}
