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
        var a=Minimum(node.First,minimum);var b=Minimum(node.Second,minimum);
        return node.Axis=="X"?new Size(a.Width+b.Width,Math.Max(a.Height,b.Height)):
            new Size(Math.Max(a.Width,b.Width),a.Height+b.Height);
    }
    static bool ResolveNode(PaneSplit node,Rectangle area,Func<string,Size> minimum,Dictionary<string,Rectangle> frames){
        var min=Minimum(node,minimum);
        if(area.Width<min.Width||area.Height<min.Height)return false;
        node.Frame=area;
        if(node.Leaf){frames[node.GroupId]=area;return true;}
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
        if(!ResolveNode(candidate,scope.Viewport,id=>SlotMinimum(scope,scope.Groups[id],minimum),frames))return false;
        scope.Root=candidate;
        foreach(var pair in frames)scope.Groups[pair.Key].ResolvedFrame=Content(scope,pair.Value);
        return true;
    }
    static bool Contains(PaneSplit node,string group){return Leaves(node).Contains(group);}
    public static PaneSplit Boundary(PaneScope scope,string group,string edge){
        Ensure(scope);var node=scope.Root;var path=new List<PaneSplit>();
        while(node!=null&&!node.Leaf){path.Add(node);node=Contains(node.First,group)?node.First:node.Second;}
        var frame=Slot(scope,scope.Groups[group]);
        for(int i=path.Count-1;i>=0;i--){
            var p=path[i];bool first=Contains(p.First,group);
            int seam=p.Axis=="X"?p.First.Frame.Right:p.First.Frame.Bottom;
            if(p.Axis=="X"&&((edge=="right"&&first&&frame.Right==seam)||(edge=="left"&&!first&&frame.Left==seam)))return p;
            if(p.Axis=="Y"&&((edge=="bottom"&&first&&frame.Bottom==seam)||(edge=="top"&&!first&&frame.Top==seam)))return p;
        }
        return null;
    }
    public static bool AcceptEdge(PaneScope scope,string group,string edge,int position,Func<PaneGroup,Size> minimum){
        var boundary=Boundary(scope,group,edge);if(boundary==null)return false;
        // Dragging the lower native window's top border also moves its header;
        // translate the observed native edge to the shared slot boundary once.
        if(edge=="top")position-=scope.HeaderHeight;
        bool x=boundary.Axis=="X";int start=x?boundary.Frame.Left:boundary.Frame.Top;
        int extent=x?boundary.Frame.Width:boundary.Frame.Height;
        int current=x?boundary.First.Frame.Right:boundary.First.Frame.Bottom;
        if(position==current)return false;
        var a=Minimum(boundary.First,id=>SlotMinimum(scope,scope.Groups[id],minimum));var b=Minimum(boundary.Second,id=>SlotMinimum(scope,scope.Groups[id],minimum));
        if(position<start+(x?a.Width:a.Height)||position>start+extent-(x?b.Width:b.Height))return false;
        double previous=boundary.Ratio;boundary.Ratio=(double)(position-start)/extent;
        if(!Resolve(scope,minimum)){boundary.Ratio=previous;return false;}
        scope.Ratio=scope.Root.Ratio;scope.GeometryRevision++;return true;
    }
    public static bool AcceptRightGroupLeftEdge(PaneScope scope,int proposed,Func<PaneGroup,int> width){
        if(scope.Order.Count!=2)return false;
        return AcceptEdge(scope,scope.Order[1],"left",proposed,g=>new Size(width(g),DefaultMinHeight));
    }
    public static bool Split(PaneSplit node,string target,string added,string side){
        if(node.Leaf){
            if(node.GroupId!=target)return false;
            var old=Leaf(target);var fresh=Leaf(added);bool before=side=="left"||side=="top";
            node.GroupId=null;node.Axis=side=="left"||side=="right"?"X":"Y";node.Ratio=.5;
            node.First=before?fresh:old;node.Second=before?old:fresh;return true;
        }
        return Split(node.First,target,added,side)||Split(node.Second,target,added,side);
    }
    public static void PreserveBoundaries(PaneSplit node,Rectangle area){
        if(node.Leaf)return;
        bool x=node.Axis=="X";int seam=x?node.First.Frame.Right:node.First.Frame.Bottom;
        int start=x?area.Left:area.Top;int extent=x?area.Width:area.Height;
        node.Ratio=extent<=0?.5:(double)(seam-start)/extent;
        var a=x?Rectangle.FromLTRB(area.Left,area.Top,seam,area.Bottom):Rectangle.FromLTRB(area.Left,area.Top,area.Right,seam);
        var b=x?Rectangle.FromLTRB(seam,area.Top,area.Right,area.Bottom):Rectangle.FromLTRB(area.Left,seam,area.Right,area.Bottom);
        PreserveBoundaries(node.First,a);PreserveBoundaries(node.Second,b);
    }
    public static PaneSplit Remove(PaneSplit node,string id){
        if(node.Leaf)return node.GroupId==id?null:node;
        node.First=Remove(node.First,id);node.Second=Remove(node.Second,id);
        if(node.First==null)return node.Second;if(node.Second==null)return node.First;return node;
    }
}
