import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { evalInHost, evalInHostWindow, launchPapers, waitFor } from './helpers';

function previewPdf(): Buffer {
 const stream='BT /F1 18 Tf 20 100 Td (Pinned PDF fixture) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(pdf);
}

// Real Papers preload/main/capability/pipe/native route. DOM dispatch exercises
// the strip without taking the creator's physical mouse or keyboard.
it.each([false,true])('Papers moves native/preview tabs through real group commands (embedded=%s)',async(embedded)=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'papers-coordinated-e2e-'));
 const id='bp-30303030-3030-4030-8030-303030303030',project=path.join(profile,'project'),data=path.join(profile,'PapersData');
 const ayg=process.env['PAPERS_AYG_SOURCE']??'D:/Letters/MatTroiSeConMoc/Products/Papers/Runtime/Backpack projects/As you Go';
 const fixtureExe=process.env['PAPERS_PANE_FIXTURE_EXE']??'D:/CodexTemp/papers-split-integration/native-split-next.exe';
 const fixtures:ChildProcess[]=[];
 await fs.mkdir(path.join(data,'backpacks',id),{recursive:true});
 await fs.cp(path.join(ayg,'public'),path.join(project,'public'),{recursive:true});
 await fs.writeFile(path.join(project,'project.json'),JSON.stringify({schemaVersion:1,backpackId:id,entry:'public/pane-test.html'}));
 await fs.writeFile(path.join(project,'actions.json'),JSON.stringify({schemaVersion:1,actions:[]}));
 const backpack={id,name:'Coordinated Panes Acceptance',type:'environment',createdAt:'2026-10-09T00:00:00Z',lastEnteredAt:null,archived:false,workspacePath:null};
 await fs.writeFile(path.join(data,'backpacks',id,'backpack.json'),JSON.stringify({schemaVersion:1,...backpack}));
 await fs.writeFile(path.join(data,'registry.json'),JSON.stringify({schemaVersion:1,backpacks:[backpack],lastActiveBackpackId:null}));
 await fs.writeFile(path.join(data,'backpack-projects.json'),JSON.stringify({schemaVersion:1,projects:{[id]:{root:project}}}));
 const documentPath=path.join(project,'preview.txt');await fs.writeFile(documentPath,'An isolated preview fixture.');
 const pdfPath=path.join(project,'preview.pdf');await fs.writeFile(pdfPath,previewPdf());
 const secondPdfPath=path.join(project,'preview-two.pdf');await fs.writeFile(secondPdfPath,previewPdf());
 const imagePath=path.join(project,'preview.png');await fs.writeFile(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=','base64'));
 await fs.writeFile(path.join(project,'public','pane-test.html'),`<!doctype html><html class="workspace-two-pane"><head><link rel="stylesheet" href="styles/base.css"><link rel="stylesheet" href="styles/file-capability.css"><link rel="stylesheet" href="styles/workspace-pane-layout.css"></head><body><div id="right" style="position:fixed;left:35%;right:8px;top:8px;bottom:8px"></div><script type="module">
 import {createHostBridge} from './app/host/host-bridge.js';
 import {installCoordinatedWindowSlices} from './app/coordinated-window-slices.js';
 import {installPreviewPinDrag} from './app/preview-pin-drag.js';
 window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 window.host=createHostBridge(window);window.calls=[];const call=host.fileCapability;host.fileCapability=async(...args)=>{const reply=await call(...args);calls.push({args,reply});return reply;};const root={element:document.querySelector('#right'),replaceNativeTabs(){window.legacyTeardown=host.fileCapability('chrome-pane-visible',{visible:false});},restoreWindows(){throw Error('Unexpected legacy fallback');}};
 host.onPaneLayout(s=>window.latest=s);window.previews=[];
 root.element.style.width='300px';root.element.style.transition='width 160ms ease';
 window.pin=document.createElement('button');pin.textContent='Pin preview';document.body.append(pin);window.resolvePreviewDrag=installPreviewPinDrag({pin,getItem:()=>({path:${JSON.stringify(imagePath)},name:'Dragged image'}),createId:()=> 'pin-drag-image'});
 window.panes=installCoordinatedWindowSlices({document,host,root,resolvePreviewDrag,onStatus:e=>errors.push(e),onPreviews:tabs=>window.previews=tabs,onOuterEdge:r=>{root.element.style.left=r.x+'px';}});
 // Load the saved width before restore; a legacy transition must not expose
 // intermediate narrow geometry to the retained-window mount.
 window.ready=(async()=>{while(innerWidth<500||innerHeight<300)await new Promise(r=>setTimeout(r,50));root.element.style.boxSizing='border-box';root.element.style.width=(innerWidth*.65-8)+'px';return panes.restore();})();
 window.dropTab=(type,value,x,y)=>{const transfer=new DataTransfer();transfer.setData(type,value);document.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true}));document.elementFromPoint(x,y).dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,clientX:x,clientY:y,bubbles:true,cancelable:true}));document.elementFromPoint(x,y).dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:x,clientY:y,bubbles:true,cancelable:true}));};
 </script></body></html>`);
 const html=await fs.readFile(path.join(project,'public','pane-test.html'),'utf8');
 await fs.writeFile(path.join(project,'public','pane-test.css'),'#right{position:fixed;left:35%;right:8px;top:8px;bottom:8px}');
 await fs.writeFile(path.join(project,'public','pane-test.js'),html.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!);
 await fs.writeFile(path.join(project,'public','pane-test.html'),html.replace('</head>','<link rel="stylesheet" href="pane-test.css"></head>').replace(/<script type="module">[\s\S]*?<\/script>/,'<script type="module" src="pane-test.js"></script>'));
 const hostId='bp-40404040-4040-4040-8040-404040404040',topId=embedded?hostId:id;
 if(embedded){
  const shell=path.join(profile,'shell');await fs.mkdir(path.join(shell,'public'),{recursive:true});
  await fs.writeFile(path.join(shell,'project.json'),JSON.stringify({schemaVersion:1,backpackId:hostId,entry:'public/shell.html',workspaceHost:id}));
  const hostBackpack={...backpack,id:hostId,name:'Coordinated Panes Acceptance Embedded'};
  await fs.mkdir(path.join(data,'backpacks',hostId),{recursive:true});await fs.writeFile(path.join(data,'backpacks',hostId,'backpack.json'),JSON.stringify({schemaVersion:1,...hostBackpack}));
  await fs.writeFile(path.join(data,'registry.json'),JSON.stringify({schemaVersion:1,backpacks:[hostBackpack,backpack],lastActiveBackpackId:null}));
  await fs.writeFile(path.join(data,'backpack-projects.json'),JSON.stringify({schemaVersion:1,projects:{[id]:{root:project},[hostId]:{root:shell}}}));
  await fs.writeFile(path.join(shell,'public','shell.html'),'<!doctype html><html><head><link rel="stylesheet" href="shell.css"></head><body><script src="shell.js"></script></body></html>');
  await fs.writeFile(path.join(shell,'public','shell.css'),'iframe{position:fixed;left:350px;right:12px;top:60px;bottom:12px;width:calc(100% - 362px);height:calc(100% - 72px);border:0}');
  // The same response relay and scoped iframe contract used by Proxima.
  await fs.writeFile(path.join(shell,'public','shell.js'),`window.shellErrors=[];window.addEventListener('error',e=>shellErrors.push(e.message));const routes=new Set();let child;const scopeId=crypto.randomUUID();window.addEventListener('message',e=>{if(e.source===child?.contentWindow&&e.data?.requestId)routes.add(e.data.requestId);if(e.source!==window||e.data?.type!=='papers:host:result')return;if(e.data.requestId===scopeId){if(!e.data.ok)throw Error(e.data.error);child=document.createElement('iframe');child.src=e.data.workspaceScope.url;document.body.append(child);}else if(routes.delete(e.data.requestId))child.contentWindow.postMessage(e.data,'papers-backpack://${id}');});window.postMessage({type:'papers:project:workspace-scope',requestId:scopeId,projectKey:'pane-test',projectName:'Pane test'},location.origin);`);
 }
 const childId='bp-50505050-5050-4050-8050-505050505050',childRoot=path.join(profile,'child-page');
 await fs.mkdir(path.join(childRoot,'public'),{recursive:true});await fs.writeFile(path.join(childRoot,'public','index.html'),'<html><body>Retained Backpack page<script>window.marker=crypto.randomUUID()</script></body></html>');
 await fs.writeFile(path.join(childRoot,'project.json'),JSON.stringify({schemaVersion:1,backpackId:childId,entry:'public/index.html'}));
 const childBackpack={...backpack,id:childId,name:'Proxima page fixture'};await fs.mkdir(path.join(data,'backpacks',childId),{recursive:true});await fs.writeFile(path.join(data,'backpacks',childId,'backpack.json'),JSON.stringify({schemaVersion:1,...childBackpack}));
 const registry=JSON.parse(await fs.readFile(path.join(data,'registry.json'),'utf8'));registry.backpacks.push(childBackpack);await fs.writeFile(path.join(data,'registry.json'),JSON.stringify(registry));
 const roots=JSON.parse(await fs.readFile(path.join(data,'backpack-projects.json'),'utf8'));roots.projects[childId]={root:childRoot};await fs.writeFile(path.join(data,'backpack-projects.json'),JSON.stringify(roots));
 let launched=await launchPapers(profile,{fixtures:false});
 let primaryContentsId=0;
 const evaluate=<T>(js:string)=>launched.app.evaluate(async({webContents},args)=>{
  const view=webContents.getAllWebContents().find(w=>(!args.primaryContentsId||w.id===args.primaryContentsId)&&w.getURL().startsWith('papers-backpack://'+args.topId+'/'));
  if(!view)throw Error('Project has not loaded');
  const target=args.embedded?view.mainFrame.frames.find(f=>f.url.startsWith('papers-backpack://'+args.id+'/')):view.mainFrame;
  if(!target)throw Error('Embedded project has not loaded');return target.executeJavaScript(args.js,true);
 },{js,topId,embedded,id,primaryContentsId}) as Promise<T>;
 try{
  await waitFor(()=>launched.app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().length>0),10000,'Papers host window');
  // Keep fixture heights below Windows' current monitor maximum tracking size.
  // This offscreen host must not turn a docking check into a rejected oversize request.
  await launched.app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0]!;win.setBounds({x:2100,y:20,width:1500,height:700});});
  await waitFor(async()=>await evalInHost<boolean>(launched.app,`(()=>{const card=[...document.querySelectorAll('.backpack-card')].find(n=>n.textContent.includes('Coordinated Panes Acceptance'));if(!card)return false;[...card.querySelectorAll('button')].find(n=>n.textContent==='Enter').click();return true;})()`),10000,'seeded Backpack');
  await waitFor(async()=>await evaluate<boolean>('Boolean(window.ready)'),10000,'pane module');await evaluate('ready');
  expect(await evaluate<boolean>('panes.active()')).toBe(true);
  expect(await evaluate<boolean>('getComputedStyle(document.querySelector("#right")).transitionDuration==="0s"')).toBe(true);
  expect(await evaluate<boolean>(`(()=>{const edge=document.createElement('div');edge.className='file-capability-resizer';document.querySelector('#right').append(edge);const style=getComputedStyle(edge);return style.left==='2px'&&style.top==='32px'&&style.pointerEvents==='none';})()`)).toBe(true);
  expect(await evaluate<boolean>('Math.abs(calls.find(c=>c.args[0]==="pane-layout-mount").args[1].rect.width-(innerWidth*.65-8))<1')).toBe(true);
  await evaluate('legacyTeardown');
  expect(await evaluate<boolean>("host.fileCapability('pane-layout-command',{command:'snapshot'}).then(r=>r.snapshot?.presented)")).toBe(true);
  const marker='PX'+Date.now().toString(36).slice(-5);
  for(const suffix of ['A','B'])fixtures.push(spawn(fixtureExe,['--fixture',marker+suffix],{stdio:'ignore'}));
  await waitFor(async()=>await evaluate<number>(`host.windowCandidates({includeNativeIcons:false}).then(r=>{window.candidates=r;return r.candidates.filter(c=>c.title.includes(${JSON.stringify(marker)})).length;})`)===2,12000,'isolated native candidates');
  const attached=await evaluate<any>(`(async()=>{const listed=window.candidates;const ids=[];for(const c of listed.candidates.filter(c=>c.title.includes(${JSON.stringify(marker)}))){const bound=await host.bindWindowCandidate(c.id);if(bound.outcome!=='success')throw Error(JSON.stringify(bound));const result=await host.fileCapability('pane-window-attach',{bindingId:bound.capability.bindingId,groupId:'main',rect:latest.groups[0].content});if(!result.ok)throw Error(JSON.stringify(result));ids.push(result.tabId);}return ids;})()`);
  expect(attached).toHaveLength(2);
  await evalInHost(launched.app, "window.papersHost.layout.setHostOverlayActive(true,'picker')");
  await waitFor(async()=>await evaluate<boolean>("host.fileCapability('pane-layout-command',{command:'snapshot'}).then(r=>r.snapshot?.presented===false)"),5000,'host menu suspends native cut-outs');
  await evalInHost(launched.app, "window.papersHost.layout.setHostOverlayActive(false,'picker')");
  await waitFor(async()=>await evaluate<boolean>("host.fileCapability('pane-layout-command',{command:'snapshot'}).then(r=>r.snapshot?.presented===true)"),5000,'closing host menu restores native panes');
  await waitFor(async()=>await evaluate<number>('document.querySelectorAll("[data-pane-tab-id]").length')===2,10000,'two native strip tabs');
  expect(await evaluate<boolean>('Math.abs(latest.viewport.x-document.querySelector("#right").getBoundingClientRect().left)<1')).toBe(true);
  const safe=await evaluate<any>('latest');expect(safe.groups[0].tabs.every((t:any)=>!t.handle&&!t.pid&&t.windowInstanceId)).toBe(true);
  expect(safe.presented).toBe(true);
  const recoveryFiles=await fs.readdir(path.join(data,'native-helpers'));
  const actions=await Promise.all(recoveryFiles.filter(f=>f.startsWith('pane-actions-')&&f.endsWith('.jsonl')).map(f=>fs.readFile(path.join(data,'native-helpers',f),'utf8')));
  const moves=actions.flatMap(log=>log.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))).filter(action=>action.action==='SetWindowPos:NOACTIVATE|NOZORDER');
  expect(moves.length).toBeGreaterThanOrEqual(2);
  expect(moves.every(action=>JSON.stringify(action.actual)===JSON.stringify(action.requested))).toBe(true);
  await evaluate(`window.previews=[{id:'doc-one',path:${JSON.stringify(documentPath)},name:'preview.txt'}];panes.setPreviews(previews);panes.selectPreview(previews[0]);`);
  await waitFor(async()=>await evaluate<boolean>('latest.groups.some(g=>g.selected==="preview:doc-one")&&Boolean(document.querySelector(".slice-file-preview:not([hidden])"))'),12000,'selected document preview');
  await waitFor(async()=>await evaluate<boolean>(`(()=>{const pane=document.querySelector('.slice-file-preview:not([hidden])'),body=pane?.querySelector('.file-capability-body');return pane?.classList.contains('expanded')&&getComputedStyle(body).display!=='none'&&body.getBoundingClientRect().height>100&&body.textContent.includes('An isolated preview fixture.');})()`),5000,'pinned preview content is visible');
  const boxes=await evaluate<any>('latest.groups[0].slot');
  await evaluate(`dropTab('application/x-papers-native-pane-tab',JSON.stringify({id:${JSON.stringify(attached[0])},sliceId:'main'}),${boxes.x+boxes.width-20},${boxes.y+boxes.height/2});`);
  await waitFor(async()=>await evaluate<number>('latest.groups.length')===2,10000,'native tab split from actual strip drag contract');
  const after=await evaluate<any>('latest');expect(after.groups.some((g:any)=>g.selected==='preview:doc-one')).toBe(true);expect(after.groups.some((g:any)=>g.selected===attached[0])).toBe(true);
  await waitFor(async()=>await evaluate<boolean>('latest.presented===true'),5000,'drag yield restored');
  expect(await evaluate<number>(`document.querySelectorAll('.window-slice-number,.window-slice-header .native-window-lens').length`)).toBe(0);
  expect(await evaluate<number>(`document.querySelectorAll('.slice-group-handle').length`)).toBe(2);
  await evaluate(`window.dragGroup=(source,target,side)=>{const box=latest.groups.find(g=>g.id===target).slot;window.groupTransfer=new DataTransfer();const handle=document.querySelector('[data-slice-id="'+source+'"] .slice-group-handle');handle.dispatchEvent(new DragEvent('dragstart',{dataTransfer:groupTransfer,bubbles:true}));window.groupPoint={x:box.x+(side==='left'?4:side==='right'?box.width-4:box.width/2),y:box.y+(side==='top'?4:side==='bottom'?box.height-4:box.height/2)};window.groupTarget=document.querySelector('[data-slice-id="'+target+'"]');groupTarget.dispatchEvent(new DragEvent('dragover',{dataTransfer:groupTransfer,clientX:groupPoint.x,clientY:groupPoint.y,bubbles:true,cancelable:true}));};window.finishGroup=()=>groupTarget.dispatchEvent(new DragEvent('drop',{dataTransfer:groupTransfer,clientX:groupPoint.x,clientY:groupPoint.y,bubbles:true,cancelable:true}));window.otherGroup=latest.groups.find(g=>g.id!=='main').id;dragGroup('main',otherGroup,'center');`);
  expect(await evaluate<boolean>(`(()=>{const cue=document.querySelector('.window-slice-drop');const target=latest.groups.find(g=>g.id===otherGroup);return !cue.hidden&&cue.textContent==='Swap this group'&&parseFloat(cue.style.width)===target.slot.width&&parseFloat(cue.style.height)===target.slot.height;})()`)).toBe(true);
  await evaluate('finishGroup()');
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id==='main').slot.x>latest.groups.find(g=>g.id===otherGroup).slot.x&&latest.presented`),10000,'actual handle swaps whole mixed group');
  expect(await evaluate<boolean>(`latest.groups.find(g=>g.id==='main').selected==='preview:doc-one'`)).toBe(true);
  await evaluate(`dragGroup('main',otherGroup,'center');finishGroup();`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id==='main').slot.x<latest.groups.find(g=>g.id===otherGroup).slot.x&&latest.presented`),10000,'handle swap restores original positions');
  await evaluate(`dragGroup('main',otherGroup,'top');`);
  expect(await evaluate<boolean>(`(()=>{const cue=document.querySelector('.window-slice-drop'),box=latest.groups.find(g=>g.id===otherGroup).slot;return cue.classList.contains('is-group-insertion')&&parseFloat(cue.style.height)===6&&parseFloat(cue.style.width)===box.width&&parseFloat(cue.style.top)===box.y&&cue.textContent==='';})()`)).toBe(true);
  await evaluate('finishGroup()');
  await waitFor(async()=>await evaluate<boolean>(`latest.tree.axis==='y'&&latest.presented`),10000,'handle edge drop resplits entire group');
  await evaluate(`dragGroup('main',otherGroup,'left');finishGroup();`);
  await waitFor(async()=>await evaluate<boolean>(`latest.tree.axis==='x'&&latest.groups.find(g=>g.id==='main').slot.x<latest.groups.find(g=>g.id===otherGroup).slot.x&&latest.presented`),10000,'handle edge reorder returns horizontal arrangement');
  await evaluate(`document.querySelector('[data-slice-id="main"] button[aria-label="Minimize group"]').click();`);
  await waitFor(async()=>await evaluate<boolean>(`(()=>{const collapsed=latest.groups.find(g=>g.id==='main'),remaining=latest.groups.find(g=>g.id!=='main');return collapsed.presentation==='minimized'&&collapsed.slot.width===32&&remaining.slot.y===latest.viewport.y&&remaining.slot.width===latest.viewport.width-32&&document.querySelector('.slice-vertical-restore:not([hidden]) button')&&!document.querySelector('.slice-file-preview:not([hidden])');})()`),10000,'group minimize releases content space and keeps restore strip');
  await evaluate(`document.querySelector('[data-slice-id="main"] button[aria-label="Minimize group"]').click();`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id==='main').presentation==='normal'&&Boolean(document.querySelector('.slice-file-preview:not([hidden]).expanded'))`),10000,'group restore returns pinned preview');
  expect(await evaluate<any>('latest.groups.map(g=>g.slot)')).toEqual(after.groups.map((g:any)=>g.slot));
  const resize=await evaluate<any>(`(async()=>{const left=latest.groups.find(g=>g.id==='main'),other=latest.groups.find(g=>g.id!=='main');const before=other.slot.x;const result=await host.fileCapability('pane-layout-command',{command:'document-edge',groupId:'main',edge:'right',position:left.slot.width-16,revision:latest.stateRevision});return {result,before,selected:result.snapshot?.groups.find(g=>g.id==='main').selected,after:result.snapshot?.groups.find(g=>g.id!=='main').slot.x};})()`);
  expect(resize.result.ok).toBe(true);expect(resize.after).toBe(resize.before-16);expect(resize.selected).toBe('preview:doc-one');
  const second=after.groups.find((g:any)=>g.id!=='main');
  await evaluate(`(()=>{window.tabCueDrag=new DataTransfer();tabCueDrag.setData('application/x-papers-preview-tab','doc-one');document.querySelector('[data-preview-tab-id="doc-one"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:tabCueDrag,bubbles:true}));const target=document.querySelector('[data-slice-id="${second.id}"] .pane-window-tabs');target.dispatchEvent(new DragEvent('dragover',{dataTransfer:tabCueDrag,clientX:${second.slot.x+second.slot.width/2},clientY:${second.slot.y+16},bubbles:true,cancelable:true}));})()`);
  expect(await evaluate<boolean>(`document.querySelector('[data-slice-id="${second.id}"] .window-slice-header').classList.contains('is-tab-drop-target')`)).toBe(true);
  await evaluate(`document.dispatchEvent(new DragEvent('dragleave',{clientX:0,clientY:0,bubbles:true}));`);
  expect(await evaluate<number>(`document.querySelectorAll('.is-tab-drop-target').length`)).toBe(0);
  await evaluate(`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:tabCueDrag,bubbles:true}));`);
  await evaluate(`dropTab('application/x-papers-preview-tab','doc-one',${second.slot.x+second.slot.width/2},${second.slot.y+16});`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id===${JSON.stringify(second.id)}).tabs.some(t=>t.id==='preview:doc-one')`),10000,'preview transferred to native group');
  await evaluate(`(()=>{const group=document.querySelector('[data-slice-id="${second.id}"]');const doc=group.querySelector('[data-preview-tab-id="doc-one"]'),native=group.querySelector('[data-pane-tab-id]');const box=native.getBoundingClientRect();dropTab('application/x-papers-preview-tab','doc-one',box.left+4,box.top+4);})()`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id===${JSON.stringify(second.id)}).tabs[0].id==='preview:doc-one'`),10000,'preview reorder among native tabs');
  await evaluate(`document.querySelector('[data-slice-id="${second.id}"] button[aria-label="Remove window group"]').click();`);
  await waitFor(async()=>await evaluate<number>('latest.groups.length')===1,10000,'group removal merges mixed membership');
  const final=await evaluate<any>('({latest,errors,headers:document.querySelectorAll(".window-slice-header").length})');
  expect(final.latest.groups[0].tabs).toHaveLength(3);expect(final.headers).toBe(1);expect(final.errors).toEqual([]);
  // A real retained Backpack WebContentsView can join a native layout group.
  const parentSurface=await evalInHost<string>(launched.app,`papersHost.app.pages().then(p=>p[0].key)`);
  const childPage=await evalInHost<any>(launched.app,`papersHost.backpackProject.open('${childId}')`);
  const childState=()=>launched.app.evaluate(async({webContents,BaseWindow},id)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('papers-backpack://'+id+'/'));if(!w)return null;const view=BaseWindow.getAllWindows().flatMap(win=>win.contentView.children).find(v=>(v as Electron.WebContentsView).webContents?.id===w.id);return {id:w.id,marker:await w.executeJavaScript('window.marker'),bounds:view?.getBounds()??null};},childId);
  const childBefore=await childState();expect(childBefore).not.toBeNull();
  await evalInHost(launched.app,`papersHost.app.showPage(${JSON.stringify(parentSurface)})`);
  await waitFor(()=>evaluate<boolean>("host.fileCapability('pane-layout-command',{command:'snapshot'}).then(r=>r.snapshot?.presented===true)"),5000,'parent page active for hosting');
  const pageDrag=await evalInHost<Array<[string,string]>>(launched.app,`(()=>{window.pageDrag=new DataTransfer();document.querySelector('[data-tab-panel-id="${childPage.surfaceId}"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:pageDrag,bubbles:true}));return [...pageDrag.types].map(type=>[type,pageDrag.getData(type)]);})()`);
  expect(pageDrag.some(([type,value])=>type==='application/x-papers-page'&&value===childPage.surfaceId)).toBe(true);
  await evaluate(`(()=>{window.hostedPageDrag=new DataTransfer();for(const [type,value] of ${JSON.stringify(pageDrag)})hostedPageDrag.setData(type,value);const g=latest.groups[0],strip=document.querySelector('[data-slice-id="'+g.id+'"] .pane-window-tabs');strip.dispatchEvent(new DragEvent('dragover',{dataTransfer:hostedPageDrag,clientX:g.slot.x+g.slot.width/2,clientY:g.slot.y+16,bubbles:true,cancelable:true}));})()`);
  await waitFor(()=>evaluate<boolean>(`calls.some(c=>c.args[0]==='pane-page-check'&&c.reply.ok)`),5000,'Backpack page drop preflight');
  expect(await evaluate<boolean>(`Boolean(document.querySelector('.is-tab-drop-target'))`)).toBe(true);
  await evaluate(`(()=>{const g=latest.groups[0];document.querySelector('[data-slice-id="'+g.id+'"] .pane-window-tabs').dispatchEvent(new DragEvent('drop',{dataTransfer:hostedPageDrag,clientX:g.slot.x+g.slot.width/2,clientY:g.slot.y+16,bubbles:true,cancelable:true}));})()`);
  await waitFor(()=>evaluate<boolean>(`calls.some(c=>c.args[0]==='pane-page-attach'&&c.reply.ok)`),5000,'actual Backpack tab drop joins group');
  await evalInHost(launched.app,`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:pageDrag,bubbles:true}))`);
  await waitFor(()=>evaluate<boolean>(`Boolean(document.querySelector('.is-proxima-page'))`),5000,'Proxima retains blue time tab styling');
  const pageTab=await evaluate<string>(`latest.groups.flatMap(g=>g.tabs).find(t=>t.preview?.PageKey).id`);
  const hostedState=await childState();expect(hostedState?.id).toBe(childBefore?.id);expect(hostedState?.marker).toBe(childBefore?.marker);
  expect(hostedState?.bounds?.width).toBe((await evaluate<any>('latest.groups[0].content')).width);
  await evaluate(`host.fileCapability('pane-layout-command',{command:'select',groupId:latest.groups[0].id,tabId:'preview:doc-one',revision:latest.stateRevision})`);
  await waitFor(async()=>(await childState())?.bounds===null,5000,'inactive hosted page is concealed but retained');
  await evaluate(`host.fileCapability('pane-layout-command',{command:'select',groupId:latest.groups[0].id,tabId:${JSON.stringify(pageTab)},revision:latest.stateRevision})`);
  expect((await childState())?.marker).toBe(childBefore?.marker);
  const deniedSelf=await evaluate<any>(`host.fileCapability('pane-page-check',{pageId:${JSON.stringify(parentSurface)},groupId:latest.groups[0].id,side:'center'})`);expect(deniedSelf.ok).toBe(false);
  const beforePageSplit=await evaluate<any>('latest.groups[0].slot');
  await evaluate(`dropTab('application/x-papers-preview-tab',${JSON.stringify(pageTab.slice(8))},${beforePageSplit.x+beforePageSplit.width-10},${beforePageSplit.y+beforePageSplit.height/2});`);
  await waitFor(()=>evaluate<boolean>(`latest.groups.length===2&&latest.groups.some(g=>g.tabs.some(t=>t.id===${JSON.stringify(pageTab)}))`),5000,'hosted Backpack page can split like a tab');
  expect((await childState())?.marker).toBe(childBefore?.marker);
  const hostedGroup=await evaluate<string>(`latest.groups.find(g=>g.tabs.some(t=>t.id===${JSON.stringify(pageTab)})).id`);
  await evaluate(`host.fileCapability('pane-layout-command',{command:'close-group',groupId:${JSON.stringify(hostedGroup)},destination:'main',revision:latest.stateRevision})`);
  await waitFor(()=>evaluate<boolean>('latest.groups.length===1'),5000,'merge hosted Backpack split');
  const childKey=await evalInHost<string>(launched.app,`papersHost.app.pages().then(p=>p.find(p=>p.title==='Proxima page fixture').key)`);
  await evalInHost(launched.app,`papersHost.app.showPage(${JSON.stringify(childKey)})`);
  // Closing a logical page also removes its reference from an inactive parent.
  await evalInHost(launched.app,`papersHost.backpackProject.close(${JSON.stringify(childPage.surfaceId)})`);
  await waitFor(()=>evaluate<boolean>(`!latest.groups.some(g=>g.tabs.some(t=>t.id===${JSON.stringify(pageTab)}))`),5000,'explicit page close removes layout reference');
  // Exercise rendered media, not just membership or a visible path strip.
  await evaluate(`previews.push({id:'doc-pdf',path:${JSON.stringify(pdfPath)},name:'preview.pdf'},{id:'doc-image',path:${JSON.stringify(imagePath)},name:'preview.png'});panes.setPreviews(previews);panes.selectPreview(previews.find(p=>p.id==='doc-pdf'));`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok&&c.args[1].rect.width>100&&c.args[1].rect.height>100)`),12000,'pinned PDF viewer opened at usable bounds');
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')))),12000,'actual pinned PDF viewer frame');
  const pdfSession=await evaluate<string>(`calls.findLast(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok).reply.sessionId`);
  await evaluate(`host.fileCapability('pane-layout-command',{command:'split',tabId:${JSON.stringify(attached[1])},groupId:latest.groups[0].id,newGroupId:'fullscreen-test',side:'right',revision:latest.stateRevision})`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.length===2`),10000,'fullscreen neighbor created');
  await evaluate(`(async()=>{const other=latest.groups.find(g=>g.id==='fullscreen-test');window.fullscreenOther=other.id;await host.fileCapability('pane-layout-command',{command:'presentation',groupId:other.id,mode:'maximized',revision:latest.stateRevision});})()`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-move'&&c.args[1].sessionId===${JSON.stringify(pdfSession)}&&c.args[1].visible===false&&c.reply.ok)`),10000,'fullscreen suspends neighboring PDF without closing it');
  await evaluate(`host.fileCapability('pane-layout-command',{command:'presentation',groupId:fullscreenOther,mode:'normal',revision:latest.stateRevision})`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-move'&&c.args[1].sessionId===${JSON.stringify(pdfSession)}&&c.args[1].visible===true&&c.reply.ok)`),10000,'fullscreen exit restores same PDF session');
  expect(await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-close'&&c.args[1].sessionId===${JSON.stringify(pdfSession)})`)).toBe(false);
  await evaluate(`host.fileCapability('pane-layout-command',{command:'close-group',groupId:'fullscreen-test',destination:latest.groups.find(g=>g.id!=='fullscreen-test').id,revision:latest.stateRevision})`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.length===1`),10000,'temporary test group merged');
  await evaluate(`(async()=>{const r=await host.fileCapability('pane-layout-command',{command:'select',groupId:latest.groups[0].id,tabId:${JSON.stringify(attached[0])},revision:latest.stateRevision});if(!r.ok)throw Error(r.error);})()`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-move'&&c.args[1].sessionId===${JSON.stringify(pdfSession)}&&c.args[1].visible===false&&c.reply.ok)`),10000,'switching to native tab hides hosted pinned PDF');
  expect(await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-close'&&c.args[1].sessionId===${JSON.stringify(pdfSession)})`)).toBe(false);
  await evaluate(`panes.selectPreview(previews.find(p=>p.id==='doc-pdf'));`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-move'&&c.args[1].sessionId===${JSON.stringify(pdfSession)}&&c.args[1].visible===true&&c.reply.ok)`),12000,'returning to pinned PDF restores same viewer');
  expect(await evaluate<number>(`calls.filter(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok&&c.args[1].surfaceId==='tab:doc-pdf').length`)).toBe(1);
  await evaluate(`previews.push({id:'doc-pdf-two',path:${JSON.stringify(secondPdfPath)},name:'preview-two.pdf'});panes.setPreviews(previews);panes.splitPreview('doc-pdf-two','left');`);
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))).length===2),12000,'two split PDFs retain independent live viewers');
  expect(await evaluate<boolean>(`(()=>{const opened=calls.filter(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok);return new Set(opened.map(c=>c.args[1].surfaceId)).size===2;})()`)).toBe(true);
  await evaluate(`panes.selectPreview(previews.find(p=>p.id==='doc-image'));`);
  await waitFor(async()=>await evaluate<boolean>(`(()=>{const image=document.querySelector('.slice-file-preview:not([hidden]) img');return image?.complete&&image.naturalWidth>0&&image.getBoundingClientRect().width>0;})()`),10000,'pinned image decoded and rendered');
  expect(await evaluate<boolean>(`!document.querySelector('.slice-file-preview:not([hidden]) .file-capability-image-toolbar')`)).toBe(true);
  expect(await evaluate<boolean>(`(()=>{const pane=document.querySelector('.slice-file-preview:not([hidden])'),width=pane.style.width;pane.style.width='180px';const header=pane.querySelector('.file-capability-header'),path=header.querySelector('.file-capability-path'),copy=header.querySelector('[aria-label="Copy path"]'),h=header.getBoundingClientRect(),p=path.getBoundingClientRect(),c=copy.getBoundingClientRect();pane.style.width=width;return h.width<=180&&p.right<=c.left+1&&c.right<=h.right+1&&c.width>=20;})()`)).toBe(true);
  await evaluate(`(()=>{const g=latest.groups.find(g=>g.selected==='preview:doc-image'),x=g.content.x+g.content.width/2,y=g.content.y+g.content.height/2,t=new DataTransfer();pin.dispatchEvent(new DragEvent('dragstart',{dataTransfer:t,bubbles:true,cancelable:true}));const target=document.elementFromPoint(x,y);target.dispatchEvent(new DragEvent('dragover',{dataTransfer:t,clientX:x,clientY:y,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent('drop',{dataTransfer:t,clientX:x,clientY:y,bubbles:true,cancelable:true}));pin.dispatchEvent(new DragEvent('dragend',{dataTransfer:t,bubbles:true}));})()`);
  await waitFor(()=>evaluate<boolean>(`latest.groups.some(g=>g.selected==='preview:pin-drag-image')&&previews.some(p=>p.id==='pin-drag-image')`),10000,'pin drag creates persisted preview in target group');
  await evaluate(`(async()=>{const r=await host.fileCapability('pane-layout-command',{command:'document-remove',tabId:'preview:pin-drag-image',revision:latest.stateRevision});if(!r.ok)throw Error(r.error);previews=previews.filter(p=>p.id!=='pin-drag-image');panes.setPreviews(previews);panes.selectPreview(previews.find(p=>p.id==='doc-image'));})()`);
  await waitFor(()=>evaluate<boolean>(`latest.groups.some(g=>g.selected==='preview:doc-image')`),5000,'fixture returns to original preview');
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))).length===2),10000,'switching tabs retains both independent PDF viewer sessions');
  expect(await evaluate<string[]>('errors')).toEqual([]);
  if(!embedded){
    // Same Backpack, two real Papers windows: pages own independent persistent scopes.
    const firstContents=await launched.app.evaluate(({webContents},id)=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('papers-backpack://'+id+'/'))!.id,id);
    primaryContentsId=firstContents;
    const firstWindow=await launched.app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0]!.id);
    await evalInHost(launched.app,'papersHost.app.newWindow()');
    const secondWindow=await launched.app.evaluate(({BaseWindow},first)=>BaseWindow.getAllWindows().find(w=>w.id!==first&&w.getTitle()==='Papers')!.id,firstWindow);
    await launched.app.evaluate(({BaseWindow},id)=>BaseWindow.getAllWindows().find(w=>w.id===id)!.setBounds({x:2100,y:20,width:1500,height:700}),secondWindow);
    await waitFor(()=>evalInHostWindow<boolean>(launched.app,secondWindow,`Boolean(document.querySelector('.backpack-card'))`),10000,'second host');
    await evalInHostWindow(launched.app,secondWindow,`[...document.querySelectorAll('.backpack-card button')].find(b=>b.textContent==='Enter').click()`);
    const evaluateSecond=<T>(js:string)=>launched.app.evaluate(async({webContents},args)=>{
      const view=webContents.getAllWebContents().find(w=>w.id!==args.first&&w.getURL().startsWith('papers-backpack://'+args.id+'/'));
      if(!view)throw Error('Second page has not loaded');return view.executeJavaScript(args.js,true);
    },{js,first:firstContents,id}) as Promise<T>;
    await waitFor(()=>evaluateSecond<boolean>('Boolean(window.ready)'),10000,'second pane module');await evaluateSecond('ready');
    expect(await evaluateSecond<number>('latest.groups.flatMap(g=>g.tabs).length')).toBe(0);
    const claims=await evaluateSecond<any>(`host.windowCandidates({includeNativeIcons:false}).then(r=>r.candidates.filter(c=>c.title.includes(${JSON.stringify(marker)})))`);
    expect(claims).toHaveLength(2);expect(claims.every((c:any)=>c.inUse&&!c.inUse.samePage&&c.inUse.label.includes('window'))).toBe(true);
    expect((await evaluateSecond<any>(`host.fileCapability('pane-window-transfer',{transferId:'00000000000000000000000000000000',groupId:'main'})`)).ok).toBe(false);
    const before=await evaluate<any>('latest.groups.map(g=>({id:g.id,selected:g.selected,tabs:g.tabs.map(t=>t.id)}))');
    const source=await evaluate<any>(`latest.groups.find(g=>g.tabs.some(t=>t.id===${JSON.stringify(attached[0])}))`);
    await evaluateSecond(`document.querySelector('#right').style.width='400px';`);
    await waitFor(()=>evaluateSecond<boolean>('latest.viewport.width===400'),10000,'narrow transfer destination');
    const refused=await evaluateSecond<any>(`host.fileCapability('pane-window-transfer',{transferId:${JSON.stringify(source.transferId)},groupId:'main',side:'right'})`);
    expect(refused.ok).toBe(false);
    expect(await evaluate('latest.groups.map(g=>({id:g.id,selected:g.selected,tabs:g.tabs.map(t=>t.id)}))')).toEqual(before);
    expect(await evaluateSecond<number>('latest.groups.flatMap(g=>g.tabs).length')).toBe(0);
    await evaluateSecond(`document.querySelector('#right').style.width=(innerWidth*.65-8)+'px';`);
    await waitFor(()=>evaluateSecond<boolean>('latest.viewport.width>900'),10000,'room for incoming group');
    const refreshed=await evaluate<any>(`latest.groups.find(g=>g.tabs.some(t=>t.id===${JSON.stringify(attached[0])}))`);
    const payload=await evaluate<Array<[string,string]>>(`(()=>{window.crossDrag=new DataTransfer();document.querySelector('[data-slice-id="${refreshed.id}"] .slice-group-handle').dispatchEvent(new DragEvent('dragstart',{dataTransfer:crossDrag,bubbles:true}));return [...crossDrag.types].map(type=>[type,crossDrag.getData(type)]);})()`);
    await waitFor(()=>evaluateSecond<boolean>('latest.presented===false'),10000,'cross-window drag yields native destination');
    await evaluateSecond(`(()=>{const data=new DataTransfer();for(const [type,value] of ${JSON.stringify(payload)})data.setData(type,value);const target=document.querySelector('[data-slice-id="main"]'),box=latest.groups[0].slot;target.dispatchEvent(new DragEvent('dragover',{dataTransfer:data,clientX:box.x+box.width-4,clientY:box.y+80,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent('drop',{dataTransfer:data,clientX:box.x+box.width-4,clientY:box.y+80,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evaluateSecond<boolean>(`latest.groups.some(g=>g.tabs.some(t=>t.id===${JSON.stringify(attached[0])}))&&previews.some(p=>p.id==='doc-image')`),10000,'incoming mixed group rendered');
    await evaluate(`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:crossDrag,bubbles:true}))`);
    await waitFor(()=>evaluateSecond<boolean>('latest.presented===true'),10000,'drag completion restores native targets');
    expect(await evaluate<boolean>(`!latest.groups.some(g=>g.tabs.some(t=>t.id===${JSON.stringify(attached[0])}))&&!previews.some(p=>p.id==='doc-image')`)).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(data,'native-helpers','pane-transfer-journal.json'),'utf8')).status).toBe('settled');
    const incoming=await evaluateSecond<any>(`latest.groups.find(g=>g.tabs.some(t=>t.id===${JSON.stringify(attached[0])}))`);
    const destinationGroup=await evaluate<any>(`latest.groups.find(g=>g.tabs.length)`);
    const originalTrees=[await evaluate('JSON.stringify(latest.tree)'),await evaluateSecond('JSON.stringify(latest.tree)')];
    const swapPayload=await evaluateSecond<Array<[string,string]>>(`(()=>{window.swapDrag=new DataTransfer();document.querySelector('[data-slice-id="${incoming.id}"] .slice-group-handle').dispatchEvent(new DragEvent('dragstart',{dataTransfer:swapDrag,bubbles:true}));return [...swapDrag.types].map(type=>[type,swapDrag.getData(type)]);})()`);
    await waitFor(()=>evaluate<boolean>('latest.presented===false'),10000,'group swap yields source native window');
    await evaluate(`(()=>{window.incomingSwap=new DataTransfer();for(const [type,value] of ${JSON.stringify(swapPayload)})incomingSwap.setData(type,value);const g=document.querySelector('[data-slice-id="${destinationGroup.id}"]'),r=latest.groups.find(g=>g.id==='${destinationGroup.id}').slot;g.dispatchEvent(new DragEvent('dragover',{dataTransfer:incomingSwap,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evaluate<boolean>(`[...document.querySelectorAll('.window-slice-drop')].some(c=>!c.hidden&&c.textContent==='Swap this group'&&!c.classList.contains('is-rejected'))`),5000,'foreign group center shows swap cue');
    await evaluate(`(()=>{const g=document.querySelector('[data-slice-id="${destinationGroup.id}"]'),r=latest.groups.find(g=>g.id==='${destinationGroup.id}').slot;g.dispatchEvent(new DragEvent('drop',{dataTransfer:incomingSwap,clientX:r.x+r.width/2,clientY:r.y+r.height/2,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evaluate<boolean>(`latest.groups.find(g=>g.id==='${destinationGroup.id}').tabs.some(t=>t.id===${JSON.stringify(attached[0])})`),12000,'group moved into existing destination slot');
    await waitFor(()=>evaluateSecond<boolean>(`latest.groups.find(g=>g.id==='${incoming.id}').tabs.some(t=>t.id===${JSON.stringify(destinationGroup.tabs[0].id)})`),12000,'other group moved into existing source slot');
    await evaluateSecond(`document.dispatchEvent(new DragEvent('dragend',{dataTransfer:swapDrag,bubbles:true}))`);
    expect([await evaluate('JSON.stringify(latest.tree)'),await evaluateSecond('JSON.stringify(latest.tree)')]).toEqual(originalTrees);
    expect(await evaluate(`latest.groups.find(g=>g.id==='${destinationGroup.id}').tabs.map(t=>t.id)`)).toEqual(incoming.tabs.map((t:any)=>t.id));
    expect(await evaluateSecond(`latest.groups.find(g=>g.id==='${incoming.id}').tabs.map(t=>t.id)`)).toEqual(destinationGroup.tabs.map((t:any)=>t.id));
    expect(await evaluate(`latest.groups.find(g=>g.id==='${destinationGroup.id}').selected`)).toBe(incoming.selected);
    expect(await evaluateSecond(`latest.groups.find(g=>g.id==='${incoming.id}').selected`)).toBe(destinationGroup.selected);
    // Put the groups back; following retirement/reconnect checks exercise the same owner.
    const back=await evaluate<any>(`latest.groups.find(g=>g.id==='${destinationGroup.id}').transferId`);
    const reversed=await evaluateSecond<any>(`host.fileCapability('pane-window-transfer',{transferId:${JSON.stringify(back)},groupId:'${incoming.id}',side:'center'})`);
    expect(reversed.ok).toBe(true);
    await waitFor(()=>evaluateSecond<boolean>(`latest.groups.find(g=>g.id==='${incoming.id}').tabs.some(t=>t.id===${JSON.stringify(attached[0])})`),10000,'exchange round trip');
    // Lost applications keep compact recoverable membership; replacing one preserves tab identity.
    for(const fixture of fixtures)if(fixture.exitCode===null)fixture.kill();
    await waitFor(()=>evaluateSecond<boolean>(`latest.groups.flatMap(g=>g.tabs).some(t=>t.id===${JSON.stringify(attached[0])}&&t.kind==='dormant')`),12000,'closed native window becomes dormant');
    fixtures.push(spawn(fixtureExe,['--fixture',marker+'C'],{stdio:'ignore'}));
    await waitFor(()=>evaluateSecond<boolean>(`host.windowCandidates({includeNativeIcons:false}).then(r=>r.candidates.some(c=>c.title.includes(${JSON.stringify(marker+'C')})))`),10000,'replacement fixture');
    const replaced=await evaluateSecond<any>(`(async()=>{const c=(await host.windowCandidates({includeNativeIcons:false})).candidates.find(c=>c.title.includes(${JSON.stringify(marker+'C')}));const bound=await host.bindWindowCandidate(c.id);return host.fileCapability('pane-window-replace',{bindingId:bound.capability.bindingId,tabId:${JSON.stringify(attached[0])}});})()`);
    expect(replaced.ok).toBe(true);expect(replaced.snapshot.groups.flatMap((g:any)=>g.tabs).some((t:any)=>t.id===attached[0]&&t.kind==='native')).toBe(true);
    fixtures.at(-1)!.kill();await waitFor(()=>evaluateSecond<boolean>(`latest.groups.flatMap(g=>g.tabs).some(t=>t.id===${JSON.stringify(attached[0])}&&t.kind==='dormant')`),10000,'replacement retires');
    const pageKey=await evaluateSecond<string>(`new URL(location.href).searchParams.get('papers-surface-key')`);
    await launched.app.evaluate(({BaseWindow},id)=>BaseWindow.getAllWindows().find(w=>w.id===id)!.close(),secondWindow);
    await waitFor(()=>evalInHost<boolean>(launched.app,`papersHost.app.pages().then(rows=>rows.some(p=>p.key===${JSON.stringify(pageKey)}&&p.windowId===null))`),15000,'window close preserves page without preserving window');
    await launched.close();
    // Simulate reboot with lost process cache. Durable page layouts are enough.
    for(const file of await fs.readdir(path.join(data,'native-helpers')))if(/^pane-mount-.*\.json(?:\.bak)?$/.test(file))await fs.unlink(path.join(data,'native-helpers',file));
    launched=await launchPapers(profile,{fixtures:false});
    await waitFor(()=>launched.app.evaluate(({webContents},id)=>webContents.getAllWebContents().filter(w=>w.getURL().startsWith('papers-backpack://'+id+'/')).length===1,id),20000,'only unclosed Papers window restored automatically');
    const resumed=<T>(js:string)=>launched.app.evaluate(async({webContents},args)=>{const page=webContents.getAllWebContents().find(w=>w.getURL().includes('papers-surface-key='+args.key));if(!page)throw Error('Saved page missing');return page.executeJavaScript(args.js,true);},{key:pageKey,js}) as Promise<T>;
    await evalInHost(launched.app,`papersHost.app.showPage(${JSON.stringify(pageKey)})`);
    await waitFor(()=>resumed<boolean>('Boolean(window.panes?.active())'),20000,'page-scoped native checkpoint remount');
    expect(await resumed<boolean>(`latest.groups.flatMap(g=>g.tabs).some(t=>t.id===${JSON.stringify(attached[0])}&&t.kind==='dormant')&&previews.some(p=>p.id==='doc-image')`)).toBe(true);
    expect(await evalInHost<number>(launched.app,'papersHost.app.windows().then(rows=>rows.length)')).toBe(2);
    expect(await evalInHost<number>(launched.app,'papersHost.app.pages().then(rows=>rows.length)')).toBe(2);
    const intentFiles=await fs.readdir(path.join(data,'pane-layouts'));const intents=await Promise.all(intentFiles.filter(f=>f.endsWith('.json')).map(f=>fs.readFile(path.join(data,'pane-layouts',f),'utf8')));
    expect(intents.length).toBe(2);expect(intents.join('')).not.toMatch(/"(?:Handle|Pid|Started|OwnerPid|OwnerStarted|Recovery)"/);

    // Tear out and adopt the entire page through the real DOM drop route.
    const restoredWindow=(await evalInHost<any[]>(launched.app,'papersHost.app.windows()'))[0]!.windowId;
    // Pick the exact tab from Dockview's panel DOM; data is supplied by the
    // same synchronous drag hook used by physical desktop drags.
    const dragPage=await evalInHost<string>(launched.app,`(()=>{const tab=[...document.querySelectorAll('.dv-tab')].at(-1);window.pageDrag=new DataTransfer();tab.dispatchEvent(new DragEvent('dragstart',{dataTransfer:pageDrag,bubbles:true,cancelable:true}));return pageDrag.getData('application/x-papers-page');})()`);
    expect(dragPage).toBeTruthy();
    await evalInHost(launched.app,`window.dispatchEvent(new DragEvent('dragend',{dataTransfer:pageDrag,clientX:innerWidth+100,clientY:70,screenX:2100,screenY:70,bubbles:true}))`);
    await waitFor(()=>evalInHost<boolean>(launched.app,'papersHost.app.windows().then(rows=>rows.length===3)'),20000,'page drag out creates a third runtime window');
    const windows=await evalInHost<any[]>(launched.app,'papersHost.app.windows()');const recipient=windows.find(w=>w.windowId===restoredWindow)!;
    await evalInHostWindow(launched.app,recipient.windowId,`(()=>{const data=new DataTransfer();data.setData('application/x-papers-page',${JSON.stringify(dragPage)});document.querySelector('.titlebar').dispatchEvent(new DragEvent('dragover',{dataTransfer:data,bubbles:true,cancelable:true}));document.querySelector('.titlebar').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));})()`);
    await waitFor(()=>evalInHostWindow<boolean>(launched.app,recipient.windowId,'papersHost.app.pages().then(rows=>rows.filter(p=>p.current).length===1)'),20000,'page drop returns to its original window');
    await evalInHostWindow(launched.app,recipient.windowId,`papersHost.app.closePage(${JSON.stringify(pageKey)})`);
    await waitFor(()=>evalInHostWindow<boolean>(launched.app,recipient.windowId,`papersHost.app.pages().then(rows=>!rows.some(p=>p.key===${JSON.stringify(pageKey)}))`),10000,'explicit page close removes restore record');
  }
 }catch(error){console.error(await evaluate('JSON.stringify({calls:window.calls?.filter(c=>String(c.args[0]).startsWith("pane-")).map(c=>({args:c.args,ok:c.reply.ok,revision:c.reply.snapshot?.stateRevision,error:c.reply.error||c.reply.message})),errors:window.errors,panes:typeof window.panes,size:[innerWidth,innerHeight]})').catch(String));console.error(await launched.app.evaluate(async({webContents},id)=>{const v=webContents.getAllWebContents().find(w=>w.getURL().startsWith('papers-backpack://'+id+'/'));return v?{url:v.getURL(),frames:v.mainFrame.frames.map(f=>f.url),body:await v.executeJavaScript('({html:document.body.innerHTML,errors:window.shellErrors,origin:location.origin})')}:null;},topId));console.error(fixtures.map(f=>({pid:f.pid,exit:f.exitCode})));throw error;}
 finally{await launched.close();for(const fixture of fixtures)if(fixture.exitCode===null)fixture.kill();}
});
