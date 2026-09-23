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

    public static int Main()
    {
        var state = new AltQHoldTracker();

        // A physical key-up can be observed before Windows dequeues WM_HOTKEY.
        // It must not emit a release before a start; the polling watchdog must
        // release the subsequently-started hold once it sees both keys are up.
        Require(!state.Release(), "release-before-hotkey must be ignored");
        Require(state.Begin(), "hotkey must begin the hold");
        Require(state.ReleaseIfKeysAreUp(false), "watchdog must close a missed key-up");
        Require(!state.Release(), "watchdog and hook release must not double-release");

        Require(state.Begin(), "a later hotkey must begin another hold");
        Require(!state.ReleaseIfKeysAreUp(true), "watchdog must retain a physically-held chord");
        Require(state.Release(), "the direct hook key-up must release the hold");
        Require(!state.ReleaseIfKeysAreUp(false), "poll after direct release must be inert");

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
            var delayedStart = new AltQHoldTracker();
            delayedStart.Begin();
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
