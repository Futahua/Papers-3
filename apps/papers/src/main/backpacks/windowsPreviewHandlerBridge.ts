import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveWindowsCscPath } from '../windows/foregroundBridge';
import { getOrCreateSourceSnapshot } from './derivedPreviewCache';

const EXE = 'papers-windows-preview-host.exe';
const STAMP = 'papers-windows-preview-host.stamp';
export interface PreviewRect { x:number; y:number; width:number; height:number }
export interface PreviewHostContext { ownerKey:string; parentHwnd:string; surfaceBounds:PreviewRect }
interface Live { id:string; ownerKey:string; process:ChildProcessWithoutNullStreams; localRect:PreviewRect; surfaceBounds:PreviewRect; clsid:string }

export interface WindowsPreviewHandlerBridge {
  probe(target:string):Promise<{available:boolean; clsid?:string}>;
  open(context:PreviewHostContext,target:string,localRect:PreviewRect):Promise<{ok:true;sessionId:string;clsid:string}|{ok:false;error?:string}>;
  move(ownerKey:string,sessionId:string,localRect:PreviewRect):boolean;
  focus(ownerKey:string,sessionId:string):boolean;
  close(ownerKey:string,sessionId:string):boolean;
  setOwnerSurfaceBounds(ownerKey:string,bounds:PreviewRect):void;
  setOwnerVisible(ownerKey:string,visible:boolean):void;
  closeOwner(ownerKey:string):void;
  dispose():void;
}

export function resolveWindowsPreviewHostSourcePath(input:{appPath:string;resourcesPath:string;packaged:boolean}):string {
  const root=input.packaged?path.join(input.resourcesPath,'native'):path.join(input.appPath,'resources','native');
  return path.join(root,'windows-preview-host.cs');
}
function validRect(r:PreviewRect):boolean {
  return [r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0&&Math.abs(r.x)<=100000&&Math.abs(r.y)<=100000&&r.width<=100000&&r.height<=100000;
}
function absoluteRect(s:PreviewRect,l:PreviewRect):PreviewRect { return {x:Math.round(s.x+l.x),y:Math.round(s.y+l.y),width:Math.round(l.width),height:Math.round(l.height)}; }
function parseLine(line:string):{kind:'available'|'ready'|'none'|'error';value?:string} {
  const t=line.trim(); if(t==='NONE')return{kind:'none'};
  const i=t.indexOf('\t'), k=i<0?t:t.slice(0,i), v=i<0?'':t.slice(i+1);
  if((k==='AVAILABLE'||k==='READY')&&/^\{[0-9a-f-]{36}\}$/i.test(v))return{kind:k==='AVAILABLE'?'available':'ready',value:v};
  if(k==='ERR'){try{return{kind:'error',value:Buffer.from(v,'base64').toString('utf8').slice(0,500)}}catch{}}
  return{kind:'error',value:'Windows preview host returned an invalid response.'};
}

export function createWindowsPreviewHandlerBridge(input:{cacheDirectory:string;sourcePath:string;compilerPath?:string}):WindowsPreviewHandlerBridge|null {
  let source:Buffer; try{source=fs.readFileSync(input.sourcePath)}catch{return null}
  const compiler=input.compilerPath??resolveWindowsCscPath(process.env['SystemRoot']??process.env['WINDIR']??'C:\\Windows'); if(!compiler)return null;
  const executable=path.join(input.cacheDirectory,EXE), stampFile=path.join(input.cacheDirectory,STAMP), stamp=createHash('sha256').update(source).digest('hex');
  let built=false; try{built=fs.readFileSync(stampFile,'utf8')===stamp&&fs.statSync(executable).isFile()}catch{}
  if(!built){try{
    fs.mkdirSync(input.cacheDirectory,{recursive:true});
    execFileSync(compiler,['/nologo','/optimize+','/platform:x64','/target:exe','/r:System.Windows.Forms.dll',`/out:${executable}`,input.sourcePath],{timeout:15000,windowsHide:true,stdio:['ignore','ignore','pipe']});
    fs.writeFileSync(stampFile,stamp,'utf8');
  }catch{try{fs.rmSync(executable,{force:true});fs.rmSync(stampFile,{force:true})}catch{};return null}}

  const sessions=new Map<string,Live>(), owners=new Map<string,string>();
  const forget=(s:Live)=>{if(sessions.get(s.id)===s)sessions.delete(s.id);if(owners.get(s.ownerKey)===s.id)owners.delete(s.ownerKey)};
  const stop=(s:Live)=>{forget(s);try{s.process.stdin.write('CLOSE\n')}catch{};const timer=setTimeout(()=>{try{s.process.kill()}catch{}},750);timer.unref?.()};
  const sendMove=(s:Live)=>{const r=absoluteRect(s.surfaceBounds,s.localRect);if(!validRect(r))return;try{s.process.stdin.write(`MOVE\t${r.x}\t${r.y}\t${r.width}\t${r.height}\n`)}catch{stop(s)}};

  return {
    probe(target){return new Promise(resolve=>execFile(executable,['--probe',target],{timeout:4000,windowsHide:true,encoding:'utf8',maxBuffer:16384},(_e,stdout)=>{
      const p=parseLine(String(stdout??'').split(/\r?\n/).find(Boolean)??''); resolve(p.kind==='available'&&p.value?{available:true,clsid:p.value}:{available:false});
    }))},
    async open(context,target,localRect){
      if(!validRect(context.surfaceBounds)||!validRect(localRect)||!/^\d+$/.test(context.parentHwnd))return{ok:false,error:'Invalid native preview host geometry.'};
      let safeTarget:string;
      try {
        safeTarget=(await getOrCreateSourceSnapshot({cacheDirectory:input.cacheDirectory,source:target})).filePath;
      } catch(error) {
        return{ok:false,error:error instanceof Error?error.message:String(error)};
      }
      this.closeOwner(context.ownerKey); const r=absoluteRect(context.surfaceBounds,localRect);
      const child=spawn(executable,['--host',safeTarget,context.parentHwnd,String(r.x),String(r.y),String(r.width),String(r.height)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const line=await new Promise<string>(resolve=>{let done=false;const finish=(v:string)=>{if(done)return;done=true;clearTimeout(timer);resolve(v)};createInterface({input:child.stdout}).once('line',finish);child.once('error',e=>finish('ERR\t'+Buffer.from(String(e)).toString('base64')));child.once('exit',()=>finish('NONE'));const timer=setTimeout(()=>finish('NONE'),7000);timer.unref?.()});
      const p=parseLine(line); if(p.kind!=='ready'||!p.value){try{child.kill()}catch{};return{ok:false,...(p.value?{error:p.value}:{})}};
      const s:Live={id:randomUUID(),ownerKey:context.ownerKey,process:child,localRect:{...localRect},surfaceBounds:{...context.surfaceBounds},clsid:p.value};
      sessions.set(s.id,s);owners.set(s.ownerKey,s.id);child.once('exit',()=>forget(s));child.once('error',()=>forget(s));return{ok:true,sessionId:s.id,clsid:s.clsid};
    },
    move(ownerKey,sessionId,localRect){const s=sessions.get(sessionId);if(!s||s.ownerKey!==ownerKey||!validRect(localRect))return false;s.localRect={...localRect};sendMove(s);return true},
    focus(ownerKey,sessionId){const s=sessions.get(sessionId);if(!s||s.ownerKey!==ownerKey)return false;try{s.process.stdin.write('FOCUS\n');return true}catch{stop(s);return false}},
    close(ownerKey,sessionId){const s=sessions.get(sessionId);if(!s||s.ownerKey!==ownerKey)return false;stop(s);return true},
    setOwnerSurfaceBounds(ownerKey,bounds){if(!validRect(bounds))return;const id=owners.get(ownerKey),s=id?sessions.get(id):undefined;if(!s)return;s.surfaceBounds={...bounds};sendMove(s)},
    setOwnerVisible(ownerKey,visible){const id=owners.get(ownerKey),s=id?sessions.get(id):undefined;if(!s)return;try{s.process.stdin.write(visible?'SHOW\n':'HIDE\n')}catch{stop(s)}},
    closeOwner(ownerKey){const id=owners.get(ownerKey),s=id?sessions.get(id):undefined;if(s)stop(s)},
    dispose(){for(const s of [...sessions.values()])stop(s)}
  };
}
