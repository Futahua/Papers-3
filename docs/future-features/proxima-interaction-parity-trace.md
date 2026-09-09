# Proxima interaction parity trace

The complete click-by-click specification of the original Proxima Obsidian plugin, as
the definition of what "feels exactly like Proxima" means for Proxima Backpack.

Traced from `Futahua/Proxima-Obsidian` at `c1af9cb0f58cdff9c46ffd10b769bf40bd456d80`,
compared against `Futahua/proxima-backpack` at `608bcdc`.

The creator's direction this records:

- The Backpack should feel exactly like Proxima, without the caveats.
- It is not meant to be permanent. A backpack is a cockpit you can throw away and
  rebuild; the data is what persists.
- Obsidian, Markdown and the plugin architecture the old host dictated are conveniences,
  not commitments. What matters is how it is presented.
- The long-term goal is agentic: agents edit the files, Proxima is the cockpit. None of
  that is possible while the creator cannot yet click through things the way the plugin
  allowed.

KeToan is out of scope per `docs/AUDIT-CHECKLIST.md` and is excluded throughout.

This is the trace, not the checklist. It defines the target; it does not sequence
the work.

---

KeToan is excluded completely below.

The useful way to read the old plugin is: **the presentation is the specification; the Obsidian implementation underneath it is not.** Where the plugin used Obsidian settings, paths, Markdown or workspace APIs to make that presentation happen, those mechanisms are replaceable.

Tags:

- **(a) PRESENTATION** — no durable Proxima-data mutation. Can exist under today's creator-vault boundary.
- **(b) LOCAL STATE** — state belonging to this disposable cockpit/session. The plugin may have persisted it through Obsidian settings, but it is not canonical project/task/event truth.
- **(c) DATA WRITE** — changes durable Proxima information: tasks, projects, events, file membership/content, dates, statuses, recurrence, etc.

Opening an editor is generally **(a)**; pressing Save inside it is **(c)**.

---

# 1. Global shell

The old plugin does not feel like separate little utilities. It feels like one cockpit with a stable top-level navigation and project context.

Source: `src/ui/App.svelte`, `src/ui/views/TasksView.svelte`, `src/ui/views/ScheduleView.svelte`.

### Main surface navigation

**Tasks tab — (a) PRESENTATION.** Clicking it replaces the center of the cockpit with task work. The current data is unchanged. Inside Tasks, the creator chooses between Elastic Boards and Timekeeping.

**Schedule tab — (a).** Switches to calendar/schedule work.

**Projects Hub — (a).** Switches to the portfolio/project workspace.

The old Tools branch is intentionally omitted from this specification.

The active top-level tab has the selected visual state; changing it immediately swaps the work surface. There is no concept that choosing a surface is domain data.

### Project context

Where the task/schedule surfaces expose a project selector:

**Selecting a project — (a).** Changes which records are shown. It does not change those records.

**Selecting all/global/uncategorized context — (a).** Same rule: it is a query/view choice.

That distinction matters for the Backpack: **project selection must not become a stored property mutation just because the old plugin happened to use a Svelte/Obsidian store to remember UI context.**

---

# 2. Tasks → Elastic Boards

Source: `src/ui/views/ElasticView.svelte`; task editing flows into `src/modals/Modals.ts`; underlying persistence in `src/data/FileManager.ts`.

This is where the difference between the current Backpack and old Proxima is most obvious.

The old Elastic surface is an **execution controller**, not merely three proportional columns.

## Header / execution controls

### Elastic / Timekeeping switch

**Elastic Boards — (a).** Selects this surface.

**Timekeeping — (a).** Leaves Elastic and opens the deadline cockpit.

The selected option receives the active state.

### Execution deadline/date-time

The Elastic header contains the target time that the currently running work is being fitted into.

**Click/focus date-time control — (b) LOCAL STATE.** Edit the execution horizon.

**Type/change the date or time — (b).** The planned sizes/durations of Running cards recalculate against the new available time.

The default horizon is approximately four hours ahead when a new unlocked run is being configured. This isn't the task's canonical deadline. It is **the current execution session's deadline**. `src/ui/views/ElasticView.svelte`.

That means the Backpack should not write this back into task Markdown or reinterpret it as a task `deadline`.

### Lock / Unlock

**Lock — (b).** Freezes the execution plan.

Once locked, Proxima records the lock instant, target deadline and per-running-task progress allocation. The board stops behaving like an unconstrained planning preview and starts behaving like a live run.

**Unlock — (b).** Leaves the live locked run and returns to editable planning.

The plugin persisted this through its settings. That does **not** make it canonical task data.

While locked, the important visual feedback is temporal: the creator sees the schedule being consumed rather than simply seeing static weighted heights. `src/ui/views/ElasticView.svelte`.

This is one of the strongest examples of something that can be rebuilt **today**, before creator-vault writes are solved.

## Columns

The visible columns are:

- Backlog
- Running
- Finished

Their headers are mostly informational rather than editors.

The Running column is special: card height represents allocated execution time according to available time and task weight. That sizing is **(a)** presentation derived from records + **(b)** current execution-plan state.

### New task

**New Task / add task control — opening is (a); committing is (c).**

The user presses the add control, receives a task-creation modal, fills it in, and saves. Once creation succeeds, the new card enters the appropriate board column.

Cancel leaves the board untouched.

Source: `src/ui/views/ElasticView.svelte`, `src/modals/Modals.ts`.

## Task cards

### Click card

**Clicking the body of a task card — (a).**

It opens the task quick editor for that task.

The click itself is navigation into an editor; no data changes until Save/Delete/etc.

### Hover

Cards expose their interactive nature on hover. Actions that would otherwise visually compete with the card are revealed/emphasized, and draggable cards gain the drag affordance.

This is **(a)**.

### Delete affordance

**Press delete on a task — (c).**

The task is actually removed from canonical task storage. After success the card disappears.

If deletion is cancelled/refused, the card remains.

### Drag card vertically within a column

**Drag/reorder — (c).**

This is not merely visual sorting. The old plugin persists task ordering.

The tactile behavior is important:

- pickup visually detaches the selected card;
- the board inserts a placeholder representing where the card will land;
- the placeholder carries the correct card geometry rather than being a tiny generic line;
- moving the pointer through the list moves that insertion point;
- dropping commits the new order;
- the resulting board stays in that order.

If the drag ends without a valid destination, no canonical change is made and the placeholder disappears; the source data simply renders the card back in its prior position.

`src/ui/views/ElasticView.svelte`.

### Drag card across columns

**Drop into Backlog/Running/Finished — (c).**

The user's meaning is direct:

> this task is now backlog/running/finished.

The old plugin expresses that by changing the task status and related completion state.

Mid-drag, the destination column provides the insertion target/placeholder.

After a successful drop, the card visually moves and remains there because the underlying record was updated.

Dropping outside an accepted list does not manufacture a new state; it returns to the source-rendered position.

### Card fields/pills

Configured properties shown as chips/pills are **(a)** when merely displayed.

If a property is clickable only to open the task editor, the click remains **(a)**. Editing the actual property in the modal is **(c)**.

### Running-card temporal state

When unlocked:

- card size is a proposed allocation;
- changing target time changes allocations.

When locked:

- the execution allocation becomes the active run;
- elapsed time/progress changes what the card communicates as the run advances.

All of the passage-of-time rendering is **(a)**; the saved lock/run session is **(b)**.

No task record has to be rewritten every second to reproduce this feel.

---

# 3. Tasks → Timekeeping

Sources: `src/ui/views/TasksView.svelte`, `src/ui/views/components/ProjectDeadlines.svelte`, `src/ui/views/DeadlinesView.svelte`.

Timekeeping is a composite cockpit. Calendar, Timeline/Gantt and Countdowns are independently useful and can coexist.

## Surface toggles

### Calendar toggle

**(a) PRESENTATION.**

Shows/hides the deadline calendar.

Active/inactive visual state communicates whether the panel participates in the workspace.

### Timeline/Gantt toggle

**(a).**

Shows/hides the horizontal task timeline.

### Countdowns toggle

**(a).**

Shows/hides urgency buckets.

The useful parity point is that these are **not mutually exclusive tabs**. The creator can compose the Timekeeping workspace from several simultaneous representations.

## Panel sizing/layout

Where the panels are resized/rebalanced:

**Dragging a panel divider / changing presentation width — (a)** if kept only for this live surface, or **(b)** if the Backpack elects to remember the layout across reopening.

Its product meaning is never canonical task data.

Likewise horizontal scroll/viewport positioning and timeline zoom are presentation/local cockpit state, never a task mutation.

---

# 4. Timekeeping → Deadline Calendar

Source: `src/ui/views/components/ProjectDeadlines.svelte`.

This is a **task deadline calendar**, distinct from Schedule's event calendar.

### Month navigation

**Previous month — (a).**

**Next month — (a).**

**Return to current period/Today where exposed — (a).**

The header/date label changes and the same tasks are projected against a different month.

### Day cells

Day cells are presentation containers.

**Clicking ordinary empty calendar space does not create a task deadline in this old deadline component.**

This corrects the easy assumption that it behaves like the Schedule time grid.

### Deadline task/card

**Click a task shown on its deadline — (a).**

Opens that task's quick editor.

The deadline calendar itself is not the confirmed drag-to-reschedule mechanism in this source. The code contains drag-related deadline machinery elsewhere, but the rendered deadline-calendar interaction at this SHA should be treated as click/edit, not as calendar drag parity.

### Overdue/current styling

Current day, overdue tasks and different urgency states are **(a)**.

Their state changes as time passes or canonical deadlines change.

There is no data mutation merely because a task crosses midnight and becomes overdue.

---

# 5. Timekeeping → Gantt / Timeline

Source: `src/ui/views/components/ProjectDeadlines.svelte`.

This is one of the old plugin's most interaction-dense surfaces.

Each task becomes a horizontal bar spanning its effective start through its deadline.

## Click bar

**(a).**

Clicking without performing a drag opens/enters task editing.

## Move a bar horizontally

**(c) DATA WRITE.**

Normal bar dragging changes the task's date placement.

The important UX:

- pointer down picks up the bar;
- the actual bar follows the gesture rather than waiting for drop;
- motion is converted into the timeline's date increment;
- the displayed dates/geometry update provisionally;
- releasing commits the corresponding date change;
- successful persistence leaves the bar where it was dropped.

This is not a view-only reorder if the horizontal location changes the task's dates.

## Move a bar vertically

**(c).**

Dragging into another row changes task ordering/row placement.

The timeline attempts to maintain a valid non-colliding row arrangement.

A particularly important old-Proxima behavior is that an occupied target need not produce a hard "invalid drop." The layout can advance the task into the next available row. The creator gets a continuous manipulation rather than an error dialog.

That collision/layout feedback belongs to the parity specification.

## Resize with modifier

The timeline uses **Shift-modified dragging for resize behavior**. `src/ui/views/components/ProjectDeadlines.svelte`.

**Shift + manipulate the start edge — (c).**

Changes the effective start boundary.

**Shift + manipulate the deadline/end edge — (c).**

Changes the deadline boundary.

The bar changes width live while manipulating it; release commits the date.

Task timeline dates are day-scale rather than Schedule's 15-minute time-of-day grid, so this is not the same snapping model as event resizing.

### Edge hover

The relevant edge becomes visibly/cursor-wise resizable when the resize gesture is available.

**(a).**

### Invalid geometry

The timeline should not silently create a negative/inverted task span.

When an attempted result is not accepted, the durable state remains the previous one and the next render restores valid geometry. There is no separate durable "failed drag state."

---

# 6. Timekeeping → Countdowns

Source: `src/ui/views/components/ProjectDeadlines.svelte`.

Countdowns turn deadlines into urgency instead of spatial calendar positions.

The old groups include approximately:

- overdue;
- due within a day;
- due within three days;
- due within a week;
- later.

### Countdown clocks

**(a).**

They update as wall-clock time advances. Nothing is written to the task.

A task moves between urgency groups automatically as time passes.

### Click countdown task

**(a).**

Opens task quick edit.

Changing the deadline from there is **(c)**, but looking/opening is not.

### Group headers

Informational/presentation only **(a)**.

Collapsed/expanded state, if retained in a new Backpack, should be **(b)** at most—not task data.

---

# 7. Schedule: global controls

Sources: `src/ui/views/ScheduleView.svelte`, `src/ui/views/components/calendar/CalendarWeek.svelte`, `CalendarMonth.svelte`, `CalendarYear.svelte`, `CalendarAgenda.svelte`, `src/utils/recurrence.ts`.

Schedule has six modes:

**Day / 4-Day / Week / Month / Year / Agenda.**

### Mode buttons

Each mode-button click is **(a)**.

It changes the geometry and range of the same event records.

No canonical event gets rewritten because the creator wants a four-day view instead of a week.

### Previous

**(a).**

Moves the visible range backward by the mode's natural interval.

### Today

**(a).**

Returns the viewport to the current date.

### Next

**(a).**

Moves the viewport forward.

### Project selector/filter

**(a).**

Restricts which schedule project's events are shown.

---

# 8. Schedule → Day

Day is the one-day configuration of the same time-grid machinery used by the multi-day views.

Source: `src/ui/views/components/calendar/CalendarWeek.svelte`.

The screen is a 24-hour vertical axis with events positioned by time and sized by duration.

## Empty time-grid click

**Opening creation — (a); saving the resulting event — (c).**

Clicking unused time space seeds a new event at the clicked date/time rather than forcing the creator to type the timestamp from scratch.

The default event span is an hour.

The creation modal opens with that date/time already supplied.

Cancel returns to the unchanged calendar.

## Click event body

**(a).**

Opens the event editor.

## Drag event body

**(c).**

This reschedules the event.

During drag:

- the event becomes the active dragged item;
- its visual position tracks the pointer;
- vertical movement corresponds to time;
- in multi-day configurations horizontal movement also selects day;
- the original duration is preserved when moving rather than resizing;
- the preview snaps to the calendar's time increment.

The Schedule grid uses **15-minute snapping** for direct time manipulation. `CalendarWeek.svelte`.

On drop, start/end are persisted.

If a move is abandoned or doesn't produce an accepted destination, the durable event remains unchanged and the rendered block returns to that state.

## Resize event

The event exposes a duration-resize affordance at its lower edge.

**Bottom-edge drag — (c).**

The user drags the event's lower boundary, and the end time moves in **15-minute increments**.

The top/start remains fixed for this duration resize.

The event's box changes height live, making the proposed duration visible before release.

On release, the new end time is saved.

The source does not present a symmetric second top-edge duration handle that should be treated as parity.

## Hover

Event hover/emphasis and resize cursor/handle appearance are **(a)**.

The resize affordance should not need permanent chrome to be discoverable.

---

# 9. Schedule → 4-Day

Same interaction grammar as Day, now over four adjacent dates.

Source: `CalendarWeek.svelte` instantiated by `ScheduleView.svelte`.

### Empty time cell

**(a) to open / (c) to save.**

Creates an event seeded to that date/time.

### Event click

**(a).**

Edit.

### Event drag vertically

**(c).**

Change time, preserving duration.

### Event drag horizontally across day columns

**(c).**

Change date while retaining the corresponding duration/time placement.

### Bottom resize

**(c).**

Adjust duration, 15-minute increments.

### Navigation/mode switching

**(a).**

The critical feel is that a four-day window is not a mini month: it remains a full time-of-day scheduling surface.

---

# 10. Schedule → Week

Again the same direct-manipulation grid, now seven days.

All interactions above apply:

**Empty-cell creation — (a → c).**

**Event click/edit — (a → c on Save).**

**Time/day drag — (c).**

**Bottom-edge resize, 15-minute snap — (c).**

**Hover affordances — (a).**

**Previous/Today/Next — (a).**

Source: `src/ui/views/components/calendar/CalendarWeek.svelte`.

---

# 11. Schedule → Month

Source: `src/ui/views/components/calendar/CalendarMonth.svelte`.

Month changes the interaction density. Events become date-level entries rather than time-height blocks.

### Month day cells

**(a)** as presentation/navigation targets.

Where the parent supplies creation from a date selection, opening the seeded creation flow is **(a)** and Save is **(c)**.

The month surface should not inherit Week's time-grid resize affordance.

### Event chip/row

**Click event — (a).**

Opens event editing.

### Recurring occurrence

It appears like an occurrence on the relevant date rather than forcing the creator to mentally reconstruct the recurrence rule. Generating these occurrences is **(a)**.

### Time/duration drag

Do **not** import the Week grid's 15-minute resize behavior into Month. That exact interaction belongs to the timed Day/4-Day/Week surface.

---

# 12. Schedule → Year

Source: `src/ui/views/components/calendar/CalendarYear.svelte`.

Year is twelve mini-months: overview/navigation, not twelve compressed Week schedulers.

### Year navigation

**Previous/next range — (a).**

### Mini-month date targets

**Clicking a date/drilling into a more detailed date context — (a).**

The user's meaning is navigation.

### Event indicators

Presentation **(a)**.

No direct time resize belongs here.

The purpose is answering "where in the year is this?" and getting quickly to the period, not microscopic event editing.

---

# 13. Schedule → Agenda

Source: `src/ui/views/components/calendar/CalendarAgenda.svelte`.

Agenda turns events into a chronological reading list grouped by date.

### Event row

**Click — (a).**

Opens edit.

### Date group headers

**(a).**

Presentation only.

### Scrolling

**(a).**

No record mutation.

There is no drag/reorder semantic to reproduce here: chronology is derived from event dates.

---

# 14. Recurring schedule events

Sources: `src/utils/recurrence.ts`, `src/modals/Modals.ts`.

Recurrence is not merely a string printed on the event.

### Occurrence expansion

**(a).**

The calendar derives visible occurrences of daily/weekly/monthly/custom recurrence without creating a new canonical event file for every normal display occurrence.

### Click recurring occurrence

**(a).**

The user gets the important scope question before mutating the series:

- this occurrence;
- the recurring series.

### Choose "this occurrence"

The selection itself is **(a)**; committing the resulting exception/change is **(c)**.

The user's expectation is that one date can diverge without rewriting the entire recurrence rule.

### Choose "series"

Selection is **(a)**; saving edits to the recurrence/source event is **(c)**.

### Recurrence exception dates

Adding/removing a durable exception is **(c)**.

### Recurrence fields

Changing daily/weekly/monthly/custom pattern, interval, end/until conditions or relevant pattern parameters is **(c)**.

The generated display is **(a)**.

This split should survive regardless of future storage.

---

# 15. Projects Hub

Source: `src/ui/views/AgingView.svelte`, project creation/editing in `src/modals/Modals.ts`.

The Hub is not just a listbox. It is a portfolio surface with project identity and pressure visible before opening a project.

It distinguishes task and schedule projects in the old model. I return to why that distinction is probably a database defect later.

## Project-category navigation

**Task projects / Schedule projects selection — (a).**

Filters the hub.

## Project card

A card shows things such as:

- project name;
- icon/visual identity;
- description;
- age;
- task count;
- overdue count;
- P1 count;
- next deadline;
- archive state.

All of those displays are **(a)**.

### Click project card

**(a).**

Enters that project's workspace.

This is one of the most important parity clicks: a project card leads to **a place**, not merely to "filter current board by project ID."

## New project

**Press New Project — (a).**

Opens creation modal.

**Confirm creation — (c).**

The new project becomes durable and then appears in the Hub.

## Archive

**(c).**

Changes durable project state.

Feedback: card leaves the active collection/appears in archived state.

## Restore

**(c).**

Moves an archived project back into active project presentation.

## Delete

**(c).**

Durably removes the project through the plugin's project deletion flow.

Where confirmation is presented, cancelling does nothing; confirmation removes it.

## Show/view archived projects

**(a).**

Merely changes which project cards are visible.

## Hub cosmetic identity/configuration

The old plugin allows customization around Hub/ribbon presentation—title/icon and related display choices.

Those are **(b) LOCAL STATE**, not project data.

They should not be used to justify changing creator files.

---

# 16. Project workspace: global frame

Source: `src/ui/views/ProjectsView.svelte`.

Opening a task project gives:

- Notes
- Task Board
- Backlog
- Deadlines

A schedule project instead centers Notes + Schedule.

### Back to Projects Hub

**(a).**

Navigation.

### Workspace tabs

Every tab click is **(a)**.

The selected tab is cockpit state. Remembering the most recent tab may be **(b)** if desired, but it must never become canonical project content.

---

# 17. Project workspace → Notes

Sources: `src/ui/views/ProjectsView.svelte`, `src/ui/views/components/ProjectFileNode.svelte`.

This was heavily Obsidian-shaped underneath, but the **feel** is clear:

> project on the left/around me, its working files immediately available inside it.

## File tree

### Click folder row / disclosure control

**(a).**

Expands or collapses children.

Expanded/collapsed state is temporary presentation state; persisted expansion would at most be **(b)**.

### Click file row

**(a).**

Selects the file and puts its content/preview into the workspace.

The row receives selected styling.

### Markdown file

Viewing/rendering is **(a)**.

### Canvas file

Viewing is **(a)**.

### Excalidraw file

Viewing is **(a)**.

The old implementation borrowed Obsidian's rendering/plugin stack. That part is not parity; the ability to view the project artifact in-place is.

### Hover file/folder row

**(a).**

Reveals/emphasizes file controls and draggable/context-menu affordance.

## Right-click file/folder

**Opening context menu — (a).**

The plugin delegates this heavily to Obsidian's file menu.

The user-facing operations reached from it divide by meaning:

**Open/view/reveal — (a).**

**Rename — (c).**

**Move — (c).**

**Delete — (c).**

Other Obsidian-specific plugin menu items are not Proxima-parity requirements.

## Drag file

**(c).**

A project file can be picked up and moved into another folder.

During drag, the relevant folder becomes the destination; the user sees the tree as a drop surface rather than receiving a path textbox.

On a valid drop, file location changes and the tree refreshes.

On an invalid destination/non-folder/no-op destination, no durable move should occur; the source tree remains authoritative.

## Drag folder

**(c).**

Same principle, with the additional obvious requirement that a folder cannot become its own descendant.

The old Obsidian machinery may enforce some of this; the successor must preserve the direct manipulation, not the API.

## Create note

**Press create-note — (a).**

Opens/seeds creation.

**Commit new note — (c).**

A durable project artifact is created and appears in the tree.

## Create Canvas

**(c) on creation.**

The creation control/opening UI is **(a)**.

## Create Excalidraw drawing

Same split: open/select **(a)**, actual creation **(c)**.

The `.excalidraw.md`/Obsidian-specific format is not sacred.

## Create folder

**(c).**

Project file organization changes durably.

## Rename file/folder

**(c).**

The visible tree immediately reflects the new name after success.

## Delete file/folder

**(c).**

After confirmation/success it disappears.

## Attach/add existing file

The chooser itself is **(a)**.

Making that artifact part of the project is **(c)** because project membership is durable product information even if the future representation is not "move a Markdown file into this folder."

This is an important strict (b)/(c) line: **membership is not a view preference**.

## Open Native Note

Where exposed by the old plugin, this is **(a)**.

It escapes to Obsidian's native editor.

It is an Obsidian-host convenience, **not** part of the durable Proxima domain and not something the Backpack must reproduce literally.

---

# 18. Project workspace → Task Board

Source: `src/ui/views/components/ProjectTaskBoard.svelte`.

This is **not** the Elastic board.

Elastic answers:

> What am I executing now?

The project Task Board answers:

> Where is this project's work in its workflow?

The old implementation muddies those concepts by storing both through one task `status`. The presentation distinction is worth preserving; the database coupling is not.

## Column header/title

Displays workflow column name and color: **(a)**.

### Configure/rename column

The plugin's per-project board configuration lives in plugin settings.

The **column visual/config definition itself is (b) LOCAL STATE only if it is merely presentation**.

But because the old implementation makes column identity equal task `status`, there are actually two effects that must be separated in the successor:

- renaming/recoloring/reordering how the cockpit presents a stage — **(b)**;
- changing the durable workflow state of tasks to another semantic stage — **(c)**.

Do not preserve the old accidental coupling.

### Change column color

**(b).**

Pure cockpit presentation.

### Change column order

**(b)** for the order of workflow columns in this board.

It should not reorder task records.

### Add/remove configured column

As old UI configuration, **(b)**.

If a future column is declared as a first-class semantic workflow stage, its schema may instead deserve canonical domain storage—but that is a domain decision, not a reason to copy Obsidian settings.

## Task card click

**(a).**

Opens task quick edit.

## Task drag within a column

**(c).**

Changes durable task ordering in the old plugin.

Mid-drag, an insertion position appears; after drop the card remains in the new location.

## Task drag across columns

**(c).**

Changes the task's workflow state/status and its position.

Destination column provides visual feedback. Invalid/no-target drop produces no durable state transition and the card returns on rerender.

## Add task from board

Opening creation UI: **(a)**.

Save: **(c)**.

If initiated from a specific column, that column can seed the initial workflow state.

## Column/task hover

**(a).**

Shows drag/action affordances without mutating anything.

---

# 19. Project workspace → Backlog database/grid

Source: `src/ui/views/components/ProjectTaskGrid.svelte`.

This is where the old plugin feels much more like a database than the current Backpack.

## Search box

**(a).**

Typing narrows visible tasks immediately.

Search text is query state, not data.

If the Backpack decides to restore the same search after reopening, that persistence is **(b)**—still not task data.

## Tag filtering

### Click/select tag

**(a).**

Changes visible rows.

### Remove tag filter

**(a).**

Returns matching rows.

Tags themselves are durable task data only when edited on a task. Filtering by them is not.

## Property filters

The grid lets the creator choose a property, comparison/operator and value.

All query construction is **(a)**.

Examples conceptually include equals/not-equals and comparisons appropriate to the property's type.

### Add filter

**(a).**

### Change filter operator

**(a).**

### Change filter value

**(a).**

### Remove filter

**(a).**

No task file should be rewritten because a user asks a question of the database.

## Column headers

### Click sortable header

**(a).**

First click establishes sort; subsequent click can reverse direction according to that column's sorting behavior.

Sort indicator changes.

### Resize column edge

**(b)** if remembered across reopening; otherwise merely **(a)** during the live session.

The product meaning is cockpit layout.

Drag the header/column boundary; width follows the pointer. It does not mutate tasks.

## Select row

**(a).**

Row checkbox enters/leaves the current multi-selection.

Selected rows gain selected state.

## Select all

**(a).**

Changes only current selection.

## Click task name/row

**(a).**

Opens quick edit.

## Property cells

Reading displayed values is **(a)**.

Where click routes to the task editor, the click remains **(a)**; changing the value and saving is **(c)**.

## Bulk Complete

**(c).**

Applies a durable completion/status change to all selected tasks.

Feedback is structural: rows change status/disappear from the active query as appropriate.

## Bulk Delete

**(c).**

After confirmation, selected task records are deleted.

## Relation/rollup/formula cells

Displaying relation values: **(a)**.

Following a relation to inspect the related record: **(a)**.

Editing relation membership: **(c)**.

Displaying rollup: **(a)**.

Displaying formula result: **(a)**.

The derived values do not need to be rewritten every time the grid renders.

---

# 20. Project workspace → Deadlines

This is the same deadline cockpit described under Timekeeping, now naturally scoped to one project.

Source: `src/ui/views/components/ProjectDeadlines.svelte`.

The interaction classification remains:

**Calendar/Timeline/Countdown visibility — (a).**

**Viewport/panel sizing — (a)/(b), never canonical data.**

**Deadline card click — (a).**

**Countdown click — (a).**

**Gantt horizontal date movement — (c).**

**Gantt vertical ordering — (c).**

**Shift-resize start/end boundary — (c).**

**Live countdown/urgency changes — (a).**

---

# 21. Schedule-project workspace

Source: `src/ui/views/ProjectsView.svelte`, `src/ui/views/ScheduleView.svelte`.

A schedule project receives its Notes workspace and schedule view.

All Notes interactions remain as above.

All calendar interactions remain as above, but filtered/project-scoped.

Again, that "task project versus schedule project" split is old-model behavior, not necessarily something that should survive into the successor database.

---

# 22. Task creation/edit modal

Source: `src/modals/Modals.ts`, schema information in `src/types.ts`.

The exact visual layout can change, but parity means the creator can reach the same information without opening the underlying source file.

## Open

From New Task/card click/etc.:

**(a).**

The modal overlays the cockpit with current values pre-populated when editing.

## Task name/title

Typing is provisional/local form state **(a)**.

**Save — (c).**

## Project association

Changing selector while editing the form is provisional **(a)**.

Saving the new association is **(c)**.

## Status

Choose another status: provisional **(a)**.

Save: **(c)**.

## Start date

Enable/set/edit/clear in form: provisional **(a)**.

Save: **(c)**.

## Deadline

Same:

form interaction **(a)**;

commit **(c)**.

## Weight

Form interaction **(a)**.

Commit **(c)**.

This directly affects Elastic allocation after save.

## Fixed duration / maximum duration controls

Form entry/toggle: **(a)**.

Save: **(c)**.

The resulting Elastic geometry changes after the record reloads.

## Custom properties

The modal adapts to the configured property schema.

The old types include:

- text;
- number;
- select;
- multi-select;
- date;
- checkbox;
- relation;
- rollup;
- formula.

`src/types.ts`, `PROXIMA_ADVANCED_FEATURES.md`.

For editors:

**Text input — provisional (a), Save (c).**

**Number input — provisional (a), Save (c).**

**Select choice — provisional (a), Save (c).**

**Multi-select choices/chips — provisional (a), Save (c).**

**Date property — provisional (a), Save (c).**

**Checkbox property — provisional (a), Save (c).**

**Relation selection — provisional (a), Save (c).**

**Rollup value — (a)** if derived/read-only.

**Formula result — (a)** if derived/read-only.

## Task recurrence

Changing recurrence form controls is provisional **(a)**.

Saving the recurrence definition is **(c)**.

## Open underlying/native note

**(a).**

Host escape hatch, not domain mutation.

## Save

**(c).**

Modal closes after successful update and affected surfaces reflect the changed record.

## Cancel/close

**(a).**

Discard unsaved form state.

## Delete

**(c).**

Removes the task after whatever confirmation flow is invoked.

---

# 23. Event creation/edit modal

Source: `src/modals/Modals.ts`, recurrence in `src/utils/recurrence.ts`.

## Open from event click

**(a).**

Existing title/start/end/etc. populate.

## Open from empty time slot

**(a).**

The clicked date/time pre-seeds the form, typically with a one-hour span.

## Name/title

Type **(a)**; save **(c)**.

## Start date/time

Edit **(a)**; save **(c)**.

## End date/time

Edit **(a)**; save **(c)**.

## Event project/association where offered

Change in form **(a)**; save **(c)**.

## Color

Choosing a display/event color before save is **(a)**.

If color is stored as part of the event record, Save is **(c)**.

## Recurrence mode

Daily/weekly/monthly/custom selection in the form: **(a)**.

Persist recurrence: **(c)**.

## Recurrence parameters/until

Form manipulation **(a)**.

Commit **(c)**.

## Delete

**(c).**

## Open Native Note

**(a).**

Again, an Obsidian escape hatch, not a Proxima semantic requirement.

## Save

**(c).**

Calendar reprojects the updated event.

## Cancel/Escape/close

**(a).**

No record change.

---

# 24. Recurring-event scope modal

Source: `src/modals/Modals.ts`.

This is an important modal in its own right.

When an occurrence belongs to a recurring series, editing it cannot silently assume scope.

### "This occurrence"

Choosing it is **(a)**.

Committing the exception/one-off change is **(c)**.

### "Entire series"

Choosing it is **(a)**.

Saving series-level changes is **(c)**.

### Cancel

**(a).**

Nothing changes.

The successor should preserve this explicit scope choice even if recurrence no longer lives in Markdown.

---

# 25. New Project modal

Source: `src/modals/Modals.ts`.

### Open New Project

**(a).**

### Name

Input **(a)**; creation **(c)**.

### Project kind/type

The plugin requires a task-project versus schedule-project choice.

Selecting it in the form is **(a)**.

Saving that type is **(c)**.

I would reproduce that interaction only as parity scaffolding if needed; I would **not** assume the binary belongs in the successor's permanent domain. More on that below.

### Other project metadata exposed by the modal

Description/associated configuration follows the same rule:

form editing **(a)**;

Create **(c)**.

### Create

**(c).**

Project appears in the Hub.

### Cancel

**(a).**

---

# 26. Template modal

Sources: `src/modals/Modals.ts`, `src/template/TemplateParser.ts`, `src/template/TemplateExecutor.ts`, `PROXIMA_TEMPLATER_SPEC.md`.

The old Templater is a batch-construction interface.

### Open Templater

**(a).**

### Paste/type template text

**(a)** until execution.

The text describes project/schedule structure using the plugin's `@project`, `@task`, `@event` style grammar and relative dates.

### Parse/preview/validation

**(a).**

Errors at this stage should remain errors in the modal; no half-created database should result merely from parsing.

### Execute

**(c).**

The template can create multiple canonical records at once: project structure, tasks/columns or schedule events according to the parsed template.

### Relative dates

Resolving `today`, relative offsets and similar expressions during preview is **(a)**.

Persisting the resulting created records is **(c)**.

### Error feedback

Parser failure refuses execution and keeps the user in the modal.

That refusal behavior is important; the exact mini-language is not.

---

# 27. Confirmation / destructive flows

Where delete/project/file operations invoke confirmation:

**Opening confirmation — (a).**

**Cancel — (a).**

**Confirm destructive operation — (c).**

The visible result should follow the mutation:

- task disappears;
- project leaves the collection;
- event disappears;
- file vanishes from the project tree.

A refusal/failure must not optimistically pretend the object is gone permanently.

---

# 28. Add-existing-file chooser

The old implementation is deeply Obsidian-shaped, but the user gesture is separable.

### Open chooser

**(a).**

### Search/select existing artifact

**(a).**

### Confirm association

**(c).**

The project now durably includes/references that artifact.

How a future Proxima represents that association is not parity.

---

# 29. Keyboard, modifier, context-menu and hover grammar

Across the plugin, there is much less keyboard-command architecture than mouse/direct-manipulation architecture.

The interaction that is specifically product-significant is:

### Shift during Gantt manipulation

**Shift + timeline edge/bar manipulation — (c)** when it causes a date-boundary resize.

The modifier distinguishes resize semantics from normal movement.

### Escape/close modal

**(a).**

Discard current unsaved editor state.

### Text-field keyboard entry

**(a)** until the relevant form is committed.

### Enter/submit where the modal/input accepts normal form submission

Opening/typing remains **(a)**; the actual Save/Create action is **(c)**.

### Right-click project file/folder

**(a)** to reveal the context menu.

The selected menu operation then determines whether the action is **(a)** or **(c)**.

### Hover card/bar/file/event

**(a).**

Hover reveals affordance/cursor/emphasis; it must not have side effects.

I found no reason to treat the old plugin as keyboard-shortcut-driven. Its distinctive feel is overwhelmingly **click, drag, resize, inspect, edit**.

---

# 30. What "feels exactly like Proxima" therefore means

It does **not** mean "use the same CSS."

The old cockpit has a consistent grammar:

**Objects are clickable.** A task card, event, deadline item or project card opens the thing itself.

**Things that have spatial meaning can usually be grabbed.** Tasks move between workflow states, timeline bars move through time, events move through day/time space, files move through folders.

**Manipulation is previewed continuously.** The creator sees the card placeholder, moving Gantt bar, changing event geometry or active drop destination **before** the final write.

**The UI does not make the creator translate gestures into database forms unnecessarily.** "Move this to Thursday" is a drag. "Make this two hours long" is a resize. "This is Running now" is dropping it in Running.

**Forms are for attributes that are not naturally spatial.**

**Multiple representations coexist.** Calendar/Gantt/Countdowns are not forced into one abstraction merely because they all read the same deadline.

That is the interaction character the Backpack currently lacks.

---

# 31. The write-authority problem after removing "Obsidian must always co-write"

This changes the problem substantially.

D51/D52 answer this question:

> Can Proxima safely perform checked writes into creator Markdown through browser FSA while Obsidian or another process may alter those same files during Proxima's check-to-commit window?

The answer found by the project is **no**.

That does **not** establish:

> Proxima can never be a writer.

Nor does it establish:

> Full click parity must wait for some universally safe FSA solution.

The real requirement for nearly every **(c)** interaction above is much simpler:

> There must be one authoritative mutation path whose commit semantics are strong enough that the cockpit can know whether the operation happened.

If the creator no longer requires live simultaneous Obsidian editing, there are several honest worlds.

## Option 1: Proxima owns its canonical database

Tasks/projects/events stop treating ordinary creator Markdown as the live database. Proxima owns a transaction-capable store—SQLite is an obvious implementation family, but the product requirement is transactionality and durable identity, not SQLite specifically.

Then:

- card drops can commit atomically;
- Gantt resizes can commit;
- event drags can commit;
- bulk operations can be transactions;
- stable IDs are natural;
- relations do not need wikilinks;
- agents can later use the same semantic mutation surface.

**Cost to the creator:** Obsidian stops being a live editor of canonical Proxima records.

They may still be able to read exported Markdown or linked notes, but editing that exported representation would not automatically edit the authoritative Proxima task/event database.

They lose the current convenience of:

> open the same task file in Obsidian, edit frontmatter, and immediately have that be canonical.

They also lose plugin behaviors that depend specifically on those task/event Markdown files being live Obsidian objects.

In return, Proxima stops shaping its database around Obsidian's file grammar.

For the stated direction, this is not obviously a loss the creator cares about.

## Option 2: Keep current files, but Proxima is the only active writer

The data can remain ordinary files while the creator obeys an exclusive-writer rule:

> while Proxima owns the vault, do not edit those records from Obsidian or another writer.

This collapses the dangerous concurrent-writer race.

The simplest human version is literally:

> close Obsidian before enabling Proxima write mode.

A stronger version is a lease/lock enforced by a native owner.

**Cost:** the creator loses simultaneous Proxima + Obsidian modification.

They may still open the vault in Obsidian when Proxima releases ownership.

The weakness is that a browser-only "please don't write" lease is not enough. Obsidian does not inherently honor Proxima's lock. A second process can violate it. If the system relies only on convention, safety relies on the creator remembering the convention.

This can be perfectly reasonable for a personal transitional system, but it must be described truthfully.

## Option 3: A real single-writer lease enforced outside the browser

Papers or a native helper owns the vault writer.

It grants Proxima exclusive mutation authority and refuses/coordinates other participating writers.

The Backpack itself remains disposable; the native service owns the safety primitive.

**Cost:** another native capability has to exist and stay alive.

**Creator cost:** Obsidian cannot concurrently mutate while the lease is held unless it participates in the same protocol.

If Obsidian does not cooperate, the reliable lease may effectively mean "Obsidian closed/read-only during Proxima ownership."

## Option 4: Papers supplies atomic generic file transactions

This is the world D51 explicitly leaves open.

Papers need not learn tasks, projects, recurrence or Proxima semantics. It supplies something generic such as:

> replace this file only if its revision is still X.

Or a small transaction across a bounded set of files.

Proxima continues owning all domain logic.

This preserves the current strongest promise:

- ordinary shared files;
- Obsidian can remain a peer writer;
- Proxima can detect a race at commit;
- stale operations refuse rather than overwrite.

**Creator cost:** essentially none in workflow, aside from occasional explicit conflict/refusal when Obsidian wins a race.

**Engineering cost:** this requires native work in Papers or a helper instead of remaining a Backpack-only change.

This is the most conservative route if live Obsidian coexistence remains desirable.

## Option 5: Proxima-owned canonical store + explicit export/import to Obsidian

Proxima runs on its own clean database.

At a chosen boundary it exports a human-friendly Markdown representation for Obsidian.

Changes from Obsidian come back only through an explicit import/reconciliation action.

This turns continuous co-writing into discrete synchronization.

**Creator gains:** full Proxima interaction parity and a clean database.

**Creator loses:** immediate two-way liveness.

Editing an exported task in Obsidian does not become canonical until imported.

Import can also surface real conflicts explicitly rather than having filesystem races.

For someone who says "Obsidian is convenient, not the destination," this is a coherent transitional model.

## Option 6: Proxima owns records; ordinary project files remain ordinary files

The data split need not be all-or-nothing.

Projects/tasks/events could live in Proxima-owned transactional storage while project notes, documents, drawings and attachments remain ordinary filesystem artifacts.

Then the cockpit gets robust task/event writes without swallowing every human file into a database.

**Creator cost:** task metadata no longer looks like editable Markdown frontmatter in Obsidian; working notes still do.

This is arguably closer to what the old UI actually implied: tasks/events behaved like database rows, while Notes behaved like files.

## Option 7: Native Proxima service/daemon owns the current Markdown

A small native process—not the renderer—can own watches, revisions, journaling, locking and commits.

Papers communicates with it through a generic/Proxima-specific bridge depending on the boundary chosen.

This can preserve files while giving much stronger filesystem semantics than browser FSA.

**Cost:** deployment/lifecycle complexity and another long-lived component.

It is still not inherently safe against an uncooperative external writer unless it uses an actual atomic compare-and-swap/locking strategy.

## Option 8: Full multi-writer database / CRDT world

Proxima and other clients edit a storage system designed for concurrent writes; Obsidian becomes an adapter/client rather than canonical filesystem owner.

This can solve the underlying multi-writer problem at a deeper level.

**Cost:** by far the most complexity, and ordinary Markdown is no longer naturally the transactional source of truth.

Nothing in the creator's current requirement forces this.

### The practical reframing

For parity, there are therefore two very different costs:

**Presentation + local-state parity can start immediately.**

And:

**Data-write parity requires choosing a writer world. It does not necessarily require solving concurrent Obsidian FSA forever.**

If the creator is willing to say:

> Proxima owns these records while I am using it,

then D51 ceases to be the thing that blocks every card drag.

D51 remains important evidence about a **specific storage/coexistence mode**, not a universal product law.

---

# 32. The old database constraints that should NOT survive

This is where fidelity should stop.

## 32.1 Shallow colon-split frontmatter parsing

Source: `src/data/FileManager.ts`.

The plugin's parser effectively treats metadata as simple lines split around `:` rather than owning a robust structured-data model.

### What this forced on the creator

Values had to stay inside the subset the parser understood.

Complex YAML became dangerous.

Nested structures, quoting, punctuation, plugin-owned metadata and richer values could become ambiguous.

The creator's "database" was therefore partially constrained by **what a hand-built text parser could survive**.

### What the Backpack should do instead

A Proxima record should be structurally represented before it reaches presentation.

If Markdown remains an interchange/storage representation, use a real source-preserving parser and an explicit mapping layer.

If Markdown stops being canonical, this constraint disappears entirely.

The cockpit should never care whether a task title contains a colon.

---

## 32.2 Path-derived / filename-derived identity

The old plugin's world is heavily tied to Obsidian `TFile`, paths and file names. `src/data/FileManager.ts`; project/file flows in `ProjectsView.svelte` and `ProjectFileNode.svelte`.

### What this forced

Rename/move operations risked changing the practical identity through which something was found.

A relation or setting tied to a path/name could become stale when a human reorganized files.

Display name, physical location and record identity were insufficiently independent.

### Better successor rule

**Identity is opaque and stable.**

Name is editable.

Storage path is movable.

Project membership is editable.

None of those operations changes the record's ID.

The Backpack has already moved in this direction with explicit logical IDs plus separate source provenance. Do not regress.

---

## 32.3 Wikilink-encoded relations

Source: `PROXIMA_ADVANCED_FEATURES.md`, `src/types.ts`.

The plugin represents relations through wiki-link-shaped values.

### What this forced

A database relation became entangled with:

- a Markdown syntax;
- file naming;
- Obsidian link resolution;
- rename behavior;
- existence/location of a note file.

The creator could not simply mean:

> task UUID A relates to record UUID B.

They had to mean it through the host's file-link grammar.

### Better successor rule

Relations point to stable record IDs.

Rendering them as `[[Pretty Name]]`, a chip, a graph edge or plain text is presentation.

Exporting a relation as a wikilink is an adapter concern.

---

## 32.4 One `status` field serves two different concepts

Sources: `ElasticView.svelte`, `ProjectTaskBoard.svelte`.

This is one of the biggest structural mistakes.

The global Elastic board needs an **execution state**:

- backlog;
- running;
- finished.

The per-project board wants a **workflow stage** that may be:

- research;
- draft;
- blocked;
- review;
- shipped;

or anything else.

The plugin makes both compete over the same task `status`.

### What this forced

A project-specific workflow column and the global execution board could not evolve independently.

If a task is `review`, what does the Elastic board do with it?

If you drag it to global `Running`, did you just erase `review`?

Custom project Kanban semantics become hostage to the three global execution states.

### Better successor rule

They are separate dimensions.

For example conceptually:

`executionState = backlog | running | finished`

and

`workflowStage = <project-defined stable stage ID>`

A card can therefore truthfully be:

> Running globally, while in Review inside its project.

The exact field names are unimportant. The separation is not.

---

## 32.5 Per-project column schema lives in plugin settings

Source: `ProjectTaskBoard.svelte`, `src/settings.ts`.

### What this forced

The thing defining the project's workflow did not live with the project records.

Move the vault to another environment without the plugin settings and the project could lose the interpretation of its statuses.

Agents editing only the data files could not reliably know the workflow definition.

Column config and actual task state could drift apart.

### Better successor rule

Split semantic state from visual state.

**Semantic workflow stages** belong to the project/domain if they define what task values mean.

Each stage should have a stable identity.

**Column color, width, collapsed state and perhaps display order** can be Backpack-local **(b)** state.

Do not put semantic workflow vocabulary into disposable UI settings.

---

## 32.6 One ordering value is made to serve unrelated surfaces

The plugin persists task ordering when cards move. Elastic, project board and deadline/Gantt views each have reasons to order tasks.

Sources: `ElasticView.svelte`, `ProjectTaskBoard.svelte`, `ProjectDeadlines.svelte`.

### What this risks/forces

"Put this third in my execution queue" and "put this third in my project's Review column" are not necessarily the same assertion.

Likewise a Gantt row can be a layout decision rather than workflow priority.

When one generic `order` leaks across surfaces, arranging one view can make another view strange.

### Better successor rule

Order has a scope.

Execution order, workflow-column order and timeline layout order should not be silently conflated.

Some orders may even be **(b) local presentation** rather than canonical data.

Only persist an order canonically when the user meaning is genuinely durable.

---

## 32.7 Task project versus schedule project is a hard silo

Sources: `AgingView.svelte`, `ProjectsView.svelte`, `ScheduleView.svelte`, project type in `src/types.ts`.

The plugin makes projects choose a kind and then gives them different workspace tabs.

### What this forced

A real project containing both tasks and scheduled events does not map naturally to one project.

The creator may need parallel concepts or arbitrary type switching simply because the UI/database says "task project" or "schedule project."

### Better successor rule

A project should be able to own/associate whichever domain objects actually belong to it.

A project can have:

- tasks;
- events;
- notes/files;
- deadlines;
- workflow.

The cockpit can hide irrelevant tabs when a project has nothing of that kind without making the absence a permanent type-system wall.

Notably, the current Backpack still carries a project `type`. That deserves scrutiny rather than automatic preservation.

---

## 32.8 Schema definitions and record values live in different durability worlds

Source: `src/settings.ts`, `src/types.ts`, `PROXIMA_ADVANCED_FEATURES.md`.

The plugin has sophisticated custom property types, but much of the schema/configuration is plugin-owned while values live in files.

### What this forced

The raw record is insufficient to understand itself.

Copy the data without plugin settings and a value may remain while its meaning/editor/formula/rollup definition disappears.

Agents working directly on the files do not necessarily possess the schema that gives those fields semantics.

### Better successor rule

If a custom field is a real part of the database, its schema is first-class durable Proxima data.

Visual treatment belongs to the Backpack.

Formula/rollup definitions likewise need durable identities and explicit dependencies if they are meant to survive cockpits.

---

## 32.9 Relations/rollups/formulas are shaped around file-addressable records

Sources: `PROXIMA_ADVANCED_FEATURES.md`, `src/types.ts`.

### What this prevented

The system's "advanced database" layer inherited all of the weaknesses of file names/wikilinks.

Computed fields therefore depend on a relationship substrate that is less stable than the conceptual records themselves.

### Better successor rule

Evaluation should operate on typed record IDs and values.

The presentation can still look exactly like the old chips/columns.

The database underneath does not need to know that Obsidian has wikilinks.

---

## 32.10 Record name and physical file representation are too close

Source: `src/data/FileManager.ts` and all create/rename paths.

### What this forced

Human naming collides with filename legality, uniqueness and rename/move mechanics.

"Rename this task" can accidentally become "rename its storage object."

### Better successor rule

Display title is a field.

Storage identity is opaque.

An exporter decides filenames.

Changing a title should not invalidate relations or identity.

---

## 32.11 Project membership is too filesystem-shaped

Source: `ProjectsView.svelte`, `ProjectFileNode.svelte`, linked-folder/project file behavior.

### What this forced

"What belongs to this project?" is partly answered by:

> which folder is this file under?

That is convenient in Obsidian, but restrictive as a database rule.

One working artifact may meaningfully belong to more than one project.

Moving a file for organizational reasons should not necessarily change its semantic membership.

### Better successor rule

Project membership/association is explicit data.

Filesystem location is one possible source/projection of that relationship, not the relationship itself.

A Notes tree can still **look exactly the same**.

---

## 32.12 Recurrence is storage-format-shaped

Sources: `src/utils/recurrence.ts`, `src/modals/Modals.ts`, frontmatter model.

The old UX has a useful recurrence concept, but recurrence ultimately has to fit inside file metadata and exception mechanics.

### What this costs

Series identity, occurrence identity and exceptions are harder than they need to be when the underlying primitive is "one file plus metadata."

A modified occurrence risks becoming an awkward mixture of base event + exception marker + separate physical representation.

### Better successor rule

Treat:

- series;
- recurrence rule;
- generated occurrence identity;
- explicit exception;
- detached occurrence

as actual domain concepts.

How they export to Markdown is a secondary question.

The **"this occurrence / entire series" modal should survive exactly because it reflects the domain correctly**, not because of Obsidian.

---

## 32.13 The plugin setting store became a second hidden database

Source: `src/settings.ts`, Elastic lock/configuration, project board configuration.

This is the broader pattern behind several problems.

### What it forced

Some truths lived in Markdown.

Some lived in plugin settings.

Some were inferred from paths.

Some were generated from conventions.

A human or agent looking only at one layer did not actually possess "the Proxima database."

### Better successor rule

There should be an explicit boundary:

**Canonical Proxima data:** durable records and semantic configuration.

**Backpack local state:** disposable cockpit state.

**External/source metadata:** adapter/provenance information.

Nothing should live in a fourth category merely because a host API offered `saveData()`.

---

# 33. What should remain faithful versus what should be replaced

The fidelity boundary can now be stated sharply.

**Faithful:** the creator sees the same conceptual surfaces, can click the same kinds of objects, gets the same editors, can drag cards, timeline bars, calendar events and files, can resize things spatially, can compose Timekeeping views, can operate a project's notes/board/backlog/deadlines, and gets immediate continuous feedback.

**Not faithful:** path identity, Markdown-as-domain, wikilink relations, Obsidian settings as a hidden schema database, single shared status, single ambiguous ordering, task-vs-schedule project siloing, Obsidian-native leaves/context menus, or any other constraint whose only justification is "that was how the plugin could make it work."

That is the target I would use for the implementation checklist: **old Proxima above the interaction boundary; a cleaner Proxima below it.**
