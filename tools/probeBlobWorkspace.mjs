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
const timedOut=new Set();app.on('window',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))console.log('CONSOLE',message.type(),message.text().slice(0,300));const m=/request timed out: (\S+)/.exec(message.text());if(m)timedOut.add(m[1]);});});
const wait=async(run,tries=100)=>{for(let i=0;i<tries;i++){const result=await run();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for fixture');};
// The live pane's own saves can land between a load and a save; rebase like the pane does.
const saveRetrying=(page,edit)=>page.evaluate(async source=>{const change=eval(source);for(let attempt=0;;attempt++){const current=await ProximaWorkspaces.frameCall('ayg-root','load');const doc=structuredClone(current.state);change(doc);const saved=await ProximaWorkspaces.frameCall('ayg-root','save',[doc,current.revision]);if(saved.ok||saved.code!=='STALE_REVISION'||attempt>=5)return saved;}},edit.toString());
try{
 await wait(()=>fs.access(descriptor).then(()=>true,()=>false));const control=await connectPapersControl(await readDescriptor(descriptor));assert.equal((await control.call('workspace.open',{windowId:1,projectId:ids.proxima})).ok,true);control.close();
 const page=await wait(()=>app.context().pages().find(p=>p.url().includes('/public/index.html')));await page.waitForFunction(()=>typeof Store!=='undefined'&&typeof ProximaBlobWorkspaces!=='undefined');
 const ROOT='ayg-root',name='Disposable blob pane acceptance';
 const seeded=await page.evaluate(async name=>{await Store.command({type:'timeline-interval.create',payload:{name,start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()-60000).toISOString()}});const item=Store.timelineIntervals().find(i=>i.name===name);const result=await Store.command({type:'timeline-interval.template',ifRev:item.rev,payload:{intervalId:item.id,template:'as-you-go'}});if(!result.ok)throw Error(JSON.stringify(result));await ProximaBlobWorkspaces.open(item.id);return Store.timelineIntervals().find(i=>i.id===item.id);},name);
 const folderId=seeded.template.folderId;assert.equal(seeded.template.workspaceId,ROOT);assert.ok(folderId);
 console.log('STEP 1');
 // 1. The blob's folder exists in the synced root, named after the blob, and the pane opens inside it.
 const folder=await page.evaluate(({ROOT,folderId})=>ProximaWorkspaces.folder(ROOT,folderId),{ROOT,folderId});assert.equal(folder.exists,true);assert.equal(folder.name,name);
 const child=await wait(()=>page.frames().find(f=>f.url().includes('papers-blob-workspace=')));
 assert.ok(child.url().includes('as-you-go-folder='+folderId),child.url());
 await child.waitForFunction(()=>!!window.__papersFlushBeforeClose,{timeout:20000});
 const crumbs=()=>child.evaluate(()=>[...document.querySelectorAll('[class*="breadcrumb"],[class*="crumb"]')].map(n=>n.innerText).join(' | '));
 const openedIn=await wait(async()=>{const c=await crumbs();return c.includes(name)?c:null;}).catch(async e=>{console.log("CRUMBS",JSON.stringify(await crumbs()));console.log("NAV",JSON.stringify(await child.evaluate(()=>[...document.querySelectorAll("[class*=navigator]")].slice(0,3).map(n=>n.className+": "+n.innerText.slice(0,300)))));console.log("DOC",JSON.stringify(await page.evaluate(async ROOT=>(await ProximaWorkspaces.load(ROOT)).state.groups,ROOT)));throw e;});
 console.log('STEP 2');
 // 2. A file added in the folder becomes an independent managed copy.
 const imported=await saveRetrying(page,`doc=>doc.shortcuts.push({id:'fixture-file',name:'Independent copy',target:${JSON.stringify(original)},icon:null,placements:[{id:'fixture-placement',parentId:${JSON.stringify(folderId)},order:0}]})`);assert.equal(imported.ok,true,JSON.stringify(imported));
  await wait(()=>child.evaluate(()=>document.body.textContent.includes('Independent copy'))).catch(async e=>{console.log('OPENED',openedIn);console.log('TEXT',JSON.stringify(await child.evaluate(()=>document.body.innerText.slice(0,800))));console.log('DOC',JSON.stringify(await page.evaluate(async ROOT=>{const s=(await ProximaWorkspaces.load(ROOT)).state;return {groups:s.groups.map(g=>g.id+':'+g.name),shortcuts:s.shortcuts.map(x=>x.name+'@'+x.placements.map(p=>p.parentId))};},ROOT)));throw e;});
 const copy=await page.evaluate(async ROOT=>(await ProximaWorkspaces.load(ROOT)).state.shortcuts.find(s=>s.id==='fixture-file'),ROOT);assert.notEqual(copy.target,original);assert.equal(await fs.readFile(copy.target,'utf8'),'original bytes');await fs.writeFile(copy.target,'saved outside Papers');
 const history=await page.evaluate(async ROOT=>{await ProximaWorkspaces.reconcile();return ProximaWorkspaces.history(ROOT,'fixture-file');},ROOT);assert.equal(history.versions.length,2);assert.equal(await fs.readFile(original,'utf8'),'original bytes');
 console.log('STEP 2b');
 // 2b. Pasting a web link with Ctrl+V saves it in the open folder. The paste event carries the text;
 // Papers refuses a separate clipboard read from inside the embedded pane.
 const link='https://onedrive.live.com/:w:/g/personal/32654c7f6b647d7a/IQB9MhHL4vKiR6lpN4t10ZrgAa-WfCj6F-2HcIsDO26V8QE?rtime=bJb_tDQc30g&redeem=aHR0cHM6Ly8xZHJ2Lm1zL3cvYy8zMjY1NGM3ZjZiNjQ3ZDdhL0lRQjlNaEhMNHZLaVI2bHBONHQxMFpyZ0FhLVdmQ2o2Ri0ySGNJc0RPMjZWOFFFP2U9N1lDR0RQJmZiY2xpZD1Jd1kyeGphd1VsVFU1bGVIUnVBMkZsYlFJeE1RQndaRzltQlhOeWRHTUdZWEJ3WDJsa0RETTFNRFk0TlRVek1UY3lPQUFCSG4tTFFKR19iZV9wMFBiZURCaGV3TC1Kci16STJhMjlUaFptWk9NN1dqRl9wdHlHODRGdUIyN2RLRUlfX2FlbV9jMDBoQkhGTXNnX3BUcmUxd0FnT1JB';
 await child.evaluate(link=>{const target=document.querySelector('.workspace-navigator-body,.workspace-navigator .workspace-navigator-row')||document.querySelector('.workspace-navigator');const data=new DataTransfer();data.setData('text/plain',link);target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},link);
 const pastedLink=await wait(()=>page.evaluate(async({ROOT,link,folderId})=>{const s=(await ProximaWorkspaces.load(ROOT)).state.shortcuts.find(x=>x.target===link);return s&&s.placements.some(p=>p.parentId===folderId)?s.name:null;},{ROOT,link,folderId}),300) /* saving fetches the page title first */.catch(async e=>{console.log('PASTE-STATUS',JSON.stringify(await child.evaluate(()=>[...document.querySelectorAll('[id*=status],[class*=status],[role=status]')].map(n=>n.textContent.trim()).filter(Boolean))));throw e;});
 console.log('STEP 3');
 // 2c. A file dragged from this computer's own Files pane (navigator items carrying its path) is
 // imported by that path; an embedded pane cannot turn dropped File objects into paths.
 const dragged=path.join(root,'dragged-from-files.txt');await fs.writeFile(dragged,'dragged bytes');
 await child.evaluate(source=>{const body=document.querySelector('.workspace-navigator-body');const data=new DataTransfer();data.setData('application/x-papers-machine-navigator-items',JSON.stringify([source]));for(const type of ['dragenter','dragover','drop'])body.dispatchEvent(new DragEvent(type,{dataTransfer:data,bubbles:true,cancelable:true}));},dragged);
 const droppedCopy=await wait(()=>page.evaluate(async({ROOT,folderId})=>{const s=(await ProximaWorkspaces.load(ROOT)).state.shortcuts.find(x=>x.name==='dragged-from-files.txt'&&x.placements.some(p=>p.parentId===folderId));return s?.workspaceFileId?s.target:null;},{ROOT,folderId}),150);
 assert.notEqual(droppedCopy,dragged);assert.equal(await fs.readFile(droppedCopy,'utf8'),'dragged bytes');
 console.log('STEP 3');
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
 console.log('STEP 4');
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
 console.log('STEP 5');
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

 async function ProximaReopen(){await page.evaluate(id=>ProximaBlobWorkspaces.open(id),seeded.id);await wait(()=>child2()?.url().includes('as-you-go-folder='));await child2().waitForFunction(()=>!!window.__papersFlushBeforeClose,{timeout:20000});await wait(()=>child2().evaluate(()=>[...document.querySelectorAll('.workspace-navigator-header button')].some(b=>b.title==='Close')));}
 function child2(){return page.frames().filter(f=>f.url().includes('papers-blob-workspace=')).at(-1);}
 await page.evaluate(()=>ProximaBlobWorkspaces.flush());
 const background=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(c=>c.getURL().includes('workspace-owner.html')).length);assert.equal(background,1);
 const globalAyg=await fs.readdir(path.join(root,'ayg'));assert.ok(!globalAyg.includes('state.json'));
 console.log(JSON.stringify({ok:true,root,folderId,pastedLink,buttonPicture,openedIn,inBin,managedCopy:copy.target,versions:history.versions.length,killed,renewedFolder:renewed.folderId,errors},null,2));
 // The pane has no header while a folder is open; the close button sits in As you Go's pill strip.
 const chrome=await page.evaluate(()=>{const pane=document.querySelector('.blob-workspace-pane');return {hasFolder:pane.classList.contains('has-folder'),header:getComputedStyle(pane.querySelector('header')).display};});
 await ProximaReopen();
 const strip=await child2().evaluate(()=>{const close=[...document.querySelectorAll('.workspace-navigator-header button')].find(b=>b.title==='Close');close?.click();return !!close;});
 const closed=await wait(()=>page.evaluate(()=>document.querySelector('.blob-workspace-pane').hidden));
 assert.equal(strip,true);assert.equal(closed,true);
 console.log('CHROME',JSON.stringify(chrome));assert.equal(chrome.header,'none');
 // 6. One As you Go page serves every blob: it shows only once rendered, and opening another blob
 // moves it to that folder instead of loading As you Go again.
 const second=await page.evaluate(async()=>{await Store.command({type:'timeline-interval.create',payload:{name:'Second acceptance blob',start:new Date(Date.now()-7200000).toISOString(),end:new Date(Date.now()-3600000).toISOString()}});const item=Store.timelineIntervals().find(i=>i.name==='Second acceptance blob');const r=await Store.command({type:'timeline-interval.template',ifRev:item.rev,payload:{intervalId:item.id,template:'as-you-go'}});await ProximaBlobWorkspaces.open(item.id);return r.value.template.folderId;});
 const framesNow=await page.evaluate(()=>document.querySelectorAll('.blob-workspace-pane iframe').length);
 const moved=await wait(async()=>{const c=await child2().evaluate(()=>[...document.querySelectorAll('[class*="crumb"]')].map(n=>n.innerText).join(' | '));return c.includes('Second acceptance blob')?c:null;});
 const visible=await page.evaluate(()=>getComputedStyle(document.querySelector('.blob-workspace-pane iframe')).visibility);
 assert.equal(framesNow,1);assert.equal(visible,'visible');console.log('REUSED',JSON.stringify({framesNow,visible,second}));
 // 7. Opening a blob while the page is still preloading another blob's folder lands in the opened
 // blob's folder (the request waits for the page instead of being lost).
 await page.reload();await page.waitForFunction(()=>typeof Store!=='undefined'&&typeof ProximaBlobWorkspaces!=='undefined');
 // Start the preload (hidden test windows throttle its idle timer) and open another blob at once.
 // As on the phone, the preloading page exists but is not ready yet when the other blob opens.
 await page.evaluate(async()=>{ProximaBlobWorkspaces.prewarm();for(let i=0;i<200&&!document.querySelector('.blob-workspace-pane iframe');i++)await new Promise(r=>setTimeout(r,10));return ProximaBlobWorkspaces.open(Store.timelineIntervals().find(i=>i.name==='Second acceptance blob').id);});
 const flashed=[];const raced=await wait(async()=>{const f=page.frames().filter(x=>x.url().includes('papers-blob-workspace=')).at(-1);if(!f)return null;const c=await f.evaluate(()=>[...document.querySelectorAll('[class*="crumb"]')].map(n=>n.innerText).join(' | ')).catch(()=>'');const shown=await page.evaluate(()=>getComputedStyle(document.querySelector('.blob-workspace-pane iframe')).visibility==='visible');if(shown&&c&&!c.includes('Second acceptance blob'))flashed.push(c.slice(0,60));return shown&&c.includes('Second acceptance blob')?c.slice(0,80):null;},300);
 console.log('RACE',JSON.stringify({raced,flashed}));assert.deepEqual(flashed,[],'the preloaded folder must never show before the opened one');
 // 8. A large folder picture is stored small in the synced records (they reach every device).
 const big=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=800;const x=c.getContext('2d'),d=x.createImageData(800,800);for(let i=0;i<d.data.length;i++)d.data[i]=Math.random()*255|0;x.putImageData(d,0,0);return c.toDataURL('image/png');});
 const secondFolder=await page.evaluate(()=>Store.timelineIntervals().find(i=>i.name==='Second acceptance blob').template.folderId);
 assert.equal((await saveRetrying(page,`doc=>{doc.groups.find(g=>g.id===${JSON.stringify(secondFolder)}).icon=${JSON.stringify(big)};}`)).ok,true);
 const stored=await page.evaluate(async id=>{const f=await ProximaWorkspaces.folder('ayg-root',id);return typeof f.icon==='string'?f.icon.length:JSON.stringify(f.icon).length;},secondFolder);
 console.log('PICTURE',JSON.stringify({original:big.length,stored}));assert.ok(stored<60000&&big.length>500000); // random noise is the worst case; real photos at 128 px are a few KB
 console.log('TIMED-OUT',JSON.stringify([...timedOut]));assert.deepEqual([...timedOut],[],'no blob-pane host request may hang until its timeout');
 assert.equal(errors.length,0,JSON.stringify(errors));
}finally{await app.close();}
