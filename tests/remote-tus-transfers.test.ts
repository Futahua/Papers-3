import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRemoteFileGateway, remoteTokenHash } from '../src/main/backpacks/remoteFileGateway';
import { uploadWithTus } from '../src/main/backpacks/remoteTusClient';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-tus-'));
  const shared = path.join(root, 'shared'); await fs.mkdir(shared);
  const token = 'x'.repeat(40), deviceId = randomUUID(), ownerId = randomUUID();
  const headers = { Authorization: 'Bearer ' + token, 'Tus-Resumable': '1.0.0' };
  async function start() {
    const gateway = await createRemoteFileGateway({ owner: { id: ownerId, name: 'Fixture' }, grants: [{ deviceId, tokenHash: remoteTokenHash(token), canWrite: true, shares: [{ id: 'share', name: 'Fixture', directory: shared }] }], transfersDirectory: path.join(root, 'transfers') });
    await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
    const address = 'http://127.0.0.1:' + (gateway.server.address() as { port: number }).port;
    const shares = await (await fetch(address + '/v1/files/shares', { headers })).json();
    return { gateway, address, folderId: shares.entries[0].id };
  }
  return { root, shared, token, deviceId, headers, start };
}

it('uses the actual tus server to recover partial bytes across restart, reject stale offsets and publish once after a lost reply', async () => {
  const f = await fixture(); let server = await f.start();
  try {
    const bytes = Buffer.from('first chunk and remaining bytes');
    const metadata = Object.entries({ folderId: server.folderId, name: 'file.txt', sha256: digest(bytes) }).map(([key, value]) => key + ' ' + Buffer.from(value).toString('base64')).join(',');
    const created = await fetch(server.address + '/v1/files/transfers', { method: 'POST', headers: { ...f.headers, 'Upload-Length': String(bytes.length), 'Upload-Metadata': metadata } });
    expect(created.status).toBe(201);
    const location = new URL(created.headers.get('location')!, server.address).pathname;
    const patch = (offset: number, body: Buffer) => fetch(server.address + location, { method: 'PATCH', headers: { ...f.headers, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }, body: new Uint8Array(body) });
    expect((await patch(0, bytes.subarray(0, 7))).status).toBe(204);
    await server.gateway.close(); server = await f.start();
    const status = await fetch(server.address + location, { method: 'HEAD', headers: f.headers });
    expect(status.headers.get('upload-offset')).toBe('7');
    expect((await patch(0, bytes)).status).toBe(409);
    expect((await patch(7, bytes.subarray(7))).status).toBe(204);
    // The receiver has completed; the sender does not need the last PATCH reply.
    expect((await fetch(server.address + location, { method: 'HEAD', headers: f.headers })).headers.get('upload-offset')).toBe(String(bytes.length));
    const publish = async () => (await fetch(server.address + location + '/commit', { method: 'POST', headers: f.headers, body: '{}' })).json();
    const first = await publish(); expect(first.ok).toBe(true);
    await server.gateway.close(); server = await f.start();
    expect((await publish()).entry.id).toBe(first.entry.id);
    expect(await fs.readFile(path.join(f.shared, 'file.txt'))).toEqual(bytes);
    expect((await fs.readdir(f.shared)).filter(name => !name.startsWith('.'))).toEqual(['file.txt']);
    server.gateway.revoke(f.deviceId);
    expect((await fetch(server.address + location, { method: 'HEAD', headers: f.headers })).status).toBe(401);
  } finally { await server.gateway.close(); await fs.rm(f.root, { recursive: true, force: true }); }
}, 20000);

it('uses tus-js-client and retains its resume URL for completion recovery without another file', async () => {
  const f = await fixture(), server = await f.start();
  try {
    const bytes = Buffer.alloc(5 * 1024 ** 2, 73), local = path.join(f.root, 'local.bin'); await fs.writeFile(local, bytes);
    const options = { address: server.address, token: f.token, file: local, folderId: server.folderId, name: 'file.bin', size: bytes.length, sha256: digest(bytes), journal: path.join(f.root, 'upload.json') };
    const url = await uploadWithTus(options);
    expect(await uploadWithTus(options)).toBe(url);
    const published = await fetch(url + '/commit', { method: 'POST', headers: f.headers, body: '{}' }); expect(published.ok).toBe(true);
    expect(digest(await fs.readFile(path.join(f.shared, 'file.bin')))).toBe(digest(bytes));
  } finally { await server.gateway.close(); await fs.rm(f.root, { recursive: true, force: true }); }
}, 20000);
