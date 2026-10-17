import { it, expect, vi } from 'vitest';
import { RemoteFileClient } from '../src/main/backpacks/remoteFileClient';

it('retries a locked stopped copy without blocking a new assignment for the same owner', async () => {
  const client = new RemoteFileClient('unused', { seal: x => x, open: x => x });
  const state = client as any;
  const stopped = {id:'old-copy',session:{assignmentId:'old'}};
  const active = {id:'new-copy',session:{assignmentId:'new'}};
  state.connections = [{id:'owner'}];
  state.editingAssignments = vi.fn().mockResolvedValue({assignments:[{id:'old',active:false},{id:'new',active:true,mine:true,entry:{}}]});
  state.editCopies.list = vi.fn().mockResolvedValue([stopped]);
  const cleanup = vi.fn().mockRejectedValue(Object.assign(new Error('Folder in use'),{code:'EBUSY'}));
  state.editCopies.removeUnlinked = cleanup;
  const close = vi.fn().mockResolvedValue(undefined);
  state.editWatchers.set(stopped.id,{close});
  state.editWatchers.set(active.id,{close:vi.fn()});
  state.editGenerations.set(stopped.id,'stale');state.dirtyEdits.add(stopped.id);
  state.beginEdit = vi.fn().mockResolvedValue(active);
  state.automaticSave = vi.fn();
  await state.pollAssignments();
  expect(cleanup).toHaveBeenCalledWith(stopped.id);
  expect(close).toHaveBeenCalledOnce();
  expect(state.editWatchers.has(stopped.id)).toBe(false);
  expect(state.dirtyEdits.has(stopped.id)).toBe(false);
  expect(state.beginEdit).toHaveBeenCalledWith('owner',{});
  expect(state.automaticSave).toHaveBeenCalledWith(active.id);
  await state.pollAssignments();
  expect(cleanup).toHaveBeenCalledTimes(2);
});
