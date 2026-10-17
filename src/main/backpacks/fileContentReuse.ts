import {promises as fs,createReadStream} from 'node:fs';import {pipeline} from 'node:stream/promises';import {createHash} from 'node:crypto';import path from 'node:path';
const escape=(s:string)=>s.split('').map(c=>'.*+?^${}()|[]'.includes(c)?String.fromCharCode(92)+c:c).join('');
const locks=new Map<string,Promise<unknown>>();
export async function withDestinationLock<T>(directory:string,name:string,act:()=>Promise<T>):Promise<T>{const key=path.resolve(directory)+'|'+name.toLocaleLowerCase(),prior=locks.get(key)??Promise.resolve();const work=prior.catch(()=>{}).then(act);locks.set(key,work);try{return await work;}finally{if(locks.get(key)===work)locks.delete(key);}}
/** Only the requested filename/collision family in this destination, never a disk scan. */
export async function findIdenticalDestination(directory:string,name:string,size:number,digest:string|(()=>Promise<string>)):Promise<string|null>{
 const ext=path.extname(name),stem=name.slice(0,name.length-ext.length),pattern=new RegExp('^'+escape(stem)+'(?: [(][0-9]+[)])?'+escape(ext)+'$',process.platform==='win32'?'i':'');let expected:string|undefined=typeof digest==='string'?digest:undefined;
 for(const entry of (await fs.readdir(directory,{withFileTypes:true})).filter(e=>e.isFile()&&pattern.test(e.name)).slice(0,1000)){
  const target=path.join(directory,entry.name);let handle;try{const link=await fs.lstat(target);if(!link.isFile()||link.isSymbolicLink()||link.size!==size)continue;
   handle=await fs.open(target,'r');const before=await handle.stat();if(before.size!==size)continue;expected??=await (digest as ()=>Promise<string>)();if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid source digest');const hash=createHash('sha256');await pipeline(handle.createReadStream({autoClose:false}),hash);const after=await handle.stat(),atPath=await fs.stat(target);const generation=(s:typeof before)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');if(generation(before)!==generation(after)||generation(after)!==generation(atPath))continue;if(hash.digest('hex')===expected)return target;
  }catch(e){if(!['ENOENT','EACCES','EPERM','EBUSY'].includes((e as NodeJS.ErrnoException).code??''))throw e;}finally{await handle?.close();}
 }
 return null;
}
