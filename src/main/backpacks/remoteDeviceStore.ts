import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { remoteTokenHash, type RemoteFileGrant, type RemoteBackpackShare } from './remoteFileGateway';
import { RemoteFileResources, type RemoteFileShare } from './remoteFileResources';

interface Device extends RemoteFileGrant { name: string; pairedAt: number; node?: string }
interface State { version: 1; owner: { id: string; name: string }; devices: Device[] }
interface Invitation { codeHash: string; expiresAt: number; attempts: number; shares: RemoteFileShare[]; canWrite:boolean; backpacks:RemoteBackpackShare[] }
function validBackpacks(value:unknown):value is RemoteBackpackShare[]{return Array.isArray(value)&&value.every(item=>item&&/^[a-f0-9-]{36}$/.test(item.id)&&/^bp-[a-f0-9-]{36}$/.test(item.projectId)&&typeof item.name==='string'&&item.name.length>0&&item.name.length<=256&&item.kind==='proxima')&&new Set(value.map(item=>item.id)).size===value.length;}
function validate(value: unknown): string | null {
  const state = value as State | null;
  if (!state || state.version !== 1 || typeof state.owner?.id !== 'string' || typeof state.owner.name !== 'string' || !Array.isArray(state.devices)) return 'Invalid device store';
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const device of state.devices) {
    if(device?.backpacks!==undefined&&!validBackpacks(device.backpacks))return 'Invalid Backpack grant';
    if (device.canWrite !== undefined && typeof device.canWrite !== 'boolean') return 'Invalid file-change permission';
    if (!device || typeof device.deviceId !== 'string' || ids.has(device.deviceId) || typeof device.name !== 'string' || !Number.isFinite(device.pairedAt) || !/^[a-f0-9]{64}$/.test(device.tokenHash) || hashes.has(device.tokenHash) || !Array.isArray(device.shares)) return 'Invalid device grant';
    for (const share of device.shares) if (!share || typeof share.id !== 'string' || typeof share.name !== 'string' || typeof share.directory !== 'string' || !path.isAbsolute(share.directory)) return 'Invalid shared directory';
    ids.add(device.deviceId); hashes.add(device.tokenHash);
  }
  return null;
}

/** Host-local identity and grants. Pairing never copies a profile or a provider secret. */
export class RemoteDeviceStore {
  private invitation: Invitation | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly store: AtomicJsonStore, private state: State, private readonly now: () => number) {}

  static async open(directory: string, name: string, now = Date.now): Promise<RemoteDeviceStore> {
    const store = new AtomicJsonStore(path.join(directory, 'devices.json'), { recoveryDir: path.join(directory, 'recovery'), validate });
    let existing: State | null = null;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(directory, 'devices.json'), 'utf8'));
      if (validate(parsed)) throw new Error('Device identity needs recovery.');
      existing = parsed as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Automatic backup restoration could resurrect a revoked token. Pairing
      // recovery is explicit; never roll access grants backward on startup.
      try { await fs.access(store.backupPath); throw new Error('Device identity needs explicit recovery.'); }
      catch (backupError) { if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError; }
    }
    const state: State = existing ?? { version: 1, owner: { id: randomUUID(), name }, devices: [] };
    if (!existing) await store.save(state);
    return new RemoteDeviceStore(store, state, now);
  }

  snapshot(): State { return structuredClone(this.state); }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Called only by the local owner UI after choosing the folders to share. */
  invite(shares: RemoteFileShare[], canWrite = false, backpacks:RemoteBackpackShare[]=[]): Promise<{ code: string; expiresAt: number }> {
    return this.serialize(async () => {
      if (!shares.length&&!backpacks.length) throw new Error('Choose at least one folder or Backpack.');
      if(!validBackpacks(backpacks))throw new Error('Invalid Backpack selection.');
      await RemoteFileResources.create(shares);
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = this.now() + 5 * 60_000;
      this.invitation = { codeHash: remoteTokenHash(code), expiresAt, attempts: 0, shares: structuredClone(shares), canWrite,backpacks:structuredClone(backpacks) };
      return { code, expiresAt };
    });
  }

  redeem(code: string, name: string): Promise<{ owner: State['owner']; deviceId: string; token: string }> {
    return this.serialize(async () => {
      const invitation = this.invitation;
      if (!invitation || this.now() >= invitation.expiresAt || invitation.attempts >= 5) throw new Error('Pairing code expired; request a new code on the owner.');
      invitation.attempts++;
      if (!/^\d{6}$/.test(code) || remoteTokenHash(code) !== invitation.codeHash) throw new Error('Pairing code is incorrect.');
      if (!name.trim() || name.length > 120) throw new Error('Device name is invalid.');
      const token = randomBytes(32).toString('base64url');
      const device: Device = { deviceId: randomUUID(), name: name.trim(), pairedAt: this.now(), tokenHash: remoteTokenHash(token), shares: invitation.shares, canWrite:invitation.canWrite,backpacks:invitation.backpacks };
      const candidate = { ...this.state, devices: [...this.state.devices, device] };
      await this.store.save(candidate);
      this.state = candidate;
      this.invitation = null;
      return { owner: { ...this.state.owner }, deviceId: device.deviceId, token };
    });
  }

  /** Admits a device whose identity the caller already verified (same Tailscale account). Replaces the earlier grant of that same client (node + name) only, so a second client on one machine never revokes the first. */
  admit(node: string, name: string, shares: RemoteFileShare[], canWrite: boolean, backpacks: RemoteBackpackShare[]): Promise<{ owner: State['owner']; deviceId: string; token: string; replaced: string[] }> {
    return this.serialize(async () => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(node)) throw new Error('Invalid device node.');
      if (!name.trim() || name.length > 120) throw new Error('Device name is invalid.');
      if (!validBackpacks(backpacks)) throw new Error('Invalid Backpack selection.');
      await RemoteFileResources.create(shares);
      const token = randomBytes(32).toString('base64url');
      const sameClient = (item: Device) => item.node === node && item.name === name.trim();
      const previous=this.state.devices.find(sameClient);
      // Authentication renews; a retained Proxima view/follow still addresses the
      // same granted Backpack after the client's periodic same-account rejoin.
      const retainedBackpacks=backpacks.map(share=>({...share,id:previous?.backpacks?.find(item=>item.projectId===share.projectId&&item.kind===share.kind)?.id??share.id}));
      const device: Device = { deviceId: randomUUID(), name: name.trim(), pairedAt: this.now(), node, tokenHash: remoteTokenHash(token), shares: structuredClone(shares), canWrite, backpacks: structuredClone(retainedBackpacks) };
      const replaced = this.state.devices.filter(sameClient).map(item => item.deviceId);
      const candidate = { ...this.state, devices: [...this.state.devices.filter(item => !sameClient(item)), device] };
      await this.store.save(candidate);
      this.state = candidate;
      return { owner: { ...this.state.owner }, deviceId: device.deviceId, token, replaced };
    });
  }

  revoke(deviceId: string): Promise<void> {
    return this.serialize(async () => {
      const candidate = { ...this.state, devices: this.state.devices.filter(device => device.deviceId !== deviceId) };
      await this.store.save(candidate);
      this.state = candidate;
    });
  }
}
