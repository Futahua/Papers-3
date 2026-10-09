using System;
using System.Collections.Generic;
using System.Linq;

public sealed partial class PaneCoordinator {
    // Opaque renderer document references only. File paths and preview engines
    // remain owned by the Backpack and its existing preview capability.
    readonly Dictionary<string,string> documentGroups=new Dictionary<string,string>();
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
        Change("removeDocument",()=>{group.OrderedTabs.Remove(id);documentGroups.Remove(id);
            if(group.SelectedTab==id)group.SelectedTab=group.OrderedTabs.FirstOrDefault();});
    }
}
