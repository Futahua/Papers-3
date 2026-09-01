import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
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
  const hideBackpackProjectSurface = vi.fn();
  const showBackpackProjectSurface = vi.fn(async () => {});
  const facade = new PapersHostFacade({
    surfaces,
    windowIdForSender: () => 1,
    registry: {
      find: (id: string) => (id === PROJECT || id === OTHER ? { id, archived: false } : null),
    },
    showBackpackProjectSurface,
    hideBackpackProjectSurface,
    // Present only so the guard is what refuses, not a missing service.
    backpackProjects: { saveState: vi.fn(async () => ({ ok: true, revision: 'r1' })) },
  } as unknown as FacadeDeps);
  return { facade, surfaces, hideBackpackProjectSurface, showBackpackProjectSurface };
}

describe('surface routing in the host facade', () => {
  const HOST = 11;
  const FRAME = 12;
  const WIDGET = 13;

  it('hiding does not leave: the host can show again straight afterwards', async () => {
    const { facade, surfaces, showBackpackProjectSurface } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });
    const url = `papers-backpack://${PROJECT}/ns/1/public/index.html`;

    await facade.showBackpackProjectSurface(HOST, url);
    // BackpackProjectFrame hides on unmount and shows again on mount, so an
    // unbound host here would refuse the very next show.
    facade.hideBackpackProjectSurface(HOST);
    await expect(facade.showBackpackProjectSurface(HOST, url)).resolves.toBeUndefined();

    expect(showBackpackProjectSurface).toHaveBeenCalledTimes(2);
    expect(surfaces.projectForSender(HOST)).toBe(PROJECT);
  });

  it('hiding the workspace leaves a live compact widget bound and usable', () => {
    const { facade, surfaces } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });
    surfaces.bind(FRAME, { projectId: PROJECT, windowId: 1, kind: 'project' });
    // A widget outlives a return to the Backpack list, and carries the same
    // owning window id as the host.
    surfaces.bind(WIDGET, { projectId: PROJECT, windowId: 1, kind: 'widget' });

    facade.hideBackpackProjectSurface(HOST);

    expect(surfaces.projectForSender(WIDGET)).toBe(PROJECT);
    expect(surfaces.projectForSender(HOST)).toBe(PROJECT);
  });

  it('leaving the project unbinds the host that asked', async () => {
    const { facade, surfaces } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });

    await facade.closeBackpackProject(HOST).catch(() => undefined);

    expect(surfaces.projectForSender(HOST)).toBeNull();
  });

  it('a hide from an unbound sender is a no-op rather than an error', () => {
    const { facade, hideBackpackProjectSurface } = createFacade();
    expect(() => facade.hideBackpackProjectSurface(999)).not.toThrow();
    expect(hideBackpackProjectSurface).not.toHaveBeenCalled();
  });

  it('refuses to show a URL belonging to a different project than the sender', async () => {
    const { facade, surfaces, showBackpackProjectSurface } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });

    await expect(
      facade.showBackpackProjectSurface(HOST, `papers-backpack://${OTHER}/ns/1/public/index.html`),
    ).rejects.toThrow(/may not show another Backpack project/);
    expect(showBackpackProjectSurface).not.toHaveBeenCalled();
  });

  it('refuses a surface URL that is not a Backpack project scheme', async () => {
    const { facade, surfaces } = createFacade();
    surfaces.bind(HOST, { projectId: PROJECT, windowId: 1, kind: 'host' });

    await expect(
      facade.showBackpackProjectSurface(HOST, `https://${PROJECT}/index.html`),
    ).rejects.toThrow(/may not show another Backpack project/);
  });

  it('refuses every project request from a sender that is not bound', async () => {
    const { facade } = createFacade();
    await expect(facade.showBackpackProjectSurface(999, `papers-backpack://${PROJECT}/x`))
      .rejects.toThrow(/Enter a Backpack project/);
    await expect(facade.saveBackpackProjectState(999, '{}'))
      .rejects.toThrow(/Enter a Backpack project/);
  });
});
