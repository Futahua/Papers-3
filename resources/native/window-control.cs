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
    // For the honest z-order check below.
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    const uint GW_HWNDPREV = 3;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOPMOST = 0x00000008;
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
        public string Class,Group; public volatile bool Active, Iconic;
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
            // RESTORE, THEN RAISE - and nothing about focus.
            //
            // "Raise" alone changes nothing the creator can see when the window is
            // already visible at the top of the ordinary z-order, and switching the
            // keyboard foreground to a foreign window is not available to us: the
            // call must come from a process Windows considers foreground-eligible,
            // and Papers cannot make native calls from its own process. So this does
            // the two things it CAN do visibly - bring a minimized window back, and
            // lift it above other ordinary windows - with no activation, no topmost
            // forcing, and no refusal flash.
            int raised = 0;
            if (IsIconic(slot.Hwnd)) {
                WINDOWPLACEMENT placement = slot.Restore;
                if (SetWindowPlacement(slot.Hwnd, ref placement)) {
                    raised = 1;
                    slot.Iconic = false;
                }
            }
            bool placed = SetWindowPos(slot.Hwnd, HWND_TOP, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            if (placed) raised = 1;
            // THE RAISE ITSELF IS FAILING, and "foreground-refused" said only that
            // something did not work - not what. The last Win32 error is recorded, with
            // the window's own state, so "Windows refused the raise" can be told apart
            // from "the call was never valid for this window".
            if (!placed) {
                Telemetry("foreground-fail|id=" + slot.Id + " hwnd=" + slot.Hwnd.ToInt64()
                    + " iconic=" + (IsIconic(slot.Hwnd) ? 1 : 0)
                    + " visible=" + (IsWindowVisible(slot.Hwnd) ? 1 : 0)
                    + " err=" + Marshal.GetLastWin32Error()
                    + " owner=" + slot.Owner.ToInt64());
            }
            // A window of the SAME process already holding the foreground can be
            // activated without refusal; that is the only activation attempted.
            IntPtr foreground = GetForegroundWindow();
            uint foregroundPid = 0;
            if (foreground != IntPtr.Zero) GetWindowThreadProcessId(foreground, out foregroundPid);
            if (foregroundPid == (uint)slot.Pid) SetForegroundWindow(slot.Hwnd);
            issued = raised != 0;
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
                // A REAL z-order check, not a claim: the window above this one must be
                // a TOPMOST window (or none at all) for this to count as raised to the
                // top of the ordinary band. The old check was IsWindowVisible, which is
                // true for a window that never moved - so "raised" meant nothing and
                // the creator was told it worked while nothing on screen changed.
                : IsAtTopOfBand(slot.Hwnd) ? "raised" : "pending") :
            op == "minimize" ? (IsIconic(slot.Hwnd) ? "success" : "pending") :
            (!IsIconic(slot.Hwnd) && IsWindowVisible(slot.Hwnd) ? "success" : "pending");
        Queue(slot, op, result, input, dispatch, confirm);
    }
    /** True when nothing ordinary sits above this window: the only things above it may
     * be TOPMOST windows, which an ordinary raise is not allowed to pass. */
    static bool IsAtTopOfBand(IntPtr hwnd) {
        IntPtr above = GetWindow(hwnd, GW_HWNDPREV);
        while (above != IntPtr.Zero) {
            if ((GetWindowLong(above, GWL_EXSTYLE) & WS_EX_TOPMOST) == 0) return false;
            above = GetWindow(above, GW_HWNDPREV);
        }
        return true;
    }
    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
        if (code >= 0 && PapersGestures.Mouse(wParam.ToInt32(), lParam)) return new IntPtr(1);
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
        if (p.Length != 15 && p.Length != 16) return false;
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
            Class = className, Group = p.Length == 16 ? Encoding.UTF8.GetString(Convert.FromBase64String(p[15])) : "", Iconic = IsIconic(new IntPtr(hwnd)), Active = true };
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
        if (args.Length == 1 && args[0] == "--gesture-selftest") return PapersGestures.SelfTest();
        if (args.Length == 1 && args[0] == "--gesture-window-selftest") return PapersGestures.WindowSelfTest();
        if (args.Length != 1 && args.Length != 2) return 2;
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
        PapersGestures.GroupMembers = h => {
            Slot selected=null;foreach(var slot in slots)if(slot.Hwnd==h&&Valid(slot)&&!String.IsNullOrEmpty(slot.Group)){selected=slot;break;}
            var members=new List<IntPtr>();if(selected!=null)foreach(var slot in slots)if(slot.Owner==selected.Owner&&slot.Group==selected.Group&&Valid(slot)&&!IsIconic(slot.Hwnd)&&!members.Contains(slot.Hwnd))members.Add(slot.Hwnd);
            return members.ToArray();
        };
        PapersGestures.Diagnostic = Telemetry;
        PapersGestures.Start(args.Length>1?args[1]:null);
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseCallback, IntPtr.Zero, 0);
        lifecycleHook = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND,
            IntPtr.Zero, eventCallback, 0, 0, WINEVENT_OUTOFCONTEXT);
        destroyHook = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY,
            IntPtr.Zero, eventCallback, 0, 0, WINEVENT_OUTOFCONTEXT);
        if (mouseHook == IntPtr.Zero) return 3;
        MSG msg;
        while (running && GetMessage(out msg, IntPtr.Zero, 0, 0)) {
            if (msg.Message == 0x113) PapersGestures.Tick();
            TranslateMessage(ref msg); DispatchMessage(ref msg);
        }
        PapersGestures.Stop();
        UnhookWindowsHookEx(mouseHook);
        if (lifecycleHook != IntPtr.Zero) UnhookWinEvent(lifecycleHook);
        if (destroyHook != IntPtr.Zero) UnhookWinEvent(destroyHook);
        return 0;
    }
}

// Input-time gestures share the resident control process. They keep no durable
// window groups: Direct Pick returns ordinary identities to Papers' capability
// service; a drag only holds validated native identities until button-up.
internal static class PapersGestures {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public Point P; public uint Data,Flags,Time; public IntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public IntPtr Extra; }
    delegate IntPtr KeyProc(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,KeyProc proc,IntPtr module,uint thread);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h,int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int count);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int command);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern void NotifyWinEvent(uint evt,IntPtr h,int obj,int child);
    [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h,UIntPtr id,uint interval,IntPtr proc);
    [DllImport("user32.dll")] static extern bool KillTimer(IntPtr h,UIntPtr id);
    static readonly KeyProc keyProc=Keyboard;
    static IntPtr keyHook; static UIntPtr timer;
    static bool dragging,resize,swallowLeft,swallowRight,swallowMiddle;
    static Point anchor; static Rect original; static IntPtr target; static uint targetPid;
    static readonly GestureInputState input = new GestureInputState();
    sealed class PendingRestore {public IntPtr H;public uint Pid;public long Deadline;public Action Continue;}
    static readonly List<PendingRestore> pendingRestores=new List<PendingRestore>();
    static void RestoreThen(IntPtr h,uint pid,Action action){
        if(pendingRestores.Count>=8)return;
        ShowWindowAsync(h,9);pendingRestores.Add(new PendingRestore{H=h,Pid=pid,Deadline=Now+750,Continue=action});
    }
    static void ContinueRestores(){foreach(var pending in new List<PendingRestore>(pendingRestores)){
        if(!Valid(pending.H,pending.Pid)||Now>pending.Deadline){pendingRestores.Remove(pending);continue;}
        if(!IsZoomed(pending.H)&&!IsIconic(pending.H)){pendingRestores.Remove(pending);if(Active)pending.Continue();}
    }}
    static long rightDownAt;
    static long Now {get{return (long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);}}
    static bool pickup, middleScale, proportional;
    static double currentScale=1;
    static readonly Dictionary<IntPtr,uint> temporarySelection=new Dictionary<IntPtr,uint>();
    static readonly Dictionary<IntPtr,Outline> selectionOutlines=new Dictionary<IntPtr,Outline>();
    static string cursorDirectory;
    static IntPtr lastCursor;
    static readonly Dictionary<string,IntPtr> cursors=new Dictionary<string,IntPtr>();
    [DllImport("user32.dll")] static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr module,IntPtr name);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr LoadCursorFromFile(string path);
    [DllImport("user32.dll")] static extern bool DestroyCursor(IntPtr cursor);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int Size;public Rect Monitor,Work;public uint Flags;}
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attr,out Rect value,int size);
    static Rect WorkArea(IntPtr h){var info=new MonitorInfo{Size=Marshal.SizeOf(typeof(MonitorInfo))};return GetMonitorInfo(MonitorFromWindow(h,2),ref info)?info.Work:new Rect{L=0,T=0,R=1920,B=1080};}
    static Rect VisibleRect(IntPtr h){Rect r;if(DwmGetWindowAttribute(h,9,out r,16)==0)return r;GetWindowRect(h,out r);return r;}
    static bool PaintWindow(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);try{string name=Process.GetProcessById((int)pid).ProcessName;return name.Equals("CLIPStudioPaint",StringComparison.OrdinalIgnoreCase)||name.Equals("krita",StringComparison.OrdinalIgnoreCase);}catch{return false;}}
    static bool PaintAtCursor(){Point p;return GetCursorPos(out p)&&PaintWindow(At(p));}
    static bool ForceClose {get{return Down(0x11)&&Down(0x10)&&Down(0x12);}}
    static bool Active {get{return input.Active;}}
    static void ExitMode(){input.Exit();pendingRestores.Clear();FinishDrag();temporarySelection.Clear();HideFeedback();}
    static void HideFeedback(){if(outline!=null)outline.Hide();foreach(var o in selectionOutlines.Values)o.Hide();if(lastCursor!=IntPtr.Zero){SetCursor(LoadCursor(IntPtr.Zero,new IntPtr(32512)));lastCursor=IntPtr.Zero;}}
    static void FeedbackCursor(string name,int fallback){IntPtr cursor;if(!cursors.TryGetValue(name,out cursor)){cursor=LoadCursorFromFile(Path.Combine(cursorDirectory??"",name+".cur"));if(cursor==IntPtr.Zero)cursor=LoadCursor(IntPtr.Zero,new IntPtr(fallback));else cursors[name]=cursor;}SetCursor(cursor);lastCursor=cursor;}
    static void RaiseWithoutFocus(IntPtr h){if(fixtureTesting)return;var band=(GetWindowLong(h,-20)&8)!=0?new IntPtr(-1):IntPtr.Zero;SetWindowPos(h,band,0,0,0,0,0x13);}
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    static void Raise(IntPtr h){if(fixtureTesting)return;RaiseWithoutFocus(h);uint foregroundPid,targetProcess;GetWindowThreadProcessId(GetForegroundWindow(),out foregroundPid);GetWindowThreadProcessId(h,out targetProcess);if(foregroundPid!=0&&foregroundPid==targetProcess)SetForegroundWindow(h);}
    static void ToggleTemporary(IntPtr h,uint pid){FinishDrag();if(temporarySelection.ContainsKey(h))temporarySelection.Remove(h);else if(temporarySelection.Count<128)temporarySelection[h]=pid;}

    static int resizeX,resizeY,lastX=int.MinValue,lastY=int.MinValue;
    static readonly Queue<Action> actions=new Queue<Action>();
    static readonly System.Web.Script.Serialization.JavaScriptSerializer json=new System.Web.Script.Serialization.JavaScriptSerializer();
    static readonly string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDocuments),"PapersNativeBridgeReceipts");
    static string token,lastToken;
    static readonly Dictionary<IntPtr,int> seedIds=new Dictionary<IntPtr,int>();
    static readonly Dictionary<IntPtr,uint> picked=new Dictionary<IntPtr,uint>();
    static readonly HashSet<int> removed=new HashSet<int>();
    static int ticks;
    sealed class Outline:System.Windows.Forms.Form {
        public Outline(){FormBorderStyle=System.Windows.Forms.FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;Enabled=false;}
        protected override bool ShowWithoutActivation {get{return true;}}
        protected override System.Windows.Forms.CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000020|0x80|0x80000;return p;}}
        // True per-pixel alpha keeps SlopTop's tints independent of the target's
        // content. A color-key Form would blend translucent paint against magenta.
        [StructLayout(LayoutKind.Sequential)] struct Size {public int W,H;}
        [StructLayout(LayoutKind.Sequential,Pack=1)] struct Blend {public byte Op,Flags,Alpha,Format;}
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h,IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("user32.dll",SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr h,IntPtr screen,ref Point position,ref Size size,IntPtr source,ref Point origin,uint key,ref Blend blend,uint flags);
        // 0 move, 1 resize, 2 force close, 3 picker selection, 4/5 picker hover,
        // 6 temporary move selection.
        public int Mode; public bool Inner;
        IntPtr cachedBits;int cachedWidth,cachedHeight,cachedMode=-1;bool cachedInner;
        protected override void Dispose(bool disposing){if(cachedBits!=IntPtr.Zero){DeleteObject(cachedBits);cachedBits=IntPtr.Zero;}base.Dispose(disposing);}
        static void Fill(System.Drawing.Graphics g,int alpha,int rgb,System.Drawing.Rectangle r){using(var b=new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(alpha,(rgb>>16)&255,(rgb>>8)&255,rgb&255)))g.FillRectangle(b,r);}
        internal static System.Drawing.Bitmap Render(int w,int h,int mode,bool inner){
            var bitmap=new System.Drawing.Bitmap(w,h,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
            using(var g=System.Drawing.Graphics.FromImage(bitmap)){
                var all=new System.Drawing.Rectangle(0,0,w,h);
                if(mode==3){int t=Math.Max(2,Math.Min(4,(int)Math.Round(Math.Min(w,h)/120.0)));Fill(g,205,0x46B889,new System.Drawing.Rectangle(0,0,w,t));Fill(g,205,0x46B889,new System.Drawing.Rectangle(0,h-t,w,t));Fill(g,205,0x46B889,new System.Drawing.Rectangle(0,t,t,h-2*t));Fill(g,205,0x46B889,new System.Drawing.Rectangle(w-t,t,t,h-2*t));}
                else if(mode==4||mode==5||mode==6)Fill(g,mode==4?56:mode==5?48:70,mode==4?0x8D5CC7:mode==5?0xD45A63:0x3388FF,all);
                else{
                    Fill(g,mode==1?15:40,mode==0?0x3388FF:0xFF0000,all);
                    if(mode==1){var center=new System.Drawing.Rectangle(w/4,h/4,w/2,h/2);if(inner)Fill(g,40,0x00FF00,center);else{using(var region=new System.Drawing.Region(all)){region.Exclude(center);using(var b=new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(25,0,255,0)))g.FillRegion(b,region);}}}
                    using(var white=new System.Drawing.Pen(System.Drawing.Color.White,1))using(var gray=new System.Drawing.Pen(System.Drawing.Color.FromArgb(136,136,136),1)){
                        white.DashStyle=gray.DashStyle=System.Drawing.Drawing2D.DashStyle.Dash;
                        g.DrawLine(white,0,0,w,0);g.DrawLine(white,0,0,0,h);g.DrawLine(white,2,h-3,w-2,h-3);g.DrawLine(white,w-3,2,w-3,h-2);
                        g.DrawLine(gray,0,h-1,w,h-1);g.DrawLine(gray,w-1,0,w-1,h);g.DrawLine(gray,2,2,w-2,2);g.DrawLine(gray,2,2,2,h-2);
                    }
                    if(mode==2)using(var pen=new System.Drawing.Pen(System.Drawing.Color.Red,4)){g.DrawLine(pen,0,0,w,h);g.DrawLine(pen,w,0,0,h);}
                }
            }
            return bitmap;
        }
        public void RefreshLayer(){
            if(Width<1||Height<1)return;
            if(cachedBits==IntPtr.Zero||cachedWidth!=Width||cachedHeight!=Height||cachedMode!=Mode||cachedInner!=Inner){
                using(var bitmap=Render(Width,Height,Mode,Inner)){var next=bitmap.GetHbitmap(System.Drawing.Color.FromArgb(0));if(cachedBits!=IntPtr.Zero)DeleteObject(cachedBits);cachedBits=next;}
                cachedWidth=Width;cachedHeight=Height;cachedMode=Mode;cachedInner=Inner;
            }
            IntPtr screen=GetDC(IntPtr.Zero),dc=IntPtr.Zero,old=IntPtr.Zero;
            try{dc=CreateCompatibleDC(screen);old=SelectObject(dc,cachedBits);var position=new Point{X=Left,Y=Top};var size=new Size{W=Width,H=Height};var origin=new Point();var blend=new Blend{Alpha=255,Format=1};if(!UpdateLayeredWindow(Handle,screen,ref position,ref size,dc,ref origin,0,ref blend,2))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
            finally{if(old!=IntPtr.Zero)SelectObject(dc,old);if(dc!=IntPtr.Zero)DeleteDC(dc);if(screen!=IntPtr.Zero)ReleaseDC(IntPtr.Zero,screen);}
        }
    }
    static Outline outline;
    public static Func<IntPtr,IntPtr[]> GroupMembers;
    public static Action<string> Diagnostic;
    static void Note(string value){if(Diagnostic!=null)Diagnostic("gesture|"+value);}
    static void InstallKeyboard(){keyHook=SetWindowsHookEx(13,keyProc,GetModuleHandle(null),0);Note("keyboard="+(keyHook!=IntPtr.Zero)+"|error="+Marshal.GetLastWin32Error());}
    sealed class DragMember { public IntPtr H; public uint Pid; public Rect Box; }
    static readonly List<DragMember> dragMembers=new List<DragMember>();
    static bool legacyRunning=true;
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder title,int count);
    static bool LegacyRunning(){bool found=false;EnumWindows((h,l)=>{var title=new StringBuilder(1024);GetWindowText(h,title,1024);if(title.ToString().IndexOf("sloptop_engine.ahk - AutoHotkey",StringComparison.OrdinalIgnoreCase)>=0)found=true;return !found;},IntPtr.Zero);return found;}
    static bool fixtureTesting;
    static bool Down(int key){return !fixtureTesting&&(GetAsyncKeyState(key)&0x8000)!=0;}
    static void Queue(Action action){if(actions.Count<64)actions.Enqueue(action);}
    static bool Valid(IntPtr h,uint pid){uint actual;return h!=IntPtr.Zero&&IsWindow(h)&&GetWindowThreadProcessId(h,out actual)!=0&&actual==pid;}
    static IntPtr At(Point p){var h=GetAncestor(WindowFromPoint(p),2);uint pid;GetWindowThreadProcessId(h,out pid);if(h==IntPtr.Zero||pid==(uint)Process.GetCurrentProcess().Id||!IsWindowVisible(h))return IntPtr.Zero;var name=new StringBuilder(128);GetClassName(h,name,128);if(name.ToString()=="Progman"||name.ToString()=="WorkerW"||name.ToString()=="Shell_TrayWnd"||name.ToString()=="Shell_SecondaryTrayWnd"||name.ToString()=="DV2ControlHost"||name.ToString()=="tooltips_class32"||name.ToString()=="#32768")return IntPtr.Zero;return h;}
    public static void Start(string assets){cursorDirectory=assets??Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"gesture-cursors");try{if(File.Exists(FileName("activate")))lastToken=Convert.ToString(Read("activate")["token"]);}catch{}legacyRunning=LegacyRunning();if(!legacyRunning)InstallKeyboard();timer=SetTimer(IntPtr.Zero,UIntPtr.Zero,16,IntPtr.Zero);Note("start|legacy="+legacyRunning+"|timer="+timer);}
    public static void Stop(){if(keyHook!=IntPtr.Zero)UnhookWindowsHookEx(keyHook);KillTimer(IntPtr.Zero,timer);FinishDrag();if(outline!=null)outline.Dispose();foreach(var o in selectionOutlines.Values)o.Dispose();selectionOutlines.Clear();foreach(var c in cursors.Values)DestroyCursor(c);cursors.Clear();}
    static IntPtr Keyboard(int code,IntPtr message,IntPtr data){
        if(code<0)return CallNextHookEx(keyHook,code,message,data);
        var k=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData));bool up=message.ToInt32()==0x101||message.ToInt32()==0x105;
        int key=(int)k.Key;
        if(token!=null&&!Active&&!ForceClose&&!up&&!GestureInputState.Modifier(key)&&key!=0x20){bool cancel=key==0x1B;Queue(()=>FinishPick(cancel));return new IntPtr(1);}
        // Never suppress a painting application's Space, even at keyboard-hook time.
        bool paint=key==0x20&&PaintAtCursor();
        bool consumed=input.Key(key,up,Now,paint);
        if(input.ClearRequested){input.ClearRequested=false;Queue(()=>{if(temporarySelection.Count>0){FinishDrag();temporarySelection.Clear();}else ExitMode();});}
        if(input.ExitRequested){input.ExitRequested=false;Queue(ExitMode);}
        if(token!=null&&!Active&&!up&&key==0x20&&!consumed){Queue(()=>FinishPick(false));return new IntPtr(1);}
        return consumed?new IntPtr(1):CallNextHookEx(keyHook,code,message,data);
    }
    public static bool Mouse(int message,IntPtr data){
        if(legacyRunning)return false;
        var m=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
        if(message==0x202&&swallowLeft){swallowLeft=false;return true;}
        if(message==0x205&&swallowRight){swallowRight=false;long elapsed=Now-rightDownAt;Queue(()=>{if(dragging&&(!pickup||elapsed>100||resize))FinishDrag();});return true;}
        if(message==0x208&&swallowMiddle){swallowMiddle=false;Queue(FinishDrag);return true;}
        if(message!=0x204&&message!=0x201&&message!=0x207&&message!=0x20A)return false;
        var hit=At(m.P);
        if(hit!=IntPtr.Zero&&PaintWindow(hit))return false;
        uint pid=0;if(hit!=IntPtr.Zero)GetWindowThreadProcessId(hit,out pid);
        if(ForceClose&&message==0x201&&hit!=IntPtr.Zero){swallowLeft=true;Queue(()=>{if(Valid(hit,pid))ForceCloseWindow(hit);});return true;}
        if(token!=null&&!Active&&message==0x201){swallowLeft=true;Queue(()=>TogglePick(hit));return true;}
        if(!Active&&!dragging)return false;
        if(message==0x204){
            swallowRight=true;rightDownAt=Now;
            if(input.Latched&&Down(0x11)){Queue(()=>ToggleTemporary(hit,pid));return true;}
            if(dragging){Queue(FinishDrag);return true;}
            if(hit==IntPtr.Zero&&temporarySelection.Count>0)foreach(var pair in temporarySelection){if(Valid(pair.Key,pair.Value)){hit=pair.Key;pid=pair.Value;break;}}
            if(hit==IntPtr.Zero){Queue(ExitMode);return true;}
            bool sizing=Down(0x10),group=Down(0x12),latched=input.Latched;var point=m.P;
            if(sizing&&(GetWindowLong(hit,-16)&0x40000)==0)return true;
            Queue(()=>BeginDrag(hit,pid,point,sizing,group,false,latched));return true;
        }
        if(hit==IntPtr.Zero){if(input.Latched&&message!=0x20A)Queue(ExitMode);return input.Latched;}
        bool shift=Down(0x10);
        if(message==0x201){if(shift)return false;swallowLeft=true;Queue(()=>{if(Valid(hit,pid)){ShowWindowAsync(hit,IsZoomed(hit)?9:3);Raise(hit);}});return true;}
        if(message==0x207){swallowMiddle=true;if(shift){var point=m.P;Queue(()=>BeginDrag(hit,pid,point,true,false,true,false));}else Queue(()=>{if(Valid(hit,pid))ShowWindowAsync(hit,6);});return true;}
        if(message==0x20A){if(shift)return false;int delta=(short)(m.Data>>16);Queue(()=>Scale(hit,pid,delta>0?1.1:0.9));return true;}
        return false;
    }
    static void ForceCloseWindow(IntPtr h){
        // Match WinKill's window-first behavior; only kill its process if the
        // window refuses WM_CLOSE. Delayed validation never blocks an input hook.
        uint pid;GetWindowThreadProcessId(h,out pid);PostMessage(h,0x10,IntPtr.Zero,IntPtr.Zero);
        var process=Process.GetProcessById((int)pid);var pinnedHandle=process.Handle;long started=process.StartTime.ToUniversalTime().Ticks;
        ThreadPool.QueueUserWorkItem(_=>{Thread.Sleep(500);try{if(Valid(h,pid)&&!process.HasExited&&process.StartTime.ToUniversalTime().Ticks==started)process.Kill();}catch{}finally{process.Dispose();}});
    }
    static void BeginDrag(IntPtr h,uint pid,Point point,bool sizing,bool group,bool uniform,bool latched){
        if(!Valid(h,pid)||!Active)return;
        if(IsZoomed(h)||IsIconic(h)){RestoreThen(h,pid,()=>BeginDrag(h,pid,point,sizing,group,uniform,latched));return;}
        Note("drag-begin|resize="+sizing+"|pickup="+latched);
        if(!GetWindowRect(h,out original))return;
        target=h;targetPid=pid;anchor=point;resize=sizing;middleScale=uniform;pickup=latched;dragging=true;lastX=int.MinValue;lastY=int.MinValue;currentScale=1;
        dragMembers.Clear();var handles=new List<IntPtr>();
        if(input.Latched&&temporarySelection.Count>0)foreach(var pair in temporarySelection){if(Valid(pair.Key,pair.Value))handles.Add(pair.Key);}
        else if(group&&GroupMembers!=null)handles.AddRange(GroupMembers(h));
        if(handles.Count==0)handles.Add(h);
        foreach(var member in handles){uint memberPid;Rect box;GetWindowThreadProcessId(member,out memberPid);if(Valid(member,memberPid)&&GetWindowRect(member,out box)){if(sizing&&(GetWindowLong(member,-16)&0x40000)==0)continue;dragMembers.Add(new DragMember{H=member,Pid=memberPid,Box=box});}}
        if(dragMembers.Count==0){dragging=false;return;}
        ConfigureResize(point);
        foreach(var member in dragMembers){PostMessage(member.H,0x231,IntPtr.Zero,IntPtr.Zero);NotifyWinEvent(0xA,member.H,0,0);if(member.H==h)Raise(member.H);else RaiseWithoutFocus(member.H);}
    }
    static void ConfigureResize(Point point){
        proportional=middleScale||Inner(original,point);
        resizeX=point.X<(original.L+original.R)/2?-1:1;resizeY=point.Y<(original.T+original.B)/2?-1:1;
        currentScale=1;
    }
    static bool Inner(Rect r,Point p){return p.X>=r.L+(r.R-r.L)/4&&p.X<=r.R-(r.R-r.L)/4&&p.Y>=r.T+(r.B-r.T)/4&&p.Y<=r.B-(r.B-r.T)/4;}
    static void Rebase(Point p,bool sizing){foreach(var member in dragMembers){Rect r;if(GetWindowRect(member.H,out r))member.Box=r;}GetWindowRect(target,out original);anchor=p;resize=sizing;ConfigureResize(p);lastX=int.MinValue;lastY=int.MinValue;}
    static void FinishDrag(){foreach(var member in dragMembers)if(Valid(member.H,member.Pid)){PostMessage(member.H,0x232,IntPtr.Zero,IntPtr.Zero);NotifyWinEvent(0xB,member.H,0,0);}dragMembers.Clear();dragging=false;pickup=false;middleScale=false;target=IntPtr.Zero;if(outline!=null)outline.Hide();}
    internal static System.Drawing.Rectangle Bounds(int l,int t,int r,int b,int dx,int dy,bool sizing,int edgeX,int edgeY){
        if(!sizing){l+=dx;r+=dx;t+=dy;b+=dy;}else{if(edgeX<0)l=Math.Min(r-140,l+dx);if(edgeX>0)r=Math.Max(l+140,r+dx);if(edgeY<0)t=Math.Min(b-140,t+dy);if(edgeY>0)b=Math.Max(t+140,b+dy);}
        return System.Drawing.Rectangle.FromLTRB(l,t,r,b);
    }
    static void Assert(bool value,string name){if(!value)throw new Exception("gesture regression: "+name);}
    public static int SelfTest(){try{
        var move=Bounds(-900,100,-400,500,40,-20,false,0,0);
        Assert(move==new System.Drawing.Rectangle(-860,80,500,400),"negative-monitor move");
        var left=Bounds(100,100,600,500,40,0,true,-1,0);
        Assert(left.Right==600&&left.Left==140,"left resize keeps right edge");
        var minimum=Bounds(100,100,600,500,900,900,true,-1,-1);
        Assert(minimum.Width==140&&minimum.Height==140&&minimum.Right==600&&minimum.Bottom==500,"minimum anchored corner");
        var r=new System.Drawing.Rectangle(-1800,200,800,400);
        var scaled=ScaledBounds(r,2,1000,800);
        Assert(scaled.Width==1000&&scaled.Height==500&&scaled.Left+scaled.Width/2==r.Left+r.Width/2,"centered proportional monitor cap");
        var k=new GestureInputState();k.Key(0xA2,false,1000,false);
        Assert(k.Key(0x20,false,1010,false)&&k.Active,"consumed space begins mode");
        k.Advance(1111);Assert(k.Active&&!k.Latched,"held chord is not latched");
        Assert(k.Key(0x20,true,1200,false)&&!k.Active,"consumed space release finishes");
        k=new GestureInputState();k.Key(0xA2,false,1000,false);k.Key(0xA2,true,1020,false);
        Assert(k.Key(0x20,false,1300,false),"sequential Ctrl then Space");k.Key(0x20,true,1320,false);Assert(k.Latched&&k.Active,"latched after key release");
        k.Key(0x10,false,1400,false);Assert(k.Active,"Shift retains latch");
        k.Key(0x20,false,1450,false);Assert(k.ClearRequested,"Space clears temporary selection before exit");
        k.ClearRequested=false;k.Key(0x20,true,1460,false);Assert(!k.Key(0x41,false,1500,false)&&k.ExitRequested&&!k.Active,"typing exits and passes through");
        k=new GestureInputState();k.Key(0xA2,false,1000,false);k.Key(0xA2,true,1020,false);
        Assert(!k.Key(0x20,false,2100,false)&&!k.Active,"expired sequential arm");
        k=new GestureInputState();k.Key(0xA2,false,1000,false);Assert(!k.Key(0x20,false,1010,true)&&!k.Active,"drawing application Space passes through");
        k=new GestureInputState();k.Key(0xA2,false,1000,false);k.Key(0x20,false,1010,false);k.Advance(1111);
        Assert(k.Key(0x1B,false,1200,false)&&!k.Active,"Escape cancels held chord");
        Assert(k.Key(0x20,false,1210,false)&&!k.Active,"Space repeat cannot revive cancelled chord");
        k.Key(0x20,true,1220,false);Assert(k.Key(0x20,false,1300,false)&&k.Active,"fresh Space can start again");
        k=new GestureInputState();k.Key(0xA2,false,1000,false);k.Key(0xA3,false,1010,false);k.Key(0xA2,true,1020,false);Assert(k.Control,"either Ctrl key remains held");
        Console.WriteLine("gesture regressions: tap/hold/sequential/expiry/Escape/paint passthrough/key repeats/both Ctrl keys; move/anchored resize/proportional scale/monitor cap pass; no hooks or input installed");return 0;
    }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
    public static int WindowSelfTest(){
        // Hidden windows owned by this process only. Never hook, move the real
        // pointer, activate a window, or act on any application belonging to the user.
        fixtureTesting=true;
        try{
            using(var move=Outline.Render(240,160,0,false))using(var inner=Outline.Render(240,160,1,true))using(var outer=Outline.Render(240,160,1,false))using(var picker=Outline.Render(240,160,4,false))using(var selected=Outline.Render(240,160,3,false))using(var close=Outline.Render(240,160,2,false)){
                Assert(move.GetPixel(100,70).A==40,"move tint preserves translucency");
                Assert(inner.GetPixel(100,70).A>inner.GetPixel(20,20).A,"resize center lights only inside zone");
                Assert(outer.GetPixel(100,70).A<outer.GetPixel(20,20).A,"resize outer ring lights outside zone");
                Assert(picker.GetPixel(100,70).A==56,"picker hover translucency");
                Assert(selected.GetPixel(100,70).A==0&&selected.GetPixel(0,70).A==205,"picker border leaves content untouched");
                Assert(close.GetPixel(120,80).A==255,"force-close cross remains visible over tint");
            }
            using(var layer=new Outline()){layer.Bounds=new System.Drawing.Rectangle(-3000,-3000,240,160);layer.RefreshLayer();Assert(!layer.Visible,"layer rendering never activates hidden fixture");}
        }catch(Exception e){Console.Error.WriteLine(e.Message);fixtureTesting=false;return 1;}
        try{using(var first=new System.Windows.Forms.Form())using(var second=new System.Windows.Forms.Form()){
            var a=first.Handle;var b=second.Handle;uint pid=(uint)Process.GetCurrentProcess().Id;
            SetWindowPos(a,IntPtr.Zero,-3000,-3000,600,400,0x14);SetWindowPos(b,IntPtr.Zero,-2300,-2800,500,300,0x14);
            Rect a0,b0;GetWindowRect(a,out a0);GetWindowRect(b,out b0);
            input.Latched=true;swallowRight=true;
            GroupMembers=h=>new[]{a,b};
            var start=new Point{X=a0.L+100,Y=a0.T+100};
            BeginDrag(a,pid,start,false,true,false,true);
            UpdateDrag(new Point{X=start.X+60,Y=start.Y+40});
            Rect ar,br;GetWindowRect(a,out ar);GetWindowRect(b,out br);
            Assert(ar.L==a0.L+60&&ar.T==a0.T+40&&br.L==b0.L+60&&br.T==b0.T+40,"native group move preserves offsets");
            FinishDrag();
            // Held RMB is consumed, so no GetAsyncKeyState(RButton) can gate this.
            input.Latched=true;swallowRight=true;var corner=new Point{X=ar.L+5,Y=ar.T+5};
            BeginDrag(a,pid,corner,true,false,false,false);UpdateDrag(new Point{X=corner.X+50,Y=corner.Y+30});
            Rect resized;GetWindowRect(a,out resized);
            Assert(resized.L==ar.L+50&&resized.T==ar.T+30&&resized.R==ar.R&&resized.B==ar.B,"native consumed-button corner resize");
            FinishDrag();
            input.Latched=true;swallowMiddle=true;var center=new Point{X=(resized.L+resized.R)/2,Y=(resized.T+resized.B)/2};
            BeginDrag(a,pid,center,true,false,true,false);UpdateDrag(new Point{X=center.X,Y=center.Y-50});
            Rect uniform;GetWindowRect(a,out uniform);
            Assert(uniform.R-uniform.L>resized.R-resized.L&&uniform.B-uniform.T>resized.B-resized.T,"native middle-button uniform scale");
            Assert(Math.Abs((uniform.L+uniform.R)-(resized.L+resized.R))<=1,"uniform scale keeps center");
            swallowMiddle=false;UpdateDrag(center);Assert(!dragging,"button release terminates manipulation");
            input.Latched=true;swallowRight=true;BeginDrag(a,pid,center,false,false,false,true);
            input.Exit();UpdateDrag(center);Assert(!dragging,"mode exit terminates pickup");
            ToggleTemporary(a,pid);ToggleTemporary(b,pid);Assert(temporarySelection.Count==2,"temporary multi-selection");
            ToggleTemporary(a,pid);Assert(temporarySelection.Count==1&&temporarySelection.ContainsKey(b),"positive toggle removal");
            ExitMode();Assert(temporarySelection.Count==0,"mode teardown clears temporary selection");
            picked[a]=pid;seedIds[a]=7;TogglePick(a);Assert(removed.Contains(7)&&!picked.ContainsKey(a),"picker records only positive seed removal");
            TogglePick(a);Assert(!removed.Contains(7)&&picked.ContainsKey(a),"picker reselect cancels removal");
            picked.Clear();seedIds.Clear();removed.Clear();
        }
        Console.WriteLine("native fixture regressions: group move, consumed-button resize, middle-button scale, release/cancel, temporary selection pass; only hidden fixture windows used");return 0;
        }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}finally{FinishDrag();fixtureTesting=false;}
    }
    internal static System.Drawing.Rectangle ScaledBounds(System.Drawing.Rectangle r,double factor,int maxW,int maxH){
        // Keep proportions, center and monitor limits; negative monitor origins
        // are ordinary coordinates. A shared scale gives every group member the
        // same proportional change rather than forcing identical dimensions.
        factor=Math.Max(.15,factor);
        factor=Math.Min(factor,Math.Min((double)Math.Max(140,maxW)/r.Width,(double)Math.Max(140,maxH)/r.Height));
        int w=Math.Max(140,(int)Math.Round(r.Width*factor)),h=Math.Max(140,(int)Math.Round(r.Height*factor));
        return new System.Drawing.Rectangle(r.Left+(r.Width-w)/2,r.Top+(r.Height-h)/2,w,h);
    }
    static void Scale(IntPtr h,uint pid,double factor){Rect r;if(!Valid(h,pid))return;if(IsZoomed(h)||IsIconic(h)){RestoreThen(h,pid,()=>Scale(h,pid,factor));return;}if(!GetWindowRect(h,out r))return;var work=WorkArea(h);var next=ScaledBounds(System.Drawing.Rectangle.FromLTRB(r.L,r.T,r.R,r.B),factor,work.R-work.L-60,work.B-work.T-60);SetWindowPos(h,IntPtr.Zero,next.Left,next.Top,next.Width,next.Height,0x14);Raise(h);}
    static void DrawOn(Outline o,IntPtr h,int mode,bool inner){if(h==IntPtr.Zero||!IsWindowVisible(h)||IsIconic(h)){o.Hide();return;}var r=VisibleRect(h);bool changed=!o.Visible||o.Mode!=mode||o.Inner!=inner;o.Mode=mode;o.Inner=inner;var bounds=System.Drawing.Rectangle.FromLTRB(r.L,r.T,r.R,r.B);if(o.Bounds!=bounds){o.Bounds=bounds;changed=true;}if(changed)o.RefreshLayer();if(!o.Visible)o.Show();KeepFeedbackAbove(o.Handle);}
    // Other topmost apps can overtake an already-visible overlay. Reassert its
    // band while feedback is active, without activating it or moving the target.
    static void KeepFeedbackAbove(IntPtr h){SetWindowPos(h,new IntPtr(-1),0,0,0,0,0x213);}
    static void Draw(IntPtr h,int mode,Point p){if(h==IntPtr.Zero){if(outline!=null)outline.Hide();return;}if(outline==null)outline=new Outline();Rect r;GetWindowRect(h,out r);DrawOn(outline,h,mode,Inner(r,p));}
    static void DrawSelections(Dictionary<IntPtr,uint> selection,IntPtr hover){
        foreach(var pair in new List<KeyValuePair<IntPtr,uint>>(selection)){if(!Valid(pair.Key,pair.Value)){selection.Remove(pair.Key);continue;}Outline o;if(!selectionOutlines.TryGetValue(pair.Key,out o)){o=new Outline();selectionOutlines[pair.Key]=o;}if(pair.Key==hover)o.Hide();else DrawOn(o,pair.Key,object.ReferenceEquals(selection,temporarySelection)?6:3,false);}
        foreach(var pair in new List<KeyValuePair<IntPtr,Outline>>(selectionOutlines))if(!selection.ContainsKey(pair.Key)){pair.Value.Dispose();selectionOutlines.Remove(pair.Key);}
    }
    static void UpdateDrag(Point p){
        if(!Valid(target,targetPid)||!Active||(!pickup&&!(middleScale?swallowMiddle:swallowRight))){FinishDrag();return;}
        bool sizing=middleScale||Down(0x10);
        if(pickup&&sizing!=resize)Rebase(p,sizing);
        bool moved=p.X!=lastX||p.Y!=lastY;
        if(!moved&&!proportional)return;
        int dx=p.X-anchor.X,dy=p.Y-anchor.Y;
        if(resize&&Math.Abs(dx)<3&&Math.Abs(dy)<3&&lastX==int.MinValue)return;
        if(resize&&proportional){double wanted=Math.Max(.15,1.0-(double)dy/Math.Max(1,original.B-original.T)*3);currentScale+= (wanted-currentScale)*.12;}
        foreach(var member in dragMembers){
            if(!Valid(member.H,member.Pid))continue;
            System.Drawing.Rectangle next;
            if(resize&&proportional){var work=WorkArea(member.H);next=ScaledBounds(System.Drawing.Rectangle.FromLTRB(member.Box.L,member.Box.T,member.Box.R,member.Box.B),currentScale,work.R-work.L-60,work.B-work.T-60);}
            else next=Bounds(member.Box.L,member.Box.T,member.Box.R,member.Box.B,dx,dy,resize,resizeX,resizeY);
            SetWindowPos(member.H,IntPtr.Zero,next.Left,next.Top,next.Width,next.Height,0x14);
        }
        lastX=p.X;lastY=p.Y;
    }
    public static void Tick(){
        if(ticks==0)Note("timer-active");
        if(++ticks%60==0){bool legacy=LegacyRunning();if(legacy!=legacyRunning){legacyRunning=legacy;if(legacy){ExitMode();if(keyHook!=IntPtr.Zero)UnhookWindowsHookEx(keyHook);keyHook=IntPtr.Zero;}else InstallKeyboard();}}
        if(legacyRunning)return;
        input.Advance(Now);
        while(actions.Count>0){try{actions.Dequeue()();}catch(Exception e){Note("action-failed|"+e.GetType().Name);FinishDrag();}}
        ContinueRestores();
        if(ticks%4==0)PollPick();
        Point p;if(!GetCursorPos(out p))return;
        if(dragging)UpdateDrag(p);
        if(!Active&&!ForceClose&&token==null&&!dragging){temporarySelection.Clear();HideFeedback();return;}
        var h=dragging?target:At(p);
        if(h!=IntPtr.Zero&&PaintWindow(h)){HideFeedback();return;}
        if(Active||ForceClose){int mode=ForceClose?2:Down(0x10)?1:0;
            // Original activation: multi-selection owns the blue fills; ordinary
            // hover feedback pauses during group pickup, but close always wins.
            bool suppress=mode!=2&&temporarySelection.Count>0&&(mode==0||input.Latched&&dragging);
            Draw(suppress?IntPtr.Zero:h,mode,p);DrawSelections(temporarySelection,IntPtr.Zero);
            if(h==IntPtr.Zero)HideFeedback();else FeedbackCursor(mode==0?"move":mode==1&&Inner(VisibleRect(h),p)?"vore":"squash",mode==0?32646:32642);}
        else if(token!=null){DrawSelections(picked,h);Draw(h,picked.ContainsKey(h)?5:4,p);}
        else HideFeedback();
    }
    static string FileName(string kind){return Path.Combine(root,"picker-"+kind+".signal");}
    static void Write(string kind,object value){Directory.CreateDirectory(root);string path=FileName(kind),temp=path+".native-tmp";File.WriteAllText(temp,json.Serialize(value),new UTF8Encoding(false));if(File.Exists(path))File.Delete(path);File.Move(temp,path);}
    static Dictionary<string,object> Read(string kind){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(FileName(kind),Encoding.UTF8));}
    static int Num(Dictionary<string,object> o,string key){return Convert.ToInt32(o[key],CultureInfo.InvariantCulture);}
    static IntPtr Match(Dictionary<string,object> identity){var found=IntPtr.Zero;int count=0;uint pid=(uint)Num(identity,"processId");EnumWindows((h,l)=>{Rect r;uint actual;GetWindowThreadProcessId(h,out actual);if(actual==pid&&IsWindowVisible(h)&&!IsIconic(h)&&GetWindowRect(h,out r)&&r.L==Num(identity,"x")&&r.T==Num(identity,"y")&&r.R-r.L==Num(identity,"width")&&r.B-r.T==Num(identity,"height")){found=h;count++;}return true;},IntPtr.Zero);return count==1?found:IntPtr.Zero;}
    delegate bool EnumProc(IntPtr h,IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc,IntPtr l);
    static void PollPick(){try{
        if(token!=null&&File.Exists(FileName("cancel"))){var cancel=Read("cancel");if(Convert.ToString(cancel["token"])==token){FinishPick(true);return;}}
        if(!File.Exists(FileName("activate")))return;var request=Read("activate");string next=Convert.ToString(request["token"]);if(next==lastToken)return;
        if(Convert.ToInt32(request["version"])!=3||next.Length>128)return;
        ExitMode();lastToken=token=next;seedIds.Clear();picked.Clear();removed.Clear();
        foreach(object entry in (System.Collections.IEnumerable)request["seeds"]){var identity=entry as Dictionary<string,object>;if(identity==null)continue;var h=Match(identity);if(h==IntPtr.Zero)continue;uint pid;GetWindowThreadProcessId(h,out pid);picked[h]=pid;seedIds[h]=Num(identity,"seedId");}
        Write("ack",new{version=3,token=token,active=true});
    }catch{}}
    static void TogglePick(IntPtr h){if(h==IntPtr.Zero)return;int seed;if(picked.ContainsKey(h)){picked.Remove(h);if(seedIds.TryGetValue(h,out seed))removed.Add(seed);}else{uint pid;GetWindowThreadProcessId(h,out pid);picked[h]=pid;if(seedIds.TryGetValue(h,out seed))removed.Remove(seed);}}
    static void FinishPick(bool cancel){if(token==null)return;string done=token;token=null;var windows=new List<object>();foreach(var pair in picked){Rect r;if(Valid(pair.Key,pair.Value)&&GetWindowRect(pair.Key,out r))windows.Add(new{processId=pair.Value,x=r.L,y=r.T,width=r.R-r.L,height=r.B-r.T});}if(cancel)Write("result",new{version=3,token=done,outcome="cancelled"});else Write("result",new{version=3,token=done,outcome="committed",windows=windows,deselectedSeedIds=new List<int>(removed)});picked.Clear();seedIds.Clear();removed.Clear();HideFeedback();}
}


// Pure key state machine: consumed input has no reliable Windows async state.
// Tests exercise tap/hold/sequential activation without sending any user input.
internal sealed class GestureInputState {
    readonly HashSet<int> keys=new HashSet<int>();
    public bool Latched,Pending,ClearRequested,ExitRequested;
    long armedUntil,confirmAt;
    public bool Control {get{return keys.Contains(0x11)||keys.Contains(0xA2)||keys.Contains(0xA3);}}
    public bool Active {get{return Latched||(!blockedSpace&&spaceConsumed&&keys.Contains(0x20)&&Control);}}
    public static bool Modifier(int k){return k==0x10||k==0x11||k==0x12||(k>=0xA0&&k<=0xA5)||k==0x5B||k==0x5C;}
    public void Exit(){Latched=false;Pending=false;armedUntil=0;blockedSpace=keys.Contains(0x20);}
    public bool Key(int k,bool up,long now,bool paint){
        bool already=keys.Contains(k);
        if(up)keys.Remove(k);else keys.Add(k);
        bool ctrl=k==0x11||k==0xA2||k==0xA3;
        if(ctrl&&!up&&!Latched&&!Pending&&!paint)armedUntil=now+1000;
        if(k==0x20){
            if(up){bool consumed=spaceConsumed;spaceConsumed=false;blockedSpace=false;return consumed;}
            if(already||blockedSpace)return spaceConsumed;
            if(paint){Pending=false;armedUntil=0;return false;}
            if(Latched){ClearRequested=true;spaceConsumed=true;return true;}
            if(Control||now<armedUntil){spaceConsumed=true;Latched=true;Pending=Control;confirmAt=now+100;armedUntil=0;return true;}
            return false;
        }
        if(!up&&!Modifier(k)){
            if(Latched||k==0x1B&&Active){ExitRequested=true;Exit();return k==0x1B;}
            armedUntil=0;
        }
        return false;
    }
    bool spaceConsumed,blockedSpace;
    public void Advance(long now){if(Pending&&now>=confirmAt){Pending=false;if(Control&&keys.Contains(0x20))Latched=false;}}
}
