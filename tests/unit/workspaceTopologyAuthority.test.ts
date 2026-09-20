import { describe, expect, it } from 'vitest';

import { createWorkspaceTopology, openWorkspaceSurface } from '../../src/shared/workspaceTopology';
import { workspaceTopologyMatchesSurfaceSet } from '../../src/main/workspaceTopologyAuthority';

describe('workspace topology read authority', () => {
  it('invalidates a committed topology immediately after a surface retires', () => {
    const topology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'project-a', title: 'A',
    });

    expect(workspaceTopologyMatchesSurfaceSet(topology, [
      { surfaceId: 'surface-a', projectId: 'project-a' },
    ])).toBe(true);
    expect(workspaceTopologyMatchesSurfaceSet(topology, [])).toBe(false);
  });

  it('does not expose a topology until a newly-created surface is incorporated', () => {
    const topology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'project-a', title: 'A',
    });

    expect(workspaceTopologyMatchesSurfaceSet(topology, [
      { surfaceId: 'surface-a', projectId: 'project-a' },
      { surfaceId: 'surface-b', projectId: 'project-b' },
    ])).toBe(false);
  });

  it('requires an exact surface/project identity set rather than only matching length', () => {
    const topology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'project-a', title: 'A',
    });

    expect(workspaceTopologyMatchesSurfaceSet(topology, [
      { surfaceId: 'surface-a', projectId: 'project-other' },
    ])).toBe(false);
  });
});
