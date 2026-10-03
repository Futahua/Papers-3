using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItemImageFactory
{
    [PreserveSig]
    int GetImage(SIZE size, uint flags, out IntPtr bitmap);
}

[StructLayout(LayoutKind.Sequential)]
struct SIZE
{
    public int cx;
    public int cy;
}

static class Native
{
    public const uint SIIGBF_BIGGERSIZEOK = 0x00000001;
    public const uint SIIGBF_THUMBNAILONLY = 0x00000008;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int SHCreateItemFromParsingName(
        string path,
        IntPtr bindContext,
        ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DeleteObject(IntPtr handle);
}

static class Program
{
    const int MaxPngBytes = 32 * 1024 * 1024;

    static void WriteError(string message)
    {
        string bounded = (message ?? "unknown error").Replace("\r", " ").Replace("\n", " ");
        if (bounded.Length > 400) bounded = bounded.Substring(0, 400);
        Console.WriteLine("ERR\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(bounded)));
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            WriteError("expected file path and target thumbnail size");
            return 2;
        }

        string filePath = Path.GetFullPath(args[0]);
        int requested;
        if (!File.Exists(filePath) || !Int32.TryParse(args[1], out requested) || requested < 64 || requested > 4096)
        {
            Console.WriteLine("NONE");
            return 0;
        }

        IShellItemImageFactory factory = null;
        IntPtr bitmapHandle = IntPtr.Zero;
        try
        {
            Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            int hr = Native.SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref iid, out factory);
            if (hr < 0 || factory == null)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            hr = factory.GetImage(
                new SIZE { cx = requested, cy = requested },
                Native.SIIGBF_THUMBNAILONLY | Native.SIIGBF_BIGGERSIZEOK,
                out bitmapHandle);
            if (hr < 0 || bitmapHandle == IntPtr.Zero)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            using (Bitmap source = Image.FromHbitmap(bitmapHandle))
            using (Bitmap bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
            {
                bitmap.SetResolution(source.HorizontalResolution, source.VerticalResolution);
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(Color.Transparent);
                    graphics.DrawImageUnscaled(source, 0, 0);
                }

                using (MemoryStream stream = new MemoryStream())
                {
                    bitmap.Save(stream, ImageFormat.Png);
                    byte[] png = stream.ToArray();
                    if (png.Length <= 0 || png.Length > MaxPngBytes)
                    {
                        Console.WriteLine("NONE");
                        return 0;
                    }
                    Console.WriteLine(
                        "PNG\t"
                        + bitmap.Width.ToString()
                        + "\t"
                        + bitmap.Height.ToString()
                        + "\t"
                        + Convert.ToBase64String(png));
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            WriteError(error.GetType().Name + ": " + error.Message);
            return 1;
        }
        finally
        {
            if (bitmapHandle != IntPtr.Zero)
            {
                try { Native.DeleteObject(bitmapHandle); } catch { }
            }
            if (factory != null && Marshal.IsComObject(factory))
            {
                try { Marshal.FinalReleaseComObject(factory); } catch { }
            }
        }
    }
}
