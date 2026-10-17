import {_electron} from 'playwright-core';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {connectPapersControl,readDescriptor} from './papersControlClient.mjs';
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
try{
 await wait(()=>fs.access(descriptor).then(()=>true,()=>false));const control=await connectPapersControl(await readDescriptor(descriptor));assert.equal((await control.call('workspace.open',{windowId:1,projectId:ids.proxima})).ok,true);control.close();
 const page=await wait(()=>app.context().pages().find(p=>p.url().includes('/public/index.html')));await page.waitForFunction(()=>typeof Store!=='undefined'&&typeof ProximaBlobWorkspaces!=='undefined');
 const seeded=await page.evaluate(async()=>{await Store.command({type:'timeline-interval.create',payload:{name:'Disposable blob pane acceptance',start:'2026-10-17T00:00:00Z',end:'2026-10-17T01:00:00Z'}});const item=Store.timelineIntervals().find(i=>i.name==='Disposable blob pane acceptance');const result=await Store.command({type:'timeline-interval.template',ifRev:item.rev,payload:{intervalId:item.id,template:'as-you-go'}});if(!result.ok)throw Error(JSON.stringify(result));await ProximaBlobWorkspaces.open(item.id);return Store.timelineIntervals().find(i=>i.id===item.id);});
 const child=await wait(()=>page.frames().find(f=>f.url().includes('papers-blob-workspace=')));
 await child.waitForFunction(()=>!!window.__papersFlushBeforeClose,{timeout:20000});
 const imported=await page.evaluate(async({workspaceId,original})=>{for(let attempt=0;;attempt++){const current=await ProximaWorkspaces.frameCall(workspaceId,'load');const saved=await ProximaWorkspaces.frameCall(workspaceId,'save',[{schemaVersion:1,groups:[],shortcuts:[{id:'fixture-file',name:'Independent copy',target:original,icon:null,placements:[{id:'fixture-placement',parentId:'root',order:0}]}],view:current.state.view},current.revision]);if(saved.ok||saved.code!=='STALE_REVISION'||attempt>=5)return saved;/* the live pane's own first save can land between load and save; rebase like the pane does */}},{workspaceId:seeded.template.workspaceId,original});assert.equal(imported.ok,true,JSON.stringify(imported));
 await wait(()=>child.evaluate(()=>document.body.textContent.includes('Independent copy')));
 const copy=await page.evaluate(async id=>(await ProximaWorkspaces.load(id)).state.shortcuts[0],seeded.template.workspaceId);assert.notEqual(copy.target,original);assert.equal(await fs.readFile(copy.target,'utf8'),'original bytes');await fs.writeFile(copy.target,'saved outside Papers');
 const history=await page.evaluate(async id=>{await ProximaWorkspaces.reconcile();return ProximaWorkspaces.history(id,'fixture-file');},seeded.template.workspaceId);assert.equal(history.versions.length,2);assert.equal(await fs.readFile(original,'utf8'),'original bytes');
 await page.evaluate(()=>ProximaBlobWorkspaces.flush());
 const background=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(c=>c.getURL().includes('workspace-owner.html')).map(c=>({url:c.getURL(),type:c.getType()})));assert.equal(background.length,1);
 const owner=await app.evaluate(async({webContents})=>{const c=webContents.getAllWebContents().find(c=>c.getURL().includes('workspace-owner.html'));return c.executeJavaScript("({ready:typeof __proximaReplaceAll==='function',workspace:typeof ProximaWorkspaces==='object'})");});assert.equal(owner.ready,true);assert.equal(owner.workspace,true);
 const globalAyg=await fs.readdir(path.join(root,'ayg'));assert.ok(!globalAyg.includes('state.json'));
 console.log(JSON.stringify({ok:true,root,template:seeded.template,childUrl:child.url(),managedCopy:copy.target,versions:history.versions.length,backgroundOwner:owner,errors},null,2));
 assert.equal(errors.length,0);
}finally{await app.close();}
