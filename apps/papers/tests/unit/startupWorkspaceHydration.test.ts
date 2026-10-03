import { describe, expect, it, vi } from 'vitest';

import { hydrateStartupWorkspace } from '../../src/main/persistence/startupWorkspaceHydration';
import { createWorkspaceTopology, openWorkspaceSurface, splitWorkspaceGroup } from '../../src/shared/workspaceTopology';

function snapshot() {
  let topology = createWorkspaceTopology();
  topology = openWorkspaceSurface(topology, { surfaceId: 'old-a', projectId: 'bp-a', title: 'A' });
  topology = openWorkspaceSurface(topology, { surfaceId: 'old-b', projectId: 'bp-b', title: 'B' });
  topology = splitWorkspaceGroup(topology, { groupId: 'group-main', newGroupId: 'group-b', surfaceId: 'old-b', orientation: 'horizontal', position: 'after' });
  return { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' } as const;
}

describe('startup workspace hydration transaction', () => {
  it('opens all projects, remaps fresh ids, delivers once, then commits once', async () => {
    const created: string[] = [];
    const deliver = vi.fn();
    const commit = vi.fn();
    const result = await hydrateStartupWorkspace(1, {
      snapshot: snapshot(),
      findAvailableBackpack: (projectId) => ({ name: projectId.toUpperCase() }),
      openProject: async (projectId) => ({ url: `papers-backpack://${projectId}/fresh` }),
      createSurface: ({ projectId }) => { const surfaceId = `fresh-${projectId}`; created.push(surfaceId); return { surfaceId }; },
      retireSurface: vi.fn(), validate: vi.fn(), deliver, commit,
    });
    expect(result?.workspaceId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result?.topology.surfaces.map((surface) => surface.surfaceId)).toEqual(['fresh-bp-a', 'fresh-bp-b']);
    expect(result?.topology.groups[1]?.surfaceIds).toEqual(['fresh-bp-b']);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
  });

  it('does not allocate or deliver when any project cannot be opened', async () => {
    const createSurface = vi.fn(() => ({ surfaceId: 'orphan' }));
    const deliver = vi.fn();
    await expect(hydrateStartupWorkspace(1, {
      snapshot: snapshot(), findAvailableBackpack: () => ({ name: 'ok' }),
      openProject: async (projectId) => projectId === 'bp-a' ? { url: 'papers-backpack://a/fresh' } : null,
      createSurface, retireSurface: vi.fn(), validate: vi.fn(), deliver, commit: vi.fn(),
    })).rejects.toThrow(/no usable/);
    expect(createSurface).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('retires only invocation-owned surfaces if delivery fails', async () => {
    const retireSurface = vi.fn();
    const created = ['fresh-a', 'fresh-b'];
    let index = 0;
    await expect(hydrateStartupWorkspace(1, {
      snapshot: snapshot(), findAvailableBackpack: () => ({ name: 'ok' }),
      openProject: async () => ({ url: 'papers-backpack://fresh' }),
      createSurface: () => ({ surfaceId: created[index++]! }), retireSurface, validate: vi.fn(),
      deliver: () => { throw new Error('host unavailable'); }, commit: vi.fn(),
    })).rejects.toThrow(/host unavailable/);
    expect(retireSurface.mock.calls).toEqual([['fresh-a'], ['fresh-b']]);
  });

  it('does not allocate while project ownership gates are held', async () => {
    const createSurface = vi.fn(() => ({ surfaceId: 'orphan' }));
    const gateSpy = vi.fn();
    const gateImplementation = async <T>(_projectIds: readonly string[], operation: () => Promise<T>): Promise<T> => {
      gateSpy(_projectIds, operation);
      await new Promise<void>((resolve) => { releaseGate = resolve; });
      return operation();
    };
    let releaseGate!: () => void;
    let available = true;
    const hydrating = hydrateStartupWorkspace(1, {
      snapshot: snapshot(),
      findAvailableBackpack: (projectId) => available ? { name: projectId } : null,
      openProject: async (projectId) => ({ url: `papers-backpack://${projectId}/fresh` }),
      createSurface,
      retireSurface: vi.fn(), validate: vi.fn(), deliver: vi.fn(), commit: vi.fn(),
      runWithProjectOwnershipGates: gateImplementation,
    });

    await Promise.resolve();
    expect(gateSpy).toHaveBeenCalledWith(['bp-a', 'bp-b'], expect.any(Function));
    expect(createSurface).not.toHaveBeenCalled();

    available = false;
    releaseGate();
    await expect(hydrating).rejects.toThrow(/not available/);
    expect(createSurface).not.toHaveBeenCalled();
  });

  it('does not allocate while the target window mutation boundary is held', async () => {
    const createSurface = vi.fn(() => ({ surfaceId: 'orphan' }));
    const deliver = vi.fn();
    const commit = vi.fn();
    const assertWorkspaceMutationAvailable = vi.fn(() => {
      throw new Error('Workspace mutation is busy.');
    });

    await expect(hydrateStartupWorkspace(1, {
      snapshot: snapshot(),
      findAvailableBackpack: () => ({ name: 'ok' }),
      openProject: async (projectId) => ({ url: `papers-backpack://${projectId}/fresh` }),
      createSurface,
      retireSurface: vi.fn(), validate: vi.fn(), deliver, commit,
      assertWorkspaceMutationAvailable,
    })).rejects.toThrow(/Workspace mutation is busy/);

    expect(assertWorkspaceMutationAvailable).toHaveBeenCalledWith(1);
    expect(createSurface).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
