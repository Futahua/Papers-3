import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {launchPapers} from './helpers';
it('Move here is its own clickable control and does not select its row',async()=>{
 const source=await readFile('src/main/index.ts','utf8');
 const start=source.indexOf('const html = `<!doctype html><meta charset="utf-8"><title>Papers Window Chooser');
 const end=source.indexOf('</script>`;',start)+'</script>'.length;
 expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(start);
 const candidates=[{id:'owned',title:'Owned window',icon:null,current:false,inUse:{label:'another group',transferId:'transfer'}}];
 const html=source.slice(start+'const html = `'.length,end).replace('${encoded}',JSON.stringify(candidates)).replace('${candidates.length === 0}','false').replace('<script>','<script>window.signals=[];window.candidatePicker={signal:(action,id)=>signals.push({action,id})};');
 const launched=await launchPapers();
 try{
  await launched.app.evaluate(async({BrowserWindow},html)=>{const w=new BrowserWindow({show:false,focusable:false,x:-10000,y:-10000,webPreferences:{contextIsolation:false,sandbox:false}});(globalThis as any).movePicker=w;await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));w.showInactive();},html);
  await new Promise(resolve=>setTimeout(resolve,400));
  const result=await launched.app.evaluate(async()=>await (globalThis as any).movePicker.webContents.executeJavaScript(`(()=>{const button=document.querySelector('.row>button');const row=button.parentElement;const rect=button.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);button.click();return {signals,hit:hit===button,noDrag:getComputedStyle(button).webkitAppRegion};})()`));
  expect(result.hit).toBe(true);expect(result.noDrag).toBe('no-drag');expect(result.signals).toEqual([{action:'move',id:'owned'}]);
 }finally{await launched.app.evaluate(()=>{(globalThis as any).movePicker?.destroy();});await launched.close();}
});
