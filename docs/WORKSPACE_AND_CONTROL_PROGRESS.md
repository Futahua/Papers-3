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
- [x] Prove collection-level A/B independence and exact close behavior in unit
  tests; live application proof remains pending until the host can create two
  surfaces through the user workflow/control plane.
- [ ] Prove one native window can hold A→project X and B→project Y in a live
  Electron workflow.
- [ ] Show/hide A without affecting B in a live Electron workflow.
- [ ] Prove two distinct surfaces can show the same project.
- [ ] Destroy/recreate a renderer transport while retaining logical `surfaceId`.
- [x] Close handling fans out to every owned runtime, and finalization retires
  every logical surface; live multi-surface Electron proof remains pending.
- [x] Resize and transparency changes fan out to every runtime entry.
- [x] Add semantic control inspection as each operation becomes real;
  do not use DOM scripting as the primary verification path.
- [ ] Reviewer sign-off before Dockview.

### Gate A1 — first usable tabs and splits in one native window

- [ ] Add and pin the selected layout dependency after current license/activity
  verification.
- [ ] Build Papers' versioned workspace topology model:
  surfaces, tab groups, active tab, split orientation/weights and focused group.
- [ ] Integrate layout renderer chrome without putting actual Backpack content
  into the DOM.
- [ ] Open, activate, reorder and close tabs.
- [ ] Split Right and Split Down.
- [ ] Drag tabs between same-window groups.
- [ ] Report pane rectangles to main and position/show/hide native WCVs.
- [ ] Hide relevant WCVs during drag/drop overlays so native views cannot cover
  drop targets; restore after commit/cancel.
- [ ] Keyboard tab selection and accessibility acceptance.
- [ ] Automatic restore of last tab/split workspace.
- [ ] Archive/remove and crash/reload behavior across multiple live surfaces.
- [ ] Add control commands such as `workspace.open`, `workspace.activate`,
  `workspace.close`, `layout.split`, `layout.moveSurface`, `layout.restore`.
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
