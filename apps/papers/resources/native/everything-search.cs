using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class EverythingNative
{
    private const uint REQUEST_FILE_NAME = 0x00000001;
    private const uint REQUEST_PATH = 0x00000002;
    private const uint REQUEST_FULL_PATH = 0x00000004;
    private const uint REQUEST_SIZE = 0x00000010;
    private const uint REQUEST_DATE_MODIFIED = 0x00000040;
    private const uint REQUEST_ATTRIBUTES = 0x00000100;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low; public uint High; }

    [DllImport("Everything64.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetSearchW(string search);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetMatchPath([MarshalAs(UnmanagedType.Bool)] bool enabled);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetMatchCase([MarshalAs(UnmanagedType.Bool)] bool enabled);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetMatchWholeWord([MarshalAs(UnmanagedType.Bool)] bool enabled);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetRegex([MarshalAs(UnmanagedType.Bool)] bool enabled);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetMax(uint max);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetOffset(uint offset);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_SetRequestFlags(uint flags);
    [DllImport("Everything64.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Everything_QueryW([MarshalAs(UnmanagedType.Bool)] bool wait);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetLastError();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetNumResults();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetTotResults();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Everything_IsFolderResult(uint index);
    [DllImport("Everything64.dll", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetResultFullPathNameW(uint index, StringBuilder buffer, uint bufferChars);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Everything_GetResultSize(uint index, out long size);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Everything_GetResultDateModified(uint index, out FileTime fileTime);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetResultAttributes(uint index);
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetMajorVersion();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetMinorVersion();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetRevision();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern uint Everything_GetBuildNumber();
    [DllImport("Everything64.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void Everything_Reset();

    private static string B64(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? String.Empty));
    }

    private static long ToUnixMilliseconds(FileTime value)
    {
        ulong raw = ((ulong)value.High << 32) | value.Low;
        if (raw == 0) return -1;
        try
        {
            DateTime utc = DateTime.FromFileTimeUtc(unchecked((long)raw));
            return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }
        catch { return -1; }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.WriteLine("ERR\t" + B64("usage: papers-everything-search <limit> <query>"));
            return 2;
        }

        uint limit;
        if (!UInt32.TryParse(args[0], out limit) || limit < 1 || limit > 1000)
        {
            Console.WriteLine("ERR\t" + B64("invalid result limit"));
            return 2;
        }

        try
        {
            Everything_Reset();
            Everything_SetSearchW(args[1]);
            Everything_SetMatchPath(false);
            Everything_SetMatchCase(false);
            Everything_SetMatchWholeWord(false);
            Everything_SetRegex(false);
            Everything_SetOffset(0);
            Everything_SetMax(limit);
            Everything_SetRequestFlags(REQUEST_FILE_NAME | REQUEST_PATH | REQUEST_FULL_PATH | REQUEST_SIZE | REQUEST_DATE_MODIFIED | REQUEST_ATTRIBUTES);

            if (!Everything_QueryW(true))
            {
                Console.WriteLine("ERR\t" + B64("Everything IPC query failed (" + Everything_GetLastError() + ")"));
                return 3;
            }

            uint count = Everything_GetNumResults();
            uint total = Everything_GetTotResults();
            string version = Everything_GetMajorVersion() + "." + Everything_GetMinorVersion() + "." + Everything_GetRevision() + "." + Everything_GetBuildNumber();
            Console.WriteLine("META\t" + count + "\t" + total + "\t" + version);

            for (uint i = 0; i < count; i++)
            {
                var buffer = new StringBuilder(32768);
                Everything_GetResultFullPathNameW(i, buffer, (uint)buffer.Capacity);
                long size;
                bool hasSize = Everything_GetResultSize(i, out size);
                FileTime modified;
                bool hasModified = Everything_GetResultDateModified(i, out modified);
                uint attrs = Everything_GetResultAttributes(i);
                Console.WriteLine(
                    "R\t" +
                    (Everything_IsFolderResult(i) ? "d" : "f") + "\t" +
                    (hasSize ? size.ToString() : "-1") + "\t" +
                    (hasModified ? ToUnixMilliseconds(modified).ToString() : "-1") + "\t" +
                    attrs + "\t" +
                    B64(buffer.ToString())
                );
            }
            Everything_Reset();
            return 0;
        }
        catch (DllNotFoundException)
        {
            Console.WriteLine("ERR\t" + B64("Everything SDK bridge DLL is unavailable"));
            return 4;
        }
        catch (Exception error)
        {
            Console.WriteLine("ERR\t" + B64(error.Message));
            return 5;
        }
    }
}
