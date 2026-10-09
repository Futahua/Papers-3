using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

// One physical owner, immutable per-Backpack scope controllers. Events route to
// the HWND's actual owner; no current-slice or current-scope state is swapped.
public sealed class PaneCoordinatorHub:IDisposable {
    public readonly IntPtr Handle;
    internal readonly PanePresentation Presentation;
    readonly Mutex lease;
    readonly Native.Event callback;
    readonly List<IntPtr> hooks=new List<IntPtr>();
    readonly Dictionary<PaneCoordinator,List<Rectangle>> scopes=new Dictionary<PaneCoordinator,List<Rectangle>>();
    readonly System.Windows.Forms.Timer liveness=new System.Windows.Forms.Timer();
    bool released;
    public Action HostGeometryChanged;
    public Action<uint,IntPtr> NativeGesture;
    public PaneCoordinatorHub(IntPtr owner){
        Handle=owner;uint pid;Native.GetWindowThreadProcessId(owner,out pid);
        if(pid==0)throw new Exception("Missing physical host HWND.");
        lease=PaneCoordinator.ClaimPhysicalHost(owner,pid);
        try{
            Presentation=new PanePresentation(owner,pid);callback=Route;
            foreach(var range in new uint[][]{new uint[]{0x800B,0x800B},new uint[]{0xA,0xB},new uint[]{3,3},new uint[]{0x8001,0x8003}}){
                var hook=Native.SetWinEventHook(range[0],range[1],IntPtr.Zero,callback,0,0,0);
                if(hook==IntPtr.Zero)throw new Exception("Physical event subscription failed.");hooks.Add(hook);
            }
            liveness.Interval=350;liveness.Tick+=(s,e)=>{foreach(var scope in scopes.Keys.ToArray())try{scope.ReconcileClosed();}catch{}};liveness.Start();
        }catch{foreach(var hook in hooks)Native.UnhookWinEvent(hook);liveness.Dispose();PaneCoordinator.ReleasePhysicalHost(owner,lease);throw;}
    }
    internal void Register(PaneCoordinator scope){
        if(released)throw new Exception("Physical host released.");
        if(scopes.Keys.Any(other=>other.Scope.ScopeId==scope.Scope.ScopeId))throw new Exception("Scope already mounted.");
        scopes.Add(scope,new List<Rectangle>());
    }
    void Route(IntPtr hook,uint ev,IntPtr hwnd,int obj,int child,uint thread,uint time){
        if(released)return;
        if(hwnd==Handle&&ev==0x8001){try{Dispose();}catch{}return;}
        if(hwnd==Handle&&ev==0x800B&&obj==0&&HostGeometryChanged!=null)try{HostGeometryChanged();}catch{}
        foreach(var scope in scopes.Keys.ToArray())
            if(hwnd==Handle||scope.OwnsNativeEvent(hwnd))scope.SafeNativeEvent(hook,ev,hwnd,obj,child,thread,time);
        if((ev==0xA||ev==0xB)&&NativeGesture!=null)try{NativeGesture(ev,hwnd);}catch{}
    }
    internal void Apply(PaneCoordinator scope,List<Rectangle> frames){
        if(!scopes.ContainsKey(scope))return;scopes[scope]=frames;Compose();
    }
    void Compose(){Presentation.Apply(scopes.Values.SelectMany(frames=>frames));}
    internal void Remove(PaneCoordinator scope){scopes.Remove(scope);Compose();}
    internal void Stack(bool focus,PanePeer target){Presentation.Stack(scopes.Keys.SelectMany(scope=>scope.Visible()),focus,target);}
    public void Dispose(){
        if(released)return;released=true;var failures=new List<Exception>();liveness.Stop();liveness.Dispose();
        foreach(var hook in hooks)try{Native.UnhookWinEvent(hook);}catch(Exception error){failures.Add(error);}
        foreach(var scope in scopes.Keys.ToArray())try{scope.Release();}catch(Exception error){failures.Add(error);}
        try{Presentation.Reset();}catch(Exception error){failures.Add(error);}
        try{PaneCoordinator.ReleasePhysicalHost(Handle,lease);}catch(Exception error){failures.Add(error);}
        if(failures.Count>0)throw new AggregateException("Physical host release failed.",failures);
    }
}
