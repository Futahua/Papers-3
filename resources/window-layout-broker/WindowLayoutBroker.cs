using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// Personal-use native child host. A Papers HWND owns one small pane host per
// foreign surface; the selected external HWND becomes that host's child. This
// deliberately does not move top-level windows around the desktop.
public static class WindowLayoutBroker
{
    private const string InstanceProperty = "Papers.WindowInstanceId.v1";
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsChild = 0x40000000L;
    private const uint WsChildWindow = 0x40000000;
    private const long WsPopup = unchecked((long)0x80000000);
    private const uint WsClipChildren = 0x02000000;
    private const uint WsClipSiblings = 0x04000000;
    private const int SwHide = 0;
    private const int SwShow = 5;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpShowWindow = 0x0040;
    private const uint SwpHideWindow = 0x0080;
    private const uint SwpFrameChanged = 0x0020;
    private static readonly IntPtr HwndTop = new IntPtr(0);
    private const uint Synchronize = 0x00100000;
    private const uint WaitObject0 = 0;
    private const uint WaitFailed = 0xffffffff;
    private const int StdInputHandle = -10;
    private const uint WmApp = 0x8000;
    private const uint GuiWorkMessage = WmApp + 1;
    private const uint WmQuit = 0x0012;
    private const uint PmRemove = 0x0001;

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Hwnd; public uint MessageId; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool ScreenToClient(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetFocus();
    [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetPropW(IntPtr hwnd, string name);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(IntPtr handle, byte[] buffer, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PeekMessage(out Message message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetMessage(out Message message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);

    private sealed class Binding
    {
        public string Id = "";
        public string InstanceId = "";
        public IntPtr Papers;
        public IntPtr Host;
        public IntPtr Target;
        public IntPtr OriginalParent;
        public long OriginalStyle;
        public long OriginalExStyle;
        public Rect OriginalRect;
        public bool Adopted;
    }

    private static readonly object Gate = new object();
    private static readonly Dictionary<string, Binding> Bindings = new Dictionary<string, Binding>(StringComparer.Ordinal);
    private static readonly StringBuilder PipeBuffer = new StringBuilder();
    private sealed class GuiWork
    {
        public Func<bool> Action;
        public readonly AutoResetEvent Done = new AutoResetEvent(false);
        public bool Result;
    }
    private static readonly object GuiGate = new object();
    private static readonly Queue<GuiWork> GuiQueue = new Queue<GuiWork>();
    private static readonly AutoResetEvent GuiReady = new AutoResetEvent(false);
    private static Thread GuiThread;
    private static uint GuiThreadId;
    private static int GuiManagedThreadId;
    private static volatile bool GuiStopping;

    private static int Width(Rect r) { return Math.Max(1, r.Right - r.Left); }
    private static int Height(Rect r) { return Math.Max(1, r.Bottom - r.Top); }

    private static string StringValue(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
    }

    private static double? NumberValue(string json, string key)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
        double value;
        return m.Success && double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out value) ? value : (double?)null;
    }

    private static bool BoolValue(string json, string key, out bool value)
    {
        Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
        if (!m.Success) { value = false; return false; }
        value = string.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase); return true;
    }

    private static void Reply(string requestId, bool ok, string error = null)
    {
        Console.WriteLine("{\"ok\":" + (ok ? "true" : "false") + ",\"requestId\":\"" + Escape(requestId) + "\"" + (error == null ? "" : ",\"error\":\"" + Escape(error) + "\"") + "}");
        Console.Out.Flush();
    }

    private static string Escape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static IntPtr FindWindowByInstance(string instanceId)
    {
        if (string.IsNullOrEmpty(instanceId)) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            if (!IsWindow(hwnd)) return true;
            IntPtr value = GetPropW(hwnd, InstanceProperty);
            if (value == IntPtr.Zero) return true;
            string current = "W" + value.ToInt64().ToString("x16");
            if (string.Equals(current, instanceId, StringComparison.OrdinalIgnoreCase)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static bool InstanceMatches(Binding binding)
    {
        if (!IsWindow(binding.Target)) return false;
        IntPtr value = GetPropW(binding.Target, InstanceProperty);
        return value != IntPtr.Zero && string.Equals("W" + value.ToInt64().ToString("x16"), binding.InstanceId, StringComparison.OrdinalIgnoreCase);
    }

    private static bool ValidBounds(double? x, double? y, double? w, double? h)
    {
        return x.HasValue && y.HasValue && w.HasValue && h.HasValue
            && w.Value > 0 && h.Value > 0 && w.Value <= 32768 && h.Value <= 32768
            && Math.Abs(x.Value) <= 32768 && Math.Abs(y.Value) <= 32768;
    }

    private static bool CreateHost(Binding binding, string papersText)
    {
        long papersValue;
        if (!long.TryParse(papersText ?? "", out papersValue)) return false;
        binding.Papers = new IntPtr(papersValue);
        if (!IsWindow(binding.Papers)) return false;
        // This pane is a real input surface.  WS_EX_NOACTIVATE would make the
        // child visibly follow Papers while silently rejecting mouse activation.
        binding.Host = CreateWindowEx(0, "STATIC", "", WsChildWindow | WsClipChildren | WsClipSiblings, 0, 0, 1, 1, binding.Papers, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (binding.Host == IntPtr.Zero) return false;
        ShowWindow(binding.Host, SwHide);
        return true;
    }

    private static bool Adopt(Binding binding, string instanceId)
    {
        IntPtr target = FindWindowByInstance(instanceId);
        Rect original;
        if (target == IntPtr.Zero || !GetWindowRect(target, out original)) return false;
        lock (Gate)
        {
            foreach (Binding other in Bindings.Values) if (other != binding && other.Target == target) return false;
        }
        long style = GetWindowLongPtr(target, GwlStyle).ToInt64();
        long exStyle = GetWindowLongPtr(target, GwlExStyle).ToInt64();
        IntPtr originalParent = GetParent(target);
        ShowWindow(target, SwHide);
        SetWindowLongPtr(target, GwlStyle, new IntPtr((style & ~WsPopup) | WsChild));
        if (SetParent(target, binding.Host) == IntPtr.Zero && GetParent(target) != binding.Host) {
            SetWindowLongPtr(target, GwlStyle, new IntPtr(style));
            SetWindowLongPtr(target, GwlExStyle, new IntPtr(exStyle));
            ShowWindow(target, SwShow);
            return false;
        }
        long adoptedStyle = GetWindowLongPtr(target, GwlStyle).ToInt64();
        if ((adoptedStyle & WsChild) == 0 || (adoptedStyle & WsPopup) != 0 || GetParent(target) != binding.Host) {
            SetParent(target, originalParent);
            SetWindowLongPtr(target, GwlStyle, new IntPtr(style));
            SetWindowLongPtr(target, GwlExStyle, new IntPtr(exStyle));
            ShowWindow(target, SwShow);
            return false;
        }
        binding.InstanceId = instanceId;
        binding.Target = target;
        binding.OriginalParent = originalParent;
        binding.OriginalStyle = style;
        binding.OriginalExStyle = exStyle;
        binding.OriginalRect = original;
        binding.Adopted = true;
        SetWindowLongPtr(target, GwlExStyle, new IntPtr(exStyle));
        SetWindowPos(target, IntPtr.Zero, 0, 0, 1, 1, SwpNoActivate | SwpNoZOrder | SwpFrameChanged | SwpHideWindow);
        return true;
    }

    private static bool Restore(Binding binding)
    {
        if (!IsWindow(binding.Target)) { if (IsWindow(binding.Host)) DestroyWindow(binding.Host); return true; }
        if (!InstanceMatches(binding)) return false;
        ShowWindow(binding.Target, SwHide);
        SetParent(binding.Target, binding.OriginalParent);
        if (GetParent(binding.Target) != binding.OriginalParent) return false;
        SetWindowLongPtr(binding.Target, GwlStyle, new IntPtr(binding.OriginalStyle));
        SetWindowLongPtr(binding.Target, GwlExStyle, new IntPtr(binding.OriginalExStyle));
        if (GetWindowLongPtr(binding.Target, GwlStyle).ToInt64() != binding.OriginalStyle
            || GetWindowLongPtr(binding.Target, GwlExStyle).ToInt64() != binding.OriginalExStyle) return false;
        int x = binding.OriginalRect.Left, y = binding.OriginalRect.Top;
        if (binding.OriginalParent != IntPtr.Zero)
        {
            Point point = new Point { X = x, Y = y };
            if (!ScreenToClient(binding.OriginalParent, ref point)) return false;
            x = point.X; y = point.Y;
        }
        if (!SetWindowPos(binding.Target, IntPtr.Zero, x, y, Width(binding.OriginalRect), Height(binding.OriginalRect), SwpNoActivate | SwpNoZOrder | SwpFrameChanged | SwpShowWindow)) return false;
        if (IsWindow(binding.Host)) DestroyWindow(binding.Host);
        return true;
    }

    private static bool SetHostBounds(Binding binding, double? x, double? y, double? w, double? h)
    {
        if (!ValidBounds(x, y, w, h) || !IsWindow(binding.Host)) return false;
        int left = (int)Math.Round(x.Value), top = (int)Math.Round(y.Value), width = (int)Math.Round(w.Value), height = (int)Math.Round(h.Value);
        // Chromium's WebContentsView is another native child of Papers.  Keep
        // this host above that sibling so Windows hit-tests the adopted app,
        // while SWP_NOACTIVATE preserves the caller's current focus until the
        // user actually clicks the foreign surface.
        if (!SetWindowPos(binding.Host, HwndTop, left, top, width, height, SwpNoActivate | SwpShowWindow)) return false;
        if (binding.Adopted && IsWindow(binding.Target)) return SetWindowPos(binding.Target, IntPtr.Zero, 0, 0, width, height, SwpNoActivate | SwpNoZOrder | SwpShowWindow);
        return true;
    }

    private static bool Focus(Binding binding)
    {
        if (!binding.Adopted || !IsWindow(binding.Host) || !IsWindow(binding.Target) || GetParent(binding.Target) != binding.Host) return false;
        uint currentThread = GetCurrentThreadId();
        uint targetProcessId;
        uint targetThread = GetWindowThreadProcessId(binding.Target, out targetProcessId);
        bool attached = false;
        try
        {
            if (targetThread != 0 && targetThread != currentThread)
            {
                attached = AttachThreadInput(currentThread, targetThread, true);
                if (!attached) return false;
            }
            SetFocus(binding.Target);
            return GetFocus() == binding.Target;
        }
        finally
        {
            if (attached) AttachThreadInput(currentThread, targetThread, false);
        }
    }

    private static bool SetVisible(Binding binding, bool visible)
    {
        if (!IsWindow(binding.Host)) return false;
        ShowWindow(binding.Host, visible ? SwShow : SwHide);
        if (binding.Adopted && IsWindow(binding.Target)) ShowWindow(binding.Target, visible ? SwShow : SwHide);
        return true;
    }

    private static bool RestoreAll()
    {
        bool all = true;
        List<Binding> copy;
        lock (Gate) copy = new List<Binding>(Bindings.Values);
        foreach (Binding binding in copy)
        {
            bool restored = Restore(binding);
            if (restored) lock (Gate) Bindings.Remove(binding.Id); else all = false;
        }
        return all;
    }

    private static void DrainGuiQueue()
    {
        while (true)
        {
            GuiWork work;
            lock (GuiGate) { if (GuiQueue.Count == 0) return; work = GuiQueue.Dequeue(); }
            try { work.Result = work.Action(); } catch { work.Result = false; }
            work.Done.Set();
        }
    }

    private static void GuiLoop()
    {
        GuiManagedThreadId = Thread.CurrentThread.ManagedThreadId;
        GuiThreadId = GetCurrentThreadId();
        // Force creation of this thread's message queue before the main reader
        // can post work to it.
        Message ignored;
        PeekMessage(out ignored, IntPtr.Zero, 0, 0, PmRemove);
        GuiReady.Set();
        while (true)
        {
            Message message;
            int result = GetMessage(out message, IntPtr.Zero, 0, 0);
            if (result <= 0) break;
            if (message.MessageId == GuiWorkMessage) DrainGuiQueue();
            else { TranslateMessage(ref message); DispatchMessage(ref message); }
        }
        DrainGuiQueue();
    }

    private static void StartGuiThread()
    {
        GuiStopping = false;
        GuiThread = new Thread(GuiLoop) { IsBackground = true, Name = "Papers native host GUI" };
        GuiThread.Start();
        GuiReady.WaitOne(5000);
    }

    private static bool RunOnGui(Func<bool> action)
    {
        if (Thread.CurrentThread.ManagedThreadId == GuiManagedThreadId) return action();
        if (GuiStopping || GuiThreadId == 0) return false;
        GuiWork work = new GuiWork { Action = action };
        lock (GuiGate) GuiQueue.Enqueue(work);
        if (!PostThreadMessage(GuiThreadId, GuiWorkMessage, UIntPtr.Zero, IntPtr.Zero)) return false;
        work.Done.WaitOne();
        return work.Result;
    }

    private static void StopGuiThread()
    {
        GuiStopping = true;
        if (GuiThreadId != 0) PostThreadMessage(GuiThreadId, WmQuit, UIntPtr.Zero, IntPtr.Zero);
        if (GuiThread != null && GuiThread.IsAlive && Thread.CurrentThread != GuiThread) GuiThread.Join(1000);
    }

    // .NET's Console.ReadLine can treat a Node stdio pipe's interval between
    // sequential writes as EOF on Windows. ReadFile blocks until the next
    // byte or an actual pipe close, which is the JSONL contract we need.
    private static string ReadPipeLine()
    {
        IntPtr input = GetStdHandle(StdInputHandle);
        if (input == IntPtr.Zero || input == new IntPtr(-1)) return null;
        byte[] buffer = new byte[4096];
        while (true)
        {
            string buffered = PipeBuffer.ToString();
            int newline = buffered.IndexOf('\n');
            if (newline >= 0)
            {
                string line = buffered.Substring(0, newline).TrimEnd('\r');
                PipeBuffer.Remove(0, newline + 1);
                return line;
            }
            uint read;
            bool ok = ReadFile(input, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
            if (read > 0) PipeBuffer.Append(Encoding.UTF8.GetString(buffer, 0, (int)read));
            if (!ok && read == 0) return PipeBuffer.Length == 0 ? null : PipeBuffer.ToString();
        }
    }

    private static void CommandOnGui(string json)
    {
        string requestId = StringValue(json, "requestId") ?? "";
        string cmd = StringValue(json, "cmd") ?? "";
        string surfaceId = StringValue(json, "surfaceId") ?? "";
        if (cmd == "releaseAll") { bool releasedAll = RestoreAll(); Reply(requestId, releasedAll, releasedAll ? null : "one or more hosted windows cannot be restored"); return; }
        if (cmd == "ping") { Reply(requestId, true); return; }
        if (cmd == "host-create")
        {
            if (surfaceId == "") { Reply(requestId, false, "surface is missing"); return; }
            lock (Gate)
            {
                if (Bindings.ContainsKey(surfaceId)) { Reply(requestId, false, "surface already exists"); return; }
                Binding binding = new Binding { Id = surfaceId };
                if (!CreateHost(binding, StringValue(json, "papersHwnd"))) { Reply(requestId, false, "Papers host is unavailable"); return; }
                Bindings[surfaceId] = binding;
            }
            Reply(requestId, true); return;
        }
        Binding item;
        lock (Gate) Bindings.TryGetValue(surfaceId, out item);
        if (item == null) { Reply(requestId, false, "surface is unavailable"); return; }
        if (cmd == "adopt") { bool ok = Adopt(item, StringValue(json, "windowInstanceId")); Reply(requestId, ok, ok ? null : "window cannot be hosted inside Papers"); return; }
        if (cmd == "host-bounds") { bool ok = SetHostBounds(item, NumberValue(json, "x"), NumberValue(json, "y"), NumberValue(json, "w"), NumberValue(json, "h")); Reply(requestId, ok, ok ? null : "host bounds rejected"); return; }
        if (cmd == "host-visible") { bool visible; bool ok = BoolValue(json, "visible", out visible) && SetVisible(item, visible); Reply(requestId, ok, ok ? null : "host visibility rejected"); return; }
        if (cmd == "focus") { bool ok = Focus(item); Reply(requestId, ok, ok ? null : "host focus rejected"); return; }
        if (cmd == "release")
        {
            bool ok = Restore(item);
            if (ok) lock (Gate) Bindings.Remove(surfaceId);
            Reply(requestId, ok, ok ? null : "window cannot be safely restored"); return;
        }
        Reply(requestId, false, "unknown command");
    }

    private static void DispatchCommand(string json)
    {
        if (!RunOnGui(() => { try { CommandOnGui(json); return true; } catch { Reply(StringValue(json, "requestId") ?? "", false, "command failed"); return false; } }))
            Reply(StringValue(json, "requestId") ?? "", false, "native host GUI unavailable");
    }

    private static void WatchParent(uint parentPid)
    {
        IntPtr handle = OpenProcess(Synchronize, false, parentPid);
        if (handle == IntPtr.Zero) return;
        uint result = WaitForSingleObject(handle, 0xffffffff);
        CloseHandle(handle);
        if (result == WaitObject0 || result == WaitFailed) { RunOnGui(RestoreAll); StopGuiThread(); Environment.Exit(0); }
    }

    public static void Main(string[] args)
    {
        StartGuiThread();
        uint parentPid = 0;
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--parent-pid") uint.TryParse(args[i + 1], out parentPid);
        if (parentPid != 0) { Thread monitor = new Thread(() => WatchParent(parentPid)); monitor.IsBackground = true; monitor.Start(); }
        string line;
        while ((line = ReadPipeLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            DispatchCommand(line);
        }
        RunOnGui(RestoreAll);
        StopGuiThread();
    }
}
