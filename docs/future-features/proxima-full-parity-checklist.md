# Proxima Backpack — Full-Parity Implementation Checklist

**Starting point:** `608bcdc`

**Target:** the old Proxima cockpit interaction model, backed by a cleaner Proxima-owned record database and fully operable by semantic agent actions.

**KeToan is permanently excluded.**

The current repo already has the right beginnings for programmability: `src/app/actionProtocol.ts` defines versioned typed actions/results, request IDs, accepted/rejected events and machine-readable errors. It currently supports only project selection, surface selection, month shifting and fixture reset. The inspection contract is likewise machine-readable, but currently represents only the simplified board/calendar world and reports no real pending mutations.

The existing mutation coordinator already provides checked create/update/move/delete outcomes and structured conflict/refusal results, while the durable recovery store records prepared/committed/recovery-required/recovered/blocked states and reconciles uncertain operations without guessing.

That machinery is reused. **The Markdown-specific semantic writers are legacy-import compatibility code, not the future record database API.**

---

# Global completion rules

These apply to **every stage**.

- The Backpack remains disposable. No feature depends on preserving today's renderer structure or migrating old cockpit/view state.
- Durable **domain data** and disposable **cockpit state** remain explicitly separate.
- Tasks, projects, events, schemas, workflow definitions and relations use the Proxima-owned record store once cutover occurs.
- Notes, drawings and attachments remain ordinary vault files.
- Legacy task/project/event Markdown remains readable for import and historical compatibility but is never silently treated as canonical after cutover.
- No feature reintroduces Markdown syntax, paths, filenames, wikilinks or Obsidian APIs into `src/domain`.
- KeToan does not return through Tools, templates, schema work or generic "future utility" abstractions.
- H4 remains unclaimed. Do **not** add a Papers transaction capability merely because one might be useful someday.
- No gate may require the creator to click something and report the result. This requirement already exists in the repository's engineering ledger: post-enrollment acceptance must be programmatic and machine-readable.
- Every automated UI acceptance can be invoked without a human through a browser/test interaction driver.
- Every canonical mutation can be invoked without the UI through `actionProtocol`.
- Every canonical mutation returns a typed, machine-readable outcome.
- Human UI and agent calls invoke **the same semantic operation**, not parallel implementations.
- An agent is never granted direct write access to record JSON as an alternative to the semantic action protocol.
- Direct record-store modification behind Proxima's back is explicitly unsupported and not exposed as an agent capability.

## Binding agent-action invariant

For every interaction tagged **DATA WRITE** in the parity trace:

```
human gesture
      │
      ▼
typed Proxima semantic action
      │
      ├── UI caller
      └── agent caller
      │
      ▼
semantic validation
      │
      ▼
record/file mutation boundary
      │
      ▼
typed ActionResult
```

Never:

```
agent → filesystem → JSON record
```

That would create an uncoordinated second writer and destroy the very write serialization gained by moving records away from Obsidian.

A stage containing a human mutation is **not closed** until its equivalent action can be submitted programmatically and its effect confirmed through inspection.

---

# Stage 0 — Expand the automation/acceptance spine first

Do this before adding large amounts of UI.

The current action dispatcher is synchronous and typed but only understands four non-domain-writing actions. Its success result already supplies `requestId`, `changed`, `stateRevision` and snapshot; failures already have typed errors. Preserve that pattern.

## Work

- [ ] Establish one public versioned action union for:
  - [ ] presentation actions;
  - [ ] local-state actions;
  - [ ] record mutations;
  - [ ] vault-artifact gestures.

- [ ] Extend the result taxonomy so mutation callers can distinguish at minimum:
  - [ ] `accepted`;
  - [ ] validation refusal;
  - [ ] not found;
  - [ ] stale observed revision;
  - [ ] semantic conflict;
  - [ ] unavailable action;
  - [ ] recovery required / ambiguous commit;
  - [ ] storage failure.

- [ ] Preserve a unique request ID through dispatcher → semantic operation → mutation journal → result/event.
- [ ] Include affected logical record IDs in mutation results.
- [ ] Include resulting record revision(s) where a record changed.
- [ ] Define bulk-action results per entity so partial success can never be mistaken for complete success.
- [ ] Make the inspection contract expose:
  - [ ] current surface and submode;
  - [ ] local cockpit state needed for test assertions;
  - [ ] record revisions;
  - [ ] pending operations;
  - [ ] latest action/mutation event sequence;
  - [ ] settled/busy state.

- [ ] Replace the current permanently empty `pendingOperations: []` implementation with actual state once asynchronous mutation exists.
- [ ] Provide a programmatic browser interaction harness capable of:
  - [ ] click;
  - [ ] pointer down/move/up;
  - [ ] drag/drop;
  - [ ] resize gestures;
  - [ ] Shift modifier;
  - [ ] keyboard entry;
  - [ ] Escape;
  - [ ] context-menu invocation;
  - [ ] hover.

- [ ] Give important interactive geometry stable machine keys independent of visual text.
- [ ] Tests can assert provisional drag/resize state **before** pointer release.

## Acceptance

- [ ] An action submitted through the UI and the equivalent action submitted through the agent/programmatic entry point produce the same semantic operation/result shape.
- [ ] Invalid action input performs zero durable writes.
- [ ] Unknown action type returns a typed refusal.
- [ ] Every action result can be runtime-validated at the boundary.
- [ ] Test code can perform a real drag sequence without creator input and inspect the intermediate state.
- [ ] Test code can wait for `settled` rather than relying on sleeps.
- [ ] No test requires visual inspection by the creator.

## Evidence

- Action parser/guard tests.
- UI-versus-agent equivalence tests.
- Programmatic pointer/keyboard harness tests.
- Machine-readable inspection snapshot fixtures.
- A test proving malformed agent requests never reach mutation storage.

### HARD GATE 0

**Stages 1–6 may begin only when programmatic UI acceptance exists.**

Otherwise the project will accumulate "looks right when I click it" behavior that cannot be closed autonomously later.

---

# Stage 1 — Restore the cockpit shell and navigation

Presentation/local state only. No storage migration dependency.

## Work

- [ ] Replace the simplified Board / Calendar / Canvas-only navigation with the Proxima cockpit hierarchy:
  - [ ] Tasks;
  - [ ] Schedule;
  - [ ] Projects Hub;
  - [ ] retain Canvas as a Backpack capability without displacing old Proxima surfaces.

- [ ] Tasks contains:
  - [ ] Elastic Boards;
  - [ ] Timekeeping.

- [ ] Schedule exposes:
  - [ ] Day;
  - [ ] 4-Day;
  - [ ] Week;
  - [ ] Month;
  - [ ] Year;
  - [ ] Agenda.

- [ ] Projects Hub opens project workspaces.
- [ ] Project workspace exposes appropriate tabs from one project rather than treating selection as only a global filter.
- [ ] Project selection remains view state.
- [ ] Current surface/subsurface remains local cockpit state.
- [ ] No migration framework is created for this state.
- [ ] Resetting/rebuilding the Backpack may discard it without affecting records.

## Local/presentation actions

- `surface.select`
- `tasks.mode.select`
- `schedule.mode.select`
- `project.select`
- `project.workspace-tab.select`
- `calendar.navigate`
- `calendar.today`

These do not need to mutate durable records.

## Acceptance

- [ ] Every old top-level destination is programmatically reachable.
- [ ] Project selection does not alter any record JSON/source data.
- [ ] Reload/reset of local cockpit state leaves canonical records byte-identical.
- [ ] Inspection identifies exactly which surface/subsurface/project/tab is active.

## Evidence

- Navigation contract tests.
- Headless browser tests for every navigation target.
- Before/after durable-store hash proving navigation does not write records.

---

# Stage 2 — Elastic presentation and local execution session

No record writes yet.

The current domain already contains weights, fixed/max duration and Elastic concepts, but its execution-column membership is derived through status definitions. Do not deepen that coupling; the structural replacement happens before import.

## Work

### Board rendering

- [ ] Restore Backlog / Running / Finished appearance.
- [ ] Restore proportional Running-card height.
- [ ] Restore task-property pills/chips.
- [ ] Restore hover affordances.
- [ ] Restore clickable task cards opening a modal.
- [ ] Render read-only task values in that modal even before Save is enabled.

### Execution planning

- [ ] Restore editable execution target date/time.
- [ ] Restore default future execution horizon behavior matching old Proxima.
- [ ] Recalculate Running allocations immediately as the target changes.
- [ ] Restore Lock.
- [ ] Restore Unlock.
- [ ] Restore live elapsed-progress visualization.
- [ ] Restore per-task allocation/progress during a locked run.
- [ ] Lock information is **LOCAL STATE**, not task data.
- [ ] No task JSON/legacy Markdown is touched when:
  - [ ] target time changes;
  - [ ] run locks;
  - [ ] time advances;
  - [ ] run unlocks.

### Drag feel without committing data yet

- [ ] Implement card pickup.
- [ ] Correctly sized insertion placeholder.
- [ ] Placeholder moves during drag.
- [ ] Destination-column highlight/feedback.
- [ ] Invalid/outside drop restores visual source state.
- [ ] During this stage successful state-changing drop remains disabled/refused with a typed "mutation unavailable before record-store cutover" result rather than silently pretending to save.

## Local-state actions

- `elastic.target.set`
- `elastic.lock`
- `elastic.unlock`
- optional `elastic.session.reset`

## Acceptance

- [ ] Changing target changes card allocation deterministically.
- [ ] Lock survives ordinary rerender within the same Backpack session if local persistence is intended.
- [ ] Destroying local state does not alter any domain record.
- [ ] Locked run advances under injected clock.
- [ ] Programmatic drag shows placeholder before release.
- [ ] Pre-storage DATA WRITE drop refuses visibly rather than updating only the DOM.

## Evidence

- Deterministic clock tests.
- Elastic geometry tests.
- Programmatic drag mid-state assertions.
- Record-source before/after hashes proving zero durable writes.

---

# Stage 3 — Restore Timekeeping presentation

No storage migration dependency.

## Work

### Composition controls

- [ ] Calendar panel toggle.
- [ ] Timeline/Gantt panel toggle.
- [ ] Countdowns panel toggle.
- [ ] Multiple panels can be visible simultaneously.
- [ ] Panel sizing/layout is local state only.

### Deadline Calendar

- [ ] Month navigation.
- [ ] Current-day styling.
- [ ] Deadline task placement.
- [ ] Overdue/urgency styling.
- [ ] Click task → task modal.
- [ ] Do not invent empty-day task creation if the old deadline surface did not have it.

### Timeline/Gantt

- [ ] Render task range from effective start to deadline.
- [ ] Render row structure.
- [ ] Hover/edge affordances.
- [ ] Normal pointer drag previews a bar move.
- [ ] Shift-modified edge manipulation previews resize.
- [ ] Start-edge and end-edge geometry are distinct.
- [ ] Proposed date values visible during interaction.
- [ ] Occupied row resolution matches the old continuous behavior rather than producing unnecessary modal errors.
- [ ] No canonical write yet; final drop is typed unavailable until cutover.

### Countdowns

- [ ] Overdue.
- [ ] under one day.
- [ ] under three days.
- [ ] under one week.
- [ ] later.
- [ ] Live countdown progression.
- [ ] Automatic movement between buckets as injected clock advances.
- [ ] Click countdown item → task editor.

## Local/presentation actions

- `timekeeping.panel.set-visible`
- `timekeeping.panel.resize` if panel geometry is remembered.
- `timekeeping.timeline.viewport.set` if required for agent steering.

## Acceptance

- [ ] Same task can be observed simultaneously in Calendar/Gantt/Countdown where applicable.
- [ ] Clock-only changes never write records.
- [ ] Programmatic Shift-resize visibly changes provisional Gantt geometry.
- [ ] Invalid resize returns to authoritative geometry.
- [ ] Panel composition survives rerender only according to local-state policy.

## Evidence

- Injected-clock urgency tests.
- Calendar projection tests.
- Gantt pointer/Shift tests.
- Zero-write proof for all presentation/local-state operations.

---

# Stage 4 — Restore Schedule presentation in all six modes

No record migration dependency.

## Work

### Shared navigation

- [ ] Day.
- [ ] 4-Day.
- [ ] Week.
- [ ] Month.
- [ ] Year.
- [ ] Agenda.
- [ ] Previous.
- [ ] Today.
- [ ] Next.
- [ ] Project/event filtering without mutation.

### Day / 4-Day / Week

- [ ] 24-hour time grid.
- [ ] Correct event vertical placement.
- [ ] Correct duration height.
- [ ] Empty-cell click seeds event editor with clicked time.
- [ ] Default one-hour event proposal.
- [ ] Event click opens editor.
- [ ] Drag preview follows pointer.
- [ ] Cross-day drag preview in multi-day modes.
- [ ] 15-minute snap during drag.
- [ ] Bottom-edge resize affordance.
- [ ] 15-minute duration snapping.
- [ ] Live resize preview.
- [ ] Final save/drop remains unavailable until record-store mutation stage.

### Month

- [ ] Month grid.
- [ ] Date-level occurrence projection.
- [ ] Event click opens editor.
- [ ] No Week-style time-height resize imported into Month.

### Year

- [ ] Twelve mini-month overview.
- [ ] Date navigation/drill-down.
- [ ] Event indicators.

### Agenda

- [ ] Chronological date groups.
- [ ] Event rows.
- [ ] Event click opens editor.
- [ ] No arbitrary drag ordering.

### Recurrence projection

- [ ] Existing recurring events expand into visible occurrences.
- [ ] Expansion itself writes nothing.
- [ ] Clicking a recurring occurrence can reach the later scope-choice modal.
- [ ] No generated ordinary occurrence is prematurely materialized as a separate record merely to display it.

## Acceptance

- [ ] Same event projects correctly across all six views.
- [ ] Day/4-Day/Week use 15-minute interaction geometry.
- [ ] Month/Year/Agenda do not inherit invalid resize semantics.
- [ ] Recurrence expansion is deterministic under injected clock/date range.
- [ ] Empty-cell creation opens a form without modifying source data before Save.

## Evidence

- Six-mode projection tests.
- Automated event drag/resize preview tests.
- Recurrence-expansion tests.
- Zero-write proof before Save.

---

# Stage 5 — Restore Projects Hub and read-only project workspaces

No record migration dependency.

## Projects Hub work

- [ ] Project cards display:
  - [ ] name;
  - [ ] description;
  - [ ] age;
  - [ ] task count;
  - [ ] overdue count;
  - [ ] P1/high-priority equivalent where represented;
  - [ ] next deadline;
  - [ ] archive state;
  - [ ] visual identity where available.

- [ ] Active/archived filtering.
- [ ] Clicking a project opens its workspace.
- [ ] New Project button opens its modal even before Save is enabled.
- [ ] Archive/restore/delete controls exist but refuse DATA WRITE until storage cutover.

## Workspace work

- [ ] Notes.
- [ ] Task Board.
- [ ] Backlog.
- [ ] Deadlines.
- [ ] Schedule capability can coexist with tasks instead of being hidden behind permanent task/schedule project silos once the corrected domain lands.

### Notes — read side

- [ ] Project-linked vault artifact tree.
- [ ] Folder expand/collapse.
- [ ] File selection.
- [ ] Markdown preview.
- [ ] Canvas preview.
- [ ] Excalidraw preview where supported.
- [ ] Hover affordances.
- [ ] Context menu opens programmatically.
- [ ] Read/open/reveal-like operations remain presentation.
- [ ] Drag targets can preview valid folder destinations without committing moves yet.

### Task Board — read side

- [ ] Project workflow columns.
- [ ] Card click.
- [ ] Column presentation colors.
- [ ] Local display order.
- [ ] Drag pickup/placeholders implemented.
- [ ] Durable workflow transition still disabled until corrected domain/store exists.

### Deadlines

- [ ] Reuse the Timekeeping interaction implementation project-scoped rather than independently reinventing it.

## Acceptance

- [ ] Opening a project changes the cockpit, not canonical data.
- [ ] Project Notes can inspect ordinary vault files without treating them as database records.
- [ ] Same task can be visible in project Board, Backlog and Deadlines.
- [ ] Project can eventually show both tasks and events; no new UI work assumes `projectType` is permanent.

## Evidence

- Programmatic project navigation tests.
- File-tree read/preview fixture tests.
- Cross-tab projection tests.
- Zero-write proof for all read-only project navigation.

---

# Stage 6 — Restore Backlog/database presentation and modal completeness

Still before migration.

## Backlog

- [ ] Search.
- [ ] Tag filtering.
- [ ] Property filters.
- [ ] Type-appropriate comparison operators.
- [ ] Multiple filters.
- [ ] Remove filter.
- [ ] Sort ascending/descending.
- [ ] Sort indicator.
- [ ] Custom-property columns.
- [ ] Resizable columns.
- [ ] Row selection.
- [ ] Select all.
- [ ] Multi-selection.
- [ ] Task row/name click opens editor.
- [ ] Relation display.
- [ ] Rollup display.
- [ ] Formula display.
- [ ] Bulk Complete control visible but unavailable until write cutover.
- [ ] Bulk Delete control visible but unavailable until write cutover.

## Task modal

All existing meaningful fields must be representable:

- [ ] name;
- [ ] project;
- [ ] execution state;
- [ ] workflow stage where project-scoped;
- [ ] weight;
- [ ] fixed-duration enable/value;
- [ ] maximum duration;
- [ ] start date;
- [ ] deadline;
- [ ] completion;
- [ ] custom text property;
- [ ] number;
- [ ] select;
- [ ] multi-select;
- [ ] date;
- [ ] checkbox;
- [ ] relation;
- [ ] derived rollup;
- [ ] derived formula;
- [ ] recurrence if task recurrence remains supported.
- [ ] Cancel/Escape discards provisional form state.
- [ ] Save is disabled/refused until the new record write path exists.

## Event modal

- [ ] name.
- [ ] description.
- [ ] project.
- [ ] start.
- [ ] end.
- [ ] color if event metadata supports it.
- [ ] recurrence controls.
- [ ] until/end condition.
- [ ] exception/scope UX.
- [ ] Save/Delete unavailable until write cutover.
- [ ] Cancel/Escape loses no data.

## Project modal

- [ ] name.
- [ ] description.
- [ ] metadata that survives the corrected model.
- [ ] Do **not** require task-versus-schedule type in the successor record shape.

## Recurrence-scope modal

- [ ] This occurrence.
- [ ] Entire series.
- [ ] Cancel.
- [ ] No mutation while simply choosing/opening scope.

## Template UI

- [ ] Paste/type.
- [ ] Parse.
- [ ] Preview.
- [ ] Structured parse errors.
- [ ] Execution disabled until record write actions exist.
- [ ] Exact old textual mini-language is not assumed immutable if the same presentation/workflow can be preserved cleanly.

## Acceptance

- [ ] Every old editor can be opened programmatically.
- [ ] Every unsaved field can be changed and cancelled without durable change.
- [ ] Search/filter/sort never mutate records.
- [ ] Relation/rollup/formula projection works without wikilink semantics leaking into UI code.
- [ ] All future Save/Delete buttons currently produce a typed unavailable result rather than fake success.

## Evidence

- Modal state tests.
- Query/filter/sort tests.
- Derived-property tests.
- Automated cancel/Escape tests.
- Durable-store/source no-write evidence.

---

# HARD GATE A — Fix the future database shape before importing anything

**No record-store import may start before this closes.**

The current domain still contains structural residue from the plugin: `Project.projectType` is `'task' | 'schedule'`; a task has one generic `status`; `StatusDefinition` maps that status into an Elastic column; task ordering is a single `orderIndex`; relation schema still has a `targetFolder` field.

If those shapes are copied into JSON first, the migration will preserve precisely the database constraints the creator approved removing.

## A1 — Stable opaque identity

- [ ] Every task/project/event/schema/workflow-stage record has an opaque stable ID.
- [ ] Display name is not identity.
- [ ] Filename is not identity.
- [ ] Physical file location is not identity.
- [ ] Record lookup never derives meaning from JSON filename.
- [ ] Rename does not alter identity.
- [ ] Import policy for legacy explicit IDs is settled:
  - [ ] whether they become aliases/provenance only;
  - [ ] they must not silently defeat the opaque-ID requirement.

### Acceptance

- [ ] Change record name; ID unchanged.
- [ ] Change physical record filename if adapter permits; domain identity unchanged.
- [ ] Two records may have identical display names.

---

## A2 — Separate execution state from workflow stage

Replace the old shared status concept.

- [ ] Task has explicit execution state capable of:
  - [ ] Backlog;
  - [ ] Running;
  - [ ] Finished.

- [ ] Task independently has project workflow-stage identity.
- [ ] Workflow stage references stable stage ID, not display text.
- [ ] Moving a task into global Running does not erase project workflow stage.
- [ ] Moving a task from Review → Done-like workflow stage does not automatically change global execution state unless an explicit semantic rule is separately defined.

### Acceptance

Fixture proves a task can simultaneously be:

```
execution = Running
workflow = Review
```

and appears correctly on both surfaces.

---

## A3 — Scoped ordering

The single current `orderIndex` cannot remain the universal answer.

- [ ] Define separate ordering semantics for:
  - [ ] Elastic execution queue;
  - [ ] project workflow stage;
  - [ ] any durable user-authored ordering elsewhere.

- [ ] Workflow ordering is scoped at least by project + stage.
- [ ] Reordering Elastic cannot silently reorder the project's workflow board.
- [ ] Reordering the project board cannot silently alter Elastic order.
- [ ] Decide Gantt row placement explicitly:
  - [ ] preferred correction: treat pure row layout as LOCAL STATE;
  - [ ] if creator declares it semantic priority, give it its own scoped field.

- [ ] Even if Gantt row placement becomes LOCAL STATE, retain a typed programmatic action because the old DATA WRITE gesture must remain agent-operable.

---

## A4 — Project-type silo removed

- [ ] Project can associate with tasks and events simultaneously.
- [ ] Project UI capabilities are determined by available data/workspace configuration, not immutable `task|schedule` type.
- [ ] Existing legacy `projectType` is import metadata only if needed for faithfully reconstructing old presentation.
- [ ] No selector filters task visibility merely because a project was formerly labeled schedule.
- [ ] No selector filters event visibility merely because a project was formerly labeled task.

The current inspection and selectors still expose/project on `projectType`, so both projection and inspection contracts must change.

---

## A5 — Schema is canonical data

- [ ] Property-schema definitions are durable Proxima records.
- [ ] Schema identity is opaque/stable.
- [ ] Schema does not live in Backpack local settings.
- [ ] Select-option identity is stable and separate from label.
- [ ] Formula definitions are durable.
- [ ] Rollup definitions are durable.
- [ ] Relation definitions are durable.
- [ ] Colors/column widths/collapsed UI state remain LOCAL STATE where they are only presentation.

---

## A6 — Relations are ID-based

- [ ] Relation values contain logical record IDs.
- [ ] Relation semantics do not contain wikilinks.
- [ ] Relation semantics do not depend on target filenames.
- [ ] Relation schemas do not use `targetFolder` as the conceptual target.
- [ ] Rename/move of a human-facing record representation cannot break relation identity.
- [ ] Markdown/wikilink conversion exists only inside legacy import/export compatibility code if required.

---

## A7 — Names are independent from storage representation

- [ ] Task/project/event titles are ordinary fields.
- [ ] Any valid domain title can be represented without changing filename logic.
- [ ] Colon/YAML quoting rules disappear from canonical record validation.
- [ ] JSON encoding, not hand-authored source syntax, represents canonical structured values.

---

## A8 — Project/filesystem association is explicit

- [ ] A project can explicitly reference its Notes/drawings/attachments roots or artifacts without asserting that filesystem location *is* project identity.
- [ ] Moving a note does not mutate task/project IDs.
- [ ] One artifact being referenceable from multiple projects is not structurally forbidden by "must live inside project directory" assumptions.
- [ ] Exact external-artifact identity semantics are documented separately from Proxima record identity.

---

## A9 — Recurrence becomes explicit domain data

- [ ] Recurrence rule has a typed structure.
- [ ] Series identity is explicit.
- [ ] Occurrence identity can be addressed semantically.
- [ ] Exception identity/state is explicit.
- [ ] "this occurrence" and "entire series" actions do not depend on filenames or accidental source layout.
- [ ] A detached/special occurrence can be represented without corrupting series identity.

---

## A10 — No hidden second database

Every durable piece of information is classified as one of:

- [ ] canonical Proxima record/schema data;
- [ ] disposable Backpack-local state;
- [ ] external vault-artifact provenance/reference.

Nothing semantic is allowed to survive only in an opaque equivalent of Obsidian plugin settings.

### Evidence closing HARD GATE A

- Revised domain types.
- New domain-schema version.
- Tests covering every separation above.
- Architecture/import mapping document.
- A fixture demonstrating combined task+event project.
- A fixture demonstrating independent execution/workflow movement.
- ID-based relation test surviving title changes.
- Scoped-order independence tests.
- No canonical-domain import of filesystem, Papers or Obsidian APIs.

### What breaks if this gate is skipped

The importer would freeze old mistakes into new JSON:

- shared execution/workflow status;
- global ambiguous ordering;
- project-type silos;
- wikilink relations;
- file-shaped schema;
- path-like identity.

Correcting those afterward means migrating the newly migrated database a second time.

---

# Stage 7 — Define and implement the Proxima-owned Record Store

This stage is storage infrastructure, not user parity yet.

## Record-store contract

- [ ] One JSON file per durable record.
- [ ] Filename carries no human/domain meaning.
- [ ] Every JSON document validates against the current domain schema.
- [ ] Unknown/corrupt record files fail visibly.
- [ ] No arbitrary partial JSON patch is exposed as the semantic application API.
- [ ] Reader returns:
  - [ ] typed record;
  - [ ] opaque ID;
  - [ ] kind;
  - [ ] observed revision.

- [ ] Writer supports:
  - [ ] create-if-absent;
  - [ ] update-if-unchanged;
  - [ ] delete-if-unchanged.

- [ ] Physical move/rename of a record JSON is not required for changing any human-facing record property.

## Single-writer boundary

- [ ] Record-store write authority is explicitly distinct from creator-vault FSA write authority.
- [ ] D51 remains intact for shared creator files.
- [ ] A new record-store boundary may enable writes because the record location is Proxima-owned and not a live Obsidian source.
- [ ] The code makes it difficult to accidentally pass a creator-vault root into the record writer.
- [ ] Record-store adapter never receives arbitrary user vault paths from semantic actions.

## Crash durability

Reuse the existing mutation/recovery semantics rather than inventing another journal.

The existing coordinator records the prior bytes, intended update bytes, revisions, request IDs and durable state, then classifies uncertain operations.

- [ ] Record updates go through a coordinator with equivalent prepared → commit → committed semantics.
- [ ] Durable journal loads before record mutation authority becomes available.
- [ ] Prepared entries reconcile on restart.
- [ ] `recovery-required` entries reconcile.
- [ ] Effect-present operation classifies committed.
- [ ] Effect-absent operation classifies recovered/no-op.
- [ ] Ambiguous/corrupt state blocks rather than guesses.
- [ ] Process-death injection exists before commit.
- [ ] Process-death injection exists after file commit but before journal finalization.
- [ ] Reconciliation is idempotent.
- [ ] Agent receives machine-readable recovery-required/blocked outcome.

## Multiple Proxima callers

Even with no Obsidian co-writer, UI surfaces and agents may observe stale revisions.

- [ ] Every modifying action binds to an observed record revision where stale semantics matter.
- [ ] Two concurrent Proxima operations on the same observed revision cannot silently last-write-wins.
- [ ] Winner succeeds.
- [ ] Loser receives typed stale/conflict.
- [ ] Different records may commit independently.
- [ ] Semantic caller may explicitly refetch/retry; storage layer does not silently merge.

## Acceptance

- [ ] Create/read/update/delete record through headless APIs.
- [ ] Restart retains records.
- [ ] Corrupt JSON reports error.
- [ ] Stale update refuses.
- [ ] Two independent action callers race same revision: one winner.
- [ ] Process-kill tests classify every recovery state.
- [ ] No creator-vault file changed during record-store test suite.

## Evidence

- RecordStore adapter tests.
- Mutation coordinator conformance tests.
- Durable recovery/process-kill tests.
- Tree diff showing writes confined to the Proxima-owned store.
- Explicit test that a creator-vault path cannot be supplied as a record-store target.

---

# HARD GATE B — Physical store location must be settled before real import

The storage **format** is decided; the exact physical backing location/API is not established by `608bcdc` or the prompt.

Before importing the real database, answer:

> Where exactly do the Proxima-owned JSON files and recovery journal live such that they persist across Papers restarts, require no recurring creator gesture, are not edited by Obsidian, and remain available to Proxima's semantic action service?

Possible implementation choices should be judged against those requirements, but this checklist does **not** invent the answer.

- [ ] Backing location chosen.
- [ ] Authority restoration is programmatic after initial unavoidable enrollment, if any.
- [ ] Store survives normal Papers restart.
- [ ] Obsidian does not treat it as the live task/project/event database.
- [ ] Agent access occurs through Proxima actions, not direct backing-store access.
- [ ] Recovery journal survives wherever the record store survives.

**Do not start real migration until this closes.**

---

# Stage 8 — One-time Markdown → Record Store importer

Legacy Markdown is input only.

## Import architecture

- [ ] Importer uses the existing compatibility reader/parser rather than creating another Markdown interpretation.
- [ ] Import has a dry-run/planning phase.
- [ ] Import plan is machine-readable.
- [ ] Import assigns final opaque record IDs according to HARD GATE A.
- [ ] A durable import mapping records legacy provenance → new opaque record identity for reconciliation of relationships.
- [ ] Project references are translated to new project IDs.
- [ ] Relations are translated to record IDs.
- [ ] Legacy status is translated separately into:
  - [ ] execution state;
  - [ ] workflow stage.

- [ ] Legacy ordering is translated into the appropriate scoped orders.
- [ ] Legacy project type informs import compatibility only; it does not create a permanent silo.
- [ ] Schema/settings needed to interpret custom properties become first-class schema records.
- [ ] Legacy wikilink relations never remain canonical relation values.
- [ ] Notes/drawings/attachments are **not copied** into the record store.
- [ ] Project references to external notes/files remain references to external artifacts.
- [ ] Legacy source files are never altered.

## Import staging

Use staged activation, not a half-cut-over live database.

- [ ] Import can materialize a staging record store.
- [ ] Valid records may be converted into staging while blockers are reported.
- [ ] Staging is not canonical until activation.
- [ ] Re-running the same import is idempotent with respect to already assigned import identities.
- [ ] An interrupted import resumes/replans without producing duplicate canonical records.
- [ ] No hidden "some records now JSON, some still Markdown" live mode is allowed unless explicitly designed and tested.

## Duplicate legacy IDs

Do **not** silently choose one source file.

- [ ] Every physical legacy record involved in an ID collision is identified separately.
- [ ] Each decodable physical record can receive its own candidate opaque ID in staging.
- [ ] The duplicate legacy alias is recorded as a collision.
- [ ] Any legacy relation/project reference that resolves through that duplicate alias remains explicitly unresolved/ambiguous.
- [ ] No arbitrary filesystem/index order picks the target.
- [ ] Canonical activation cannot claim the migration is clean while ambiguous references remain unacknowledged.
- [ ] A machine-callable import-resolution operation exists if ambiguous identities require explicit mapping.
- [ ] Resolution decisions are included in the import evidence.

## Malformed records

- [ ] Parse/validation-blocking malformed record produces a structured import failure containing:
  - [ ] source path/reference;
  - [ ] record kind if known;
  - [ ] problem code;
  - [ ] bounded diagnostic.

- [ ] No JSON record is created from guessed fields.
- [ ] Original malformed Markdown remains byte-identical.
- [ ] Other valid records may be prepared in staging.
- [ ] Canonical activation does not silently omit malformed records as though import were complete.
- [ ] A machine-readable unresolved-record count remains nonzero until deliberately resolved/skipped according to an explicit migration policy.

## Unsupported-frontmatter open question

The repository currently has a real unresolved semantic mismatch: repository loading can accept `unsupported-frontmatter` as a warning, while refresh treats that same code as blocking. The docs correctly preserve this as an open question. Do **not** invent an import rule for it.

- [ ] Before final migration activation, answer:

> Is an otherwise readable record containing `unsupported-frontmatter` importable using the interpreted fields with legacy source preserved as provenance, or must import block until the unsupported construct is resolved?

- [ ] Until answered, importer reports it distinctly from an ordinary malformed record.
- [ ] Tests encode the decided rule only after the decision exists.

## Byte-preservation proof

- [ ] Hash every legacy Markdown record before import.
- [ ] Run import.
- [ ] Hash every legacy Markdown record afterward.
- [ ] Every hash matches.
- [ ] Notes/drawings/attachments also remain untouched by the importer.
- [ ] No source "promotion" or ID injection is performed into legacy files.

## Import verification

Machine-check the legacy interpreted state against new-state semantics:

- [ ] same count of valid physical task records accounted for;
- [ ] same count of valid projects accounted for;
- [ ] same count of valid events accounted for;
- [ ] every imported source has explicit import disposition;
- [ ] names preserved;
- [ ] descriptions preserved;
- [ ] dates preserved;
- [ ] task durations/weights preserved;
- [ ] project associations mapped;
- [ ] custom property values mapped;
- [ ] relations either resolved to new IDs or explicitly unresolved;
- [ ] recurrence mapped where representable;
- [ ] archived/completed state preserved;
- [ ] no legacy `projectType` silo leaks into new capability filtering;
- [ ] no record filename is derived from record title.

## Programmatic import actions

The creator must not have to perform migration by clicking through a wizard.

- `import.plan`
- `import.inspect`
- `import.resolve`
- `import.commit`
- `import.status`

These are semantic administrative actions with typed results.

## Evidence closing import

- Full import against all four existing fixture vaults.
- Dedicated duplicate-ID fixture assertions.
- Dedicated malformed-record fixture assertions.
- Legacy tree byte hashes before/after.
- Machine-readable import manifest/report.
- Restart after staged import.
- Restart after committed import.
- Idempotent rerun.
- No creator gesture.

---

# HARD GATE C — Canonical cutover

Do not enable any real record-editing UI until this gate closes.

## Work

- [ ] Startup chooses the Proxima record store as canonical tasks/projects/events/schema source after successful migration activation.
- [ ] Legacy Markdown record directories remain present but become **legacy source only**.
- [ ] Legacy Markdown task/project/event changes after cutover do not silently overwrite JSON records.
- [ ] Record-store mutations refresh every active Proxima surface.
- [ ] Read-only projection/source abstractions are generalized so UI does not care whether state originated from legacy import fixtures or record store.
- [ ] Current UI no longer labels the ordinary product as "Read-only workspace" once record mutations are enabled; at `608bcdc` that label is still hardcoded into the browser shell.
- [ ] Existing FSA creator-vault write boundary remains blocked for record files because record files are no longer creator-vault files at all.
- [ ] H4 remains untouched.

## Acceptance

- [ ] Modify a legacy task Markdown file after cutover; canonical Proxima task does not change.
- [ ] Execute semantic JSON-backed task update; every surface changes.
- [ ] Restart; JSON-backed state remains.
- [ ] Remove/rename legacy task source after cutover; canonical record remains.
- [ ] Notes continue reading from vault.
- [ ] Inspection identifies record-store source/revision rather than pretending JSON records are Markdown provenance.

## Evidence

- Cutover integration test.
- Cross-surface convergence test.
- Legacy-source-isolation test.
- Restart test.
- Machine-readable source-mode inspection.

### What breaks if writes are enabled before this gate

UI/agents could mutate JSON while some surfaces still refresh from Markdown, yielding two apparent truths and making accepted actions appear to revert.

---

# Stage 9 — Task mutation parity and Elastic direct manipulation

First full DATA WRITE surface.

## Required semantic actions

### Record editing

- `task.create`
- `task.update`
- `task.delete`
- `task.property.set`
- `task.property.clear`
- `task.relation.set` / equivalent typed relation mutation
- `task.recurrence.set`
- `task.recurrence.clear`

`task.update` must use a closed typed mutation schema, not arbitrary JSON patch paths.

### Elastic gestures

- `task.execution.move`
  - task ID;
  - target execution state;
  - optional scoped insertion target/order;
  - expected revision.

- `task.execution.reorder`
  - task ID;
  - execution scope;
  - before/after target or explicit semantic ordering intent;
  - expected revision.

## UI wiring

- [ ] New Task Save calls `task.create`.
- [ ] Card edit Save calls typed task mutation.
- [ ] Delete calls `task.delete`.
- [ ] Drag Backlog → Running calls `task.execution.move`.
- [ ] Drag Running → Finished calls same semantic family.
- [ ] In-column card reorder calls `task.execution.reorder`.
- [ ] UI uses provisional card/placeholder feedback during drag.
- [ ] UI does not update authoritative record until accepted.
- [ ] Stale refusal returns card to authoritative location and shows refusal feedback.
- [ ] Storage/recovery failure does not leave a card optimistically "saved."

## Agent parity

For every UI operation above:

- [ ] same action accepted through agent entry point;
- [ ] same validation;
- [ ] same stale behavior;
- [ ] same resulting record revision;
- [ ] same resulting inspection state.

Example required contract behavior:

```
Agent: move task T from Backlog to Running using observed revision R

Result:
- accepted + new revision, OR
- stale + actual/current revision information, OR
- typed refusal/failure
```

Never "200 OK but it didn't move."

## Acceptance

- [ ] Human-style drag and direct semantic action produce identical durable task state.
- [ ] Two agents/surfaces race same task revision: one wins, stale caller learns it lost.
- [ ] Elastic lock/progress remains local and does not increment task revision.
- [ ] Completion semantics are consistent when moving into/out of Finished.
- [ ] Reordering Elastic does not alter workflow-stage order.

## Evidence

- Semantic action tests.
- UI/agent equivalence tests.
- Stale race tests.
- Automated drag tests.
- Restart/read-back tests.
- Mutation journal request-ID attribution.

---

# Stage 10 — Project workflow Board and Backlog mutation parity

## First-class workflow schema

Because workflow stages are now semantic, distinguish their semantic definition from local presentation.

### DATA WRITE actions

- `workflow-stage.create`
- `workflow-stage.rename`
- `workflow-stage.delete`
- explicit remap/refusal semantics when deleting a stage containing tasks
- `task.workflow.move`
- `task.workflow.reorder`

### LOCAL STATE actions

- workflow column color if treated only as cockpit decoration;
- displayed column order if purely presentational;
- column width;
- collapsed state.

If stage order itself is determined to have semantic workflow meaning, move that one item into canonical schema explicitly rather than accidentally persisting UI order.

## Board UI

- [ ] Drag task between project workflow stages.
- [ ] Drag task within stage.
- [ ] Placeholder during drag.
- [ ] Destination feedback.
- [ ] Stale refusal restores authoritative state.
- [ ] Moving workflow stage does not alter Elastic execution state.

## Backlog mutation actions

- `task.bulk.complete`
- `task.bulk.delete`

Bulk contracts must identify every requested task and outcome.

- [ ] zero silent omissions;
- [ ] no "overall success" if some members failed unless result explicitly reports partial success;
- [ ] stale member behavior defined;
- [ ] retry is caller-controlled.

## Task-property edits

- [ ] All editable custom property types round-trip through semantic operations.
- [ ] Relations use IDs.
- [ ] Rollup/formula values are derived, not independently writable unless their schema says otherwise.
- [ ] Schema validation occurs before record writer call.

## Schema-management actions

Because the creator does not manually maintain wiring:

- `schema.property.create`
- `schema.property.update`
- `schema.property.delete`
- semantic option management for select/multi-select fields
- relation target-schema update
- formula-definition update
- rollup-definition update

## Acceptance

- [ ] Running + Review task remains Running after workflow drag.
- [ ] Project-board reorder leaves Elastic order unchanged.
- [ ] Search/filter/sort remain presentation only.
- [ ] Bulk complete from UI and agent produce same results.
- [ ] Bulk delete survives restart.
- [ ] Relation survives target title change.

## Evidence

- Cross-dimension status tests.
- Scoped-order tests.
- Schema-record tests.
- Bulk mutation tests.
- UI/agent parity matrix.

---

# Stage 11 — Project lifecycle parity

## Actions

- `project.create`
- `project.update`
- `project.archive`
- `project.restore`
- `project.delete`

No `projectType` mutation should survive as an ordinary successor operation unless a new separate product decision explicitly reintroduces it.

## UI

- [ ] New Project.
- [ ] Edit project fields.
- [ ] Archive.
- [ ] Restore.
- [ ] Delete.
- [ ] Project card/hub updates immediately after accepted mutation.
- [ ] Combined task/event project remains valid throughout lifecycle.

## Delete semantics

Must be explicit before implementation:

- [ ] Define whether deleting a project:
  - [ ] leaves tasks/events uncategorized;
  - [ ] requires explicit cascading action;
  - [ ] or refuses while members exist.

- [ ] Do not infer old plugin filesystem behavior as the answer.
- [ ] Whatever choice is made appears identically in UI and agent actions.

This is an **open semantic question**; source cannot answer what the creator wants after removing the old storage model.

## Acceptance

- [ ] Agent can create/archive/restore/delete without UI.
- [ ] UI buttons call the same actions.
- [ ] Project deletion has deterministic typed effect/refusal.
- [ ] Archive does not silently delete records.
- [ ] Project with both tasks and events behaves correctly.

## Evidence

- Lifecycle action tests.
- Cross-surface hub/workspace tests.
- UI/agent equivalence.
- Restart/read-back.

---

# Stage 12 — Schedule DATA WRITE parity

## Required actions

- `event.create`
- `event.update`
- `event.delete`
- `event.reschedule`
- `event.resize`

### `event.reschedule`

Typed intent must carry:

- event ID;
- proposed new start;
- proposed new end or preserved duration rule;
- expected revision.

### `event.resize`

Typed intent must carry:

- event ID;
- new end/duration;
- expected revision.

The semantic operation, not the agent, owns date validation.

## UI

### Empty cell

- [ ] Click seeds form.
- [ ] Save → `event.create`.

### Event editor

- [ ] Save → `event.update`.
- [ ] Delete → `event.delete`.

### Drag

- [ ] Actual block follows pointer provisionally.
- [ ] 15-minute snapping.
- [ ] Cross-day behavior.
- [ ] Release → `event.reschedule`.
- [ ] Stale refusal snaps back to authoritative location.

### Resize

- [ ] Bottom edge visible on hover.
- [ ] Live provisional height.
- [ ] 15-minute snap.
- [ ] Release → `event.resize`.
- [ ] Invalid duration refused before storage.

## Agent parity

An agent must be able to state:

> Move event E to 2026-09-10 14:30, retaining its current duration.

and get a typed accepted/stale/refused result without manipulating pixels.

- [ ] Agent does not need to know calendar geometry.
- [ ] UI geometry converts gesture → same semantic request.

## Acceptance

- [ ] Day/4-Day/Week drag writes correct record.
- [ ] Month/Agenda editor writes same record.
- [ ] Resized event appears consistently in every view.
- [ ] Race between UI drag and agent edit produces explicit stale loser.

## Evidence

- Semantic event tests.
- 15-minute snapping tests.
- Pointer integration tests.
- UI/agent race test.
- Restart/read-back.

---

# Stage 13 — Recurrence and occurrence-scope write parity

## Actions

- `event.recurrence.set`
- `event.recurrence.clear`
- `event.occurrence.update`
- `event.occurrence.delete` if old delete behavior requires occurrence scope
- series-scoped update/delete remains explicit rather than inferred.
- Equivalent task-recurrence actions if task recurrence is retained.

Every occurrence-level request identifies:

- series ID;
- occurrence identity/date;
- expected series revision;
- operation scope.

## UI

- [ ] Click recurring occurrence.
- [ ] Show scope modal.
- [ ] This occurrence.
- [ ] Entire series.
- [ ] Cancel.
- [ ] Save selected scope through semantic action.
- [ ] Occurrence exception reprojects immediately.
- [ ] Series update reprojects all affected future/visible occurrences.

## Agent parity

Agent never answers a hidden modal.

Its request contains the scope explicitly.

Example:

```
event.occurrence.update
seriesId = …
occurrence = …
scope = occurrence
…
```

or series action equivalent.

## Acceptance

- [ ] Occurrence-only edit does not rewrite unaffected occurrences.
- [ ] Series edit changes derived occurrences consistently.
- [ ] Stale series revision refuses occurrence update.
- [ ] UI scope selection and agent scope request produce identical state.
- [ ] No ordinary generated occurrence is incorrectly persisted merely because it was displayed.

## Evidence

- Recurrence-domain tests.
- Exception tests.
- Scope UI/action equivalence.
- Restart/read-back.

---

# Stage 14 — Timekeeping/Gantt DATA WRITE parity

## Actions

- `task.timeline.move`
- `task.timeline.resize`

`task.timeline.resize` explicitly identifies:

- task ID;
- edge = `start | end`;
- target date;
- expected revision.

`task.timeline.move` explicitly identifies:

- task ID;
- resulting date range or semantic delta;
- expected revision.

If vertical row position was reclassified as LOCAL STATE:

- `timeline.row.move` still exists programmatically but mutates only local cockpit state.

If creator later declares it semantic:

- it gets its own scoped canonical field rather than reusing workflow/Elastic order.

## UI

- [ ] Drag whole Gantt bar → semantic move.
- [ ] Shift + start edge → resize start.
- [ ] Shift + end edge → resize deadline.
- [ ] Live provisional bar geometry.
- [ ] Dates preview during manipulation.
- [ ] Invalid/inverted ranges visibly refuse.
- [ ] Stale commit restores authoritative bar.
- [ ] Collision/row handling retains old fluid interaction feel.

## Acceptance

- [ ] Agent can express exact same date mutation without pointer coordinates.
- [ ] UI and agent operations produce identical task dates.
- [ ] Gantt date changes update Countdowns and deadline Calendar immediately.
- [ ] Scoped local row movement cannot alter project workflow/Elastic ordering.

## Evidence

- Gesture-to-action tests.
- Shift-modifier tests.
- Cross-Timekeeping convergence.
- UI/agent equivalence.
- Stale refusal test.

---

# Stage 15 — Notes, drawings and attachments workspace

This is deliberately separate from the record store.

## Read parity

- [ ] File/folder tree.
- [ ] Markdown preview.
- [ ] Canvas preview.
- [ ] Excalidraw preview.
- [ ] Folder expansion.
- [ ] Selection.
- [ ] Context menu.
- [ ] Hover.
- [ ] Attached existing file navigation.

These are not blocked by record-store migration.

## Explicit file DATA WRITE actions

Every file gesture still requires an agent semantic action:

- `artifact.create-note`
- `artifact.create-folder`
- `artifact.create-canvas`
- `artifact.create-drawing`
- `artifact.rename`
- `artifact.move`
- `artifact.delete`
- `project.artifact.attach`
- detach action if the UX supports detaching without deleting.

The agent supplies logical/project-relative intent, not arbitrary unrestricted machine paths.

## UI

- [ ] Create controls call same actions.
- [ ] Drag file to folder calls `artifact.move`.
- [ ] Drag folder to folder calls same semantic family.
- [ ] Rename calls `artifact.rename`.
- [ ] Delete calls `artifact.delete`.
- [ ] Attach existing artifact calls project-association action.
- [ ] Valid destination visibly highlights.
- [ ] Invalid/self-descendant folder drops refuse.
- [ ] Failed move leaves tree at authoritative location.

---

# HARD GATE D — unresolved shared-file write question

This is the one part of the supplied storage decision that does **not** automatically follow from moving records to Proxima-owned storage.

Moving **records** eliminates the Obsidian co-writer race for task/project/event JSON.

It does **not** by itself eliminate concurrent access to **Notes/drawings/attachments**, because the decision explicitly leaves those as ordinary vault files owned by Obsidian.

At `608bcdc`, native creator-vault writes are still blocked specifically because ordinary browser FSA cannot guarantee an atomic checked commit.

Therefore the following must be answered before Stage 15's file mutations can be called safe:

> What semantics are acceptable if Obsidian edits a note while Proxima explicitly renames, moves or deletes that same ordinary vault file?

Creating a brand-new unique file and moving/deleting an existing file are not identical conflict cases.

Do not silently treat "explicit gesture" as concurrency control.

Possible resolution could be a deliberately accepted single-writer convention for those explicit operations, stronger native capability later, or narrower safe operations—but **this checklist does not invent the creator's answer.**

Until answered:

- [ ] Notes/files **read parity can close**.
- [ ] File-write actions can be implemented/tested on disposable roots.
- [ ] Native shared-vault rename/move/delete cannot be declared fully safe merely because record JSON is now private.
- [ ] H4 remains unclaimed unless creator later explicitly chooses it.

This does **not** block task/project/event parity.

---

# Stage 16 — Template execution

The old compact template syntax is less important than the resulting operation.

## Work

- [ ] Parser remains separate from executor.
- [ ] Preview produces a typed intended-operation plan.
- [ ] No mutation occurs on parse.
- [ ] Invalid template produces structured errors.
- [ ] Execution translates the plan into the same semantic actions normal UI/agents use.
- [ ] Do not give TemplateExecutor direct RecordStore write authority.
- [ ] Batch creation uses stable opaque IDs.
- [ ] Relations between simultaneously created records use those IDs.
- [ ] Project can contain both tasks and events.
- [ ] Relative dates use injected clock.

## Agent action

- `template.execute`

Result identifies:

- created project IDs;
- task IDs;
- event IDs;
- failures;
- whether operation was complete or partial.

Prefer atomic plan semantics where required; do not report full success after partial creation without explicit result representation.

## Acceptance

- [ ] Same semantic record set can be produced manually and through template execution.
- [ ] Invalid plan causes no hidden partial writes.
- [ ] Agent can execute template without opening modal.
- [ ] Restart reproduces created state.

## Evidence

- Parser fixtures.
- Plan tests.
- Execution/action equivalence tests.
- Partial-failure tests.
- Restart/read-back.

---

# Stage 17 — Full DATA WRITE action coverage audit

Before calling UX parity complete, make the interaction trace itself executable as a conformance matrix.

## Required canonical/action coverage

### Tasks

- [ ] create;
- [ ] edit every mutable ordinary field;
- [ ] delete;
- [ ] set/clear dates;
- [ ] weight/duration edits;
- [ ] execution-state move;
- [ ] execution reorder;
- [ ] workflow-stage move;
- [ ] workflow reorder;
- [ ] Gantt date move;
- [ ] Gantt start resize;
- [ ] Gantt end resize;
- [ ] custom property set/clear;
- [ ] relation edit;
- [ ] task recurrence if retained;
- [ ] bulk complete;
- [ ] bulk delete.

### Projects/workflow/schema

- [ ] project create;
- [ ] project edit;
- [ ] archive;
- [ ] restore;
- [ ] delete;
- [ ] workflow stage create;
- [ ] stage rename;
- [ ] stage delete/remap;
- [ ] property schema create/update/delete;
- [ ] schema options;
- [ ] formula/rollup/relation schema edits.

### Events

- [ ] create;
- [ ] edit;
- [ ] delete;
- [ ] reschedule;
- [ ] resize;
- [ ] recurrence set/clear;
- [ ] occurrence-specific change;
- [ ] series-specific change.

### External project artifacts

- [ ] create note;
- [ ] create folder;
- [ ] create Canvas;
- [ ] create drawing;
- [ ] rename;
- [ ] move;
- [ ] delete;
- [ ] attach existing.

Shared-vault safety qualification from HARD GATE D applies.

### Templates

- [ ] execute.

## For every row above

- [ ] typed request exists;
- [ ] runtime validation exists;
- [ ] typed success exists;
- [ ] typed stale/conflict where applicable;
- [ ] typed validation refusal exists;
- [ ] typed storage/recovery failure exists;
- [ ] request ID exists;
- [ ] affected entity IDs returned;
- [ ] state/revision observable afterward;
- [ ] event/audit record exists;
- [ ] agent invocation test exists;
- [ ] UI invocation test exists;
- [ ] equivalence test exists.

### HARD GATE E

**No DATA WRITE interaction is considered shipped if only its UI route works.**

Trigger for reopening the gate:

> A human can perform a durable operation that an agent cannot express semantically through Proxima.

That is a release-blocking defect.

---

# Stage 18 — Interaction-feel conformance pass

This is not an architecture audit. It verifies the cockpit actually behaves like old Proxima.

## Elastic

- [ ] click card opens editor;
- [ ] drag pickup;
- [ ] correctly sized placeholder;
- [ ] column feedback;
- [ ] invalid drop restoration;
- [ ] successful drop persists;
- [ ] Lock/Unlock;
- [ ] live run progression.

## Timekeeping

- [ ] Calendar/Gantt/Countdown independent toggles;
- [ ] simultaneous panels;
- [ ] live countdown buckets;
- [ ] Gantt bar follows pointer;
- [ ] Shift resize;
- [ ] accepted drop remains;
- [ ] refused drop visibly reverts.

## Schedule

- [ ] six modes;
- [ ] Today/Previous/Next;
- [ ] empty-cell event creation;
- [ ] event click;
- [ ] 15-minute drag;
- [ ] 15-minute resize;
- [ ] cross-day move;
- [ ] recurring occurrence scope.

## Projects Hub

- [ ] cards expose pressure/summary;
- [ ] clicking enters workspace;
- [ ] create/archive/restore/delete have visible feedback.

## Notes

- [ ] file/folder click;
- [ ] expand;
- [ ] context menu;
- [ ] hover actions;
- [ ] drag destination;
- [ ] move/rename/create/delete feedback as far as HARD GATE D permits.

## Task Board

- [ ] custom workflow columns;
- [ ] card click;
- [ ] card drag;
- [ ] placeholder;
- [ ] workflow transition independent of Elastic execution state.

## Backlog

- [ ] search;
- [ ] filters;
- [ ] sort;
- [ ] resizable columns;
- [ ] selection;
- [ ] select-all;
- [ ] bulk actions;
- [ ] relation/rollup/formula display.

## Modals

- [ ] every meaningful field accessible;
- [ ] Save;
- [ ] Cancel;
- [ ] Escape;
- [ ] Delete;
- [ ] recurrence scope;
- [ ] invalid form refusal;
- [ ] stale-save refusal.

## Feedback

- [ ] provisional UI never masquerades as committed state;
- [ ] accepted action visibly settles;
- [ ] stale/refused action visibly restores authoritative state;
- [ ] operation failures are not swallowed;
- [ ] no gesture depends on opening raw JSON/Markdown to finish the operation.

## Evidence

- Automated interaction recording/report covering every trace row.
- Every expected DOM/state transition machine-asserted.
- No "creator visually confirmed" evidence.
- Full action/inspection trace retained for the run.

---

# Stage 19 — Cross-surface and agent convergence

The cockpit must behave as one system, not a collection of independently updated surfaces.

## Work

- [ ] Task changed on Elastic updates:
  - [ ] Backlog;
  - [ ] project Task Board;
  - [ ] Timekeeping;
  - [ ] task modal;
  - [ ] project metrics.

- [ ] Deadline changed in Gantt updates:
  - [ ] Countdowns;
  - [ ] deadline Calendar;
  - [ ] task modal;
  - [ ] project Hub next-deadline metric.

- [ ] Event changed in Week updates:
  - [ ] Day;
  - [ ] 4-Day;
  - [ ] Month;
  - [ ] Year;
  - [ ] Agenda.

- [ ] Project archive updates navigator/Hub/workspace everywhere.
- [ ] Relation/schema changes reproject Backlog without restart.
- [ ] Agent write appears on human cockpit without a manual Refresh click.
- [ ] Human cockpit write becomes visible to agent inspection without manual refresh.
- [ ] Multiple independent Proxima surfaces converge to the same record revision.
- [ ] Each surface may keep independent local view state.

Current action dispatch already has state revisions and source-replacement semantics; preserve that concept while moving canonical state to the record store.

## Acceptance

- [ ] Agent modifies task while Board and Backlog are open; both converge.
- [ ] UI and agent race one record; stale loser explicit.
- [ ] Separate records update independently.
- [ ] Local surface selections do not bleed into canonical storage.
- [ ] No manual source-refresh control is required for normal record-store coherence.

## Evidence

- Multi-surface integration tests.
- UI+agent concurrent-operation tests.
- Revision convergence report.
- Local-state isolation report.

---

# Stage 20 — Remove transitional read-only scaffolding from the product surface

Only after parity writes are genuinely working.

At `608bcdc`, the visible page still contains fixture/FSA acceptance controls, build evidence panels and a `"Read-only workspace"` identity. These are useful engineering surfaces but are not the final old-Proxima cockpit.

## Work

- [ ] Ordinary user surface no longer leads with acceptance-probe chrome.
- [ ] Engineering diagnostics remain programmatically available.
- [ ] FSA disposable-probe controls are not confused with ordinary record ownership.
- [ ] "Read-only workspace" disappears from normal record-backed operation.
- [ ] Build/source/recovery health remains inspectable without dominating the cockpit.
- [ ] Canvas remains available as the Backpack capability already ahead of the old plugin.
- [ ] Legacy import controls disappear/retire after successful migration if they are no longer needed operationally.
- [ ] No migration ceremony becomes permanent UX.

## Acceptance

- [ ] Starting ordinary Proxima shows the cockpit, not the audit harness.
- [ ] Agents can still inspect build/source/recovery state.
- [ ] Removing user-visible diagnostics does not remove machine-readable diagnostics.
- [ ] Rebuilding/discarding the Backpack does not threaten record data.

## Evidence

- Browser acceptance.
- Inspection contract test.
- Restart/rebuild test against existing record store.

---

# Final release gate — "Feels like Proxima and agents can do everything"

Full parity is closed only when all of the following are true.

- [ ] Elastic is again an active execution cockpit rather than a read-only projection.
- [ ] Timekeeping again provides Calendar + Gantt + Countdowns.
- [ ] Schedule again provides all six modes and direct event manipulation.
- [ ] Projects are workspaces, not just filters.
- [ ] Notes remain ordinary vault artifacts.
- [ ] Task Board and Elastic no longer fight over one status field.
- [ ] Backlog behaves as a database view.
- [ ] Recurrence has occurrence/series semantics.
- [ ] Every human DATA WRITE gesture has one semantic Proxima action.
- [ ] Every such action has typed success/refusal/stale/failure.
- [ ] UI and agent paths share implementation.
- [ ] Agents never directly modify Proxima record JSON.
- [ ] Legacy Markdown record files remain untouched after migration.
- [ ] Changing legacy record Markdown after cutover cannot silently change canonical state.
- [ ] Record filenames carry no semantic meaning.
- [ ] IDs survive names/storage changes.
- [ ] Relations survive renames.
- [ ] Schema survives disposal/rebuilding of the Backpack.
- [ ] Project may contain both tasks and events.
- [ ] Scoped ordering no longer cross-contaminates surfaces.
- [ ] Crash during record mutation has deterministic restart classification.
- [ ] Multiple Proxima callers cannot silently last-write-wins a stale record.
- [ ] No Papers change is claimed.
- [ ] H4 remains unclaimed.
- [ ] KeToan remains out.
- [ ] No acceptance row requires creator manual interaction.

---

# Open questions that must remain open

These should not be silently "resolved" by whoever implements the checklist.

### Unsupported frontmatter during import

> Is `unsupported-frontmatter` importable when the compatibility reader produced a usable record, or is it an import blocker?

This must be answered before real migration activation.

### Physical Proxima-owned store location

> What concrete backing store/location satisfies one-JSON-file-per-record, restart durability, no recurring owner click, no Obsidian co-writer and agent access only through Proxima?

Must close before real import.

### Project deletion semantics

> When a project containing tasks/events is deleted, are members retained and unassigned, is cascade explicitly available, or must deletion refuse until empty?

Must close before project-delete parity.

### Gantt row order

> Is vertical Gantt row arrangement meaningful durable priority, or merely cockpit layout?

The old plugin persisted it, but that alone is not evidence that it belongs in the database. Either answer is supportable; do not reuse generic task order.

### External vault-artifact identity

> For project Notes/drawings/attachments that remain ordinary files, what exactly identifies an association across a rename performed outside Proxima?

Do not claim stronger identity than the filesystem integration can actually provide.

### Shared Notes-file mutation concurrency

> If Obsidian edits an ordinary note while Proxima explicitly renames/moves/deletes it, what behavior is acceptable?

Moving record data into private JSON does not answer this separate ordinary-file race. Read parity is unaffected; native shared-file mutation parity cannot be called closed until this is settled.

---

The most important sequencing rule is:

**Restore presentation first → correct the domain before import → build the private store → import once → cut over → enable semantic writes surface by surface.**

And the most important architectural rule is:

**The agent never becomes another storage writer. It becomes another caller of Proxima.**
