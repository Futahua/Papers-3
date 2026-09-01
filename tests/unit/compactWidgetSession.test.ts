import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import { createCompactWidgetSession, type CompactWidgetWindow } from '../../src/main/windows/compactWidgetSession';

class FakeWindow {
  static nextId = 8000;
  readonly webContents = { id: ++FakeWindow.nextId, send: vi.fn(), on: vi.fn() };
  readonly closedHandlers: Array<() => void> = [];
  destroyed = false;
  bounds = { x: 0, y: 0, width: 420, height: 180 };
  loadedUrls: string[] = [];
  setBounds = vi.fn((bounds) => { this.bounds = { ...bounds }; });
  getBounds = vi.fn(() => ({ ...this.bounds }));
  setContentSize = vi.fn((width: number, height: number) => { this.bounds = { ...this.bounds, width, height }; });
  focus = vi.fn();
  isDestroyed = vi.fn(() => this.destroyed);
  destroy = vi.fn(() => {
    this.destroyed = true;
    for (const handler of [...this.closedHandlers]) handler();
  });
  on(event: 'closed', handler: () => void): void {
    if (event === 'closed') this.closedHandlers.push(handler);
  }
  loadURL = vi.fn(async (url: string) => { this.loadedUrls.push(url); });
}

function harness() {
  const registry = new BackpackSurfaceRegistry();
  registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
  const windows: FakeWindow[] = [];
  const listeners = new Map<string, (event: { sender: { id: number } }, payload?: unknown) => void>();
  const screenListeners = new Map<string, () => void>();
  const screen = {
    getAllDisplays: () => [{ x: 0, y: 0, width: 1200, height: 800 }],
    getPrimaryDisplay: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    on: vi.fn((event: string, handler: () => void) => { screenListeners.set(event, handler); }),
    removeListener: vi.fn(),
  };
  const ipcMain = {
    on: vi.fn((channel: string, handler: (event: { sender: { id: number } }, payload?: unknown) => void) => listeners.set(channel, handler)),
    removeListener: vi.fn(),
  };
  const session = createCompactWidgetSession({
    registry,
    screen,
    ipcMain,
    preloadPath: 'backpack.cjs',
    resolveEntryUrl: () => 'papers-backpack://bp-a/_papers-open/a/public/index.html',
    createWindow: (options) => {
      const window = new FakeWindow();
      windows.push(window);
      return window as unknown as CompactWidgetWindow;
    },
  });
  return { registry, session, windows, listeners, screenListeners };
}

describe('compact widget session', () => {
  it('opens one authenticated widget per layout, reuses duplicates, and never sends 018 transfer traffic', async () => {
    const h = harness();
    const first = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const duplicate = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const second = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    expect(first).toEqual({ ok: true, reused: false });
    expect(duplicate).toEqual({ ok: true, reused: true });
    expect(second).toEqual({ ok: true, reused: false });
    expect(h.windows).toHaveLength(2);
    expect(h.windows[0]!.loadedUrls[0]).toContain('papers-surface=compact-widget');
    expect(h.windows[0]!.loadedUrls[0]).toContain('papers-layout-key=layout-a');
    expect(h.windows[0]!.webContents.send).toHaveBeenCalledWith('papers:backpack:widget-token', expect.objectContaining({ token: expect.any(String) }));
    expect(h.windows[0]!.webContents.send.mock.calls.map(([channel]) => channel)).not.toContain('papers:backpack:detach-stop-request');
    expect(h.registry.surfaceForWidget('bp-a', 'layout-a')).not.toBeNull();
    expect(h.registry.surfaceForWidget('bp-a', 'layout-b')).not.toBeNull();
  });

  it('accepts only the live widget token, rejects stale tokens, and cleans up close/crash/repeat', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    expect(h.session.ready(9999, { token })).toBe(false);
    expect(h.session.ready(window.webContents.id, { token: 'stale' })).toBe(false);
    expect(h.session.ready(window.webContents.id, { token })).toBe(true);
    expect(h.session.focus('bp-a', 'layout-a', 1)).toBe(true);
    await h.session.closeFromSender(window.webContents.id, token);
    expect(h.registry.surface(window.webContents.id)).toBeNull();
    expect(h.session.focus('bp-a', 'layout-a', 1)).toBe(false);

    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const replacement = h.windows[1]!;
    replacement.destroy();
    expect(h.registry.surface(replacement.webContents.id)).toBeNull();
    await h.session.closeAll();
    expect(h.registry.surfaceForWidget('bp-a', 'layout-a')).toBeNull();
  });

  it('019F: widgetUrl requires the exact project host (wrong-host and wrong-scheme rejected)', async () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const windows: FakeWindow[] = [];
    const screen = { getAllDisplays: () => [{ x: 0, y: 0, width: 1200, height: 800 }], getPrimaryDisplay: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on: vi.fn(), removeListener: vi.fn() };
    const ipcMain = { on: vi.fn(), removeListener: vi.fn() };
    const session = createCompactWidgetSession({
      registry,
      screen,
      ipcMain,
      preloadPath: 'backpack.cjs',
      resolveEntryUrl: () => 'papers-backpack://bp-other/_papers-open/a/public/index.html',
      createWindow: (options) => {
        const window = new FakeWindow();
        windows.push(window);
        return window as unknown as CompactWidgetWindow;
      },
    });
    const wrongHost = await session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    expect(wrongHost).toEqual({ ok: false, error: 'widget entry is not a bound project surface' });
    expect(windows).toHaveLength(0);
    const badScheme = await createCompactWidgetSession({
      registry,
      screen,
      ipcMain,
      preloadPath: 'backpack.cjs',
      resolveEntryUrl: () => 'https://evil.example/',
      createWindow: (options) => new FakeWindow() as unknown as CompactWidgetWindow,
    }).open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    expect(badScheme).toEqual({ ok: false, error: 'widget entry is not a bound project surface' });
  });

  it('035: resizeFromSender applies the reported window content size verbatim (no +tolerance), token-gated', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    // A non-widget sender or a stale token is rejected.
    expect(() => h.session.resizeFromSender(1, token, 300, 160)).toThrow('denied');
    expect(() => h.session.resizeFromSender(window.webContents.id, 'stale', 300, 160)).toThrow('denied');
    // 035: the user owns the size. The reported window content size is applied
    // EXACTLY (no +tolerance), so a fill-width card can never creep.
    h.session.resizeFromSender(window.webContents.id, token, 151, 82);
    expect(window.setContentSize).toHaveBeenCalledWith(151, 82);
    // Oversize reports clamp to the bounded ceiling; a tiny card stays at the
    // small usability floor, never a large fixed minimum.
    h.session.resizeFromSender(window.webContents.id, token, 4000, 2);
    expect(window.setContentSize).toHaveBeenLastCalledWith(2000, 40);
    h.session.resizeFromSender(window.webContents.id, token, 10, 10);
    expect(window.setContentSize).toHaveBeenLastCalledWith(64, 40);
    // Non-finite sizes are ignored (no resize).
    const callsBefore = window.setContentSize.mock.calls.length;
    h.session.resizeFromSender(window.webContents.id, token, Number.NaN, 200);
    expect(window.setContentSize.mock.calls).toHaveLength(callsBefore);
  });

  it('moves a widget through the token-gated blank-surface drag channel', async () => {
    const h = harness();
    h.session.registerIpc();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    const drag = h.listeners.get('papers:backpack:widget-drag')!;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'begin', x: 100, y: 90 });
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 150, y: 130 });
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 50, y: 40, width: 420, height: 180 });
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'end', x: 150, y: 130 });
    const calls = window.setBounds.mock.calls.length;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 180, y: 160 });
    expect(window.setBounds.mock.calls).toHaveLength(calls);
  });
});

describe('compact widget ownership by Papers window', () => {
  it('gives two windows their own widget for the same layout, rather than sharing one', async () => {
    const h = harness();

    const fromA = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const fromB = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 2 });

    // Keyed by (projectId, layoutKey) alone these would collide, and the
    // second window would silently get the first window's widget -- which
    // neither could then be said to own.
    expect(fromA).toEqual({ ok: true, reused: false });
    expect(fromB).toEqual({ ok: true, reused: false });
    expect(h.windows).toHaveLength(2);
  });

  it('reuses only within the same window', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const again = await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    expect(again).toEqual({ ok: true, reused: true });
    expect(h.windows).toHaveLength(1);
  });

  it('focus and close reach only the asking window own widget', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 2 });

    expect(h.session.focus('bp-a', 'layout-a', 1)).toBe(true);
    expect(h.session.focus('bp-a', 'layout-a', 99)).toBe(false);

    await h.session.close('bp-a', 'layout-a', 1);
    // Window 2's widget is untouched by window 1 closing its own.
    expect(h.session.focus('bp-a', 'layout-a', 2)).toBe(true);
    expect(h.session.focus('bp-a', 'layout-a', 1)).toBe(false);
  });

  it('destroys every widget of a closing window, and no others', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 2 });

    // Called before the window's surface bindings are released, so no widget
    // outlives its window as an authorized sender with no routing context.
    await h.session.closeOwnedByWindow(1);

    expect(h.session.focus('bp-a', 'layout-a', 1)).toBe(false);
    expect(h.session.focus('bp-a', 'layout-b', 1)).toBe(false);
    expect(h.session.focus('bp-a', 'layout-a', 2)).toBe(true);
  });
});
