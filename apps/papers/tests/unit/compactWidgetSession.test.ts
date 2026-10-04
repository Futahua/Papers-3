import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import { createCompactWidgetSession, type CompactWidgetWindow } from '../../src/main/windows/compactWidgetSession';

class FakeWindow {
  static nextId = 8000;
  readonly webContents = { id: ++FakeWindow.nextId, send: vi.fn(), on: vi.fn() };
  readonly closedHandlers: Array<() => void> = [];
  readonly focusHandlers: Array<() => void> = [];
  readonly willResizeHandlers: Array<() => void> = [];
  destroyed = false;
  bounds = { x: 0, y: 0, width: 420, height: 180 };
  visible = true;
  loadedUrls: string[] = [];
  setBounds = vi.fn((bounds) => { this.bounds = { ...bounds }; });
  setPosition = vi.fn((x: number, y: number) => { this.bounds = { ...this.bounds, x, y }; });
  getBounds = vi.fn(() => ({ ...this.bounds }));
  setContentSize = vi.fn((width: number, height: number) => { this.bounds = { ...this.bounds, width, height }; });
  focus = vi.fn();
  minimized = false;
  isMinimized = vi.fn(() => this.minimized);
  restore = vi.fn(() => { this.minimized = false; this.visible = true; });
  minimize = vi.fn(() => { this.minimized = true; this.visible = false; });
  hide = vi.fn(() => { this.visible = false; });
  isVisible = vi.fn(() => this.visible);
  show = vi.fn(() => { this.visible = true; });
  showInactive = vi.fn(() => { this.visible = true; this.minimized = false; });
  moveTop = vi.fn();
  isFocused = vi.fn(() => true);
  getNativeWindowHandle = vi.fn(() => Buffer.alloc(8));
  isDestroyed = vi.fn(() => this.destroyed);
  destroy = vi.fn(() => {
    this.destroyed = true;
    for (const handler of [...this.closedHandlers]) handler();
  });
  on(event: string, handler: () => void): void {
    if (event === 'closed') this.closedHandlers.push(handler);
    else if (event === 'focus') this.focusHandlers.push(handler);
    else if (event === 'will-resize') this.willResizeHandlers.push(handler);
  }
  loadURL = vi.fn(async (url: string) => { this.loadedUrls.push(url); });
}

function harness(cursor = { x: 537, y: 284 }, nativeMove = false) {
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
  const placeWidgetAtCursorNative = vi.fn(() => true);
  const dragWidgetNative = vi.fn(() => true);
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
    ...(nativeMove ? { placeWidgetAtCursorNative, dragWidgetNative } : {}),
  });
  return { registry, session, windows, listeners, screenListeners, placeWidgetAtCursorNative, dragWidgetNative };
}

describe('compact widget session', () => {
  it('uses the resident native move-only path for Alt+Q follow when available', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ x: 537, y: 284 }, true);
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      const window = h.windows[0]!;
      expect(await h.session.bringLatestToCursor()).toBe(true);
      expect(h.placeWidgetAtCursorNative).toHaveBeenCalledWith(window.webContents.id, 11);
      expect(window.setPosition).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      expect(h.placeWidgetAtCursorNative.mock.calls.length).toBeGreaterThan(1);
      expect(window.setPosition).not.toHaveBeenCalled();
      h.session.stopFollowing();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the resident native move-only path for blank-surface drag when available', async () => {
    const h = harness({ x: 100, y: 90 }, true);
    h.session.registerIpc();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    const drag = h.listeners.get('papers:backpack:widget-drag')!;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'begin', x: 100, y: 90 });
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 140, y: 100 });
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'end', x: 140, y: 100 });
    expect(h.dragWidgetNative.mock.calls).toEqual([
      [window.webContents.id, 'begin'],
      [window.webContents.id, 'move'],
      [window.webContents.id, 'end'],
    ]);
    expect(window.setPosition).not.toHaveBeenCalled();
  });

  it('can ensure a live widget without focusing or activating it', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    window.focus.mockClear();
    await expect(h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false }))
      .resolves.toEqual({ ok: true, reused: true });
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();

    window.minimize();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.focus).not.toHaveBeenCalled();
  });

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
    const cursor = { x: 100, y: 90 };
    const h = harness(cursor);
    h.session.registerIpc();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    const drag = h.listeners.get('papers:backpack:widget-drag')!;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'begin', x: 100, y: 90 });
    cursor.x = 150;
    cursor.y = 130;
    // Renderer screen coordinates can be in a different pixel scale on a
    // mixed-DPI desktop. The main-process Electron cursor is authoritative.
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 300, y: 260 });
    expect(window.setPosition).toHaveBeenLastCalledWith(50, 40);
    expect(window.getBounds()).toEqual({ x: 50, y: 40, width: 420, height: 180 });
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'end', x: 300, y: 260 });
    const calls = window.setPosition.mock.calls.length;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 180, y: 160 });
    expect(window.setPosition.mock.calls).toHaveLength(calls);
  });

  it('ignores renderer size reports while the widget is moving, then accepts them after release', async () => {
    const cursor = { x: 100, y: 90 };
    const h = harness(cursor);
    h.session.registerIpc();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    const token = (window.webContents.send.mock.calls[0]![1] as { token: string }).token;
    const drag = h.listeners.get('papers:backpack:widget-drag')!;

    drag({ sender: { id: window.webContents.id } }, { token, phase: 'begin', x: 100, y: 90 });
    h.session.resizeFromSender(window.webContents.id, token, 900, 500);
    expect(window.setContentSize).not.toHaveBeenCalled();

    cursor.x = 180;
    cursor.y = 120;
    drag({ sender: { id: window.webContents.id } }, { token, phase: 'move', x: 360, y: 240 });
    expect(window.getBounds()).toEqual({ x: 80, y: 30, width: 420, height: 180 });
    h.session.resizeFromSender(window.webContents.id, token, 950, 550);
    expect(window.setContentSize).not.toHaveBeenCalled();

    drag({ sender: { id: window.webContents.id } }, { token, phase: 'end', x: 360, y: 240 });
    h.session.resizeFromSender(window.webContents.id, token, 500, 210);
    expect(window.setContentSize).toHaveBeenCalledOnce();
    expect(window.setContentSize).toHaveBeenLastCalledWith(500, 210);
  });

  it('marks only a real native edge resize as renderer resize authority', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const window = h.windows[0]!;
    window.webContents.send.mockClear();

    expect(window.willResizeHandlers).toHaveLength(1);
    window.willResizeHandlers[0]!();
    expect(window.webContents.send).toHaveBeenCalledWith('papers:backpack:widget-native-resize', {});
  });

  it('Alt+Q starting inside a visible widget hides it once and never follows while held', async () => {
    vi.useFakeTimers();
    try {
      const cursor = { x: 100, y: 50 };
      const h = harness(cursor);
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      const target = h.windows[0]!;
      const initialBounds = target.getBounds();
      let releaseAuthority!: () => void;
      const authority = new Promise<void>((resolve) => { releaseAuthority = resolve; });
      let ensureReachedSession = false;
      // This mirrors the production IPC ordering: widget-open waits for host
      // authority before it calls session.open(..., activate: false).
      const pendingEnsure = authority.then(() => {
        ensureReachedSession = true;
        return h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
      });
      await Promise.resolve();
      expect(ensureReachedSession).toBe(false);

      h.session.beginAltQGesture(target.webContents.id);
      expect(target.hide).toHaveBeenCalledOnce();
      // A startup/writer-takeover ensure already in flight can reach the host
      // after this one-shot input. It reuses the entry but must not show it.
      releaseAuthority();
      await expect(pendingEnsure)
        .resolves.toEqual({ ok: true, reused: true });
      expect(ensureReachedSession).toBe(true);
      expect(target.showInactive).not.toHaveBeenCalled();
      expect(target.isVisible()).toBe(false);

      h.session.beginAltQGesture(target.webContents.id);
      cursor.x = 300;
      cursor.y = 150;
      await vi.advanceTimersByTimeAsync(200);
      expect(target.hide).toHaveBeenCalledOnce();
      expect(target.setBounds).not.toHaveBeenCalled();

      h.session.endAltQGesture();
      h.session.endAltQGesture();
      await vi.advanceTimersByTimeAsync(100);
      expect(target.hide).toHaveBeenCalledOnce();
      expect(target.getBounds()).toEqual(initialBounds);
      expect(target.isVisible()).toBe(false);

      // A deliberate open still restores and focuses the exact existing widget.
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      expect(target.show).toHaveBeenCalledOnce();
      expect(target.focus).toHaveBeenCalled();
      expect(target.isVisible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stale native focus does not release Alt+Q suppression; explicit restore does', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;

    h.session.beginAltQGesture(target.webContents.id);
    expect(target.isVisible()).toBe(false);

    // A delayed focus report must not undo the explicit Alt+Q hide.
    target.focusHandlers[0]!();

    await expect(h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false }))
      .resolves.toEqual({ ok: true, reused: true });
    expect(target.showInactive).not.toHaveBeenCalled();
    expect(target.isVisible()).toBe(false);

    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    expect(target.isVisible()).toBe(true);
    target.minimize();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
    expect(target.showInactive).toHaveBeenCalledOnce();
  });

  it('uses an immediate Alt+Q hide without entering native minimize state', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;

    h.session.beginAltQGesture(target.webContents.id);
    expect(target.hide).toHaveBeenCalledOnce();
    expect(target.minimize).not.toHaveBeenCalled();
    expect(target.isMinimized()).toBe(false);
    expect(target.isVisible()).toBe(false);
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
    expect(target.showInactive).not.toHaveBeenCalled();
  });

  it('alternates inside hide and outside restore through rapid presses without native minimize', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    for (let i = 0; i < 20; i += 1) {
      h.session.beginAltQGesture(target.webContents.id);
      h.session.endAltQGesture();
      expect(target.isVisible()).toBe(false);
      await expect(h.session.beginAltQGesture(null)).resolves.toBe(true);
      h.session.endAltQGesture();
      expect(target.isVisible()).toBe(true);
    }
    expect(target.hide).toHaveBeenCalledTimes(20);
    expect(target.showInactive).toHaveBeenCalledTimes(20);
    expect(target.minimize).not.toHaveBeenCalled();
  });

  it('honors a native inside hit even if Electron state changes before delivery', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    target.minimized = true;
    target.visible = false;

    h.session.beginAltQGesture(target.webContents.id);
    expect(target.restore).not.toHaveBeenCalled();
    expect(target.hide).toHaveBeenCalledOnce();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
    expect(target.showInactive).not.toHaveBeenCalled();
  });

  it('keeps Alt+Q hidden across a focus notification during hide', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    target.hide.mockImplementation(() => {
      for (const handler of target.focusHandlers) handler();
      target.visible = false;
    });

    h.session.beginAltQGesture(target.webContents.id);
    target.focusHandlers[0]!(); // delayed focus from before the hide
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1, activate: false });
    expect(target.isVisible()).toBe(false);
    expect(target.showInactive).not.toHaveBeenCalled();
  });

  it('Alt+Q hides the exact widget under the starting cursor even if another becomes latest', async () => {
    const cursor = { x: 100, y: 50 };
    const h = harness(cursor);
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    const target = h.windows[0]!;
    const other = h.windows[1]!;
    // Both widgets overlap. The native hit test reports the actual topmost
    // HWND, independently of which widget is latest or was created last.

    h.session.beginAltQGesture(target.webContents.id);
    h.session.focus('bp-a', 'layout-b', 1);
    h.session.endAltQGesture();

    expect(target.hide).toHaveBeenCalledOnce();
    expect(other.hide).not.toHaveBeenCalled();
  });

  it('Alt+Q outside widgets keeps bringing the latest widget to the cursor and stops on release', async () => {
    vi.useFakeTimers();
    try {
      const cursor = { x: 1100, y: 700 };
      const h = harness(cursor);
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
      const target = h.windows[1]!;

      await expect(h.session.beginAltQGesture(null)).resolves.toBe(true);
      expect(target.setPosition).toHaveBeenLastCalledWith(890, 531);
      expect(target.focus).not.toHaveBeenCalled();
      expect(target.hide).not.toHaveBeenCalled();
      h.session.endAltQGesture();

      const callsAtRelease = target.setPosition.mock.calls.length;
      cursor.x = 800;
      cursor.y = 500;
      await vi.advanceTimersByTimeAsync(32);
      expect(target.setPosition).toHaveBeenCalledTimes(callsAtRelease);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releasing an inside-widget Alt+Q press does not stop an unrelated follow', async () => {
    vi.useFakeTimers();
    try {
      const cursor = { x: 600, y: 50 };
      const h = harness(cursor);
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
      const inside = h.windows[0]!;
      const followed = h.windows[1]!;
      followed.bounds = { x: 500, y: 0, width: 420, height: 180 };
      expect(await h.session.bringLatestToCursor()).toBe(true);

      cursor.x = 100;
      cursor.y = 50;
      h.session.beginAltQGesture(inside.webContents.id);
      h.session.endAltQGesture();
      const beforeMove = followed.setPosition.mock.calls.length;
      cursor.x = 800;
      cursor.y = 500;
      await vi.advanceTimersByTimeAsync(16);

      expect(inside.hide).toHaveBeenCalledOnce();
      expect(followed.setPosition.mock.calls.length).toBeGreaterThan(beforeMove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the most recently focused widget to the exact pointer and raises it when minimized', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-b', owningWindowId: 1 });
    const target = h.windows[0]!;
    target.focusHandlers[0]!();
    target.minimized = true;
    target.visible = false;

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(target.setPosition).toHaveBeenLastCalledWith(327, 115);
    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.show).not.toHaveBeenCalled();
    expect(target.setPosition.mock.invocationCallOrder[0]).toBeLessThan(target.restore.mock.invocationCallOrder[0]!);
    expect(target.isVisible()).toBe(true);
    expect(target.focus).not.toHaveBeenCalled();
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
      expect(target.setPosition).toHaveBeenLastCalledWith(327, 115);

      cursor.x = 800;
      cursor.y = 500;
      await vi.advanceTimersByTimeAsync(16);
      expect(target.setPosition).toHaveBeenLastCalledWith(590, 331);

      h.session.stopFollowing();
      const callsAtRelease = target.setPosition.mock.calls.length;
      cursor.x = 900;
      cursor.y = 600;
      await vi.advanceTimersByTimeAsync(64);
      expect(target.setPosition).toHaveBeenCalledTimes(callsAtRelease);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores renderer size reports during Alt+Q follow and accepts them after release', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ x: 537, y: 284 });
      await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
      const target = h.windows[0]!;
      const token = (target.webContents.send.mock.calls[0]![1] as { token: string }).token;

      expect(await h.session.bringLatestToCursor()).toBe(true);
      h.session.resizeFromSender(target.webContents.id, token, 900, 500);
      expect(target.setContentSize).not.toHaveBeenCalled();

      h.session.stopFollowing();
      h.session.resizeFromSender(target.webContents.id, token, 500, 210);
      expect(target.setContentSize).toHaveBeenCalledOnce();
      expect(target.setContentSize).toHaveBeenLastCalledWith(500, 210);
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
    expect(target.setPosition).toHaveBeenLastCalledWith(327, 115);
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
    expect(h.windows[0]!.setPosition).toHaveBeenLastCalledWith(-208, -165);
    h.session.stopFollowing();
  });

  it('keeps the cursor at the strip center beyond the right and bottom display edges', async () => {
    const h = harness({ x: 1198, y: 798 });
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });

    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(h.windows[0]!.setPosition).toHaveBeenLastCalledWith(988, 629);
    h.session.stopFollowing();
  });

  it('reveals a hidden widget once without attempting foreground activation', async () => {
    const h = harness();
    await h.session.open({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    const target = h.windows[0]!;
    target.visible = false;
    expect(await h.session.bringLatestToCursor()).toBe(true);
    expect(target.showInactive).toHaveBeenCalledOnce();
    expect(target.focus).not.toHaveBeenCalled();
    expect(target.moveTop).toHaveBeenCalledOnce();
    expect(target.setPosition.mock.invocationCallOrder[0]).toBeLessThan(target.showInactive.mock.invocationCallOrder[0]!);
    h.session.stopFollowing();
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
