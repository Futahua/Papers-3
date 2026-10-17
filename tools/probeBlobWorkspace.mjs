import {_electron} from 'playwright-core';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {connectPapersControl,readDescriptor} from './papersControlClient.mjs';
// Hidden-window acceptance for Proxima blob folders in the synced As you Go root, using the real
// Papers host, the real Proxima page and the real embedded As you Go pane on an isolated profile.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'papers-blob-pane-'));
const data=path.join(root,'data'),documents=path.join(data,'PapersData');await fs.mkdir(documents,{recursive:true});
const ids={proxima:'bp-759cd960-26ee-4560-90b0-1ef6678802c4',ayg:'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d'},projects={},backpacks=[];
for(const [kind,source] of [['proxima','D:/Programs/CodexTemp/ProximaCrossDeviceSource'],['ayg','D:/Programs/CodexTemp/AYGCrossDeviceSource']]){
 const target=path.join(root,kind);await fs.mkdir(target);await fs.cp(path.join(source,'public'),path.join(target,'public'),{recursive:true});await fs.copyFile(path.join(source,'project.json'),path.join(target,'project.json'));projects[ids[kind]]={root:target};backpacks.push({id:ids[kind],name:kind,type:'environment',createdAt:new Date().toISOString(),lastEnteredAt:null,archived:false,workspacePath:null});
}
await fs.writeFile(path.join(documents,'backpack-projects.json'),JSON.stringify({schemaVersion:1,projects}));await fs.writeFile(path.join(documents,'registry.json'),JSON.stringify({schemaVersion:1,backpacks,lastActiveBackpackId:ids.proxima}));
const original=path.join(root,'independent-original.txt');await fs.writeFile(original,'original bytes');const descriptor=path.join(data,'control.json'),errors=[];
const app=await _electron.launch({args:[process.cwd()],env:{...process.env,PAPERS_TEST_USER_DATA:data,PAPERS_TEST_HIDDEN_WINDOWS:'1',PAPERS_ENABLE_FIXTURES:'0',PAPERS_DEV_CONTROL:'1',PAPERS_DEV_CONTROL_DESCRIPTOR:descriptor}});
app.on('window',page=>page.on('pageerror',error=>errors.push(error.message)));
const wait=async run=>{for(let i=0;i<100;i++){const result=await run();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for fixture');};
// The live pane's own saves can land between a load and a save; rebase like the pane does.
const saveRetrying=(page,edit)=>page.evaluate(async source=>{const change=eval(source);for(let attempt=0;;attempt++){const current=await ProximaWorkspaces.frameCall('ayg-root','load');const doc=structuredClone(current.state);change(doc);const saved=await ProximaWorkspaces.frameCall('ayg-root','save',[doc,current.revision]);if(saved.ok||saved.code!=='STALE_REVISION'||attempt>=5)return saved;}},edit.toString());
try{
 await wait(()=>fs.access(descriptor).then(()=>true,()=>false));const control=await connectPapersControl(await readDescriptor(descriptor));assert.equal((await control.call('workspace.open',{windowId:1,projectId:ids.proxima})).ok,true);control.close();
 const page=await wait(()=>app.context().pages().find(p=>p.url().includes('/public/index.html')));await page.waitForFunction(()=>typeof Store!=='undefined'&&typeof ProximaBlobWorkspaces!=='undefined');
 const ROOT='ayg-root',name='Disposable blob pane acceptance';
 const seeded=await page.evaluate(async name=>{await Store.command({type:'timeline-interval.create',payload:{name,start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()-60000).toISOString()}});const item=Store.timelineIntervals().find(i=>i.name===name);const result=await Store.command({type:'timeline-interval.template',ifRev:item.rev,payload:{intervalId:item.id,template:'as-you-go'}});if(!result.ok)throw Error(JSON.stringify(result));await ProximaBlobWorkspaces.open(item.id);return Store.timelineIntervals().find(i=>i.id===item.id);},name);
 const folderId=seeded.template.folderId;assert.equal(seeded.template.workspaceId,ROOT);assert.ok(folderId);
 // 1. The blob's folder exists in the synced root, named after the blob, and the pane opens inside it.
 const folder=await page.evaluate(({ROOT,folderId})=>ProximaWorkspaces.folder(ROOT,folderId),{ROOT,folderId});assert.equal(folder.exists,true);assert.equal(folder.name,name);
 const child=await wait(()=>page.frames().find(f=>f.url().includes('papers-blob-workspace=')));
 assert.ok(child.url().includes('as-you-go-folder='+folderId),child.url());
 await child.waitForFunction(()=>!!window.__papersFlushBeforeClose,{timeout:20000});
 const crumbs=()=>child.evaluate(()=>[...document.querySelectorAll('[class*="breadcrumb"],[class*="crumb"]')].map(n=>n.innerText).join(' | '));
 const openedIn=await wait(async()=>{const c=await crumbs();return c.includes(name)?c:null;}).catch(async e=>{console.log("CRUMBS",JSON.stringify(await crumbs()));console.log("NAV",JSON.stringify(await child.evaluate(()=>[...document.querySelectorAll("[class*=navigator]")].slice(0,3).map(n=>n.className+": "+n.innerText.slice(0,300)))));console.log("DOC",JSON.stringify(await page.evaluate(async ROOT=>(await ProximaWorkspaces.load(ROOT)).state.groups,ROOT)));throw e;});
 // 2. A file added in the folder becomes an independent managed copy.
 const imported=await saveRetrying(page,`doc=>doc.shortcuts.push({id:'fixture-file',name:'Independent copy',target:${JSON.stringify(original)},icon:null,placements:[{id:'fixture-placement',parentId:${JSON.stringify(folderId)},order:0}]})`);assert.equal(imported.ok,true,JSON.stringify(imported));
  await wait(()=>child.evaluate(()=>document.body.textContent.includes('Independent copy'))).catch(async e=>{console.log('OPENED',openedIn);console.log('TEXT',JSON.stringify(await child.evaluate(()=>document.body.innerText.slice(0,800))));console.log('DOC',JSON.stringify(await page.evaluate(async ROOT=>{const s=(await ProximaWorkspaces.load(ROOT)).state;return {groups:s.groups.map(g=>g.id+':'+g.name),shortcuts:s.shortcuts.map(x=>x.name+'@'+x.placements.map(p=>p.parentId))};},ROOT)));throw e;});
 const copy=await page.evaluate(async ROOT=>(await ProximaWorkspaces.load(ROOT)).state.shortcuts.find(s=>s.id==='fixture-file'),ROOT);assert.notEqual(copy.target,original);assert.equal(await fs.readFile(copy.target,'utf8'),'original bytes');await fs.writeFile(copy.target,'saved outside Papers');
 const history=await page.evaluate(async ROOT=>{await ProximaWorkspaces.reconcile();return ProximaWorkspaces.history(ROOT,'fixture-file');},ROOT);assert.equal(history.versions.length,2);assert.equal(await fs.readFile(original,'utf8'),'original bytes');
 // 3. Only killing: the trash is gone, the skull stays, and holding the skull opens the Bin.
 const tools=await child.evaluate(()=>{const visible=title=>[...document.querySelectorAll('button')].filter(b=>b.title===title).map(b=>getComputedStyle(b).display!=='none'&&!b.hidden);return {trash:visible('Delete entry · Right-click to open Bin'),skull:visible('Kill · Hold to open Bin')};});
 assert.ok(tools.skull.includes(true),JSON.stringify(tools));assert.ok(!tools.trash.includes(true),JSON.stringify(tools));
 const beforeHold=await crumbs();
 await child.evaluate(async()=>{const all=[...document.querySelectorAll('button')].filter(b=>b.title==='Kill · Hold to open Bin');const skull=all.find(b=>b.offsetParent!==null)||all[0];skull.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));await new Promise(r=>setTimeout(r,700));skull.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerType:'mouse'}));skull.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));});
 const inBin=await wait(async()=>{const c=await crumbs();return c!==beforeHold&&/\bBin\b/.test(c)?c:null;});
 const stillThere=await page.evaluate(ROOT=>ProximaWorkspaces.history(ROOT,'fixture-file').then(h=>!h.deleted),ROOT);assert.equal(stillThere,true,'holding the skull must not also kill');
 // In the kill bin, the blob view offers emptying it (that is what recycles files).
 const emptyButton=await child.evaluate(()=>{const b=document.querySelector('#delete-all-bin');return b?{inNavigator:!!b.closest('.workspace-navigator-toolbar'),title:b.title}:null;});
 assert.ok(emptyButton?.inNavigator,JSON.stringify(emptyButton));
 // 4. Killing moves the entry to the kill bin and keeps the file; restoring brings the entry back.
 assert.equal((await saveRetrying(page,`doc=>{for(const p of doc.shortcuts.find(s=>s.id==='fixture-file').placements)p.bin={parentId:${JSON.stringify(folderId)},order:0,binnedAt:new Date().toISOString()};}`)).ok,true);
 await page.evaluate(()=>ProximaWorkspaces.reconcile());
 assert.equal(await fs.readFile(copy.target,'utf8'),'saved outside Papers');assert.equal(await page.evaluate(ROOT=>ProximaWorkspaces.history(ROOT,'fixture-file').then(h=>h.deleted),ROOT),false);
 assert.equal((await saveRetrying(page,`doc=>{for(const p of doc.shortcuts.find(s=>s.id==='fixture-file').placements)delete p.bin;}`)).ok,true);
 // Emptying is refused for an entry that is not in the kill bin...
 const refused=await saveRetrying(page,`doc=>{doc.shortcuts=doc.shortcuts.filter(s=>s.id!=='fixture-file');}`).catch(error=>({ok:false,error:String(error.message||error)}));
 assert.equal(refused.ok,false,JSON.stringify(refused));assert.equal(await fs.readFile(copy.target,'utf8'),'saved outside Papers');
 // ...and emptying the kill bin recycles the file, keeping its bytes in history.
 assert.equal((await saveRetrying(page,`doc=>{for(const p of doc.shortcuts.find(s=>s.id==='fixture-file').placements)p.bin={parentId:${JSON.stringify(folderId)},order:0,binnedAt:new Date().toISOString()};}`)).ok,true);
 assert.equal((await saveRetrying(page,`doc=>{doc.shortcuts=doc.shortcuts.filter(s=>s.id!=='fixture-file');}`)).ok,true);
 await page.evaluate(()=>ProximaWorkspaces.reconcile());
 const killed=await page.evaluate(ROOT=>ProximaWorkspaces.history(ROOT,'fixture-file').then(h=>({deleted:h.deleted,versions:h.versions.length})),ROOT);
 assert.equal(killed.deleted,true);assert.equal(await fs.access(copy.target).then(()=>true,()=>false),false);
 // 5. Renaming the blob renames its folder; deleting the folder leaves the blob without a template.
 await page.evaluate(async id=>{const item=Store.timelineIntervals().find(i=>i.id===id);await Store.command({type:'timeline-interval.patch',ifRev:item.rev,payload:{intervalId:id,patch:{name:'Renamed acceptance blob'}}});},seeded.id);
 await wait(()=>page.evaluate(({ROOT,folderId})=>ProximaWorkspaces.folder(ROOT,folderId).then(f=>f.name==='Renamed acceptance blob'),{ROOT,folderId}));
 assert.equal((await page.evaluate(id=>ProximaBlobWorkspaces.button(Store.timelineIntervals().find(i=>i.id===id)),seeded.id)).propagated,true);
 // A picture set on the folder becomes the blob's button.
 const picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
 assert.equal((await saveRetrying(page,`doc=>{doc.groups.find(g=>g.id===${JSON.stringify(folderId)}).icon=${JSON.stringify(picture)};}`)).ok,true);
 await wait(()=>page.evaluate(({id,picture})=>ProximaBlobWorkspaces.button(Store.timelineIntervals().find(i=>i.id===id)).icon===picture,{id:seeded.id,picture}));
 await page.evaluate(()=>{const t=document.querySelector('.exact-timeline');ExactTimeline.mount(t,Store).configure({readOnly:false,remoteReadOnly:false});ExactTimeline.mount(t,Store).refresh();}); /* the hidden test window opens the timeline in read-only peek */
 const buttonPicture=await wait(()=>page.evaluate(id=>{const b=document.querySelector('.exact-interval[data-interval-id="'+id+'"] .exact-blob-content');return b?.classList.contains('has-picture')&&b.style.backgroundImage.includes('data:image/png')?b.style.backgroundImage.slice(0,40):null;},seeded.id)).catch(async e=>{console.log('BAR',JSON.stringify(await page.evaluate(id=>{const bars=[...document.querySelectorAll('.exact-interval')];const b=document.querySelector('.exact-interval[data-interval-id="'+id+'"]');return {bars:bars.length,ids:bars.slice(0,5).map(x=>x.dataset.intervalId),found:!!b,button:b?.querySelector('.exact-blob-content')?.outerHTML?.slice(0,300),timelines:document.querySelectorAll('.exact-timeline').length};},seeded.id)));throw e;});
 assert.equal((await saveRetrying(page,`doc=>{doc.groups.find(g=>g.id===${JSON.stringify(folderId)}).bin={parentId:'root',order:0,binnedAt:new Date().toISOString()};}`)).ok,true);
 await wait(()=>page.evaluate(id=>!ProximaBlobWorkspaces.button(Store.timelineIntervals().find(i=>i.id===id)).propagated,seeded.id));
 const renewed=await page.evaluate(async id=>{const item=Store.timelineIntervals().find(i=>i.id===id);return (await Store.command({type:'timeline-interval.template',ifRev:item.rev,payload:{intervalId:id,template:'as-you-go',renew:true}})).value.template;},seeded.id);
 assert.notEqual(renewed.folderId,folderId);assert.equal((await page.evaluate(({ROOT,folderId})=>ProximaWorkspaces.folder(ROOT,folderId),{ROOT,folderId})).binned,true);
 await page.evaluate(()=>ProximaBlobWorkspaces.flush());
 const background=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(c=>c.getURL().includes('workspace-owner.html')).length);assert.equal(background,1);
 const globalAyg=await fs.readdir(path.join(root,'ayg'));assert.ok(!globalAyg.includes('state.json'));
 console.log(JSON.stringify({ok:true,root,folderId,buttonPicture,openedIn,inBin,managedCopy:copy.target,versions:history.versions.length,killed,renewedFolder:renewed.folderId,errors},null,2));
 assert.equal(errors.length,0,JSON.stringify(errors));
}finally{await app.close();}
