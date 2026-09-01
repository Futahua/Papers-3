import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
import { createLogicalSurfaceRegistry } from '../../src/main/windows/logicalSurfaceRegistry';
import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';

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
  const hideBackpackProjectSurface = vi.fn((_senderId: number) => {});
  const showBackpackProjectSurface = vi.fn(async (_senderId: number, _surfaceId: string, _url: string) => {});
  const facade = new PapersHostFacade({
    surfaces,
    logicalSurfaces,
    windowIdForSender: () => 1,
    // Realistic: only the host renderer of window 1 resolves. An unknown
    // sender is not a Papers window.
    hostWindowForSender: (senderId: number) => (senderId === 11 ? 1 : null),
    hostWindowIds: () => [1],
    sendToWindow: () => {},
    enteredBackpack: () => null,
    setEnteredBackpack: vi.fn(),
    registry: {
      find: (id: string) => (id === PROJECT || id === OTHER ? { id, archived: false } : null),
      list: () => [],
    },
    showBackpackProjectSurface,
    hideBackpackProjectSurface,
    // Present only so the guard is what refuses, not a missing service.
    backpackProjects: { saveState: vi.fn(async () => ({ ok: true, revision: 'r1' })) },
  } as unknown as FacadeDeps);
  return { facade, surfaces, logicalSurfaces, hideBackpackProjectSurface, showBackpackProjectSurface };
}

describe('surface routing in the host facade', () => {
  const HOST = 11;
  const FRAME = 12;
  const WIDGET = 13;

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
    const { facade, surfaces, logicalSurfaces } = createFacade();
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
    const { facade, surfaces, logicalSurfaces } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });
    const surface = logicalSurfaces.create({ windowId: 1, projectId: PROJECT, kind: 'project' });

    await facade.closeBackpackProject(HOST, surface.surfaceId);

    expect(surfaces.projectForSender(HOST)).toBeNull();
    expect(logicalSurfaces.get(surface.surfaceId)).toBeNull();
    // A stale client repeating the call gets a refusal, not another window's
    // surface.
    await expect(facade.closeBackpackProject(HOST, surface.surfaceId))
      .rejects.toThrow(/not open in this Papers window/);
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
