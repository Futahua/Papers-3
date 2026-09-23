internal static class HoverInputBridgeAltQTests
{
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
        return 0;
    }
}
