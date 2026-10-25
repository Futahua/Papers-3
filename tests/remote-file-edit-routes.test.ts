import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteFileGateway, remoteTokenHash } from '../src/main/backpacks/remoteFileGateway';
import { RemoteFileEditOwner } from '../src/main/backpacks/remoteFileEditOwner';
import { RemoteFileEditNativeProvider } from '../src/main/backpacks/remoteFileEditNativeProvider';

it('checks grants and streams session-bound working copies through actual HTTP routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-edit-http-'));
  const share = path.join(root, 'shared'); await fs.mkdir(share);
  const file = path.join(share, 'source.txt'); await fs.writeFile(file, 'original');
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  let writes = 0;
  const native = process.platform === 'win32' ? new RemoteFileEditNativeProvider(path.resolve('resources/native/conditional-file-save.ps1'), path.resolve('resources/native/conditional-file-save.cs')) : null;
  const owner = new RemoteFileEditOwner(path.join(root, 'edits'), {
    async inspect(source) { return native ? native.inspect(source) : { token: 'a'.repeat(64), sha256: hash(await fs.readFile(source.path)) }; },
    async save(source, upload, expected, authorize) {
      authorize(); const bytes = await fs.readFile(upload); expect(hash(bytes)).toBe(expected.editedSha256);
      if (native) { const result = await native.save(source, upload, expected, authorize); writes++; return result; }
      writes++; await fs.writeFile(source.path, bytes); return { savedSha256: hash(bytes) };
    },
  }); await owner.initialize();
  const token = randomBytes(32).toString('base64url'), readonly = randomBytes(32).toString('base64url');
  const shares = [{ id: 'share', name: 'Generated', directory: share }];
  const gateway = await createRemoteFileGateway({ owner: { id: 'owner', name: 'Fixture' }, edits: owner, grants: [
    { deviceId: 'writer', tokenHash: remoteTokenHash(token), shares, canWrite: true },
    { deviceId: 'reader', tokenHash: remoteTokenHash(readonly), shares },
  ] });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const address = gateway.server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (url: string, value: unknown) => fetch(base + url, { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    expect((await fetch(base + '/v1/files/edits')).status).toBe(401);
    expect((await fetch(base + '/v1/files/edits', { headers: { Authorization: `Bearer ${readonly}` } })).status).toBe(403);
    const catalog = await (await fetch(base + '/v1/files/shares', { headers })).json();
    expect(catalog.capabilities.edits).toBe(true);
    const readerCatalog = await (await fetch(base + '/v1/files/shares', { headers: { Authorization: `Bearer ${readonly}` } })).json();
    expect(readerCatalog.capabilities.edits).toBe(false);
    const folder = catalog.entries[0];
    const entry = (await (await fetch(`${base}/v1/files/${folder.id}/list`, { headers })).json()).entries[0];
    const begun = await post('/v1/files/edits', { resourceId: entry.id, sourceVersion: entry.version, path: 'ignored-client-path' });
    expect(begun.status).toBe(201); const session = (await begun.json()).session;
    const bytes = Buffer.from('edited remotely');
    const uploading = await post(`/v1/files/edits/${session.id}/uploads`, { bytes: bytes.length, sha256: hash(bytes) });
    expect(uploading.status).toBe(201); const upload = (await uploading.json()).uploadId;
    expect((await fetch(`${base}/v1/files/edits/uploads/${upload}?offset=0`, { method: 'PUT', headers, body: bytes })).status).toBe(200);
    expect((await (await fetch(`${base}/v1/files/edits/uploads/${upload}`, { headers })).json()).upload).toMatchObject({ receivedBytes: bytes.length, prefixSha256: hash(bytes), complete: false });
    expect((await post(`/v1/files/edits/uploads/${upload}/seal`, {})).status).toBe(200);
    const save = { saveId: randomUUID(), uploadId: upload, sha256: hash(bytes) };
    expect((await (await post(`/v1/files/edits/${session.id}/save`, save)).json()).session.phase).toBe('saved');
    expect((await (await post(`/v1/files/edits/${session.id}/save`, save)).json()).session.phase).toBe('saved');
    expect(writes).toBe(1); expect(await fs.readFile(file, 'utf8')).toBe('edited remotely');
    gateway.revoke('writer'); expect((await fetch(base + '/v1/files/edits', { headers })).status).toBe(401);
  } finally { await gateway.close(); await owner.close(); }
}, 30_000);
