# Papers — governing document

Read this first and completely before working in this repository.

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
