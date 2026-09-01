import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { preparePapersWindow } from '../../src/main/windows/papersWindowLifecycle';
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
});
