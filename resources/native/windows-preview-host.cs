using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[ComImport, Guid("8895B1C6-B41F-4C1C-A562-0D564250836F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPreviewHandler {
    void SetWindow(IntPtr hwnd, ref RECT rect);
    void SetRect(ref RECT rect);
    void DoPreview();
    void Unload();
    void SetFocus();
    void QueryFocus(out IntPtr phwnd);
    [PreserveSig] int TranslateAccelerator(ref MSG message);
}

[ComImport, Guid("B7D14566-0509-4CCE-A71F-0A554233BD9B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IInitializeWithFile {
    void Initialize([MarshalAs(UnmanagedType.LPWStr)] string filePath, uint mode);
}

[ComImport, Guid("B824B49D-22AC-4161-AC8A-9916E8FA3F7F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IInitializeWithStream {
    void Initialize(IStream stream, uint mode);
}

[ComImport, Guid("7F73BE3F-FB79-493C-A6C7-7EE14E245841"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IInitializeWithItem {
    void Initialize(IShellItem item, uint mode);
}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {}

[StructLayout(LayoutKind.Sequential)]
struct RECT { public int left, top, right, bottom; }

[StructLayout(LayoutKind.Sequential)]
struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
}

static class Native {
    public const int GWL_STYLE = -16;
    public const long WS_CHILD = 0x40000000L;
    public const long WS_POPUP = unchecked((long)0x80000000);
    public const long WS_CLIPCHILDREN = 0x02000000L;
    public const long WS_CLIPSIBLINGS = 0x04000000L;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint STGM_READ = 0x00000000;
    public const uint STGM_SHARE_DENY_WRITE = 0x00000020;
    public const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int SHCreateStreamOnFileEx(string fileName, uint mode, uint attributes, bool create, IStream template, out IStream stream);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);
}

static class Program {
    const string PreviewHandlerShellEx = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";
    static readonly IntPtr DpiPerMonitorV2 = new IntPtr(-4);

    static string ReadDefault(string keyPath) {
        try {
            using (RegistryKey key = Registry.ClassesRoot.OpenSubKey(keyPath))
                return key == null ? null : key.GetValue(null) as string;
        } catch { return null; }
    }

    static string ResolveHandlerClsid(string filePath) {
        string extension = Path.GetExtension(filePath);
        if (String.IsNullOrWhiteSpace(extension)) return null;
        string direct = ReadDefault(extension + @"\shellex\" + PreviewHandlerShellEx);
        if (!String.IsNullOrWhiteSpace(direct)) return direct.Trim().Trim('"');
        string progId = ReadDefault(extension);
        if (!String.IsNullOrWhiteSpace(progId)) {
            string viaProgId = ReadDefault(progId + @"\shellex\" + PreviewHandlerShellEx);
            if (!String.IsNullOrWhiteSpace(viaProgId)) return viaProgId.Trim().Trim('"');
        }
        string viaSystem = ReadDefault(@"SystemFileAssociations\" + extension + @"\shellex\" + PreviewHandlerShellEx);
        return String.IsNullOrWhiteSpace(viaSystem) ? null : viaSystem.Trim().Trim('"');
    }

    static bool RegisteredPreviewHandler(string clsid) {
        if (String.IsNullOrWhiteSpace(clsid)) return false;
        string wanted = clsid.Trim();
        foreach (RegistryKey root in new[] { Registry.LocalMachine, Registry.CurrentUser }) {
            try {
                using (RegistryKey key = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers")) {
                    if (key == null) continue;
                    foreach (string name in key.GetValueNames())
                        if (String.Equals(name, wanted, StringComparison.OrdinalIgnoreCase)) return true;
                }
            } catch {}
        }
        return false;
    }

    static bool TryResolve(string filePath, out string clsid) {
        clsid = ResolveHandlerClsid(filePath);
        return File.Exists(filePath) && RegisteredPreviewHandler(clsid);
    }

    static void WriteError(string message) {
        string bounded = (message ?? "unknown error").Replace("\r", " ").Replace("\n", " ");
        if (bounded.Length > 500) bounded = bounded.Substring(0, 500);
        Console.WriteLine("ERR\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(bounded)));
        Console.Out.Flush();
    }

    static bool Initialize(object instance, string filePath, out object retained) {
        retained = null;

        IInitializeWithStream streamInit = instance as IInitializeWithStream;
        if (streamInit != null) {
            IStream stream;
            int hr = Native.SHCreateStreamOnFileEx(filePath, Native.STGM_READ | Native.STGM_SHARE_DENY_WRITE, Native.FILE_ATTRIBUTE_NORMAL, false, null, out stream);
            if (hr >= 0 && stream != null) {
                streamInit.Initialize(stream, Native.STGM_READ);
                retained = stream;
                return true;
            }
        }

        IInitializeWithFile fileInit = instance as IInitializeWithFile;
        if (fileInit != null) {
            fileInit.Initialize(filePath, Native.STGM_READ);
            return true;
        }

        IInitializeWithItem itemInit = instance as IInitializeWithItem;
        if (itemInit != null) {
            Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            IShellItem item;
            int hr = Native.SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref iid, out item);
            if (hr >= 0 && item != null) {
                itemInit.Initialize(item, Native.STGM_READ);
                retained = item;
                return true;
            }
        }
        return false;
    }

    static int DipToPixel(int value, uint dpi) {
        double scale = dpi == 0 ? 1.0 : dpi / 96.0;
        return (int)Math.Round(value * scale);
    }

    [STAThread]
    static int Main(string[] args) {
        try { Native.SetProcessDpiAwarenessContext(DpiPerMonitorV2); } catch {}

        if (args.Length == 2 && args[0] == "--probe") {
            string filePath = Path.GetFullPath(args[1]);
            string clsid;
            if (!TryResolve(filePath, out clsid)) Console.WriteLine("NONE");
            else Console.WriteLine("AVAILABLE\t" + clsid.ToLowerInvariant());
            return 0;
        }

        if (args.Length != 7 || args[0] != "--host") {
            WriteError("expected --probe <file> or --host <file> <parent-hwnd> <x> <y> <width> <height>");
            return 2;
        }

        string target = Path.GetFullPath(args[1]);
        long parentValue;
        int x, y, width, height;
        if (!Int64.TryParse(args[2], out parentValue)
            || !Int32.TryParse(args[3], out x)
            || !Int32.TryParse(args[4], out y)
            || !Int32.TryParse(args[5], out width)
            || !Int32.TryParse(args[6], out height)) {
            WriteError("invalid host geometry");
            return 2;
        }

        IntPtr parent = new IntPtr(parentValue);
        string clsidText;
        if (!Native.IsWindow(parent) || width <= 0 || height <= 0 || !TryResolve(target, out clsidText)) {
            Console.WriteLine("NONE");
            return 0;
        }

        object instance = null;
        object retained = null;
        IPreviewHandler handler = null;
        Form host = null;
        System.Windows.Forms.Timer parentWatch = null;
        try {
            Guid clsid;
            if (!Guid.TryParse(clsidText, out clsid)) { Console.WriteLine("NONE"); return 0; }
            Type type = Type.GetTypeFromCLSID(clsid, true);
            instance = Activator.CreateInstance(type);
            handler = instance as IPreviewHandler;
            if (handler == null || !Initialize(instance, target, out retained)) {
                Console.WriteLine("NONE");
                return 0;
            }

            host = new Form {
                FormBorderStyle = FormBorderStyle.None,
                ShowInTaskbar = false,
                StartPosition = FormStartPosition.Manual,
                ControlBox = false
            };
            IntPtr hwnd = host.Handle;
            long style = Native.GetWindowLongPtr(hwnd, Native.GWL_STYLE).ToInt64();
            style = (style & ~Native.WS_POPUP) | Native.WS_CHILD | Native.WS_CLIPCHILDREN | Native.WS_CLIPSIBLINGS;
            Native.SetWindowLongPtr(hwnd, Native.GWL_STYLE, new IntPtr(style));
            Native.SetParent(hwnd, parent);

            uint dpi = Native.GetDpiForWindow(parent);
            Action<int,int,int,int> place = (dx,dy,dw,dh) => {
                int px = DipToPixel(dx, dpi);
                int py = DipToPixel(dy, dpi);
                int pw = Math.Max(1, DipToPixel(dw, dpi));
                int ph = Math.Max(1, DipToPixel(dh, dpi));
                Native.SetWindowPos(hwnd, IntPtr.Zero, px, py, pw, ph, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
                RECT rect = new RECT { left = 0, top = 0, right = pw, bottom = ph };
                handler.SetWindow(hwnd, ref rect);
                handler.SetRect(ref rect);
            };

            place(x, y, width, height);
            handler.DoPreview();
            host.Show();
            Console.WriteLine("READY\t" + clsidText.ToLowerInvariant());
            Console.Out.Flush();

            Thread stdin = new Thread(() => {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    string command = line;
                    try {
                        host.BeginInvoke(new Action(() => {
                            if (command == "CLOSE") { host.Close(); return; }
                            if (command == "HIDE") { host.Hide(); return; }
                            if (command == "SHOW") { host.Show(); return; }
                            if (command == "FOCUS") { try { handler.SetFocus(); } catch {} return; }
                            if (command.StartsWith("MOVE\t", StringComparison.Ordinal)) {
                                string[] parts = command.Split('\t');
                                int mx,my,mw,mh;
                                if (parts.Length == 5
                                    && Int32.TryParse(parts[1], out mx)
                                    && Int32.TryParse(parts[2], out my)
                                    && Int32.TryParse(parts[3], out mw)
                                    && Int32.TryParse(parts[4], out mh)
                                    && mw > 0 && mh > 0) place(mx,my,mw,mh);
                            }
                        }));
                    } catch { break; }
                }
            });
            stdin.IsBackground = true;
            stdin.Start();

            parentWatch = new System.Windows.Forms.Timer { Interval = 750 };
            parentWatch.Tick += (_, __) => { if (!Native.IsWindow(parent)) host.Close(); };
            parentWatch.Start();

            Application.Run(host);
            return 0;
        } catch (Exception error) {
            WriteError(error.GetType().Name + ": " + error.Message);
            return 1;
        } finally {
            try { if (parentWatch != null) parentWatch.Dispose(); } catch {}
            try { if (handler != null) handler.Unload(); } catch {}
            try { if (retained != null && Marshal.IsComObject(retained)) Marshal.FinalReleaseComObject(retained); } catch {}
            try { if (instance != null && Marshal.IsComObject(instance)) Marshal.FinalReleaseComObject(instance); } catch {}
            try { if (host != null) host.Dispose(); } catch {}
        }
    }
}
