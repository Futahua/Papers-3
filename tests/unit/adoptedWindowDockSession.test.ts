/**
 * Adopted-window dock session: tile math, adopt/refuse paths, follow on
 * Papers moves, and clean release. All Electron and helper seams are faked;
 * nothing here touches a real window.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createAdoptedWindowDock,
  tileRightOf,
  tileRightOfMany,
  toPhysical,
  type DockCapabilityService,
  type DockPapersWindow,
  type DockScreen,
  type DockShortcut,
} from '../../src/main/windows/adoptedWindowDockSession';
import type {
  RuntimeWindowId,
  WindowCapabilityResult,
  WindowObservation,
} from '../../src/main/windows/windowCapabilityTypes';
import type { WindowBindResult, WindowHoverResult, WindowRuntimeCapability } from '../../src/main/windows/windowCapabilityService';

const id = (value: string) => value as RuntimeWindowId;
const capability = (): WindowRuntimeCapability => ({ version: 1, bindingId: 'binding-1' });

function observation(overrides: Partial<WindowObservation> = {}): WindowObservation {
  return {
    runtimeId: id('token-1'),
    title: 'Victim App',
    processId: 4242,
    processPath: 'C:\\apps\\victim.exe',
    windowClass: 'VictimMain',
    state: 'normal',
    bounds: { x: 2000, y: 200, width: 960, height: 600 },
    ...overrides,
  };
}

const success = (obs: WindowObservation): WindowCapabilityResult => ({ outcome: 'success', observation: obs });

interface FakeServiceState {
  hover: WindowHoverResult;
  pick: WindowBindResult;
  observations: WindowCapabilityResult[];
  appliedBounds: Array<{ x: number; y: number; width: number; height: number }>;
}

function fakeService(state: Partial<FakeServiceState> = {}): DockCapabilityService & FakeServiceState & { applyCalls: number } {
  let observed = 0;
  const full: FakeServiceState = {
    hover: { outcome: 'success', candidate: { id: 'cand-1', title: 'Victim App', applicationLabel: 'victim', icon: null, state: 'normal' }, bounds: null, descriptor: null },
    pick: { outcome: 'success', capability: capability(), descriptor: { version: 1, title: 'Victim App' } },
    observations: [success(observation())],
    appliedBounds: [],
    ...state,
  };
  let applyCalls = 0;
  return {
    ...full,
    get applyCalls() {
      return applyCalls;
    },
    hoverAt: async () => full.hover,
    pickAt: async () => full.pick,
    observeCapability: async () => full.observations[Math.min(observed++, full.observations.length - 1)] as WindowCapabilityResult,
    applyCapability: async (_cap, bounds) => {
      applyCalls += 1;
      full.appliedBounds.push({ ...bounds });
      return { outcome: 'success' };
    },
  };
}

function fakeWindow(bounds = { x: 100, y: 100, width: 1200, height: 800 }): DockPapersWindow & {
  emit(event: 'move' | 'resize' | 'restore' | 'closed'): void;
  setBounds(next: { x: number; y: number; width: number; height: number }): void;
} {
  let current = { ...bounds };
  const listeners = new Map<string, Set<() => void>>();
  return {
    id: 7,
    getBounds: () => ({ ...current }),
    isDestroyed: () => false,
    on: (event, callback) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
    },
    removeListener: (event, callback) => {
      listeners.get(event)?.delete(callback);
    },
    emit: (event) => {
      for (const callback of [...(listeners.get(event) ?? [])]) callback();
    },
    setBounds: (next) => {
      current = { ...next };
    },
  };
}

function fakeScreen(): DockScreen & { cursor: { x: number; y: number } } {
  return {
    cursor: { x: 2050, y: 300 },
    getCursorScreenPoint() {
      return { ...this.cursor };
    },
    getDisplayMatching: () => ({ scaleFactor: 1, workArea: { x: 0, y: 0, width: 3840, height: 1080 } }),
  };
}

function fakeShortcut(): DockShortcut & { callbacks: Map<string, () => void> } {
  const callbacks = new Map<string, () => void>();
  return {
    callbacks,
    register: (accelerator, callback) => {
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      callbacks.delete(accelerator);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('tileRightOf', () => {
  const papers = { x: 100, y: 100, width: 1200, height: 800 };
  const area = { x: 0, y: 0, width: 3840, height: 1080 };

  it('glues the window right of Papers with the same top and height', () => {
    expect(tileRightOf(papers, 960, area)).toEqual({ x: 1308, y: 100, width: 960, height: 800 });
  });

  it('pulls the tile back on-screen at the right edge', () => {
    const edge = { x: 2500, y: 100, width: 1200, height: 800 };
    expect(tileRightOf(edge, 960, area)).toEqual({ x: 2880, y: 100, width: 960, height: 800 });
  });

  it('refuses when not even the minimum width fits', () => {
    const tiny = { x: 0, y: 0, width: 100, height: 100 };
    expect(tileRightOf(papers, 960, tiny)).toBeNull();
  });
});

describe('tileRightOfMany', () => {
  it('keeps the first tile geometry and stacks later tiles below it', () => {
    const papers = { x: 100, y: 100, width: 1200, height: 800 };
    const area = { x: 0, y: 0, width: 3840, height: 1080 };
    expect(tileRightOfMany(papers, 960, 0, 2, area)).toEqual({ x: 1308, y: 100, width: 960, height: 396 });
    expect(tileRightOfMany(papers, 960, 1, 2, area)).toEqual({ x: 1308, y: 504, width: 960, height: 396 });
  });
});

describe('toPhysical', () => {
  it('scales DIP by the display factor and falls back to 1', () => {
    expect(toPhysical({ x: 1308, y: 100, width: 960, height: 800 }, 1.5))
      .toEqual({ x: 1962, y: 150, width: 1440, height: 1200 });
    expect(toPhysical({ x: 10, y: 10, width: 100, height: 100 }, 0))
      .toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });
});

describe('adoptedWindowDockSession', () => {
  it('docks the window under the cursor right of Papers', async () => {
    const service = fakeService();
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut(), followDelayMs: 5 });
    const window = fakeWindow();
    const result = await dock.toggle(window);
    expect(result.outcome).toBe('docked');
    expect(dock.active).toBe(true);
    expect(dock.adoptedTitle).toBe('Victim App');
    // Papers at x=100 w=1200, gap 8, adopted width 960 (scale 1).
    expect(service.appliedBounds).toEqual([{ x: 1308, y: 100, width: 960, height: 800 }]);
  });

  it('refuses a Papers window: never adopts itself', async () => {
    const service = fakeService({ observations: [success(observation({ processId: process.pid, processPath: 'C:\\papers.exe' }))] });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    const result = await dock.toggle(fakeWindow());
    expect(result).toMatchObject({ outcome: 'refused' });
    expect(service.applyCalls).toBe(0);
    expect(dock.active).toBe(false);
  });

  it('refuses minimized windows without touching them', async () => {
    const service = fakeService({ observations: [success(observation({ state: 'minimized' }))] });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    expect(await dock.toggle(fakeWindow())).toMatchObject({ outcome: 'refused' });
    expect(service.applyCalls).toBe(0);
  });

  it('refuses when nothing adoptable is under the cursor', async () => {
    const service = fakeService({ hover: { outcome: 'success', candidate: null, bounds: null, descriptor: null } });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    expect(await dock.toggle(fakeWindow())).toMatchObject({ outcome: 'refused' });
    expect(dock.active).toBe(false);
  });

  it('a second toggle releases and restores the original rectangle', async () => {
    const service = fakeService();
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    const window = fakeWindow();
    await dock.toggle(window);
    const released = await dock.toggle(window);
    expect(released.outcome).toBe('released');
    expect(dock.active).toBe(false);
    // Last write is the restore of the pre-adoption rectangle.
    expect(service.appliedBounds.at(-1)).toEqual({ x: 2000, y: 200, width: 960, height: 600 });
  });

  it('keeps two distinct Chrome windows adopted at the same time', async () => {
    const service = fakeService({
      observations: Array.from({ length: 20 }, () => success(observation())),
    });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    const window = fakeWindow();
    expect((await dock.toggle(window)).outcome).toBe('docked');

    // The capability service identifies a window by its stable candidate id.
    // Change that id in-place to model hovering a second Chrome top-level HWND.
    (service.hover as Extract<WindowHoverResult, { outcome: 'success' }>).candidate!.id = 'chrome-2';
    ((service.pick as Extract<WindowBindResult, { outcome: 'success' }>).capability as WindowRuntimeCapability).bindingId = 'binding-2';
    expect((await dock.toggle(window)).outcome).toBe('docked');
    expect(dock.active).toBe(true);
    expect(service.appliedBounds).toContainEqual({ x: 1308, y: 100, width: 960, height: 396 });
    expect(service.appliedBounds).toContainEqual({ x: 1308, y: 504, width: 960, height: 396 });

    // Hovering the first identity again releases only that window; the second
    // remains active and is retiled into the full-height slot.
    (service.hover as Extract<WindowHoverResult, { outcome: 'success' }>).candidate!.id = 'cand-1';
    ((service.pick as Extract<WindowBindResult, { outcome: 'success' }>).capability as WindowRuntimeCapability).bindingId = 'binding-1';
    expect((await dock.toggle(window)).outcome).toBe('released');
    expect(dock.active).toBe(true);
  });

  it('follows Papers moves and stops after release', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation()), success(observation())],
    });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut(), followDelayMs: 5 });
    const window = fakeWindow();
    await dock.toggle(window);
    const callsAfterDock = service.applyCalls;
    window.setBounds({ x: 300, y: 120, width: 1200, height: 800 });
    window.emit('move');
    await sleep(40);
    expect(service.applyCalls).toBeGreaterThan(callsAfterDock);
    expect(service.appliedBounds.at(-1)).toEqual({ x: 1508, y: 120, width: 960, height: 800 });
    await dock.toggle(window);
    const callsAfterRelease = service.applyCalls;
    window.emit('move');
    await sleep(40);
    expect(service.applyCalls).toBe(callsAfterRelease);
  });

  it('closing the Papers window restores the adopted window', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation())],
    });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    const window = fakeWindow();
    await dock.toggle(window);
    window.emit('closed');
    await sleep(20);
    expect(service.appliedBounds.at(-1)).toEqual({ x: 2000, y: 200, width: 960, height: 600 });
  });

  it('adopts again after a release: the follower is not single-use', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation()), success(observation()), success(observation())],
    });
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut: fakeShortcut() });
    const window = fakeWindow();
    expect((await dock.toggle(window)).outcome).toBe('docked');
    expect((await dock.toggle(window)).outcome).toBe('released');
    const second = await dock.toggle(window);
    expect(second.outcome).toBe('docked');
    expect(dock.active).toBe(true);
  });

  it('registers the chord and routes it to toggle', async () => {
    const service = fakeService();
    const shortcut = fakeShortcut();
    const dock = createAdoptedWindowDock({ service, screen: fakeScreen(), shortcut });
    const notified: unknown[] = [];
    const window = fakeWindow();
    const report = dock.register({ focusedWindow: () => window, notify: (outcome) => notified.push(outcome) });
    expect(report.registered).toBe(true);
    shortcut.callbacks.get(report.accelerator)?.();
    await sleep(20);
    expect(notified).toHaveLength(1);
    expect(dock.active).toBe(true);
    vi.useRealTimers();
  });
});
