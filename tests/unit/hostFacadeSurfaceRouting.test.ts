import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
import { createLogicalSurfaceRegistry } from '../../src/main/windows/logicalSurfaceRegistry';
import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';
import { createWorkspaceTopology, openWorkspaceSurface, splitWorkspaceGroup } from '../../src/shared/workspaceTopology';

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
  const setWorkspaceTopology = vi.fn((windowId: number, topology: ReturnType<typeof createWorkspaceTopology>) => {
    workspaceTopologies.set(windowId, topology);
  });
  const markLeft = vi.fn(async () => {});
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
    clearEnteredBackpackEverywhere: vi.fn(),
    listLogicalSurfaces: () => logicalSurfaces.project(),
    retireProjectSurfaces: (projectId: string) => { logicalSurfaces.retireProject(projectId); },
    retireBackpackProjectSurfaces: vi.fn(async () => {}),
    closeAttachedProjectSurface,
    closeBackpackProjectSurface,
    registry: {
      find: (id: string) => (id === PROJECT || id === OTHER ? {
        id, name: id === PROJECT ? 'Alpha' : 'Beta', archived: archivedProjects.has(id),
      } : null),
      list: () => [],
      setArchived: vi.fn(async (id: string, archived: boolean) => {
        if (archived) archivedProjects.add(id); else archivedProjects.delete(id);
      }),
      markLeft,
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
