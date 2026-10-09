using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;

// Local runtime checkpoint; never written into a Backpack document or user profile.
public sealed class PaneMountPeer { public string TabId,GroupId;public long Handle,Started;public uint Pid; }
public sealed class PaneMountGroup { public string Id,Selected,Presentation;public string[] Tabs; }
public sealed class PaneMount {
    public int Version=1,OwnerPid,HeaderHeight;
    public long OwnerStarted,BindingGeneration;
    public string Recovery,RecoveryGeneration;
    public int? LeftOffset;
    public PaneSplit Root;
    public List<PaneMountGroup> Groups=new List<PaneMountGroup>();
    public List<PaneMountPeer> Peers=new List<PaneMountPeer>();
}
public sealed partial class PaneCoordinator {
    public void SaveMount(string path){
        if(stopped||Scope.Groups.Values.Any(g=>g.Gesture!=null))throw new Exception("Cannot checkpoint released scope or active resize.");
        PaneLayout.Ensure(Scope);
        var data=new PaneMount{OwnerPid=Process.GetCurrentProcess().Id,OwnerStarted=Started((uint)Process.GetCurrentProcess().Id),
            BindingGeneration=Scope.BindingGeneration,Recovery=recoveryFile,RecoveryGeneration=recoveryGeneration,LeftOffset=authoredLeftOffset,Root=Scope.Root.Copy(),HeaderHeight=Scope.HeaderHeight};
        foreach(var id in Scope.Order){var g=Group(id);data.Groups.Add(new PaneMountGroup{Id=id,Selected=g.SelectedTab,Presentation=g.Presentation,Tabs=g.OrderedTabs.ToArray()});}
        foreach(var peer in tabIndex.Values)data.Peers.Add(new PaneMountPeer{TabId=peer.TabId,GroupId=peer.GroupId,
            Handle=peer.Session.Handle.ToInt64(),Pid=peer.Session.Saved.Pid,Started=Started(peer.Session.Saved.Pid)});
        var full=Path.GetFullPath(path);Directory.CreateDirectory(Path.GetDirectoryName(full));
        var temp=full+".tmp";File.WriteAllText(temp,json.Serialize(data));
        if(File.Exists(full))File.Replace(temp,full,null);else File.Move(temp,full);
        Log("checkpoint",null,null,null,full);
    }
    public string[] RestoreMount(string path,Rectangle viewport){
        if(stopped||tabIndex.Count!=0)throw new Exception("Remount requires an empty live coordinator.");
        var data=json.Deserialize<PaneMount>(File.ReadAllText(path));
        if(data==null||data.Version!=1||data.Root==null||data.Groups.Count==0)throw new Exception("Invalid native mount checkpoint.");
        if(data.HeaderHeight!=Scope.HeaderHeight)throw new Exception("Checkpoint header geometry does not match this host.");
        var ids=data.Groups.Select(g=>g.Id).ToArray();
        if(ids.Distinct().Count()!=ids.Length||!PaneLayout.Leaves(data.Root).OrderBy(x=>x).SequenceEqual(ids.OrderBy(x=>x)))throw new Exception("Checkpoint topology does not match groups.");
        // Old leases and restoration must finish before capturing a new original placement.
        if(!ReleasedMarker(data.Recovery,data.RecoveryGeneration)){
            if(Started((uint)data.OwnerPid)==data.OwnerStarted)throw new Exception("Checkpoint owner is still running.");
            var until=DateTime.UtcNow.AddSeconds(4);
            while(!File.Exists(data.Recovery+".recovered")&&!File.Exists(data.Recovery+".failed")&&DateTime.UtcNow<until)Thread.Sleep(25);
            if(!File.Exists(data.Recovery+".recovered"))throw new Exception("Wait for successful crash recovery before remount.");
        }
        var omitted=new List<string>();
        Scope.Groups.Clear();Scope.Order.Clear();Scope.Root=data.Root.Copy();Scope.Presented=false;
        Scope.BindingGeneration=data.BindingGeneration+1;authoredLeftOffset=data.LeftOffset;
        foreach(var g in data.Groups)Scope.Add(g.Id);
        SetViewport(viewport,Scope.ViewportRevision+1);
        try{
            foreach(var group in data.Groups)foreach(var tab in group.Tabs){
                var p=data.Peers.SingleOrDefault(peer=>peer.TabId==tab&&peer.GroupId==group.Id);
                uint actual;
                if(p==null||Started(p.Pid)!=p.Started||Native.GetWindowThreadProcessId(new IntPtr(p.Handle),out actual)==0||actual!=p.Pid){omitted.Add(tab);continue;}
                Attach(new IntPtr(p.Handle),p.Pid,group.Id,Scope.BindingGeneration,Scope.StateRevision,p.TabId);
            }
            foreach(var saved in data.Groups){var g=Group(saved.Id);
                g.SelectedTab=g.OrderedTabs.Contains(saved.Selected)?saved.Selected:g.OrderedTabs.FirstOrDefault();
                g.Presentation=saved.Presentation=="minimized"||saved.Presentation=="maximized"?saved.Presentation:"normal";
            }
            // Attach temporarily selected each group's first peer. Suppress all before presenting final choices.
            foreach(var p in tabIndex.Values)ShowPeer(p,false);
            SetPresented(true);Notify("remount");return omitted.ToArray();
        }catch{
            foreach(var p in tabIndex.Values.ToArray())try{DetachTab(p.TabId,Scope.BindingGeneration,Scope.StateRevision);}catch{}
            throw;
        }
    }
}
