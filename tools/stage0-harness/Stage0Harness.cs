// STAGE 0 disposable Win32 harness.
//
// Why this exists: Notepad is a bad conventional-Win32 baseline on this machine
// (a fresh notepad owns zero top-level windows while an older one owns 29), so a
// Notepad result tells us about Notepad. This harness is ours, it is boring, and
// its shape is known: one process, exactly one top-level window at rest, standard
// overlapped style, an owned modal on demand, an optional minimum track size, and
// a deliberate hang mode.
//
// It is disposable. It is never the adopted target of anything the creator uses.
//
// Control is by files, not by window messages, so a test in another process can
// drive it without needing to find its window first:
//
//   <control>\command.txt   one command, polled every 100 ms
//   <control>\status.json   rewritten after each command and on a timer
//   <control>\persisted.json  the harness's own remembered placement
//
// Commands: report | modal | closemodal | hang:<ms> | min:<w>x<h> | clearish |
//           flash:<ms> | quit
//
// `persisted.json` is the point of the whole harness for STAGE 0.0: a real
// application remembers where it was and opens there tomorrow. This one does too,
// which is what makes "kill Papers mid-lease and prove the window comes back"
// checkable after the fact rather than only in the live rectangle.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Stage0Harness
{
    internal static class Native
    {
        public delegate IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MINMAXINFO
        {
            public POINT ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length, flags, showCmd;
            public POINT ptMinPosition, ptMaxPosition;
            public RECT rcNormalPosition;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASSEX
        {
            public uint cbSize, style;
            public WndProc lpfnWndProc;
            public int cbClsExtra, cbWndExtra;
            public IntPtr hInstance, hIcon, hCursor, hbrBackground;
            public string lpszMenuName, lpszClassName;
            public IntPtr hIconSm;
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName,
            uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
        [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] public static extern bool UpdateWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG m, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
        [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG m);
        [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr SetTimer(IntPtr hWnd, IntPtr id, uint ms, IntPtr proc);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT val, int size);

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }

        public const uint WM_DESTROY = 0x0002, WM_CLOSE = 0x0010, WM_TIMER = 0x0113;
        public const uint WM_GETMINMAXINFO = 0x0024, WM_DPICHANGED = 0x02E0;
        public const int GW_OWNER = 4, GW_HWNDNEXT = 2;
        public const int SW_SHOWNORMAL = 1, SW_SHOWMINIMIZED = 2, SW_SHOWMAXIMIZED = 3;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        public const uint WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_VISIBLE = 0x10000000, WS_CHILD = 0x40000000;
        public const uint WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000, WS_SYSMENU = 0x00080000;
        public const uint WS_EX_TOOLWINDOW = 0x00000080, WS_EX_APPWINDOW = 0x00040000;
    }

    internal sealed class Harness
    {
        private const string MainClass = "Stage0HarnessMain";
        private const string OwnedClass = "Stage0HarnessOwned";
        private const uint TimerId = 1;
        private const int TimerMs = 100;

        private readonly string controlDir;
        private readonly string title;
        private readonly int minW, minH;
        private readonly string awareness;

        private IntPtr main, owned;
        private string lastCommand = "";
        private string note = "";
        private bool hung;
        private Native.WndProc mainProc, ownedProc; // keep delegates alive

        private Harness(string controlDir, string title, int minW, int minH, string awareness)
        {
            this.controlDir = controlDir; this.title = title;
            this.minW = minW; this.minH = minH; this.awareness = awareness;
        }

        private static void Main(string[] args)
        {
            var a = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string key = args[i].Substring(2);
                string val = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "1";
                a[key] = val;
            }

            string dir = a.ContainsKey("control") ? a["control"] : Path.Combine(Path.GetTempPath(), "stage0-harness");
            Directory.CreateDirectory(dir);

            ApplyAwareness(a.ContainsKey("awareness") ? a["awareness"] : "pmv2");

            int minW = 0, minH = 0;
            if (a.ContainsKey("min"))
            {
                var parts = a["min"].Split('x');
                if (parts.Length == 2) { int.TryParse(parts[0], out minW); int.TryParse(parts[1], out minH); }
            }

            var h = new Harness(dir, a.ContainsKey("title") ? a["title"] : "Stage 0 Harness",
                minW, minH, a.ContainsKey("awareness") ? a["awareness"] : "pmv2");
            h.Run();
        }

        private static void ApplyAwareness(string mode)
        {
            // The harness's own awareness changes what GetWindowRect reports for
            // it from another process, which is the hazard the measurement
            // convention exists to pin down. It is a control, not a preference.
            switch ((mode ?? "pmv2").ToLowerInvariant())
            {
                case "unaware": break;
                case "system": Native.SetProcessDPIAware(); break;
                default: Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); break; // PMv2
            }
        }

        private void Run()
        {
            IntPtr inst = Process.GetCurrentProcess().Handle;

            mainProc = MainWndProc;
            var wc = new Native.WNDCLASSEX();
            wc.cbSize = (uint)Marshal.SizeOf(typeof(Native.WNDCLASSEX));
            wc.lpfnWndProc = mainProc;
            wc.hInstance = inst;
            wc.lpszClassName = MainClass;
            wc.hbrBackground = new IntPtr(16); // COLOR_APPWORKSPACE+1 -> gray
            if (Native.RegisterClassEx(ref wc) == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "RegisterClassEx(main)");

            ownedProc = OwnedWndProc;
            var oc = new Native.WNDCLASSEX();
            oc.cbSize = (uint)Marshal.SizeOf(typeof(Native.WNDCLASSEX));
            oc.lpfnWndProc = ownedProc;
            oc.hInstance = inst;
            oc.lpszClassName = OwnedClass;
            oc.hbrBackground = new IntPtr(16);
            if (Native.RegisterClassEx(ref oc) == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "RegisterClassEx(owned)");

            // A real application reopens where it was. This is the behaviour that
            // turns "Papers crashed" into "and now it opens there tomorrow".
            int x = 200, y = 200, w = 640, h = 420;
            string persisted = Path.Combine(controlDir, "persisted.json");
            if (File.Exists(persisted))
            {
                try
                {
                    var text = File.ReadAllText(persisted);
                    x = ReadInt(text, "x", x); y = ReadInt(text, "y", y);
                    w = ReadInt(text, "w", w); h = ReadInt(text, "h", h);
                }
                catch { /* a corrupt file is not a reason to refuse to start */ }
            }

            main = Native.CreateWindowEx(0, MainClass, title, Native.WS_OVERLAPPEDWINDOW,
                x, y, w, h, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
            if (main == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateWindowEx(main)");

            Native.ShowWindow(main, Native.SW_SHOWNORMAL);
            Native.UpdateWindow(main);
            Native.SetTimer(main, new IntPtr(TimerId), TimerMs, IntPtr.Zero);

            WriteStatus();
            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                Native.TranslateMessage(ref msg);
                Native.DispatchMessage(ref msg);
            }
            Persist();
        }

        private static int ReadInt(string json, string key, int fallback)
        {
            var m = System.Text.RegularExpressions.Regex.Match(json, "\"" + key + "\"\\s*:\\s*(-?\\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : fallback;
        }

        private IntPtr MainWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            switch (msg)
            {
                case Native.WM_TIMER:
                    Tick();
                    return IntPtr.Zero;
                case Native.WM_GETMINMAXINFO:
                    if (minW > 0 || minH > 0)
                    {
                        var mmi = (Native.MINMAXINFO)Marshal.PtrToStructure(lParam, typeof(Native.MINMAXINFO));
                        if (minW > 0) mmi.ptMinTrackSize.X = minW;
                        if (minH > 0) mmi.ptMinTrackSize.Y = minH;
                        Marshal.StructureToPtr(mmi, lParam, false);
                    }
                    return IntPtr.Zero;
                case Native.WM_CLOSE:
                    Persist();
                    Native.DestroyWindow(hWnd);
                    return IntPtr.Zero;
                case Native.WM_DESTROY:
                    Native.PostQuitMessage(0);
                    return IntPtr.Zero;
            }
            return Native.DefWindowProc(hWnd, msg, wParam, lParam);
        }

        private IntPtr OwnedWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == Native.WM_CLOSE) { Native.DestroyWindow(hWnd); return IntPtr.Zero; }
            if (msg == Native.WM_DESTROY) { owned = IntPtr.Zero; WriteStatus(); return IntPtr.Zero; }
            return Native.DefWindowProc(hWnd, msg, wParam, lParam);
        }

        private void Tick()
        {
            string path = Path.Combine(controlDir, "command.txt");
            string command = "";
            try { if (File.Exists(path)) command = File.ReadAllText(path).Trim(); } catch { }
            if (command.Length == 0 || command == lastCommand) return;
            lastCommand = command;
            Execute(command);
            WriteStatus();
        }

        private void Execute(string command)
        {
            // The hang mode blocks this thread exactly as a real hung application
            // does: the window stops pumping messages. That is the point — it is
            // what SWP_ASYNCWINDOWPOS exists to survive.
            if (command.StartsWith("hang:", StringComparison.OrdinalIgnoreCase))
            {
                int ms;
                if (int.TryParse(command.Substring(5), out ms) && ms > 0)
                {
                    hung = true; WriteStatus();
                    Thread.Sleep(ms);
                    hung = false;
                }
                note = "hang:" + ms;
                return;
            }

            switch (command.ToLowerInvariant())
            {
                case "modal":
                    if (owned == IntPtr.Zero)
                    {
                        var r = new Native.RECT(); Native.GetWindowRect(main, out r);
                        owned = Native.CreateWindowEx(0, OwnedClass, title + " — Open File",
                            Native.WS_OVERLAPPEDWINDOW, r.Left + 60, r.Top + 60, 420, 200,
                            main, IntPtr.Zero, Process.GetCurrentProcess().Handle, IntPtr.Zero);
                        if (owned != IntPtr.Zero) Native.ShowWindow(owned, Native.SW_SHOWNORMAL);
                    }
                    note = owned == IntPtr.Zero ? "modal-failed" : "modal-open";
                    return;
                case "closemodal":
                    if (owned != IntPtr.Zero) Native.DestroyWindow(owned);
                    note = "modal-closed";
                    return;
                case "raise":
                    // Raises THIS window to the top of the ordinary band without
                    // activating it. It is the test stimulus for "something else
                    // took the top of the ordinary z-order": the harness is our
                    // own fixture, so moving it is not the forbidden case, which
                    // is Papers re-stacking a foreign application.
                    {
                        var ins = Native.SetWindowPos(main, IntPtr.Zero, 0, 0, 0, 0,
                            0x0001 | 0x0002 | 0x0010); // HWND_TOP | NOSIZE | NOMOVE | NOACTIVATE
                        note = ins ? "raised" : "raise-failed";
                    }
                    return;
                case "topmost":
                    // Makes this harness an "already-topmost target", which is on
                    // the forbidden list. It exists so the refusal can be tested
                    // against a window that really is topmost rather than one we
                    // merely called topmost.
                    {
                        var ins = Native.SetWindowPos(main, new IntPtr(-1), 0, 0, 0, 0,
                            0x0001 | 0x0002 | 0x0010); // NOSIZE | NOMOVE | NOACTIVATE
                        note = ins ? "topmost-set" : "topmost-failed";
                    }
                    return;
                case "untopmost":
                    {
                        var ins = Native.SetWindowPos(main, new IntPtr(-2), 0, 0, 0, 0,
                            0x0001 | 0x0002 | 0x0010); // HWND_NOTOPMOST
                        note = ins ? "topmost-cleared" : "topmost-failed";
                    }
                    return;
                case "report":
                    note = "reported";
                    return;
                case "quit":
                    Persist();
                    Native.DestroyWindow(main);
                    return;
                default:
                    note = "unknown-command:" + command;
                    return;
            }
        }

        private void Persist()
        {
            try
            {
                var r = new Native.RECT();
                if (main != IntPtr.Zero && Native.GetWindowRect(main, out r))
                {
                    File.WriteAllText(Path.Combine(controlDir, "persisted.json"),
                        "{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + "}");
                }
            }
            catch { }
        }

        private void WriteStatus()
        {
            try
            {
                var sb = new StringBuilder();
                var r = new Native.RECT();
                Native.GetWindowRect(main, out r);
                var pl = new Native.WINDOWPLACEMENT();
                pl.length = Marshal.SizeOf(typeof(Native.WINDOWPLACEMENT));
                Native.GetWindowPlacement(main, ref pl);
                var ext = new Native.RECT();
                int extOk = Native.DwmGetWindowAttribute(main, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out ext, Marshal.SizeOf(typeof(Native.RECT)));

                uint fgPid; Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out fgPid);

                sb.Append("{");
                sb.Append("\"pid\":").Append(Process.GetCurrentProcess().Id).Append(",");
                sb.Append("\"hwnd\":").Append(main.ToInt64()).Append(",");
                sb.Append("\"title\":\"").Append(Escape(title)).Append("\",");
                sb.Append("\"awareness\":\"").Append(Escape(awareness)).Append("\",");
                sb.Append("\"rect\":{\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
                  .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top).Append("},");
                sb.Append("\"dwmExtendedFrameBounds\":").Append(extOk == 0
                    ? "{\"x\":" + ext.Left + ",\"y\":" + ext.Top + ",\"w\":" + (ext.Right - ext.Left) + ",\"h\":" + (ext.Bottom - ext.Top) + "}"
                    : "null").Append(",");
                sb.Append("\"placement\":{\"showCmd\":").Append(pl.showCmd)
                  .Append(",\"rcNormal\":{\"x\":").Append(pl.rcNormalPosition.Left).Append(",\"y\":").Append(pl.rcNormalPosition.Top)
                  .Append(",\"w\":").Append(pl.rcNormalPosition.Right - pl.rcNormalPosition.Left)
                  .Append(",\"h\":").Append(pl.rcNormalPosition.Bottom - pl.rcNormalPosition.Top).Append("}},");
                sb.Append("\"minTrack\":{\"w\":").Append(minW).Append(",\"h\":").Append(minH).Append("},");
                sb.Append("\"owned\":").Append(owned == IntPtr.Zero ? "null" : owned.ToInt64().ToString()).Append(",");
                sb.Append("\"hung\":").Append(hung ? "true" : "false").Append(",");
                sb.Append("\"foregroundIsSelf\":").Append(fgPid == (uint)Process.GetCurrentProcess().Id ? "true" : "false").Append(",");
                sb.Append("\"note\":\"").Append(Escape(note)).Append("\"");
                sb.Append("}");

                File.WriteAllText(Path.Combine(controlDir, "status.json"), sb.ToString());
            }
            catch { }
        }

        private static string Escape(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
