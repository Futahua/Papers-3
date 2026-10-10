export interface SwapBounds {x:number;y:number;width:number;height:number}
export interface SwapWindow {
  isDestroyed():boolean;isMinimized():boolean;isMaximized():boolean;isFullScreen():boolean;
  getBounds():SwapBounds;getMinimumSize():number[];setBounds(bounds:SwapBounds):void;
}
const same=(a:SwapBounds,b:SwapBounds)=>['x','y','width','height'].every(k=>a[k as keyof SwapBounds]===b[k as keyof SwapBounds]);
/** Exchange containers, preserving page identities and native leases. */
export async function swapPapersWindows(source:SwapWindow,target:SwapWindow,fits:(window:SwapWindow,bounds:SwapBounds)=>Promise<boolean>,commit=false):Promise<{ok:boolean;error?:string}> {
  const invalid=(window:SwapWindow)=>window.isDestroyed()||window.isMinimized()||window.isMaximized()||window.isFullScreen();
  if(source===target||invalid(source)||invalid(target))return {ok:false,error:'Use two different, restored Papers windows.'};
  const a=source.getBounds(),b=target.getBounds();
  const minimum=(window:SwapWindow,bounds:SwapBounds)=>{const [w,h]=window.getMinimumSize();return bounds.width>=(w??0)&&bounds.height>=(h??0);};
  if(!minimum(source,b)||!minimum(target,a)||!await fits(source,b)||!await fits(target,a))return {ok:false,error:'The layouts cannot fit the exchanged window sizes.'};
  if(invalid(source)||invalid(target)||!same(source.getBounds(),a)||!same(target.getBounds(),b))return {ok:false,error:'A window changed during the drag. Try again.'};
  if(!commit)return {ok:true};
  try {
    source.setBounds(b);target.setBounds(a);
    if(!same(source.getBounds(),b)||!same(target.getBounds(),a))throw Error('Windows refused the exchanged bounds.');
    return {ok:true};
  }catch(error){
    const failures:string[]=[];
    for(const [window,bounds] of [[source,a],[target,b]] as const)try{if(!window.isDestroyed())window.setBounds(bounds);}catch(rollback){failures.push(String(rollback));}
    return {ok:false,error:String(error)+(failures.length?' Restore failed: '+failures.join('; '):'')};
  }
}
