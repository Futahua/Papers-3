import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RemoteFileResources } from '../src/main/backpacks/remoteFileResources';
import { RemoteFileMutations } from '../src/main/backpacks/remoteFileMutations';
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>fs.rm(directory,{recursive:true,force:true})));});
async function fixture(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'papers-file-changes-'));directories.push(directory);const shared=path.join(directory,'shared');await fs.mkdir(shared);await fs.writeFile(path.join(shared,'source.txt'),'original');const catalog=await RemoteFileResources.create([{id:'share',name:'Files',directory:shared}]);const root=(await catalog.shares())[0]!;const source=(await catalog.list(root.id)).entries[0]!;return {directory,shared,catalog,root,source};}
it('does not mark provider acceptance complete until actual rename and verification',async()=>{
 const f=await fixture();let checks=0;
 const owner=vi.fn(async()=>({ok:true}));
 const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),owner,async()=>{checks++;await fs.rename(path.join(f.shared,'source.txt'),path.join(f.shared,'renamed.txt'));},3);
 await mutations.initialize();const command={commandId:randomUUID(),operation:'rename',resourceId:f.source.id,expectedVersion:f.source.version,newName:'renamed.txt'};
 await mutations.submit('device',f.catalog,command);await mutations.close();
 expect(checks).toBe(1);expect(mutations.list('device')[0]!.phase).toBe('completed');expect(owner).toHaveBeenCalledTimes(1);
 const reopened=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await reopened.initialize();await reopened.submit('device',f.catalog,command);await reopened.close();expect(owner).toHaveBeenCalledTimes(1);
});
it('refuses stale source versions and existing destinations without invoking the owner',async()=>{
 const f=await fixture(),owner=vi.fn(async()=>({ok:true}));const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await mutations.initialize();
 await fs.writeFile(path.join(f.shared,'source.txt'),'externally changed');
 await mutations.submit('device',f.catalog,{commandId:randomUUID(),operation:'rename',resourceId:f.source.id,expectedVersion:f.source.version,newName:'other.txt'});await mutations.close();
 expect(owner).not.toHaveBeenCalled();expect(mutations.list('device')[0]!.phase).toBe('failed');expect(await fs.readFile(path.join(f.shared,'source.txt'),'utf8')).toBe('externally changed');
});
it('preserves source and refuses to claim a corrupt copy completed',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.shared,'destination'));const destination=(await f.catalog.list(f.root.id)).entries.find(e=>e.name==='destination')!;
 const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),async()=>{await fs.writeFile(path.join(f.shared,'destination/source.txt'),'wrong');return {ok:true};},async()=>{},2);await mutations.initialize();
 await mutations.submit('device',f.catalog,{commandId:randomUUID(),operation:'copy',resourceId:f.source.id,expectedVersion:f.source.version,destinationId:destination.id,destinationVersion:destination.version});await mutations.close();
 expect(mutations.list('device')[0]!.phase).toBe('uncertain');expect(await fs.readFile(path.join(f.shared,'source.txt'),'utf8')).toBe('original');expect(await fs.readFile(path.join(f.shared,'destination/source.txt'),'utf8')).toBe('wrong');
});
it('refuses root deletion and a reused command ID with a different intent',async()=>{
 const f=await fixture(),owner=vi.fn(async()=>({ok:true}));const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await mutations.initialize();const command={commandId:randomUUID(),operation:'delete',resourceId:f.root.id,expectedVersion:f.root.version};
 await mutations.submit('device',f.catalog,command);await mutations.close();expect(owner).not.toHaveBeenCalled();
 const reopened=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await reopened.initialize();await expect(reopened.submit('device',f.catalog,{...command,operation:'rename',newName:'different'})).rejects.toThrow('another operation');
});
it('does not redispatch an ambiguous operation after restart',async()=>{
 const f=await fixture(),owner=vi.fn(async()=>({ok:true}));await fs.mkdir(path.join(f.directory,'journal'));await fs.writeFile(path.join(f.directory,'journal/commands.json'),JSON.stringify({jobs:[{commandId:randomUUID(),deviceId:'device',operation:'move',phase:'waiting',intentHash:'hash'}]}));
 const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await mutations.initialize();expect(mutations.list('device')[0]!.phase).toBe('uncertain');expect(owner).not.toHaveBeenCalled();
});
it('acknowledges queued requests and deduplicates concurrent submissions while the owner is busy',async()=>{
 const f=await fixture();let release!:()=>void;let entered!:()=>void;
 const busy=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const owner=vi.fn(async()=>{entered();await busy;await fs.rename(path.join(f.shared,'source.txt'),path.join(f.shared,'renamed.txt'));return {ok:true};});
 const mutations=new RemoteFileMutations(path.join(f.directory,'journal'),owner);await mutations.initialize();
 const first={commandId:randomUUID(),operation:'rename',resourceId:f.source.id,expectedVersion:f.source.version,newName:'renamed.txt'};
 await Promise.all([mutations.submit('device',f.catalog,first),mutations.submit('device',f.catalog,first)]);await started;
 const second={commandId:randomUUID(),operation:'create-folder',resourceId:f.root.id,expectedVersion:f.root.version,newName:'queued'};
 try {
  const accepted=await mutations.submit('device',f.catalog,second);
  expect(accepted.phase).toBe('queued');expect(owner).toHaveBeenCalledTimes(1);
  mutations.revoke('device');
 } finally {release();await mutations.close();}
 expect(owner).toHaveBeenCalledTimes(1);
 expect(mutations.list('device').find(job=>job.commandId===second.commandId)?.phase).toBe('failed');
 expect(await fs.stat(path.join(f.shared,'renamed.txt'))).toBeDefined();
 await expect(fs.stat(path.join(f.shared,'queued'))).rejects.toMatchObject({code:'ENOENT'});
});
