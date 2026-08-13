import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createPickSessionFromService,
  createWindowPickSession,
  applyPickOverlayDesiredState,
  buildOverlayHtml,
  parseOverlayClick,
  sanitizeOverlayState,
  WINDOW_PICK_CURSOR_POLL_MS,
  type PickDisplay,
  type PickOverlayWindow,
  type PickService,
  type WindowPickScreen,
  type WindowPickSession,
} from '../../src/main/windows/windowPickSession';

// 016R3: the PRODUCTION adapter (createPickSessionFromService) pulls electron
// lazily via `require('electron')`. Vitest externalizes the real electron
// package, so `vi.mock('electron')` cannot intercept that require; the test
// instead hooks Module.prototype.require test-locally and restores it after.
// The pure session tests never require electron, so the hook is inert there.
const electronMock = vi.hoisted(() => {
  class FakeBrowserWindow {
    static counter = 1000;
    readonly id = FakeBrowserWindow.counter += 1;
    readonly webContents: {
      id: number;
      send: () => Promise<void>;
      executeJavaScript: () => Promise<unknown>;
    } = {
      id: this.id,
      send: () => Promise.resolve(),
      executeJavaScript: () => Promise.resolve('undefined'),
    };
    calls: string[] = [];
    destroyed = false;
    readyToShowHandlers: Array<() => void> = [];
    constructor() {
      windows.push(this);
    }
    setAlwaysOnTop(): void { this.calls.push('alwaysOnTop'); }
    setIgnoreMouseEvents(ignore: boolean): void { this.calls.push(`capture:${!ignore}`); }
    setBounds(): void { this.calls.push('setBounds'); }
    focus(): void { this.calls.push('focus'); }
    showInactive(): void { this.calls.push('show'); }
    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void { this.destroyed = true; }
    loadURL(): Promise<void> { return Promise.resolve(); }
    on(event: string, callback: () => void): void { if (event === 'ready-to-show') this.readyToShowHandlers.push(callback); }
    fireReadyToShow(): void { for (const callback of [...this.readyToShowHandlers]) callback(); }
  }
  const windows: FakeBrowserWindow[] = [];
  const screen = {
    getCursorScreenPoint: () => ({ x: 300, y: 300 }),
    getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    on: () => undefined,
    removeListener: () => undefined,
  };
  const ipcMain = { on: () => undefined, removeListener: () => undefined };
  return { FakeBrowserWindow, windows, screen, ipcMain };
});

const electronRequireHook = vi.hoisted(() => {
  const moduleApi = require('node:module');
  const originalRequire = moduleApi.Module.prototype.require;
  let fakeElectron: unknown = null;
  moduleApi.Module.prototype.require = function patchedRequire(this: unknown, id: string): unknown {
    if (id === 'electron') {
      if (!fakeElectron) throw new Error('fake electron not installed');
      return fakeElectron;
    }
    return originalRequire.call(this, id);
  };
  return {
    install: (fake: unknown): void => { fakeElectron = fake; },
    restore: (): void => { moduleApi.Module.prototype.require = originalRequire; },
  };
});

beforeAll(() => {
  electronRequireHook.install({
    screen: electronMock.screen,
    BrowserWindow: electronMock.FakeBrowserWindow,
    ipcMain: electronMock.ipcMain,
  });
});

afterAll(() => {
  electronRequireHook.restore();
});

const DESCRIPTOR_A = { version: 1 as const, title: 'Window A', executableFingerprint: 'a'.repeat(64) };
const DESCRIPTOR_B = { version: 1 as const, title: 'Window B', executableFingerprint: 'b'.repeat(64) };

export interface PickHandlers {
  onClick(x: number, y: number): void;
  onCancel(): void;
  onPointerMove(x: number, y: number): void;
  onCommit(): void;
}

export interface TestOverlay extends PickOverlayWindow {
  states: unknown[];
  bounds: Array<{ x: number; y: number; width: number; height: number }>;
  closed: boolean;
  events: string[];
  wire: (h: PickHandlers) => void;
  clickAt: (x: number, y: number) => void;
  pointerMoveAt: (x: number, y: number) => void;
  commitPick: () => void;
  cancelPick: () => void;
}

function makeTestOverlay(): TestOverlay {
  let handlers: PickHandlers | null = null;
  const overlay: TestOverlay = {
    states: [],
    bounds: [],
    closed: false,
    events: [],
    sendState: (state) => { overlay.states.push(state); },
    show: () => { overlay.events.push('show'); },
    setBounds: (b) => { overlay.bounds.push(b); overlay.events.push('setBounds'); },
    close: () => { overlay.closed = true; },
    wire: (h) => { handlers = h; },
    clickAt: (x, y) => handlers?.onClick(x, y),
    pointerMoveAt: (x, y) => handlers?.onPointerMove(x, y),
    commitPick: () => handlers?.onCommit(),
    cancelPick: () => handlers?.onCancel(),
  };
  return overlay;
}

function makeTwoOverlays(): TestOverlay[] {
  return [makeTestOverlay(), makeTestOverlay()];
}

function fakeScreen(overrides: Partial<WindowPickScreen> = {}): WindowPickScreen & { emit: (event: string) => void } {
  const listeners: Record<string, Array<() => void>> = {};
  const screen: WindowPickScreen & { emit: (event: string) => void } = {
    getCursorScreenPoint: () => ({ x: 300, y: 300 }),
    getAllDisplays: () => ([{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }] as PickDisplay[]),
    onDisplayChange: (callback) => {
      for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
        (listeners[event] ??= []).push(callback);
      }
      return () => {
        for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
          listeners[event] = (listeners[event] ?? []).filter((listener) => listener !== callback);
        }
      };
    },
    emit: (event) => {
      for (const listener of [...(listeners[event] ?? [])]) listener();
    },
    ...overrides,
  };
  return screen;
}

function fakeService(overrides: Partial<PickService> = {}): PickService {
  return {
    hoverAt: async () => ({
      outcome: 'success',
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' },
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      descriptor: DESCRIPTOR_A,
    }),
    pickAt: async () => ({
      outcome: 'success',
      capability: { version: 1, bindingId: 'wl-binding-1' },
      descriptor: DESCRIPTOR_A,
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' },
    }),
    resolvePersisted: async (descriptor) => ({
      outcome: 'success',
      capability: { version: 1, bindingId: 'wl-binding-member' },
      descriptor,
    }),
    observeCapability: async () => ({
      outcome: 'success',
      observation: { bounds: { x: 10, y: 10, width: 300, height: 200 } },
    }),
    ...overrides,
  };
}

function sessionWithOverlays(service: PickService = fakeService()): { session: WindowPickSession; created: TestOverlay[]; screen: ReturnType<typeof fakeScreen> } {
  const all = makeTwoOverlays();
  const created: TestOverlay[] = [];
  const screen = fakeScreen();
  const session = createWindowPickSession({
    service,
    screen,
    createOverlay: (_display, handlers) => {
      const overlay = all[created.length]!;
      overlay.wire(handlers);
      created.push(overlay);
      return overlay;
    },
  });
  return { session, created, screen };
}

function lastState(overlay: TestOverlay): Record<string, unknown> {
  return overlay.states[overlay.states.length - 1] as Record<string, unknown>;
}

describe('window pick session (019B live picker)', () => {
  it('begins immediately with an initial state (no green-rect startup blockade)', async () => {
    const { session, created } = sessionWithOverlays();
    const begin = await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    expect(begin).toEqual({ outcome: 'started' });
    expect(session.active).toBe(true);
    // begin() pushes an initial state synchronously; green resolution is async.
    expect(created[0]!.states.length).toBeGreaterThanOrEqual(1);
    await session.cancel();
  });

  it('green member rects resolve in the background and appear in the pushed state', async () => {
    const { session, created } = sessionWithOverlays();
    await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = lastState(created[0]!);
    expect(state['green']).toEqual([{ x: 10, y: 10, width: 300, height: 200 }]);
    await session.cancel();
  });

  it('pointer move resolves the hover under the point and paints it', async () => {
    const hoverAt = vi.fn(async () => ({
      outcome: 'success' as const,
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      descriptor: DESCRIPTOR_A,
    }));
    const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hoverAt).toHaveBeenCalledWith(250, 250);
    const state = lastState(created[0]!);
    expect(state['hover']).toMatchObject({ kind: 'add', x: 100, y: 100, width: 400, height: 300 });
    await session.cancel();
  });

  it('a move to the same point does not re-resolve (dedup)', async () => {
    const hoverAt = vi.fn(async () => ({
      outcome: 'success' as const,
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      descriptor: DESCRIPTOR_A,
    }));
    const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hoverAt).toHaveBeenCalledTimes(1);
    await session.cancel();
  });

  it('stale move results cannot repaint over newer points (coalescing + stale-guard)', async () => {
    vi.useFakeTimers();
    const hoverPromises: Array<(result: unknown) => void> = [];
    const hoverAt = vi.fn((_x: number, _y: number) => new Promise((resolve) => hoverPromises.push(resolve)));
    const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    // Move A starts a resolve; move B arrives while A is in flight.
    created[0]!.pointerMoveAt(100, 100);
    await vi.advanceTimersByTimeAsync(1);
    created[0]!.pointerMoveAt(200, 200);
    // Resolve A (stale) - it must NOT paint over the newer point B.
    hoverPromises[0]!({
      outcome: 'success',
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' },
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      descriptor: DESCRIPTOR_A,
    });
    await vi.advanceTimersByTimeAsync(1);
    const statesAfterStale = created[0]!.states.length;
    // The finally re-runs for B: hoverAt called again for (200,200).
    expect(hoverAt).toHaveBeenLastCalledWith(200, 200);
    hoverPromises[1]!({
      outcome: 'success',
      candidate: { id: 'wl-candidate-Tbbbb', title: 'Window B', applicationLabel: 'B', icon: null, state: 'normal' },
      bounds: { x: 200, y: 200, width: 300, height: 200 },
      descriptor: DESCRIPTOR_B,
    });
    await vi.advanceTimersByTimeAsync(1);
    const finalState = lastState(created[0]!);
    // Only B's rect paints; the stale A rect never appears as the hover.
    expect(finalState['hover']).toMatchObject({ x: 200, y: 200, width: 300, height: 200, kind: 'add' });
    // No intermediate state between the stale resolution and B's resolution
    // may carry A's bounds as the hover (statesAfterStale === statesAfterB).
    expect(created[0]!.states.length - statesAfterStale).toBeLessThanOrEqual(2);
    await session.cancel();
    vi.useRealTimers();
  });

  it('a blank hover clears the highlight (no stranded old window)', async () => {
    const hoverAt = vi.fn(async () => ({ outcome: 'success', candidate: null, bounds: null, descriptor: null }));
    const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    created[0]!.pointerMoveAt(10, 10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = lastState(created[0]!);
    expect(state['hover']).toBeNull();
    await session.cancel();
  });

  it('a click stages the highlighted candidate WITHOUT any helper round-trip', async () => {
    const hoverAt = vi.fn(async () => ({
      outcome: 'success' as const,
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      descriptor: DESCRIPTOR_A,
    }));
    const pickAt = vi.fn(async () => null);
    const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'], pickAt: pickAt as unknown as PickService['pickAt'] }));
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const hoverCalls = hoverAt.mock.calls.length;
    created[0]!.clickAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Click stages only: no hover and no bind round-trip.
    expect(hoverAt.mock.calls.length).toBe(hoverCalls);
    expect(pickAt).not.toHaveBeenCalled();
    // The staged ADD marker appears in the pushed state (persistent blue).
    const staged = lastState(created[0]!)['staged'] as Array<{ kind: string }>;
    expect(staged.some((s) => s.kind === 'add')).toBe(true);
    await session.cancel();
  });

  it('a staged removal persists red and drops the member green ring', async () => {
    const { session, created } = sessionWithOverlays();
    await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 20)); // green resolved
    created[0]!.pointerMoveAt(250, 250); // member hover -> remove
    await new Promise((resolve) => setTimeout(resolve, 10));
    created[0]!.clickAt(250, 250); // stage removal
    await new Promise((resolve) => setTimeout(resolve, 10));
    const state = lastState(created[0]!);
    const staged = state['staged'] as Array<{ kind: string }>;
    expect(staged.some((s) => s.kind === 'remove')).toBe(true);
    // The staged removal's green ring is dropped.
    expect(state['green']).toEqual([]);
    await session.cancel();
  });

  it('Enter commits the complete staged set in one typed result', async () => {
    const pickAt = vi.fn(async () => ({
      outcome: 'success' as const,
      capability: { version: 1 as const, bindingId: 'wl-binding-1' },
      descriptor: DESCRIPTOR_A,
      candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
    }));
    const { session, created } = sessionWithOverlays(fakeService({ pickAt: pickAt as unknown as PickService['pickAt'] }));
    let result: unknown = null;
    await session.begin({ memberDescriptors: [DESCRIPTOR_B], onResult: (next) => { result = next; } });
    created[0]!.pointerMoveAt(250, 250); // unselected A -> add
    await new Promise((resolve) => setTimeout(resolve, 10));
    created[0]!.clickAt(250, 250); // stage add A
    created[0]!.commitPick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pickAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      outcome: 'committed',
      adds: [
        {
          descriptor: DESCRIPTOR_A,
          capability: { version: 1, bindingId: 'wl-binding-1' },
          candidate: expect.objectContaining({ id: 'wl-candidate-Taaaa' }),
        },
      ],
      removes: [],
    });
    expect(session.active).toBe(false);
  });

  it('Escape cancels with zero mutation (no bind round-trip)', async () => {
    const pickAt = vi.fn(async () => null);
    const { session, created } = sessionWithOverlays(fakeService({ pickAt: pickAt as unknown as PickService['pickAt'] }));
    let result: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { result = next; } });
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    created[0]!.clickAt(250, 250); // stage an add
    created[0]!.cancelPick();
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(pickAt).not.toHaveBeenCalled();
    expect(session.active).toBe(false);
  });

  it('021: the overlay is ALWAYS click-through and never focused or capture-owning', async () => {
    const { session, created } = sessionWithOverlays();
    const begin = await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    expect(begin).toEqual({ outcome: 'started' });
    for (const overlay of created) {
      expect(overlay.events).not.toContain('focus');
      expect(overlay.events).not.toContain('capture:true');
      expect(overlay.events).toContain('show');
    }
    await session.cancel();
  });

  it('021: the overlay is shown inactive without ever being focused', async () => {
    const { session, created } = sessionWithOverlays();
    await expect(session.begin({ memberDescriptors: [], onResult: vi.fn() }))
      .resolves.toEqual({ outcome: 'started' });
    for (const overlay of created) {
      expect(overlay.events[0]).toBe('show');
      expect(overlay.events).not.toContain('focus');
    }
    await session.cancel();
  });

  it('a second begin replaces the first deterministically', async () => {
    const onResult1 = vi.fn();
    const onResult2 = vi.fn();
    const { session } = sessionWithOverlays();
    await session.begin({ memberDescriptors: [], onResult: onResult1 });
    await session.begin({ memberDescriptors: [], onResult: onResult2 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onResult1).toHaveBeenCalledWith({ outcome: 'cancelled' });
    expect(onResult2).not.toHaveBeenCalled();
    expect(session.active).toBe(true);
    await session.cancel();
  });

  it('display change cancels and cleans up', async () => {
    const { session, created, screen } = sessionWithOverlays();
    let result: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { result = next; } });
    screen.emit('display-removed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(session.active).toBe(false);
    for (const overlay of created) {
      expect(overlay.closed).toBe(true);
    }
  });

  it('member list beyond the bound is rejected without starting', async () => {
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: () => makeTestOverlay(),
      maxMembers: 2,
    });
    const begin = await session.begin({
      memberDescriptors: [DESCRIPTOR_A, DESCRIPTOR_B, DESCRIPTOR_A],
      onResult: vi.fn(),
    });
    expect(begin).toEqual({ outcome: 'failed', error: 'member list is malformed or exceeds the bound' });
    expect(session.active).toBe(false);
  });

  it('cancel with no active session is a harmless no-op', async () => {
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: () => makeTestOverlay(),
    });
    await session.cancel();
    expect(session.active).toBe(false);
  });

  it('a failed begin delivers no result and leaves no capture behind', async () => {
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: () => {
        throw new Error('boom');
      },
    });
    let result: unknown = 'pending';
    const begin = await session.begin({
      memberDescriptors: [],
      onResult: (next) => {
        result = next;
      },
    });
    expect(begin).toEqual({ outcome: 'failed', error: 'could not start the pick overlay' });
    expect(result).toBe('pending');
    expect(session.active).toBe(false);
  });

  it('the no-display branch fails cleanly with no result', async () => {
    const screen = fakeScreen({ getAllDisplays: () => [] });
    const session = createWindowPickSession({
      service: fakeService(),
      screen,
      createOverlay: () => {
        throw new Error('must never be called');
      },
    });
    let result: unknown = 'pending';
    const begin = await session.begin({
      memberDescriptors: [DESCRIPTOR_A],
      onResult: (next) => {
        result = next;
      },
    });
    expect(begin).toEqual({ outcome: 'failed', error: 'no display is available for picking' });
    expect(result).toBe('pending');
    expect(session.active).toBe(false);
  });

  it('repeated failed begins stay clean; fail-then-succeed fires only the fresh callback', async () => {
    const overlays = makeTwoOverlays();
    let throws = true;
    let created: TestOverlay | null = null;
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: (_display, handlers) => {
        if (throws) throw new Error('boom');
        const overlay = overlays.shift()!;
        overlay.wire(handlers);
        created = overlay;
        return overlay;
      },
    });
    const results: unknown[] = [];
    const onResult = (next: unknown) => { results.push(next); };
    const first = await session.begin({ memberDescriptors: [], onResult });
    expect(first).toEqual({ outcome: 'failed', error: 'could not start the pick overlay' });
    const second = await session.begin({ memberDescriptors: [], onResult });
    expect(second).toEqual({ outcome: 'failed', error: 'could not start the pick overlay' });
    expect(results).toEqual([]);
    expect(session.active).toBe(false);
    throws = false;
    const third = await session.begin({ memberDescriptors: [], onResult });
    expect(third).toEqual({ outcome: 'started' });
    expect(session.active).toBe(true);
    created!.cancelPick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(results).toEqual([{ outcome: 'cancelled' }]);
    expect(session.active).toBe(false);
  });

  it('021: retry native window is ALWAYS click-through and shown without focus before readiness', () => {
    const events: string[] = [];
    const desired = { shown: true };
    const makeWindow = (label: string) => ({
      setIgnoreMouseEvents: (ignore: boolean) => { events.push(`${label}:ignore=${ignore}`); },
      showInactive: () => { events.push(`${label}:show`); },
      setBounds: () => { events.push(`${label}:setBounds`); },
    });
    const first = makeWindow('first');
    const second = makeWindow('second');
    applyPickOverlayDesiredState(first, desired);
    events.push('first:preload-failed');
    applyPickOverlayDesiredState(second, desired);
    expect(events).toEqual([
      'first:ignore=true',
      'first:show',
      'first:preload-failed',
      'second:ignore=true',
      'second:show',
    ]);
  });

  it('021: adapter rebuild reapplies click-through + show to the replacement before its ready-to-show', async () => {
    electronMock.windows.length = 0;
    const service = fakeService() as unknown as Parameters<typeof createPickSessionFromService>[0];
    const session = createPickSessionFromService(service);
    const began = await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    expect(electronMock.windows.length).toBe(1);
    const first = electronMock.windows[0]!;
    first.webContents.executeJavaScript = () => Promise.resolve('undefined');
    first.fireReadyToShow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(electronMock.windows.length).toBe(2);
    const second = electronMock.windows[1]!;
    expect(second.readyToShowHandlers.length).toBe(1);
    expect(second.calls.filter((call) => call !== 'alwaysOnTop')).toEqual([
      'capture:false',
      'show',
    ]);
    second.webContents.executeJavaScript = () => Promise.resolve('object');
    second.fireReadyToShow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(electronMock.windows.length).toBe(2);
    // The overlay never takes focus and is always click-through.
    expect(second.calls).not.toContain('focus');
    expect(second.calls).not.toContain('capture:true');
    await session.cancel();
    void began;
  });

  it('016R: parseOverlayClick only accepts exact bounded finite integer points', () => {
    expect(parseOverlayClick({ x: 100, y: -50 })).toEqual({ x: 100, y: -50 });
    expect(parseOverlayClick(null)).toBeNull();
    expect(parseOverlayClick('nope')).toBeNull();
    expect(parseOverlayClick([1, 2])).toBeNull();
    expect(parseOverlayClick({})).toBeNull();
    expect(parseOverlayClick({ x: 1 })).toBeNull();
    expect(parseOverlayClick({ x: 1, y: 2, z: 3 })).toBeNull();
    expect(parseOverlayClick({ x: '1', y: 2 })).toBeNull();
    expect(parseOverlayClick({ x: NaN, y: 2 })).toBeNull();
    expect(parseOverlayClick({ x: 1.5, y: 2 })).toBeNull();
    expect(parseOverlayClick({ x: Number.MAX_SAFE_INTEGER + 1, y: 0 })).toBeNull();
    expect(parseOverlayClick({ x: 1, y: 65537 })).toBeNull();
    expect(parseOverlayClick({ x: -65536, y: 0 })).toEqual({ x: -65536, y: 0 });
    expect(parseOverlayClick({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(parseOverlayClick({ x: 65537, y: 1 })).toBeNull();
    expect(parseOverlayClick({ x: 1, y: -65537 })).toBeNull();
  });

  it('019B: sanitizeOverlayState accepts exact, finite, bounded draw state including staged', () => {
    const valid = {
      green: [{ x: 10, y: 10, width: 300, height: 200 }],
      hover: { x: 100, y: 100, width: 400, height: 300, kind: 'add' },
      staged: [{ x: 50, y: 50, width: 200, height: 150, kind: 'remove' }],
      display: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    expect(sanitizeOverlayState(valid)).toEqual(valid);
    expect(sanitizeOverlayState({ ...valid, hover: null })).toEqual({ ...valid, hover: null });
    expect(sanitizeOverlayState({ ...valid, staged: [] })).toEqual({ ...valid, staged: [] });
    expect(sanitizeOverlayState(null)).toBeNull();
    expect(sanitizeOverlayState('nope')).toBeNull();
    expect(sanitizeOverlayState({ green: [], hover: null })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, extra: 1 })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, green: [{ x: 1, y: 2, width: 3, height: 4, kind: 'add' }] })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, staged: [{ x: 1, y: 2, width: 3, height: 4 }] })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, staged: [{ x: 1, y: 2, width: 3, height: 4, kind: 'wobble' }] })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: 1, y: 2, width: 3, height: 4 } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: NaN, y: 2, width: 3, height: 4, kind: 'add' } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: 1, y: 2, width: 0, height: 4, kind: 'add' } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, staged: [{ x: 1, y: 2, width: 3, height: -1, kind: 'add' }] })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, display: { x: 0, y: 0, width: 0, height: 1080 } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, display: { x: 0, y: 0, width: 200000, height: 1080 } })).toBeNull();
    expect(sanitizeOverlayState({
      ...valid,
      staged: Array.from({ length: 65 }, () => ({ x: 1, y: 1, width: 1, height: 1, kind: 'add' })),
    })).toBeNull();
  });

  it('021: the cursor poll feeds the pointer-move pipeline (live hover without overlay events)', async () => {
    vi.useFakeTimers();
    try {
      const hoverAt = vi.fn(async () => ({
        outcome: 'success' as const,
        candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
        bounds: { x: 100, y: 100, width: 400, height: 300 },
        descriptor: DESCRIPTOR_A,
      }));
      const { session } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
      await session.begin({ memberDescriptors: [], onResult: vi.fn() });
      await vi.advanceTimersByTimeAsync(WINDOW_PICK_CURSOR_POLL_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(hoverAt).toHaveBeenCalledWith(300, 300);
      await session.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('021: the overlay is sized to the visible painted union, never the full display', async () => {
    const { session, created } = sessionWithOverlays();
    await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 20)); // green resolves in background
    const overlay = created[0]!;
    const last = overlay.bounds[overlay.bounds.length - 1]!;
    expect(last.width).not.toBe(1920);
    expect(last).toEqual({ x: 10, y: 10, width: 300, height: 200 });
    const state = lastState(overlay);
    expect(state['display']).toEqual(last);
    await session.cancel();
  });

  it('021: an overlay with nothing painted degrades to a 1x1 pixel, never a full display', async () => {
    const { session, created } = sessionWithOverlays();
    await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    const first = created[0]!.bounds[0]!;
    expect(first).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    await session.cancel();
  });

  it('021: stage() toggles the hovered window and commit() commits the staged set once', async () => {
    const { session, created } = sessionWithOverlays();
    let result: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { result = next; } });
    created[0]!.pointerMoveAt(250, 250);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.stage();
    await session.commit();
    expect(result).toMatchObject({
      outcome: 'committed',
      adds: [expect.objectContaining({ descriptor: DESCRIPTOR_A })],
    });
    expect(session.active).toBe(false);
  });

  it('021: workspace-page commit/cancel route with no overlay focus (keyboard stays on the launching page)', async () => {
    const { session, created } = sessionWithOverlays();
    let result: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { result = next; } });
    expect(created[0]!.events).not.toContain('focus');
    await session.cancel();
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(session.active).toBe(false);
  });

  it('021: the overlay page draws an OPAQUE border fallback plus the translucent tint (rendered pixels provable)', () => {
    const html = buildOverlayHtml();
    // Fully-opaque borders so the highlight is visible even where transparent
    // compositing cannot prove pixels.
    expect(html).toContain("strokeStyle = 'rgb(76, 175, 80)'");
    expect(html).toContain("strokeStyle = add ? 'rgb(33, 150, 243)' : 'rgb(244, 67, 54)'");
    // Translucent interior wash (blue add / red remove) plus the staged marker.
    expect(html).toContain('rgba(33, 150, 243, 0.22)');
    expect(html).toContain('rgba(244, 67, 54, 0.22)');
    expect(html).toContain('rgba(33, 150, 243, 0.10)');
    expect(html).toContain('rgba(244, 67, 54, 0.10)');
    // The renderer bridge and the click-through-agnostic page.
    expect(html).toContain('window.pickOverlay.onState');
    expect(html).toContain('window.pickOverlay.commit');
  });

  it('033 C1-C2: repeated production session cycles stay immediate and tear down cleanly', async () => {
    const startup: number[] = [];
    const hoverLatency: number[] = [];
    const cycleCount = 25;
    for (let cycle = 0; cycle < cycleCount; cycle += 1) {
      const hoverAt = vi.fn(async () => ({
        outcome: 'success' as const,
        candidate: { id: `wl-candidate-${cycle}`, title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' as const },
        bounds: { x: 100, y: 100, width: 400, height: 300 },
        descriptor: DESCRIPTOR_A,
      }));
      const { session, created } = sessionWithOverlays(fakeService({ hoverAt: hoverAt as unknown as PickService['hoverAt'] }));
      const openedAt = performance.now();
      await session.begin({ memberDescriptors: [], onResult: vi.fn() });
      startup.push(performance.now() - openedAt);
      const movedAt = performance.now();
      created[0]!.pointerMoveAt(250, 250);
      while (hoverAt.mock.calls.length === 0) await Promise.resolve();
      hoverLatency.push(performance.now() - movedAt);
      await session.stage();
      await session.cancel();
      expect(session.active).toBe(false);
      expect(created.every((overlay) => overlay.closed)).toBe(true);
    }
    const confirms = 10;
    for (let cycle = 0; cycle < confirms; cycle += 1) {
      const { session, created } = sessionWithOverlays();
    let resultOutcome: string | null = null;
      await session.begin({ memberDescriptors: [], onResult: (next) => { resultOutcome = next.outcome; } });
      created[0]!.pointerMoveAt(250, 250);
      await Promise.resolve();
      await session.stage();
      await session.commit();
      expect(resultOutcome).toBe('committed');
      expect(session.active).toBe(false);
      expect(created.every((overlay) => overlay.closed)).toBe(true);
    }
    const maxStartup = Math.max(...startup);
    const maxHover = Math.max(...hoverLatency);
    console.log(`033 C1-C2 latency cycles=${cycleCount} confirms=${confirms} maxStartupMs=${maxStartup.toFixed(3)} maxHoverMs=${maxHover.toFixed(3)}`);
    expect(maxStartup).toBeLessThan(50);
    expect(maxHover).toBeLessThan(50);
  });
});
