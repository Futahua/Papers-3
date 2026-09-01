# Workspace composition and programmatic control — persistent progress

Last updated: 2026-09-02
Working branch: `agent/surface-context-routing`  
Canonical checkout used in this work: `D:\Letters\MatTroiSeConMoc\Products\Papers\Source`

This is the durable multi-session handoff for the two creator goals active today.
It records implementation progress, not approval to broaden Papers or release it.
Read [`../HERMES.md`](../HERMES.md) before acting on this document.

## Creator goals

### Goal A — multiple workspaces inside one Papers window

The creator wants one native Papers window to contain multiple Backpack/workspace
views:

- Chrome-like tabs;
- multiple views visible simultaneously in split/tiled layouts;
- saved/restored workspace topology;
- later, tabs/panes movable between native Papers windows;
- no loss of per-surface Backpack identity, sender routing, renderer state or
  the one-global-Hermes ownership model.

This must be a finished user workflow, not a generic docking-framework product.

### Goal B — Papers is programmatically usable and debuggable

Every creator-facing Papers action and authoritative observable state should
eventually have a supported semantic programmatic path so future developers and
agents do not require mouse/keyboard computer control for routine setup,
debugging and verification.

The programmatic path must preserve:

- native-window and logical-surface authority;
- Backpack/project sender security;
- permission and destructive-action confirmation boundaries;
- secret and filesystem-path redaction;
- real UI testing for visual, focus, keyboard, accessibility and crash behavior.

It is not permission for a public network API, remote access, arbitrary renderer
JavaScript, release, installation or bypassing creator confirmation.

## Current product decisions/defaults

- Renderer layout engine recommendation: **Dockview**, with Papers' own small,
  versioned logical workspace model as authority. FlexLayout is the strongest
  all-open-source fallback if Dockview's licensed advanced features become a
  blocker.
- Dockview must not own Backpack lifecycle or be the persisted product model.
- Actual Backpack content remains in native `WebContentsView`s; the React layout
  engine owns tabs, groups, splitters, drag/drop chrome and geometry only.
- A logical `surfaceId` is durable identity. `webContents.id` is a replaceable
  transport endpoint; native `windowId` is current ownership.
- Automatic restoration of the last workspace comes before named Save/Load
  Layout unless the creator later requires named layouts in the first milestone.
- Cross-native-window movement guarantees recreate/rebind against the same
  logical surface. Live `WebContentsView` reparenting may be a tested fast path,
  never the only correctness path.
- Developer control is dev/test-only by default, with explicit opt-in. It uses a
  local named pipe/Unix socket, never TCP.
- No destructive developer-control commands until a two-phase confirmation
  challenge is designed and explicitly authorized.

## Completed implementation

### Multi-window and global Hermes correctness — closed

Key commits, oldest to newest:

- `436238d` — serialize Hermes placement mutations.
- `d299618` — reconcile dock ownership on native owner-window close.
- `db62123` — require native placement acknowledgements.
- `58ba5d5` — preserve failed placement state and report renderer failures.
- `6cf96b9` — defer dock realignment during placement transitions.
- `c51f27d` — serialize the independent native realignment side channel with
  placement mutation; reviewer signed off with no remaining concrete issue.

Invariant: one global Hermes placement, one deliberate dock owner, all native
control state changes acknowledged, and no resize/reassert can overtake
dock/detach/hide.

### B1/B1.1 developer-control foundation — implemented

- `d7ec56f` — opt-in local developer command plane and first real Electron E2E.
- `136fadd` — socket tracking, forced shutdown, transactional startup, atomic
  descriptor publication, correct newline framing, shared client, safe build
  projection, command metadata/output schemas and Claude pickup guide.
- `4a920ae` — serialize client requests and drain in-flight commands before
  shutdown.
- `61c21cd` — redact Hermes error prose and raise shutdown admission barrier.
- `e053c95` — repair the actual `papersctl` executable and exercise it in the
  real Electron E2E.
- `af4e26c` — replace the one-runtime-per-window assumption with a
  `surfaceId`-keyed native runtime collection, fix exact hide/close routing,
  retire dead-window logical surfaces before delayed Hermes reconciliation, and
  expose safe native presentation state through control inspection.

Current semantic control capabilities:

- `inspect.snapshot`
- `inspect.windows`
- `inspect.surfaces`
- `inspect.surface --window <id> --surface <id>`
- `inspect.workspace --window <id>`
- `layout.list`, `layout.save`, `layout.load`, `layout.restore`
- `workspace.open`, `workspace.activate`, `workspace.close`
- `layout.split`, `layout.moveSurface`, `layout.moveSurfaceToWindow`
- `window.create`

Surface inspection also reports safe presentation state (`not-created`,
`hidden`, or `visible`) without exposing sender ids, URLs or filesystem paths.

Properties already enforced:

- explicit `PAPERS_DEV_CONTROL=1` opt-in;
- random process-specific local endpoint and 256-bit token;
- no TCP listener;
- strict versioned Zod schemas and output validation;
- request/frame size limits and correct stream framing;
- no fabricated renderer sender identity;
- no arbitrary renderer JavaScript command;
- redacted coherent snapshots;
- tracked clients, shutdown barrier, in-flight draining and forced close;
- transactional startup rollback and descriptor cleanup.

Usage and security contract: [`DEVELOPER_CONTROL.md`](DEVELOPER_CONTROL.md).  
Claude pickup: [`../CLAUDE.md`](../CLAUDE.md).

### A0 logical surface authority — implemented through lifecycle closure

- `9052d2f` — logical surface registry and durable `surfaceId`.
- `d55a889` — host commands explicitly name their target surface.
- `39ac317` — host renderer proves only native-window identity; it is no longer
  treated as a project surface.
- `edd1ffa` — developer control names exact surfaces and proves
  `{windowId, surfaceId}` agreement.
- `0df5991` — leaving a Backpack clears resumable selection correctly.
- `e053c95` — native-window close retires its logical surfaces; archive/remove
  tears down and notifies exact logical surfaces instead of the retired
  host-surface model.

Current authority model:

```text
host renderer sender -> native window only
host workspace command -> explicit surfaceId -> must belong to that window

project renderer sender
  -> {surfaceId, projectId, windowId}
  -> must still match the live logical-surface registry

developer-control actor
  -> authenticated control session
  -> explicit {windowId, surfaceId}
  -> must match current registries
```

## Validation evidence at `a03ff39`

- `npm run typecheck` — passed.
- `npm test` — 635 passed, 4 skipped; 55 files passed, 1 skipped.
- `npm run build` — passed.
- `npx vitest run --config vitest.e2e.config.ts tests/e2e/dev-control.e2e.ts`
  — 2/2 passed, including the real `papersctl` executable controlling a running
  Electron Papers process without DOM injection.
- Focused A0.4 collection/finalization/routing tests — 47/47 passed.
- `git diff --check` — passed before commit.
- Branch was pushed to `origin/agent/surface-context-routing` at `a03ff39`.

Do not claim the historical full product E2E suite is wholly green: unrelated
fixture/restart failures were previously observed and remain separately scoped.

## Current reviewer status

The browser reviewer signed off A3.4, B2.1 and the Electron 43.1.1 WCV
compatibility gate. The next eligible recorded gate is the A0.4 residual
same-project multi-surface evidence test.

The prior A3 review history is retained below.

Prior verdict on `e053c95`:

- A0 identity/authority and archive/remove targeting are closed.
- B1.1 remains closed with no new control-plane security or shutdown regression.
- Work may begin on A0.4, the per-window `surfaceId`-keyed runtime collection.
- Dockview must not begin yet.
- `closeAttachedProjectSurface(windowId, surfaceId)` currently discards
  `surfaceId` in the physical runtime implementation. This must be fixed by the
  A0.4 collection, not by adding another one-runtime guard or workaround.
- One smaller lifecycle-ordering correction remains: on native-window death,
  unbind senders and retire logical surfaces before awaiting potentially delayed
  Hermes reconciliation. Window authority may remain until reconciliation ends.

The `af4e26c` review found two concrete gaps, now addressed in `962f3b8`:

- ordinary semantic close removes its exact runtime collection entry, while
  hide preserves the entry for renderer remount;
- the window now tracks an explicit focused `activeSurfaceId`, and active
  Backpack/list/run projections no longer clear when a non-focused surface is
  closed.

The follow-up acceptance harness in `a03ff39` composes two logical projects in
one native-window collection and verifies focused-projection preservation.

The completed follow-up review of `06df02e` found two remaining projection
gaps, now addressed after `12d99b2`:

- archive/remove now reconciles each affected window's `activeSurfaceId` after
  project-wide retirement, selecting an unrelated surviving surface or
  clearing the projection;
- the cross-window "still active anywhere" decision now derives from the same
  active logical-surface projection as list/runs/return-to-origin, rather than
  treating legacy `enteredBackpackId` as workspace authority;
- focused ordinary close also updates the legacy fallback to the selected
  survivor, keeping the compatibility projection coherent.

Current validation after those fixes: typecheck passed, production build
passed, and the full Vitest suite passed with 636 tests and 4 skipped.

The completed review of `d9a7d3c` confirmed those projection fixes and found
one final owner-resolution seam. Detached workspace cleanup and delivery had
resolved `projectId` first, so activity in window A could close or miss the
same project's detached surface owned by window B. The follow-up implementation
now:

- carries the owning native `windowId` through the project-surface-close
  callback;
- closes a detached project only when both project and owner window match;
- unregisters only the closing owner's workspace registration;
- searches all same-project workspace registrations for the exact owner before
  delivering detached lifecycle messages.

Regressions cover owner-scoped detach close and exact workspace selection when
the same project has registrations from two windows. Current validation after
this seam: typecheck passed, production build passed, and the full Vitest suite
passed with 638 tests and 4 skipped.

The completed review of `07359f0` found the corresponding explicit IPC seam:
workspace-originated focus/reattach/close still used project-only session
methods, and a failed duplicate detach-open retained the newly created
workspace registration. The follow-up now:

- resolves the authenticated workspace sender's native window for focus,
  reattach and close;
- invokes owner-exact session methods and refuses a different owner's detached
  surface;
- rolls back only a registration created by a failed detach-open attempt.

Current validation: typecheck passed, production build passed, full Vitest
passed with 639 tests and 4 skipped, and dev-control Electron E2E passed 2/2.
The broader legacy Electron suite remains non-green in this environment across
unrelated fixture workflows (permission/startup timeouts and a missing
`crypto.randomUUID` in the worker fixture); no failure implicated these detach
paths.

Implementation submitted through `a03ff39`:

- Native project presentations now live in a per-window collection keyed by
  durable `surfaceId`; no layout framework or DOM-hosted Backpack content was
  added.
- Host show/hide/close and frame sender lookup resolve the exact surface.
- `inspect.surfaces` and `inspect.surface` report `presentation` as
  `not-created`, `hidden`, or `visible`, without sender ids or paths.
- Window-wide fit, transparency and close fan-out are covered by focused unit
  tests.
- Finalization retires sender bindings and logical surfaces before awaiting
  Hermes reconciliation.
- A focused-surface projection preserves the surviving surface when another
  surface closes; legacy `enteredBackpackId` remains only as a no-surface/UI and
  fixture fallback.

Reviewer conversation:
`https://chatgpt.com/c/6a963c1d-a728-83ec-b504-7d312e94fcc0`

Future sessions must read only the latest **completed** reviewer response and
verify any finding against exact current source before changing code.

## Remaining implementation checklist

### Gate A0.3 review closure

- [x] Repair `papersctl` shared-client usage.
- [x] Construct exact `inspect.surface` params from CLI flags.
- [x] Invoke the actual CLI in Electron E2E.
- [x] Retire logical surfaces on native-window finalization.
- [x] Archive/remove by exact `{windowId, surfaceId}`.
- [x] Preserve unrelated project surfaces.
- [x] Receive reviewer sign-off on exact `e053c95` for identity/authority,
  archive/remove targeting and B1.1.
- [x] Reorder native-window finalization so dead-window logical surfaces are
  retired before awaiting Hermes reconciliation.
- [x] Add the delayed-finalization regression proving retirement occurs before
  Hermes reconciliation completes.

### Gate A0.4 — per-window surface runtime collection, no Dockview yet

Purpose: remove the final one-runtime-per-native-window assumption before adding
renderer tabs or splits.

- [x] Replace `PapersWindowOwned.backpackProjectRuntime` with a
  surfaceId-keyed per-window manager/collection.
- [x] Make `papersWindowFactory.ts` construct the collection.
- [x] Make `runtimeForSender()` resolve the exact surface runtime.
- [x] Make `allRuntimes()` enumerate every attached surface runtime.
- [x] Make host show/hide/open/close act on an explicit `surfaceId` runtime.
- [x] Ensure `closeAttachedProjectSurface(windowId, surfaceId)` destroys/hides
  only the named runtime; closing P must leave Q physically and logically live.
- [x] Keep `enteredBackpackId` only as the documented active/focused/MRU
  projection; target authority uses the logical surface registry.
- [x] Replace list, runs, Canvas and return-to-origin active lookups with the
  explicit active-surface projection, retaining `enteredBackpackId` only for
  no-surface/UI and fixture fallback.
- [x] Reconcile focused-surface state after archive/remove retires every surface
  for one project; preserve a surviving surface from another project.
- [x] Make cross-window "still active anywhere" checks follow active logical
  surfaces rather than legacy `enteredBackpackId`.
- [x] Make detached workspace cleanup and lifecycle delivery resolve exact
  `{projectId, owningWindowId}` rather than the first project-wide match.
- [x] Make workspace-originated detach focus/reattach/close owner-exact and
  roll back registrations created by rejected duplicate opens.
- [x] Prove collection-level A/B independence and exact close behavior in unit
  tests.
- [x] Prove one native window can hold A→project X and B→project Y in a live
  Electron/control workflow (`workspace-tabs.e2e.ts`).
- [x] Show/hide A without affecting B in a live Electron/control workflow.
- [ ] Prove two distinct surfaces can show the same project.
- [ ] Destroy/recreate a renderer transport while retaining logical `surfaceId`.
- [x] Close handling fans out to every owned runtime, and finalization retires
  every logical surface.
- [x] Resize and transparency changes fan out to every runtime entry.
- [x] Add semantic control inspection as each operation becomes real;
  do not use DOM scripting as the primary verification path.
- [x] Reviewer sign-off at `06edf24`; A0.4 is closed and Dockview A1 may begin.

### Gate A1 — first usable tabs and splits in one native window

- [x] Verify Dockview's current package: `dockview-react` 8.2.0, MIT, active
  upstream; pin exactly 8.2.0. Enterprise features are not used.
- [x] Build Papers' versioned workspace topology model:
  surfaces, tab groups, active tab, split orientation/weights and focused group.
- [x] Integrate layout renderer chrome without putting actual Backpack content
  into the DOM.
- [x] Open, activate and close tabs through exact logical `surfaceId` targets.
- [x] Persist Dockview drag reorder into the Papers topology model.
- [x] Split Right and Split Down through explicit workspace controls; live
  Electron acceptance proves Split Right with two visible native panes.
- [x] Drag tabs between existing same-window groups; unsupported edge-created
  groups are rejected before Dockview mutates.
- [x] Report the active pane rectangle to main and position/show/hide its exact
  native WCV without covering Dockview tab chrome.
- [x] Hide relevant WCVs synchronously before Dockview drop overlays, and
  restore after drop, drag cancel or DOM drop.
- [x] Retain inactive tab WCVs and renderer sender bindings; presentation hide
  detaches without destruction, while semantic close/window teardown destroys.
- [x] Make a project-originated close authoritative in main: close the exact
  native runtime, retire the exact logical surface and select a survivor.
- [x] Keep the surviving tab selected and visible when archive/remove or a
  project-originated close retires the active surface.

First A1 slice at the current branch head:

- pinned `dockview-react` 8.2.0 (MIT; no Enterprise dependency);
- added the Papers-owned schema-versioned topology and pure open/activate/move/
  split/close transitions; Dockview serialization is not product state;
- added semantic host activation and pane-bounds IPC, both authorized against
  the exact logical surface;
- tab visibility drives exact native WCV show/hide, and returning to the
  Backpack picker preserves logical tabs rather than semantically closing them;
- live Electron/control acceptance proves Alpha/Beta tabs in one native window
  and presentation transitions `visible ↔ hidden` independently.

Validation: typecheck passed, full Vitest 646 passed / 4 skipped, production
build passed, dev-control Electron E2E 2/2 passed, workspace-tabs Electron E2E
1/1 passed, and diff check passed.

A1.1 lifecycle hardening after reviewer feedback:

- inactive tabs now preserve the same live WebContents and sender identity;
- concealment no longer emits surface-closed lifecycle callbacks, so tab
  selection cannot tear down owner-scoped detached workspace state;
- project-originated close is an authenticated semantic close in main rather
  than a renderer-only tab removal;
- the live workspace test proves A→B→A retains Alpha's sender, then closes
  Alpha from its project frame with no logical/control orphan and Beta visible;
- window teardown remains terminal and destroys every retained native view.
- repeated conceal/show cycles retain one destroyed/unbind listener per
  WebContents incarnation, preventing ordinary tab switching from accumulating
  lifecycle listeners.

Validation after A1.1: typecheck passed, full Vitest 649 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed.

A1.2 canonical-topology work in progress:

- [x] Retain the schema-v1 topology value in `App` and pass it into the layout
  renderer instead of discarding the value and keeping only its setter.
- [x] Translate Dockview's committed panel-move event into the Papers-owned
  `moveWorkspaceSurface` transition for known same-window groups.
- [x] Collapse the source group/tree node when its final surface moves away,
  matching semantic close behavior and preventing empty product groups.
- [x] Prove real tab reorder and same-window group DnD update Papers topology.
- [x] Synchronize user-resized root split weights into normalized Papers
  topology weights at the committed layout boundary.
- [x] Validate Split Right/Down against Papers topology before mutating
  Dockview, so a one-tab group cannot diverge the two models.
- [x] Rebuild Dockview-to-Papers group mappings atomically after committed
  mutations and restore native presentation at that same boundary.
- [x] Reconcile Dockview from external Papers topology mutations for the
  supported flat/single-split model, with API-origin/generation feedback
  suppression and convergence checks before every Dockview mutation.
- [x] Persist only validated/atomic schema-v1 Papers topology; do not persist
  Dockview JSON, sender ids, WebContents ids or native window ids.
- [x] Expose validated read-only topology through `inspect.workspace` and
  `papersctl inspect.workspace --window`, without Dockview serialization.
- [x] Decide restart identity mapping separately before consuming persisted
  surface ids during automatic restoration; A1.2h/i use durable workspace ids
  plus fresh runtime surface remapping.

A1.2b validation: typecheck passed, full Vitest 652 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed. The live workspace workflow
proves real reorder `[A,B] → [B,A]`, semantic `inspect.workspace`, sash-weight
changes, existing-group DnD, final-source-group collapse, retained native
renderer identity and authoritative project close.

A1.2b reviewer hardening:

- [x] Preserve existing Dockview-group ↔ Papers-group mappings across the
  post-mutation React lag; remove only dead mappings and explicitly map new
  supported groups. A focused race regression covers a moved tab whose source
  group still contains other tabs.
- [x] Disable floating Dockview groups until the Papers schema intentionally
  models them.
- [x] Require every renderer topology commit to exactly match the live
  `{surfaceId, projectId}` project surfaces owned by that native window;
  fabricated, retired, foreign-window and mismatched identities are refused.
- [x] Delete a window's in-memory topology during finalization.
- [x] Temporarily prohibit nested splitting in both UI eligibility and the
  Papers transition path until recursive split-weight synchronization exists.

Validation after hardening: typecheck passed, full Vitest 655 passed / 4
skipped, production build passed, dev-control Electron E2E 2/2 passed,
workspace-tabs Electron E2E 1/1 passed, and diff check passed.

Reviewer follow-up at `15daa02` closed those four blockers and found one final
cleanup-timing issue. Workspace topology is now cleared at the same pre-Hermes
authority boundary as logical-surface retirement, rather than waiting behind
delayed Hermes reconciliation and window-record removal. The delayed-Hermes
regression proves sender unbind, logical retirement and topology cleanup all
finish before the await begins. The original reviewer chat then reached its
conversation-length limit; start a fresh reviewer conversation for subsequent
reverse-reconciliation review.

A1.2c reverse convergence:

- [x] Add exact-window `layout.restore` semantic control, reusing the same
  live-surface authority validation as renderer commits.
- [x] Reconcile external Papers order, existing-group membership, active tabs,
  one supported root split/collapse and normalized root weights into Dockview.
- [x] Ignore API-origin structural mutations, suppress move/layout callbacks
  during a reconciliation generation, and skip the renderer's echo commit for
  externally restored topology.
- [x] Add monotonic workspace revision to `inspect.workspace`; live acceptance
  proves one external restore advances it exactly once, not again through
  feedback.
- [x] Extend `papersctl` with `layout.restore --window <id> --topology <file>`.
- [x] Live Electron acceptance proves external order convergence, real sash
  geometry, group collapse/recreation and retained native sender identity.

A1.2c validation: typecheck passed, full Vitest 655 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed.

A1.2d atomic persistence:

- [x] Persist schema-v1 Papers topology through `AtomicJsonStore` using
  runtime-independent identity rather than Electron/native window ids; A1.2h
  upgrades that identity to durable schema-v2 workspace ids.
- [x] Serialize and coalesce concurrent main-process commits; one writer drains
  the newest topology snapshots without parallel file replacement races.
- [x] Validate the complete persisted envelope and every nested topology on
  load; quarantine invalid state rather than consuming or deleting it.
- [x] Consume the selected v2 snapshot only through primary-window,
  resolve-first startup hydration with fresh runtime surface remapping; later
  windows remain fresh and no empty snapshot overwrites a failed/no-selection
  startup.
- [x] Live Electron acceptance proves the final one-surface topology reaches
  disk and the persisted JSON contains no Dockview, WebContents, sender or
  native-window identity.

A1.2d validation: typecheck passed, full Vitest 657 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed.
- [x] Keyboard tab selection and accessibility acceptance; see A1.2k.
- [x] Automatic restore of last tab/split workspace.
- [x] Archive/remove and crash/reload behavior across multiple live surfaces.
- [x] Add control commands such as `workspace.open`, `workspace.activate`,
  `workspace.close`, `layout.split`, `layout.moveSurface`, `layout.restore`.
  Implemented and live-validated: `workspace.open`, `workspace.activate`,
  `workspace.close`, `layout.split`, `layout.moveSurface`, `layout.restore`.

A1.2e semantic control operations:

- [x] Add exact-window/surface `workspace.activate`, `workspace.close`,
  `layout.split` and `layout.moveSurface` commands over canonical topology.
- [x] Reuse live surface lookup and topology authority validation; no command
  infers a target from active/current UI state.
- [x] Make control close terminally destroy the exact runtime, retire the
  logical surface, unbind its sender and converge the surviving topology/UI.
- [x] Extend `papersctl` with flags for each semantic command.
- [x] Live Electron acceptance drives semantic activation, split, restore and
  close while retaining the visual/DnD/sash assertions.

A1.2e validation: typecheck passed, full Vitest 657 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed.

A1.2f reviewer hardening (fresh review of `9a3c79f`):

- [x] Apply cross-field topology invariants at control ingress, main authority
  validation, persistence commit and persistence load; invalid state never
  advances canonical revision or reaches durable state.
- [x] Refuse topology outside the currently realizable flat one-/two-group
  model. Refuse in-place split orientation/root-order changes until Dockview
  can realize them exactly; external topology mutation is all-or-refuse.
- [x] Converge the renderer shell's `surfaceId`, project URL and entered
  Backpack from the canonical focused group's active surface.
- [x] Remove renderer-side close successor selection/activation. Main topology
  is the sole successor authority, including three-or-more-surface layouts.
- [x] Route ordinary Dockview/user close, project-originated close,
  archive/remove and developer-control close through the same main-owned
  terminal surface transaction: validate
  current topology before retirement, close/retire/unbind exactly, derive the
  canonical successor, persist it, emit topology, then emit cleanup notice.
- [x] Make every reconciliation generation schedule the suppression-latch
  clear, including a no-op generation superseding a mutating generation.
- [x] Allocate fresh split group ids when a derived id survives a prior
  collapse/re-split history.
- [x] Flush topology persistence during owned shutdown and make commit/flush
  failures visible in main diagnostics instead of swallowing them.
- [x] Add regressions for semantic-invalid restore with no mutation,
  unsupported orientation restore, retained group-id history, semantic disk
  validation, external host-tab activation, duplicate-restore unlatching, and
  three-surface project-originated/archive close where canonical focus is not
  the first logical-registry survivor.

A1.2f validation: typecheck passed, full Vitest 661 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed. Reviewer signed off exact head
`bccd746abc110d404ae262f77f4e27e099746946`.

Creator authorization note (2026-09-01): the creator explicitly authorized
continuing all scoped work with the reviewer. `workspace.close` is treated as
closing an open runtime surface, not deleting Backpack/project data; it remains
exact-target only. Any future data-deleting control operation still requires
the two-phase confirmation design below.

A1.2g main-authoritative `workspace.open`:

- [x] Add `workspace.open {windowId, projectId}` with authenticated explicit
  creation authority; no sender, entered/active inference or caller-provided
  surface identity.
- [x] Validate the exact live window's canonical topology before creation,
  resolve an available registry Backpack and real project URL, and refuse
  unavailable/empty projects without mutation.
- [x] Allocate a fresh logical project surface in main, insert it into the
  focused group, make it canonical active, and commit/revise/persist it.
- [x] Deliver one atomic main→host event containing trusted project descriptor
  plus resulting topology, so App has URL metadata before Dockview renders.
- [x] Re-resolve live window topology and Backpack availability after the
  project-lookup await, so concurrent layout/close/archive wins without stale
  canonical rollback.
- [x] Require fail-closed exact-host delivery before active/entered/revision/
  persistence mutation. Delivery failure retires only the invocation-owned
  fresh surface and leaves canonical state/revision untouched.
- [x] Add `papersctl workspace.open --window <id> --project <id>`.
- [x] Live A/B/C E2E opens Gamma through control, verifies the real host tab,
  then continues actual Dockview close/archive and persistence acceptance.

A1.2g deliberately does not read persisted snapshots, select restart workspace
identity, reuse old surface ids, map old→fresh ids or automatically restore.
Reviewer signed off exact head `6b66f13ab7921334db913f6303f5c4cb32fbec10`.

A1.2h durable identity and pure remapping basis:

- [x] Upgrade snapshot persistence to schema v2 with durable `workspaceId`,
  `lastWorkspaceId`, validated topology and `updatedAt`; native `windowId`
  remains only in the live in-memory `windowId → workspaceId` association.
- [x] Reuse one durable ID across every revision committed by a live workspace.
  Closing a native window drops only its live association, not its disk record.
- [x] Explicitly migrate schema-v1 lifetime snapshot keys to newly minted
  durable IDs rather than silently overstating their historical semantics.
- [x] Validate envelope relationships: unique v1/v2 workspace identities and
  non-null `lastWorkspaceId` referencing an existing record; quarantine
  malformed relationships instead of collapsing them through a Map.
- [x] Migrate one legacy snapshot as selected, but multiple legacy snapshots
  with `lastWorkspaceId: null`; v1 array order never invents selection authority.
- [x] Add pure `remapWorkspaceTopologySurfaceIds(topology, oldToFresh)` that
  rewrites surfaces, group membership and active IDs while preserving project,
  tab/group order, focus, split orientation/tree and weights.
- [x] Require a complete exact mapping with unique non-empty fresh IDs; refuse
  missing, extra or duplicate mappings and semantically validate the result.
- [x] Prove duplicate tabs for one project remap independently.

A1.2h still does not consume `lastWorkspaceId`, open projects, allocate startup
surfaces, construct mappings, or restore layout automatically. Reviewer sign-off
completed at exact head `100f2817fec005a33e04f2eacaa7c955b94bc6ca`.

A1.2i all-or-nothing primary startup hydration:

- [x] Add read-only selected snapshot access; it does not consume, reorder or
  persist, and a null selector makes no automatic choice.
- [x] Make main the sole startup restore authority and gate renderer initial
  empty topology commit until hydration decision.
- [x] Add a resolve-first all-or-nothing hydration core: resolve every
  persisted surface project/URL before allocation; allocate fresh surfaces,
  build old→fresh map, remap once, validate, deliver once, commit once, and
  retire only invocation-owned surfaces on failure.
- [x] Wire primary-window startup IPC and one combined descriptors+topology
  hydration event; additional windows return fresh/no-hydration decisions.
- [x] Gate initial empty topology commits until the hydration decision and
  keep no-selection/failure from immediately persisting a replacement empty
  snapshot.
- [x] Recheck every persisted Backpack after all project-opening awaits and
  before fresh surface allocation.
- [x] Memoize the primary hydration promise in main so StrictMode/repeated IPC
  calls cannot allocate or deliver a second restored workspace.
- [x] Keep hydration persistence failures visible through main diagnostics.
- [x] Complete live seeded-v2 restore acceptance; reviewer final sign-off is
  pending.
- [x] Live seeded-v2 primary restore; fresh IDs/order/focus/weights; durable ID
  reuse after mutation; additional window remains fresh.
- [x] Real UI E2E only for visual/keyboard/focus behavior; semantic setup and
  assertions through the control plane.
- [x] Reviewer sign-off on exact head `641460843d379862ec4bb50092847ffa618965bb`.

Reviewer closed A1.2i with no concrete lifecycle, startup-authority,
identity-mapping, renderer-convergence, persistence, or acceptance blocker.
The next narrow slice is A1.2j: archive/remove plus crash/reload durability
across a multi-surface workspace. Keep additional windows fresh and preserve
the persistence-redaction assertions.

A1.2j archive/remove and crash/reload durability:

- [x] Archive a project through the real Backpack IPC path and retire only its
  live logical/native surfaces across the workspace.
- [x] Persist the canonical survivor topology under the same durable
  `workspaceId`, with no archived project remaining in the snapshot.
- [x] Relaunch from the same user-data state and automatically hydrate only
  surviving projects with fresh runtime surface ids.
- [x] Remove an already archived project and prove it is not resurrected.
- [x] Abruptly terminate and relaunch the app after the removal commit; prove
  atomic persistence restores only the surviving projects.
- [x] Keep later windows fresh and retain persistence redaction assertions.
- [x] Reviewer sign-off on exact head `63b84f43801254d03b01890a1b7e0cf836853256`.

A1.2j validation: dedicated archive/reload Electron E2E passed 1/1;
typecheck passed; full Vitest passed with 677 tests and 4 skipped; and the
dedicated startup-hydration E2E remains 1/1. Reviewer signed off exact head
`63b84f43801254d03b01890a1b7e0cf836853256` with no concrete lifecycle or
persistence defect. The broader legacy Electron suite still has the
previously documented unrelated fixture/restart failures.

### A1.2k keyboard tab selection and accessibility acceptance

- [x] Keyboard can reach and select every live workspace tab.
- [x] Active tab exposes correct selected state and accessible name.
- [x] Keyboard focus and activation preserve canonical Papers topology and
  native presentation.
- [x] Keyboard acceptance covers a multi-surface workspace without relying on
  mouse-only Dockview gestures.
- [x] Reviewer sign-off on exact head `a9184df50564c2dce0df2db2464a5b2bd58ed3c8`.

A1.2k validation: dedicated keyboard-accessibility Electron E2E passed 1/1;
it reaches the active tab through real Tab navigation, moves across the tab
strip with ArrowLeft/ArrowRight, activates Alpha and Beta with Enter, verifies
accessible names and selected state, and checks canonical active-surface plus
native presentation convergence including the inactive tab becoming hidden.
Reviewer signed off exact head `a9184df50564c2dce0df2db2464a5b2bd58ed3c8` with
no concrete keyboard/accessibility defect.

A1.2i validation: the dedicated seeded-v2 startup Electron E2E passed 1/1;
typecheck passed; full Vitest passed with 677 tests and 4 skipped; production
build passed; and `git diff --check` passed. The dedicated acceptance seeds a
known v2 workspace, proves automatic primary hydration without UI assistance,
fresh runtime surface ids, preserved tab/group/focus/split-weight semantics,
single durable workspace identity after mutation, and a fresh secondary
window. The complete legacy Electron suite remains non-green in this
environment for unrelated fixture/restart failures (permission/startup
timeouts and a worker fixture's missing `crypto.randomUUID`).

### A1 workspace/tab/split milestone — closed

A1 now has signed-off live coverage for one-window tabs, supported splits and
weights, canonical external control, durable startup restore with fresh IDs,
archive/remove and crash/reload durability, and keyboard tab accessibility.
The complete legacy Electron suite still has the separately documented
fixture/restart failures; the focused A1 acceptance tests are green.

### A2.1a prospective-set validation and bulk replacement boundary

- [x] Validate a prospective topology against an explicit `{surfaceId,
  projectId}` set instead of requiring it to equal the currently live set.
- [x] Add all-or-nothing bulk replacement cleanup that accepts the explicit
  canonical old `{surfaceId, projectId}` set, closes native presentations,
  retires those logical surfaces, and unbinds senders without intermediate
  topology commits or per-surface close events; unrelated fresh replacement
  surfaces may coexist and remain untouched.
- [x] Add unit coverage for prospective validation, exact complete-set
  enforcement, and no-mutation-on-invalid-cleanup.
- [x] Reviewer sign-off on exact head `51c1df7e976cc73d75c660adbf51be8e6db94e44`.

A2.1a validation: typecheck passed and focused host-facade unit tests passed
27/27, including old+fresh coexistence and invalid-set no-mutation cases. The
production seam is intentionally not used by ordinary close; it is ready for
the named-layout replace-load transaction after reviewer review.

### A2.1b app-level named-layout persistence

- [x] Add separate `PapersData/workspace-layouts.json` persistence through
  `AtomicJsonStore` and `PapersPaths.workspaceLayoutsFile`.
- [x] Persist only validated named layouts with UUID `layoutId`, trimmed
  bounded names, topology, and creation/update timestamps; exclude workspace,
  window, URL, sender/WebContents, Dockview and native presentation identity.
- [x] Provide serialized create-only `create(name, topology)`, read-only
  `list()`/`get(layoutId)`, and `flush()` store operations.
- [x] Reject duplicate normalized names, duplicate IDs, malformed topology and
  invalid envelope state through validation/quarantine.
- [x] Ensure durable create failure leaves no in-memory phantom layout.
- [x] Reviewer sign-off on exact head `cf9faf696a89ca1b334cce55c6bc38bc75135bce`.

A2.1b validation: typecheck passed and focused named-layout store tests passed
5/5, covering atomic round-trip/cloning, concurrent create serialization,
duplicate/invalid names, malformed-state quarantine, redaction, and failed-save
no-phantom behavior. Reviewer found no concrete blocker and signed the exact
pushed head. No control, UI, or load transaction was included in this slice.

### A2.1c exact-window named-layout control transaction

- [x] Add exact-window `layout.list`, `layout.save` and `layout.load` control
  commands; neither save nor load may infer an active/current window.
- [x] Make `layout.save` capture only the target window's validated canonical
  topology and create one durable named layout without changing workspace
  identity or revision.
- [x] Make `layout.load` resolve every saved Backpack before allocating any
  replacement surface, recheck availability after awaits, remap every saved
  surface to a fresh runtime identity, and fail closed on any missing project.
- [x] Deliver one combined `host:event:workspace-layout-loaded` payload and
  replace the target only after complete validation/delivery; failures retire
  only invocation-created surfaces and preserve the old topology, revision and
  workspace identity.
- [x] Add focused transaction and control-protocol regression coverage for
  ordering, duplicate project tabs, rollback, exact cleanup, and one commit.
- [x] Add `papersctl layout.list`, `layout.save --window … --name …`, and
  `layout.load --window … --layout …`.
- [x] Reviewer sign-off on exact head `e4a96f21dc154e3a875751504cba4c9e89782d24`.

A2.1c implementation validation: typecheck passed, full Vitest passed 60/60
files with 691 passed and 4 skipped tests, build passed, and `git diff --check`
passed. Focused facade/control coverage includes resolve-first archive races,
duplicate project tabs with independent fresh identities, delivery rollback,
one combined event, exact old-set cleanup, one final topology commit, and a
late native-close failure after event delivery. Replacement cleanup now treats
known native teardown errors as non-throwing after the delivery boundary, so a
queued successful layout cannot be contradicted by rollback of its fresh ids.
Reviewer sign-off is still pending on the exact pushed head. UI remains deferred
to A2.1d.

### A2.1d minimal Layouts UI and live acceptance

- [x] Add a title-bar Layouts popover with name entry, Save current layout,
  named-layout list, Load actions, busy state and visible error feedback.
- [x] Expose renderer operations through authenticated host IPC that derives the
  target window from its sender; the renderer never supplies a native window ID.
- [x] Consume the combined load event by replacing the descriptor set before
  Dockview/native presentation convergence, with external-restore commit
  suppression.
- [x] Add a real Electron acceptance test for UI save, material mutation, UI
  load, fresh IDs, persistence, a second-window independent load, and an
  unavailable-project failure that preserves the target.
- [ ] Reviewer sign-off on the exact pushed head.

A2.1d validation: typecheck passed, the focused real Electron acceptance passed
1/1 after making secondary-window targeting use its explicit native `windowId`.
Full unit suite passed 691/695 (4 skipped), build and diff checks passed, and
the reviewer found no concrete UI, authority, convergence, lifecycle,
persistence or acceptance defect. No overwrite, rename, delete, merge, startup
selection, or management screen was added.

### Later gates

- [x] A2 — named Save Layout / Load Layout (A2.1a–d signed off at
  `e4a96f21dc154e3a875751504cba4c9e89782d24`).
- [x] A3.1 — define cross-native-window move transaction and authority
  contract (signed off at
  `adfd9796a7f9c3f21ca037681f86b08a92cb3ec2`).
- [x] A3 — cross-native-window move transaction with recreate/rebind fallback,
  forward canonicalization, and authenticated host-sender adapter (signed off
  through A3.4; exact implementation heads are recorded below).
- [x] Electron-version compatibility test for optional live WCV reparenting.
- [ ] B2 — richer `papersctl`, event subscriptions and authorized confirmation
  challenges for destructive operations.
- [ ] B3 — thin stdio MCP adapter over the same local control protocol; no
  duplicated business logic.

### A3.1 cross-native-window move contract (design slice)

- [x] Explicit source target `{sourceWindowId, surfaceId}` and destination
  `{targetWindowId, targetGroupId, targetIndex}`; reject missing, foreign,
  retired, non-project or non-live window identities. The source is proved by
  the authenticated host sender; the destination is an explicit live Papers
  window and is never the focused/primary window by inference.
- [x] Validate both workspace topologies against exact live project sets before
  mutation. Compute `sourceNext` with `closeWorkspaceSurface(sourceTopology,
  surfaceId)`. Compute `targetNext` by inserting the moved descriptor into the
  explicit target group, then applying the existing `moveWorkspaceSurface`
  ordering semantics (or an equivalent pure `insertWorkspaceSurface` helper);
  validate both prospective sets before touching native state. The destination
  cannot call `moveWorkspaceSurface` against the pre-move target alone because
  that helper requires the surface to already be present in that topology.
- [x] Choose recreate/rebind as the first Electron `43.1.1` implementation.
  `BackpackProjectRuntime` currently owns a fixed `BaseWindow` and exposes no
  reparent operation, so A3 must prepare a destination presentation from the
  project service's freshly resolved URL. A later optional live WCV reparent
  path needs an Electron-version compatibility test; neither native
  presentation nor `WebContents` identity is durable product state.
- [x] Define one serialized move transaction per application. Its phases are:
  capture and validate both windows/topologies; resolve and revalidate the
  project; preflight both host destinations; prepare a lifecycle-silent staged
  destination runtime and wait for its renderer to load; compute/validate
  `sourceNext` and `targetNext`; atomically persist both durable workspace
  records with one awaited store save; then perform the synchronous canonical
  handoff with no further asynchronous failure boundary. The handoff moves the
  logical `surfaceId` to the target, unbinds only old sender contexts for that
  exact surface, binds only the newly prepared destination project sender to
  `{surfaceId, projectId, targetWindowId, kind:'project'}`, updates both
  in-memory topologies/revisions/projections, and delivers one complete
  `{projects, topology}` projection to each affected host. The source projection
  removes the descriptor; the destination projection adds the moved descriptor
  with its resolved URL. Finally, perform best-effort source native teardown.
  The staged duplicate is never canonical or exposed to control inspection.
- [x] Use a dedicated `commitWorkspacePair`-style persistence primitive for the
  shared `workspace-topologies.json`; two sequential `commit()` calls are not
  crash-atomic. The primitive replaces both existing records in one
  `AtomicJsonStore.save()` and preserves the pre-move `lastWorkspaceId` rather
  than selecting whichever side was written second. An initially unassigned
  target receives a new durable workspace ID inside this transaction; the
  primitive also supports an atomic compensating restore that removes that
  newly introduced record if the canonical handoff must be undone.
- [x] Define rollback at every await and commit boundary. Before pair
  persistence, discard only the staged destination presentation and leave
  source topology, logical ownership, sender bindings and durable records
  untouched. If canonical handoff or either post-commit renderer delivery
  fails, restore the source/destination in-memory snapshots and exact sender
  bindings, discard the staged/adopted destination presentation, and perform
  one compensating atomic pair restore (including removal of a newly allocated
  target workspace record). If one renderer was already notified, send it one
  compensating complete `{projects, topology}` projection, not a topology-only
  event, so its descriptor set and topology return together. Preserve the
  logical `surfaceId` throughout; retire it only if the original native
  presentation cannot be restored and the source is no longer safe to expose.
- [x] Define renderer consumption for the move projection: replace the affected
  host's complete `openProjects` descriptor set before setting topology, arm the
  established externally-restored suppression latch, then derive active/entered
  state from the focused group's descriptor-backed active surface. The same
  complete-projection shape is required for compensation; a topology-only event
  is insufficient because `App.tsx` stores descriptors separately from
  `workspaceTopology`.
- [x] Make staging lifecycle-silent: a prepared runtime must not be inserted
  into the ordinary canonical project-surface collection before adoption,
  because ordinary `close()` can invoke `onSurfaceClosed` and mutate detach /
  widget ownership. It needs an explicit `prepareProjectSurface(...) ->
  {senderId, adopt, discard}` seam; `discard` cannot fire canonical close
  cleanup, while `adopt` installs the normal destination collection ownership
  only at handoff.
- [x] Make staging authority-safe: a staged destination WebContents must not
  be a fully executing, unbound project page that receives rejected startup IPC
  before adoption. The staging seam must either gate project application
  execution until canonical adoption or queue/withhold project IPC behind a
  staging barrier released only when the new sender is atomically bound to the
  target `{surfaceId, projectId, targetWindowId}`. It must not bind the staged
  sender early to either window, and it must never permit two simultaneously
  authoritative renderers for one logical surface.
- [x] Keep source and destination authority adapters separate. Host IPC derives
  `sourceWindowId` from its authenticated sender and accepts only `surfaceId`
  plus an explicit target; developer control authorizes explicit
  `sourceWindowId`, `surfaceId` and target through its authenticated control
  session. Both call the same core transaction. Never rebind a source
  WebContents to the target window, and never project-wide rebind same-project,
  widget, detached or unrelated tab senders.
- [x] Keep native teardown best-effort after canonical commit, with no rollback
  from a late destroyed-object error. Add the control command, sender-binding
  tests, native recreate/rebind tests, durable two-workspace failure tests and
  a focused two-window Electron acceptance only after this contract is reviewed.
- [x] Reviewer sign-off on exact head
  `adfd9796a7f9c3f21ca037681f86b08a92cb3ec2`.

A3.1 is signed off and implementation is proceeding at the infrastructure
boundary. A3 must not copy window IDs, sender IDs or native presentation state
into durable layout/workspace files. The two workspace records remain
independently represented but are committed through one atomic file save, with
the move operation responsible for coordinating their in-memory canonical
snapshots and compensating restore. The staged project renderer is not
considered prepared until its authority barrier is also safe.

### A3.2 cross-window move infrastructure

- [x] Add pure `insertWorkspaceSurface(...)` semantics for a moved descriptor
  that is absent from the destination topology; preserve explicit target group,
  index, active surface and focus invariants.
- [x] Add `WorkspaceTopologyStore.commitPair(...)` for one awaited durable save
  of source and target records while preserving pre-move `lastWorkspaceId`.
- [x] Add pair snapshots and compensating restore with explicit deletion of a
  newly introduced target workspace record.
- [x] Add a project authority barrier that queues staged project IPC until
  adoption and rejects it on discard; integrate the gate before the normal
  project sender guard.
- [x] Add a native runtime presentation option for hidden preparation and a
  lifecycle-silent collection `prepare(...)->{runtime,adopt,discard}` seam.
- [x] Reviewer sign-off on the infrastructure exact head
  `3da78e69a68d2b6885d65e494d1f1c5b6f57d596`.

A3.2 implementation validation: typecheck passed; focused topology,
workspace-store, authority-barrier and surface-collection tests passed; full
Vitest passed 702/706 (4 skipped); build and diff checks passed. The reviewer
signed off the infrastructure exact head above.

### A3.3 application move transaction and control path

- [x] Add one application-serialized `layout.moveSurfaceToWindow` transaction
  using explicit source/target window and group/index identities.
- [x] Resolve and validate source/target topology plus exact live logical
  surface sets, prepare a hidden destination runtime, atomically commit the
  durable workspace pair, then synchronously move logical ownership and exact
  sender bindings.
- [x] Deliver complete `{projects, topology}` projections to both affected
  hosts, with complete compensating projections after post-commit delivery
  failure; source native teardown is best-effort after commit.
- [x] Expose the move through the authenticated developer control protocol
  without sender IDs, URLs, or native identity in the command result.
- [x] Add facade success/rollback tests, control dispatch coverage, and a live
  two-window Electron acceptance covering native presentation convergence.
- [x] A3.3r hardening: exclude ordinary topology commits and window finalization
  from the pair boundary; retain forward canonical state if compensating durable
  restore fails; and make source native collection removal unconditional before
  best-effort teardown. Add race, restore-failure, and throwing-close tests.
- [x] A3.3r2 hardening: archive/remove now acquire the same per-project window
  authority before registry persistence; locked availability is rechecked before
  pair commit; failed-restore forward fallback also tears down the source
  collection; and composed adoption retries after a first presentation throw.
  Add archive/remove, source-cleanup, and double-failure adoption coverage.
- [x] A3.3r3 hardening: archive/remove and every live project-surface creation
  path share a project-level ownership gate across awaited registry/project
  work; the gate is held through availability cleanup, and native collection
  adoption retries presentation after a first `present()` failure without
  duplicating collection ownership. Add held-registry-save archive/remove and
  real collection retry regressions.
- [x] A3.3r4 hardening: direct host project open rechecks its window mutation
  barrier after its final await; startup hydration acquires the same sorted
  project ownership gates through resolve, allocation, delivery, and commit;
  add held-pair host-open and held-registry hydration races.
- [x] A3.3r5 hardening: startup hydration also checks the target window’s
  workspace-mutation boundary after final availability validation and before
  any allocation, delivery, or commit; add held-target move/hydration coverage.
- [x] A3.3r6 hardening: when the target closes after pair persistence and
  compensating persistence also fails, terminal forward handling discards the
  staged destination, retires/unbinds the moved surface, tears down the source,
  and advances the source projection without adopting into the dead target.
  Add target-close plus restore-failure coverage.
- [x] Reviewer sign-off on exact pushed head
  `b8717bb840be56c0a422398f6e11f3fc24d63994` (reviewed at pushed tip
  `a3b7f6fa90ab9c6a7db7ce7fad0c0328304f51e6`).

A3.3 validation so far: typecheck passed; focused move/protocol/persistence/
collection tests passed 81/81; full Vitest passed 719/723 (4 skipped); build
and diff checks passed; live workspace-tabs and developer-control Electron
acceptance passed 3/3. The A3.3 exact-head review is signed off.
Reviewer signed off A3.3 forward canonicalization at the exact implementation
head above with no remaining concrete defect. The next narrow slice is the
authenticated host-sender `moveSurfaceToWindow` adapter: accept only
`surfaceId` plus explicit target fields from the renderer, derive
`sourceWindowId` from authenticated `event.sender.id`, and delegate to the
same reviewed transaction.

### A3.4 authenticated host-sender move adapter

- [x] Add `host:workspace:move-surface-to-window` with a strict payload of only
  `{surfaceId, targetWindowId, targetGroupId, targetIndex}`; reject any
  renderer-supplied `sourceWindowId`.
- [x] Derive `sourceWindowId` exclusively from the authenticated host sender
  and delegate to the same `moveWorkspaceSurfaceAcrossWindows` transaction.
- [x] Expose the operation through host preload/bridge and cover correct-source
  routing, wrong-window rejection, payload spoofing, and strict schema tests.
- [x] Reviewer sign-off on exact pushed head
  `b7d4bcac93aedd1ee795aca5eeddc16651bf508d` (reviewed at pushed tip
  `166632d1066e20e90e98e9eb0f2eb184aa15b702`).

A3.4 validation so far: typecheck passed; full Vitest passed 723/727 (4
skipped); focused move/protocol/persistence/collection/host-IPC tests passed
85/85; production build and diff checks passed; live workspace-tabs and
developer-control Electron acceptance passed 3/3. The A3.4 exact-head review
is signed off with no correctness or security defect.

### A3 closure

- [x] Keep durable workspace state limited to validated topology/workspace
  identity; native windows, WebContents, sender IDs, URLs and Dockview
  internals remain live-only.
- [x] Keep cross-window moves serialized through exact source/target topology
  and logical-surface validation, hidden authority-gated preparation, one
  atomic pair save, exact sender replacement, and complete host projections.
- [x] Keep ordinary topology mutation, archive/remove availability changes,
  project ownership creation, startup hydration, and window finalization
  excluded from an in-flight move boundary.
- [x] Preserve canonical recovery for delivery failure, durable restore
  failure, native teardown failure, presentation retry, and close/dead-target
  double failure.
- [x] Expose the same reviewed move transaction through both authenticated
  developer control and authenticated host IPC, with host source identity
  derived from `event.sender.id`.
- [x] A3 implementation and adapter gates are signed off at exact heads
  `b8717bb840be56c0a422398f6e11f3fc24d63994` and
  `b7d4bcac93aedd1ee795aca5eeddc16651bf508d`; the latest pushed documentation
  tip is `a48a3b67ec6af48d5a1c5219626edbf383aa1517`.
- [x] Final A3 evidence: typecheck passed; full Vitest passed 723/727 (4
  skipped); focused validation passed 85/85; production build and diff checks
  passed; live workspace-tabs and developer-control Electron acceptance passed
  3/3.

A3 is complete. No A3.5 or A4 scope is inferred here; the next milestone must
be defined and reviewed separately.

### B2.1 control-client parity and safe event subscriptions — signed off

The reviewer’s next-milestone recommendation after A3.4 is this narrow
programmatic-control slice:

- [x] Keep `papersctl` and the shared `papersControlClient` at parity with all
  already-authorized semantic commands, including explicit cross-window move
  identities.
- [x] Add authenticated connection-local subscriptions with explicit,
  schema-validated event frames and response/event demultiplexing while a
  request is outstanding.
- [x] Permit only redacted semantic events; never emit URLs, filesystem roots,
  sender/WebContents IDs, native handles, Dockview internals, or renderer/native
  identity.
- [x] Prove subscription isolation, malformed frame/refusal behavior, and
  stable machine-readable `papersctl` event output in unit coverage.
- [x] Add one live Electron acceptance where a subscribed client observes a
  real semantic change while ordinary requests remain correct.

The initial implementation uses `window.created` and `workspace.changed` as
the deliberately small event vocabulary. Subscription is connection-local and
the server validates every complete frame before fan-out. Destructive
confirmation, MCP/stdio transport, optional Electron compatibility, release,
installation and packaging remain out of scope.

Implementation exact head `3bf0f6a0f161e3884c6d10a57522e3eceb2821eb` is
pushed with event implementation base
`d2c728c1d9a4a031d753b68554a49034fcf76e1a`; reviewer sign-off was recorded at
exact pushed docs tip `dfd8ccb51bcc3464f8282ed0d7c35e1440989e75`. Validation:
`npm run typecheck` passed; full Vitest passed 727/731 (4 skipped); production
build passed; live developer-control Electron E2E passed 3/3; and
`git diff --check` passed. The pre-existing user-owned modification to
`docs/evidence/worker-comparison.json` was not staged or changed by this gate.

Next narrow gate: test only whether Electron 43.1.1 can live-reparent one
already-loaded WebContentsView between two real BaseWindows, including a
post-reparent interaction and source/target close behavior. Either result
closes the compatibility gate; recreate/rebind remains the correctness path,
with no production behavior change.

### Electron 43.1.1 live-WebContentsView reparent compatibility — signed off

The standalone acceptance probe creates two real `BaseWindow`s and one loaded
`WebContentsView`, detaches it from the source, attaches it to the target, and
verifies:

- the source no longer owns the view and the target does;
- the same `webContents.id`, loaded data URL and renderer probe survive;
- a post-reparent renderer interaction returns the expected value;
- source and target can be destroyed without a destroyed-object exception.

Observed result: compatible for the live detach/attach operation on Electron
43.1.1. A target-window destroy does not automatically destroy the WCV, so the
probe explicitly closes the WCV and verifies its `destroyed` lifecycle. This
is evidence only: Papers continues to use recreate/rebind as the correctness
path, and no production behavior or A3 transaction selection changes.

Implementation exact head `bbe07275df114ebfd5b97956a98fae38342a52c3` is pushed
at review tip `18c9e564afab2703facac9c89ba41e5195b6cdb1`. Validation at this
candidate:
`npm run typecheck` passed; full Vitest passed 727/731 (4 skipped); production
build passed; combined developer-control and compatibility Electron E2E passed
4/4; and `git diff --check` passed. Reviewer found no concrete defect.

Next narrow eligible gate: the A0.4 residual evidence test for two distinct
same-project surfaces in one live window, with independent native presentation,
exact-surface interaction/routing, and exact close-survivor inspection.

### A0.4 residual same-project surface evidence — review pending

The standalone acceptance test uses existing authorized control semantics only.
It creates two fresh surfaces for one project in one live window, proves
distinct logical IDs and two native renderers, splits them into simultaneously
visible panes, activates each exact surface by requiring the focused group to
name that surface, and closes only the first while the second remains live,
visible and natively presented. Renderer probes receive distinct markers (`1`
and `2`) from the two independent project renderers.

Candidate exact pushed head: `9423857`. Focused same-project Electron E2E and
typecheck pass; full Vitest remains 727/731 (4 skipped), build passes, and the
combined live A0.4/compatibility/developer-control E2E set passes 5/5. The
candidate is re-submitted after review tightened two evidence assertions. No
production behavior, persistence, authority or control redaction is changed.

## Persistent pickup checklist for every new session

1. Read `HERMES.md` completely and state scope/release boundaries.
2. Read this document completely.
3. Inspect `git status --short`, current branch, origin parity and recent log.
4. Preserve creator/user changes; never reset or overwrite a dirty worktree.
5. Read the latest completed reviewer message once; ignore stale responses that
   name an older commit unless the finding still verifies in current source.
6. Run typecheck and focused tests before changing the next seam.
7. Implement one gate at a time; do not start Dockview before A0.4 sign-off.
8. Add/extend semantic control for newly real user actions and state.
9. Validate full unit suite, build, focused Electron E2E and `git diff --check`.
10. Commit and push only `agent/surface-context-routing` unless the creator says
    otherwise.
11. Send the exact commit and evidence to the reviewer; wait for completion
    before reading.
12. Update this document after each completed/reviewed gate.

## Explicit non-authorizations

This work does **not** authorize:

- release, package publication, installation or updater changes;
- terminating/restarting an installed Papers instance without a separate request;
- exposing developer control in normal production by default;
- TCP/remote control;
- arbitrary renderer code execution as a supported API;
- destructive commands without confirmation design and creator scope;
- turning one Backpack's behavior into a universal Backpack framework;
- persisting Dockview internals, Electron ids or sender ids as product identity.
