import {it,expect} from 'vitest';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createRemoteFileGateway,remoteTokenHash} from '../src/main/backpacks/remoteFileGateway';
import {RemoteFileClient} from '../src/main/backpacks/remoteFileClient';
it('requires an existing grant and derives the reverse peer address from the authenticated socket',async()=>{
 const token='a'.repeat(43),deviceId=randomUUID(),seen:unknown[]=[];
 const gateway=await createRemoteFileGateway({owner:{id:randomUUID(),name:'PC'},grants:[{deviceId,tokenHash:remoteTokenHash(token),shares:[]}],peerConnect:async(...args)=>{seen.push(args);}});
 await new Promise<void>(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(gateway.server.address() as {port:number}).port}`;
 try{const invitation={owner:{id:randomUUID(),name:'Phone',kind:'phone'},deviceId:randomUUID(),token:'b'.repeat(43),address:'http://attacker.invalid'};
 expect((await fetch(base+'/v1/peer/connect',{method:'PUT',body:JSON.stringify(invitation)})).status).toBe(401);expect(seen).toHaveLength(0);
 expect((await fetch(base+'/v1/peer/connect',{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(invitation)})).status).toBe(200);
 expect(seen).toEqual([['127.0.0.1',deviceId,invitation]]);
 }finally{await gateway.close();}
});
it('preserves durable phone identity and refuses invalid invitations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-phone-trust-')),box={seal:(value:string)=>value,open:(value:string)=>value},client=new RemoteFileClient(dir,box);
 try{await client.initialize();const invitation={owner:{id:randomUUID(),name:'Poordroid',kind:'phone'},token:'c'.repeat(43),deviceId:randomUUID()},oldId=randomUUID();
 await expect(client.acceptPhone('192.168.1.2',oldId,invitation)).rejects.toThrow();
 await expect(client.acceptPhone('100.124.102.127',oldId,{...invitation,token:'bad'})).rejects.toThrow();
 await client.acceptPhone('100.124.102.127',oldId,invitation);expect(client.phoneForPeer(oldId)).toBe(invitation.owner.id);expect(client.snapshot().devices).toEqual([{id:invitation.owner.id,name:'Poordroid',address:'http://100.124.102.127:48240',kind:'phone',legacyPeerId:oldId}]);
 await client.close();const reopened=new RemoteFileClient(dir,box);try{await reopened.initialize();expect(reopened.phoneForPeer(oldId)).toBe(invitation.owner.id);}finally{await reopened.close();}
 }finally{await client.close();await fs.rm(dir,{recursive:true,force:true});}
});
