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

import type { SurfaceContextRegistry } from '../windows/surfaceContextRegistry';

export const WORKSPACE_SURFACE_KIND = 'workspace';
export const DETACHED_SURFACE_KIND = 'detached';
export const COMPACT_WIDGET_SURFACE_KIND = 'compact-widget';
/**
 * The command-surface launcher: a transient overlay the host opens over whatever
 * the creator is doing.
 *
 * Its own kind rather than a reused `compact-widget`, because every reader of a
 * kind is entitled to a different answer for it. A compact widget owns a layout
 * key and is looked up by one; the launcher has no layout. A compact widget may
 * pick windows and write state; a launcher is a text box that closes on blur.
 * Admitting the launcher by mislabelling it would have made all of those answers
 * wrong in the same direction.
 */
export const LAUNCHER_SURFACE_KIND = 'launcher';
export const MAX_REGISTERED_SURFACES = 64;

export type SurfaceKind = typeof WORKSPACE_SURFACE_KIND | typeof DETACHED_SURFACE_KIND | typeof COMPACT_WIDGET_SURFACE_KIND;

/**
 * WHAT A SENDER MAY DO, SEPARATE FROM WHO IT IS.
 *
 * The guard used to answer one question - "is this sender trusted?" - and then
 * hand over every project channel. Those are two questions, and collapsing them
 * is why admitting a new kind of surface meant granting it window enumeration.
 *
 * Capabilities are grouped by what the channel DOES, not by which feature asked
 * for it, so a new channel lands in a group by its nature and every kind's
 * answer follows from that group.
 */
export type ProjectCapability =
  | 'read'
  | 'invoke'
  | 'clipboard'
  | 'reveal'
  | 'mutate'
  | 'native'
  | 'delegate'
  | 'surface'
  | 'service';

/** Channels, by what they do. Anything not listed is not a project channel. */
const CHANNEL_CAPABILITY: Readonly<Record<string, ProjectCapability>> = Object.freeze({
  'host:backpack-project:state-load': 'read',
  'host:backpack-project:state-load-versioned': 'read',
  'host:backpack-project:workspace-scope': 'read',
  'host:backpack-project:workspace-scope-revoke': 'read',
  'host:backpack-project:shortcut-icon': 'read',
  'host:backpack-project:resolve-web-link-icon': 'read',

  'host:backpack-project:launch-shortcut': 'invoke',
  'host:backpack-project:run-action': 'invoke',

  // Putting TEXT on the clipboard, and nothing else. Kept separate from `reveal`
  // because a launcher legitimately copies an item and has no business opening
  // the creator's file manager or a browser.
  'host:backpack-project:copy-text': 'clipboard',

  // Activating something OUTSIDE Papers, on the creator's desktop.
  'host:backpack-project:pick-target': 'reveal',
  'host:backpack-project:reveal-shortcut': 'reveal',
  'host:backpack-project:open-web-link': 'reveal',

  'host:backpack-project:state-save': 'mutate',
  'host:backpack-project:state-save-checked': 'mutate',

  'host:backpack-project:native-source-grant': 'native',
  'host:backpack-project:native-source-open-granted': 'native',
  'host:backpack-project:native-source-reveal-granted': 'native',
  'host:backpack-project:resolve-dropped-targets': 'native',

  'host:backpack-project:delegate-wave': 'delegate',

  // Opening a NEW project surface in the workspace. Its own capability, not
  // `mutate`: this changes the workspace's shape, not the project's document, and
  // conflating the two would make "a launcher must not write project state" also
  // mean "a launcher must not open what it found", which is not the same claim.
  'host:backpack-project:open-new-surface': 'surface',

  // Reaching a service ON THIS MACHINE through the host, which attaches a
  // credential the project declared. Its own capability because it is its own
  // kind of reach: not the project's document, and not the creator's desktop.
  'host:backpack-project:local-service-fetch': 'service',
});

/** What each kind of owned surface is granted. Not listed means nothing. */
const KIND_CAPABILITIES: Readonly<Record<string, readonly ProjectCapability[] | 'all'>> = Object.freeze({
  // The live workspace frame and the surfaces the 018 detach and compact-widget
  // paths create are full project surfaces, and keep every capability.
  project: 'all',
  detached: 'all',
  widget: 'all',
  // The launcher reads the project so it has something to search, runs the item
  // the creator chooses, copies the text of one, and may open a full surface for
  // a result that needs one. It cannot write the document, reveal anything on the
  // desktop, or reach a service: see the mutate, reveal and service decisions.
  launcher: ['read', 'invoke', 'clipboard', 'surface'] as const,
});

/** The capability a channel belongs to, or null when it is not a project channel. */
export function capabilityForChannel(channel: string): ProjectCapability | null {
  return CHANNEL_CAPABILITY[channel] ?? null;
}

/**
 * May a surface of this kind use this capability?
 *
 * FAIL-CLOSED ON BOTH AXES. An unknown kind gets nothing, and an unknown
 * capability gets nothing. That is deliberate and is the opposite of the
 * previous arrangement, where a new surface kind was admitted to every channel
 * the moment it appeared in a registry - the bug that made a launcher able to
 * enumerate the creator's windows if anyone had got that far.
 */
export function projectCapabilityDecision(kind: string, capability: ProjectCapability): boolean {
  const granted = KIND_CAPABILITIES[kind];
  if (granted === undefined) return false;
  if (granted === 'all') return true;
  return granted.includes(capability);
}

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
  /** The registry that binds every Papers-owned project surface, by sender. */
  surfaces: SurfaceContextRegistry;
  detachRegistry: BackpackSurfaceRegistry;
  widgetRegistry: BackpackSurfaceRegistry;
}

/**
 * Is this sender an owned project surface for the project its URL claims?
 *
 * THE RECONCILIATION. There were two registries and two checks that disagreed,
 * and the disagreement was the bug. They do different jobs and both should stay:
 *
 *   - `surfaceContexts` answers WHO a request is from - sender to project,
 *     window and kind. It is written for every Papers-owned surface without
 *     exception, which is exactly what a guard asking "may this sender act for
 *     this project?" needs.
 *   - `BackpackSurfaceRegistry` answers which surfaces exist FOR A FEATURE - the
 *     detach path looks up a workspace entry by project, and the widget path
 *     looks one up by layout key. Those are feature questions, and a feature
 *     registry is the wrong place to ask about trust: a surface that Paper owns
 *     but no feature has a lookup for was invisible to the guard, which is how
 *     the launcher came to be refused.
 *
 * So trust is asked of the registry that binds EVERY surface, and the feature
 * registries keep answering their own questions. The URL must still carry the
 * bound project, so this is not "trust the binding" alone: the sender is admitted
 * for what it is currently showing, and a surface bound to one project cannot act
 * for another.
 *
 * This is narrower than what it replaces in one direction and wider in another,
 * and both are intentional. Narrower: it no longer admits a sender merely for
 * appearing in a feature registry, so the binding is now load-bearing. Wider: it
 * admits a surface the host owns and bound even when no feature has a lookup for
 * it - which is the bug, and includes the launcher.
 */
export function isAllowedProjectSurfaceSender({
  senderId,
  url,
  isWorkspaceSender,
  surfaces,
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

  const bound = surfaces.contextForSender(senderId);
  if (bound && bound.projectId === origin.host) return true;

  // Kept for the feature paths that register before a context exists, so the
  // reconciliation cannot refuse a surface the previous check admitted.
  const detached = detachRegistry.surface(senderId);
  if (detached?.kind === DETACHED_SURFACE_KIND && detached.projectId === origin.host) return true;

  const widget = widgetRegistry.surface(senderId);
  return widget?.kind === COMPACT_WIDGET_SURFACE_KIND && widget.projectId === origin.host;
}

/**
 * The whole gate in one place: is this sender an owned surface of the project it
 * claims, AND may its kind use this channel?
 *
 * `channel` is the real IPC channel, so the capability is looked up rather than
 * asserted by the caller - a caller cannot ask for permission it names itself.
 */
export function decideProjectSurfaceRequest(input: ProjectSurfaceSenderInput & {
  channel: string;
}): 'allow' | 'not-a-project-sender' | 'capability-not-granted' {
  if (!isAllowedProjectSurfaceSender(input)) return 'not-a-project-sender';
  const capability = capabilityForChannel(input.channel);
  if (capability === null) return 'capability-not-granted';
  const kind = surfaceKindForSender(input);
  if (kind === null) return 'not-a-project-sender';
  return projectCapabilityDecision(kind, capability) ? 'allow' : 'capability-not-granted';
}

/**
 * The kind of surface this sender is, by the same authority the allowance uses.
 * Null when it is an owned surface of no known kind.
 */
export function surfaceKindForSender({
  senderId,
  isWorkspaceSender,
  surfaces,
}: Pick<ProjectSurfaceSenderInput, 'senderId' | 'isWorkspaceSender' | 'surfaces'>): string | null {
  if (isWorkspaceSender) return 'project';
  return surfaces.contextForSender(senderId)?.kind ?? null;
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
