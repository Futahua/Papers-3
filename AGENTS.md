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
