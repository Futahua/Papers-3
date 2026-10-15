import {it,expect} from 'vitest';import {randomUUID} from 'node:crypto';
import {outerDeviceTopology,retainInlineGroupMembers,restoredDeviceUrl} from '../src/shared/inlineDeviceTopology';
import {parseWorkspaceTopology,type WorkspaceTopologyV1} from '../src/shared/workspaceTopology';
const deviceId=randomUUID();const topology:WorkspaceTopologyV1={schemaVersion:1,surfaces:[{surfaceId:'parent',surfaceKey:'parent-key',projectId:'ayg',title:'Files'},{surfaceId:'remote',surfaceKey:'remote-key',projectId:'ayg',title:'LapDog',deviceId,inlineParentKey:'parent-key'}],groups:[{groupId:'main',surfaceIds:['parent','remote'],activeSurfaceId:'parent'}],root:{kind:'group',groupId:'main'},focusedGroupId:'main'};
it('persists an inline device view while omitting it from outer tabs',()=>{
 const saved=parseWorkspaceTopology(JSON.parse(JSON.stringify(topology)));expect(saved.surfaces[1]).toMatchObject({deviceId,inlineParentKey:'parent-key'});
 const outer=outerDeviceTopology(saved);expect(outer.surfaces.map(s=>s.surfaceId)).toEqual(['parent']);expect(outer.groups[0]?.surfaceIds).toEqual(['parent']);
 expect(retainInlineGroupMembers(saved,outer.groups)).toEqual([{groupId:'main',surfaceIds:['parent','remote'],activeSurfaceId:'parent'}]);
});
it('restores device identity using the current project URL, without retaining a spent URL nonce',()=>{
 const url=restoredDeviceUrl('papers-backpack://ayg/open/new/public/workspace.html',topology.surfaces[1]!);expect(new URL(url).searchParams.get('papers-device')).toBe(deviceId);expect(new URL(url).searchParams.get('papers-inline-device')).toBe('1');expect(url).toContain('/open/new/');
});
it('keeps hidden children with their parent when the outer group moves',()=>{expect(retainInlineGroupMembers(topology,[{groupId:'moved',surfaceIds:['parent']}])[0]?.surfaceIds).toEqual(['parent','remote']);});
