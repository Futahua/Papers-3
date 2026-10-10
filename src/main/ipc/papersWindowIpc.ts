import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
export interface PapersWindowIpcDependencies {
  reload?:()=>Promise<void>;
  ipcMain: Pick<IpcMain,'handle'>;
  isHostSender:(sender:WebContents)=>boolean;
  createAdditionalWindow:()=>Promise<void>;
  listWindows?:(sender:WebContents)=>Promise<Array<{windowId:number;title:string;groupId:string;current:boolean}>>;
  listPages?:(sender:WebContents)=>Promise<Array<{key:string;title:string;windowId:number|null;current:boolean;workspaceId?:string}>>;
  closePage?:(key:string)=>Promise<void>;
  showPage?:(key:string)=>Promise<void>;
  adoptPage?:(sender:WebContents,surfaceId:string)=>Promise<unknown>;
  detachPage?:(sender:WebContents,surfaceId:string)=>Promise<unknown>;
  drag?:(sender:WebContents,active:boolean,key?:string,cancelled?:boolean)=>Promise<unknown>;
  dragState?:()=>unknown;
  dragOutcome?:(ok:boolean)=>void;
  pageDrag?:(sender:WebContents,active:boolean,pageId?:string)=>Promise<void>;
  moveFailed?:(sender:WebContents,item:{sourceId?:number;key?:string;surfaceId?:string})=>void;
  swapWindow?:(sender:WebContents,sourceId:number,commit:boolean)=>Promise<unknown>;
  dropSavedPage?:(sender:WebContents,key:string,groupId:string,side:string,commit:boolean)=>Promise<unknown>;
}
export function registerPapersWindowIpc(deps:PapersWindowIpcDependencies):void {
  let previewRevision=0;
  const preflight=async(action:()=>Promise<unknown>|undefined)=>{
    const revision=++previewRevision,state=JSON.stringify(deps.dragState?.());
    const result=await action();
    if(revision===previewRevision&&state===JSON.stringify(deps.dragState?.()))deps.dragOutcome?.((result as {ok?:boolean})?.ok!==false);
    return result;
  };
  const handle=(channel:string,action:(event:IpcMainInvokeEvent,value:unknown)=>Promise<unknown>):void=>{
    deps.ipcMain.handle(channel,async(event,value)=>{if(!deps.isHostSender(event.sender))throw Error('Window/page action called from non-host sender');return action(event,value);});
  };
  const attempt=async(sender:WebContents,item:{sourceId?:number;key?:string;surfaceId?:string},action:()=>Promise<unknown>|undefined)=>{try{previewRevision++;deps.dragOutcome?.(true);const reply=await action();if((reply as {ok?:boolean})?.ok===false)deps.moveFailed?.(sender,item);return reply;}catch(error){deps.moveFailed?.(sender,item);throw error;}};
  handle('host:app:reload',async()=>{if(!deps.reload)throw Error('Reload is unavailable');await deps.reload();});
  handle('host:window:new',()=>deps.createAdditionalWindow());
  handle('host:window:list',async event=>deps.listWindows?.(event.sender)??[]);
  handle('host:pages:list',async event=>deps.listPages?.(event.sender)??[]);
  handle('host:window:drag',async(event,active)=>{
    const v=active as {active:boolean;key?:string;cancelled?:boolean};
    if(!v||typeof v.active!=='boolean'||v.cancelled!==undefined&&typeof v.cancelled!=='boolean'||v.key!==undefined&&(typeof v.key!=='string'||!v.key.trim()||Buffer.byteLength(v.key)>512))throw Error('Invalid drag');
    return deps.drag?.(event.sender,v.active,v.key,v.cancelled);
  });
  handle('host:pages:drag',async(event,value)=>{const v=value as {active:boolean;pageId?:string};if(!v||typeof v.active!=='boolean'||v.pageId!==undefined&&(typeof v.pageId!=='string'||!v.pageId||v.pageId.length>128))throw Error('Invalid page drag');return deps.pageDrag?.(event.sender,v.active,v.pageId);});
  handle('host:window:drag-state',async()=>deps.dragState?.()??null);
  handle('host:window:swap',async(event,value)=>{
    const v=value as {sourceId:number;commit:boolean};
    if(!v||!Number.isSafeInteger(v.sourceId)||typeof v.commit!=='boolean')throw Error('Invalid window swap');
    return v.commit?attempt(event.sender,{sourceId:v.sourceId},()=>deps.swapWindow?.(event.sender,v.sourceId,true)):preflight(()=>deps.swapWindow?.(event.sender,v.sourceId,false));
  });
  handle('host:pages:drop',async(event,value)=>{
    const v=value as {key:string;groupId:string;side:string;commit:boolean};
    if(!v||[v.key,v.groupId].some(s=>typeof s!=='string'||!s.trim()||Buffer.byteLength(s)>512)
      ||!['center','left','right','top','bottom'].includes(v.side)||typeof v.commit!=='boolean')throw Error('Invalid saved page drop');
    const state=deps.dragState?.() as {sourceId?:number}|null;
    return v.commit?attempt(event.sender,{key:v.key,sourceId:state?.sourceId},()=>deps.dropSavedPage?.(event.sender,v.key,v.groupId,v.side,true)):preflight(()=>deps.dropSavedPage?.(event.sender,v.key,v.groupId,v.side,false));
  });
  for(const action of ['adopt','detach'] as const)handle('host:pages:'+action,async(event,surfaceId)=>{
    if(typeof surfaceId!=='string'||!surfaceId.trim()||Buffer.byteLength(surfaceId)>512)throw Error('Invalid page');
    return attempt(event.sender,{surfaceId},()=>action==='adopt'?deps.adoptPage?.(event.sender,surfaceId):deps.detachPage?.(event.sender,surfaceId));
  });
  for(const action of ['close','show'] as const)handle('host:pages:'+action,async(_event,key)=>{
    if(typeof key!=='string'||!key.trim()||Buffer.byteLength(key)>512)throw Error('Invalid saved page');
    if(action==='close')await deps.closePage?.(key);else await deps.showPage?.(key);
  });
}
