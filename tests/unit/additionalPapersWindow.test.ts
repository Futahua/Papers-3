import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createAdditionalPapersWindow } from '../../src/main/windows/additionalPapersWindow';
import type { PapersWindowInstance } from '../../src/main/windows/papersWindowFactory';
import { createPapersWindowRegistry } from '../../src/main/windows/papersWindowRegistry';
import type { PapersWindowLifecycleDependencies } from '../../src/main/windows/papersWindowLifecycle';

function instance(id: number, loadHostRenderer: () => Promise<void>): PapersWindowInstance {
  let destroyed = false;
  const window = new EventEmitter() as EventEmitter & {
    id: number;
    isDestroyed: () => boolean;
    destroy: () => void;
  };
  window.id = id;
  window.isDestroyed = () => destroyed;
  window.destroy = vi.fn(() => { destroyed = true; });
  return {
    window: window as never,
    hostView: { webContents: { id: id + 100 } } as never,
    backpackProjectRuntime: { hide: vi.fn() } as never,
    loadHostRenderer,
  };
}

type Owned = Pick<PapersWindowInstance, 'window' | 'hostView' | 'backpackProjectRuntime'>;

describe('additional Papers window composer', () => {
  it('creates B with fresh restore policy while preserving A as primary', async () => {
    const windows = createPapersWindowRegistry<Owned>();
    const first = instance(1, async () => undefined);
    const second = instance(2, async () => undefined);
    const lifecycleDependencies = (restoreBackpackId: string | null): PapersWindowLifecycleDependencies => ({
      register: (current) => {
        windows.add(current.window.id, current, restoreBackpackId);
        windows.setHostSender(current.window.id, current.hostView.webContents.id);
      },
      finalize: (windowId) => windows.remove(windowId),
    });

    windows.add(first.window.id, first, 'backpack-X');
    windows.setHostSender(first.window.id, first.hostView.webContents.id);
    await createAdditionalPapersWindow({ createWindow: () => second, lifecycleDependencies });

    expect(windows.restoreBackpack(1)).toBe('backpack-X');
    expect(windows.restoreBackpack(2)).toBeNull();
    expect(windows.windowIds).toEqual([1, 2]);
    expect(windows.windowForSender(101)).toBe(1);
    expect(windows.windowForSender(102)).toBe(2);
  });

  it('rolls back B without disturbing an already registered A', async () => {
    const windows = createPapersWindowRegistry<Owned>();
    const first = instance(11, async () => undefined);
    const second = instance(12, async () => { throw new Error('B load failed'); });
    windows.add(first.window.id, first, 'backpack-X');
    windows.setHostSender(first.window.id, first.hostView.webContents.id);
    const lifecycleDependencies = (restoreBackpackId: string | null): PapersWindowLifecycleDependencies => ({
      register: (current) => {
        windows.add(current.window.id, current, restoreBackpackId);
        windows.setHostSender(current.window.id, current.hostView.webContents.id);
      },
      finalize: (windowId) => windows.remove(windowId),
    });

    await expect(createAdditionalPapersWindow({
      createWindow: () => second,
      lifecycleDependencies,
    })).rejects.toThrow('B load failed');

    expect(windows.windowIds).toEqual([11]);
    expect(windows.restoreBackpack(11)).toBe('backpack-X');
    expect(second.window.destroy).toHaveBeenCalledTimes(1);
  });

  it('closes B without retiring A or transferring dock ownership', async () => {
    const windows = createPapersWindowRegistry<Owned>();
    const first = instance(21, async () => undefined);
    const second = instance(22, async () => undefined);
    windows.add(first.window.id, first, 'backpack-X');
    windows.setHostSender(first.window.id, first.hostView.webContents.id);
    const lifecycleDependencies = (restoreBackpackId: string | null): PapersWindowLifecycleDependencies => ({
      register: (current) => {
        windows.add(current.window.id, current, restoreBackpackId);
        windows.setHostSender(current.window.id, current.hostView.webContents.id);
      },
      onClose: (current) => current.backpackProjectRuntime.hide(),
      finalize: (windowId) => windows.remove(windowId),
    });

    await createAdditionalPapersWindow({ createWindow: () => second, lifecycleDependencies });
    windows.setHermesDockOwner(second.window.id);
    (second.window as never as EventEmitter).emit('close');
    (second.window as never as EventEmitter).emit('closed');

    expect(second.backpackProjectRuntime.hide).toHaveBeenCalledTimes(1);
    expect(windows.windowIds).toEqual([21]);
    expect(windows.hermesDockOwner()).toBeNull();
    expect(windows.windowForSender(121)).toBe(21);
  });
});
