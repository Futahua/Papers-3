using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;

// All mutable group authority lives in objects, never in a swapped global slice.
public sealed class PaneGroup {
    public readonly string Id;
    public readonly List<string> OrderedTabs = new List<string>();
    public string SelectedTab;
    public Rectangle ResolvedFrame;
    public string Presentation = "normal";
    public PaneGesture Gesture;
    public PaneGroup(string id) { Id = id; }
}

public sealed class PaneGesture {
    public Rectangle InitialOuter;
    public int StartingBoundary;
    public long Generation;
    public bool Changed;
    public string Edge;
    public bool OuterLeft;
}

// Leaves name groups. Branches own one boundary; X means side by side, Y stacked.
public sealed class PaneSplit {
    public string GroupId;
    public string Axis;
    public double Ratio=0.5;
    public PaneSplit First,Second;
    public Rectangle Frame;
    public bool Leaf { get { return GroupId!=null; } }
    public PaneSplit Copy(){return new PaneSplit{GroupId=GroupId,Axis=Axis,Ratio=Ratio,Frame=Frame,
        First=First==null?null:First.Copy(),Second=Second==null?null:Second.Copy()};}
}

public sealed class PanePlacement {
    public long Generation;
    public Rectangle Actual;
    public DateTime At;
    public string Cause;
}

public sealed class PanePeer {
    public readonly string TabId;
    public readonly WindowSession Session;
    public readonly Mutex Lease;
    public string GroupId;
    public int MinTrackWidth=240,MinTrackHeight=160;
    public bool FixedSize;
    public Rectangle ObservedOuter, ObservedVisible;
    public readonly List<PanePlacement> Programmatic = new List<PanePlacement>();
    public PanePeer(string id, WindowSession session, Mutex lease, string group) {
        TabId = id; Session = session; Lease = lease; GroupId = group;
    }
}

public sealed class PaneScope {
    public readonly string ScopeId;
    public readonly int HeaderHeight;
    public long BindingGeneration = 1;
    public long StateRevision = 1, GeometryRevision = 1;
    public long ViewportRevision;
    public Rectangle? PendingViewport;
    public long PendingViewportRevision;
    public readonly Dictionary<string,PaneGroup> Groups = new Dictionary<string,PaneGroup>();
    public readonly List<string> Order = new List<string>();
    public Rectangle Viewport;
    public double Ratio = 0.5;
    public bool Presented = true;
    public PaneSplit Root;
    public PaneScope(string id,int headerHeight=0) { ScopeId = id; HeaderHeight=Math.Max(0,headerHeight); }
    public PaneGroup Add(string id) {
        if (Groups.ContainsKey(id)) throw new InvalidOperationException("Duplicate group.");
        var group = new PaneGroup(id); Groups.Add(id,group); Order.Add(id); StateRevision++;
        return group;
    }
}
