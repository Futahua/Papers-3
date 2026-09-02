import { describe, expect, it, vi } from 'vitest';

import {
  attachVisualLifecycleMonitor,
  type VisualLifecycleSource,
} from '../../src/main/visual/visualLifecycleMonitor';
import {
  attachVisualResourceMonitor,
  type VisualResourceSource,
} from '../../src/main/visual/visualResourceMonitor';
import { createVisualDiagnosticBuffer } from '../../src/main/visual/visualDiagnostics';
import { installProjectVisualLayoutObserver } from '../../src/preload/projectVisualLayoutObserver';

class FakeLifecycleSource implements VisualLifecycleSource {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeResourceSource implements VisualResourceSource {
  errorListener: ((details: { webContentsId?: number; resourceType?: string; error?: string }) => void) | null = null;
  completedListener: ((details: { webContentsId?: number; resourceType?: string; error?: string; statusCode?: number }) => void) | null = null;

  onErrorOccurred = vi.fn((listener: typeof this.errorListener) => { this.errorListener = listener; });
  onCompleted = vi.fn((listener: typeof this.completedListener) => { this.completedListener = listener; });

  emitError(details: { webContentsId?: number; resourceType?: string; error?: string }): void {
    this.errorListener?.(details);
  }

  emitCompleted(details: { webContentsId?: number; resourceType?: string; error?: string; statusCode?: number }): void {
    this.completedListener?.(details);
  }
}

function layoutHarness() {
  let width = 100;
  let bodyAvailable = true;
  const frames: FrameRequestCallback[] = [];
  let mutationCallback: (() => void) | undefined;
  const rect = () => ({ x: 0, y: 0, width, height: 80 });
  const body = { getBoundingClientRect: rect, scrollWidth: 100, scrollHeight: 80 };
  const root = { getBoundingClientRect: rect, scrollWidth: 100, scrollHeight: 80 };
  const document = { documentElement: root, get body() { return bodyAvailable ? body : null; } } as unknown as Document;
  class FakeResizeObserver {
    observe(): void {}
  }
  class FakeMutationObserver {
    constructor(callback: () => void) { mutationCallback = callback; }
    observe(): void {}
  }
  const send = vi.fn();
  installProjectVisualLayoutObserver({ send }, {
    document,
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
    MutationObserver: FakeMutationObserver as unknown as typeof MutationObserver,
  });
  return {
    send,
    setWidth: (nextWidth: number) => { width = nextWidth; },
    setBodyAvailable: (available: boolean) => { bodyAvailable = available; },
    mutate: () => mutationCallback?.(),
    pendingFrames: () => frames.length,
    flushFrame: () => frames.shift()?.(0),
  };
}

describe('visual observation side effects', () => {
  it('uses event listeners only and becomes inert after lifecycle/resource detach', () => {
    const lifecycleSource = new FakeLifecycleSource();
    const resourceSource = new FakeResourceSource();
    const buffer = createVisualDiagnosticBuffer();
    const recovery = { reload: vi.fn(), loadURL: vi.fn(), restart: vi.fn() };
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const setTimeout = vi.spyOn(globalThis, 'setTimeout');
    const lifecycle = attachVisualLifecycleMonitor(lifecycleSource, { windowId: 7, surfaceId: 'surface-a' }, buffer);
    const resource = attachVisualResourceMonitor(
      resourceSource,
      () => ({ windowId: 7, surfaceId: 'surface-a' }),
      () => buffer,
    );

    lifecycleSource.emit('did-start-loading');
    lifecycleSource.emit('console-message', {}, 3, 'visual signal');
    resourceSource.emitError({ webContentsId: 12, resourceType: 'image', error: 'network failed' });
    resourceSource.emitCompleted({ webContentsId: 12, resourceType: 'script', statusCode: 404 });
    expect(buffer.snapshot()).toHaveLength(4);
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(recovery.loadURL).not.toHaveBeenCalled();
    expect(recovery.restart).not.toHaveBeenCalled();

    lifecycle.detach();
    resource.detach();
    expect(lifecycleSource.listenerCount()).toBe(0);
    expect(resourceSource.onErrorOccurred).toHaveBeenLastCalledWith(null);
    expect(resourceSource.onCompleted).toHaveBeenLastCalledWith(null);
    lifecycleSource.emit('dom-ready');
    resourceSource.emitError({ webContentsId: 12, resourceType: 'font', error: 'late failure' });
    resourceSource.emitCompleted({ webContentsId: 12, resourceType: 'stylesheet', statusCode: 503 });
    expect(buffer.snapshot()).toHaveLength(4);

    setInterval.mockRestore();
    setTimeout.mockRestore();
  });

  it('coalesces layout mutations and ends every epoch at a bounded frame count', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const setTimeout = vi.spyOn(globalThis, 'setTimeout');
    const stable = layoutHarness();
    expect(stable.pendingFrames()).toBe(1);
    stable.mutate();
    stable.mutate();
    stable.mutate();
    expect(stable.pendingFrames()).toBe(1);
    stable.flushFrame();
    stable.flushFrame();
    stable.flushFrame();
    expect(stable.send).toHaveBeenCalledTimes(1);
    expect(stable.pendingFrames()).toBe(0);

    const timeout = layoutHarness();
    timeout.setBodyAvailable(false);
    for (let frame = 0; frame < 12; frame += 1) timeout.flushFrame();
    expect(timeout.send).toHaveBeenCalledTimes(1);
    expect(timeout.pendingFrames()).toBe(0);
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    setInterval.mockRestore();
    setTimeout.mockRestore();
  });
});
