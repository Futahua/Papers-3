import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const aygRoot = process.argv[2];
if (!aygRoot) throw Error('Supply the actual AYG source checkout.');
const source = await fs.readFile(path.join(aygRoot, 'public/app/remote-file-view.js'));
const html = `<!doctype html><html><body style="margin:0;background:#2b302f;color:#ddd;font:14px sans-serif"><main style="position:relative;width:700px;height:500px"></main><script type="module">
import {createRemoteFileView} from '/view.js';
window.calls=[];window.writeAllowed=true;window.clientEditing=true;window.copies=[];window.recovery=[];
const owner={id:'fixture-owner',name:'Generated owner'};
const call=async p=>{window.calls.push(p);switch(p.operation){
case 'status':return {capabilities:{edits:window.clientEditing,editRecovery:true,editContinue:true,editImport:true},devices:[owner],jobs:[],commandJobs:[]};
case 'browse':return {online:true,entries:[{id:'fixture-file',name:'Generated document.txt',kind:'file',version:'fixture-version'}],capabilities:{edits:window.writeAllowed},nextOffset:null};
case 'edit-begin':{const copy={id:'fixture-edit',name:p.entry.name,phase:'editing'};window.copies=[copy];return copy;}
case 'edit-open':return {opened:true};
case 'edit-list':return window.copies;
case 'edit-recovery':return window.recovery;
case 'edit-recovery-open':return {opened:true};
case 'edit-continue':{const copy={id:'fixture-next-edit',name:'Generated document.txt',phase:'editing'};window.copies.push(copy);return copy;}
case 'edit-import':{const previous=window.copies.find(copy=>copy.id===p.editId);previous.importedCopyId='fixture-imported';const copy={id:'fixture-imported',name:previous.name,phase:'editing'};window.copies.push(copy);return copy;}
case 'edit-save':window.copies[0].phase='conflict';return window.copies[0];
case 'offline':return [];default:throw Error('Unexpected fixture operation '+p.operation);}};
window.view=createRemoteFileView({document,container:document.querySelector('main'),call});
await window.view.show();window.ready=true;
</script></body></html>`;
const server = createServer((request,response)=>{response.setHeader('Content-Type', request.url==='/view.js'?'text/javascript':'text/html');response.end(request.url==='/view.js'?source:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:760,height:540}});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.getByRole('button',{name:'Browse',exact:true}).click();
  await page.getByRole('button',{name:'Edit local copy',exact:true}).click();
  await page.getByText('Local edits — not saved to owner',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(p=>p.operation==='edit-open').length),1);
  await page.getByRole('button',{name:'Save back',exact:true}).click();
  await page.getByText('Owner changed — both versions retained',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save back',exact:true}).count(),0);
  await page.getByRole('button',{name:'Open local editor',exact:true}).click();
  await page.waitForFunction(()=>window.calls.filter(p=>p.operation==='edit-open').length===2);
  await page.evaluate(()=>{window.copies[0].phase='saved';window.copies[0].newerLocalEdits=true;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Earlier snapshot saved; newer local edits are not saved to owner',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue newer edits',exact:true}).click();
  await page.getByText('Local edits — not saved to owner',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.calls.some(p=>p.operation==='edit-open'&&p.editId==='fixture-next-edit')));
  await page.getByRole('button',{name:'Import edited copy',exact:true}).click();
  await page.getByText('Previous working copy retained; use the imported edited copy',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save back',exact:true}).count(),1);
  assert.ok(await page.evaluate(()=>window.calls.some(p=>p.operation==='edit-import'&&p.editId==='fixture-next-edit')));
  await page.evaluate(()=>{window.copies=[{id:'fixture-edit',name:'Generated document.txt',phase:'conflict'}];});
  await page.evaluate(()=>{window.recovery=[{id:'fixture-recovery',name:'Interrupted edit.txt',message:'Preparation was interrupted. Retained files are available for recovery.'}];});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Interrupted edit.txt',{exact:true}).waitFor();
  await page.getByText('Owner changed — both versions retained',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Open retained files',exact:true}).click();
  await page.waitForFunction(()=>window.calls.some(p=>p.operation==='edit-recovery-open'&&p.editId==='fixture-recovery'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'papers-remote-edit-view-'));
  const screenshot=path.join(output,'retained-conflict.png');await page.screenshot({path:screenshot});
  await page.getByRole('button',{name:'Offline copies',exact:true}).click();
  await page.getByText('No files kept offline yet.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.evaluate(()=>{window.writeAllowed=false;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Online',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit local copy',exact:true}).count(),0);
  await page.evaluate(()=>{window.writeAllowed=true;window.clientEditing=false;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Online',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit local copy',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Working copies',exact:true}).count(),0);
  console.log(JSON.stringify({passed:true,screenshot,checks:['prepare/open local','explicit save','retained conflict','local editor recovery','offline view switch','read-only edit controls absent','unsupported receiving client controls absent']}));
  await page.evaluate(()=>window.view.dispose());
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
