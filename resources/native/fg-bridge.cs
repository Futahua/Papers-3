using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

// Papers native foreground bridge.
//
// WHY THIS EXISTS
// The launcher overlay must take the keyboard and then give focus back to the
// exact application the creator came from. Electron exposes no API for either
// half, and Papers' PowerShell window helper cannot do it either: a background
// process calling SetForegroundWindow is refused by the Windows foreground
// lock. That was measured, not assumed - the helper reports `restore` success
// while the foreground does not move (LongHorizon probes/probe-25).
//
// WHY C# COMPILED AT RUNTIME
// csc.exe ships with Windows at
// %SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe, so this needs no
// new dependency, no node-gyp, and no change to the packaged layout. The source
// ships as a resource and is compiled once into the Papers Data directory, then
// reused. If compilation is unavailable the bridge is absent, and the overlay
// reports that it could not hand focus back rather than pretending it did.
//
// TWO CALLERS, TWO ROLES
//   fgbridge get             -> the window that currently has the foreground
//   fgbridge set <handle>    -> put the foreground back on that exact window
//   fgbridge iswindow <h>    -> whether the handle is still a real window
//
// `set` is deliberately just BringWindowToTop + SetForegroundWindow. An earlier
// probe tried the AttachThreadInput workarounds and the ALT-tap unlock and
// measured no reliable improvement; the honest sequence is the plain one, and a
// refusal is reported as a refusal.
public class FgBridge
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();

    /** Walk the z-order. GW_HWNDNEXT gives the window BELOW this one, which is
     * exactly what "what was underneath" means. */
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(uint processId);

    private delegate bool EnumWindowsCallback(IntPtr hWnd, IntPtr lParam);

    private const int SW_RESTORE = 9;
    private const int SW_SHOW = 5;
    private const uint GW_HWNDNEXT = 2;
    private const uint GW_OWNER = 4;

    private static string TitleOf(IntPtr h)
    {
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string ClassOf(IntPtr h)
    {
        var sb = new StringBuilder(256);
        GetClassNameW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    private static int ActivatePapersProcess(string executablePath)
    {
        string expectedPath;
        try { expectedPath = Path.GetFullPath(executablePath); }
        catch { Console.WriteLine("found=0 moved=0 allowed=0 detail=invalid-path"); return 2; }
        string processName = Path.GetFileNameWithoutExtension(expectedPath);
        var processIds = new HashSet<uint>();
        int currentProcessId;
        using (Process current = Process.GetCurrentProcess()) currentProcessId = current.Id;
        foreach (Process process in Process.GetProcessesByName(processName))
        {
            try
            {
                if (process.Id != currentProcessId
                    && String.Equals(Path.GetFullPath(process.MainModule.FileName), expectedPath, StringComparison.OrdinalIgnoreCase))
                    processIds.Add((uint)process.Id);
            }
            catch { }
            finally { process.Dispose(); }
        }

        var candidates = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr ignored)
        {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (!processIds.Contains(processId) || !IsWindow(hWnd) || GetWindow(hWnd, GW_OWNER) != IntPtr.Zero)
                return true;
            string title = TitleOf(hWnd);
            if (String.Equals(title, "Papers", StringComparison.Ordinal)) candidates.Add(hWnd);
            return true;
        }, IntPtr.Zero);

        if (candidates.Count == 0)
        {
            Console.WriteLine("found=0 moved=0 allowed=0");
            return 5;
        }

        foreach (IntPtr hWnd in candidates)
        {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
            else if (!IsWindowVisible(hWnd)) ShowWindow(hWnd, SW_SHOW);
            if (GetForegroundWindow() == hWnd)
            {
                Console.WriteLine("found=1 moved=1 allowed=0 pid=" + processId);
                return 0;
            }
            BringWindowToTop(hWnd);
            bool set = SetForegroundWindow(hWnd);
            if (GetForegroundWindow() == hWnd)
            {
                Console.WriteLine("found=1 moved=1 allowed=0 pid=" + processId);
                return 0;
            }

            // A shortcut-launched second process can inherit foreground
            // eligibility even though the already-running process cannot.
            // Transfer that permission before the primary instance handles
            // Electron's second-instance event.
            bool allowed = AllowSetForegroundWindow(processId);
            Console.WriteLine("found=1 moved=0 allowed=" + (allowed ? "1" : "0")
                + " set=" + (set ? "1" : "0") + " pid=" + processId);
            if (allowed) return 0;
        }
        return 4;
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                Console.WriteLine("usage: get | set <handle> | iswindow <handle>");
                return 2;
            }

            string command = args[0].ToLowerInvariant();

            if (command == "activate-papers")
            {
                if (args.Length < 2 || String.IsNullOrWhiteSpace(args[1]))
                {
                    Console.WriteLine("missing executable path");
                    return 2;
                }
                return ActivatePapersProcess(args[1]);
            }

            if (command == "get")
            {
                IntPtr foreground = GetForegroundWindow();
                if (foreground == IntPtr.Zero)
                {
                    Console.WriteLine("none");
                    return 0;
                }
                // The desktop and the shell are not applications the creator can
                // be "in"; reporting them as a focus target would mean handing
                // focus to the desktop.
                string cls = ClassOf(foreground);
                bool isShell = foreground == GetShellWindow()
                    || foreground == GetDesktopWindow()
                    || cls == "Progman"
                    || cls == "WorkerW"
                    || cls == "Shell_TrayWnd";
                Console.WriteLine(
                    "handle=" + foreground.ToInt64()
                    + " shell=" + (isShell ? "1" : "0")
                    + " class=" + cls
                    + " title=" + TitleOf(foreground));
                return 0;
            }

            if (args.Length < 2)
            {
                Console.WriteLine("missing handle");
                return 2;
            }

            IntPtr target;
            long parsed;
            // Int64.TryParse + cast, not IntPtr.TryParse: this source is compiled
            // by the .NET Framework 4.0 csc.exe that ships with Windows, where
            // IntPtr has no TryParse. Measured the hard way - the first version
            // failed to compile and the failure was invisible.
            if (!long.TryParse(args[1], out parsed) || parsed == 0)
            {
                Console.WriteLine("invalid handle");
                return 2;
            }
            target = new IntPtr(parsed);

            if (command == "iswindow")
            {
                Console.WriteLine(IsWindow(target) ? "1" : "0");
                return 0;
            }

            if (command == "next")
            {
                // The next window BELOW `target` in the z-order that a creator
                // could plausibly be looking at: visible, not minimized, not
                // owned by another window (owned windows travel with their
                // owner), and not the shell or desktop. This answers "what was
                // underneath the window I am about to hide", which is the
                // sensible place for focus to land.
                IntPtr candidate = GetWindow(target, GW_HWNDNEXT);
                int guard = 0;
                while (candidate != IntPtr.Zero && guard < 2000)
                {
                    guard++;
                    bool usable = candidate != target
                        && candidate != GetShellWindow()
                        && candidate != GetDesktopWindow()
                        && IsWindow(candidate)
                        && IsWindowVisible(candidate)
                        && !IsIconic(candidate)
                        && GetWindow(candidate, GW_OWNER) == IntPtr.Zero;
                    if (usable)
                    {
                        Console.WriteLine(
                            "handle=" + candidate.ToInt64()
                            + " class=" + ClassOf(candidate)
                            + " title=" + TitleOf(candidate));
                        return 0;
                    }
                    candidate = GetWindow(candidate, GW_HWNDNEXT);
                }
                Console.WriteLine("none");
                return 5;
            }

            if (command == "set")
            {
                if (!IsWindow(target))
                {
                    Console.WriteLine("gone");
                    return 3;
                }
                // If it is ALREADY the foreground, say so and stop. Measured: a
                // SetForegroundWindow call on the window that already owns the
                // foreground can BLOCK indefinitely, and this bridge has a
                // timeout, so a caller would see a timeout instead of an answer.
                // Windows already gives such a process the right to take the
                // foreground, which is exactly why the real hand-back succeeds
                // moments after the caller took focus - and why this guard costs
                // nothing in the case that matters.
                if (GetForegroundWindow() == target)
                {
                    Console.WriteLine("already=1 moved=1 fg=" + target.ToInt64());
                    return 0;
                }
                if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
                bool raised = BringWindowToTop(target);
                bool foregrounded = SetForegroundWindow(target);
                bool moved = GetForegroundWindow() == target;
                Console.WriteLine(
                    "raised=" + (raised ? "1" : "0")
                    + " set=" + (foregrounded ? "1" : "0")
                    + " moved=" + (moved ? "1" : "0")
                    + " fg=" + GetForegroundWindow().ToInt64());
                // Exit 0 only when the foreground REALLY moved. A caller must not
                // be able to read a refusal as success - that false success is
                // exactly what the PowerShell helper produced.
                return moved ? 0 : 4;
            }

            Console.WriteLine("unknown command");
            return 2;
        }
        catch (Exception error)
        {
            Console.WriteLine("error: " + error.Message);
            return 1;
        }
    }
}
