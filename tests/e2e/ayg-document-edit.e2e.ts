import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {evalInBackpackProject,evalInHost,launchPapers,waitFor,type LaunchedApp} from './helpers';

const ayg=process.env['PAPERS_AYG_PROJECT'];
describe.runIf(Boolean(ayg))('full AYG document editing after graph startup',()=>{
 let app:LaunchedApp,root:string,project:string,document:string;
 const id='bp-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const state=async()=>JSON.parse(await readFile(join(project,'state.json'),'utf8'));
 beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'papers-ayg-document-'));
  const data=join(root,'PapersData'),folder=join(data,'backpacks',id);
  project=join(root,'project');document=join(root,'Dropped document.txt');
  await mkdir(folder,{recursive:true});await mkdir(project);
  await cp(join(ayg!,'public'),join(project,'public'),{recursive:true});
  const backpack={id,name:'AYG document fixture',type:'environment',createdAt:'2026-10-07T00:00:00Z',lastEnteredAt:null,archived:false,workspacePath:null};
  await writeFile(join(data,'registry.json'),JSON.stringify({schemaVersion:1,backpacks:[backpack],lastActiveBackpackId:null}));
  await writeFile(join(folder,'backpack.json'),JSON.stringify({schemaVersion:1,...backpack}));
  await writeFile(join(data,'backpack-projects.json'),JSON.stringify({schemaVersion:1,projects:{[id]:{root:project}}}));
  await writeFile(join(project,'project.json'),JSON.stringify({schemaVersion:1,backpackId:id,entry:'public/workspace-20260730b.html'}));
  await writeFile(join(project,'state.json'),JSON.stringify({schemaVersion:1,groups:[{id:'g-proof',parentId:'root',name:'Proof',order:0}],shortcuts:[],windowLayouts:[],view:{currentGroupId:'root'}}));
  await writeFile(document,'Disposable import fixture');
  app=await launchPapers(root,{fixtures:false});
  await app.app.evaluate(({app})=>{(globalThis as any).aygErrors=[];app.on('web-contents-created',(_event,contents)=>{contents.on('console-message',(_event,level,message)=>{if(level>=2)(globalThis as any).aygErrors.push(message);});});});
  await waitFor(async()=>{try{return await evalInHost<boolean>(app.app,'typeof window.papersHost?.backpacks?.enter==="function"');}catch{return false;}},20_000,'host ready');
  await evalInHost(app.app,`window.papersHost.backpacks.enter(${JSON.stringify(id)})`);
  await evalInHost(app.app,`window.papersHost.backpackProject.open(${JSON.stringify(id)})`);
  try{await waitFor(async()=>{try{return await evalInBackpackProject<boolean>(app.app,'Boolean([...document.querySelectorAll("button")].find(x=>x.title==="New folder"))');}catch{return false;}},20_000,'full navigator ready');}
  catch(error){console.error(await app.app.evaluate(()=>({errors:(globalThis as any).aygErrors})));console.error(await evalInBackpackProject(app.app,'({title:document.title,text:document.body.textContent.slice(0,500)})'));throw error;}
 });
 afterAll(async()=>{await app?.close();if(root)await rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:200});});
 it('creates a folder from the real navigator and durably imports a real File into its body',async()=>{
  await evalInBackpackProject(app.app,'[...document.querySelectorAll("button")].find(x=>x.title==="New folder").click();true');
  await waitFor(()=>evalInBackpackProject<boolean>(app.app,'Boolean(document.querySelector("[data-new-folder] input"))'),10_000,'new folder input');
  await evalInBackpackProject(app.app,'const input=document.querySelector("[data-new-folder] input");input.value="nckh";input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));true');
  await waitFor(async()=>(await state()).groups.some((group:{name:string})=>group.name==='nckh'),20_000,'folder durably saved');
  await evalInBackpackProject(app.app,'const fileInput=document.createElement("input");fileInput.type="file";fileInput.id="native-drop-fixture";document.body.append(fileInput);true');
  await app.app.evaluate(async({BaseWindow},file)=>{
   const project=(BaseWindow.getAllWindows()[0]!.contentView.children as Electron.WebContentsView[]).find(view=>view.webContents.getURL().startsWith('papers-backpack://'))!;
   const debug=project.webContents.debugger;debug.attach('1.3');
   try{const doc=await debug.sendCommand('DOM.getDocument');const input=await debug.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#native-drop-fixture'});await debug.sendCommand('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});}finally{debug.detach();}
  },document);
  await evalInBackpackProject(app.app,'const transfer=new DataTransfer();transfer.items.add(document.querySelector("#native-drop-fixture").files[0]);const body=document.querySelector(".workspace-navigator-body");body.dispatchEvent(new DragEvent("dragover",{dataTransfer:transfer,bubbles:true,cancelable:true}));body.dispatchEvent(new DragEvent("drop",{dataTransfer:transfer,bubbles:true,cancelable:true}));true');
  await waitFor(async()=>(await state()).shortcuts.some((item:{target:string})=>item.target===document),20_000,'dropped file durably imported');
  expect(await readFile(document,'utf8')).toBe('Disposable import fixture');
 });
});
