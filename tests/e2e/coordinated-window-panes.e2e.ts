import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { evalInHost, launchPapers, waitFor } from './helpers';

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
 window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 window.host=createHostBridge(window);window.calls=[];const call=host.fileCapability;host.fileCapability=async(...args)=>{const reply=await call(...args);calls.push({args,reply});return reply;};const root={element:document.querySelector('#right'),replaceNativeTabs(){window.legacyTeardown=host.fileCapability('chrome-pane-visible',{visible:false});},restoreWindows(){throw Error('Unexpected legacy fallback');}};
 host.onPaneLayout(s=>window.latest=s);window.previews=[];
 root.element.style.width='300px';root.element.style.transition='width 160ms ease';
 window.panes=installCoordinatedWindowSlices({document,host,root,onStatus:e=>errors.push(e),onPreviews:tabs=>window.previews=tabs,onOuterEdge:r=>{root.element.style.left=r.x+'px';}});
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
 const launched=await launchPapers(profile,{fixtures:false});
 const evaluate=<T>(js:string)=>launched.app.evaluate(async({webContents},args)=>{
  const view=webContents.getAllWebContents().find(w=>w.getURL().startsWith('papers-backpack://'+args.topId+'/'));
  if(!view)throw Error('Project has not loaded');
  const target=args.embedded?view.mainFrame.frames.find(f=>f.url.startsWith('papers-backpack://'+args.id+'/')):view.mainFrame;
  if(!target)throw Error('Embedded project has not loaded');return target.executeJavaScript(args.js,true);
 },{js,topId,embedded,id}) as Promise<T>;
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
  await evaluate(`document.querySelector('[data-slice-id="main"] button[aria-label="Minimize group"]').click();`);
  await waitFor(async()=>await evaluate<boolean>(`(()=>{const collapsed=latest.groups.find(g=>g.id==='main'),remaining=latest.groups.find(g=>g.id!=='main');return collapsed.presentation==='minimized'&&collapsed.slot.height===32&&remaining.slot.y===latest.viewport.y+32&&remaining.slot.width===latest.viewport.width&&collapsed.slot.width<latest.viewport.width&&!document.querySelector('.slice-file-preview:not([hidden])');})()`),10000,'group minimize releases content space and keeps restore strip');
  await evaluate(`document.querySelector('[data-slice-id="main"] button[aria-label="Minimize group"]').click();`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id==='main').presentation==='normal'&&Boolean(document.querySelector('.slice-file-preview:not([hidden]).expanded'))`),10000,'group restore returns pinned preview');
  expect(await evaluate<any>('latest.groups.map(g=>g.slot)')).toEqual(after.groups.map((g:any)=>g.slot));
  const resize=await evaluate<any>(`(async()=>{const left=latest.groups.find(g=>g.id==='main'),other=latest.groups.find(g=>g.id!=='main');const before=other.slot.x;const result=await host.fileCapability('pane-layout-command',{command:'document-edge',groupId:'main',edge:'right',position:left.slot.width-16,revision:latest.stateRevision});return {result,before,selected:result.snapshot?.groups.find(g=>g.id==='main').selected,after:result.snapshot?.groups.find(g=>g.id!=='main').slot.x};})()`);
  expect(resize.result.ok).toBe(true);expect(resize.after).toBe(resize.before-16);expect(resize.selected).toBe('preview:doc-one');
  const second=after.groups.find((g:any)=>g.id!=='main');
  await evaluate(`dropTab('application/x-papers-preview-tab','doc-one',${second.slot.x+second.slot.width/2},${second.slot.y+16});`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id===${JSON.stringify(second.id)}).tabs.some(t=>t.id==='preview:doc-one')`),10000,'preview transferred to native group');
  await evaluate(`(()=>{const group=document.querySelector('[data-slice-id="${second.id}"]');const doc=group.querySelector('[data-preview-tab-id="doc-one"]'),native=group.querySelector('[data-pane-tab-id]');const box=native.getBoundingClientRect();dropTab('application/x-papers-preview-tab','doc-one',box.left+4,box.top+4);})()`);
  await waitFor(async()=>await evaluate<boolean>(`latest.groups.find(g=>g.id===${JSON.stringify(second.id)}).tabs[0].id==='preview:doc-one'`),10000,'preview reorder among native tabs');
  await evaluate(`document.querySelector('[data-slice-id="${second.id}"] button[aria-label="Remove window group"]').click();`);
  await waitFor(async()=>await evaluate<number>('latest.groups.length')===1,10000,'group removal merges mixed membership');
  const final=await evaluate<any>('({latest,errors,headers:document.querySelectorAll(".window-slice-header").length})');
  expect(final.latest.groups[0].tabs).toHaveLength(3);expect(final.headers).toBe(1);expect(final.errors).toEqual([]);
  // Exercise rendered media, not just membership or a visible path strip.
  await evaluate(`previews.push({id:'doc-pdf',path:${JSON.stringify(pdfPath)},name:'preview.pdf'},{id:'doc-image',path:${JSON.stringify(imagePath)},name:'preview.png'});panes.setPreviews(previews);panes.selectPreview(previews.find(p=>p.id==='doc-pdf'));`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok&&c.args[1].rect.width>100&&c.args[1].rect.height>100)`),12000,'pinned PDF viewer opened at usable bounds');
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')))),12000,'actual pinned PDF viewer frame');
  const pdfSession=await evaluate<string>(`calls.findLast(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok).reply.sessionId`);
  await evaluate(`(async()=>{const r=await host.fileCapability('pane-layout-command',{command:'select',groupId:latest.groups[0].id,tabId:${JSON.stringify(attached[0])},revision:latest.stateRevision});if(!r.ok)throw Error(r.error);})()`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-close'&&c.args[1].sessionId===${JSON.stringify(pdfSession)}&&c.reply.ok)`),10000,'switching to native tab closes hosted pinned PDF');
  await evaluate(`panes.selectPreview(previews.find(p=>p.id==='doc-pdf'));`);
  await waitFor(async()=>await evaluate<boolean>(`calls.some(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok&&c.reply.sessionId!==${JSON.stringify(pdfSession)})`),12000,'returning to pinned PDF reopens viewer');
  await evaluate(`previews.push({id:'doc-pdf-two',path:${JSON.stringify(secondPdfPath)},name:'preview-two.pdf'});panes.setPreviews(previews);panes.splitPreview('doc-pdf-two','left');`);
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))).length===2),12000,'two split PDFs retain independent live viewers');
  expect(await evaluate<boolean>(`(()=>{const opened=calls.filter(c=>c.args[0]==='preview-pdf-open'&&c.reply.ok);return new Set(opened.map(c=>c.args[1].surfaceId)).size===2;})()`)).toBe(true);
  await evaluate(`panes.selectPreview(previews.find(p=>p.id==='doc-image'));`);
  await waitFor(async()=>await evaluate<boolean>(`(()=>{const image=document.querySelector('.slice-file-preview:not([hidden]) img');return image?.complete&&image.naturalWidth>0&&image.getBoundingClientRect().width>0;})()`),10000,'pinned image decoded and rendered');
  await waitFor(()=>launched.app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.mainFrame.frames.some(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))).length===1),10000,'switching one split leaves neighboring PDF viewer alive');
  expect(await evaluate<string[]>('errors')).toEqual([]);
 }catch(error){console.error(await evaluate('JSON.stringify({calls:window.calls?.filter(c=>c.reply?.ok===false).map(c=>({args:c.args,error:c.reply.error||c.reply.message})),errors:window.errors,panes:typeof window.panes,size:[innerWidth,innerHeight]})').catch(String));console.error(await launched.app.evaluate(async({webContents},id)=>{const v=webContents.getAllWebContents().find(w=>w.getURL().startsWith('papers-backpack://'+id+'/'));return v?{url:v.getURL(),frames:v.mainFrame.frames.map(f=>f.url),body:await v.executeJavaScript('({html:document.body.innerHTML,errors:window.shellErrors,origin:location.origin})')}:null;},topId));console.error(fixtures.map(f=>({pid:f.pid,exit:f.exitCode})));throw error;}
 finally{await launched.close();for(const fixture of fixtures)if(fixture.exitCode===null)fixture.kill();}
});
