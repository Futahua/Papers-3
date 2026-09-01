/**
 * 018H1: allowed-sender registry for Papers-owned detached Backpack surfaces.
 *
 * Binds a live webContents (the workspace frame or one detached window) to a
 * single project identity and an opaque surface token. Every detach message is
 * validated against this registry before it reaches session or window logic:
 * an unknown, unregistered or spoofed sender is rejected. Papers stays a
 * generic host - it binds identities and routes bounded opaque messages; it
 * never interprets, persists or mediates the Backpack document.
 */
import { randomUUID } from 'node:crypto';

export const WORKSPACE_SURFACE_KIND = 'workspace';
export const DETACHED_SURFACE_KIND = 'detached';
export const COMPACT_WIDGET_SURFACE_KIND = 'compact-widget';
export const MAX_REGISTERED_SURFACES = 64;

export type SurfaceKind = typeof WORKSPACE_SURFACE_KIND | typeof DETACHED_SURFACE_KIND | typeof COMPACT_WIDGET_SURFACE_KIND;

export interface RegisteredSurface {
  projectId: string;
  kind: SurfaceKind;
  token: string;
  layoutKey?: string;
}

export interface ProjectSurfaceSenderInput {
  senderId: number;
  url: string;
  isWorkspaceSender: boolean;
  detachRegistry: BackpackSurfaceRegistry;
  widgetRegistry: BackpackSurfaceRegistry;
}

/** Shared gate for generic project capabilities used by every trusted project
 * surface. A sender must either be the live workspace frame, or be registered
 * as a Papers-owned detached/widget surface for the exact papers-backpack host
 * carried by its current main-frame URL. */
export function isAllowedProjectSurfaceSender({
  senderId,
  url,
  isWorkspaceSender,
  detachRegistry,
  widgetRegistry,
}: ProjectSurfaceSenderInput): boolean {
  let origin: URL;
  try {
    origin = new URL(url);
  } catch {
    return false;
  }
  if (origin.protocol !== 'papers-backpack:') return false;
  if (isWorkspaceSender) return true;

  const detached = detachRegistry.surface(senderId);
  if (detached?.kind === DETACHED_SURFACE_KIND && detached.projectId === origin.host) return true;

  const widget = widgetRegistry.surface(senderId);
  return widget?.kind === COMPACT_WIDGET_SURFACE_KIND && widget.projectId === origin.host;
}

export class BackpackSurfaceRegistry {
  private readonly surfaces = new Map<number, RegisteredSurface>();
  private readonly tokens = new Set<string>();

  register(webContentsId: number, projectId: string, kind: SurfaceKind, layoutKey?: string): string {
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) {
      throw new Error('a valid live webContents id is required');
    }
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new Error('a non-empty project id is required');
    }
    if (this.surfaces.size >= MAX_REGISTERED_SURFACES) {
      throw new Error('surface registry capacity reached');
    }
    if (this.surfaces.has(webContentsId)) {
      throw new Error('this webContents is already registered as a surface');
    }
    let token = `ds-${randomUUID()}`;
    while (this.tokens.has(token)) token = `ds-${randomUUID()}`;
    this.tokens.add(token);
    this.surfaces.set(webContentsId, { projectId, kind, token, ...(layoutKey === undefined ? {} : { layoutKey }) });
    return token;
  }

  unregister(webContentsId: number): RegisteredSurface | null {
    const existing = this.surfaces.get(webContentsId) ?? null;
    if (existing) {
      this.surfaces.delete(webContentsId);
      this.tokens.delete(existing.token);
    }
    return existing;
  }

  surface(webContentsId: number): RegisteredSurface | null {
    return this.surfaces.get(webContentsId) ?? null;
  }

  unregisterAllForProject(projectId: string): number[] {
    const removed: number[] = [];
    for (const [id, surface] of [...this.surfaces]) {
      if (surface.projectId === projectId) {
        this.surfaces.delete(id);
        this.tokens.delete(surface.token);
        removed.push(id);
      }
    }
    return removed;
  }

  unregisterDetachedForProject(projectId: string): number[] {
    const removed: number[] = [];
    for (const [id, surface] of [...this.surfaces]) {
      if (surface.projectId === projectId && surface.kind === DETACHED_SURFACE_KIND) {
        this.surfaces.delete(id);
        this.tokens.delete(surface.token);
        removed.push(id);
      }
    }
    return removed;
  }

  unregisterWorkspaceForProject(projectId: string): number[] {
    const removed: number[] = [];
    for (const [id, surface] of [...this.surfaces]) {
      if (surface.projectId === projectId && surface.kind === WORKSPACE_SURFACE_KIND) {
        this.surfaces.delete(id);
        this.tokens.delete(surface.token);
        removed.push(id);
      }
    }
    return removed;
  }

  surfaceForProject(
    projectId: string,
    kind: SurfaceKind,
    accepts: (webContentsId: number) => boolean = () => true,
  ): { id: number; surface: RegisteredSurface } | null {
    for (const [id, surface] of this.surfaces) {
      if (surface.projectId === projectId && surface.kind === kind && accepts(id)) return { id, surface };
    }
    return null;
  }

  surfaceForWidget(projectId: string, layoutKey: string): { id: number; surface: RegisteredSurface } | null {
    for (const [id, surface] of this.surfaces) {
      if (surface.projectId === projectId && surface.kind === COMPACT_WIDGET_SURFACE_KIND && surface.layoutKey === layoutKey) {
        return { id, surface };
      }
    }
    return null;
  }

  clear(): void {
    this.surfaces.clear();
    this.tokens.clear();
  }

  /** Fail-closed ownership check: sender id, project id and token must all
   * belong to one live registration. */
  validSender(webContentsId: number, projectId: string, token: string): boolean {
    const surface = this.surfaces.get(webContentsId);
    return surface !== undefined
      && surface.projectId === projectId
      && surface.token === token;
  }

  hasSurface(projectId: string, kind: SurfaceKind): boolean {
    for (const surface of this.surfaces.values()) {
      if (surface.projectId === projectId && surface.kind === kind) return true;
    }
    return false;
  }

  get size(): number {
    return this.surfaces.size;
  }
}
