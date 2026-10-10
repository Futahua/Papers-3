import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {launchPapers} from './helpers';
it('exchanges real maximized Windows containers and their restore bounds',async()=>{
 const launched=await launchPapers();
 try {
  const code=ts.transpileModule(readFileSync('src/main/windows/papersWindowSwap.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const result=await launched.app.evaluate(async({BaseWindow,screen},code)=>{
   const {swapPapersWindows}=new Function('exports',code+';return exports;')({});
   const displays=screen.getAllDisplays();if(displays.length<2)throw Error('Two displays required for this Windows acceptance check');
   const create=(r:Electron.Rectangle)=>new BaseWindow({show:false,focusable:false,x:r.x+40,y:r.y+40,width:Math.min(600,r.width-80),height:Math.min(500,r.height-80)});
   const a=create(displays[0]!.workArea),b=create(displays[1]!.workArea);
   try {
    a.showInactive();b.showInactive();a.maximize();b.maximize();await new Promise(r=>setTimeout(r,300));
    const before=[a.getBounds(),b.getBounds()],normal=[a.getNormalBounds(),b.getNormalBounds()];
    const preview=await swapPapersWindows(a,b,async()=>true,false);
    const reply=await swapPapersWindows(a,b,async()=>true,true);
    return {before,normal,preview,reply,after:[a.getBounds(),b.getBounds()],restore:[a.getNormalBounds(),b.getNormalBounds()],max:[a.isMaximized(),b.isMaximized()]};
   }finally{a.destroy();b.destroy();}
  },code);
  expect(result.preview).toEqual({ok:true});expect(result.reply).toEqual({ok:true});expect(result.after).toEqual(result.before.slice().reverse());expect(result.restore).toEqual(result.normal.slice().reverse());expect(result.max).toEqual([true,true]);
 }finally{await launched.close();}
});
