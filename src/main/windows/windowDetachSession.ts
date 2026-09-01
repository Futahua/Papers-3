/**
 * 018H1: Papers-owned generic detached Backpack surface session.
 *
 * One BrowserWindow per registered project/surface request, sandboxed with a
 * narrow preload and no Node exposure. The session owns the detached window's
 * lifecycle and the ownership-transfer handshake: the detached renderer
 * reports ready before it is ever activated, and every close/reattach flushes
 * (flush-request -> flush-ack, or a bounded timeout) BEFORE the window is
 * destroyed. Lifecycle is idempotent across renderer crash, project close,
 * display loss and app shutdown. Restored and live detached bounds are clamped
 * to a visible display work area, re-clamped on display removal, and never
 * move unrelated creator windows.
 *
 * Papers remains a generic host: it routes bounded opaque state/commands only
 * between registered surfaces and does not interpret, persist or mediate the
 * Backpack document.
 */
import { randomUUID } from 'node:crypto';
import { BACKPACK_PROJECT_SCHEME } from '../backpacks/backpackProjectService';
import {
  resolveWindowBounds,
  type DisplayArea,
  type WindowBounds,
} from '../windowBounds';
import {
  DETACHED_SURFACE_KIND,
  WORKSPACE_SURFACE_KIND,
  type BackpackSurfaceRegistry,
} from '../backpacks/backpackSurfaceRegistry';

/** The single enumerated detached mode appended to a validated project entry.
 * The renderer never supplies the entry URL or the mode. */
export const DETACHED_MODE = 'detach=1';
export const DETACH_MAX_COORD = 65536;
export const DEFAULT_DETACH_WIDTH = 1000;
export const DEFAULT_DETACH_HEIGHT = 700;
export const DETACH_FLUSH_TIMEOUT_MS = 1500;
export const DETACH_ACTIVATE_RETRY_INTERVAL_MS = 100;

export function isAllowedDetachedNavigation(target: string, projectId: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === `${BACKPACK_PROJECT_SCHEME}:` && parsed.host === projectId;
  } catch {
    return false;
  }
}

export interface DetachDisplay {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetachScreen {
  getAllDisplays(): DetachDisplay[];
  getPrimaryDisplay(): DetachDisplay;
  on(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
  removeListener(event: 'display-metrics-changed' | 'display-added' | 'display-removed', callback: () => void): void;
}

export interface DetachWindow {
  readonly webContents: {
    id: number;
    send(channel: string, payload: unknown): void;
    on(event: 'render-process-gone', callback: () => void): void;
  };
  setBounds(bounds: WindowBounds): void;
  getBounds(): WindowBounds;
  focus(): void;
  isDestroyed(): boolean;
  destroy(): void;
  on(event: 'closed', callback: () => void): void;
  loadURL(url: string): Promise<void>;
}

export interface WindowDetachSessionDependencies {
  registry: BackpackSurfaceRegistry;
  screen: DetachScreen;
  ipcMain: {
    on(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
    removeListener(channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void): void;
  };
  createWindow: (options: { bounds: WindowBounds; preloadPath: string; projectId: string; owningWindowId: number }) => DetachWindow;
  preloadPath: string;
  /** Called once per detached surface teardown (crash, close, project close,
   * shutdown) so the composer can cancel any sender-scoped pick. */
  onSurfaceClosed?: (projectId: string) => void;
  /** Owner-scoped: lifecycle messages go back to the workspace of the Papers
   * window that owns this detached surface, not to the first workspace that
   * happens to show the project. */
  sendToWorkspace?: (projectId: string, owningWindowId: number, channel: string, payload: unknown) => boolean;
  isSurfaceOrigin?: (senderId: number, projectId: string) => boolean;
  flushTimeoutMs?: number;
}

interface DetachedWindowEntry {
  projectId: string;
  /** The Papers window this detached surface belongs to. Preserved so its
   * lifecycle messages return to that window's workspace even though this
   * path is currently unreachable. */
  owningWindowId: number;
  window: DetachWindow;
  ready: boolean;
  closing: boolean;
  flushTimer: NodeJS.Timeout | null;
  flushResolve: (() => void) | null;
  activateResolve: ((value: { ok: true } | { ok: false; error: string }) => void) | null;
  activateTimer: NodeJS.Timeout | null;
  activateRetryTimer: NodeJS.Timeout | null;
  transferId: string;
  workspaceStopped: boolean;
  stopRequested: boolean;
  activated: boolean;
  resumeResolve: (() => void) | null;
  resumeTimer: NodeJS.Timeout | null;
}

export interface WindowDetachSession {
  open(request: { projectId: string; entryUrl: string; owningWindowId: number; bounds?: WindowBounds | null }): Promise<
    { ok: true } | { ok: false; error: string }
  >;
  focus(projectId: string, transferId?: string): boolean;
  reattach(projectId: string): Promise<void>;
  closeProject(projectId: string): Promise<void>;
  closeProjectForOwner(projectId: string, owningWindowId: number): Promise<void>;
  closeAll(): Promise<void>;
  isOpen(projectId: string): boolean;
  registerDetachIpc(): void;
  unregisterDetachIpc(): void;
}

export interface WindowDetachOpenRequest {
  projectId: string;
  entryUrl: string;
  bounds?: WindowBounds | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseTokenPayload(payload: unknown, requireTransfer = false): { token: string; transferId: string | null } | null {
  if (!isPlainObject(payload)) return null;
  if (!exactKeys(payload, requireTransfer ? ['token', 'transferId'] : ['token'])) return null;
  const token = payload['token'];
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null;
  const transferId = payload['transferId'];
  if (requireTransfer && (typeof transferId !== 'string' || transferId.length === 0 || transferId.length > 512)) return null;
  return { token, transferId: typeof transferId === 'string' ? transferId : null };
}

function parseBounds(raw: unknown): WindowBounds | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ['x', 'y', 'width', 'height'])) return null;
  const x = raw['x']; const y = raw['y']; const width = raw['width']; const height = raw['height'];
  if ([x, y, width, height].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  if (Math.abs(x as number) > DETACH_MAX_COORD || Math.abs(y as number) > DETACH_MAX_COORD) return null;
  if ((width as number) < 1 || (height as number) < 1) return null;
  if ((width as number) > 2 * DETACH_MAX_COORD || (height as number) > 2 * DETACH_MAX_COORD) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** Derives the detached entry URL ONLY from the already-validated registered
 * project entry and the single enumerated detached mode - never from renderer
 * input. The entry must be a `papers-backpack:` URL whose origin is exactly
 * the registered project identity. */
function buildDetachUrl(entryUrl: string, projectId: string): string {
  const parsed = new URL(entryUrl);
  if (parsed.protocol !== `${BACKPACK_PROJECT_SCHEME}:`) {
    throw new Error('detach entry must be a bound Backpack project surface');
  }
  if (parsed.host !== projectId) {
    throw new Error('detach entry origin must match the project identity');
  }
  parsed.search = parsed.search ? `${parsed.search}&${DETACHED_MODE}` : `?${DETACHED_MODE}`;
  return parsed.toString();
}

function asDisplays(displays: readonly DetachDisplay[]): DisplayArea[] {
  return displays.map((d) => ({ x: d.x, y: d.y, width: d.width, height: d.height }));
}

export function createWindowDetachSession(deps: WindowDetachSessionDependencies): WindowDetachSession {
  const registry = deps.registry;
  const flushTimeoutMs = deps.flushTimeoutMs ?? DETACH_FLUSH_TIMEOUT_MS;
  const entries = new Map<string, DetachedWindowEntry>();
  const pendingResumes = new Map<string, { transferId: string; resolve: () => void; timer: NodeJS.Timeout }>();
  const requiresTransfer = typeof deps.sendToWorkspace === 'function';
  let listenersRegistered = false;
  const readyHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    const parsed = parseTokenPayload(payload, requiresTransfer);
    if (parsed === null) return;
    const surface = registry.surface(event.sender.id);
    if (!surface) return;
    if (surface.kind === DETACHED_SURFACE_KIND && deps.isSurfaceOrigin && !deps.isSurfaceOrigin(event.sender.id, surface.projectId)) return;
    if (!registry.validSender(event.sender.id, surface.projectId, parsed.token)) return;
    if (surface.kind !== DETACHED_SURFACE_KIND) return;
    const entry = entries.get(surface.projectId);
    if (!entry || entry.closing) return;
    if (entry.ready) return;
    if (requiresTransfer && parsed.transferId !== entry.transferId) return;
    entry.ready = true;
    if (!requiresTransfer) {
      if (entry.activated) return;
      entry.activated = true;
      entry.window.webContents.send('papers:backpack:detach-activate', {});
      entry.activateResolve?.({ ok: true });
      entry.activateResolve = null;
      return;
    }
    if (!entry.stopRequested) {
      entry.stopRequested = true;
      deps.sendToWorkspace?.(surface.projectId, entry.owningWindowId, 'papers:backpack:detach-stop-request', { transferId: entry.transferId });
    }
  };
  const flushAckHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    const parsed = parseTokenPayload(payload, requiresTransfer);
    if (parsed === null) return;
    const surface = registry.surface(event.sender.id);
    if (!surface) return;
    if (surface.kind === DETACHED_SURFACE_KIND && deps.isSurfaceOrigin && !deps.isSurfaceOrigin(event.sender.id, surface.projectId)) return;
    if (!registry.validSender(event.sender.id, surface.projectId, parsed.token)) return;
    if (surface.kind !== DETACHED_SURFACE_KIND) return;
    const entry = entries.get(surface.projectId);
    if (!entry || !entry.closing || (requiresTransfer && parsed.transferId !== entry.transferId)) return;
    finishDetachedClose(entry, 'reattach');
  };
  const workspaceStopAckHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    if (!requiresTransfer || !isExactTransfer(payload)) return;
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.kind !== WORKSPACE_SURFACE_KIND) return;
    const entry = entries.get(surface.projectId);
    if (!entry || entry.closing || !entry.ready || entry.workspaceStopped || entry.activated || entry.transferId !== payload.transferId) return;
    entry.workspaceStopped = true;
    sendActivation(entry);
  };
  const activatedAckHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    if (!requiresTransfer) return;
    const parsed = parseTokenPayload(payload, true);
    if (parsed === null) return;
    const surface = registry.surface(event.sender.id);
    if (!surface) return;
    if (surface.kind === DETACHED_SURFACE_KIND && deps.isSurfaceOrigin && !deps.isSurfaceOrigin(event.sender.id, surface.projectId)) return;
    if (!registry.validSender(event.sender.id, surface.projectId, parsed.token)) return;
    if (surface.kind !== DETACHED_SURFACE_KIND) return;
    const entry = entries.get(surface.projectId);
    if (!entry || entry.closing || entry.transferId !== parsed.transferId || entry.activated) return;
    entry.activated = true;
    if (entry.activateRetryTimer) clearTimeout(entry.activateRetryTimer);
    entry.activateRetryTimer = null;
    if (entry.activateTimer) clearTimeout(entry.activateTimer);
    entry.activateTimer = null;
    entry.activateResolve?.({ ok: true });
    entry.activateResolve = null;
  };
  const workspaceResumedHandler = (event: { sender: { id: number } }, payload?: unknown): void => {
    if (!isExactTransfer(payload)) return;
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.kind !== WORKSPACE_SURFACE_KIND) return;
    const pending = pendingResumes.get(surface.projectId);
    if (!pending || pending.transferId !== payload.transferId) return;
    clearTimeout(pending.timer);
    pendingResumes.delete(surface.projectId);
    pending.resolve();
  };

  function clearFlushTimer(entry: DetachedWindowEntry): void {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
  }

  function destroyEntry(entry: DetachedWindowEntry): void {
    if (entries.get(entry.projectId) !== entry) return;
    clearFlushTimer(entry);
    if (entry.activateTimer) clearTimeout(entry.activateTimer);
    entry.activateTimer = null;
    if (entry.activateRetryTimer) clearTimeout(entry.activateRetryTimer);
    entry.activateRetryTimer = null;
    if (entry.resumeTimer) clearTimeout(entry.resumeTimer);
    entry.resumeTimer = null;
    entries.delete(entry.projectId);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    entry.flushResolve = null;
    registry.unregisterDetachedForProject(entry.projectId);
    deps.onSurfaceClosed?.(entry.projectId);
  }

  function finishDetachedClose(entry: DetachedWindowEntry, reason: string): void {
    if (entries.get(entry.projectId) !== entry) return;
    const activateResolve = entry.activateResolve;
    entry.activateResolve = null;
    const resolve = entry.flushResolve;
    entry.flushResolve = null;
    destroyEntry(entry);
    if (!requiresTransfer || !deps.sendToWorkspace) {
      resolve?.();
      activateResolve?.({ ok: false, error: `detached surface closed before activation (${reason})` });
      return;
    }
    const sent = deps.sendToWorkspace(entry.projectId, entry.owningWindowId, 'papers:backpack:detach-closed', {
      transferId: entry.transferId,
      reason,
    });
    if (!sent) {
      resolve?.();
      activateResolve?.({ ok: false, error: `detached surface closed before activation (${reason})` });
      return;
    }
    const previous = pendingResumes.get(entry.projectId);
    if (previous) {
      clearTimeout(previous.timer);
      pendingResumes.delete(entry.projectId);
      previous.resolve();
    }
    const pending: { transferId: string; resolve: () => void; timer: NodeJS.Timeout } = {
      transferId: entry.transferId,
      resolve: resolve ?? (() => undefined),
      timer: setTimeout(() => {
        if (pendingResumes.get(entry.projectId) !== pending) return;
        pendingResumes.delete(entry.projectId);
        pending.resolve();
      }, flushTimeoutMs),
    };
    pendingResumes.set(entry.projectId, pending);
    activateResolve?.({ ok: false, error: `detached surface closed before activation (${reason})` });
  }

  function onWindowClosed(projectId: string): void {
    const entry = entries.get(projectId);
    if (!entry) return;
    // Renderer crash or external close: still release the registration and
    // any pending flush wait so nothing leaks or hangs.
    finishDetachedClose(entry, 'crash');
  }

  function clampToDisplays(bounds: WindowBounds | null): WindowBounds {
    const displays = asDisplays(deps.screen.getAllDisplays());
    const resolved = resolveWindowBounds(bounds, displays);
    if (resolved) return resolved;
    const primary = deps.screen.getPrimaryDisplay();
    const width = Math.min(DEFAULT_DETACH_WIDTH, primary.width - 40);
    const height = Math.min(DEFAULT_DETACH_HEIGHT, primary.height - 40);
    return {
      x: primary.x + 20,
      y: primary.y + 20,
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    };
  }

  function clampOpen(): void {
    const displays = asDisplays(deps.screen.getAllDisplays());
    for (const entry of entries.values()) {
      if (entry.window.isDestroyed()) continue;
      const current = entry.window.getBounds();
      const resolved = resolveWindowBounds(current, displays);
      if (resolved) entry.window.setBounds(resolved);
    }
  }

  const displayEvents: Array<'display-metrics-changed' | 'display-added' | 'display-removed'> = [
    'display-metrics-changed',
    'display-added',
    'display-removed',
  ];
  const onDisplayChanged = (): void => { clampOpen(); };

  const session: WindowDetachSession = {
    async open(request) {
      if (typeof request?.projectId !== 'string' || !request.projectId) {
        return { ok: false, error: 'a non-empty project id is required' };
      }
      if (typeof request?.entryUrl !== 'string' || !request.entryUrl) {
        return { ok: false, error: 'a detached entry url is required' };
      }
      const parsedBounds = request.bounds === undefined || request.bounds === null
        ? null
        : parseBounds(request.bounds);
      if (request.bounds !== undefined && request.bounds !== null && parsedBounds === null) {
        return { ok: false, error: 'detached bounds are malformed' };
      }
      if (!registry.hasSurface(request.projectId, WORKSPACE_SURFACE_KIND)) {
        return { ok: false, error: 'project is not registered for detach' };
      }
      if (entries.has(request.projectId)) {
        return { ok: false, error: 'a detached surface is already open for this project' };
      }
      let entryUrl: string;
      try {
        entryUrl = buildDetachUrl(request.entryUrl, request.projectId);
      } catch {
        return { ok: false, error: 'detached entry url is not a bound project surface' };
      }
      const bounds = clampToDisplays(parsedBounds);
      const window = deps.createWindow({ bounds, preloadPath: deps.preloadPath, projectId: request.projectId, owningWindowId: request.owningWindowId });
      let token: string;
      try {
        token = registry.register(window.webContents.id, request.projectId, DETACHED_SURFACE_KIND);
      } catch {
        if (!window.isDestroyed()) window.destroy();
        return { ok: false, error: 'surface registration failed' };
      }
      const entry: DetachedWindowEntry = {
        projectId: request.projectId,
        owningWindowId: request.owningWindowId,
        window,
        ready: false,
        closing: false,
        flushTimer: null,
        flushResolve: null,
        activateResolve: null,
        activateTimer: null,
        activateRetryTimer: null,
        transferId: randomUUID(),
        workspaceStopped: false,
        stopRequested: false,
        activated: false,
        resumeResolve: null,
        resumeTimer: null,
      };
      entries.set(request.projectId, entry);
      window.on('closed', () => { onWindowClosed(request.projectId); });
      window.webContents.on('render-process-gone', () => { onWindowClosed(request.projectId); });
      const activationPromise = requiresTransfer
        ? new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
          entry.activateResolve = resolve;
          entry.activateTimer = setTimeout(() => {
            if (entries.get(request.projectId) !== entry) return;
            const fail = entry.activateResolve;
            entry.activateResolve = null;
            finishDetachedClose(entry, 'open-failed');
            fail?.({ ok: false, error: 'workspace ownership transfer timed out' });
          }, flushTimeoutMs);
        })
        : null;
      try {
        await window.loadURL(entryUrl);
      } catch {
        if (entries.get(request.projectId) === entry) {
          const fail = entry.activateResolve;
          entry.activateResolve = null;
          destroyEntry(entry);
          fail?.({ ok: false, error: 'the detached surface failed to load' });
        }
        return { ok: false, error: 'the detached surface failed to load' };
      }
      if (entries.get(request.projectId) !== entry || window.isDestroyed()) {
        return activationPromise ?? { ok: false, error: 'detached surface closed before activation' };
      }
      if (!window.isDestroyed()) {
        window.webContents.send('papers:backpack:detach-token', { token, transferId: entry.transferId });
      }
      return activationPromise ?? { ok: true };
    },

    focus(projectId, transferId) {
      const entry = entries.get(projectId);
      if (!entry || entry.closing || entry.window.isDestroyed()
        || (requiresTransfer && transferId !== undefined && entry.transferId !== transferId)) return false;
      entry.window.focus();
      return true;
    },

    reattach(projectId) {
      return stop(projectId);
    },

    closeProject(projectId) {
      return stop(projectId);
    },

    closeProjectForOwner(projectId, owningWindowId) {
      const entry = entries.get(projectId);
      if (!entry || entry.owningWindowId !== owningWindowId) return Promise.resolve();
      return stop(projectId);
    },

    async closeAll() {
      const open = [...entries.keys()];
      await Promise.all(open.map((projectId) => stop(projectId)));
      unregisterListeners();
    },

    isOpen(projectId) {
      return entries.has(projectId);
    },

    registerDetachIpc() {
      if (listenersRegistered) return;
      listenersRegistered = true;
      deps.ipcMain.on('papers:backpack:detach-ready', readyHandler);
      deps.ipcMain.on('papers:backpack:detach-flush-ack', flushAckHandler);
      deps.ipcMain.on('papers:backpack:detach-stop-ack', workspaceStopAckHandler);
      deps.ipcMain.on('papers:backpack:detach-activated', activatedAckHandler);
      deps.ipcMain.on('papers:backpack:detach-resumed', workspaceResumedHandler);
      for (const event of displayEvents) deps.screen.on(event, onDisplayChanged);
    },

    unregisterDetachIpc() {
      if (!listenersRegistered) return;
      listenersRegistered = false;
      deps.ipcMain.removeListener('papers:backpack:detach-ready', readyHandler);
      deps.ipcMain.removeListener('papers:backpack:detach-flush-ack', flushAckHandler);
      deps.ipcMain.removeListener('papers:backpack:detach-stop-ack', workspaceStopAckHandler);
      deps.ipcMain.removeListener('papers:backpack:detach-activated', activatedAckHandler);
      deps.ipcMain.removeListener('papers:backpack:detach-resumed', workspaceResumedHandler);
      for (const event of displayEvents) deps.screen.removeListener(event, onDisplayChanged);
    },
  };

  function stop(projectId: string): Promise<void> {
    const entry = entries.get(projectId);
    if (!entry) return Promise.resolve();
    if (entry.closing) {
      return new Promise((resolve) => {
        const previous = entry.flushResolve;
        entry.flushResolve = () => { previous?.(); resolve(); };
      });
    }
    entry.closing = true;
    entry.window.webContents.send('papers:backpack:detach-flush-request', { transferId: entry.transferId });
    return new Promise((resolve) => {
      entry.flushResolve = resolve;
      entry.flushTimer = setTimeout(() => {
          if (entries.get(entry.projectId) === entry) finishDetachedClose(entry, 'flush-timeout');
      }, flushTimeoutMs);
    });
  }

  function unregisterListeners(): void {
    session.unregisterDetachIpc();
    registry.clear();
  }

  function sendActivation(entry: DetachedWindowEntry): void {
    if (entries.get(entry.projectId) !== entry || entry.closing || entry.activated) return;
    entry.window.webContents.send('papers:backpack:detach-activate', { transferId: entry.transferId });
    if (entry.activateRetryTimer) clearTimeout(entry.activateRetryTimer);
    entry.activateRetryTimer = setTimeout(() => {
      entry.activateRetryTimer = null;
      sendActivation(entry);
    }, DETACH_ACTIVATE_RETRY_INTERVAL_MS);
  }

  return session;
}

function isExactTransfer(payload: unknown): payload is { transferId: string } {
  if (!isPlainObject(payload) || !exactKeys(payload, ['transferId'])) return false;
  const transferId = payload['transferId'];
  return typeof transferId === 'string' && transferId.length > 0 && transferId.length <= 512;
}
