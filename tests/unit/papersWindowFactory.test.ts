import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
vi.mock('electron',()=>({
 BaseWindow:class extends EventEmitter {id=1;contentView={addChildView:vi.fn()};isDestroyed(){return false;}getContentBounds(){return {width:900,height:600};}},
 WebContentsView:class {webContents=Object.assign(new EventEmitter(),{isDestroyed:vi.fn(()=>false),close:vi.fn(),setWindowOpenHandler:vi.fn(),loadFile:vi.fn()});setBackgroundColor(){}setBounds(){}},
}));
vi.mock('../../src/main/backpacks/backpackProjectSurfaceCollection',()=>({BackpackProjectSurfaceCollection:class{fit(){}}}));
import {createPapersWindow} from '../../src/main/windows/papersWindowFactory';
it('closes its child renderer when the native BaseWindow closes',()=>{
 const owned=createPapersWindow({transparent:false,currentTransparent:()=>false,hostPreloadPath:'host',projectPreloadPath:'project',rendererFile:'fixture'});
 expect(owned.hostView.webContents.close).not.toHaveBeenCalled();
 (owned.window as unknown as EventEmitter).emit('closed');
 expect(owned.hostView.webContents.close).toHaveBeenCalledTimes(1);
});
