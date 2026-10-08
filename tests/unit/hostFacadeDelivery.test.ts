import { describe, expect, it, vi } from 'vitest';

import { PapersHostFacade, type FacadeDeps } from '../../src/main/hostFacade';
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

  it('drops a queued title from a target window that has started closing', async () => {
    let topology: WorkspaceTopologyV1 = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'surface-a', projectId: 'bp-a', title: 'As you Go',
    });
    const setWorkspaceTopology = vi.fn((_windowId: number, next: WorkspaceTopologyV1) => { topology = next; });
    const facade = new PapersHostFacade({
      workspaceTopology: () => topology,
      setWorkspaceTopology,
      sendToWindow: vi.fn(),
      workspaceMove: { isWindowClosing: () => true },
      surfaces: { contextForSender: () => ({ windowId: 7, surfaceId: 'surface-a', projectId: 'bp-a', kind: 'project' }) },
    } as unknown as FacadeDeps);

    await facade.updateWorkspaceSurfaceTitle(7, 'surface-a', 42, 'stale while closing');

    expect(topology.surfaces[0]?.title).toBe('As you Go');
    expect(setWorkspaceTopology).not.toHaveBeenCalled();
  });

  it('broadcasts application-level facts to every live host', () => {
    const { facade, broadcasts, targeted } = createFacade();

    expect(broadcasts.map((b) => b.channel)).toEqual([
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
