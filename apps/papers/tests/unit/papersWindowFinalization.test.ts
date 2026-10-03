import { describe, expect, it, vi } from 'vitest';

import { finalizePapersWindow } from '../../src/main/windows/papersWindowFinalization';

describe('Papers window finalization', () => {
  it('retires logical surfaces before awaiting Hermes and removing their window', async () => {
    const order: string[] = [];
    await finalizePapersWindow(7, {
      closeOwnedWidgets: async () => { order.push('widgets'); },
      reconcileHermes: async () => { order.push('hermes'); },
      unbindSurfaceSenders: () => { order.push('unbind'); },
      retireLogicalSurfaces: () => { order.push('retire'); },
      clearWorkspaceTopology: () => { order.push('topology'); },
      removeWindow: () => { order.push('remove'); },
      emitHermesSurface: () => { order.push('emit'); },
    });

    expect(order).toEqual(['widgets', 'unbind', 'retire', 'topology', 'hermes', 'remove', 'emit']);
  });

  it('still retires surfaces and removes the dead window when Hermes reconciliation fails', async () => {
    const retire = vi.fn();
    const remove = vi.fn();
    await expect(finalizePapersWindow(9, {
      closeOwnedWidgets: async () => {},
      reconcileHermes: async () => { throw new Error('minimize failed'); },
      unbindSurfaceSenders: vi.fn(),
      retireLogicalSurfaces: retire,
      clearWorkspaceTopology: vi.fn(),
      removeWindow: remove,
      emitHermesSurface: vi.fn(),
    })).rejects.toThrow('minimize failed');

    expect(retire).toHaveBeenCalledWith(9);
    expect(remove).toHaveBeenCalledWith(9);
  });

  it('retires before a delayed Hermes acknowledgement can expose a dead surface', async () => {
    let release!: () => void;
    const reconcile = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const pending = finalizePapersWindow(12, {
      closeOwnedWidgets: async () => {},
      reconcileHermes: async () => { order.push('hermes-start'); await reconcile; },
      unbindSurfaceSenders: () => { order.push('unbind'); },
      retireLogicalSurfaces: () => { order.push('retire'); },
      clearWorkspaceTopology: () => { order.push('topology'); },
      removeWindow: () => { order.push('remove'); },
      emitHermesSurface: () => { order.push('emit'); },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['unbind', 'retire', 'topology', 'hermes-start']);
    release();
    await pending;
    expect(order).toEqual(['unbind', 'retire', 'topology', 'hermes-start', 'remove', 'emit']);
  });
});
