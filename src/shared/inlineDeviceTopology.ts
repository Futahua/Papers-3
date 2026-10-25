import type {WorkspaceTopologyV1,WorkspaceSurface} from './workspaceTopology';

/** Logical inline pages persist with the workspace; the outer strip projects only their parents. */
export function outerDeviceTopology(topology:WorkspaceTopologyV1):WorkspaceTopologyV1 {
  const surfaces=topology.surfaces.filter(surface=>!surface.inlineParentKey),visible=new Set(surfaces.map(surface=>surface.surfaceId));
  return {...topology,surfaces,groups:topology.groups.map(group=>{const surfaceIds=group.surfaceIds.filter(id=>visible.has(id));return {...group,surfaceIds,activeSurfaceId:group.activeSurfaceId&&visible.has(group.activeSurfaceId)?group.activeSurfaceId:surfaceIds[0]??null};})};
}
export function retainInlineGroupMembers(topology:WorkspaceTopologyV1,groups:Array<{groupId:string;surfaceIds:string[]}>){
  return groups.map(group=>({...group,surfaceIds:[...group.surfaceIds,...topology.surfaces.filter(surface=>{
    if(!surface.inlineParentKey)return false;const parent=topology.surfaces.find(item=>(item.surfaceKey??item.surfaceId)===surface.inlineParentKey);return parent&&group.surfaceIds.includes(parent.surfaceId);
  }).map(surface=>surface.surfaceId)]}));
}
export function restoredDeviceUrl(url:string,surface:WorkspaceSurface):string {
  const parsed=new URL(url);if(surface.deviceId)parsed.searchParams.set('papers-device',surface.deviceId);else parsed.searchParams.delete('papers-device');if(surface.inlineParentKey)parsed.searchParams.set('papers-inline-device','1');else parsed.searchParams.delete('papers-inline-device');return parsed.toString();
}
