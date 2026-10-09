# Native window splits: implementation proposal

Status: the isolated coordinator was accepted and committed as `07091d9`, followed by source integration into Papers, AYG and Proxima. See the [current integration record](NATIVE_PANE_INTEGRATION.md) and [harness acceptance record](../tests/native-split-harness/README.md). The experiment milestone below records the state at that commit; it does not describe the later integration or an installed release.

## Implemented experiment, 2026-10-09

The native implementation now lives in `resources/native/pane-coordinator.cs`, `pane-group.cs`, `pane-layout.cs`, `pane-presentation.cs`, `pane-mount.cs` and the experimental `pane-region-contract.cs` compiler unit. It uses the existing `pane-host-region.cs` compositor and leaves the production helper, WindowSession and bridge route unchanged by this continuation.

The coordinator has one HWND index, per-process and cross-process lease protection, explicit group state, a native split tree, independent structural/geometry revisions, deferred viewport handling, rollback of composition failures, owned-popup event routing, and generation-bound recovery. Internal dividers can be authored from either adjacent native edge. The outer left workspace edge retains its authority across viewport replay and remount. Transfers preserve the existing native session and lease. Nested horizontal and vertical groups are enabled only in the standalone experiment.

The final isolated run passed 66 checks, including native-aligned headers after asymmetric resize, a lower group header directly above its own window, header-aware native minima and host-region controls. Each split leaf now reserves its header inside its own slot; zero-header callers retain their original native rectangles. It includes actual fixture HWND placement and visibility, both internal edges, nested groups, selection failure rollback, fullscreen fixture round-trip, shared region-client preservation, original maximize/minimize/topmost restoration, an independent crash guard, and fresh-process remount with stable tab identities. The report is in `D:\CodexTemp\native-split-harness\next-validation.txt`.

Native mouse gesture acceptance, human interaction with overlapping dialogs, real application fullscreen, mixed DPI and live Papers surface coexistence remain unsigned. There is no AYG/Proxima activation, preview-tab integration, installation or production restart in this milestone. The design and integration stages below still apply.

## Findings in the actual code

- `resources/native/chrome-pane-host.cs:253` implements the accepted `Fit`: after a native left edge is established, renderer rectangles provide top/right/bottom but do not replace it. `FollowResizedLeft` accepts a left-edge resize only while the right edge remains fixed. Fullscreen suspends fitting.
- The backup's `SetSlices` (`D:/CodexTemp/pane-single-split-backup-20261008-2345/host/files/resources/native/chrome-pane-host.cs:112`) combines rectangles, membership, visibility and active selection in one message. It explicitly clears `nativeLeft` and `chromeSizing` for every non-main slice. It then minimizes peers and calls `FitSlices`/`RaiseSlices`. A geometry replay can therefore revoke a live gesture and change presentation.
- Its `UseSlice`/`SaveSlice` copies one mutable set of native fields between groups. Event routing depends on whichever slice is currently loaded, rather than an explicit target object.
- The recently rejected per-group-helper approach reused the same physical Papers HWND across helpers. Each helper still subscribed to host/global foreground events and ran `Group`, `Fit` and recovery. Combining holes alone did not make those independent controllers independent. Transferring via detach/attach also restored then reacquired a real window.
- `window-slices.js` computes resolved rectangles, learns native constraints, changes split ratios from observations, and sends membership/visibility alongside rectangles. `pane-layout-model.js` may switch axes or automatically minimize neighbors. Those are multiple sources of presentation changes.
- `chromePaneBridge.ts` currently treats a Backpack owner as one retained native connection; `setOwnerVisible` hides other owners in the physical window. Simply adding aliases changes that contract.
- The Chrome probe is a one-visible-window experiment. Automated offscreen slice fixtures do not establish interactive multi-window behavior.

## Native ownership

Use one experimental native coordinator per physical Papers host HWND, on one native UI thread. It owns all attached window sessions, per-window leases, event routing, z-order, host cut-outs and crash recovery. Backpack scopes are namespaces within it, not separate processes controlling the same HWND.

Proposed files:

- `resources/native/pane-coordinator.cs`: command dispatch, HWND routing, host lifecycle, scopes and revisions.
- `resources/native/pane-group.cs`: explicit group state and the accepted fitting policy.
- `resources/native/pane-layout.cs`: split tree, shared boundary resolution and constraints.
- `resources/native/pane-presentation.cs`: one host mask and one stacking pass.
- `resources/native/chrome-window-session.cs`: retain capture/restore, taskbar-safe minimize/show and native fitting primitives.
- `src/main/backpacks/nativePaneBridge.ts`: one process per physical host; routes authorized surface/scope commands. The existing chromePaneBridge remains the production single-pane route during the experiment.

Runtime objects:

    HostState: HWND, process identity, scopes, HWND -> Peer index,
               original host region, geometry revision, event queue
    ScopeState: stable scope identity, current surface binding, viewport,
                split tree, groups, revision, presented flag
    GroupState: stable id, ordered tab refs, selected ref, frame,
                gesture state, minimized/maximized state
    Peer: stable tab id, WindowSession, lease, owning group,
          observed outer rectangle, observed visible frame, placement generation

A group transfer changes `Peer.GroupId` and tab order within the same coordinator. It never calls `WindowSession.Dispose`, releases its HWND lease, restores its original position, or creates a second session. The original pre-attachment placement remains valid until an actual detach or recovery.

## Separate commands

Each mutating command carries scope identity, surface binding generation, request id and expected revision. A stale command returns the current snapshot; the renderer does not retry old intent blindly.

- `mountScope(savedTopology, viewport)` / `setScopePresented(bool)` / `unmountScope`
- `setViewport(viewportRevision, rootBounds, headerMetrics)`: outer geometry only
- `attachWindow(binding, groupId)` / `detachWindow(tabId)`
- `selectTab(groupId, tabRef)` / `reorderTab(groupId, tabRef, beforeRef)`
- `splitAndMove(sourceGroup, tabRef, targetGroup, side)`
- `moveTab(sourceGroup, targetGroup, tabRef, beforeRef)`
- `closeGroup(groupId, destinationGroup)`
- `setGroupPresentation(groupId, normal|minimized|maximized)`

There is no renderer message containing every group's rectangle plus active tab and visibility. Repeating a viewport update must produce no selection, transfer, minimize, restore or focus calls.

Replies contain a complete revisioned snapshot of group topology, ordered native/document tab refs, selection and resolved frames. Geometry events carry a separate geometry revision and cause (`native-resize`, `host-layout`, `constraint`, `fullscreen`). Only completed user gestures or explicit composition commands change saved ratios. Renderer observations are acknowledgements, never new resize commands.

## Native edge flow

Keep the current left-edge policy: a title-bar move and top/right/bottom movement do not redefine the divider. Fullscreen/maximize keeps the accepted suspension behavior.

1. Enter size/move: route HWND to its peer and group; capture the actual outer rectangle and gesture generation.
2. A location event during the gesture with unchanged right edge and changed left edge changes the corresponding shared boundary. If that edge is the workspace's outer boundary, update the workspace seam; if internal, update the nearest applicable vertical split ancestor.
3. Do not reposition the dragged window. Compute affected neighboring frames in the native coordinator and reposition only those neighbors, without activation or z-order changes.
4. Apply the union of current visible frames to the host region, and publish resolved geometry. The renderer paints its strip/background to match it.
5. At gesture end, commit the resulting ratio once. Late viewport messages cannot replace the accepted boundary.

Use physical screen pixels for native calculations; convert to surface DIPs once at the bridge boundary. Keep `GetWindowRect` (placement/resize authority) and DWM frame bounds (visible seam/cut-out) distinct. Never feed a visible-frame inset back as an outer-window position: that creates cumulative drift.

A synchronous `fitting` guard is insufficient for queued WinEvents. Record the actual rectangle produced by each placement generation; discard matching programmatic echoes. Only an active native gesture can author a boundary. Treat a rejected requested size as a constraint observation, and do not retry the same impossible rectangle indefinitely.

A shared boundary has a feasible range from neighboring minimum sizes. Clamp at that range; do not alternate between renderer and application minima. Initially reject a new split that cannot fit. An incompatible tab activation is not silently allowed to shrink or hide its neighbors: retain the previous presentation and provide an explicit maximize-group action. Remove automatic axis flips and neighbor minimization from the initial implementation.

## Selection, popups and presentation

Selection only affects the chosen group's outgoing and incoming tab. The coordinator restores the incoming native window without activation, positions it once, updates the host mask, then focuses its visible owned dialog or the main window. It minimizes the outgoing peer using the accepted taskbar-visible behavior. Other groups do not receive geometry or visibility changes from a tab click.

Foreground observations during a selection transaction cannot replay an old selection. Outside a transaction, verify the current foreground HWND before treating a taskbar activation as a user selection of a retained tab.

One host-wide presentation pass sets the necessary z-order, then owned dialogs above their parents. Geometry handlers never raise all groups. Maintain one union mask using DWM visible frames, including overlapping owned popup frames where needed; renderer headers remain outside native content frames. Native apps remain top-level and unparented.

## Renderer, previews and Proxima

Replace the active responsibilities of `window-slices.js` with a view/controller that renders snapshots and emits explicit user commands. Reuse its strip/drop visuals; do not reuse its authoritative rectangle publisher or automatic layout fallback. `workspace-pane-layout.js` still owns the left list/graph and independent preview surfaces. Their resizing updates the native root viewport only when it actually changes.

Pinned previews remain renderer content with typed document tab refs. Selecting one suppresses the native peer in that group only. Its path stays in AYG document state; HWNDs and process identities remain in the native recovery store. The group snapshot supplies its preview rectangle. Preview reordering is the same ordered-tab command as application reordering; no native detach operation accepts a document ref.

AYG saves the acknowledged authored topology and preview refs through its existing checked-save queue. Native recovery stores runtime membership with process start identity. Mount restores topology first, acquires valid peers without intermediate activation, and presents selected peers once the viewport is known. Invalid runtime windows are omitted; they do not erase document previews or topology. No direct state.json rewriting.

Proxima keeps its existing sticky right sidecar. It submits a scope and viewport through the same bridge; parent/iframe coordinates are translated once. Leaving project view suspends that scope before revoking its binding. Late messages with an old binding generation are discarded. AYG and Proxima do not borrow each other's windows.

## Delivery sequence and proof

1. Build a visible standalone harness using this exact experimental coordinator. Start with two side-by-side groups and at least two tabs in one group, plus a modal dialog and a fixed/minimum-size test app. Include attach, move between groups, X/merge, minimize/maximize and release-all. Closing/crashing must restore external applications. Do not install the coordinator in Papers yet.
2. Establish single-group equivalence against 561de29 plus the retained dialog handling: same edge authority, fullscreen, minimize/restore, tab selection, release and idle behavior. The currently installed single-pane path remains independently available.
3. Test interactive two-group edge dragging and rapid switching. Log command cause, generation, requested/actual rectangle and resulting Win32 actions. Idle must have zero unsolicited geometry/visibility changes; stale messages must not move an accepted edge.
4. Test transfer without original-placement flashes or lease loss; modal/modeless windows; rejected minimum sizes; host move/resize; DPI changes; fullscreen round trip; crash/restart; three groups; group removal. Automated tests must assert final HWND rectangles, visibility and focus, not just successful API returns.
5. After the visible native behavior is demonstrated, wire the AYG renderer to the same coordinator, first in a separate test host/profile. Then add top/bottom/nested topology and pinned preview groups, followed by Proxima parity. Promote only after real interactive acceptance; passing source tests alone is insufficient.

The concrete change in architecture is one native owner of the physical window arrangement, with renderer composition expressed as explicit intent and acknowledged snapshots. It is not the rejected backup's context swapping or the rejected per-group-process bridge.
