export interface SwapBounds {x:number;y:number;width:number;height:number}
export interface SwapWindow {
  isDestroyed():boolean;isMinimized():boolean;isMaximized():boolean;isFullScreen():boolean;
  getBounds():SwapBounds;getNormalBounds():SwapBounds;maximize():void;unmaximize():void;getMinimumSize():number[];setBounds(bounds:SwapBounds):void;
}
const same=(a:SwapBounds,b:SwapBounds)=>['x','y','width','height'].every(k=>a[k as keyof SwapBounds]===b[k as keyof SwapBounds]);
/** Exchange containers, preserving page identities and native leases. */
export async function swapPapersWindows(source:SwapWindow,target:SwapWindow,fits:(window:SwapWindow,bounds:SwapBounds)=>Promise<boolean>,commit=false):Promise<{ok:boolean;error?:string}> {
  const invalid=(window:SwapWindow)=>window.isDestroyed()||window.isMinimized()||window.isFullScreen();
  if(source===target)return {ok:false,error:'Drop onto a different Papers window.'};
  if(invalid(source)||invalid(target))return {ok:false,error:'Restore minimized windows or leave fullscreen before swapping.'};
  const a=source.getBounds(),b=target.getBounds();
  const am=source.isMaximized(),bm=target.isMaximized(),an=source.getNormalBounds(),bn=target.getNormalBounds();
  const minimum=(window:SwapWindow,bounds:SwapBounds)=>{const [w,h]=window.getMinimumSize();return bounds.width>=(w??0)&&bounds.height>=(h??0);};
  if(!minimum(source,b)||!minimum(target,a)||!await fits(source,b)||!await fits(target,a))return {ok:false,error:'The layouts cannot fit the exchanged window sizes.'};
  if(invalid(source)||invalid(target)||source.isMaximized()!==am||target.isMaximized()!==bm||!same(source.getBounds(),a)||!same(target.getBounds(),b))return {ok:false,error:'A window changed during the drag. Try again.'};
  if(!commit)return {ok:true};
  try {
    if(am)source.unmaximize();if(bm)target.unmaximize();
    source.setBounds(bm?bn:b);target.setBounds(am?an:a);
    if(bm)source.maximize();if(am)target.maximize();
    // Native maximize completes asynchronously; verify the accepted placement.
    for(let i=0;i<40&&(!same(source.getBounds(),b)||!same(target.getBounds(),a));i++)await new Promise(resolve=>setTimeout(resolve,25));
    if(!same(source.getBounds(),b)||!same(target.getBounds(),a))throw Error('Windows refused the exchanged bounds.');
    return {ok:true};
  }catch(error){
    const failures:string[]=[];
    for(const [window,bounds,normal,maximized] of [[source,a,an,am],[target,b,bn,bm]] as const)try{if(!window.isDestroyed()){if(window.isMaximized())window.unmaximize();window.setBounds(maximized?normal:bounds);if(maximized)window.maximize();}}catch(rollback){failures.push(String(rollback));}
    return {ok:false,error:String(error)+(failures.length?' Restore failed: '+failures.join('; '):'')};
  }
}
