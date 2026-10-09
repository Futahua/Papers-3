import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
export interface PapersWindowIpcDependencies {
  ipcMain: Pick<IpcMain,'handle'>;
  isHostSender:(sender:WebContents)=>boolean;
  createAdditionalWindow:()=>Promise<void>;
  listWindows?:(sender:WebContents)=>Promise<Array<{windowId:number;title:string;groupId:string;current:boolean}>>;
  listPages?:(sender:WebContents)=>Promise<Array<{key:string;title:string;windowId:number|null;current:boolean}>>;
  closePage?:(key:string)=>Promise<void>;
  showPage?:(key:string)=>Promise<void>;
  adoptPage?:(sender:WebContents,surfaceId:string)=>Promise<unknown>;
  detachPage?:(sender:WebContents,surfaceId:string)=>Promise<unknown>;
}
export function registerPapersWindowIpc(deps:PapersWindowIpcDependencies):void {
  const handle=(channel:string,action:(event:IpcMainInvokeEvent,value:unknown)=>Promise<unknown>):void=>{
    deps.ipcMain.handle(channel,async(event,value)=>{if(!deps.isHostSender(event.sender))throw Error('Window/page action called from non-host sender');return action(event,value);});
  };
  handle('host:window:new',()=>deps.createAdditionalWindow());
  handle('host:window:list',async event=>deps.listWindows?.(event.sender)??[]);
  handle('host:pages:list',async event=>deps.listPages?.(event.sender)??[]);
  for(const action of ['adopt','detach'] as const)handle('host:pages:'+action,async(event,surfaceId)=>{
    if(typeof surfaceId!=='string'||!surfaceId.trim()||Buffer.byteLength(surfaceId)>512)throw Error('Invalid page');
    return action==='adopt'?deps.adoptPage?.(event.sender,surfaceId):deps.detachPage?.(event.sender,surfaceId);
  });
  for(const action of ['close','show'] as const)handle('host:pages:'+action,async(_event,key)=>{
    if(typeof key!=='string'||!key.trim()||Buffer.byteLength(key)>512)throw Error('Invalid saved page');
    if(action==='close')await deps.closePage?.(key);else await deps.showPage?.(key);
  });
}
