/**
 * 018H1: dedicated IPC for the generic Papers-owned detached Backpack surface.
 *
 * Every invoke is gated on the allowed-sender registry plus an injected
 * workspace-sender predicate, and every input is deeply validated (exact keys,
 * bounded project id, bounded finite bounds). The detached entry URL is never
 * renderer input: it is derived by the composer from the already-validated
 * registered project entry. Papers routes bounded opaque state/commands only
 * between registered surfaces and never interprets the Backpack document.
 */
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

import {
  MAX_REGISTERED_SURFACES,
  WORKSPACE_SURFACE_KIND,
  DETACHED_SURFACE_KIND,
  type BackpackSurfaceRegistry,
} from '../backpacks/backpackSurfaceRegistry';
import type { WindowDetachSession } from '../windows/windowDetachSession';

export const WINDOW_DETACH_MAX_PROJECT_BYTES = 512;
export const WINDOW_DETACH_MAX_COORD = 65536;

export interface WindowDetachIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>;
  registry: BackpackSurfaceRegistry;
  session: WindowDetachSession;
  /** True only for the genuine bound project frame of the given project. */
  isWorkspaceSender: (sender: WebContents, projectId: string) => boolean;
  /** Ownership resolved once, at the authenticated boundary; null denies. */
  windowIdForWorkspaceSender: (sender: WebContents) => number | null;
  isDetachedSender?: (sender: WebContents, projectId: string) => boolean;
  /** Returns the live workspace's already-validated entry URL, or null. */
  resolveEntryUrl: (sender: WebContents, projectId: string) => string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(raw).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseProjectId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > WINDOW_DETACH_MAX_PROJECT_BYTES) {
    throw new Error('a bounded non-empty project id is required');
  }
  return raw;
}

function parseBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!isPlainObject(raw) || !exactKeys(raw, ['x', 'y', 'width', 'height'])) return null;
  const x = raw['x']; const y = raw['y']; const width = raw['width']; const height = raw['height'];
  if ([x, y, width, height].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  if (Math.abs(x as number) > WINDOW_DETACH_MAX_COORD || Math.abs(y as number) > WINDOW_DETACH_MAX_COORD) return null;
  if ((width as number) < 1 || (height as number) < 1) return null;
  if ((width as number) > 2 * WINDOW_DETACH_MAX_COORD || (height as number) > 2 * WINDOW_DETACH_MAX_COORD) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function parseTokenTransfer(raw: unknown): { token: string; transferId: string } {
  if (!isPlainObject(raw) || !exactKeys(raw, ['token', 'transferId'])) throw new Error('detached transfer payload is malformed');
  const token = raw['token'];
  const transferId = raw['transferId'];
  if (typeof token !== 'string' || token.length === 0 || token.length > 512
    || typeof transferId !== 'string' || transferId.length === 0 || transferId.length > 512) {
    throw new Error('detached transfer token is malformed');
  }
  return { token, transferId };
}

/** Registers the workspace sender as the project's workspace surface unless it
 * is already bound to the SAME project. A sender already bound elsewhere, or a
 * registry at capacity, fails closed. */
function ensureWorkspaceSurface(
  registry: BackpackSurfaceRegistry,
  senderId: number,
  projectId: string,
): boolean {
  const existing = registry.surface(senderId);
  if (existing) {
    if (existing.projectId !== projectId || existing.kind !== WORKSPACE_SURFACE_KIND) {
      throw new Error('denied: sender is bound to another project surface');
    }
    return false;
  }
  if (registry.size >= MAX_REGISTERED_SURFACES) {
    throw new Error('denied: surface registry capacity reached');
  }
  registry.register(senderId, projectId, WORKSPACE_SURFACE_KIND);
  return true;
}

function requireWorkspaceOwner(
  sender: WebContents,
  windowIdForWorkspaceSender: (sender: WebContents) => number | null,
): number {
  const windowId = windowIdForWorkspaceSender(sender);
  if (windowId === null) throw new Error('denied: workspace has no Papers window');
  return windowId;
}

export function registerWindowDetachIpc({
  ipcMain,
  registry,
  session,
  isWorkspaceSender,
  resolveEntryUrl,
  isDetachedSender = () => false,
  windowIdForWorkspaceSender,
}: WindowDetachIpcDependencies): void {
  ipcMain.handle('papers:backpack:detach-open', async (event, raw) => {
    if (!isPlainObject(raw)) throw new Error('detach open payload must be an object');
    if (!exactKeys(raw, ['projectId']) && !exactKeys(raw, ['projectId', 'bounds'])) {
      throw new Error('detach open payload contains unknown fields');
    }
    const projectId = parseProjectId(raw['projectId']);
    const rawBounds = raw['bounds'];
    const bounds = rawBounds === undefined ? null : parseBounds(rawBounds);
    if (rawBounds !== undefined && bounds === null) {
      throw new Error('detach open bounds are malformed');
    }
    if (!isWorkspaceSender(event.sender, projectId)) {
      throw new Error('denied: not the bound project frame for this project');
    }
    const entryUrl = resolveEntryUrl(event.sender, projectId);
    if (!entryUrl) throw new Error('denied: no live workspace entry for this project');
    const owningWindowId = requireWorkspaceOwner(event.sender, windowIdForWorkspaceSender);
    const registeredHere = ensureWorkspaceSurface(registry, event.sender.id, projectId);
    const opened = await session.open({ projectId, entryUrl, owningWindowId, bounds });
    if (!opened.ok) {
      if (registeredHere) registry.unregister(event.sender.id);
      throw new Error(opened.error);
    }
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:detach-reattach', async (event, raw) => {
    if (isPlainObject(raw) && exactKeys(raw, ['projectId'])) {
      const projectId = parseProjectId(raw['projectId']);
      if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound project frame for this project');
      const surface = registry.surface(event.sender.id);
      if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) throw new Error('denied: sender is not a registered workspace surface for this project');
      const owningWindowId = requireWorkspaceOwner(event.sender, windowIdForWorkspaceSender);
      if (!await session.reattachProjectForOwner(projectId, owningWindowId)) {
        throw new Error('denied: detached surface belongs to another Papers window');
      }
      return { ok: true };
    }
    const transfer = parseTokenTransfer(raw);
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.kind !== DETACHED_SURFACE_KIND
      || !registry.validSender(event.sender.id, surface.projectId, transfer.token)
      || !isDetachedSender(event.sender, surface.projectId)) {
      throw new Error('denied: sender is not the registered detached surface');
    }
    await session.reattach(surface.projectId);
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:detach-focus', async (event, raw) => {
    if (isPlainObject(raw) && exactKeys(raw, ['projectId'])) {
      const projectId = parseProjectId(raw['projectId']);
      if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound project frame for this project');
      const surface = registry.surface(event.sender.id);
      if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) throw new Error('denied: sender is not a registered workspace surface for this project');
      const owningWindowId = requireWorkspaceOwner(event.sender, windowIdForWorkspaceSender);
      return { ok: session.focusProjectForOwner(projectId, owningWindowId) };
    }
    const transfer = parseTokenTransfer(raw);
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.kind !== DETACHED_SURFACE_KIND
      || !registry.validSender(event.sender.id, surface.projectId, transfer.token)
      || !isDetachedSender(event.sender, surface.projectId)) {
      throw new Error('denied: sender is not the registered detached surface');
    }
    return { ok: session.focus(surface.projectId, transfer.transferId) };
  });

  ipcMain.handle('papers:backpack:detach-close', async (event, raw) => {
    if (!isPlainObject(raw) || !exactKeys(raw, ['projectId'])) {
      throw new Error('detach close payload must be exactly {projectId}');
    }
    const projectId = parseProjectId(raw['projectId']);
    if (!isWorkspaceSender(event.sender, projectId)) {
      throw new Error('denied: not the bound project frame for this project');
    }
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) {
      throw new Error('denied: sender is not a registered workspace surface for this project');
    }
    const owningWindowId = requireWorkspaceOwner(event.sender, windowIdForWorkspaceSender);
    if (!await session.closeProjectForOwner(projectId, owningWindowId)) {
      throw new Error('denied: detached surface belongs to another Papers window');
    }
    return { ok: true };
  });
}
