# As you Go — architecture and change guide

This is the machine-local “As you Go” Backpack project. It is a modular, vanilla-JavaScript
app served as static files from `public/` inside the Papers host. Read `README.md` for
ownership, data and behavior; read this file before changing the code so new work lands in
the right module and preserves the interaction behavior.

## Module map

The entry file `public/workspace-20260730b.js` is a thin composition root. It wires modules
together and keeps the tiny amount of glue that has nowhere else to live. Everything with a
clear responsibility lives in a module.

| Change type | Correct location |
|---|---|
| Keyboard, pointer, marquee, drop events | `public/app/interactions/` |
| Dialogs, menus, toolbar, Bin controls | `public/app/components/` |
| User-intent operations and host coordination | `public/app/workspace-commands.js` |
| Session, history, persistence queue | `public/app/workspace-store.js` |
| Data transformations and invariants | `public/workspace-model-20260730b.js` |
| Papers messaging | `public/app/host/host-bridge.js` |
| Startup and synchronous mounting | `public/app/bootstrap.js` |
| Styling | the matching file under `public/styles/` |
| Compatibility composition | `public/workspace-20260730b.js` |
| Quick Run search (filter vocabulary and cycle, the searchable universe, the index, the session, what the surface draws) | `public/app/quick-run/quick-run-types.js`, `quick-run-search.js`, `quick-run-index.js`, `quick-run-session.js`, `quick-run-presentation.js`, `quick-run-surface.js`, `quick-run-activation.js` |
| Quick Run layout-item resolution (the fail-closed decision that names one window or refuses, and the ephemeral availability the surface shows) | `public/app/quick-run/quick-run-resolution.js`, `quick-run-presentation.js` |
| Quick Run workspace binding (what Enter and Ctrl+Enter execute against the workspace, and the close-on-success rule) | `public/app/quick-run/quick-run-workspace.js` |
| Quick Run presentation (the palette, its chips, rows and two sentences) | `public/styles/quick-run.css`, imported by `public/workspace-20260730b.css` |

Quick Run writes no workspace state. Its binding is handed commands, the state reader, the visible ids and
the status line, and nothing else: Shift+Enter (add to the active layout) was cut on 2026-09-13 rather than
repaired, because its only write installed state in memory without committing it, so a surface without
document-write authority could report success after a refused write. The gesture has no key, no plan and no
notice; `quick-run-entry.test.mjs` fails if any of them comes back, and `papers/quick-run.md` carries the
cut note.

The palette is an overlay (`z-index: 60`: above the graph viewport and toolbars, below the context menu and
dialogs). That is not decoration — measured in the real host before `public/styles/quick-run.css` existed,
the layer computed to a static transparent block underneath the absolutely-positioned `#graph-viewport`, so
its rows were painted but every pointer event at their coordinates hit the graph. `quick-run-style.test.mjs`
holds the layering, the scrollable list, the row height the wheel arithmetic falls back to, and the rule
that keeps `[hidden]` able to hide a `display: flex` layer.

## Quick Run's paint cap

One keystroke can rank thousands of matches — the fuzzy subsequence tier in `quick-run-index.js` matches a
single letter against a large slice of a 20,000-occurrence corpus — and the surface paints every row it is
handed, so a keystroke's cost tracks the size of the ranked result set rather than the query. The session
therefore holds at most `QUICK_RUN_MAX_PAINTED_ROWS` (200) rows, a measured number rather than a taste: in
`quick-run-integrated-perf.mjs` the bucket at or below 200 painted rows measured p95 6.1 ms against the
contract's 16 ms gate, while 201–1,000 is already at 10.8 ms and 1,001–3,000 misses outright.

The rule lives in `quick-run-session.js` because `rows` is the single list three consumers share: what the
surface paints, what `quickRunSessionAfterArrow` walks, and what the highlight is chosen from. Bounding it
there bounds all three together, so the highlight can never land on a row that is not on screen; a cap in
the DOM layer would leave navigation and highlight pointing at unpainted rows.

Nothing else is capped. `chipsFor` and the filter-fallback rule still read every match, the session carries
`totalRows` and `capped` so the surface can say what it is not showing (`quickRunCapNotice` in
`quick-run-presentation.js`, painted into `#quick-run-cap` only while the cap actually bites), and Enter
still revalidates the row by stable result key against the current workspace (`quick-run-activation.js`), so
a match past the cap is exactly as actionable as one on screen. `quick-run-paint-cap.test.mjs` holds each of
those rules individually, and `npm run test:quick-run:integrated-perf` is the acceptance instrument for the
number itself.

## Multi-window document behavior

Papers projects a scoped workspace from the same `state.json` and merges its
checked saves back into that file. Scoped and full surfaces therefore retain
separate channels and writer locks: their snapshots have different shapes.
Each ordinary surface reads its own versioned host projection every two seconds,
including while unfocused. A changed revision is installed as an external
generation; the writer broadcasts it within its scope. This also makes direct
edits to `state.json` visible without treating a file change as an unchecked
save. The host revision remains the CAS authority across every scope.

Every open As you Go surface accepts document actions. One surface remains the
durable writer, while other surfaces apply the action optimistically and send a
bounded snapshot over the same-origin channel. The writer merges entity edits
by stable id, commits through Papers' versioned state service, and broadcasts
the exact committed bytes back to every surface. This prevents a delete, bin,
rename, move, or other action in one window from disappearing in another.

Peer mutation requests are serialized at the writer. Each request is rebased
against the latest committed snapshot before its compare-and-set; if an
unexpected external revision advances the host, the writer reloads and retries
that same request once instead of dropping it. This preserves disjoint edits
when two windows act at nearly the same time.

On real BroadcastChannel surfaces, forwarded mutations carry a stable request
id. The writer deduplicates an id before queueing it and emits one correlated
acknowledgement containing the committed revision; the sender exposes that
acknowledgement for diagnostics and reports a bounded timeout if the writer
dies. Missing or failing Web Locks/BroadcastChannel primitives fail closed:
document/history mutations are disabled and never fall back to unchecked
`host.saveWorkspace` writes. A stale compare-and-set enters CONFLICT and the
store gate freezes further document/history changes until Use latest or Keep
my version resolves it. External installs and writer promotion reloads clear
snapshot undo/redo history so an old generation cannot resurrect peer edits.
If a forwarded mutation receives a negative acknowledgement or reaches the
writer-ack timeout, its optimistic overlay is retired and the surface reloads
the versioned authoritative document before reporting failure. This keeps a
transport miss from leaving a folder, prompt, or rename painted in only one
window. A timeout remains an uncertain request while recovery is in flight: the
follower sends a correlated cancellation, and the writer either suppresses a
queued request before `host.saveChecked` or returns the already-committed result.
Only the actual Web-Lock writer may answer cancellation; an observed successful
ACK owns terminal resolution and suppresses cancellation exhaustion until a
fresh authority read proves it. The follower retries a bounded number of times
so a newly promoted writer can observe it. If no writer
answers, the surface becomes an explicit non-editable CONFLICT and settles as
`MUTATION_UNCERTAIN`, never continuing to accept speculative document actions.
That cancellation fence prevents a late writer queue turn from committing after
the follower has declared failure. Installed-app proof still needs two native
Papers windows on a cloned real profile; synthetic coordinator tests do not
establish channel or session scope by themselves. Recovery is fenced by the
latest authoritative-generation epoch, keeps the request correlation alive
through timeout recovery so a late committed broadcast can win, and enters
CONFLICT if the authoritative reload itself cannot complete rather than silently
presenting the speculative state as reconciled. Every terminal ACK, including a
cancellation ACK, reloads the versioned authority before settling, so a dropped
committed broadcast cannot leave a stale follower behind. If the reload finds
the forwarded bytes already durable, the request resolves as a successful
recovery rather than invalidating dependent edits. A follower conflict never
becomes a writer without first acquiring the same Web Lock; successful Keep my
version also reinstalls its own committed bytes through the store before
publishing them.

Committed frames carry their parent revision. A view that receives a frame whose
parent does not match its current authority performs a host-authoritative load
instead of installing the frame directly; this prevents a delayed former-writer
frame from regressing a view after a cross-writer promotion when opaque host
revisions cannot be ordered locally.

The merge is three-way and stable-id aware for entities, item sets, prompt
library trees, and per-context graph/rest/toolbar position keys. Local surface
navigation, selection, expansion, trail expansion, and Bin-mode UI are stripped
from forwarded document snapshots; they remain owned by the live surface.

Graph, resting, and toolbar position maps are deliberately last-writer-wins;
the most recently committed drag is the visible placement everywhere.
Creator correction (2026-09-04): restore natural positioning on entry, followed
by cooling and rest. Remembered coordinates seed unpinned items; saved positions
do not freeze the graph. Entry, topology, set membership, pin, node-size and
viewport changes reheat the simulation. Rest-position commits and unchanged
renders do not reheat it: doing so fed every periodic save back into another
physics pass and prevented settling. Coordinated writes, last-writer-wins
placement, and close-time save draining remain in place. A
surface opening a folder with the context-menu action or middle mouse button
requests a new generic Papers surface on its own authenticated project URL;
the host does not interpret As you Go's folder id.

Papers also supplies each project tab an opaque stable surface key. As you Go
uses that key only to store a bounded `{ currentGroupId }` entry, so each tab
can restore its own last-opened folder after runtime surface ids are recreated
at startup. These entries merge by key; they never make a peer tab navigate.

The creator confirmed working multi-window interactions before requesting this correction.
Validation of the cooling correction: 1,116 unit tests and 8 visual pretests
pass. Five production-function entry tests include a two-simulation reproduction
with periodic position commits; it fails against `d15f717` and passes with the
correction. `npm run test:graph:settling` (with `PAPERS_PACKAGED_EXE`) opens two
native Papers windows on a disposable synthetic profile containing six folders
and overlapping sets. After 12 seconds, both views must remain still over a
further 3 seconds, with all six positions durably saved. This test fails on
`d15f717` and passes with the correction against the installed Papers executable.
The earlier saved-PNG hash mismatch remains a separate baseline issue; no
baseline was updated by this correction.

## Prompt library (copy button)

The prompt library is a nested tree of prompts and folders persisted in
`view.promptLibrary`. It is split across four modules plus one pure model:

| Responsibility | Module |
|---|---|
| Pure tree data (normalize/migrate, create/find/update/remove, single and atomic multi-node move, batch inclusion via folder `includeAll`, explicit Copy Selected, validation) | `public/prompt-library-model.js` |
| Pure temporary row-selection logic (select/toggle/range/visible order/collapse repair; no DOM/store/host) | `public/app/components/prompt-tree-selection.js` |
| Pure dialog-local undo/redo (past/present/future, edit transactions, limit; no DOM/store/host) | `public/app/components/prompt-library-history.js` |
| Tree DOM interaction → plain intents (clicks, keyboard, drag, context-menu requests; selection state; no host/persistence) | `public/app/components/prompt-tree-controller.js` |
| Prompt-tree context menu (rendering, keyboard nav, dismissal, action intents) | `public/app/components/prompt-tree-context-menu.js` |
| Panel composition root (open/close, draft tree, expansion/editor/rename/delete-confirm, rendering, auto-save) | `public/app/components/prompt-library-dialog.js` |

Rules: the dialog clones the saved library into a `draftLibrary` and owns
persistence via `setPromptLibrary` + `store.replace/save`; the controller and
context menu never call the host or persist state; the toolbar copier keeps
selected-shortcut precedence and reads the saved snapshot through
`getSnapshotLibrary()`/`getBatchText()`. Folder checkboxes persist an explicit
override (never a derived tri-state) and setting one never rewrites descendant
prompt checkboxes.

A folder's override is one of three states, stored as two booleans so libraries
saved before exclude-all existed migrate untouched:

| state | stored | meaning |
| --- | --- | --- |
| neutral | both false | each descendant's own checkbox decides |
| include | `includeAll` | everything inside is copied |
| exclude | `excludeAll` | nothing inside is copied, even a checked prompt |

The **nearest** override wins, so an excluded folder inside an included one
copies nothing and an included folder inside an excluded one copies everything.
Clicking a folder checkbox cycles neutral → include → exclude → neutral; the
context menu offers whichever two states the folder is not currently in, and
"Use child selections" clears both flags so a folder is never stranded in
exclude. Exclude renders as a red box with a white minus (a native checkbox has
no excluded state), and rows under a non-neutral folder take that override's
colour — green for include, struck-through red for exclude — because their own
checkbox no longer decides anything.

Batch checkboxes support two bulk gestures, each one undo entry, and neither
ever changes row selection (the tree controller ignores `.prompt-checkbox`
clicks entirely, so they cannot collide with Shift+click row ranges):

- Clicking the checkbox of a row **inside** a multi-row selection forces every
  selected row to the clicked value — checking and unchecking alike. Clicking a
  row outside the selection touches only that row and leaves the selection
  intact.
- **Shift+click** applies the clicked box's resulting state to the visible range
  between the last-clicked checkbox and this one. `change` does not carry
  `shiftKey`, so the modifier is captured on the preceding `click`.

While `#prompt-layer` is open, the workspace keyboard controller is inert; the
prompt-tree controller owns tree shortcuts (Ctrl/C/X/V are dialog-local
copy/cut/paste via `treeClipboard` — never the OS clipboard or `copyText`,
which is reserved for prompt double-click and "Copy prompt text"). Feedback
for modal actions uses the local `#prompt-status`, not the workspace status.
New prompt / New folder are permanent header buttons; New prompt inserts
inside the selected folder only when exactly one folder row is selected,
otherwise at root. Ctrl/Meta+Z/Y/Shift+Z drive a dialog-local undo/redo on the
draft (never the workspace store history); each completed data mutation is one
entry, a focused editing session is one transaction, and editable controls keep
native text editing. The tree root is a first-class paste destination: blank
tree space (or the root context menu) targets the root while the internal
clipboard is preserved, and dragging below the last top-level row moves nodes
to root.

Three invariants keep the tree usable in a real browser, each covered by tests
that dispatch bubbling events from the actually-focused element:

- **Keyboard scope is the modal, not the row list.** The controller takes a
  `keyboardTarget` (`#prompt-layer`) for `keydown` while pointer listeners stay
  on the viewport. Tree shortcuts therefore work from New prompt/New folder,
  Close and the status line — anywhere non-editable. `isEditableTarget()`
  still excludes inputs, textareas and contenteditable, which never get
  `preventDefault()`, so native text undo/redo survives.
- **Focus is explicit.** Setting `tabindex` does not move focus, so selection
  calls `row.focus({ preventScroll: true })` and root targeting focuses
  `#prompt-tree-viewport`. Opening the dialog focuses the root surface rather
  than leaving `document.body` active.
- **One destination, never a drift-prone boolean.** `activeDestination` is
  `{ type: 'root' | 'node', nodeId }`, updated from a single
  `controller.setSelection()` path that always notifies `onSelectionChange` —
  pointer-driven and programmatic alike. `resolvePasteDestination()` reads it
  and falls back to root when the node no longer exists, so paste can never
  target a row that undo or delete removed.

`#prompt-tree-viewport` owns scrolling and the blank `.prompt-root-surface`
below the last row, so clicking, right-clicking, or dropping in empty space is
a real root gesture. There is no persisted root node.

The dialog auto-saves; there is no Save step and no discard. Every structural
change persists from the shared `afterHistoryTreeChange()` tail, so mutations,
undo and redo all reach the store the same way. Text editing persists once per
session when its transaction commits, not once per keystroke, which is also
what Close flushes before hiding the layer. `autoSave()` installs the draft
with `store.replace()` synchronously — so the next edit reads it — and hands
the write to the store's existing save queue rather than adding a second queue
on top; layering one caused an edit landing mid-save to be silently dropped. An
invalid draft (the last prompt removed) is reported in `#prompt-error` and left
unsaved, so the persisted library never goes empty. Ctrl+Z is the only way
back, which is why the local history covers every tree operation.

## Interaction controllers

Controllers live in `public/app/interactions/` and own browser events for one gesture
family: `keyboard-controller.js`, `pointer-controller.js` (graph drag + marquee + the
double-click listener), `marquee-controller.js`, `drop-controller.js`.

Controllers may read the DOM and the event, but they must not mutate document/session state
and must not call the host. They translate an event into plain command inputs and call
`commands`.

## Command layer

`public/app/workspace-commands.js` owns every user-intent operation: activation, reveal,
copy/cut/paste, moving to the Bin, graph reset, drag outcomes, drops. Commands receive
plain values (IDs, placement maps, destination IDs, position maps, modifier booleans) —
never a raw browser event.

Commands are the only layer that coordinates host calls, document mutation, session
mutation, history, rendering and persistence for a user action. The entry's menu map
(`runMenuAction`) delegates to commands; editor and confirmation dialogs stay in the entry
wiring and call `commit`.

## Store

`public/app/workspace-store.js` owns session state, undo/redo history and the save queue.
The store exposes explicit operations; components and controllers never assign to
`session.*` directly.

- Persistent document changes that belong in history: `store.commit(nextState)`.
- Non-history view/position changes (toolbar position, graph positions, icon size):
  the appropriate store operation or `store.replace(...)`.
- Session writes: `setSelection`, `addToSelection`, `removeFromSelection`, `clearSelection`,
  `setSelectionAnchor`, `setNavigation`, `setGraphExpanded`, `toggleGraphExpanded`,
  `addToGraphExpanded`, `removeFromGraphExpanded`, `setClipboard`.

## Host bridge

`public/app/host/host-bridge.js` is the only place that talks to Papers over
`postMessage`. It owns the pending-request map and the response listener, and exposes named
methods (`loadWorkspace`, `saveWorkspace`, `launchShortcut`, `revealShortcut`, `openWebLink`,
`pickTarget`, `shortcutIcon`, `resolveWebIcon`, `resolveDroppedTargets`, `copyText`). No
other module should post a Papers message directly.

## Bootstrap

`public/app/bootstrap.js` mounts the behavior-only components (context menu, editor,
confirmation dialog, Bin controls, keyboard, drop, pointer controllers) synchronously so the
fallback workspace stays interactive even when host loading fails. The toolbar mounts only
after state is restored because it immediately re-applies saved positions.

## Styling

`public/workspace-20260730b.css` is an `@import` aggregator over `public/styles/`: tokens,
base, workspace, toolbar, items, graph, context-menu, dialogs, utilities, responsive. Put a
rule in the file that owns its category; do not rename selectors or custom properties that
the interaction code depends on.

## Compatibility contracts

These are stable and must not change casually:

- `project.json` `backpackId` and `entry` (`public/workspace-20260730b.html`).
- Serialized state fields in `state.json` (`schemaVersion`, `groups`, `shortcuts`, `view`).
- The dated compatibility filenames: `public/workspace-20260730b.html`,
  `public/workspace-20260730b.js`, `public/workspace-20260730b.css`.
- The host protocol messages sent by `host-bridge.js` (e.g. `papers:project:as-you-go-load`,
  `as-you-go-save`, `as-you-go-launch`, `as-you-go-reveal`, `open-web-link`).

## Required checks before finishing a change

- Every changed interaction needs a behavioral unit test in the matching `*.test.mjs` (not a
  source-text regex).
- Run `npm test` after a change; it is self-contained and never launches a prepared action.
- After interaction changes, run a short browser smoke test in Papers covering: group
  double-click navigation, file/app double-click launch, web-link open, directory
  double-click reveal, keyboard Enter, drag, marquee, external drop, Bin restore/delete,
  and the failed-load fallback staying interactive.
