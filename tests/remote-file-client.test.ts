import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RemoteDeviceStore } from '../src/main/backpacks/remoteDeviceStore';
import { createRemoteFileGateway } from '../src/main/backpacks/remoteFileGateway';
import { RemoteFileClient } from '../src/main/backpacks/remoteFileClient';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const box = { seal: (value: string) => Buffer.from(value).toString('base64'), open: (value: string) => Buffer.from(value, 'base64').toString() };
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-file-client-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const shared = path.join(directory, 'shared'); await fs.mkdir(shared);
  const content = randomBytes(1024 * 1024);
  await fs.writeFile(path.join(shared, 'original.bin'), content);
  const devices = await RemoteDeviceStore.open(path.join(directory, 'owner'), 'Desktop');
  const invitation = await devices.invite([{ id: 'files', name: 'Files', directory: shared }]);
  const gateway = await createRemoteFileGateway({ owner: devices.snapshot().owner, grants: [], pair: async (code, name) => {
    const paired = await devices.redeem(code, name);
    return { ...paired, grant: devices.snapshot().devices.find(device => device.deviceId === paired.deviceId)! };
  } });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const closeGateway = async () => { if (!closed) { closed = true; await gateway.close(); } };
  cleanups.push(closeGateway);
  const address = gateway.server.address(); if (!address || typeof address === 'string') throw new Error('Listener missing');
  const clientDir = path.join(directory, 'receiver');
  const client = new RemoteFileClient(clientDir, box, true);
  cleanups.push(() => client.close());
  await client.initialize();
  await client.pair(`http://127.0.0.1:${address.port}`, invitation.code, 'Laptop');
  const ownerId = devices.snapshot().owner.id;
  const share = (await client.browse(ownerId)).entries[0]!;
  const file = (await client.browse(ownerId, share.id)).entries[0]!;
  return { client, clientDir, ownerId, file, share, content, closeGateway };
}
async function finished(client: RemoteFileClient, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = client.snapshot().jobs.find(job => job.id === id)!;
    if (job.phase === 'completed' || job.phase === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Transfer did not finish');
}
it('downloads verified content and retains it and listings after owner disconnects', async () => {
  const { client, clientDir, ownerId, file, share, content, closeGateway } = await fixture();
  expect(await finished(client, client.download(ownerId, file).id)).toMatchObject({ phase: 'completed', bytes: content.length });
  const offline = await client.offline(ownerId);
  expect(offline).toHaveLength(1);
  expect(await fs.readFile(await client.cachedPath(ownerId, offline[0]!.key))).toEqual(content);
  await closeGateway();
  expect(await client.browse(ownerId, share.id)).toMatchObject({ online: false });
  const reopened = new RemoteFileClient(clientDir, box, true); await reopened.initialize();
  cleanups.push(() => reopened.close());
  expect(reopened.snapshot().devices[0]!.id).toBe(ownerId);
  expect(await fs.readFile(await reopened.cachedPath(ownerId, offline[0]!.key))).toEqual(content);
});
it('resumes retained partial bytes and rejects a damaged offline copy', async () => {
  const { client, clientDir, ownerId, file, content } = await fixture();
  const { createHash } = await import('node:crypto');
  const key = createHash('sha256').update(JSON.stringify([ownerId, file.id, file.version])).digest('hex');
  await fs.mkdir(path.join(clientDir, 'content'), { recursive: true });
  await fs.writeFile(path.join(clientDir, 'content', `${key}.partial`), content.subarray(0, 128 * 1024));
  expect((await finished(client, client.download(ownerId, file).id)).phase).toBe('completed');
  const target = await client.cachedPath(ownerId, key);
  expect(await fs.readFile(target)).toEqual(content);
  await fs.writeFile(target, Buffer.alloc(content.length));
  await expect(client.cachedPath(ownerId, key)).rejects.toThrow('damaged');
});
it('refuses arbitrary network destinations', async () => {
  const { client } = await fixture();
  await expect(client.pair('http://example.com', '123456', 'Laptop')).rejects.toThrow('Tailscale');
  await expect(client.pair('http://100.64.1.1/private', '123456', 'Laptop')).rejects.toThrow('Tailscale');
});
