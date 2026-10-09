using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

// One serialized compositor per physical host, shared by independent Backpack workers.
public static class PaneHostRegion {
 public sealed class Frame {public int X,Y,W,H;}
 public sealed class Client {public int Pid;public long Started;public List<Frame> Frames=new List<Frame>();}
 public sealed class State {public SavedShape Original;public long OwnerStarted;public Dictionary<string,Client> Clients=new Dictionary<string,Client>();public string Applied;}
 [DllImport("gdi32.dll")]static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")]static extern int CombineRgn(IntPtr a,IntPtr b,IntPtr c,int mode);
 [DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr h);
 [DllImport("gdi32.dll")]static extern uint GetRegionData(IntPtr h,uint size,[Out]byte[] bytes);
 [DllImport("gdi32.dll")]static extern IntPtr ExtCreateRegion(IntPtr transform,uint size,byte[] bytes);
 [DllImport("user32.dll")]static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("user32.dll")]static extern int SetWindowRgn(IntPtr h,IntPtr r,bool repaint);
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static string FileName(SavedShape saved){return Path.Combine(Path.GetTempPath(),"papers-host-region-"+saved.Pid+"-"+saved.Handle+".json");}
 static long Started(int pid){try{using(var p=Process.GetProcessById(pid))return p.StartTime.ToUniversalTime().Ticks;}catch{return 0;}}
 static bool Valid(SavedShape saved){uint pid;Native.GetWindowThreadProcessId(new IntPtr(saved.Handle),out pid);return pid==saved.Pid;}
 static T Locked<T>(SavedShape saved,Func<State,T> action){using(var mutex=new Mutex(false,"Local\\PapersHostRegion-"+saved.Pid+"-"+saved.Handle)){bool acquired=false;try{try{acquired=mutex.WaitOne(3000);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new Exception("Host region compositor is busy.");State state=null;try{state=Json.Deserialize<State>(File.ReadAllText(FileName(saved)));}catch{}var ownerStarted=Started((int)saved.Pid);if(state==null||state.OwnerStarted!=ownerStarted){state=new State{Original=Capture(saved),OwnerStarted=ownerStarted};}foreach(var key in state.Clients.Where(p=>Started(p.Value.Pid)!=p.Value.Started).Select(p=>p.Key).ToArray())state.Clients.Remove(key);var result=action(state);var file=FileName(saved);var temp=file+"."+Process.GetCurrentProcess().Id+".tmp";File.WriteAllText(temp,Json.Serialize(state));if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);return result;}finally{if(acquired)mutex.ReleaseMutex();}}}
 static SavedShape Capture(SavedShape saved){var result=new SavedShape{Handle=saved.Handle,Pid=saved.Pid};var region=CreateRectRgn(0,0,0,0);try{if(GetWindowRgn(new IntPtr(saved.Handle),region)!=0){uint n=GetRegionData(region,0,null);result.Data=new byte[n];GetRegionData(region,n,result.Data);}}finally{DeleteObject(region);}return result;}
 public static SavedShape Register(IntPtr owner,uint pid){var saved=new SavedShape{Handle=owner.ToInt64(),Pid=pid,ClientPid=Process.GetCurrentProcess().Id};return Locked(saved,state=>new SavedShape{Handle=saved.Handle,Pid=pid,ClientPid=saved.ClientPid,Data=state.Original.Data});}
 public static void Present(SavedShape saved,Rectangle[] frames){if(!Valid(saved))return;Locked(saved,state=>{var key=saved.ClientPid.ToString();if(frames==null||frames.Length==0)state.Clients.Remove(key);else state.Clients[key]=new Client{Pid=saved.ClientPid,Started=Started(saved.ClientPid),Frames=frames.Select(r=>new Frame{X=r.X,Y=r.Y,W=r.Width,H=r.Height}).ToList()};Apply(state);return true;});}
 static void Apply(State state){var saved=state.Original;if(!Valid(saved))return;Native.Rect bounds;if(!Native.GetWindowRect(new IntPtr(saved.Handle),out bounds))return;var frames=state.Clients.OrderBy(p=>p.Key).SelectMany(p=>p.Value.Frames).ToArray();var signature=bounds.Box.ToString()+"|"+Json.Serialize(frames);if(state.Applied==signature)return;IntPtr original=saved.Data==null?IntPtr.Zero:ExtCreateRegion(IntPtr.Zero,(uint)saved.Data.Length,saved.Data);IntPtr region=CreateRectRgn(0,0,bounds.R-bounds.L,bounds.B-bounds.T);try{if(original!=IntPtr.Zero)CombineRgn(region,region,original,1);foreach(var f in frames){var rect=new Rectangle(f.X,f.Y,f.W,f.H);rect.Intersect(bounds.Box);rect.Offset(-bounds.L,-bounds.T);var hole=CreateRectRgn(rect.Left,rect.Top,rect.Right,rect.Bottom);try{CombineRgn(region,region,hole,4);}finally{DeleteObject(hole);}}if(SetWindowRgn(new IntPtr(saved.Handle),region,true)==0)throw new Exception("Cannot compose native window regions.");region=IntPtr.Zero;state.Applied=signature;}finally{if(original!=IntPtr.Zero)DeleteObject(original);if(region!=IntPtr.Zero)DeleteObject(region);}}
}
