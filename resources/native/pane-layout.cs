using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

// All coordinates are physical outer-window pixels. Only this tree owns boundaries.
public static class PaneLayout {
    public const int DefaultMinWidth=240,DefaultMinHeight=160;
    // Each leaf reserves host-owned chrome above its native content. Zero keeps
    // existing callers' outer-window geometry unchanged.
    public static Rectangle Content(PaneScope scope,Rectangle slot){
        return Rectangle.FromLTRB(slot.Left,slot.Top+scope.HeaderHeight,slot.Right,slot.Bottom);
    }
    public static Rectangle Slot(PaneScope scope,PaneGroup group){
        var frame=group.ResolvedFrame;
        return Rectangle.FromLTRB(frame.Left,frame.Top-scope.HeaderHeight,frame.Right,frame.Bottom);
    }
    static Size SlotMinimum(PaneScope scope,PaneGroup group,Func<PaneGroup,Size> minimum){
        var size=minimum(group);return new Size(size.Width,size.Height+scope.HeaderHeight);
    }
    public static PaneSplit Leaf(string id){return new PaneSplit{GroupId=id};}
    public static void Ensure(PaneScope scope){
        if(scope.Root!=null)return;
        if(scope.Order.Count==1)scope.Root=Leaf(scope.Order[0]);
        else if(scope.Order.Count==2)scope.Root=new PaneSplit{Axis="X",Ratio=scope.Ratio,
            First=Leaf(scope.Order[0]),Second=Leaf(scope.Order[1])};
    }
    public static IEnumerable<string> Leaves(PaneSplit node){
        if(node==null)yield break;
        if(node.Leaf){yield return node.GroupId;yield break;}
        foreach(var id in Leaves(node.First))yield return id;
        foreach(var id in Leaves(node.Second))yield return id;
    }
    public static Size Minimum(PaneSplit node,Func<string,Size> minimum){
        if(node.Leaf)return minimum(node.GroupId);
        var b=Minimum(node.Second,minimum);
        if(node.Span){var reserved=Minimum(node.First,ReserveSpan(node,minimum,b));return new Size(Math.Max(reserved.Width,b.Width),Math.Max(reserved.Height,b.Height));}
        var a=Minimum(node.First,minimum);
        return node.Axis=="X"?new Size(a.Width+b.Width,Math.Max(a.Height,b.Height)):
            new Size(Math.Max(a.Width,b.Width),a.Height+b.Height);
    }
    static bool ResolveNode(PaneSplit node,Rectangle area,Func<string,Size> minimum,Dictionary<string,Rectangle> frames){
        var min=Minimum(node,minimum);
        if(area.Width<min.Width||area.Height<min.Height)return false;
        node.Frame=area;
        if(node.Leaf){frames[node.GroupId]=area;return true;}
        if(node.Span){
            if(!ResolveNode(node.First,area,ReserveSpan(node,minimum,Minimum(node.Second,minimum)),frames))return false;
            return ResolveSpan(node,area,minimum,frames,(child,rect)=>ResolveNode(child,rect,minimum,frames));
        }
        var a=Minimum(node.First,minimum);var b=Minimum(node.Second,minimum);
        bool x=node.Axis=="X";int extent=x?area.Width:area.Height;
        int first=Math.Max(x?a.Width:a.Height,Math.Min(extent-(x?b.Width:b.Height),(int)Math.Round(extent*node.Ratio)));
        Rectangle left=x?new Rectangle(area.X,area.Y,first,area.Height):new Rectangle(area.X,area.Y,area.Width,first);
        Rectangle right=x?new Rectangle(area.X+first,area.Y,extent-first,area.Height):new Rectangle(area.X,area.Y+first,area.Width,extent-first);
        return ResolveNode(node.First,left,minimum,frames)&&ResolveNode(node.Second,right,minimum,frames);
    }
    public static bool ResolveWidths(PaneScope scope,Func<PaneGroup,int> width){
        return Resolve(scope,g=>new Size(Math.Max(DefaultMinWidth,width(g)),DefaultMinHeight));
    }
    public static bool Resolve(PaneScope scope,Func<PaneGroup,Size> minimum){
        if(scope.Order.Count==0)return true;
        Ensure(scope);if(scope.Root==null)return false;
        var candidate=scope.Root.Copy();var frames=new Dictionary<string,Rectangle>();
        // Resolve presentation inside each authored branch. Horizontal columns
        // retain their quadrant; vertical siblings reclaim only local height.
        var unused=new Dictionary<string,Rectangle>();
        ResolveNode(candidate,scope.Viewport,id=>Size.Empty,unused);
        if(!ResolvePresentation(candidate,scope.Viewport,scope,minimum,frames))return false;
        scope.Root=candidate;
        foreach(var pair in frames)scope.Groups[pair.Key].ResolvedFrame=Content(scope,pair.Value);
        return true;
    }
    static int StripHeight(PaneScope scope){return Math.Max(32,scope.HeaderHeight);}
    static bool Collapsed(PaneSplit node,PaneScope scope){return Leaves(node).All(id=>scope.Groups[id].Presentation=="minimized");}
    static Size PresentedMinimum(PaneSplit node,PaneScope scope,Func<PaneGroup,Size> minimum){
        return Minimum(node,id=>scope.Groups[id].Presentation=="minimized"?new Size(DefaultMinWidth,StripHeight(scope)):SlotMinimum(scope,scope.Groups[id],minimum));
    }
    static bool ResolvePresentation(PaneSplit node,Rectangle area,PaneScope scope,Func<PaneGroup,Size> minimum,Dictionary<string,Rectangle> frames){
        var min=PresentedMinimum(node,scope,minimum);if(area.Width<min.Width||area.Height<min.Height)return false;
        if(node.Leaf){frames[node.GroupId]=scope.Groups[node.GroupId].Presentation=="minimized"?new Rectangle(area.X,area.Y,area.Width,StripHeight(scope)):area;return true;}
        if(node.Span){
            node.Frame=area;
            bool collapsed=Collapsed(node.Second,scope),horizontal=node.SpanEdge=="left"||node.SpanEdge=="right";
            var incoming=PresentedMinimum(node.Second,scope,minimum);if(collapsed&&horizontal)incoming.Width=StripHeight(scope);
            var reserved=ReserveSpan(node,id=>SlotMinimum(scope,scope.Groups[id],minimum),incoming);
            if(!ResolvePresentation(node.First,area,scope,g=>{var size=reserved(g.Id);return new Size(size.Width,Math.Max(0,size.Height-scope.HeaderHeight));},frames))return false;
            return ResolveSpan(node,area,id=>scope.Groups[id].Presentation=="minimized"?new Size(collapsed&&Contains(node.Second,id)&&horizontal?StripHeight(scope):DefaultMinWidth,StripHeight(scope)):SlotMinimum(scope,scope.Groups[id],minimum),frames,
                (child,rect)=>{if(collapsed&&horizontal){ResolveVerticalStrip(child,rect,scope,frames);return true;}return ResolvePresentation(child,rect,scope,minimum,frames);},collapsed?StripHeight(scope):0);
        }
        bool x=node.Axis=="X";var a=PresentedMinimum(node.First,scope,minimum);var b=PresentedMinimum(node.Second,scope,minimum);
        int extent=x?area.Width:area.Height;
        int first=Math.Max(x?a.Width:a.Height,Math.Min(extent-(x?b.Width:b.Height),(int)Math.Round(extent*node.Ratio)));
        if(!x){if(Collapsed(node.First,scope))first=a.Height;else if(Collapsed(node.Second,scope))first=extent-b.Height;}
        var left=x?new Rectangle(area.X,area.Y,first,area.Height):new Rectangle(area.X,area.Y,area.Width,first);
        var right=x?new Rectangle(area.X+first,area.Y,extent-first,area.Height):new Rectangle(area.X,area.Y+first,area.Width,extent-first);
        if(x&&Collapsed(node.First,scope)!=Collapsed(node.Second,scope)){
            bool firstCollapsed=Collapsed(node.First,scope);
            var collapsed=firstCollapsed?node.First:node.Second;
            var active=firstCollapsed?node.Second:node.First;
            int width=StripHeight(scope);
            var strip=new Rectangle(firstCollapsed?area.Left:area.Right-width,area.Top,width,area.Height);
            var expanded=new Rectangle(firstCollapsed?area.Left+width:area.Left,area.Top,area.Width-width,area.Height);
            ResolveVerticalStrip(collapsed,strip,scope,frames);
            return ResolvePresentation(active,expanded,scope,minimum,frames);
        }
        return ResolvePresentation(node.First,left,scope,minimum,frames)&&ResolvePresentation(node.Second,right,scope,minimum,frames);
    }
    static void ResolveVerticalStrip(PaneSplit node,Rectangle area,PaneScope scope,Dictionary<string,Rectangle> frames){
        var ids=Leaves(node).ToArray();
        for(int i=0;i<ids.Length;i++){
            int top=area.Top+(int)Math.Round((double)area.Height*i/ids.Length);
            int bottom=area.Top+(int)Math.Round((double)area.Height*(i+1)/ids.Length);
            frames[ids[i]]=Rectangle.FromLTRB(area.Left,top,area.Right,bottom);
        }
    }
    static PaneSplit Projection(PaneSplit node,PaneScope scope){
        if(node==null)return null;
        if(node.Leaf)return new PaneSplit{GroupId=node.GroupId,Frame=Slot(scope,scope.Groups[node.GroupId]),Source=node};
        var first=Projection(node.First,scope);var second=Projection(node.Second,scope);
        return new PaneSplit{Axis=node.Axis,Ratio=node.Ratio,First=first,Second=second,Source=node,Frame=Rectangle.Union(first.Frame,second.Frame)};
    }
    public static Size PresentationMinimum(PaneScope scope,Func<PaneGroup,Size> minimum){return PresentedMinimum(scope.Root,scope,minimum);}
    public static Size PresentedMinimumForWorkspace(PaneSplit root,PaneScope scope,Func<PaneGroup,Size> minimum){return PresentedMinimum(root,scope,minimum);}
    static bool Contains(PaneSplit node,string group){return Leaves(node).Contains(group);}
    public static PaneSplit Boundary(PaneScope scope,string group,string edge){
        Ensure(scope);var node=Projection(scope.Root,scope);var path=new List<PaneSplit>();
        while(node!=null&&!node.Leaf){path.Add(node);node=Contains(node.First,group)?node.First:node.Second;}
        var frame=Slot(scope,scope.Groups[group]);
        for(int i=path.Count-1;i>=0;i--){
            var p=path[i];bool first=Contains(p.First,group);
            if(p.Source.Span){
                var e=p.Source.SpanEdge;
                if((!first&&edge==Opposite(e))||(first&&p.Source.SpanGroups.Contains(group)&&edge==e))return p;
                continue;
            }
            int seam=p.Axis=="X"?p.First.Frame.Right:p.First.Frame.Bottom;
            if(p.Axis=="X"&&((edge=="right"&&first&&frame.Right==seam)||(edge=="left"&&!first&&frame.Left==seam)))return p;
            if(p.Axis=="Y"&&((edge=="bottom"&&first&&frame.Bottom==seam)||(edge=="top"&&!first&&frame.Top==seam)))return p;
        }
        return null;
    }
    public static bool AcceptEdge(PaneScope scope,string group,string edge,int position,Func<PaneGroup,Size> minimum){
        var boundary=Boundary(scope,group,edge);if(boundary==null)return false;
        if(boundary.Source.Span){
            var spanSource=boundary.Source;var r=boundary.Second.Frame;var e=spanSource.SpanEdge;
            if(edge=="top")position-=scope.HeaderHeight;
            int size=e=="right"?r.Right-position:e=="left"?position-r.Left:e=="bottom"?r.Bottom-position:position-r.Top;
            bool horizontal=e=="left"||e=="right";int currentDepth=horizontal?r.Width:r.Height;
            var incoming=PresentedMinimum(spanSource.Second,scope,minimum);
            int required=horizontal?incoming.Width:incoming.Height;
            int available=spanSource.SpanGroups.Min(id=>{var slot=Slot(scope,scope.Groups[id]);var min=SlotMinimum(scope,scope.Groups[id],minimum);return (horizontal?slot.Width:slot.Height)+currentDepth-(horizontal?min.Width:min.Height);});
            if(size==currentDepth||size<required||size>available)return false;
            double oldSpanRatio=spanSource.Ratio;spanSource.Ratio=(double)size/Math.Max(1,spanSource.SpanExtent);
            if(spanSource.Ratio<=0||spanSource.Ratio>=1||!Resolve(scope,minimum)){spanSource.Ratio=oldSpanRatio;return false;}
            scope.GeometryRevision++;return true;
        }
        // Dragging the lower native window's top border also moves its header;
        // translate the observed native edge to the shared slot boundary once.
        if(edge=="top")position-=scope.HeaderHeight;
        bool x=boundary.Axis=="X";int start=x?boundary.Frame.Left:boundary.Frame.Top;
        int extent=x?boundary.Frame.Width:boundary.Frame.Height;
        int current=x?boundary.First.Frame.Right:boundary.First.Frame.Bottom;
        if(position==current)return false;
        var a=PresentedMinimum(boundary.First,scope,minimum);var b=PresentedMinimum(boundary.Second,scope,minimum);
        if(position<start+(x?a.Width:a.Height)||position>start+extent-(x?b.Width:b.Height))return false;
        var source=boundary.Source;double previous=source.Ratio;source.Ratio=(double)(position-start)/extent;
        if(!Resolve(scope,minimum)){source.Ratio=previous;return false;}
        scope.Ratio=scope.Root.Ratio;scope.GeometryRevision++;return true;
    }
    public static bool AcceptRightGroupLeftEdge(PaneScope scope,int proposed,Func<PaneGroup,int> width){
        if(scope.Order.Count!=2)return false;
        return AcceptEdge(scope,scope.Order[1],"left",proposed,g=>new Size(width(g),DefaultMinHeight));
    }
    public static bool Split(PaneSplit node,string target,string added,string side){
        if(side!=null&&side.StartsWith("span-"))return SplitSpan(node,target,added,side);
        if(side=="column-l"||side=="column-r"||side=="row-t"||side=="row-b"){
            if(!Leaves(node).Contains(target))return false;
            bool column=side.StartsWith("column-");
            if(!node.Leaf&&node.Axis!=(column?"Y":"X")){
                bool branchChanged=Split(Leaves(node.First).Contains(target)?node.First:node.Second,target,added,side);
                if(branchChanged&&node.Span)UpdateSpanSelection(node,target,added,side);
                return branchChanged;
            }
            var previous=node.Copy();var fresh=Leaf(added);
            node.GroupId=null;node.Axis=column?"X":"Y";node.Ratio=.5;
            bool before=side=="column-l"||side=="row-t";
            node.First=before?fresh:previous;node.Second=before?previous:fresh;
            return true;
        }
        if(node.Leaf){
            if(node.GroupId!=target)return false;
            var old=Leaf(target);var fresh=Leaf(added);bool before=side=="left"||side=="top";
            node.GroupId=null;node.Axis=side=="left"||side=="right"?"X":"Y";node.Ratio=.5;
            node.First=before?fresh:old;node.Second=before?old:fresh;return true;
        }
        bool changed=Split(node.First,target,added,side)||Split(node.Second,target,added,side);
        if(changed&&node.Span)UpdateSpanSelection(node,target,added,side);
        return changed;
    }
    public static void PreserveBoundaries(PaneSplit node,Rectangle area){
        if(node.Leaf)return;
        if(node.Span)return; // The underlying authored ratios survive viewport changes.
        bool x=node.Axis=="X";int seam=x?node.First.Frame.Right:node.First.Frame.Bottom;
        int start=x?area.Left:area.Top;int extent=x?area.Width:area.Height;
        node.Ratio=extent<=0?.5:(double)(seam-start)/extent;
        var a=x?Rectangle.FromLTRB(area.Left,area.Top,seam,area.Bottom):Rectangle.FromLTRB(area.Left,area.Top,area.Right,seam);
        var b=x?Rectangle.FromLTRB(seam,area.Top,area.Right,area.Bottom):Rectangle.FromLTRB(area.Left,seam,area.Right,area.Bottom);
        PreserveBoundaries(node.First,a);PreserveBoundaries(node.Second,b);
    }
    public static void PreserveScopeBoundaries(PaneScope scope,Rectangle area){
        PreserveBoundaries(scope.Root,area);
    }
    public static PaneSplit Remove(PaneSplit node,string id){
        if(node.Leaf)return node.GroupId==id?null:node;
        node.First=Remove(node.First,id);node.Second=Remove(node.Second,id);
        if(node.Span){node.SpanGroups=node.SpanGroups.Where(key=>key!=id).ToArray();if(node.SpanGroups.Length==0){node.Axis=node.SpanEdge=="left"||node.SpanEdge=="right"?"X":"Y";if(node.SpanEdge=="left"||node.SpanEdge=="top"){var first=node.First;node.First=node.Second;node.Second=first;}node.SpanEdge=null;node.SpanGroups=null;}}
        if(node.First==null)return node.Second;if(node.Second==null)return node.First;return node;
    }

    static string Opposite(string edge){return edge=="left"?"right":edge=="right"?"left":edge=="top"?"bottom":"top";}
    static Func<string,Size> ReserveSpan(PaneSplit node,Func<string,Size> minimum,Size incoming){return id=>{var size=minimum(id);if(node.SpanGroups!=null&&node.SpanGroups.Contains(id)){if(node.SpanEdge=="left"||node.SpanEdge=="right")size.Width+=incoming.Width;else size.Height+=incoming.Height;}return size;};}
    static void UpdateSpanSelection(PaneSplit node,string target,string added,string side){
        if(!node.SpanGroups.Contains(target))return;
        bool x=node.SpanEdge=="left"||node.SpanEdge=="right",splitX=side=="left"||side=="right"||side.StartsWith("column-");
        bool before=side=="left"||side=="top"||side=="column-l"||side=="row-t",edgeBefore=node.SpanEdge=="left"||node.SpanEdge=="top";
        if(x!=splitX)node.SpanGroups=node.SpanGroups.Concat(new[]{added}).Distinct().ToArray();
        else if(before==edgeBefore)node.SpanGroups=node.SpanGroups.Select(id=>id==target?added:id).ToArray();
    }
    public static bool SplitSide(string side){return new[]{"left","right","top","bottom","column-l","column-r","row-t","row-b"}.Contains(side)||(side!=null&&side.StartsWith("span-")&&side.Length<16384);}
    static bool SplitSpan(PaneSplit node,string target,string added,string side){
        int colon=side.IndexOf(':');if(colon<0)return false;
        string edge=side.Substring(5,colon-5);if(!new[]{"left","right","top","bottom"}.Contains(edge))return false;
        string[] ids;try{ids=side.Substring(colon+1).Split(',').Select(Uri.UnescapeDataString).ToArray();}catch{return false;}
        var leaves=Leaves(node).ToArray();
        if(ids.Length==0||ids.Distinct().Count()!=ids.Length||!ids.Contains(target)||ids.Contains(added)||ids.Any(id=>!leaves.Contains(id)))return false;
        if(ids.Length==1)return Split(node,target,added,edge);
        if(ids.Length==leaves.Length){
            var retained=node.Copy();bool before=edge=="left"||edge=="top";
            node.GroupId=null;node.Axis=edge=="left"||edge=="right"?"X":"Y";node.Ratio=.5;node.SpanEdge=null;node.SpanGroups=null;
            node.First=before?Leaf(added):retained;node.Second=before?retained:Leaf(added);return true;
        }
        var previous=node.Copy();node.GroupId=null;node.Axis="E";node.Ratio=.5;node.SpanEdge=edge;node.SpanGroups=ids;node.First=previous;node.Second=Leaf(added);return true;
    }
    // Carve a rectangle from an adjoining run of equal-facing edges. The base
    // tree still resolves first, so T junctions and unrelated panes keep their slots.
    static bool ResolveSpan(PaneSplit node,Rectangle area,Func<string,Size> minimum,Dictionary<string,Rectangle> frames,Func<PaneSplit,Rectangle,bool> resolve,int compact=0){
        var ids=node.SpanGroups;if(ids==null||ids.Length==0||ids.Any(id=>!frames.ContainsKey(id)))return false;
        bool x=node.SpanEdge=="left"||node.SpanEdge=="right",before=node.SpanEdge=="left"||node.SpanEdge=="top";
        var ordered=ids.Select(id=>frames[id]).OrderBy(r=>x?r.Top:r.Left).ToArray();
        int edge=x?(before?ordered[0].Left:ordered[0].Right):(before?ordered[0].Top:ordered[0].Bottom);
        for(int i=0;i<ordered.Length;i++){
            var r=ordered[i];int facing=x?(before?r.Left:r.Right):(before?r.Top:r.Bottom);
            if(facing!=edge||(i>0&&(x?ordered[i-1].Bottom!=r.Top:ordered[i-1].Right!=r.Left)))return false;
        }
        int extent=ordered.Min(r=>x?r.Width:r.Height);node.SpanExtent=extent;
        var newMinimum=Minimum(node.Second,minimum);
        int requested=compact>0?compact:(int)Math.Round(extent*node.Ratio),required=x?newMinimum.Width:newMinimum.Height;
        int available=ids.Min(id=>(x?frames[id].Width:frames[id].Height)-(x?minimum(id).Width:minimum(id).Height));
        if(requested<=0||requested>=extent||required>available)return false;
        int depth=Math.Max(required,Math.Min(available,requested));
        int start=x?ordered[0].Top:ordered[0].Left,end=x?ordered[ordered.Length-1].Bottom:ordered[ordered.Length-1].Right;
        var box=x?new Rectangle(before?edge:edge-depth,start,depth,end-start):new Rectangle(start,before?edge:edge-depth,end-start,depth);
        if(box.Width<newMinimum.Width||box.Height<newMinimum.Height)return false;
        foreach(var pair in frames)if(!ids.Contains(pair.Key)&&pair.Value.IntersectsWith(box))return false;
        foreach(var id in ids){var r=frames[id];frames[id]=x?Rectangle.FromLTRB(before?box.Right:r.Left,r.Top,before?r.Right:box.Left,r.Bottom):Rectangle.FromLTRB(r.Left,before?box.Bottom:r.Top,r.Right,before?r.Bottom:box.Top);}
        if(!resolve(node.Second,box))return false;
        return true;
    }
}
