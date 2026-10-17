import {it,expect} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID,randomBytes} from 'node:crypto';import {createRemoteFileGateway,remoteTokenHash} from '../src/main/backpacks/remoteFileGateway';
it('target resolution follows owner paths, conceals outside-share locations and requires current grants',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'papers-target-gateway-')),share=path.join(root,'share');await fs.mkdir(share);await fs.writeFile(path.join(share,'file.txt'),'hello');const id=randomUUID(),token=randomBytes(32).toString('base64url');let current=path.join(share,'file.txt');
 const targets={track:async(p:string)=>({targetId:id,status:'present',path:p,revision:1}),resolve:async()=>({targetId:id,status:'present',path:current,revision:2}),relocate:async()=>{},deleted:async()=>{}};
 const gateway=await createRemoteFileGateway({owner:{id:'owner',name:'PC'},grants:[{deviceId:'peer',tokenHash:remoteTokenHash(token),shares:[{id:'share',name:'Documents',directory:share}]}],fileTargets:targets});
 try{await new Promise<void>(r=>gateway.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(gateway.server.address() as any).port,headers={Authorization:'Bearer '+token};const request=async(body:unknown)=>fetch(base+'/v1/files/targets',{method:'POST',headers,body:JSON.stringify(body)});
 const shares=await(await fetch(base+'/v1/files/shares',{headers})).json();const listing=await(await fetch(base+'/v1/files/'+shares.entries[0].id+'/list',{headers})).json();const file=listing.entries[0];
 expect((await request({operation:'track',resourceId:file.id,expectedVersion:'wrong'})).status).toBe(400);
 const enrolled=await(await request({operation:'track',resourceId:file.id,expectedVersion:file.version})).json();expect(enrolled.target.targetId).toBe(id);expect(enrolled.target.parts).toEqual(['Documents','file.txt']);expect(JSON.stringify(enrolled)).not.toContain(share);
 expect((await request({operation:'delete',targetId:id,expectedRevision:1,commandId:randomUUID()})).status).toBe(403);
 current=path.join(share,'moved.txt');expect((await(await request({operation:'resolve',targetId:id})).json()).target.parts).toEqual(['Documents','moved.txt']);
 current=path.join(root,'private','secret.txt');const outside=await(await request({operation:'resolve',targetId:id})).json();expect(outside.target.status).toBe('unavailable');expect(outside.target.parts).toBeUndefined();expect(JSON.stringify(outside)).not.toContain('secret');
 gateway.revoke('peer');expect((await request({operation:'resolve',targetId:id})).status).toBe(401);
 }finally{await gateway.close();expect(path.basename(root).startsWith('papers-target-gateway-')).toBe(true);await fs.rm(root,{recursive:true,force:true});}
});
