import * as os from 'node:os';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { RemoteDeviceStore } from './remoteDeviceStore';
import { createRemoteFileGateway, type RemoteBackpackShare } from './remoteFileGateway';
import { randomUUID } from 'node:crypto';
import type { RemoteFileMutations } from './remoteFileMutations';

export class RemoteDeviceService {
  private devices: RemoteDeviceStore | null = null;
  private gateway: Awaited<ReturnType<typeof createRemoteFileGateway>> | null = null;
  private address: string | null = null;
  private failure: string | null = null;
  mutations: RemoteFileMutations | null = null;
  readBackpack: ((share:RemoteBackpackShare)=>Promise<unknown>) | null = null;
  private readonly configuration: AtomicJsonStore;
  constructor(private readonly directory: string,private readonly port=48240) {
    this.configuration = new AtomicJsonStore(path.join(directory, 'connection.json'), { recoveryDir: path.join(directory, 'recovery') });
  }
  async initialize(): Promise<void> {
    try {
      this.devices = await RemoteDeviceStore.open(this.directory, os.hostname());
      const config = await this.configuration.load<{ enabled: boolean }>();
      if (config.value?.enabled === true) await this.start();
    } catch (error) { this.failure = error instanceof Error ? error.message : 'Device connection is unavailable.'; }
  }
  snapshot() {
    const snapshot = this.devices?.snapshot();
    return { owner: snapshot?.owner ?? null, address: this.address, error: this.failure, devices: snapshot?.devices.map(device => ({ id: device.deviceId, name: device.name, pairedAt: device.pairedAt, folders: device.shares.map(share => share.name),backpacks:(device.backpacks??[]).map(share=>share.name) })) ?? [] };
  }
  private async start(): Promise<void> {
    if (this.gateway) return;
    if (!this.devices) throw new Error('Device identity is unavailable.');
    const address = Object.entries(os.networkInterfaces()).filter(([name]) => /tailscale/i.test(name)).flatMap(([, entries]) => entries ?? []).find(entry => entry.family === 'IPv4' && !entry.internal)?.address;
    if (!address) throw new Error('Connect Tailscale on this computer first.');
    const devices = this.devices;
    const snapshot = devices.snapshot();
    const gateway = await createRemoteFileGateway({ owner: snapshot.owner, grants: snapshot.devices,
      backpackSnapshot:share=>{if(!this.readBackpack)throw Error('Backpack execution owner is unavailable.');return this.readBackpack(share);},
      mutate:async(deviceId,catalog,request)=>{if(!this.mutations)throw new Error('File changes are unavailable.');return this.mutations.submit(deviceId,catalog,request);},
      changes:deviceId=>this.mutations?.list(deviceId)??[],revokeChanges:deviceId=>this.mutations?.revoke(deviceId),
      pair: async (code, name) => {
      const paired = await devices.redeem(code, name);
      return { ...paired, grant: devices.snapshot().devices.find(device => device.deviceId === paired.deviceId)! };
    } });
    try {
      await new Promise<void>((resolve, reject) => {
        gateway.server.once('error', reject);
        gateway.server.listen(this.port, address, () => { gateway.server.removeListener('error', reject); resolve(); });
      });
      this.gateway = gateway;
      this.address = `http://${address}:${(gateway.server.address() as {port:number}).port}`;
      this.failure = null;
    } catch (error) { await gateway.close().catch(() => {}); throw error; }
  }
  async invite(directories: string[], canWrite = false, backpacks:RemoteBackpackShare[]=[]) {
    if (!this.devices) throw new Error(this.failure ?? 'Device identity is unavailable.');
    await this.start();
    const invitation = await this.devices.invite(directories.map(directory => ({ id: randomUUID(), name: path.basename(directory) || directory, directory })),canWrite,backpacks);
    await this.configuration.save({ enabled: true });
    return { ...invitation, address: this.address, owner: this.devices.snapshot().owner };
  }
  async revoke(id: string): Promise<void> {
    await this.devices?.revoke(id);
    this.gateway?.revoke(id);
  }
  async close(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = null;
    this.address = null;
    await gateway?.close();
  }
}
