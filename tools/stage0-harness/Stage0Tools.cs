// STAGE 0 window tools — one binary, three roles.
//
//   --role probe      measure only. Never mutates anything.
//   --role follower   the experimenter. Stands in for Papers.
//   --role watchdog   the dead-man. A SEPARATE PROCESS that restores the lease.
//
// The split is the point of STAGE 0.0. The dangerous contract is not
// adopt-manipulate-release; it is adopt, then the experimenter is killed, and the
// creator's application stays where it was last put — and persists those bounds
// and opens there tomorrow. A watchdog inside the experimenter cannot cover that,
// so the follower spawns this same binary in its watchdog role and the two share
// nothing but a lease file on disk.
//
// Measurement convention (decided before measuring, see the STAGE 0 record):
// GetWindowRect is the pass/fail quantity, taken under an explicitly
// Per-Monitor-V2-aware process; DWMWA_EXTENDED_FRAME_BOUNDS is recorded as
// diagnostic only and is never compared. Both sides of every comparison use the
// same call, so a delta is a positioning error and never a unit mismatch.
//
// Owned windows are enumerated, not ignored: a follower that manages a main HWND
// beautifully but strands an app-owned modal behind another surface produces
// "the application is frozen" while an invisible modal waits for input.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Stage0Tools
{
    internal static class N
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length, flags, showCmd;
            public POINT ptMinPosition, ptMaxPosition;
            public RECT rcNormalPosition;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

        [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int index);
        [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
        [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint tid);
        [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr mon, int type, out uint x, out uint y);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT val, int size);
        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int cls, out uint info, uint len, out uint ret);

        public const uint GW_HWNDNEXT = 2, GW_OWNER = 4;
        public const int GWL_EXSTYLE = -20, GWL_STYLE = -16;
        public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010, SWP_ASYNCWINDOWPOS = 0x4000;
        public const uint WS_EX_TOPMOST = 0x00000008, WS_EX_TOOLWINDOW = 0x00000080;
        public const uint WS_CHILD = 0x40000000, WS_POPUP = 0x80000000;
        public const int DWMWA_CLOAKED = 14;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        public const uint MONITOR_DEFAULTTONEAREST = 2;
        public const int WPF_ASYNCWINDOWPLACEMENT = 0x0004;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint TOKEN_QUERY = 0x0008;
        public const int TokenElevation = 20;

        public static long Ptr(IntPtr h) { return h.ToInt64(); }
        public static IntPtr H(long v) { return new IntPtr(v); }
    }

    internal sealed class Observation
    {
        public long Hwnd;
        public string ClassName = "";
        public string Title = "";
        public uint Pid;
        public bool Visible;
        public bool Cloaked;
        public int ZIndex = -1;
        public bool IsTopmost;
        public long ExStyle, Style;
        public bool IsOwned;
        public long Owner;
        public bool IsChild;
        public int[] Rect = new int[4];
        public int[] DwmFrame = new int[4];
        public bool DwmFrameOk;
        public int ShowCmd;
        public int[] RcNormal = new int[4];
        public uint Dpi;
        public string Monitor = "";
        public int[] MonitorRect = new int[4];
        public bool Elevated;

        public string ToJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\"hwnd\":").Append(Hwnd);
            sb.Append(",\"class\":\"").Append(Esc(ClassName)).Append('"');
            sb.Append(",\"title\":\"").Append(Esc(Title)).Append('"');
            sb.Append(",\"pid\":").Append(Pid);
            sb.Append(",\"visible\":").Append(Visible ? "true" : "false");
            sb.Append(",\"cloaked\":").Append(Cloaked ? "true" : "false");
            sb.Append(",\"zIndex\":").Append(ZIndex);
            sb.Append(",\"topmost\":").Append(IsTopmost ? "true" : "false");
            sb.Append(",\"exStyle\":").Append(ExStyle);
            sb.Append(",\"style\":").Append(Style);
            sb.Append(",\"owned\":").Append(IsOwned ? "true" : "false");
            sb.Append(",\"owner\":").Append(Owner);
            sb.Append(",\"child\":").Append(IsChild ? "true" : "false");
            sb.Append(",\"rect\":").Append(Rect4(Rect));
            sb.Append(",\"dwmExtendedFrameBounds\":").Append(DwmFrameOk ? Rect4(DwmFrame) : "null");
            sb.Append(",\"showCmd\":").Append(ShowCmd);
            sb.Append(",\"rcNormalPosition\":").Append(Rect4(RcNormal));
            sb.Append(",\"dpi\":").Append(Dpi);
            sb.Append(",\"monitor\":\"").Append(Esc(Monitor)).Append('"');
            sb.Append(",\"monitorRect\":").Append(Rect4(MonitorRect));
            sb.Append(",\"elevated\":").Append(Elevated ? "true" : "false");
            sb.Append('}');
            return sb.ToString();
        }

        private static string Rect4(int[] r)
        {
            return "{\"x\":" + r[0] + ",\"y\":" + r[1] + ",\"w\":" + r[2] + ",\"h\":" + r[3] + "}";
        }
        public static string Esc(string s)
        {
            return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }

    internal static class Win
    {
        /// <summary>Enumerate top-level windows in Z-order, topmost first.</summary>
        public static List<Observation> Enumerate()
        {
            var list = new List<Observation>();
            int z = 0;
            IntPtr fg = N.GetForegroundWindow();
            for (IntPtr h = N.GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = N.GetWindow(h, N.GW_HWNDNEXT))
            {
                list.Add(Observe(h, z++, h == fg));
            }
            return list;
        }

        public static Observation Observe(IntPtr h, int zIndex, bool isForeground)
        {
            var o = new Observation { Hwnd = N.Ptr(h), ZIndex = zIndex };
            var sb = new StringBuilder(256);
            N.GetClassName(h, sb, sb.Capacity); o.ClassName = sb.ToString();
            sb.Clear(); N.GetWindowTextW(h, sb, sb.Capacity); o.Title = sb.ToString();
            uint pid; N.GetWindowThreadProcessId(h, out pid); o.Pid = pid;
            o.Visible = N.IsWindowVisible(h);
            int cloak = 0;
            if (N.DwmGetWindowAttribute(h, N.DWMWA_CLOAKED, out cloak, 4) == 0) o.Cloaked = cloak != 0;
            o.ExStyle = N.GetWindowLongPtrW(h, N.GWL_EXSTYLE).ToInt64();
            o.Style = N.GetWindowLongPtrW(h, N.GWL_STYLE).ToInt64();
            o.IsTopmost = (o.ExStyle & N.WS_EX_TOPMOST) != 0;
            o.IsChild = (o.Style & N.WS_CHILD) != 0;
            IntPtr owner = N.GetWindow(h, N.GW_OWNER);   // there is no exported GetWindowOwner; GW_OWNER is the call
            o.Owner = N.Ptr(owner); o.IsOwned = owner != IntPtr.Zero;
            N.RECT r;
            if (N.GetWindowRect(h, out r)) o.Rect = new[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
            N.RECT ext;
            if (N.DwmGetWindowAttribute(h, N.DWMWA_EXTENDED_FRAME_BOUNDS, out ext, Marshal.SizeOf(typeof(N.RECT))) == 0)
            {
                o.DwmFrameOk = true;
                o.DwmFrame = new[] { ext.Left, ext.Top, ext.Right - ext.Left, ext.Bottom - ext.Top };
            }
            var pl = new N.WINDOWPLACEMENT(); pl.length = Marshal.SizeOf(typeof(N.WINDOWPLACEMENT));
            if (N.GetWindowPlacement(h, ref pl))
            {
                o.ShowCmd = pl.showCmd;
                o.RcNormal = new[] { pl.rcNormalPosition.Left, pl.rcNormalPosition.Top,
                    pl.rcNormalPosition.Right - pl.rcNormalPosition.Left, pl.rcNormalPosition.Bottom - pl.rcNormalPosition.Top };
            }
            o.Dpi = N.GetDpiForWindow(h);
            IntPtr mon = N.MonitorFromWindow(h, N.MONITOR_DEFAULTTONEAREST);
            if (mon != IntPtr.Zero)
            {
                var mi = new N.MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(N.MONITORINFO));
                if (N.GetMonitorInfo(mon, ref mi))
                {
                    o.MonitorRect = new[] { mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right - mi.rcMonitor.Left, mi.rcMonitor.Bottom - mi.rcMonitor.Top };
                }
                uint dx, dy;
                if (N.GetDpiForMonitor(mon, 0, out dx, out dy) == 0) o.Monitor = "dpi:" + dx + "x" + dy;
            }
            o.Elevated = IsElevated(pid);
            return o;
        }

        private static bool IsElevated(uint pid)
        {
            IntPtr proc = N.OpenProcess(N.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) return false;
            try
            {
                IntPtr token;
                if (!N.OpenProcessToken(proc, N.TOKEN_QUERY, out token)) return false;
                try
                {
                    uint info, ret;
                    if (!N.GetTokenInformation(token, N.TokenElevation, out info, 4, out ret)) return false;
                    return info != 0;
                }
                finally { N.CloseHandle(token); }
            }
            finally { N.CloseHandle(proc); }
        }

        /// <summary>Process start time, so PID reuse cannot be mistaken for continuity.</summary>
        public static string ProcessIdentity(uint pid)
        {
            try
            {
                using (var p = Process.GetProcessById((int)pid))
                {
                    return p.StartTime.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
                }
            }
            catch { return null; }
        }

        public static bool ProcessIdentityMatches(uint pid, string startedAtUtc)
        {
            string now = ProcessIdentity(pid);
            return now != null && startedAtUtc != null && string.Equals(now, startedAtUtc, StringComparison.Ordinal);
        }
    }

    /// <summary>The lease: everything needed to undo, and nothing that permits reacquiring.</summary>
    internal sealed class Lease
    {
        public string LeaseId = "";
        public long Hwnd;
        public uint TargetPid;
        public string TargetStartedAt = "";
        public string TargetClass = "";
        public string TargetTitle = "";
        public int[] Rect = new int[4];
        public int[] RcNormal = new int[4];
        public int ShowCmd;
        public bool WasTopmost;
        public long ExStyle;
        public long Style;
        public int[] MonitorRect = new int[4];
        public uint ExperimenterPid;
        public string ExperimenterStartedAt = "";
        public string ExperimenterExe = "";
        public string CreatedAt = "";
        public string State = "active";      // active | released | restored-by-watchdog | target-gone | refused
        public string Note = "";

        public string ToJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\"leaseId\":\"").Append(Observation.Esc(LeaseId)).Append('"');
            sb.Append(",\"hwnd\":").Append(Hwnd);
            sb.Append(",\"targetPid\":").Append(TargetPid);
            sb.Append(",\"targetStartedAt\":\"").Append(Observation.Esc(TargetStartedAt)).Append('"');
            sb.Append(",\"targetClass\":\"").Append(Observation.Esc(TargetClass)).Append('"');
            sb.Append(",\"targetTitle\":\"").Append(Observation.Esc(TargetTitle)).Append('"');
            sb.Append(",\"rect\":").Append(R(Rect));
            sb.Append(",\"rcNormalPosition\":").Append(R(RcNormal));
            sb.Append(",\"showCmd\":").Append(ShowCmd);
            sb.Append(",\"wasTopmost\":").Append(WasTopmost ? "true" : "false");
            sb.Append(",\"exStyle\":").Append(ExStyle);
            sb.Append(",\"style\":").Append(Style);
            sb.Append(",\"monitorRect\":").Append(R(MonitorRect));
            sb.Append(",\"experimenterPid\":").Append(ExperimenterPid);
            sb.Append(",\"experimenterStartedAt\":\"").Append(Observation.Esc(ExperimenterStartedAt)).Append('"');
            sb.Append(",\"experimenterExe\":\"").Append(Observation.Esc(ExperimenterExe)).Append('"');
            sb.Append(",\"createdAt\":\"").Append(Observation.Esc(CreatedAt)).Append('"');
            sb.Append(",\"state\":\"").Append(Observation.Esc(State)).Append('"');
            sb.Append(",\"note\":\"").Append(Observation.Esc(Note)).Append('"');
            sb.Append('}');
            return sb.ToString();
        }
        private static string R(int[] r) { return "{\"x\":" + r[0] + ",\"y\":" + r[1] + ",\"w\":" + r[2] + ",\"h\":" + r[3] + "}"; }

        public static Lease FromJson(string json)
        {
            var l = new Lease();
            l.LeaseId = Str(json, "leaseId");
            l.Hwnd = Num(json, "hwnd");
            l.TargetPid = (uint)Num(json, "targetPid");
            l.TargetStartedAt = Str(json, "targetStartedAt");
            l.TargetClass = Str(json, "targetClass");
            l.TargetTitle = Str(json, "targetTitle");
            l.Rect = ParseRect(json, "rect");
            l.RcNormal = ParseRect(json, "rcNormalPosition");
            l.ShowCmd = (int)Num(json, "showCmd");
            l.WasTopmost = json.Contains("\"wasTopmost\":true");
            l.ExStyle = Num(json, "exStyle");
            l.Style = Num(json, "style");
            l.MonitorRect = ParseRect(json, "monitorRect");
            l.ExperimenterPid = (uint)Num(json, "experimenterPid");
            l.ExperimenterStartedAt = Str(json, "experimenterStartedAt");
            l.ExperimenterExe = Str(json, "experimenterExe");
            l.CreatedAt = Str(json, "createdAt");
            l.State = Str(json, "state");
            l.Note = Str(json, "note");
            return l;
        }

        private static long Num(string s, string k)
        {
            var m = System.Text.RegularExpressions.Regex.Match(s, "\"" + k + "\"\\s*:\\s*(-?\\d+)");
            return m.Success ? long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        }
        private static string Str(string s, string k)
        {
            var m = System.Text.RegularExpressions.Regex.Match(s, "\"" + k + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            return m.Success ? m.Groups[1].Value.Replace("\\\"", "\"").Replace("\\\\", "\\") : "";
        }
        private static int[] ParseRect(string s, string k)
        {
            var m = System.Text.RegularExpressions.Regex.Match(s, "\"" + k + "\"\\s*:\\s*\\{\"x\":(-?\\d+),\"y\":(-?\\d+),\"w\":(-?\\d+),\"h\":(-?\\d+)\\}");
            if (!m.Success) return new int[4];
            return new[] { int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value), int.Parse(m.Groups[4].Value) };
        }
    }

    internal static class Program
    {
        private static string leasePath, controlDir, hostSpec;
        private static long targetHwnd, hostHwnd;
        private static bool asyncPos;
        private static string lastCommand = "";

        private static void Main(string[] args)
        {
            // Before anything creates a window, or the call is refused.
            N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2

            var a = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string k = args[i].Substring(2);
                string v = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "1";
                a[k] = v;
            }
            string role = a.ContainsKey("role") ? a["role"] : "probe";
            leasePath = a.ContainsKey("lease") ? a["lease"] : null;
            controlDir = a.ContainsKey("control") ? a["control"] : null;
            hostSpec = a.ContainsKey("host") ? a["host"] : null;
            if (a.ContainsKey("target")) long.TryParse(a["target"], out targetHwnd);
            if (a.ContainsKey("hostid")) long.TryParse(a["hostid"], out hostHwnd);
            asyncPos = a.ContainsKey("async");

            switch (role)
            {
                case "probe": Probe(a); return;
                case "follower": Follower(a); return;
                case "watchdog": Watchdog(); return;
                default: Console.Error.WriteLine("unknown role: " + role); Environment.Exit(2); return;
            }
        }

        // ── probe: measurement only, never mutates ───────────────────────────
        private static void Probe(Dictionary<string, string> a)
        {
            var all = Win.Enumerate();
            var sb = new StringBuilder();
            sb.Append("{\"dpiAwareness\":\"per-monitor-v2\"");
            sb.Append(",\"convention\":\"GetWindowRect, physical pixels, PMv2 measurer\"");
            IntPtr fg = N.GetForegroundWindow();
            uint fgPid; N.GetWindowThreadProcessId(fg, out fgPid);
            sb.Append(",\"foregroundHwnd\":").Append(N.Ptr(fg)).Append(",\"foregroundPid\":").Append(fgPid);
            sb.Append(",\"windows\":[");
            bool first = true;
            foreach (var o in all)
            {
                if (a.ContainsKey("pid") && o.Pid != uint.Parse(a["pid"])) continue;
                if (!first) sb.Append(',');
                first = false;
                sb.Append(o.ToJson());
            }
            sb.Append("]}");
            Console.Out.Write(sb.ToString());
        }

        // ── follower: the experimenter ──────────────────────────────────────
        private static void Follower(Dictionary<string, string> a)
        {
            if (leasePath == null || controlDir == null) { Console.Error.WriteLine("follower needs --lease and --control"); Environment.Exit(2); }
            Directory.CreateDirectory(controlDir);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(leasePath)));

            IntPtr target = N.H(targetHwnd);
            if (!N.IsWindow(target)) { Refuse("target is not a window"); return; }

            var obs = Win.Observe(target, -1, false);

            // Fail closed on everything §6 forbids, by name, before any lease.
            if (obs.IsChild) { Refuse("target is a child window"); return; }
            if (obs.IsTopmost) { Refuse("target is already topmost"); return; }
            if (obs.Elevated) { Refuse("target is elevated"); return; }
            if ((obs.ExStyle & N.WS_EX_TOOLWINDOW) != 0) { Refuse("target is a tool window"); return; }
            if (obs.Cloaked) { Refuse("target is cloaked"); return; }
            if (obs.ShowCmd == 2 || obs.ShowCmd == 3) { Refuse("target is minimised or maximised; restored-window mechanics first"); return; }
            if (obs.ShowCmd == 0) { Refuse("target placement is unreadable"); return; }

            var lease = new Lease
            {
                LeaseId = Guid.NewGuid().ToString("D"),
                Hwnd = N.Ptr(target),
                TargetPid = obs.Pid,
                TargetStartedAt = Win.ProcessIdentity(obs.Pid),
                TargetClass = obs.ClassName,
                TargetTitle = obs.Title,
                Rect = obs.Rect,
                RcNormal = obs.RcNormal,
                ShowCmd = obs.ShowCmd,
                WasTopmost = obs.IsTopmost,
                ExStyle = obs.ExStyle,
                Style = obs.Style,
                MonitorRect = obs.MonitorRect,
                ExperimenterPid = (uint)Process.GetCurrentProcess().Id,
                ExperimenterStartedAt = Win.ProcessIdentity((uint)Process.GetCurrentProcess().Id),
                ExperimenterExe = Process.GetCurrentProcess().MainModule.FileName,
                CreatedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                State = "active"
            };

            // Journal BEFORE the first mutation. A lease written after the move
            // is a lease that does not exist for the crash it is meant to cover.
            File.WriteAllText(leasePath, lease.ToJson());

            // The dead-man is a separate process reading only that file.
            var wd = Process.Start(new ProcessStartInfo
            {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "--role watchdog --lease \"" + leasePath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            });

            WriteStatus(lease, wd == null ? 0 : wd.Id, "acquired", true);

            // Z-order maintenance is a SEPARATE controller from geometry, with its
            // own gate, on its own thread. It is deliberately not a flag inside
            // the placement path: "one loop calling SetWindowPos with a Z
            // argument" is the shape the reviewer rejected, because it makes the
            // foreground rule a condition inside the thing it is meant to stop.
            var zStop = new ManualResetEventSlim(false);
            bool zOrderEnabled = false;
            var zThread = new Thread(() =>
            {
                while (!zStop.IsSet)
                {
                    Thread.Sleep(250);
                    if (!zOrderEnabled) continue;
                    try
                    {
                        IntPtr host = N.H(hostHwnd);
                        if (hostHwnd == 0 || !N.IsWindow(host)) continue;

                        // PAPERS HAS NO Z-ORDER AUTHORITY WHILE AN UNRELATED
                        // APPLICATION IS FOREGROUND. The central architectural
                        // gate: if the creator raises Outlook, silently re-hoisting
                        // the adopted window is indistinguishable from malware.
                        IntPtr fg = N.GetForegroundWindow();
                        uint fgPid; N.GetWindowThreadProcessId(fg, out fgPid);
                        uint hostPid; N.GetWindowThreadProcessId(host, out hostPid);
                        bool papersFamilyForeground = fgPid == hostPid;

                        WriteZState(papersFamilyForeground, fgPid, hostPid);
                        if (!papersFamilyForeground) continue;

                        IntPtr target = N.H(lease.Hwnd);
                        if (Revalidate(lease, target) != null) continue;
                        // Immediately above the host, in the ordinary band. No
                        // HWND_TOPMOST, no activation — nothing that could take
                        // focus from whatever the creator is using.
                        N.SetWindowPos(target, host, 0, 0, 0, 0,
                            N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE);
                    }
                    catch { }
                }
            });
            zThread.IsBackground = true;
            zThread.Start();

            while (true)
            {
                string cmd = ReadCommand();
                if (cmd == null) { Thread.Sleep(50); continue; }
                bool quit = false;
                switch (cmd.Split(':')[0].ToLowerInvariant())
                {
                    case "place":
                        Place(lease, cmd);
                        break;
                    case "zorder":
                        zOrderEnabled = cmd.EndsWith("on", StringComparison.OrdinalIgnoreCase);
                        WriteZState(false, 0, 0);
                        break;
                    case "release":
                        zStop.Set();
                        Restore(lease, "released", "explicit release");
                        quit = true;
                        break;
                    case "quit":
                        // Deliberately NOT a release: this models Papers being
                        // killed with the window still adopted, which is the case
                        // the watchdog exists for.
                        WriteStatus(Lease.FromJson(File.ReadAllText(leasePath)), wd == null ? 0 : wd.Id, "abandoned", false);
                        Environment.Exit(0);
                        break;
                    case "report":
                        break;
                    default:
                        break;
                }
                if (quit) break;
                WriteStatus(Lease.FromJson(File.ReadAllText(leasePath)), wd == null ? 0 : wd.Id, "ok", false);
            }
        }

        private static void WriteZState(bool authority, uint fgPid, uint hostPid)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append("{\"zOrderAuthority\":").Append(authority ? "true" : "false");
                sb.Append(",\"foregroundPid\":").Append(fgPid);
                sb.Append(",\"hostPid\":").Append(hostPid);
                sb.Append(",\"rule\":\"no z-order authority while an unrelated application is foreground\"");
                sb.Append(",\"at\":\"").Append(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)).Append("\"}");
                File.WriteAllText(Path.Combine(controlDir, "zorder-state.json"), sb.ToString());
            }
            catch { }
        }

        private static void Refuse(string why)
        {
            var l = new Lease { State = "refused", Note = why, CreatedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
            if (leasePath != null) File.WriteAllText(leasePath, l.ToJson());
            Console.Error.WriteLine("REFUSED: " + why);
            Environment.Exit(3);
        }

        private static string ReadCommand()
        {
            string p = Path.Combine(controlDir, "command.txt");
            try
            {
                if (!File.Exists(p)) return null;
                string c = File.ReadAllText(p).Trim();
                if (c.Length == 0 || c == lastCommand) return null;
                lastCommand = c;
                return c;
            }
            catch { return null; }
        }

        private static void Place(Lease lease, string cmd)
        {
            var parts = cmd.Split(':');
            if (parts.Length < 2) return;
            var nums = parts[1].Split(',');
            if (nums.Length != 4) return;
            int x = int.Parse(nums[0]), y = int.Parse(nums[1]), w = int.Parse(nums[2]), h = int.Parse(nums[3]);

            IntPtr target = N.H(lease.Hwnd);
            string doubt = Revalidate(lease, target);
            if (doubt != null)
            {
                // Terminal. No reacquisition, no sibling search, no fallback.
                lease.State = "target-gone";
                lease.Note = doubt;
                File.WriteAllText(leasePath, lease.ToJson());
                Console.Error.WriteLine("LEASE TERMINAL: " + doubt);
                return;
            }

            uint flags = N.SWP_NOACTIVATE | N.SWP_NOZORDER;
            if (asyncPos) flags |= N.SWP_ASYNCWINDOWPOS;
            bool ok = N.SetWindowPos(target, IntPtr.Zero, x, y, w, h, flags);
            if (!ok)
            {
                int err = Marshal.GetLastWin32Error();
                lease.Note = "SetWindowPos failed err=" + err;
                File.WriteAllText(leasePath, lease.ToJson());
                Console.Error.WriteLine("SetWindowPos failed: " + err);
            }
        }

        /// <summary>Everything that would make us doubt continuity, checked before every mutation.</summary>
        private static string Revalidate(Lease lease, IntPtr target)
        {
            if (!N.IsWindow(target)) return "the selected window no longer exists";
            var o = Win.Observe(target, -1, false);
            if (o.Pid != lease.TargetPid) return "the window now belongs to a different process";
            if (o.ClassName != lease.TargetClass) return "the window class changed";
            if (!Win.ProcessIdentityMatches(lease.TargetPid, lease.TargetStartedAt))
                return "the target process identity changed (a different process now holds this pid)";
            if (o.IsTopmost && !lease.WasTopmost) return "the target became topmost under us";
            return null;
        }

        /// <summary>Restore by placement, never by feeding rcNormalPosition to SetWindowPos.</summary>
        private static void Restore(Lease lease, string state, string why)
        {
            IntPtr target = N.H(lease.Hwnd);
            string doubt = Revalidate(lease, target);
            if (doubt != null)
            {
                lease.State = "target-gone";
                lease.Note = doubt;
            }
            else
            {
                var pl = new N.WINDOWPLACEMENT();
                pl.length = Marshal.SizeOf(typeof(N.WINDOWPLACEMENT));
                pl.flags = N.WPF_ASYNCWINDOWPLACEMENT; // survives a hung target
                pl.showCmd = lease.ShowCmd == 0 ? 1 : lease.ShowCmd;
                pl.rcNormalPosition = new N.RECT
                {
                    Left = lease.RcNormal[0],
                    Top = lease.RcNormal[1],
                    Right = lease.RcNormal[0] + lease.RcNormal[2],
                    Bottom = lease.RcNormal[1] + lease.RcNormal[3]
                };
                bool ok = N.SetWindowPlacement(target, ref pl);
                lease.State = ok ? state : "restore-failed";
                lease.Note = ok ? why : "SetWindowPlacement failed err=" + Marshal.GetLastWin32Error();
            }
            File.WriteAllText(leasePath, lease.ToJson());
        }

        private static void WriteStatus(Lease lease, int watchdogPid, string phase, bool initial)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append("{\"role\":\"follower\",\"phase\":\"").Append(phase).Append('"');
                sb.Append(",\"followerPid\":").Append(Process.GetCurrentProcess().Id);
                sb.Append(",\"watchdogPid\":").Append(watchdogPid);
                sb.Append(",\"asyncWindowPos\":").Append(asyncPos ? "true" : "false");
                sb.Append(",\"lease\":").Append(lease.ToJson());
                sb.Append('}');
                File.WriteAllText(Path.Combine(controlDir, initial ? "follower-initial.json" : "follower-status.json"), sb.ToString());
            }
            catch { }
        }

        // ── watchdog: the dead-man ──────────────────────────────────────────
        private static void Watchdog()
        {
            if (leasePath == null) { Environment.Exit(2); }
            string log = leasePath + ".watchdog.log";
            void Log(string m)
            {
                try { File.AppendAllText(log, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " " + m + Environment.NewLine); } catch { }
            }
            Log("watchdog up, pid " + Process.GetCurrentProcess().Id);

            for (int i = 0; i < 36000; i++)   // ~1 hour at 100 ms, then it gives up rather than lingering
            {
                Thread.Sleep(100);
                Lease lease;
                try
                {
                    if (!File.Exists(leasePath)) continue;
                    lease = Lease.FromJson(File.ReadAllText(leasePath));
                }
                catch { continue; }

                if (lease.State != "active") { Log("lease is " + lease.State + "; watchdog exiting"); return; }

                bool alive = Win.ProcessIdentityMatches(lease.ExperimenterPid, lease.ExperimenterStartedAt);
                if (alive) continue;

                // The experimenter is gone — crashed, killed, or exited without
                // releasing. This is the whole reason the watchdog is a separate
                // process.
                Log("experimenter " + lease.ExperimenterPid + " is gone; restoring");
                IntPtr target = N.H(lease.Hwnd);
                string doubt = Revalidate(lease, target);
                if (doubt != null)
                {
                    lease.State = "target-gone";
                    lease.Note = "experimenter died and the target could not be revalidated: " + doubt;
                    Log(lease.Note);
                }
                else
                {
                    var pl = new N.WINDOWPLACEMENT();
                    pl.length = Marshal.SizeOf(typeof(N.WINDOWPLACEMENT));
                    pl.flags = N.WPF_ASYNCWINDOWPLACEMENT;
                    pl.showCmd = lease.ShowCmd == 0 ? 1 : lease.ShowCmd;
                    pl.rcNormalPosition = new N.RECT
                    {
                        Left = lease.RcNormal[0],
                        Top = lease.RcNormal[1],
                        Right = lease.RcNormal[0] + lease.RcNormal[2],
                        Bottom = lease.RcNormal[1] + lease.RcNormal[3]
                    };
                    bool ok = N.SetWindowPlacement(target, ref pl);
                    lease.State = ok ? "restored-by-watchdog" : "restore-failed";
                    lease.Note = ok
                        ? "experimenter died without releasing; placement restored by the watchdog"
                        : "SetWindowPlacement failed err=" + Marshal.GetLastWin32Error();
                    Log(lease.State + ": " + lease.Note);
                }
                try { File.WriteAllText(leasePath, lease.ToJson()); } catch { }
                return;
            }
            Log("watchdog timed out without the experimenter dying");
        }
    }
}
