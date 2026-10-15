import * as os from 'node:os';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { RemoteDeviceStore } from './remoteDeviceStore';
import { createRemoteFileGateway, type RemoteBackpackShare } from './remoteFileGateway';
import { randomUUID } from 'node:crypto';
import type { RemoteFileMutations } from './remoteFileMutations';
import type { RemoteFileEditOwner } from './remoteFileEditOwner';
import { logDevice, sameAccountNode } from './tailnetIdentity';
import type { RemoteFileShare } from './remoteFileResources';

export class RemoteDeviceService {
  private devices: RemoteDeviceStore | null = null;
  private gateway: Awaited<ReturnType<typeof createRemoteFileGateway>> | null = null;
  private address: string | null = null;
  private failure: string | null = null;
  mutations: RemoteFileMutations | null = null;
  edits: RemoteFileEditOwner | null = null;
  readBackpack: ((share:RemoteBackpackShare,control?:boolean)=>Promise<unknown>) | null = null;
  commandBackpack: ((share:RemoteBackpackShare,command:Record<string,unknown>)=>Promise<unknown>) | null = null;
  peerProxima: ((deviceId:string,snapshot:Record<string,unknown>)=>Promise<void>) | null = null;
  peerConnect: ((peerAddress:string,grantDeviceId:string,invitation:unknown)=>Promise<void>) | null = null;
  replaceBackpack: ((share:RemoteBackpackShare,projection:Record<string,unknown>)=>Promise<unknown>) | null = null;
  peerReplacement: { take:(deviceId:string)=>Promise<unknown>; clear:(deviceId:string)=>Promise<void> } | null = null;
  workspaces: Parameters<typeof createRemoteFileGateway>[0]['workspaces'] | null = null;
  preview: ((target:string)=>Promise<Record<string,unknown>>) | null = null;
  search: ((query:string,limit:number)=>Promise<{results:{path:string;name:string;kind:'file'|'folder';size:number|null;modifiedAt:number|null}[]}>) | null = null;
  inbox:Parameters<typeof createRemoteFileGateway>[0]['inbox']|null=null;
  /** What a device on the creator's own Tailscale account receives when it joins. */
  defaultGrant: (() => Promise<{ shares: RemoteFileShare[]; canWrite: boolean; backpacks: RemoteBackpackShare[] }>) | null = null;
  private readonly configuration: AtomicJsonStore;
  constructor(private readonly directory: string,private readonly port=48240) {
    this.configuration = new AtomicJsonStore(path.join(directory, 'connection.json'), { recoveryDir: path.join(directory, 'recovery') });
  }
  async initialize(): Promise<void> {
    try {
      this.devices = await RemoteDeviceStore.open(this.directory, os.hostname());
      // Always listen when Tailscale is up; access is still limited to the creator's own account.
      await this.start().then(() => logDevice('owner-listening', { address: this.address }), error => logDevice('owner-not-listening', { reason: error instanceof Error ? error.message : String(error) }));
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
      inbox:{get:()=>{if(!this.inbox)throw Error('Inbox settings are unavailable.');return this.inbox.get();},set:parts=>{if(!this.inbox)throw Error('Inbox settings are unavailable.');return this.inbox.set(parts);}},
      edits: this.edits ?? undefined,
      workspaces:{list:()=>this.workspaces?.list()??Promise.resolve([]),load:projectId=>{if(!this.workspaces)throw Error('Workspaces are unavailable.');return this.workspaces.load(projectId);},save:(projectId,raw,revision)=>{if(!this.workspaces)throw Error('Workspaces are unavailable.');return this.workspaces.save(projectId,raw,revision);},icon:(projectId,name)=>{if(!this.workspaces)throw Error('Workspaces are unavailable.');return this.workspaces.icon(projectId,name);}},
      preview:target=>{if(!this.preview)throw Error('Previews are unavailable.');return this.preview(target);},
      search:(query,limit)=>{if(!this.search)throw Error('Search is unavailable on this computer.');return this.search(query,limit);},
      backpackSnapshot:(share,control)=>{if(!this.readBackpack)throw Error('Backpack execution owner is unavailable.');return this.readBackpack(share,control);},
      backpackCommand:(share,command)=>{if(!this.commandBackpack)throw Error('Backpack execution owner is unavailable.');return this.commandBackpack(share,command);},
      peerProxima:(deviceId,snapshot)=>{if(!this.peerProxima)throw Error('Peer Proxima storage is unavailable.');return this.peerProxima(deviceId,snapshot);},
      peerConnect:async(peer,deviceId,invitation)=>{await sameAccountNode(peer);if(!this.peerConnect)throw Error('Phone sharing is not ready.');await this.peerConnect(peer,deviceId,invitation);},
      backpackReplace:(share,projection)=>{if(!this.replaceBackpack)throw Error('Backpack execution owner is unavailable.');return this.replaceBackpack(share,projection);},
      peerReplacement:{take:deviceId=>this.peerReplacement?this.peerReplacement.take(deviceId):Promise.resolve(null),clear:deviceId=>this.peerReplacement?this.peerReplacement.clear(deviceId):Promise.resolve()},
      mutate:async(deviceId,catalog,request)=>{if(!this.mutations)throw new Error('File changes are unavailable.');return this.mutations.submit(deviceId,catalog,request);},
      changes:deviceId=>this.mutations?.list(deviceId)??[],revokeChanges:deviceId=>this.mutations?.revoke(deviceId),
      join: async (peer, name) => {
      // Papers wires the grant a moment after the listener opens at startup; wait briefly rather than refuse.
      for (let attempt = 0; !this.defaultGrant && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 250));
      if (!this.defaultGrant) throw new Error('Device sharing is not ready.');
      const node = await sameAccountNode(peer);
      const grant = await this.defaultGrant();
      const joined = await devices.admit(node, name, grant.shares, grant.canWrite, grant.backpacks);
      return { ...joined, grant: devices.snapshot().devices.find(device => device.deviceId === joined.deviceId)! };
    },
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
