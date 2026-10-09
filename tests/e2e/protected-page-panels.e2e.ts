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
 document.documentElement.classList.add('workspace-unified-panes');
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
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`['files','preview'].every(id=>{const e=document.querySelector('#'+id),r=e.getBoundingClientRect();return !e.hidden&&r.width>=120&&r.height>=120&&getComputedStyle(e).display!=='none'})`),12000,'both visibly sized page panels');
  const ownership=await evalInBackpackProject<{files:string;preview:string;filesSelected:boolean;previewSelected:boolean}>(launched.app,`(()=>{const files=latest.groups.find(g=>g.tabs.some(t=>t.id==='preview:workspace-files')),preview=latest.groups.find(g=>g.tabs.some(t=>t.id==='preview:workspace-preview'));return {files:files.id,preview:preview.id,filesSelected:files.selected==='preview:workspace-files',previewSelected:preview.selected==='preview:workspace-preview'};})()`);
  expect(ownership.files).not.toBe(ownership.preview);
  expect(ownership.filesSelected&&ownership.previewSelected).toBe(true);
  const before=await evalInBackpackProject<{width:number;viewportX:number;edge:number}>(launched.app,`(()=>{const group=latest.groups.find(g=>g.id===${JSON.stringify('system-workspace-files')});return {width:group.slot.width,viewportX:latest.viewport.x,edge:group.slot.x+group.slot.width}})()`);
  const movedEdge=await evalInBackpackProject<{ok:boolean;error?:string}>(launched.app,`nativeCommand('document-edge',{groupId:'system-workspace-files',edge:'right',position:${before.edge+12-before.viewportX}})`);
  expect(movedEdge.ok,movedEdge.error).toBe(true);
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`latest.groups.find(g=>g.id==='system-workspace-files').slot.width!==${before.width}`),5000,'Files pane resizable via native edge');
  // A zero-tab group has no favicon to click when minimized vertically. The
  // restore/maximize/close controls must remain exposed in that strip.
  const collapsed=await evalInBackpackProject<{ok:boolean}>(launched.app,`nativeCommand('presentation',{groupId:'main',mode:'minimized'})`);
  expect(collapsed.ok).toBe(true);
  const emptyRail=`(()=>{const group=latest.groups.find(g=>g.id==='main'),rail=document.querySelector('[data-slice-id="main"] .slice-vertical-restore');return group?.presentation==='minimized'&&group.tabs.length===0&&group.slot.width===32&&rail&&!rail.hidden&&['Restore group','Maximize group','Remove window group'].every(label=>{const button=[...rail.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);return button&&!button.hidden&&getComputedStyle(button).display!=='none'})})()`;
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,emptyRail),5000,'empty minimized rail has three usable controls');
  await evalInBackpackProject(launched.app,`document.querySelector('[data-slice-id="main"] .slice-vertical-controls [aria-label="Restore group"]').click()`);
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`latest.groups.find(g=>g.id==='main')?.presentation==='normal'`),5000,'restore empty group without a tab');
  expect((await evalInBackpackProject<{ok:boolean}>(launched.app,`nativeCommand('presentation',{groupId:'main',mode:'minimized'})`)).ok).toBe(true);
  await evalInBackpackProject(launched.app,`document.querySelector('[data-slice-id="main"] .slice-vertical-controls [aria-label="Maximize group"]').click()`);
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`latest.groups.find(g=>g.id==='main')?.presentation==='maximized'`),5000,'maximize empty minimized group');
  expect((await evalInBackpackProject<{ok:boolean}>(launched.app,`nativeCommand('presentation',{groupId:'main',mode:'minimized'})`)).ok).toBe(true);
  await evalInBackpackProject(launched.app,`document.querySelector('[data-slice-id="main"] .slice-vertical-controls [aria-label="Remove window group"]').click()`);
  await waitFor(()=>evalInBackpackProject<boolean>(launched.app,`!latest.groups.some(g=>g.id==='main')`),5000,'close empty minimized group without a tab');
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