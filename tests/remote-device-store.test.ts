import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteDeviceStore } from '../src/main/backpacks/remoteDeviceStore';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-pairing-'));
  directories.push(directory);
  const shared = path.join(directory, 'files');
  await fs.mkdir(shared);
  const clock = { value: 1000 };
  const store = await RemoteDeviceStore.open(directory, 'Desktop', () => clock.value);
  return { directory, clock, store, shares: [{ id: 'documents', name: 'Documents', directory: shared }] };
}
it('persists identity and grants without storing client bearer secrets', async () => {
  const { directory, store, shares } = await fixture();
  const invitation = await store.invite(shares);
  const paired = await store.redeem(invitation.code, 'Laptop');
  await expect(store.redeem(invitation.code, 'Other')).rejects.toThrow('expired');
  const reopened = await RemoteDeviceStore.open(directory, 'Renamed host');
  expect(reopened.snapshot().owner).toEqual(paired.owner);
  expect(reopened.snapshot().devices[0]!.deviceId).toBe(paired.deviceId);
  expect(await fs.readFile(path.join(directory, 'devices.json'), 'utf8')).not.toContain(paired.token);
  await reopened.revoke(paired.deviceId);
  expect((await RemoteDeviceStore.open(directory, 'Desktop')).snapshot().devices).toEqual([]);
});
it('expires invitations and bounds guesses', async () => {
  const { clock, store, shares } = await fixture();
  const invitation = await store.invite(shares);
  clock.value = invitation.expiresAt;
  await expect(store.redeem(invitation.code, 'Laptop')).rejects.toThrow('expired');
  const second = await store.invite(shares);
  const wrong = second.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await expect(store.redeem(wrong, 'Laptop')).rejects.toThrow('incorrect');
  await expect(store.redeem(second.code, 'Laptop')).rejects.toThrow('expired');
});
it('does not restore revoked access from backup after main-file corruption', async () => {
  const { directory, store, shares } = await fixture();
  const invitation = await store.invite(shares);
  const paired = await store.redeem(invitation.code, 'Laptop');
  await store.revoke(paired.deviceId);
  await fs.writeFile(path.join(directory, 'devices.json'), '{broken');
  await expect(RemoteDeviceStore.open(directory, 'Desktop')).rejects.toThrow();
  expect(await fs.readFile(path.join(directory, 'devices.json'), 'utf8')).toBe('{broken');
});
