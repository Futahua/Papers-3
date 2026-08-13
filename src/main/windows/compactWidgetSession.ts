import { COMPACT_WIDGET_SURFACE_KIND, type BackpackSurfaceRegistry } from '../backpacks/backpackSurfaceRegistry';
import { resolveWindowBounds, type DisplayArea, type WindowBounds } from '../windowBounds';
import { BACKPACK_PROJECT_SCHEME } from '../backpacks/backpackProjectService';

export const COMPACT_WIDGET_MARKER = 'papers-surface';
export const COMPACT_WIDGET_MODE = 'compact-widget';
export const COMPACT_WIDGET_LAYOUT_PARAM = 'papers-layout-key';
export const COMPACT_WIDGET_MAX_KEY_BYTES = 512;
export const COMPACT_WIDGET_WIDTH = 420;
export const COMPACT_WIDGET_HEIGHT = 180;
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
  isDestroyed(): boolean;
  destroy(): void;
  on(event: 'closed', callback: () => void): void;
  loadURL(url: string): Promise<void>;
}

export interface CompactWidgetSessionDependencies {
  registry: BackpackSurfaceRegistry;
  screen: {
    getAllDisplays(): DisplayArea[];
    getPrimaryDisplay(): DisplayArea;
    on(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
    removeListener(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
  };
  ipcMain: {
    on(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
    removeListener(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
  };
  createWindow: (options: { bounds: WindowBounds; preloadPath: string; projectId: string; layoutKey: string }) => CompactWidgetWindow;
  preloadPath: string;
  resolveEntryUrl: (projectId: string) => string | null;
  isSurfaceOrigin?: (senderId: number, projectId: string) => boolean;
  onSurfaceClosed?: (projectId: string, layoutKey: string) => void;
}

export interface CompactWidgetSession {
  open(request: { projectId: string; layoutKey: string; bounds?: WindowBounds | null }): Promise<{ ok: true; reused: boolean } | { ok: false; error: string }>;
  ready(senderId: number, payload: unknown): boolean;
  focus(projectId: string, layoutKey: string): boolean;
  close(projectId: string, layoutKey: string): Promise<void>;
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
  let activeDrag: { senderId: number; token: string; offsetX: number; offsetY: number } | null = null;
  let registered = false;
  const keyOf = (projectId: string, layoutKey: string) => `${projectId}\0${layoutKey}`;

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
    if (entries.get(keyOf(entry.projectId, entry.layoutKey)) !== entry) return;
    entries.delete(keyOf(entry.projectId, entry.layoutKey));
    if (activeDrag?.senderId === entry.window.webContents.id) activeDrag = null;
    deps.registry.unregister(entry.window.webContents.id);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    deps.onSurfaceClosed?.(entry.projectId, entry.layoutKey);
  }

  const onClosed = (projectId: string, layoutKey: string): void => {
    const entry = entries.get(keyOf(projectId, layoutKey));
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
      const key = keyOf(request.projectId, request.layoutKey);
      const existing = entries.get(key);
      if (existing && !existing.window.isDestroyed()) {
        existing.window.focus();
        return { ok: true, reused: true };
      }
      const entryUrl = deps.resolveEntryUrl(request.projectId);
      if (!entryUrl) return { ok: false, error: 'no live workspace entry for this project' };
      let url: string;
      try { url = widgetUrl(entryUrl, request.layoutKey, request.projectId); } catch { return { ok: false, error: 'widget entry is not a bound project surface' }; }
      const window = deps.createWindow({ bounds: clamp(request.bounds ?? null), preloadPath: deps.preloadPath, projectId: request.projectId, layoutKey: request.layoutKey });
      let token: string;
      try { token = deps.registry.register(window.webContents.id, request.projectId, COMPACT_WIDGET_SURFACE_KIND, request.layoutKey); }
      catch { if (!window.isDestroyed()) window.destroy(); return { ok: false, error: 'widget surface registration failed' }; }
      const entry: WidgetEntry = { projectId: request.projectId, layoutKey: request.layoutKey, window, closing: false };
      entries.set(key, entry);
      window.on('closed', () => onClosed(request.projectId, request.layoutKey));
      window.webContents.on('render-process-gone', () => onClosed(request.projectId, request.layoutKey));
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
    focus(projectId, layoutKey) {
      const entry = entries.get(keyOf(projectId, layoutKey));
      if (!entry || entry.closing || entry.window.isDestroyed()) return false;
      entry.window.focus();
      return true;
    },
    async close(projectId, layoutKey) {
      const entry = entries.get(keyOf(projectId, layoutKey));
      if (entry) destroy(entry);
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
