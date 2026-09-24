import type { IpcMain, WebContents } from 'electron';
import type { BackpackSurfaceRegistry } from '../backpacks/backpackSurfaceRegistry';
import { WORKSPACE_SURFACE_KIND, MAX_REGISTERED_SURFACES } from '../backpacks/backpackSurfaceRegistry';
import type { CompactWidgetSession } from '../windows/compactWidgetSession';

const MAX_BYTES = 512;

export interface CompactWidgetIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>;
  registry: BackpackSurfaceRegistry;
  session: CompactWidgetSession;
  isWorkspaceSender: (sender: WebContents, projectId: string) => boolean;
  waitForAuthority?: (sender: WebContents) => Promise<void>;
  /**
   * The Papers window a genuine workspace sender belongs to; null denies.
   *
   * Ownership is resolved ONCE here, at the authenticated boundary, and the
   * proven fact is passed downward. The session never learns how senders are
   * resolved, and nothing downstream infers a window from a project -- two
   * windows may show the same project, so that inference is unanswerable.
   */
  windowIdForWorkspaceSender: (sender: WebContents) => number | null;
  isWidgetSender: (sender: WebContents, projectId: string) => boolean;
  setHoverPolicy?: (senderId: number, enabled: boolean, blockedBindings: readonly string[]) => void;
  requestHoverQuickRun?: (senderId: number, phase: 'open' | 'append', text: string) => Promise<{ ok: boolean; detail: string }>;
  acknowledgeHoverQuickRunSeal?: (senderId: number, generation: number) => boolean;
  showPreview?: (sender: WebContents, preview: { imageUrl: string; title: string; width: number; height: number; anchor: { x: number; y: number; width: number; height: number } }) => void;
  hidePreview?: (senderId: number) => void;
  showContextMenu?: (sender: WebContents) => Promise<'remove' | 'cancel'>;
  showCandidatePicker?: (sender: WebContents, currentWindowInstanceIds: string[]) => Promise<{ action: 'select' | 'remove' | 'close' | 'cancel' | 'direct-pick'; candidateId: string | null }>;
  dismissCandidatePicker?: (sender: WebContents) => void;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function key(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw new Error(`${name} is malformed`);
  return value;
}

/** Registers the workspace sender as the project's workspace surface unless it
 * is already bound to the SAME project (019C wiring, mirroring the detach
 * seam). A sender already bound elsewhere, or a registry at capacity, fails
 * closed so a widget can never be opened by a spoofed or cross-project frame. */
function ensureWorkspaceSurface(
  registry: BackpackSurfaceRegistry,
  senderId: number,
  projectId: string,
): void {
  const existing = registry.surface(senderId);
  if (existing) {
    if (existing.projectId !== projectId || existing.kind !== WORKSPACE_SURFACE_KIND) {
      throw new Error('denied: sender is bound to another project surface');
    }
    return;
  }
  if (registry.size >= MAX_REGISTERED_SURFACES) {
    throw new Error('denied: surface registry capacity reached');
  }
  registry.register(senderId, projectId, WORKSPACE_SURFACE_KIND);
}

export function registerCompactWidgetIpc({ ipcMain, registry, session, isWorkspaceSender, waitForAuthority, windowIdForWorkspaceSender, isWidgetSender, setHoverPolicy, requestHoverQuickRun, acknowledgeHoverQuickRunSeal, showPreview, hidePreview, showContextMenu, showCandidatePicker, dismissCandidatePicker }: CompactWidgetIpcDependencies): void {
  ipcMain.handle('papers:backpack:widget-open', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, raw.activate === undefined
      ? ['projectId', 'layoutKey']
      : ['projectId', 'layoutKey', 'activate'])
      || (raw.activate !== undefined && typeof raw.activate !== 'boolean')) throw new Error('widget open payload is malformed');
    const projectId = key(raw.projectId, 'projectId');
    const layoutKey = key(raw.layoutKey, 'layoutKey');
    if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound workspace sender');
    ensureWorkspaceSurface(registry, event.sender.id, projectId);
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) throw new Error('denied: workspace is not registered');
    const owningWindowId = windowIdForWorkspaceSender(event.sender);
    if (owningWindowId === null) throw new Error('denied: workspace has no Papers window');
    return session.open({ projectId, layoutKey, owningWindowId, ...(raw.activate === undefined ? {} : { activate: raw.activate }) });
  });

  ipcMain.handle('papers:backpack:widget-focus', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['projectId', 'layoutKey'])) throw new Error('widget focus payload is malformed');
    const projectId = key(raw.projectId, 'projectId');
    const layoutKey = key(raw.layoutKey, 'layoutKey');
    if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound workspace sender');
    // 019F: focus must require an ALREADY registered matching WORKSPACE surface;
    // an unregistered sender is never auto-registered on focus.
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) {
      throw new Error('denied: workspace is not registered');
    }
    const owningWindowId = windowIdForWorkspaceSender(event.sender);
    if (owningWindowId === null) throw new Error('denied: workspace has no Papers window');
    return { ok: session.focus(projectId, layoutKey, owningWindowId) };
  });

  ipcMain.handle('papers:backpack:widget-minimize', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['projectId', 'layoutKey'])) throw new Error('widget minimize payload is malformed');
    const projectId = key(raw.projectId, 'projectId');
    const layoutKey = key(raw.layoutKey, 'layoutKey');
    if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound workspace sender');
    const surface = registry.surface(event.sender.id);
    if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) {
      throw new Error('denied: workspace is not registered');
    }
    const owningWindowId = windowIdForWorkspaceSender(event.sender);
    if (owningWindowId === null) throw new Error('denied: workspace has no Papers window');
    return { ok: session.minimize(projectId, layoutKey, owningWindowId) };
  });

  ipcMain.handle('papers:backpack:widget-close', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw)) throw new Error('widget close payload is malformed');
    if (exact(raw, ['projectId', 'layoutKey'])) {
      const projectId = key(raw.projectId, 'projectId');
      const layoutKey = key(raw.layoutKey, 'layoutKey');
      if (!isWorkspaceSender(event.sender, projectId)) throw new Error('denied: not the bound workspace sender');
      // 019F: close must require an ALREADY registered matching WORKSPACE
      // surface; an unregistered sender is never auto-registered on close.
      const surface = registry.surface(event.sender.id);
      if (!surface || surface.projectId !== projectId || surface.kind !== WORKSPACE_SURFACE_KIND) {
        throw new Error('denied: workspace is not registered');
      }
      const owningWindowId = windowIdForWorkspaceSender(event.sender);
      if (owningWindowId === null) throw new Error('denied: workspace has no Papers window');
      await session.close(projectId, layoutKey, owningWindowId);
      return { ok: true };
    }
    if (!exact(raw, ['token'])) throw new Error('widget close payload is malformed');
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, key(raw.token, 'token'))) {
      throw new Error('denied: sender is not the registered widget');
    }
    await session.closeFromSender(event.sender.id, key(raw.token, 'token'));
    return { ok: true };
  });

  // 024: the widget page reports its bounded card content size after each
  // render so the host refits the frameless window to the compact card.
  ipcMain.handle('papers:backpack:widget-report-size', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token', 'width', 'height'])) throw new Error('widget size payload is malformed');
    const token = key(raw.token, 'token');
    const width = raw.width;
    const height = raw.height;
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('widget size width/height must be finite numbers');
    }
    if (width < 1 || height < 1 || width > 2000 || height > 2000) throw new Error('widget size width/height out of range');
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    session.resizeFromSender(event.sender.id, token, Math.round(width), Math.round(height));
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:widget-hover-policy', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token', 'enabled', 'blockedBindings'])) throw new Error('widget hover policy is malformed');
    const token = key(raw.token, 'token');
    if (typeof raw.enabled !== 'boolean' || !Array.isArray(raw.blockedBindings) || raw.blockedBindings.length > 256
      || raw.blockedBindings.some((binding) => typeof binding !== 'string' || binding.length < 1 || binding.length > 64 || !/^(?:Shift\+)?[^+\t\r\n]+$/.test(binding))) {
      throw new Error('widget hover policy is malformed');
    }
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    setHoverPolicy?.(event.sender.id, raw.enabled, [...new Set(raw.blockedBindings as string[])]);
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:widget-quick-run-input', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token', 'phase', 'text'])) throw new Error('widget Quick Run input is malformed');
    const token = key(raw.token, 'token');
    const phase = raw.phase;
    const text = raw.text;
    if ((phase !== 'open' && phase !== 'append') || typeof text !== 'string' || [...text].length !== 1
      || Buffer.byteLength(text, 'utf8') > 8) {
      throw new Error('widget Quick Run input is malformed');
    }
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId)
      || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    if (!requestHoverQuickRun) throw new Error('widget Quick Run is unavailable');
    return requestHoverQuickRun(event.sender.id, phase, text);
  });

  ipcMain.handle('papers:backpack:widget-quick-run-seal-ack', async (event, raw) => {
    if (!object(raw) || !exact(raw, ['token', 'generation'])) throw new Error('widget Quick Run seal acknowledgement is malformed');
    const token = key(raw.token, 'token');
    const generation = raw.generation;
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId)
      || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1
      || !acknowledgeHoverQuickRunSeal?.(event.sender.id, generation)) {
      throw new Error('widget Quick Run seal acknowledgement is stale');
    }
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:widget-preview-show', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token', 'imageUrl', 'title', 'width', 'height', 'anchor'])) throw new Error('widget preview payload is malformed');
    const token = key(raw.token, 'token');
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    const imageUrl = raw.imageUrl;
    const title = raw.title;
    const width = raw.width;
    const height = raw.height;
    const anchor = raw.anchor;
    if (typeof imageUrl !== 'string' || imageUrl.length > 400000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)
      || typeof title !== 'string' || Buffer.byteLength(title, 'utf8') > MAX_BYTES
      || typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || width > 320 || height < 1 || height > 180 || !object(anchor)
      || !exact(anchor, ['x', 'y', 'width', 'height'])
      || !['x', 'y', 'width', 'height'].every((name) => typeof anchor[name] === 'number' && Number.isFinite(anchor[name]))) {
      throw new Error('widget preview payload is malformed');
    }
    showPreview?.(event.sender, { imageUrl, title, width, height, anchor: anchor as { x: number; y: number; width: number; height: number } });
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:widget-preview-hide', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token'])) throw new Error('widget preview hide payload is malformed');
    const token = key(raw.token, 'token');
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    hidePreview?.(event.sender.id);
    return { ok: true };
  });

  ipcMain.handle('papers:backpack:widget-context-menu', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !exact(raw, ['token'])) throw new Error('widget context menu payload is malformed');
    const token = key(raw.token, 'token');
    const surface = registry.surface(event.sender.id);
    if (!surface || !isWidgetSender(event.sender, surface.projectId) || !registry.validSender(event.sender.id, surface.projectId, token)) {
      throw new Error('denied: sender is not the registered widget');
    }
    const action = showContextMenu ? await showContextMenu(event.sender) : 'cancel';
    return { action };
  });

  ipcMain.handle('papers:backpack:window-candidate-picker', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw) || !Array.isArray(raw.currentWindowInstanceIds) || raw.currentWindowInstanceIds.length > 64
      || raw.currentWindowInstanceIds.some((id) => typeof id !== 'string' || !/^W[0-9a-f]{16}$/i.test(id))) {
      throw new Error('window candidate picker payload is malformed');
    }
    let authorized = false;
    if (exact(raw, ['projectId', 'currentWindowInstanceIds'])) {
      const projectId = key(raw.projectId, 'projectId');
      if (isWorkspaceSender(event.sender, projectId)) {
        ensureWorkspaceSurface(registry, event.sender.id, projectId);
        const surface = registry.surface(event.sender.id);
        authorized = !!surface && surface.projectId === projectId && surface.kind === WORKSPACE_SURFACE_KIND;
      }
    } else if (exact(raw, ['token', 'currentWindowInstanceIds'])) {
      const surface = registry.surface(event.sender.id);
      const token = key(raw.token, 'token');
      authorized = !!surface && isWidgetSender(event.sender, surface.projectId)
        && registry.validSender(event.sender.id, surface.projectId, token);
    }
    if (!authorized) throw new Error('denied: sender is not a registered project surface');
    return showCandidatePicker
      ? showCandidatePicker(event.sender, raw.currentWindowInstanceIds as string[])
      : { action: 'cancel', candidateId: null };
  });

  ipcMain.handle('papers:backpack:window-candidate-picker-close', async (event, raw) => {
    await waitForAuthority?.(event.sender);
    if (!object(raw)) throw new Error('window candidate picker close payload is malformed');
    let authorized = false;
    if (exact(raw, ['projectId'])) {
      const projectId = key(raw.projectId, 'projectId');
      const surface = registry.surface(event.sender.id);
      authorized = isWorkspaceSender(event.sender, projectId)
        && !!surface && surface.projectId === projectId && surface.kind === WORKSPACE_SURFACE_KIND;
    } else if (exact(raw, ['token'])) {
      const surface = registry.surface(event.sender.id);
      const token = key(raw.token, 'token');
      authorized = !!surface && isWidgetSender(event.sender, surface.projectId)
        && registry.validSender(event.sender.id, surface.projectId, token);
    }
    if (!authorized) throw new Error('denied: sender is not a registered project surface');
    dismissCandidatePicker?.(event.sender);
    return { ok: true };
  });
}
