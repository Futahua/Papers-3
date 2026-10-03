import { describe, expect, it } from 'vitest';

import {
  TOGGLE_RULE,
  createWindowToggle,
  type WindowToggleDependencies,
} from '../../src/main/windows/windowToggle';

/**
 * The judgement in this feature is not the boolean: it is what "Papers is the
 * foreground window" means across the cases a creator actually produces -
 * visible but unfocused, focused on another monitor, partially covered, several
 * windows with one focused. Every case below is a decision, and the rule has to
 * be the one a person would predict without reading it.
 */
function harness(overrides: Partial<WindowToggleDependencies> = {}) {
  const calls: string[] = [];
  const reported: Array<{ outcome: string; detail: string }> = [];
  const deps: WindowToggleDependencies = {
    // The window the creator is looking at, when Papers owns the foreground.
    foregroundPapersWindowId: () => null,
    // The window to raise when Papers does not own the foreground.
    currentWindowId: () => 7,
    isForeground: () => false,
    minimize: (windowId) => { calls.push(`minimize:${windowId}`); return true; },
    bringToFront: (windowId) => { calls.push(`bring:${windowId}`); return { ok: true, detail: 'shown and focused' }; },
    nextWindowInZOrder: () => null,
    focusWindow: (handle) => { calls.push(`focus:${handle}`); return true; },
    report: (report) => { reported.push(report); },
    ...overrides,
  };
  return { deps, calls, reported };
}

describe('the toggle rule, stated once', () => {
  it('states the rule as one sentence a person would predict', async () => {
    expect(TOGGLE_RULE).toBe(
      'If the window you are looking at is Papers, the chord minimises it; otherwise the chord brings Papers forward.',
    );
  });
});

describe('alt+shift+a: bring forward', () => {
  it('Papers not in the foreground: brings it forward and does not minimise', async () => {
    const h = harness({ isForeground: () => false });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('brought-forward');
    expect(h.calls).toEqual(['bring:7']);
  });

  it('Papers VISIBLE but not focused counts as not-foreground, so it is raised not minimized', async () => {
    // The case the brief asked to be thought about: visible is not foreground.
    const h = harness({ isForeground: () => false });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('brought-forward');
    expect(h.calls.some((c) => c.startsWith('minimize'))).toBe(false);
  });

  it('Papers focused on ANOTHER monitor still counts as foreground, so it minimizes', async () => {
    // "Which monitor" is not part of the question. Foreground is foreground.
    const h = harness({ isForeground: () => true, foregroundPapersWindowId: () => 7 });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('minimized');
  });

  it('Papers PARTIALLY COVERED but focused minimizes, because it is in front', async () => {
    const h = harness({ isForeground: () => true, foregroundPapersWindowId: () => 7 });
    await createWindowToggle(h.deps).invoke();

    expect(h.calls).toContain('minimize:7');
  });

  it('several Papers windows, one focused: the FOCUSED one is toggled, not the most recent', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 12,
      currentWindowId: () => 7, // a different, more recent window
    });
    await createWindowToggle(h.deps).invoke();

    expect(h.calls).toContain('minimize:12');
    expect(h.calls).not.toContain('minimize:7');
    expect(h.calls.some((c) => c.startsWith('bring'))).toBe(false);
  });

  it('no Papers window at all: reports unavailability rather than doing nothing silently', async () => {
    const h = harness({ currentWindowId: () => null, foregroundPapersWindowId: () => null });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('window-unavailable');
    expect(result.detail.length).toBeGreaterThan(0);
  });
});

describe('alt+shift+a: minimise, and where focus lands', () => {
  it('minimises the foreground Papers window', async () => {
    const h = harness({ isForeground: () => true, foregroundPapersWindowId: () => 7 });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('minimized');
    expect(h.calls).toContain('minimize:7');
    expect(h.calls.some((c) => c.startsWith('bring'))).toBe(false);
  });

  it('gives focus to the next window in the z-order rather than leaving it nowhere', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      nextWindowInZOrder: () => 0xABC,
      focusWindow: (handle) => { h.calls.push(`focus:${handle}`); return true; },
    });
    await createWindowToggle(h.deps).invoke();

    // 0xABC === 2748. Spelled out so the assertion cannot read as a different
    // number than the fixture.
    expect(h.calls).toContain('focus:2748');
  });

  it('reports which window it handed focus to', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      nextWindowInZOrder: () => 0xABC,
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.detail).toContain('focus');
    expect(result.focusHandedTo).toBe(0xABC);
  });

  it('says so when there is no window underneath to focus', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      nextWindowInZOrder: () => null,
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('minimized');
    expect(result.focusHandedTo).toBeNull();
    // Minimising still happened; only the focus choice is reported as absent.
    expect(h.calls).toContain('minimize:7');
  });

  it('reports a refused focus hand-off without pretending it worked', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      nextWindowInZOrder: () => 0xABC,
      focusWindow: () => false,
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.focusHandedTo).toBeNull();
    expect(result.detail).toContain('could not');
  });

  it('a refused focus hand-off does NOT undo the minimise', async () => {
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      nextWindowInZOrder: () => 0xABC,
      focusWindow: () => false,
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('minimized');
    expect(h.calls).toContain('minimize:7');
  });

  it('a minimisation that fails falls back to bringing Papers forward', async () => {
    // Prefer bringing forward over leaving the creator with nothing.
    const h = harness({
      isForeground: () => true,
      foregroundPapersWindowId: () => 7,
      minimize: () => false,
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('brought-forward');
    expect(h.calls).toContain('bring:7');
  });

  it('never minimises a window that is not a live Papers window', async () => {
    const h = harness({ isForeground: () => true, foregroundPapersWindowId: () => null, currentWindowId: () => 7 });
    const result = await createWindowToggle(h.deps).invoke();

    // Foreground is Papers by identity, but no owned window matches: raise
    // rather than minimise something we cannot name.
    expect(result.outcome).toBe('brought-forward');
    expect(h.calls.some((c) => c.startsWith('minimize'))).toBe(false);
  });
});

describe('the ambiguous-case preference', () => {
  it('when foreground cannot be determined at all, it brings forward rather than minimising', async () => {
    // An unwanted raise costs one more keypress; an unwanted minimise hides work.
    const h = harness({
      isForeground: () => { throw new Error('cannot determine'); },
    });
    const result = await createWindowToggle(h.deps).invoke();

    expect(result.outcome).toBe('brought-forward');
    expect(h.calls.some((c) => c.startsWith('minimize'))).toBe(false);
  });

  it('an unknown-origin foreground never minimises', async () => {
    const h = harness({ isForeground: () => true, foregroundPapersWindowId: () => null });
    await createWindowToggle(h.deps).invoke();

    expect(h.calls.some((c) => c.startsWith('minimize'))).toBe(false);
  });
});
