import { randomUUID } from 'node:crypto';

import type { SurfaceKind } from './surfaceContextRegistry';

/**
 * A0.1: what surfaces exist, independently of who is currently rendering them.
 *
 * Three identities have been conflated until now, and separating them is the
 * whole point of this registry:
 *
 *   surfaceId       the logical tab or pane -- what the creator would call
 *                   "this board, here"
 *   webContents.id  the current transport incarnation, which dies and is
 *                   rebuilt on a crash or reload
 *   windowId        the native window that currently owns it, which changes if
 *                   the surface is moved
 *
 * A sender-keyed registry cannot tell the truth during the interval where a
 * view has died and its replacement does not exist yet: the tab is still there,
 * with nothing rendering it. So this registry is the authority for what exists,
 * and sender bindings point AT it rather than constituting it.
 *
 * A surfaceId is opaque and is never reused once retired. That is what makes a
 * stale client harmless: an id it still holds can only ever refer to the
 * surface it saw, or to nothing at all -- never to some later unrelated
 * surface that happened to inherit the number.
 */

export type LogicalSurfaceState = 'live' | 'retired';

export interface LogicalSurface {
  surfaceId: string;
  /** The native window that owns this surface right now. */
  windowId: number;
  /** The Backpack project it shows. Several surfaces may show the same one. */
  projectId: string;
  kind: SurfaceKind;
  state: LogicalSurfaceState;
}

/** What a control client is allowed to see. No sender ids: those are process
 * implementation details, and encouraging clients to depend on them would
 * undermine the logical model this registry exists to establish. */
export interface LogicalSurfaceProjection {
  surfaceId: string;
  windowId: number;
  projectId: string;
  kind: SurfaceKind;
}

export interface LogicalSurfaceRegistry {
  /** Create a logical surface and return its permanent id. */
  create(input: { windowId: number; projectId: string; kind: SurfaceKind }): LogicalSurface;
  get(surfaceId: string): LogicalSurface | null;
  /** Live surfaces only, in creation order. */
  list(): LogicalSurface[];
  listForWindow(windowId: number): LogicalSurface[];
  /** Move a surface to another window. Its identity does not change. */
  moveToWindow(surfaceId: string, windowId: number): boolean;
  /** Permanently retire a surface. Its id is never issued again. */
  retire(surfaceId: string): boolean;
  retireWindow(windowId: number): string[];
  retireProject(projectId: string): string[];
  /** True only for a surface that exists, is live, and is in that window --
   * the check a target-bearing command needs before it acts. */
  isLiveIn(surfaceId: string, windowId: number): boolean;
  /** The control-facing projection of every live surface. */
  project(): LogicalSurfaceProjection[];
  readonly size: number;
}

export function createLogicalSurfaceRegistry(
  newSurfaceId: () => string = () => `sf-${randomUUID()}`,
): LogicalSurfaceRegistry {
  /** Retired surfaces are removed from here but their ids stay spent. */
  const live = new Map<string, LogicalSurface>();
  const retired = new Set<string>();

  const copy = (surface: LogicalSurface): LogicalSurface => ({ ...surface });

  return {
    create({ windowId, projectId, kind }) {
      // An id source is allowed to be unlucky; it is not allowed to hand back
      // an id that once meant something else. Bounded, because retrying
      // forever against a source that cannot produce a fresh id is a hang, and
      // a hang is a worse failure than a loud one.
      let surfaceId = newSurfaceId();
      for (let attempt = 0; live.has(surfaceId) || retired.has(surfaceId); attempt += 1) {
        if (attempt >= 8) throw new Error('Could not allocate an unused surface id.');
        surfaceId = newSurfaceId();
      }
      const surface: LogicalSurface = { surfaceId, windowId, projectId, kind, state: 'live' };
      live.set(surfaceId, surface);
      return copy(surface);
    },

    get(surfaceId) {
      const found = live.get(surfaceId);
      return found ? copy(found) : null;
    },

    list() {
      return [...live.values()].map(copy);
    },

    listForWindow(windowId) {
      return [...live.values()].filter((surface) => surface.windowId === windowId).map(copy);
    },

    moveToWindow(surfaceId, windowId) {
      const surface = live.get(surfaceId);
      if (!surface) return false;
      // Moving is not recreating: the surface keeps its identity, and anything
      // holding its id keeps referring to the same tab.
      surface.windowId = windowId;
      return true;
    },

    retire(surfaceId) {
      const surface = live.get(surfaceId);
      if (!surface) return false;
      live.delete(surfaceId);
      retired.add(surfaceId);
      return true;
    },

    retireWindow(windowId) {
      const ids = [...live.values()]
        .filter((surface) => surface.windowId === windowId)
        .map((surface) => surface.surfaceId);
      for (const id of ids) { live.delete(id); retired.add(id); }
      return ids;
    },

    retireProject(projectId) {
      const ids = [...live.values()]
        .filter((surface) => surface.projectId === projectId)
        .map((surface) => surface.surfaceId);
      for (const id of ids) { live.delete(id); retired.add(id); }
      return ids;
    },

    isLiveIn(surfaceId, windowId) {
      const surface = live.get(surfaceId);
      return surface !== undefined && surface.windowId === windowId;
    },

    project() {
      return [...live.values()].map(({ surfaceId, windowId, projectId, kind }) => ({
        surfaceId,
        windowId,
        projectId,
        kind,
      }));
    },

    get size() {
      return live.size;
    },
  };
}
