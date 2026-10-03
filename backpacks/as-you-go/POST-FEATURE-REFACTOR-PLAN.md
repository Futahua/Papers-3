# As you Go post-feature refactor plan

Status: proposed, to begin only after the current feature wave and its creator eye checks are accepted.

## Outcome

Refactor As you Go into small, testable services and surface controllers without changing creator-visible behavior, persisted data, Papers host messages, or the dated public entry filenames. The work is an incremental extraction from `public/workspace-20260730b.js`, not a rewrite.

The refactor is complete when the dated entry is a genuine composition root: it selects the workspace, detached, or compact-widget surface; constructs dependencies; mounts the selected surface; and contains no window-layout business logic, protocol parsing, persistence decisions, or substantial markup.

## Why this is needed

The current entry is about 4,300 lines and mixes mature explorer behavior with the recent window-layout wave. Its window-layout responsibilities currently include surface detection, markup, selection, group actions, direct and list picking, capability caching, recording ownership, detached lifecycle, widget channel wiring, preview handling, drag/unlink behavior, persistence scheduling, and DOM event routing.

Several supporting modules already exist and are useful seams:

- `public/app/window-layout-runtime.js`: recording and native-window runtime.
- `public/app/window-layout-detached.js`: exclusive ownership and save-gate lifecycle.
- `public/app/window-layout-widget-channel.js`: workspace/widget messaging.
- `public/app/window-layout-workspace.js`: committed pick and retirement writers.
- `public/app/window-layout-preview.js`: preview scheduling and validation.
- `public/app/window-layout-actions.js`: bounded scheduling.
- `public/app/host/host-bridge.js`: page-side Papers bridge.
- `public/app/workspace-store.js`: state, history, and persistence queue.

The remaining risk is primarily composition risk: the modules are sound in isolation, but the entry still carries important cross-module state and adapters. The 019I Promise-to-state defect is the model example: each individual component behaved correctly, while a two-line integration adapter invalidated the whole renderer state.

## Non-goals

- No redesign of the minimal layout buttons, hotkeys, or final UI polish during this refactor.
- No change to the window matching algorithm or native helper unless a separately proven defect requires it.
- No schema-version bump merely to rearrange code.
- No change to `project.json`, the Backpack ID, dated HTML/JS/CSS entry names, or existing Papers message names.
- No conversion to a framework, TypeScript build pipeline, bundler, or new runtime dependency.
- No simultaneous cleanup of unrelated prompt, graph, set, toolbar, or explorer behavior.

## Frozen invariants

Every extraction must preserve these contracts.

### Creator behavior

- Clicking a member icon activates/restores or minimizes the same live window while recording its current placement for that layout.
- Direct picking supports hover over native windows: unselected is blue/add, selected is red/remove, persisted members are green, Enter commits, and Escape/right-click is byte-zero.
- List picking remains available as a secondary path.
- Group minimize, restore, isolate, selection ranges, drag reorder, and data-only unlink retain their exact semantics.
- The compact widget remains a view/controller client; the workspace remains the sole durable writer.
- Detachment maintains exactly one active recording/controller owner and keeps the workspace read-only during ownership transfer.
- Helper outage, timeout, denied, malformed, or ambiguous outcomes never become evidence that a member disappeared. Retirement requires two genuine, freshly resolved missing observations.

### State and persistence

- Durable state remains a plain object with `schemaVersion: 1`, `groups`, `shortcuts`, `windowLayouts`, `activeWindowLayoutId`, and `view` as currently normalized.
- Runtime capabilities, helper tokens, HWNDs, process identities, candidates, counters, thumbnails, hover state, widget revisions, and transfer IDs are never persisted.
- All history-bearing changes go through the workspace store commit path; view-only changes use replace/save; the store owns the one persistence queue.
- A commit installs state synchronously and returns a persistence promise. That promise must never be assigned to document state.
- Cancelled picks and superseded read-only operations produce zero durable mutation.
- The workspace is the only durable writer, including commands originating from a compact widget.

### Host and ownership

- `public/app/host/host-bridge.js` remains the only page module that calls `postMessage` for Papers requests.
- Protocol payloads and results are bounded, exact, and typed by outcome. No renderer code consumes raw helper output.
- Native helper startup remains demand-driven and owned by Papers; As you Go never launches or kills it.
- Detached lifecycle order remains stop/cancel/drain -> flush -> acknowledge -> activate the new owner. Recovery reverses that order without two active controllers.
- Foreign Papers processes, helpers, windows, and creator state remain untouched by probes and cleanup.

### Compatibility

- Existing persisted `state.json` opens without migration loss.
- The dated entry files remain stable public compatibility shims even if their internals become small imports.
- Existing selectors, data attributes, glyph identifiers, accessibility labels, hotkey IDs, and widget URL parameters remain stable until a separately reviewed UI change.

## Target module boundaries

Names are proposed; adjust only to fit an already-established naming convention.

| Module | Owns | Must not own |
| --- | --- | --- |
| `app/surfaces/workspace-surface.js` | Main-surface construction and mounting | Native operations, protocol parsing, model transforms |
| `app/surfaces/window-layout-widget-surface.js` | Compact widget DOM, local selection, command intents | Store, saves, recording controller |
| `app/surfaces/window-layout-detached-surface.js` | Detached bootstrap and lifecycle presentation | Workspace persistence policy beyond injected gates |
| `app/window-layout/window-layout-controller.js` | User intents and orchestration across model/store/runtime | Raw DOM events, raw host messages |
| `app/window-layout/window-layout-view.js` | Card/member/picker markup and DOM patching | Host calls or persistence |
| `app/window-layout/window-layout-selection.js` | Inner selection and range-anchor state | Durable document state |
| `app/window-layout/window-layout-picker.js` | Direct/list picker session coordination and cleanup | Host protocol encoding, durable commit implementation |
| `app/window-layout/window-layout-group-actions.js` | Target selection, capability prewarm/retry, bounded actions | DOM querying or save scheduling |
| `app/window-layout/window-layout-recording-service.js` | Wiring runtime observations to model/store/status | Widget or picker UI |
| `app/window-layout/window-layout-repository.js` | Narrow plain-state selectors and durable writer adapters | Native capability calls |
| `app/window-layout/window-layout-observability.js` | Bounded structured diagnostics and snapshots | Creator data or unbounded logs |
| `app/host/protocol-schemas.js` | Exact request/result validation and bounded parsers | Transport or UI decisions |
| `app/host/host-bridge.js` | Request IDs, pending map, transport, named methods | Feature policy |
| `app/workspace-store.js` | Document/session state, history, serialized save queue | Window-layout semantics |

Avoid a generic `utils.js`. Shared code should be named after the contract it implements. Modules should accept explicit dependencies and expose the smallest interface needed by their caller.

## Sequenced migration

Each phase ends in a shippable state. Do not start the next phase with a red gate.

### Phase 0 — freeze the accepted baseline

1. Complete all outstanding feature fixes and creator eye checks.
2. Record the accepted live-proof transcript, screenshots, exact test totals, and known unrelated failures.
3. Add or update an architecture dependency map showing current entry-owned state, factories, and event routes.
4. Tag or commit the accepted baseline before any movement.

Gate:

- Creator accepts the major visual/native checks.
- All assignment-specific automated checks pass.
- Any remaining full-suite failures are classified with owners and are unrelated to window layouts.
- No probe processes or disposable windows remain.

Rollback: return to the baseline commit. No schema or data rollback is needed.

### Phase 1 — lock contracts before moving code

1. Add characterization tests at current production seams, especially adapters that connect store, runtime, widget channel, detachment, and host bridge.
2. Centralize strict page-side protocol parsers in `app/host/protocol-schemas.js`; keep message names and payloads byte-compatible.
3. Add plain-object assertions around load/install/commit/save boundaries in development diagnostics and tests.
4. Define a small diagnostic event vocabulary: surface lifecycle, controller owner, picker phase, group action summary, capability outcome, save outcome, and helper availability. Values must be bounded and exclude tokens, paths, thumbnails, and native identifiers unless a temporary proof explicitly requires them.

Gate:

- Contract tests fail under deliberate mutations of every protected seam.
- Protocol round-trip tests cover success and all typed negative outcomes.
- Persistence tests use the real store and validate complete Papers state shape.

Rollback: delete only new characterization/schema modules and restore imports; behavior is otherwise unchanged.

### Phase 2 — extract pure selectors, adapters, and ephemeral state

1. Move layout/member selectors and state-only adapters into `window-layout-repository.js`.
2. Move selected-member and range-anchor behavior into `window-layout-selection.js`.
3. Replace loose entry-level maps with one explicitly constructed ephemeral session object. Keep capabilities, icons, picker subscription, preview generation, save timer, selections, and anchors separated by responsibility rather than stored in one grab bag.
4. Preserve synchronous state installation and asynchronous persistence as distinct operations in names and types.

Gate:

- Pure module tests cover missing layouts, stale members, selection repair, and commit-return behavior.
- Serialized state remains byte-equivalent except for legitimate current-state updates.
- Forbidden runtime-key scan remains clean.

Rollback: restore entry-local implementations; no persisted migration occurred.

### Phase 3 — extract view and event translation

1. Move card/member/control/picker markup and DOM patch helpers into `window-layout-view.js`.
2. Move window-layout-specific DOM event interpretation into a controller that emits plain intents. Browser events do not cross into service APIs.
3. Keep selectors/data attributes and rendered order unchanged.
4. Separate workspace rendering, widget rendering, and read-only rendering through an explicit presentation-mode input rather than global surface checks.

Gate:

- Markup/accessibility/glyph tests compare behavior and stable contracts.
- Browser smoke covers member click, selection range, context action, drag reorder/unlink, list picker, and surface rerender.
- No host or store call exists in the view module.

Rollback: switch the entry imports back to its prior inline render/event functions.

### Phase 4 — extract picker and group-action services

1. Give the picker one session object with an explicit state machine: idle -> starting -> active -> staged -> committed/cancelled/failed -> closed.
2. Make subscribe-before-begin, overlay cleanup, cancellation, and supersession properties of the picker service rather than entry conventions.
3. Move target derivation, capability prewarm, stale-binding retry, bounded concurrency, action summaries, and the one durable state commit into `window-layout-group-actions.js`.
4. Return typed results to surfaces; services never paint status directly.

Gate:

- Picker tests cover immediate result, failed begin, repeated begin, Escape/right-click, Enter, read-only supersession, lost overlay, and byte-zero cancellation.
- Group tests cover all/selected/range targeting, partial failure, stale capability recovery, helper outage, and concurrency bounds.
- N6 and N8 harness rows pass without increasing timeouts.

Rollback: rewire the controller to the prior entry functions; state and host protocol remain unchanged.

### Phase 5 — make recording ownership a single service

1. Wrap runtime, active-layout persistence, save scheduling, and retirement handling behind `window-layout-recording-service.js`.
2. Expose explicit `start`, `ensure`, `stopAndDrain`, `reconcile`, `invalidateCapabilities`, and `snapshot` methods.
3. Make ownership state observable: surface, active layout ID, generation, timer active, member count, and in-flight count. Do not expose capabilities or tokens.
4. Keep helper recovery demand-driven, but make the reason for no demand visible (`inactive`, `no members`, `read-only`, `stopped`, or `superseded`).

Gate:

- Runtime unit tests retain two-genuine-missing and transient-outage guarantees.
- Detach tests prove exactly one controller and no calls after read-only handoff.
- N7 live proof shows fresh helper recovery and exact member-set preservation.

Rollback: restore direct runtime wiring while retaining compatible service interfaces behind an adapter.

### Phase 6 — split the three surfaces

1. Move compact-widget bootstrap, local selection, preview resolution, picker intents, and close behavior into `window-layout-widget-surface.js`.
2. Move detached bootstrap/activate/resume presentation into `window-layout-detached-surface.js`.
3. Move main workspace construction into `workspace-surface.js`.
4. Reduce the dated entry to dependency construction, surface selection, and mount/error handling.

Gate:

- Workspace, widget, and detached surface tests each start independently with fake dependencies.
- Widget has no store/save/controller references by structural test.
- Workspace remains sole writer under simultaneous widget commands.
- Repeated detach/widget crash-reopen proofs pass.

Rollback: retain the dated entry as a compatibility switch able to select the old composition for one release/checkpoint. Remove that switch only after live acceptance.

### Phase 7 — consolidate observability and harnesses

1. Replace temporary assignment-specific console diagnostics with bounded structured events behind the observability module.
2. Make live proofs consume typed receipts where possible instead of inferring completion only from timeouts or screenshots.
3. Keep physical-input rows separate from renderer-driven rows. A renderer-driven event must never be labelled as real OS input.
4. Give each row an independent preflight, captured decisive values, bounded timeout, cleanup receipt, and contamination classification.
5. Retain a fast smoke tier, a native non-input tier, and an exclusive physical-input tier.

Gate:

- A failed row reports the exact boundary and typed outcome, not merely “timed out.”
- Harness cleanup proves zero owned survivors and preserves all foreign processes.
- Repeating a proof produces no stale temp-state dependency.

Rollback: retain the last accepted proof scripts until the replacement produces equivalent receipts twice.

### Phase 8 — delete compatibility scaffolding and refresh documentation

1. Remove entry implementations only after their extracted replacements have passed two successive checkpoints.
2. Remove obsolete debug tags, duplicated adapters, dead selectors, and assignment-only comments.
3. Update `ARCHITECTURE.md` so it describes reality, including the three surfaces and window-layout service map.
4. Record final module sizes and dependency direction; investigate any new module that becomes another oversized composition root.

Gate:

- No duplicate production implementation remains.
- The dated entry is a small composition root.
- Full automated, native, and creator eye-check gates pass.
- State from the pre-refactor baseline opens and behaves correctly.

Rollback: revert only the cleanup commit; extracted modules remain available.

## Workstreams and coordination

Parallel work is useful only after Phase 1 freezes interfaces.

| Workstream | Scope | May run alongside | Merge dependency |
| --- | --- | --- | --- |
| A — state/contracts | Repository adapters, persistence assertions, protocol schemas | B, D | First |
| B — view/surfaces | Markup, event translation, workspace/widget/detached mounts | A, D | After A interfaces freeze |
| C — native orchestration | Picker, group actions, recording service | D | After A; before final surface wiring |
| D — verification | Characterization tests, diagnostics, harness receipts, migration fixtures | Every phase | Must approve every merge |

Rules for parallel workers:

- One editor owns each production file at a time.
- A worker changing an interface posts its exact proposed signature before editing consumers.
- Tests for a seam belong in the same commit as the seam movement.
- Do not resolve merge conflicts by choosing an entire file. Reconcile behavior at the smallest changed block.
- Native/exclusive harness runs are serialized on the shared desktop. Unit tests and read-only audits may run in parallel.

## Test and proof matrix

| Layer | Required evidence |
| --- | --- |
| Pure state | Normalize/migrate, add/remove/reorder/update, forbidden-key rejection, byte stability |
| Store | Synchronous install vs persistence Promise, queued saves, failure handling, read-only permit |
| Protocol | Exact schemas, size/Unicode boundaries, source/origin checks, typed negative outcomes |
| Controller | Plain intents, selection/range semantics, no raw event leakage |
| Picker | State machine, staging colors/kinds, commit/cancel, cleanup, supersession |
| Group actions | Target set, bounded concurrency, per-member result, stale retry, one final commit |
| Runtime | Ownership, timer lifecycle, recovery, echo suppression, two-miss retirement |
| Surfaces | Workspace writer, widget client-only, detached ownership transfer, crash/reopen |
| Native non-input | Real helper, native bounds/state, group operations, outage recovery, cleanup |
| Exclusive physical | Real cursor hover, click, Enter/Escape, visual green/blue/red eye check |
| Migration | Accepted pre-refactor state fixture loads and re-saves without data loss |

Never increase a timeout until the decisive values at the failing boundary have been recorded. Prefer one measurement that eliminates several hypotheses.

## Commit strategy

The current worktree contains a large, dirty feature wave. Do not begin extraction on top of an unclassified diff.

1. Inventory every modified/untracked file and assign it to the feature wave, proof artifacts, creator data, or unrelated pre-existing work.
2. Finish and commit the feature wave in reviewable behavioral slices before refactoring. Keep generated logs, screenshots, temp profiles, and creator state out of production commits unless intentionally archived.
3. Create a dedicated `codex/ayg-post-feature-refactor` branch from the accepted baseline.
4. Use one concept per commit, normally in this order: characterization test, extraction with compatibility adapter, consumer rewire, dead-code removal, documentation.
5. Do not mix renames with semantic edits. Move first with behavior unchanged, then improve internals in a later commit.
6. Keep every commit green at its declared gate and include the exact test/proof receipt in its message or checkpoint.
7. Never squash away the accepted baseline or the intermediate compatibility adapters until creator acceptance; they are rollback points.

## Migration and rollback policy

This plan expects no durable-state migration. If extraction reveals that a schema change is genuinely necessary:

1. Stop the refactor and propose the schema change separately.
2. Add a pure, idempotent migration with old-state fixtures before changing writers.
3. Preserve unknown fields and reject runtime identity.
4. Prove old -> new -> normalize again is stable.
5. Back up creator state and provide an explicit downgrade/restore path before a live run.

For ordinary extraction failures, rollback is code-only: revert the smallest phase commit and reopen the same state. Never “repair” creator state to hide a refactor defect.

## Final acceptance

The post-feature refactor is accepted only when:

- Creator-visible behavior matches the accepted pre-refactor baseline.
- The dated entry is a small surface/composition root with no feature business logic.
- Dependency direction is host transport -> services -> controllers -> views/surfaces, with the store/model injected rather than imported opportunistically.
- Workspace is demonstrably the sole durable writer.
- Runtime ownership and helper-demand state are directly observable without exposing sensitive native identity.
- Every extracted seam has behavioral tests against the production implementation, not a test-only reimplementation.
- Full unit/integration tests, native non-input proofs, exclusive physical-input proofs, cleanup receipts, and creator eye checks pass.
- `ARCHITECTURE.md` and the live module tree agree.
