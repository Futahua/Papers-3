import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RemoteFileOutbox } from '../src/main/backpacks/remoteFileOutbox';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'papers-outbox-'));roots.push(root);const outbox=new RemoteFileOutbox(root);await outbox.initialize();return {root,outbox,ownerId:randomUUID(),deviceId:randomUUID(),command:{commandId:randomUUID(),operation:'rename',resourceId:randomUUID(),expectedVersion:'a'.repeat(64),newName:'renamed.txt'}};}
it('saves before sending and retries the same identity after a lost response and receiver restart',async()=>{
 const f=await fixture();const nativeFile=path.join(f.root,'native.txt');await fs.writeFile(nativeFile,'retained bytes');let executed=false;
 const dispatch=vi.fn(async(raw:unknown)=>{const command=raw as typeof f.command;const saved=JSON.parse(await fs.readFile(path.join(f.root,'outbox.json'),'utf8'));expect(saved.commands[0].command.commandId).toBe(command.commandId);if(!executed){executed=true;await fs.rename(nativeFile,path.join(f.root,'renamed.txt'));throw new Error('Response connection was lost.');}return {commandId:command.commandId,phase:'completed'};});
 await expect(f.outbox.send(f.ownerId,f.deviceId,f.command,dispatch)).rejects.toThrow('connection was lost');await f.outbox.close();
 await expect(f.outbox.send(f.ownerId,f.deviceId,{...f.command,commandId:randomUUID()},dispatch)).rejects.toThrow('Retry the saved request');
 const reopened=new RemoteFileOutbox(f.root);await reopened.initialize();expect(reopened.snapshot()[0]!.phase).toBe('uncertain');
 await reopened.retry(f.ownerId,f.deviceId,f.command.commandId,dispatch);await reopened.close();
 expect(dispatch).toHaveBeenCalledTimes(2);expect(dispatch.mock.calls[1]![0]).toEqual(f.command);expect(await fs.readFile(path.join(f.root,'renamed.txt'),'utf8')).toBe('retained bytes');expect(reopened.snapshot()[0]!.phase).toBe('completed');
});
it('shares concurrent dispatch and refuses replay under a new pairing',async()=>{
 const f=await fixture();let resolve!:(value:unknown)=>void;const response=new Promise(resolveResponse=>{resolve=resolveResponse;});const dispatch=vi.fn(()=>response);
 const first=f.outbox.send(f.ownerId,f.deviceId,f.command,dispatch),second=f.outbox.send(f.ownerId,f.deviceId,f.command,dispatch);
 await vi.waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(1));resolve({commandId:f.command.commandId,phase:'queued'});await Promise.all([first,second]);
 await expect(f.outbox.retry(f.ownerId,randomUUID(),f.command.commandId,dispatch)).rejects.toThrow('different pairing');
 await expect(f.outbox.send(f.ownerId,f.deviceId,{...f.command,newName:'other.txt'},dispatch)).rejects.toThrow('different pairing or operation');await f.outbox.close();
});
it('refuses dispatch when the durable journal cannot be written',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.root,'outbox.json'));const dispatch=vi.fn();await expect(f.outbox.send(f.ownerId,f.deviceId,f.command,dispatch)).rejects.toThrow();expect(dispatch).not.toHaveBeenCalled();await f.outbox.close();
});
it('reconciles an ambiguous request from owner history without redispatch',async()=>{
 const f=await fixture(),dispatch=vi.fn(async()=>{throw new Error('Connection lost');});await expect(f.outbox.send(f.ownerId,f.deviceId,f.command,dispatch)).rejects.toThrow();await f.outbox.reconcile(f.ownerId,[{commandId:f.command.commandId,phase:'completed'}]);expect(f.outbox.snapshot()[0]!.phase).toBe('completed');expect(f.outbox.snapshot()[0]!.error).toBeUndefined();expect(dispatch).toHaveBeenCalledTimes(1);await f.outbox.close();
});
