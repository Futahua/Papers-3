import type { WorkspaceTopologyV1 } from '@shared/workspaceTopology';

export interface WorkspaceSurfaceIdentity {
  surfaceId: string;
  projectId: string;
}

/**
 * A committed topology is readable only while it describes the current live
 * project-surface set for its window. Ordering belongs to the topology; the
 * authority check here is deliberately only the exact identity set.
 */
export function workspaceTopologyMatchesSurfaceSet(
  topology: WorkspaceTopologyV1,
  liveSurfaces: ReadonlyArray<WorkspaceSurfaceIdentity>,
): boolean {
  if (topology.surfaces.length !== liveSurfaces.length) return false;

  const liveById = new Map<string, string>();
  for (const surface of liveSurfaces) {
    if (liveById.has(surface.surfaceId)) return false;
    liveById.set(surface.surfaceId, surface.projectId);
  }

  const topologyIds = new Set<string>();
  for (const surface of topology.surfaces) {
    if (topologyIds.has(surface.surfaceId)) return false;
    topologyIds.add(surface.surfaceId);
    if (liveById.get(surface.surfaceId) !== surface.projectId) return false;
  }

  return topologyIds.size === liveById.size;
}
