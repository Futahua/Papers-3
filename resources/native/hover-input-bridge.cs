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

internal sealed class AltQChordTracker
{
    private bool qDown;
    private bool altDown;
    private bool active;

    public void ObserveAltDown(bool isAlt)
    {
        if (isAlt) altDown = true;
    }

    public bool ObserveQDown(bool isQ, bool altFlag, Func<int> captureWidgetId, out int widgetId)
    {
        widgetId = 0;
        if (!isQ || qDown) return false;
        qDown = true;
        if (!(altFlag || altDown) || active) return false;
        active = true;
        widgetId = captureWidgetId();
        return true;
    }

    public bool ObserveKeyUp(bool isQ, bool isAlt)
    {
        if (isQ) qDown = false;
        if (isAlt) altDown = false;
        if (!isQ && !isAlt) return false;
        if (!active) return false;
        active = false;
        return true;
    }

    public bool TryStartFallback(bool chordHeld, Func<int> captureWidgetId, out int widgetId)
    {
        widgetId = 0;
        if (!chordHeld || active) return false;
        qDown = true;
        altDown = true;
        active = true;
        widgetId = captureWidgetId();
        return true;
    }

    public bool ReleaseIfKeysAreUp(bool chordHeld)
    {
        if (chordHeld) return false;
        qDown = false;
        altDown = false;
        if (!active) return false;
        active = false;
        return true;
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

internal sealed class NativeDragRevealState
{
    private readonly HashSet<uint> shifts = new HashSet<uint>();
    private readonly HashSet<uint> preheld = new HashSet<uint>();
    public bool Revealed { get; private set; }
    public bool Cancelled { get; private set; }
    public bool Released { get; private set; }
    public bool WantsHidden { get { return shifts.Count > 0 && !Cancelled && !Released; } }
    public void SetPreheld(uint key) { preheld.Add(key); }
    public bool Shift(uint key, bool down) {
        if (preheld.Contains(key)) { if (!down) preheld.Remove(key); return false; }
        if (down) shifts.Add(key); else shifts.Remove(key);
        return true;
    }
    public void Cancel() { Cancelled = true; }
    public bool Observe(bool leftDown) {
        if (!leftDown) Released = true;
        if (WantsHidden) Revealed = true;
        return WantsHidden;
    }
}

internal static class HoverInputBridge
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int WM_NULL = 0x0000;
    private const int WM_HOTKEY = 0x0312;
    private const int WM_TIMER = 0x0113;
    private const int WM_QUIT = 0x0012;
    private const int VK_Q = 0x51;
    private const int VK_W = 0x57;
    private const int ALT_W_HOTKEY_ID = 0x5043;
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
    private const uint GW_HWNDPREV = 3;
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
    private static readonly AltQChordTracker altQChords = new AltQChordTracker();
    private static volatile bool altQHotkeyRegistered;
    private static volatile bool altWHotkeyRegistered;
    private static readonly AltQChordTracker altWChords = new AltQChordTracker();
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
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
    [DllImport("user32.dll")] private static extern bool GetKeyboardState(byte[] state);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ToUnicodeEx(uint key, uint scan, byte[] state, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity, uint flags, IntPtr layout);
    [DllImport("imm32.dll")] private static extern bool ImmIsIME(IntPtr layout);

    private static void Emit(string line) { output.Enqueue(line); }
    private static NativeDragRevealState nativeDrag;
    private static IntPtr nativeDragWindow, nativeDragTarget;
    private static uint nativeDragProcess;
    private static long nativeDragId;
    private static bool nativeDragHidden;
    private static void ObserveNativeDrag()
    {
        lock (captureLock) {
            if (nativeDrag == null) return;
            bool wasReleased = nativeDrag.Released;
            bool hide = nativeDrag.Observe((GetAsyncKeyState(1) & 0x8000) != 0);
            if (nativeDrag.Released && nativeDragHidden && !nativeDrag.Cancelled) hide = true;
            if (!wasReleased && nativeDrag.Released && nativeDrag.Revealed && !nativeDrag.Cancelled) {
                POINT point; uint process;
                if (GetCursorPos(out point)) {
                    IntPtr hit = GetAncestor(WindowFromPoint(point), 2);
                    GetWindowThreadProcessId(hit, out process);
                    if (hit != IntPtr.Zero && process != nativeDragProcess && IsWindowVisible(hit)) nativeDragTarget = hit;
                }
            }
            if (hide != nativeDragHidden && IsWindow(nativeDragWindow)) {
                ShowWindowAsync(nativeDragWindow, hide ? 0 : 4);
                nativeDragHidden = hide;
            }
        }
    }
    private static void FinishNativeDrag(bool acknowledge)
    {
        ObserveNativeDrag();
        lock (captureLock) {
            if (nativeDrag == null) return;
            if (nativeDragHidden && IsWindow(nativeDragWindow)) ShowWindowAsync(nativeDragWindow, 4);
            long target = nativeDrag.Revealed && !nativeDrag.Cancelled && IsWindow(nativeDragTarget) ? nativeDragTarget.ToInt64() : 0;
            if (acknowledge) Emit("DRAG_ENDED\t" + nativeDragId + "\t" + target + "\t" + (nativeDrag.Revealed ? "1" : "0"));
            nativeDrag = null; nativeDragWindow = IntPtr.Zero; nativeDragTarget = IntPtr.Zero; nativeDragHidden = false;
        }
    }
    private static void FlushOutput()
    {
        string line;
        while (output.TryDequeue(out line))
        {
            try { Console.Out.WriteLine(line); Console.Out.Flush(); }
            catch { /* parent exited; shutdown is handled by stdin */ }
        }
    }

    private static bool IsAltQPhysicallyHeld(uint virtualKey = VK_Q)
    {
        bool qDown = (GetAsyncKeyState((int)virtualKey) & 0x8000) != 0;
        bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0
            || (GetAsyncKeyState(VK_LMENU) & 0x8000) != 0
            || (GetAsyncKeyState(VK_RMENU) & 0x8000) != 0;
        return qDown && altDown;
    }

    private static void ReleaseAltQIfKeysAreUp()
    {
        if (altQChords.ReleaseIfKeysAreUp(IsAltQPhysicallyHeld())) Emit("ALTQ_RELEASE");
        if (altWChords.ReleaseIfKeysAreUp(IsAltQPhysicallyHeld(VK_W))) Emit("ALTW_RELEASE");
    }

    private static void WakeMainLoop()
    {
        PostThreadMessage(mainThreadId, WM_NULL, UIntPtr.Zero, IntPtr.Zero);
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
                if (parts[0] == "DRAG_BEGIN" && parts.Length == 3) {
                    lock (captureLock) {
                        IntPtr source = new IntPtr(long.Parse(parts[2], CultureInfo.InvariantCulture));
                        if (nativeDrag != null || !IsWindow(source) || !IsWindowVisible(source)) { Emit("DRAG_REJECTED\t" + parts[1]); continue; }
                        nativeDragId = long.Parse(parts[1], CultureInfo.InvariantCulture); nativeDragWindow = source;
                        GetWindowThreadProcessId(source, out nativeDragProcess);
                        nativeDrag = new NativeDragRevealState(); nativeDragTarget = IntPtr.Zero; nativeDragHidden = false;
                        foreach (uint key in new uint[] { 0x10, 0xA0, 0xA1 }) if ((GetAsyncKeyState((int)key) & 0x8000) != 0) nativeDrag.SetPreheld(key);
                    }
                    Emit("DRAG_READY\t" + parts[1]); WakeMainLoop(); continue;
                }
                if (parts[0] == "DRAG_END" && parts.Length == 2) {
                    if (long.Parse(parts[1], CultureInfo.InvariantCulture) == nativeDragId) FinishNativeDrag(true);
                    WakeMainLoop(); continue;
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
        foreach (WidgetPolicy item in Snapshot())
        {
            if (!item.Enabled || unchecked(Environment.TickCount - item.UpdatedAt) > 1200) continue;
            // Electron's translucent widget can be visually and DOM-hovered
            // while WindowFromPoint reports the window beneath a transparent
            // pixel. The renderer's renewed policy is the hover authority;
            // the native rectangle keeps capture confined to this widget.
            if (!IsWindow(item.Handle) || !IsWindowVisible(item.Handle) || IsIconic(item.Handle)) continue;
            RECT rect;
            if (!GetWindowRect(item.Handle, out rect)) continue;
            if (point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom) continue;
            if (GetAncestor(GetForegroundWindow(), GA_ROOT) == item.Handle) continue;
            return item;
        }
        return null;
    }

    // Alt+Q docking asks which registered widget Windows actually hit at the
    // cursor when the chord starts. Keep this separate from HitWidget(): that
    // Quick Run policy intentionally excludes foreground widgets and applies
    // capture-specific enablement checks.
    private static WidgetPolicy WidgetForRootHit(IntPtr rootHit, WidgetPolicy[] snapshot)
    {
        if (rootHit == IntPtr.Zero) return null;
        foreach (WidgetPolicy item in snapshot)
        {
            if (item.Handle == rootHit) return item;
        }
        return null;
    }

    // WindowFromPoint skips a translucent Electron pixel and can report the
    // ordinary window underneath the visible widget. Walk upward from that
    // root hit: only a registered widget above it can claim its own rectangle.
    // A foreign window above the widget remains the root hit and wins.
    private static WidgetPolicy WidgetForTransparentHit(IntPtr rootHit, WidgetPolicy[] snapshot,
        Func<IntPtr, bool> containsPoint, Func<IntPtr, IntPtr> previousWindow)
    {
        if (rootHit == IntPtr.Zero) return null;
        WidgetPolicy match = null;
        IntPtr current = rootHit;
        for (int depth = 0; depth < 512; ++depth)
        {
            current = previousWindow(current);
            if (current == IntPtr.Zero || current == rootHit) break;
            WidgetPolicy candidate = WidgetForRootHit(current, snapshot);
            if (candidate != null && containsPoint(candidate.Handle)) match = candidate;
        }
        return match;
    }

    private static bool VisibleWidgetContains(IntPtr handle, POINT point, bool requireRestored)
    {
        if (!IsWindow(handle) || !IsWindowVisible(handle) || (requireRestored && IsIconic(handle))) return false;
        RECT rect;
        return GetWindowRect(handle, out rect)
            && point.x >= rect.left && point.x < rect.right
            && point.y >= rect.top && point.y < rect.bottom;
    }

    private static int WidgetAtCursor()
    {
        POINT point;
        if (!GetCursorPos(out point)) return 0;
        IntPtr hit = GetAncestor(WindowFromPoint(point), GA_ROOT);
        WidgetPolicy[] snapshot = Snapshot();
        WidgetPolicy widget = WidgetForRootHit(hit, snapshot);
        // A restore can briefly report iconic while the widget is already
        // visible and WindowFromPoint directly hits it. Trust that exact hit.
        if (widget != null && VisibleWidgetContains(widget.Handle, point, false)) return widget.Id;
        widget = WidgetForTransparentHit(hit, snapshot,
            handle => VisibleWidgetContains(handle, point, true),
            window => GetWindow(window, GW_HWNDPREV));
        return widget == null ? 0 : widget.Id;
    }

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scan, uint flags, UIntPtr extra);

    private static void MaskShortcutMenuActivation()
    {
        // The registered chord is invisible to the foreground application.
        // A no-mapping key prevents bare-Alt menu activation without swallowing
        // modifier release or interfering with the physical hold watchdog.
        keybd_event(0xFF, 0, 0, UIntPtr.Zero);
        keybd_event(0xFF, 0, 2, UIntPtr.Zero);
    }

    private static IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code < 0) return CallNextHookEx(hookHandle, code, wParam, lParam);
        int message = wParam.ToInt32();
        bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
        if (!down && !up) return CallNextHookEx(hookHandle, code, wParam, lParam);
        KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        lock (captureLock) {
            if (nativeDrag != null) {
                if (key.vkCode == 27 && down) nativeDrag.Cancel();
                if (key.vkCode == 0x10 || key.vkCode == 0xA0 || key.vkCode == 0xA1) {
                    bool consume = nativeDrag.Shift(key.vkCode, down); WakeMainLoop();
                    if (consume && down && !nativeDrag.Released) { swallowedKeys.Add(key.vkCode); return new IntPtr(1); }
                }
            }
        }
        bool isAlt = key.vkCode == VK_MENU || key.vkCode == VK_LMENU || key.vkCode == VK_RMENU;
        bool injected = (key.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        // Remote-control software such as Chrome Remote Desktop normally reaches
        // WH_KEYBOARD_LL as injected input. Alt+Q is special: its low-level Q-down
        // is the authoritative immediate start, while WM_HOTKEY remains a fallback
        // if Windows delivered the registered chord but the hook missed Q-down.
        // Injected Alt+Q may use this tracker, but injected input still cannot enter
        // the hover typing/capture path below.
        if (up && altQHotkeyRegistered && altQChords.ObserveKeyUp(key.vkCode == VK_Q, isAlt))
        {
            Emit("ALTQ_RELEASE");
            WakeMainLoop();
        }
        if (up && altWHotkeyRegistered && altWChords.ObserveKeyUp(key.vkCode == VK_W, isAlt)) { Emit("ALTW_RELEASE"); WakeMainLoop(); }
        if (up && swallowedKeys.Remove(key.vkCode)) return new IntPtr(1);
        if (!down) return CallNextHookEx(hookHandle, code, wParam, lParam);
        if (swallowedKeys.Contains(key.vkCode)) return new IntPtr(1); // suppress auto-repeat for consumed physical key
        if (altQHotkeyRegistered)
        {
            altQChords.ObserveAltDown(isAlt);
            int widgetId;
            if (altQChords.ObserveQDown(
                key.vkCode == VK_Q,
                (key.flags & LLKHF_ALTDOWN) != 0,
                WidgetAtCursor,
                out widgetId))
            {
                Emit("ALTQ\t" + widgetId.ToString(CultureInfo.InvariantCulture));
                WakeMainLoop();
                MaskShortcutMenuActivation();
            }
        }
        if (altWHotkeyRegistered) {
            altWChords.ObserveAltDown(isAlt); int widgetId;
            if (altWChords.ObserveQDown(key.vkCode == VK_W, (key.flags & LLKHF_ALTDOWN) != 0, WidgetAtCursor, out widgetId)) { Emit("ALTW\t" + widgetId.ToString(CultureInfo.InvariantCulture)); WakeMainLoop(); MaskShortcutMenuActivation(); }
        }
        if (injected) return CallNextHookEx(hookHandle, code, wParam, lParam);
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
        altQHotkeyRegistered = hotkey;
        altWHotkeyRegistered = RegisterHotKey(IntPtr.Zero, ALT_W_HOTKEY_ID, MOD_ALT | MOD_NOREPEAT, VK_W);
        if (!altWHotkeyRegistered) Emit("ERROR\talt-w-registration-failed");
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
                // Low-level Q-down is the authoritative, immediate start path.
                // WM_HOTKEY is only a fallback when Windows delivered the
                // registered chord but the hook missed its Q-down. Never queue a
                // delayed start: stale presses must not poison later Alt+Q input.
                int widgetId;
                if (altQChords.TryStartFallback(IsAltQPhysicallyHeld(), WidgetAtCursor, out widgetId))
                {
                    Emit("ALTQ\t" + widgetId.ToString(CultureInfo.InvariantCulture));
                }
            }
            else if (message.message == WM_HOTKEY && message.wParam.ToUInt64() == ALT_W_HOTKEY_ID) {
                int widgetId; if (altWChords.TryStartFallback(IsAltQPhysicallyHeld(VK_W), WidgetAtCursor, out widgetId)) Emit("ALTW\t" + widgetId.ToString(CultureInfo.InvariantCulture));
            }
            else if (message.message == WM_TIMER && releaseWatchdog.IsTimerMessage(message.wParam)) {
                ReleaseAltQIfKeysAreUp();
                ObserveNativeDrag();
            }
            TranslateMessage(ref message); DispatchMessage(ref message); FlushOutput();
        }
        releaseWatchdog.Stop();
        FinishNativeDrag(false);
        UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
        UnregisterHotKey(IntPtr.Zero, ALT_W_HOTKEY_ID);
        if (hookHandle != IntPtr.Zero) UnhookWindowsHookEx(hookHandle);
        FlushOutput();
    }

    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
}
