// Resident, session-local window control. Protocol input is background registration,
// never a click request. The low-level hook owns the physical mouse-down timestamp.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class WindowControl
{
    const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x201,
        WM_RBUTTONDOWN = 0x204, WM_QUIT = 0x12, GA_ROOT = 2;
    const int SW_MINIMIZE = 6, SW_SHOWNORMAL = 1, WPF_ASYNCWINDOWPLACEMENT = 4;
    const uint EVENT_OBJECT_DESTROY = 0x8001, EVENT_OBJECT_SHOW = 0x8002,
        EVENT_OBJECT_HIDE = 0x8003, EVENT_SYSTEM_MINIMIZESTART = 0x0016,
        EVENT_SYSTEM_MINIMIZEEND = 0x0017, WINEVENT_OUTOFCONTEXT = 0;
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const int TELEMETRY_LIMIT = 4096;
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT {
        public POINT Point; public uint MouseData, Flags, Time; public IntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT {
        public int Length, Flags, ShowCmd; public POINT Min, Max; public RECT Normal;
    }
    [StructLayout(LayoutKind.Sequential)] struct MSG {
        public IntPtr Hwnd; public uint Message; public IntPtr WParam, LParam;
        public uint Time; public POINT Point;
    }
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO {
        public int Size; public RECT Monitor, Work; public uint Flags;
    }
    delegate IntPtr MouseProc(int code, IntPtr wParam, IntPtr lParam);
    delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int objectId,
        int childId, uint threadId, uint eventTime);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, MouseProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last,
        IntPtr module, WinEventProc callback, uint pid, uint tid, uint flags);
    // Raising a window in the ordinary z-order needs no foreground and cannot
    // produce the refusal flash that SetForegroundWindow does.
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter,
        int x, int y, int width, int height, uint flags);
    static readonly IntPtr HWND_TOP = IntPtr.Zero;
    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOMOVE = 0x0002;
    const uint SWP_NOACTIVATE = 0x0010;
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder value, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT placement);
    [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT placement);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref RECT rect, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,
        out FILETIME created, out FILETIME exited, out FILETIME kernel, out FILETIME user);
    [DllImport("kernel32.dll")] static extern bool QueryPerformanceCounter(out long value);
    [DllImport("kernel32.dll")] static extern bool QueryPerformanceFrequency(out long value);

    sealed class Slot {
        public int Id, Pid; public IntPtr Hwnd, Owner, Process;
        public long StartTicks; public RECT Hit; public WINDOWPLACEMENT Restore;
        public string Class; public volatile bool Active, Iconic;
    }
    sealed class Record {
        public long Seq, Input, Dispatch, Confirmed;
        public int Id; public string Op, Result; public IntPtr Target; public long Deadline;
    }
    static volatile Slot[] slots = new Slot[0];
    static readonly ConcurrentQueue<Record> records = new ConcurrentQueue<Record>();
    static long sequence;
    static int recordCount;
    static readonly MouseProc mouseCallback = OnMouse;
    static readonly WinEventProc eventCallback = OnWindowEvent;
    static IntPtr mouseHook, lifecycleHook, destroyHook;
    static volatile bool running = true;
    static StreamWriter telemetry;
    static readonly object telemetryLock = new object();
    static TextWriter response;
    static readonly object responseLock = new object();
    static long qpcFrequency;

    static long Tick() { long value; QueryPerformanceCounter(out value); return value; }
    static long NativeStartTicks(IntPtr handle) {
        FILETIME a, b, c, d;
        if (handle == IntPtr.Zero || !GetProcessTimes(handle, out a, out b, out c, out d)) return -1;
        return (long)(((ulong)a.High << 32) | a.Low) + 504911232000000000L;
    }
    static void Retire(Slot slot) {
        slot.Active = false;
        if (slot.Process != IntPtr.Zero) CloseHandle(slot.Process);
    }
    static bool Valid(Slot slot) {
        if (!slot.Active || !IsWindow(slot.Hwnd)) return false;
        uint pid;
        GetWindowThreadProcessId(slot.Hwnd, out pid);
        StringBuilder cls = new StringBuilder(256);
        if (pid != (uint)slot.Pid || NativeStartTicks(slot.Process) != slot.StartTicks
            || GetClassName(slot.Hwnd, cls, cls.Capacity) == 0 || cls.ToString() != slot.Class) {
            slot.Active = false; return false;
        }
        return true;
    }
    static void Queue(Slot slot, string op, string result, long input, long dispatch, long confirmed) {
        if (Interlocked.Increment(ref recordCount) > TELEMETRY_LIMIT) {
            Record ignored;
            if (records.TryDequeue(out ignored)) Interlocked.Decrement(ref recordCount);
        }
        records.Enqueue(new Record { Seq = Interlocked.Increment(ref sequence), Id = slot.Id,
            Op = op, Result = result, Input = input, Dispatch = dispatch, Confirmed = confirmed,
            Target = slot.Hwnd, Deadline = input + qpcFrequency / 10 });
    }
    static void Execute(Slot slot, string requested, long input) {
        if (!Valid(slot)) { Queue(slot, requested, "stale", input, Tick(), Tick()); return; }
        string op; bool issued;
        long dispatch = Tick();
        if (requested == "foreground") {
            op = "foreground";
            // RAISE IT; DO NOT BEG FOR THE FOREGROUND.
            //
            // SetForegroundWindow from a process that does not own the foreground is
            // refused by design, and the widget is deliberately non-activating - so
            // nothing of ours holds the foreground to hand over. Windows answers the
            // refusal by FLASHING the taskbar button, which is worse than doing
            // nothing: the creator sees an attention flash and no raise.
            //
            // Bringing a window to the top of the ordinary z-order needs neither
            // activation nor the foreground. The creator asked for bring-to-FRONT, not
            // focus - and the standing rule here is to never force z-order or topmost.
            // So the window is raised, activation is attempted ONLY when this process
            // already owns the foreground (where it can actually succeed), and the
            // result says exactly which of the two happened.
            bool raised = BringWindowToTop(slot.Hwnd)
                || SetWindowPos(slot.Hwnd, HWND_TOP, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            IntPtr foreground = GetForegroundWindow();
            uint foregroundPid = 0;
            if (foreground != IntPtr.Zero) GetWindowThreadProcessId(foreground, out foregroundPid);
            if (foregroundPid == (uint)slot.Pid) {
                // A window of the SAME process already holds the foreground, so this
                // call is allowed and will not produce a refusal flash.
                SetForegroundWindow(slot.Hwnd);
            }
            issued = raised;
        } else if (requested == "restore" || (requested == "toggle" && slot.Iconic)) {
            op = "restore";
            WINDOWPLACEMENT placement = slot.Restore;
            issued = SetWindowPlacement(slot.Hwnd, ref placement);
            if (issued) slot.Iconic = false;
        } else {
            op = "minimize";
            issued = ShowWindowAsync(slot.Hwnd, SW_MINIMIZE);
            if (issued) slot.Iconic = true;
        }
        long confirm = Tick();
        string result = !issued ? "native-refused" :
            op == "foreground" ? (GetForegroundWindow() == slot.Hwnd ? "success"
                : IsWindowVisible(slot.Hwnd) ? "raised" : "pending") :
            op == "minimize" ? (IsIconic(slot.Hwnd) ? "success" : "pending") :
            (!IsIconic(slot.Hwnd) && IsWindowVisible(slot.Hwnd) ? "success" : "pending");
        Queue(slot, op, result, input, dispatch, confirm);
    }
    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
        int message = wParam.ToInt32();
        if (code >= 0 && (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN)) {
            long input = Tick();
            // Modifier gestures retain the renderer's selection, drag and range semantics.
            if ((GetAsyncKeyState(0x10) & 0x8000) == 0 && (GetAsyncKeyState(0x11) & 0x8000) == 0
                && (GetAsyncKeyState(0x12) & 0x8000) == 0 && (GetAsyncKeyState(0x5B) & 0x8000) == 0
                && (GetAsyncKeyState(0x5C) & 0x8000) == 0) {
                MSLLHOOKSTRUCT mouse = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                IntPtr owner = GetAncestor(WindowFromPoint(mouse.Point), GA_ROOT);
                Slot[] snapshot = slots;
                bool matched = false;
                // WHICH OF THE TWO FAILURES IS IT? "The hook never fired" and "the hook
                // fired and matched no slot" looked identical from outside - the broker
                // logged nothing either way. A press inside a window this process KNOWS
                // (one of the registered owners) that still matches nothing is the
                // interesting case, and it is recorded with the point it happened at and
                // the rectangle it was compared against.
                bool overKnownOwner = false;
                for (int i = 0; i < snapshot.Length; ++i) {
                    Slot slot = snapshot[i];
                    if (slot.Active && slot.Owner == owner) { overKnownOwner = true; break; }
                }
                for (int i = 0; i < snapshot.Length; ++i) {
                    Slot slot = snapshot[i];
                    if (slot.Active && slot.Owner == owner && mouse.Point.X >= slot.Hit.Left
                        && mouse.Point.X < slot.Hit.Right && mouse.Point.Y >= slot.Hit.Top
                        && mouse.Point.Y < slot.Hit.Bottom) {
                        matched = true;
                        Telemetry("hook-hit|" + slot.Id + "|" + (message == WM_RBUTTONDOWN ? "foreground" : "toggle"));
                        // Right-click has no toggle side effect, so its foreground
                        // attempt can run at physical mouse-down. The widget is
                        // non-activating; an attempt delayed until DOM contextmenu
                        // loses the input-time foreground opportunity on Windows.
                        // THE PAGE OWNS THE RIGHT-CLICK ATTEMPT NOW. It asked the broker
                        // directly, which is one gesture and one attempt with one
                        // reported answer. Letting the hook also actuate would be two
                        // attempts for one press, and the reviewer's rule is explicit:
                        // never a second activation after a final refusal.
                        // Left-click is unaffected - the page has always been its actuator.
                        break;
                    }
                }
                if (!matched && overKnownOwner) {
                    Slot first = snapshot[0];
                    for (int i = 0; i < snapshot.Length; ++i) {
                        if (snapshot[i].Active && snapshot[i].Owner == owner) { first = snapshot[i]; break; }
                    }
                    Telemetry("hook-miss|" + (message == WM_RBUTTONDOWN ? "foreground" : "toggle")
                        + "|at=" + mouse.Point.X + "," + mouse.Point.Y
                        + "|slot=" + first.Id + " owner=" + first.Owner.ToInt64() + " seen=" + owner.ToInt64()
                        + " rect=" + first.Hit.Left + "," + first.Hit.Top + "," + first.Hit.Right + "," + first.Hit.Bottom);
                }
            }
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }
    static void OnWindowEvent(IntPtr hook, uint evt, IntPtr hwnd, int objectId,
        int childId, uint threadId, uint eventTime) {
        if (objectId != 0 || childId != 0) return;
        Slot[] snapshot = slots;
        foreach (Slot slot in snapshot) {
            if (slot.Hwnd != hwnd) continue;
            if (evt == EVENT_OBJECT_DESTROY) slot.Active = false;
            if (evt == EVENT_SYSTEM_MINIMIZESTART) slot.Iconic = true;
            if (evt == EVENT_SYSTEM_MINIMIZEEND) slot.Iconic = false;
        }
    }
    static bool Register(string[] p) {
        if (p.Length != 15) return false;
        int id, pid; long hwnd, owner, start;
        int[] n = new int[8];
        if (!int.TryParse(p[1], out id) || !long.TryParse(p[2], out hwnd)
            || !int.TryParse(p[3], out pid) || !long.TryParse(p[4], out start)
            || !long.TryParse(p[5], out owner) || id <= 0 || hwnd <= 0 || owner <= 0) return false;
        for (int i = 0; i < n.Length; ++i)
            if (!int.TryParse(p[i + 6], out n[i])) return false;
        if (n[2] <= 0 || n[3] <= 0 || n[6] <= 0 || n[7] <= 0) return false;
        string className;
        try { className = Encoding.UTF8.GetString(Convert.FromBase64String(p[14])); }
        catch { return false; }
        if (className.Length == 0 || className.Length > 255) return false;
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (handle == IntPtr.Zero || NativeStartTicks(handle) != start) {
            if (handle != IntPtr.Zero) CloseHandle(handle);
            return false;
        }
        WINDOWPLACEMENT placement = new WINDOWPLACEMENT { Length = Marshal.SizeOf(typeof(WINDOWPLACEMENT)) };
        StringBuilder actualClass = new StringBuilder(256);
        if (!IsWindow(new IntPtr(hwnd)) || !GetWindowPlacement(new IntPtr(hwnd), ref placement)
            || GetClassName(new IntPtr(hwnd), actualClass, actualClass.Capacity) == 0
            || actualClass.ToString() != className) {
            CloseHandle(handle); return false;
        }
        placement.Flags |= WPF_ASYNCWINDOWPLACEMENT;
        placement.ShowCmd = SW_SHOWNORMAL;
        // GetWindowRect gives screen coordinates; WINDOWPLACEMENT for a normal
        // top-level window expects workspace coordinates on the chosen monitor.
        RECT saved = new RECT { Left = n[4], Top = n[5], Right = n[4] + n[6], Bottom = n[5] + n[7] };
        IntPtr monitor = MonitorFromRect(ref saved, 2);
        MONITORINFO info = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) { CloseHandle(handle); return false; }
        int dx = info.Work.Left - info.Monitor.Left, dy = info.Work.Top - info.Monitor.Top;
        placement.Normal = new RECT { Left = saved.Left - dx, Top = saved.Top - dy,
            Right = saved.Right - dx, Bottom = saved.Bottom - dy };
        Slot next = new Slot { Id = id, Pid = pid, Hwnd = new IntPtr(hwnd), Owner = new IntPtr(owner),
            Process = handle, StartTicks = start, Hit = new RECT { Left = n[0], Top = n[1],
                Right = n[0] + n[2], Bottom = n[1] + n[3] }, Restore = placement,
            Class = className, Iconic = IsIconic(new IntPtr(hwnd)), Active = true };
        Slot[] old = slots; List<Slot> list = new List<Slot>();
        foreach (Slot slot in old) { if (slot.Id != id) list.Add(slot); else Retire(slot); }
        list.Add(next); slots = list.ToArray();
        return true;
    }
    /** One bounded diagnostic line. Never blocks the click: the writer buffers and
     * the drain thread flushes. "The broker holds nothing" and "a command matched
     * nothing" must be readable afterwards instead of inferred. */
    static void Telemetry(string line) {
        try {
            if (telemetry == null) return;
            lock (telemetryLock) telemetry.WriteLine(Tick() + "|" + line);
        } catch { }
    }    static void ReadPipe(object state) {
        try {
            TextReader reader = Console.In;
            TextWriter writer = Console.Out;
            response = writer;
            lock (responseLock) writer.WriteLine("READY|" + qpcFrequency.ToString(CultureInfo.InvariantCulture));
            string line;
            while (running && (line = reader.ReadLine()) != null) {
                if (line.Length > 8192) break;
                string[] p = line.Split('|');
                if (p[0] == "R" && p.Length >= 2) {
                    bool ok = Register(p);
                    lock (responseLock) writer.WriteLine("ACK|" + p[1] + "|" + (ok ? "1" : "0"));
                    // Registration is recorded, so "the broker holds nothing" is
                    // never again an inference from an empty action log.
                    Telemetry("slot-" + (ok ? "accepted" : "rejected") + "|" + p[1]);
                }
                else if (p[0] == "C" && p.Length == 2) {
                    int id; if (int.TryParse(p[1], out id)) {
                        Slot[] old = slots; List<Slot> list = new List<Slot>();
                        foreach (Slot slot in old) { if (slot.Id != id) list.Add(slot); else Retire(slot); }
                        slots = list.ToArray();
                        Telemetry("slot-cleared|" + id);
                    }
                } else if (p[0] == "G" && p.Length == 2) {
                    foreach (string item in p[1].Split(',')) {
                        string[] pair = item.Split(':');
                        if (pair.Length != 2 || (pair[1] != "foreground" && pair[1] != "minimize" && pair[1] != "restore" && pair[1] != "toggle")) continue;
                        int id; if (!int.TryParse(pair[0], out id)) continue;
                        bool acted = false;
                        foreach (Slot slot in slots) if (slot.Id == id) { Execute(slot, pair[1], Tick()); acted = true; break; }
                        // A COMMAND FOR SOMETHING THIS PROCESS DOES NOT HOLD IS A
                        // FIRST-CLASS FAILURE, not silence: it is the exact state
                        // that made every click fall back without saying so.
                        if (!acted) {
                            Telemetry("command-no-slot|" + id + "|" + pair[1]);
                            lock (responseLock) writer.WriteLine("EVENT|0|" + id + "|" + pair[1]
                                + "|0|0|0|no-slot");
                        }
                    }
                } else if (p[0] == "Q") { running = false; break; }
                }
        } catch { running = false; }
        running = false;
        Environment.Exit(0);
    }
    static void Drain(object state) {
        while (running) {
            Record record;
            while (records.TryDequeue(out record)) {
                Interlocked.Decrement(ref recordCount);
                if (record.Result == "pending") {
                    bool confirmed = record.Op == "foreground" ? GetForegroundWindow() == record.Target
                        : record.Op == "minimize" ? IsIconic(record.Target)
                        : !IsIconic(record.Target) && IsWindowVisible(record.Target);
                    if (confirmed) { record.Result = "success"; record.Confirmed = Tick(); }
                    else if (Tick() < record.Deadline) {
                        Interlocked.Increment(ref recordCount);
                        records.Enqueue(record);
                        break;
                    }
                    else { record.Result = record.Op == "foreground" ? "foreground-refused" : "timeout"; record.Confirmed = Tick(); }
                }
                string line = record.Seq + "|" + record.Id + "|" + record.Op + "|"
                    + record.Input + "|" + record.Dispatch + "|" + record.Confirmed + "|" + record.Result;
                try { if (telemetry != null) telemetry.WriteLine(line); } catch { }
                try { lock (responseLock) if (response != null) response.WriteLine("EVENT|" + line); } catch { }
            }
            try { if (telemetry != null) telemetry.Flush(); } catch { }
            Thread.Sleep(10);
        }
    }
    static void WatchShift(object state) {
        bool previous = false;
        while (running) {
            bool held = (GetAsyncKeyState(0x10) & 0x8000) != 0;
            if (held != previous) {
                previous = held;
                try {
                    lock (responseLock) if (response != null)
                        response.WriteLine("SHIFT|" + (held ? "1" : "0"));
                } catch { }
                // The shift channel had no way to be seen at all: it wrote one line
                // to the pipe and nothing else. A transition is now a record, so
                // "the broker never noticed" and "the broker noticed and the page
                // dropped it" stop looking identical.
                Telemetry("shift|" + (held ? "held" : "released"));
            }
            Thread.Sleep(20);
        }
    }
    static int Main(string[] args) {
        if (args.Length != 1) return 2;
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch { SetProcessDPIAware(); }
        QueryPerformanceFrequency(out qpcFrequency);
        try {
            telemetry = new StreamWriter(new FileStream(args[0], FileMode.Append, FileAccess.Write,
                FileShare.Read, 4096, FileOptions.Asynchronous), new UTF8Encoding(false));
            telemetry.AutoFlush = false;
        } catch { telemetry = null; }
        Thread drain = new Thread(Drain); drain.IsBackground = true; drain.Start();
        Thread pipe = new Thread(ReadPipe); pipe.IsBackground = true; pipe.Start();
        Thread shift = new Thread(WatchShift); shift.IsBackground = true; shift.Start();
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseCallback, IntPtr.Zero, 0);
        lifecycleHook = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND,
            IntPtr.Zero, eventCallback, 0, 0, WINEVENT_OUTOFCONTEXT);
        destroyHook = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY,
            IntPtr.Zero, eventCallback, 0, 0, WINEVENT_OUTOFCONTEXT);
        if (mouseHook == IntPtr.Zero) return 3;
        MSG msg;
        while (running && GetMessage(out msg, IntPtr.Zero, 0, 0)) {
            TranslateMessage(ref msg); DispatchMessage(ref msg);
        }
        UnhookWindowsHookEx(mouseHook);
        if (lifecycleHook != IntPtr.Zero) UnhookWinEvent(lifecycleHook);
        if (destroyHook != IntPtr.Zero) UnhookWinEvent(destroyHook);
        return 0;
    }
}
