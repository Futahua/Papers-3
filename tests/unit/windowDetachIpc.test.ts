import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import { registerWindowDetachIpc } from '../../src/main/ipc/windowDetachIpc';
import type { WindowDetachSession } from '../../src/main/windows/windowDetachSession';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle(channel: string, fn: (event: never, raw: unknown) => Promise<unknown>) {
        handlers.set(channel, fn as (event: unknown, raw: unknown) => Promise<unknown>);
      },
    },
    invoke(channel: string, senderId: number, raw: unknown) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      const send = vi.fn();
       const sender = { id: senderId, mainFrame: { url: senderId === 10 ? 'https://evil.example/' : 'papers-backpack://bp-a/public/index.html' }, isDestroyed: () => false, send };
      return { result: handler({ sender }, raw), send };
    },
  };
}

function fakeSession(): WindowDetachSession {
  return {
    open: vi.fn(async () => ({ ok: true })),
    focus: vi.fn(() => true),
    reattach: vi.fn(async () => undefined),
    closeProject: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    isOpen: vi.fn(() => false),
    registerDetachIpc: vi.fn(),
    unregisterDetachIpc: vi.fn(),
  } as unknown as WindowDetachSession;
}

const ENTRY = 'papers-backpack://bp-a/ns/u/public/index.html';

describe('window detach IPC', () => {
  it('detach-open registers the workspace sender and opens the session', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    const session = fakeSession();
    const resolveEntryUrl = vi.fn(() => ENTRY);
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: (sender, projectId) => sender.id === 7 && projectId === 'bp-a',
      resolveEntryUrl,
    });
    const { result, send } = await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a', bounds: { x: 100, y: 100, width: 800, height: 600 } });
    expect(await result).toEqual({ ok: true });
    expect(registry.surface(7)?.kind).toBe('workspace');
    expect(registry.surface(7)?.projectId).toBe('bp-a');
    expect(resolveEntryUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'bp-a');
    expect(session.open).toHaveBeenCalledWith({
      projectId: 'bp-a',
      entryUrl: ENTRY,
      // Ownership resolved once at this boundary and passed downward; the
      // session never derives it.
      owningWindowId: 1,
      bounds: { x: 100, y: 100, width: 800, height: 600 },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('018X1R rejects detached routes when the current sender origin is wrong', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    registry.register(9, 'bp-a', 'detached');
    registry.register(10, 'bp-a', 'detached');
    const session = fakeSession();
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => false,
      isDetachedSender: (sender, projectId) => {
        try {
          const origin = new URL(sender.mainFrame.url);
          return origin.protocol === 'papers-backpack:' && origin.host === projectId;
        } catch {
          return false;
        }
      },
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-reattach', 9, { token: registry.surface(9)!.token, transferId: 'tr-1' })).result)
      .resolves.toEqual({ ok: true });
    expect(session.reattach).toHaveBeenCalledWith('bp-a');
    await expect((await invoke('papers:backpack:detach-reattach', 10, { token: registry.surface(10)!.token, transferId: 'tr-2' })).result)
      .rejects.toThrow(/denied/);
  });

  it('detach-open rejects unknown or missing fields', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session: fakeSession(),
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => true,
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a', extra: 1 })).result).rejects.toThrow(/unknown fields/);
    await expect((await invoke('papers:backpack:detach-open', 7, {})).result).rejects.toThrow(/unknown fields/);
  });

  it('detach-open rejects an oversized or malformed project id', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session: fakeSession(),
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => true,
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'x'.repeat(600) })).result).rejects.toThrow(/bounded non-empty project id/);
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: '' })).result).rejects.toThrow(/bounded non-empty project id/);
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 5 })).result).rejects.toThrow(/bounded non-empty project id/);
  });

  it('detach-open rejects malformed bounds', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session: fakeSession(),
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => true,
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a', bounds: { x: 0, y: 0, width: 0, height: 100 } })).result).rejects.toThrow(/bounds are malformed/);
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a', bounds: { x: 0, y: 0, width: 1 } })).result).rejects.toThrow(/bounds are malformed/);
  });

  it('detach-open rejects a sender that is not the bound project frame', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session: fakeSession(),
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => false,
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a' })).result).rejects.toThrow(/denied/);
  });

  it('018V6: detach-open rejects when the live workspace entry is unavailable', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const session = fakeSession();
    const resolveEntryUrl = vi.fn(() => null);
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => true,
      resolveEntryUrl,
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a' })).result)
      .rejects.toThrow(/no live workspace entry/);
    expect(session.open).not.toHaveBeenCalled();
  });

  it('detach-open rejects a sender already bound to another project or kind', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    registry.register(7, 'bp-other', WORKSPACE_SURFACE_KIND);
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session: fakeSession(),
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: (sender, projectId) => sender.id === 7 && projectId === 'bp-a',
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a' })).result).rejects.toThrow(/bound to another project surface/);
  });

  it('detach-open surfaces the session failure as an error', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const session = fakeSession();
    (session.open as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'already open' });
    registerWindowDetachIpc({
      ipcMain,
      registry: new BackpackSurfaceRegistry(),
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: () => true,
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    await expect((await invoke('papers:backpack:detach-open', 7, { projectId: 'bp-a' })).result).rejects.toThrow(/already open/);
  });

  it('detach-reattach delegates CLOSED production push to the session', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    registry.register(7, 'bp-a', WORKSPACE_SURFACE_KIND);
    const session = fakeSession();
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: (sender, projectId) => sender.id === 7 && projectId === 'bp-a',
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    const { result, send } = await invoke('papers:backpack:detach-reattach', 7, { projectId: 'bp-a' });
    expect(await result).toEqual({ ok: true });
    expect(session.reattach).toHaveBeenCalledWith('bp-a');
    expect(send).not.toHaveBeenCalled();
  });

  it('detach-reattach and detach-close reject unregistered or wrong-project senders', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    registry.register(7, 'bp-a', WORKSPACE_SURFACE_KIND);
    const session = fakeSession();
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: (sender, projectId) => sender.id === 7 && projectId === 'bp-a',
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    // Unregistered sender.
    await expect((await invoke('papers:backpack:detach-reattach', 99, { projectId: 'bp-a' })).result).rejects.toThrow(/denied/);
    // Wrong project for a registered sender.
    await expect((await invoke('papers:backpack:detach-reattach', 7, { projectId: 'bp-b' })).result).rejects.toThrow(/denied/);
    // Malformed payload.
    await expect((await invoke('papers:backpack:detach-close', 7, { projectId: 'bp-a', extra: 1 })).result).rejects.toThrow(/exactly/);
    // Unregistered sender for close.
    await expect((await invoke('papers:backpack:detach-close', 99, { projectId: 'bp-a' })).result).rejects.toThrow(/denied/);
    expect(session.reattach).not.toHaveBeenCalled();
    expect(session.closeProject).not.toHaveBeenCalled();
  });

  it('detach-close delegates CLOSED production push to the session', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const registry = new BackpackSurfaceRegistry();
    registry.register(7, 'bp-a', WORKSPACE_SURFACE_KIND);
    const session = fakeSession();
    registerWindowDetachIpc({
      ipcMain,
      registry,
      session,
      windowIdForWorkspaceSender: () => 1,
      isWorkspaceSender: (sender, projectId) => sender.id === 7 && projectId === 'bp-a',
       resolveEntryUrl: vi.fn(() => ENTRY),
    });
    const { result, send } = await invoke('papers:backpack:detach-close', 7, { projectId: 'bp-a' });
    expect(await result).toEqual({ ok: true });
    expect(session.closeProject).toHaveBeenCalledWith('bp-a');
    expect(send).not.toHaveBeenCalled();
  });
});
