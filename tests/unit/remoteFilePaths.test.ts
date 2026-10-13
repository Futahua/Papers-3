import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { createRemotePaths, parseRemotePath, remotePath } from '../../src/main/backpacks/remoteFilePaths';

const owner = 'b2b514db-668a-4092-bda4-67e33c52c807';
const v = (n: number) => String(n).repeat(64).slice(0, 64);
const tree: Record<string, { id: string; name: string; kind: 'file' | 'folder'; size: number; modifiedAt: number; version: string }[]> = {
  '': [{ id: '00000000-0000-4000-8000-000000000001', name: 'C:', kind: 'folder', size: 0, modifiedAt: 1, version: v(1) }],
  '00000000-0000-4000-8000-000000000001': [
    { id: '00000000-0000-4000-8000-000000000002', name: 'Users', kind: 'folder', size: 0, modifiedAt: 2, version: v(2) },
    { id: '00000000-0000-4000-8000-000000000003', name: 'note.txt', kind: 'file', size: 5, modifiedAt: 3, version: v(3) },
  ],
};
function client() {
  const sent: unknown[] = [];
  return {
    sent,
    snapshot: () => ({ devices: [{ id: owner, name: 'LapDog', address: 'http://100.112.127.26:48240' }] }),
    browse: async (_owner: string, id?: string) => ({ entries: tree[id ?? ''] ?? [], nextOffset: null, online: true }),
    change: async (_owner: string, command: unknown) => { sent.push(command); },
    changes: async () => sent.map(command => ({ commandId: (command as { commandId: string }).commandId, phase: 'completed' })),
    materialize: async () => path.join(os.tmpdir(), 'cached-note.txt'),
  };
}
const unused = async () => { throw new Error('not expected'); };

describe('remote file paths', () => {
  it('parses only Papers device paths', () => {
    expect(parseRemotePath(`\\\\papers~${owner}\\C:\\Users`)).toEqual({ ownerId: owner, parts: ['C:', 'Users'] });
    expect(parseRemotePath('\\\\server\\share\\x')).toBeNull();
    expect(parseRemotePath('C:\\Users')).toBeNull();
  });
  it('leaves local requests to local handling', async () => {
    expect(await createRemotePaths(client(), { iconDirectory: os.tmpdir(), fileIcon: unused }).handle('list', { path: 'C:\\' }, unused)).toBeNull();
  });
  it('lists drives and folders in the local listing shape, folders first', async () => {
    const paths = createRemotePaths(client(), { iconDirectory: os.tmpdir(), fileIcon: unused });
    const drives = await paths.handle('list', { path: remotePath(owner, []) }, unused);
    expect(drives?.entry).toMatchObject({ name: 'LapDog', kind: 'folder' });
    const listing = await paths.handle('list', { path: remotePath(owner, ['C:']) }, unused) as { items: { name: string; kind: string; path: string }[] };
    expect(listing.items.map(i => [i.name, i.kind])).toEqual([['Users', 'folder'], ['note.txt', 'file']]);
    expect(listing.items[1]!.path).toBe(remotePath(owner, ['C:', 'note.txt']));
  });
  it('sends renames as version-checked device commands', async () => {
    const fake = client();
    const result = await createRemotePaths(fake, { iconDirectory: os.tmpdir(), fileIcon: unused }).handle('rename', { path: remotePath(owner, ['C:', 'note.txt']), newName: 'n.txt' }, unused);
    expect(result).toMatchObject({ ok: true, path: remotePath(owner, ['C:', 'n.txt']) });
    expect(fake.sent[0]).toMatchObject({ operation: 'rename', resourceId: '00000000-0000-4000-8000-000000000003', expectedVersion: v(3), newName: 'n.txt' });
  });
  it('previews a verified local copy and reports the remote path back', async () => {
    const remote = remotePath(owner, ['C:', 'note.txt']);
    const result = await createRemotePaths(client(), { iconDirectory: os.tmpdir(), fileIcon: unused })
      .handle('preview', { path: remote }, async (_operation, params) => ({ ok: true, preview: { path: params.path, kind: 'text' } }));
    expect(result).toEqual({ ok: true, preview: { path: remote, kind: 'text' } });
  });
  it('refuses copying between devices instead of guessing', async () => {
    const result = createRemotePaths(client(), { iconDirectory: os.tmpdir(), fileIcon: unused })
      .handle('copy', { paths: ['C:\\local.txt'], destination: remotePath(owner, ['C:']) }, unused);
    await expect(result).rejects.toThrow(/between devices/);
  });
});
