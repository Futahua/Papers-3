using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;

// Local runtime checkpoint; never written into a Backpack document or user profile.
public sealed class PaneMountPeer { public string TabId,GroupId,Title,Icon,Url;public long Handle,Started,InstanceMark;public uint Pid; }
public sealed class PaneMountGroup { public string Id,Selected,Presentation;public string[] Tabs; }
public sealed class PaneMount {
    public int Version=1,OwnerPid,HeaderHeight;
    public long OwnerStarted,BindingGeneration;
    public string Recovery,RecoveryGeneration;
    public int? LeftOffset;
    public PaneSplit Root;
    public List<PaneMountGroup> Groups=new List<PaneMountGroup>();
    public List<PaneMountPeer> Peers=new List<PaneMountPeer>();
    public List<string> Documents=new List<string>();
    public List<PaneDocumentRef> DocumentReferences=new List<PaneDocumentRef>();
}
public sealed partial class PaneCoordinator {
    public static string IntentPath(string mount){return Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(mount))),"pane-layouts",Path.GetFileName(mount));}
    public void SaveMount(string path){
        if(stopped||Scope.Groups.Values.Any(g=>g.Gesture!=null))throw new Exception("Cannot checkpoint released scope or active resize.");
        RecoverWrite();
        PaneLayout.Ensure(Scope);
        var data=new PaneMount{OwnerPid=Process.GetCurrentProcess().Id,OwnerStarted=Started((uint)Process.GetCurrentProcess().Id),
            BindingGeneration=Scope.BindingGeneration,Recovery=recoveryFile,RecoveryGeneration=recoveryGeneration,LeftOffset=authoredLeftOffset,Root=Scope.Root.Copy(),HeaderHeight=Scope.HeaderHeight};
        foreach(var id in Scope.Order){var g=Group(id);data.Groups.Add(new PaneMountGroup{Id=id,Selected=g.SelectedTab,Presentation=g.Presentation,Tabs=g.OrderedTabs.ToArray()});}
        foreach(var peer in tabIndex.Values)data.Peers.Add(new PaneMountPeer{TabId=peer.TabId,GroupId=peer.GroupId,
            Title=peer.LastTitle,Icon=peer.LastIcon,Url=peer.RestoreUrl,
            Handle=peer.Session.Handle.ToInt64(),InstanceMark=peer.Session.Saved.InstanceMark,Pid=peer.Session.Saved.Pid,Started=Started(peer.Session.Saved.Pid)});
        foreach(var entry in dormantPeers){var peer=entry.Value;peer.GroupId=TabGroup(entry.Key);data.Peers.Add(peer);}
        data.Documents.AddRange(documentGroups.Keys.Where(id=>!dormantPeers.ContainsKey(id)));
        data.DocumentReferences.AddRange(documentReferences.Values);
        var full=Path.GetFullPath(path);Directory.CreateDirectory(Path.GetDirectoryName(full));
        WriteDurableJson(full,json.Serialize(data));
        // Durable intent is independent of the helper/PID/HWND checkpoint.
        string intent=IntentPath(full);Directory.CreateDirectory(Path.GetDirectoryName(intent));
        WriteDurableJson(intent,json.Serialize(new{Version=1,HeaderHeight=data.HeaderHeight,LeftOffset=data.LeftOffset,Root=data.Root,Groups=data.Groups,
            Peers=data.Peers.Select(p=>new{p.TabId,p.GroupId,p.Title,p.Icon,p.Url}).ToArray(),Documents=data.Documents,DocumentReferences=data.DocumentReferences}));
        Log("checkpoint",null,null,null,full);
    }
    public string[] RestoreMount(string path,Rectangle viewport,bool present=true){
        if(stopped||tabIndex.Count!=0)throw new Exception("Remount requires an empty live coordinator.");
        PaneMount data;
        if(!File.Exists(path)&&File.Exists(IntentPath(path)))path=IntentPath(path);
        try{data=json.Deserialize<PaneMount>(File.ReadAllText(path));}
        catch{data=json.Deserialize<PaneMount>(File.ReadAllText(path+".backup"));}
        if(data==null||data.Version!=1||data.Root==null||data.Groups.Count==0)throw new Exception("Invalid native mount checkpoint.");
        // Header pixels are host/DPI metrics, not authored split intent. Resolve
        // the saved tree using this mount's current metrics.
        var ids=data.Groups.Select(g=>g.Id).ToArray();
        if(ids.Distinct().Count()!=ids.Length||!PaneLayout.Leaves(data.Root).OrderBy(x=>x).SequenceEqual(ids.OrderBy(x=>x)))throw new Exception("Checkpoint topology does not match groups.");
        // Old leases and restoration must finish before capturing a new original placement.
        if(!ReleasedMarker(data.Recovery,data.RecoveryGeneration)&&data.Peers.Any(p=>Started(p.Pid)==p.Started&&p.Started!=0)){
            if(Started((uint)data.OwnerPid)==data.OwnerStarted)throw new Exception("Checkpoint owner is still running.");
            var until=DateTime.UtcNow.AddSeconds(4);
            while(!File.Exists(data.Recovery+".recovered")&&!File.Exists(data.Recovery+".failed")&&DateTime.UtcNow<until)Thread.Sleep(25);
            // After reboot none of the old processes/windows need restoration.
            // Do not require a marker from a guard that died with Windows.
            if(!File.Exists(data.Recovery+".recovered")&&data.Peers.Any(p=>Started(p.Pid)==p.Started&&p.Started!=0))throw new Exception("Wait for successful crash recovery before remount.");
        }
        var omitted=new List<string>();
        Scope.Groups.Clear();Scope.Order.Clear();Scope.Root=data.Root.Copy();Scope.Presented=false;
        Scope.BindingGeneration=data.BindingGeneration+1;authoredLeftOffset=data.LeftOffset;
        foreach(var g in data.Groups)Scope.Add(g.Id);
        SetViewport(viewport,Scope.ViewportRevision+1);
        try{
            foreach(var group in data.Groups)foreach(var tab in group.Tabs){
                if(data.Documents!=null&&data.Documents.Contains(tab)){AddDocument(tab,group.Id,Scope.BindingGeneration,Scope.StateRevision);
                    if(data.DocumentReferences!=null)SetDocumentReference(data.DocumentReferences.FirstOrDefault(d=>d.Id==tab));continue;}
                var p=data.Peers.SingleOrDefault(peer=>peer.TabId==tab&&peer.GroupId==group.Id);
                uint actual;
                if(p==null){omitted.Add(tab);continue;}
                if(Started(p.Pid)!=p.Started||p.Started==0||Native.GetWindowThreadProcessId(new IntPtr(p.Handle),out actual)==0||actual!=p.Pid||p.InstanceMark!=0&&Native.GetProp(new IntPtr(p.Handle),"Papers.WindowInstance").ToInt64()!=p.InstanceMark){AddDormant(p,group.Id);omitted.Add(tab);continue;}
                try{Attach(new IntPtr(p.Handle),p.Pid,group.Id,Scope.BindingGeneration,Scope.StateRevision,p.TabId);
                    var live=Find(p.TabId);live.LastTitle=p.Title;live.LastIcon=p.Icon;live.RestoreUrl=p.Url;
                }catch{AddDormant(p,group.Id);omitted.Add(tab);}
            }
            foreach(var saved in data.Groups){var g=Group(saved.Id);
                g.SelectedTab=g.OrderedTabs.Contains(saved.Selected)?saved.Selected:g.OrderedTabs.FirstOrDefault();
                g.Presentation=saved.Presentation=="minimized"||saved.Presentation=="maximized"?saved.Presentation:"normal";
                if(g.OrderedTabs.Count>0&&g.OrderedTabs.All(id=>Dormant(id)!=null))g.Presentation="minimized";
            }
            // Attach temporarily selected each group's first peer. Suppress all before presenting final choices.
            foreach(var p in tabIndex.Values)ShowPeer(p,false);
            SetPresented(present);Notify("remount");return omitted.ToArray();
        }catch{
            foreach(var p in tabIndex.Values.ToArray())try{DetachTab(p.TabId,Scope.BindingGeneration,Scope.StateRevision);}catch{}
            throw;
        }
    }
}
