using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// Small personal-use companion for Papers foreign-window layout.
//
// The process deliberately knows nothing about Papers topology.  It receives
// one host HWND, opaque Papers.WindowInstanceId values, and the latest screen
// rectangles.  Native host LOCATIONCHANGE events translate the stored layout
// without going back through Electron.  All visible windows are committed with
// one DeferWindowPos transaction.  stdin EOF restores every captured rectangle.
public static class WindowLayoutBroker
{
    private const string InstanceProperty = "Papers.WindowInstanceId.v1";
    private const uint EventObjectLocationChange = 0x800B;
    private const uint EventSystemMoveSizeStart = 0x000A;
    private const uint EventSystemMoveSizeEnd = 0x000B;
    private const uint WineventOutOfContext = 0;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoOwnerZOrder = 0x0200;
    private const uint GwOwner = 4;
    private const uint GwHwndNext = 2;
    private const int ObjidWindow = 0;
    private const int ChildId = 0;

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Msg { public IntPtr Hwnd; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void WinEventDelegate(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetPropW(IntPtr hwnd, string name);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventDelegate callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Msg message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Msg message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Msg message);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr BeginDeferWindowPos(int count);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr DeferWindowPos(IntPtr hDwp, IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EndDeferWindowPos(IntPtr hDwp);

    private sealed class Item
    {
        public string Id = "";
        public string InstanceId = "";
        public IntPtr Hwnd;
        public Rect Original;
        public Rect Target;
        public bool HasTarget;
    }

    private static readonly object Gate = new object();
    private static readonly Dictionary<string, Item> Items = new Dictionary<string, Item>(StringComparer.Ordinal);
    private static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    private static readonly ManualResetEvent StopSignal = new ManualResetEvent(false);
    private static IntPtr Host;
    private static Rect LastHost;
    private static bool HasLastHost;
    private static uint EventThreadId;
    private static IntPtr EventHook;
    private static WinEventDelegate EventCallback;
    private static bool Stopping;

    private static int Width(Rect r) { return r.Right - r.Left; }
    private static int Height(Rect r) { return r.Bottom - r.Top; }
    private static Rect MakeRect(int x, int y, int width, int height) { return new Rect { Left = x, Top = y, Right = x + width, Bottom = y + height }; }

    private static bool Same(Rect a, Rect b) { return a.Left == b.Left && a.Top == b.Top && a.Right == b.Right && a.Bottom == b.Bottom; }

    private static IntPtr FindWindowByInstance(string instanceId)
    {
        if (!Regex.IsMatch(instanceId ?? "", "^W[0-9a-fA-F]{16}$")) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            if (!IsWindow(hwnd)) return true;
            IntPtr value = GetPropW(hwnd, InstanceProperty);
            if (value == IntPtr.Zero) return true;
            long numeric = value.ToInt64();
            string current = "W" + numeric.ToString("x16");
            if (string.Equals(current, instanceId, StringComparison.OrdinalIgnoreCase)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static bool HostRect(out Rect rect)
    {
        rect = new Rect();
        return Host != IntPtr.Zero && IsWindow(Host) && GetWindowRect(Host, out rect);
    }

    private static bool HostClientOrigin(out Point origin)
    {
        origin = new Point();
        if (Host == IntPtr.Zero || !IsWindow(Host)) return false;
        return ClientToScreen(Host, ref origin);
    }

    private static void QueueApply()
    {
        Wake.Set();
    }

    private static void ApplyLayout()
    {
        List<Item> ready = new List<Item>();
        lock (Gate)
        {
            foreach (Item item in Items.Values)
            {
                if (item.HasTarget && IsWindow(item.Hwnd) && InstanceMatches(item)) ready.Add(item);
            }
        }
        if (ready.Count == 0) return;
        IntPtr defer = BeginDeferWindowPos(ready.Count);
        if (defer == IntPtr.Zero) return;
        foreach (Item item in ready)
        {
            Rect r = item.Target;
            defer = DeferWindowPos(defer, item.Hwnd, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder);
            if (defer == IntPtr.Zero) return;
        }
        EndDeferWindowPos(defer);
    }

    private static void FollowHostMove()
    {
        Rect current;
        if (!HostRect(out current)) return;
        int dx = HasLastHost ? current.Left - LastHost.Left : 0;
        int dy = HasLastHost ? current.Top - LastHost.Top : 0;
        LastHost = current;
        HasLastHost = true;
        if (dx == 0 && dy == 0) return;
        lock (Gate)
        {
            foreach (Item item in Items.Values)
            {
                if (!item.HasTarget) continue;
                item.Target.Left += dx; item.Target.Right += dx;
                item.Target.Top += dy; item.Target.Bottom += dy;
            }
        }
        ApplyLayout();
    }

    private static void EventLoop()
    {
        EventThreadId = GetCurrentThreadId();
        EventCallback = (hook, evt, hwnd, idObject, idChild, thread, time) =>
        {
            if (idObject != ObjidWindow || idChild != ChildId || hwnd == IntPtr.Zero) return;
            bool hostEvent = hwnd == Host && (evt == EventObjectLocationChange || evt == EventSystemMoveSizeStart || evt == EventSystemMoveSizeEnd);
            if (hostEvent) QueueApply();
        };
        EventHook = SetWinEventHook(EventObjectLocationChange, EventObjectLocationChange, IntPtr.Zero, EventCallback, 0, 0, WineventOutOfContext);
        IntPtr moveHook = SetWinEventHook(EventSystemMoveSizeStart, EventSystemMoveSizeEnd, IntPtr.Zero, EventCallback, 0, 0, WineventOutOfContext);
        while (!Stopping)
        {
            if (Wake.WaitOne(15)) ApplyLayout();
            Msg message;
            while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
            Thread.Sleep(1);
        }
        if (EventHook != IntPtr.Zero) UnhookWinEvent(EventHook);
        if (moveHook != IntPtr.Zero) UnhookWinEvent(moveHook);
    }

    private static void RestoreAll()
    {
        List<Item> restore;
        lock (Gate) restore = new List<Item>(Items.Values);
        if (restore.Count == 0) return;
        IntPtr defer = BeginDeferWindowPos(restore.Count);
        if (defer == IntPtr.Zero) return;
        foreach (Item item in restore)
        {
            if (!IsWindow(item.Hwnd) || !InstanceMatches(item)) continue;
            Rect r = item.Original;
            defer = DeferWindowPos(defer, item.Hwnd, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder);
            if (defer == IntPtr.Zero) return;
        }
        EndDeferWindowPos(defer);
    }

    private static string StringValue(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
    }

    private static long? LongValue(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(\\-?[0-9]+)");
        long value; return m.Success && long.TryParse(m.Groups[1].Value, out value) ? value : (long?)null;
    }

    private static double? NumberValue(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(\\-?[0-9]+(?:\\.[0-9]+)?)");
        double value; return m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value) ? value : (double?)null;
    }

    private static string[] ObjectArray(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\[");
        if (!m.Success) return new string[0];
        int start = m.Index + m.Length, depth = 0, objectStart = -1;
        List<string> result = new List<string>();
        for (int i = start; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '{') { if (depth == 0) objectStart = i; depth++; }
            else if (c == '}') { depth--; if (depth == 0 && objectStart >= 0) { result.Add(json.Substring(objectStart, i - objectStart + 1)); objectStart = -1; } }
            else if (c == ']' && depth == 0) break;
        }
        return result.ToArray();
    }

    private static string Escape(string value) { return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n"); }
    private static void Reply(string id, bool ok, string error = null) { Console.WriteLine("{\"ok\":" + (ok ? "true" : "false") + ",\"id\":\"" + Escape(id) + "\"" + (error == null ? "" : ",\"error\":\"" + Escape(error) + "\"") + "}"); Console.Out.Flush(); }

    private static void Command(string json)
    {
        string cmd = StringValue(json, "cmd") ?? "";
        string id = StringValue(json, "id") ?? "";
        if (cmd == "host")
        {
            long? handle = LongValue(json, "hwnd");
            if (!handle.HasValue || !IsWindow(new IntPtr(handle.Value))) { Reply(id, false, "invalid host"); return; }
            Host = new IntPtr(handle.Value); HasLastHost = HostRect(out LastHost); Reply(id, true); return;
        }
        if (cmd == "bind")
        {
            string surface = id; string instance = StringValue(json, "windowInstanceId") ?? "";
            IntPtr hwnd = FindWindowByInstance(instance); Rect original;
            if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out original)) { Reply(id, false, "window not found"); return; }
            lock (Gate) Items[surface] = new Item { Id = surface, InstanceId = instance, Hwnd = hwnd, Original = original };
            Reply(id, true); return;
        }
        if (cmd == "layout")
        {
            foreach (string itemJson in ObjectArray(json, "items"))
            {
                string itemId = StringValue(itemJson, "id") ?? "";
                double? x = NumberValue(itemJson, "x"), y = NumberValue(itemJson, "y"), w = NumberValue(itemJson, "w"), h = NumberValue(itemJson, "h");
                if (itemId == "" || !x.HasValue || !y.HasValue || !w.HasValue || !h.HasValue || w <= 0 || h <= 0) continue;
                lock (Gate) { Item item; if (Items.TryGetValue(itemId, out item)) { item.Target = MakeRect((int)Math.Round(x.Value), (int)Math.Round(y.Value), (int)Math.Round(w.Value), (int)Math.Round(h.Value)); item.HasTarget = true; } }
            }
            QueueApply(); Reply(id, true); return;
        }
        if (cmd == "release")
        {
            lock (Gate) { Item item; if (Items.TryGetValue(id, out item)) { RestoreOne(item); Items.Remove(id); } }
            Reply(id, true); return;
        }
        if (cmd == "releaseAll") { RestoreAll(); lock (Gate) Items.Clear(); Reply(id, true); return; }
        if (cmd == "ping") { Reply(id, true); return; }
        Reply(id, false, "unknown command");
    }

    private static void RestoreOne(Item item)
    {
        if (!IsWindow(item.Hwnd) || !InstanceMatches(item)) return;
        IntPtr defer = BeginDeferWindowPos(1); if (defer == IntPtr.Zero) return;
        Rect r = item.Original; defer = DeferWindowPos(defer, item.Hwnd, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder); if (defer != IntPtr.Zero) EndDeferWindowPos(defer);
    }

    private static bool InstanceMatches(Item item)
    {
        IntPtr value = GetPropW(item.Hwnd, InstanceProperty);
        if (value == IntPtr.Zero) return false;
        return string.Equals("W" + value.ToInt64().ToString("x16"), item.InstanceId, StringComparison.OrdinalIgnoreCase);
    }

    public static int Main(string[] args)
    {
        Thread eventThread = new Thread(EventLoop); eventThread.IsBackground = true; eventThread.Start();
        try
        {
            string line; while ((line = Console.ReadLine()) != null) { if (line.Trim().Length == 0) continue; try { Command(line); } catch { Reply("", false, "command failed"); } }
        }
        finally
        {
            Stopping = true; RestoreAll(); Wake.Set();
            if (EventThreadId != 0) PostThreadMessage(EventThreadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
            eventThread.Join(1000);
        }
        return 0;
    }
}
