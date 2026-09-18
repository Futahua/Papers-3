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
    private const int ObjidWindow = 0;
    private const int ChildId = 0;
    private const uint WmQuit = 0x0012;
    private const uint WmAppApply = 0x8001;
    private const uint PmRemove = 0x0001;
    private const uint Synchronize = 0x00100000;

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
    [DllImport("user32.dll")] private static extern int GetMessage(out Msg message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Msg message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Msg message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Msg message);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr BeginDeferWindowPos(int count);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr DeferWindowPos(IntPtr hDwp, IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EndDeferWindowPos(IntPtr hDwp);

    private sealed class Item
    {
        public string Id = "";
        public string InstanceId = "";
        public IntPtr Hwnd;
        public Rect Original;
        public Rect Relative;
        public bool HasTarget;
    }

    private static readonly object Gate = new object();
    private static readonly Dictionary<string, Item> Items = new Dictionary<string, Item>(StringComparer.Ordinal);
    private static readonly object PlacementGate = new object();
    private static IntPtr Host;
    private static uint EventThreadId;
    private static IntPtr EventHook;
    private static WinEventDelegate EventCallback;
    private static bool Stopping;
    private static int ApplyQueued;

    private static int Width(Rect r) { return r.Right - r.Left; }
    private static int Height(Rect r) { return r.Bottom - r.Top; }
    private static Rect MakeRect(int x, int y, int width, int height) { return new Rect { Left = x, Top = y, Right = x + width, Bottom = y + height }; }

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

    private static bool HostClientOrigin(out Point origin)
    {
        origin = new Point();
        if (Host == IntPtr.Zero || !IsWindow(Host)) return false;
        return ClientToScreen(Host, ref origin);
    }

    private static void QueueApply()
    {
        if (Stopping) return;
        if (Interlocked.Exchange(ref ApplyQueued, 1) == 0 && EventThreadId != 0)
            PostThreadMessage(EventThreadId, WmAppApply, UIntPtr.Zero, IntPtr.Zero);
    }

    private static void ApplyLayout()
    {
        lock (PlacementGate)
        {
            Point origin;
            if (!HostClientOrigin(out origin)) return;
            List<Tuple<IntPtr, string, Rect>> ready = new List<Tuple<IntPtr, string, Rect>>();
            lock (Gate)
            {
                foreach (Item item in Items.Values)
                {
                    if (!item.HasTarget || !IsWindow(item.Hwnd) || !InstanceMatches(item)) continue;
                    Rect relative = item.Relative;
                    ready.Add(Tuple.Create(item.Hwnd, item.InstanceId, MakeRect(origin.X + relative.Left, origin.Y + relative.Top, Width(relative), Height(relative))));
                }
            }
            if (ready.Count == 0) return;
            IntPtr defer = BeginDeferWindowPos(ready.Count);
            if (defer == IntPtr.Zero) return;
            foreach (Tuple<IntPtr, string, Rect> entry in ready)
            {
                Rect r = entry.Item3;
                defer = DeferWindowPos(defer, entry.Item1, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder);
                if (defer == IntPtr.Zero) return;
            }
            EndDeferWindowPos(defer);
        }
    }

    private static void EventLoop()
    {
        // Touch the queue before another thread can post the coalesced apply
        // message. SetWinEventHook callbacks are delivered on this thread.
        Msg startupMessage;
        PeekMessage(out startupMessage, IntPtr.Zero, 0, 0, 0);
        EventThreadId = GetCurrentThreadId();
        if (Interlocked.CompareExchange(ref ApplyQueued, 0, 0) != 0)
            PostThreadMessage(EventThreadId, WmAppApply, UIntPtr.Zero, IntPtr.Zero);
        EventCallback = (hook, evt, hwnd, idObject, idChild, thread, time) =>
        {
            if (idObject != ObjidWindow || idChild != ChildId || hwnd == IntPtr.Zero) return;
            bool hostEvent = hwnd == Host && (evt == EventObjectLocationChange || evt == EventSystemMoveSizeStart || evt == EventSystemMoveSizeEnd);
            if (hostEvent) QueueApply();
        };
        EventHook = SetWinEventHook(EventObjectLocationChange, EventObjectLocationChange, IntPtr.Zero, EventCallback, 0, 0, WineventOutOfContext);
        IntPtr moveHook = SetWinEventHook(EventSystemMoveSizeStart, EventSystemMoveSizeEnd, IntPtr.Zero, EventCallback, 0, 0, WineventOutOfContext);
        Msg message;
        while (!Stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            if (message.Message == WmAppApply)
            {
                Interlocked.Exchange(ref ApplyQueued, 0);
                if (!Stopping) ApplyLayout();
            }
            else { TranslateMessage(ref message); DispatchMessage(ref message); }
        }
        if (EventHook != IntPtr.Zero) UnhookWinEvent(EventHook);
        if (moveHook != IntPtr.Zero) UnhookWinEvent(moveHook);
    }

    private static bool RestoreAll()
    {
        List<Item> restore;
        lock (Gate) restore = new List<Item>(Items.Values);
        bool all = true;
        lock (PlacementGate)
        {
            foreach (Item item in restore)
            {
                if (!IsWindow(item.Hwnd)) { lock (Gate) Items.Remove(item.Id); continue; }
                if (!InstanceMatches(item)) { all = false; continue; }
                IntPtr defer = BeginDeferWindowPos(1);
                if (defer == IntPtr.Zero) { all = false; continue; }
                Rect r = item.Original;
                defer = DeferWindowPos(defer, item.Hwnd, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder);
                if (defer == IntPtr.Zero || !EndDeferWindowPos(defer)) { all = false; continue; }
                lock (Gate) Items.Remove(item.Id);
            }
        }
        return all;
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
            Host = new IntPtr(handle.Value); Reply(id, true); return;
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
            Point origin;
            if (!HostClientOrigin(out origin)) { Reply(id, false, "host is unavailable"); return; }
            List<Tuple<string, Rect>> updates = new List<Tuple<string, Rect>>();
            foreach (string itemJson in ObjectArray(json, "items"))
            {
                string itemId = StringValue(itemJson, "id") ?? "";
                double? x = NumberValue(itemJson, "x"), y = NumberValue(itemJson, "y"), w = NumberValue(itemJson, "w"), h = NumberValue(itemJson, "h");
                if (itemId == "" || !x.HasValue || !y.HasValue || !w.HasValue || !h.HasValue || w <= 0 || h <= 0) continue;
                updates.Add(Tuple.Create(itemId, MakeRect((int)Math.Round(x.Value) - origin.X, (int)Math.Round(y.Value) - origin.Y, (int)Math.Round(w.Value), (int)Math.Round(h.Value))));
            }
            lock (Gate) foreach (Tuple<string, Rect> update in updates) { Item item; if (Items.TryGetValue(update.Item1, out item)) { item.Relative = update.Item2; item.HasTarget = true; } }
            QueueApply(); Reply(id, true); return;
        }
        if (cmd == "release")
        {
            bool released = false;
            Item item = null;
            lock (Gate) { if (Items.TryGetValue(id, out item)) { } else released = true; }
            if (item != null)
            {
                released = RestoreOne(item);
                if (released) lock (Gate) Items.Remove(id);
            }
            Reply(id, released, released ? null : "native restore failed"); return;
        }
        if (cmd == "releaseAll") { bool released = RestoreAll(); Reply(id, released, released ? null : "one or more native restores failed"); return; }
        if (cmd == "ping") { Reply(id, true); return; }
        Reply(id, false, "unknown command");
    }

    private static bool RestoreOne(Item item)
    {
        if (!IsWindow(item.Hwnd)) return true;
        if (!InstanceMatches(item)) return false;
        lock (PlacementGate)
        {
            IntPtr defer = BeginDeferWindowPos(1); if (defer == IntPtr.Zero) return false;
            Rect r = item.Original;
            defer = DeferWindowPos(defer, item.Hwnd, IntPtr.Zero, r.Left, r.Top, Width(r), Height(r), SwpNoActivate | SwpNoZOrder | SwpNoOwnerZOrder);
            return defer != IntPtr.Zero && EndDeferWindowPos(defer);
        }
    }

    private static bool InstanceMatches(Item item)
    {
        IntPtr value = GetPropW(item.Hwnd, InstanceProperty);
        if (value == IntPtr.Zero) return false;
        return string.Equals("W" + value.ToInt64().ToString("x16"), item.InstanceId, StringComparison.OrdinalIgnoreCase);
    }

    private static void WatchParent(uint parentPid)
    {
        if (parentPid == 0) return;
        IntPtr handle = OpenProcess(Synchronize, false, parentPid);
        if (handle == IntPtr.Zero) return;
        try
        {
            if (WaitForSingleObject(handle, 0xFFFFFFFF) == 0 && !Stopping)
            {
                Stopping = true;
                if (EventThreadId != 0) PostThreadMessage(EventThreadId, WmQuit, UIntPtr.Zero, IntPtr.Zero);
                // PlacementGate makes this final restore wait for any native
                // batch already in flight, so a Papers crash cannot be followed
                // by a late broker placement.
                RestoreAll();
                Environment.Exit(0);
            }
        }
        finally { CloseHandle(handle); }
    }

    public static int Main(string[] args)
    {
        Thread eventThread = new Thread(EventLoop); eventThread.IsBackground = true; eventThread.Start();
        uint parentPid = 0;
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--parent-pid") uint.TryParse(args[i + 1], out parentPid);
        if (parentPid != 0) { Thread monitor = new Thread(() => WatchParent(parentPid)); monitor.IsBackground = true; monitor.Start(); }
        try
        {
            string line; while ((line = Console.ReadLine()) != null) { if (line.Trim().Length == 0) continue; try { Command(line); } catch { Reply("", false, "command failed"); } }
        }
        finally
        {
            Stopping = true;
            if (EventThreadId != 0) PostThreadMessage(EventThreadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
            eventThread.Join(1000);
            RestoreAll();
        }
        return 0;
    }
}
