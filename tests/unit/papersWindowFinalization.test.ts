import { describe, expect, it, vi } from 'vitest';

import { finalizePapersWindow } from '../../src/main/windows/papersWindowFinalization';

describe('Papers window finalization', () => {
  it('retires logical surfaces before removing their native window', async () => {
    const order: string[] = [];
    await finalizePapersWindow(7, {
      closeOwnedWidgets: async () => { order.push('widgets'); },
      reconcileHermes: async () => { order.push('hermes'); },
      unbindSurfaceSenders: () => { order.push('unbind'); },
      retireLogicalSurfaces: () => { order.push('retire'); },
      removeWindow: () => { order.push('remove'); },
      emitHermesSurface: () => { order.push('emit'); },
    });

    expect(order).toEqual(['widgets', 'hermes', 'unbind', 'retire', 'remove', 'emit']);
  });

  it('still retires surfaces and removes the dead window when Hermes reconciliation fails', async () => {
    const retire = vi.fn();
    const remove = vi.fn();
    await expect(finalizePapersWindow(9, {
      closeOwnedWidgets: async () => {},
      reconcileHermes: async () => { throw new Error('minimize failed'); },
      unbindSurfaceSenders: vi.fn(),
      retireLogicalSurfaces: retire,
      removeWindow: remove,
      emitHermesSurface: vi.fn(),
    })).rejects.toThrow('minimize failed');

    expect(retire).toHaveBeenCalledWith(9);
    expect(remove).toHaveBeenCalledWith(9);
  });
});
