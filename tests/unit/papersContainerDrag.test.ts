import {describe,it,expect,vi} from 'vitest';
import {savedPageGroups} from '../../src/host/savedPageGroups';
import {swapPapersWindows,type SwapWindow,type SwapBounds} from '../../src/main/windows/papersWindowSwap';
import {savedPageDropFits} from '../../src/main/windows/savedPageDrop';
import {createWorkspaceTopology,openWorkspaceSurface,splitWorkspaceGroup} from '../../src/shared/workspaceTopology';
const window=(bounds:SwapBounds)=>({
  bounds:{...bounds},isDestroyed:()=>false,isMinimized:()=>false,isMaximized:()=>false,isFullScreen:()=>false,
  getBounds(){return {...this.bounds};},getMinimumSize:()=>[240,192],setBounds(b:SwapBounds){this.bounds={...b};},
});
describe('container drag',()=>{
  it('shows only unopened pages and joins siblings with stable color',()=>{
    const input=[{key:'a',title:'A',windowId:null,current:false,workspaceId:'one'},
      {key:'live',title:'Live',windowId:9,current:false,workspaceId:'two'},
      {key:'b',title:'B',windowId:null,current:false,workspaceId:'one'},
      {key:'c',title:'C',windowId:null,current:false,workspaceId:'three'}];
    const groups=savedPageGroups(input);expect(groups.map(g=>g.pages.map(p=>p.key))).toEqual([['a','b'],['c']]);
    expect(savedPageGroups(input.slice().reverse()).find(g=>g.id==='one')?.hue).toBe(groups[0]!.hue);
  });
  it('validates without moving; then exchanges complete window bounds',async()=>{
    const a=window({x:10,y:20,width:800,height:600}),b=window({x:900,y:30,width:1200,height:700});
    const originalA=a.getBounds(),originalB=b.getBounds();
    expect(await swapPapersWindows(a,b,async()=>true)).toEqual({ok:true});expect(a.bounds).toEqual(originalA);
    expect(await swapPapersWindows(a,b,async()=>true,true)).toEqual({ok:true});expect(a.bounds).toEqual(originalB);expect(b.bounds).toEqual(originalA);
  });
  it('refuses native minimum constraints and stale geometry without moving',async()=>{
    const a=window({x:10,y:20,width:800,height:600}),b=window({x:900,y:30,width:1200,height:700});
    const move=vi.spyOn(a,'setBounds');expect((await swapPapersWindows(a,b,async()=>false,true)).ok).toBe(false);expect(move).not.toHaveBeenCalled();
    expect((await swapPapersWindows(a,b,async w=>{if(w===a)b.bounds.x++;return true;},true)).ok).toBe(false);expect(move).not.toHaveBeenCalled();
  });
  it('rolls back both windows when native placement refuses one',async()=>{
    const a=window({x:10,y:20,width:800,height:600}),b=window({x:900,y:30,width:1200,height:700});
    const first=a.getBounds(),second=b.getBounds();let writes=0;
    b.setBounds=(bounds)=>{if(writes++===0)throw Error('refused');b.bounds={...bounds};};
    expect((await swapPapersWindows(a,b,async()=>true,true)).ok).toBe(false);expect(a.bounds).toEqual(first);expect(b.bounds).toEqual(second);
  });
  it.each(['isMinimized','isMaximized','isFullScreen','isDestroyed'] as const)('refuses a window in state %s',async state=>{
    const a=window({x:0,y:0,width:800,height:600}),b=window({x:800,y:0,width:800,height:600});a[state]=()=>true;
    expect((await swapPapersWindows(a as SwapWindow,b,async()=>true,true)).ok).toBe(false);
  });
  it('uses the existing group area for split acceptance',()=>{
    let topology=openWorkspaceSurface(createWorkspaceTopology(),{surfaceId:'a',projectId:'a',title:'A'});
    topology=openWorkspaceSurface(topology,{surfaceId:'b',projectId:'b',title:'B'});
    topology=splitWorkspaceGroup(topology,{groupId:'group-main',newGroupId:'right',surfaceId:'b',orientation:'horizontal',position:'after'});
    expect(savedPageDropFits(topology,'right','right',800,600)).toBe(false);
    expect(savedPageDropFits(topology,'right','bottom',800,600)).toBe(true);
    expect(savedPageDropFits(topology,'missing','center',800,600)).toBe(false);
  });
});
