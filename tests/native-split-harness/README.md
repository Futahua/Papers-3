# Native split experiment

This is the visible test host for the accepted coordinator in `resources/native/pane-*.cs`. Running it does not install or activate a replacement in the installed Papers application. Source integration now connects the coordinator to AYG and Proxima; see [the integration record](../../docs/NATIVE_PANE_INTEGRATION.md).

## Build and test

From this directory, run:

```powershell
./build.ps1 -OutputDirectory D:\CodexTemp\native-split-harness
./test-next.ps1 -OutputDirectory D:\CodexTemp\native-split-harness
```

Open `D:\CodexTemp\native-split-harness\native-split-next.exe` for the interactive host titled **Papers Split Test**. Closing it also closes its own fixture applications; manually attached applications stay open and are restored. The earlier prototype and hardened executables are historical builds. Their source snapshots are in the continuation backup; use this directory as the current harness source.

Pass `--stacked-demo` to open the four-group arrangement with two columns on the left and two stacked windows on the right.

The default host starts three disposable native fixture applications, with two tabs in group 1 and one in group 2. These are separate processes with ordinary top-level windows and taskbar entries.

## Controls

- Drag either adjoining native border to move an internal divider. For the initial pair, these are A's right border and B's left border. Nested top/bottom splits accept either adjoining horizontal border.
- The workspace's outer left border retains the single-pane policy. Title-bar moves, outer right/top/bottom changes and corner drags do not author a workspace divider. Fullscreen suspends fitting.
- Drag tabs onto another tab to reorder or transfer. Drop on a group's arrow button to create a new group on that side. The receiving control has a faint green tint during the drag. Shift + drag outside the host detaches.
- Each group has a number, add, minimize/restore, maximize/restore and X-to-merge controls. Each leaf reserves its own header directly above its native content, including lower stacked groups. Native minima include the reserved header, and maximizing a group retains its header. Existing zero-header coordinator callers keep their original rectangles.
- **Attach existing…** opens a picker for manual tests with real applications. Attachment is explicit; automated tests only attach this harness's disposable fixture applications. A window already leased by another pane helper is rejected.
- **Checkpoint + remount** releases and reacquires the retained windows with the same tab identities, topology, order, selection, presentation and authored outer seam. Commands from the previous binding are rejected.
- **Release all**, closing the host, and crash recovery restore captured native placements. Inactive peers are minimized, not hidden.

## Latest evidence, 2026-10-09

The experiment commit recorded **66 checks**; the integrated native source now passes **70 checks**, including:

- repeated selection, unchanged neighboring placements and idle settling;
- headers following asymmetric native divider movement, lower headers between their own window and the upper window, and host-region hit areas;
- both adjoining edges, same-gesture out-and-back, nested three/four-group layouts and minimum-size rejection;
- rollback after attachment or selection placement failure;
- dead-window retirement during an active gesture with a deferred viewport;
- suppression under group maximize, host minimize/hide/resume and fullscreen fixture round-trip;
- owned-dialog z-order across a divider;
- independent region-client contributions;
- normal, maximized, minimized and topmost original-state restoration;
- stable remount identities, binding rejection, stale recovery-marker rejection;
- force termination of a disposable host, independent full-state recovery of all three fixtures, and remount in a fresh process.

`next-validation.txt`, `smoke-result.txt`, `native-actions-*.jsonl`, and the per-run crash checkpoint/recovery files are written to the output directory. The validation script checks that evidence is fresh and fails on assertions or exceptions. Foreground focus may be reported as SKIP if Windows refuses activation from a background run; that is never counted as a pass. The latest run had no skips; physical tab-click focus still needs verification.

The border tests change actual HWND rectangles and invoke gesture start/end callbacks. They do not synthesize mouse or keyboard input and do not establish physical mouse-drag acceptance. The fullscreen check uses a fixture's real borderless monitor-sized window; it does not establish Chrome/AutoCAD fullscreen behavior. Shared-region checks exercise the existing compositor with independent client identities; coexistence in a live Papers host remains unsigned.

## Remaining live acceptance

Physically drag borders out and back, rapidly click tabs, reorder/transfer/drop onto split arrows, and type/click in a dialog crossing a divider. Try a real application's fullscreen/restore and moving the host across monitors with different DPI settings. Verify the same behavior after remount and with other Papers native surfaces present.

The mixed native/document strips, pinned-preview group content, authorized Electron bridge and sticky Proxima sidecar are connected in source. `build-pipe.ps1` additionally verifies the production endpoint with 25 assertions. Installed behavior has not been replaced. The legacy single-pane route remains available to clients that do not mount the coordinator.

Continuation backup: `D:\CodexTemp\native-split-before-continuation-20261009-083422`.

## Creator acceptance, 2026-10-09

The creator accepted the visible four-group experiment and requested a separate commit followed by Papers integration. This authorizes the next implementation stage; the unmeasured acceptance cases above remain explicit verification work. Production integration must retain single-group geometry, restoration, ordinary taskbar entries and independent Backpack state.
