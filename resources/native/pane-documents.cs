using System;
using System.Collections.Generic;
using System.Linq;

public sealed class PaneDocumentRef {public string Id,Path,Name;}

public sealed partial class PaneCoordinator {
    // Opaque renderer document references only. File paths and preview engines
    // remain owned by the Backpack and its existing preview capability.
    readonly Dictionary<string,string> documentGroups=new Dictionary<string,string>();
    readonly Dictionary<string,PaneMountPeer> dormantPeers=new Dictionary<string,PaneMountPeer>();
    readonly Dictionary<string,PaneDocumentRef> documentReferences=new Dictionary<string,PaneDocumentRef>();
    public PaneDocumentRef DocumentReference(string id){PaneDocumentRef data;return documentReferences.TryGetValue(id,out data)?data:null;}
    public void SetDocumentReference(PaneDocumentRef data){if(data!=null&&IsDocument(data.Id)&&Dormant(data.Id)==null)documentReferences[data.Id]=data;}
    public PaneMountPeer Dormant(string id){PaneMountPeer peer;return dormantPeers.TryGetValue(id,out peer)?peer:null;}
    public void AddDormant(PaneMountPeer peer,string groupId){
        if(peer==null||string.IsNullOrEmpty(peer.TabId)||tabIndex.ContainsKey(peer.TabId)||documentGroups.ContainsKey(peer.TabId))throw new Exception("Invalid dormant reference.");
        var group=Group(groupId);peer.GroupId=groupId;dormantPeers.Add(peer.TabId,peer);documentGroups.Add(peer.TabId,groupId);
        group.OrderedTabs.Add(peer.TabId);if(group.SelectedTab==null)group.SelectedTab=peer.TabId;Scope.StateRevision++;
    }
    public string Reconnect(string id,IntPtr handle,uint pid,long binding,long state){
        Check(binding,state);var saved=Dormant(id);if(saved==null)throw new Exception("That tab is already connected.");
        var group=Group(TabGroup(id));string oldPresentation=group.Presentation;if(group.Presentation=="minimized")SetGroupPresentation(group.Id,"normal",binding,Scope.StateRevision);int index=group.OrderedTabs.IndexOf(id);bool selected=group.SelectedTab==id;
        group.OrderedTabs.Remove(id);documentGroups.Remove(id);dormantPeers.Remove(id);if(selected)group.SelectedTab=null;
        try{
            string tab=Attach(handle,pid,group.Id,binding,Scope.StateRevision,id);
            var peer=Find(tab);peer.RestoreUrl=saved.Url;peer.LastTitle=saved.Title;peer.LastIcon=saved.Icon;
            group.OrderedTabs.Remove(id);group.OrderedTabs.Insert(index,id);if(selected)SelectTab(group.Id,id,binding,Scope.StateRevision);Notify("reconnect");return tab;
        }catch{documentGroups[id]=group.Id;dormantPeers[id]=saved;group.OrderedTabs.Remove(id);group.OrderedTabs.Insert(index,id);if(selected)group.SelectedTab=id;if(oldPresentation=="minimized")SetGroupPresentation(group.Id,oldPresentation,binding,Scope.StateRevision);Paint();throw;}
    }
    public string TabGroup(string id){PanePeer peer;string group;
        if(tabIndex.TryGetValue(id,out peer))return peer.GroupId;
        if(documentGroups.TryGetValue(id,out group))return group;
        throw new Exception("Unknown tab.");
    }
    public bool IsDocument(string id){return documentGroups.ContainsKey(id);}
    public void ResizeDocumentEdge(string groupId,string edge,int offset,long binding,long state){
        Check(binding,state);var group=Group(groupId);
        if(!IsDocument(group.SelectedTab)||group.Presentation!="normal"||!new[]{"left","right","top","bottom"}.Contains(edge))throw new Exception("Only a visible document edge can use this resize route.");
        var viewport=Scope.Viewport;var frame=group.ResolvedFrame;
        int proposed=(edge=="left"||edge=="right"?viewport.Left:viewport.Top)+offset;
        if(proposed==(edge=="left"?frame.Left:edge=="right"?frame.Right:edge=="top"?frame.Top:frame.Bottom))return;
        Change("document-edge-resize",()=>{
            int position=(edge=="left"||edge=="right"?Scope.Viewport.Left:Scope.Viewport.Top)+offset;
            if(PaneLayout.AcceptEdge(Scope,groupId,edge,position,MinimumSize))return;
            if(edge=="left"&&PaneLayout.Slot(Scope,group).Left==Scope.Viewport.Left){
                Scope.Viewport=System.Drawing.Rectangle.FromLTRB(position,viewport.Top,viewport.Right,viewport.Bottom);
                PaneLayout.PreserveScopeBoundaries(Scope,Scope.Viewport);Native.Rect hostBox;
                if(Native.GetWindowRect(host,out hostBox))authoredLeftOffset=position-hostBox.L;Scope.NativeEdgeRevision++;return;
            }throw new Exception("This edge does not own a split boundary.");
        });
    }
    public void AddDocument(string id,string groupId,long binding,long state){
        Check(binding,state);var group=Group(groupId);
        if(string.IsNullOrEmpty(id)||!id.StartsWith("preview:")||id.Length>64)throw new Exception("Invalid document tab reference.");
        if(documentGroups.ContainsKey(id))return;
        if(tabIndex.ContainsKey(id))throw new Exception("Duplicate tab identity.");
        Change("addDocument",()=>{documentGroups.Add(id,groupId);group.OrderedTabs.Add(id);if(group.SelectedTab==null)group.SelectedTab=id;});
    }
    public void RemoveDocument(string id,long binding,long state){
        Check(binding,state);if(!documentGroups.ContainsKey(id))return;
        var group=Group(documentGroups[id]);
        Change("removeDocument",()=>{group.OrderedTabs.Remove(id);documentGroups.Remove(id);dormantPeers.Remove(id);documentReferences.Remove(id);
            if(group.SelectedTab==id)group.SelectedTab=group.OrderedTabs.FirstOrDefault();});
    }
}
