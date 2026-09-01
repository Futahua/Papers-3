# Workspace composition and programmatic control — persistent progress

Last updated: 2026-09-01  
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

The browser reviewer completed its review of exact `af4e26c`; the next review is
pending for `a03ff39`.

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
- [ ] Decide restart identity mapping separately before consuming persisted
  surface ids during automatic restoration.

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
  runtime-independent UUID snapshot keys rather than Electron/native window
  ids. These keys are currently stable only for one live window lifetime and
  are not yet restart workspace identity.
- [x] Serialize and coalesce concurrent main-process commits; one writer drains
  the newest topology snapshots without parallel file replacement races.
- [x] Validate the complete persisted envelope and every nested topology on
  load; quarantine invalid state rather than consuming or deleting it.
- [x] Keep persisted snapshots write-only for now. Automatic startup hydration
  remains blocked on the explicit surface-identity mapping policy and cannot be
  overwritten accidentally by a hydration implementation that does not exist.
- [x] Live Electron acceptance proves the final one-surface topology reaches
  disk and the persisted JSON contains no Dockview, WebContents, sender or
  native-window identity.

A1.2d validation: typecheck passed, full Vitest 657 passed / 4 skipped,
production build passed, dev-control Electron E2E 2/2 passed, workspace-tabs
Electron E2E 1/1 passed, and diff check passed.
- [ ] Keyboard tab selection and accessibility acceptance.
- [ ] Automatic restore of last tab/split workspace.
- [ ] Archive/remove and crash/reload behavior across multiple live surfaces.
- [ ] Add control commands such as `workspace.open`, `workspace.activate`,
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
remains.
- [ ] Real UI E2E only for visual/keyboard/focus behavior; semantic setup and
  assertions through the control plane.
- [ ] Reviewer sign-off.

### Later gates

- [ ] A2 — named Save Layout / Load Layout.
- [ ] A3 — cross-native-window move transaction with recreate/rebind fallback.
- [ ] Electron-version compatibility test for optional live WCV reparenting.
- [ ] B2 — richer `papersctl`, event subscriptions and authorized confirmation
  challenges for destructive operations.
- [ ] B3 — thin stdio MCP adapter over the same local control protocol; no
  duplicated business logic.

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
