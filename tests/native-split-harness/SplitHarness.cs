using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

public sealed class SplitHarness:Form {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback,IntPtr data);
    delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,System.Text.StringBuilder text,int count);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd,IntPtr region);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
    [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region,int x,int y);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
    readonly bool selftest;
    readonly string directory=AppDomain.CurrentDomain.BaseDirectory;
    readonly Dictionary<string,List<Button>> tabButtons=new Dictionary<string,List<Button>>();
    readonly Dictionary<string,FlowLayoutPanel> heads=new Dictionary<string,FlowLayoutPanel>();
    readonly List<Process> fixtures=new List<Process>();
    readonly Label status=new Label();
    readonly Label heading=new Label();
    PaneCoordinator engine;
    long viewportSerial=1;
    bool closing;
    bool rejectedActualPlacement;
    int groupSerial=2;
    readonly Dictionary<string,string> renderedTabs=new Dictionary<string,string>();
    public SplitHarness(bool testing) {
        selftest=testing;
        Text="Papers Split Test";
        StartPosition=FormStartPosition.CenterScreen;Size=new Size(1450,850);MinimumSize=new Size(950,570);
        BackColor=Color.FromArgb(228,234,241);Font=new Font("Segoe UI",10);
        var actions=new FlowLayoutPanel{Dock=DockStyle.Top,Height=88,WrapContents=true,AutoScroll=true};
        Add(actions,"Attach existing…",()=>PickWindow());
        Add(actions,"Spawn A",()=>Spawn("Amber","A"));
        Add(actions,"Spawn B",()=>Spawn("Blue","B"));
        Add(actions,"Try fixed",()=>Spawn("Fixed","B"));
        Add(actions,"A -> B",()=>Transfer("A","B"));
        Add(actions,"B -> A",()=>Transfer("B","A"));
        Add(actions,"Detach A",()=>Detach("A"));
        Add(actions,"Detach B",()=>Detach("B"));
        Add(actions,"Dialog A",()=>OpenFixtureDialog("A"));
        Add(actions,"Dialog B",()=>OpenFixtureDialog("B"));
        Add(actions,"Min A",()=>Present("A","minimized"));
        Add(actions,"Max A",()=>Present("A","maximized"));
        Add(actions,"Normal A",()=>Present("A","normal"));
        Add(actions,"X B -> A",()=>Merge("B","A"));
        Add(actions,"Checkpoint + remount",()=>Remount());
        Add(actions,"Release all",()=>{engine.Release();status.Text="All attached applications restored.";});
        heading.Dock=DockStyle.Top;heading.Height=38;heading.Text="Drag the left edge of the RIGHT window to move the split. Click its tabs without disturbing the other group.";
        heading.TextAlign=ContentAlignment.MiddleCenter;
        status.Dock=DockStyle.Bottom;status.Height=38;status.TextAlign=ContentAlignment.MiddleLeft;
        status.Text="Launching independent test applications…";
        Controls.Add(actions);Controls.Add(heading);Controls.Add(status);
        foreach(var id in new[]{"A","B"}){
            var strip=new FlowLayoutPanel{Height=40,AutoScroll=true,WrapContents=false,BackColor=Color.FromArgb(184,197,214)};
            heads.Add(id,strip);Controls.Add(strip);
        }
    }
    static void Add(FlowLayoutPanel panel,string title,Action task) {
        var button=new Button{Text=title,AutoSize=true,Height=34};
        button.Click+=(s,e)=>{try{task();}catch(Exception ex){MessageBox.Show(ex.Message,"Harness command rejected");}};
        panel.Controls.Add(button);
    }
    Rectangle Viewport(){const int top=145;
        return RectangleToScreen(new Rectangle(15,top,Math.Max(1,ClientSize.Width-30),Math.Max(1,ClientSize.Height-top-48)));}
    protected override void OnShown(EventArgs e) {
        base.OnShown(e);Native.ShowWindow(Handle,4);
        string recovery=Path.Combine(directory,"recovery-"+Guid.NewGuid().ToString("N")+".json");
        string log=Path.Combine(directory,"native-actions-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".jsonl");
        try{
            engine=new PaneCoordinator(Handle,recovery,log,_=>{if(!closing)Render();},44);
            if(Program.Mode=="--remount-probe"){
                var saved=new JavaScriptSerializer().Deserialize<PaneMount>(File.ReadAllText(Program.Checkpoint));
                string[] omitted=engine.RestoreMount(Program.Checkpoint,Viewport());
                bool okay=omitted.Length==0&&saved.Groups.All(g=>g.Tabs.SequenceEqual(engine.Group(g.Id).OrderedTabs))&&
                    saved.Peers.All(p=>engine.Find(p.TabId).Session.Handle.ToInt64()==p.Handle)&&engine.Scope.Order.All(RectMatches);
                engine.Release();File.WriteAllText(Program.Checkpoint+".remount-result",okay?"PASS crash/restart remount: topology, tab order, identities and actual frames":"FAIL crash/restart remount");
                foreach(var p in saved.Peers)try{using(var fixture=Process.GetProcessById((int)p.Pid)){
                    if(fixture.MainModule.FileName==Application.ExecutablePath&&fixture.MainWindowTitle.StartsWith("Native split fixture:"))fixture.CloseMainWindow();
                }}catch{}
                BeginInvoke((Action)Close);return;
            }
            engine.SetViewport(Viewport(),++viewportSerial);
            if(selftest)try{Spawn("Resistant","A");}catch(Exception error){
                rejectedActualPlacement=error.Message.Contains("refused");}
            Spawn("Amber","A");Spawn("Blue","A");Spawn("Green","B");
            Render();
            if(Program.Mode=="--stacked-demo"){
                var blue=engine.Group("A").OrderedTabs.Last();
                engine.SplitAndMove(blue,"A",NextGroupId(),"right",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                Spawn("Amber","B");var lower=engine.Group("B").OrderedTabs.Last();
                engine.SplitAndMove(lower,"B",NextGroupId(),"bottom",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                return;
            }
            if(Program.Mode=="--crash-probe"){
                var tab=engine.Group("A").OrderedTabs.Last();
                engine.SplitAndMove(tab,"B","C","bottom",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                engine.SaveMount(Program.Checkpoint);File.WriteAllText(Program.Checkpoint+".ready",recovery);return;
            }
            if(selftest)BeginInvoke((Action)Smoke);
        }catch(Exception ex){status.Text="Harness startup FAILED: "+ex.Message;File.WriteAllText(Path.Combine(directory,"startup-error.txt"),ex.ToString());}
    }
    protected override void OnResize(EventArgs e){base.OnResize(e);RefreshViewport();}
    protected override void OnMove(EventArgs e){base.OnMove(e);RefreshViewport();}
    void RefreshViewport(){
        if(engine==null||closing||WindowState==FormWindowState.Minimized)return;
        try{engine.SetViewport(Viewport(),++viewportSerial);}catch(Exception ex){status.Text="Viewport rejected: "+ex.Message;}
        Render();
    }
    void Render(){
        if(engine==null||closing||engine.Released)return;
        string maximized=engine.Scope.Order.FirstOrDefault(id=>engine.Group(id).Presentation=="maximized");
        int index=0;
        foreach(var id in engine.Scope.Order.ToArray()){
            var g=engine.Group(id);FlowLayoutPanel strip;
            if(!heads.TryGetValue(id,out strip)){
                strip=new FlowLayoutPanel{Height=44,AutoScroll=true,WrapContents=false,BackColor=Color.FromArgb(184,197,214)};
                heads.Add(id,strip);Controls.Add(strip);
            }
            // Native-resolved geometry owns both the window and its header. No equal-width replay.
            var local=RectangleToClient(g.Presentation=="maximized"?engine.Scope.Viewport:PaneLayout.Slot(engine.Scope,g));
            strip.Visible=maximized==null||id==maximized;
            strip.SetBounds(local.Left,local.Top,Math.Max(1,local.Width),42);index++;
            string signature=string.Join("|",g.OrderedTabs.ToArray())+"/"+g.Presentation+"/"+engine.Scope.Order.Count+"/"+index;
            string prior;bool rebuild=!renderedTabs.TryGetValue(id,out prior)||prior!=signature;
            if(rebuild){
                strip.SuspendLayout();foreach(Control c in strip.Controls.Cast<Control>().ToArray())c.Dispose();strip.Controls.Clear();
                string group=id;
                strip.Controls.Add(new Label{Text=(index)+" "+id,TextAlign=ContentAlignment.MiddleCenter,Width=45,Height=30});
                Small(strip,"+",()=>Spawn("Amber",group));
                Small(strip,g.Presentation=="minimized"?"↗":"—",()=>Present(group,g.Presentation=="minimized"?"normal":"minimized"));
                Small(strip,g.Presentation=="maximized"?"❐":"□",()=>Present(group,g.Presentation=="maximized"?"normal":"maximized"));
                if(engine.Scope.Order.Count>1)Small(strip,"×",()=>Merge(group,engine.Scope.Order.First(other=>other!=group)));
                foreach(var tab in g.OrderedTabs.ToArray()){
                    var peer=engine.Find(tab);string target=tab;
                    var button=new Button{Text=WindowTitle(peer.Session.Handle).Replace("Native split fixture: ",""),Tag=target,Width=85,Height=30};
                    button.Click+=(sender,e)=>Run(()=>engine.SelectTab(group,target,engine.Scope.BindingGeneration,engine.Scope.StateRevision));
                    Point down=Point.Empty;
                    button.MouseDown+=(sender,e)=>{if(e.Button==MouseButtons.Left)down=e.Location;};
                    button.MouseMove+=(sender,e)=>{if(e.Button==MouseButtons.Left&&(Math.Abs(e.X-down.X)>6||Math.Abs(e.Y-down.Y)>6)){
                        var result=button.DoDragDrop(target,DragDropEffects.Move);
                        if(result==DragDropEffects.None&&(Control.ModifierKeys&Keys.Shift)!=0&&!Bounds.Contains(Cursor.Position))
                            Run(()=>engine.DetachTab(target,engine.Scope.BindingGeneration,engine.Scope.StateRevision));
                    }};
                    Drop(button,(tabId)=>{var p=engine.Find(tabId);if(p.GroupId!=group)engine.MoveTab(tabId,group,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                        engine.ReorderTab(group,tabId,target,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                        engine.SelectTab(group,tabId,engine.Scope.BindingGeneration,engine.Scope.StateRevision);});
                    strip.Controls.Add(button);
                }
                foreach(var side in new[]{"left","right","top","bottom"}){
                    string direction=side;
                    var spot=new Button{Text=side=="left"?"←":side=="right"?"→":side=="top"?"↑":"↓",Width=30,Height=30};
                    Drop(spot,tabId=>engine.SplitAndMove(tabId,group,NextGroupId(),direction,engine.Scope.BindingGeneration,engine.Scope.StateRevision));
                    strip.Controls.Add(spot);
                }
                Drop(strip,tabId=>{var p=engine.Find(tabId);if(p.GroupId!=group)engine.MoveTab(tabId,group,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                    engine.ReorderTab(group,tabId,null,engine.Scope.BindingGeneration,engine.Scope.StateRevision);});
                strip.ResumeLayout();renderedTabs[id]=signature;
            }
            foreach(var button in strip.Controls.OfType<Button>())if(button.Tag is string)
                button.BackColor=(string)button.Tag==g.SelectedTab?Color.White:Color.FromArgb(220,226,235);
        }
        foreach(var pair in heads)if(!engine.Scope.Order.Contains(pair.Key))pair.Value.Visible=false;
        heading.Text=engine.Scope.Order.Count+" groups | drag tabs to reorder/transfer; drop on arrows to split | Shift + drag outside detaches";
    }
    void Small(FlowLayoutPanel panel,string text,Action action){var b=new Button{Text=text,Width=28,Height=30};b.Click+=(sender,e)=>Run(action);panel.Controls.Add(b);}
    void Drop(Control control,Action<string> action){
        control.AllowDrop=true;Color normal=control.BackColor;
        control.DragEnter+=(sender,e)=>{if(e.Data.GetDataPresent(typeof(string))){e.Effect=DragDropEffects.Move;control.BackColor=Color.FromArgb(167,205,184);}};
        control.DragLeave+=(sender,e)=>control.BackColor=normal;
        control.DragDrop+=(sender,e)=>{control.BackColor=normal;string tab=e.Data.GetData(typeof(string)) as string;if(tab!=null)Run(()=>action(tab));};
    }
    string NextGroupId(){string id;do{id="G"+(++groupSerial);}while(engine.Scope.Groups.ContainsKey(id));return id;}
    void Remount(){
        string checkpoint=Path.Combine(directory,"mount-checkpoint.json");engine.SaveMount(checkpoint);engine.Release();
        engine=new PaneCoordinator(Handle,Path.Combine(directory,"recovery-"+Guid.NewGuid().ToString("N")+".json"),
            Path.Combine(directory,"native-actions-remount-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".jsonl"),_=>{if(!closing)Render();},44);
        string[] omitted=engine.RestoreMount(checkpoint,Viewport());
        viewportSerial=engine.Scope.ViewportRevision;renderedTabs.Clear();Render();
        status.Text="Remounted retained windows; omitted closed peers: "+omitted.Length;
    }
    sealed class Candidate {public IntPtr Handle;public uint Pid;public string Title;public override string ToString(){return Title;}}
    static string WindowTitle(IntPtr hwnd){var text=new System.Text.StringBuilder(512);GetWindowText(hwnd,text,text.Capacity);return text.ToString();}
    void PickWindow(){
        if(engine==null||engine.Released)return;
        var candidates=new List<Candidate>();
        EnumWindows((hwnd,unused)=>{string title=WindowTitle(hwnd);uint pid;Native.GetWindowThreadProcessId(hwnd,out pid);
            if(hwnd!=Handle&&Native.IsWindowVisible(hwnd)&&GetWindow(hwnd,4)==IntPtr.Zero&&!string.IsNullOrWhiteSpace(title)&&
                !engine.Scope.Groups.Values.SelectMany(g=>g.OrderedTabs).Any(tab=>engine.Find(tab).Session.Handle==hwnd))
                candidates.Add(new Candidate{Handle=hwnd,Pid=pid,Title=title});return true;},IntPtr.Zero);
        using(var picker=new Form{Text="Attach a window to the experiment",Size=new Size(560,420),StartPosition=FormStartPosition.CenterParent,
            FormBorderStyle=FormBorderStyle.FixedDialog,MinimizeBox=false,MaximizeBox=false,TopMost=true}){
            var list=new ListBox{Dock=DockStyle.Fill};list.Items.AddRange(candidates.OrderBy(c=>c.Title).Cast<object>().ToArray());
            var group=new ComboBox{Dock=DockStyle.Top,DropDownStyle=ComboBoxStyle.DropDownList};group.Items.AddRange(engine.Scope.Order.Cast<object>().ToArray());group.SelectedIndex=0;
            var attach=new Button{Text="Attach selected window",Dock=DockStyle.Bottom,Height=38};
            attach.Click+=(sender,e)=>{var candidate=list.SelectedItem as Candidate;if(candidate==null)return;
                try{engine.Attach(candidate.Handle,candidate.Pid,(string)group.SelectedItem,engine.Scope.BindingGeneration,engine.Scope.StateRevision);picker.Close();}
                catch(Exception error){MessageBox.Show(picker,error.Message,"Window cannot attach");}};
            picker.Controls.Add(list);picker.Controls.Add(group);picker.Controls.Add(attach);picker.ShowDialog(this);
        }
    }
    void Run(Action action){try{action();Render();}catch(Exception ex){status.Text="Command rejected: "+ex.Message;}}
    void Spawn(string name,string group){
        if(engine==null)throw new Exception("Not ready.");
        var p=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--fixture "+name){UseShellExecute=false});
        if(p==null)throw new Exception("Fixture launch failed.");
        fixtures.Add(p);
        try{p.WaitForInputIdle(3000);}catch{}
        IntPtr hwnd=IntPtr.Zero;
        for(int i=0;i<35;i++){p.Refresh();hwnd=p.MainWindowHandle;if(hwnd!=IntPtr.Zero)break;Thread.Sleep(40);}
        if(hwnd==IntPtr.Zero)throw new Exception("Fixture HWND unavailable.");
        string tab;
        try { tab=engine.Attach(hwnd,(uint)p.Id,group,engine.Scope.BindingGeneration,engine.Scope.StateRevision); }
        catch { fixtures.Remove(p);try{p.CloseMainWindow();}catch{}throw; }
        status.Text="Attached "+name+" as "+tab+" in group "+group;
        Render();
    }
    PanePeer Active(string id){var g=engine.Group(id);return g.SelectedTab==null?null:engine.Find(g.SelectedTab);}
    void Transfer(string src,string dst){var p=Active(src);if(p==null)return;Run(()=>engine.MoveTab(p.TabId,dst,engine.Scope.BindingGeneration,engine.Scope.StateRevision));}
    void Detach(string id){var p=Active(id);if(p==null)return;Run(()=>engine.DetachTab(p.TabId,engine.Scope.BindingGeneration,engine.Scope.StateRevision));}
    void Merge(string from,string to){Run(()=>engine.CloseGroup(from,to,engine.Scope.BindingGeneration,engine.Scope.StateRevision));}
    void Present(string id,string mode){Run(()=>engine.SetGroupPresentation(id,mode,engine.Scope.BindingGeneration,engine.Scope.StateRevision));}
    void OpenFixtureDialog(string id){var p=Active(id);if(p!=null)PostMessage(p.Session.Handle,0x8029,IntPtr.Zero,IntPtr.Zero);}
    void Smoke(){
        var report=new List<string>();bool passed=true;
        Action<bool,string> check=(good,name)=>{report.Add((good?"PASS ":"FAIL ")+name);if(!good)passed=false;};
        try{
            var legacy=new PaneScope("zero-header");legacy.Add("A");legacy.Add("B");legacy.Viewport=new Rectangle(100,100,800,600);
            bool legacyLayout=PaneLayout.Resolve(legacy,g=>new Size(270,230));
            check(legacyLayout&&legacy.Groups["A"].ResolvedFrame==new Rectangle(100,100,400,600)&&
                PaneLayout.AcceptEdge(legacy,"A","right",520,g=>new Size(270,230))&&
                legacy.Groups["B"].ResolvedFrame==new Rectangle(520,100,380,600),
                "zero-header callers retain original native rectangles and boundary authority");
            var headerMin=new PaneScope("header-minimum",44);headerMin.Add("A");headerMin.Add("B");
            headerMin.Root=new PaneSplit{Axis="Y",First=PaneLayout.Leaf("A"),Second=PaneLayout.Leaf("B")};
            headerMin.Viewport=new Rectangle(0,0,700,547);
            check(!PaneLayout.Resolve(headerMin,g=>new Size(270,230)),
                "vertical minimum includes both headers and rejects clipping either native window");
            check(rejectedActualPlacement,"fixture refusing programmatic bounds fails attachment without committing contradictory geometry");
            check(engine.Scope.Groups.Count==2&&engine.Group("A").OrderedTabs.Count==2&&engine.Group("B").OrderedTabs.Count==1,"two simultaneous groups; 2+1 attached windows");
            var b=engine.Group("B").SelectedTab;var a=engine.Group("A").OrderedTabs.ToArray();
            Native.Rect leftActual,rightActual;
            bool gotA=Native.GetWindowRect(engine.Find(engine.Group("A").SelectedTab).Session.Handle,out leftActual);
            bool gotB=Native.GetWindowRect(engine.Find(b).Session.Handle,out rightActual);
            check(gotA&&gotB&&leftActual.Box==engine.Group("A").ResolvedFrame&&rightActual.Box==engine.Group("B").ResolvedFrame,"requested and actual top-level rectangles match on both sides");
            check(engine.Group("A").OrderedTabs.All(id=>engine.Find(id).Session.Valid()),"all attached sessions retain their native HWND identity");
            engine.SelectTab("A",a[1],engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            Application.DoEvents();
            check(engine.Group("A").SelectedTab==a[1]&&engine.Group("B").SelectedTab==b&&
                Native.IsIconic(engine.Find(a[0]).Session.Handle)&&!Native.IsIconic(engine.Find(a[1]).Session.Handle),
                "real A switch minimizes prior peer, restores incoming, leaves B selected");
            engine.SelectTab("A",a[0],engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            Application.DoEvents();
            check(engine.Group("A").SelectedTab==a[0]&&engine.Group("B").SelectedTab==b&&
                Native.IsIconic(engine.Find(a[1]).Session.Handle)&&!Native.IsIconic(engine.Find(a[0]).Session.Handle),
                "reverse A switch restores original and keeps B independent");
            bool focused=GetForegroundWindow()==engine.Find(a[0]).Session.Handle||
                PanePresentation.OwnedPopups(engine.Find(a[0]).Session.Handle).Contains(GetForegroundWindow());
            if(focused)check(true,"tab selection foreground belongs to selected A peer or owned dialog");
            else report.Add("SKIP foreground assertion: Windows denied background test activation; physical tab-click focus remains unsigned");
            int neighborPlacements=engine.Find(b).Programmatic.Count;
            for(int round=0;round<12;round++){
                engine.SelectTab("A",a[1],engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                engine.SelectTab("A",a[0],engine.Scope.BindingGeneration,engine.Scope.StateRevision);Application.DoEvents();
            }
            check(engine.Group("A").SelectedTab==a[0]&&engine.Group("B").SelectedTab==b&&RectMatches("A")&&RectMatches("B")&&
                engine.Find(b).Programmatic.Count==neighborPlacements,"24 rapid selections preserve both final frames without placing the neighboring window");
            int startingBoundary=engine.Group("A").ResolvedFrame.Right;
            long geometryBefore=engine.Scope.GeometryRevision;
            engine.ExerciseNativeResizeForHarness(b,new[]{startingBoundary-80});
            check(HeadersMatch()&&heads["A"].Right==heads["B"].Left&&heads["A"].Width!=heads["B"].Width,
                "header boundaries follow asymmetric native resize instead of equal-width columns");
            engine.ExerciseNativeResizeForHarness(b,new[]{startingBoundary+60,startingBoundary});
            Native.Rect afterOutBackA=new Native.Rect(),afterOutBackB=new Native.Rect();
            bool both=Native.GetWindowRect(engine.Find(a[0]).Session.Handle,out afterOutBackA)&&
                Native.GetWindowRect(engine.Find(b).Session.Handle,out afterOutBackB);
            check(both&&engine.Group("A").ResolvedFrame.Right==startingBoundary&&
                afterOutBackA.Box==engine.Group("A").ResolvedFrame&&
                afterOutBackB.Box==engine.Group("B").ResolvedFrame&&
                engine.Scope.GeometryRevision>=geometryBefore+2,
                "synthetic native edge out/back returns boundary and both real rectangles");
            foreach(var initialState in new[]{"OriginalMax","OriginalMin","OriginalTop"}){
                Spawn(initialState,"B");var stateTab=engine.Group("B").OrderedTabs.Last();var statePeer=engine.Find(stateTab);
                var originalState=statePeer.Session.Saved;
                engine.DetachTab(stateTab,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                var restoredState=new Native.Placement{Length=Marshal.SizeOf(typeof(Native.Placement))};
                bool readState=Native.GetWindowPlacement(statePeer.Session.Handle,ref restoredState);
                check(readState&&restoredState.Show==originalState.Placement.Show&&
                    (Native.GetWindowLong(statePeer.Session.Handle,-20)&8)==(originalState.ExStyle&8),
                    "detach restores original native state: "+initialState);
                PostMessage(statePeer.Session.Handle,0x10,IntPtr.Zero,IntPtr.Zero);
            }
            var nativeMin=PaneCoordinator.NativeMinimum(engine.Find(b).Session.Handle);
            check(nativeMin.Width>=270&&nativeMin.Height>=230,"fixture Win32 minimum track is observed");
            long beforeConstraint=engine.Scope.GeometryRevision;
            engine.ExerciseNativeResizeForHarness(b,new[]{engine.Scope.Viewport.Right-nativeMin.Width+30});
            Native.Rect constrainedA=new Native.Rect(),constrainedB=new Native.Rect();
            bool readConstraint=Native.GetWindowRect(engine.Find(a[0]).Session.Handle,out constrainedA)&&
                Native.GetWindowRect(engine.Find(b).Session.Handle,out constrainedB);
            check(readConstraint&&engine.Scope.GeometryRevision==beforeConstraint&&
                engine.Group("A").ResolvedFrame.Right==startingBoundary&&
                constrainedA.Box==engine.Group("A").ResolvedFrame&&constrainedB.Box==engine.Group("B").ResolvedFrame,
                "synthetic resize below B minimum is rejected without contradictory overlapping geometry");
            long structural=engine.Scope.StateRevision;
            var viewport=engine.Scope.Viewport;
            engine.SetViewport(viewport,++viewportSerial);
            check(engine.Scope.StateRevision==structural&&engine.Group("B").SelectedTab==b,"idempotent viewport cannot alter tabs/selection");
            var original=engine.Find(a[0]).Session;var handle=engine.Find(a[0]).Session.Handle;
            engine.MoveTab(a[0],"B",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            check(Object.ReferenceEquals(original,engine.Find(a[0]).Session)&&handle==engine.Find(a[0]).Session.Handle,"transfer preserves original WindowSession and HWND lease");
            check(engine.Find(a[0]).GroupId=="B","HWND indexes into destination group");
            IntPtr modalParent=engine.Find(engine.Group("A").SelectedTab).Session.Handle;
            PostMessage(modalParent,0x8029,IntPtr.Zero,IntPtr.Zero);
            IntPtr modal=IntPtr.Zero;
            for(int i=0;i<18;i++){var found=PanePresentation.OwnedPopups(modalParent);if(found.Count>0){modal=found[0];break;}Thread.Sleep(80);}
            check(modal!=IntPtr.Zero,"fixture exposes a real owned modal dialog");
            if(modal!=IntPtr.Zero){
                Application.DoEvents();var stackInfo=engine.RestackForHarness();
                Native.Rect modalRect,bRect;
                bool crossing=Native.GetWindowRect(modal,out modalRect)&&Native.GetWindowRect(engine.Find(b).Session.Handle,out bRect)&&
                    modalRect.L<startingBoundary&&modalRect.R>startingBoundary;
                bool bAbove=false;var ahead=GetWindow(modal,3);
                for(int z=0;z<1000&&ahead!=IntPtr.Zero;z++,ahead=GetWindow(ahead,3))
                    if(ahead==engine.Find(b).Session.Handle){bAbove=true;break;}
                check(crossing&&!bAbove,"cross-divider owned modal remains above B in non-focus stack pass");
                if(!crossing||bAbove)report.Add("DETAIL crossing="+crossing+" bAbove="+bAbove+" boundary="+startingBoundary+" modal="+modalRect.Box+" stack="+stackInfo+" styles="+Native.GetWindowLong(modal,-20)+","+Native.GetWindowLong(engine.Find(b).Session.Handle,-20));
                PostMessage(modal,0x10,IntPtr.Zero,IntPtr.Zero);
            }
            int beforeFixed=engine.Group("B").OrderedTabs.Count;
            bool rejected=false;
            try{Spawn("Fixed","B");}catch(Exception error){rejected=error.Message.Contains("Fixed-size");}
            check(rejected&&engine.Group("B").OrderedTabs.Count==beforeFixed,"impossible fixed-size attachment rejected without changing group");
            Spawn("Blue","B");
            string retainedB=engine.Group("B").SelectedTab;
            string alternateB=engine.Group("B").OrderedTabs.Last();
            engine.SetGroupPresentation("A","maximized",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            engine.SelectTab("B",alternateB,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            Application.DoEvents();
            check(engine.Group("B").SelectedTab==alternateB&&
                Native.IsIconic(engine.Find(alternateB).Session.Handle)&&!Native.IsIconic(engine.Find(engine.Group("A").SelectedTab).Session.Handle),
                "selecting B under A maximize cannot expose suppressed B window");
            Native.Rect maxActual;bool maxRead=Native.GetWindowRect(engine.Find(engine.Group("A").SelectedTab).Session.Handle,out maxActual);
            check(maxRead&&maxActual.Box==PaneLayout.Content(engine.Scope,engine.Scope.Viewport)&&HeadersMatch()&&engine.Group("B").SelectedTab==alternateB,"group A maximize fills content below its header and preserves explicit B selection");
            engine.SetGroupPresentation("A","normal",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            Native.Rect backActual;bool backRead=Native.GetWindowRect(engine.Find(alternateB).Session.Handle,out backActual);
            check(backRead&&backActual.Box==engine.Group("B").ResolvedFrame,"return from group maximize restores selected B group bounds");
            int beforeFailed=engine.Group("B").OrderedTabs.Count;
            engine.RejectNextAttachAfterPlacement=true;bool injected=false;
            try{Spawn("Amber","B");}catch(Exception error){injected=error.Message.Contains("Injected");}
            check(injected&&engine.Group("B").OrderedTabs.Count==beforeFailed&&
                engine.Group("B").OrderedTabs.All(id=>engine.Find(id).Session.Valid()),
                "post-registration attach failure rolls back membership and leaves leases valid");
            // Retry the SAME HWND after a post-registration fault: a silently disposed
            // lease still indexed by the coordinator would fail here.
            var retryProcess=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--fixture Amber"){UseShellExecute=false});
            fixtures.Add(retryProcess);
            try{retryProcess.WaitForInputIdle(3000);}catch{}
            IntPtr retryHwnd=IntPtr.Zero;
            for(int i=0;i<40;i++){retryProcess.Refresh();retryHwnd=retryProcess.MainWindowHandle;
                if(retryHwnd!=IntPtr.Zero)break;Thread.Sleep(25);}
            bool reacquired=false;
            if(retryHwnd!=IntPtr.Zero){
                engine.RejectNextAttachAfterPlacement=true;
                try{engine.Attach(retryHwnd,(uint)retryProcess.Id,"B",engine.Scope.BindingGeneration,engine.Scope.StateRevision);}
                catch(Exception error){if(!error.Message.Contains("Injected"))throw;}
                string retryTab=engine.Attach(retryHwnd,(uint)retryProcess.Id,"B",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
                reacquired=engine.Find(retryTab).Session.Handle==retryHwnd;
                engine.DetachTab(retryTab,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            }
            check(reacquired&&engine.Group("B").OrderedTabs.Count==beforeFailed,
                "same HWND reacquires lease after a failed attach and detaches cleanly");
            try{retryProcess.CloseMainWindow();}catch{}
            var closingPeer=engine.Find(alternateB);
            var beforeInterrupted=engine.Scope.Viewport;
            var deferred=new Rectangle(beforeInterrupted.X,beforeInterrupted.Y+3,beforeInterrupted.Width,beforeInterrupted.Height-3);
            engine.ExerciseNativeEdgeForHarness(alternateB,"left",new int[0],()=>{
                engine.SetViewport(deferred,++viewportSerial);
                using(var process=Process.GetProcessById((int)closingPeer.Session.Saved.Pid))process.CloseMainWindow();
                for(int i=0;i<50&&closingPeer.Session.Valid();i++){Application.DoEvents();Thread.Sleep(15);}
                engine.ReconcileClosed();
            });
            check(!engine.Scope.PendingViewport.HasValue&&engine.Scope.Viewport==deferred&&RectMatches("B"),
                "closing an application during native resize drains deferred viewport and restores survivor");
            engine.SetViewport(beforeInterrupted,++viewportSerial);
            for(int i=0;i<50&&closingPeer.Session.Valid();i++){Application.DoEvents();Thread.Sleep(35);}
            engine.ReconcileClosed();Application.DoEvents();
            check(!engine.Group("B").OrderedTabs.Contains(alternateB)&&engine.Group("B").SelectedTab==retainedB&&
                engine.Find(retainedB).Session.Valid(),"closing selected application retires dead tab and selects survivor");
            // Additional acceptance cases run against the same retained real fixture HWNDs.
            var otherClient=engine.HostRegionForHarness;
            var external=new SavedShape{Handle=otherClient.Handle,Pid=otherClient.Pid,Data=otherClient.Data,ClientPid=(int)engine.Find(retainedB).Session.Saved.Pid};
            var externalHole=RectangleToScreen(new Rectangle(18,118,20,18));
            PaneHostRegion.Present(external,new[]{externalHole});
            var ownPoint=engine.Group("A").ResolvedFrame.Location;ownPoint.Offset(40,50);
            engine.SetPresented(false);
            check(HostContains(ownPoint)&&!HostContains(new Point(externalHole.X+5,externalHole.Y+5)),
                "suspending coordinator removes only its own holes and preserves another region client");
            engine.SetPresented(true);PaneHostRegion.Present(external,new Rectangle[0]);
            check(!HostContains(ownPoint)&&HostContains(new Point(externalHole.X+5,externalHole.Y+5)),
                "removing another region client preserves coordinator holes");
            Native.ShowWindow(Handle,7);Pump(250);
            check(engine.Scope.Groups.Values.Where(g=>g.SelectedTab!=null).All(g=>Native.IsIconic(engine.Find(g.SelectedTab).Session.Handle)),
                "minimizing physical host suspends all attached group windows");
            Native.ShowWindow(Handle,4);Pump(250);
            check(RectMatches("A")&&RectMatches("B")&&!Native.IsIconic(engine.Find(engine.Group("A").SelectedTab).Session.Handle),
                "restoring physical host resumes selected windows at resolved frames");
            Native.ShowWindow(Handle,0);Pump(150);
            check(engine.Scope.Groups.Values.Where(g=>g.SelectedTab!=null).All(g=>Native.IsIconic(engine.Find(g.SelectedTab).Session.Handle)&&Native.IsWindowVisible(engine.Find(g.SelectedTab).Session.Handle)),
                "hidden physical host minimizes peers while preserving ordinary taskbar visibility");
            Native.ShowWindow(Handle,8);Pump(150);
            check(RectMatches("A")&&RectMatches("B")&&!Native.IsIconic(engine.Find(engine.Group("A").SelectedTab).Session.Handle),
                "showing physical host resumes its selected peers");
            var activeA=engine.Find(engine.Group("A").SelectedTab);
            int seam=engine.Group("A").ResolvedFrame.Right;
            long aEdgeRevision=engine.Scope.GeometryRevision;
            engine.ExerciseNativeEdgeForHarness(activeA.TabId,"right",new[]{seam-35,seam});
            check(engine.Scope.GeometryRevision>=aEdgeRevision+2&&RectMatches("A")&&RectMatches("B")&&engine.Group("A").ResolvedFrame.Right==seam,
                "A right edge and B left edge author the same boundary, including out/back");
            var oldViewport=engine.Scope.Viewport;
            engine.SetPresented(false);
            var shifted=new Rectangle(oldViewport.X+9,oldViewport.Y+7,oldViewport.Width,oldViewport.Height);
            engine.SetViewport(shifted,++viewportSerial);engine.SetPresented(true);Application.DoEvents();
            check(RectMatches("A")&&RectMatches("B")&&engine.Scope.Viewport==shifted,
                "scope resume refits selected peers to geometry changed while suspended");
            engine.SetViewport(oldViewport,++viewportSerial);
            bool duplicateOwner=false;
            try{using(var second=new PaneCoordinator(Handle,Path.Combine(directory,"unused-recovery.json"),null,null)){} }catch(Exception error){duplicateOwner=error.Message.Contains("already has");}
            check(duplicateOwner,"same-process reentrant mutex cannot create a second coordinator for one host");
            var orderBeforeSelf=engine.Group("B").OrderedTabs.ToArray();long selfRevision=engine.Scope.StateRevision;
            engine.ReorderTab("B",retainedB,retainedB,engine.Scope.BindingGeneration,selfRevision);
            check(orderBeforeSelf.SequenceEqual(engine.Group("B").OrderedTabs)&&engine.Scope.StateRevision==selfRevision,
                "dropping tab onto itself is an idempotent reorder");
            long beforeStale=engine.Scope.StateRevision;bool stale=false;
            try{engine.ReorderTab("B",retainedB,null,engine.Scope.BindingGeneration,beforeStale-1);}catch{stale=true;}
            check(stale&&engine.Scope.StateRevision==beforeStale,"stale command is rejected without changing state");
            string selectedB=engine.Group("B").SelectedTab;
            engine.ReorderTab("B",selectedB,null,engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            check(engine.Group("B").OrderedTabs.Last()==selectedB&&engine.Group("B").SelectedTab==selectedB,
                "tab reorder changes strip order without changing selection or HWND membership");
            Spawn("Resistant","B");var refusing=engine.Group("B").OrderedTabs.Last();bool refused=false;
            try{engine.SelectTab("B",refusing,engine.Scope.BindingGeneration,engine.Scope.StateRevision);}catch(Exception error){refused=error.Message.Contains("refused");}
            check(refused&&engine.Group("B").SelectedTab==selectedB&&RectMatches("B")&&Native.IsIconic(engine.Find(refusing).Session.Handle),
                "incoming tab refusing placement rolls back selection, visibility and previous HWND geometry");
            var refusingHwnd=engine.Find(refusing).Session.Handle;
            engine.DetachTab(refusing,engine.Scope.BindingGeneration,engine.Scope.StateRevision);PostMessage(refusingHwnd,0x10,IntPtr.Zero,IntPtr.Zero);
            PostMessage(activeA.Session.Handle,0x802A,new IntPtr(1),IntPtr.Zero);Pump(180);
            Native.Rect fullscreenBox;Native.GetWindowRect(activeA.Session.Handle,out fullscreenBox);
            var monitor=Screen.FromHandle(activeA.Session.Handle).Bounds;
            var fullView=engine.Scope.Viewport;
            engine.SetViewport(new Rectangle(fullView.X,fullView.Y+5,fullView.Width,fullView.Height-5),++viewportSerial);
            Native.Rect stillFullscreen;Native.GetWindowRect(activeA.Session.Handle,out stillFullscreen);
            check(fullscreenBox.Box==monitor&&stillFullscreen.Box==monitor&&activeA.Session.Fullscreen,
                "native fullscreen fixture suspends pane fitting while viewport changes");
            PostMessage(activeA.Session.Handle,0x802A,IntPtr.Zero,IntPtr.Zero);Pump(180);
            check(!activeA.Session.Fullscreen&&RectMatches("A"),"native fullscreen exit resumes current group geometry");
            engine.SetViewport(fullView,++viewportSerial);
            long idleGeneration=engine.PlacementGeneration;Pump(550);
            check(engine.PlacementGeneration==idleGeneration,"idle settling produces zero unsolicited native geometry placements");
            var retainedSession=engine.Find(a[0]).Session;
            engine.SplitAndMove(a[0],"A","C","right",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            check(engine.Scope.Order.Count==3&&Object.ReferenceEquals(retainedSession,engine.Find(a[0]).Session)&&
                RectMatches("A")&&RectMatches("B")&&RectMatches("C"),"three groups split and transfer without releasing or replacing the native session");
            int inner=engine.Group("C").ResolvedFrame.Left;
            long nestedRevision=engine.Scope.GeometryRevision;
            engine.ExerciseNativeEdgeForHarness(a[0],"left",new[]{inner+20,inner});
            check(engine.Scope.GeometryRevision>=nestedRevision+2&&RectMatches("A")&&RectMatches("C")&&engine.Group("C").ResolvedFrame.Left==inner,
                "nested horizontal native edge changes its own ancestor boundary");
            var roomy=engine.Scope.Viewport;
            engine.SetViewport(new Rectangle(roomy.X,roomy.Y,900,roomy.Height),++viewportSerial);
            int beforeImpossible=engine.Scope.Order.Count;bool impossible=false;
            try{engine.SplitAndMove(a[0],"A","TooSmall","right",engine.Scope.BindingGeneration,engine.Scope.StateRevision);}catch{impossible=true;}
            check(impossible&&engine.Scope.Order.Count==beforeImpossible&&engine.Find(a[0]).GroupId=="C"&&RectMatches("C"),
                "split below combined native minima rolls back topology, membership and actual windows");
            engine.SetViewport(roomy,++viewportSerial);
            engine.SplitAndMove(retainedB,"C","D","bottom",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            int horizontal=engine.Group("D").ResolvedFrame.Top;
            long verticalRevision=engine.Scope.GeometryRevision;
            engine.ExerciseNativeEdgeForHarness(retainedB,"top",new[]{horizontal+20,horizontal});
            int upperBottom=horizontal-engine.Scope.HeaderHeight;
            engine.ExerciseNativeEdgeForHarness(a[0],"bottom",new[]{upperBottom-20,upperBottom});
            check(engine.Scope.GeometryRevision>=verticalRevision+4&&engine.Scope.Order.Count==4&&RectMatches("C")&&RectMatches("D")&&
                engine.Group("D").ResolvedFrame.Top==horizontal,"nested vertical split accepts either adjacent native edge without overlap");
            check(HeadersMatch()&&heads["D"].Top==PointToClient(engine.Group("C").ResolvedFrame.Location).Y+engine.Group("C").ResolvedFrame.Height&&
                heads["D"].Bottom<=PointToClient(engine.Group("D").ResolvedFrame.Location).Y,
                "lower group's strip lives between its own native window and the upper native window");
            var lowerHeader=heads["D"].PointToScreen(new Point(10,10));
            check(HostContains(lowerHeader),"lower group's controls remain in the host region outside all native window cutouts");
            engine.CloseGroup("D","C",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            engine.CloseGroup("C","A",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            check(engine.Scope.Order.Count==2&&Object.ReferenceEquals(retainedSession,engine.Find(a[0]).Session)&&RectMatches("A"),
                "closing nested groups collapses tree and preserves original native sessions");
            var transferred=engine.Find(a[0]);
            engine.CloseGroup("B","A",engine.Scope.BindingGeneration,engine.Scope.StateRevision);
            check(engine.Scope.Order.Count==1&&Object.ReferenceEquals(transferred,engine.Find(a[0]))&&transferred.GroupId=="A","group X merges tab membership without replacing native peer");
            var single=engine.Find(engine.Group("A").SelectedTab);var singleFrame=engine.Scope.Viewport;
            long singleEdgeRevision=engine.Scope.GeometryRevision;
            engine.ExerciseNativeEdgeForHarness(single.TabId,"left",new[]{singleFrame.Left+35,singleFrame.Left});
            check(engine.Scope.GeometryRevision>=singleEdgeRevision+2&&engine.Scope.Viewport==singleFrame&&RectMatches("A"),
                "single-pane outer left edge returns to start within the SAME native gesture");
            engine.ExerciseNativeEdgeForHarness(single.TabId,"left",new[]{singleFrame.Left+35});
            engine.SetViewport(singleFrame,++viewportSerial);
            check(engine.Scope.Viewport.Left==singleFrame.Left+35&&RectMatches("A"),
                "single pane native left edge survives stale renderer viewport replay");
            engine.ExerciseNativeEdgeForHarness(single.TabId,"left",new[]{singleFrame.Left});
            check(RectMatches("A")&&engine.Scope.Viewport==singleFrame,"single pane returns smoothly to its starting seam");
            engine.ExerciseNativeEdgeForHarness(single.TabId,"left",new[]{singleFrame.Left+22});
            long oldBinding=engine.Scope.BindingGeneration;var beforeMount=engine.Group("A").OrderedTabs.ToArray();
            Remount();
            check(engine.Scope.BindingGeneration>oldBinding&&beforeMount.SequenceEqual(engine.Group("A").OrderedTabs)&&RectMatches("A")&&HeadersMatch()&&engine.Scope.Viewport.Left==singleFrame.Left+22,
                "release and remount retain topology, stable tab order and HWNDs with a new binding generation");
            bool oldBindingRejected=false;
            try{engine.SelectTab("A",beforeMount[0],oldBinding,engine.Scope.StateRevision);}catch{oldBindingRejected=true;}
            check(oldBindingRejected,"remounted scope rejects commands from its previous surface binding");
            var saves=engine.Scope.Order.SelectMany(g=>engine.Group(g).OrderedTabs).Select(id=>engine.Find(id).Session.Saved).ToArray();
            engine.Release();
            check(engine.Released,"release completes cleanly");
            bool restored=true;foreach(var saved in saves){var placed=new Native.Placement{Length=System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.Placement))};
                var hwnd=new IntPtr(saved.Handle);
                if(!Native.GetWindowPlacement(hwnd,ref placed)||placed.Normal.L!=saved.Placement.Normal.L||
                  placed.Normal.T!=saved.Placement.Normal.T||placed.Normal.R!=saved.Placement.Normal.R||
                  placed.Normal.B!=saved.Placement.Normal.B||placed.Show!=saved.Placement.Show||
                  Native.IsWindowVisible(hwnd)!=saved.Visible||
                  ((Native.GetWindowLong(hwnd,-20)&8)!=(saved.ExStyle&8)))restored=false;}
            check(restored,"released windows restore size, position, show state and topmost bit");
            using(var physical=new PaneCoordinatorHub(Handle)){
                var peers=fixtures.Where(p=>!p.HasExited&&p.MainWindowHandle!=IntPtr.Zero).Take(2).ToArray();
                if(peers.Length!=2)throw new Exception("Two live fixture peers required for physical scope tests.");
                using(var first=new PaneCoordinator(Handle,Path.Combine(directory,"scope-A-"+Guid.NewGuid()+".json"),null,null,44,physical,"ayg",true))
                using(var second=new PaneCoordinator(Handle,Path.Combine(directory,"scope-B-"+Guid.NewGuid()+".json"),null,null,44,physical,"proxima",true)){
                    var area=Viewport();int half=area.Width/2;
                    first.SetViewport(new Rectangle(area.X,area.Y,half,area.Height),1);
                    second.SetViewport(new Rectangle(area.X+half,area.Y,area.Width-half,area.Height),1);
                    second.SetPresented(false);
                    string one=first.Attach(peers[0].MainWindowHandle,(uint)peers[0].Id,"main",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    string two=second.Attach(peers[1].MainWindowHandle,(uint)peers[1].Id,"main",second.Scope.BindingGeneration,second.Scope.StateRevision);
                    check(first.Scope.ScopeId=="ayg"&&second.Scope.ScopeId=="proxima"&&first.Group("main").SelectedTab==one&&
                        second.Group("main").SelectedTab==two&&Native.IsIconic(second.Find(two).Session.Handle)&&!Native.IsIconic(first.Find(one).Session.Handle),
                        "one physical event owner retains independent AYG and Proxima scope selection and visibility");
                    first.AddDocument("preview:fixture","main",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    first.SelectTab("main","preview:fixture",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    second.SetPresented(true);
                    check(first.Group("main").SelectedTab=="preview:fixture"&&Native.IsIconic(first.Find(one).Session.Handle)&&
                        !Native.IsIconic(second.Find(two).Session.Handle),"document selection suppresses only its own group's native peer");
                    first.SplitAndMove("preview:fixture","main","document-bottom","bottom",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    first.MoveTab("preview:fixture","main",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    first.CloseGroup("document-bottom","main",first.Scope.BindingGeneration,first.Scope.StateRevision);
                    first.ReorderTab("main","preview:fixture",one,first.Scope.BindingGeneration,first.Scope.StateRevision);
                    first.SelectTab("main",one,first.Scope.BindingGeneration,first.Scope.StateRevision);
                    check(first.IsDocument("preview:fixture")&&first.Group("main").OrderedTabs[0]=="preview:fixture"&&
                        first.Find(one).Session.Handle==peers[0].MainWindowHandle,"document split, transfer, group merge and mixed-strip reorder preserve the native session");
                    var secondBox=second.Group("main").ResolvedFrame;long secondMoves=second.PlacementGeneration;
                    first.Release();Pump(70);
                    Native.Rect actualSecond;Native.GetWindowRect(second.Find(two).Session.Handle,out actualSecond);
                    check(actualSecond.Box==secondBox&&second.PlacementGeneration==secondMoves&&
                        !HostContains(new Point(secondBox.X+30,secondBox.Y+50)),"releasing one Backpack scope preserves another scope's HWND geometry and host cutout");
                }
            }
        }catch(Exception ex){passed=false;report.Add("EXCEPTION "+ex);}
        File.WriteAllLines(Path.Combine(directory,"smoke-result.txt"),report);
        status.Text=passed?"Smoke PASS; all leased windows released.":"Smoke FAIL; inspect smoke-result.txt";
        foreach(var p in fixtures)try{if(!p.HasExited)p.CloseMainWindow();}catch{}
        var timer=new System.Windows.Forms.Timer{Interval=450};timer.Tick+=(s,e)=>{timer.Stop();Close();};timer.Start();
    }
    static void Pump(int milliseconds){var until=DateTime.UtcNow.AddMilliseconds(milliseconds);while(DateTime.UtcNow<until){Application.DoEvents();Thread.Sleep(10);}}
    bool HostContains(Point screen){Native.Rect box;Native.GetWindowRect(Handle,out box);var region=CreateRectRgn(0,0,0,0);
        try{return GetWindowRgn(Handle,region)==0||PtInRegion(region,screen.X-box.L,screen.Y-box.T);}finally{DeleteObject(region);}}
    bool RectMatches(string group){var g=engine.Group(group);if(g.SelectedTab==null)return true;
        Native.Rect actual;return Native.GetWindowRect(engine.Find(g.SelectedTab).Session.Handle,out actual)&&
            actual.Box==(g.Presentation=="maximized"?PaneLayout.Content(engine.Scope,engine.Scope.Viewport):g.ResolvedFrame);}
    bool HeadersMatch(){
        Render();
        var visible=engine.Scope.Order.Where(id=>heads[id].Visible).ToArray();
        return visible.All(id=>{
            var g=engine.Group(id);var slot=RectangleToClient(g.Presentation=="maximized"?engine.Scope.Viewport:PaneLayout.Slot(engine.Scope,g));var strip=heads[id];
            return strip.Left==slot.Left&&strip.Width==slot.Width&&strip.Top==slot.Top&&strip.Bottom<=slot.Top+engine.Scope.HeaderHeight;
        })&&visible.All(id=>visible.All(other=>id==other||!heads[id].Bounds.IntersectsWith(heads[other].Bounds)))&&
            visible.All(id=>visible.All(other=>{
                var g=engine.Group(other);var content=g.Presentation=="maximized"?PaneLayout.Content(engine.Scope,engine.Scope.Viewport):g.ResolvedFrame;
                return !heads[id].Bounds.IntersectsWith(RectangleToClient(content));
            }));
    }
    protected override void OnFormClosing(FormClosingEventArgs e){
        closing=true;if(engine!=null){try{engine.Release();}catch(Exception ex){File.WriteAllText(Path.Combine(directory,"release-error.txt"),ex.ToString());}}
        // Only applications launched as this harness's fixtures are closed.
        // Manually attached applications remain open after their lease is restored.
        foreach(var p in fixtures)try{if(!p.HasExited)p.CloseMainWindow();}catch{}
        base.OnFormClosing(e);
    }
}
