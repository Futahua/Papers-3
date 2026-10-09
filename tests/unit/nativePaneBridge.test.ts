import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const h=vi.hoisted(()=>({children:[] as any[],spawn:vi.fn(),failMount:false,failViewport:false}));
vi.mock('node:child_process',()=>({spawn:h.spawn,execFileSync:vi.fn()}));
vi.mock('node:fs',()=>({existsSync:()=>true,readFileSync:()=>Buffer.from('source'),mkdirSync:vi.fn()}));
vi.mock('../../src/main/windows/foregroundBridge',()=>({resolveWindowsCscPath:()=> 'X:/csc.exe'}));
import { createNativePaneBridge } from '../../src/main/backpacks/nativePaneBridge';
const platform=process.platform;
const rect={x:400,y:20,width:500,height:600};
const context=(ownerKey:string,paneGroup='ayg',parentHwnd='456')=>({ownerKey,paneGroup,parentHwnd,surfaceBounds:{x:10,y:30,width:1000,height:800}});
beforeEach(()=>{
 Object.defineProperty(process,'platform',{value:'win32'});h.children.length=0;h.failMount=false;h.failViewport=false;h.spawn.mockReset();
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
it('one physical endpoint retains separate Backpack scopes and strips native handles from page snapshots',async()=>{
 const bridge=make();const a=await bridge.mount(context('1:a'),rect,32),b=await bridge.mount(context('1:b','proxima'),rect,32);
 expect(h.spawn).toHaveBeenCalledTimes(1);expect(h.children[0].commands[0].scope).not.toBe(h.children[0].commands[1].scope);
 expect(a.snapshot?.groups[0]?.tabs[0]).toEqual({id:'peer',kind:'native',active:true,title:'Fixture',windowInstanceId:'opaque-instance'});
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
it('failed and hidden mounts cannot claim an owner or route selection commands',async()=>{
 const bridge=make();h.failMount=true;expect((await bridge.mount(context('1:bad'),rect,32)).ok).toBe(false);expect(bridge.has('1:bad')).toBe(false);
 bridge.setOwnerVisible('1:hidden',false);const before=h.children[0].commands.length;expect((await bridge.mount(context('1:hidden'),rect,32)).ok).toBe(false);expect(h.children[0].commands).toHaveLength(before);await bridge.dispose();
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
