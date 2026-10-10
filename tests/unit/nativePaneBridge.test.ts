import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const h=vi.hoisted(()=>({children:[] as any[],spawn:vi.fn(),failMount:false,failViewport:false,journal:null as unknown,writes:new Map<string,string>()}));
vi.mock('node:child_process',()=>({spawn:h.spawn,execFileSync:vi.fn()}));
vi.mock('node:fs',()=>({existsSync:(file:string)=>file.endsWith('pane-transfer-journal.json')?h.journal!==null:true,
 readFileSync:(file:string)=>file.endsWith('pane-transfer-journal.json')?JSON.stringify(h.journal):Buffer.from('source'),mkdirSync:vi.fn(),
 openSync:(file:string)=>file,writeFileSync:(file:string,value:string)=>h.writes.set(file,value),fsyncSync:vi.fn(),closeSync:vi.fn(),renameSync:(from:string,to:string)=>{h.writes.set(to,h.writes.get(from)!);h.writes.delete(from);}}));
vi.mock('../../src/main/windows/foregroundBridge',()=>({resolveWindowsCscPath:()=> 'X:/csc.exe'}));
import { createNativePaneBridge } from '../../src/main/backpacks/nativePaneBridge';
const platform=process.platform;
const rect={x:400,y:20,width:500,height:600};
const context=(ownerKey:string,paneGroup='ayg',parentHwnd='456')=>({ownerKey,paneGroup,parentHwnd,surfaceBounds:{x:10,y:30,width:1000,height:800}});
beforeEach(()=>{
 Object.defineProperty(process,'platform',{value:'win32'});h.children.length=0;h.failMount=false;h.failViewport=false;h.spawn.mockReset();h.journal=null;h.writes.clear();
 h.spawn.mockImplementation(()=>{
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),commands:[] as any[],states:new Map()});
  child.stdin.on('data',data=>{const r=JSON.parse(data.toString());child.commands.push(r);
   queueMicrotask(()=>{const previous=child.states.get(r.scope),snapshot={binding:r.binding,bindingGeneration:(previous?.bindingGeneration??0)+(r.op==='mount'?1:0),stateRevision:(previous?.stateRevision??1)+1,geometryRevision:(previous?.geometryRevision??1)+1,
    viewport:r.rect??previous?.viewport,tree:{id:'main'},presented:true,groups:[{id:'main',selected:'peer',presentation:'normal',slot:r.rect??previous?.viewport,content:r.rect??previous?.viewport,tabs:[{id:'peer',kind:'native',handle:789,pid:123,active:true,title:'Fixture'}]}]};
    if(r.op==='mount'&&h.failMount){child.stdout.write(JSON.stringify({id:r.id,result:{ok:false,error:'mount rejected'}})+'\n');return;}
    if(r.op==='viewport'&&h.failViewport){child.stdout.write(JSON.stringify({id:r.id,result:{ok:false,error:'minimum size rejected'}})+'\n');return;}
    if(r.scope)child.states.set(r.scope,snapshot);child.stdout.write(JSON.stringify({id:r.id,result:{ok:true,snapshot:r.scope?snapshot:undefined}})+'\n');
   });
  });h.children.push(child);return child;
 });
});
afterEach(()=>Object.defineProperty(process,'platform',{value:platform}));
const make=(onSnapshot=vi.fn())=>createNativePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native',onSnapshot,windowInstanceId:()=> 'opaque-instance'})!;
it('saved shutdown is bounded when a helper stops answering and queued presentation is retired',async()=>{
 const bridge=make();await bridge.mount(context('1:first'),rect,32);const child=h.children[0];child.kill=vi.fn();child.stdin.removeAllListeners('data');
 vi.useFakeTimers();try{const pending=bridge.command('1:first','snapshot');await Promise.resolve();const stopped=bridge.dispose();await vi.advanceTimersByTimeAsync(20000);await stopped;expect(child.kill).toHaveBeenCalledOnce();expect((await pending).ok).toBe(false);expect(bridge.snapshot('1:first')).toBeUndefined();}finally{vi.useRealTimers();}
});
it.each(['prepared','committed'])('recovers a %s handoff before mounting and saves only durable references in page intent',async status=>{
 const a='a'.repeat(64),b='b'.repeat(64),mount={Version:1,HeaderHeight:28,Root:{GroupId:'main'},Groups:[],Peers:[{TabId:'peer',GroupId:'main',Handle:123,Pid:456,Started:789,Title:'CAD'}],Documents:[]};
 h.journal={status,records:[{key:a,mount},{key:b,mount}]};const bridge=make();
 const written=(suffix:string)=>[...h.writes].find(([file])=>file.replaceAll('\\','/').endsWith(suffix))?.[1];
 for(const key of [a,b]){const runtime=JSON.parse(written('cache/pane-mount-'+key+'.json')!);expect(runtime.Peers[0].Handle).toBe(123);
  const intent=[...h.writes].find(([file])=>file.includes('pane-layouts')&&file.endsWith(key+'.json'))!;expect(JSON.parse(intent[1]).Peers[0]).toEqual({TabId:'peer',GroupId:'main',Title:'CAD'});}
 expect(JSON.parse(written('cache/pane-transfer-journal.json')!).status).toBe(status==='prepared'?'rolled-back':'recovered-commit');await bridge.dispose();
});
it('never replays a settled handoff over newer edits',async()=>{
 h.journal={status:'settled',records:[{key:'a'.repeat(64),mount:{}},{key:'b'.repeat(64),mount:{}}]};const bridge=make();expect(h.writes.size).toBe(0);await bridge.dispose();
});
it('one physical endpoint retains separate Backpack scopes and strips native handles from page snapshots',async()=>{
 const bridge=make();const a=await bridge.mount(context('1:a'),rect,32),b=await bridge.mount(context('1:b','proxima'),rect,32);
 expect(h.spawn).toHaveBeenCalledTimes(1);expect(h.children[0].commands[0].scope).not.toBe(h.children[0].commands[1].scope);
 expect(a.snapshot?.groups[0]?.tabs[0]).toEqual({id:'peer',kind:'native',active:true,title:'Fixture',windowInstanceId:'opaque-instance',transferId:expect.stringMatching(/^[a-f0-9]{32}$/)});
 expect(b.snapshot?.viewport).toMatchObject(rect);expect(h.children[0].commands[0].rect).toMatchObject({x:410,y:50});await bridge.dispose();
});
it('remount rejects old-owner commands, stale binding events and out-of-order geometry',async()=>{
 const events=vi.fn(),bridge=make(events);await bridge.mount(context('1:first'),rect,32);const child=h.children[0],old=child.states.get(child.commands[0].scope);
 await bridge.mount(context('1:second'),rect,32);const count=events.mock.calls.length;
 child.stdout.write(JSON.stringify({kind:'snapshot',scope:child.commands[0].scope,snapshot:old})+'\n');expect(events).toHaveBeenCalledTimes(count);
 const current=bridge.snapshot('1:second')!;child.stdout.write(JSON.stringify({kind:'snapshot',scope:child.commands[0].scope,snapshot:{...current,geometryRevision:0}})+'\n');expect(events).toHaveBeenCalledTimes(count);
 expect((await bridge.command('1:first','select',{tabId:'peer',groupId:'main'})).ok).toBe(false);await bridge.dispose();
});
it('checkpoint scope is stable across HWND and surface changes without crossing logical windows',async()=>{
 const first=make();await first.mount(context('1:first'),rect,32);const key=h.children[0].commands[0].scope;await first.dispose();
 const next=make();await next.mount(context('1:second','ayg','999'),rect,32);expect(h.children[1].commands[0].scope).toBe(key);
 await next.mount(context('2:third','ayg','1000'),rect,32);expect(h.children[2].commands[0].scope).not.toBe(key);await next.dispose();
});
it('failed mounts cannot claim, and hidden page mounts retain membership without presenting or accepting selection',async()=>{
 const bridge=make();h.failMount=true;expect((await bridge.mount(context('1:bad'),rect,32)).ok).toBe(false);expect(bridge.has('1:bad')).toBe(false);
 h.failMount=false;bridge.setOwnerVisible('1:hidden',false);expect((await bridge.mount(context('1:hidden'),rect,32)).ok).toBe(true);expect(h.children[0].commands.at(-1)).toMatchObject({op:'mount',visible:false});expect((await bridge.command('1:hidden','select',{tabId:'peer'})).ok).toBe(false);await bridge.dispose();
});
it('viewport updates preserve native feedback and never replay tab selection',async()=>{
 const bridge=make();await bridge.mount(context('1:a'),rect,32);const child=h.children[0],key=child.commands[0].scope;
 const snapshot=bridge.snapshot('1:a')!;child.stdout.write(JSON.stringify({kind:'snapshot',scope:key,snapshot:{...snapshot,nativeEdgeRevision:1,geometryRevision:snapshot.geometryRevision+1,viewport:{...snapshot.viewport,x:510,width:400}}})+'\n');
 bridge.setOwnerSurfaceBounds('1:a',{x:20,y:40,width:1100,height:800});await bridge.command('1:a','snapshot');
 expect(child.commands.findLast((r:any)=>r.op==='viewport')).toMatchObject({rect:{x:520,y:60,width:400}});
 expect(child.commands.some((r:any)=>r.op==='select')).toBe(false);await bridge.closeOwner('1:a');expect(bridge.has('1:a')).toBe(false);await bridge.dispose();
});
it('rejected viewport updates are reported and cannot replace the retained root rectangle',async()=>{
 const bridge=make();await bridge.mount(context('1:a'),{...rect,rightInset:8,bottomInset:10},32);const child=h.children[0];
 h.failViewport=true;expect((await bridge.move('1:a',{x:999,y:999,width:1,height:1})).ok).toBe(false);
 h.failViewport=false;bridge.setOwnerSurfaceBounds('1:a',{x:20,y:40,width:1100,height:800});await bridge.command('1:a','snapshot');
 expect(child.commands.findLast((r:any)=>r.op==='viewport')).toMatchObject({rect:{x:420,y:60,width:500,height:600,rightInset:8,bottomInset:10}});await bridge.dispose();
});

it('page identity isolates two AYG pages and follows the page across physical windows',async()=>{
 const bridge=make();await bridge.mount({...context('1:first'),layoutKey:'ayg:page-one'},rect,28);const first=h.children[0].commands[0].scope;
 await bridge.mount({...context('1:second'),layoutKey:'ayg:page-two'},rect,28);expect(h.children[0].commands[1].scope).not.toBe(first);
 await bridge.closeOwner('1:first');await bridge.mount({...context('2:moved','ayg','1000'),layoutKey:'ayg:page-one'},rect,28);
 expect(h.children[1].commands[0].scope).toBe(first);await bridge.dispose();
});
it('picker ownership names a foreign owner and never reveals a stale transfer ticket',async()=>{
 const revealOwner=vi.fn(),bridge=createNativePaneBridge({cacheDirectory:'X:/cache',nativeDirectory:'X:/native',windowInstanceId:()=> 'instance',ownerLabel:()=> 'Design · another window',revealOwner})!;
 await bridge.mount(context('1:first'),rect,32);await bridge.mount(context('2:second','ayg','1000'),rect,32);
 const claim=bridge.ownership('instance','2:second')!;expect(claim).toMatchObject({samePage:false,label:'Design · another window'});
 expect((await bridge.reveal('2:second',claim.transferId)).ok).toBe(true);expect(revealOwner).toHaveBeenCalledWith('1:first');
 await bridge.closeOwner('1:first');expect((await bridge.reveal('2:second',claim.transferId)).ok).toBe(false);
 expect((await bridge.transfer('2:second',claim.transferId,'main')).ok).toBe(false);await bridge.dispose();
});

it('a cross-window drag yields every native target, then restores owner visibility on completion or source close',async()=>{
 const bridge=make();await bridge.mount(context('1:first'),rect,32);await bridge.mount(context('2:second','ayg','1000'),rect,32);
 await bridge.dragOverlay('1:first',true);for(const child of h.children)expect(child.commands.findLast((c:any)=>c.op==='present').visible).toBe(false);
 await bridge.command('2:second','present',{visible:true});expect(h.children[1].commands.at(-1).visible).toBe(false);
 bridge.setOwnerVisible('2:second',false);await bridge.closeOwner('1:first');await bridge.command('2:second','snapshot');
 expect(h.children[1].commands.findLast((c:any)=>c.op==='present').visible).toBe(false);bridge.setOwnerVisible('2:second',true);await bridge.command('2:second','snapshot');
 expect(h.children[1].commands.findLast((c:any)=>c.op==='present').visible).toBe(true);await bridge.dispose();
});
it('a simultaneous drag heartbeat waits for initial presentation and returns its current revision',async()=>{
 const bridge=make();await bridge.mount(context('1:first'),rect,32);
 const [begin,heartbeat]=await Promise.all([bridge.dragOverlay('1:first',true),bridge.dragOverlay('1:first',true)]);
 expect(heartbeat.snapshot?.stateRevision).toBe(begin.snapshot?.stateRevision);expect(heartbeat.snapshot?.stateRevision).toBe(bridge.snapshot('1:first')?.stateRevision);await bridge.dispose();
});
it('host menus suspend only their window and block presentation replay until the menu closes',async()=>{
 const bridge=make();await bridge.mount(context('1:first'),rect,32);await bridge.mount(context('2:second','ayg','1000'),rect,32);
 await bridge.setHostOverlayActive!(1,true);
 expect(h.children[0].commands.at(-1)).toMatchObject({op:'present',visible:false});
 expect(h.children[1].commands.some((c:any)=>c.op==='present'&&c.visible===false)).toBe(false);
 await bridge.command('1:first','present',{visible:true});expect(h.children[0].commands.at(-1).visible).toBe(false);
 bridge.setOwnerVisible('1:first',true);await bridge.command('1:first','snapshot');
 expect(h.children[0].commands.findLast((c:any)=>c.op==='present').visible).toBe(false);
 await bridge.setHostOverlayActive!(1,false);expect(h.children[0].commands.at(-1)).toMatchObject({op:'present',visible:true});
 bridge.setOwnerVisible('1:first',false);await bridge.setHostOverlayActive!(1,true);await bridge.setHostOverlayActive!(1,false);
 expect(h.children[0].commands.at(-1).visible).toBe(false);await bridge.dispose();
});

it('concealed pages can inspect their scope but cannot mutate hidden layouts',async()=>{
 const bridge=make();await bridge.mount(context('1:child'),rect,32);bridge.setOwnerVisible('1:child',false);
 expect((await bridge.command('1:child','snapshot')).ok).toBe(true);
 const count=h.children[0].commands.length;
 expect((await bridge.command('1:child','select',{groupId:'main',tabId:'peer'})).ok).toBe(false);
 expect(h.children[0].commands).toHaveLength(count);await bridge.dispose();
});
