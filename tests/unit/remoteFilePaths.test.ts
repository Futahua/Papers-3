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
    uploads: [] as { folderId: string; localFile: string; name: string }[],
    async upload(_owner: string, folderId: string, localFile: string, name: string) { this.uploads.push({ folderId, localFile, name }); return { ...tree['00000000-0000-4000-8000-000000000001']![1]!, id: '00000000-0000-4000-8000-000000000009', name }; },
    inbox: async () => ({ entry: tree['00000000-0000-4000-8000-000000000001']![0]!, parts: ['C:', 'Users'] }),
    search: async () => [{ parts: ['C:', 'Users', 'found.txt'], name: 'found.txt', kind: 'file' as const, size: 3, modifiedAt: 4 }],
  };
}
const unused = async () => { throw new Error('not expected'); };

describe('remote file paths', () => {
  it('shares concurrent folder lookups across metadata and navigation requests',async()=>{
    const fake=client(),counts=new Map<string,number>(),browse=fake.browse;
    fake.browse=async(owner,id)=>{counts.set(id??'',(counts.get(id??'')??0)+1);await new Promise(r=>setTimeout(r,10));return browse(owner,id);};
    const paths=createRemotePaths(fake,{iconDirectory:os.tmpdir(),fileIcon:unused});
    const target=remotePath(owner,['C:','Users']);
    await Promise.all(Array.from({length:24},(_,i)=>paths.handle(i%2?'stat':'list',{path:target},unused)));
    expect([...counts.values()]).toEqual([1,1,1]);
  });
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
  it('searches the device when the search is scoped to it', async () => {
    const result = await createRemotePaths(client(), { iconDirectory: os.tmpdir(), fileIcon: unused })
      .handle('search', { query: 'found', path: remotePath(owner, ['C:']) }, unused) as { results: { path: string }[] };
    expect(result.results.map(item => item.path)).toEqual([remotePath(owner, ['C:', 'Users', 'found.txt'])]);
  });
  it('copies a local file onto a device under a free name, even when asked to move', async () => {
    const fake = client();
    const local = path.join(os.tmpdir(), 'note.txt');
    await import('node:fs/promises').then(fs => fs.writeFile(local, 'x'));
    const result = await createRemotePaths(fake, { iconDirectory: os.tmpdir(), fileIcon: unused })
      .handle('move', { paths: [local], destination: remotePath(owner, ['C:']) }, unused);
    expect(result).toEqual({ ok: true, operation: 'copy', paths: [remotePath(owner, ['C:', 'note (2).txt'])] });
    expect(fake.uploads).toEqual([{ folderId: '00000000-0000-4000-8000-000000000001', localFile: local, name: 'note (2).txt' }]);
  });
});

it('uses owner thumbnails and app icons without materializing the remote file',async()=>{const base=client(),calls:string[]=[];const paths=createRemotePaths({...base,ownerThumbnail:async(ownerId,entry)=>{calls.push(ownerId);return{kind:'image',dataUrl:'data:image/jpeg;base64,YQ=='};},materialize:async()=>{throw Error('Original file must not download');}},{iconDirectory:os.tmpdir(),fileIcon:unused});expect(await paths.handle('thumbnail',{path:remotePath(owner,['C:','note.txt'])},unused)).toMatchObject({ok:true,preview:{kind:'image'}});expect(await paths.handle('icon',{path:remotePath(owner,['C:','note.txt'])},unused)).toEqual({ok:true,icon:'data:image/jpeg;base64,YQ=='});expect(calls).toEqual([owner,owner]);});
