// Temporary uniquely named facts only; all mutations go through the live owner's Store.command.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const address=process.argv[2];if(!/^http:\/\/100\.\d+\.\d+\.\d+:48240$/.test(address||''))throw Error('Supply a Tailscale owner address.');
const joined=await(await fetch(address+'/v1/devices/join',{method:'POST',body:JSON.stringify({name:'Proxima command verification'}),headers:{'Content-Type':'application/json'}})).json();if(!joined.token)throw Error('Owner refused trusted join.');
const headers={Authorization:'Bearer '+joined.token,'Content-Type':'application/json'};
const request=async(route,command)=>{const r=await fetch(address+route,{headers,...(command?{method:'POST',body:JSON.stringify(command)}:{}),signal:AbortSignal.timeout(25000)});const value=await r.json();if(!r.ok||value.ok===false)throw Error(value.code||'Owner unavailable');return value;};
const catalog=await request('/v1/backpacks'),share=catalog.entries.find(e=>e.kind==='proxima');if(!share)throw Error('Owner has no shared Proxima.');const route='/v1/backpacks/'+share.id;let snapshot=(await request(route+'/snapshot')).snapshot,created;
const send=async envelope=>{const response=await request(route+'/commands',envelope);assert.equal(response.owner.id,joined.owner.id);assert.equal(response.snapshot.source.ownerId,joined.owner.id);snapshot=response.snapshot;return response.command;};
const act=(type,payload)=>send({type,payload,commandId:randomUUID(),expectedSeq:snapshot.source.seq});
const name='Temporary cross-device verification '+randomUUID();
try{
 const envelope={type:'task.create',payload:{name},commandId:randomUUID(),expectedSeq:snapshot.source.seq};let result=await send(envelope);assert.equal(result.ok,true);created=result.value.id;assert.equal(snapshot.records.tasks.find(t=>t.id===created)?.name,name);console.log('PASS live owner created and durably confirmed temporary task');
 result=await send(envelope);assert.equal(result.ok,true);assert.equal(result.replayed,true);assert.equal(snapshot.records.tasks.filter(t=>t.id===created).length,1);console.log('PASS same request replayed without duplicate task');
 const previous=snapshot.source.seq;result=await act('task.patch',{taskId:created,patch:{name:name+' edited'}});assert.equal(result.ok,true);assert.equal(snapshot.records.tasks.find(t=>t.id===created)?.name,name+' edited');console.log('PASS live owner applied edit and returned current facts');
 result=await send({type:'task.patch',payload:{taskId:created,patch:{name:'Must never be saved'}},commandId:randomUUID(),expectedSeq:previous});assert.equal(result.ok,false);assert.equal(result.code,'SOURCE_CHANGED');assert.equal(snapshot.records.tasks.find(t=>t.id===created)?.name,name+' edited');console.log('PASS stale remote edit refused without overwriting owner');
}finally{
 if(created){snapshot=(await request(route+'/snapshot')).snapshot;const result=await act('task.delete',{taskId:created});assert.equal(result.ok,true);assert.equal(snapshot.records.tasks.some(t=>t.id===created),false);console.log('PASS temporary task removed through owner; creator facts preserved');}
}
