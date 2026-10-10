import { expect, it, vi } from 'vitest';
import { createPaneBackpackPages, type PanePage } from '../../src/main/backpacks/paneBackpackPages';
import type { NativePaneBridge, NativePaneSnapshot } from '../../src/main/backpacks/nativePaneBridge';

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
