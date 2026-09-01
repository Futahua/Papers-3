import { describe, expect, it } from 'vitest';

import {
  activateWorkspaceSurface,
  assertValidWorkspaceTopology,
  closeWorkspaceSurface,
  createWorkspaceTopology,
  openWorkspaceSurface,
  moveWorkspaceSurface,
  splitWorkspaceGroup,
} from '../../src/shared/workspaceTopology';

describe('workspace topology', () => {
  it('owns stable product identities without Dockview state', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });

    expect(topology.schemaVersion).toBe(1);
    expect(topology.groups[0]?.surfaceIds).toEqual(['sf-a', 'sf-b']);
    expect(topology.groups[0]?.activeSurfaceId).toBe('sf-b');
    expect(JSON.stringify(topology)).not.toMatch(/dockview/i);
    expect(() => assertValidWorkspaceTopology(topology)).not.toThrow();
  });

  it('activates a surface and its owning group', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = activateWorkspaceSurface(topology, 'sf-a');

    expect(topology.focusedGroupId).toBe('group-main');
    expect(topology.groups[0]?.activeSurfaceId).toBe('sf-a');
  });

  it('splits right or down using Papers groups and normalized weights', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main',
      newGroupId: 'group-right',
      surfaceId: 'sf-b',
      orientation: 'horizontal',
      position: 'after',
    });

    expect(topology.groups).toEqual([
      { groupId: 'group-main', surfaceIds: ['sf-a'], activeSurfaceId: 'sf-a' },
      { groupId: 'group-right', surfaceIds: ['sf-b'], activeSurfaceId: 'sf-b' },
    ]);
    expect(topology.root).toEqual({
      kind: 'split',
      orientation: 'horizontal',
      weights: [0.5, 0.5],
      children: [
        { kind: 'group', groupId: 'group-main' },
        { kind: 'group', groupId: 'group-right' },
      ],
    });
  });

  it('rejects duplicate surfaces and invalid split identities', () => {
    const topology = openWorkspaceSurface(
      createWorkspaceTopology(),
      { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' },
    );
    expect(() => openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-b', title: 'B' }))
      .toThrow(/already exists/);
    expect(() => splitWorkspaceGroup(topology, {
      groupId: 'group-main',
      newGroupId: 'group-right',
      surfaceId: 'sf-a',
      orientation: 'vertical',
      position: 'after',
    })).toThrow(/only surface/);
  });

  it('reorders tabs and collapses an empty split group on close', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-c', projectId: 'bp-c', title: 'C' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-c',
      orientation: 'horizontal', position: 'after',
    });
    topology = moveWorkspaceSurface(topology, 'sf-b', 'group-main', 0);
    expect(topology.groups[0]?.surfaceIds).toEqual(['sf-b', 'sf-a']);

    topology = closeWorkspaceSurface(topology, 'sf-c');
    expect(topology.groups.map((group) => group.groupId)).toEqual(['group-main']);
    expect(topology.root).toEqual({ kind: 'group', groupId: 'group-main' });
    expect(topology.surfaces.map((surface) => surface.surfaceId)).toEqual(['sf-a', 'sf-b']);
  });

  it('collapses a source group when its final surface moves away', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-b',
      orientation: 'horizontal', position: 'after',
    });

    topology = moveWorkspaceSurface(topology, 'sf-b', 'group-main', 1);

    expect(topology.groups).toEqual([{
      groupId: 'group-main', surfaceIds: ['sf-a', 'sf-b'], activeSurfaceId: 'sf-b',
    }]);
    expect(topology.root).toEqual({ kind: 'group', groupId: 'group-main' });
  });
});
