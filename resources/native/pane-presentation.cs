using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;

// One stack owner for native groups; one contribution to the existing host-region
// compositor. Release and crash recovery remove only this coordinator contribution.
public sealed class PaneRegionSaved { public long Handle; public uint Pid; public byte[] RegionData; public SavedShape Shared; }
public sealed class PanePresentation {
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
    [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr target,IntPtr first,IntPtr second,int mode);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr h,uint size,[Out] byte[] data);
    [DllImport("gdi32.dll")] static extern IntPtr ExtCreateRegion(IntPtr transform,uint size,byte[] data);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h,IntPtr region);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h,IntPtr region,bool repaint);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    delegate bool EnumProc(IntPtr h,IntPtr data);
    public string StackDiagnostic;
    public readonly PaneRegionSaved Saved;
    readonly IntPtr host;
    string lastSignature;
    public PanePresentation(IntPtr hwnd,uint pid) {
        host=hwnd; Saved=new PaneRegionSaved{Handle=hwnd.ToInt64(),Pid=pid,Shared=PaneHostRegion.Register(hwnd,pid)};
    }
    public static PaneRegionSaved Capture(IntPtr hwnd,uint pid) {
        var result=new PaneRegionSaved{Handle=hwnd.ToInt64(),Pid=pid};
        var r=CreateRectRgn(0,0,0,0);
        try { if(GetWindowRgn(hwnd,r)!=0) { uint size=GetRegionData(r,0,null); if(size>0) { result.RegionData=new byte[size]; if(GetRegionData(r,size,result.RegionData)==0)throw new Exception("Cannot capture original host region."); } } }
        finally { DeleteObject(r); }
        return result;
    }
    public static void Restore(PaneRegionSaved saved) {
        if(saved==null)return;
        if(saved.Shared!=null){PaneHostRegion.Present(saved.Shared,new Rectangle[0]);return;}
        uint pid;var h=new IntPtr(saved.Handle);Native.GetWindowThreadProcessId(h,out pid);
        if(pid!=saved.Pid)return;
        IntPtr r=saved.RegionData==null?IntPtr.Zero:ExtCreateRegion(IntPtr.Zero,(uint)saved.RegionData.Length,saved.RegionData);
        if(SetWindowRgn(h,r,true)==0 && r!=IntPtr.Zero)DeleteObject(r);
    }
    public void Reset(){Restore(Saved);lastSignature=null;}
    public void Apply(IEnumerable<Rectangle> frames) {
        Native.Rect bounds;if(!Native.GetWindowRect(host,out bounds))return;
        var clipped=frames.Select(f=>Rectangle.Intersect(bounds.Box,f)).Where(r=>r.Width>0&&r.Height>0).ToArray();
        var signature=bounds.L+","+bounds.T+","+bounds.R+","+bounds.B+"|"+string.Join(";",clipped.Select(r=>r.ToString()).ToArray());
        if(signature==lastSignature)return;
        if(Saved.Shared!=null){PaneHostRegion.Present(Saved.Shared,clipped);lastSignature=signature;return;}
        IntPtr region=CreateRectRgn(0,0,bounds.R-bounds.L,bounds.B-bounds.T);
        IntPtr original=Saved.RegionData==null?IntPtr.Zero:ExtCreateRegion(IntPtr.Zero,(uint)Saved.RegionData.Length,Saved.RegionData);
        try {
            if(original!=IntPtr.Zero)CombineRgn(region,region,original,1);
            foreach(var frame in clipped) {
                var r=frame; r.Offset(-bounds.L,-bounds.T);
                var hole=CreateRectRgn(r.Left,r.Top,r.Right,r.Bottom);
                try { CombineRgn(region,region,hole,4); } finally { DeleteObject(hole); }
            }
            if(SetWindowRgn(host,region,true)==0)throw new Exception("Cannot apply combined host region.");
            region=IntPtr.Zero;lastSignature=signature;
        } finally { if(region!=IntPtr.Zero)DeleteObject(region); if(original!=IntPtr.Zero)DeleteObject(original); }
    }
    static bool OwnedBy(IntPtr popup,IntPtr main) {
        var seen=new HashSet<IntPtr>(); var next=Native.GetWindow(popup,4);
        while(next!=IntPtr.Zero&&seen.Add(next)){if(next==main)return true;next=Native.GetWindow(next,4);}
        return false;
    }
    public static List<IntPtr> OwnedPopups(IntPtr main) {
        var found=new List<IntPtr>();
        EnumWindows((h,data)=>{if(h!=main&&Native.IsWindowVisible(h)&&!Native.IsIconic(h)&&OwnedBy(h,main))found.Add(h);return true;},IntPtr.Zero);
        return found;
    }
    public void Stack(IEnumerable<PanePeer> selected,bool focus,PanePeer target) {
        var peers=selected.Where(p=>p.Session.Valid()&&!p.Session.Fullscreen&&!Native.IsIconic(p.Session.Handle)).ToArray();
        if(peers.Length==0)return;
        // A single host-wide pass. No z-order calls on normal size/move events.
        bool top=(Native.GetWindowLong(host,-20)&8)!=0;
        Native.SetWindowPos(host,IntPtr.Zero,0,0,0,0,0x213);
        // Raise EVERY main peer first: a popup from A must not be buried beneath B.
        foreach(var peer in peers) {
            var h=peer.Session.Handle;
            bool peerTop=(Native.GetWindowLong(h,-20)&8)!=0;
            if(top!=peerTop)Native.SetWindowPos(h,new IntPtr(top?-1:-2),0,0,0,0,0x213);
            Native.SetWindowPos(h,IntPtr.Zero,0,0,0,0,0x213);
        }
        var owned=peers.SelectMany(p=>OwnedPopups(p.Session.Handle)).Distinct().ToList();
        // Preserve the currently foreground dialog at the front when this is a non-focus pass.
        var foreground=Native.GetForegroundWindow();
        if(owned.Remove(foreground))owned.Add(foreground);
        if(target!=null){var targeted=OwnedPopups(target.Session.Handle);foreach(var popup in targeted){owned.Remove(popup);owned.Add(popup);}}
        foreach(var popup in owned)Native.SetWindowPos(popup,IntPtr.Zero,0,0,0,0,0x13);
        // Explicit relative order also works when the modal's process cannot become foreground.
        if(owned.Count>0){var below=owned[0];foreach(var peer in peers){
            Native.SetWindowPos(peer.Session.Handle,below,0,0,0,0,0x213);below=peer.Session.Handle;
        }}
        StackDiagnostic="peers="+string.Join(",",peers.Select(p=>p.Session.Handle.ToString()).ToArray())+" owned="+string.Join(",",owned.Select(h=>h.ToString()).ToArray());
        if(focus&&target!=null) {
            var dialogs=OwnedPopups(target.Session.Handle);
            SetForegroundWindow(dialogs.Count>0?dialogs[0]:target.Session.Handle);
        }
    }
}
