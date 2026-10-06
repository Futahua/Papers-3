import {describe,it,expect,vi} from 'vitest';
import {runNativeFileDrag} from '../../src/main/windows/nativeFileDrag';

function fixture(revealed=true,destinationHandle:number|null=456){
 const events:string[]=[];
 const window={isDestroyed:()=>false,getNativeWindowHandle:()=>Buffer.from([1,0,0,0]),showInactive:vi.fn(()=>events.push('restore'))};
 const tracker={beginNativeDrag:vi.fn(async()=>{events.push('arm');return 7;}),endNativeDrag:vi.fn(async()=>{events.push('end');return {revealed,destinationHandle};})};
 const start=vi.fn(()=>{events.push('drag');});
 const activateDestination=vi.fn(async()=>{events.push('destination');return true;});
 const onError=vi.fn();
 return {events,window,tracker,start,activateDestination,onError};
}
describe('native file drag reveal session',()=>{
 it('arms the existing tracker, completes the drag, restores only its source, then activates the captured destination',async()=>{
  const f=fixture();await runNativeFileDrag(f);expect(f.events).toEqual(['arm','drag','end','restore','destination']);expect(f.activateDestination).toHaveBeenCalledWith(456);
 });
 it('does not change window visibility or focus for ordinary drags',async()=>{
  const f=fixture(false,null);await runNativeFileDrag(f);expect(f.events).toEqual(['arm','drag','end']);
 });
 it('restores cancellation without selecting a destination',async()=>{
  const f=fixture(true,null);await runNativeFileDrag(f);expect(f.events).toEqual(['arm','drag','end','restore']);
 });
 it('preserves ordinary file dragging when the tracker is unavailable',async()=>{
  const f=fixture();f.tracker.beginNativeDrag.mockRejectedValue(Error('unavailable'));await runNativeFileDrag(f);expect(f.start).toHaveBeenCalledOnce();expect(f.window.showInactive).not.toHaveBeenCalled();expect(f.onError).toHaveBeenCalledOnce();
 });
 it('restores its source on helper loss and permits the next session',async()=>{
  const f=fixture();f.tracker.endNativeDrag.mockRejectedValueOnce(Error('disconnected'));await runNativeFileDrag(f);expect(f.window.showInactive).toHaveBeenCalledOnce();expect(f.activateDestination).not.toHaveBeenCalled();await runNativeFileDrag(f);expect(f.start).toHaveBeenCalledTimes(2);
 });
 it('does not activate a destination if native start throws',async()=>{
  const f=fixture();f.start.mockImplementation(()=>{throw Error('native failure');});await expect(runNativeFileDrag(f)).rejects.toThrow('native failure');expect(f.tracker.endNativeDrag).toHaveBeenCalledWith(7);expect(f.window.showInactive).toHaveBeenCalledOnce();expect(f.activateDestination).not.toHaveBeenCalled();
 });
 it('does not resurrect a closed source window',async()=>{
  const f=fixture();f.start.mockImplementation(()=>{f.window.isDestroyed=()=>true;});await runNativeFileDrag(f);expect(f.window.showInactive).not.toHaveBeenCalled();
 });
});
