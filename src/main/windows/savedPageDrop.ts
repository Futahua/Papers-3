import type {WorkspaceLayoutNode,WorkspaceTopologyV1} from '@shared/workspaceTopology';
/** Derive available group dimensions from the authoritative tree, not drag coordinates. */
export function savedPageDropFits(topology:WorkspaceTopologyV1,groupId:string,side:string,width:number,height:number):boolean {
  const area=savedPageDropArea(topology,groupId,side,width,height);
  return !!area&&(side==='center'||area.width>=240&&area.height>=192);
}
export function savedPageDropArea(topology:WorkspaceTopologyV1,groupId:string,side:string,width:number,height:number):{width:number;height:number}|undefined {
  const visit=(node:WorkspaceLayoutNode,w:number,h:number):{width:number;height:number}|undefined=>{
    if(node.kind==='group')return node.groupId===groupId
      ? {width:side==='left'||side==='right'?w/2:w,height:side==='top'||side==='bottom'?h/2:h} : undefined;
    const sum=node.weights.reduce((a,b)=>a+b,0);
    for(let i=0;i<node.children.length;i++){
      const ratio=node.weights[i]!/sum;
      const found=visit(node.children[i]!,node.orientation==='horizontal'?w*ratio:w,node.orientation==='vertical'?h*ratio:h);
      if(found!==undefined)return found;
    }
    return undefined;
  };
  return visit(topology.root,width,height);
}
