import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPACT_WIDGET_TOPMOST_LEVEL, focusSurfaceForForeignActivation } from '../../src/main/windows/activationSurfaceFocus';

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
    const release = await focusSurfaceForForeignActivation(fake.window, COMPACT_WIDGET_TOPMOST_LEVEL);

    expect(COMPACT_WIDGET_TOPMOST_LEVEL).toBe('screen-saver');
    expect(release).toBeTypeOf('function');
    expect(fake.calls).toEqual(['focusable:true', 'focus']);

    release?.();
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:screen-saver',
      'moveTop',
    ]);
    expect(fake.window.isFocusable()).toBe(false);
    expect(fake.window.isAlwaysOnTop()).toBe(true);

    vi.advanceTimersByTime(400);
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:screen-saver',
      'moveTop',
      'topmost:true:screen-saver',
      'moveTop',
      'topmost:true:screen-saver',
      'moveTop',
    ]);
  });

  it('wires compact widget creation and activation to the strongest topmost band', async () => {
    const source = await readFile(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
    expect(source.match(/setAlwaysOnTop\(true, COMPACT_WIDGET_TOPMOST_LEVEL\)/g)).toHaveLength(2);
    expect(source).toMatch(/surface\?\.kind === COMPACT_WIDGET_SURFACE_KIND \? COMPACT_WIDGET_TOPMOST_LEVEL : 'floating'/);
  });

  it('keeps the old floating default for unrelated topmost surfaces', async () => {
    const fake = fakeWindow({ focusable: false, alwaysOnTop: true });
    const release = await focusSurfaceForForeignActivation(fake.window);
    release?.();

    expect(fake.calls).toContain('topmost:true:floating');
    expect(fake.calls).not.toContain('topmost:true:screen-saver');
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
    const release = await focusSurfaceForForeignActivation(fake.window, COMPACT_WIDGET_TOPMOST_LEVEL);

    expect(release).toBeNull();
    expect(fake.calls).toEqual([
      'focusable:true',
      'focus',
      'focusable:false',
      'topmost:true:screen-saver',
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
