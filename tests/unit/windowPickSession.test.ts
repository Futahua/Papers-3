import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createPickSessionFromService,
  createWindowPickSession,
  applyPickOverlayDesiredState,
  parseOverlayClick,
  sanitizeOverlayState,
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

function fakeOverlay(record: { states: unknown[]; captures: boolean[]; closed: boolean }): PickOverlayWindow {
  return {
    sendState: (state) => { record.states.push(state); },
    show: () => undefined,
    setCapture: (capture) => { record.captures.push(capture); },
    focus: () => undefined,
    close: () => { record.closed = true; },
  };
}

export interface TestOverlay extends PickOverlayWindow {
  states: unknown[];
  captures: boolean[];
  closed: boolean;
  focusCount: number;
  events: string[];
  wire: (h: { onClick(x: number, y: number): void; onCancel(): void }) => void;
  clickAt: (x: number, y: number) => void;
  cancelPick: () => void;
}

function makeTestOverlay(): TestOverlay {
  let handlers: { onClick(x: number, y: number): void; onCancel(): void } | null = null;
  const overlay: TestOverlay = {
    states: [],
    captures: [],
    closed: false,
    focusCount: 0,
    events: [],
    sendState: (state) => { overlay.states.push(state); },
    show: () => { overlay.events.push('show'); },
    setCapture: (capture) => { overlay.captures.push(capture); overlay.events.push(`capture:${capture}`); },
    focus: () => { overlay.focusCount += 1; overlay.events.push('focus'); },
    close: () => { overlay.closed = true; },
    wire: (h) => { handlers = h; },
    clickAt: (x, y) => handlers?.onClick(x, y),
    cancelPick: () => handlers?.onCancel(),
  };
  return overlay;
}

/** Two wired overlay fakes matching the default two-display fake screen. */
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

describe('window pick session', () => {
  it('begins a session: overlay per display, green member outlines resolved, sampling starts', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    const service = fakeService();
    const onResult = vi.fn();
    const session: WindowPickSession = createWindowPickSession({
      service,
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay(record),
      sampleIntervalMs: 20,
    });
    const begin = await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult });
    expect(begin).toEqual({ outcome: 'started' });
    expect(session.active).toBe(true);
    // green resolution ran: the member's resolved bounds appear in state
    await new Promise((resolve) => setTimeout(resolve, 60));
    const state = record.states[record.states.length - 1] as { green: unknown[]; hover: unknown };
    expect(state.green).toEqual([{ x: 10, y: 10, width: 300, height: 200 }]);
    // hovered candidate (a member) => remove kind + capture on
    expect(state.hover).toMatchObject({ kind: 'remove', x: 100, y: 100, width: 400, height: 300 });
    expect(record.captures.includes(true)).toBe(true);
    await session.cancel();
  });

  it('hover over a NON-member shows blue add and no green', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    const session = createWindowPickSession({
      service: fakeService({
        hoverAt: async () => ({
          outcome: 'success',
          candidate: { id: 'wl-candidate-Tbbbb', title: 'Window B', applicationLabel: 'B', icon: null, state: 'normal' },
          bounds: { x: 500, y: 500, width: 200, height: 150 },
          descriptor: DESCRIPTOR_B,
        }),
      }),
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay(record),
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const state = record.states[record.states.length - 1] as { hover: { kind: string } };
    expect(state.hover.kind).toBe('add');
    await session.cancel();
  });

  it('click toggles only the exact highlighted candidate; a changed target fails closed', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    const onResult = vi.fn();
    const clickHandlers: { click: ((x: number, y: number) => void) | null } = { click: null };
    const session = createWindowPickSession({
      service: fakeService({
        pickAt: async (x, y, candidateId) => {
          if (candidateId !== 'wl-candidate-Taaaa') {
            return { outcome: 'missing', error: 'the hovered window changed before the click' };
          }
          return {
            outcome: 'success',
            capability: { version: 1, bindingId: 'wl-binding-1' },
            descriptor: DESCRIPTOR_A,
            candidate: { id: 'wl-candidate-Taaaa', title: 'Window A', applicationLabel: 'A', icon: null, state: 'normal' },
          };
        },
      }),
      screen: fakeScreen(),
      createOverlay: (_display, handlers) => {
        clickHandlers.click = handlers.onClick;
        return fakeOverlay(record);
      },
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [], onResult });
    await new Promise((resolve) => setTimeout(resolve, 60));
    clickHandlers.click?.(300, 300);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'picked', capability: { version: 1, bindingId: 'wl-binding-1' } }));
    expect(session.active).toBe(false);
  });

  it('Escape/right-click (cancel) ends with cancelled and closes every overlay', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    const onResult = vi.fn();
    const cancelHandlers: { cancel: (() => void) | null } = { cancel: null };
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: (_display, handlers) => {
        cancelHandlers.cancel = handlers.onCancel;
        return fakeOverlay(record);
      },
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [], onResult });
    cancelHandlers.cancel?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onResult).toHaveBeenCalledWith({ outcome: 'cancelled' });
    expect(session.active).toBe(false);
    expect(record.closed).toBe(true);
  });

  it('a second begin replaces the first deterministically', async () => {
    const onResult1 = vi.fn();
    const onResult2 = vi.fn();
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay({ states: [], captures: [], closed: false }),
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [], onResult: onResult1 });
    await session.begin({ memberDescriptors: [], onResult: onResult2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onResult1).toHaveBeenCalledWith({ outcome: 'cancelled' });
    expect(onResult2).not.toHaveBeenCalled();
    expect(session.active).toBe(true);
    await session.cancel();
  });

  it('display change cancels and cleans up', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    const onResult = vi.fn();
    const displayChangeHandlers: { change: (() => void) | null } = { change: null };
    const screen = fakeScreen();
    const session = createWindowPickSession({
      service: fakeService(),
      screen: {
        ...screen,
        onDisplayChange: (callback) => {
          displayChangeHandlers.change = callback;
          return () => undefined;
        },
      },
      createOverlay: () => fakeOverlay(record),
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [], onResult });
    displayChangeHandlers.change?.();
    expect(onResult).toHaveBeenCalledWith({ outcome: 'cancelled' });
    expect(session.active).toBe(false);
    expect(record.closed).toBe(true);
  });

  it('helper failure during sampling ends with failed', async () => {
    const onResult = vi.fn();
    const session = createWindowPickSession({
      service: fakeService({
        hoverAt: async () => ({ outcome: 'helper-unavailable', error: 'window helper is unavailable' }),
      }),
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay({ states: [], captures: [], closed: false }),
      sampleIntervalMs: 20,
    });
    await session.begin({ memberDescriptors: [], onResult });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
    expect(session.active).toBe(false);
  });

  it('member list beyond the bound is rejected without starting', async () => {
    const session = createWindowPickSession({
      service: fakeService(),
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay({ states: [], captures: [], closed: false }),
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
      createOverlay: () => fakeOverlay({ states: [], captures: [], closed: false }),
    });
    await session.cancel();
    expect(session.active).toBe(false);
  });

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

  it('016R: input capture and focus are applied before any sample', async () => {
    const { session, created } = sessionWithOverlays();
    const begin = await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    expect(begin).toEqual({ outcome: 'started' });
    for (const overlay of created) {
      expect(overlay.captures[0]).toBe(true);
    }
    expect(created[0]!.focusCount).toBe(1);
    await session.cancel();
  });

  it('016R2: each native overlay is shown before capture and focus', async () => {
    const { session, created } = sessionWithOverlays();
    await expect(session.begin({ memberDescriptors: [], onResult: vi.fn() }))
      .resolves.toEqual({ outcome: 'started' });
    for (const overlay of created) {
      expect(overlay.events.slice(0, 2)).toEqual(['capture:true', 'show']);
    }
    expect(created[0]!.events[2]).toBe('focus');
    await session.cancel();
  });

  it('016R2R: retry native window receives capture, show, focus before readiness', () => {
    const events: string[] = [];
    const desired = { capture: true, shown: true, focused: true };
    const first = {
      setIgnoreMouseEvents: (ignore: boolean) => { events.push(`first:capture=${!ignore}`); },
      showInactive: () => { events.push('first:show'); },
      focus: () => { events.push('first:focus'); },
    };
    const second = {
      setIgnoreMouseEvents: (ignore: boolean) => { events.push(`second:capture=${!ignore}`); },
      showInactive: () => { events.push('second:show'); },
      focus: () => { events.push('second:focus'); },
    };
    applyPickOverlayDesiredState(first, desired);
    events.push('first:preload-failed');
    applyPickOverlayDesiredState(second, desired);
    expect(events.slice(3)).toEqual([
      'first:preload-failed',
      'second:capture=true',
      'second:show',
      'second:focus',
    ]);
  });

  it('016R3: adapter rebuild reapplies capture, show, focus to the replacement before its ready-to-show', async () => {
    electronMock.windows.length = 0;
    const service = fakeService() as unknown as Parameters<typeof createPickSessionFromService>[0];
    const session = createPickSessionFromService(service);
    const began = await session.begin({ memberDescriptors: [], onResult: vi.fn() });
    expect(electronMock.windows.length).toBe(1);
    const first = electronMock.windows[0]!;
    // The first native window's preload validation FAILS (bridge missing).
    first.webContents.executeJavaScript = () => Promise.resolve('undefined');
    first.fireReadyToShow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Exactly one replacement is created (single-retry limit preserved).
    expect(electronMock.windows.length).toBe(2);
    const second = electronMock.windows[1]!;
    // build() must have reapplied the persisted desired state to the
    // replacement - capture, show, focus, in that order - BEFORE the
    // replacement's own ready-to-show fired. The ready-to-show handler's
    // show/focus only run when that handler fires, so these calls can only
    // come from the build-time applyPickOverlayDesiredState. If build()
    // forgot to reapply, this assertion fails.
    expect(second.readyToShowHandlers.length).toBe(1);
    expect(second.calls.filter((call) => call !== 'alwaysOnTop')).toEqual([
      'capture:true',
      'show',
      'focus',
    ]);
    // The replacement is fully usable: the preload now validates and no
    // further rebuild happens.
    second.webContents.executeJavaScript = () => Promise.resolve('object');
    second.fireReadyToShow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(electronMock.windows.length).toBe(2);
    await session.cancel();
  });

  it('016R: immediate click on the first overlay resolves the session (no begin-promise race)', async () => {
    const { session, created } = sessionWithOverlays();
    let result: unknown = 'pending';
    const beginPromise = session.begin({
      memberDescriptors: [],
      onResult: (next) => {
        result = next;
      },
    });
    // Click before begin() has resolved: with synchronous fakes begin has
    // not returned 'started' yet, but the session is already active and the
    // click resolves immediately.
    created[0]!.clickAt(300, 300);
    expect(await beginPromise).toEqual({ outcome: 'started' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result).toMatchObject({ outcome: 'picked' });
    expect(session.active).toBe(false);
  });

  it('016R: blank-area click reports a typed failure and never re-enables click-through', async () => {
    const { session, created } = sessionWithOverlays(fakeService({
      hoverAt: async () => ({ outcome: 'missing', error: 'nothing eligible is under the pointer' }),
    }));
    let result: unknown = 'pending';
    await session.begin({
      memberDescriptors: [],
      onResult: (next) => {
        result = next;
      },
    });
    // Override hoverAt after wiring: a blank click finds nothing eligible.
    await new Promise((resolve) => setTimeout(resolve, 20));
    created[0]!.clickAt(300, 300);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result).toEqual({ outcome: 'failed', error: 'nothing eligible is under the pointer' });
    for (const overlay of created) {
      expect(overlay.captures[overlay.captures.length - 1]).toBe(true);
    }
    expect(session.active).toBe(false);
  });

  it('016R: a failed begin delivers no result and leaves no capture behind', async () => {
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

  it('016R: the no-display branch fails cleanly with no result', async () => {
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

  it('016R: repeated failed begins stay clean; fail-then-succeed fires only the fresh callback', async () => {
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
    // A subsequent SUCCESSFUL begin must never deliver a stale failed-begin
    // callback; only the fresh session's outcome can arrive.
    throws = false;
    const third = await session.begin({ memberDescriptors: [], onResult });
    expect(third).toEqual({ outcome: 'started' });
    expect(session.active).toBe(true);
    created!.cancelPick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(results).toEqual([{ outcome: 'cancelled' }]);
    expect(session.active).toBe(false);
  });

  it('016R: display lifecycle changes (added/removed/metrics) cancel the session', async () => {
    const { session, created, screen } = sessionWithOverlays();
    let result: unknown = 'pending';
    await session.begin({
      memberDescriptors: [],
      onResult: (next) => {
        result = next;
      },
    });
    screen.emit('display-removed');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(session.active).toBe(false);
    for (const overlay of created) {
      expect(overlay.closed).toBe(true);
    }
  });

  it('016R gap 8: green member rects track moved members at the sampling cadence', async () => {
    const record = { states: [] as unknown[], captures: [] as boolean[], closed: false };
    let observes = 0;
    const session = createWindowPickSession({
      service: fakeService({
        observeCapability: async () => {
          observes += 1;
          return observes === 1
            ? { outcome: 'success', observation: { bounds: { x: 10, y: 10, width: 300, height: 200 } } }
            : { outcome: 'success', observation: { bounds: { x: 500, y: 500, width: 300, height: 200 } } };
        },
      }),
      screen: fakeScreen(),
      createOverlay: () => fakeOverlay(record),
      sampleIntervalMs: 10,
    });
    await session.begin({ memberDescriptors: [DESCRIPTOR_A], onResult: vi.fn() });
    // The member's first observation is at (10,10); after the bounded green
    // refresh cadence the pushed state must carry the CURRENT bounds (500,500).
    await new Promise((resolve) => setTimeout(resolve, 900));
    const last = record.states[record.states.length - 1] as { green: unknown[] };
    expect(last.green).toEqual([{ x: 500, y: 500, width: 300, height: 200 }]);
    expect(observes).toBeGreaterThan(1);
    await session.cancel();
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

  it('016R: sanitizeOverlayState accepts only exact, finite, bounded draw state', () => {
    const valid = {
      green: [{ x: 10, y: 10, width: 300, height: 200 }],
      hover: { x: 100, y: 100, width: 400, height: 300, kind: 'add' },
      display: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    expect(sanitizeOverlayState(valid)).toEqual(valid);
    expect(sanitizeOverlayState({ ...valid, hover: null })).toEqual({ ...valid, hover: null });
    expect(sanitizeOverlayState({ ...valid, green: [] })).toEqual({ ...valid, green: [] });
    expect(sanitizeOverlayState(null)).toBeNull();
    expect(sanitizeOverlayState('nope')).toBeNull();
    expect(sanitizeOverlayState({ green: [], hover: null })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, extra: 1 })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, green: [{ x: 1, y: 2, width: 3, height: 4, kind: 'add' }] })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: 1, y: 2, width: 3, height: 4 } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: 1, y: 2, width: 3, height: 4, kind: 'wobble' } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: NaN, y: 2, width: 3, height: 4, kind: 'add' } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, hover: { x: Infinity, y: 2, width: 3, height: 4, kind: 'add' } })).toBeNull();
    expect(sanitizeOverlayState({ ...valid, display: { x: 0, y: 0, width: 200000, height: 1080 } })).toBeNull();
    expect(sanitizeOverlayState({
      ...valid,
      green: Array.from({ length: 65 }, () => ({ x: 1, y: 1, width: 1, height: 1 })),
    })).toBeNull();
  });
});
