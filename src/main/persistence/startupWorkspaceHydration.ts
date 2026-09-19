import {
  remapWorkspaceTopologySurfaceIds,
  remapWorkspaceTopologyV2ProjectSurfaceIds,
  closeWorkspaceSurfaceV2,
  type WorkspaceTopologyV1,
  type WorkspaceSurface,
  type WorkspaceTopologyV2,
  type WorkspaceForeignWindowSurfaceV2,
} from '@shared/workspaceTopology';
import type { SelectedWorkspaceSnapshot } from './workspaceTopologyStore';

export interface HydratedWorkspaceProject {
  surfaceId: string;
  projectId: string;
  title: string;
  url: string;
}

export interface StartupWorkspaceHydrationDeps {
  snapshot: SelectedWorkspaceSnapshot | null;
  findAvailableBackpack: (projectId: string) => { name: string } | null;
  openProject: (projectId: string) => Promise<{ url: string } | null>;
  createSurface: (project: { projectId: string; windowId: number }) => { surfaceId: string };
  retireSurface: (surfaceId: string) => void;
  validate: (topology: WorkspaceTopologyV1) => void;
  deliver: (projects: HydratedWorkspaceProject[], topology: WorkspaceTopologyV1) => void;
  commit: (workspaceId: string, topology: WorkspaceTopologyV1) => void;
  /** Serialize project ownership creation with archive/remove availability changes. */
  runWithProjectOwnershipGates?: <T>(projectIds: readonly string[], operation: () => Promise<T>) => Promise<T>;
  /** Fail closed if a live window mutation already owns the canonical boundary. */
  assertWorkspaceMutationAvailable?: (windowId: number) => void;
}

export interface StartupWorkspaceForeignHydrationDeps {
  snapshot: SelectedWorkspaceSnapshot | null;
  findAvailableBackpack: (projectId: string) => { name: string } | null;
  openProject: (projectId: string) => Promise<{ url: string } | null>;
  createSurface: (project: { projectId: string; windowId: number }) => { surfaceId: string };
  retireSurface: (surfaceId: string) => void;
  /** Recreate and resolve one persisted foreign surface using its durable id.
   * Returning false means the external window is no longer present; startup
   * removes that stale layout member and continues with the remaining work. */
  resolveForeign: (surface: WorkspaceForeignWindowSurfaceV2, windowId: number) => Promise<boolean | void>;
  retireForeign?: (surfaceId: string) => Promise<void> | void;
  validate: (topology: WorkspaceTopologyV2) => void;
  deliver: (projects: HydratedWorkspaceProject[], topology: WorkspaceTopologyV2) => void;
  commit: (workspaceId: string, topology: WorkspaceTopologyV2) => void;
  runWithProjectOwnershipGates?: <T>(projectIds: readonly string[], operation: () => Promise<T>) => Promise<T>;
  assertWorkspaceMutationAvailable?: (windowId: number) => void;
}

export async function hydrateStartupWorkspaceWithForeign(
  windowId: number,
  deps: StartupWorkspaceForeignHydrationDeps,
): Promise<{ workspaceId: string; projects: HydratedWorkspaceProject[]; topology: WorkspaceTopologyV2 } | null> {
  const snapshot = deps.snapshot;
  if (!snapshot) return null;
  if (snapshot.topology.schemaVersion !== 2) throw new Error('Foreign startup hydration requires a v2 workspace topology.');
  const topologySnapshot = snapshot.topology as WorkspaceTopologyV2;
  const projectSurfaces = topologySnapshot.surfaces.filter((surface) => surface.kind === 'project');
  const projectIds = [...new Set(projectSurfaces.map((surface) => surface.projectId))];
  const run = deps.runWithProjectOwnershipGates ?? (<T>(_: readonly string[], operation: () => Promise<T>) => operation());
  return run(projectIds, async () => {
    const opened: Array<{ old: Extract<WorkspaceTopologyV2['surfaces'][number], { kind: 'project' }>; fresh: HydratedWorkspaceProject }> = [];
    const allocated: string[] = [];
    const resolvedForeign: string[] = [];
    const unavailableForeign: string[] = [];
    try {
      for (const oldSurface of projectSurfaces) {
        const backpack = deps.findAvailableBackpack(oldSurface.projectId);
        if (!backpack) throw new Error(`Backpack ${oldSurface.projectId} is not available.`);
        const project = await deps.openProject(oldSurface.projectId);
        if (!project) throw new Error(`Backpack ${oldSurface.projectId} has no usable project surface.`);
        opened.push({ old: oldSurface, fresh: { ...oldSurface, url: project.url } });
      }
      for (const oldSurface of projectSurfaces) {
        if (!deps.findAvailableBackpack(oldSurface.projectId)) throw new Error(`Backpack ${oldSurface.projectId} is not available.`);
      }
      deps.assertWorkspaceMutationAvailable?.(windowId);
      for (const foreign of topologySnapshot.surfaces.filter((surface): surface is WorkspaceForeignWindowSurfaceV2 => surface.kind === 'foreign-window')) {
        const resolved = await deps.resolveForeign(foreign, windowId);
        if (resolved === false) unavailableForeign.push(foreign.surfaceId);
        else resolvedForeign.push(foreign.surfaceId);
      }
      for (const { old, fresh } of opened) {
        const surface = deps.createSurface({ windowId, projectId: old.projectId });
        allocated.push(surface.surfaceId);
        fresh.surfaceId = surface.surfaceId;
      }
      const oldToFresh = new Map(opened.map(({ old, fresh }) => [old.surfaceId, fresh.surfaceId]));
      let topology = remapWorkspaceTopologyV2ProjectSurfaceIds(topologySnapshot, oldToFresh);
      // A foreign window is an external process, not a prerequisite for
      // opening Papers or its Backpacks. If it disappeared while Papers was
      // closed, discard only that stale layout member and persist the repaired
      // topology so every later startup is clean.
      for (const surfaceId of unavailableForeign) {
        topology = closeWorkspaceSurfaceV2(topology, surfaceId);
      }
      deps.validate(topology);
      deps.deliver(opened.map(({ fresh }) => fresh), topology);
      deps.commit(snapshot.workspaceId, topology);
      return { workspaceId: snapshot.workspaceId, projects: opened.map(({ fresh }) => fresh), topology };
    } catch (error) {
      for (const surfaceId of allocated) deps.retireSurface(surfaceId);
      for (const surfaceId of resolvedForeign.reverse()) await deps.retireForeign?.(surfaceId);
      throw error;
    }
  });
}

/**
 * Resolve-first, all-or-nothing startup hydration. This function deliberately
 * has no UI/window lookup and never reads or writes persistence itself. The
 * caller supplies the exact primary window and the final canonical boundary.
 */
export async function hydrateStartupWorkspace(
  windowId: number,
  deps: StartupWorkspaceHydrationDeps,
): Promise<{ workspaceId: string; projects: HydratedWorkspaceProject[]; topology: WorkspaceTopologyV1 } | null> {
  const snapshot = deps.snapshot;
  if (!snapshot) return null;
  if (snapshot.topology.schemaVersion !== 1) {
    throw new Error('Startup workspace contains foreign windows and requires foreign-surface hydration.');
  }
  const projectIds = [...new Set(snapshot.topology.surfaces.map((surface) => surface.projectId))];
  const run = deps.runWithProjectOwnershipGates
    ?? (<T>(_: readonly string[], operation: () => Promise<T>) => operation());
  return run(projectIds, () => hydrateStartupWorkspaceUngated(windowId, deps, snapshot));
}

async function hydrateStartupWorkspaceUngated(
  windowId: number,
  deps: StartupWorkspaceHydrationDeps,
  snapshot: SelectedWorkspaceSnapshot,
): Promise<{ workspaceId: string; projects: HydratedWorkspaceProject[]; topology: WorkspaceTopologyV1 }> {
  if (snapshot.topology.schemaVersion !== 1) {
    throw new Error('Startup workspace contains foreign windows and requires foreign-surface hydration.');
  }
  const opened: Array<{ old: WorkspaceSurface; fresh: HydratedWorkspaceProject }> = [];
  const allocated: string[] = [];
  try {
    for (const oldSurface of snapshot.topology.surfaces) {
      const backpack = deps.findAvailableBackpack(oldSurface.projectId);
      if (!backpack) throw new Error(`Backpack ${oldSurface.projectId} is not available.`);
      const project = await deps.openProject(oldSurface.projectId);
      if (!project) throw new Error(`Backpack ${oldSurface.projectId} has no usable project surface.`);
      opened.push({ old: oldSurface, fresh: { ...oldSurface, url: project.url } });
    }
    // Availability may change while the asynchronous project lookups above
    // are in flight. Recheck the complete set before any allocation.
    for (const oldSurface of snapshot.topology.surfaces) {
      if (!deps.findAvailableBackpack(oldSurface.projectId)) {
        throw new Error(`Backpack ${oldSurface.projectId} is not available.`);
      }
    }
    // Hydration has no await after this point. If a move already owns the
    // target window, fail before allocating/delivering any fresh surface; if
    // hydration wins this JS turn, it completes before a move can acquire it.
    deps.assertWorkspaceMutationAvailable?.(windowId);
    for (const { old, fresh } of opened) {
      const surface = deps.createSurface({ windowId, projectId: old.projectId });
      allocated.push(surface.surfaceId);
      fresh.surfaceId = surface.surfaceId;
    }
    const oldToFresh = new Map(opened.map(({ old, fresh }) => [old.surfaceId, fresh.surfaceId]));
    const topology = remapWorkspaceTopologySurfaceIds(snapshot.topology, oldToFresh);
    deps.validate(topology);
    deps.deliver(opened.map(({ fresh }) => fresh), topology);
    deps.commit(snapshot.workspaceId, topology);
    return { workspaceId: snapshot.workspaceId, projects: opened.map(({ fresh }) => fresh), topology };
  } catch (error) {
    for (const surfaceId of allocated) deps.retireSurface(surfaceId);
    throw error;
  }
}
