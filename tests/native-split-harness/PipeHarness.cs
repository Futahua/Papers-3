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

// Exercises the production endpoint, not an in-process coordinator substitute.
// All windows belong to this disposable offscreen test; no input is synthesized.
public sealed class PipeHarness:Form {
    sealed class Fixture:Form{protected override bool ShowWithoutActivation{get{return true;}}}
    [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]static extern void NotifyWinEvent(uint ev,IntPtr hwnd,int obj,int child);
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly List<string> checks=new List<string>();
    readonly Dictionary<string,Dictionary<string,object>> snapshots=new Dictionary<string,Dictionary<string,object>>();
    readonly List<Form> fixtures=new List<Form>();
    readonly List<Native.Rect> originals=new List<Native.Rect>();
    readonly string cache=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"pipe-run-"+Guid.NewGuid().ToString("N"),"native-helpers");
    Process endpoint;long requestId;string scope=new string('a',64),token="first";
    protected override bool ShowWithoutActivation{get{return true;}}
    [STAThread]public static void Main(){try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}Application.EnableVisualStyles();Application.Run(new PipeHarness());}
    PipeHarness(){Text="Disposable Papers pipe verification";StartPosition=FormStartPosition.Manual;Bounds=new Rectangle(Screen.PrimaryScreen.Bounds.Right+200,50,1450,900);
        Shown+=(s,e)=>{
            foreach(var name in new[]{"Amber","Blue","Green"}){var f=new Fixture{Text="Pipe fixture "+name,StartPosition=FormStartPosition.Manual,
                Bounds=new Rectangle(100,100,640,420),MinimumSize=new Size(name=="Blue"?700:270,230)};f.Show();fixtures.Add(f);Native.Rect r;Native.GetWindowRect(f.Handle,out r);originals.Add(r);}
            new Thread(Run){IsBackground=true}.Start();
        };
    }
    static Dictionary<string,object> D(object value){return (Dictionary<string,object>)value;}
    static object[] A(object value){return value as object[]??((System.Collections.ArrayList)value).ToArray();}
    static long N(Dictionary<string,object> value,string key){return Convert.ToInt64(value[key]);}
    Dictionary<string,object> State{get{return snapshots[scope];}}
    Dictionary<string,object>[] Groups{get{return A(State["groups"]).Select(D).ToArray();}}
    Dictionary<string,object> Group(string id){return Groups.Single(g=>(string)g["id"]==id);}
    string[] Tabs(string group){return A(Group(group)["tabs"]).Select(t=>(string)D(t)["id"]).ToArray();}
    void Check(bool okay,string message){checks.Add((okay?"PASS ":"FAIL ")+message);if(!okay)throw new Exception(message);}
    void StartEndpoint(){endpoint=Process.Start(new ProcessStartInfo(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"pane-coordinator-host.exe"),
        Handle.ToInt64()+" "+Process.GetCurrentProcess().Id+" \""+cache+"\" \"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true});}
    Dictionary<string,object> Call(string op,Dictionary<string,object> args=null,bool okay=true){
        var r=args??new Dictionary<string,object>();string id=(++requestId).ToString();r["id"]=id;r["op"]=op;r["scope"]=scope;r["binding"]=token;
        if(snapshots.ContainsKey(scope)&&!r.ContainsKey("revision"))r["revision"]=N(State,"stateRevision");
        endpoint.StandardInput.WriteLine(json.Serialize(r));endpoint.StandardInput.Flush();
        while(true){var read=endpoint.StandardOutput.ReadLineAsync();if(!read.Wait(15000))throw new Exception("Pipe response timed out: "+op);
            if(read.Result==null)throw new Exception("Pipe closed: "+endpoint.StandardError.ReadToEnd());
            var response=json.Deserialize<Dictionary<string,object>>(read.Result);
            if(response.ContainsKey("kind")){snapshots[(string)response["scope"]]=D(response["snapshot"]);continue;}
            if((string)response["id"]!=id)throw new Exception("Response correlation mismatch.");
            var result=D(response["result"]);if(result.ContainsKey("snapshot"))snapshots[scope]=D(result["snapshot"]);
            if(okay&&!Convert.ToBoolean(result["ok"]))throw new Exception(op+": "+json.Serialize(result));return result;
        }
    }
    static Dictionary<string,object> Args(params object[] values){var result=new Dictionary<string,object>();for(int i=0;i<values.Length;i+=2)result.Add((string)values[i],values[i+1]);return result;}
    Dictionary<string,object> Rect(){return Args("x",450,"y",40,"width",970,"height",800,"rightInset",20,"bottomInset",40);}
    Native.Rect Frame(int i){Native.Rect r;Native.GetWindowRect(fixtures[i].Handle,out r);return r;}
    void Wait(){Thread.Sleep(180);Call("snapshot");}
    void Run(){try{
        Directory.CreateDirectory(cache);string legacy=Path.Combine(cache,"legacy-windows.json");
        File.WriteAllText(legacy,json.Serialize(new[]{new{Id="legacy-peer",Handle=fixtures[0].Handle.ToInt64(),Pid=Process.GetCurrentProcess().Id,Started=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,Active=true}}));
        StartEndpoint();Call("mount",Args("rect",Rect(),"headerHeight",32,"legacyMount",legacy));
        Check(Groups.Length==1&&(string)Group("main")["id"]=="main","production mount begins with one group");
        Check(Tabs("main").SequenceEqual(new[]{"legacy-peer"})&&(string)Group("main")["selected"]=="legacy-peer","first production mount migrates legacy membership and stable active identity");
        var ids=new List<string>{"legacy-peer"};foreach(var f in fixtures.Skip(1))ids.Add((string)Call("attach",Args("handle",f.Handle.ToInt64(),"pid",Process.GetCurrentProcess().Id,"groupId","main"))["tabId"]);
        Check(Tabs("main").Length==3&&Native.IsIconic(fixtures[0].Handle)&&!Native.IsIconic(fixtures[2].Handle),"attach retains all peers and minimizes inactive tabs");
        Call("select",Args("groupId","main","tabId",ids[0]));Check(!Native.IsIconic(fixtures[0].Handle)&&Native.IsIconic(fixtures[2].Handle),"actual pipe selection changes native show states");
        Call("split",Args("groupId","main","tabId",ids[2],"newGroupId","right","side","right"));
        Check(Groups.Length==2&&!Native.IsIconic(fixtures[0].Handle)&&!Native.IsIconic(fixtures[2].Handle),"two selected native groups present together");
        var a=Frame(0);var b=Frame(2);Check(a.R==b.L&&a.T==b.T,"production pipe fits adjoining native frames without a gap");
        var originalMainTabs=Tabs("main");var selectedMain=(string)Group("main")["selected"];
        Call("relocate-group",Args("groupId","main","destination","right","side","center"));
        Check(Frame(0).Box==b.Box&&Frame(2).Box==a.Box&&Tabs("main").SequenceEqual(originalMainTabs)&&(string)Group("main")["selected"]==selectedMain,"group swap exchanges slots without changing membership or selection");
        Call("relocate-group",Args("groupId","main","destination","right","side","center"));
        Call("relocate-group",Args("groupId","main","destination","right","side","right"));
        Check(Frame(0).L==b.L&&Tabs("main").SequenceEqual(originalMainTabs),"whole group edge reorder retains all native tabs");
        Call("relocate-group",Args("groupId","main","destination","right","side","left"));
        Check(Frame(0).Box==a.Box&&Frame(2).Box==b.Box,"reverse whole-group reorder restores original layout");
        var beforeMinA=a;var beforeMinB=b;var beforeMinTree=json.Serialize(State["tree"]);
        Call("presentation",Args("groupId","main","mode","minimized"));b=Frame(2);
        var minimizedSlot=D(Group("main")["slot"]);var remainingSlot=D(Group("right")["slot"]);var rootViewport=D(State["viewport"]);
        Check(Convert.ToDouble(minimizedSlot["width"])==32&&Convert.ToDouble(minimizedSlot["height"])==Convert.ToDouble(rootViewport["height"])&&
            Frame(2).L==beforeMinA.L+32&&Frame(2).R-Frame(2).L==Convert.ToDouble(rootViewport["width"])-32&&Frame(2).T==beforeMinB.T&&Native.IsIconic(fixtures[0].Handle),"minimized column keeps its local strip while active content reclaims the width");
        Call("viewport",Args("rect",Rect()));
        Check(Frame(2).Box==b.Box&&json.Serialize(State["tree"])==beforeMinTree,"viewport replay preserves collapsed presentation without rewriting authored split");
        Call("presentation",Args("groupId","main","mode","normal"));
        Check(Frame(0).Box==beforeMinA.Box&&Frame(2).Box==beforeMinB.Box,"restoring minimized group restores exact saved native split geometry");
        Call("document-add",Args("groupId","main","tabId","preview:fixture"));Call("select",Args("groupId","main","tabId","preview:fixture"));
        Check(Native.IsIconic(fixtures[0].Handle)&&!Native.IsIconic(fixtures[2].Handle),"document selection suppresses only its own group's native peer");
        Call("document-add",Args("groupId","main","tabId","preview:collapsed"));
        Call("split",Args("groupId","main","tabId","preview:collapsed","newGroupId","bottom","side","bottom"));
        var nestedNormal=json.Serialize(State["tree"]);var rightBeforeCollapse=Frame(2);
        Call("presentation",Args("groupId","bottom","mode","minimized"));
        Check(Convert.ToDouble(D(Group("main")["slot"])["height"])==Convert.ToDouble(D(State["viewport"])["height"])-32&&
            Frame(2).Box==rightBeforeCollapse.Box&&json.Serialize(State["tree"])==nestedNormal,"nested minimized leaf releases its vertical space without destroying saved topology");
        Call("presentation",Args("groupId","bottom","mode","normal"));
        Call("presentation",Args("groupId","right","mode","minimized"));
        var rightStrip=D(Group("right")["slot"]);var expandedLeft=D(Group("main")["slot"]);
        Check(Convert.ToDouble(rightStrip["x"])>Convert.ToDouble(D(State["viewport"])["x"])&&Convert.ToDouble(rightStrip["width"])==32&&
            Convert.ToDouble(expandedLeft["width"])==Convert.ToDouble(D(State["viewport"])["width"])-32,"minimized right column retains right-hand strip while nested left panes reclaim its width");
        Call("presentation",Args("groupId","right","mode","normal"));
        Call("presentation",Args("groupId","bottom","mode","minimized"));
        Call("presentation",Args("groupId","main","mode","minimized"));
        var upperRail=D(Group("main")["slot"]);var lowerRail=D(Group("bottom")["slot"]);
        Check(Convert.ToDouble(upperRail["width"])==32&&Convert.ToDouble(lowerRail["width"])==32&&
            Convert.ToDouble(upperRail["x"])==Convert.ToDouble(lowerRail["x"])&&Convert.ToDouble(upperRail["y"])+Convert.ToDouble(upperRail["height"])==Convert.ToDouble(lowerRail["y"]),"fully minimized nested column shares one vertical strip in adjacent sections");
        Call("presentation",Args("groupId","main","mode","normal"));
        var minimizedFrame=Frame(2);Call("release-host");endpoint.WaitForExit(5000);
        snapshots.Clear();StartEndpoint();token="minimized-remount";Call("mount",Args("rect",Rect(),"headerHeight",32));
        Check((string)Group("bottom")["presentation"]=="minimized"&&Frame(2).Box==minimizedFrame.Box,"fresh process restores minimized topology and compact native presentation");
        b=Frame(2);int projectedBoundary=b.L-12;
        NotifyWinEvent(0xA,fixtures[2].Handle,0,0);Thread.Sleep(100);
        Native.SetWindowPos(fixtures[2].Handle,IntPtr.Zero,projectedBoundary,b.T,b.R-projectedBoundary,b.B-b.T,0x14);Wait();
        NotifyWinEvent(0xB,fixtures[2].Handle,0,0);Wait();Call("viewport",Args("rect",Rect()));
        Check(Frame(2).L==projectedBoundary&&Convert.ToDouble(D(Group("main")["slot"])["x"])+Convert.ToDouble(D(Group("main")["slot"])["width"])==Convert.ToDouble(D(Group("right")["slot"])["x"]),
            "native shared edge remains authoritative while a nested group is minimized");
        Call("presentation",Args("groupId","bottom","mode","normal"));
        Check(Frame(2).L==projectedBoundary&&Frame(2).T==rightBeforeCollapse.T,"restore preserves subsequently authored native boundary and releases restore-strip height");
        Call("close-group",Args("groupId","bottom","destination","main"));Call("document-remove",Args("tabId","preview:collapsed"));
        Call("reorder",Args("groupId","main","tabId","preview:fixture","beforeId",ids[0]));Check(Tabs("main")[0]=="preview:fixture","mixed preview/native order is authoritative");
        int neighbor=Frame(2).L;double edge=Convert.ToDouble(D(Group("main")["slot"])["width"])-20;
        Call("document-edge",Args("groupId","main","edge","right","position",edge));
        Check(Frame(2).L==neighbor-20,"document edge resizes the shared native boundary through the same layout owner");
        var edgeReject=Call("document-edge",Args("groupId","main","edge","right","position",1),false);
        Check(!Convert.ToBoolean(edgeReject["ok"])&&Frame(2).L==neighbor-20,"rejected document edge leaves neighboring placement intact");
        var viewportReject=Call("viewport",Args("rect",Args("x",999,"y",999,"width",1,"height",1)),false);
        Check(!Convert.ToBoolean(viewportReject["ok"])&&Frame(2).L==neighbor-20,"rejected root viewport preserves native placement and retained host geometry");
        var stale=Call("select",Args("groupId","main","tabId",ids[1],"revision",1),false);
        Check(!Convert.ToBoolean(stale["ok"])&&(string)Group("main")["selected"]=="preview:fixture","stale command cannot reverse the current tab");
        Call("select",Args("groupId","main","tabId",ids[0]));a=Frame(0);int left=a.L-45;
        NotifyWinEvent(0xA,fixtures[0].Handle,0,0);Thread.Sleep(100);Native.SetWindowPos(fixtures[0].Handle,IntPtr.Zero,left,a.T,a.R-left,a.B-a.T,0x14);Wait();
        NotifyWinEvent(0xB,fixtures[0].Handle,0,0);Wait();
        Check(Frame(0).L==left&&Math.Abs(Convert.ToDouble(D(State["viewport"])["x"])-405)<3,"native outer edge authors the production viewport");
        Call("viewport",Args("rect",Rect()));Check(Frame(0).L==left,"old page viewport replay cannot undo native edge authority");
        int hostLeft=Left;BeginInvoke((Action)(()=>Left+=30));Wait();Check(Frame(0).L==left+30,"moving Papers translates all native frames once");
        Call("presentation",Args("groupId","main","mode","maximized"));Call("select",Args("groupId","right","tabId",ids[2]));
        Check(Native.IsIconic(fixtures[2].Handle)&&!Native.IsIconic(fixtures[0].Handle),"selection in another group honors maximized visibility");
        Call("presentation",Args("groupId","main","mode","normal"));
        scope=new string('b',64);token="proxima";Call("mount",Args("rect",Rect(),"headerHeight",32));
        Check(Native.IsIconic(fixtures[0].Handle)&&Native.IsIconic(fixtures[2].Handle),"mounting another Backpack suspends previous membership");
        scope=new string('a',64);token="remounted";Call("mount",Args("rect",Rect(),"headerHeight",32));
        Check(Groups.Length==2&&Tabs("main").Contains("preview:fixture")&&!Native.IsIconic(fixtures[0].Handle),"same-host remount retains topology and mixed membership");
        token="first";var rejected=Call("select",Args("groupId","main","tabId",ids[1]),false);Check(!Convert.ToBoolean(rejected["ok"]),"old surface binding cannot select retained windows");token="remounted";
        Call("release-host");endpoint.WaitForExit(5000);Check(endpoint.HasExited,"production endpoint exits after release acknowledgement");
        for(int i=0;i<fixtures.Count;i++)Check(Frame(i).Box==originals[i].Box&&!Native.IsIconic(fixtures[i].Handle),"release restores exact original fixture "+i);
        snapshots.Clear();StartEndpoint();token="restart";Call("mount",Args("rect",Rect(),"headerHeight",32));
        Check(Groups.Length==2&&Tabs("main").Contains("preview:fixture")&&Tabs("right").Contains(ids[2]),"fresh production process restores checkpoint topology and stable tab identities");
        Call("close-group",Args("groupId","right","destination","main"));Check(Groups.Length==1&&Tabs("main").Length==4,"group X merges documents and windows without detaching");
        Call("select",Args("groupId","main","tabId",ids[0]));a=Frame(0);int narrowLeft=a.R-500;
        NotifyWinEvent(0xA,fixtures[0].Handle,0,0);Thread.Sleep(100);
        Native.SetWindowPos(fixtures[0].Handle,IntPtr.Zero,narrowLeft,a.T,500,a.B-a.T,0x14);Wait();
        NotifyWinEvent(0xB,fixtures[0].Handle,0,0);Wait();
        Check(Frame(0).L==narrowLeft&&Frame(0).R==a.R&&Convert.ToDouble(D(State["viewport"])["width"])==500&&Native.IsIconic(fixtures[1].Handle),
            "inactive wide tab cannot veto selected native edge or snap it back");
        Call("viewport",Args("rect",Rect()));Check(Frame(0).L==narrowLeft,"narrowed selected edge survives stale page viewport");
        long edgeBefore=N(State,"nativeEdgeRevision");Call("select",Args("groupId","main","tabId",ids[1]));b=Frame(1);
        Check((string)Group("main")["selected"]==ids[1]&&b.R==a.R&&b.R-b.L==700&&N(State,"nativeEdgeRevision")>edgeBefore&&Native.IsIconic(fixtures[0].Handle),
            "selecting wider native tab widens root once and publishes authoritative seam");
        Call("select",Args("groupId","main","tabId",ids[0]));
        NotifyWinEvent(0xA,fixtures[0].Handle,0,0);Thread.Sleep(100);
        Native.SetWindowPos(fixtures[0].Handle,IntPtr.Zero,narrowLeft,a.T,500,a.B-a.T,0x14);Wait();
        NotifyWinEvent(0xB,fixtures[0].Handle,0,0);Wait();Call("release-host");endpoint.WaitForExit(5000);
        snapshots.Clear();StartEndpoint();token="narrow-restart";Call("mount",Args("rect",Rect(),"headerHeight",32));
        Check(Frame(0).L==narrowLeft&&Frame(0).R==a.R&&Tabs("main").Contains(ids[1])&&Native.IsIconic(fixtures[1].Handle),
            "restart restores narrow selected pane while retaining oversized inactive tab");
        Call("release-host");endpoint.WaitForExit(5000);
    }catch(Exception e){checks.Add("FAIL "+e);}finally{
        try{if(endpoint!=null&&!endpoint.HasExited){endpoint.StandardInput.Close();if(!endpoint.WaitForExit(5000))endpoint.Kill();}}catch{}
        if(checks.Any(c=>c.StartsWith("FAIL"))&&endpoint!=null&&endpoint.HasExited)checks.Add("FAIL endpoint diagnostics: "+endpoint.StandardError.ReadToEnd());
        File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"pipe-result.txt"),checks.ToArray());
        BeginInvoke((Action)(()=>{foreach(var f in fixtures)f.Close();Close();}));
    }}
}

