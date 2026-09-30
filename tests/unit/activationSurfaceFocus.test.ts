import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { focusSurfaceForForeignActivation } from '../../src/main/windows/activationSurfaceFocus';

function fakeWindow(options: { focusable: boolean; alwaysOnTop: boolean; focusThrows?: boolean }) {
  let destroyed = false;
  let focusable = options.focusable;
  let alwaysOnTop = options.alwaysOnTop;
  const calls: string[] = [];

  return {
    calls,
    destroy: () => { destroyed = true; },
    window: {
      isDestroyed: () => destroyed,
      isFocusable: () => focusable,
      isAlwaysOnTop: () => alwaysOnTop,
      setFocusable(flag: boolean) {
        focusable = flag;
        calls.push(`focusable:${flag}`);
        // Mirrors the Windows behavior already measured by the widget startup:
        // returning to NOACTIVATE can drop TOPMOST.
        if (!flag) alwaysOnTop = false;
      },
      setAlwaysOnTop(flag: boolean, level?: string) {
        alwaysOnTop = flag;
        calls.push(`topmost:${flag}:${level ?? ''}`);
      },
      focus() {
        calls.push('focus');
        if (options.focusThrows) throw new Error('focus failed');
      },
      moveTop() { calls.push('moveTop'); },
    },
  };
}

describe('focusSurfaceForForeignActivation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('restores a non-focusable topmost widget above the activated target', async () => {
    const fake = fakeWindow({ focusable: false, alwaysOnTop: true });
    const release = await focusSurfaceForForeignActivation(fake.window);

    expect(release).toBeTypeOf('function');
    expect(fake.calls).toEqual(['focusable:true', 'focus']);

    release?.();
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:floating',
      'moveTop',
    ]);
    expect(fake.window.isFocusable()).toBe(false);
    expect(fake.window.isAlwaysOnTop()).toBe(true);

    vi.advanceTimersByTime(400);
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:floating',
      'moveTop',
      'topmost:true:floating',
      'moveTop',
      'topmost:true:floating',
      'moveTop',
    ]);
  });

  it('does not accidentally pin an ordinary project surface', async () => {
    const fake = fakeWindow({ focusable: true, alwaysOnTop: false });
    const release = await focusSurfaceForForeignActivation(fake.window);
    release?.();

    expect(fake.calls).toEqual(['focusable:true', 'focus', 'focusable:true']);
    expect(fake.window.isAlwaysOnTop()).toBe(false);
  });

  it('restores the original policy if taking focus itself fails', async () => {
    const fake = fakeWindow({ focusable: false, alwaysOnTop: true, focusThrows: true });
    const release = await focusSurfaceForForeignActivation(fake.window);

    expect(release).toBeNull();
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:floating',
      'moveTop',
    ]);
  });

  it('does nothing on release after the surface was destroyed', async () => {
    const fake = fakeWindow({ focusable: false, alwaysOnTop: true });
    const release = await focusSurfaceForForeignActivation(fake.window);
    fake.destroy();
    release?.();
    vi.advanceTimersByTime(400);

    expect(fake.calls).toEqual(['focusable:true', 'focus']);
  });
});
