import { COMPACT_WIDGET_SURFACE_KIND, type BackpackSurfaceRegistry } from '../backpacks/backpackSurfaceRegistry';
import { resolveWindowBounds, type DisplayArea, type WindowBounds } from '../windowBounds';
import { BACKPACK_PROJECT_SCHEME } from '../backpacks/backpackProjectService';

export const COMPACT_WIDGET_MARKER = 'papers-surface';
export const COMPACT_WIDGET_MODE = 'compact-widget';
export const COMPACT_WIDGET_LAYOUT_PARAM = 'papers-layout-key';
export const COMPACT_WIDGET_MAX_KEY_BYTES = 512;
export const COMPACT_WIDGET_WIDTH = 420;
export const COMPACT_WIDGET_HEIGHT = 180;
// Alt+Q anchors the cursor to the center of the widget's bottom control strip,
// rather than the center of the whole card. Keep this in DIP, like window bounds.
const COMPACT_WIDGET_CURSOR_BOTTOM_INSET = 11;
/** 024/031: the compact widget host refits the frameless window to the reported
 * CARD content with only a small chrome tolerance - never a large empty
 * surround. The floor is a small usability safety net (an empty card), not a
 * fixed minimum that would relabel a huge empty frame as content-sized. */
export const COMPACT_WIDGET_MIN_WIDTH = 64;
export const COMPACT_WIDGET_MIN_HEIGHT = 40;
/** 035: the frameless widget is user-resizable, so the upper clamp only needs
 * to match the bounded IPC report ceiling (2000), never to cap a fixed card. */
export const COMPACT_WIDGET_MAX_WIDTH = 2000;
export const COMPACT_WIDGET_MAX_HEIGHT = 2000;

interface WidgetEntry {
  projectId: string;
  layoutKey: string;
  entryUrl: string;
  /** The Papers window this widget belongs to. Part of its identity, so two
   * windows showing one layout get their own widget rather than sharing one
   * that neither can be said to own. */
  owningWindowId: number;
  window: CompactWidgetWindow;
  closing: boolean;
}

export interface CompactWidgetWindow {
  readonly webContents: {
    id: number;
    send(channel: string, payload: unknown): void;
    on(event: 'render-process-gone', callback: () => void): void;
  };
  setBounds(bounds: WindowBounds): void;
  getBounds(): WindowBounds;
  setContentSize(width: number, height: number): void;
  focus(): void;
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  minimize(): void;
  show(): void;
  showInactive(): void;
  moveTop(): void;
  getNativeWindowHandle(): Buffer;
  isDestroyed(): boolean;
  destroy(): void;
  on(event: 'closed' | 'focus', callback: () => void): void;
  loadURL(url: string): Promise<void>;
}

export interface CompactWidgetSessionDependencies {
  registry: BackpackSurfaceRegistry;
  screen: {
    getAllDisplays(): DisplayArea[];
    getPrimaryDisplay(): DisplayArea;
    getCursorScreenPoint(): { x: number; y: number };
    on(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
    removeListener(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
  };
  ipcMain: {
    on(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
    removeListener(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
  };
  createWindow: (options: { bounds: WindowBounds; preloadPath: string; projectId: string; layoutKey: string; owningWindowId: number }) => CompactWidgetWindow;
  /** Activate a widget after positioning it. Must report whether it actually
   * became the foreground window, rather than trusting Electron's focus call. */
  activateWindow: (window: CompactWidgetWindow) => Promise<boolean>;
  preloadPath: string;
  /** Owner-scoped: two Papers windows may show one project, and each has its
   * own project runtime, so the entry URL cannot be derived from the project
   * alone. */
  resolveEntryUrl: (projectId: string, owningWindowId: number) => string | null;
  isSurfaceOrigin?: (senderId: number, projectId: string) => boolean;
  onSurfaceClosed?: (projectId: string, layoutKey: string, owningWindowId: number) => void;
  onWidgetRegistered?: (senderId: number, nativeHandle: Buffer) => void;
  onWidgetRemoved?: (senderId: number) => void;
}

export interface CompactWidgetSession {
  open(request: { projectId: string; layoutKey: string; owningWindowId: number; bounds?: WindowBounds | null; activate?: boolean }): Promise<{ ok: true; reused: boolean } | { ok: false; error: string }>;
  /** Authenticated live widgets can host a project's declared command surface
   * after its ordinary workspace tab has been closed. */
  liveProjectOwners(): Array<{ projectId: string; owningWindowId: number }>;
  entryUrlForOwner(projectId: string, owningWindowId: number): string | null;
  ready(senderId: number, payload: unknown): boolean;
  focus(projectId: string, layoutKey: string, owningWindowId: number): boolean;
  /** Minimize without destroying the widget, so Alt+Q can restore it. */
  minimize(projectId: string, layoutKey: string, owningWindowId: number): boolean;
  /** Restore the most recently opened/focused widget at the current pointer. */
  bringLatestToCursor(): Promise<boolean>;
  /** Stop the pointer-follow started by the most recent Alt+Q press. */
  stopFollowing(): void;
  close(projectId: string, layoutKey: string, owningWindowId: number): Promise<void>;
  /**
   * Destroy every widget belonging to one Papers window.
   *
   * Called before that window's surface bindings are released: a widget that
   * outlived its window would be an authorized project sender with no routing
   * context -- the same authorized-but-unbound defect found twice already.
   */
  closeOwnedByWindow(owningWindowId: number): Promise<void>;
  closeFromSender(senderId: number, token: string): Promise<void>;
  /** 024: the widget page reports its bounded card content size after each
   * render; the host refits the frameless window to that content (clamped). */
  resizeFromSender(senderId: number, token: string, width: number, height: number): void;
  closeProject(projectId: string): Promise<void>;
  closeAll(): Promise<void>;
  registerIpc(): void;
  unregisterIpc(): void;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= COMPACT_WIDGET_MAX_KEY_BYTES;
}

function widgetUrl(raw: string, layoutKey: string, projectId: string): string {
  const url = new URL(raw);
  // 019F: require BOTH the exact custom scheme AND the exact project host
  // before appending the widget marker/key.
  if (url.protocol !== `${BACKPACK_PROJECT_SCHEME}:` || url.host !== projectId) {
    throw new Error('widget entry is not the bound project surface');
  }
  url.searchParams.set(COMPACT_WIDGET_MARKER, COMPACT_WIDGET_MODE);
  url.searchParams.set(COMPACT_WIDGET_LAYOUT_PARAM, layoutKey);
  return url.toString();
}

export function createCompactWidgetSession(deps: CompactWidgetSessionDependencies): CompactWidgetSession {
  const entries = new Map<string, WidgetEntry>();
  let latestWidgetKey: string | null = null;
  let followTimer: NodeJS.Timeout | null = null;
  let followedEntry: WidgetEntry | null = null;
  let activeDrag: { senderId: number; token: string; offsetX: number; offsetY: number } | null = null;
  let registered = false;
  /**
   * Widget identity includes the owning Papers window.
   *
   * Keyed by (projectId, layoutKey) alone, two windows showing the same layout
   * would share one native widget, and nothing could say whose it was or which
   * window's close should destroy it. Separate instances keep teardown
   * coherent and avoid inventing an ownership-transfer protocol nobody asked
   * for.
   */
  const keyOf = (projectId: string, layoutKey: string, owningWindowId: number) =>
    `${owningWindowId}\0${projectId}\0${layoutKey}`;

  const stopFollowing = (): void => {
    if (followTimer !== null) clearInterval(followTimer);
    followTimer = null;
    followedEntry = null;
  };

  const restoreAndFocus = (entry: WidgetEntry): boolean => {
    if (entry.closing || entry.window.isDestroyed()) return false;
    if (entry.window.isMinimized()) entry.window.restore();
    if (!entry.window.isVisible()) entry.window.show();
    entry.window.focus();
    return true;
  };

  const placeAtCursor = (entry: WidgetEntry): void => {
    if (entry.closing || entry.window.isDestroyed()) return;
    const point = deps.screen.getCursorScreenPoint();
    const bounds = entry.window.getBounds();
    const next = {
      ...bounds,
      x: Math.round(point.x - bounds.width / 2),
      y: Math.round(point.y - Math.max(0, bounds.height - COMPACT_WIDGET_CURSOR_BOTTOM_INSET)),
    };
    if (next.x !== bounds.x || next.y !== bounds.y) entry.window.setBounds(next);
  };

  const followCursor = (entry: WidgetEntry): void => {
    stopFollowing();
    followedEntry = entry;
    placeAtCursor(entry);
    followTimer = setInterval(() => {
      if (followedEntry !== entry || entries.get(keyOf(entry.projectId, entry.layoutKey, entry.owningWindowId)) !== entry
        || entry.closing || entry.window.isDestroyed()) {
        stopFollowing();
        return;
      }
      // Electron's cursor and BrowserWindow bounds are both DIP coordinates.
      // The old helper moved using Win32 physical pixels, so mixed-DPI desktops
      // could make a held Alt+Q appear not to follow (or jump by a scale ratio).
      placeAtCursor(entry);
    }, 16);
  };

  function clamp(bounds: WindowBounds | null): WindowBounds {
    const displays = deps.screen.getAllDisplays();
    const resolved = resolveWindowBounds(bounds, displays);
    if (resolved) return resolved;
    const display = deps.screen.getPrimaryDisplay();
    return {
      x: display.x + 20,
      y: display.y + 20,
      width: Math.min(COMPACT_WIDGET_WIDTH, Math.max(1, display.width - 40)),
      height: Math.min(COMPACT_WIDGET_HEIGHT, Math.max(1, display.height - 40)),
    };
  }

  function destroy(entry: WidgetEntry): void {
    const key = keyOf(entry.projectId, entry.layoutKey, entry.owningWindowId);
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    if (followedEntry === entry) stopFollowing();
    if (latestWidgetKey === key) {
      const remainingKeys = [...entries.keys()];
      latestWidgetKey = remainingKeys[remainingKeys.length - 1] ?? null;
    }
    if (activeDrag?.senderId === entry.window.webContents.id) activeDrag = null;
    deps.onWidgetRemoved?.(entry.window.webContents.id);
    deps.registry.unregister(entry.window.webContents.id);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    deps.onSurfaceClosed?.(entry.projectId, entry.layoutKey, entry.owningWindowId);
  }

  const onClosed = (projectId: string, layoutKey: string, owningWindowId: number): void => {
    const entry = entries.get(keyOf(projectId, layoutKey, owningWindowId));
    if (entry) destroy(entry);
  };

  const readyHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const raw = payload as Record<string, unknown>;
    if (!exactKeys(raw, ['token']) || typeof raw.token !== 'string') return;
    const surface = deps.registry.surface(event.sender.id);
    if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || surface.token !== raw.token) return;
    if (deps.isSurfaceOrigin && !deps.isSurfaceOrigin(event.sender.id, surface.projectId)) return;
    return;
  };

  const dragHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const raw = payload as Record<string, unknown>;
    if (!exactKeys(raw, ['token', 'phase', 'x', 'y']) || typeof raw.token !== 'string'
      || !['begin', 'move', 'end'].includes(String(raw.phase))
      || typeof raw.x !== 'number' || typeof raw.y !== 'number'
      || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)
      || Math.abs(raw.x) > 100000 || Math.abs(raw.y) > 100000) return;
    const surface = deps.registry.surface(event.sender.id);
    if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || surface.token !== raw.token) return;
    if (deps.isSurfaceOrigin && !deps.isSurfaceOrigin(event.sender.id, surface.projectId)) return;
    const entry = [...entries.values()].find((candidate) => candidate.window.webContents.id === event.sender.id);
    if (!entry || entry.closing || entry.window.isDestroyed()) return;
    if (raw.phase === 'begin') {
      const bounds = entry.window.getBounds();
      activeDrag = {
        senderId: event.sender.id,
        token: raw.token,
        offsetX: raw.x - bounds.x,
        offsetY: raw.y - bounds.y,
      };
      return;
    }
    if (!activeDrag || activeDrag.senderId !== event.sender.id || activeDrag.token !== raw.token) return;
    if (raw.phase === 'end') {
      activeDrag = null;
      return;
    }
    const bounds = entry.window.getBounds();
    entry.window.setBounds({
      x: Math.round(raw.x - activeDrag.offsetX),
      y: Math.round(raw.y - activeDrag.offsetY),
      width: bounds.width,
      height: bounds.height,
    });
  };

  const displayEvents: Array<'display-metrics-changed' | 'display-added' | 'display-removed'> = ['display-metrics-changed', 'display-added', 'display-removed'];
  const clampOpen = (): void => {
    for (const entry of entries.values()) {
      if (!entry.window.isDestroyed()) entry.window.setBounds(resolveWindowBounds(entry.window.getBounds(), deps.screen.getAllDisplays()) ?? entry.window.getBounds());
    }
  };

  const session: CompactWidgetSession = {
    async open(request) {
      if (!request || typeof request.projectId !== 'string' || !request.projectId || !validKey(request.layoutKey)) return { ok: false, error: 'a bounded project and layout key are required' };
      if (!Number.isInteger(request.owningWindowId)) return { ok: false, error: 'an owning Papers window is required' };
      const key = keyOf(request.projectId, request.layoutKey, request.owningWindowId);
      const existing = entries.get(key);
      if (existing && !existing.window.isDestroyed()) {
        if (request.activate !== false) {
          latestWidgetKey = key;
          restoreAndFocus(existing);
        } else if (existing.window.isMinimized() || !existing.window.isVisible()) {
          existing.window.showInactive();
        }
        return { ok: true, reused: true };
      }
      const entryUrl = deps.resolveEntryUrl(request.projectId, request.owningWindowId);
      if (!entryUrl) return { ok: false, error: 'no live workspace entry for this project' };
      let url: string;
      try { url = widgetUrl(entryUrl, request.layoutKey, request.projectId); } catch { return { ok: false, error: 'widget entry is not a bound project surface' }; }
      const window = deps.createWindow({ bounds: clamp(request.bounds ?? null), preloadPath: deps.preloadPath, projectId: request.projectId, layoutKey: request.layoutKey, owningWindowId: request.owningWindowId });
      let token: string;
      try { token = deps.registry.register(window.webContents.id, request.projectId, COMPACT_WIDGET_SURFACE_KIND, request.layoutKey); }
      catch { if (!window.isDestroyed()) window.destroy(); return { ok: false, error: 'widget surface registration failed' }; }
      const entry: WidgetEntry = { projectId: request.projectId, layoutKey: request.layoutKey, entryUrl, owningWindowId: request.owningWindowId, window, closing: false };
      entries.set(key, entry);
      deps.onWidgetRegistered?.(window.webContents.id, window.getNativeWindowHandle());
      latestWidgetKey = key;
      window.on('focus', () => {
        if (entries.get(key) === entry) latestWidgetKey = key;
      });
      window.on('closed', () => onClosed(request.projectId, request.layoutKey, request.owningWindowId));
      window.webContents.on('render-process-gone', () => onClosed(request.projectId, request.layoutKey, request.owningWindowId));
      try { await window.loadURL(url); }
      catch { destroy(entry); return { ok: false, error: 'compact widget failed to load' }; }
      if (entries.get(key) !== entry || window.isDestroyed()) return { ok: false, error: 'compact widget closed during load' };
      window.webContents.send('papers:backpack:widget-token', { token });
      return { ok: true, reused: false };
    },
    ready(senderId, payload) {
      const before = deps.registry.surface(senderId);
      readyHandler({ sender: { id: senderId } }, payload);
      return before?.kind === COMPACT_WIDGET_SURFACE_KIND && before.token === (payload as { token?: unknown })?.token;
    },
    liveProjectOwners() {
      const owners = new Map<string, { projectId: string; owningWindowId: number }>();
      for (const entry of entries.values()) {
        if (entry.closing || entry.window.isDestroyed()) continue;
        owners.set(`${entry.projectId}\0${entry.owningWindowId}`, {
          projectId: entry.projectId,
          owningWindowId: entry.owningWindowId,
        });
      }
      return [...owners.values()];
    },
    entryUrlForOwner(projectId, owningWindowId) {
      const entry = [...entries.values()].find((candidate) => candidate.projectId === projectId
        && candidate.owningWindowId === owningWindowId && !candidate.closing && !candidate.window.isDestroyed());
      return entry?.entryUrl ?? null;
    },
    focus(projectId, layoutKey, owningWindowId) {
      const key = keyOf(projectId, layoutKey, owningWindowId);
      const entry = entries.get(key);
      if (!entry || entry.closing || entry.window.isDestroyed()) return false;
      latestWidgetKey = key;
      return restoreAndFocus(entry);
    },
    minimize(projectId, layoutKey, owningWindowId) {
      const key = keyOf(projectId, layoutKey, owningWindowId);
      const entry = entries.get(key);
      if (!entry || entry.closing || entry.window.isDestroyed()) return false;
      stopFollowing();
      // Docking is an explicit user action on this widget. Keep that exact
      // instance as the Alt+Q target even if another widget was focused most
      // recently (for example, while the AYG pill tray was handling the
      // minimize request).
      latestWidgetKey = key;
      entry.window.minimize();
      return entry.window.isMinimized();
    },
    async bringLatestToCursor() {
      const entry = latestWidgetKey === null ? undefined : entries.get(latestWidgetKey);
      if (!entry || entry.closing || entry.window.isDestroyed()) return false;
      // Restore/show before changing bounds: moving a minimized HWND can update
      // its restore rectangle without making the native window visible. Do the
      // visibility transition explicitly, then place it at the live pointer.
      if (!restoreAndFocus(entry)) return false;
      followCursor(entry);
      try {
        return await deps.activateWindow(entry.window);
      } catch {
        return false;
      }
    },
    stopFollowing,
    async close(projectId, layoutKey, owningWindowId) {
      const entry = entries.get(keyOf(projectId, layoutKey, owningWindowId));
      if (entry) destroy(entry);
    },

    async closeOwnedByWindow(owningWindowId) {
      for (const entry of [...entries.values()]) {
        if (entry.owningWindowId === owningWindowId) destroy(entry);
      }
    },
    async closeFromSender(senderId, token) {
      const surface = deps.registry.surface(senderId);
      if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || surface.token !== token) throw new Error('denied: sender is not the registered compact widget');
      const found = [...entries.values()].find((entry) => entry.window.webContents.id === senderId);
      if (found) destroy(found);
    },
    resizeFromSender(senderId, token, width, height) {
      const surface = deps.registry.surface(senderId);
      if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || surface.token !== token) throw new Error('denied: sender is not the registered compact widget');
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      const entry = [...entries.values()].find((candidate) => candidate.window.webContents.id === senderId);
      if (!entry || entry.closing || entry.window.isDestroyed()) return;
      // 035: the user owns the window size (resizable). The widget reports its
      // exact window content size and the host applies it verbatim with only the
      // small usability floor - no +tolerance, which would creep on a fill-width
      // card, and no content-refit that would fight the user's resize.
      const w = Math.round(Math.max(COMPACT_WIDGET_MIN_WIDTH, Math.min(COMPACT_WIDGET_MAX_WIDTH, width)));
      const h = Math.round(Math.max(COMPACT_WIDGET_MIN_HEIGHT, Math.min(COMPACT_WIDGET_MAX_HEIGHT, height)));
      entry.window.setContentSize(w, h);
    },
    async closeProject(projectId) {
      for (const entry of [...entries.values()]) {
        if (entry.projectId === projectId) destroy(entry);
      }
    },
    closeAll() {
      stopFollowing();
      for (const entry of [...entries.values()]) destroy(entry);
      return Promise.resolve();
    },
    registerIpc() {
      if (registered) return;
      registered = true;
      deps.ipcMain.on('papers:backpack:widget-ready', readyHandler);
      deps.ipcMain.on('papers:backpack:widget-drag', dragHandler);
      for (const event of displayEvents) deps.screen.on(event, clampOpen);
    },
    unregisterIpc() {
      if (!registered) return;
      registered = false;
      deps.ipcMain.removeListener('papers:backpack:widget-ready', readyHandler);
      deps.ipcMain.removeListener('papers:backpack:widget-drag', dragHandler);
      for (const event of displayEvents) deps.screen.removeListener(event, clampOpen);
    },
  };
  return session;
}
