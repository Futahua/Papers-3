# Papers — governing document

Managed native maximize follow-up, 2026-10-11: presentation restoration and pane placement normalize a native maximized window, including WPF_RESTORETOMAXIMIZED retained through minimization, before fitting it. Original SavedWindow placement remains untouched for exact release and recovery. Borderless application fullscreen detection remains distinct. Production pipe checks cover drag suspension/restoration and group exchange after native maximization.

Cross-window group exchange, 2026-10-11: transfer attachment uses `select:false` so only the authored selected member determines minimum size; outgoing inactive members release before the selected member. Groups containing independent hosted pages use `paneBackpackPages` and the existing workspace topology adoption owner for checked cross-window page ownership, with compensation on failure. Files/Preview remain protected. Interrupted page adoption reconciles live page ownership from retained native references. Evidence includes real cross-window round trips with a Proxima-style task-board page and a 780px inactive native peer entering a narrower slot.

Physical drag completion follow-up: swap validation compares binding and actual topology, membership, selection and rectangles rather than broad native revision counters. Source dragend restores presentation concurrently with the destination fit check; that presentation-only revision must not veto the accepted drop. Live request tracing confirmed the earlier rejection before mutation. Unit checks retain rejection of an actual selection change, and the real-window fixture now dispatches source dragend immediately after the foreign drop.

Relocation repair, 2026-10-10: a foreign pane destination may finish the exact source drag-overlay ticket so source DOM teardown cannot leave every window suspended until the watchdog. Cross-scope group transfers acquire the selected member first, then restore authored tab order; inactive wider native tabs must not become a temporary selection and veto a valid swap. Move here selects its incoming native tab after same-scope membership transfer. Preserve journal compensation and native size checks. Journal and rollback checkpoint decoding retains exact unsafe integer tokens with JSON.rawJSON; .NET process-start ticks must never pass through rounded JavaScript numbers, which incorrectly turns live native peers into dormant tabs on remount.

Read this first and completely before working in this repository.

Creator correction, 2026-10-16: unavailable native application windows must not change a group's authored presentation. Closing the last live peer or restoring after reboot retains expanded/minimized/maximized intent; dormant tabs represent missing windows. RetireClosed and RestoreMount must not infer minimization from all-dormant membership. The native regression exercises last-window closure and remount while preserving explicit minimization.

## Product north star

Papers is the creator's **personal programmable environment on an actual machine,
layered over Windows**. Its scope includes the machine's real files, installed
applications, native windows, devices, running processes, services and working state.
Actions must work with those real things and produce the intended result on the machine.

It keeps the best tools, applications, native machinery, agents, custom surfaces,
scripts and behaviors under the creator's fingers with minimal cognitive overhead.
Windows is the compatibility substrate for the software and machine the creator uses.
Electron, C#, Win32, Chromium, external programs, local services, agents and remote
systems are implementation choices; none defines or limits the product.

The creator describes the desired experience. Agents own architecture, implementation,
migration, testing and evidence. Internal implementation state must not become work
for the creator to manage.

The goal is maximum useful capability and excellent UX without growth making the
system progressively more brittle or expensive for agents to change.
**Capability is unbounded. Coupling is bounded.** Architecture preserves freedom.
Use the existing owner when it owns the truth; widen its contract when needed; create
another owner when the truth or lifecycle differs. Do not make unrelated systems own
new truth or sacrifice accepted behavior for architectural uniformity.

This vision is recorded in the opening of [the original north-star handoff](https://github.com/Futahua/Papers-3/blob/251aa0bf9e9ba3fe336b3354c3cd4b7f972af5c6/REFACTOR-HANDOFF.md).
Its dated paths, implementation plans and old runtime instructions are historical.

## Authority and working rules

This is this repository's single governing document. Current creator instructions
outrank it. Other documents supply technical reference, evidence, history or proposals;
they do not independently govern product direction or authorize work. Record accepted
corrections here rather than making several competing contracts.

- Preserve accepted behavior, creator data and unrelated changes. If recently working
  behavior regresses, compare history before inventing replacement architecture.
- Reuse existing trackers, services, applications and native behavior. Equivalent actions
  should converge on the same owner before identity, mutation and persistence.
- Keep failure local. A preview failure must not disable unrelated work or durable state.
- Inspect the actual source and running build; distinguish source tests from installed
  behavior. Use isolated fixtures and avoid taking the creator's mouse or keyboard.
- Honor authorization already given in the conversation. A document does not revoke it
  or require repeated permission. Publishing, installing, restarting or destructive work
  needs applicable authorization; ordinary inspection and reversible fixes can proceed.
- **Current cleanup scope (2026-10-07): documentation and comments first.** Reconcile
  stale or conflicting descriptions and clarify ownership. This cleanup does not authorize
  code rewrites, refactoring, behavior changes, deployment or publication. Historical
  refactor roadmaps are not the current assignment.

## Papers and Backpack ownership

Backpacks are independently evolvable compositions of behavior and presentation. They
may differ in UI, storage, lifecycle, languages and processes. One Backpack's design
must not become a universal ontology or framework. Share only after demonstrated reuse.
Backpack behavior belongs in its independent project; Papers owns reusable host
capabilities. A concrete Backpack experience can require host support: identify the
right owner and evolve its contract without moving Backpack-specific policy into it.
Ordinary Backpack changes do not require a Papers release or distribution elsewhere.

Reuse the best existing applications instead of rebuilding their interfaces or agent
systems. Native resident machinery is appropriate when timing and truth live at the
Windows input layer; do not force a renderer round trip merely for uniformity.

## Accepted product boundaries

- Basic remains reachable with Backpacks and Settings. Tool definitions and their
  management belong to the creator's Pencilcase Backpack, not a built-in Tools pane.
- Backpacks have no mandatory contents or common schema. Only the creator identifies
  something as a Tool; an implementation detail does not settle that product question.
- Mobile Backpack access uses the creator's PC as execution/state authority and Android
  as a live client, prioritizing latency and phone usability over desktop mirroring.
- Preserve the established Papers visual character while honoring explicitly requested
  surface themes. A historical warm-paper rule must not override approved blue panes.
- Preserve durable creator work. Document each feature's owner, location, sync, secrets,
  concurrency and recovery. Live profiles, credentials and process state default local;
  copying them does not install capabilities on another machine.
- State saves have no fixed character ceiling. Keep validation, checked revisions and
  atomic replacement. Keep snapshots out of ordinary state payloads and preserve the
  snapshot list when restoring a snapshot.
- Inline office editing is explicit and uses installed LibreOffice against original
  files. Preserve unsaved models when leaving or closing their native host. Only
  proven editor families are enabled; see docs/INLINE_OFFICE_EDITING.md for evidence.
- Current and future inline editors separate runtime startup from document loading.
  Reuse healthy clean engines, bound idle retention, issue fresh document identities,
  and preserve unsaved work before retiring an engine. Use the shared editor runtime
  lifecycle where applicable. Loading progress comes from the provider's reported
  stage/range; stages with no measured total remain indeterminate.

## Pickup and reference map

State the intended experience, owner, unresolved product questions and relevant delivery
scope briefly. Resolve implementation choices as an agent; do not ask the creator to
choose frameworks. Inspect Git status and preserve unrelated work before editing.

The source checkout containing this file is the working authority; use its actual path
instead of old absolute checkout paths. Installed binaries and copied debug/build trees
are not documentation authorities. Each independent Backpack has its own AGENTS.md.

- [Product reference](docs/PRODUCT.md): vocabulary and accepted behavior details.
- [Architecture](docs/ARCHITECTURE.md): implementation owners and dated evidence.
- [Decisions](docs/DECISIONS.md), [problems](docs/PROBLEMS.md), [acceptance](docs/ACCEPTANCE.md).
- [Projects](docs/PROJECTS.md), [data inventory](docs/SYNCTHING_AND_DATA.md).
- [Diagnostics and review procedures](docs/AGENT_WORKFLOWS.md), [control API](docs/DEVELOPER_CONTROL.md).
- [Update procedure](docs/UPDATING_PAPERS.md): use the supported installer, not hand-copying over App.
- [Reincarnation handoff](REINCARNATION-HANDOFF.md): historical refactor context, not an active rewrite assignment.

Run checks appropriate to the changed owner. Documentation-only edits need link,
consistency and diff checks, not an application rebuild or desktop interaction.

- [New-machine dependency and recovery checklist](docs/NEW_MACHINE_SETUP.md).
- [Cross-device experience, research and delivery plan](docs/CROSS_DEVICE_PLAN.md): creator-requested planning for PC/Android live access, AYG owner-based files, Proxima selective copies/following, native remote control and installation. Provider choices are provisional; distinguish preliminary device evidence from implemented features.
- Creator clarification, 2026-10-12: remote AYG is a filesystem experience only. It does not launch/control the owner's Windows applications or stream their windows. Any native remote-control capability is a separate Papers track and is not an AYG delivery dependency.
- Creator clarification, 2026-10-14: a PC Devices-menu row opens only a new Files tab inside the current group, immediately on click. Keep the original Files view unchanged. Device tabs are named explicitly, e.g. LapDog · Files; they never embed a complete workspace, Preview pane or native-window composition. The containing page owns that layout.

Pencilcase also owns the ChatGPT local coder view, opened from its dedicated tool
entry as a separate page. The Delegate Wave Backpack is retired and archived. Its
existing companion service remains the operational owner; Papers transfers the
single trusted relay binding to Pencilcase. No second agent manager is introduced.

Attached application windows remain available in the ordinary Windows taskbar and widget candidate list. Inactive pane tabs are minimized, never hidden. Release and recovery must not restore a temporary hidden state.

Papers owns desktop window gestures and Direct Pick in the resident native window-control service. Do not restart SlopTop AHK or introduce separate durable gesture selection/groups. Preserve the independent display-toggle daemon.

## Native pane stabilization, 2026-10-08

Physical host cut-outs are composed by `resources/native/pane-host-region.cs`, serialized per HWND across independent Backpack helper processes. Each helper contributes its own rectangles; hide/release/crash recovery removes only that contribution. Native minimum dimensions are observations retained by WindowSession, never authored edge intent. Geometry reports identify `placement` versus deliberate `resize`; only the latter can change durable splits. Restore acquires retained windows without presenting intermediate selections and waits for managed slice geometry. Accepted geometry caches omit activeTabId, and owner-bound replay waits for any in-flight slice transaction. Release acknowledges before teardown. Shutdown diagnostics record stages in `diagnostics/shutdown.ndjson` to identify any remaining hang rather than attributing it speculatively.

Evidence: 1,370 host tests passed (4 skipped); typecheck passed; isolated real WinForms host with two helper processes, constrained native peer, 30 placement replays and idle settling passed. Hide and release of one helper preserved the other helper's host holes. Hidden Electron composition fixture reported zero legacy Chrome moves. Real application modal dialogs and creator-driven fullscreen/drag interaction remain live acceptance checks, not proven by these fixtures.

Shutdown ownership follow-up: when the final authoritative Papers host retires, explicitly invoke app.quit instead of waiting for window-all-closed (hidden auxiliary windows may still exist). Close the host WebContentsView on BaseWindow.closed; BaseWindow does not automatically destroy that renderer. Per-window flush/finalization and global shutdown stages are logged separately. Focused lifecycle/finalization/factory checks: 12 passed. Do not describe this as a measured repair of every possible shutdown stall until the installed restart check completes.

Creator-directed single-pane restoration, 2026-10-08: supersedes the multi-slice presentation described above. Native host, WindowSession and pane bridge reuse commit 561de29 unchanged; numbered groups are no longer installed by AYG or Proxima. Independent preview composition and pinned document tabs remain. Backup of working files, patches, saved project state and retained native memberships: D:\CodexTemp\pane-single-split-backup-20261008-2345. Typecheck and 36 focused host tests pass; offscreen native check covers retained tabs, switching both ways, resized left edge surviving a stale rectangle, and release. This is a scoped pane restoration, not a rollback of file deletion or lifecycle fixes.


Creator-directed single-pane restoration, 2026-10-09: the attempted independent multi-group rebuild was rejected. Restore the accepted single native controller and original divider/geometry path in both AYG and Proxima. Keep the corrected pin button styling, reorderable pinned document tabs and native owned-dialog stacking/focus handling. No numbered native window groups are installed; saved split preferences remain dormant. Do not reactivate multi-group layout without a new creator request.

Creator acceptance and integration, 2026-10-09: the creator accepted the isolated native split experiment, committed as `07091d9`, and explicitly requested Papers integration. This supersedes the preceding prohibition for the accepted coordinator. `nativePaneBridge.ts` and `pane-coordinator-host.cs` opt AYG and Proxima into one native coordinator hub per physical Papers HWND, with independent Backpack scopes. Native snapshots alone own group rectangles, membership, selection and cut-outs; pages send one root viewport and explicit composition commands. Deliberate native outer-edge revisions and explicit selection requiring more native width can move the page divider; ordinary placement echoes cannot. Document refs remain opaque to native code; file paths/preferences remain Backpack-owned. Legacy single-pane code is retained for clients that have not mounted the coordinator, never run concurrently for a mounted scope. See `docs/NATIVE_PANE_INTEGRATION.md` for recovery, migration, validation and remaining live acceptance limits. The creator subsequently authorized local installation; the supported installer completed and Papers reopened with matching app/native-source hashes. This remains an unpublished local build.

Dock visibility follow-up, 2026-10-09: mounted coordinator scopes ignore legacy `chrome-pane-visible` requests, including old preview teardown after mount. Only native composition `present` and authoritative owner visibility control those scopes. The shared renderer measures a root without width transitions before retained-window restoration. Installed verification confirms selected ChatGPT matches the dock frame, the host cut-out exists, and idle bounds remain stable; both isolated Electron routes cover late teardown and final startup geometry.

Selected-edge follow-up, 2026-10-09: group minimum dimensions follow only the selected native tab, so an inactive wider application cannot veto its resize. Explicit selection refreshes native minimums and can widen the root leftward with a native revision while preserving its right edge. Narrow remounts retain oversized inactive tabs. Production pipe checks: 29 passed; broader native checks: 70 passed. Physical creator dragging remains a distinct live acceptance check.

Pinned PDF follow-up, 2026-10-09: `pdfPreviewHostBridge.ts` retains independent surface sessions inside one authorized Backpack owner. Optional bounded `surfaceId` changes presentation identity only; session move/close authority remains the validated owner. Replacing one surface cannot close neighboring viewers. Owner movement, visibility and teardown apply to every surface. Legacy callers without a surface ID preserve the single ordinary viewer contract. Both Electron routes verify two simultaneous PDF viewers, local tab lifecycle and decoded pinned images.

Minimized group follow-up, 2026-10-09: native layout projects minimized leaves out of content allocation and keeps a compact restore strip for each inside their authored quadrant. Remaining groups fill the released space. The authored split tree and ratios survive; visible edge gestures update their corresponding authored boundary, and restoration preserves such subsequent edits. Fresh-process recovery restores the minimized presentation. Native pipe checks: 36 passed; broader native checks: 70 passed; both Electron routes exercise minimize/restore and visible pinned content.
Whole-group drag acceptance, 2026-10-09: group numbers are removed; Lens belongs to the file toolbar. The group grip requests atomic relocate-group: center swaps leaf slots, edges reinsert that same group at the target split. Preserve membership, selected tab and HWND leases; keep native topology authoritative and show a matching swap/resplit cue.

Page session acceptance, 2026-10-09: persist unclosed pages, not physical windows. Closing a Papers window preserves pages; a page tab X or direct saved-page X removes one from the restore set without reopening it. Reboot/reload consolidates all unclosed pages into one window/strip. Runtime windows can exchange pages through the reviewed surface transaction. Durable page keys own independent AYG/Proxima native scopes; intent contains no HWND/PID. Unavailable native applications become compact replaceable tabs. Known URL recipes reopen lazily; never infer arbitrary application relaunch from a title. Picker In use rows reveal their owner; only explicit Move here transfers. Cross-page native transfer is journaled and compensated before remount; settled journals never replay over later edits. See docs/NATIVE_PANE_INTEGRATION.md for storage, migration and acceptance limits.


Container and hosted-page acceptance, 2026-10-10: the Pages menu lists only parked pages, joined by a stable colored branch for each restore set. Dragging one opens only that page and leaves its siblings parked. Backpacks-pill drags exchange complete runtime window bounds through a checked, reversible placement; page identities stay with their containers. Native group-center drops between windows swap group membership; edges insert groups, with native minimum and protected-panel checks. Refused moves pulse the source border for 400ms without changing its geometry.

An independent Backpack page can enter an AYG native layout as a retained logical page view. AYG cannot contain its own page or recursive page layouts. Native intent stores an opaque PageKey for membership; workspace topology remains the page/session authority, and the existing transfer owner handles cross-window adoption. Switching group tabs conceals presentation without restarting the page. Explicit page closure removes references, and remount prunes references absent from the authoritative unclosed-page set. Proxima retains its blue time-pill tab style; Files uses muted yellow and follow Preview purple. These are local source/install changes, not a new published version.

Hosting a retained page also relocates its outer tab into the containing page's actual outer group, including moves within one Papers window. The existing workspace topology owner collapses an emptied source split without closing the logical page or replacing its renderer; do not leave a blank outer slot or infer the destination from whichever group happens to be focused.

Retained page tabs follow authenticated live page-title changes, including Proxima's clock. Synchronize the native document reference as well as the displayed label without changing selection, membership or renderer identity; hidden layouts catch up when presented again.

Inactive outer page mouse drags keep the current destination page presented. For native draggable tabs, defer activation from pointerdown to the completed click; dragstart clears pending click intent. Preserve tab actions, modifier gestures and pointer-backend input. Drag regression checks include the inactive pointer press and a frame delay before dragstart, plus ordinary click activation on release.

Shift-drag of an outer page targets AYG native groups: suppress Dockview content/edge split handling and release the workspace-drag compositor lease while Shift is held. Ordinary drags retain outer splits and reordering. Shift does not activate an inactive source tab on press.

Reload Papers belongs in both Backpacks popup surfaces. The main-process owner waits for workspace mutations, invokes existing page/frame save hooks, flushes the canonical page/layout stores, then relaunches through normal graceful shutdown. A failed save leaves all windows open. `PapersData/reload-once.json` contains only a nonce, time and open workspace IDs, consumed once by the matching launch argument within five minutes; it restores current runtime containers from existing durable topologies without changing ordinary reboot policy or reopening parked pages. No HWND/PID or copied document state is stored in the reload recipe.

Web-link preview loading, 2026-10-11: native Chrome remains the explicit open/commit owner. Ephemeral embedded link previews retain persist:papers-web-browser and reuse their view. New or navigating preview views attach after dom-ready rather than covering loading status with an initial blank surface; browser-open returns at DOM readiness without waiting for trailing resources. Pending load failures before readiness still return through the existing error path. Native Chrome and durable browser-tab contracts are unchanged.

Shared-seam column drop, 2026-10-11: column-l/column-r split intent inserts beside the containing vertical subtree rather than splitting one leaf. Group relocation still removes and reinserts the same group through Change, preserving membership, selection, rollback and native minimum checks. The retained stack keeps its authored ratios and durable tree. Local deployment/restart for these fixes is creator-authorized.

Contiguous span drops, 2026-10-11: whole-group drags expose offset midpoint targets for every adjoining run of facing pane edges, in all four directions. Papers owns edge-span nodes (SpanEdge/SpanGroups) for crossings of T junctions, reserves selected native minimum sizes and carves one rectangular row/column without duplicating group identities. Checked preflight returns the actual proposed slot; Change remains the mutation/rollback owner. Span topology, ratios and group identities persist through the existing mount/intent store. Embedded suspension replies and preflight bounds use the same frame translation as layout snapshots. Evidence: 24 native directional spans plus recovery, resize, minimize/restore, removal and nested splits; both real Electron routes verify six handles, a crossing span, and exact cue/commit bounds. Existing local deployment authorization applies.

Creator-requested dead-window cleanup, 2026-10-11: Discard dead windows is an immediate cleanup action beside Reload Papers, never a reload. The native coordinator removes only dormant application tabs and checkpoints every mounted page, including hidden pages. Keep every pane, split ratio, presentation and size; preserve live applications, Files, Preview and hosted documents/pages. No automatic cleanup on restart.

Verified image assets, 2026-10-11: file capabilities store-image-asset and verify-image-asset provide immutable SHA-256-named image files with verified bytes. Backpack policy chooses the asset directory and state references; Papers does not rewrite Backpack state or bypass its writer/CAS owner. Static Backpack assets serve ICO and GIF with their image MIME types. AYG's public/icons migration and snapshot asset bundles are Backpack-owned.

Native Shift-drop replacement correction, 2026-10-12: physical title-bar Shift drags run in PaneCoordinatorHost.FinishDrop, independently of browser drag events. AttachShiftDrop replaces the destination group's selected dormant reference through Reconnect; ordinary destinations attach normally. Replacement preserves the retained tab identity and topology; failed acquisition restores the dormant slot. Native fixture checks cover replacement and rollback. Installed through the supported local installer after the existing reload/save owner completed.

Creator clarification, 2026-10-13: PC-to-PC Proxima may use the full interface to edit the live owner's facts. Every act goes to the owning PC's existing Store.command and is confirmed only after its persistence succeeds. Require the viewed source checkpoint, retain idempotency keys, refuse stale commands, and never queue offline edits or write remote facts to the receiver's database. Copy/follow remains distinct. Android work is outside this task; preserve the other agent's phone work.


Foreground return correction, 2026-10-15: the resident native pane coordinator handles the physical Papers HWND's actual foreground event. Refresh visible scopes and raise their selected native peers through the existing shared presentation stack exactly once; standalone coordinators use the same rule. Reject delayed events when the foreground has changed, preserve focus, and keep ordinary geometry events free of z-order writes. External maximized/fullscreen windows do not change pane membership, layout or native topmost policy.

Foreground stacking follow-up: HWND_TOP can return success while an external process's window remains above a peer. Insert selected peers explicitly after the physical host, whose cut-outs expose them, so the host and peers form a contiguous band. Preserve the existing owned-dialog ordering and foreground focus. Verify actual ordering, not just the API return value.

File target identity, 2026-10-15: Papers owns opaque device-local target identities, current paths, native observation and checked recycle receipts. Use the existing file capability / authenticated remote gateway; never expose owner absolute paths outside granted shares. Resolve identity before effects. Offline, ambiguous replacement and unobserved absence are not deletion. Windows uses normal-user native file/object IDs plus live deletion observation; no privileged journal service is installed. Android reuses PhoneIndex observation and census. Backpack placement, labels, bin policy and document writes remain AYG-owned.


Owner-rendered remote artwork, 2026-10-16: reuse the bounded thumbnail gateway and receiver client for previews and app-icon fallback; keep owner share checks, opaque resource IDs, maximum dimensions/bytes and before/after file-generation verification. Resolve remote icons at the owner before falling back locally. Do not materialize full source files merely to display icons. Evidence resides in AYG docs/REMOTE_OWNER_REFRESH_EVIDENCE.md.


Transfer/edit implementation, 2026-10-16: use pinned official tus engines for resumable bytes, retaining existing pairing, catalog, publication and edit-session owners. The original file owner serializes deliberate editing assignments, save publication and stop; stopped generations cannot publish late uploads. Preserve unsent editor copies and checked conflicts. Reuse the existing transfer UI and AYG writer; byte completion is distinct from durable AYG linking. See docs/TRANSFER_EDITING_IMPLEMENTATION_20261016.md for evidence and practical limits.

USB routing and folder latency, 2026-10-17: prefer an authorized physical Android USB route to the already-paired owner. Use official adb forwarding/reverse and standard HTTP transport; never change persisted device identity, paired network address, logical tus URLs or upload fingerprints when the cable changes. Reuse existing bearer/scoped owners. Bounded route discovery and resumable engines own reconnection; do not blindly replay uncertain mutations. Bundle the existing official adb runtime and notices for computers without an SDK. Coalesce concurrent remote listings so icons, metadata and folder navigation do not issue duplicate owner requests. Invalidate both completed and in-flight listing cache generations after owner changes. The creator prohibits mouse/keyboard automation; activation uses the existing reload/save owner. See docs/USB_FOLDER_LATENCY_20261017.md for actual delivery and acceptance evidence.
`nCreator-directed editing mark follow-up, 2026-10-16: marking must not launch an editor. New copies use original filenames and checked original-path metadata under Papers/Working files. Owner-confirmed unlink explicitly deletes the local copy, sidecars and private retained snapshots; unknown/unreachable is not a stop. Keep owner originals. Cached offline navigation dims unavailable neighbours and keeps prepared local editing files opaque. See docs/EDITING_MARKS_WORKING_FILES_20261016.md.

Phone read contention follow-up, 2026-10-17: resource catalogue registrations are dirty only when their mapping changes. One scheduled writer persists changed generations; ordinary HTTP reads never rewrite the complete catalogue. Checked jobs synchronously flush necessary mappings before durable acceptance and close flushes remaining registrations. Phone target resolution may supply freshly verified scoped entry metadata, allowing immediate direct browsing through the existing paired owner rather than enumerating ancestor directories. Preserve checked mutation paths and existing fallback for other owners. Evidence: docs/USB_FOLDER_LATENCY_20261017.md.

Restricted launcher file identity, 2026-10-17: the existing persisted-record launch owner resolves an optional bound fileTarget through the native TargetRegistry before opening. The launcher keeps only its existing invoke capability; arbitrary file-capability requests remain denied. Normal pages keep their checked renderer effects. Tests cover moved originals and refusal of replacement identities. See AYG docs/LAUNCHER_IDENTITY_20261017.md for regression evidence and activation.

Proxima rolling-cache support, 2026-10-18: the native workspace owner exposes inventory and checked local eviction, retaining bindings and causal records. Windows serializes managed file mutations and uses exclusive checked handles; Android protects exposed external-edit copies and checks hashes before removing bytes. This capability does not decide retention policy; Proxima does. BOP remains a complete replica with eviction policy disabled. No unrelated original/import-source files are removed.

Blob project sibling pages, 2026-10-19: an authenticated own-project open-new-surface request may specify inlineGroupId sibling. Resolve its parent and native group from the caller's existing pane page placement, never arbitrary target identifiers. Use the existing logical surface/attach owner and close an unattachable new surface. Without a containing native group, retain ordinary page creation. This powers MMB on Proxima blob project icons.

Stale tab-layout correction, 2026-10-19: Dockview reorder callbacks must match canonical group membership, not only tab count. A same-count stale membership previously threw from the React topology state updater and unmounted the whole host interface while all processes remained alive. App.tsx now rejects duplicate/foreign surface IDs before calling the strict reorder owner; keep reorderWorkspaceGroup validation strict. Build succeeded; no tests run. Renderer-only SlopTop package installed via normal host save/reload, SHA256 48e6d29c581d8168b125317f07bdcfc7533696c6cd01a72de7058bd43d33952c. Live host root text and child page views returned; no renderer isCrashed flags. Delivery/recovery in D:/Programs/evTEMP/papers-layout-crash-20261019. Existing main/preload/native code preserved.

File identity for non-ASCII names, 2026-10-25: `resources/native/file-target-identity.cs` reads requests and writes replies as UTF-8 on its pipes. It previously used the console code page, so files whose paths held Vietnamese letters or U+202F (Windows time stamps) were never enrolled and their AYG links could not follow moves. The helper executable is content-stamped, so the new source compiles on first use.
