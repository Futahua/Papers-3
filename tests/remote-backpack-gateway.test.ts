import {afterEach,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RemoteDeviceStore} from '../src/main/backpacks/remoteDeviceStore';
import {RemoteFileClient} from '../src/main/backpacks/remoteFileClient';
import {createRemoteFileGateway} from '../src/main/backpacks/remoteFileGateway';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const box={seal:(value:string)=>Buffer.from(value).toString('base64'),open:(value:string)=>Buffer.from(value,'base64').toString()};
async function fixture(read?:()=>Promise<unknown>){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'papers-backpacks-'));cleanups.push(()=>fs.rm(directory,{recursive:true,force:true}));const store=await RemoteDeviceStore.open(path.join(directory,'owner'),'Source');
 const share={id:randomUUID(),projectId:'bp-'+randomUUID(),name:'Proxima',kind:'proxima' as const};const snapshot={version:1,source:{ownerId:store.snapshot().owner.id,backpackId:share.projectId,seq:12},records:{projects:[{id:'project',name:'Approved data'}]}};
 const reader=vi.fn(read??(async()=>snapshot));const gateway=await createRemoteFileGateway({owner:store.snapshot().owner,grants:[],backpackSnapshot:reader,pair:async(code,name)=>{const paired=await store.redeem(code,name);return {...paired,grant:store.snapshot().devices.find(device=>device.deviceId===paired.deviceId)!};}});
 await new Promise<void>(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));let closed=false;const close=async()=>{if(!closed){closed=true;await gateway.close();}};cleanups.push(close);
 const address='http://127.0.0.1:'+(gateway.server.address() as {port:number}).port;return {directory,store,share,snapshot,reader,gateway,address,close};
}
it('requires a separate Backpack grant and never expands a legacy folder grant',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.directory,'files'));const legacy=await f.store.invite([{id:'folder',name:'Files',directory:path.join(f.directory,'files')}]);const paired=await(await fetch(f.address+'/v1/devices/pair',{method:'POST',body:JSON.stringify({code:legacy.code,name:'Reader'})})).json();const headers={Authorization:'Bearer '+paired.token};
 expect((await fetch(f.address+'/v1/backpacks')).status).toBe(401);expect((await(await fetch(f.address+'/v1/backpacks',{headers})).json()).entries).toEqual([]);expect((await fetch(f.address+'/v1/backpacks/'+f.share.id+'/snapshot',{headers})).status).toBe(403);expect(f.reader).not.toHaveBeenCalled();
});
it('pairs for data only, retains checked identity, and reads its cached catalog/snapshot offline',async()=>{
 const f=await fixture(),invitation=await f.store.invite([],false,[f.share]);const client=new RemoteFileClient(path.join(f.directory,'receiver'),box,true);await client.initialize();cleanups.push(()=>client.close());await client.pair(f.address,invitation.code,'Laptop');const ownerId=f.store.snapshot().owner.id;
 const catalog=await client.backpacks(ownerId);expect(catalog.online).toBe(true);expect(catalog.entries).toEqual([{id:f.share.id,name:'Proxima',kind:'proxima'}]);expect(JSON.stringify(catalog.entries)).not.toContain(f.share.projectId);
 const response=await client.backpackSnapshot(ownerId,f.share.id);expect(response.online).toBe(true);expect(response.snapshot).toEqual(f.snapshot);expect(f.reader).toHaveBeenCalledWith(f.share);
 expect((await fetch(f.address+'/v1/backpacks/'+f.share.id+'/snapshot',{method:'POST',headers:{Authorization:'Bearer '+box.open(JSON.parse(await fs.readFile(path.join(f.directory,'receiver/connections.json'),'utf8')).connections[0].secret)},body:'{}'})).status).toBe(405);
 await f.close();expect((await client.backpacks(ownerId)).online).toBe(false);const offline=await client.backpackSnapshot(ownerId,f.share.id);expect(offline.online).toBe(false);expect(offline.snapshot).toEqual(f.snapshot);
});
it('revocation closes a pending data response and refuses subsequent reads',async()=>{
 let release!:(value:unknown)=>void;const pending=new Promise(resolve=>{release=resolve;}),f=await fixture(()=>pending),invitation=await f.store.invite([],false,[f.share]),paired=await(await fetch(f.address+'/v1/devices/pair',{method:'POST',body:JSON.stringify({code:invitation.code,name:'Reader'})})).json();const headers={Authorization:'Bearer '+paired.token};
 const request=fetch(f.address+'/v1/backpacks/'+f.share.id+'/snapshot',{headers}).then(response=>response.json(),error=>({disconnected:!!error}));await vi.waitFor(()=>expect(f.reader).toHaveBeenCalledTimes(1));await f.store.revoke(paired.deviceId);f.gateway.revoke(paired.deviceId);release(f.snapshot);expect(await request).toMatchObject({disconnected:true});expect((await fetch(f.address+'/v1/backpacks',{headers})).status).toBe(401);
});
