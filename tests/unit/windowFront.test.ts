import { describe, expect, it, vi } from 'vitest';

import { bringFirstWindowToFront, bringWindowToFront, type FrontableWindow } from '../../src/main/windows/windowFront';

/**
 * The sequences here mirror what was MEASURED on Electron 43.1.1
 * (probes/electron-front-probe.mjs, output in the round-four record):
 *   - after minimize():  isMinimized=true, isVisible=false
 *   - after show()+focus(): isMinimized=false, isVisible=true
 *   - focus() alone on a minimised window does NOT clear isMinimized
 *   - a hidden window reports isVisible=false and needs show()
 */
function fakeWindow(state: { minimized?: boolean; visible?: boolean; destroyed?: boolean; focused?: boolean } = {}) {
  const calls: string[] = [];
  const window: FrontableWindow = {
    isDestroyed: () => state.destroyed ?? false,
    isMinimized: () => state.minimized ?? false,
    isVisible: () => state.visible ?? true,
    restore: () => { calls.push('restore'); state.minimized = false; },
    show: () => { calls.push('show'); state.visible = true; },
    focus: () => { calls.push('focus'); state.focused = true; },
    moveTop: () => { calls.push('moveTop'); },
    isFocused: () => state.focused ?? false,
    getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0]),
  };
  return { window, calls };
}

describe('bringWindowToFront', () => {
  it('a visible window behind another application is focused and re-stacked', async () => {
    const { window, calls } = fakeWindow({ minimized: false, visible: true });
    const result = await bringWindowToFront(window);

    expect(result.ok).toBe(true);
    expect(calls).toEqual(['focus', 'moveTop']);
    expect(result.observed.wasMinimized).toBe(false);
    expect(result.observed.wasVisible).toBe(true);
    expect(result.detail).toContain('focused');
  });

  it('a minimised window is RESTORED, because focus() alone does not unminimise it', async () => {
    const { window, calls } = fakeWindow({ minimized: true, visible: false });
    const result = await bringWindowToFront(window);

    expect(result.ok).toBe(true);
    // restore must come before show/focus; this is the measured Windows order.
    expect(calls.indexOf('restore')).toBeLessThan(calls.indexOf('focus'));
    expect(calls).toContain('show');
    expect(calls).toContain('moveTop');
    expect(result.observed.wasMinimized).toBe(true);
    expect(result.observed.restored).toBe(true);
    expect(result.detail).toContain('restored');
  });

  it('a hidden window is shown, because a hidden window cannot take focus', async () => {
    const { window, calls } = fakeWindow({ minimized: false, visible: false });
    const result = await bringWindowToFront(window);

    expect(result.ok).toBe(true);
    expect(calls).toContain('show');
    expect(result.observed.shown).toBe(true);
  });

  it('never pins the window on top: no topmost call exists in this path', async () => {
    const { window, calls } = fakeWindow();
    await bringWindowToFront(window);
    // The whole surface is structural: this asserts the sequence stays the
    // re-stack one and does not grow an always-on-top step.
    expect(calls).toEqual(['focus', 'moveTop']);
  });

  it('refuses a destroyed window instead of pretending it came forward', async () => {
    const { window, calls } = fakeWindow({ destroyed: true });
    const result = await bringWindowToFront(window);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(result.detail).toContain('no longer exists');
  });

  it('refuses a missing window rather than throwing', async () => {
    for (const missing of [null, undefined]) {
      const result = await bringWindowToFront(missing);
      expect(result.ok).toBe(false);
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it('reports what it observed so a caller never has to trust one boolean', async () => {
    const { window } = fakeWindow({ minimized: true, visible: false });
    const result = await bringWindowToFront(window);
    expect(result.observed).toEqual({
      wasMinimized: true,
      wasVisible: false,
      restored: true,
      shown: true,
      focused: true,
      raised: true,
    });
  });

  it('uses native Windows activation and verifies foreground ownership', async () => {
    const { window } = fakeWindow({ focused: false });
    let activated = false;
    const nativeForeground = {
      setForegroundWindow: vi.fn(async (handle: number) => { activated = handle === 42; return activated; }),
      isForegroundWindow: vi.fn(async (handle: number) => activated && handle === 42),
    };
    const result = await bringWindowToFront(window, { platform: 'win32', nativeForeground });
    expect(result.ok).toBe(true);
    expect(nativeForeground.setForegroundWindow).toHaveBeenCalledWith(42);
    expect(result.observed.focused).toBe(true);
  });

  it('reports failure when Windows refuses foreground activation', async () => {
    const { window } = fakeWindow({ focused: false });
    const nativeForeground = {
      setForegroundWindow: vi.fn(async () => false),
      isForegroundWindow: vi.fn(async () => false),
    };
    const result = await bringWindowToFront(window, { platform: 'win32', nativeForeground });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('foreground');
  });

  it('retries briefly so the second-instance foreground permission handoff can arrive', async () => {
    const { window } = fakeWindow({ focused: false });
    let attempts = 0;
    const nativeForeground = {
      setForegroundWindow: vi.fn(async () => { attempts += 1; return attempts >= 3; }),
      isForegroundWindow: vi.fn(async () => attempts >= 3),
    };
    const result = await bringWindowToFront(window, {
      platform: 'win32',
      nativeForeground,
      nativeActivationRetryDelayMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(nativeForeground.setForegroundWindow).toHaveBeenCalledTimes(3);
  });

  it('converts a rejected native activation into an honest failure', async () => {
    const { window } = fakeWindow({ focused: false });
    const result = await bringWindowToFront(window, {
      platform: 'win32',
      nativeActivationAttempts: 2,
      nativeActivationRetryDelayMs: 0,
      nativeForeground: {
        setForegroundWindow: vi.fn(async () => { throw new Error('native bridge failed'); }),
        isForegroundWindow: vi.fn(async () => false),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('foreground');
  });

  it('the second-instance path tries another live Papers window after refusal', async () => {
    const first = fakeWindow({ focused: false });
    const second = fakeWindow({ focused: false });
    let attempts = 0;
    const result = await bringFirstWindowToFront([first.window, second.window], {
      platform: 'win32',
      nativeForeground: {
        setForegroundWindow: vi.fn(async () => ++attempts === 2),
        isForegroundWindow: vi.fn(async () => attempts === 2),
      },
    });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});
