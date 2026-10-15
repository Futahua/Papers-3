import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCustomIconStore } from '../src/main/backpacks/customIconStore';
import { createRemoteFileGateway, remoteTokenHash } from '../src/main/backpacks/remoteFileGateway';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function temp() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-icons-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

it('keeps pictures per item, lists a folder\'s direct children only, and survives a restart', async () => {
  const directory = await temp(), file = path.join(directory, 'icons.json');
  const store = createCustomIconStore(file);
  const folder = path.join(directory, 'Photos'), child = path.join(folder, 'Trip'), deep = path.join(child, 'a.jpg');
  await store.set([child, deep], PNG);
  expect(await store.inFolder(folder)).toEqual({ Trip: PNG });
  expect(await store.inFolder(child)).toEqual({ 'a.jpg': PNG });
  expect(await createCustomIconStore(file).inFolder(folder)).toEqual({ Trip: PNG });
  await store.set([child], null);
  expect(await createCustomIconStore(file).inFolder(folder)).toEqual({});
});

it('refuses anything that is not a small image', async () => {
  const store = createCustomIconStore(path.join(await temp(), 'icons.json'));
  await expect(store.set([path.resolve('x')], 'javascript:alert(1)')).rejects.toThrow();
  await expect(store.set([path.resolve('x')], 'data:image/png;base64,' + 'A'.repeat(300 * 1024))).rejects.toThrow();
  await expect(store.set(['relative/path'], PNG)).rejects.toThrow();
});

it('gateway serves a folder\'s pictures to paired devices and lets only writers change them', async () => {
  const directory = await temp();
  await fs.mkdir(path.join(directory, 'Trip'));
  const customIcons = createCustomIconStore(path.join(await temp(), 'icons.json'));
  const writer = randomBytes(32).toString('base64url'), reader = randomBytes(32).toString('base64url');
  const share = { id: 'docs', name: 'Documents', directory };
  const gateway = await createRemoteFileGateway({ customIcons, owner: { id: 'owner', name: 'Desktop' }, grants: [
    { deviceId: 'phone', tokenHash: remoteTokenHash(writer), canWrite: true, shares: [share] },
    { deviceId: 'laptop', tokenHash: remoteTokenHash(reader), shares: [share] },
  ] });
  await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => gateway.close());
  const address = gateway.server.address();
  if (!address || typeof address === 'string') throw new Error('Listener missing');
  const base = `http://127.0.0.1:${address.port}`;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const root = (await (await fetch(`${base}/v1/files/shares`, { headers: as(writer) })).json()).entries[0];
  const trip = (await (await fetch(`${base}/v1/files/${root.id}/list`, { headers: as(writer) })).json()).entries[0];
  const readerRoot = (await (await fetch(`${base}/v1/files/shares`, { headers: as(reader) })).json()).entries[0];
  await fetch(`${base}/v1/files/${readerRoot.id}/list`, { headers: as(reader) });

  expect((await fetch(`${base}/v1/files/${trip.id}/custom-icon`, { method: 'POST', headers: { ...as(reader), 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: PNG }) })).status).toBe(403);
  expect((await fetch(`${base}/v1/files/${trip.id}/custom-icon`, { method: 'POST', headers: { ...as(writer), 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: 'data:text/html;base64,PGI+' }) })).status).toBe(400);
  expect((await fetch(`${base}/v1/files/${trip.id}/custom-icon`, { method: 'POST', headers: { ...as(writer), 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: PNG }) })).status).toBe(200);
  expect(await customIcons.inFolder(directory)).toEqual({ Trip: PNG });
  const seen = await (await fetch(`${base}/v1/files/${readerRoot.id}/custom-icons`, { headers: as(reader) })).json();
  expect(seen.icons).toEqual({ Trip: PNG });
  expect((await fetch(`${base}/v1/files/00000000-0000-4000-8000-000000000000/custom-icons`, { headers: as(reader) })).status).not.toBe(200);
});
