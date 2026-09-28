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

        // A foreign occluder's root HWND has no registered widget and therefore
        // selects the outside-Alt+Q path, even if a widget rectangle is beneath it.
        object foreign = resolve.Invoke(null, new object[] { new System.IntPtr(9999), policies });
        Require(foreign == null, "foreign topmost hit must not be mapped to an occluded widget");
    }

    private static void VerifyChordStartHitSurvivesDelayedHotkeyAndRelease()
    {
        var tracker = new AltQChordTracker();
        int cursorHit = 17;
        tracker.ObserveQDown(true, true, () => cursorHit);

        // Pointer moves before WM_HOTKEY is drained, and Q-up can arrive first.
        cursorHit = 18;
        tracker.ObserveQDown(true, true, () => cursorHit); // autorepeat is not a new chord
        Require(!tracker.ObserveKeyUp(true, false), "key-up before WM_HOTKEY must stay with the pending chord");

        int capturedHit;
        bool releasedBeforeStart;
        Require(tracker.TryStartNext(out capturedHit, out releasedBeforeStart) && capturedHit == 17,
            "WM_HOTKEY must receive the root hit captured at physical chord start");
        Require(releasedBeforeStart, "the start record must retain its earlier key-up");
        Require(!tracker.TryStartNext(out capturedHit, out releasedBeforeStart), "one captured hit must be consumed only once");

        // A subsequent physical chord captures its own current hit.
        cursorHit = 18;
        tracker.ObserveQDown(true, true, () => cursorHit);
        Require(tracker.TryStartNext(out capturedHit, out releasedBeforeStart) && capturedHit == 18,
            "a later chord must receive its own start-time hit");
        Require(!releasedBeforeStart, "a held chord must not be treated as already released");
        Require(tracker.ObserveKeyUp(true, false), "release after start must release that exact chord");
        Require(!tracker.ObserveKeyUp(true, false), "a second key-up must not duplicate release");
    }

    private static void VerifyRapidTapChordsKeepReleaseOwnership()
    {
        var firstStartDelayed = new AltQChordTracker();
        int firstHit = 29;
        firstStartDelayed.ObserveQDown(true, true, () => firstHit);
        Require(!firstStartDelayed.ObserveKeyUp(true, false), "first release must attach to its queued chord");
        int secondHit = 30;
        firstStartDelayed.ObserveQDown(true, true, () => secondHit);
        int delayedId;
        bool delayedRelease;
        Require(firstStartDelayed.TryStartNext(out delayedId, out delayedRelease) && delayedId == 29 && delayedRelease,
            "first delayed hotkey must emit its own start followed by release");
        Require(firstStartDelayed.TryStartNext(out delayedId, out delayedRelease) && delayedId == 30 && !delayedRelease,
            "second delayed hotkey must remain active while its physical chord is held");
        Require(!firstStartDelayed.ReleaseIfKeysAreUp(true), "the second held chord must not be released by the watchdog");
        Require(firstStartDelayed.ObserveKeyUp(true, false), "the second chord's key-up must release only that chord");

        // Now queue two completed taps before either WM_HOTKEY is drained.
        var tracker = new AltQChordTracker();
        int cursorHit = 31;
        tracker.ObserveQDown(true, true, () => cursorHit);
        Require(!tracker.ObserveKeyUp(true, false), "first tap release must wait behind its queued start");

        cursorHit = 32;
        tracker.ObserveQDown(true, true, () => cursorHit);
        Require(!tracker.ObserveKeyUp(true, false), "second tap release must attach to its own queued start");

        int widgetId;
        bool releasedBeforeStart;
        Require(tracker.TryStartNext(out widgetId, out releasedBeforeStart) && widgetId == 31 && releasedBeforeStart,
            "first dequeued WM_HOTKEY must start then release chord one");
        Require(tracker.TryStartNext(out widgetId, out releasedBeforeStart) && widgetId == 32 && releasedBeforeStart,
            "second dequeued WM_HOTKEY must start then release chord two");
        Require(!tracker.TryStartNext(out widgetId, out releasedBeforeStart), "both starts must be consumed exactly once");

        // A later held chord remains active until its own release or watchdog.
        cursorHit = 33;
        tracker.ObserveQDown(true, true, () => cursorHit);
        Require(tracker.TryStartNext(out widgetId, out releasedBeforeStart) && widgetId == 33 && !releasedBeforeStart,
            "held chord must not release before start");
        Require(!tracker.ReleaseIfKeysAreUp(true), "watchdog must preserve a physically held chord");
        Require(tracker.ReleaseIfKeysAreUp(false), "watchdog must recover a missed physical key-up");
        Require(!tracker.ReleaseIfKeysAreUp(false), "watchdog release must be one-shot");
    }

    public static int Main()
    {
        VerifyAuthoritativeWidgetHitResolution();
        VerifyChordStartHitSurvivesDelayedHotkeyAndRelease();
        VerifyRapidTapChordsKeepReleaseOwnership();
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
            delayedStart.ObserveQDown(true, true, () => 0);
            int ignoredId;
            bool releasedBeforeStart;
            Require(delayedStart.TryStartNext(out ignoredId, out releasedBeforeStart) && !releasedBeforeStart,
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
