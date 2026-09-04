import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createRegisteredPapersWindow, preparePapersWindow } from '../../src/main/windows/papersWindowLifecycle';
import type { PapersWindowInstance } from '../../src/main/windows/papersWindowFactory';

function windowStub() {
  const events = new EventEmitter() as EventEmitter & {
    id: number;
    isDestroyed: () => boolean;
    destroy: () => void;
  };
  events.id = 42;
  events.isDestroyed = () => false;
  events.destroy = vi.fn();
  return events;
}

function instance(loadHostRenderer: () => Promise<void>, id = 42): PapersWindowInstance {
  const window = windowStub();
  window.id = id;
  return {
    window: window as never,
    hostView: {} as never,
    projectSurfaces: { hideAll: vi.fn() } as never,
    loadHostRenderer,
  };
}

describe('prepared Papers window lifecycle', () => {
  it('registers before renderer activation and returns the registered instance', async () => {
    const order: string[] = [];
    const current = instance(async () => { order.push('load'); });
    const register = vi.fn(() => { order.push('register'); });
    const finalize = vi.fn();

    const prepared = preparePapersWindow(current, { register, finalize });
    expect(order).toEqual(['register']);
    await expect(prepared.loadAndRollback()).resolves.toBe(current);
    expect(order).toEqual(['register', 'load']);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('rolls back a failed load exactly once and makes a later closed event harmless', async () => {
    const current = instance(async () => { throw new Error('load failed'); });
    const finalize = vi.fn();
    const prepared = preparePapersWindow(current, { register: vi.fn(), finalize });

    await expect(prepared.loadAndRollback()).rejects.toThrow('load failed');
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(current.projectSurfaces.hideAll).toHaveBeenCalledTimes(1);
    expect(current.window.destroy).toHaveBeenCalledTimes(1);

    (current.window as never as EventEmitter).emit('closed');
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('offers an atomic create/register/load operation for later windows', async () => {
    const order: string[] = [];
    const current = instance(async () => { order.push('load'); });
    const result = await createRegisteredPapersWindow(
      () => { order.push('create'); return current; },
      { register: () => { order.push('register'); }, finalize: vi.fn() },
    );

    expect(result).toBe(current);
    expect(order).toEqual(['create', 'register', 'load']);
  });

  it('hides the owned runtime before finalizing on normal close', async () => {
    const current = instance(async () => undefined);
    const order: string[] = [];
    const hide = current.projectSurfaces.hideAll as ReturnType<typeof vi.fn>;
    hide.mockImplementation(() => { order.push('hide'); });
    const finalize = vi.fn(() => { order.push('finalize'); });
    preparePapersWindow(current, {
      register: vi.fn(),
      onClose: (window) => window.projectSurfaces.hideAll(),
      finalize,
    });

    (current.window as never as EventEmitter).emit('close');
    (current.window as never as EventEmitter).emit('closed');
    await Promise.resolve();
    expect(order).toEqual(['hide', 'finalize']);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('holds native close until asynchronous project teardown is complete', async () => {
    const current = instance(async () => undefined);
    let release!: () => void;
    const teardown = new Promise<void>((resolve) => { release = resolve; });
    const hide = current.projectSurfaces.hideAll as ReturnType<typeof vi.fn>;
    hide.mockReturnValue(teardown);
    const prepared = preparePapersWindow(current, {
      register: vi.fn(),
      onClose: (window) => window.projectSurfaces.hideAll(),
      finalize: vi.fn(),
    });
    const preventDefault = vi.fn();

    (current.window as never as EventEmitter).emit('close', { preventDefault });
    await Promise.resolve();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(current.window.destroy).not.toHaveBeenCalled();

    release();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(current.window.destroy).toHaveBeenCalledTimes(1);
    // The existing closed listener remains responsible for finalization.
    (current.window as never as EventEmitter).emit('closed');
    expect(prepared.windowId).toBe(current.window.id);
  });

  it('registers two windows independently without changing primary aliases', () => {
    const first = instance(async () => undefined, 1);
    const second = instance(async () => undefined, 2);
    const registered: number[] = [];
    const dependencies = { register: (current: PapersWindowInstance) => registered.push(current.window.id), finalize: vi.fn() };

    preparePapersWindow(first, dependencies);
    preparePapersWindow(second, dependencies);

    expect(registered).toEqual([1, 2]);
    expect(first.window.id).toBe(1);
    expect(second.window.id).toBe(2);
  });

  it('installs per-window behavior for every prepared window', () => {
    const first = instance(async () => undefined, 10);
    const second = instance(async () => undefined, 20);
    const installed: number[] = [];

    preparePapersWindow(first, {
      register: vi.fn(),
      install: (current) => installed.push(current.window.id),
      finalize: vi.fn(),
    });
    preparePapersWindow(second, {
      register: vi.fn(),
      install: (current) => installed.push(current.window.id),
      finalize: vi.fn(),
    });

    expect(installed).toEqual([10, 20]);
  });

  it('waits for asynchronous finalization before destroying after load failure', async () => {
    const current = instance(async () => { throw new Error('load failed'); });
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    const finalize = vi.fn(() => cleanup);
    const pending = preparePapersWindow(current, { register: vi.fn(), finalize }).loadAndRollback();

    await Promise.resolve();
    expect(current.window.destroy).not.toHaveBeenCalled();
    release();
    await expect(pending).rejects.toThrow('load failed');
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(current.window.destroy).toHaveBeenCalledTimes(1);
  });
});
