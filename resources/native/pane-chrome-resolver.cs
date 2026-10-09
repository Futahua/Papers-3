using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// Chrome keeps its own native UI and profile. Accessibility resolves/activates
// browser tabs; only PaneCoordinator owns window geometry and HWND leases.
public sealed class PaneChromeResolver {
    delegate bool EnumProc(IntPtr hwnd,IntPtr data);
    [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder name,int count);
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
    sealed class Tab {public IntPtr Window;public string Key;public AutomationElement Element;}
    public sealed class Link {public string Url,TabKey;}
    readonly string chrome,file;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly Dictionary<string,Link> links;
    public PaneChromeResolver(string executable,string stateFile){chrome=executable;file=stateFile;
        try{links=json.Deserialize<Dictionary<string,Link>>(File.ReadAllText(file));}catch{links=new Dictionary<string,Link>();}}
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

    public long Resolve(string source,string url,long[] owned){
        Uri parsed;if(!Uri.TryCreate(url,UriKind.Absolute,out parsed)||(parsed.Scheme!="http"&&parsed.Scheme!="https"))throw new Exception("Only HTTP and HTTPS links are supported.");
        url=parsed.AbsoluteUri;var all=Tabs();var tabs=all.Where(t=>owned.Contains(t.Window.ToInt64())).ToList();Link link;
        var selected=links.TryGetValue(source,out link)&&link.Url==url?tabs.FirstOrDefault(t=>t.Key==link.TabKey):null;
        if(source=="workspace:resume")selected=tabs.FirstOrDefault(Selected);
        if(selected==null)selected=tabs.FirstOrDefault(t=>ActiveUrlMatches(t,url));
        if(selected==null){
            var before=new HashSet<string>(all.Select(t=>t.Key));
            if(tabs.Count>0)SetForegroundWindow(tabs[0].Window);
            using(var launch=Process.Start(new ProcessStartInfo(chrome,(tabs.Count==0?"--new-window ":"--new-tab ")+"\""+url+"\""){UseShellExecute=false,CreateNoWindow=true})){}
            var watch=Stopwatch.StartNew();
            while(watch.ElapsedMilliseconds<9000){
                var added=Tabs().Where(t=>!before.Contains(t.Key)).ToList();
                var matching=added.Where(t=>ActiveUrlMatches(t,url)).ToList();
                if(matching.Count==1){selected=matching[0];break;}
                if(added.Count==1){selected=added[0];break;}Thread.Sleep(150);
            }
            if(selected==null)throw new Exception("Chrome opened the link, but the new tab could not be identified.");
        }
        object pattern;if(!selected.Element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out pattern))throw new Exception("Chrome tab selection unavailable.");
        ((SelectionItemPattern)pattern).Select();
        if(source!="workspace:resume")links[source]=new Link{Url=url,TabKey=selected.Key};
        var tmp=file+".tmp";File.WriteAllText(tmp,json.Serialize(links));if(File.Exists(file))File.Replace(tmp,file,null);else File.Move(tmp,file);
        return selected.Window.ToInt64();
    }
}
