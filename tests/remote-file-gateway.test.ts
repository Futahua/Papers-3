import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteFileGateway, remoteTokenHash } from '../src/main/backpacks/remoteFileGateway';
import { RemoteDeviceStore } from '../src/main/backpacks/remoteDeviceStore';
import { RemoteFileMutations } from '../src/main/backpacks/remoteFileMutations';
import { randomUUID } from 'node:crypto';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-gateway-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'file.txt'), 'abcdefgh');
  const token = randomBytes(32).toString('base64url');
  const gateway = await createRemoteFileGateway({ owner: { id: 'owner', name: 'Desktop' }, grants: [{ deviceId: 'laptop', tokenHash: remoteTokenHash(token), shares: [{ id: 'docs', name: 'Documents', directory }] }] });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => gateway.close());
  const address = gateway.server.address();
  if (!address || typeof address === 'string') throw new Error('Listener missing');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${token}` };
  const share = (await (await fetch(`${base}/v1/files/shares`, { headers })).json()).entries[0];
  const file = (await (await fetch(`${base}/v1/files/${share.id}/list`, { headers })).json()).entries[0];
  return { base, headers, share, file, gateway, directory };
}
it('requires a granted device and never dispatches arbitrary host operations', async () => {
  const { base, headers, gateway } = await fixture();
  expect((await fetch(`${base}/v1/files/shares`)).status).toBe(401);
  expect((await fetch(`${base}/v1/files/launch`, { headers })).status).toBe(404);
  expect((await fetch(`${base}/v1/files/shares`, { headers, method: 'POST' })).status).toBe(405);
  gateway.revoke('laptop');
  expect((await fetch(`${base}/v1/files/shares`, { headers })).status).toBe(401);
});
it('serves checked ranges and rejects missing or changed owner versions', async () => {
  const { base, headers, file, directory } = await fixture();
  const url = `${base}/v1/files/${file.id}/content`;
  expect((await fetch(url, { headers })).status).toBe(428);
  const checked = { ...headers, 'If-Match': `"${file.version}"` };
  const digest = await (await fetch(`${base}/v1/files/${file.id}/digest`, { headers: checked })).json();
  expect(digest).toMatchObject({ ok: true, size: 8, version: file.version, sha256: createHash('sha256').update('abcdefgh').digest('hex') });
  const response = await fetch(url, { headers: { ...checked, Range: 'bytes=3-5' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 3-5/8');
  expect(await response.text()).toBe('def');
  expect((await fetch(url, { headers: { ...checked, Range: 'bytes=8-' } })).status).toBe(416);
  await fs.writeFile(path.join(directory, 'file.txt'), 'replacement');
  expect((await fetch(url, { headers: checked })).status).toBe(412);
});
it('rejects resource IDs outside the authenticated grant', async () => {
  const { base, headers } = await fixture();
  expect((await fetch(`${base}/v1/files/00000000-0000-4000-8000-000000000000/stat`, { headers })).status).toBe(404);
});

it('pairs once through the host store and grants only the invited folders', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-pair-handshake-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const shared = path.join(directory, 'shared');
  await fs.mkdir(shared);
  const store = await RemoteDeviceStore.open(path.join(directory, 'private'), 'Desktop');
  const invitation = await store.invite([{ id: 'selected', name: 'Selected files', directory: shared }]);
  const gateway = await createRemoteFileGateway({ owner: store.snapshot().owner, grants: [], pair: async (code, name) => {
    const paired = await store.redeem(code, name);
    return { ...paired, grant: store.snapshot().devices.find(device => device.deviceId === paired.deviceId)! };
  } });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => gateway.close());
  const address = gateway.server.address();
  if (!address || typeof address === 'string') throw new Error('Listener missing');
  const base = `http://127.0.0.1:${address.port}`;
  const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: invitation.code, name: 'Phone' }) };
  const response = await fetch(`${base}/v1/devices/pair`, request);
  expect(response.status).toBe(200);
  const paired = await response.json();
  const headers = { Authorization: `Bearer ${paired.token}` };
  const shares = await (await fetch(`${base}/v1/files/shares`, { headers })).json();
  expect(shares.entries.map((entry: { name: string }) => entry.name)).toEqual(['Selected files']);
  expect((await fetch(`${base}/v1/devices/pair`, request)).status).toBe(403);
  await store.revoke(paired.deviceId);
  gateway.revoke(paired.deviceId);
  expect((await fetch(`${base}/v1/files/shares`, { headers })).status).toBe(401);
});

it('refuses changes for a read-only grant and confirms an authorized owner rename',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'papers-change-http-'));cleanups.push(()=>fs.rm(directory,{recursive:true,force:true}));const shared=path.join(directory,'shared');await fs.mkdir(shared);await fs.writeFile(path.join(shared,'before.txt'),'content');
 const writable=randomBytes(32).toString('base64url'),readonly=randomBytes(32).toString('base64url');
 const mutations=new RemoteFileMutations(path.join(directory,'journal'),async(operation,params)=>{expect(operation).toBe('rename');await fs.rename(params.path as string,path.join(path.dirname(params.path as string),params.newName as string));return {ok:true};});await mutations.initialize();
 const share={id:'files',name:'Files',directory:shared};const gateway=await createRemoteFileGateway({owner:{id:randomUUID(),name:'Owner'},grants:[{deviceId:'writer',tokenHash:remoteTokenHash(writable),shares:[share],canWrite:true},{deviceId:'reader',tokenHash:remoteTokenHash(readonly),shares:[share]}],mutate:(device,catalog,request)=>mutations.submit(device,catalog,request),changes:device=>mutations.list(device),revokeChanges:device=>mutations.revoke(device)});
 await new Promise<void>(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));cleanups.push(async()=>{await gateway.close();await mutations.close();});const address=gateway.server.address();if(!address||typeof address==='string')throw Error('Listener missing');const base=`http://127.0.0.1:${address.port}`;
 expect((await fetch(base+'/v1/files/changes',{method:'POST',headers:{Authorization:'Bearer '+readonly,'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
 const headers={Authorization:'Bearer '+writable};const roots=await(await fetch(base+'/v1/files/shares',{headers})).json();expect(roots.capabilities.changes).toBe(true);const files=await(await fetch(base+`/v1/files/${roots.entries[0].id}/list`,{headers})).json();
 const command={commandId:randomUUID(),operation:'rename',resourceId:files.entries[0].id,expectedVersion:files.entries[0].version,newName:'after.txt'};
 expect((await fetch(base+'/v1/files/changes',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(command)})).status).toBe(202);
 await mutations.close();const result=await(await fetch(base+'/v1/files/changes',{headers})).json();expect(result.jobs[0].phase).toBe('completed');expect(await fs.readFile(path.join(shared,'after.txt'),'utf8')).toBe('content');
 const other=await(await fetch(base+'/v1/files/changes',{headers:{Authorization:'Bearer '+readonly}})).json();expect(other.jobs).toEqual([]);
});
