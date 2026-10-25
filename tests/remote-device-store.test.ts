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
it('admits a same-account device without a code and replaces its earlier grant', async () => {
  const { directory, store, shares } = await fixture();
  const first = await store.admit('7338249508159368', 'lapdog', shares, true, []);
  const second = await store.admit('7338249508159368', 'lapdog', shares, true, []);
  expect(second.replaced).toEqual([first.deviceId]);
  const devices = (await RemoteDeviceStore.open(directory, 'Desktop')).snapshot().devices;
  expect(devices.map(device => device.deviceId)).toEqual([second.deviceId]);
  expect(devices[0]!.canWrite).toBe(true);
  await expect(store.admit('bad node!', 'x', shares, false, [])).rejects.toThrow('node');
});
it('keeps a second client on the same machine from revoking the first', async () => {
  const { store, shares } = await fixture();
  const papers = await store.admit('7338249508159368', 'LapDog', shares, true, []);
  const check = await store.admit('7338249508159368', 'LapDog device check', shares, true, []);
  expect(check.replaced).toEqual([]);
  expect(store.snapshot().devices.map(device => device.deviceId).sort()).toEqual([papers.deviceId, check.deviceId].sort());
});
it('renews authentication while retaining the same granted Proxima identity',async()=>{
 const {store,shares}=await fixture(),projectId='bp-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const firstShare={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',projectId,name:'Proxima',kind:'proxima' as const};
 const first=await store.admit('7338249508159368','LapDog',shares,true,[firstShare]);
 const second=await store.admit('7338249508159368','LapDog',shares,true,[{...firstShare,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}]);
 expect(second.token).not.toBe(first.token);expect(second.replaced).toEqual([first.deviceId]);expect(store.snapshot().devices[0]!.backpacks?.[0]?.id).toBe(firstShare.id);
 const independent=await store.admit('7338249508159368','Separate client',shares,true,[{...firstShare,id:'cccccccc-cccc-cccc-cccc-cccccccccccc'}]);
 expect(store.snapshot().devices.find(d=>d.deviceId===independent.deviceId)?.backpacks?.[0]?.id).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
});
