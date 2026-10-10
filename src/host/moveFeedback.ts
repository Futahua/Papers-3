// Keep native and authored geometry untouched while the refusal cue shakes.
export function showMoveRefusal(source:Element|null):void {
  if(!source?.isConnected)return;
  const r=source.getBoundingClientRect();if(!r.width||!r.height)return;
  const border=document.createElement('div');border.className='move-refusal-feedback';border.setAttribute('aria-hidden','true');
  Object.assign(border.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});document.body.append(border);
  border.addEventListener('animationend',()=>border.remove(),{once:true});setTimeout(()=>border.remove(),450);
}
