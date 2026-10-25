import {it,expect} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {createFileTargetRegistry,windowsTargetObserver,windowsTargetWatcher,type TargetObservation} from '../../src/main/backpacks/fileTargetRegistry';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
it('checked recycling refuses reused paths and stale revisions and deduplicates a completed delete',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-target-delete-')),file=path.join(dir,'file.txt');await fs.writeFile(file,'kept');let fileId='original',count=0;const owner=createFileTargetRegistry({file:path.join(dir,'registry.json'),observe:async()=>[{status:'present',path:file,fileId,volume:'disk',serial:'1'}],recycle:async p=>{count++;await fs.rm(p);}});
 try{const ref=await owner.track(file);await expect(owner.remove!(ref.targetId,99,'12345678-1234-4234-8234-123456789abc')).rejects.toThrow('changed');fileId='replacement';await expect(owner.remove!(ref.targetId,ref.revision,'12345678-1234-4234-8234-123456789abc')).rejects.toThrow('another file');expect(count).toBe(0);expect(await fs.readFile(file,'utf8')).toBe('kept');fileId='original';expect((await owner.remove!(ref.targetId,ref.revision,'12345678-1234-4234-8234-123456789abc')).status).toBe('deleted');await owner.remove!(ref.targetId,ref.revision,'12345678-1234-4234-8234-123456789abc');expect(count).toBe(1);}finally{expect(path.basename(dir).startsWith('papers-target-delete-')).toBe(true);await fs.rm(dir,{recursive:true,force:true});}
});
it('retains identity after a move/restart, refuses replacement/offline inference, and records verified deletion',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-target-test-'));const native:TargetObservation={status:'present',path:'D:\\a.txt',fileId:'a',volume:'disk',serial:'1'};let current={...native};let online=true;
 const observe=async(items:TargetObservation[])=>items.map(i=>!online?{status:'unavailable'}:i.fileId?(i.fileId===current.fileId?current:{status:'missing'}):i.path===current.path?current:{status:'unavailable'});
 try{const options={file:path.join(dir,'targets.json'),observe};let owner=createFileTargetRegistry(options);const first=await owner.track(native.path!);expect(first.status).toBe('present');expect((await owner.track(native.path!)).targetId).toBe(first.targetId);
 current={...current,path:'D:\\folder\\renamed.txt'};owner=createFileTargetRegistry(options);expect((await owner.resolve(first.targetId)).path).toBe(current.path);
 online=false;expect((await owner.resolve(first.targetId)).status).toBe('unavailable');online=true;
 current={...current,fileId:'different'};expect((await owner.resolve(first.targetId)).status).toBe('replacement');
 await owner.deleted(current.path!);expect((await owner.resolve(first.targetId)).status).toBe('deleted');
 }finally{expect(path.basename(dir).startsWith('papers-target-test-')).toBe(true);await fs.rm(dir,{recursive:true,force:true});}
});
it.skipIf(process.platform!=='win32')('real Windows IDs follow parent moves and ReplaceFile; external deletion is observed without locking files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-target-native-'));const source=path.resolve('resources/native/file-target-identity.cs');const observe=windowsTargetObserver(path.join(dir,'helper'),source),watch=windowsTargetWatcher(path.join(dir,'helper'),source);
 try{const root=path.join(dir,'source');await fs.mkdir(root);const file=path.join(root,'report.txt');await fs.writeFile(file,'first');const owner=createFileTargetRegistry({file:path.join(dir,'targets.json'),observe,watch});const ref=await owner.track(file);expect(ref.status).toBe('present');await wait(300);
 const moved=path.join(dir,'moved');await fs.rename(root,moved);const target=path.join(moved,'report.txt');expect((await owner.resolve(ref.targetId)).path?.toLowerCase()).toBe(target.toLowerCase());await wait(300);
 const replacement=path.join(moved,'temp.txt');await fs.writeFile(replacement,'edited');const quote=(p:string)=>"'"+p.replaceAll("'","''")+"'";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[IO.File]::Replace(${quote(replacement)},${quote(target)},${quote(path.join(moved,'backup.txt'))})`],{windowsHide:true});
 expect((await owner.resolve(ref.targetId)).status).toBe('present');expect(await fs.readFile(target,'utf8')).toBe('edited');
 await fs.rm(target);let result=await owner.resolve(ref.targetId);for(let n=0;result.status!=='deleted'&&n<35;n++){await wait(150);result=await owner.resolve(ref.targetId);}expect(result.status).toBe('deleted');
 await fs.writeFile(target,'unrelated');expect((await owner.resolve(ref.targetId)).status).toBe('deleted');
 }finally{watch.close();observe.close();await wait(150);expect(path.basename(dir).startsWith('papers-target-native-')).toBe(true);await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},20000);

it('restore uses the retained native identity, refuses an occupied destination, and keeps bytes intact',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-target-restore-')),file=path.join(dir,'report.txt'),trash=path.join(dir,'.PapersRecycle','report.txt');await fs.mkdir(path.dirname(trash));await fs.writeFile(file,'original');let actual=file;
 const observe=async(items:TargetObservation[])=>Promise.all(items.map(async item=>{const target=item.status==='identify'||item.status==='enroll'?item.path!:actual;return await fs.stat(target).then(()=>({status:'present',path:target,fileId:target===actual?'original':'replacement',volume:'disk',serial:'1'}),()=>({status:'missing'}));}));
 const owner=createFileTargetRegistry({file:path.join(dir,'registry.json'),observe,recycle:async p=>{await fs.rename(p,trash);actual=trash;},restore:async(from,to)=>{await fs.rename(from,to);actual=to;}});const command='12345678-1234-4234-8234-123456789abc';
 try{const ref=await owner.track(file),deleted=await owner.remove!(ref.targetId,ref.revision,command);await fs.writeFile(file,'unrelated');await expect(owner.restore!(ref.targetId,deleted.revision,command)).rejects.toThrow('already exists');expect(await fs.readFile(file,'utf8')).toBe('unrelated');await fs.rm(file);const restored=await owner.restore!(ref.targetId,deleted.revision,command);expect(restored.status).toBe('present');expect(await fs.readFile(file,'utf8')).toBe('original');expect((await owner.resolve(ref.targetId)).status).toBe('present');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

it.skipIf(process.platform!=='win32')('real Windows recycle and restore preserves the original native file identity',async()=>{
 const {windowsRecycleRestore}=await import('../../src/main/backpacks/fileTargetRegistry');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'papers-shell-restore-')),file=path.join(dir,'recover.txt'),helper=path.join(dir,'helper');await fs.writeFile(file,'recover these exact bytes');const observe=windowsTargetObserver(helper,path.resolve('resources/native/file-target-identity.cs'));
 const recycle=async(p:string)=>{const quote="'"+p.replaceAll("'","''")+"'";execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${quote},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`],{windowsHide:true,timeout:15000});};
 const registry=createFileTargetRegistry({file:path.join(dir,'registry.json'),observe,recycle,restore:windowsRecycleRestore(helper)});try{const ref=await registry.track(file),deleted=await registry.remove!(ref.targetId,ref.revision,'12345678-1234-4234-8234-123456789abc');expect(deleted.status).toBe('deleted');const result=await registry.restore!(ref.targetId,deleted.revision,'12345678-1234-4234-8234-123456789abd');expect(result.status).toBe('present');expect(await fs.readFile(file,'utf8')).toBe('recover these exact bytes');}finally{observe.close();await wait(150);await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},30000);
