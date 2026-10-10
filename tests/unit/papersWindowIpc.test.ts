import { describe, expect, it, vi } from 'vitest';

import { registerPapersWindowIpc } from '../../src/main/ipc/papersWindowIpc';
import type { PapersWindowIpcDependencies } from '../../src/main/ipc/papersWindowIpc';

function harness() {
  const handlers = new Map<string, (event:{sender:object},value?:unknown)=>Promise<unknown>>();
  let handler: ((event: { sender: object }) => Promise<unknown>) | undefined;
  const ipcMain = { handle: vi.fn((_channel: string, current: typeof handler) => { handlers.set(_channel,current!); if (_channel === 'host:window:new') handler = current; }) };
  return { ipcMain, getHandler: () => handler!, handlers };
}

describe('Papers window IPC', () => {
  it.each(['host:app:reload','host:window:drag','host:window:drag-state','host:window:swap','host:pages:drop'])('refuses %s from project senders',async channel=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>false,createAdditionalWindow:callback,drag:callback,swapWindow:callback,dropSavedPage:callback});
    await expect(h.handlers.get(channel)!({sender:{}},{})).rejects.toThrow('non-host sender');expect(callback).not.toHaveBeenCalled();
  });
  it('rejects malformed drag commands before invoking an owner',async()=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow:callback,drag:callback,swapWindow:callback,dropSavedPage:callback});
    for(const value of [null,{},true,{active:true,key:'x'.repeat(513)}])await expect(h.handlers.get('host:window:drag')!({sender:{}},value)).rejects.toThrow('Invalid');
    for(const value of [null,{}, {sourceId:1.5,commit:true},{sourceId:1,commit:'yes'}])await expect(h.handlers.get('host:window:swap')!({sender:{}},value)).rejects.toThrow('Invalid');
    for(const value of [null,{}, {key:'a',groupId:'main',side:'diagonal',commit:true},{key:'',groupId:'main',side:'center',commit:true}])await expect(h.handlers.get('host:pages:drop')!({sender:{}},value)).rejects.toThrow('Invalid');
    expect(callback).not.toHaveBeenCalled();
  });
  it('does not mark a new drag as refused when an old preflight finishes late',async()=>{
    const h=harness(),outcome=vi.fn();let state={sourceId:1,key:'old'};let finish!:(value:{ok:boolean})=>void;
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow:async()=>{},dragState:()=>state,dragOutcome:outcome,swapWindow:()=>new Promise(resolve=>{finish=resolve;})});
    const pending=h.handlers.get('host:window:swap')!({sender:{}},{sourceId:1,commit:false});
    state={sourceId:2,key:'new'};finish({ok:false});await pending;expect(outcome).not.toHaveBeenCalled();
  });
  it('closes a saved page directly without constructing or showing a window',async()=>{
    const h=harness(),closePage=vi.fn(async()=>{}),showPage=vi.fn(async()=>{}),createAdditionalWindow=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow,closePage,showPage});
    await h.handlers.get('host:pages:close')!({sender:{}},'durable-page');
    expect(closePage).toHaveBeenCalledWith('durable-page');expect(showPage).not.toHaveBeenCalled();expect(createAdditionalWindow).not.toHaveBeenCalled();
  });
  it.each(['list','close','show','adopt','detach'])('refuses page %s from a Backpack renderer',async action=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>false,createAdditionalWindow:callback,closePage:callback,showPage:callback,adoptPage:callback,detachPage:callback});
    await expect(h.handlers.get('host:pages:'+action)!({sender:{}},'page')).rejects.toThrow('non-host sender');expect(callback).not.toHaveBeenCalled();
  });
  it.each(['close','show','adopt','detach'])('validates page identity before %s',async action=>{
    const h=harness(),callback=vi.fn(async()=>{});
    registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow:callback,closePage:callback,showPage:callback,adoptPage:callback,detachPage:callback});
    for(const key of ['',null,{},'a'.repeat(513)])await expect(h.handlers.get('host:pages:'+action)!({sender:{}},key)).rejects.toThrow('Invalid');
    expect(callback).not.toHaveBeenCalled();
  });
  it('creates a secondary window only for a trusted host sender', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => true, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('rejects non-host senders before constructing a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => false, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('non-host sender');
    expect(createAdditionalWindow).not.toHaveBeenCalled();
  });

  it('allows a second legitimate host sender to request a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    const hostSenders = new Set<object>([{}]);
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: (sender) => hostSenders.has(sender),
      createAdditionalWindow,
    });
    const secondHost = {};
    hostSenders.add(secondHost);

    await expect(h.getHandler()({ sender: secondHost })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('propagates secondary-window construction failures', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => { throw new Error('construction failed'); });
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: () => true,
      createAdditionalWindow,
    });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('construction failed');
  });
});

it('page group drags retain identity without requesting the outer overlay',async()=>{
 const h=harness(),pageDrag=vi.fn(async()=>{}),sender={};
 registerPapersWindowIpc({ipcMain:h.ipcMain as PapersWindowIpcDependencies['ipcMain'],isHostSender:()=>true,createAdditionalWindow:async()=>{},pageDrag});
 await h.handlers.get('host:pages:drag')!({sender},{active:true,pageId:'page',groupTarget:true});
 expect(pageDrag).toHaveBeenCalledWith(sender,true,'page',true);
 await expect(h.handlers.get('host:pages:drag')!({sender},{active:true,pageId:'page',groupTarget:'yes'})).rejects.toThrow('Invalid page drag');
 expect(pageDrag).toHaveBeenCalledTimes(1);
});
