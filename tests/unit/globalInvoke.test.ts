import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_INVOKE_ACCELERATORS,
  createGlobalInvoke,
  type GlobalInvokeDependencies,
  type GlobalInvokeReport,
} from '../../src/main/windows/globalInvoke';

/**
 * A fake globalShortcut with Electron's MEASURED behaviour (probe:
 * electron-shortcut-probe.mjs on Electron 43.1.1):
 *   - register() returns false when the chord is already held; it does NOT throw
 *   - isRegistered() reports whether this process currently holds the chord
 *   - an unparseable accelerator THROWS a TypeError
 *   - a chord another application owns returns false from register()
 * The fake encodes all four so the tests exercise the real contract.
 */
function fakeShortcut(options: { taken?: string[]; throwOn?: string[] } = {}) {
  const held = new Set<string>();
  const taken = new Set(options.taken ?? []);
  const throwOn = new Set(options.throwOn ?? []);
  const callbacks = new Map<string, () => void>();
  const order: string[] = [];
  return {
    held,
    order,
    callbacks,
    api: {
      register(accelerator: string, callback: () => void): boolean {
        if (throwOn.has(accelerator)) {
          throw new TypeError(`Error processing argument at index 0, conversion failure from ${accelerator}`);
        }
        order.push(accelerator);
        if (taken.has(accelerator)) return false;
        if (held.has(accelerator)) return false;
        held.add(accelerator);
        callbacks.set(accelerator, callback);
        return true;
      },
      unregister(accelerator: string): void {
        held.delete(accelerator);
        callbacks.delete(accelerator);
      },
      unregisterAll(): void {
        held.clear();
        callbacks.clear();
      },
      isRegistered(accelerator: string): boolean {
        return held.has(accelerator);
      },
    },
  };
}

function harness(overrides: Partial<GlobalInvokeDependencies> = {}) {
  const shortcut = fakeShortcut();
  const brought: Array<{ windowId: number; reason: string }> = [];
  const invoked: Array<{ projectId: string; surfaceId: string; reason: string }> = [];
  // The launcher overlay: a fake that records open/close calls. The invoke chord
  // must reach THIS and must never reach `bringToFront`.
  const overlay = {
    opened: 0,
    closed: [] as string[],
    isOpenValue: false,
    open: async () => { overlay.opened += 1; overlay.isOpenValue = true; return { ok: true, detail: 'opened' }; },
    close: async (reason: string) => { overlay.closed.push(reason); overlay.isOpenValue = false; },
    isOpen: () => overlay.isOpenValue,
  };
  const deps: GlobalInvokeDependencies = {
    shortcut: shortcut.api,
    currentWindowId: () => 7,
    bringToFront: (windowId) => {
      brought.push({ windowId, reason: '' });
      return { ok: true, detail: 'shown and focused' };
    },
    invokeCommandSurface: (projectId, surfaceId, reason) => {
      invoked.push({ projectId, surfaceId, reason });
      return { ok: true, detail: 'delivered' };
    },
    resolveCommandSurface: () => ({ projectId: 'project-a', surfaceId: 'surface-1' }),
    overlay,
    ...overrides,
  };
  return { shortcut, brought, invoked, overlay, deps };
}

describe('globalInvoke registration', () => {
  it('registers exactly the two requested chords and nothing else', () => {
    const { shortcut, deps } = harness();
    const report = createGlobalInvoke(deps).register();

    expect(report.ok).toBe(true);
    expect(report.registered).toEqual(['Alt+Shift+A', 'Alt+A']);
    expect(shortcut.order).toEqual(['Alt+Shift+A', 'Alt+A']);
    // Nothing beyond the two chords may be captured while Papers merely runs.
    expect([...shortcut.held].sort()).toEqual(['Alt+A', 'Alt+Shift+A']);
  });

  it('reports a chord another application already owns as an explicit refusal naming the chord', () => {
    const shortcut = fakeShortcut({ taken: ['Alt+A'] });
    const deps: GlobalInvokeDependencies = {
      shortcut: shortcut.api,
      currentWindowId: () => 1,
      bringToFront: () => ({ ok: true, detail: '' }),
      invokeCommandSurface: () => ({ ok: true, detail: '' }),
    };
    const report = createGlobalInvoke(deps).register();

    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.accelerator === 'Alt+A');
    expect(failure).toBeDefined();
    expect(failure?.reason).toBe('already-registered-by-another-application');
    // The creator must be able to see which chord, in the chord's own words.
    expect(failure?.message).toContain('Alt+A');
    // The other chord still works: one failure must not take the feature down.
    expect(report.registered).toEqual(['Alt+Shift+A']);
    expect(shortcut.held.has('Alt+Shift+A')).toBe(true);
  });

  it('never falls back to a different chord when one is taken', () => {
    const shortcut = fakeShortcut({ taken: ['Alt+A'] });
    const deps: GlobalInvokeDependencies = {
      shortcut: shortcut.api,
      currentWindowId: () => 1,
      bringToFront: () => ({ ok: true, detail: '' }),
      invokeCommandSurface: () => ({ ok: true, detail: '' }),
    };
    createGlobalInvoke(deps).register();

    // The exact requested set only. No substituted chord may appear.
    for (const held of shortcut.held) {
      expect(['Alt+Shift+A', 'Alt+A']).toContain(held);
    }
    expect(shortcut.order).toEqual(['Alt+Shift+A', 'Alt+A']);
  });

  it('turns an unparseable accelerator into a named refusal instead of throwing', () => {
    const shortcut = fakeShortcut({ throwOn: ['Alt+A'] });
    const deps: GlobalInvokeDependencies = {
      shortcut: shortcut.api,
      currentWindowId: () => 1,
      bringToFront: () => ({ ok: true, detail: '' }),
      invokeCommandSurface: () => ({ ok: true, detail: '' }),
    };
    const report = createGlobalInvoke(deps).register();

    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.accelerator === 'Alt+A');
    expect(failure?.reason).toBe('unusable-accelerator');
    expect(failure?.message).toContain('Alt+A');
  });

  it('refuses a single-key chord, which Electron accepts but which would swallow that key system-wide', () => {
    // Measured: globalShortcut.register('A') returns TRUE on Electron 43.1.1.
    // A bare key is never an acceptable global chord regardless of the backend.
    const shortcut = fakeShortcut();
    const deps: GlobalInvokeDependencies = {
      shortcut: shortcut.api,
      currentWindowId: () => 1,
      bringToFront: () => ({ ok: true, detail: '' }),
      invokeCommandSurface: () => ({ ok: true, detail: '' }),
      accelerators: { invoke: 'A', bringToFront: 'Alt+Shift+A' },
    };
    const report = createGlobalInvoke(deps).register();

    expect(report.ok).toBe(false);
    expect(report.failures.find((f) => f.accelerator === 'A')?.reason).toBe('modifier-required');
    expect(shortcut.held.has('A')).toBe(false);
  });
});

describe('globalInvoke release', () => {
  it('releases both chords on quit so nothing stays captured after Papers exits', () => {
    const { shortcut, deps } = harness();
    const invoke = createGlobalInvoke(deps);
    invoke.register();
    expect(shortcut.held.size).toBe(2);

    invoke.release();
    expect(shortcut.held.size).toBe(0);
    expect(shortcut.api.isRegistered('Alt+A')).toBe(false);
    expect(shortcut.api.isRegistered('Alt+Shift+A')).toBe(false);
  });

  it('release is idempotent and safe before registration', () => {
    const { shortcut, deps } = harness();
    const invoke = createGlobalInvoke(deps);
    expect(() => invoke.release()).not.toThrow();
    invoke.register();
    invoke.release();
    expect(() => invoke.release()).not.toThrow();
    expect(shortcut.held.size).toBe(0);
  });

  it('releaseAll of the backend is never used, so unrelated chords are left alone', () => {
    const { shortcut, deps } = harness();
    const unregisterAll = vi.spyOn(shortcut.api, 'unregisterAll');
    const invoke = createGlobalInvoke(deps);
    invoke.register();
    invoke.release();
    expect(unregisterAll).not.toHaveBeenCalled();
  });
});

describe('globalInvoke behaviour', () => {
  it('bring-to-front chord brings the window forward and opens nothing', () => {
    const { shortcut, brought, invoked, deps } = harness();
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+Shift+A')?.();

    expect(brought).toHaveLength(1);
    expect(brought[0]?.windowId).toBe(7);
    expect(invoked).toHaveLength(0);
  });

  it('THE CORRECTION: the invoke chord opens the overlay and NEVER brings Papers forward', () => {
    const { shortcut, brought, overlay, deps } = harness();
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();

    expect(overlay.opened).toBe(1);
    // Papers keeps its place in the z-order. This is a launcher, not a switcher.
    expect(brought).toHaveLength(0);
  });

  it('reports the overlay as opened over the current application', async () => {
    const calls: GlobalInvokeReport[] = [];
    const { shortcut, deps } = harness({ report: (r) => calls.push(r) });
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.at(-1)?.outcome).toBe('overlay-opened');
    expect(calls.at(-1)?.chord).toBe('invoke');
  });

  it('reports a refusal visibly and still does not raise Papers', async () => {
    const calls: GlobalInvokeReport[] = [];
    const { shortcut, brought, deps } = harness({
      overlay: {
        open: async () => ({ ok: false, detail: 'no project is open in Papers' }),
        close: async () => undefined,
        isOpen: () => false,
      },
      report: (r) => calls.push(r),
    });
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();
    await new Promise((r) => setTimeout(r, 0));

    // It must not appear to do nothing: the reason is reported...
    expect(calls.at(-1)?.outcome).toBe('overlay-unavailable');
    expect(calls.at(-1)?.detail).toBe('no project is open in Papers');
    // ...and Papers was still not brought forward.
    expect(brought).toHaveLength(0);
  });

  it('asks the overlay to open again when the chord is pressed again, instead of closing it', () => {
    // The creator pressed Alt+A a second time expecting an empty, focused line.
    // Closing the overlay here (or merely refocusing the window) leaves the
    // project with no event to clear on, which is the reported defect. The
    // chord re-invokes; the overlay decides what "already open" means.
    const { shortcut, overlay, deps } = harness();
    overlay.isOpenValue = true;
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();

    expect(overlay.closed).toEqual([]);
    expect(overlay.opened).toBe(1);
  });

  it('reports an overlay that throws instead of leaving the creator guessing', async () => {
    const calls: GlobalInvokeReport[] = [];
    const { shortcut, deps } = harness({
      overlay: {
        open: async () => { throw new Error('renderer refused'); },
        close: async () => undefined,
        isOpen: () => false,
      },
      report: (r) => calls.push(r),
    });
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.at(-1)?.outcome).toBe('overlay-unavailable');
    expect(calls.at(-1)?.detail).toContain('renderer refused');
  });

  it('reports the overlay as unavailable when this build has none, without raising Papers', () => {
    const calls: GlobalInvokeReport[] = [];
    const { shortcut, brought, deps } = harness({ overlay: undefined, report: (r) => calls.push(r) });
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+A')?.();

    expect(calls.at(-1)?.outcome).toBe('overlay-unavailable');
    expect(brought).toHaveLength(0);
  });

  it('does nothing when no window exists to bring forward', () => {
    const calls: GlobalInvokeReport[] = [];
    const { shortcut, brought, deps } = harness({
      currentWindowId: () => null,
      report: (r) => calls.push(r),
    });
    createGlobalInvoke(deps).register();

    shortcut.callbacks.get('Alt+Shift+A')?.();

    expect(brought).toHaveLength(0);
    expect(calls.at(-1)?.outcome).toBe('window-unavailable');
  });
});

describe('globalInvoke defaults', () => {
  it('defaults are exactly the two chords the creator asked for', () => {
    expect(DEFAULT_INVOKE_ACCELERATORS).toEqual({
      invoke: 'Alt+A',
      bringToFront: 'Alt+Shift+A',
    });
  });

  it('chords come from the injected configuration, not from hardcoded literals at the call site', () => {
    const { shortcut, deps } = harness({
      accelerators: { invoke: 'Ctrl+Alt+J', bringToFront: 'Ctrl+Alt+K' },
    });
    const report = createGlobalInvoke(deps).register();
    expect(report.registered).toEqual(['Ctrl+Alt+K', 'Ctrl+Alt+J']);
  });
});
