import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileClient } from '../src/main/backpacks/remoteFileClient';
import { RemoteFileEditOwner } from '../src/main/backpacks/remoteFileEditOwner';
import { createRemoteFileGateway, remoteTokenHash } from '../src/main/backpacks/remoteFileGateway';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function until(check: () => Promise<boolean>, timeout = 14000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error('Editing condition timed out'); }

it('a controller assigns a different editing client, two local saves write back, then controller stop fences future edits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-edit-assignment-live-')), shared = path.join(root, 'shared'), clientDirectory = path.join(root, 'client'); await fs.mkdir(shared); await fs.mkdir(clientDirectory);
  const original = path.join(shared, 'document.txt'); await fs.writeFile(original, 'baseline');
  const owner = new RemoteFileEditOwner(path.join(root, 'owner'), {
    async inspect(source) { return { token: 'a'.repeat(64), sha256: sha(await fs.readFile(source.path)) }; },
    async save(source, snapshot, expected, authorize) { authorize(); if (sha(await fs.readFile(source.path)) !== expected.sourceSha256) throw Object.assign(Error('Source changed'), { code: 'VERSION_CHANGED' }); const bytes = await fs.readFile(snapshot); if (sha(bytes) !== expected.editedSha256) throw Error('Snapshot changed'); await fs.writeFile(source.path, bytes); return { savedSha256: sha(bytes) }; },
  }); await owner.initialize();
  const ownerId = randomUUID(), editorId = randomUUID(), controllerId = randomUUID(), editorToken = 'e'.repeat(40), controllerToken = 'c'.repeat(40), shares = [{ id: 'share', name: 'Fixture', directory: shared }];
  const gateway = await createRemoteFileGateway({ owner: { id: ownerId, name: 'Owner' }, edits: owner, grants: [{ deviceId: editorId, tokenHash: remoteTokenHash(editorToken), canWrite: true, shares }, { deviceId: controllerId, tokenHash: remoteTokenHash(controllerToken), canWrite: true, shares }] });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve)); const address = 'http://127.0.0.1:' + (gateway.server.address() as {port: number}).port;
  await fs.writeFile(path.join(clientDirectory, 'connections.json'), JSON.stringify({ version: 1, connections: [{ id: ownerId, name: 'Owner', address, deviceId: editorId, secret: editorToken }] }));
  const client = new RemoteFileClient(clientDirectory, { seal: x => x, open: x => x }, true); let working = ''; client.onAssignedEdit = async target => { working = target; }; await client.initialize();
  const headers = { Authorization: 'Bearer ' + controllerToken, 'Content-Type': 'application/json' };
  try {
    const folder = (await (await fetch(address + '/v1/files/shares', { headers })).json()).entries[0];
    const entry = (await (await fetch(address + '/v1/files/' + folder.id + '/list', { headers })).json()).entries[0];
    const assigned = await (await fetch(address + '/v1/files/edits/assignments', { method: 'POST', headers, body: JSON.stringify({ resourceId: entry.id, sourceVersion: entry.version, editorDeviceId: editorId }) })).json(); expect(assigned.ok).toBe(true);
    await until(async () => (await client.localEdits(ownerId)).length > 0);
    expect(working).toBe(''); // Marking must not invoke the editor-opening callback.
    working = await client.editPath((await client.localEdits(ownerId))[0]!.id);
    expect(path.basename(working)).toBe('document.txt');
    await fs.writeFile(working, 'first local save');
    await until(async () => await fs.readFile(original, 'utf8') === 'first local save');
    await fs.writeFile(working, 'second local save'); await until(async () => await fs.readFile(original, 'utf8') === 'second local save');
    const port=(gateway.server.address() as {port:number}).port;
    const closed=new Promise<void>(resolve=>gateway.server.close(()=>resolve()));gateway.server.closeAllConnections();await closed;
    expect((await client.editingAssignments(ownerId)).offline).toBe(true);
    const offlineRoots=await client.browse(ownerId);expect(offlineRoots.online).toBe(false);
    expect((await client.browse(ownerId,offlineRoots.entries[0]!.id)).online).toBe(false);
    expect(await client.editPath((await client.localEdits(ownerId))[0]!.id)).toBe(working);
    await new Promise<void>(resolve=>gateway.server.listen(port,'127.0.0.1',resolve));
    const stopped = await (await fetch(address + '/v1/files/edits/assignments', { method: 'POST', headers, body: JSON.stringify({ action: 'stop', id: assigned.assignment.id }) })).json(); expect(stopped.assignment.active).toBe(false);
    await fs.writeFile(working, 'retained unsent changes'); await new Promise(resolve => setTimeout(resolve, 6500));
    expect(await fs.readFile(original, 'utf8')).toBe('second local save'); await expect(fs.stat(working)).rejects.toMatchObject({code:'ENOENT'});
  } finally { await client.close(); if(gateway.server.listening)await gateway.close(); await owner.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 40000);
