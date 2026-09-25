// Papers-owned, narrowly scoped Windows input helper.
// Protocol: newline-delimited tab records on stdin/stdout; no user text is logged.
// The hook callback only gates input, queues a bounded record, and returns.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal sealed class AltQHoldTracker
{
    private bool active;

    public bool Begin()
    {
        if (active) return false;
        active = true;
        return true;
    }

    public bool Release()
    {
        if (!active) return false;
        active = false;
        return true;
    }

    public bool ReleaseIfKeysAreUp(bool chordHeld)
    {
        return !chordHeld && Release();
    }
}

internal sealed class AltQReleaseWatchdog
{
    private readonly UIntPtr timerId;

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr callback);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool KillTimer(IntPtr window, UIntPtr id);

    public AltQReleaseWatchdog(uint requestedId, uint interval)
    {
        // With a null HWND, Windows may replace requestedId. Always retain the
        // returned UINT_PTR for WM_TIMER matching and KillTimer.
        timerId = SetTimer(IntPtr.Zero, new UIntPtr(requestedId), interval, IntPtr.Zero);
    }

    public bool IsRunning { get { return !timerId.Equals(UIntPtr.Zero); } }

    public bool IsTimerMessage(UIntPtr messageId)
    {
        return IsRunning && timerId.Equals(messageId);
    }

    public void Stop()
    {
        if (IsRunning) KillTimer(IntPtr.Zero, timerId);
    }
}

internal static class HoverInputBridge
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int WM_HOTKEY = 0x0312;
    private const int WM_TIMER = 0x0113;
    private const int WM_QUIT = 0x0012;
    private const int VK_Q = 0x51;
    private const int VK_MENU = 0x12;
    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;
    private const int VK_CONTROL = 0x11;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int LLKHF_INJECTED = 0x10;
    private const int LLKHF_LOWER_IL_INJECTED = 0x02;
    private const int LLKHF_ALTDOWN = 0x20;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_NOREPEAT = 0x4000;
    private const uint GA_ROOT = 2;
    private const uint ALTQ_RELEASE_WATCHDOG_ID = 0x5042;
    private const int HOTKEY_ID = 0x5041;
    private const uint PM_NOREMOVE = 0x0000;
    private const int MAX_TEXT_BYTES = 512;

    private sealed class WidgetPolicy
    {
        public readonly int Id;
        public readonly IntPtr Handle;
        public readonly bool Enabled;
        public readonly HashSet<string> Blocked;
        public readonly int UpdatedAt;
        public WidgetPolicy(int id, IntPtr handle, bool enabled, HashSet<string> blocked)
        { Id = id; Handle = handle; Enabled = enabled; Blocked = blocked; UpdatedAt = Environment.TickCount; }
    }

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] private struct KBDLLHOOKSTRUCT
    { public uint vkCode; public uint scanCode; public uint flags; public uint time; public UIntPtr extraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x; public int y; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int left; public int top; public int right; public int bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG
    { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

    private static WidgetPolicy[] policies = new WidgetPolicy[0];
    private static readonly object policyLock = new object();
    private static readonly HashSet<uint> swallowedKeys = new HashSet<uint>();
    private static readonly object captureLock = new object();
    private static readonly HashSet<long> outstandingCaptures = new HashSet<long>();
    private static readonly ConcurrentQueue<string> output = new ConcurrentQueue<string>();
    private static readonly HookProc hookCallback = KeyboardHook;
    private static IntPtr hookHandle = IntPtr.Zero;
    private static uint mainThreadId;
    private static readonly AltQHoldTracker altQHold = new AltQHoldTracker();
    private static volatile bool overlayOpen;
    private static volatile bool captureOpening;
    private static volatile int openingWidgetId;
    private static long captureId;
    private static bool overlayReadyRequested;
    private static long overlayReadyGeneration;

    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
    [DllImport("user32.dll")] private static extern bool GetKeyboardState(byte[] state);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ToUnicodeEx(uint key, uint scan, byte[] state, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity, uint flags, IntPtr layout);
    [DllImport("imm32.dll")] private static extern bool ImmIsIME(IntPtr layout);

    private static void Emit(string line) { output.Enqueue(line); }
    private static void FlushOutput()
    {
        string line;
        while (output.TryDequeue(out line))
        {
            try { Console.Out.WriteLine(line); Console.Out.Flush(); }
            catch { /* parent exited; shutdown is handled by stdin */ }
        }
    }

    private static bool IsAltQPhysicallyHeld()
    {
        bool qDown = (GetAsyncKeyState(VK_Q) & 0x8000) != 0;
        bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0
            || (GetAsyncKeyState(VK_LMENU) & 0x8000) != 0
            || (GetAsyncKeyState(VK_RMENU) & 0x8000) != 0;
        return qDown && altDown;
    }

    private static void ReleaseAltQIfKeysAreUp()
    {
        if (altQHold.ReleaseIfKeysAreUp(IsAltQPhysicallyHeld())) Emit("ALTQ_RELEASE");
    }

    private static WidgetPolicy[] Snapshot()
    { return Interlocked.CompareExchange(ref policies, null, null); }

    private static void ReadCommands()
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string[] parts = line.Split('\t');
            try
            {
                if (parts[0] == "QUIT") { PostThreadMessage(mainThreadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero); return; }
                if (parts[0] == "OVERLAY" && parts.Length == 2 && parts[1] == "0")
                {
                    lock (captureLock)
                    {
                        overlayReadyRequested = false;
                        overlayReadyGeneration = 0;
                        outstandingCaptures.Clear();
                        overlayOpen = false;
                        captureOpening = false;
                        openingWidgetId = 0;
                    }
                    continue;
                }
                if (parts[0] == "OVERLAY" && parts.Length == 3 && parts[1] == "1")
                {
                    lock (captureLock)
                    {
                        overlayReadyRequested = true;
                        overlayReadyGeneration = long.Parse(parts[2], CultureInfo.InvariantCulture);
                    }
                    CompleteOverlayReadyIfDrained();
                    continue;
                }
                if (parts[0] == "OPENING" && parts.Length == 2)
                {
                    int senderId = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    lock (captureLock)
                    {
                        overlayReadyRequested = false;
                        overlayReadyGeneration = 0;
                        outstandingCaptures.Clear();
                        openingWidgetId = senderId;
                        overlayOpen = false;
                        captureOpening = true;
                    }
                    Emit("OPENING_READY\t" + senderId.ToString(CultureInfo.InvariantCulture));
                    continue;
                }
                if (parts[0] == "ACK" && parts.Length == 2)
                {
                    long acknowledged = long.Parse(parts[1], CultureInfo.InvariantCulture);
                    lock (captureLock) outstandingCaptures.Remove(acknowledged);
                    CompleteOverlayReadyIfDrained();
                    continue;
                }
                if (parts[0] == "REMOVE" && parts.Length == 2)
                {
                    int removeId = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    UpdatePolicies(removeId, null);
                    continue;
                }
                if (parts[0] == "WIDGET" && parts.Length == 3)
                {
                    int id = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    IntPtr hwnd = new IntPtr(long.Parse(parts[2], CultureInfo.InvariantCulture));
                    UpdatePolicies(id, new WidgetPolicy(id, hwnd, false, new HashSet<string>()));
                    continue;
                }
                if (parts[0] == "POLICY" && parts.Length == 5)
                {
                    string acknowledgement = ApplyPolicyCommand(parts);
                    if (acknowledgement != null) Emit(acknowledgement);
                }
            }
            catch { Emit("ERROR\tbad-command"); }
        }
        PostThreadMessage(mainThreadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
    }

    private static void CompleteOverlayReadyIfDrained()
    {
        long generation = 0;
        lock (captureLock)
        {
            if (!overlayReadyRequested || outstandingCaptures.Count != 0) return;
            overlayReadyRequested = false;
            generation = overlayReadyGeneration;
            overlayReadyGeneration = 0;
            // The hook's capture admission takes this same lock while checking
            // captureOpening and registering an accepted record. Thus no key
            // can slip between the empty-set test and this mode transition.
            overlayOpen = true;
            captureOpening = false;
            openingWidgetId = 0;
        }
        Emit("OVERLAY_READY\t" + generation.ToString(CultureInfo.InvariantCulture));
    }

    private static void UpdatePolicies(int id, WidgetPolicy replacement)
    {
        lock (policyLock)
        {
            List<WidgetPolicy> next = new List<WidgetPolicy>();
            foreach (WidgetPolicy item in Snapshot()) if (item.Id != id) next.Add(item);
            if (replacement != null) next.Add(replacement);
            Interlocked.Exchange(ref policies, next.ToArray());
        }
        if (replacement == null)
        {
            lock (captureLock)
            {
                if (openingWidgetId != id) return;
                outstandingCaptures.Clear();
                overlayReadyRequested = false;
                overlayReadyGeneration = 0;
                overlayOpen = false;
                captureOpening = false;
                openingWidgetId = 0;
            }
        }
    }

    private static string ApplyPolicyCommand(string[] parts)
    {
        long requestId = long.Parse(parts[1], CultureInfo.InvariantCulture);
        if (requestId <= 0) throw new FormatException();
        int id = int.Parse(parts[2], CultureInfo.InvariantCulture);
        WidgetPolicy current = FindById(Snapshot(), id);
        if (current == null) return "POLICY_ACK\t" + requestId.ToString(CultureInfo.InvariantCulture) + "\tERROR\twidget-not-found";
        if (parts[3] != "0" && parts[3] != "1") throw new FormatException();
        bool enabled = parts[3] == "1";
        string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(parts[4]));
        HashSet<string> blocked = new HashSet<string>(decoded.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries), StringComparer.Ordinal);
        UpdatePolicies(id, new WidgetPolicy(id, current.Handle, enabled, blocked));
        return "POLICY_ACK\t" + requestId.ToString(CultureInfo.InvariantCulture) + "\tOK\t-";
    }

    private static WidgetPolicy FindById(WidgetPolicy[] source, int id)
    { foreach (WidgetPolicy item in source) if (item.Id == id) return item; return null; }

    private static string CanonicalKey(string text)
    {
        if (text.Length != 1) return null;
        char c = text[0];
        switch (c)
        {
            case ',': return "Comma"; case '.': return "Period"; case '/': return "Slash";
            case ';': return "Semicolon"; case '=': return "Equal"; case '[': return "BracketLeft";
            case ']': return "BracketRight"; case '\\': return "Backslash"; case '`': return "Backquote";
            case '\'': return "Quote"; case '+': return "Plus"; case '-': return "Minus";
            case ' ': return "Space"; default: return char.IsLetter(c) ? char.ToUpperInvariant(c).ToString() : c.ToString();
        }
    }

    private static bool Pressed(byte[] state, int key)
    { return (state[key] & 0x80) != 0 || (GetAsyncKeyState(key) & 0x8000) != 0; }

    private static string Translate(KBDLLHOOKSTRUCT key, out bool shifted)
    {
        shifted = false;
        byte[] state = new byte[256];
        if (!GetKeyboardState(state)) return null;
        shifted = Pressed(state, 0x10) || Pressed(state, 0xA0) || Pressed(state, 0xA1);
        if (Pressed(state, VK_CONTROL) || Pressed(state, VK_LCONTROL) || Pressed(state, VK_RCONTROL)
            || Pressed(state, VK_MENU) || Pressed(state, VK_LMENU) || Pressed(state, VK_RMENU)
            || Pressed(state, VK_LWIN) || Pressed(state, VK_RWIN)) return null;
        IntPtr foreground = GetForegroundWindow();
        uint processId;
        uint thread = GetWindowThreadProcessId(foreground, out processId);
        IntPtr layout = GetKeyboardLayout(thread);
        if (layout == IntPtr.Zero || ImmIsIME(layout)) return null;
        StringBuilder text = new StringBuilder(4);
        int length = ToUnicodeEx(key.vkCode, key.scanCode, state, text, text.Capacity, 0x4, layout);
        if (length <= 0 || length > 2) return null; // dead keys and multi-character mappings pass through
        string value = text.ToString(0, length);
        if (length == 2 && !(char.IsHighSurrogate(value[0]) && char.IsLowSurrogate(value[1]))) return null;
        UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(value, 0);
        if (category == UnicodeCategory.Control || category == UnicodeCategory.Format || category == UnicodeCategory.Surrogate) return null;
        return value;
    }

    private static WidgetPolicy HitWidget()
    {
        POINT point;
        if (!GetCursorPos(out point)) return null;
        IntPtr top = GetAncestor(WindowFromPoint(point), GA_ROOT);
        if (top == IntPtr.Zero) return null;
        foreach (WidgetPolicy item in Snapshot())
        {
            if (!item.Enabled || unchecked(Environment.TickCount - item.UpdatedAt) > 1200) continue;
            if (item.Handle != top || !IsWindow(item.Handle) || !IsWindowVisible(item.Handle) || IsIconic(item.Handle)) continue;
            RECT rect;
            if (!GetWindowRect(item.Handle, out rect)) continue;
            if (point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom) continue;
            if (GetAncestor(GetForegroundWindow(), GA_ROOT) == item.Handle) continue;
            return item;
        }
        return null;
    }

    private static IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code < 0) return CallNextHookEx(hookHandle, code, wParam, lParam);
        int message = wParam.ToInt32();
        bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
        if (!down && !up) return CallNextHookEx(hookHandle, code, wParam, lParam);
        KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        bool isAlt = key.vkCode == VK_MENU || key.vkCode == VK_LMENU || key.vkCode == VK_RMENU;
        if (up && (key.vkCode == VK_Q || isAlt) && altQHold.Release())
        {
            Emit("ALTQ_RELEASE");
        }
        if (up && swallowedKeys.Remove(key.vkCode)) return new IntPtr(1);
        if (!down) return CallNextHookEx(hookHandle, code, wParam, lParam);
        if (swallowedKeys.Contains(key.vkCode)) return new IntPtr(1); // suppress auto-repeat for consumed physical key
        if ((key.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0) return CallNextHookEx(hookHandle, code, wParam, lParam);
        if ((key.flags & LLKHF_ALTDOWN) != 0 || key.vkCode == VK_Q || isAlt) return CallNextHookEx(hookHandle, code, wParam, lParam);
        WidgetPolicy policy = HitWidget();
        if (policy == null) return CallNextHookEx(hookHandle, code, wParam, lParam);
        bool shifted;
        string text = Translate(key, out shifted);
        if (String.IsNullOrEmpty(text) || Encoding.UTF8.GetByteCount(text) > MAX_TEXT_BYTES) return CallNextHookEx(hookHandle, code, wParam, lParam);
        string canonical = CanonicalKey(text);
        if (canonical == null) return CallNextHookEx(hookHandle, code, wParam, lParam);
        string binding = (shifted ? "Shift+" : "") + canonical;
        lock (captureLock)
        {
            if (overlayOpen && !captureOpening) return CallNextHookEx(hookHandle, code, wParam, lParam);
            if (captureOpening)
            {
                if (openingWidgetId != policy.Id) return CallNextHookEx(hookHandle, code, wParam, lParam);
                swallowedKeys.Add(key.vkCode);
                long appendId = Interlocked.Increment(ref captureId);
                outstandingCaptures.Add(appendId);
                Emit("APPEND\t" + policy.Id.ToString(CultureInfo.InvariantCulture) + "\t" + appendId.ToString(CultureInfo.InvariantCulture) + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                return new IntPtr(1);
            }
            if (text == " " || policy.Blocked.Contains(binding)) return CallNextHookEx(hookHandle, code, wParam, lParam);
            swallowedKeys.Add(key.vkCode);
            long id = Interlocked.Increment(ref captureId);
            outstandingCaptures.Add(id);
            openingWidgetId = policy.Id;
            captureOpening = true;
            overlayOpen = false;
            Emit("CAPTURE\t" + policy.Id.ToString(CultureInfo.InvariantCulture) + "\t" + id.ToString(CultureInfo.InvariantCulture) + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
            return new IntPtr(1);
        }
    }

    private static void Main()
    {
        mainThreadId = GetCurrentThreadId();
        // Create this thread's message queue before the stdin reader can post WM_QUIT.
        MSG queueMessage; PeekMessage(out queueMessage, IntPtr.Zero, 0, 0, PM_NOREMOVE);
        hookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, hookCallback, IntPtr.Zero, 0);
        bool hotkey = RegisterHotKey(IntPtr.Zero, HOTKEY_ID, MOD_ALT | MOD_NOREPEAT, VK_Q);
        var releaseWatchdog = new AltQReleaseWatchdog(ALTQ_RELEASE_WATCHDOG_ID, 12);
        if (hookHandle == IntPtr.Zero) Emit("ERROR\thook-install-failed");
        else Emit("READY\t" + (hotkey ? "1" : "0"));
        if (!hotkey) Emit("ERROR\talt-q-registration-failed");
        if (!releaseWatchdog.IsRunning) Emit("ERROR\talt-q-release-watchdog-failed");
        Thread reader = new Thread(ReadCommands); reader.IsBackground = true; reader.Start();
        MSG message;
        int result;
        while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0)
        {
            if (message.message == WM_HOTKEY && message.wParam.ToUInt64() == HOTKEY_ID)
            {
                // The registered hotkey can be dequeued after the physical key-up
                // callback. The timer below repairs that ordering by polling the
                // actual key state after the start record has been emitted.
                if (altQHold.Begin())
                {
                    Emit("ALTQ");
                }
            }
            else if (message.message == WM_TIMER && releaseWatchdog.IsTimerMessage(message.wParam))
                ReleaseAltQIfKeysAreUp();
            TranslateMessage(ref message); DispatchMessage(ref message); FlushOutput();
        }
        releaseWatchdog.Stop();
        UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
        if (hookHandle != IntPtr.Zero) UnhookWindowsHookEx(hookHandle);
        FlushOutput();
    }

    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
}
