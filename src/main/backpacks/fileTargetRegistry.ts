import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,execFile,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolveWindowsCscPath} from '../windows/foregroundBridge';

export type TargetObservation={status:string;path?:string;volume?:string;fileId?:string;serial?:string;objectId?:string|null;version?:string|null};
type Target={id:string;path:string;native:TargetObservation;revision:number;missingSince?:number;deleted?:boolean;deletion?:{commandId:string;phase:string}};
export type TargetResult={targetId:string;status:string;path?:string;revision:number};
export interface TargetRegistry{track(target:string):Promise<TargetResult>;resolve(id:string):Promise<TargetResult>;relocate(oldPath:string,newPath:string):Promise<void>;deleted(target:string):Promise<void>;remove?(id:string,revision:number,commandId:string):Promise<TargetResult>;restore?(id:string,revision:number,commandId:string):Promise<TargetResult>}

/** Owner-local identity map. Documents retain opaque target IDs, never native IDs or credentials. */
export function createFileTargetRegistry(options:{file:string;observe:(items:TargetObservation[])=>Promise<TargetObservation[]>;watch?:(paths:string[],deleted:(p:string)=>void)=>void;recycle?:(p:string)=>Promise<void>;restore?:(recycled:string,destination:string)=>Promise<void>;now?:()=>number}):TargetRegistry{
 const now=options.now??Date.now;let state:Record<string,Target>|undefined;let queue=Promise.resolve();
 async function load(){if(!state){try{const raw=JSON.parse(await fs.readFile(options.file,'utf8'));if(raw.version!==1||!raw.targets||typeof raw.targets!=='object')throw Error('Invalid file target registry');state=raw.targets;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={};}}return state!;}
 function watch(){options.watch?.(Object.values(state??{}).filter(t=>!t.deleted).map(t=>t.path),target=>{const timer=setTimeout(()=>{void run(async()=>{const all=await load();let changed=false;for(const t of Object.values(all)){if(t.deleted||!(t.path.toLowerCase()===target.toLowerCase()||t.path.toLowerCase().startsWith(target.toLowerCase()+path.sep)))continue;
 const [found]=await options.observe([t.native]);if(found?.status!=='missing')continue;try{await fs.lstat(t.path);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')continue;}try{await fs.readdir(path.dirname(target));}catch{continue;}t.deleted=true;t.revision++;changed=true;}if(changed)await save();}).catch(()=>{});},3000);timer.unref();});}
 async function save(){await fs.mkdir(path.dirname(options.file),{recursive:true});const temporary=options.file+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify({version:1,targets:state}));await fs.rename(temporary,options.file);watch();}
 function run<T>(fn:()=>Promise<T>):Promise<T>{const task=queue.then(fn);queue=task.then(()=>{},()=>{});return task;}
 const same=(a:TargetObservation,b:TargetObservation)=>a.volume===b.volume&&a.serial===b.serial&&(a.objectId&&b.objectId?a.objectId===b.objectId:a.fileId&&a.fileId===b.fileId);
 const recycled=(p:string|undefined)=>/\\(?:\$recycle\.bin|recycler|\.papersrecycle)\\/i.test(p??'');
 function result(t:Target,status:string):TargetResult{return{targetId:t.id,status,path:t.path,revision:t.revision};}
 return{
 track:target=>run(async()=>{const all=await load();const [native]=await options.observe([{status:'enroll',path:target}]);if(!native||native.status!=='present')return{targetId:'',status:native?.status??'unavailable',revision:0};
 let t=Object.values(all).find(x=>!x.deleted&&same(x.native,native));if(!t){t={id:randomUUID(),path:native.path!,native,revision:1};all[t.id]=t;}else if(t.path!==native.path){t.path=native.path!;t.native=native;t.revision++;}await save();return result(t,'present');}),
 resolve:id=>run(async()=>{const all=await load(),t=all[id];if(!t)return{targetId:id,status:'unknown',revision:0};if(t.deleted){const [restored]=await options.observe([{status:'identify',path:t.path}]);if(restored?.status==='present'&&same(t.native,restored)){delete t.deleted;t.native=restored;t.revision++;await save();return result(t,'present');}return result(t,'deleted');}
 watch();
 const [atPath]=await options.observe([{status:'identify',path:t.path}]);if(atPath?.status==='present'&&same(t.native,atPath)){if(t.missingSince||t.native.version!==atPath.version||t.native.fileId!==atPath.fileId){delete t.missingSince;t.native=atPath;t.revision++;await save();}return result(t,'present');}
 const [found]=await options.observe([t.native]);if(found?.status==='present'&&same(t.native,found)){if(recycled(found.path)){t.deleted=true;t.revision++;await save();return result(t,'deleted');}t.path=found.path!;t.native=found;delete t.missingSince;t.revision++;await save();return result(t,'present');}
 if(found?.status==='deleted'&&atPath?.status!=='present'){t.deleted=true;t.revision++;await save();return result(t,'deleted');}
 // A replacement document and an unavailable/offline volume are never deletion evidence.
 if(atPath?.status==='present')return result(t,'replacement');
 if(found?.status!=='missing')return result(t,'unavailable');
 if(!t.missingSince){t.missingSince=now();await save();}return result(t,'missing');}),
 relocate:(oldPath,newPath)=>run(async()=>{const all=await load();const [native]=await options.observe([{status:'enroll',path:newPath}]);if(native?.status!=='present')throw Error('Moved file cannot be identified');for(const t of Object.values(all))if(!t.deleted&&(t.path.toLowerCase()===oldPath.toLowerCase()||t.path.toLowerCase().startsWith(oldPath.toLowerCase()+path.sep))){const suffix=t.path.slice(oldPath.length);const [child]=suffix?await options.observe([{status:'enroll',path:newPath+suffix}]):[native];if(child?.status!=='present')continue;t.path=child.path!;t.native=child;t.revision++;delete t.missingSince;}await save();}),
 deleted:target=>run(async()=>{const all=await load();for(const t of Object.values(all))if(t.path.toLowerCase()===target.toLowerCase()||t.path.toLowerCase().startsWith(target.toLowerCase()+path.sep)){if(t.path.toLowerCase()!==target.toLowerCase()){const [found]=await options.observe([t.native]);if(found?.status==='present'&&!recycled(found.path)){t.path=found.path!;t.native=found;t.revision++;continue;}if(found?.status!=='missing'&&!recycled(found?.path))continue;}t.deleted=true;t.revision++;}await save();}),
 restore:(id,revision,commandId)=>run(async()=>{
  if(!options.restore)throw Error('Restore unavailable');if(!/^[a-f0-9-]{36}$/i.test(commandId))throw Error('Invalid restore command');
  const all=await load(),t=all[id];if(!t)throw Error('File reference unavailable');if(t.revision!==revision)throw Error('File changed; refresh before restoring');
  const [found]=await options.observe([t.native]);if(found?.status!=='present'||!same(t.native,found))throw Error('This file is no longer available in the Recycle Bin.');
  if(found.path?.toLowerCase()!==t.path.toLowerCase()){
    if(!recycled(found.path))throw Error('The file moved to another location; refresh its reference.');
    try{await fs.lstat(t.path);throw Error('A file already exists at the original location. Restore refused.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await options.restore(found.path!,t.path);
  }
  const [restored]=await options.observe([{status:'identify',path:t.path}]);if(restored?.status!=='present'||!same(t.native,restored))throw Error('The owner could not verify restoration.');
  t.native=restored;delete t.deleted;delete t.missingSince;t.revision++;await save();return result(t,'present');
 }),
 remove:(id,revision,commandId)=>run(async()=>{if(!options.recycle)throw Error('Recycling unavailable');if(!/^[a-f0-9-]{36}$/i.test(commandId))throw Error('Invalid deletion command');const all=await load(),t=all[id];if(!t)throw Error('File reference unavailable');if(t.deleted)return result(t,'deleted');if(t.revision!==revision)throw Error('File changed; refresh before deleting');if(path.parse(t.path).root===t.path)throw Error('Storage roots cannot be recycled');const info=await fs.lstat(t.path);if(info.isSymbolicLink())throw Error('Relinked paths cannot be recycled through a file reference');const [current]=await options.observe([{status:'identify',path:t.path}]);if(current?.status!=='present'||!same(t.native,current))throw Error('The path belongs to another file; deletion refused');if(t.native.version&&current.version!==t.native.version)throw Error('File contents changed; refresh before deleting');t.deletion={commandId,phase:'prepared'};await save();try{await options.recycle(t.path);t.deleted=true;t.revision++;t.deletion.phase='completed';await save();return result(t,'deleted');}catch(error){t.deletion.phase='uncertain';await save();throw error;}})
 };
}

export function windowsTargetObserver(directory:string,source:string){let executable:string|undefined,child:ChildProcessWithoutNullStreams|undefined;let queue=Promise.resolve();let reply:((line:string)=>void)|undefined;
 const observe=(items:TargetObservation[]):Promise<TargetObservation[]>=>{const task=queue.then(async()=>{if(process.platform!=='win32')return items.map(()=>({status:'unsupported'}));if(!executable){const bytes=await fs.readFile(source),stamp=createHash('sha256').update(bytes).digest('hex').slice(0,16);executable=path.join(directory,'file-target-'+stamp+'.exe');await fs.mkdir(directory,{recursive:true});try{await fs.access(executable);}catch{const compiler=resolveWindowsCscPath(process.env.SystemRoot??'C:\\Windows');if(!compiler)throw Error('Windows file identity helper unavailable');execFileSync(compiler,['/nologo','/r:System.Web.Extensions.dll','/out:'+executable,source],{windowsHide:true,timeout:15000});}}
 if(!child){child=spawn(executable!,['serve'],{windowsHide:true,stdio:['pipe','pipe','pipe']});const active=child;createInterface({input:active.stdout}).on('line',line=>{const complete=reply;reply=undefined;complete?.(line);});const failed=()=>{if(child===active){child=undefined;const complete=reply;reply=undefined;complete?.('null');}};active.stdin.on('error',failed);active.on('error',failed);active.on('exit',failed);process.once('exit',()=>active.kill());}
 return new Promise<TargetObservation[]>((resolve,reject)=>{const timer=setTimeout(()=>{reply=undefined;child?.kill();child=undefined;reject(Error('File identity timed out'));},15000);reply=line=>{clearTimeout(timer);try{const result=JSON.parse(line);if(!Array.isArray(result)||result.length!==items.length)throw Error('Invalid identity reply');resolve(result);}catch(e){reject(e);}};child!.stdin.write(JSON.stringify(items)+'\n');});});queue=task.then(()=>{},()=>{});return task;};
 observe.close=()=>{child?.kill();child=undefined;};return observe;
}

export function windowsTargetWatcher(directory:string,source:string){let child:ChildProcessWithoutNullStreams|undefined;let signature='';let pending=false;
 const update=(paths:string[],deleted:(p:string)=>void)=>{const dirs=[...new Set(paths.flatMap(p=>{const parents:string[]=[];let current=path.dirname(p);for(let n=0;n<128;n++){parents.push(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}return parents;}))].sort();const next=JSON.stringify(dirs);if(next===signature||pending||process.platform!=='win32')return;pending=true;
 void (async()=>{if(!child){const bytes=await fs.readFile(source),stamp=createHash('sha256').update(bytes).digest('hex').slice(0,16),exe=path.join(directory,'file-target-'+stamp+'.exe');await fs.access(exe);child=spawn(exe,['watch'],{windowsHide:true,stdio:['pipe','pipe','pipe']});const active=child;createInterface({input:active.stdout}).on('line',line=>{try{const event=JSON.parse(line);if(typeof event.deleted==='string')deleted(event.deleted);}catch{}});active.stdin.on('error',()=>{});active.on('error',()=>{if(child===active){child=undefined;signature='';}});active.on('exit',()=>{if(child===active){child=undefined;signature='';}});process.once('exit',()=>active.kill());}child.stdin.write(next+'\n');signature=next;})().catch(()=>{}).finally(()=>{pending=false;});};
 update.close=()=>{child?.kill();child=undefined;signature='';};return update;
}

/** Use the Windows Shell's canonical restore verb for the exact identity-located item. */
export function windowsRecycleRestore(directory:string){return async(recycled:string,destination:string)=>{
 await fs.mkdir(directory,{recursive:true});const script=path.join(directory,'restore-recycled-file.ps1');
 await fs.writeFile(script,`param([string]$RecycledPath,[string]$Destination)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Destination){throw 'Original location is occupied'}
$shell=New-Object -ComObject Shell.Application
$item=@($shell.NameSpace(10).Items()) | Where-Object { $_.Path -eq $RecycledPath } | Select-Object -First 1
if(-not $item){throw 'Recycled file unavailable'}
$item.InvokeVerb('undelete')
for($attempt=0;$attempt -lt 100;$attempt++){if((Test-Path -LiteralPath $Destination) -and -not (Test-Path -LiteralPath $RecycledPath)){exit 0};Start-Sleep -Milliseconds 100}
throw 'Windows has not confirmed restoration'
`);
 await new Promise<void>((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',script,'-RecycledPath',recycled,'-Destination',destination],{windowsHide:true,timeout:15000},error=>error?reject(error):resolve()));
};}
