import { describe, expect, it } from 'vitest';
import { serializedRootForTopology, workspaceRootFromDockview } from '../../src/host/workspaceDockLayout';
import type { WorkspaceTopologyV1 } from '../../src/shared/workspaceTopology';

describe('workspace Dockview recursive adapter', () => {
  it('projects mixed nested canonical splits into Dockview branches with stable group ids', () => {
    const topology: WorkspaceTopologyV1 = {
      schemaVersion: 1,
      surfaces: [
        { surfaceId: 'a', projectId: 'pa', title: 'A' },
        { surfaceId: 'b', projectId: 'pb', title: 'B' },
        { surfaceId: 'c', projectId: 'pc', title: 'C' },
      ],
      groups: [
        { groupId: 'group-a', surfaceIds: ['a'], activeSurfaceId: 'a' },
        { groupId: 'group-b', surfaceIds: ['b'], activeSurfaceId: 'b' },
        { groupId: 'group-c', surfaceIds: ['c'], activeSurfaceId: 'c' },
      ],
      root: {
        kind: 'split', orientation: 'horizontal', weights: [0.4, 0.6], children: [
          { kind: 'group', groupId: 'group-a' },
          { kind: 'split', orientation: 'vertical', weights: [0.5, 0.5], children: [
            { kind: 'group', groupId: 'group-b' },
            { kind: 'group', groupId: 'group-c' },
          ] },
        ],
      },
      focusedGroupId: 'group-c',
    };
    const api = {
      groups: [
        { id: 'dock-a', panels: [{ id: 'a' }] },
        { id: 'dock-b', panels: [{ id: 'b' }] },
        { id: 'dock-c', panels: [{ id: 'c' }] },
      ],
    } as never;
    const existing = {
      panels: {},
      grid: { root: { type: 'leaf', data: { id: 'dock-a', views: ['a'] }, size: 1 }, height: 100, width: 100, orientation: 'horizontal' },
    } as never;
    const root = serializedRootForTopology(api, topology, new Map([
      ['group-a', 'dock-a'], ['group-b', 'dock-b'], ['group-c', 'dock-c'],
    ]), existing);
    expect(root.type).toBe('branch');
    expect(root.data).toHaveLength(2);
    const nested = (root.data as Array<{ type: string; data: unknown }>)[1]!;
    expect(nested.type).toBe('branch');
    expect((nested.data as Array<{ data: { id: string } }>).map((leaf) => leaf.data.id)).toEqual(['dock-b', 'dock-c']);
  });

  it('round-trips nested Dockview geometry into canonical weights and orientation', () => {
    const topology: WorkspaceTopologyV1 = {
      schemaVersion: 1,
      surfaces: [
        { surfaceId: 'a', projectId: 'pa', title: 'A' },
        { surfaceId: 'b', projectId: 'pb', title: 'B' },
        { surfaceId: 'c', projectId: 'pc', title: 'C' },
      ],
      groups: [
        { groupId: 'group-a', surfaceIds: ['a'], activeSurfaceId: 'a' },
        { groupId: 'group-b', surfaceIds: ['b'], activeSurfaceId: 'b' },
        { groupId: 'group-c', surfaceIds: ['c'], activeSurfaceId: 'c' },
      ],
      root: { kind: 'group', groupId: 'group-a' },
      focusedGroupId: 'group-a',
    };
    const api = {
      toJSON: () => ({
        grid: {
          orientation: 'HORIZONTAL',
          root: {
            type: 'branch', size: 100,
            data: [
              { type: 'leaf', size: 40, data: { id: 'dock-a', views: ['a'] } },
              { type: 'branch', size: 60, data: [
                { type: 'leaf', size: 20, data: { id: 'dock-b', views: ['b'] } },
                { type: 'leaf', size: 40, data: { id: 'dock-c', views: ['c'] } },
              ] },
            ],
          },
        },
      }),
    } as never;
    expect(workspaceRootFromDockview(api, topology, new Map([
      ['group-a', 'dock-a'], ['group-b', 'dock-b'], ['group-c', 'dock-c'],
    ]))).toEqual({
      kind: 'split', orientation: 'horizontal', weights: [0.4, 0.6], children: [
        { kind: 'group', groupId: 'group-a' },
        { kind: 'split', orientation: 'vertical', weights: [1 / 3, 2 / 3], children: [
          { kind: 'group', groupId: 'group-b' },
          { kind: 'group', groupId: 'group-c' },
        ] },
      ],
    });
  });

  it('allocates distinct stable live groups when hydrating a coarse one-group layout', () => {
    const topology: WorkspaceTopologyV1 = {
      schemaVersion: 1,
      surfaces: [
        { surfaceId: 'a', projectId: 'pa', title: 'A' },
        { surfaceId: 'b', projectId: 'pb', title: 'B' },
        { surfaceId: 'c', projectId: 'pc', title: 'C' },
      ],
      groups: [
        { groupId: 'group-a', surfaceIds: ['a'], activeSurfaceId: 'a' },
        { groupId: 'group-b', surfaceIds: ['b'], activeSurfaceId: 'b' },
        { groupId: 'group-c', surfaceIds: ['c'], activeSurfaceId: 'c' },
      ],
      root: { kind: 'split', orientation: 'horizontal', weights: [1 / 3, 1 / 3, 1 / 3], children: [
        { kind: 'group', groupId: 'group-a' }, { kind: 'group', groupId: 'group-b' }, { kind: 'group', groupId: 'group-c' },
      ] },
      focusedGroupId: 'group-a',
    };
    const api = { groups: [{ id: 'coarse', panels: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] } as never;
    const root = serializedRootForTopology(api, topology, new Map(), { panels: {}, grid: {} } as never);
    const ids = (root.data as Array<{ data: { id: string } }>).map((leaf) => leaf.data.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('coarse');
    expect(ids.slice(1)).toEqual(['group-b', 'group-c']);
  });
});
