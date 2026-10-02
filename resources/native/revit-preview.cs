using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

[ComImport, Guid("0000000B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IStorage
{
    void CreateStream([MarshalAs(UnmanagedType.LPWStr)] string name, uint mode, uint reserved1, uint reserved2, out IStream stream);
    void OpenStream([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr reserved1, uint mode, uint reserved2, out IStream stream);
}

static class Native
{
    [DllImport("ole32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int StgOpenStorage(
        string name,
        IStorage priority,
        uint mode,
        IntPtr exclude,
        uint reserved,
        out IStorage storage);
}

static class Program
{
    const uint STGM_READ = 0x00000000;
    const uint STGM_SHARE_DENY_WRITE = 0x00000020;
    const uint STGM_SHARE_EXCLUSIVE = 0x00000010;
    const int MAX_STREAM_BYTES = 16 * 1024 * 1024;
    static readonly byte[] PngSignature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    static void WriteError(string message)
    {
        string bounded = (message ?? "unknown error").Replace("\r", " ").Replace("\n", " ");
        if (bounded.Length > 400) bounded = bounded.Substring(0, 400);
        Console.WriteLine("ERR\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(bounded)));
    }

    static byte[] ReadAll(IStream stream)
    {
        System.Runtime.InteropServices.ComTypes.STATSTG stat;
        stream.Stat(out stat, 1);
        long size = stat.cbSize;
        if (size <= 0 || size > MAX_STREAM_BYTES) throw new InvalidOperationException("preview stream size is outside the allowed range");

        byte[] output = new byte[(int)size];
        IntPtr readPointer = Marshal.AllocCoTaskMem(4);
        try
        {
            int offset = 0;
            while (offset < output.Length)
            {
                int requested = Math.Min(1024 * 1024, output.Length - offset);
                byte[] chunk = new byte[requested];
                Marshal.WriteInt32(readPointer, 0);
                stream.Read(chunk, requested, readPointer);
                int read = Marshal.ReadInt32(readPointer);
                if (read <= 0) break;
                Buffer.BlockCopy(chunk, 0, output, offset, read);
                offset += read;
            }
            if (offset != output.Length) Array.Resize(ref output, offset);
            return output;
        }
        finally
        {
            Marshal.FreeCoTaskMem(readPointer);
        }
    }

    static int FindPng(byte[] bytes)
    {
        for (int index = 0; index <= bytes.Length - PngSignature.Length; index++)
        {
            bool match = true;
            for (int sig = 0; sig < PngSignature.Length; sig++)
            {
                if (bytes[index + sig] == PngSignature[sig]) continue;
                match = false;
                break;
            }
            if (match) return index;
        }
        return -1;
    }

    static uint ReadUInt32BigEndian(byte[] bytes, int offset)
    {
        return ((uint)bytes[offset] << 24)
            | ((uint)bytes[offset + 1] << 16)
            | ((uint)bytes[offset + 2] << 8)
            | bytes[offset + 3];
    }

    static int FindPngEnd(byte[] bytes, int start)
    {
        int cursor = start + PngSignature.Length;
        while (cursor + 12 <= bytes.Length)
        {
            uint payload = ReadUInt32BigEndian(bytes, cursor);
            if (payload > MAX_STREAM_BYTES) return bytes.Length;
            long end = (long)cursor + 12L + payload;
            if (end > bytes.Length) return bytes.Length;
            bool isIend = bytes[cursor + 4] == (byte)'I'
                && bytes[cursor + 5] == (byte)'E'
                && bytes[cursor + 6] == (byte)'N'
                && bytes[cursor + 7] == (byte)'D';
            cursor = (int)end;
            if (isIend) return cursor;
        }
        return bytes.Length;
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 1 || String.IsNullOrWhiteSpace(args[0]))
        {
            WriteError("expected one Revit file path");
            return 2;
        }

        IStorage storage = null;
        IStream stream = null;
        try
        {
            string file = Path.GetFullPath(args[0]);
            int hr = Native.StgOpenStorage(
                file,
                null,
                STGM_READ | STGM_SHARE_DENY_WRITE,
                IntPtr.Zero,
                0,
                out storage);
            if (hr < 0 || storage == null)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            try
            {
                storage.OpenStream(
                    "RevitPreview4.0",
                    IntPtr.Zero,
                    STGM_READ | STGM_SHARE_EXCLUSIVE,
                    0,
                    out stream);
            }
            catch (COMException)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            byte[] raw = ReadAll(stream);
            int start = FindPng(raw);
            if (start < 0)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            int end = FindPngEnd(raw, start);
            int length = end - start;
            if (length <= 0 || length > MAX_STREAM_BYTES)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            byte[] png = new byte[length];
            Buffer.BlockCopy(raw, start, png, 0, length);
            Console.WriteLine("PNG\t" + Convert.ToBase64String(png));
            return 0;
        }
        catch (Exception error)
        {
            WriteError(error.GetType().Name + ": " + error.Message);
            return 1;
        }
        finally
        {
            if (stream != null && Marshal.IsComObject(stream))
            {
                try { Marshal.FinalReleaseComObject(stream); } catch { }
            }
            if (storage != null && Marshal.IsComObject(storage))
            {
                try { Marshal.FinalReleaseComObject(storage); } catch { }
            }
        }
    }
}
