import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { evalInBackpackProject, evalInHost, launchPapers, waitFor } from './helpers';

it('protected Files/Preview remain distinct, movable and durable', async () => {
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'papers-page-panels-'));
 const id='bp-41414141-4141-4141-8141-414141414141';
 const root=path.join(profile,'project'),data=path.join(profile,'PapersData');
 const ayg=process.env['PAPERS_AYG_SOURCE']??'D:/Letters/MatTroiSeConMoc/Papers/Backpack projects/As you Go';
 await fs.mkdir(path.join(root,'public'),{recursive:true});
 await fs.cp(path.join(ayg,'public'),path.join(root,'public'),{recursive:true});
 await fs.writeFile(path.join(root,'public','protected-panels.html'),`<!doctype html><html><head><link rel="stylesheet" href="styles/base.css"><link rel="stylesheet" href="styles/file-capability.css"><link rel="stylesheet" href="styles/workspace-pane-layout.css"></head><body><div id="files" style="position:fixed;left:8px;top:8px;width:400px;height:400px"></div><div id="preview" style="position:fixed;left:8px;top:8px;width:400px;height:400px"></div><div id="right" style="position:fixed;left:8px;top:8px;width:calc(100% - 16px);height:calc(100% - 16px)"></div><script type="module" src="protected-panels.js"></script></body></html>`);
 await fs.writeFile(path.join(root,'public','protected-panels.js'),`
 import {createHostBridge} from './app/host/host-bridge.js';
 import {installCoordinatedWindowSlices} from './app/coordinated-window-slices.js';
 window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 const host=createHostBridge(window),root={element:document.querySelector('#right'),replaceNativeTabs(){},restoreWindows(){throw Error('Legacy fallback')}};
 const files={element:document.querySelector('#files')},preview={element:document.querySelector('#preview'),setPreviewSuspended(){},refreshPreviewGeometry(){}};
 host.onPaneLayout(s=>window.latest=s);
 window.panes=installCoordinatedWindowSlices({document,host,root,pagePanels:{files,preview},onStatus:e=>errors.push(e)});
 window.ready=panes.restore();window.nativeCommand=(command,params={})=>host.fileCapability('pane-layout-command',{command,revision:latest.stateRevision,...params});
 `);
 await fs.writeFile(path.join(root,'project.json'),JSON.stringify({schemaVersion:1,backpackId:id,entry:'public/protected-panels.html'}));
 await fs.writeFile(path.join(root,'actions.json'),JSON.stringify({schemaVersion:1,actions:[]}));
 const backpack={id,name:'Protected panels',type:'environment',createdAt:'2026-10-09T00:00:00.000Z',lastEnteredAt:null,archived:false,workspacePath:null};
 await fs.mkdir(path.join(data,'backpacks',id),{recursive:true});
 await fs.writeFile(path.join(data,'backpacks',id,'backpack.json'),JSON.stringify({schemaVersion:1,...backpack}));
 await fs.writeFile(path.join(data,'registry.json'),JSON.stringify({schemaVersion:1,backpacks:[backpack],lastActiveBackpackId:null}));
 await fs.writeFile(path.join(data,'backpack-projects.json'),JSON.stringify({schemaVersion:1,projects:{[id]:{root}}}));
 let launched=await launchPapers(profile,{fixtures:false});
 try{
  await waitFor(()=>evalInHost<boolean>(launched.app,`(()=>{const card=[...document.querySelectorAll('.backpack-card')].find(n=>n.textContent.includes('Protected panels'));if(!card)return false;const enter=[...card.querySelectorAll('button')].find(b=>b.textContent==='Enter');enter?.click();return !!enter;})()`),15000,'fixture project entry');
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,'Boolean(window.panes?.active())'),15000,'native pane mounted');
  await evalInBackpackProject(launched.app,'ready');
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`latest.groups.flatMap(g=>g.tabs).filter(t=>['preview:workspace-files','preview:workspace-preview'].includes(t.id)).length===2`),15000,'both protected panels');
  expect(await evalInBackpackProject<string[]>(launched.app,'errors')).toEqual([]);
  expect(await evalInBackpackProject<boolean>(launched.app,`[...document.querySelectorAll('[data-preview-tab-id="workspace-files"],[data-preview-tab-id="workspace-preview"]')].every(tab=>!tab.querySelector('.file-capability-browser-tab-close'))`)).toBe(true);
  expect((await evalInBackpackProject<{ok:boolean}>(launched.app,`nativeCommand('document-remove',{tabId:'preview:workspace-files'})`)).ok).toBe(false);
  const group=await evalInBackpackProject<string>(launched.app,`latest.groups.find(g=>g.tabs.some(t=>t.id==='preview:workspace-preview')).id`);
  const moved=await evalInBackpackProject<{ok:boolean}>(launched.app,`nativeCommand('move',{tabId:'preview:workspace-files',groupId:${JSON.stringify(group)}})`);
  expect(moved.ok).toBe(true);
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`latest.groups.some(g=>g.tabs.some(t=>t.id==='preview:workspace-files')&&g.tabs.some(t=>t.id==='preview:workspace-preview'))`),5000,'protected panels moved together');
  await launched.app.evaluate(({app})=>app.quit());await launched.close();
  launched=await launchPapers(profile,{fixtures:false});
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`Boolean(window.latest?.groups?.some(g=>g.tabs.some(t=>t.id==='preview:workspace-files')&&g.tabs.some(t=>t.id==='preview:workspace-preview')))`),18000,'protected membership recovered after restart');
 }finally{await launched.close();await fs.rm(profile,{recursive:true,force:true});}
});