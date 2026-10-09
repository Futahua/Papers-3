using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class PaneRecoveryPeer { public SavedWindow Window; public long Started; }
public sealed class PaneRecovery { public int HostPid; public long Started; public string Generation; public PaneRegionSaved Region; public List<PaneRecoveryPeer> Peers=new List<PaneRecoveryPeer>(); }

// One coordinator / one UI thread / one set of WinEvents per physical HWND.
public sealed partial class PaneCoordinator : IDisposable {
    const uint Start=0xA,End=0xB,Location=0x800B,Foreground=3,Destroy=0x8001,Show=0x8002,Hide=0x8003;
    [StructLayout(LayoutKind.Sequential)] struct MinMaxInfo {
        public Native.Point Reserved,MaxSize,MaxPosition,MinTrackSize,MaxTrackSize;
    }
    [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)]
    static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr wp,ref MinMaxInfo info,uint flags,uint timeout,out IntPtr result);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    public static Size NativeMinimum(IntPtr hwnd){
        var info=new MinMaxInfo();IntPtr result;
        if(SendMessageTimeout(hwnd,0x24,IntPtr.Zero,ref info,2,250,out result)==IntPtr.Zero)
            return new Size(PaneLayout.DefaultMinWidth,PaneLayout.DefaultMinHeight);
        return new Size(Math.Max(PaneLayout.DefaultMinWidth,info.MinTrackSize.X),Math.Max(PaneLayout.DefaultMinHeight,info.MinTrackSize.Y));
    }
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    static readonly HashSet<long> ProcessHosts=new HashSet<long>(),ProcessPeers=new HashSet<long>();
    readonly string recoveryGeneration=Guid.NewGuid().ToString("N");
    readonly IntPtr host;
    readonly Mutex hostLease;
    readonly Dictionary<IntPtr,PanePeer> hwndIndex=new Dictionary<IntPtr,PanePeer>();
    readonly Dictionary<string,PanePeer> tabIndex=new Dictionary<string,PanePeer>();
    readonly PanePresentation presentation;
    readonly PaneCoordinatorHub hub;
    readonly Native.Event callback;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly string recoveryFile, logFile;
    readonly Action<object> publish;
    IntPtr geometryHook,moveHook,focusHook,destroyHook,popupHook;
    readonly System.Windows.Forms.Timer liveness=new System.Windows.Forms.Timer();
    // Experimental failure-injection seam: one post-registration error must roll back the peer.
    public bool RejectNextAttachAfterPlacement;
    bool stopped,guardStarted,hostSuspended;
    int? authoredLeftOffset;
    readonly Dictionary<IntPtr,PanePeer> popupOwners=new Dictionary<IntPtr,PanePeer>();
    long moveGeneration,gestureGeneration;
    public readonly PaneScope Scope;
    public SavedShape HostRegionForHarness {get{return presentation.Saved.Shared;}}
    public long PlacementGeneration {get{return moveGeneration;}}
    public bool Released { get { return stopped; } }
    public PaneCoordinator(IntPtr owner,string recovery,string log,Action<object> onSnapshot,int headerHeight=0,PaneCoordinatorHub physical=null,string scopeId="harness",bool singleGroup=false) {
        host=owner;recoveryFile=recovery;logFile=log;publish=onSnapshot;hub=physical;
        uint pid;Native.GetWindowThreadProcessId(owner,out pid);
        if(pid==0)throw new Exception("Missing real host HWND.");
        if(hub==null)hostLease=ClaimPhysicalHost(owner,pid);
        else if(hub.Handle!=owner)throw new Exception("Scope cannot change its physical host.");
        try{
            presentation=hub==null?new PanePresentation(owner,pid):hub.Presentation;
            Scope=new PaneScope(scopeId,headerHeight);Scope.Add(singleGroup?"main":"A");if(!singleGroup)Scope.Add("B");
            if(hub!=null){hub.Register(this);Log("start",null,null,null,"shared physical event router");return;}
            callback=SafeNativeEvent;
            geometryHook=Native.SetWinEventHook(Location,Location,IntPtr.Zero,callback,0,0,0);
            moveHook=Native.SetWinEventHook(Start,End,IntPtr.Zero,callback,0,0,0);
            focusHook=Native.SetWinEventHook(Foreground,Foreground,IntPtr.Zero,callback,0,0,0);
            destroyHook=Native.SetWinEventHook(Destroy,Destroy,IntPtr.Zero,callback,0,0,0);
            popupHook=Native.SetWinEventHook(Show,Hide,IntPtr.Zero,callback,0,0,0);
            if(geometryHook==IntPtr.Zero||moveHook==IntPtr.Zero||focusHook==IntPtr.Zero||destroyHook==IntPtr.Zero||popupHook==IntPtr.Zero)throw new Exception("WinEvent subscription failed.");
            liveness.Interval=350;
            liveness.Tick+=(s,e)=>{try{ReconcileClosed();}catch(Exception error){Log("liveness-error",null,null,null,error.Message);}};
            liveness.Start();Log("start",null,null,null,"hooks");
        }catch{
            foreach(var hook in new[]{geometryHook,moveHook,focusHook,destroyHook,popupHook})
                if(hook!=IntPtr.Zero)Native.UnhookWinEvent(hook);
            liveness.Dispose();if(hostLease!=null)ReleasePhysicalHost(host,hostLease);throw;
        }
    }
    internal static Mutex ClaimPhysicalHost(IntPtr owner,uint pid){
        lock(ProcessHosts)if(!ProcessHosts.Add(owner.ToInt64()))throw new Exception("Physical host already has a native coordinator in this process.");
        Mutex lease=null;
        try{lease=new Mutex(false,"Local\\NativePaneCoordinator-"+pid+"-"+owner.ToInt64());
            bool acquired=false;try{acquired=lease.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
            if(!acquired)throw new Exception("Physical host already has a native coordinator.");return lease;
        }catch{if(lease!=null)lease.Dispose();lock(ProcessHosts)ProcessHosts.Remove(owner.ToInt64());throw;}
    }
    internal static void ReleasePhysicalHost(IntPtr owner,Mutex lease){
        try{lease.ReleaseMutex();}finally{lease.Dispose();lock(ProcessHosts)ProcessHosts.Remove(owner.ToInt64());}
    }
    internal bool OwnsNativeEvent(IntPtr hwnd){
        if(hwndIndex.ContainsKey(hwnd)||popupOwners.ContainsKey(hwnd))return true;
        var seen=new HashSet<IntPtr>();var next=Native.GetWindow(hwnd,4);
        while(next!=IntPtr.Zero&&seen.Add(next)){if(hwndIndex.ContainsKey(next))return true;next=Native.GetWindow(next,4);}return false;
    }
    void Stack(bool focus,PanePeer target){if(hub==null)presentation.Stack(Visible(),focus,target);else hub.Stack(focus,target);}
    public object Snapshot() {return new {scopeId=Scope.ScopeId,bindingGeneration=Scope.BindingGeneration,
        stateRevision=Scope.StateRevision,geometryRevision=Scope.GeometryRevision,
        topology=Scope.Root,ratio=Scope.Ratio,
        groups=Scope.Order.Select(id=>Scope.Groups[id]).Select(g=>new{id=g.Id,orderedTabRefs=g.OrderedTabs.ToArray(),
        selectedTabRef=g.SelectedTab,resolvedFrame=g.ResolvedFrame,slotFrame=PaneLayout.Slot(Scope,g),presentation=g.Presentation}).ToArray(),
        resolvedFrames=Scope.Order.Select(id=>Scope.Groups[id].ResolvedFrame).ToArray()};}
    public PanePeer Find(string id) {PanePeer p;if(!tabIndex.TryGetValue(id,out p))throw new Exception("Unknown tab.");return p;}
    public PaneGroup Group(string id){PaneGroup g;if(!Scope.Groups.TryGetValue(id,out g))throw new Exception("Unknown group.");return g;}
    PanePeer Selected(PaneGroup g){PanePeer p;return g.SelectedTab!=null&&tabIndex.TryGetValue(g.SelectedTab,out p)?p:null;}
    internal IEnumerable<PanePeer> Visible(){
        if(!Scope.Presented||hostSuspended)return Enumerable.Empty<PanePeer>();
        var maximized=Scope.Order.FirstOrDefault(id=>Group(id).Presentation=="maximized");
        return Scope.Order.Where(id=>maximized==null||id==maximized).Select(id=>Group(id))
            .Where(g=>g.Presentation!="minimized").Select(Selected).Where(p=>p!=null&&p.Session.Valid());
    }
    void Notify(string cause){Log(cause,null,null,null,"snapshot");if(publish!=null)try{publish(Snapshot());}catch(Exception error){Log("snapshot-publish-error",null,null,null,error.Message);}}
    void Log(string cause,PanePeer p,Rectangle? request,Rectangle? actual,string action){
        if(string.IsNullOrEmpty(logFile))return;
        var data=new {at=DateTime.UtcNow.ToString("o"),cause,group=p==null?null:p.GroupId,tab=p==null?null:p.TabId,
            hwnd=p==null?0:p.Session.Handle.ToInt64(),requested=request,actual,action,
            stateRevision=Scope.StateRevision,geometryRevision=Scope.GeometryRevision,moveGeneration};
        try{File.AppendAllText(logFile,json.Serialize(data)+Environment.NewLine);}catch{}
    }
    static long Started(uint pid){try{using(var p=Process.GetProcessById((int)pid))return p.StartTime.ToUniversalTime().Ticks;}catch{return 0;}}
    void RecoverWrite(){
        var data=new PaneRecovery{Generation=recoveryGeneration,HostPid=Process.GetCurrentProcess().Id,Started=Started((uint)Process.GetCurrentProcess().Id),Region=presentation.Saved};
        foreach(var p in tabIndex.Values)data.Peers.Add(new PaneRecoveryPeer{Window=p.Session.Saved,Started=Started(p.Session.Saved.Pid)});
        Directory.CreateDirectory(Path.GetDirectoryName(recoveryFile));
        WriteDurableJson(recoveryFile,json.Serialize(data));
        if(!guardStarted) {
            guardStarted=true;
            try{Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--guard \""+recoveryFile+"\""){UseShellExecute=false,CreateNoWindow=true});}
            catch{guardStarted=false;throw;}
        }
    }
    public static void WriteDurableJson(string filename,string value){
        var temp=filename+".tmp";var bytes=new System.Text.UTF8Encoding(false).GetBytes(value);
        using(var file=new FileStream(temp,FileMode.Create,FileAccess.Write,FileShare.None)){file.Write(bytes,0,bytes.Length);file.Flush(true);}
        if(File.Exists(filename))File.Replace(temp,filename,filename+".backup");else File.Move(temp,filename);
    }
    public static void Guard(string filename) {
        var ser=new JavaScriptSerializer();PaneRecovery data;
        try{data=ser.Deserialize<PaneRecovery>(File.ReadAllText(filename));}catch{return;}
        try{using(var p=Process.GetProcessById(data.HostPid))if(p.StartTime.ToUniversalTime().Ticks==data.Started)p.WaitForExit();}catch{}
        using(var recoveryLease=new Mutex(false,"Local\\NativePaneRecovery-"+data.Generation)){
        bool recoveryHeld=false;
        try{try{recoveryHeld=recoveryLease.WaitOne(10000);}catch(AbandonedMutexException){recoveryHeld=true;}
        if(!recoveryHeld)return;
        if(ReleasedMarker(filename,data.Generation))return;
        if(File.Exists(filename+".recovered"))return;
        try{data=ser.Deserialize<PaneRecovery>(File.ReadAllText(filename));}catch{return;}
        var failures=new List<string>();
        foreach(var peer in data.Peers)if(Started(peer.Window.Pid)==peer.Started){
            using(var lease=new Mutex(false,"Local\\ChromePaneExperiment-"+peer.Window.Handle)){
                bool held=false;
                try{try{held=lease.WaitOne(0);}catch(AbandonedMutexException){held=true;}
                    if(!held)throw new Exception("Native window belongs to another live pane; recovery deferred.");
                    RestoreSavedWindow(peer.Window);
                }catch(Exception error){failures.Add(error.Message);}
                finally{if(held)try{lease.ReleaseMutex();}catch{}}
            }
        }
        try{PanePresentation.Restore(data.Region);}catch(Exception error){failures.Add(error.Message);}
        try{File.WriteAllText(filename+(failures.Count==0?".recovered":".failed"),
            failures.Count==0?DateTime.UtcNow.ToString("o"):string.Join(Environment.NewLine,failures));}catch{}
        }finally{if(recoveryHeld)try{recoveryLease.ReleaseMutex();}catch{}}
        }
    }
    static bool ReleasedMarker(string recovery,string generation){
        try{return File.Exists(recovery+".released")&&(generation==null||File.ReadAllText(recovery+".released").Trim()==generation);}catch{return false;}
    }
    static void ForgetLease(PanePeer peer){lock(ProcessPeers)ProcessPeers.Remove(peer.Session.Handle.ToInt64());}
    int Minimum(PaneGroup group) {
        var peer=Selected(group);
        if(peer==null)return PaneLayout.DefaultMinWidth;
        return Math.Max(PaneLayout.DefaultMinWidth,peer.FixedSize?
            Math.Max(peer.MinTrackWidth,peer.Session.Saved.Placement.Normal.R-peer.Session.Saved.Placement.Normal.L):peer.MinTrackWidth);
    }
    Size MinimumSize(PaneGroup group){
        var peer=Selected(group);
        int height=peer==null?PaneLayout.DefaultMinHeight:Math.Max(PaneLayout.DefaultMinHeight,peer.MinTrackHeight);
        return new Size(Minimum(group),height);
    }
    bool WidenForSelection(){
        var minimum=PaneLayout.PresentationMinimum(Scope,MinimumSize);
        Native.Rect owner;
        if(minimum.Height>Scope.Viewport.Height||minimum.Width<=Scope.Viewport.Width||
           !Native.GetWindowRect(host,out owner)||Scope.Viewport.Right-minimum.Width<owner.L)return false;
        Scope.Viewport=Rectangle.FromLTRB(Scope.Viewport.Right-minimum.Width,Scope.Viewport.Top,Scope.Viewport.Right,Scope.Viewport.Bottom);
        PaneLayout.PreserveScopeBoundaries(Scope,Scope.Viewport);
        if(!PaneLayout.Resolve(Scope,MinimumSize))return false;
        authoredLeftOffset=Scope.Viewport.Left-owner.L;Scope.NativeEdgeRevision++;return true;
    }
    // Roll back a composition command as one unit, including actual HWND placement.
    void Change(string cause,Action action,bool expandForSelection=false){
        if(Scope.Groups.Values.Any(g=>g.Gesture!=null))throw new Exception("Finish native resize before changing composition.");
        PaneLayout.Ensure(Scope);var root=Scope.Root==null?null:Scope.Root.Copy();
        var order=Scope.Order.ToArray();var groups=Scope.Groups.ToDictionary(p=>p.Key,p=>p.Value);
        var tabs=groups.ToDictionary(p=>p.Key,p=>p.Value.OrderedTabs.ToArray());
        var selected=groups.ToDictionary(p=>p.Key,p=>p.Value.SelectedTab);
        var modes=groups.ToDictionary(p=>p.Key,p=>p.Value.Presentation);
        var frames=groups.ToDictionary(p=>p.Key,p=>p.Value.ResolvedFrame);
        var ownership=tabIndex.Values.ToDictionary(p=>p.TabId,p=>p.GroupId);
        var docs=new Dictionary<string,string>(documentGroups);
        var dormant=new Dictionary<string,PaneMountPeer>(dormantPeers);
        var references=new Dictionary<string,PaneDocumentRef>(documentReferences);
        var actual=tabIndex.Values.Where(p=>p.Session.Valid()).Select(p=>new WindowSession(p.Session.Handle.ToInt64(),p.Session.Saved.Pid).Saved).ToArray();
        long state=Scope.StateRevision,geometry=Scope.GeometryRevision;double ratio=Scope.Ratio;bool shown=Scope.Presented;
        bool priorPanelMigration=protectedPanelsMigrated;
        var viewport=Scope.Viewport;var leftOffset=authoredLeftOffset;long nativeEdge=Scope.NativeEdgeRevision;
        try{
            action();
            if(!PaneLayout.Resolve(Scope,MinimumSize)&&(!expandForSelection||!WidenForSelection()))throw new Exception("Native minimum sizes reject split.");
            RefreshGroupVisibility();Reflow(null,cause);Paint();
        }catch{
            Scope.Root=root;Scope.Ratio=ratio;Scope.Presented=shown;Scope.Viewport=viewport;authoredLeftOffset=leftOffset;Scope.NativeEdgeRevision=nativeEdge;
            protectedPanelsMigrated=priorPanelMigration;
            Scope.Order.Clear();Scope.Order.AddRange(order);Scope.Groups.Clear();
            foreach(var pair in groups){Scope.Groups.Add(pair.Key,pair.Value);var g=pair.Value;
                g.OrderedTabs.Clear();g.OrderedTabs.AddRange(tabs[pair.Key]);g.SelectedTab=selected[pair.Key];
                g.Presentation=modes[pair.Key];g.ResolvedFrame=frames[pair.Key];}
            foreach(var pair in ownership)tabIndex[pair.Key].GroupId=pair.Value;
            documentGroups.Clear();foreach(var pair in docs)documentGroups.Add(pair.Key,pair.Value);
            dormantPeers.Clear();foreach(var pair in dormant)dormantPeers.Add(pair.Key,pair.Value);
            documentReferences.Clear();foreach(var pair in references)documentReferences.Add(pair.Key,pair.Value);
            Scope.StateRevision=state;Scope.GeometryRevision=geometry;
            // Rejected pure layout changes have not touched HWNDs. Replaying a
            // normal placement anyway can make an application restore cached
            // bounds, so only undo native state that actually changed.
            foreach(var saved in actual)try{if(!SavedWindowUnchanged(saved))RestoreSavedWindow(saved);}catch(Exception e){Log("command-rollback",null,null,null,e.Message);}
            try{Paint();}catch{}throw;
        }
        Scope.StateRevision=state+1;Scope.GeometryRevision=geometry+1;
        Stack(false,null);Notify(cause);
    }
    public void SetViewport(Rectangle box,long revision) {
        Native.Rect hostBox;
        if(authoredLeftOffset.HasValue&&Native.GetWindowRect(host,out hostBox))
            box=Rectangle.FromLTRB(hostBox.L+authoredLeftOffset.Value,box.Top,box.Right,box.Bottom);
        if(stopped||revision<=Scope.ViewportRevision||revision<=Scope.PendingViewportRevision)return;
        // A renderer geometry replay cannot replace a boundary during a native gesture.
        if(Scope.Groups.Values.Any(g=>g.Gesture!=null)){
            Scope.PendingViewport=box;Scope.PendingViewportRevision=revision;return;
        }
        if(box.Width<PaneLayout.DefaultMinWidth||box.Height<PaneLayout.DefaultMinHeight)
            throw new Exception("Viewport too small for groups.");
        var previous=Scope.Viewport;long oldViewportRevision=Scope.ViewportRevision;
        var oldRoot=Scope.Root==null?null:Scope.Root.Copy();
        if(previous==box){Scope.ViewportRevision=revision;return;}
        var oldFrames=Scope.Order.ToDictionary(id=>id,id=>Group(id).ResolvedFrame);
        Scope.Viewport=box;
        if(!PaneLayout.Resolve(Scope,MinimumSize)){Scope.Viewport=previous;Scope.ViewportRevision=oldViewportRevision;Scope.Root=oldRoot;
            foreach(var pair in oldFrames)Group(pair.Key).ResolvedFrame=pair.Value;throw new Exception("Native minimum sizes reject viewport.");}
        try{Reflow(null,"viewport");}catch{
            Scope.Viewport=previous;Scope.ViewportRevision=oldViewportRevision;Scope.Root=oldRoot;
            foreach(var pair in oldFrames)Group(pair.Key).ResolvedFrame=pair.Value;
            try{Reflow(null,"viewport-rollback");}catch{}throw;
        }
        Scope.ViewportRevision=revision;Scope.GeometryRevision++;Notify("setViewport");
    }
    public void SetHeaderHeight(int height){
        height=Math.Max(0,height);if(height==Scope.HeaderHeight)return;
        if(Scope.Groups.Values.Any(g=>g.Gesture!=null))return;
        int previous=Scope.HeaderHeight;Scope.HeaderHeight=height;
        try{Change("headerMetrics",()=>{});}catch{Scope.HeaderHeight=previous;throw;}
    }
    public void Raise(){if(!stopped&&Scope.Presented){Paint();Stack(false,null);}}
    void ShowPeer(PanePeer p,bool show){
        if(p==null||!p.Session.Valid())return;
        if(show&&Native.IsIconic(p.Session.Handle))Native.ShowWindow(p.Session.Handle,4);
        p.Session.Show(show);
    }
    void RefreshGroupVisibility(){
        var max=Scope.Order.FirstOrDefault(id=>Group(id).Presentation=="maximized");
        foreach(var id in Scope.Order){var g=Group(id);ShowPeer(Selected(g),Scope.Presented&&!hostSuspended&&g.Presentation!="minimized"&&(max==null||max==id));}
    }
    public void SetPresented(bool value){
        if(stopped||Scope.Presented==value)return;
        Change("setScopePresented",()=>Scope.Presented=value,value);
    }
    void Check(long binding,long state){if(stopped)throw new Exception("Native scope released.");if(binding!=Scope.BindingGeneration||state!=Scope.StateRevision)throw new Exception("Stale state or scope binding.");}
    public string Attach(IntPtr hwnd,uint pid,string groupId,long binding,long state,string retainedId=null) {
        Check(binding,state);var group=Group(groupId);
        if(hwndIndex.ContainsKey(hwnd))throw new Exception("Already attached.");
        uint actual;Native.GetWindowThreadProcessId(hwnd,out actual);
        if(actual!=pid||pid==0||hwnd==host)throw new Exception("HWND identity mismatch.");
        Native.Rect outer;if(!Native.GetWindowRect(hwnd,out outer))throw new Exception("GetWindowRect failed.");
        var frame=group.ResolvedFrame;
        var size=NativeMinimum(hwnd);
        if(Scope.Presented&&group.SelectedTab==null&&(frame.Width<size.Width||frame.Height<size.Height))
            throw new Exception("Native minimum size cannot fit this group.");
        if((Native.GetWindowLong(hwnd,-16)&0x00040000)==0&&
          ((outer.R-outer.L)!=frame.Width||(outer.B-outer.T)!=frame.Height))
            throw new Exception("Fixed-size window cannot fit this group.");
        var lease=new Mutex(false,"Local\\ChromePaneExperiment-"+hwnd.ToInt64());
        bool held=false,registered=false;PanePeer peer=null;string oldSelection=group.SelectedTab;
        long oldState=Scope.StateRevision;
        try{
            lock(ProcessPeers){if(!ProcessPeers.Add(hwnd.ToInt64()))throw new Exception("HWND already leased in this process.");registered=true;}
            try{held=lease.WaitOne(0);}catch(AbandonedMutexException){held=true;}
            if(!held)throw new Exception("HWND already leased.");
            string id=retainedId??Guid.NewGuid().ToString("N");
            if(tabIndex.ContainsKey(id)||documentGroups.ContainsKey(id))throw new Exception("Duplicate tab identity.");
            peer=new PanePeer(id,new WindowSession(hwnd.ToInt64(),pid),lease,groupId);
            peer.MinTrackWidth=size.Width;peer.MinTrackHeight=size.Height;peer.FixedSize=(Native.GetWindowLong(hwnd,-16)&0x00040000)==0;
            hwndIndex.Add(hwnd,peer);tabIndex.Add(peer.TabId,peer);group.OrderedTabs.Add(peer.TabId);
            if(group.SelectedTab==null)group.SelectedTab=peer.TabId;
            RecoverWrite();
            if(group.SelectedTab!=peer.TabId||!Visible().Contains(peer))ShowPeer(peer,false);
            Reflow(null,"attach");Paint();Stack(false,null);
            if(RejectNextAttachAfterPlacement){RejectNextAttachAfterPlacement=false;throw new Exception("Injected post-registration attachment failure.");}
            Scope.StateRevision++;Notify("attachWindow");
            return peer.TabId;
        }catch{
            if(peer!=null){
                hwndIndex.Remove(hwnd);tabIndex.Remove(peer.TabId);group.OrderedTabs.Remove(peer.TabId);
                group.SelectedTab=oldSelection;Scope.StateRevision=oldState;
                try{RestorePeer(peer);}catch(Exception e){Log("attach-rollback",peer,null,null,e.Message);}
                try{RecoverWrite();}catch(Exception e){Log("attach-recovery-error",peer,null,null,e.Message);}
                try{RefreshGroupVisibility();Reflow(null,"attach-rollback");Paint();}catch(Exception e){Log("attach-rollback-layout",peer,null,null,e.Message);}
            }
            if(held)try{lease.ReleaseMutex();}catch{}
            lease.Dispose();if(registered)lock(ProcessPeers)ProcessPeers.Remove(hwnd.ToInt64());throw;
        }
    }
    public void SelectTab(string groupId,string tabId,long binding,long state) {
        Check(binding,state);PaneGroup g=Group(groupId);PanePeer p;tabIndex.TryGetValue(tabId,out p);
        if(TabGroup(tabId)!=groupId)throw new Exception("Tab belongs to another group.");
        if(g.SelectedTab==tabId)return;
        Change("selectTab",()=>{var old=Selected(g);g.SelectedTab=tabId;
            if(p!=null){var minimum=NativeMinimum(p.Session.Handle);p.MinTrackWidth=minimum.Width;p.MinTrackHeight=minimum.Height;}
            if(old!=null)ShowPeer(old,false);},true);
        if(p!=null&&Visible().Contains(p))Stack(true,p);
    }
    public void ReorderTab(string groupId,string tabId,string before,long binding,long state) {
        Check(binding,state);var g=Group(groupId);
        if(before==tabId)return;
        if(!g.OrderedTabs.Remove(tabId))throw new Exception("Not a member.");
        int index=g.OrderedTabs.IndexOf(before);if(index<0)g.OrderedTabs.Add(tabId);else g.OrderedTabs.Insert(index,tabId);
        Scope.StateRevision++;Notify("reorderTab");
    }
    public void MoveTab(string tabId,string destination,long binding,long state) {
        Check(binding,state);PaneGroup from=Group(TabGroup(tabId)),to=Group(destination);
        if(from==to)return;
        Change("moveTab",()=>MoveMembership(tabId,from,to));
    }
    void MoveMembership(string id,PaneGroup from,PaneGroup to){
        bool active=from.SelectedTab==id;from.OrderedTabs.Remove(id);to.OrderedTabs.Add(id);
        PanePeer peer;if(tabIndex.TryGetValue(id,out peer))peer.GroupId=to.Id;else documentGroups[id]=to.Id;
        if(active)from.SelectedTab=from.OrderedTabs.FirstOrDefault();
        if(to.SelectedTab==null)to.SelectedTab=id;
        if(peer!=null&&to.SelectedTab!=id)ShowPeer(peer,false);
    }
    public void SplitAndMove(string tabId,string target,string added,string side,long binding,long state){
        Check(binding,state);var from=Group(TabGroup(tabId));Group(target);
        if(string.IsNullOrWhiteSpace(added)||Scope.Groups.ContainsKey(added))throw new Exception("New group id required.");
        if(!new[]{"left","right","top","bottom"}.Contains(side))throw new Exception("Invalid split side.");
        Change("splitAndMove",()=>{
            var to=Scope.Add(added);
            if(!PaneLayout.Split(Scope.Root,target,added,side))throw new Exception("Missing split target.");
            MoveMembership(tabId,from,to);Scope.Order.Clear();Scope.Order.AddRange(PaneLayout.Leaves(Scope.Root));
        });
    }
    public void CreateGroup(string target,string added,string side,long binding,long state){
        Check(binding,state);Group(target);
        if(string.IsNullOrWhiteSpace(added)||Scope.Groups.ContainsKey(added)||!new[]{"left","right","top","bottom"}.Contains(side))throw new Exception("Invalid new group.");
        Change("createGroup",()=>{Scope.Add(added);if(!PaneLayout.Split(Scope.Root,target,added,side))throw new Exception("Missing split target.");
            Scope.Order.Clear();Scope.Order.AddRange(PaneLayout.Leaves(Scope.Root));});
    }
    public void RelocateGroup(string id,string target,string side,long binding,long state){
        Check(binding,state);Group(id);Group(target);
        if(id==target)return;
        if(!new[]{"center","left","right","top","bottom"}.Contains(side))throw new Exception("Invalid group destination.");
        Change("relocateGroup",()=>{
            if(side=="center")SwapGroupLeaves(Scope.Root,id,target);
            else{Scope.Root=PaneLayout.Remove(Scope.Root,id);if(!PaneLayout.Split(Scope.Root,target,id,side))throw new Exception("Missing group destination.");}
            Scope.Order.Clear();Scope.Order.AddRange(PaneLayout.Leaves(Scope.Root));
        });
    }
    static void SwapGroupLeaves(PaneSplit node,string a,string b){
        if(node.Leaf){if(node.GroupId==a)node.GroupId=b;else if(node.GroupId==b)node.GroupId=a;return;}
        SwapGroupLeaves(node.First,a,b);SwapGroupLeaves(node.Second,a,b);
    }
    public void DetachTab(string tabId,long binding,long state) {
        if(Dormant(tabId)!=null){RemoveDocument(tabId,binding,state);return;}
        Check(binding,state);PanePeer p=Find(tabId);PaneGroup g=Group(p.GroupId);
        g.OrderedTabs.Remove(tabId);if(g.SelectedTab==tabId)g.SelectedTab=g.OrderedTabs.FirstOrDefault();
        tabIndex.Remove(tabId);hwndIndex.Remove(p.Session.Handle);
        try{RestorePeer(p);}finally{try{p.Lease.ReleaseMutex();}finally{p.Lease.Dispose();ForgetLease(p);}}
        RecoverWrite();RefreshGroupVisibility();
        Scope.StateRevision++;Reflow(null,"detach");Notify("detachWindow");
    }
    public void CloseGroup(string fromId,string toId,long binding,long state){
        Check(binding,state);PaneGroup from=Group(fromId),to=Group(toId);
        if(from==to||Scope.Order.Count<2)throw new Exception("Cannot merge group.");
        Change("closeGroup",()=>{
            foreach(var id in from.OrderedTabs.ToArray())MoveMembership(id,from,to);
            Scope.Root=PaneLayout.Remove(Scope.Root,fromId);Scope.Order.Remove(fromId);Scope.Groups.Remove(fromId);
        });
    }
    public void SetGroupPresentation(string id,string mode,long binding,long state){
        Check(binding,state);if(mode!="normal"&&mode!="minimized"&&mode!="maximized")throw new Exception("Invalid group presentation.");
        var g=Group(id);if(g.Presentation==mode)return;
        Change("setGroupPresentation",()=>{
            if(mode=="maximized")foreach(var other in Scope.Groups.Values)if(other!=g&&other.Presentation=="maximized")other.Presentation="normal";
            g.Presentation=mode;
        },mode!="minimized");
    }
    bool Fullscreen(PanePeer p) {
        if(IsZoomed(p.Session.Handle))return true;
        int style=Native.GetWindowLong(p.Session.Handle,-16);
        if((style&0x00C40000)==0)return true;
        Native.Rect raw;if(!Native.GetWindowRect(p.Session.Handle,out raw))return false;
        var screen=Screen.FromHandle(p.Session.Handle).Bounds;
        return Math.Abs(raw.L-screen.Left)<=8&&Math.Abs(raw.T-screen.Top)<=8&&
            Math.Abs(raw.R-screen.Right)<=8&&Math.Abs(raw.B-screen.Bottom)<=8;
    }
    void Place(PanePeer p,Rectangle target,string cause) {
        if(!p.Session.Valid()||Native.IsIconic(p.Session.Handle))return;
        p.Session.Fullscreen=Fullscreen(p);
        if(p.Session.Fullscreen)return;
        Native.Rect before;if(!Native.GetWindowRect(p.Session.Handle,out before)||before.Box==target)return;
        if(!Native.SetWindowPos(p.Session.Handle,IntPtr.Zero,target.X,target.Y,target.Width,target.Height,0x14))
            throw new Exception("SetWindowPos failed.");
        Native.Rect after;if(!Native.GetWindowRect(p.Session.Handle,out after))throw new Exception("Cannot observe placed HWND.");
        p.ObservedOuter=after.Box;p.ObservedVisible=p.Session.Frame();
        if(after.Box!=target){
            var minimum=NativeMinimum(p.Session.Handle);
            p.MinTrackWidth=minimum.Width;p.MinTrackHeight=minimum.Height;
            Log("native-constraint",p,target,after.Box,"rejected placement; no geometry commit");
            throw new Exception("Native peer refused requested geometry.");
        }
        p.Programmatic.Add(new PanePlacement{Generation=++moveGeneration,Actual=after.Box,At=DateTime.UtcNow,Cause=cause});
        if(p.Programmatic.Count>12)p.Programmatic.RemoveAt(0);
        Log(cause,p,target,after.Box,"SetWindowPos:NOACTIVATE|NOZORDER");
    }
    void Reflow(PanePeer dragged,string cause) {
        foreach(var id in Scope.Order){
            PaneGroup g=Group(id);PanePeer p=Selected(g);
            if(p==null||p==dragged||!Scope.Presented||hostSuspended||g.Presentation=="minimized")continue;
            if(g.Gesture!=null&&dragged==null)continue;
            Place(p,g.Presentation=="maximized"?PaneLayout.Content(Scope,Scope.Viewport):g.ResolvedFrame,cause);
        }
        Paint();
    }
    void Paint() {
        var frames=new List<Rectangle>();
        foreach(var p in Visible()){
            p.Session.Fullscreen=Fullscreen(p);
            if(p.Session.Fullscreen)continue;
            p.ObservedVisible=p.Session.Frame();frames.Add(p.ObservedVisible);
            foreach(var popup in PanePresentation.OwnedPopups(p.Session.Handle)){
                popupOwners[popup]=p;Native.Rect r;if(Native.GetWindowRect(popup,out r))frames.Add(r.Box);
            }
        }
        if(hub==null)presentation.Apply(frames);else hub.Apply(this,frames);
    }
    internal void SafeNativeEvent(IntPtr hook,uint ev,IntPtr hwnd,int obj,int child,uint thread,uint time){
        try{NativeEvent(hook,ev,hwnd,obj,child,thread,time);}
        catch(Exception error){Log("native-callback-error",null,null,null,error.ToString());}
    }
    void NativeEvent(IntPtr hook,uint ev,IntPtr hwnd,int obj,int child,uint thread,uint time){
        if(stopped)return;
        if((ev==Location||ev==Destroy||ev==Show||ev==Hide)&&obj!=0)return;
        if(ev==Destroy&&hwnd==host){Release();return;}
        if(ev==Destroy){PanePeer dead;if(hwndIndex.TryGetValue(hwnd,out dead)){RetireClosed(dead);return;}if(popupOwners.Remove(hwnd))Paint();return;}
        PanePeer p;if(!hwndIndex.TryGetValue(hwnd,out p)) {
            if(hwnd==host&&(ev==Location||ev==Show||ev==Hide)){
                bool suspend=Native.IsIconic(host)||!Native.IsWindowVisible(host);
                if(hostSuspended!=suspend){hostSuspended=suspend;RefreshGroupVisibility();Reflow(null,"host-presentation");}
                Paint();
            }
            // Popup HWNDs are routed through their owner chain, never registered as tabs.
            var next=Native.GetWindow(hwnd,4);var seen=new HashSet<IntPtr>();
            while(next!=IntPtr.Zero&&seen.Add(next)){
                PanePeer owner;
                if(hwndIndex.TryGetValue(next,out owner)){
                    if(Visible().Contains(owner)){
                        Paint();if(ev==Foreground||ev==Show)Stack(false,null);
                    }
                    break;
                }
                next=Native.GetWindow(next,4);
            }
            return;
        }
        if(!p.Session.Valid()){RetireClosed(p);return;}
        var g=Group(p.GroupId);
        Native.Rect actual;
        if(ev==Start){
            if(!Visible().Contains(p)||g.Presentation!="normal"||Scope.Groups.Values.Any(other=>other.Gesture!=null))return;
            if(g.SelectedTab!=p.TabId||!Native.GetWindowRect(hwnd,out actual))return;
            g.Gesture=new PaneGesture{InitialOuter=actual.Box,StartingBoundary=Scope.Order.Count==2?Group(Scope.Order[0]).ResolvedFrame.Right:0,
                Generation=++gestureGeneration,OuterLeft=actual.L==Scope.Viewport.Left};
            Log("native-start",p,null,actual.Box,"gesture");
            return;
        }
        if(ev==End){
            var gesture=g.Gesture;
            if(gesture!=null){
                g.Gesture=null;
                if(gesture.Changed&&Scope.Root!=null)Scope.Ratio=Scope.Root.Ratio;
                if(Scope.PendingViewport.HasValue){var pending=Scope.PendingViewport.Value;var revision=Scope.PendingViewportRevision;
                    Scope.PendingViewport=null;Scope.PendingViewportRevision=0;SetViewport(pending,revision);}
                else {Reflow(null,gesture.Changed?"native-end":"native-move-end");Paint();}
                if(gesture.Changed){
                    try{Reflow(null,"native-resize-validation");Notify("native-resize-commit");}
                    catch(Exception error){Log("native-resize-rejected",p,null,null,error.Message);}
                }
            }
            return;
        }
        if(ev==Foreground){
            // Delayed foreground events from newly created, subsequently minimized peers
            // must not reverse a selection transaction or fit an iconic -32000 rect.
            if(Native.GetForegroundWindow()!=hwnd||Native.IsIconic(hwnd))return;
            if(g.SelectedTab!=p.TabId){
                try{SelectTab(g.Id,p.TabId,Scope.BindingGeneration,Scope.StateRevision);}
                catch(Exception error){
                    // The taskbar already restored the incoming HWND before this callback.
                    // If it refuses fitting, suppress it and retain the last usable selection.
                    ShowPeer(p,false);RefreshGroupVisibility();Reflow(null,"taskbar-rollback");
                    Log("taskbar-selection-rejected",p,null,null,error.Message);
                }
            }
            if(!Visible().Contains(p))RefreshGroupVisibility();
            Stack(false,null);
            return;
        }
        if(ev!=Location||!Native.GetWindowRect(hwnd,out actual))return;
        p.ObservedOuter=actual.Box;p.ObservedVisible=p.Session.Frame();
        if(p.Session.Fullscreen&&!Fullscreen(p)&&g.SelectedTab==p.TabId&&g.Gesture==null){
            p.Session.Fullscreen=false;Place(p,g.Presentation=="maximized"?PaneLayout.Content(Scope,Scope.Viewport):g.ResolvedFrame,"fullscreen-exit");
            Paint();Notify("fullscreen-exit");return;
        }
        // Active gestures override matching historical SetWindowPos echoes.
        if(g.Gesture==null)for(int i=p.Programmatic.Count-1;i>=0;i--){
            var echo=p.Programmatic[i];
            if((DateTime.UtcNow-echo.At).TotalSeconds>5){p.Programmatic.RemoveAt(i);continue;}
            if(actual.Box==echo.Actual)return;
        }
        var gestureNow=g.Gesture;
        if(gestureNow==null||g.SelectedTab!=p.TabId||p.Session.Fullscreen||Fullscreen(p)){Paint();return;}
        var initial=gestureNow.InitialOuter;
        // Lock the first qualifying edge for this gesture. Translation/corner moves cannot author a seam.
        if(gestureNow.Edge==null){
            if(actual.R==initial.Right&&actual.T==initial.Top&&actual.B==initial.Bottom&&actual.L!=initial.Left)gestureNow.Edge="left";
            else if(actual.L==initial.Left&&actual.T==initial.Top&&actual.B==initial.Bottom&&actual.R!=initial.Right)gestureNow.Edge="right";
            else if(actual.B==initial.Bottom&&actual.L==initial.Left&&actual.R==initial.Right&&actual.T!=initial.Top)gestureNow.Edge="top";
            else if(actual.T==initial.Top&&actual.L==initial.Left&&actual.R==initial.Right&&actual.B!=initial.Bottom)gestureNow.Edge="bottom";
        }
        var edge=gestureNow.Edge;if(edge==null)return;
        bool anchored=edge=="left"?actual.R==initial.Right&&actual.T==initial.Top&&actual.B==initial.Bottom:
            edge=="right"?actual.L==initial.Left&&actual.T==initial.Top&&actual.B==initial.Bottom:
            edge=="top"?actual.B==initial.Bottom&&actual.L==initial.Left&&actual.R==initial.Right:
            actual.T==initial.Top&&actual.L==initial.Left&&actual.R==initial.Right;
        if(!anchored)return;
        int position=edge=="left"?actual.L:edge=="right"?actual.R:edge=="top"?actual.T:actual.B;
        var before=Scope.Order.ToDictionary(id=>id,id=>Group(id).ResolvedFrame);
        var root=Scope.Root.Copy();var viewport=Scope.Viewport;double ratio=Scope.Ratio;long edgeRevision=Scope.GeometryRevision;
        bool accepted=PaneLayout.AcceptEdge(Scope,p.GroupId,edge,position,MinimumSize);
        // The original single-pane rule: the outer LEFT edge authors its workspace seam.
        if(!accepted&&edge=="left"&&gestureNow.OuterLeft&&position!=Scope.Viewport.Left){
            Scope.Viewport=Rectangle.FromLTRB(position,viewport.Top,viewport.Right,viewport.Bottom);
            PaneLayout.PreserveScopeBoundaries(Scope,Scope.Viewport);
            accepted=PaneLayout.Resolve(Scope,MinimumSize);
            if(accepted)Scope.GeometryRevision++;else {Scope.Viewport=viewport;Scope.Root=root;}
        }
        if(accepted){
            try{Reflow(p,"native-resize-neighbor");gestureNow.Changed=true;
                if(edge=="left"&&gestureNow.OuterLeft){Native.Rect owner;if(Native.GetWindowRect(host,out owner))authoredLeftOffset=position-owner.L;Scope.NativeEdgeRevision++;}
                Notify("native-resize");}
            catch(Exception error){
                Scope.Root=root;Scope.Viewport=viewport;Scope.Ratio=ratio;Scope.GeometryRevision=edgeRevision;
                foreach(var pair in before)Group(pair.Key).ResolvedFrame=pair.Value;
                try{Reflow(p,"resize-reject-rollback");}catch{}
                Log("native-resize-rejected",p,null,actual.Box,error.Message);
            }
        }
    }
    void RetireClosed(PanePeer peer){
        if(!hwndIndex.ContainsKey(peer.Session.Handle))return;
        PaneGroup group=Group(peer.GroupId);
        hwndIndex.Remove(peer.Session.Handle);tabIndex.Remove(peer.TabId);
        if(group.SelectedTab==peer.TabId)group.SelectedTab=group.OrderedTabs.FirstOrDefault(id=>id!=peer.TabId&&!dormantPeers.ContainsKey(id))??peer.TabId;
        documentGroups[peer.TabId]=group.Id;
        dormantPeers[peer.TabId]=new PaneMountPeer{TabId=peer.TabId,GroupId=group.Id,Title=peer.LastTitle,Icon=peer.LastIcon,Url=peer.RestoreUrl,
            Handle=peer.Session.Handle.ToInt64(),InstanceMark=peer.Session.Saved.InstanceMark,Pid=peer.Session.Saved.Pid,Started=Started(peer.Session.Saved.Pid)};
        if(group.OrderedTabs.All(id=>dormantPeers.ContainsKey(id)))group.Presentation="minimized";
        bool interrupted=group.Gesture!=null;group.Gesture=null;
        try{peer.Lease.ReleaseMutex();}catch(Exception error){Log("retire-lease",peer,null,null,error.Message);}
        try{peer.Lease.Dispose();}catch{}
        ForgetLease(peer);
        Scope.StateRevision++;
        Log("peer-destroyed",peer,null,null,"retired HWND and retained session");
        try{RecoverWrite();}catch(Exception error){Log("retire-recovery",peer,null,null,error.Message);}
        RefreshGroupVisibility();
        if(interrupted&&Scope.PendingViewport.HasValue&&!Scope.Groups.Values.Any(g=>g.Gesture!=null)){
            var pending=Scope.PendingViewport.Value;var revision=Scope.PendingViewportRevision;
            Scope.PendingViewport=null;Scope.PendingViewportRevision=0;SetViewport(pending,revision);
        }
        Reflow(null,"peer-destroyed");Paint();
        Stack(false,null);
        Notify("peer-destroyed");
    }
    public void ReconcileClosed(){
        if(stopped)return;
        foreach(var peer in tabIndex.Values.ToArray())
            if(!IsWindow(peer.Session.Handle)||!peer.Session.Valid())RetireClosed(peer);
    }
    // Isolated harness only: model a native WM_ENTERSIZEMOVE / HWND geometry /
    // WM_EXITSIZEMOVE sequence without moving the creator's physical cursor.
    // This is NOT evidence of real mouse-driven drag acceptance.
    public void ExerciseNativeResizeForHarness(string tabId,int[] leftEdges){ExerciseNativeEdgeForHarness(tabId,"left",leftEdges);}
    public void ExerciseNativeEdgeForHarness(string tabId,string edge,int[] positions,Action beforeEnd=null){
        var peer=Find(tabId);
        Native.Rect start;
        if(!Native.GetWindowRect(peer.Session.Handle,out start))throw new Exception("Missing fixture HWND.");
        NativeEvent(IntPtr.Zero,Start,peer.Session.Handle,0,0,0,0);
        foreach(int position in positions){
            var box=start.Box;
            if(edge=="left")box=Rectangle.FromLTRB(position,start.T,start.R,start.B);
            if(edge=="right")box=Rectangle.FromLTRB(start.L,start.T,position,start.B);
            if(edge=="top")box=Rectangle.FromLTRB(start.L,position,start.R,start.B);
            if(edge=="bottom")box=Rectangle.FromLTRB(start.L,start.T,start.R,position);
            if(!Native.SetWindowPos(peer.Session.Handle,IntPtr.Zero,box.X,box.Y,box.Width,box.Height,0x14))throw new Exception("Fixture resize rejected.");
            NativeEvent(IntPtr.Zero,Location,peer.Session.Handle,0,0,0,0);
        }
        if(beforeEnd!=null)beforeEnd();
        NativeEvent(IntPtr.Zero,End,peer.Session.Handle,0,0,0,0);
    }
    public string RestackForHarness(){Stack(false,null);return presentation.StackDiagnostic;}

    static bool SavedWindowUnchanged(SavedWindow saved){
        var hwnd=new IntPtr(saved.Handle);var placement=new Native.Placement{Length=Marshal.SizeOf(typeof(Native.Placement))};
        uint pid;Native.GetWindowThreadProcessId(hwnd,out pid);
        return pid==saved.Pid&&WindowSession.SameInstance(saved)&&Native.GetWindowPlacement(hwnd,ref placement)&&
            placement.Equals(saved.Placement)&&Native.IsWindowVisible(hwnd)==saved.Visible&&
            (Native.GetWindowLong(hwnd,-20)&8)==(saved.ExStyle&8);
    }
    static void RestoreSavedWindow(SavedWindow saved){
        var hwnd=new IntPtr(saved.Handle);uint pid;Native.GetWindowThreadProcessId(hwnd,out pid);
        if(pid!=saved.Pid||!WindowSession.SameInstance(saved))return;
        if(!Native.SetWindowPos(hwnd,new IntPtr((saved.ExStyle&8)!=0?-1:-2),0,0,0,0,0x13))throw new Exception("Cannot restore native topmost state.");
        // Restore before applying the original normal/maximized placement.
        // Otherwise some apps replay their retained pane-sized restore bounds
        // when SW_SHOWNA brings an inactive, iconic tab back.
        if(Native.IsIconic(hwnd)&&saved.Placement.Show!=2&&saved.Placement.Show!=6&&saved.Placement.Show!=7)Native.ShowWindow(hwnd,4);
        var placement=saved.Placement;
        if(!Native.SetWindowPlacement(hwnd,ref placement))throw new Exception("Cannot restore native placement.");
        // SW_SHOWNA preserves the restored maximize/minimize state. SW_SHOWNOACTIVATE
        // would normalize an originally maximized window after SetWindowPlacement.
        Native.ShowWindow(hwnd,saved.Visible?8:0);
        var result=new Native.Placement{Length=Marshal.SizeOf(typeof(Native.Placement))};
        if(!Native.GetWindowPlacement(hwnd,ref result)||result.Normal.L!=saved.Placement.Normal.L||
          result.Normal.T!=saved.Placement.Normal.T||result.Normal.R!=saved.Placement.Normal.R||
          result.Normal.B!=saved.Placement.Normal.B||result.Show!=saved.Placement.Show||
          Native.IsWindowVisible(hwnd)!=saved.Visible||
          (Native.GetWindowLong(hwnd,-20)&8)!=(saved.ExStyle&8))
            throw new Exception("Native window restoration mismatch for HWND "+saved.Handle+": "+new JavaScriptSerializer().Serialize(new{expected=saved.Placement,actual=result,visible=Native.IsWindowVisible(hwnd),expectedVisible=saved.Visible}));
    }
    static void RestorePeer(PanePeer peer){if(peer.Session.Valid())RestoreSavedWindow(peer.Session.Saved);}
    public void Release(){
        if(stopped)return;stopped=true;liveness.Stop();liveness.Dispose();
        var failures=new List<Exception>();
        foreach(var hook in new[]{geometryHook,moveHook,focusHook,destroyHook,popupHook})
            if(hook!=IntPtr.Zero)try{Native.UnhookWinEvent(hook);}catch(Exception error){failures.Add(error);}
        foreach(var peer in tabIndex.Values.ToArray()){
            try{RestorePeer(peer);}catch(Exception error){failures.Add(error);Log("release-restore-error",peer,null,null,error.Message);}
            try{peer.Lease.ReleaseMutex();}catch(Exception error){failures.Add(error);Log("release-lease-error",peer,null,null,error.Message);}
            try{peer.Lease.Dispose();}catch(Exception error){failures.Add(error);}
            ForgetLease(peer);Log("release",peer,null,null,"Restore");
        }
        hwndIndex.Clear();tabIndex.Clear();documentGroups.Clear();dormantPeers.Clear();documentReferences.Clear();
        try{if(hub==null)presentation.Reset();else hub.Remove(this);}catch(Exception error){failures.Add(error);}
        if(guardStarted&&failures.Count==0)try{File.WriteAllText(recoveryFile+".released",recoveryGeneration);}
            catch(Exception error){failures.Add(error);}
        if(hostLease!=null)try{ReleasePhysicalHost(host,hostLease);}catch(Exception error){failures.Add(error);}
        try{Notify("release");}catch(Exception error){failures.Add(error);}
        if(failures.Count>0)throw new AggregateException("Release failed; recovery guard remains armed.",failures);
    }
    public void Dispose(){Release();}
}
