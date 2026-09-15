using System;
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

    private const int SW_RESTORE = 9;

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

            if (command == "set")
            {
                if (!IsWindow(target))
                {
                    Console.WriteLine("gone");
                    return 3;
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
