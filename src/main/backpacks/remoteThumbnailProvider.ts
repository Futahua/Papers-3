import {stat} from 'node:fs/promises';
import type {ShellThumbnailBridge} from './shellThumbnailBridge';

/** Derived, bounded thumbnails only. Never opens an application or transfers source bytes. */
export function createRemoteThumbnailProvider(deps:{shell:ShellThumbnailBridge|null;icon?:(target:string)=>Promise<Buffer>;encode:(png:Buffer)=>{bytes:Buffer;width:number;height:number}}){
 const cache=new Map<string,Promise<Record<string,unknown>>>();let running=0;const waiting:(()=>void)[]=[];
 return async(target:string):Promise<Record<string,unknown>>=>{
  const info=await stat(target);if(!info.isFile()||(!deps.shell&&!deps.icon))return {kind:'none'};
  const key=JSON.stringify([target,info.size,info.mtimeMs,info.ctimeMs]);const found=cache.get(key);if(found)return found;
  if(waiting.length>=24)return {kind:'none'};
  const result=(async()=>{if(running>=2)await new Promise<void>(resolve=>waiting.push(resolve));else running++;
   try{const icon=await deps.icon?.(target).catch(()=>null);const image=await deps.shell?.preview(target,256).catch(()=>null);const png=image?.ok?image.png:icon;if(!png?.length)return {kind:'none'};const out=deps.encode(png);
    if(out.width<1||out.height<1||out.width>256||out.height>256||out.bytes.length>128*1024)return {kind:'none'};
    const after=await stat(target);if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)return {kind:'none'};
    return {kind:'image',renderKind:image?.ok?'thumbnail':'icon',...(icon&&icon.length<=128*1024?{iconDataUrl:'data:image/png;base64,'+icon.toString('base64')}:{}),mime:'image/jpeg',width:out.width,height:out.height,dataUrl:'data:image/jpeg;base64,'+out.bytes.toString('base64')};
   }catch{return {kind:'none'};}finally{const next=waiting.shift();if(next)next();else running--;}
  })();cache.set(key,result);while(cache.size>128)cache.delete(cache.keys().next().value!);return result;
 };
}
