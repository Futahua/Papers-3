import { expect, it, vi } from 'vitest';
import { createPaneBackpackPages, type PanePage } from '../../src/main/backpacks/paneBackpackPages';
import type { NativePaneBridge, NativePaneSnapshot } from '../../src/main/backpacks/nativePaneBridge';

it('admits a device view from its own parent while still refusing an ordinary recursive AYG page',async()=>{
 const pages:PanePage[]=[{windowId:1,surfaceId:'parent',key:'parent-key',projectId:'ayg',title:'Files'},{windowId:1,surfaceId:'remote',key:'remote-key',projectId:'ayg',title:'Phone',deviceId:'phone',inlineParentKey:'parent-key'}];
 const snapshot={binding:'b',stateRevision:1,geometryRevision:1,presented:true,groups:[{id:'main',tabs:[],content:{x:0,y:0,width:800,height:600},slot:{x:0,y:0,width:800,height:600}}]} as unknown as NativePaneSnapshot;
 const bridge={snapshot:()=>snapshot,has:()=>true,canFitPageGroup:async()=>true} as unknown as NativePaneBridge;
 const owner=createPaneBackpackPages({bridge:()=>bridge,pages:()=>pages,outer:()=>({bounds:null,visible:false}),present:vi.fn(),adopt:vi.fn(),exists:async()=>true});
 expect((await owner.check('1:parent','remote','main','center')).ok).toBe(true);
 pages[1]!.inlineParentKey='wrong';expect((await owner.check('1:parent','remote','main','center')).ok).toBe(false);
 delete pages[1]!.deviceId;delete pages[1]!.inlineParentKey;expect((await owner.check('1:parent','remote','main','center')).ok).toBe(false);
});

it('refreshes retained page titles without selecting, moving or recreating their tab, including after hidden-page presentation', async () => {
 const pages: PanePage[] = [{windowId:1,surfaceId:'parent',key:'parent',projectId:'ayg',title:'Files'},
  {windowId:1,surfaceId:'child',key:'child',projectId:'proxima',title:'21:55',tabStyle:'proxima'}];
 let snapshot = {binding:'b',stateRevision:1,geometryRevision:1,presented:true,groups:[{id:'main',selected:'other',tabs:[
  {id:'preview:child',kind:'document',active:false,preview:{Id:'preview:child',PageKey:'child',Name:'21:55',TabStyle:'proxima'}},
  {id:'other',kind:'document',active:true},
 ]}]} as NativePaneSnapshot;
 let owner: ReturnType<typeof createPaneBackpackPages>;
 const command = vi.fn(async (_owner:string, _op:string, params:any) => {
  snapshot = {...snapshot,groups:snapshot.groups.map(g=>({...g,tabs:g.tabs.map(t=>t.id===params.tabId?{...t,preview:params.preview}:t)}))};
  owner.accept('1:parent',snapshot);
  return {ok:true,snapshot};
 });
 owner=createPaneBackpackPages({bridge:()=>({has:()=>true,snapshot:()=>snapshot,command}) as unknown as NativePaneBridge,
  pages:()=>pages,outer:()=>({bounds:null,visible:false}),present:vi.fn(),adopt:vi.fn(),exists:async()=>true});
 owner.accept('1:parent',snapshot);
 pages[1]!.title='22:09';
 owner.accept('1:parent',{...snapshot,groups:snapshot.groups.map(g=>({...g,tabs:g.tabs.map(t=>t.preview?{...t,preview:{...t.preview,Name:'22:09'}}:t)}))});
 await owner.syncTitles();
 expect(command).toHaveBeenCalledTimes(1);
 expect(command).toHaveBeenLastCalledWith('1:parent','document-add',{tabId:'preview:child',groupId:'main',preview:{Id:'preview:child',PageKey:'child',Name:'22:09',TabStyle:'proxima'}});
 expect(snapshot.groups[0]!.selected).toBe('other');
 await owner.syncTitles();expect(command).toHaveBeenCalledTimes(1);
 snapshot={...snapshot,presented:false};owner.accept('1:parent',snapshot);
 pages[1]!.title='22:10';await owner.syncTitles();expect(command).toHaveBeenCalledTimes(1);
 snapshot={...snapshot,presented:true};owner.accept('1:parent',snapshot);await owner.syncTitles();
 expect(snapshot.groups[0]!.tabs[0]!.preview?.Name).toBe('22:10');
 expect(snapshot.groups[0]!.selected).toBe('other');
});
it('moves both hosted page owners through the topology owner and compensates a partial exchange',async()=>{
 const pages:PanePage[]=[{windowId:1,surfaceId:'a',key:'a',projectId:'ayg',title:'A'},{windowId:2,surfaceId:'b',key:'b',projectId:'ayg',title:'B'},
  {windowId:1,surfaceId:'p',key:'p',projectId:'proxima',title:'Clock'},{windowId:2,surfaceId:'q',key:'q',projectId:'pencilcase',title:'Tools'}];
 const adopt=vi.fn(async(page:PanePage,parent:PanePage)=>{if(page.key==='q'&&parent.key==='a')throw Error('destination closed');page.windowId=parent.windowId;});
 const bridge={has:()=>false,canFitPageGroup:vi.fn(async()=>true)} as unknown as NativePaneBridge;
 const owner=createPaneBackpackPages({bridge:()=>bridge,pages:()=>pages,outer:()=>({bounds:null,visible:false}),present:vi.fn(),adopt,exists:async()=>true});
 const moves=[{key:'p',from:'1:a',to:'2:b',width:800,height:600},{key:'q',from:'2:b',to:'1:a',width:800,height:600}];
 expect((await owner.checkTransfers(moves)).ok).toBe(true);
 await expect(owner.applyTransfers(moves)).rejects.toThrow('destination closed');
 expect(pages[2]!.windowId).toBe(1);expect(pages[3]!.windowId).toBe(2);
 adopt.mockImplementation(async(page,parent)=>{page.windowId=parent.windowId;});
 const undo=await owner.applyTransfers(moves);expect(pages[2]!.windowId).toBe(2);expect(pages[3]!.windowId).toBe(1);
 await undo();expect(pages[2]!.windowId).toBe(1);expect(pages[3]!.windowId).toBe(2);
});
