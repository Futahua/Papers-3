import { describe, it, expect, vi } from 'vitest';
import { finalizePapersWindow } from '../../src/main/windows/papersWindowFinalization';

describe('closed Papers window finalization', () => {
 it('ends sender and surface authority before removing the native window record', async () => {
  const order: string[]=[];
  await finalizePapersWindow(7, {
   closeOwnedWidgets: async()=>{order.push('widgets');},
   unbindSurfaceSenders: ()=>{order.push('unbind');},
   retireLogicalSurfaces: ()=>{order.push('retire');},
   clearWorkspaceTopology: ()=>{order.push('topology');},
   removeWindow: ()=>{order.push('remove');},
  });
  expect(order).toEqual(['widgets','unbind','retire','topology','remove']);
 });
 it('still revokes authority and removes the dead window if widget cleanup fails', async () => {
  const remove=vi.fn(),retire=vi.fn(),unbind=vi.fn();
  await finalizePapersWindow(9, {closeOwnedWidgets: async()=>{throw new Error('closed widget');},unbindSurfaceSenders:unbind,retireLogicalSurfaces:retire,clearWorkspaceTopology:vi.fn(),removeWindow:remove});
  expect(unbind).toHaveBeenCalledWith(9);expect(retire).toHaveBeenCalledWith(9);expect(remove).toHaveBeenCalledWith(9);
 });
});
