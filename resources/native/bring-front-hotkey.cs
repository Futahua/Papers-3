using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private const int HotkeyId = 0x5041;
    private const uint ModAlt = 0x0001;
    private const uint ModShift = 0x0004;
    private const uint ModNoRepeat = 0x4000;
    private const uint VkA = 0x41;
    private const uint WmHotkey = 0x0312;
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080L;
    private const int SwRestore = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Msg
    {
        public IntPtr Hwnd;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int PtX;
        public int PtY;
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);

    private static string papersExe = "";
    private static string launcher = "";
    private static string telemetry = "";
    private static IntPtr cachedWindow = IntPtr.Zero;

    private static bool SamePath(string a, string b)
    {
        try { return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static IntPtr FindPapersWindow()
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = -1;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused)
        {
            if (!IsWindowVisible(hwnd)) return true;
            if ((GetWindowLongPtr(hwnd, GwlExStyle).ToInt64() & WsExToolWindow) != 0) return true;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return true;
            try
            {
                using (Process process = Process.GetProcessById((int)pid))
                {
                    if (!SamePath(process.MainModule.FileName, papersExe)) return true;
                }
            }
            catch { return true; }
            Rect rect;
            if (!GetWindowRect(hwnd, out rect)) return true;
            long area = Math.Max(1, rect.Right - rect.Left) * (long)Math.Max(1, rect.Bottom - rect.Top);
            if (area > bestArea) { bestArea = area; best = hwnd; }
            return true;
        }, IntPtr.Zero);
        cachedWindow = best;
        return best;
    }

    private static IntPtr GetPapersWindow()
    {
        if (cachedWindow != IntPtr.Zero
            && IsWindow(cachedWindow)
            && IsWindowVisible(cachedWindow)
            && (GetWindowLongPtr(cachedWindow, GwlExStyle).ToInt64() & WsExToolWindow) == 0)
            return cachedWindow;
        cachedWindow = IntPtr.Zero;
        return FindPapersWindow();
    }

    private static bool Activate(IntPtr target)
    {
        if (target == IntPtr.Zero) return false;
        if (IsIconic(target)) ShowWindow(target, SwRestore);
        BringWindowToTop(target);
        if (SetForegroundWindow(target) && GetForegroundWindow() == target) return true;

        IntPtr foreground = GetForegroundWindow();
        uint foregroundPid;
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out foregroundPid);
        uint currentThread = GetCurrentThreadId();
        bool attached = false;
        try
        {
            if (foregroundThread != 0 && foregroundThread != currentThread)
                attached = AttachThreadInput(currentThread, foregroundThread, true);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            return GetForegroundWindow() == target;
        }
        finally
        {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    private static void Launch()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(launcher) && File.Exists(launcher))
            {
                Process.Start(new ProcessStartInfo("wscript.exe", "\"" + launcher + "\"") { UseShellExecute = false, CreateNoWindow = true });
                return;
            }
            if (File.Exists(papersExe)) Process.Start(papersExe);
        }
        catch { }
    }

    private static void Note(long elapsedMs, bool activated, bool launched)
    {
        if (string.IsNullOrWhiteSpace(telemetry)) return;
        try { File.AppendAllText(telemetry, DateTime.UtcNow.ToString("O") + " ms=" + elapsedMs + " activated=" + (activated ? "1" : "0") + " launched=" + (launched ? "1" : "0") + Environment.NewLine); }
        catch { }
    }

    public static int Main(string[] args)
    {
        papersExe = args.Length > 0 ? args[0] : "";
        launcher = args.Length > 1 ? args[1] : "";
        telemetry = args.Length > 2 ? args[2] : "";
        if (string.IsNullOrWhiteSpace(papersExe)) return 2;
        bool first;
        using (Mutex mutex = new Mutex(true, "Papers.BringFrontHotkey.v1", out first))
        {
            if (!first) return 0;
            if (!RegisterHotKey(IntPtr.Zero, HotkeyId, ModAlt | ModShift | ModNoRepeat, VkA)) return 3;
            // Pay the process/window scan once at helper startup, never on the
            // creator's first hotkey press. A destroyed/recreated Papers window
            // is detected and rediscovered lazily by GetPapersWindow().
            FindPapersWindow();
            try
            {
                Msg msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    if (msg.Message != WmHotkey || msg.WParam.ToUInt32() != HotkeyId) continue;
                    Stopwatch watch = Stopwatch.StartNew();
                    IntPtr target = GetPapersWindow();
                    bool activated = Activate(target);
                    bool launched = false;
                    if (!activated && target == IntPtr.Zero) { Launch(); launched = true; }
                    watch.Stop();
                    Note(watch.ElapsedMilliseconds, activated, launched);
                }
            }
            finally { UnregisterHotKey(IntPtr.Zero, HotkeyId); }
        }
        return 0;
    }
}