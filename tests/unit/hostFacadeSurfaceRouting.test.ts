import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
import { createLogicalSurfaceRegistry } from '../../src/main/windows/logicalSurfaceRegistry';
import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';
import { createWorkspaceTopology, openWorkspaceSurface, splitWorkspaceGroup } from '../../src/shared/workspaceTopology';
import type { NamedWorkspaceLayout } from '../../src/main/persistence/workspaceLayoutStore';

const PROJECT = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const OTHER = 'bp-a5d07080-7210-45e6-b3f1-93978873a2fe';

/**
 * Only the dependencies these surface-routing paths actually touch. The facade
 * has a large surface; casting keeps the test about routing rather than about
 * constructing every unrelated service.
 */
function createFacade() {
  const surfaces = createSurfaceContextRegistry();
  let n = 0;
  const logicalSurfaces = createLogicalSurfaceRegistry(() => `sf-${++n}`);
  const hideBackpackProjectSurface = vi.fn((_senderId: number, _surfaceId: string) => {});
  const showBackpackProjectSurface = vi.fn(async (_senderId: number, _surfaceId: string, _url: string) => {});
  const closeAttachedProjectSurface = vi.fn();
  const closeBackpackProjectSurface = vi.fn();
  const openProject = vi.fn(async (id: string) => id === PROJECT || id === OTHER ? { url: `papers-backpack://${id}/open` } : null);
  const archivedProjects = new Set<string>();
  const removedProjects = new Set<string>();
  const sendToWindow = vi.fn();
  const focusedSurfaces = new Map<number, string | null>();
  const enteredBackpacks = new Map<number, string | null>();
  const setActiveSurfaceId = vi.fn((windowId: number, surfaceId: string | null) => {
    focusedSurfaces.set(windowId, surfaceId);
  });
  const setEnteredBackpack = vi.fn((windowId: number, backpackId: string | null) => {
    enteredBackpacks.set(windowId, backpackId);
  });
  const workspaceTopologies = new Map<number, ReturnType<typeof createWorkspaceTopology>>();
  const workspaceIds = new Map<number, string>();
  const workspaceRevisions = new Map<number, number>();
  const closingWindows = new Set<number>();
  const setWorkspaceTopology = vi.fn((windowId: number, topology: ReturnType<typeof createWorkspaceTopology>) => {
    workspaceTopologies.set(windowId, topology);
  });
  const commitPair = vi.fn(async () => {});
  const snapshotPair = vi.fn(async (sourceWorkspaceId: string, targetWorkspaceId: string) => ({
    source: { workspaceId: sourceWorkspaceId, topology: workspaceTopologies.get(1) ?? createWorkspaceTopology(), updatedAt: '2026-09-01T00:00:00.000Z' },
    target: workspaceTopologies.get(2)
      ? { workspaceId: targetWorkspaceId, topology: workspaceTopologies.get(2)!, updatedAt: '2026-09-01T00:00:00.000Z' }
      : null,
    lastWorkspaceId: sourceWorkspaceId,
  }));
  const restorePair = vi.fn(async () => {});
  const prepareProjectSurface = vi.fn(async () => ({
    senderId: 99,
    adopt: vi.fn(),
    discard: vi.fn(),
  }));
  const markLeft = vi.fn(async () => {});
  const markEntered = vi.fn(async () => {});
  const workspaceLayouts = {
    list: vi.fn(async () => []),
    get: vi.fn(async (_id: string): Promise<NamedWorkspaceLayout | null> => null),
    create: vi.fn(async (name: string, topology: ReturnType<typeof createWorkspaceTopology>) => ({
      layoutId: '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c', name, topology,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    })),
  };
  const setArchived = vi.fn(async (id: string, archived: boolean) => {
    if (archived) archivedProjects.add(id); else archivedProjects.delete(id);
  });
  const remove = vi.fn(async (id: string) => { removedProjects.add(id); });
  const facade = new PapersHostFacade({
    surfaces,
    logicalSurfaces,
    windowIdForSender: () => 1,
    // Realistic: only the host renderer of window 1 resolves. An unknown
    // sender is not a Papers window.
    hostWindowForSender: (senderId: number) => (senderId === 11 ? 1 : null),
    hostWindowIds: () => [1, 2],
    sendToWindow,
    sendToWindowOrThrow: sendToWindow,
    broadcastToHosts: vi.fn(),
    enteredBackpack: (windowId: number) => enteredBackpacks.get(windowId) ?? null,
    setEnteredBackpack,
    activeSurfaceId: (windowId: number) => focusedSurfaces.get(windowId) ?? null,
    setActiveSurfaceId,
    workspaceTopology: (windowId: number) => workspaceTopologies.get(windowId) ?? null,
    setWorkspaceTopology,
    workspaceLayouts,
    workspaceMove: {
      workspaceId: (windowId: number) => workspaceIds.get(windowId) ?? null,
      workspaceState: (windowId: number) => ({
        topology: workspaceTopologies.get(windowId) ?? null,
        revision: workspaceRevisions.get(windowId) ?? 0,
        workspaceId: workspaceIds.get(windowId) ?? null,
        activeSurfaceId: focusedSurfaces.get(windowId) ?? null,
        enteredBackpackId: enteredBackpacks.get(windowId) ?? null,
      }),
      setWorkspaceState: (windowId: number, state: {
        topology: ReturnType<typeof createWorkspaceTopology> | null;
        revision: number;
        workspaceId: string | null;
        activeSurfaceId: string | null;
        enteredBackpackId: string | null;
      }) => {
        if (state.topology) workspaceTopologies.set(windowId, state.topology);
        else workspaceTopologies.delete(windowId);
        workspaceRevisions.set(windowId, state.revision);
        if (state.workspaceId) workspaceIds.set(windowId, state.workspaceId);
        else workspaceIds.delete(windowId);
        focusedSurfaces.set(windowId, state.activeSurfaceId);
        enteredBackpacks.set(windowId, state.enteredBackpackId);
      },
      commitPair,
      snapshotPair,
      restorePair,
      projectEntryUrl: () => null,
      prepareProjectSurface,
      isWindowClosing: (windowId: number) => closingWindows.has(windowId),
    },
    clearEnteredBackpackEverywhere: vi.fn(),
    listLogicalSurfaces: () => logicalSurfaces.project(),
    retireProjectSurfaces: (projectId: string) => { logicalSurfaces.retireProject(projectId); },
    retireBackpackProjectSurfaces: vi.fn(async () => {}),
    closeAttachedProjectSurface,
    closeBackpackProjectSurface,
    registry: {
      find: (id: string) => (id === PROJECT || id === OTHER) && !removedProjects.has(id) ? {
        id, name: id === PROJECT ? 'Alpha' : 'Beta', archived: archivedProjects.has(id),
      } : null,
      list: () => [],
      setArchived,
      remove,
      markLeft,
      markEntered,
    },
    runtime: { stopActive: vi.fn(async () => {}) },
    showBackpackProjectSurface,
    hideBackpackProjectSurface,
    // Present only so the guard is what refuses, not a missing service.
    backpackProjects: { open: openProject, saveState: vi.fn(async () => ({ ok: true, revision: 'r1' })) },
  } as unknown as FacadeDeps);
  return {
    facade, surfaces, logicalSurfaces, hideBackpackProjectSurface,
    showBackpackProjectSurface, closeAttachedProjectSurface,
    closeBackpackProjectSurface, sendToWindow, setActiveSurfaceId,
    setEnteredBackpack, setWorkspaceTopology, workspaceTopologies, openProject, archivedProjects, markLeft,
    removedProjects, setArchived, remove, markEntered, workspaceLayouts, workspaceIds, workspaceRevisions, closingWindows,
    commitPair, restorePair, prepareProjectSurface,
  };
}

describe('surface routing in the host facade', () => {
  const HOST = 11;
  const FRAME = 12;
  const WIDGET = 13;

  it('opens a real project into the exact window and atomically sends descriptor plus topology', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, sendToWindow } = createFacade();
    workspaceTopologies.set(1, createWorkspaceTopology());
    const opened = await facade.openWorkspaceSurfaceFromControl(1, PROJECT);
    expect(opened.projectId).toBe(PROJECT);
    expect(logicalSurfaces.isLiveIn(opened.surfaceId, 1)).toBe(true);
    expect(opened.topology.groups[0]?.activeSurfaceId).toBe(opened.surfaceId);
    expect(sendToWindow).toHaveBeenCalledWith(1, 'host:event:workspace-project-opened', {
      project: { surfaceId: opened.surfaceId, projectId: PROJECT, title: 'Alpha', url: `papers-backpack://${PROJECT}/open` },
      topology: opened.topology,
    });
  });

  it('refuses unavailable project without creating a surface', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, setWorkspaceTopology } = createFacade();
    workspaceTopologies.set(1, createWorkspaceTopology());
    await expect(facade.openWorkspaceSurfaceFromControl(1, 'bp-missing')).rejects.toThrow(/not available/);
    expect(logicalSurfaces.project()).toEqual([]);
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
  });

  it('rolls back only its fresh surface if atomic host delivery fails', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, sendToWindow } = createFacade();
    const original = createWorkspaceTopology();
    workspaceTopologies.set(1, original);
    sendToWindow.mockImplementationOnce(() => { throw new Error('host unavailable'); });
    await expect(facade.openWorkspaceSurfaceFromControl(1, PROJECT)).rejects.toThrow(/host unavailable/);
    expect(logicalSurfaces.project()).toEqual([]);
    expect(workspaceTopologies.get(1)).toEqual(original);
  });

  it('re-resolves canonical topology after project lookup awaits', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, openProject } = createFacade();
    const a = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const b = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    const original = openWorkspaceSurface(openWorkspaceSurface(createWorkspaceTopology(),
      { surfaceId: a.surfaceId, projectId: PROJECT, title: 'A' }),
    { surfaceId: b.surfaceId, projectId: OTHER, title: 'B' });
    workspaceTopologies.set(1, original);
    let release!: (value: { url: string }) => void;
    openProject.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const opening = facade.openWorkspaceSurfaceFromControl(1, PROJECT);
    await Promise.resolve();
    const latest = { ...original, groups: [{ ...original.groups[0]!, surfaceIds: [b.surfaceId, a.surfaceId] }] };
    workspaceTopologies.set(1, latest);
    release({ url: `papers-backpack://${PROJECT}/open` });
    const opened = await opening;
    expect(opened.topology.groups[0]?.surfaceIds.slice(0, 2)).toEqual([b.surfaceId, a.surfaceId]);
  });

  it('refuses an archive that wins while project lookup awaits without reverting topology', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, openProject, archivedProjects } = createFacade();
    const original = createWorkspaceTopology();
    workspaceTopologies.set(1, original);
    let release!: (value: { url: string }) => void;
    openProject.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const opening = facade.openWorkspaceSurfaceFromControl(1, PROJECT);
    await Promise.resolve();
    archivedProjects.add(PROJECT);
    release({ url: `papers-backpack://${PROJECT}/open` });
    await expect(opening).rejects.toThrow(/not available/);
    expect(logicalSurfaces.project()).toEqual([]);
    expect(workspaceTopologies.get(1)).toEqual(original);
  });

  it('hiding does not leave: the host can show again straight afterwards', async () => {
    const { facade, surfaces, logicalSurfaces, showBackpackProjectSurface } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const url = `papers-backpack://${PROJECT}/ns/1/public/index.html`;

    await facade.showBackpackProjectSurface(HOST, surface.surfaceId, url);
    // BackpackProjectFrame hides on unmount and shows again on mount, so the
    // surface must survive a hide.
    facade.hideBackpackProjectSurface(HOST, surface.surfaceId);
    await expect(facade.showBackpackProjectSurface(HOST, surface.surfaceId, url)).resolves.toBeUndefined();

    expect(showBackpackProjectSurface).toHaveBeenCalledTimes(2);
    // Both calls carry the asking sender, so they act on that window's runtime.
    expect(showBackpackProjectSurface.mock.calls.every(([sender]) => sender === HOST)).toBe(true);
    expect(surfaces.projectForSender(HOST)).toBe(PROJECT);
  });

  it('hiding the workspace leaves a live compact widget bound and usable', () => {
    const { facade, surfaces, logicalSurfaces, closeBackpackProjectSurface } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });
    surfaces.bind(FRAME, { projectId: PROJECT, windowId: 1, kind: 'project' });
    // A widget outlives a return to the Backpack list, and carries the same
    // owning window id as the host.
    surfaces.bind(WIDGET, { projectId: PROJECT, windowId: 1, kind: 'widget' });
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    facade.hideBackpackProjectSurface(HOST, surface.surfaceId);

    expect(surfaces.projectForSender(WIDGET)).toBe(PROJECT);
    expect(surfaces.projectForSender(HOST)).toBe(PROJECT);
    // Hiding is not leaving, so the surface itself is still live.
    expect(logicalSurfaces.get(surface.surfaceId)).not.toBeNull();
  });

  it('leaving retires the surface, so its id is spent for good', async () => {
    const { facade, surfaces, logicalSurfaces, closeAttachedProjectSurface, workspaceTopologies } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: surface.surfaceId, projectId: PROJECT, title: 'A' }));

    await facade.closeBackpackProject(HOST, surface.surfaceId);

    // A0.2.1: the host was never a project surface, so there is no host
    // project binding to remove -- it proves a window, nothing more.
    expect(surfaces.projectForSender(HOST)).toBeNull();
    expect(logicalSurfaces.get(surface.surfaceId)).toBeNull();
    expect(closeAttachedProjectSurface).toHaveBeenCalledWith(1, surface.surfaceId);
    // A stale client repeating the call gets a refusal, not another window's
    // surface.
    await expect(facade.closeBackpackProject(HOST, surface.surfaceId))
      .rejects.toThrow(/not open in this Papers window/);
  });

  it('closing a non-focused surface preserves the focused surface projection', async () => {
    const { facade, logicalSurfaces, setActiveSurfaceId, workspaceTopologies } = createFacade();
    const a = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const b = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    setActiveSurfaceId(1, b.surfaceId);
    workspaceTopologies.set(1, openWorkspaceSurface(
      openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: a.surfaceId, projectId: PROJECT, title: 'A' }),
      { surfaceId: b.surfaceId, projectId: OTHER, title: 'B' },
    ));

    await facade.closeBackpackProject(HOST, a.surfaceId);

    expect(logicalSurfaces.get(a.surfaceId)).toBeNull();
    expect(logicalSurfaces.get(b.surfaceId)).not.toBeNull();
    expect(setActiveSurfaceId).toHaveBeenLastCalledWith(1, b.surfaceId);
  });

  it('project-originated close uses canonical focus rather than the first registry survivor', () => {
    const {
      facade, surfaces, logicalSurfaces, closeAttachedProjectSurface,
      sendToWindow, setActiveSurfaceId, setEnteredBackpack, workspaceTopologies,
    } = createFacade();
    const closing = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const survivor = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    const canonical = logicalSurfaces.create({ windowId: 1, projectId: 'bp-c', kind: 'project' });
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: closing.surfaceId, projectId: PROJECT, title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: survivor.surfaceId, projectId: OTHER, title: 'B' });
    topology = openWorkspaceSurface(topology, { surfaceId: canonical.surfaceId, projectId: 'bp-c', title: 'C' });
    topology = splitWorkspaceGroup(topology, { groupId: 'group-main', newGroupId: 'group-c', surfaceId: canonical.surfaceId, orientation: 'horizontal', position: 'after' });
    workspaceTopologies.set(1, topology);
    surfaces.bind(FRAME, {
      surfaceId: closing.surfaceId,
      projectId: PROJECT,
      windowId: 1,
      kind: 'project',
    });
    setActiveSurfaceId(1, closing.surfaceId);

    facade.requestCloseBackpackProject(FRAME);

    expect(closeAttachedProjectSurface).toHaveBeenCalledWith(1, closing.surfaceId);
    expect(logicalSurfaces.get(closing.surfaceId)).toBeNull();
    expect(logicalSurfaces.get(survivor.surfaceId)).not.toBeNull();
    expect(surfaces.contextForSender(FRAME)).toBeNull();
    expect(setActiveSurfaceId).toHaveBeenLastCalledWith(1, canonical.surfaceId);
    expect(setEnteredBackpack).toHaveBeenLastCalledWith(1, 'bp-c');
    expect(sendToWindow).toHaveBeenCalledWith(1, 'host:event:workspace-topology', expect.objectContaining({ focusedGroupId: 'group-c' }));
    expect(sendToWindow).toHaveBeenCalledWith(1, 'host:event:backpack-project-close-request', {
      surfaceId: closing.surfaceId,
    });
  });

  it('reports the focused surface project as the active Backpack', () => {
    const { facade, logicalSurfaces, setActiveSurfaceId } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    setActiveSurfaceId(1, surface.surfaceId);

    expect(facade.listBackpacks(HOST).activeBackpackId).toBe(OTHER);
  });

  it('activates an exact logical surface and synchronizes its fallback projection', () => {
    const { facade, logicalSurfaces, setActiveSurfaceId, setEnteredBackpack } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });

    facade.activateBackpackProjectSurface(HOST, surface.surfaceId);

    expect(setActiveSurfaceId).toHaveBeenLastCalledWith(1, surface.surfaceId);
    expect(setEnteredBackpack).toHaveBeenLastCalledWith(1, OTHER);
  });

  it('accepts only topology whose surfaces exactly match the committing window', () => {
    const { facade, logicalSurfaces, setWorkspaceTopology } = createFacade();
    const local = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const elsewhere = logicalSurfaces.create({ windowId: 2, projectId: OTHER, kind: 'project' });
    const valid = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: local.surfaceId, projectId: PROJECT, title: 'Local',
    });

    facade.commitWorkspaceTopology(HOST, valid);
    expect(setWorkspaceTopology).toHaveBeenCalledWith(1, valid);

    const foreign = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: elsewhere.surfaceId, projectId: OTHER, title: 'Foreign',
    });
    expect(() => facade.commitWorkspaceTopology(HOST, foreign)).toThrow(/does not match|every live/);

    const mismatched = { ...valid, surfaces: [{ ...valid.surfaces[0]!, projectId: OTHER }] };
    expect(() => facade.commitWorkspaceTopology(HOST, mismatched)).toThrow(/does not match/);

    const fabricated = { ...valid, surfaces: [{ ...valid.surfaces[0]!, surfaceId: 'sf-fabricated' }] };
    expect(() => facade.commitWorkspaceTopology(HOST, fabricated)).toThrow(/does not match/);
  });

  it('moves one logical surface with exact bindings, durable pair, and complete projections', async () => {
    const {
      facade, surfaces, logicalSurfaces, workspaceTopologies, workspaceIds,
      workspaceRevisions, sendToWindow, commitPair, prepareProjectSurface,
      closeAttachedProjectSurface,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const survivor = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    const sourceTopology = openWorkspaceSurface(openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    }), { surfaceId: survivor.surfaceId, projectId: OTHER, title: 'Beta' });
    workspaceTopologies.set(1, sourceTopology);
    workspaceIds.set(1, 'ws-source');
    workspaceIds.set(2, 'ws-target');
    workspaceRevisions.set(1, 4);
    workspaceRevisions.set(2, 7);
    surfaces.bind(FRAME, {
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project',
    });

    const result = await facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1,
      surfaceId: moved.surfaceId,
      targetWindowId: 2,
      targetGroupId: 'group-main',
      targetIndex: 0,
    });

    expect(commitPair).toHaveBeenCalledTimes(1);
    expect(prepareProjectSurface).toHaveBeenCalledWith(2, moved.surfaceId, `papers-backpack://${PROJECT}/open`);
    expect(logicalSurfaces.isLiveIn(moved.surfaceId, 2)).toBe(true);
    expect(surfaces.contextForSender(FRAME)).toBeNull();
    expect(surfaces.contextForSender(99)).toEqual({
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 2, kind: 'project',
    });
    expect(workspaceTopologies.get(1)?.surfaces.map(({ surfaceId }) => surfaceId)).toEqual([survivor.surfaceId]);
    expect(workspaceTopologies.get(2)?.surfaces.map(({ surfaceId }) => surfaceId)).toEqual([moved.surfaceId]);
    expect(workspaceRevisions.get(1)).toBe(5);
    expect(workspaceRevisions.get(2)).toBe(8);
    expect(result.source.projects.map(({ surfaceId }) => surfaceId)).toEqual([survivor.surfaceId]);
    expect(result.target.projects.map(({ surfaceId }) => surfaceId)).toEqual([moved.surfaceId]);
    expect(sendToWindow.mock.calls.filter(([, channel]) => channel === 'host:event:workspace-surface-moved')).toHaveLength(2);
    expect(closeAttachedProjectSurface).toHaveBeenCalledWith(1, moved.surfaceId);
  });

  it('excludes ordinary topology commits and window finalization from the pair boundary', async () => {
    const {
      facade, logicalSurfaces, workspaceTopologies, workspaceIds,
      archivedProjects, commitPair, setEnteredBackpack, setActiveSurfaceId,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const sourceTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    });
    workspaceTopologies.set(1, sourceTopology);
    workspaceIds.set(1, 'ws-source');

    let releasePair!: () => void;
    commitPair.mockImplementationOnce(() => new Promise<void>((resolve) => { releasePair = resolve; }));
    const moving = facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1,
      surfaceId: moved.surfaceId,
      targetWindowId: 2,
      targetGroupId: 'group-main',
      targetIndex: 0,
    });
    for (let attempt = 0; attempt < 20 && commitPair.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(commitPair).toHaveBeenCalledTimes(1);
    expect(() => facade.commitWorkspaceTopology(11, createWorkspaceTopology()))
      .toThrow(/Workspace mutation is busy/);
    const surfacesBeforeDirectOpen = logicalSurfaces.project();
    await expect(facade.openBackpackProject(HOST, PROJECT)).rejects.toThrow(/Workspace mutation is busy/);
    expect(logicalSurfaces.project()).toEqual(surfacesBeforeDirectOpen);
    expect(setEnteredBackpack).not.toHaveBeenCalled();
    expect(setActiveSurfaceId).not.toHaveBeenCalled();
    await expect(facade.setBackpackArchived(PROJECT, true)).rejects.toThrow(/Workspace mutation is busy/);
    await expect(facade.removeBackpack(PROJECT)).rejects.toThrow(/Workspace mutation is busy/);
    expect(archivedProjects.has(PROJECT)).toBe(false);
    expect(workspaceTopologies.get(1)).toEqual(sourceTopology);

    let finalized = false;
    const finalization = facade.waitForWorkspaceMutation(1).then(() => { finalized = true; });
    await Promise.resolve();
    expect(finalized).toBe(false);
    releasePair();
    await moving;
    await finalization;
    expect(finalized).toBe(true);
  });

  it.each([
    ['archive', 'setArchived'],
    ['remove', 'remove'],
  ] as const)('gates new project ownership while %s persistence is in flight', async (operation, persistence) => {
    const { facade, logicalSurfaces, workspaceTopologies, setArchived, remove, archivedProjects, removedProjects, openProject } = createFacade();
    workspaceTopologies.set(2, createWorkspaceTopology());
    let releaseRegistrySave!: () => void;
    const registrySave = new Promise<void>((resolve) => { releaseRegistrySave = resolve; });
    if (persistence === 'setArchived') {
      setArchived.mockImplementationOnce(async (id: string, archived: boolean) => {
        await registrySave;
        if (archived) archivedProjects.add(id); else archivedProjects.delete(id);
      });
    } else {
      remove.mockImplementationOnce(async (id: string) => {
        await registrySave;
        removedProjects.add(id);
      });
    }

    const changingAvailability = operation === 'archive'
      ? facade.setBackpackArchived(PROJECT, true)
      : facade.removeBackpack(PROJECT);
    for (let attempt = 0; attempt < 20 && (persistence === 'setArchived' ? setArchived : remove).mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect((persistence === 'setArchived' ? setArchived : remove)).toHaveBeenCalledTimes(1);

    const opening = facade.openWorkspaceSurfaceFromControl(2, PROJECT);
    await Promise.resolve();
    expect(openProject).not.toHaveBeenCalled();
    expect(logicalSurfaces.project()).toEqual([]);

    releaseRegistrySave();
    await changingAvailability;
    await expect(opening).rejects.toThrow(/not available/);
    expect(logicalSurfaces.project()).toEqual([]);
  });

  it('aborts a pair when either window starts finalization before handoff', async () => {
    const {
      facade, logicalSurfaces, workspaceTopologies, workspaceIds,
      closingWindows, commitPair, restorePair,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const sourceTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    });
    workspaceTopologies.set(1, sourceTopology);
    workspaceIds.set(1, 'ws-source');
    let releasePair!: () => void;
    commitPair.mockImplementationOnce(() => new Promise<void>((resolve) => { releasePair = resolve; }));
    const moving = facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1, surfaceId: moved.surfaceId, targetWindowId: 2,
      targetGroupId: 'group-main', targetIndex: 0,
    });
    for (let attempt = 0; attempt < 20 && commitPair.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    closingWindows.add(2);
    releasePair();
    await expect(moving).rejects.toThrow(/not live/);
    expect(restorePair).toHaveBeenCalledTimes(1);
    expect(logicalSurfaces.isLiveIn(moved.surfaceId, 1)).toBe(true);
    expect(workspaceTopologies.get(1)).toEqual(sourceTopology);
    expect(workspaceTopologies.has(2)).toBe(false);
  });

  it('restores the pair, logical owner, bindings, and notified hosts when target delivery fails', async () => {
    const {
      facade, surfaces, logicalSurfaces, workspaceTopologies, workspaceIds,
      sendToWindow, restorePair, prepareProjectSurface,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const sourceTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    });
    workspaceTopologies.set(1, sourceTopology);
    workspaceIds.set(1, 'ws-source');
    surfaces.bind(FRAME, {
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project',
    });
    sendToWindow.mockImplementation((windowId, channel) => {
      if (channel === 'host:event:workspace-surface-moved' && windowId === 2) {
        throw new Error('target renderer unavailable');
      }
    });

    await expect(facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1,
      surfaceId: moved.surfaceId,
      targetWindowId: 2,
      targetGroupId: 'group-main',
      targetIndex: 0,
    })).rejects.toThrow(/target renderer unavailable/);

    expect(restorePair).toHaveBeenCalledTimes(1);
    expect(logicalSurfaces.isLiveIn(moved.surfaceId, 1)).toBe(true);
    expect(surfaces.contextForSender(FRAME)).toEqual({
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project',
    });
    expect(surfaces.contextForSender(99)).toBeNull();
    expect(workspaceTopologies.get(1)).toEqual(sourceTopology);
    expect(workspaceTopologies.has(2)).toBe(false);
    expect(prepareProjectSurface.mock.results[0]?.value).toBeDefined();
    const movedEvents = sendToWindow.mock.calls.filter(([, channel]) => channel === 'host:event:workspace-surface-moved');
    expect(movedEvents).toHaveLength(4);
    expect(movedEvents[2]?.[2]).toEqual(expect.objectContaining({ compensating: true }));
    expect(movedEvents[3]?.[2]).toEqual(expect.objectContaining({ compensating: true }));
  });

  it('retains forward canonical state when compensating persistence fails', async () => {
    const {
      facade, surfaces, logicalSurfaces, workspaceTopologies, workspaceIds,
      sendToWindow, restorePair, closeAttachedProjectSurface,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    }));
    workspaceIds.set(1, 'ws-source');
    surfaces.bind(FRAME, {
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project',
    });
    restorePair.mockRejectedValueOnce(new Error('durable restore unavailable'));
    sendToWindow.mockImplementation((windowId, channel) => {
      if (channel === 'host:event:workspace-surface-moved' && windowId === 2) {
        throw new Error('target renderer unavailable');
      }
    });

    await expect(facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1,
      surfaceId: moved.surfaceId,
      targetWindowId: 2,
      targetGroupId: 'group-main',
      targetIndex: 0,
    })).rejects.toThrow(/durable forward state retained/);

    expect(restorePair).toHaveBeenCalledTimes(1);
    expect(logicalSurfaces.isLiveIn(moved.surfaceId, 2)).toBe(true);
    expect(surfaces.contextForSender(99)).toEqual({
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 2, kind: 'project',
    });
    expect(surfaces.contextForSender(FRAME)).toBeNull();
    expect(workspaceTopologies.get(1)?.surfaces).toEqual([]);
    expect(workspaceTopologies.get(2)?.surfaces.map(({ surfaceId }) => surfaceId)).toEqual([moved.surfaceId]);
    expect(closeAttachedProjectSurface).toHaveBeenCalledWith(1, moved.surfaceId);
    expect(sendToWindow.mock.calls.filter(([, channel]) => channel === 'host:event:workspace-surface-moved'))
      .toEqual(expect.arrayContaining([
        [1, 'host:event:workspace-surface-moved', expect.objectContaining({ topology: expect.any(Object) })],
      ]));
  });

  it('retries composed adoption when first presentation throws and restore also fails', async () => {
    const {
      facade, surfaces, logicalSurfaces, workspaceTopologies, workspaceIds,
      sendToWindow, restorePair, prepareProjectSurface,
    } = createFacade();
    const moved = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: moved.surfaceId, projectId: PROJECT, title: 'Alpha',
    }));
    workspaceIds.set(1, 'ws-source');
    surfaces.bind(FRAME, {
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project',
    });
    const adopt = vi.fn()
      .mockImplementationOnce(() => { throw new Error('destination presentation unavailable'); })
      .mockImplementationOnce(() => undefined);
    const discard = vi.fn();
    prepareProjectSurface.mockResolvedValueOnce({ senderId: 99, adopt, discard });
    restorePair.mockRejectedValueOnce(new Error('durable restore unavailable'));
    sendToWindow.mockImplementation((windowId, channel) => {
      if (channel === 'host:event:workspace-surface-moved' && windowId === 2) {
        throw new Error('target renderer unavailable');
      }
    });

    await expect(facade.moveWorkspaceSurfaceAcrossWindows({
      sourceWindowId: 1,
      surfaceId: moved.surfaceId,
      targetWindowId: 2,
      targetGroupId: 'group-main',
      targetIndex: 0,
    })).rejects.toThrow(/durable forward state retained/);

    expect(adopt).toHaveBeenCalledTimes(2);
    expect(discard).not.toHaveBeenCalled();
    expect(surfaces.contextForSender(99)).toEqual({
      surfaceId: moved.surfaceId, projectId: PROJECT, windowId: 2, kind: 'project',
    });
    expect(logicalSurfaces.isLiveIn(moved.surfaceId, 2)).toBe(true);
  });

  it('validates a prospective topology against an explicit fresh surface set', () => {
    const { facade, logicalSurfaces } = createFacade();
    const oldSurface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const freshSurface = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    const prospective = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: freshSurface.surfaceId, projectId: OTHER, title: 'Fresh',
    });

    // The old surface remains live for rollback, but the prospective topology
    // is judged against the explicit replacement set rather than that old set.
    expect(() => facade.validateWorkspaceTopologyAgainst(1, prospective, [
      { surfaceId: freshSurface.surfaceId, projectId: OTHER },
    ])).not.toThrow();
    expect(logicalSurfaces.get(oldSurface.surfaceId)).not.toBeNull();
  });

  it('bulk replacement cleanup retires every old surface without intermediate commits or events', () => {
    const {
      facade, surfaces, logicalSurfaces, closeAttachedProjectSurface,
      setWorkspaceTopology, sendToWindow, workspaceTopologies,
    } = createFacade();
    const first = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const second = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    const freshFirst = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const freshSecond = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    let oldTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: first.surfaceId, projectId: PROJECT, title: 'Old A',
    });
    oldTopology = openWorkspaceSurface(oldTopology, {
      surfaceId: second.surfaceId, projectId: OTHER, title: 'Old B',
    });
    workspaceTopologies.set(1, oldTopology);
    surfaces.bind(FRAME, { surfaceId: first.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project' });
    surfaces.bind(WIDGET, { surfaceId: second.surfaceId, projectId: OTHER, windowId: 1, kind: 'widget' });

    facade.retireWorkspaceSurfacesForReplacement(1, [
      { surfaceId: first.surfaceId, projectId: PROJECT },
      { surfaceId: second.surfaceId, projectId: OTHER },
    ]);

    expect(closeAttachedProjectSurface.mock.calls).toEqual([
      [1, first.surfaceId], [1, second.surfaceId],
    ]);
    expect(logicalSurfaces.project().map((surface) => surface.surfaceId)).toEqual([
      freshFirst.surfaceId, freshSecond.surfaceId,
    ]);
    expect(surfaces.contextForSender(FRAME)).toBeNull();
    expect(surfaces.contextForSender(WIDGET)).toBeNull();
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
    expect(sendToWindow).not.toHaveBeenCalled();
  });

  it('bulk replacement cleanup validates the complete old set before mutating', () => {
    const { facade, logicalSurfaces, closeAttachedProjectSurface, workspaceTopologies } = createFacade();
    const first = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const second = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: first.surfaceId, projectId: PROJECT, title: 'A',
    }), { surfaceId: second.surfaceId, projectId: OTHER, title: 'B' }));

    expect(() => facade.retireWorkspaceSurfacesForReplacement(1, [
      { surfaceId: first.surfaceId, projectId: PROJECT },
    ])).toThrow(/expected project surface/);
    expect(logicalSurfaces.get(first.surfaceId)).not.toBeNull();
    expect(logicalSurfaces.get(second.surfaceId)).not.toBeNull();
    expect(closeAttachedProjectSurface).not.toHaveBeenCalled();
  });

  it('saves the exact target window topology without changing workspace state', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, workspaceLayouts, setWorkspaceTopology } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const topology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: surface.surfaceId, projectId: PROJECT, title: 'Alpha',
    });
    workspaceTopologies.set(1, topology);

    const saved = await facade.saveWorkspaceLayoutFromControl(1, ' Research ');

    expect(workspaceLayouts.create).toHaveBeenCalledWith(' Research ', topology);
    expect(saved.name).toBe(' Research ');
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
  });

  it('aborts layout load after post-await availability changes without allocating replacements', async () => {
    const {
      facade, logicalSurfaces, workspaceTopologies, workspaceLayouts, openProject,
      archivedProjects, sendToWindow, setWorkspaceTopology,
    } = createFacade();
    const old = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const oldTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: old.surfaceId, projectId: PROJECT, title: 'Old',
    });
    workspaceTopologies.set(1, oldTopology);
    const savedTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'saved-a', projectId: OTHER, title: 'Beta',
    });
    workspaceLayouts.get.mockResolvedValue({
      layoutId: '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c', name: 'Saved', topology: savedTopology,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    });
    let release!: () => void;
    openProject.mockImplementation(async (id: string) => new Promise((resolve) => {
      release = () => resolve({ url: `papers-backpack://${id}/open` });
    }));
    const loading = facade.loadWorkspaceLayoutFromControl(1, '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c');
    for (let attempt = 0; attempt < 10 && openProject.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    // The manifest lookup is still in flight. Make the authoritative registry
    // unavailable before allowing the await to finish.
    archivedProjects.add(OTHER);
    release();
    await expect(loading).rejects.toThrow(/not available/);
    expect(sendToWindow).not.toHaveBeenCalled();
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
    expect(logicalSurfaces.get(old.surfaceId)).not.toBeNull();
    expect(logicalSurfaces.project()).toHaveLength(1);
  });

  it('loads duplicate project tabs with independent fresh identities and one commit', async () => {
    const {
      facade, logicalSurfaces, workspaceTopologies, workspaceLayouts, closeAttachedProjectSurface,
      sendToWindow, setWorkspaceTopology, setActiveSurfaceId, setEnteredBackpack,
    } = createFacade();
    const old = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: old.surfaceId, projectId: OTHER, title: 'Old',
    }));
    const savedTopology = openWorkspaceSurface(openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'saved-a', projectId: PROJECT, title: 'Alpha 1',
    }), { surfaceId: 'saved-b', projectId: PROJECT, title: 'Alpha 2' });
    const layoutId = '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c';
    workspaceLayouts.get.mockResolvedValue({
      layoutId, name: 'Saved', topology: savedTopology,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    });

    const loaded = await facade.loadWorkspaceLayoutFromControl(1, layoutId);
    const fresh = loaded.topology.surfaces.map((surface) => surface.surfaceId);

    expect(fresh).toHaveLength(2);
    expect(new Set(fresh).size).toBe(2);
    expect(fresh).not.toContain(old.surfaceId);
    expect(logicalSurfaces.get(old.surfaceId)).toBeNull();
    expect(closeAttachedProjectSurface).toHaveBeenCalledWith(1, old.surfaceId);
    expect(sendToWindow).toHaveBeenCalledTimes(1);
    expect(sendToWindow).toHaveBeenCalledWith(1, 'host:event:workspace-layout-loaded', expect.objectContaining({ layoutId, topology: loaded.topology }));
    expect(setWorkspaceTopology).toHaveBeenCalledTimes(1);
    expect(setActiveSurfaceId).toHaveBeenCalledWith(1, fresh[1]);
    expect(setEnteredBackpack).toHaveBeenCalledWith(1, PROJECT);
  });

  it('rolls back fresh logical surfaces when combined layout delivery fails', async () => {
    const { facade, logicalSurfaces, workspaceTopologies, workspaceLayouts, sendToWindow, setWorkspaceTopology } = createFacade();
    const old = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    workspaceTopologies.set(1, openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: old.surfaceId, projectId: OTHER, title: 'Old',
    }));
    const savedTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'saved-a', projectId: PROJECT, title: 'Alpha',
    });
    const layoutId = '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c';
    workspaceLayouts.get.mockResolvedValue({
      layoutId, name: 'Saved', topology: savedTopology,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    });
    sendToWindow.mockImplementationOnce(() => { throw new Error('renderer unavailable'); });

    await expect(facade.loadWorkspaceLayoutFromControl(1, layoutId)).rejects.toThrow(/renderer unavailable/);
    expect(logicalSurfaces.get(old.surfaceId)).not.toBeNull();
    expect(logicalSurfaces.project()).toEqual([expect.objectContaining({ surfaceId: old.surfaceId })]);
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
  });

  it('keeps the replacement commit coherent when a later old native close throws', async () => {
    const {
      facade, logicalSurfaces, workspaceTopologies, workspaceLayouts, closeAttachedProjectSurface,
      sendToWindow, setWorkspaceTopology,
    } = createFacade();
    const oldA = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const oldB = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    let oldTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: oldA.surfaceId, projectId: PROJECT, title: 'Old A',
    });
    oldTopology = openWorkspaceSurface(oldTopology, {
      surfaceId: oldB.surfaceId, projectId: OTHER, title: 'Old B',
    });
    workspaceTopologies.set(1, oldTopology);
    const savedTopology = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'saved-a', projectId: PROJECT, title: 'New',
    });
    const layoutId = '3f0f8c9c-4d3c-4c3c-8c3c-3f0f8c9c4d3c';
    workspaceLayouts.get.mockResolvedValue({
      layoutId, name: 'Saved', topology: savedTopology,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    });
    closeAttachedProjectSurface.mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('late destroyed object'); });

    const loaded = await facade.loadWorkspaceLayoutFromControl(1, layoutId);

    expect(loaded.topology.surfaces).toHaveLength(1);
    expect(sendToWindow).toHaveBeenCalledTimes(1);
    expect(setWorkspaceTopology).toHaveBeenCalledTimes(1);
    expect(logicalSurfaces.get(oldA.surfaceId)).toBeNull();
    expect(logicalSurfaces.get(oldB.surfaceId)).toBeNull();
    expect(logicalSurfaces.project()).toHaveLength(1);
  });

  it('does not mark a Backpack left while another window has an active surface for it', async () => {
    const { facade, logicalSurfaces, setActiveSurfaceId, setEnteredBackpack, markLeft } = createFacade();
    const local = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const elsewhere = logicalSurfaces.create({ windowId: 2, projectId: PROJECT, kind: 'project' });
    setActiveSurfaceId(1, local.surfaceId);
    setActiveSurfaceId(2, elsewhere.surfaceId);
    setEnteredBackpack(1, PROJECT);

    await facade.leaveBackpack(HOST);

    expect(markLeft).not.toHaveBeenCalled();
  });

  it('refuses a host operation that names no surface it owns', () => {
    const { facade, hideBackpackProjectSurface } = createFacade();
    // A0.2: the host proves its window and must name its target. There is
    // deliberately no "the window has only one surface, so use that" path --
    // it would work until a second surface existed.
    expect(() => facade.hideBackpackProjectSurface(HOST, 'sf-never-existed'))
      .toThrow(/not open in this Papers window/);
    expect(hideBackpackProjectSurface).not.toHaveBeenCalled();
  });

  it('refuses a surface that belongs to a different window', () => {
    const { facade, logicalSurfaces } = createFacade();
    // Created in window 2; the host sender proves window 1.
    const elsewhere = logicalSurfaces.create({ windowId: 2, projectId: PROJECT, kind: 'project' });

    expect(() => facade.hideBackpackProjectSurface(HOST, elsewhere.surfaceId))
      .toThrow(/not open in this Papers window/);
  });

  it('refuses to show a URL belonging to a different project than the surface', async () => {
    const { facade, logicalSurfaces, showBackpackProjectSurface } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    await expect(
      facade.showBackpackProjectSurface(HOST, surface.surfaceId, `papers-backpack://${OTHER}/ns/1/public/index.html`),
    ).rejects.toThrow(/may not show another Backpack project/);
    expect(showBackpackProjectSurface).not.toHaveBeenCalled();
  });

  it('refuses a surface URL that is not a Backpack project scheme', async () => {
    const { facade, logicalSurfaces } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    await expect(
      facade.showBackpackProjectSurface(HOST, surface.surfaceId, `https://${PROJECT}/index.html`),
    ).rejects.toThrow(/may not show another Backpack project/);
  });

  it('takes the project from the surface, not from what the window entered', async () => {
    const { facade, surfaces, logicalSurfaces, showBackpackProjectSurface } = createFacade();
    // The host binding says one project; the named surface says another. The
    // surface is authoritative, and the URL is checked against IT.
    surfaces.bind(HOST, { projectId: OTHER, windowId: 1, kind: 'host' });
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    await facade.showBackpackProjectSurface(HOST, surface.surfaceId, `papers-backpack://${PROJECT}/ns/1/public/index.html`);
    expect(showBackpackProjectSurface).toHaveBeenCalledTimes(1);
  });

  it('refuses every project request from a sender that is not bound', async () => {
    const { facade } = createFacade();
    await expect(facade.showBackpackProjectSurface(999, 'sf-1', `papers-backpack://${PROJECT}/x`))
      .rejects.toThrow(/Only a Papers window may act on a surface/);
    await expect(facade.saveBackpackProjectState(999, '{}'))
      .rejects.toThrow(/Enter a Backpack project/);
  });
});

describe('a host renderer is not a project surface', () => {
  const HOST = 11;
  const FRAME = 12;

  it('refuses an untargeted project operation from a host sender', async () => {
    const { facade, logicalSurfaces } = createFacade();
    logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    // These channels resolve through the SENDER's own project binding. A host
    // has none, so a host call is refused rather than acting on whichever
    // project the window last opened -- which, with two tabs, is the
    // wrong-project class all over again.
    await expect(facade.saveBackpackProjectState(HOST, '{}'))
      .rejects.toThrow(/Enter a Backpack project/);
    await expect(facade.runBackpackProjectAction(HOST, 'clips'))
      .rejects.toThrow(/Enter a Backpack project/);
  });

  it('lets the project frame act, because its binding proves its own surface', async () => {
    const { facade, surfaces, logicalSurfaces } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    surfaces.bind(FRAME, { surfaceId: surface.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project' });

    await expect(facade.saveBackpackProjectState(FRAME, '{}')).resolves.toBeUndefined();
  });

  it('refuses a project frame whose surface has been retired', async () => {
    const { facade, surfaces, logicalSurfaces } = createFacade();
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    surfaces.bind(FRAME, { surfaceId: surface.surfaceId, projectId: PROJECT, windowId: 1, kind: 'project' });

    // The surface is gone but this sender has not been torn down yet.
    logicalSurfaces.retire(surface.surfaceId);

    await expect(facade.saveBackpackProjectState(FRAME, '{}'))
      .rejects.toThrow(/no longer open/);
  });
});

describe('project-unavailability lifecycle uses logical surface identity', () => {
  it('archives every exact project surface without touching another project', async () => {
    const {
      facade, logicalSurfaces, closeAttachedProjectSurface, sendToWindow,
      setActiveSurfaceId, setEnteredBackpack, workspaceTopologies,
    } = createFacade();
    const a = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });
    const b = logicalSurfaces.create({ windowId: 2, projectId: PROJECT, kind: 'project' });
    const other = logicalSurfaces.create({ windowId: 1, projectId: OTHER, kind: 'project' });
    setActiveSurfaceId(1, a.surfaceId);
    setActiveSurfaceId(2, b.surfaceId);
    workspaceTopologies.set(1, openWorkspaceSurface(
      openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: a.surfaceId, projectId: PROJECT, title: 'A' }),
      { surfaceId: other.surfaceId, projectId: OTHER, title: 'Other' },
    ));
    workspaceTopologies.set(2, openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: b.surfaceId, projectId: PROJECT, title: 'A' }));

    await facade.setBackpackArchived(PROJECT, true);

    expect(closeAttachedProjectSurface.mock.calls).toEqual([
      [1, a.surfaceId],
      [2, b.surfaceId],
    ]);
    expect(sendToWindow.mock.calls.filter(([, channel]) => channel === 'host:event:backpack-project-close-request')).toEqual([
      [1, 'host:event:backpack-project-close-request', { surfaceId: a.surfaceId }],
      [2, 'host:event:backpack-project-close-request', { surfaceId: b.surfaceId }],
    ]);
    expect(logicalSurfaces.get(a.surfaceId)).toBeNull();
    expect(logicalSurfaces.get(b.surfaceId)).toBeNull();
    expect(logicalSurfaces.get(other.surfaceId)).not.toBeNull();
    expect(setActiveSurfaceId).toHaveBeenCalledWith(1, other.surfaceId);
    expect(setEnteredBackpack).toHaveBeenCalledWith(1, OTHER);
    expect(setActiveSurfaceId).toHaveBeenCalledWith(2, null);
    expect(setEnteredBackpack).toHaveBeenCalledWith(2, null);
  });
});
