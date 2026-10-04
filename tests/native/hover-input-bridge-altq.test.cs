internal static class HoverInputBridgeAltQTests
{
    private const uint WM_TIMER = 0x0113;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct Point { public int x; public int y; }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct Message
    {
        public System.IntPtr hwnd;
        public uint message;
        public System.UIntPtr wParam;
        public System.IntPtr lParam;
        public uint time;
        public Point point;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool PeekMessage(out Message message, System.IntPtr window, uint min, uint max, uint remove);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, System.IntPtr window, uint min, uint max);

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new System.Exception(message);
    }

    private static void VerifyAuthoritativeWidgetHitResolution()
    {
        System.Type bridge = typeof(HoverInputBridge);
        System.Type policyType = bridge.GetNestedType("WidgetPolicy", System.Reflection.BindingFlags.NonPublic);
        var constructor = policyType.GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic,
            null,
            new[] { typeof(int), typeof(System.IntPtr), typeof(bool), typeof(System.Collections.Generic.HashSet<string>) },
            null);
        System.Array policies = System.Array.CreateInstance(policyType, 2);
        policies.SetValue(constructor.Invoke(new object[] { 17, new System.IntPtr(1001), false, new System.Collections.Generic.HashSet<string>() }), 0);
        policies.SetValue(constructor.Invoke(new object[] { 18, new System.IntPtr(1002), true, new System.Collections.Generic.HashSet<string>() }), 1);
        var resolve = bridge.GetMethod("WidgetForRootHit", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);

        // WindowFromPoint has already selected the topmost HWND. Even where
        // widget rectangles overlap, the result is that exact registration.
        object hit = resolve.Invoke(null, new object[] { new System.IntPtr(1001), policies });
        Require((int)policyType.GetField("Id").GetValue(hit) == 17, "native root hit must select its exact widget registration");

        // A foreign root HWND has no direct widget registration.
        object foreign = resolve.Invoke(null, new object[] { new System.IntPtr(9999), policies });
        Require(foreign == null, "foreign root hit must not map directly to a widget");

        var transparent = bridge.GetMethod("WidgetForTransparentHit", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        System.Func<System.IntPtr, bool> contains = handle => handle == new System.IntPtr(1001) || handle == new System.IntPtr(1002);
        // WindowFromPoint can pass through a translucent widget pixel and hit
        // the ordinary window below both widgets. Pick the highest live widget.
        System.Func<System.IntPtr, System.IntPtr> previous = handle =>
            handle == new System.IntPtr(9999) ? new System.IntPtr(1001) :
            handle == new System.IntPtr(1001) ? new System.IntPtr(1002) : System.IntPtr.Zero;
        object behindTransparent = transparent.Invoke(null, new object[] { new System.IntPtr(9999), policies, contains, previous });
        Require((int)policyType.GetField("Id").GetValue(behindTransparent) == 18,
            "a translucent hit must choose the highest registered widget above the root hit");

        // If WindowFromPoint hits a foreign window above the widget, nothing
        // registered is above that root and Alt+Q remains an outside press.
        System.Func<System.IntPtr, System.IntPtr> noWidgetAbove = handle => System.IntPtr.Zero;
        object occluded = transparent.Invoke(null, new object[] { new System.IntPtr(9999), policies, contains, noWidgetAbove });
        Require(occluded == null, "a foreign occluder above the widget must remain an outside hit");
    }

    private static void VerifyImmediateChordStartAndRelease()
    {
        var tracker = new AltQChordTracker();
        int cursorHit = 17;
        int capturedHit;
        Require(tracker.ObserveQDown(true, true, () => cursorHit, out capturedHit) && capturedHit == 17,
            "physical Q-down with Alt held must start immediately with the current widget hit");
        cursorHit = 18;
        Require(!tracker.ObserveQDown(true, true, () => cursorHit, out capturedHit),
            "Q autorepeat must not create another Alt+Q start");
        Require(tracker.ObserveKeyUp(true, false), "Q-up must release the active chord");
        Require(!tracker.ObserveKeyUp(true, false), "a duplicate key-up must not duplicate release");

        cursorHit = 18;
        Require(tracker.ObserveQDown(true, true, () => cursorHit, out capturedHit) && capturedHit == 18,
            "the next physical chord must start immediately and independently");
        Require(tracker.ObserveKeyUp(false, true), "Alt-up must also release the active chord");

        var injectedStyle = new AltQChordTracker();
        injectedStyle.ObserveAltDown(true);
        Require(injectedStyle.ObserveQDown(true, false, () => 19, out capturedHit) && capturedHit == 19,
            "an observed Alt-down must let injected Q-down start even without LLKHF_ALTDOWN");
        Require(injectedStyle.ObserveKeyUp(true, false), "injected-style chord must release normally");
    }

    private static void VerifyMissedReleaseCannotPoisonLaterPresses()
    {
        var tracker = new AltQChordTracker();
        int widgetId;
        Require(tracker.ObserveQDown(true, true, () => 29, out widgetId) && widgetId == 29,
            "first chord must start");
        Require(tracker.ObserveKeyUp(false, true), "Alt-up must release the first chord");
        // Simulate the Q-up being missed by the hook. The watchdog sees that the
        // physical chord is no longer held and must clear stale qDown even though
        // there is no active gesture left to release.
        Require(!tracker.ReleaseIfKeysAreUp(false), "inactive stale state must resynchronize without duplicate release");
        Require(tracker.ObserveQDown(true, true, () => 30, out widgetId) && widgetId == 30,
            "a missed Q-up must not make the next Alt+Q press dead");
        Require(tracker.ObserveKeyUp(true, false), "the recovered next press must release normally");

        Require(tracker.TryStartFallback(true, () => 31, out widgetId) && widgetId == 31,
            "WM_HOTKEY fallback must recover a genuinely held chord when Q-down was missed");
        Require(!tracker.TryStartFallback(true, () => 32, out widgetId),
            "WM_HOTKEY must not duplicate a chord already started by either path");
        Require(!tracker.ReleaseIfKeysAreUp(true), "watchdog must preserve a physically held fallback chord");
        Require(tracker.ReleaseIfKeysAreUp(false), "watchdog must recover a missed release");
        Require(!tracker.ReleaseIfKeysAreUp(false), "watchdog release must remain one-shot");
    }

    private static void VerifyRepeatedMixedReleaseOrderNeverDeadlocks()
    {
        var tracker = new AltQChordTracker();
        int widgetId;
        for (int i = 0; i < 200; ++i)
        {
            Require(tracker.ObserveQDown(true, true, () => 100 + i, out widgetId) && widgetId == 100 + i,
                "every physical Alt+Q press must start exactly once");
            if ((i & 1) == 0)
            {
                Require(tracker.ObserveKeyUp(true, false), "Q-first release must end the gesture");
            }
            else
            {
                Require(tracker.ObserveKeyUp(false, true), "Alt-first release must end the gesture");
                Require(!tracker.ReleaseIfKeysAreUp(false),
                    "watchdog resync after Alt-first release must not emit a duplicate release");
            }
        }
    }

    public static int Main()
    {
        VerifyAuthoritativeWidgetHitResolution();
        VerifyImmediateChordStartAndRelease();
        VerifyMissedReleaseCannotPoisonLaterPresses();
        VerifyRepeatedMixedReleaseOrderNeverDeadlocks();
        // Exercise the production watchdog against a real thread WM_TIMER. In
        // particular, match and stop using the actual UINT_PTR returned by
        // SetTimer rather than assuming Windows kept the requested ID.
        Message queueMessage;
        PeekMessage(out queueMessage, System.IntPtr.Zero, 0, 0, 0);
        var watchdog = new AltQReleaseWatchdog(0x5042, 12);
        Require(watchdog.IsRunning, "production watchdog timer must start");
        bool recovered = false;
        try
        {
            var delayedStart = new AltQChordTracker();
            int ignoredId;
            Require(delayedStart.ObserveQDown(true, true, () => 0, out ignoredId),
                "test chord must be active before timer recovery");
            Message message;
            while (GetMessage(out message, System.IntPtr.Zero, 0, 0) > 0)
            {
                if (message.message == WM_TIMER && watchdog.IsTimerMessage(message.wParam))
                {
                    recovered = delayedStart.ReleaseIfKeysAreUp(false);
                    break;
                }
            }
        }
        finally
        {
            watchdog.Stop();
        }
        Require(recovered, "real production WM_TIMER must recover the delayed-release ordering");
        return 0;
    }
}
