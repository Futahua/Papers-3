# Native pane integration — 2026-10-09

The creator accepted the isolated experiment committed as `07091d9` and requested
Papers integration. The source now connects it to AYG and Proxima. After source
verification, the creator authorized local installation. Source changes and local
builds do not publish a new Papers version.

## Ownership

- `src/main/backpacks/nativePaneBridge.ts` compiles a hash-named helper and keeps
  one serialized endpoint per physical Papers HWND. Backpack scope identities
  survive surface remounts; new bindings reject departed renderers. The page
  receives opaque window-instance IDs, never raw HWNDs or process IDs.
- `resources/native/pane-coordinator-host.cs` owns the pipe protocol and physical
  coordinate conversion. `pane-coordinator-hub.cs` owns one event subscription
  set, HWND leases, combined presentation and the host cut-out contribution.
  Independent Backpack scopes retain separate membership and checkpoints.
- `pane-coordinator.cs`, `pane-layout.cs` and `pane-presentation.cs` own native
  selection, minimum sizes, split geometry, visibility and owned-dialog stacking.
  Both adjoining internal edges can author one shared boundary. Only deliberate
  outer-left resize revisions and explicit selection of a wider application update
  the page's root divider; ordinary placement echoes cannot become authored geometry.
- `pane-documents.cs` adds opaque `preview:` references to the same ordered group
  membership. Document edge requests use the same native layout transaction.
  Preview file paths and engines remain Backpack capabilities, outside native code.
- AYG's `public/app/coordinated-window-slices.js` renders snapshots and issues
  explicit commands. It starts with one group. Drag tabs onto another strip to
  transfer/reorder, or toward a pane edge to split. Numbered groups expose
  minimize, maximize/restore and X-to-merge. Native Shift-drag attachment and
  detachment are observed at the native owner without synthesized input.
- Proxima reuses that presentation inside its sticky sidecar. It suspends native
  presentation before disposal. Native maximize fills the pane viewport and does
  not also change Proxima's outer shell geometry. Preload converts iframe offsets
  once for both pushed snapshots and command/attachment replies.

Independent Preview docking/resizing and the existing checked document/pill store
remain Backpack-owned. The old renderer fitting controller is dormant after a
coordinator mount. The legacy native helper remains available for older clients;
the bridge releases its lease before mounting the coordinator.

## Persistence and recovery

Native cache/checkpoint files are machine-local runtime data: they contain HWND,
PID/start-time identities, original placement and local split topology, without
credentials. They are not a portable copy of another machine's live windows.
First mount imports the existing single-pane window list only after PID/start-time
validation. It preserves stable tab IDs and active selection.

One hub prevents competing leases inside a physical host. Commands are serialized,
binding/revision checked and composition failures roll back. Rejected pure geometry
changes do not replay unchanged native placements. A failed viewport cannot replace
the retained root rectangle. Inactive application tabs are minimized, never hidden;
ordinary taskbar/widget visibility is preserved. Release restores original position,
dimensions, show state, visibility and topmost status. Independent crash guards
restore native windows after a disposable host is force-terminated. Checkpoint writes
are coalesced outside resize gestures.

Document paths, saved pills and preferences continue through the existing checked
Backpack persistence queue. The version-2 renderer topology projection is descriptive;
the native checkpoint owns live group restoration. No creator state file was edited
for validation.

## Verification

Reproducible native checks:

```powershell
./tests/native-split-harness/build-pipe.ps1 -OutputDirectory D:\CodexTemp\papers-split-integration-2
./tests/native-split-harness/test-next.ps1 -OutputDirectory D:\CodexTemp\papers-split-integration-2
```

The native suite passes 70 checks; the production pipe adds 25 checks covering
legacy migration, actual HWND selection/geometry, mixed document order, document
resize and rejection, root rejection, stale bindings, separate Backpack visibility,
remount, X merge and exact release restoration. See `evidence/native-split-integration/`.

Papers typecheck/build and the full unit suite pass (1,375 tests, four skips).
AYG's full suite passes 1,986 tests. Two isolated Electron tests exercise the
actual preload/main/capability/native pipe, disposable native applications, a preview,
strip drag contracts, resize without losing selection, mixed reorder and group merge.
Both direct AYG and Proxima-style authorized embedded iframe routes pass, including
attachment replies translated to iframe coordinates and merging a group while a drag
continuation finishes. These tests do not take the creator's mouse or keyboard.

Physical mouse dragging, real application fullscreen, human interaction with an
overlapping owned dialog, mixed-DPI monitor transitions and coexistence with other
installed Papers native editor surfaces remain live acceptance work. Synthetic HWND
gesture events, fixture fullscreen and cut-out composition checks are not evidence
that all real applications have passed those cases. The accepted standalone desktop
harness remains independent of this integration test.

## Selected-window resize limits, 2026-10-09

Native group minimum dimensions follow its selected application. Inactive retained
tabs do not constrain that application's edge. The installed ChatGPT reports a
480-pixel minimum width, while an inactive browser reports 702 pixels; combining
their minima rejected the creator's narrower gesture and replayed the old frame.
Selection refreshes the incoming application's minimum and, if necessary, widens
the root leftward while preserving its right edge. This explicit native revision
updates the page divider. Ordinary geometry replays cannot undo it. Failure to fit
inside the host rolls the command back, including selection and HWND placement.

The production pipe suite now passes 29 checks, adding narrow native edge movement,
stale viewport rejection, wider-tab selection and a fresh-process narrow remount
that retains the oversized inactive tab. The broader native suite passes 70 checks,
including rejection rollback and crash restoration. Evidence is in
`D:\CodexTemp\papers-selected-edge-20261009`. These use real disposable HWNDs and
synthetic gesture events; they do not move the creator's mouse.

The selected-edge build was installed normally with matching source/package
hashes. Papers PID 68200 launched coordinator `pane-coordinator-c50016a95a2a2e88.exe`.
Read-only installed checks found the selected application's frame matched its
group, was visible and non-iconic, and had the corresponding host cut-out. The
creator was actively adding splits during verification; the check resolves the
selected group's leaf rather than incorrectly comparing it to the whole root.

## Pinned content and covered grab edge, 2026-10-09

Coordinated document panels were left collapsed. Their directory strip remained
visible but the body was hidden, and hosted PDFs declined to start. The renderer
now expands selected/presented panels and collapses inactive ones through the
existing preview lifecycle. A compact header row reserves space above content.
The dormant root resizer remains two pixels inside native content and below the
picker strip, with pointer events disabled. It cannot author a competing root
width; native borders and document-edge commands remain authoritative.

The existing PDF host now accepts an optional bounded presentation surface ID.
It indexes replacement by owner plus surface, while session movement/close remain
owner-authorized. Owner visibility, bounds and teardown cover all sessions. Calls
without a surface ID retain the legacy ordinary-preview replacement behavior.
Coordinated panels name their group surface, preserving the ordinary file preview
and neighboring pinned PDF viewers. Document paths and reading state remain with
their existing owners.

Both Electron routes failed the new visible-content check before the renderer
fix, and failed the simultaneous-PDF check before the host change. Both pass with
the changes: visible text, decoded image dimensions, actual Chromium PDF frames,
PDF close/reopen on tab changes, two simultaneous split PDFs and preservation of
the neighboring viewer. Focused host checks also cover local replacement, owner
authority, all-surface visibility/bounds/teardown and invalid surface IDs. AYG's
full suite passes 1,986 checks. Evidence is retained in the selected-edge directory.

Installed through NSIS and reopened normally at 16:15 +07, without forced shutdown
or synthesized input. Installed/package app.asar SHA-256 matches
`ABC45C861A8ABA51B715643EAA171AA95CED58FD66793BCD82CB2252835E7BE3`.
Papers PID 48424 / coordinator PID 21388 restored the creator's current groups;
the selected native frame and host cut-out match at the 16:16 read-only check.
The shared AYG/Proxima renderer loads from the existing Backpack project. No
commit, push or public release was made for these follow-up fixes.

## Minimized groups, 2026-10-09

The earlier implementation suppressed a minimized group's HWND but retained its
full content allocation, leaving a blank pane. Native layout now projects those
leaves out of the content tree and reserves one compact restore row per minimized
group above the remaining content. The authored tree/ratios remain available for
restoration. Visible boundary gestures map through the projection to the original
branch, so resizing while another group is minimized remains authoritative.
Restore can widen the root for selected native minimums using the existing explicit
native revision. Projection links are transient and never persisted.

The production pipe passes 36 checks: compact collapse, exact restoration, viewport
replay, nested vertical collapse, fresh-process minimized remount, native boundary
resizing during collapse, and restoration preserving that later boundary. The
broader native suite passes 70 checks. Both Electron routes click the actual group
controls, check that the neighbor fills the released space, and verify the pinned
preview reappears on restoration. Evidence: `D:\CodexTemp\papers-minimized-layout-20261009-v2`.

Installed normally at 16:32 +07 and reopened as Papers PID 14180, coordinator
`pane-coordinator-71be92f382d415fe.exe` PID 61864. Packaged/installed app.asar SHA-256
matches `833BD78A2434E509686ED2C7E93CCDDF3A33635311470A8F4454898A16753FCC`, and the
four changed native sources match. The creator had restored all groups before
restart; this retains their current presentation rather than changing their state
for a live minimize test. No physical input was synthesized.

## Local installation

Installed on 2026-10-09 using `Papers-Setup-1.3.11.exe /S` targeting the existing
`D:\Letters\MatTroiSeConMoc\Papers\App`. The old process completed its window flush
and global shutdown without forced termination. Installer exit code was zero;
installed `app.asar` and coordinator sources match the packaged build by SHA-256.
Papers reopened with its existing Data directory, responds normally, and launched
`pane-coordinator-87ad849a550f4a35.exe`. No mouse or keyboard input was synthesized.
AYG state differs from the pre-install backup only in its acknowledged root window
width; saved pills and other creator state remain unchanged.

Rollback backup: `D:\CodexTemp\papers-before-native-install-20261009-125424` contains
the previous App, PapersData and Backpack state copies. No push or publication occurred.

## Dock visibility regression, 2026-10-09

The installed handover exposed a missed integration path: AYG's
`replaceNativeTabs()` stops the legacy preview layout, which sends
`chrome-pane-visible(false)` after the new native scope mounts. The bridge had
translated that legacy preview message into whole-scope `present(false)`. The
saved ChatGPT tab remained selected, but the scope stayed unpresented and no HWND
placement occurred. This was a presentation-ownership error, not missing membership.

`chromePaneBridge.setPaneVisible` now ignores legacy preview visibility once the
coordinator owns the scope, just as it ignores legacy per-content geometry. Native
`pane-layout-command/present` and authoritative owner visibility still control it.
The focused bridge suite passes 15 assertions. Both isolated Electron routes now
send the exact late legacy teardown request and assert presented state plus native
placement evidence before testing split, preview resize, reorder and merge. Both
pass. The offscreen fixture height is bounded below Windows' current maximum
tracking height; oversized fixture geometry is correctly rejected by native code.

Startup also inherited the legacy panel's 160 ms width transition. The shared
coordinated renderer now disables transitions on its root before first mount, so
saved widths are measured at their final size rather than an intermediate width
that cannot contain a retained application's native minimum. Both Electron routes
exercise a narrow-to-saved-width change and verify the first mount geometry.

The visibility fix was installed through NSIS, with matching packaged/installed
app.asar SHA-256 `147D298924766275DE4D85F3016A982EA9BE18DE62A148454FE488793221E430`.
The independent AYG shared-renderer fix loaded on the final normal restart.
At 13:21:50 +07, Papers PID 61904 / coordinator PID 66848 restored both retained
tabs. Selected ChatGPT HWND 199334 was visible and non-iconic at (616,75)-(1355,760),
exactly matching the native content frame. The host region excluded its center,
and its bounds stayed unchanged during a five-second idle observation. No input
was synthesized. Verification is saved in
`D:\CodexTemp\papers-dock-visibility-fix-20261009\live-verification.json`.

Quadrant restore-strip correction, 2026-10-09: minimized strips are resolved
recursively inside the authored split branch. Horizontal columns retain their
width; a vertical sibling reclaims local content height. A minimized top-left
pane therefore leaves its restore strip in the left column and does not move
the right column down. Authored ratios remain unchanged for restoration.
Validation: 36 production pipe checks and 70 broader native checks pass, including
an unchanged neighboring quadrant, restart recovery and subsequent edge authority.

Whole-column minimize follow-up: when one horizontal subtree is entirely
minimized, its compact strip stays at that column's authored position and the
active subtree fills the width beneath it. Nested vertical leaves still collapse
locally. The production fixture now verifies the creator's exact case: minimizing
the right column while two left panes remain, then restoration and recovery.

Vertical restore rails, 2026-10-09: an entirely minimized horizontal subtree now
uses one 32-pixel vertical rail on its original side. Its minimized groups divide
that rail into adjacent sections in authored leaf order; active content fills
the remaining width without a top-row offset. The shared renderer displays only
restorable tab icons in vertical rails. Ordinary vertical-sibling minimize stays
horizontal. Native fixture checks cover both sides and a two-group shared rail.

Fullscreen preview lifetime, 2026-10-09: temporary occlusion by another maximized
group suspends the existing preview instead of collapsing and reopening it.
PDF/HTML move requests can detach presentation while retaining their live viewer;
owner visibility restoration respects session suspension. Selection changes and
explicit minimize retain the existing close lifecycle. The Electron fixture now
maximizes a neighboring native group and verifies the same PDF session resumes
without any close call. Both direct and embedded routes pass.

Whole-group handle, 2026-10-09: group numbers are removed. Lens uses the existing
camera control in the file-pane toolbar, retaining screen/clipboard activation.
A grip beside each group picker carries a whole-group drag. Center drops swap
leaf identities; edge drops remove/reinsert the existing leaf beside the target.
The coordinator applies this atomically through its normal minimum-size and native
placement rollback. Membership, ordering, selection and HWND leases stay attached
to the same group. A full target overlay means swap; a half target overlay means
resplit at that edge. Direct and embedded Electron checks exercise the actual grip,
cue geometry, mixed-group swap and vertical/horizontal edge repositioning.

## Unclosed pages and runtime windows, 2026-10-09

The creator's revised recovery model saves pages, not physical windows. Each page
has a durable `surfaceKey`; runtime surface IDs, HWNDs and renderer bindings may
change without changing its layout. Two pages of the same Backpack have independent
native scopes and page/root-keyed AYG preferences. Proxima adds its project ID to
the parent page key. The first legacy claimant migrates old layout preferences once.

Closing a Papers window preserves its pages. A page tab's X or its X in the Pages
list explicitly removes that page from the restore set, including a saved page
whose window is already closed. Reload/reboot atomically consolidates all unclosed
pages into one window and one strip, retaining each page's own native layout.
Physical window positions and groupings are not session intent. Dragging an outer
page tab out creates a runtime window; dropping it on another Papers strip/titlebar
adopts it through the existing checked cross-window surface transaction. Escape and
missing drop coordinates cannot create a window. The Pages list also offers moves.

The picker distinguishes Add, Remove here and In use at another owner. Selecting
an In use row reveals its page; only Move here transfers it. Group/tab drag tickets
are opaque and bound to the current coordinator binding. Cross-page native handoffs
checkpoint both scopes and journal a compensated transaction before release.
Prepared crash records restore the before-state; committed records finish the
after-state; settled records never replay over subsequent edits. Native hosts yield
for cross-window drag overlays and resume after the drop transaction.

Local storage owners:

- `workspace-topologies.json`: atomic unclosed-page set and runtime partitions.
- `PapersData/pane-layouts/`: atomic page split/membership intent, preview references
  and supported reopen URLs, without HWND/PID/process or recovery identities.
- `PapersData/native-helpers/`: disposable process checkpoints, native recovery
  guards and the transfer journal. Original application placement restoration is
  independent of page/session restoration.
- AYG's existing checked document preferences: page/root-specific previews and UI
  settings. Credentials remain in their existing application profiles.

Native restoration requires the same live process start time and stamped window
instance. Recycled HWNDs cannot silently acquire an old tab. Missing applications
retain compact unavailable tabs rather than blank allocated content. Known Chrome
URLs reopen lazily; Resume remaining retries supported recipes. The picker can
replace an unavailable tab without changing its ID or ordering. Arbitrary CAD or
other application's unsaved work is not an automatic relaunch recipe. Reconnect it
from the picker; Papers does not invent launch commands or credentials.

Host tests exercise direct saved-page destruction and compensated/settled journal
recovery. The isolated Electron route deletes native process checkpoints before
reload, verifies two independent pages in one window, transfers groups and pages,
and checks dormant replacement. DOM-dispatched dragging verifies production routing
without taking physical mouse/keyboard input. Physical drag acceptance and an actual
Windows reboot remain distinct manual checks; neither is claimed by these tests.

Installed-profile migration exposed a dead legacy helper whose recovery guard had
not recorded completion. Remount now runs the recorded recovery after verifying the
former owner is dead. Guards serialize by recovery generation and acquire the same
per-window leases as attachment before restoring original placements. A live lease
blocks recovery. Production pipe assertions cover the missing-marker case, rejection
of a live leased window, and release back to the true original placement. With this
follow-up, 44 pipe assertions, 70 broader native assertions, and both isolated
Electron integration routes pass.
