import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';

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
    registry: { list: () => [], lastActiveBackpackId: null },
    adapter: { health: { ok: true } },
    surfaces: { contextForSender: () => null },
  } as unknown as FacadeDeps);
  return { facade, broadcasts, targeted };
}

describe('host event delivery across windows', () => {
  it('broadcasts application-level facts to every live host', () => {
    const { facade, broadcasts, targeted } = createFacade();

    facade.emitBackpacksChanged();
    facade.emitRunsChanged({ runs: [] } as never);
    facade.emitHermesHealth();

    expect(broadcasts.map((b) => b.channel)).toEqual([
      'host:event:backpacks-changed',
      'host:event:runs-changed',
      'host:event:hermes-health',
    ]);
    expect(targeted).toEqual([]);
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
function createHermesFacade() {
  const sent: Array<{ windowId: number; channel: string; payload: unknown }> = [];
  const surface = {
    state: { placement: 'docked' as const, status: 'ready' as const },
    dock: vi.fn(async () => ({ placement: 'docked', status: 'ready' })),
    setDockBounds: vi.fn(),
    hideDock: vi.fn(async () => {}),
    showDetached: vi.fn(async () => ({ placement: 'detached', status: 'ready' })),
    hideDetached: vi.fn(async () => {}),
  };
  let owner: number | null = 2;
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

  it('releases ownership when the owner hides the dock', async () => {
    const { facade, surface, owner } = createHermesFacade();
    await facade.hideHermesDock(B);
    expect(surface.hideDock).toHaveBeenCalledTimes(1);
    expect(owner()).toBeNull();
  });
});
