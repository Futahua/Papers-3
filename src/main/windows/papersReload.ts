import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import type {SelectedWorkspaceSnapshot} from '../persistence/workspaceTopologyStore';

const prefix='--papers-reload-token=';
/** One-use restart intent. Ordinary launches/reboots still consolidate pages. */
export function consumeReloadWindows(file:string,args:string[],saved:SelectedWorkspaceSnapshot[],now=Date.now()):SelectedWorkspaceSnapshot[]|null {
 const token=args.find(a=>a.startsWith(prefix))?.slice(prefix.length);if(!token)return null;
 try {
  const value=JSON.parse(readFileSync(file,'utf8'));unlinkSync(file);
  if(value.token!==token||!Number.isFinite(value.at)||now-value.at<0||now-value.at>300000||!Array.isArray(value.ids)||!value.ids.length||new Set(value.ids).size!==value.ids.length)return null;
  const windows=value.ids.map((id:unknown)=>saved.find(s=>s.workspaceId===id));
  if(windows.some((s:SelectedWorkspaceSnapshot|undefined)=>!s))return null;
  return windows.map((s:SelectedWorkspaceSnapshot)=>({...s,window:{...s.window,parked:false}}));
 }catch{return null;}
}
export function createPapersReload(deps:{file:string;args:string[];flush:()=>Promise<void>;save:()=>Promise<string[]>;restart:(args:string[])=>void}) {
 let pending:Promise<void>|null=null;
 return ():Promise<void>=>{
  if(pending)return pending;
  pending=(async()=>{
   await deps.flush();const ids=await deps.save();const token=randomUUID();
   writeFileSync(deps.file+'.tmp',JSON.stringify({token,at:Date.now(),ids}),'utf8');renameSync(deps.file+'.tmp',deps.file);
   try{deps.restart([...deps.args.filter(a=>!a.startsWith(prefix)),prefix+token]);}
   catch(error){unlinkSync(deps.file);throw error;}
  })().catch(error=>{pending=null;throw error;});return pending;
 };
}
