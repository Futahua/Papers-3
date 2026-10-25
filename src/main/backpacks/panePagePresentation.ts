export interface PageBounds {x:number;y:number;width:number;height:number}
/** WebContentsView accepts integer DIPs; compare the geometry it can actually retain. */
export function snapPageBounds(bounds:PageBounds):PageBounds {
  return {x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.max(0,Math.round(bounds.width)),height:Math.max(0,Math.round(bounds.height))};
}
export function pagePresentationSettled(current:PageBounds|null,presented:boolean,bounds:PageBounds|null,visible:boolean):boolean {
  if(presented!==visible)return false;if(!bounds)return true;if(!current)return false;
  const next=snapPageBounds(bounds);return current.x===next.x&&current.y===next.y&&current.width===next.width&&current.height===next.height;
}
