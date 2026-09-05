import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
import type { HermesSurfaceState } from '../../src/main/hermes/hermesSurface';
import { createWorkspaceTopology, openWorkspaceSurface, type WorkspaceTopologyV1 } from '../../src/shared/workspaceTopology';

/**
 * Delivery is the part that breaks quietly once a second window exists: an
 * event sent to "the host" reaches one window and silently misses the other,
 * or reaches a window it would mislead. These assert which of the two
 * primitives each event uses.
 */
function createFacade({ hostWindows = [1, 2], runtimeWindow = 1 as number | null } = {}) {
  const broadcasts: Array<{ channel: string; payload: unknown }> = [];
  const targeted: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  const facade = new PapersHostFacade({
    broadcastToHosts: (channel: string, payload: unknown) => broadcasts.push({ channel, payload }),
    sendToWindow: (windowId: number, channel: string, payload: unknown) => targeted.push({ windowId, channel, payload }),
    hostWindowForSender: (senderId: number) => (senderId >= 10 && hostWindows.includes(senderId - 9) ? senderId - 9 : null),
    canvasRuntimeWindow: () => runtimeWindow,
    hostWindowIds: () => hostWindows,
    registry: { list: () => [], lastActiveBackpackId: null },
    enteredBackpack: (windowId: number) => (windowId === 1 ? 'bp-a' : 'bp-b'),
    activeSurfaceId: () => null,
    setActiveSurfaceId: () => {},
    adapter: { health: { ok: true } },
    surfaces: { contextForSender: () => null },
  } as unknown as FacadeDeps);
  return { facade, broadcasts, targeted };
}

describe('host event delivery across windows', () => {
  it('relays a bounded document title to the exact surface and canonical topology', () => {
    const targeted: Array<{ windowId: number; channel: string; payload: unknown }> = [];
    let topology: WorkspaceTopologyV1 = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'bp-a', title: 'As you Go',
    });
    const facade = new PapersHostFacade({
      workspaceTopology: () => topology,
      setWorkspaceTopology: (_windowId: number, next: WorkspaceTopologyV1) => { topology = next; },
      sendToWindow: (windowId: number, channel: string, payload: unknown) => targeted.push({ windowId, channel, payload }),
      surfaces: { contextForSender: (senderId: number) => senderId === 42
        ? { windowId: 7, surfaceId: 'surface-a', projectId: 'bp-a', kind: 'project' }
        : null },
    } as unknown as FacadeDeps);

    return facade.updateWorkspaceSurfaceTitle(7, 'surface-a', 42, '  Hồ sơ 📦  ').then(() => {
      expect(topology.surfaces[0]?.title).toBe('Hồ sơ 📦');
      expect(targeted).toEqual([{
        windowId: 7,
        channel: 'host:event:workspace-project-title',
        payload: { surfaceId: 'surface-a', title: 'Hồ sơ 📦' },
      }]);
    });
  });

  it('fails closed for an old or unrelated project sender', async () => {
    const targeted: unknown[] = [];
    let topology: WorkspaceTopologyV1 = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'bp-a', title: 'As you Go',
    });
    const facade = new PapersHostFacade({
      workspaceTopology: () => topology,
      setWorkspaceTopology: (_windowId: number, next: WorkspaceTopologyV1) => { topology = next; },
      sendToWindow: (_windowId: number, _channel: string, payload: unknown) => targeted.push(payload),
      surfaces: { contextForSender: () => null },
    } as unknown as FacadeDeps);

    await facade.updateWorkspaceSurfaceTitle(7, 'surface-a', 99, 'stale title');

    expect(topology.surfaces[0]?.title).toBe('As you Go');
    expect(targeted).toEqual([]);
  });

  it('broadcasts application-level facts to every live host', () => {
    const { facade, broadcasts, targeted } = createFacade();

    facade.emitRunsChanged({ runs: [] } as never);
    facade.emitHermesHealth();

    expect(broadcasts.map((b) => b.channel)).toEqual([
      'host:event:runs-changed',
      'host:event:hermes-health',
    ]);
    expect(targeted).toEqual([]);
  });

  it('projects the Backpack list per recipient rather than broadcasting one payload', () => {
    // Globally triggered, but each window must be told the Backpack IT entered.
    // A single broadcast would put one window's active Backpack into all of them.
    const { facade, broadcasts, targeted } = createFacade();

    facade.emitBackpacksChanged();

    expect(broadcasts).toEqual([]);
    expect(targeted.map((t) => [t.windowId, t.channel])).toEqual([
      [1, 'host:event:backpacks-changed'],
      [2, 'host:event:backpacks-changed'],
    ]);
    // Each window is told the Backpack it entered, not a shared one.
    expect(targeted.map((t) => (t.payload as { activeBackpackId: string }).activeBackpackId))
      .toEqual(['bp-a', 'bp-b']);
  });

  it('sends program events to the runtime owner window, not to every window', () => {
    const { facade, broadcasts, targeted } = createFacade({ runtimeWindow: 2 });

    facade.emitProgramStatus({ state: 'running' } as never);
    facade.emitShelfChanged([] as never);
    facade.emitSaveStatus('saved' as never);

    expect(broadcasts).toEqual([]);
    expect(targeted.map((t) => [t.windowId, t.channel])).toEqual([
      [2, 'host:event:program-status'],
      [2, 'host:event:shelf-changed'],
      [2, 'host:event:save-status'],
    ]);
  });

  it('save status is the program state save, so it follows the runtime owner', () => {
    // Traced to programIpc: program:state:save emits saving/saved/error. It is
    // NOT the Backpack document CAS path, which reports through its own result.
    const { facade, targeted } = createFacade({ runtimeWindow: 1 });
    facade.emitSaveStatus('error' as never, 'disk full');
    expect(targeted).toEqual([
      { windowId: 1, channel: 'host:event:save-status', payload: { status: 'error', detail: 'disk full' } },
    ]);
  });

  it('drops a runtime-owned event when no window owns the runtime', () => {
    const { facade, broadcasts, targeted } = createFacade({ runtimeWindow: null });
    facade.emitProgramStatus({ state: 'idle' } as never);
    // Better to deliver nowhere than to fall back to some window that is not
    // running the program.
    expect(targeted).toEqual([]);
    expect(broadcasts).toEqual([]);
  });

  it('accepts any registered host renderer, with no primary among them', () => {
    const { facade } = createFacade({ hostWindows: [1, 2] });

    // Window 1's renderer and window 2's renderer are equally legitimate.
    expect(facade.isHostSender({ id: 10 } as never)).toBe(true);
    expect(facade.isHostSender({ id: 11 } as never)).toBe(true);
  });

  it('rejects a sender that is not a live host renderer', () => {
    const { facade } = createFacade({ hostWindows: [1] });
    expect(facade.isHostSender({ id: 999 } as never)).toBe(false);
  });
});

describe('the updater knows nothing about windows', () => {
  it('reports state changes through a callback rather than sending to a host', async () => {
    const { PapersUpdater } = await import('../../src/main/papersUpdater');
    const seen: unknown[] = [];
    const updater = new PapersUpdater((next) => seen.push(next));

    // Constructing it requires no host, no window and no WebContents at all —
    // which is the point: updater state is application-level.
    expect(updater.current).toBeDefined();
    expect(seen).toEqual([]);
    expect(vi.isMockFunction(updater.start)).toBe(false);
  });
});

/**
 * The cross-window control class of bug: one window operating a Hermes that
 * belongs to another. Ownership is the whole guard here, so each operation is
 * asserted from a non-owner as well as from the owner.
 */
function createHermesFacade({
  surfaceState = { placement: 'docked', status: 'ready' },
  dock = async () => surfaceState,
  hideDock = async () => {},
  showDetached = async () => ({ placement: 'detached', status: 'ready' }),
  initialOwner = 2,
}: {
  surfaceState?: HermesSurfaceState;
  dock?: () => Promise<HermesSurfaceState>;
  hideDock?: () => Promise<void>;
  showDetached?: () => Promise<HermesSurfaceState>;
  initialOwner?: number | null;
} = {}) {
  const sent: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  let currentState = surfaceState;
  const surface = {
    get state() { return currentState; },
    dock: vi.fn(async () => {
      currentState = await dock();
      return currentState;
    }),
    setDockBounds: vi.fn(),
    hideDock: vi.fn(async () => {
      await hideDock();
      currentState = { placement: 'closed', status: 'ready' };
    }),
    showDetached: vi.fn(async () => {
      currentState = await showDetached();
      return currentState;
    }),
    hideDetached: vi.fn(async () => {}),
  };
  let owner: number | null = initialOwner;
  const facade = new PapersHostFacade({
    broadcastToHosts: () => {},
    sendToWindow: (windowId: number, channel: string, payload: unknown) => sent.push({ windowId, channel, payload }),
    // Sender 10 is window 1's renderer (A); sender 20 is window 2's (B).
    hostWindowForSender: (senderId: number) => (senderId === 10 ? 1 : senderId === 20 ? 2 : null),
    hostWindowIds: () => [1, 2],
    hermesDockOwner: () => owner,
    setHermesDockOwner: (windowId: number | null) => { owner = windowId; },
    hermesSurface: surface,
  } as unknown as FacadeDeps);
  return { facade, surface, sent, owner: () => owner };
}

describe('Hermes dock ownership across windows', () => {
  const A = 10;
  const B = 20;

  it('tells each window the same placement and its own answer about ownership', () => {
    const { facade } = createHermesFacade();
    expect(facade.hermesSurfaceStatus(B)).toMatchObject({ placement: 'docked', ownedByThisWindow: true });
    expect(facade.hermesSurfaceStatus(A)).toMatchObject({ placement: 'docked', ownedByThisWindow: false });
  });

  it('ignores a dock-bounds change from a window that does not own the dock', () => {
    const { facade, surface } = createHermesFacade();
    facade.setHermesDockBounds(A, { x: 0, y: 0, width: 400, height: 800 });
    expect(surface.setDockBounds).not.toHaveBeenCalled();

    facade.setHermesDockBounds(B, { x: 0, y: 0, width: 400, height: 800 });
    expect(surface.setDockBounds).toHaveBeenCalledTimes(1);
  });

  it('ignores hide-dock from a window that does not own the dock', async () => {
    const { facade, surface, owner } = createHermesFacade();
    await facade.hideHermesDock(A);
    expect(surface.hideDock).not.toHaveBeenCalled();
    expect(owner()).toBe(2);
  });

  it('transfers ownership when the other window explicitly docks, and tells both', async () => {
    const { facade, surface, sent, owner } = createHermesFacade();

    await facade.dockHermes(A, { x: 0, y: 0, width: 400, height: 800 });

    expect(surface.dock).toHaveBeenCalledTimes(1);
    expect(owner()).toBe(1);
    // Both windows are told, each with its own ownership answer.
    const hermesEvents = sent.filter((s) => s.channel === 'host:event:hermes-surface');
    expect(hermesEvents.find((e) => e.windowId === 1)?.payload).toMatchObject({ ownedByThisWindow: true });
    expect(hermesEvents.find((e) => e.windowId === 2)?.payload).toMatchObject({ ownedByThisWindow: false });
  });

  it('restores the previous owner when a dock attempt reports failure', async () => {
    const failed = { placement: 'docked', status: 'error', detail: 'dock failed' } satisfies HermesSurfaceState;
    const { facade, owner } = createHermesFacade({ surfaceState: failed, dock: async () => failed });

    await facade.dockHermes(A, { x: 0, y: 0, width: 400, height: 800 });

    expect(owner()).toBe(2);
    expect(facade.hermesSurfaceStatus(A)).toMatchObject({ placement: 'docked', status: 'error', ownedByThisWindow: false });
  });

  it('serializes overlapping docks so an older failure cannot roll back a newer success', async () => {
    let settleFirst!: (state: HermesSurfaceState) => void;
    const first = new Promise<HermesSurfaceState>((resolve) => { settleFirst = resolve; });
    const ready = { placement: 'docked', status: 'ready' } satisfies HermesSurfaceState;
    let call = 0;
    const { facade, surface, owner } = createHermesFacade({
      dock: async () => (++call === 1 ? first : ready),
    });

    const older = facade.dockHermes(A, { x: 0, y: 0, width: 400, height: 800 });
    await vi.waitFor(() => expect(surface.dock).toHaveBeenCalledTimes(1));
    const newer = facade.dockHermes(B, { x: 10, y: 10, width: 400, height: 800 });
    await Promise.resolve();
    expect(surface.dock).toHaveBeenCalledTimes(1);

    settleFirst({ placement: 'docked', status: 'error', detail: 'older failed' });
    await older;
    await newer;

    expect(surface.dock).toHaveBeenCalledTimes(2);
    expect(owner()).toBe(2);
  });

  it('serializes detach after a pending dock so final placement and ownership agree', async () => {
    let settleDock!: (state: HermesSurfaceState) => void;
    const pendingDock = new Promise<HermesSurfaceState>((resolve) => { settleDock = resolve; });
    const { facade, surface, owner } = createHermesFacade({ dock: async () => pendingDock });

    const docking = facade.dockHermes(A, { x: 0, y: 0, width: 400, height: 800 });
    await vi.waitFor(() => expect(surface.dock).toHaveBeenCalledTimes(1));
    const detaching = facade.showHermesWindow();
    await Promise.resolve();
    expect(surface.showDetached).not.toHaveBeenCalled();

    settleDock({ placement: 'docked', status: 'ready' });
    await docking;
    await detaching;

    expect(surface.showDetached).toHaveBeenCalledTimes(1);
    expect(surface.state).toMatchObject({ placement: 'detached', status: 'ready' });
    expect(owner()).toBeNull();
  });

  it('hides Hermes and releases ownership before its dock-owning window is removed', async () => {
    const { facade, surface, sent, owner } = createHermesFacade({ initialOwner: 1 });

    await facade.onPapersWindowClosing(1);

    expect(surface.hideDock).toHaveBeenCalledTimes(1);
    expect(surface.state).toMatchObject({ placement: 'closed', status: 'ready' });
    expect(owner()).toBeNull();
    expect(sent.find((event) => event.windowId === 2 && event.channel === 'host:event:hermes-surface')?.payload)
      .toMatchObject({ placement: 'closed', ownedByThisWindow: false });
  });

  it('does not release ownership or report closed when owner-close minimize fails', async () => {
    const failure = new Error('Hermes Desktop did not acknowledge minimize.');
    const { facade, surface, sent, owner } = createHermesFacade({
      initialOwner: 1,
      hideDock: async () => { throw failure; },
    });

    await expect(facade.onPapersWindowClosing(1)).rejects.toThrow(failure);

    expect(surface.state).toMatchObject({ placement: 'docked', status: 'ready' });
    expect(owner()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('serializes owner close before a later dock transfer', async () => {
    let settleHide!: () => void;
    const pendingHide = new Promise<void>((resolve) => { settleHide = resolve; });
    const { facade, surface, owner } = createHermesFacade({
      initialOwner: 1,
      hideDock: async () => pendingHide,
    });

    const closing = facade.onPapersWindowClosing(1);
    await vi.waitFor(() => expect(surface.hideDock).toHaveBeenCalledTimes(1));
    const docking = facade.dockHermes(B, { x: 10, y: 10, width: 400, height: 800 });
    await Promise.resolve();
    expect(surface.dock).not.toHaveBeenCalled();

    settleHide();
    await closing;
    await docking;

    expect(surface.dock).toHaveBeenCalledTimes(1);
    expect(surface.state).toMatchObject({ placement: 'docked', status: 'ready' });
    expect(owner()).toBe(2);
  });

  it('refuses to dock for a sender that is not a Papers window', async () => {
    const { facade, surface } = createHermesFacade();
    await expect(facade.dockHermes(999, { x: 0, y: 0, width: 400, height: 800 }))
      .rejects.toThrow(/Only a Papers window may dock Hermes/);
    expect(surface.dock).not.toHaveBeenCalled();
  });

  it('releases ownership when Hermes detaches, because a detached Hermes belongs to nobody', async () => {
    const { facade, owner } = createHermesFacade();
    await facade.showHermesWindow();
    expect(owner()).toBeNull();
  });

  it('restores the previous owner when detaching reports failure', async () => {
    const failed = { placement: 'docked', status: 'error', detail: 'detach failed' } satisfies HermesSurfaceState;
    const { facade, owner } = createHermesFacade({ surfaceState: failed, showDetached: async () => failed });

    await expect(facade.showHermesWindow()).resolves.toMatchObject({ placement: 'docked', status: 'error' });

    expect(owner()).toBe(2);
  });

  it('reports no window ownership unless Hermes is actually docked', () => {
    const { facade } = createHermesFacade({ surfaceState: { placement: 'detached', status: 'ready' } });

    expect(facade.hermesSurfaceStatus(B)).toMatchObject({ placement: 'detached', ownedByThisWindow: false });
  });

  it('releases ownership when the owner hides the dock', async () => {
    const { facade, surface, owner } = createHermesFacade();
    await facade.hideHermesDock(B);
    expect(surface.hideDock).toHaveBeenCalledTimes(1);
    expect(owner()).toBeNull();
  });
});
