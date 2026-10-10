using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Papers' authorized pipe endpoint. One helper per physical HWND; Backpack
// identities and file locations are supplied only by the trusted main bridge.
public sealed class PaneCoordinatorHost:Form {
    [DllImport("user32.dll")]static extern bool ClientToScreen(IntPtr hwnd,ref Native.Point point);
    [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr hwnd,out Native.Rect rect);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,System.Text.StringBuilder text,int count);
    [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]static extern bool GetCursorPos(out Native.Point point);
    sealed class Binding {public PaneCoordinator Pane;public PaneChromeResolver Chrome;public string Token,Mount,LastSnapshot;public bool Loading,Dirty;public int HeaderDip;public long ViewportRevision;public Dictionary<string,object> Rect;}
    sealed class LegacyPeer{public string Id{get;set;}public long Handle{get;set;}public long Started{get;set;}public uint Pid{get;set;}public bool Active{get;set;}}
    readonly Dictionary<string,Binding> scopes=new Dictionary<string,Binding>();
    readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=4*1024*1024};
    readonly object output=new object();
    readonly Dictionary<uint,string> icons=new Dictionary<uint,string>();
    readonly IntPtr owner;
    readonly uint ownerPid;
    readonly string cache,chrome;
    readonly PaneCoordinatorHub physical;
    bool released;
    IntPtr moving;bool moveHadShift;DropOverlay dropOverlay;
    readonly System.Windows.Forms.Timer dragWatch=new System.Windows.Forms.Timer{Interval=30};
    sealed class DropOverlay:Form{
        public DropOverlay(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;BackColor=Color.FromArgb(66,150,215);Opacity=.25;}
        protected override bool ShowWithoutActivation{get{return true;}}
        protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x080000A0;return p;}}
    }
    static bool ShiftDown(){return (GetAsyncKeyState(16)&0x8000)!=0;}
    KeyValuePair<Binding,string>? DropTarget(Point point){
        foreach(var b in scopes.Values)if(!b.Loading&&b.Pane.Scope.Presented){
            var max=b.Pane.Scope.Groups.Values.FirstOrDefault(g=>g.Presentation=="maximized");
            foreach(var g in b.Pane.Scope.Groups.Values)if(g.Presentation!="minimized"&&(max==null||max==g)&&
                (max==g?b.Pane.Scope.Viewport:PaneLayout.Slot(b.Pane.Scope,g)).Contains(point))return new KeyValuePair<Binding,string>(b,g.Id);
        }return null;
    }
    void Gesture(uint ev,IntPtr hwnd){
        if(ev==0xA){uint pid;Native.GetWindowThreadProcessId(hwnd,out pid);
            if(hwnd==owner||pid==0||pid==ownerPid||Native.GetAncestor(hwnd,2)!=hwnd||Native.GetWindow(hwnd,4)!=IntPtr.Zero)return;
            moving=hwnd;moveHadShift=ShiftDown();
        }else if(hwnd==moving)FinishDrop();
    }
    void FinishDrop(){
        var hwnd=moving;bool shifted=moveHadShift||ShiftDown();moving=IntPtr.Zero;moveHadShift=false;if(dropOverlay!=null)dropOverlay.Hide();
        if(!shifted||hwnd==IntPtr.Zero)return;Native.Point cursor;if(!GetCursorPos(out cursor))return;
        var destination=DropTarget(new Point(cursor.X,cursor.Y));Binding source=null;string tab=null;
        foreach(var b in scopes.Values)foreach(var g in b.Pane.Scope.Groups.Values)foreach(var id in g.OrderedTabs)
            if(!b.Pane.IsDocument(id)&&b.Pane.Find(id).Session.Handle==hwnd){source=b;tab=id;}
        try{
            if(!destination.HasValue){if(source!=null)source.Pane.DetachTab(tab,source.Pane.Scope.BindingGeneration,source.Pane.Scope.StateRevision);return;}
            var target=destination.Value.Key;var group=destination.Value.Value;
            if(source!=null&&source!=target)throw new Exception("Release this window from its other Backpack before attaching it here.");
            if(source==null){uint pid;Native.GetWindowThreadProcessId(hwnd,out pid);tab=target.Pane.Attach(hwnd,pid,group,target.Pane.Scope.BindingGeneration,target.Pane.Scope.StateRevision);}
            else if(target.Pane.TabGroup(tab)!=group)target.Pane.MoveTab(tab,group,target.Pane.Scope.BindingGeneration,target.Pane.Scope.StateRevision);
            target.Pane.SelectTab(group,tab,target.Pane.Scope.BindingGeneration,target.Pane.Scope.StateRevision);
        }catch(Exception error){Console.Error.WriteLine("Native drop rejected: "+error.Message);}
    }
    double DpiScale{get{var dpi=GetDpiForWindow(owner);return dpi==0?1:dpi/96.0;}}
    PaneCoordinatorHost(string[] args){
        owner=new IntPtr(long.Parse(args[0]));ownerPid=uint.Parse(args[1]);cache=args[2];chrome=args[3];
        uint pid;Native.GetWindowThreadProcessId(owner,out pid);if(pid!=ownerPid)throw new Exception("Physical host identity changed.");
        Directory.CreateDirectory(cache);var unused=Handle;physical=new PaneCoordinatorHub(owner);
        physical.HostGeometryChanged=()=>{foreach(var binding in scopes.Values.ToArray())if(!binding.Loading){binding.Pane.SetHeaderHeight((int)Math.Round(binding.HeaderDip*DpiScale));binding.Pane.SetViewport(ScreenRect(binding.Rect),++binding.ViewportRevision);}};
        physical.NativeGesture=Gesture;
        dragWatch.Tick+=(s,e)=>{if(moving==IntPtr.Zero)return;bool shift=ShiftDown();if(shift)moveHadShift=true;Native.Point cursor;
            var target=shift&&GetCursorPos(out cursor)?DropTarget(new Point(cursor.X,cursor.Y)):null;
            if(target.HasValue){if(dropOverlay==null)dropOverlay=new DropOverlay();var b=target.Value.Key;var g=b.Pane.Group(target.Value.Value);dropOverlay.Bounds=g.Presentation=="maximized"?b.Pane.Scope.Viewport:PaneLayout.Slot(b.Pane.Scope,g);if(!dropOverlay.Visible)dropOverlay.Show();}
            else if(dropOverlay!=null)dropOverlay.Hide();
            if((GetAsyncKeyState(1)&0x8000)==0)FinishDrop();
        };dragWatch.Start();
        var watch=new System.Windows.Forms.Timer{Interval=1000};watch.Tick+=(s,e)=>{
            uint current;Native.GetWindowThreadProcessId(owner,out current);if(current!=ownerPid){Release();return;}
            foreach(var pair in scopes.ToArray()){Publish(pair.Key,pair.Value);var b=pair.Value;if(b.Dirty&&!b.Loading&&!b.Pane.Released&&!b.Pane.Scope.Groups.Values.Any(g=>g.Gesture!=null)){try{b.Pane.SaveMount(b.Mount);b.Dirty=false;}catch{}}}
        };watch.Start();
        var reader=new Thread(Read){IsBackground=true};reader.SetApartmentState(ApartmentState.MTA);reader.Start();
    }
    [STAThread]public static void Main(string[] args){
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);Console.InputEncoding=new System.Text.UTF8Encoding(false);
        try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
        if(args.Length==2&&args[0]=="--guard"){PaneCoordinator.Guard(args[1]);return;}
        if(args.Length!=4)return;
        Application.EnableVisualStyles();var endpoint=new PaneCoordinatorHost(args);
        Application.Run(new ApplicationContext());GC.KeepAlive(endpoint);
    }
    void Emit(object data){lock(output)Console.WriteLine(json.Serialize(data));}
    T UI<T>(Func<T> task){
        T result=default(T);Exception failure=null;
        using(var done=new ManualResetEvent(false)){
            BeginInvoke((Action)(()=>{try{result=task();}catch(Exception error){failure=error;}finally{done.Set();}}));
            if(!done.WaitOne(12000))throw new Exception("Native command timed out.");
        }
        if(failure!=null)throw failure;return result;
    }
    static string ReadText(Dictionary<string,object> r,string key,string fallback=""){object value;return r.TryGetValue(key,out value)&&value is string?(string)value:fallback;}
    static long Number(Dictionary<string,object> r,string key,long fallback=0){object value;return r.TryGetValue(key,out value)?Convert.ToInt64(value):fallback;}
    Rectangle ScreenRect(Dictionary<string,object> rect){
        var origin=new Native.Point();if(!ClientToScreen(owner,ref origin))throw new Exception("Host origin unavailable.");
        double scale=DpiScale;Native.Rect client;GetClientRect(owner,out client);
        int x=origin.X+(int)Math.Round(Convert.ToDouble(rect["x"])*scale),y=origin.Y+(int)Math.Round(Convert.ToDouble(rect["y"])*scale);
        int right=rect.ContainsKey("rightInset")?origin.X+client.R-(int)Math.Round(Convert.ToDouble(rect["rightInset"])*scale):x+(int)Math.Round(Convert.ToDouble(rect["width"])*scale);
        int bottom=rect.ContainsKey("bottomInset")?origin.Y+client.B-(int)Math.Round(Convert.ToDouble(rect["bottomInset"])*scale):y+(int)Math.Round(Convert.ToDouble(rect["height"])*scale);
        return Rectangle.FromLTRB(x,y,right,bottom);
    }
    object Local(Rectangle rect){var origin=new Native.Point();ClientToScreen(owner,ref origin);double scale=DpiScale;
        return new{x=(rect.X-origin.X)/scale,y=(rect.Y-origin.Y)/scale,width=rect.Width/scale,height=rect.Height/scale};}
    object Tree(PaneSplit node){if(node==null)return null;if(node.Leaf)return new{id=node.GroupId};
        return new{axis=node.Axis.ToLowerInvariant(),ratio=node.Ratio,first=Tree(node.First),second=Tree(node.Second)};}
    string PeerIcon(uint pid){string icon;if(icons.TryGetValue(pid,out icon))return icon;
        icon=null;try{using(var process=Process.GetProcessById((int)pid))using(var image=Icon.ExtractAssociatedIcon(process.MainModule.FileName))using(var bitmap=image.ToBitmap())using(var stream=new MemoryStream()){bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Png);icon="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());}}catch{}icons[pid]=icon;return icon;}
    object Snapshot(Binding binding){var pane=binding.Pane;var scope=pane.Scope;
        return new{binding=binding.Token,bindingGeneration=scope.BindingGeneration,stateRevision=scope.StateRevision,geometryRevision=scope.GeometryRevision,nativeEdgeRevision=scope.NativeEdgeRevision,
            viewport=Local(scope.Viewport),tree=Tree(scope.Root),presented=scope.Presented,
            groups=scope.Order.Select(id=>{var g=pane.Group(id);bool max=g.Presentation=="maximized";return new{id,selected=g.SelectedTab,presentation=g.Presentation,
                slot=Local(max?scope.Viewport:PaneLayout.Slot(scope,g)),content=Local(max?PaneLayout.Content(scope,scope.Viewport):g.ResolvedFrame),
                tabs=g.OrderedTabs.Select(tab=>{var dormant=pane.Dormant(tab);if(dormant!=null)return (object)new{id=tab,kind="dormant",active=g.SelectedTab==tab,title=dormant.Title??"Unavailable application",icon=dormant.Icon,canOpen=!string.IsNullOrEmpty(dormant.Url)};
                    if(pane.IsDocument(tab))return (object)new{id=tab,kind="document",active=g.SelectedTab==tab,preview=pane.DocumentReference(tab)};
                    var p=pane.Find(tab);var text=new System.Text.StringBuilder(512);GetWindowText(p.Session.Handle,text,text.Capacity);p.LastTitle=text.ToString();p.LastIcon=PeerIcon(p.Session.Saved.Pid);
                    return new{id=tab,kind="native",active=g.SelectedTab==tab,title=text.ToString(),icon=PeerIcon(p.Session.Saved.Pid),handle=p.Session.Handle.ToInt64(),pid=p.Session.Saved.Pid};}).ToArray()};}).ToArray()};
    }
    void Publish(string key,Binding binding){
        if(binding.Pane==null||binding.Pane.Released||binding.Loading)return;
        var snapshot=Snapshot(binding);var encoded=json.Serialize(snapshot);
        if(encoded==binding.LastSnapshot)return;binding.LastSnapshot=encoded;
        Emit(new{kind="snapshot",scope=key,snapshot});binding.Dirty=true;
    }
    object Execute(Dictionary<string,object> r){
        string op=ReadText(r,"op"),key=ReadText(r,"scope");Binding binding;
        if(op=="release-host"){Release();return new{ok=true};}
        if(!System.Text.RegularExpressions.Regex.IsMatch(key,"^[a-f0-9]{64}$"))throw new Exception("Invalid authorized scope identity.");
        if(op=="mount"){
            if(!scopes.TryGetValue(key,out binding)){
                binding=new Binding{Loading=true,HeaderDip=(int)Number(r,"headerHeight",32),Token=ReadText(r,"binding"),Mount=Path.Combine(cache,"pane-mount-"+key+".json")};
                var record=binding;
                binding.Pane=new PaneCoordinator(owner,Path.Combine(cache,"pane-recovery-"+Guid.NewGuid()+".json"),
                    Path.Combine(cache,"pane-actions-"+key+".jsonl"),_=>Publish(key,record),(int)Math.Round(Number(r,"headerHeight",32)*DpiScale),physical,key,true);
                binding.Chrome=new PaneChromeResolver(chrome,Path.Combine(cache,"pane-links-"+key+".json"));
                scopes.Add(key,binding);
                binding.Pane.Scope.Presented=false;binding.Rect=(Dictionary<string,object>)r["rect"];
                try{
                    if(File.Exists(binding.Mount)||File.Exists(PaneCoordinator.IntentPath(binding.Mount)))binding.Pane.RestoreMount(binding.Mount,ScreenRect(binding.Rect),false);
                    else{
                        binding.Pane.SetViewport(ScreenRect(binding.Rect),++binding.ViewportRevision);
                        string legacy=ReadText(r,"legacyMount");string active=null;
                        if(!string.IsNullOrEmpty(legacy)&&Path.GetDirectoryName(Path.GetFullPath(legacy))==Path.GetFullPath(cache)&&File.Exists(legacy)){
                            foreach(var p in json.Deserialize<List<LegacyPeer>>(File.ReadAllText(legacy))??new List<LegacyPeer>()){
                                uint actual;Native.GetWindowThreadProcessId(new IntPtr(p.Handle),out actual);
                                if(actual!=p.Pid||p.Pid==0)continue;
                                try{using(var process=Process.GetProcessById((int)p.Pid))if(process.StartTime.ToUniversalTime().Ticks!=p.Started)continue;
                                    var id=binding.Pane.Attach(new IntPtr(p.Handle),p.Pid,"main",binding.Pane.Scope.BindingGeneration,binding.Pane.Scope.StateRevision,p.Id);if(p.Active)active=id;
                                }catch(Exception error){Console.Error.WriteLine("Legacy peer omitted: "+error.Message);}
                            }
                            if(active!=null)binding.Pane.SelectTab("main",active,binding.Pane.Scope.BindingGeneration,binding.Pane.Scope.StateRevision);
                        }
                    }
                }catch{binding.Pane.Release();scopes.Remove(key);throw;}
                binding.ViewportRevision=binding.Pane.Scope.ViewportRevision;binding.Loading=false;
            }
            binding.Token=ReadText(r,"binding");binding.Pane.Scope.BindingGeneration++;
            binding.Rect=(Dictionary<string,object>)r["rect"];
            binding.Pane.SetViewport(ScreenRect(binding.Rect),++binding.ViewportRevision);
            bool show=!r.ContainsKey("visible")||Convert.ToBoolean(r["visible"]);
            if(show)foreach(var other in scopes.Values)if(other!=binding)other.Pane.SetPresented(false);
            binding.Pane.SetPresented(show);Publish(key,binding);return new{ok=true,snapshot=Snapshot(binding)};
        }
        if(!scopes.TryGetValue(key,out binding)||binding.Token!=ReadText(r,"binding"))throw new Exception("Stale surface binding.");
        var pane=binding.Pane;var scope=pane.Scope;
        if(op=="checkpoint"){pane.SaveMount(binding.Mount);return new{ok=true,snapshot=Snapshot(binding)};}
        if(op=="snapshot")return new{ok=true,snapshot=Snapshot(binding)};
        if(op=="can-fit")return new{ok=pane.CanFit(ScreenRect((Dictionary<string,object>)r["rect"]))};
        if(op=="group-minimum"){var minimum=pane.GroupMinimum(ReadText(r,"groupId"));return new{ok=true,width=minimum.Width,height=minimum.Height};}
        if(op=="can-replace-group")return new{ok=pane.CanReplaceGroup(ReadText(r,"groupId"),(int)Number(r,"width"),(int)Number(r,"height"))};
        if(op=="can-insert-group")return new{ok=pane.CanInsertGroup(ReadText(r,"groupId"),ReadText(r,"side"),(int)Number(r,"width"),(int)Number(r,"height"))};
        if(op=="can-relocate-group")return new{ok=pane.CanRelocateGroup(ReadText(r,"source"),ReadText(r,"groupId"),ReadText(r,"side"))};
        if(op=="raise"){pane.Raise();return new{ok=true,snapshot=Snapshot(binding)};}
        if(op=="viewport"){
            var nextRect=(Dictionary<string,object>)r["rect"];pane.SetViewport(ScreenRect(nextRect),++binding.ViewportRevision);binding.Rect=nextRect;
            return new{ok=true,snapshot=Snapshot(binding)};
        }
        if(op=="present"){
            bool value=Convert.ToBoolean(r["visible"]);
            if(value)foreach(var other in scopes.Values)if(other!=binding)other.Pane.SetPresented(false);
            pane.SetPresented(value);return new{ok=true,snapshot=Snapshot(binding)};
        }
        if(Number(r,"revision")!=scope.StateRevision) return new{ok=false,error="Layout changed; try the action again.",code="STALE_REVISION",snapshot=Snapshot(binding)};
        long generation=scope.BindingGeneration,state=scope.StateRevision;string tab=ReadText(r,"tabId"),group=ReadText(r,"groupId","main");
        if(op=="attach"){
            var hwnd=new IntPtr(Number(r,"handle"));uint pid=(uint)Number(r,"pid");
            tab=pane.Attach(hwnd,pid,group,generation,state,ReadText(r,"retainedId",null));pane.Find(tab).RestoreUrl=ReadText(r,"restoreUrl",null);pane.SelectTab(group,tab,generation,scope.StateRevision);
        }else if(op=="reconnect")tab=pane.Reconnect(ReadText(r,"retainedId"),new IntPtr(Number(r,"handle")),(uint)Number(r,"pid"),generation,state);
        else if(op=="dormant-add")pane.AddDormant(json.Deserialize<PaneMountPeer>(json.Serialize(r["peer"])),group);
        else if(op=="document-add"){pane.AddDocument(tab,group,generation,state);if(r.ContainsKey("preview"))pane.SetDocumentReference(json.Deserialize<PaneDocumentRef>(json.Serialize(r["preview"])));}
        else if(op=="document-remove")pane.RemoveDocument(tab,generation,state);
        else if(op=="ensure-panels")pane.EnsureWorkspacePanels(ScreenRect(binding.Rect),generation,state);
        else if(op=="select")pane.SelectTab(group,tab,generation,state);
        else if(op=="reorder")pane.ReorderTab(group,tab,ReadText(r,"beforeId"),generation,state);
        else if(op=="move")pane.MoveTab(tab,group,generation,state);
        else if(op=="split")pane.SplitAndMove(tab,group,ReadText(r,"newGroupId"),ReadText(r,"side"),generation,state);
        else if(op=="create-group")pane.CreateGroup(group,ReadText(r,"newGroupId"),ReadText(r,"side"),generation,state);
        else if(op=="relocate-group")pane.RelocateGroup(group,ReadText(r,"destination"),ReadText(r,"side"),generation,state);
        else if(op=="close-group")pane.CloseGroup(group,ReadText(r,"destination"),generation,state);
        else if(op=="presentation")pane.SetGroupPresentation(group,ReadText(r,"mode"),generation,state);
        else if(op=="document-edge")pane.ResizeDocumentEdge(group,ReadText(r,"edge"),(int)Math.Round(Convert.ToDouble(r["position"])*DpiScale),generation,state);
        else if(op=="detach")pane.DetachTab(tab,generation,state);
        else if(op=="release"){pane.SaveMount(binding.Mount);pane.Release();scopes.Remove(key);return new{ok=true};}
        else throw new Exception("Unknown coordinator command.");
        Publish(key,binding);return new{ok=true,tabId=tab,snapshot=Snapshot(binding)};
    }
    void Read(){string line;while((line=Console.ReadLine())!=null){string id="";
        try{var r=json.Deserialize<Dictionary<string,object>>(line);id=ReadText(r,"id");
            // UIA can block; resolve on this reader thread, then acquire/fit on the UI owner.
            if(ReadText(r,"op")=="open"||ReadText(r,"op")=="resume"){
                string scopeKey=ReadText(r,"scope");var state=UI(()=>{
                    Binding b;if(!scopes.TryGetValue(scopeKey,out b)||b.Token!=ReadText(r,"binding"))throw new Exception("Stale surface binding.");
                    return b;
                });
                var handles=UI(()=>state.Pane.Scope.Groups.Values.SelectMany(g=>g.OrderedTabs).Where(t=>!state.Pane.IsDocument(t)).Select(t=>state.Pane.Find(t).Session.Handle.ToInt64()).ToArray());
                bool resume=ReadText(r,"op")=="resume";
                string retained=ReadText(r,"tabId"),url=ReadText(r,"url"),source=ReadText(r,"source");
                if(resume){var dormant=UI(()=>state.Pane.Dormant(retained));if(dormant==null||string.IsNullOrEmpty(dormant.Url))throw new Exception("Choose a replacement window for this application.");url=dormant.Url;source="resume:"+retained;}
                Uri parsed;if(!Uri.TryCreate(url,UriKind.Absolute,out parsed)||!new[]{"http","https","file"}.Contains(parsed.Scheme))throw new Exception("Unsupported reopen address.");
                long hwnd=state.Chrome.Resolve(source,url,handles);
                r["op"]=resume?"reconnect":"attach";if(resume)r["retainedId"]=retained;r["handle"]=hwnd;uint pid;Native.GetWindowThreadProcessId(new IntPtr(hwnd),out pid);r["pid"]=pid;
                var found=UI(()=>state.Pane.Scope.Groups.Values.SelectMany(g=>g.OrderedTabs).FirstOrDefault(t=>!state.Pane.IsDocument(t)&&state.Pane.Find(t).Session.Handle.ToInt64()==hwnd));
                if(found!=null&&resume)throw new Exception("That address is already open in this page; choose a replacement window.");
                if(found!=null){r["op"]="select";r["tabId"]=found;r["groupId"]=UI(()=>state.Pane.TabGroup(found));}
            }
            UI(()=>{var result=Execute(r);
                if(r.ContainsKey("url")&&(ReadText(r,"op")=="attach"||ReadText(r,"op")=="select")){
                    Binding b;var reply=json.Deserialize<Dictionary<string,object>>(json.Serialize(result));
                    if(scopes.TryGetValue(ReadText(r,"scope"),out b)&&reply.ContainsKey("tabId")){
                        var tabId=Convert.ToString(reply["tabId"]);if(!b.Pane.IsDocument(tabId))b.Pane.Find(tabId).RestoreUrl=ReadText(r,"url");
                    }
                }
                Emit(new{id,result});return true;});
        }catch(Exception error){Console.Error.WriteLine(error);Emit(new{id,result=new{ok=false,error=error.Message}});}
    }try{BeginInvoke((Action)Release);}catch{}}
    void Release(){if(released)return;released=true;
        dragWatch.Stop();dragWatch.Dispose();if(dropOverlay!=null)dropOverlay.Dispose();
        foreach(var binding in scopes.Values)try{binding.Pane.SaveMount(binding.Mount);}catch{}
        try{physical.Dispose();}finally{Application.ExitThread();}
    }
}
