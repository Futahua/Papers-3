// Reports which processes hold a file (or the files inside a folder) open, through the Windows
// Restart Manager, the same source Explorer uses for its "File In Use" dialog.
//
// Usage: papers-file-lockers.exe <absolute path>
// Output (one record per line, text fields base64 UTF-8):
//   PROC <tab> pid <tab> appName <tab> imagePath <tab> applicationType
//   DONE <tab> registeredFileCount
//   ERR  <tab> message
//
// Read-only by construction: it registers resources and lists them. It never calls RmShutdown,
// never terminates, signals or restarts any process.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class RestartManager
{
    public const int ERROR_MORE_DATA = 234;
    const int CCH_RM_SESSION_KEY = 32;

    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS
    {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
        uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
        [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    public static RM_PROCESS_INFO[] Lockers(string[] files)
    {
        uint session;
        int status = RmStartSession(out session, 0, new StringBuilder(CCH_RM_SESSION_KEY + 1));
        if (status != 0) throw new InvalidOperationException("RmStartSession failed: " + status);
        try
        {
            status = RmRegisterResources(session, (uint)files.Length, files, 0, null, 0, null);
            if (status != 0) throw new InvalidOperationException("RmRegisterResources failed: " + status);
            uint needed = 0, count = 0, reasons = 0;
            RM_PROCESS_INFO[] list = null;
            for (int attempt = 0; attempt < 4; attempt++)
            {
                status = RmGetList(session, out needed, ref count, list, ref reasons);
                if (status == 0) break;
                if (status != ERROR_MORE_DATA) throw new InvalidOperationException("RmGetList failed: " + status);
                count = needed;
                list = new RM_PROCESS_INFO[needed];
            }
            if (status != 0) throw new InvalidOperationException("RmGetList kept growing.");
            if (list == null || count == 0) return new RM_PROCESS_INFO[0];
            var result = new RM_PROCESS_INFO[count];
            Array.Copy(list, result, (int)count);
            return result;
        }
        finally
        {
            RmEndSession(session);
        }
    }
}

static class Native
{
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

    public static string ImagePath(int pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return "";
        try
        {
            var buffer = new StringBuilder(1024);
            int size = buffer.Capacity;
            return QueryFullProcessImageName(process, 0, buffer, ref size) ? buffer.ToString() : "";
        }
        finally
        {
            CloseHandle(process);
        }
    }
}

static class Program
{
    // A folder is checked through the files inside it; bounded so a huge tree cannot stall the caller.
    const int MaxFiles = 2000;

    static string B64(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? ""));
    }

    static List<string> Collect(string target)
    {
        var files = new List<string>();
        if (File.Exists(target)) { files.Add(target); return files; }
        if (!Directory.Exists(target)) return files;
        var pending = new Stack<string>();
        pending.Push(target);
        while (pending.Count > 0 && files.Count < MaxFiles)
        {
            string folder = pending.Pop();
            try
            {
                foreach (string file in Directory.EnumerateFiles(folder))
                {
                    files.Add(file);
                    if (files.Count >= MaxFiles) break;
                }
                foreach (string child in Directory.EnumerateDirectories(folder))
                {
                    // Do not follow junctions or symbolic links out of the folder being recycled.
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) pending.Push(child);
                }
            }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
        }
        return files;
    }

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length != 1 || !Path.IsPathRooted(args[0])) throw new ArgumentException("Pass one absolute path.");
            List<string> files = Collect(args[0]);
            if (files.Count > 0)
            {
                // This helper is never the holder the caller is asking about.
                var seen = new HashSet<int> { System.Diagnostics.Process.GetCurrentProcess().Id };
                foreach (var info in RestartManager.Lockers(files.ToArray()))
                {
                    int pid = info.Process.dwProcessId;
                    if (!seen.Add(pid)) continue;
                    Console.WriteLine("PROC\t" + pid + "\t" + B64(info.strAppName) + "\t" + B64(Native.ImagePath(pid)) + "\t" + info.ApplicationType);
                }
            }
            Console.WriteLine("DONE\t" + files.Count);
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine("ERR\t" + B64(error.Message));
            return 1;
        }
    }
}
