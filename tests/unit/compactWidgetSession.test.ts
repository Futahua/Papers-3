import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import { createCompactWidgetSession, type CompactWidgetWindow } from '../../src/main/windows/compactWidgetSession';

class FakeWindow {
  static nextId = 8000;
  readonly webContents = { id: ++FakeWindow.nextId, send: vi.fn(), on: vi.fn() };
  readonly closedHandlers: Array<() => void> = [];
  readonly focusHandlers: Array<() => void> = [];
  destroyed = false;
  bounds = { x: 0, y: 0, width: 420, height: 180 };
  visible = true;
  loadedUrls: string[] = [];
  setBounds = vi.fn((bounds) => { this.bounds = { ...bounds }; });
  getBounds = vi.fn(() => ({ ...this.bounds }));
  setContentSize = vi.fn((width: number, height: number) => { this.bounds = { ...this.bounds, width, height }; });
  focus = vi.fn();
  minimized = false;
  isMinimized = vi.fn(() => this.minimized);
  restore = vi.fn(() => { this.minimized = false; this.visible = true; });
  minimize = vi.fn(() => { this.minimized = true; this.visible = false; });
  isVisible = vi.fn(() => this.visible);
  show = vi.fn(() => { this.visible = true; });
  moveTop = vi.fn();
  isFocused = vi.fn(() => true);
  getNativeWindowHandle = vi.fn(() => Buffer.alloc(8));
  isDestroyed = vi.fn(() => this.destroyed);
  destroy = vi.fn(() => {
    this.destroyed = true;
    for (const handler of [...this.closedHandlers]) handler();
  });
  on(event: 'closed' | 'focus', handler: () => void): void {
    if (event === 'closed') this.closedHandlers.push(handler);
    else this.focusHandlers.push(handler);
  }
  loadURL = vi.fn(async (url: string) => { this.loadedUrls.push(url); });
}

function harness(cursor = { x: 537, y: 284 }) {
  const registry = new BackpackSurfaceRegistry();
  registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
  const windows: FakeWindow[] = [];
  const listeners = new Map<string, (event: { sender: { id: number } }, payload?: unknown) => void>();
  const screenListeners = new Map<string, () => void>();
  const screen = {
    getAllDisplays: () => [{ x: 0, y: 0, width: 1200, height: 800 }],
    getPrimaryDisplay: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    getCursorScreenPoint: () => ({ ...cursor }),
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
    activateWindow: async (window) => {
      if (window.isMinimized()) window.restore();
      if (!window.isVisible()) window.show();
      window.focus();
      window.moveTop();
      return true;
    },
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
    expect(h.session.liveProjectOwners()).toEqual([{ projectId: 'bp-a', owningWindowId: 1 }]);
    expect(h.session.entryUrlForOwner('bp-a', 1)).toBe('papers-backpack://bp-a/_papers-open/a/public/index.html');
    expect(h.session.entryUrlForOwner('bp-a', 2)).toBeNull();
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
    expect(h.session.liveProjectOwners()).toEqual([]);
    expect(h.session.entryUrlForOwner('bp-a', 1)).toBeNull();
  });

  it('019F: widgetUrl requires the exact project host (wrong-host and wrong-scheme rejected)', async () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    const windows: FakeWindow[] = [];
    const screen = { getAllDisplays: () => [{ x: 0, y: 0, width: 1200, height: 800 }], getPrimaryDisplay: () => ({ x: 0, y: 0, width: 1200, height: 800 }), getCursorScreenPoint: () => ({ x: 537, y: 284 }), on: vi.fn(), removeListener: vi.fn() };
    const ipcMain = { on: vi.fn(), removeListener: vi.fn() };
    const session = createCompactWidgetSession({
      registry,
      screen,
      ipcMain,
      preloadPath: 'backpack.cjs',
      resolveEntryUrl: () => 'papers-backpack://bp-other/_papers-open/a/public/index.html',
      activateWindow: async () => false,
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
      activateWindow: async () => false,
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

  it('moves the most recently focused widget to the exact pointer and activates it when minimized', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    const target = h.windows[0]!;
    target.focusHandlers[0]!();
    target.minimized = true;
    target.visible = false;

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(target.setBounds).toHaveBeenLastCalledWith({ x: 327, y: 115, width: 420, height: 180 });
    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.show).not.toHaveBeenCalled();
    expect(target.restore.mock.invocationCallOrder[0]).toBeLessThan(target.setBounds.mock.invocationCallOrder[0]!);
    expect(target.isVisible()).toBe(true);
    expect(target.focus).toHaveBeenCalled();
    expect(target.moveTop).toHaveBeenCalledOnce();
    expect(h.windows[1]!.restore).not.toHaveBeenCalled();
    h.session.stopFollowing();
  });

  it('keeps the bottom control-strip center under the pointer while Alt+Q is held', async () => {
    vi.useFakeTimers();
    try {
      const cursor = { x: 537, y: 284 };
      const h = harness(cursor);
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      const target = h.windows[0]!;
      expect(await h.session.bringLatestToCursor()).toBe(true);
      expect(target.setBounds).toHaveBeenLastCalledWith({ x: 327, y: 115, width: 420, height: 180 });

      cursor.x = 800;
      cursor.y = 500;
      await vi.advanceTimersByTimeAsync(16);
      expect(target.setBounds).toHaveBeenLastCalledWith({ x: 590, y: 331, width: 420, height: 180 });

      h.session.stopFollowing();
      const callsAtRelease = target.setBounds.mock.calls.length;
      cursor.x = 900;
      cursor.y = 600;
      await vi.advanceTimersByTimeAsync(64);
      expect(target.setBounds).toHaveBeenCalledTimes(callsAtRelease);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a pill-docked widget alive and restores it at the pointer with Alt+Q', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    expect(h.session.minimize('bp-a', 'layout-a', 1)).toBe(true);
    expect(target.minimize).toHaveBeenCalledOnce();
    expect(target.isDestroyed()).toBe(false);

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.isVisible()).toBe(true);
    expect(target.setBounds).toHaveBeenLastCalledWith({ x: 327, y: 115, width: 420, height: 180 });
    h.session.stopFollowing();
  });

  it('Alt+Q restores the widget that was explicitly pill-docked, not another recently focused widget', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    const pillDocked = h.windows[0]!;
    const otherWidget = h.windows[1]!;

    expect(h.session.minimize('bp-a', 'layout-a', 1)).toBe(true);
    expect(await h.session.bringLatestToCursor()).toBe(true);

    expect(pillDocked.restore).toHaveBeenCalledOnce();
    expect(otherWidget.restore).not.toHaveBeenCalled();
    expect(pillDocked.isVisible()).toBe(true);
    h.session.stopFollowing();
  });

  it('reopening a pill restores and focuses the existing native widget instead of duplicating it', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    expect(h.session.minimize('bp-a', 'layout-a', 1)).toBe(true);
    await expect(h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 }))
      .resolves.toEqual({ ok: true, reused: true });
    expect(h.windows).toHaveLength(1);
    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.isVisible()).toBe(true);
    expect(target.focus).toHaveBeenCalled();
  });

  it('keeps the cursor at the bottom control-strip center at screen edges rather than clamping', async () => {
    const h = harness({ x: 2, y: 4 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(h.windows[0]!.setBounds).toHaveBeenLastCalledWith({ x: -208, y: -165, width: 420, height: 180 });
    h.session.stopFollowing();
  });

  it('keeps the cursor at the strip center beyond the right and bottom display edges', async () => {
    const h = harness({ x: 1198, y: 798 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(h.windows[0]!.setBounds).toHaveBeenLastCalledWith({ x: 988, y: 629, width: 420, height: 180 });
    h.session.stopFollowing();
  });

  it('reports a refused activation instead of claiming Alt+Q succeeded', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    // Simulate Windows refusing foreground activation.
    const session = createCompactWidgetSession({
      registry: h.registry,
      screen: {
        getAllDisplays: () => [{ x: 0, y: 0, width: 1200, height: 800 }],
        getPrimaryDisplay: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
        getCursorScreenPoint: () => ({ x: 537, y: 284 }),
        on: vi.fn(), removeListener: vi.fn(),
      },
      ipcMain: { on: vi.fn(), removeListener: vi.fn() },
      preloadPath: 'backpack.cjs',
      resolveEntryUrl: () => 'papers-backpack://bp-a/_papers-open/a/public/index.html',
      createWindow: () => h.windows[0]!,
      activateWindow: async () => false,
    });
    await session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    expect(await session.bringLatestToCursor()).toBe(false);
    session.stopFollowing();
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
