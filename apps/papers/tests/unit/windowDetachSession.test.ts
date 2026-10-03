import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import {
  createWindowDetachSession,
  isAllowedDetachedNavigation,
  type DetachWindow,
  type WindowDetachSession,
} from '../../src/main/windows/windowDetachSession';
import type { WindowBounds } from '../../src/main/windowBounds';

class FakeDetachWindow {
  static counter = 5000;
  readonly webContents: { id: number; send: ReturnType<typeof vi.fn>; on: (event: string, callback: () => void) => void } = {
    id: (FakeDetachWindow.counter += 1),
    send: vi.fn(),
    on: (_event, callback) => { this.crashHandlers.push(callback); },
  };
  bounds: WindowBounds;
  destroyed = false;
  closedHandlers: Array<() => void> = [];
  crashHandlers: Array<() => void> = [];
  loadedUrls: string[] = [];
  setBoundsCalls: WindowBounds[] = [];
  deferLoad = false;
  loadResolve: (() => void) | null = null;

  constructor(options: { bounds: WindowBounds; preloadPath: string }) {
    this.bounds = { ...options.bounds };
  }

  setBounds(bounds: WindowBounds): void {
    this.bounds = { ...bounds };
    this.setBoundsCalls.push({ ...bounds });
  }
  getBounds(): WindowBounds { return { ...this.bounds }; }
  focus(): void { /* no-op */ }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void {
    this.destroyed = true;
    for (const callback of [...this.closedHandlers]) callback();
  }
  emitRendererCrash(): void {
    for (const callback of [...this.crashHandlers]) callback();
  }
  on(event: 'closed', callback: () => void): void {
    if (event === 'closed') this.closedHandlers.push(callback);
  }
  loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
    if (!this.deferLoad) return Promise.resolve();
    return new Promise((resolve) => { this.loadResolve = resolve; });
  }
  resolveLoad(): void {
    this.loadResolve?.();
    this.loadResolve = null;
  }
}

interface Harness {
  registry: BackpackSurfaceRegistry;
  session: WindowDetachSession;
  screen: {
    getAllDisplays: () => Array<{ x: number; y: number; width: number; height: number }>;
    getPrimaryDisplay: () => { x: number; y: number; width: number; height: number };
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    emit: (event: string) => void;
    displays: Array<{ x: number; y: number; width: number; height: number }>;
  };
  ipcMain: {
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    emit: (channel: string, senderId: number, payload?: unknown) => void;
  };
  windows: FakeDetachWindow[];
  closed: string[];
}

function makeHarness(options: {
  sendToWorkspace?: (projectId: string, owningWindowId: number, channel: string, payload: unknown) => boolean;
  deferLoad?: boolean;
  crashOnTokenSend?: boolean;
} = {}): Harness {
  const registry = new BackpackSurfaceRegistry();
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const screenListeners = new Map<string, Array<() => void>>();
  const ipcListeners = new Map<string, Array<(event: { sender: { id: number } }, payload?: unknown) => void>>();
  const windows: FakeDetachWindow[] = [];
  const closed: string[] = [];
  const screen = {
    getAllDisplays: () => displays.map((d) => ({ ...d })),
    getPrimaryDisplay: () => ({ ...displays[0]! }),
    on: vi.fn((event: string, callback: () => void) => {
      screenListeners.set(event, [...(screenListeners.get(event) ?? []), callback]);
    }),
    removeListener: vi.fn((event: string, callback: () => void) => {
      screenListeners.set(event, (screenListeners.get(event) ?? []).filter((cb) => cb !== callback));
    }),
    emit: (event: string) => {
      for (const callback of [...(screenListeners.get(event) ?? [])]) callback();
    },
    displays,
  };
  const ipcMain = {
    on: vi.fn((channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void) => {
      ipcListeners.set(channel, [...(ipcListeners.get(channel) ?? []), handler]);
    }),
    removeListener: vi.fn((channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void) => {
      ipcListeners.set(channel, (ipcListeners.get(channel) ?? []).filter((cb) => cb !== handler));
    }),
    emit: (channel: string, senderId: number, payload?: unknown) => {
      for (const handler of ipcListeners.get(channel) ?? []) handler({ sender: { id: senderId } }, payload);
    },
  };
  const session = createWindowDetachSession({
    registry,
    screen: screen as unknown as Parameters<typeof createWindowDetachSession>[0]['screen'],
    ipcMain: ipcMain as unknown as Parameters<typeof createWindowDetachSession>[0]['ipcMain'],
    preloadPath: 'detached.cjs',
    createWindow: (windowOptions) => {
      const window = new FakeDetachWindow(windowOptions);
      window.deferLoad = options.deferLoad ?? false;
      if (options.crashOnTokenSend) {
        window.webContents.send.mockImplementation((channel: string) => {
          if (channel === 'papers:backpack:detach-token') window.emitRendererCrash();
        });
      }
      windows.push(window);
      return window as unknown as DetachWindow;
    },
    onSurfaceClosed: (projectId) => { closed.push(projectId); },
    sendToWorkspace: options.sendToWorkspace,
  });
  session.registerDetachIpc();
  return {
    registry,
    session,
    screen,
    ipcMain,
    windows,
    closed,
  };
}

function tokenOf(window: FakeDetachWindow): string {
  const tokenSend = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token');
  const payload = tokenSend?.[1] as { token?: unknown } | undefined;
  const token = payload?.token;
  if (typeof token !== 'string') throw new Error('no token was sent to the detached window');
  return token;
}

function sendChannels(window: FakeDetachWindow): string[] {
  return window.webContents.send.mock.calls.map(([channel]) => channel);
}

describe('window detach session', () => {
  it('018X1R: detached navigation requires the exact Papers scheme and project host', () => {
    expect(isAllowedDetachedNavigation('papers-backpack://bp-a/public/index.html', 'bp-a')).toBe(true);
    expect(isAllowedDetachedNavigation('https://bp-a/public/index.html', 'bp-a')).toBe(false);
    expect(isAllowedDetachedNavigation('papers-backpack://bp-b/public/index.html', 'bp-a')).toBe(false);
  });

  it('opens one window per project and rejects a second open for the same project', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const session = h.session;
    const opened = await session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    expect(opened).toEqual({ ok: true });
    expect(h.windows.length).toBe(1);
    const again = await session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    expect(again.ok).toBe(false);
    expect(h.windows.length).toBe(1);
  });

  it('requires the project to have a registered workspace surface', async () => {
    const h = makeHarness();
    const opened = await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    expect(opened).toEqual({ ok: false, error: 'project is not registered for detach' });
    expect(h.windows.length).toBe(0);
  });

  it('rejects entry URLs that are not the bound project surface', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    expect(await h.session.open({ projectId: 'bp-a', entryUrl: 'https://evil.example/x', owningWindowId: 1 }))
      .toEqual({ ok: false, error: 'detached entry url is not a bound project surface' });
    expect(await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-other/ns/u/public/index.html', owningWindowId: 1 }))
      .toEqual({ ok: false, error: 'detached entry url is not a bound project surface' });
    expect(h.windows.length).toBe(0);
  });

  it('appends the single enumerated detached mode, never renderer input', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    expect(h.windows[0]!.loadedUrls).toEqual([
      'papers-backpack://bp-a/ns/u/public/index.html?detach=1',
    ]);
  });

  it('registers the detached window as a detached surface of the same project', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const surface = h.registry.surface(h.windows[0]!.webContents.id);
    expect(surface?.projectId).toBe('bp-a');
    expect(surface?.kind).toBe('detached');
  });

  it('ready -> activate ordering: no activate before ready, one activate after', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    expect(sendChannels(window)).not.toContain('papers:backpack:detach-activate');
    const token = tokenOf(window);
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, { token });
    expect(sendChannels(window)).toContain('papers:backpack:detach-activate');
    expect(sendChannels(window).filter((c) => c === 'papers:backpack:detach-activate')).toHaveLength(1);
  });

  it('018H3: detached ready waits for workspace stop acknowledgement before activation', async () => {
    const stopRequests: unknown[] = [];
    const h = makeHarness({
      sendToWorkspace: (_projectId, _owningWindowId, channel, payload) => {
        stopRequests.push([channel, payload]);
        return true;
      },
    });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const window = h.windows[0]!;
    const tokenSend = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token');
    const payload = tokenSend?.[1] as { token: string; transferId: string };
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
    expect(sendChannels(window)).not.toContain('papers:backpack:detach-activate');
    expect(stopRequests[0]).toEqual(['papers:backpack:detach-stop-request', { transferId: payload.transferId }]);
    h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
    h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
    await expect(openPromise).resolves.toEqual({ ok: true });
    expect(stopRequests).toHaveLength(1);
    expect(sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate')).toHaveLength(1);
    expect(h.session.focus('bp-a')).toBe(true);
  });

  it('018V4: resends lost activation until the exact receipt resolves open', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ sendToWorkspace: () => true });
      h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
      const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      await Promise.resolve();
      await Promise.resolve();
      const window = h.windows[0]!;
      const payload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
      h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
      h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
      expect(sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate')).toHaveLength(2);
      h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
      await expect(openPromise).resolves.toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(500);
      expect(sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('018V4: missing activation receipt uses the existing timeout and cleans up', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ sendToWorkspace: () => true });
      h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
      const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      await Promise.resolve();
      await Promise.resolve();
      const window = h.windows[0]!;
      const payload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
      h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
      h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
      await vi.advanceTimersByTimeAsync(1500);
      await expect(openPromise).resolves.toEqual({ ok: false, error: 'workspace ownership transfer timed out' });
      expect(window.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('018V4: rejects spoofed or malformed activation receipts and accepts duplicates idempotently', async () => {
    const h = makeHarness({ sendToWorkspace: () => true });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const window = h.windows[0]!;
    const payload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
    h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
    h.ipcMain.emit('papers:backpack:detach-activated', 99999, payload);
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, { token: 'wrong', transferId: payload.transferId });
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, { token: payload.token, transferId: 'wrong' });
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, { ...payload, extra: true });
    expect(sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate')).toHaveLength(1);
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
    await expect(openPromise).resolves.toEqual({ ok: true });
  });

  it('018V5: deferred-load crash settles open and leaves no activation timer', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ sendToWorkspace: () => false, deferLoad: true });
      h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
      const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      const window = h.windows[0]!;
      window.emitRendererCrash();
      window.resolveLoad();
      await expect(openPromise).resolves.toEqual({ ok: false, error: 'detached surface closed before activation (crash)' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('018V5: token-send crash settles open and leaves no activation timer', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ sendToWorkspace: () => false, crashOnTokenSend: true });
      h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
      const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      await Promise.resolve();
      await Promise.resolve();
      await expect(openPromise).resolves.toEqual({ ok: false, error: 'detached surface closed before activation (crash)' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('018X1: session emits exactly one canonical CLOSED after reattach and resume', async () => {
    const workspaceMessages: unknown[] = [];
    const h = makeHarness({
      sendToWorkspace: (_projectId, _owningWindowId, channel, payload) => {
        workspaceMessages.push({ channel, payload });
        return true;
      },
    });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const window = h.windows[0]!;
    const tokenPayload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, tokenPayload);
    h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: tokenPayload.transferId });
    h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, tokenPayload);
    await openPromise;

    const stopPromise = h.session.reattach('bp-a');
    h.ipcMain.emit('papers:backpack:detach-flush-ack', window.webContents.id, tokenPayload);
    h.ipcMain.emit('papers:backpack:detach-resumed', 1, { transferId: tokenPayload.transferId });
    await stopPromise;
    const closed = workspaceMessages.filter((message) => (message as { channel: string }).channel === 'papers:backpack:detach-closed');
    expect(closed).toEqual([{
      channel: 'papers:backpack:detach-closed',
      payload: { transferId: tokenPayload.transferId, reason: 'reattach' },
    }]);
  });

  it('018X1R: crash before ACTIVATE settles open immediately and pushes recovery', async () => {
    const workspaceMessages: unknown[] = [];
    const h = makeHarness({
      sendToWorkspace: (_projectId, _owningWindowId, channel, payload) => {
        workspaceMessages.push({ channel, payload });
        return true;
      },
    });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const openPromise = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const window = h.windows[0]!;
    const tokenPayload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, tokenPayload);
    window.emitRendererCrash();
    const result = await Promise.race([
      openPromise,
      new Promise<{ ok: false; error: string }>((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 100)),
    ]);
    expect(result.ok).toBe(false);
    expect(workspaceMessages).toContainEqual({
      channel: 'papers:backpack:detach-closed',
      payload: { transferId: tokenPayload.transferId, reason: 'crash' },
    });
  });

  it('018X2: overlapping resume cycles keep the newer pending timer authoritative', async () => {
    const h = makeHarness({ sendToWorkspace: () => true });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const openCycle = async () => {
      const opening = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      const window = h.windows.at(-1)!;
      const payload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
      h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
      h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
      h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
      await opening;
      return { window, payload };
    };
    const first = await openCycle();
    const firstStop = h.session.reattach('bp-a');
    h.ipcMain.emit('papers:backpack:detach-flush-ack', first.window.webContents.id, first.payload);
    const second = await openCycle();
    const secondStop = h.session.reattach('bp-a');
    h.ipcMain.emit('papers:backpack:detach-flush-ack', second.window.webContents.id, second.payload);
    await firstStop;
    let secondSettled = false;
    void secondStop.then(() => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondSettled).toBe(false);
    h.ipcMain.emit('papers:backpack:detach-resumed', 1, { transferId: second.payload.transferId });
    await secondStop;
  });

  it('018V1: two consecutive detach cycles each deliver one activation', async () => {
    const workspaceMessages: unknown[] = [];
    const h = makeHarness({
      sendToWorkspace: (_projectId, _owningWindowId, channel, payload) => {
        workspaceMessages.push({ channel, payload });
        return true;
      },
    });
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const cycle = async () => {
      const opening = h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/1/public/index.html', owningWindowId: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      const window = h.windows.at(-1)!;
      const payload = window.webContents.send.mock.calls.find(([channel]) => channel === 'papers:backpack:detach-token')?.[1] as { token: string; transferId: string };
      h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, payload);
      h.ipcMain.emit('papers:backpack:detach-stop-ack', 1, { transferId: payload.transferId });
      h.ipcMain.emit('papers:backpack:detach-activated', window.webContents.id, payload);
      await opening;
      const activationCount = sendChannels(window).filter((channel) => channel === 'papers:backpack:detach-activate').length;
      const stop = h.session.reattach('bp-a');
      h.ipcMain.emit('papers:backpack:detach-flush-ack', window.webContents.id, payload);
      h.ipcMain.emit('papers:backpack:detach-resumed', 1, { transferId: payload.transferId });
      await stop;
      return { transferId: payload.transferId, activationCount };
    };
    const first = await cycle();
    const second = await cycle();
    expect(first.activationCount).toBe(1);
    expect(second.activationCount).toBe(1);
    expect(second.transferId).not.toBe(first.transferId);
    expect(workspaceMessages.filter((message) => (message as { channel: string }).channel === 'papers:backpack:detach-stop-request')).toHaveLength(2);
  });

  it('rejects spoofed or wrong-token ready messages', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = tokenOf(window);
    // Unregistered sender.
    h.ipcMain.emit('papers:backpack:detach-ready', 99999, { token });
    // Wrong token from the real detached sender.
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, { token: 'ds-nope' });
    // Malformed payload (exact-key rejection).
    h.ipcMain.emit('papers:backpack:detach-ready', window.webContents.id, { token, extra: 1 });
    expect(sendChannels(window)).not.toContain('papers:backpack:detach-activate');
  });

  it('flush/stop before close: flush-request, ack, then destroy and unregister', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = tokenOf(window);
    const stopPromise = h.session.reattach('bp-a');
    expect(sendChannels(window)).toContain('papers:backpack:detach-flush-request');
    expect(window.destroyed).toBe(false);
    // No flush-ack yet: still open and registered.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(window.destroyed).toBe(false);
    h.ipcMain.emit('papers:backpack:detach-flush-ack', window.webContents.id, { token });
    await stopPromise;
    expect(window.destroyed).toBe(true);
    expect(h.registry.size).toBe(1);
    expect(h.registry.surface(1)?.kind).toBe(WORKSPACE_SURFACE_KIND);
    expect(h.closed).toEqual(['bp-a']);
  });

  it('flush timeout destroys the window after the bounded wait', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    const stopPromise = h.session.closeProject('bp-a');
    expect(window.destroyed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await stopPromise;
    expect(window.destroyed).toBe(true);
    expect(h.registry.size).toBe(1);
  });

  it('owner-scoped close leaves the same project detached for another window alone', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 2 });
    const window = h.windows[0]!;

    await h.session.closeProjectForOwner('bp-a', 1);

    expect(window.destroyed).toBe(false);
    expect(h.session.isOpen('bp-a')).toBe(true);
  });

  it('reattach and closeProject share the flush/stop path', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = tokenOf(window);
    await h.session.reattach('bp-a');
    expect(sendChannels(window)).toContain('papers:backpack:detach-flush-request');
    h.ipcMain.emit('papers:backpack:detach-flush-ack', window.webContents.id, { token });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(window.destroyed).toBe(true);
  });

  it('crash idempotence: a closed window unregisters; a later close is a no-op', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    window.destroy(); // renderer crash closes the window
    expect(h.registry.size).toBe(1);
    expect(h.closed).toEqual(['bp-a']);
    await h.session.closeProject('bp-a');
    await h.session.reattach('bp-a');
    expect(window.destroyed).toBe(true);
    expect(h.registry.size).toBe(1);
  });

  it('018H3: render-process-gone converges on the same cleanup path', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    window.emitRendererCrash();
    expect(h.session.isOpen('bp-a')).toBe(false);
    expect(h.registry.surface(window.webContents.id)).toBeNull();
    expect(h.registry.surface(1)?.kind).toBe(WORKSPACE_SURFACE_KIND);
  });

  it('malformed bounds are rejected without creating a window', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const opened = await h.session.open({
      projectId: 'bp-a',
      entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html',
      owningWindowId: 1,
      bounds: { x: 0, y: 0, width: 0, height: 200 },
    });
    expect(opened.ok).toBe(false);
    expect(h.windows.length).toBe(0);
  });

  it('clamps restored bounds onto a visible display', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({
      projectId: 'bp-a',
      entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html',
      owningWindowId: 1,
      bounds: { x: 9000, y: 9000, width: 800, height: 600 },
    });
    const created = h.windows[0]!.bounds;
    expect(created.x).toBeGreaterThanOrEqual(0);
    expect(created.y).toBeGreaterThanOrEqual(0);
    expect(created.x + created.width).toBeLessThanOrEqual(1920);
    expect(created.y + created.height).toBeLessThanOrEqual(1080);
  });

  it('re-clamps a live detached window on display removal without touching others', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    const window = h.windows[0]!;
    const before = window.getBounds();
    // The old display disappears; only a far-right display remains.
    h.screen.displays.length = 0;
    h.screen.displays.push({ x: 4000, y: 0, width: 1920, height: 1080 });
    h.screen.emit('display-removed');
    const after = window.getBounds();
    expect(after.x + after.width).toBeLessThanOrEqual(4000 + 1920);
    expect(after.x).toBeGreaterThanOrEqual(4000);
    expect(before.x).not.toBe(after.x);
    expect(window.setBoundsCalls.length).toBeGreaterThan(0);
  });

  it('closeAll stops every window and clears registry and display listeners', async () => {
    const h = makeHarness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    h.registry.register(2, 'bp-b', WORKSPACE_SURFACE_KIND);
    await h.session.open({ projectId: 'bp-a', entryUrl: 'papers-backpack://bp-a/ns/u/public/index.html', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-b', entryUrl: 'papers-backpack://bp-b/ns/u/public/index.html', owningWindowId: 1 });
    expect(h.windows.length).toBe(2);
    await h.session.closeAll();
    expect(h.windows.every((w) => w.destroyed)).toBe(true);
    expect(h.registry.size).toBe(0);
    expect(h.screen.removeListener).toHaveBeenCalled();
  });
});
