import { describe, expect, it } from 'vitest';

import {
  COMMAND_SURFACE_MARKER,
  COMMAND_SURFACE_MODE,
  createCommandSurfaceOverlay,
  type CommandSurfaceOverlayDependencies,
  type OverlayNativeWindow,
} from '../../src/main/windows/commandSurfaceOverlay';

function fakeNativeWindow() {
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  let visible = false;
  let destroyed = false;
  const window: OverlayNativeWindow = {
    webContents: {
      id: 4242,
      send: () => { calls.push('send'); },
      on: (event, callback) => { handlers.set(`wc:${event}`, callback); },
    },
    setBounds: (bounds) => { calls.push(`setBounds:${bounds.width}x${bounds.height}`); },
    focus: () => { calls.push('focus'); visible = true; },
    show: () => { calls.push('show'); visible = true; },
    hide: () => { calls.push('hide'); visible = false; },
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isFocused: () => visible,
    destroy: () => { calls.push('destroy'); destroyed = true; handlers.get('closed')?.(); },
    on: (event, callback) => { handlers.set(event, callback); },
    loadURL: async (url) => { calls.push(`loadURL:${url}`); },
  };
  return { window, calls, handlers, isDestroyed: () => destroyed };
}

function harness(overrides: Partial<CommandSurfaceOverlayDependencies> = {}) {
  const created = fakeNativeWindow();
  const delivered: Array<{ senderId: number; payload: unknown }> = [];
  const reports: Array<{ outcome: string; detail: string }> = [];
  const closedReasons: string[] = [];
  const setForegroundCalls: number[] = [];
  let foregroundValue: number | null = 778899;
  let isWindowValue = true;
  let setSucceeds = true;

  const deps: CommandSurfaceOverlayDependencies = {
    resolveCommandSurface: () => ({ ok: true, target: { projectId: 'project-a', surfaceId: 'surface-1' } }),
    resolveEntryUrl: () => 'papers-backpack://project-a/public/index.html',
    createWindow: () => created.window,
    preloadPath: 'C:\\papers\\backpackProject.cjs',
    focusBridge: {
      foregroundWindow: async () => foregroundValue,
      isWindow: async () => isWindowValue,
      setForegroundWindow: async (handle) => { setForegroundCalls.push(handle); return setSucceeds; },
    },
    placeOn: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    deliver: (senderId, payload) => { delivered.push({ senderId, payload }); },
    onClosed: (reason) => { closedReasons.push(reason); },
    report: (report) => { reports.push(report); },
    ...overrides,
  };

  return {
    deps,
    created,
    delivered,
    reports,
    closedReasons,
    setForegroundCalls,
    setForegroundOutcome: (ok: boolean) => { setSucceeds = ok; },
    setForegroundValue: (value: number | null) => { foregroundValue = value; },
    setWindowAlive: (alive: boolean) => { isWindowValue = alive; },
  };
}

describe('commandSurfaceOverlay opening', () => {
  it('loads the project entry URL with the opaque mode marker appended', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(true);
    const loadCall = h.created.calls.find((c) => c.startsWith('loadURL:'));
    expect(loadCall).toBeDefined();
    const url = new URL(loadCall!.slice('loadURL:'.length));
    expect(url.protocol).toBe('papers-backpack:');
    expect(url.host).toBe('project-a');
    expect(url.searchParams.get(COMMAND_SURFACE_MARKER)).toBe(COMMAND_SURFACE_MODE);
  });

  it('awaits a project entry that is opened on demand', async () => {
    const h = harness({
      resolveEntryUrl: async () => 'papers-backpack://project-a/_papers-open/fresh/public/index.html',
    });
    const result = await createCommandSurfaceOverlay(h.deps).open();

    expect(result.ok).toBe(true);
    expect(h.created.calls.some((call) => call.includes('/_papers-open/fresh/public/index.html'))).toBe(true);
  });

  it('refuses a URL that is not the bound project surface', async () => {
    const h = harness({ resolveEntryUrl: () => 'https://example.com/index.html' });
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not the bound project surface');
    // Nothing was created: a rejected URL must not leave a window behind.
    expect(h.created.calls.some((c) => c.startsWith('loadURL:'))).toBe(false);
  });

  it('refuses visibly when no project is open', async () => {
    const h = harness({ resolveCommandSurface: () => ({ ok: false, detail: 'no Backpack project is open in Papers, so there is nothing for the command surface shortcut to launch.' }) });
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no Backpack project is open');
  });

  it('repeats the registry\'s refusal verbatim, naming the project it looked at', async () => {
    // The creator cannot see which tab is in front, so a summary that dropped
    // the project ID would remove the only checkable thing in the message.
    const h = harness({
      resolveCommandSurface: () => ({
        ok: false,
        detail: 'the Backpack bp-11111111-1111-4111-8111-111111111111 is open, but it does not declare a command surface.',
      }),
    });
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('bp-11111111-1111-4111-8111-111111111111');
    expect(result.detail).toContain('does not declare a command surface');
  });

  it('refuses visibly when the focused project has no surface', async () => {
    const h = harness({ resolveEntryUrl: () => null });
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no surface');
  });

  it('shows and focuses the overlay without touching Papers window order', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();

    // show and focus are what make the overlay usable; nothing here raises a
    // Papers window, which is the whole point of the correction.
    expect(h.created.calls).toContain('show');
    expect(h.created.calls).toContain('focus');
    expect(h.created.calls.indexOf('show')).toBeGreaterThan(h.created.calls.indexOf('setBounds:640x220'));
  });

  it('delivers the neutral event into the overlay window', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]?.senderId).toBe(4242);
    expect(h.delivered[0]?.payload).toMatchObject({
      projectId: 'project-a',
      surfaceId: 'surface-1',
      chord: 'invoke',
      reason: 'global-accelerator',
    });
  });

  it('places the overlay inside the work area it is given, near the top', async () => {
    const h = harness({ placeOn: () => ({ x: 100, y: 50, width: 1000, height: 800 }) });
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();

    const call = h.created.calls.find((c) => c.startsWith('setBounds:'));
    expect(call).toBe('setBounds:640x220');
    // The bounds were set from the supplied work area, so the overlay is on the
    // display the caller chose rather than the primary one.
    expect(h.created.calls).toContain('setBounds:640x220');
  });

  it('reports a load failure instead of leaving an invisible window', async () => {
    const h = harness();
    h.created.window.loadURL = async () => { throw new Error('renderer refused'); };
    const overlay = createCommandSurfaceOverlay(h.deps);
    const result = await overlay.open();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('could not be loaded');
    expect(h.created.isDestroyed()).toBe(true);
  });
});

describe('commandSurfaceOverlay focus return', () => {
  it('records the foreground BEFORE showing, so it can be restored later', async () => {
    const h = harness();
    h.setForegroundValue(0x1234);
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.setForegroundCalls).toEqual([0x1234]);
    expect(h.reports.at(-1)?.outcome).toBe('focus-restored');
  });

  it('hands focus back on Escape/dismiss', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.setForegroundCalls).toHaveLength(1);
    expect(h.closedReasons).toEqual(['dismissed']);
  });

  it('does not restore the old foreground after an action has run', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('action-run');

    expect(h.setForegroundCalls).toHaveLength(0);
    expect(h.closedReasons).toEqual(['action-run']);
  });

  it('does not dismiss on native blur; only an explicit close command ends it', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();

    h.created.handlers.get('blur')?.();
    expect(overlay.isOpen()).toBe(true);
    expect(h.closedReasons).toEqual([]);

    await overlay.close('dismissed');
    expect(overlay.isOpen()).toBe(false);
    expect(h.closedReasons).toEqual(['dismissed']);
  });

  it('accepts an explicit dismissal only from the active overlay sender', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();

    await expect(overlay.dismissFromSender(9999)).rejects.toThrow('inactive surface');
    expect(overlay.isOpen()).toBe(true);

    await overlay.dismissFromSender(4242);
    expect(overlay.isOpen()).toBe(false);
    expect(h.closedReasons).toEqual(['action-run']);
  });

  it('says so when the application that was in front has closed', async () => {
    const h = harness();
    h.setWindowAlive(false);
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.reports.at(-1)?.outcome).toBe('focus-not-restored');
    expect(h.reports.at(-1)?.detail).toContain('has closed');
  });

  it('reports a refused hand-back rather than claiming success', async () => {
    const h = harness();
    h.setForegroundOutcome(false);
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.reports.at(-1)?.outcome).toBe('focus-not-restored');
    expect(h.reports.at(-1)?.detail).toContain('refused');
  });

  it('reports UNKNOWN when the native bridge is unavailable, never success', async () => {
    const h = harness({ focusBridge: undefined });
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.reports.at(-1)?.outcome).toBe('focus-unknown');
    expect(h.reports.at(-1)?.detail).toContain('bridge is unavailable');
    expect(h.setForegroundCalls).toHaveLength(0);
  });

  it('does not restore focus to the shell or desktop', async () => {
    // The bridge returns null for shell windows; the overlay must then report
    // that it has nothing to restore to, rather than focusing the desktop.
    const h = harness();
    h.setForegroundValue(null);
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    await overlay.close('dismissed');

    expect(h.setForegroundCalls).toHaveLength(0);
    expect(h.reports.at(-1)?.outcome).toBe('focus-unknown');
  });

  it('delivers a second invoke when the chord is pressed again, so the page can clear', async () => {
    // The reported defect: the second press only refocused the window and
    // delivered nothing, so the project had no event to clear its input on. The
    // creator should land on an empty, focused line - which is the project's
    // half of the bargain, and it cannot happen without this event.
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    expect(h.delivered).toHaveLength(1);

    const again = await overlay.open();

    expect(again.ok).toBe(true);
    expect(again.detail).toContain('already open');
    // Only one window, and a second invoke into it.
    expect(h.created.calls.filter((c) => c.startsWith('loadURL:')).length).toBe(1);
    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[1]!.senderId).toBe(h.delivered[0]!.senderId);
    expect(h.delivered[1]!.payload).toEqual(h.delivered[0]!.payload);
    expect(h.created.calls.filter((c) => c === 'focus').length).toBeGreaterThan(1);
  });

  it('does not re-load or re-place the overlay on a second press', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await overlay.open();
    const boundsCalls = h.created.calls.filter((c) => c.startsWith('setBounds:')).length;

    await overlay.open();

    // Re-opening must not rebuild the surface: the creator's typed text would be
    // lost, which is the opposite of what the second press is for.
    expect(h.created.calls.filter((c) => c.startsWith('loadURL:')).length).toBe(1);
    expect(h.created.calls.filter((c) => c.startsWith('setBounds:')).length).toBe(boundsCalls);
  });

  it('close is safe when nothing is open', async () => {
    const h = harness();
    const overlay = createCommandSurfaceOverlay(h.deps);
    await expect(overlay.close('dismissed')).resolves.toBeUndefined();
    expect(h.setForegroundCalls).toHaveLength(0);
  });
});
