import { describe, expect, it, vi } from 'vitest';

import { bringWindowToFront, type FrontableWindow } from '../../src/main/windows/windowFront';

/**
 * The sequences here mirror what was MEASURED on Electron 43.1.1
 * (probes/electron-front-probe.mjs, output in the round-four record):
 *   - after minimize():  isMinimized=true, isVisible=false
 *   - after show()+focus(): isMinimized=false, isVisible=true
 *   - focus() alone on a minimised window does NOT clear isMinimized
 *   - a hidden window reports isVisible=false and needs show()
 */
function fakeWindow(state: { minimized?: boolean; visible?: boolean; destroyed?: boolean } = {}) {
  const calls: string[] = [];
  const window: FrontableWindow = {
    isDestroyed: () => state.destroyed ?? false,
    isMinimized: () => state.minimized ?? false,
    isVisible: () => state.visible ?? true,
    restore: () => { calls.push('restore'); state.minimized = false; },
    show: () => { calls.push('show'); state.visible = true; },
    focus: () => { calls.push('focus'); },
    moveTop: () => { calls.push('moveTop'); },
  };
  return { window, calls };
}

describe('bringWindowToFront', () => {
  it('a visible window behind another application is focused and re-stacked', () => {
    const { window, calls } = fakeWindow({ minimized: false, visible: true });
    const result = bringWindowToFront(window);

    expect(result.ok).toBe(true);
    expect(calls).toEqual(['focus', 'moveTop']);
    expect(result.observed.wasMinimized).toBe(false);
    expect(result.observed.wasVisible).toBe(true);
    expect(result.detail).toContain('focused');
  });

  it('a minimised window is RESTORED, because focus() alone does not unminimise it', () => {
    const { window, calls } = fakeWindow({ minimized: true, visible: false });
    const result = bringWindowToFront(window);

    expect(result.ok).toBe(true);
    // restore must come before show/focus; this is the measured Windows order.
    expect(calls.indexOf('restore')).toBeLessThan(calls.indexOf('focus'));
    expect(calls).toContain('show');
    expect(calls).toContain('moveTop');
    expect(result.observed.wasMinimized).toBe(true);
    expect(result.observed.restored).toBe(true);
    expect(result.detail).toContain('restored');
  });

  it('a hidden window is shown, because a hidden window cannot take focus', () => {
    const { window, calls } = fakeWindow({ minimized: false, visible: false });
    const result = bringWindowToFront(window);

    expect(result.ok).toBe(true);
    expect(calls).toContain('show');
    expect(result.observed.shown).toBe(true);
  });

  it('never pins the window on top: no topmost call exists in this path', () => {
    const { window, calls } = fakeWindow();
    bringWindowToFront(window);
    // The whole surface is structural: this asserts the sequence stays the
    // re-stack one and does not grow an always-on-top step.
    expect(calls).toEqual(['focus', 'moveTop']);
  });

  it('refuses a destroyed window instead of pretending it came forward', () => {
    const { window, calls } = fakeWindow({ destroyed: true });
    const result = bringWindowToFront(window);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(result.detail).toContain('no longer exists');
  });

  it('refuses a missing window rather than throwing', () => {
    for (const missing of [null, undefined]) {
      const result = bringWindowToFront(missing);
      expect(result.ok).toBe(false);
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it('reports what it observed so a caller never has to trust one boolean', () => {
    const { window } = fakeWindow({ minimized: true, visible: false });
    const result = bringWindowToFront(window);
    expect(result.observed).toEqual({
      wasMinimized: true,
      wasVisible: false,
      restored: true,
      shown: true,
      focused: true,
      raised: true,
    });
  });
});
