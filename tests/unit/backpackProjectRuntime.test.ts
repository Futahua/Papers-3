import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseWindow, WebContentsView } from 'electron';
import { BackpackProjectRuntime } from '../../src/main/backpacks/backpackProjectRuntime';

/**
 * Backpack project surface lifecycle. hide() must detach and close the child
 * surface before the parent window is destroyed, be idempotent, and stay
 * safe when it arrives late — after the BaseWindow or the WebContents is
 * already destroyed. Electron cannot be instantiated under vitest's node
 * environment, so the minimal window/view boundary is mocked structurally;
 * the class under test is the real one.
 */

type FakeWebContents = {
  id: number;
  destroyed: boolean;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
};

type FakeView = {
  webContents: FakeWebContents;
  setBounds: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
};

const harness = vi.hoisted(() => ({
  window: {
    destroyed: false,
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  },
  views: [] as FakeView[],
}));

vi.mock('electron', () => ({
  BaseWindow: class {
    contentView = {
      addChildView: (view: unknown) => harness.window.addChildView(view),
      removeChildView: (view: unknown) => harness.window.removeChildView(view),
    };
    isDestroyed() {
      return harness.window.destroyed;
    }
    getContentBounds() {
      return { width: 800, height: 600 };
    }
  } as unknown as typeof BaseWindow,
  WebContentsView: class {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    setBackgroundColor = vi.fn();
    constructor() {
      const webContents: FakeWebContents = {
        id: harness.views.length + 1,
        destroyed: false,
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        isDestroyed() {
          return webContents.destroyed;
        },
      };
      this.webContents = webContents;
      harness.views.push(this);
    }
  } as unknown as typeof WebContentsView,
}));

const PROJECT_URL = 'papers-backpack://bp-004-test/entry/index.html';

beforeEach(() => {
  harness.window.destroyed = false;
  harness.window.addChildView.mockClear();
  harness.window.removeChildView.mockClear();
  harness.views.length = 0;
});

async function shownRuntime(): Promise<BackpackProjectRuntime> {
  const runtime = new BackpackProjectRuntime(new BaseWindow(), '/tmp/preload.cjs', false);
  await runtime.show(PROJECT_URL);
  expect(harness.views).toHaveLength(1);
  expect(harness.window.addChildView).toHaveBeenCalledWith(harness.views[0]);
  return runtime;
}

function soleView(): FakeView {
  const view = harness.views[0];
  expect(view).toBeDefined();
  return view as FakeView;
}

describe('BackpackProjectRuntime.hide', () => {
  it('forwards project loading lifecycle events from the live sender', async () => {
    const lifecycle = vi.fn();
    const runtime = new BackpackProjectRuntime(new BaseWindow(), '/tmp/preload.cjs', false, undefined, undefined, lifecycle);
    await runtime.show(PROJECT_URL);
    const view = soleView();
    const loading = view.webContents.on.mock.calls.find(([event]) => event === 'did-start-loading')?.[1] as (() => void) | undefined;
    const domReady = view.webContents.on.mock.calls.find(([event]) => event === 'dom-ready')?.[1] as (() => void) | undefined;
    loading?.();
    domReady?.();
    expect(lifecycle).toHaveBeenNthCalledWith(1, view.webContents.id, 'did-start-loading');
    expect(lifecycle).toHaveBeenNthCalledWith(2, view.webContents.id, 'dom-ready');
  });

  it('conceals and restores the same live renderer without closing it', async () => {
    const runtime = await shownRuntime();
    const view = soleView();

    runtime.conceal();

    expect(harness.window.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).not.toHaveBeenCalled();
    expect(runtime.senderId).toBe(view.webContents.id);

    await runtime.show(PROJECT_URL);

    expect(harness.views).toHaveLength(1);
    expect(harness.window.addChildView).toHaveBeenCalledTimes(2);
    expect(runtime.senderId).toBe(view.webContents.id);
  });

  it('registers one destroyed subscription across repeated presentations', async () => {
    const runtime = await shownRuntime();
    const view = soleView();
    const first = vi.fn();
    const latest = vi.fn();

    runtime.onFrameDestroyed(view.webContents.id, first);
    runtime.conceal();
    await runtime.show(PROJECT_URL);
    runtime.onFrameDestroyed(view.webContents.id, latest);

    expect(view.webContents.once).toHaveBeenCalledTimes(1);
    const destroyed = view.webContents.once.mock.calls[0]?.[1] as (() => void) | undefined;
    destroyed?.();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('detaches and closes the shown surface once', async () => {
    const runtime = await shownRuntime();
    const view = soleView();

    runtime.hide();

    expect(harness.window.removeChildView).toHaveBeenCalledTimes(1);
    expect(harness.window.removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(runtime.isSender(view.webContents as unknown as import('electron').WebContents)).toBe(false);
  });

  it('018V6: exposes the retained workspace entry only to its live matching sender', async () => {
    const runtime = new BackpackProjectRuntime(new BaseWindow(), '/tmp/preload.cjs', false);
    await runtime.show(PROJECT_URL);
    const view = soleView();
    expect(runtime.entryUrlFor(view.webContents as unknown as import('electron').WebContents, 'bp-004-test')).toBe(PROJECT_URL);
    expect(runtime.entryUrlFor(view.webContents as unknown as import('electron').WebContents, 'bp-other')).toBeNull();
    runtime.hide();
    expect(runtime.entryUrlFor(view.webContents as unknown as import('electron').WebContents, 'bp-004-test')).toBeNull();
  });

  it('018V6R: destroyed listener clears identity, notifies closure, and rejects other senders', async () => {
    const closed: string[] = [];
    const runtime = new BackpackProjectRuntime(new BaseWindow(), '/tmp/preload.cjs', false, (projectId) => closed.push(projectId));
    await runtime.show(PROJECT_URL);
    const view = soleView();
    expect(runtime.entryUrlFor({ id: 999 } as import('electron').WebContents, 'bp-004-test')).toBeNull();
    const destroyed = view.webContents.on.mock.calls.find(([event]) => event === 'destroyed')?.[1] as (() => void) | undefined;
    expect(destroyed).toBeTypeOf('function');
    destroyed!();
    expect(runtime.entryUrlFor(view.webContents as unknown as import('electron').WebContents, 'bp-004-test')).toBeNull();
    expect(closed).toEqual(['bp-004-test']);
  });

  it('018X2: custom-scheme navigation is restricted to the exact project host', async () => {
    await shownRuntime();
    const view = soleView();
    const navigation = view.webContents.on.mock.calls.find(([event]) => event === 'will-navigate')?.[1] as
      ((event: { preventDefault: () => void }, target: string) => void) | undefined;
    expect(navigation).toBeTypeOf('function');
    const blocked = vi.fn();
    navigation!({ preventDefault: blocked }, 'papers-backpack://bp-other/entry/index.html');
    expect(blocked).toHaveBeenCalledTimes(1);
    navigation!({ preventDefault: blocked }, 'papers-backpack://bp-004-test/entry/next.html');
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second hide does nothing', async () => {
    const runtime = await shownRuntime();
    const view = soleView();

    runtime.hide();
    runtime.hide();

    expect(harness.window.removeChildView).toHaveBeenCalledTimes(1);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it('with nothing shown is a safe no-op', () => {
    const runtime = new BackpackProjectRuntime(new BaseWindow(), '/tmp/preload.cjs', false);

    expect(() => runtime.hide()).not.toThrow();
    expect(harness.window.removeChildView).not.toHaveBeenCalled();
  });

  it('arriving after the parent window is destroyed skips removal but still closes the view', async () => {
    const runtime = await shownRuntime();
    const view = soleView();
    harness.window.destroyed = true;

    runtime.hide();

    expect(harness.window.removeChildView).not.toHaveBeenCalled();
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it('arriving after the webContents is destroyed skips close but still removes the view', async () => {
    const runtime = await shownRuntime();
    const view = soleView();
    view.webContents.destroyed = true;

    runtime.hide();

    expect(harness.window.removeChildView).toHaveBeenCalledTimes(1);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('arriving after both are destroyed touches neither', async () => {
    const runtime = await shownRuntime();
    const view = soleView();
    harness.window.destroyed = true;
    view.webContents.destroyed = true;

    runtime.hide();

    expect(harness.window.removeChildView).not.toHaveBeenCalled();
    expect(view.webContents.close).not.toHaveBeenCalled();
  });
});
