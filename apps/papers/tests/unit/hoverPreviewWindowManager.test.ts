import { describe, expect, it, vi } from 'vitest';

import { createHoverPreviewWindowManager } from '../../src/main/windows/hoverPreviewWindowManager';

function fakeWindow() {
  let destroyed = false;
  let bounds = { x: 0, y: 0, width: 1, height: 1 };
  const closed: Array<() => void> = [];
  return {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true; for (const fn of closed) fn(); }),
    getBounds: () => ({ ...bounds }),
    setPosition: vi.fn((x: number, y: number) => { bounds = { ...bounds, x, y }; }),
    setBounds: vi.fn((next: typeof bounds) => { bounds = { ...next }; }),
    setIgnoreMouseEvents: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    showInactive: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => { if (event === 'closed') closed.push(fn); }),
    loadURL: vi.fn(async () => undefined),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      isLoadingMainFrame: () => false,
      once: vi.fn(),
      executeJavaScript: vi.fn(async () => true),
    },
  };
}

const preview = {
  imageUrl: 'data:image/png;base64,AAAA',
  title: 'Window',
  width: 100,
  height: 80,
  anchor: { x: 100, y: 100, width: 20, height: 20 },
};

describe('hover preview window manager', () => {
  it('owns one reusable preview window per sender and destroys it on hide', async () => {
    const created: ReturnType<typeof fakeWindow>[] = [];
    let destroyedHandler: (() => void) | null = null;
    const sender = {
      id: 7,
      once: vi.fn((event: string, fn: () => void) => {
        if (event === 'destroyed') destroyedHandler = fn;
      }),
    };
    const manager = createHoverPreviewWindowManager({
      createWindow: (() => {
        const window = fakeWindow();
        created.push(window);
        return window as never;
      }) as never,
      ownerFromWebContents: () => null,
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 500, height: 500 } }),
    });

    manager.show(sender as never, preview, 'anchor');
    await Promise.resolve();
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(created[0]!.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(created[0]!.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(created[0]!.loadURL).toHaveBeenCalledOnce();

    manager.show(sender as never, preview, 'anchor');
    expect(created).toHaveLength(1);
    expect(created[0]!.loadURL).toHaveBeenCalledOnce();

    manager.hide(sender.id);
    expect(created[0]!.destroy).toHaveBeenCalledOnce();

    // The sender lifecycle is wired to the same owner operation and remains
    // idempotent after an explicit hide.
    const runDestroyed = destroyedHandler as unknown as (() => void) | null;
    runDestroyed?.();
    expect(created[0]!.destroy).toHaveBeenCalledOnce();
  });

  it('dispose closes every owned preview window', () => {
    const created: ReturnType<typeof fakeWindow>[] = [];
    const manager = createHoverPreviewWindowManager({
      createWindow: (() => {
        const window = fakeWindow();
        created.push(window);
        return window as never;
      }) as never,
      ownerFromWebContents: () => null,
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 500, height: 500 } }),
    });
    const sender = (id: number) => ({ id, once: vi.fn() });

    manager.show(sender(1) as never, preview, 'anchor');
    manager.show(sender(2) as never, preview, 'anchor');
    expect(created).toHaveLength(2);

    manager.dispose();
    expect(created[0]!.destroy).toHaveBeenCalledOnce();
    expect(created[1]!.destroy).toHaveBeenCalledOnce();
  });
});
