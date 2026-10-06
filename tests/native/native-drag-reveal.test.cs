using System;
using System.Reflection;
using System.Runtime.InteropServices;
class NativeDragRevealTests {
 static void Assert(bool value,string message){if(!value)throw new Exception(message);}
 static void Main(){
  var state=new NativeDragRevealState();Assert(!state.Observe(true),"ordinary drag hidden");
  state.Shift(0xA0,true);Assert(state.Observe(true)&&state.Revealed,"Shift did not reveal");
  state.Shift(0xA1,true);state.Shift(0xA0,false);Assert(state.Observe(true),"second Shift lost");
  state.Shift(0xA1,false);Assert(!state.Observe(true),"Shift release stayed hidden");
  state.Shift(0xA0,true);Assert(state.Observe(true),"repeat Shift failed");
  Assert(!state.Observe(false)&&state.Released&&state.Revealed,"mouse release not latched");
  Assert(!state.Observe(true),"finished drag resumed");
  var cancelled=new NativeDragRevealState();cancelled.Shift(0xA0,true);cancelled.Observe(true);cancelled.Cancel();Assert(!cancelled.Observe(true)&&cancelled.Cancelled,"Escape failed");
  var preheld=new NativeDragRevealState();preheld.SetPreheld(0xA0);Assert(!preheld.Shift(0xA0,true)&&!preheld.Observe(true),"preheld Shift was intercepted");Assert(!preheld.Shift(0xA0,false),"preheld release was intercepted");Assert(preheld.Shift(0xA0,true)&&preheld.Observe(true),"fresh mid-drag Shift failed");
  // Exercise the production hook directly without installing it or injecting
  // any key into the user's desktop.
  var helper=typeof(HoverInputBridge);
  var flags=BindingFlags.NonPublic|BindingFlags.Static;
  var nativeField=helper.GetField("nativeDrag",flags);
  var hooked=new NativeDragRevealState();nativeField.SetValue(null,hooked);
  var keyType=helper.GetNestedType("KBDLLHOOKSTRUCT",BindingFlags.NonPublic);
  var key=Activator.CreateInstance(keyType);
  keyType.GetField("vkCode",BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance).SetValue(key,(uint)0xA0);
  var memory=Marshal.AllocHGlobal(Marshal.SizeOf(key));
  try{
   Marshal.StructureToPtr(key,memory,false);
   var hook=helper.GetMethod("KeyboardHook",flags);
   Assert((IntPtr)hook.Invoke(null,new object[]{0,new IntPtr(0x0100),memory})==new IntPtr(1),"Shift down was not reserved");
   Assert(hooked.Observe(true),"production hook did not hold reveal");
   Assert((IntPtr)hook.Invoke(null,new object[]{0,new IntPtr(0x0101),memory})==new IntPtr(1),"Shift release was not balanced");
   Assert(!hooked.Observe(true),"production hook did not release reveal");
  }finally{Marshal.FreeHGlobal(memory);nativeField.SetValue(null,null);}
  Console.WriteLine("Native reveal state passed");
 }
}
