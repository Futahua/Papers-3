import {
  remapWorkspaceTopologySurfaceIds,
  type WorkspaceTopologyV1,
  type WorkspaceSurface,
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
