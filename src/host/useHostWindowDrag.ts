import {useEffect} from 'react';
import {showMoveRefusal} from './moveFeedback';
import {host} from './bridge';
const WINDOW='application/x-papers-window',SAVED='application/x-papers-saved-page';
export function useHostWindowDrag(onError:(message:string)=>void,onSavedMoved:()=>void):void {
  useEffect(()=>{
    let windowId:number|undefined,ownDrag=false,revision=0,lastKey='';
    let lastResult:{ok:boolean;error?:string}|undefined;
    let draggedKey:string|undefined;
    void host().app.windows().then(w=>{windowId=w.find(w=>w.current)?.windowId;}).catch(()=>{});
    const unsubscribe=host().events.onMoveRejected(item=>{if(item.surfaceId)return;const source=item.window?document.documentElement:Array.from(document.querySelectorAll('[data-saved-page]')).find(n=>n.getAttribute('data-saved-page')===item.key)??null;showMoveRefusal(source);});
    const cue=document.createElement('div');cue.className='papers-container-drop';cue.hidden=true;document.body.append(cue);
    const clear=()=>{revision++;lastKey='';lastResult=undefined;cue.classList.remove('is-rejected');cue.hidden=true;};
    const start=(event:DragEvent)=>{
      const node=event.target instanceof Element?event.target.closest('[data-window-grip],[data-saved-page]'):null;
      if(!node||!event.dataTransfer)return;
      if(node.hasAttribute('data-window-grip')){if(windowId===undefined){event.preventDefault();return;}event.dataTransfer.setData(WINDOW,String(windowId));}
      else event.dataTransfer.setData(SAVED,node.getAttribute('data-saved-page')!);
      draggedKey=node.getAttribute('data-saved-page')??undefined;event.dataTransfer.effectAllowed='move';ownDrag=true;void host().app.windowDrag(true,draggedKey).catch(onError);
    };
    const target=(event:DragEvent)=>{
      const types=event.dataTransfer?.types??[];
      if(types.includes(WINDOW))return {kind:'window' as const,groupId:'',side:'center',box:{x:0,y:32,width:innerWidth,height:innerHeight-32}};
      if(!types.includes(SAVED))return null;
      const group=event.target instanceof Element?event.target.closest<HTMLElement>('[data-papers-group-id]'):null;
      if(!group)return null;
      const r=group.getBoundingClientRect(),x=event.clientX-r.x,y=event.clientY-r.y;
      const edges=[{side:'left',d:x/r.width},{side:'right',d:1-x/r.width},{side:'top',d:y/r.height},{side:'bottom',d:1-y/r.height}].sort((a,b)=>a.d-b.d);
      const side=edges[0]!.d<.22?edges[0]!.side:'center';
      const box={x:r.x,y:r.y,width:r.width,height:r.height};
      if(side==='left'||side==='right'){if(side==='right')box.x+=box.width-6;box.width=6;}
      if(side==='top'||side==='bottom'){if(side==='bottom')box.y+=box.height-6;box.height=6;}
      return {kind:'saved' as const,groupId:group.dataset.papersGroupId!,side,box};
    };
    const over=(event:DragEvent)=>{
      const t=target(event);if(!t)return;event.preventDefault();event.stopImmediatePropagation();
      cue.hidden=false;Object.assign(cue.style,{left:t.box.x+'px',top:t.box.y+'px',width:t.box.width+'px',height:t.box.height+'px'});
      cue.classList.toggle('is-insertion',t.kind==='saved'&&t.side!=='center');
      const identity=JSON.stringify([t.kind,t.groupId,t.side]);
      const paint=(result:{ok:boolean;error?:string})=>{cue.classList.toggle('is-rejected',!result.ok);
        cue.textContent=!result.ok?result.error??'Cannot drop here':t.kind==='window'?'Swap window positions':t.side==='center'?'Open this page here':'';
        cue.setAttribute('aria-label',!result.ok?cue.textContent:t.kind==='window'?'Swap window positions':'Open page '+t.side);
        event.dataTransfer!.dropEffect=result.ok?'move':'none';};
      if(identity===lastKey){if(lastResult)paint(lastResult);return;}
      lastKey=identity;lastResult=undefined;const token=++revision;
      cue.classList.remove('is-rejected');cue.textContent='Checking layout…';event.dataTransfer!.dropEffect='none';
      void host().app.windowDragState().then(async state=>{
        if(!state)return {ok:false,error:'That drag is no longer active.'};
        return t.kind==='window'?host().app.swapWindow(state.sourceId,false)
          :state.key?host().app.dropSavedPage(state.key,t.groupId,t.side,false):{ok:false,error:'That saved page is unavailable.'};
      }).then(result=>{if(token!==revision)return;lastResult=result;paint(result);})
        .catch(error=>{if(token===revision){lastResult={ok:false,error:String(error)};paint(lastResult);}});
    };
    const drop=async(event:DragEvent)=>{
      const t=target(event);if(!t)return;
      event.preventDefault();event.stopImmediatePropagation();
      try{
        const result=t.kind==='window'?await host().app.swapWindow(Number(event.dataTransfer!.getData(WINDOW)),true)
          :await host().app.dropSavedPage(event.dataTransfer!.getData(SAVED),t.groupId,t.side,true);
        if(!result.ok)throw Error(result.error??'This drop was refused.');
        if(t.kind==='saved')onSavedMoved();
      }catch(error){onError(String(error));}finally{clear();}
    };
    const leave=(event:DragEvent)=>{if(event.clientX<=0||event.clientY<=0||event.clientX>=innerWidth||event.clientY>=innerHeight)clear();};
    const heartbeat=setInterval(()=>{if(ownDrag)void host().app.windowDrag(true,draggedKey).catch(()=>{});},5000);
    const end=(cancelled=false)=>{clear();if(ownDrag){ownDrag=false;void host().app.windowDrag(false,undefined,cancelled).catch(()=>{});}};
    const dragEnd=()=>end();
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')end(true);};
    window.addEventListener('dragstart',start);window.addEventListener('dragover',over,true);window.addEventListener('drop',drop,true);
    window.addEventListener('dragleave',leave);window.addEventListener('dragend',dragEnd);window.addEventListener('keydown',key,true);
    return ()=>{unsubscribe();clearInterval(heartbeat);end(true);cue.remove();window.removeEventListener('dragleave',leave);window.removeEventListener('dragstart',start);window.removeEventListener('dragover',over,true);window.removeEventListener('drop',drop,true);window.removeEventListener('dragend',dragEnd);window.removeEventListener('keydown',key,true);};
  },[onError,onSavedMoved]);
}
