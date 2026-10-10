using System;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;

public sealed class PaneDocumentRef {public string Id,Path,Name,PageKey,TabStyle;}

public sealed partial class PaneCoordinator {
    // Opaque renderer document references only. File paths and preview engines
    // remain owned by the Backpack and its existing preview capability.
    readonly Dictionary<string,string> documentGroups=new Dictionary<string,string>();
    readonly Dictionary<string,PaneMountPeer> dormantPeers=new Dictionary<string,PaneMountPeer>();
    readonly Dictionary<string,PaneDocumentRef> documentReferences=new Dictionary<string,PaneDocumentRef>();
    bool protectedPanelsMigrated;
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
    // Restore both protected panels atomically. Separate add/split commands
    // previously left a panel behind an unrelated tab when a split failed.
    public void EnsureWorkspacePanels(Rectangle requested,long binding,long state){
        Check(binding,state);
        const string files="preview:workspace-files",preview="preview:workspace-preview";
        const string filesGroup="system-workspace-files",previewGroup="system-workspace-preview";
        if(requested.Width<PaneLayout.DefaultMinWidth||requested.Height<PaneLayout.DefaultMinHeight)
            throw new Exception("Project viewport is too small for page panels.");
        bool exact=Scope.Groups.ContainsKey(filesGroup)&&Scope.Groups.ContainsKey(previewGroup)&&
            Group(filesGroup).OrderedTabs.SequenceEqual(new[]{files})&&Group(previewGroup).OrderedTabs.SequenceEqual(new[]{preview})&&
            Group(filesGroup).Presentation=="normal"&&Group(previewGroup).Presentation=="normal";
        // After a successful migration the creator can freely move or tab
        // either panel. Later restarts must never overwrite that authored
        // layout just because its groups no longer have fixed system names.
        if(protectedPanelsMigrated&&documentGroups.ContainsKey(files)&&documentGroups.ContainsKey(preview))return;
        if(exact&&Scope.Viewport.Equals(requested)){protectedPanelsMigrated=true;return;}
        Change("ensure-workspace-panels",()=>{
            // The old native left edge reserved the Files/Preview column.
            // Reclaim it against the actual project viewport once.
            authoredLeftOffset=null;Scope.Viewport=requested;
            foreach(var id in new[]{files,preview}){
                string old;if(!documentGroups.TryGetValue(id,out old))continue;
                var group=Group(old);group.OrderedTabs.Remove(id);
                if(group.SelectedTab==id)group.SelectedTab=group.OrderedTabs.FirstOrDefault();
                documentGroups.Remove(id);
            }
            // Remove empty *system* panel leaves only. Never delete user groups.
            foreach(var id in new[]{filesGroup,previewGroup}){
                PaneGroup group;if(!Scope.Groups.TryGetValue(id,out group))continue;
                if(group.OrderedTabs.Count>0)throw new Exception("A reserved panel group contains unrelated tabs.");
                Scope.Root=PaneLayout.Remove(Scope.Root,id);
                Scope.Groups.Remove(id);Scope.Order.Remove(id);
            }
            if(Scope.Root==null)throw new Exception("The application layout is unavailable.");
            var application=Scope.Root;
            var nativeMin=PaneLayout.PresentedMinimumForWorkspace(application,Scope,MinimumSize);
            bool column=requested.Width>=nativeMin.Width+PaneLayout.DefaultMinWidth&&
                requested.Height>=Math.Max(nativeMin.Height,2*(PaneLayout.DefaultMinHeight+Scope.HeaderHeight));
            bool row=requested.Height>=nativeMin.Height+PaneLayout.DefaultMinHeight+Scope.HeaderHeight&&
                requested.Width>=Math.Max(nativeMin.Width,2*PaneLayout.DefaultMinWidth);
            if(!column&&!row)throw new Exception("Not enough room for Files and Preview; previous layout retained.");
            Scope.Add(filesGroup);Scope.Add(previewGroup);
            var first=Group(filesGroup);first.OrderedTabs.Add(files);first.SelectedTab=files;first.Presentation="normal";
            var second=Group(previewGroup);second.OrderedTabs.Add(preview);second.SelectedTab=preview;second.Presentation="normal";
            documentGroups[files]=filesGroup;documentGroups[preview]=previewGroup;
            bool landscape=column&&(requested.Width>=requested.Height||!row);
            var pair=new PaneSplit{Axis=landscape?"Y":"X",Ratio=.5,
                First=PaneLayout.Leaf(filesGroup),Second=PaneLayout.Leaf(previewGroup)};
            double share=landscape?Math.Min(.36,Math.Max(.22,320.0/requested.Width)):
                Math.Min(.4,Math.Max(.2,330.0/requested.Height));
            Scope.Root=new PaneSplit{Axis=landscape?"X":"Y",Ratio=share,First=pair,Second=application};
            Scope.Order.Clear();Scope.Order.AddRange(PaneLayout.Leaves(Scope.Root));Scope.Ratio=Scope.Root.Ratio;
            protectedPanelsMigrated=true;
        });
    }
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
        if(id=="preview:workspace-files"||id=="preview:workspace-preview")throw new Exception("Files and Preview belong to this page and cannot be deleted.");
        Check(binding,state);if(!documentGroups.ContainsKey(id))return;
        var group=Group(documentGroups[id]);
        Change("removeDocument",()=>{group.OrderedTabs.Remove(id);documentGroups.Remove(id);dormantPeers.Remove(id);documentReferences.Remove(id);
            if(group.SelectedTab==id)group.SelectedTab=group.OrderedTabs.FirstOrDefault();});
    }
}
