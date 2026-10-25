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

 // A real PDF, as the creator previews most.
 const pdfPath=path.join(root,'sample.pdf');
 const NL=String.fromCharCode(10);
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream='BT /F1 24 Tf 40 100 Td (PDF preview works) Tj ET';objs[3]='<< /Length '+stream.length+' >>'+NL+'stream'+NL+stream+NL+'endstream';
 let pdf='%PDF-1.4'+NL;const offs=[];objs.forEach((o,i)=>{offs.push(pdf.length);pdf+=(i+1)+' 0 obj'+NL+o+NL+'endobj'+NL;});const xref=pdf.length;
 pdf+='xref'+NL+'0 '+(objs.length+1)+NL+'0000000000 65535 f '+NL+offs.map(o=>String(o).padStart(10,'0')+' 00000 n '+NL).join('')+'trailer'+NL+'<< /Size '+(objs.length+1)+' /Root 1 0 R >>'+NL+'startxref'+NL+xref+NL+'%%EOF'+NL;
 await fs.writeFile(pdfPath,pdf,'latin1');
 assert.equal((await saveRetrying(page,`doc=>doc.shortcuts.push({id:'fixture-pdf',name:'sample.pdf',target:${JSON.stringify(pdfPath)},icon:null,placements:[{id:'fixture-pdf-placement',parentId:${JSON.stringify(folderId)},order:1}]})`)).ok,true);
 await wait(()=>child.evaluate(()=>document.body.textContent.includes('sample.pdf')));
 await child.evaluate(()=>{const label=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='sample.pdf');label?.click();});
 await new Promise(r=>setTimeout(r,5000));
 await page.screenshot({path:(process.env.SHOT||'blob-preview.png').replace('.png','-pdf.png')});
 console.log('PDF',JSON.stringify(await child.evaluate(()=>({frame:!!document.querySelector('.workspace-follow-preview iframe,.workspace-follow-preview embed'),kind:document.querySelector('.workspace-follow-preview')?.innerText.slice(0,120)}))));
 // A picture.
 const pngPath=path.join(root,'pic.png');await fs.writeFile(pngPath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC','base64'));
 assert.equal((await saveRetrying(page,`doc=>doc.shortcuts.push({id:'fixture-png',name:'pic.png',target:${JSON.stringify(pngPath)},icon:null,placements:[{id:'fixture-png-placement',parentId:${JSON.stringify(folderId)},order:2}]})`)).ok,true);
 await wait(()=>child.evaluate(()=>document.body.textContent.includes('pic.png')));
 await child.evaluate(()=>{const label=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='pic.png');label?.click();});
 await new Promise(r=>setTimeout(r,4000));
 console.log('PNG',JSON.stringify(await child.evaluate(()=>{const img=document.querySelector('.workspace-follow-preview img');return {img:!!img,src:img?.src.slice(0,60),loaded:img?.naturalWidth};})));
 // Preview look: select the copied file and capture the pane.
 await child.evaluate(()=>{const label=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='Independent copy');label?.click();});
 await new Promise(r=>setTimeout(r,4000));
 await page.setViewportSize?.({width:1400,height:900}).catch(()=>{});
 await page.screenshot({path:process.env.SHOT||'blob-preview.png'});
 const info=await child.evaluate(()=>{const q=s=>document.querySelector(s);const d=e=>e?{cls:e.className,hidden:e.hidden,display:getComputedStyle(e).display,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}:null;return {controls:d(q('.workspace-pane-controls')),preview:d(q('.workspace-follow-preview')),right:d(q('.workspace-window-pane')),twoPane:document.documentElement.className,buttons:[...document.querySelectorAll('.workspace-pane-controls button')].map(b=>b.textContent+':'+b.className),empty:[...document.querySelectorAll('.file-capability-empty')].map(e=>e.textContent),url:location.search.slice(0,200)};});
 console.log('INFO',JSON.stringify(info));
}finally{await app.close();}
