import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createPapersReload,consumeReloadWindows,shouldFlushReloadSurface} from '../../src/main/windows/papersReload';
it('reload excludes cached auxiliary launchers but retains document and embedded page saves',()=>{
 expect(shouldFlushReloadSurface('papers-backpack://project/_papers-open/old/public/workspace.html?papers-surface=command-surface')).toBe(false);
 expect(shouldFlushReloadSurface('papers-backpack://project/public/workspace.html?papers-surface-key=page')).toBe(true);
 expect(shouldFlushReloadSurface('papers-backpack://project/public/embedded.html')).toBe(true);
 expect(shouldFlushReloadSurface('about:blank')).toBe(false);
});
it('reload aborts before restart when saving fails and permits retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'papers-reload-')),file=join(dir,'once.json');
 try{const flush=vi.fn().mockRejectedValueOnce(Error('save failed')).mockResolvedValue(undefined),save=vi.fn(async()=>['workspace']),restart=vi.fn();const reload=createPapersReload({file,args:['--old'],flush,save,restart});await expect(reload()).rejects.toThrow('save failed');expect(save).not.toHaveBeenCalled();expect(restart).not.toHaveBeenCalled();expect(existsSync(file)).toBe(false);await reload();expect(restart).toHaveBeenCalledOnce();}finally{rmSync(dir,{recursive:true,force:true});}
});
it('reload coalesces calls and consumes its window recipe once, while ordinary launches ignore it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'papers-reload-')),file=join(dir,'once.json');
 try{const restart=vi.fn(),reload=createPapersReload({file,args:['--papers-reload-token=old','--profile=x'],flush:async()=>{},save:async()=>['one','two'],restart});const a=reload(),b=reload();expect(a).toBe(b);await a;const value=JSON.parse(readFileSync(file,'utf8'));const saved=[{workspaceId:'one',window:{parked:true},topology:{}},{workspaceId:'two',window:{parked:true},topology:{}}] as any;
 expect(consumeReloadWindows(file,[],saved)).toBeNull();expect(existsSync(file)).toBe(true);const args=restart.mock.calls[0]![0];expect(args).toEqual(['--profile=x','--papers-reload-token='+value.token]);expect(consumeReloadWindows(file,args,saved)?.map(w=>[w.workspaceId,w.window?.parked])).toEqual([['one',false],['two',false]]);expect(consumeReloadWindows(file,args,saved)).toBeNull();}finally{rmSync(dir,{recursive:true,force:true});}
});
