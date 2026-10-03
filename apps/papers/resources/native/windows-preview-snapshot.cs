using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[ComImport, Guid("8895b1c6-b41f-4c1c-a562-0d564250836f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPreviewHandler
{
    void SetWindow(IntPtr hwnd, ref RECT rect);
    void SetRect(ref RECT rect);
    void DoPreview();
    void Unload();
    void SetFocus();
    void QueryFocus(out IntPtr phwnd);
    [PreserveSig] int TranslateAccelerator(ref MSG message);
}

[ComImport, Guid("b7d14566-0509-4cce-a71f-0a554233bd9b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IInitializeWithFile
{
    void Initialize([MarshalAs(UnmanagedType.LPWStr)] string filePath, uint mode);
}

[StructLayout(LayoutKind.Sequential)]
struct RECT { public int left, top, right, bottom; }

[StructLayout(LayoutKind.Sequential)]
struct MSG
{
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
}

static class Native
{
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);
}

static class Program
{
    const string PreviewHandlerShellEx = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    const uint STGM_READ = 0;
    const int Width = 1100;
    const int Height = 760;
    const int SettleMs = 1200;
    const int MaxPngBytes = 16 * 1024 * 1024;

    static string ReadDefault(string keyPath)
    {
        using (RegistryKey key = Registry.ClassesRoot.OpenSubKey(keyPath))
        {
            return key == null ? null : key.GetValue(null) as string;
        }
    }

    static string ResolveHandlerClsid(string filePath)
    {
        string extension = Path.GetExtension(filePath);
        if (String.IsNullOrWhiteSpace(extension)) return null;

        string direct = ReadDefault(extension + @"\shellex\" + PreviewHandlerShellEx);
        if (!String.IsNullOrWhiteSpace(direct)) return direct.Trim().Trim('"');

        string progId = ReadDefault(extension);
        if (!String.IsNullOrWhiteSpace(progId))
        {
            string viaProgId = ReadDefault(progId + @"\shellex\" + PreviewHandlerShellEx);
            if (!String.IsNullOrWhiteSpace(viaProgId)) return viaProgId.Trim().Trim('"');
        }

        string viaSystem = ReadDefault(@"SystemFileAssociations\" + extension + @"\shellex\" + PreviewHandlerShellEx);
        return String.IsNullOrWhiteSpace(viaSystem) ? null : viaSystem.Trim().Trim('"');
    }

    static bool Allowed(string actual, string encodedAllowed)
    {
        if (String.IsNullOrWhiteSpace(actual) || String.IsNullOrWhiteSpace(encodedAllowed)) return false;
        foreach (string candidate in encodedAllowed.Split(';'))
        {
            if (String.Equals(candidate.Trim(), actual, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    static void WriteError(string message)
    {
        string bounded = (message ?? "unknown error").Replace("\r", " ").Replace("\n", " ");
        if (bounded.Length > 400) bounded = bounded.Substring(0, 400);
        Console.WriteLine("ERR\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(bounded)));
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 2 || String.IsNullOrWhiteSpace(args[0]) || String.IsNullOrWhiteSpace(args[1]))
        {
            WriteError("expected file path and allowed preview-handler CLSID list");
            return 2;
        }

        string filePath = Path.GetFullPath(args[0]);
        if (!File.Exists(filePath))
        {
            Console.WriteLine("NONE");
            return 0;
        }

        string clsidText = ResolveHandlerClsid(filePath);
        if (!Allowed(clsidText, args[1]))
        {
            Console.WriteLine("NONE");
            return 0;
        }

        Guid clsid;
        if (!Guid.TryParse(clsidText, out clsid))
        {
            Console.WriteLine("NONE");
            return 0;
        }

        object instance = null;
        IPreviewHandler handler = null;
        Form host = null;
        try
        {
            Type type = Type.GetTypeFromCLSID(clsid, true);
            instance = Activator.CreateInstance(type);
            handler = instance as IPreviewHandler;
            IInitializeWithFile initializer = instance as IInitializeWithFile;
            if (handler == null || initializer == null)
            {
                Console.WriteLine("NONE");
                return 0;
            }

            initializer.Initialize(filePath, STGM_READ);

            host = new Form();
            host.FormBorderStyle = FormBorderStyle.None;
            host.ShowInTaskbar = false;
            host.StartPosition = FormStartPosition.Manual;
            host.Left = -32000;
            host.Top = -32000;
            host.ClientSize = new Size(Width, Height);
            host.Show();
            Application.DoEvents();

            RECT rect = new RECT { left = 0, top = 0, right = Width, bottom = Height };
            handler.SetWindow(host.Handle, ref rect);
            handler.SetRect(ref rect);
            handler.DoPreview();

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(SettleMs);
            while (DateTime.UtcNow < deadline)
            {
                Application.DoEvents();
                Thread.Sleep(15);
            }

            using (Bitmap bitmap = new Bitmap(Width, Height, PixelFormat.Format32bppArgb))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    IntPtr hdc = graphics.GetHdc();
                    bool printed;
                    try { printed = Native.PrintWindow(host.Handle, hdc, 2); }
                    finally { graphics.ReleaseHdc(hdc); }
                    if (!printed)
                    {
                        Console.WriteLine("NONE");
                        return 0;
                    }
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
                    Console.WriteLine("PNG\t" + clsidText.ToLowerInvariant() + "\t" + Convert.ToBase64String(png));
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
            try { if (handler != null) handler.Unload(); } catch { }
            try { if (instance != null && Marshal.IsComObject(instance)) Marshal.FinalReleaseComObject(instance); } catch { }
            try { if (host != null) { host.Close(); host.Dispose(); } } catch { }
        }
    }
}
