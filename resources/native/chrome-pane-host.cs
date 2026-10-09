using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// Chrome retains its profile, UI and session authority. No input injection,
// parenting, browser shutdown, session reconstruction or profile-file writes.
public sealed class ChromePaneHost : Form {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
    delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int count);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref Native.Point point);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Native.Rect rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    sealed class Tab { public IntPtr Window; public string Key; public AutomationElement Element; }
    public sealed class Link { public string Url; public string TabKey; }
    readonly Dictionary<string, Link> links = new Dictionary<string, Link>();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly object output = new object();
    readonly string chromePath;
    readonly uint ownerPid;
    readonly IntPtr owner;
    readonly string linkState;
    sealed class Peer { public string Id=Guid.NewGuid().ToString();public WindowSession Session;public Mutex Lease; }
    readonly List<Peer> peers=new List<Peer>();
    public sealed class RetainedPeer { public string Id; public long Handle; public uint Pid; public long Started; public bool Active; }
    bool restoredPeers;
    string lastPeers;
    readonly Dictionary<uint,string> icons=new Dictionary<uint,string>();
    string PeerIcon(uint pid){string icon;if(icons.TryGetValue(pid,out icon))return icon;
        icon=null;try{using(var process=Process.GetProcessById((int)pid))using(var image=Icon.ExtractAssociatedIcon(process.MainModule.FileName))using(var bitmap=image.ToBitmap())using(var stream=new MemoryStream()){bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Png);icon="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray());}}catch{}icons[pid]=icon;return icon;
    }
    [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]static extern bool GetCursorPos(out Native.Point point);
    IntPtr movingWindow;bool moveHadShift;
    bool ShiftDown(){return (GetAsyncKeyState(16)&0x8000)!=0;}
    object DropTab(string id,string before,bool shiftHeld){if((shiftHeld||ShiftDown())&&!InsidePane())return DetachPeer(id);if(InsidePane()&&before!=id)return Reorder(id,before);return new{ok=true};}
    void FinishWindowMove(IntPtr h){
        bool attach=moveHadShift||ShiftDown();ShowAttachOverlay(false);movingWindow=IntPtr.Zero;moveHadShift=false;
        if(!attach||!visible||!hasRect||h==owner||h==IntPtr.Zero||Native.GetAncestor(h,2)!=h||!InsidePane())return;
        try{chromeSizing=false;Adopt(h);visible=true;Fit();session.Show(true);Mask();Group(true);PublishTabs();}catch(Exception error){lock(output)Console.WriteLine(json.Serialize(new{kind="gesture-error",error=error.Message}));}
    }
    sealed class AttachOverlay:Form {
        public AttachOverlay(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;BackColor=Color.FromArgb(66,150,215);Opacity=.3;}
        protected override bool ShowWithoutActivation{get{return true;}}
        protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x080000A0;return p;}}
        protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var pen=new Pen(Color.White,6))e.Graphics.DrawRectangle(pen,3,3,Math.Max(1,Width-7),Math.Max(1,Height-7));using(var font=new Font("Segoe UI",18,FontStyle.Bold))TextRenderer.DrawText(e.Graphics,"Release to attach",font,ClientRectangle,Color.White,TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);}
    }
    AttachOverlay attachOverlay;
    Rectangle PaneBox(){Native.Point origin=new Native.Point();if(!ClientToScreen(owner,ref origin))return Rectangle.Empty;double scale=GetDpiForWindow(owner)/96.0;if(scale<=0)scale=1;Native.Rect client;GetClientRect(owner,out client);var right=anchoredEdges?client.R-rightInset*scale:local.Right*scale;var bottom=anchoredEdges?client.B-bottomInset*scale:local.Bottom*scale;return Rectangle.FromLTRB(origin.X+(int)((nativeLeft?chromeLeft:local.X)*scale),origin.Y+(int)(local.Y*scale),origin.X+(int)right,origin.Y+(int)bottom);}
    bool InsidePane(){Native.Point cursor;return GetCursorPos(out cursor)&&PaneBox().Contains(cursor.X,cursor.Y);}
    void ShowAttachOverlay(bool show){if(!show){if(attachOverlay!=null)attachOverlay.Hide();return;}var box=PaneBox();if(box.Width<1||box.Height<1)return;if(attachOverlay==null)attachOverlay=new AttachOverlay();attachOverlay.Bounds=box;if(!attachOverlay.Visible)attachOverlay.Show();}

    object Reorder(string id,string before){var peer=peers.FirstOrDefault(p=>p.Id==id);if(peer==null)throw new Exception("Window tab is unavailable.");peers.Remove(peer);int index=peers.FindIndex(p=>p.Id==before);if(index<0)peers.Add(peer);else peers.Insert(index,peer);PublishTabs();return new{ok=true};}
    string lastTabs;
    string PeerState { get { return linkState+".windows.json"; } }
    void PersistPeers(){
        if(!restoredPeers)return;
        var saved=new List<RetainedPeer>();
        foreach(var peer in peers)if(peer.Session.Valid())try{using(var process=Process.GetProcessById((int)peer.Session.Saved.Pid))saved.Add(new RetainedPeer{Id=peer.Id,Handle=peer.Session.Handle.ToInt64(),Pid=peer.Session.Saved.Pid,Started=process.StartTime.ToUniversalTime().Ticks,Active=peer.Session==session});}catch{}
        var serialized=json.Serialize(saved);if(serialized==lastPeers)return;
        var temp=PeerState+".tmp";File.WriteAllText(temp,serialized);
        if(File.Exists(PeerState))File.Replace(temp,PeerState,null);else File.Move(temp,PeerState);lastPeers=serialized;
    }
    void RestorePeers(){
        if(restoredPeers)return;restoredPeers=true;
        List<RetainedPeer> saved;try{saved=json.Deserialize<List<RetainedPeer>>(File.ReadAllText(PeerState));}catch{return;}
        Peer active=null;
        foreach(var item in saved)try{
            using(var process=Process.GetProcessById((int)item.Pid))if(process.StartTime.ToUniversalTime().Ticks!=item.Started)continue;
            uint pid;Native.GetWindowThreadProcessId(new IntPtr(item.Handle),out pid);if(pid!=item.Pid)continue;
            Adopt(new IntPtr(item.Handle));var peer=peers.First(p=>p.Session.Handle.ToInt64()==item.Handle);peer.Id=item.Id;if(item.Active)active=peer;
        }catch{}
        if(active!=null)ActivatePeer(active);lastTabs=null;PublishTabs();
    }
    WindowSession session;
    Mutex lease;
    Native.Event events;
    IntPtr geometryHook, foregroundHook, gestureHook;
    bool chromeSizing, nativeLeft;
    Native.Rect gestureStart;
    int chromeLeft;
    Rectangle local;
    bool visible, fitting, released;
    bool hasRect;
    double rightInset, bottomInset;
    bool anchoredEdges;
    string recovery;
    HostShape shape;

    bool isolated;
    ChromePaneHost(string[] args) {
        chromePath=args[0]; owner=new IntPtr(long.Parse(args[1])); ownerPid=uint.Parse(args[2]);
        linkState=args[3];isolated=args.Length>4&&args[4]=="isolated";
        try {var saved=json.Deserialize<Dictionary<string,Link>>(File.ReadAllText(linkState));foreach(var pair in saved)links[pair.Key]=pair.Value;}catch{}
        var unused=Handle;
        events=OnNative;
        geometryHook=Native.SetWinEventHook(0x800B,0x800B,IntPtr.Zero,events,0,0,0);
        foregroundHook=Native.SetWinEventHook(3,3,IntPtr.Zero,events,0,0,0);
        gestureHook=Native.SetWinEventHook(0xA,0xB,IntPtr.Zero,events,0,0,0);
        if(geometryHook==IntPtr.Zero||foregroundHook==IntPtr.Zero)throw new Exception("Cannot watch native pane events.");
        var watch=new System.Windows.Forms.Timer{Interval=1000};
        var dragWatch=new System.Windows.Forms.Timer{Interval=30};
        dragWatch.Tick+=(s,e)=>{if(movingWindow==IntPtr.Zero)return;if(ShiftDown())moveHadShift=true;ShowAttachOverlay(ShiftDown()&&visible&&hasRect);if((GetAsyncKeyState(1)&0x8000)==0)FinishWindowMove(movingWindow);};dragWatch.Start();
        watch.Tick+=(s,e)=>{uint p;Native.GetWindowThreadProcessId(owner,out p);if(p!=ownerPid)Release();else PublishTabs();};watch.Start();
        var reader=new Thread(Read){IsBackground=true};reader.SetApartmentState(ApartmentState.MTA);reader.Start();
    }
    [STAThread] public static void Main(string[] args) {
        Console.OutputEncoding=new System.Text.UTF8Encoding(false);Console.InputEncoding=new System.Text.UTF8Encoding(false);
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if(args.Length==2&&args[0]=="--guard") {
            var saved=new JavaScriptSerializer().Deserialize<ChromeRecovery>(File.ReadAllText(args[1]));
            try{Process.GetProcessById(saved.HostPid).WaitForExit();}catch(ArgumentException){}
            if(!File.Exists(args[1]+".released")){saved=new JavaScriptSerializer().Deserialize<ChromeRecovery>(File.ReadAllText(args[1]));foreach(var window in saved.Windows)WindowSession.Restore(window);HostShape.Restore(saved.Shape);}
            return;
        }
        if(args.Length==1&&args[0]=="--inspect") {
            var serializer=new JavaScriptSerializer();
            Console.WriteLine(serializer.Serialize(Tabs().Select(t=>new{window=t.Window.ToInt64(),key=t.Key,title=t.Element.Current.Name,selected=Selected(t)}).ToArray()));return;
        }
        if(args.Length!=4&&args.Length!=5)return;
        Application.EnableVisualStyles();
        var host=new ChromePaneHost(args);
        Application.Run(new ApplicationContext());GC.KeepAlive(host);
    }
    static List<IntPtr> Windows() {
        var list=new List<IntPtr>();
        EnumWindows((h,d)=>{
            var name=new System.Text.StringBuilder(80);GetClassName(h,name,80);
            if(name.ToString()!="Chrome_WidgetWin_1")return true;
            uint pid;Native.GetWindowThreadProcessId(h,out pid);
            try{using(var p=Process.GetProcessById((int)pid)){if(p.ProcessName=="chrome")list.Add(h);}}catch{}
            return true;
        },IntPtr.Zero);return list;
    }
    static List<Tab> Tabs() {
        var result=new List<Tab>();
        foreach(var h in Windows())try {
            var root=AutomationElement.FromHandle(h);
            var tabStrip=root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Tab));
            if(tabStrip==null)continue;
            var tabs=tabStrip.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.TabItem));
            uint pid;Native.GetWindowThreadProcessId(h,out pid);
            foreach(AutomationElement t in tabs)result.Add(new Tab{Window=h,Element=t,Key=pid+":"+string.Join(".",t.GetRuntimeId())});
        }catch(ElementNotAvailableException){}catch(InvalidOperationException){}
        return result;
    }
    static bool Selected(Tab tab) {
        try {object pattern;return tab.Element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern)&&((SelectionItemPattern)pattern).Current.IsSelected;}catch{return false;}
    }
    static bool ActiveUrlMatches(Tab tab,string url) {
        if(!Selected(tab))return false;
        try {
            var root=AutomationElement.FromHandle(tab.Window);
            var edits=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
            foreach(AutomationElement edit in edits){object pattern;if(!edit.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))continue;
                bool browserControl=true;var ancestor=edit;
                for(int depth=0;depth<64;depth++){ancestor=TreeWalker.ControlViewWalker.GetParent(ancestor);if(ancestor==null||ancestor==root)break;if(ancestor.Current.ControlType==ControlType.Document){browserControl=false;break;}}
                if(!browserControl)continue;
                var value=((ValuePattern)pattern).Current.Value;Uri candidate,expected;
                if(!Uri.TryCreate(url,UriKind.Absolute,out expected))return false;
                if(!Uri.TryCreate(value,UriKind.Absolute,out candidate)&&!Uri.TryCreate(expected.Scheme+"://"+value,UriKind.Absolute,out candidate))continue;
                if(candidate.AbsoluteUri.TrimEnd('/')==expected.AbsoluteUri.TrimEnd('/'))return true;
            }
        }catch{}
        return false;
    }
    void UI(Action action) {
        if(released)throw new Exception("Chrome pane has been released.");
        Exception failure=null;using(var done=new ManualResetEvent(false)) {
            BeginInvoke((Action)(()=>{try{action();}catch(Exception e){failure=e;}finally{done.Set();}}));
            if(!done.WaitOne(8000))throw new Exception("Native pane did not respond.");
        }
        if(failure!=null)throw failure;
    }
    void Adopt(IntPtr h) {
        if(session!=null&&session.Handle==h&&session.Valid())return;
        if(peers.Count==0)nativeLeft=false;chromeSizing=false;
        var existing=peers.FirstOrDefault(p=>p.Session.Handle==h&&p.Session.Valid());
        if(existing!=null){ActivatePeer(existing);return;}
        var next=new Mutex(false,"Local\\ChromePaneExperiment-"+h.ToInt64());bool acquired;
        try{acquired=next.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
        if(!acquired){next.Dispose();throw new Exception("This window is already attached to another pane. Release it there first.");}
        uint pid;Native.GetWindowThreadProcessId(h,out pid);
        WindowSession created;try{created=new WindowSession(h.ToInt64(),pid);}catch{next.ReleaseMutex();next.Dispose();throw;}
        var peer=new Peer{Session=created,Lease=next};peers.Add(peer);
        try { SaveRecovery(); } catch {peers.Remove(peer);created.Dispose();next.ReleaseMutex();next.Dispose();throw;}
        if(IsIconic(h)||IsZoomed(h))Native.ShowWindow(h,9);
        ActivatePeer(peer);
    }
    void SaveRecovery(){
        if(shape==null)shape=new HostShape(owner,ownerPid);
        bool first=recovery==null;
        if(first)recovery=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"chrome-recovery-"+Guid.NewGuid()+".json");
        var saved=new ChromeRecovery{HostPid=Process.GetCurrentProcess().Id,Shape=shape.Saved};
        foreach(var peer in peers)if(peer.Session.Valid())saved.Windows.Add(peer.Session.Saved);
        var temp=recovery+".tmp";File.WriteAllText(temp,json.Serialize(saved));
        if(File.Exists(recovery))File.Replace(temp,recovery,null);else File.Move(temp,recovery);
        if(first)Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--guard \""+recovery+"\""){UseShellExecute=false,CreateNoWindow=true});
    }
    void ActivatePeer(Peer peer){
        if(session!=null&&session!=peer.Session)session.Show(false);
        session=peer.Session;lease=peer.Lease;chromeSizing=false;
        Fit();session.Show(visible);Mask();Group(true);PublishTabs();
    }
    void PublishTabs(){
        foreach(var peer in peers.Where(p=>!p.Session.Valid()).ToArray()){
            peers.Remove(peer);peer.Lease.ReleaseMutex();peer.Lease.Dispose();
            if(session==peer.Session){session=null;lease=null;}
        }
        if(session==null&&peers.Count>0){ActivatePeer(peers[0]);return;}
        if(session==null)Mask();
        var tabs=peers.Select(p=>new{id=p.Id,title=WindowTitle(p.Session.Handle),active=p.Session==session,icon=PeerIcon(p.Session.Saved.Pid),handle=p.Session.Handle.ToInt64(),pid=p.Session.Saved.Pid}).ToArray();
        PersistPeers();var serialized=json.Serialize(new{kind="tabs",tabs=tabs});if(serialized==lastTabs)return;lastTabs=serialized;
        lock(output)Console.WriteLine(serialized);
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int size);
    static string WindowTitle(IntPtr h){var text=new System.Text.StringBuilder(512);GetWindowText(h,text,text.Capacity);return text.Length==0?"Window":text.ToString();}
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr window);
    bool OwnedBy(IntPtr popup,IntPtr main){var next=Native.GetWindow(popup,4);var seen=new HashSet<IntPtr>();while(next!=IntPtr.Zero&&seen.Add(next)){if(next==main)return true;next=Native.GetWindow(next,4);}return false;}
    List<IntPtr> PeerPopups(IntPtr main){var found=new List<IntPtr>();EnumWindows((h,d)=>{if(h!=main&&Native.IsWindowVisible(h)&&!IsIconic(h)&&OwnedBy(h,main))found.Add(h);return true;},IntPtr.Zero);return found;}
    void FocusSelectedPeer(){
        if(session==null||!session.Valid())return;
        var popup=PeerPopups(session.Handle).FirstOrDefault();SetForegroundWindow(popup==IntPtr.Zero?session.Handle:popup);Group(true);
        BeginInvoke((Action)(()=>{if(!released)Group(false);}));
    }
    object SelectPeer(string id){var peer=peers.FirstOrDefault(p=>p.Id==id&&p.Session.Valid());if(peer==null)throw new Exception("This window has closed.");visible=true;ActivatePeer(peer);FocusSelectedPeer();return new{ok=true};}
    object DetachPeer(string id){
        var peer=peers.FirstOrDefault(p=>p.Id==id);if(peer==null)return new{ok=true};
        bool active=session==peer.Session;peers.Remove(peer);peer.Session.Dispose();peer.Lease.ReleaseMutex();peer.Lease.Dispose();
        if(active){session=null;lease=null;if(peers.Count>0)ActivatePeer(peers[0]);else Mask();}
        SaveRecovery();PublishTabs();return new{ok=true};
    }
    bool MonitorMode() {
        if(session==null||!session.Valid())return false;
        if(IsZoomed(session.Handle))return true;
        int style=Native.GetWindowLong(session.Handle,-16);
        if((style & 0x00C40000)==0)return true;
        Native.Rect r;if(!Native.GetWindowRect(session.Handle,out r))return false;
        var monitor=Screen.FromHandle(session.Handle).Bounds;
        return Math.Abs(r.L-monitor.Left)<=8&&Math.Abs(r.T-monitor.Top)<=8&&Math.Abs(r.R-monitor.Right)<=8&&Math.Abs(r.B-monitor.Bottom)<=8;
    }
    void Fit() {
        if(fitting||chromeSizing||released||session==null||!hasRect||!visible||!session.Valid()||IsIconic(owner))return;
        session.Fullscreen=MonitorMode();
        if(session.Fullscreen){Mask();return;}
        uint pid;Native.GetWindowThreadProcessId(owner,out pid);if(pid!=ownerPid)return;
        var point=new Native.Point();if(!ClientToScreen(owner,ref point))return;
        var scale=GetDpiForWindow(owner)/96.0;if(scale<=0)scale=1;
        // Once resized natively, Chrome owns the dividing edge. Incoming layout
        // updates supply only the outer top/right/bottom, never reset that edge.
        int left=nativeLeft?chromeLeft:local.X;
        double right=local.Right,bottom=local.Bottom;Native.Rect client;
        if(anchoredEdges&&GetClientRect(owner,out client)){right=client.R/scale-rightInset;bottom=client.B/scale-bottomInset;}
        // Fixed-size utility windows reject pane dimensions and restore themselves.
        // Keep their native size and anchor them to the pane's right edge instead
        // of repeatedly fighting their own layout loop.
        bool resizable=(Native.GetWindowLong(session.Handle,-16)&0x00040000)!=0;
        Native.Rect fixedBox;
        int width=Math.Max(1,(int)Math.Round((right-left)*scale));
        int height=Math.Max(1,(int)Math.Round((bottom-local.Y)*scale));
        if(!resizable&&Native.GetWindowRect(session.Handle,out fixedBox)){
            width=fixedBox.R-fixedBox.L;height=fixedBox.B-fixedBox.T;
            left=(int)Math.Round(right-width/scale);
        }
        fitting=true;try{session.Fit(new Rectangle(point.X+(int)Math.Round(left*scale),point.Y+(int)Math.Round(local.Y*scale),width,height),false);Native.Rect actual;if(Native.GetWindowRect(session.Handle,out actual)){
            int targetRight=point.X+(int)Math.Round(right*scale);
            if(actual.R>targetRight+1){Native.SetWindowPos(session.Handle,IntPtr.Zero,targetRight-(actual.R-actual.L),actual.T,0,0,0x15);left=(int)Math.Round((targetRight-(actual.R-actual.L)-point.X)/scale);}
        }chromeLeft=left;nativeLeft=true;PublishLayout();Mask();}finally{fitting=false;}
    }
    void FollowResizedLeft(){
        if(session==null||!chromeSizing)return;
        Native.Rect actual;if(!Native.GetWindowRect(session.Handle,out actual))return;
        // A title-bar move shifts both edges. Only a resize holding the right
        // edge in place may redefine the split.
        if(Math.Abs(actual.R-gestureStart.R)<=2&&actual.L!=gestureStart.L)FollowChromeLeft();
    }
    void FollowChromeLeft(){
        if(session==null||!session.Valid()||session.Fullscreen||MonitorMode())return;
        Native.Rect actual;if(!Native.GetWindowRect(session.Handle,out actual))return;
        var origin=new Native.Point();if(!ClientToScreen(owner,ref origin))return;
        double scale=GetDpiForWindow(owner)/96.0;if(scale<=0)scale=1;
        int next=(int)Math.Round((actual.L-origin.X)/scale);
        if(nativeLeft&&chromeLeft==next)return;
        chromeLeft=next;nativeLeft=true;
        PublishLayout();
        Mask();
    }
    void PublishLayout(){
        if(session==null||!session.Valid()||session.Fullscreen)return;
        var origin=new Native.Point();if(!ClientToScreen(owner,ref origin))return;
        double scale=GetDpiForWindow(owner)/96.0;if(scale<=0)scale=1;
        int edge=(int)Math.Round((session.Frame().Left-origin.X)/scale);
        lock(output)Console.WriteLine(json.Serialize(new{kind="layout",rect=new{x=edge,y=local.Y,width=Math.Max(1,local.Right-edge),height=local.Height}}));
    }
    void Mask(){if(shape==null)return;if(visible&&session!=null&&session.Valid()&&!session.Fullscreen&&!IsIconic(owner))shape.Exclude(session.Frame());else shape.Reset();}
    void Group(bool force) {
        if(session==null||!visible||!session.Valid()||IsIconic(owner))return;
        var foreground=Native.GetForegroundWindow();var root=Native.GetAncestor(foreground,2);
        if(!force&&root!=owner&&root!=session.Handle)return;
        // A topmost host and a normal peer occupy different Windows z-order
        // bands. Keep the visible peer in the host's band, then raise the pair
        // in order without changing keyboard focus.
        if(IsIconic(session.Handle))Native.ShowWindow(session.Handle,9);
        session.Show(true);
        bool top=(Native.GetWindowLong(owner,-20)&8)!=0;
        bool peerTop=(Native.GetWindowLong(session.Handle,-20)&8)!=0;
        if(top!=peerTop)Native.SetWindowPos(session.Handle,new IntPtr(top?-1:-2),0,0,0,0,0x213);
        Native.SetWindowPos(owner,IntPtr.Zero,0,0,0,0,0x213);
        Native.SetWindowPos(session.Handle,IntPtr.Zero,0,0,0,0,0x213);
        var popups=PeerPopups(session.Handle);for(int i=popups.Count-1;i>=0;i--)Native.SetWindowPos(popups[i],IntPtr.Zero,0,0,0,0,0x213);
        Mask();
    }
    void OnNative(IntPtr hook,uint ev,IntPtr h,int obj,int child,uint thread,uint time) {
        if(released||fitting)return;
        // Windows can finish raising the newly activated host after this event.
        // Apply the peer ordering on the next message turn as well.
        if(ev==3){var activated=peers.FirstOrDefault(p=>p.Session.Handle==h&&p.Session.Valid());if(activated!=null&&activated.Session!=session){visible=true;ActivatePeer(activated);}if(h==owner||(session!=null&&h==session.Handle))Group(true);BeginInvoke((Action)(()=>{if(!released)Group(false);}));return;}
        if(session!=null&&h==session.Handle&&ev==0xA){movingWindow=h;moveHadShift=ShiftDown();Native.GetWindowRect(h,out gestureStart);chromeSizing=true;return;}
        if(ev==0xA&&h!=owner){movingWindow=h;moveHadShift=ShiftDown();}
        if(ev==0xB){var moved=movingWindow!=IntPtr.Zero?movingWindow:h;FinishWindowMove(moved);}
        if(session!=null&&h==session.Handle&&ev==0xB){FollowResizedLeft();chromeSizing=false;Fit();Mask();return;}
        if(obj!=0)return;
        if(session!=null&&h==session.Handle){bool was=session.Fullscreen;bool full=MonitorMode();session.Fullscreen=full;if(chromeSizing&&!full&&!was)FollowResizedLeft();if(was&&!full){chromeSizing=false;Fit();}else if(!full&&!chromeSizing)Fit();else Mask();return;}
        if(h!=owner)return;
        if(IsIconic(owner)){if(session!=null)session.Show(false);Mask();return;}
        if(session!=null&&visible)session.Show(true);Fit();Group(false);
    }
    object Open(Dictionary<string,object> request) {
        var url=(string)request["url"];Uri parsed;
        if(!Uri.TryCreate(url,UriKind.Absolute,out parsed)||(parsed.Scheme!="http"&&parsed.Scheme!="https"))throw new Exception("Only HTTP and HTTPS links are supported.");
        url=parsed.AbsoluteUri;
        var source=(string)request["source"];
        // Show before accessibility resolution, including panes hidden for Quick Run.
        var present=Convert.ToBoolean(request["present"]);
        UI(()=>{if(session!=null&&session.Valid()&&present){visible=true;session.Show(true);Group(true);}});
        var allTabs=Tabs();
        var tabs=isolated?allTabs.Where(t=>peers.Any(p=>p.Session.Handle==t.Window)).ToList():allTabs;Link previous;
        var selected=links.TryGetValue(source,out previous)&&previous.Url==url?tabs.FirstOrDefault(t=>t.Key==previous.TabKey):null;
        if(source=="workspace:resume") {
            selected=session!=null&&session.Valid()?tabs.FirstOrDefault(t=>t.Window==session.Handle&&Selected(t)):null;
            if(selected==null)selected=tabs.FirstOrDefault(Selected);
        } else if(selected==null) {
            var known=new HashSet<string>(links.Values.Where(link=>link.Url==url).Select(link=>link.TabKey));
            selected=tabs.FirstOrDefault(t=>known.Contains(t.Key));
            if(selected==null)selected=tabs.FirstOrDefault(t=>ActiveUrlMatches(t,url));
        }
        bool reused=selected!=null;
        if(selected==null) {
            var before=new HashSet<string>(allTabs.Select(t=>t.Key));
            if(isolated&&tabs.Count>0)UI(()=>SetForegroundWindow(tabs[0].Window));
            var launch=Process.Start(new ProcessStartInfo(chromePath,(isolated&&tabs.Count==0?"--new-window ":"--new-tab ")+"\""+url+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true});
            launch.StandardInput.Close();launch.BeginOutputReadLine();launch.BeginErrorReadLine();
            var watch=Stopwatch.StartNew();
            while(watch.ElapsedMilliseconds<9000) {
                var added=Tabs().Where(t=>!before.Contains(t.Key)).ToList();
                if(added.Count==1){selected=added[0];break;}
                if(added.Count>1){
                    var matching=added.Where(t=>ActiveUrlMatches(t,url)).ToList();
                    if(matching.Count==1){selected=matching[0];break;}
                    var active=added.Where(Selected).ToList();
                    if(active.Count==1){selected=active[0];break;}
                }
                Thread.Sleep(150);
            }
            if(selected==null)throw new Exception("Chrome opened the link, but its new tab could not be identified for hosting.");
        }
        UI(()=>{Adopt(selected.Window);visible=present;if(present&&IsIconic(selected.Window))Native.ShowWindow(selected.Window,9);session.Show(present);Fit();Mask();Group(true);PublishTabs();});
        object pattern;if(!selected.Element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern))throw new Exception("Chrome's tab does not expose selection.");
        ((SelectionItemPattern)pattern).Select();
        if(source!="workspace:resume")links[source]=new Link{Url=url,TabKey=selected.Key};
        var temporary=linkState+".tmp";File.WriteAllText(temporary,json.Serialize(links));
        if(File.Exists(linkState))File.Replace(temporary,linkState,null);else File.Move(temporary,linkState);
        return new {ok=true,reused=reused,window=selected.Window.ToInt64(),title=selected.Element.Current.Name};
    }
    void Read() {
        string line;while((line=Console.ReadLine())!=null) {
            string id="";
            try {
                var request=json.Deserialize<Dictionary<string,object>>(line);id=(string)request["id"];
                var op=(string)request["op"];object result=new{ok=true};
                if(op=="open")result=Open(request);
                else if(op=="attach")UI(()=>{var h=new IntPtr(Convert.ToInt64(request["handle"]));uint pid;Native.GetWindowThreadProcessId(h,out pid);if(pid!=Convert.ToUInt32(request["pid"]))throw new Exception("Window identity changed.");Adopt(h);visible=true;if(IsIconic(h)||IsZoomed(h))Native.ShowWindow(h,9);session.Show(true);Fit();Mask();Group(true);PublishTabs();});
                else if(op=="tabs")UI(()=>{lastTabs=null;PublishTabs();});
                else if(op=="select")UI(()=>{result=SelectPeer((string)request["tabId"]);});
                else if(op=="tab-drop")UI(()=>{result=DropTab((string)request["tabId"],(string)request["beforeId"],request.ContainsKey("shiftHeld")&&Convert.ToBoolean(request["shiftHeld"]));});
                else if(op=="reorder")UI(()=>{result=Reorder((string)request["tabId"],(string)request["beforeId"]);});
                else if(op=="detach")UI(()=>{result=DetachPeer((string)request["tabId"]);});
                else if(op=="rect")UI(()=>{local=new Rectangle(Convert.ToInt32(request["x"]),Convert.ToInt32(request["y"]),Convert.ToInt32(request["width"]),Convert.ToInt32(request["height"]));hasRect=true;anchoredEdges=request.ContainsKey("rightInset")&&request.ContainsKey("bottomInset");if(anchoredEdges){rightInset=Convert.ToDouble(request["rightInset"]);bottomInset=Convert.ToDouble(request["bottomInset"]);}RestorePeers();if(!chromeSizing)Fit();});
                else if(op=="visible")UI(()=>{visible=Convert.ToBoolean(request["visible"]);if(session!=null)session.Show(visible);Fit();Mask();if(visible)Group(true);});
                else if(op=="raise")UI(()=>Group(true));
                else if(op=="release"){UI(()=>{Release();lock(output)Console.WriteLine(json.Serialize(new{id=id,result=new{ok=true}}));});return;}
                else throw new Exception("Unknown Chrome pane operation.");
                lock(output)Console.WriteLine(json.Serialize(new{id=id,result=result}));
            }catch(Exception e){lock(output)Console.WriteLine(json.Serialize(new{id=id,result=new{ok=false,error=e.Message}}));}
        }
        try{BeginInvoke((Action)Release);}catch{}
    }
    void Release() {
        if(released)return;released=true;if(attachOverlay!=null){attachOverlay.Dispose();attachOverlay=null;}
        Native.UnhookWinEvent(geometryHook);Native.UnhookWinEvent(foregroundHook);
        Native.UnhookWinEvent(gestureHook);
        if(peers.Count==0&&session!=null)session.Dispose();
        foreach(var peer in peers){peer.Session.Dispose();peer.Lease.ReleaseMutex();peer.Lease.Dispose();}
        peers.Clear();
        if(shape!=null)shape.Reset();
        MarkReleased();
        lease=null;
        Application.ExitThread();
    }
    void MarkReleased(){if(recovery!=null)File.WriteAllText(recovery+".released","restored");}
}

public sealed class ChromeRecovery {
    public int HostPid;
    public List<SavedWindow> Windows=new List<SavedWindow>();
    public SavedShape Shape;
}
public sealed class SavedShape { public long Handle; public uint Pid; public byte[] Data; }
// This is the experiment's host cut-out, with recovery for an external host.
public sealed class HostShape {
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
    [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr target,IntPtr first,IntPtr second,int mode);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr h,uint size,[Out] byte[] data);
    [DllImport("gdi32.dll")] static extern IntPtr ExtCreateRegion(IntPtr transform,uint size,byte[] data);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h,IntPtr region);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h,IntPtr region,bool repaint);
    public readonly SavedShape Saved;
    Rectangle last; Size lastHost; bool applied;
    public HostShape(IntPtr owner,uint pid) {
        Saved=new SavedShape{Handle=owner.ToInt64(),Pid=pid};
        var region=CreateRectRgn(0,0,0,0);
        try{if(GetWindowRgn(owner,region)!=0){uint n=GetRegionData(region,0,null);Saved.Data=new byte[n];if(GetRegionData(region,n,Saved.Data)==0)throw new Exception("Cannot preserve Papers window shape.");}}finally{DeleteObject(region);}
    }
    static bool Valid(SavedShape saved){if(saved==null)return false;uint pid;Native.GetWindowThreadProcessId(new IntPtr(saved.Handle),out pid);return pid==saved.Pid;}
    static IntPtr Original(SavedShape saved){return saved.Data==null?IntPtr.Zero:ExtCreateRegion(IntPtr.Zero,(uint)saved.Data.Length,saved.Data);}
    public void Exclude(Rectangle screenFrame){
        if(!Valid(Saved))return;
        var owner=new IntPtr(Saved.Handle);Native.Rect bounds;if(!Native.GetWindowRect(owner,out bounds))return;
        screenFrame.Intersect(bounds.Box);screenFrame.Offset(-bounds.L,-bounds.T);
        var hostSize=bounds.Box.Size;
        if(applied&&last==screenFrame&&lastHost==hostSize)return;
        var original=Original(Saved);var region=CreateRectRgn(0,0,bounds.R-bounds.L,bounds.B-bounds.T);var hole=CreateRectRgn(screenFrame.Left,screenFrame.Top,screenFrame.Right,screenFrame.Bottom);
        try{
            if(original!=IntPtr.Zero)CombineRgn(region,region,original,1);
            CombineRgn(region,region,hole,4);
            if(SetWindowRgn(owner,region,true)==0)throw new Exception("Cannot open Chrome's area in Papers.");
            region=IntPtr.Zero;last=screenFrame;lastHost=hostSize;applied=true;
        }finally{if(original!=IntPtr.Zero)DeleteObject(original);if(region!=IntPtr.Zero)DeleteObject(region);DeleteObject(hole);}
    }
    public void Reset(){if(!applied)return;Restore(Saved);applied=false;}
    public static void Restore(SavedShape saved){if(!Valid(saved))return;var region=Original(saved);if(SetWindowRgn(new IntPtr(saved.Handle),region,true)==0&&region!=IntPtr.Zero)DeleteObject(region);}
}
