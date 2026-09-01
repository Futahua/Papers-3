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

function instance(loadHostRenderer: () => Promise<void>): PapersWindowInstance {
  return {
    window: windowStub() as never,
    hostView: {} as never,
    backpackProjectRuntime: { hide: vi.fn() } as never,
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
    expect(current.backpackProjectRuntime.hide).toHaveBeenCalledTimes(1);
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

  it('hides the owned runtime before finalizing on normal close', () => {
    const current = instance(async () => undefined);
    const order: string[] = [];
    const hide = current.backpackProjectRuntime.hide as ReturnType<typeof vi.fn>;
    hide.mockImplementation(() => { order.push('hide'); });
    const finalize = vi.fn(() => { order.push('finalize'); });
    preparePapersWindow(current, {
      register: vi.fn(),
      onClose: (window) => window.backpackProjectRuntime.hide(),
      finalize,
    });

    (current.window as never as EventEmitter).emit('close');
    (current.window as never as EventEmitter).emit('closed');
    expect(order).toEqual(['hide', 'finalize']);
    expect(finalize).toHaveBeenCalledTimes(1);
  });
});
