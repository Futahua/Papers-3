# Quick Run — Complete Implementation Checklist

> Authored by the audit reviewer on 2026-09-08 and saved here (only rendering
> artefacts removed). Written to stand alone: a future reader needs no access to
> the conversation that produced it.
>
> **Sets decision — RESOLVED.** The document below marks the Sets question as
> open pending creator confirmation. The creator confirmed on 2026-09-08:
> **Sets are OUT for v1**, keeping exactly the five chips
> `All · Folders · Shortcuts · Links · Layout Items`. Treat every "pending
> creator confirmation" note about Sets as settled — excluded by decision, not
> by oversight.

Feature: As-you-Go Quick Run
Owner: As-you-Go Backpack, with one narrow Papers native capability addition
Starting baselines:

- Papers-3 main: cbe2a75
- Papers-3 docs-only follow-up: 0397d48
- as-you-go-backpack main: 8000c88

Status: Future feature.

This document is intended to stand alone. A future implementation agent should read it from beginning to end before changing code.

# 0. Product contract

Quick Run is an As-you-Go workspace command surface inspired by command-line/AutoCAD-style quick access.

The creator invokes a workspace hotkey, types a name, chooses from matching persisted As-you-Go items, and activates the selected result.

The core interaction is:

```
hotkey
→ one search line appears
→ type
→ flat ranked results appear immediately
→ ArrowUp / ArrowDown / wheel changes highlight
→ Tab / Shift+Tab changes type filter
→ Enter performs the default action
→ Ctrl+Enter reveals the occurrence inside As-you-Go
→ Shift+Enter adds to the active window layout where supported
→ Escape closes Quick Run and leaves nothing behind
```

There is no empty-query launcher home screen.

There are no prompts.

There is no whole-window-layout result.

Quick Run is a persisted-data search system. Live native window resolution happens only when a selected Layout Item is executed.

# 1. Locked UX contract

These decisions are product requirements, not implementation suggestions.

## 1.1 Opening and closing

- [ ] A configurable As-you-Go workspace hotkey opens Quick Run.
- [ ] V1 activation works only while the As-you-Go surface itself can receive keyboard input.
- [ ] OS-global Quick Run activation is explicitly out of scope.
- [ ] Opening Quick Run shows one focused search input.
- [ ] Empty query shows no result rows.
- [ ] Results first appear after the first non-empty search query.
- [ ] Escape closes Quick Run.
- [ ] Escape does not create, move, launch, select, navigate, or persist a result action.
- [ ] Closing Quick Run clears its query/highlight/filter session state.

The existing Backpack hotkey model already has workspace-scoped actions and configurable bindings, while the keyboard controller is the central workspace keydown seam. Add Quick Run there rather than introducing a second unrelated keybinding system. `workspace.reveal-selection` and `workspace.open-selection` already occupy Ctrl+Enter and Enter in the ordinary workspace, so Quick Run must take over those keys only while its own input surface is active.

## 1.2 Result presentation

Every visible result row contains:

```
icon
primary name
faint trailing breadcrumb
```

One flat list only.

No grouped sections.

Duplicate names are allowed and expected when breadcrumbs differ.

## 1.3 Highlight

- [ ] First matching result starts highlighted.
- [ ] ArrowDown moves highlight one result down.
- [ ] ArrowUp moves highlight one result up.
- [ ] Mouse wheel/scroll updates which result is highlighted according to the agreed list behavior.
- [ ] Highlight never points to an item not present in the currently displayed filtered result set.
- [ ] When the current result set changes, preserve the highlighted result by stable result key if it still exists.
- [ ] Otherwise select the first result.

## 1.4 Type filters

Filter cycle:

```
All
Folders
Shortcuts
Links
Layout Items
```

- [ ] Tab cycles forward.
- [ ] Shift+Tab cycles backward.
- [ ] Chips appear above the result list.
- [ ] Only result types with at least one current query match receive type chips.
- [ ] All is shown whenever there is at least one result.
- [ ] If the active type filter loses all matches after another keystroke, immediately fall back to All.
- [ ] After that fallback, highlight the first All result.

## 1.5 Default Enter actions

```
Folder
→ navigate into that folder

Shortcut
→ launch it

Link
→ open its web URL

Layout Item
→ activate/focus that exact external application window
→ restore it first if currently minimized
```

## 1.6 Modifier actions

### Ctrl+Enter

Means: reveal this exact occurrence inside As-you-Go.

It explicitly does not mean OS file-manager reveal.

It must not reuse the existing `workspace.reveal-selection` behavior or `revealShortcut()`, because the existing command explicitly reveals shortcut targets through the host/file manager.

### Shift+Enter

- [ ] Enabled only for Layout Items.
- [ ] Visibly disabled for Folder, Shortcut, and Link results.
- [ ] Never silently ignore Shift+Enter.
- [ ] If no active window layout exists, the Layout Item Shift+Enter affordance is disabled with a visible reason.
- [ ] If the selected window already occurs in the active layout under the defined duplicate rule, report that instead of creating an accidental duplicate.

# 2. Searchable universe

Classification: HARD PRODUCT SCOPE

Quick Run v1 intentionally searches a narrower universe than every user-visible object As-you-Go currently contains.

The current workspace model contains top-level groups, shortcut records with one or more placements, window layouts, prompt-library state, and Sets. Window-layout members are nested persisted descriptor records rather than ordinary `itemsIn()` entries. Shortcut placements — not shared shortcut records — are the location-specific item identities exposed to the workspace.

## 2.1 Included in v1

### Folders

Source:

```
state.groups
```

One result per active folder.

### Shortcuts

Source:

```
state.shortcuts[].placements[]
```

One result per active placement, not per shared shortcut record.

A linked shortcut shown in three folders may therefore produce three Quick Run rows with:

```
same name
same underlying target
different placement IDs
different breadcrumbs
```

This is intentional. The workspace itself already treats placement IDs as the selectable/movable occurrence identity.

### Links

Links are not a separate durable record kind.

A Link is a Shortcut whose target parses as `http:` or `https:`. `createWebLink()` delegates to `createShortcut()`, and `isWebLink()` classifies the target URL. Therefore Quick Run must create one shortcut index and classify each occurrence into either link or non-web shortcut; do not build a second Link store/index.

### Layout Items

Source:

```
state.windowLayouts[].arrangement.members[]
```

One result per member occurrence.

A single native application window intentionally present in two layouts therefore produces two Quick Run rows, each with the containing layout in its breadcrumb.

Persisted window-layout members carry:

```
member.id
descriptor.version
descriptor.title
descriptor.executableFingerprint
bounds
state
```

The persisted descriptor — not an HWND/runtime token — is their durable native identity.

# 3. Explicit exclusions

Classification: HARD V1 SCOPE

Do not accidentally broaden "valid item type" to mean every persisted concept in the Backpack.

V1 excludes:

- [ ] Whole window layouts.
- [ ] Prompts / prompt library entries.
- [ ] Bin contents.
- [ ] Items whose ancestor folder is currently binned.
- [ ] Binned shortcut placements.
- [ ] Binned window layouts and their members.
- [ ] Sets — see the resolved decision at the top of this document.

## If Sets are later included

Add `Sets` as its own result kind and filter chip.

Then define separately:

- result key;
- display name;
- breadcrumb/location semantics;
- default Enter action;
- Ctrl+Enter reveal semantics;
- whether Shift+Enter is disabled;
- ranking/index invalidation for set rename/delete;
- whether set membership changes affect searchable identity.

Do not treat a Set as a Folder. Sets are a workspace-view grouping abstraction rather than folder-tree containers.

# 5. Non-negotiable architecture invariants

Classification: HARD LAUNCH CRITERIA

- [ ] Quick Run index construction performs zero native window enumeration.
- [ ] Typing performs zero native window enumeration.
- [ ] Typing performs zero capability resolution.
- [ ] Typing performs zero window observation.
- [ ] Typing performs zero thumbnail requests.
- [ ] Typing performs zero host IPC other than anything strictly necessary for unrelated existing renderer infrastructure.
- [ ] Ranking is pure local computation.
- [ ] Breadcrumb generation is based on persisted workspace hierarchy.
- [ ] Window-layout result actionability is not guessed from persisted state.
- [ ] An untouched Layout Item starts availability=unknown, not "Not running."
- [ ] Missing/ambiguous native targets remain searchable because their persisted member still exists.
- [ ] A failed native resolution never silently substitutes a different matching window.
- [ ] Enter re-reads the selected object from the current state by stable IDs before acting.
- [ ] Indexed result payloads are never treated as current authority.
- [ ] Quick Run does not invoke the normal full workspace render() on every keystroke.
- [ ] Query interaction does not restart/reheat graph physics.
- [ ] Search-index rebuilding is not triggered by layout-member state/bounds observation.
- [ ] The Papers addition is exactly a narrow already-resolved capability activation primitive; Papers does not own Quick Run search/index/ranking in v1.
- [ ] OS-global hotkey registration is not added as part of v1.

# 6. Do NOT attempt in v1

This section exists to stop scope creep.

Do not add:

- [ ] Papers-level universal command palette.
- [ ] Cross-Backpack aggregated search.
- [ ] OS-global accelerator.
- [ ] Quick Run invocation while another unrelated desktop application has focus.
- [ ] Prompt search.
- [ ] Whole-layout search.
- [ ] Bin search.
- [ ] Live "which applications are running" scanning.
- [ ] Native availability polling in the background.
- [ ] Thumbnail generation for Quick Run rows.
- [ ] Desktop enumeration while typing.
- [ ] Automatic relaunch of a missing layout member.
- [ ] "Best guess" resolution for ambiguous window descriptors.
- [ ] Folder/shortcut semantic search through descriptions or file contents.
- [ ] Search inside file contents.
- [ ] Search through link page titles fetched from the network.
- [ ] Search by URL target unless separately approved later.
- [ ] AI ranking.
- [ ] Embeddings/vector search.
- [ ] Prompt/verb syntax in the query.
- [ ] Command verbs inside the Tab filter cycle.
- [ ] Launch-a-shortcut-and-then-capture-its-new-window behavior for Shift+Enter.
- [ ] Worker architecture before profiling proves it necessary.
- [ ] New search dependency/library before the pure matcher has been measured.

# STAGE 0 — Pure search viability proof

Purpose: Prove the search/index design at target scale before UI or native work.

Classification: HARD GO/NO-GO GATE

No UI integration should begin until this stage passes.

## 0.1 Create pure Quick Run modules

Suggested new As-you-Go modules:

```
public/app/quick-run/quick-run-index.js
public/app/quick-run/quick-run-search.js
public/app/quick-run/quick-run-types.js
```

They must have no imports from:

```
host-bridge
DOM
graph
d3
window capability runtime
thumbnail code
```

## 0.2 Define stable result shape

Suggested shape:

```
{
  resultKey,
  type,
  name,
  normalizedName,
  breadcrumb,
  breadcrumbIds,
  actionRef,
}
```

Type-specific authority references:

```
folder
  groupId

shortcut/link
  shortcutId
  placementId

layout-item
  layoutId
  memberId
```

Do not copy an entire mutable workspace object into actionRef.

## 0.3 Stable result keys

Pin these or an equivalent deterministic scheme:

```
folder:<groupId>
shortcut:<placementId>
link:<placementId>
layout-member:<layoutId>:<memberId>
```

Result identity is occurrence identity.

## 0.4 Build breadcrumbs once

Use persisted folder ancestry.

The existing workspace has a simple parent walk in `pathTo()` that builds the `As you Go → ...` breadcrumb chain. Extract or implement a pure equivalent rather than calling UI/graph code for every keystroke.

Expected breadcrumbs:

### Folder

```
As you Go › Parent › Grandparent
```

Do not repeat the row's own name in the trailing breadcrumb.

### Shortcut/Link placement

```
As you Go › ... › containing folder
```

### Layout Item

```
As you Go › ... › containing folder › Window layout name
```

The whole layout is not itself searchable, but it is valid breadcrumb context.

## 0.5 Searchable text

V1 matching uses the display name only.

Do not rank against:

- breadcrumb;
- shortcut target path;
- URL;
- executable fingerprint;
- descriptor metadata.

If later approved, those become explicit product changes.

## 0.6 Normalization

Pin a single normalization function and unit-test it. Minimum:

```
Unicode normalize
case-fold/lowercase
trim
collapse repeated whitespace
```

Do not normalize the underlying display string shown in UI.

## 0.7 Ranking tiers

The ranking order is fixed:

```
Tier 0 — exact
Tier 1 — whole-name prefix
Tier 2 — word prefix
Tier 3 — fuzzy subsequence
no match
```

No fuzzy result may outrank a prefix result because of usage history.

Word-prefix behavior must be tested across:

```
spaces
hyphens
underscores
punctuation
multiple words
```

## 0.8 Tie-breaking

Within one relevance tier:

```
1. recency
2. frequency
3. normalized display name
4. breadcrumb
5. resultKey
```

The final deterministic fallback prevents list order from changing randomly across identical queries.

If the creator later specifies a different recency/frequency order, modify the pure ranking contract and tests only.

## 0.9 Synthetic performance corpus

Generate a representative synthetic workspace equivalent to roughly 10,000–20,000 searchable occurrences.

Include:

- deeply nested folders;
- duplicate shortcut placements;
- links;
- many layout-member occurrences;
- duplicate names;
- long names;
- fuzzy-match-heavy queries.

Measure only the pure query/ranking path after the index is built.

## 0.10 Performance gate

On the creator-relevant target machine or another agreed reference desktop:

```
20,000 indexed occurrences
1000 representative queries
```

Required target:

```
p95 query + ranking <= 8 ms
p99 <= 12 ms
no ordinary query >= 16 ms
```

Measure independently of DOM rendering.

Also record:

```
initial index build duration
full semantic rebuild duration
memory footprint
```

## STAGE 0 PASS GATE

Proceed with same-thread pure matching if the performance gate passes with comfortable margin.

## STAGE 0 WORKER FALLBACK

If the matcher cannot stay inside the budget, STOP UI implementation and move only the pure index/query engine to a Web Worker.

Suggested module:

```
public/app/quick-run/quick-run-worker.js
```

Worker requirements:

- immutable/versioned index payload;
- query sequence IDs;
- latest-query-wins;
- stale worker results discarded;
- no host calls;
- no native APIs;
- no DOM access;
- same pure ranking tests run against worker and direct modes.

Do not lower the latency target merely because the naïve implementation is slow.

# STAGE 1 — Canonical v1 index construction

Purpose: Convert current persisted state into the exact searchable universe.

Classification: HARD CORRECTNESS GATE

## 1.1 Folder inclusion

Include a group only if:

- it is not binned;
- none of its ancestors is binned.

## 1.2 Shortcut placement inclusion

For each shortcut record:

- classify `isWebLink(shortcut)`;
- enumerate every active placement;
- exclude a placement under a binned ancestor;
- emit one result per placement.

The existing model already expands shortcut records into one occurrence per active placement for normal workspace rendering. Reuse those semantics rather than collapsing linked placements.

## 1.3 Link classification

```
http/https target
→ type = link

everything else
→ type = shortcut
```

Do not duplicate the shortcut record/index.

## 1.4 Layout Item inclusion

For every active non-binned window layout:

- include every persisted arrangement member;
- result name = `member.descriptor.title`;
- result identity = layoutId + memberId;
- breadcrumb includes containing layout context.

Do not call:

```
windowCandidates()
resolveWindowDescriptor()
observeWindowCapability()
windowThumbnailCapability()
```

during indexing.

## 1.5 Row icons

Quick Run must show an icon without adding native work to the search path.

Allowed:

### Folder

- persisted/custom folder icon;
- existing normal folder fallback.

### Shortcut

- persisted shortcut icon if present;
- existing shortcut fallback otherwise.

### Link

- existing persisted/cached icon if already available;
- link fallback otherwise.

### Layout Item

- already-present in-memory member icon cache if available;
- static window/application placeholder otherwise.

Not allowed: opening Quick Run causes missing layout-member icons to hydrate through Papers.

Icon hydration is presentation enhancement, not search authority.

## 1.6 Whole-layout exclusion test

Given a layout `Work` with members `Chrome` and `VS Code`, the query `Work` must not return the whole layout merely because its name matches.

Layout name may only appear as the member breadcrumb.

## STAGE 1 EVIDENCE

Pure index snapshot tests must assert exact result keys and breadcrumbs for a fixture containing:

- nested folder;
- ordinary shortcut;
- linked shortcut with two placements;
- web link;
- window layout with two members;
- binned folder containing otherwise valid items;
- binned shortcut placement;
- binned window layout.

# STAGE 2 — Usage metadata for recency/frequency

Purpose: Implement tie-break history without coupling it to search-index identity.

Classification: CORE FEATURE

## 2.1 Define bounded usage records

Suggested shape:

```
{
  resultKey,
  lastUsedAt,
  useCount,
}
```

Do not persist query strings. Do not persist native window capability data.

## 2.2 Persistence location

Choose one bounded As-you-Go-owned durable location.

Recommended v1:

```
state.view.quickRunUsage
```

with normalization and a strict maximum record count.

Suggested cap:

```
2048–4096 result keys
```

If the project already develops a better per-project local preference store before this feature is implemented, reevaluate this placement explicitly rather than silently changing it.

## 2.3 Update policy

Increment usage only after a Quick Run action actually succeeds:

```
Folder navigation succeeded
Shortcut launch accepted
Link open accepted
Layout-item activation succeeded
Ctrl+Enter reveal completed
Shift+Enter add completed
```

A missing/ambiguous/denied layout member does not gain frequency.

## 2.4 Do not rebuild index for usage changes

Usage affects ranking only. Updating `lastUsedAt` / `useCount` must not rebuild the semantic search index.

## 2.5 Bound/prune

When over the cap:

- drop least-recently-used stale records first;
- do not allow usage history to grow unbounded.

Deleted result keys may be pruned opportunistically.

# STAGE 3 — Index invalidation architecture

Purpose: Keep Quick Run semantically current without rebuilding it for high-frequency irrelevant state.

Classification: HARD PERFORMANCE/CORRECTNESS CRITERION

## 3.1 Default strategy

Use whole semantic-index rebuild on a relevant searchable-data mutation.

Do not begin with complicated per-row incremental patches.

At 10k–20k occurrences, correctness is more important than avoiding an occasional bounded rebuild.

## 3.2 Local invalidation seam

Create one API, e.g. `quickRunIndex.invalidate(reason)`.

Every local mutation that changes Quick Run semantics routes through that seam.

## 3.3 Mutations that MUST invalidate/rebuild

### Folders

- [ ] create folder;
- [ ] delete/permanently remove folder;
- [ ] rename folder;
- [ ] move folder;
- [ ] bin folder;
- [ ] restore folder;
- [ ] any mutation changing its parent.

Folder rename/move can change breadcrumbs for every descendant, so full rebuild is appropriate.

### Shortcuts/Links

- [ ] create shortcut;
- [ ] create link;
- [ ] delete shared shortcut record;
- [ ] rename shortcut;
- [ ] target change;
- [ ] URL/non-URL classification change;
- [ ] create placement;
- [ ] remove placement;
- [ ] move placement;
- [ ] bin placement;
- [ ] restore placement;
- [ ] fork placement where occurrence identity changes;
- [ ] collapse placements where occurrence identity changes.

### Window layouts relevant to members

- [ ] create layout if it receives/contains searchable members;
- [ ] delete layout;
- [ ] move layout;
- [ ] bin layout;
- [ ] restore layout;
- [ ] layout name change, because layout name is part of member breadcrumbs;
- [ ] add member;
- [ ] remove member;
- [ ] change member descriptor title;
- [ ] change member descriptor executable fingerprint;
- [ ] descriptor replacement/rebinding.

## 3.4 Mutations that MUST NOT rebuild

This list is explicit because high-frequency false invalidation is a known performance risk.

Do not rebuild for:

- [ ] graph x/y positions;
- [ ] graph rest positions;
- [ ] graph physics ticks;
- [ ] graph simulation cooling/heating;
- [ ] toolbar position;
- [ ] workspace selection;
- [ ] selection anchor;
- [ ] current folder navigation;
- [ ] breadcrumb navigation;
- [ ] graph-expanded folder state;
- [ ] trail-expanded folder state;
- [ ] Bin mode view toggle by itself;
- [ ] icon-size preference;
- [ ] theme/preferences unrelated to Quick Run hotkey;
- [ ] prompt-library changes;
- [ ] Set membership changes while Sets remain excluded;
- [ ] Set rename/creation while Sets remain excluded.
- [ ] activeWindowLayoutId;
- [ ] window-layout member state normal/minimized;
- [ ] window-layout member bounds;
- [ ] window-layout card size;
- [ ] window-layout member order;
- [ ] capability cache changes;
- [ ] helper restart by itself;
- [ ] hover;
- [ ] preview state;
- [ ] thumbnail result;
- [ ] icon hydration alone;
- [ ] widget open/close;
- [ ] detached/attached presentation state;
- [ ] recency/frequency usage metadata.

Window-layout bounds/state are updated by live observation and are specifically not searchable semantics. The model separates those data-only member patches from descriptor identity.

## 3.5 External/peer document installs

The current workspace supports external document installs from other As-you-Go surfaces while preserving local navigation/session state. Quick Run must react to semantic changes arriving through this path as well.

Implement a pure searchable semantic comparison for external installs. It should compare only fields relevant to the Quick Run index.

Do not use full-document equality.

Do not allow a remote window-layout bounds observation to rebuild a 20,000-entry search index every 500 ms.

## 3.6 External semantic signature

A valid semantic projection may include:

```
groups:
  id
  name
  parentId
  bin status

shortcuts:
  shortcut id
  name
  target
  placement id
  parentId
  bin status

window layouts:
  layout id
  name
  parentId
  bin status
  members:
    member id
    descriptor version
    descriptor title
    executable fingerprint
```

Explicitly omit:

```
bounds
normal/minimized state
cardSize
activeWindowLayoutId
icons
view positions
selection
runtime fields
```

## 3.7 Open Quick Run during rebuild

When semantic index changes while Quick Run is open:

1. atomically replace index;
2. rerun current query;
3. preserve current filter if it still has matches;
4. otherwise fall back to All;
5. preserve highlighted resultKey if still present;
6. otherwise highlight first result.

## STAGE 3 GATE

Synthetic tests must prove:

```
100 state-only layout observation updates
→ 0 search-index rebuilds

one member descriptor rename
→ exactly 1 semantic rebuild
```

# STAGE 4 — Quick Run UI shell

Purpose: Build the interaction surface without yet enabling all actions.

Classification: CORE FEATURE

Suggested new modules:

```
public/app/quick-run/quick-run-controller.js
public/app/quick-run/quick-run-view.js
public/styles/quick-run.css
```

Integrate from `public/workspace-20260730b.js`.

Prefer a dedicated controller rather than adding another large inline block to the workspace entry.

## 4.1 Modal ownership

Quick Run is its own transient modal interaction layer.

While open, it owns printable keys, Escape, Enter, Ctrl+Enter, Shift+Enter, Tab/Shift+Tab and arrows; ordinary workspace hotkeys do not also fire.

## 4.2 Opening state

On open:

```
query = ''
filter = All
highlight = null
results = []
```

Focus input immediately.

## 4.3 Empty query

Evidence:

```
open Quick Run
→ no results
→ no chips requiring result data
→ no native/host call
```

## 4.4 Styling

Quick Run must be visually part of As-you-Go, not a Papers-native popup.

Required:

- one-line input;
- chips above rows;
- bounded result panel;
- icon/name/breadcrumb row;
- clear highlighted row;
- unavailable-state treatment;
- scrollable long result list.

Do not change graph layout to make room. Render Quick Run over/above the workspace.

## 4.5 No normal workspace render

Typing `a`, `ab`, `abc` must not call the full workspace `render()` three times.

Add an instrumentation test/spying seam proving:

```
100 Quick Run keystrokes
→ 0 graph update calls
→ 0 workspace full-render calls
```

# STAGE 5 — Hotkey integration

Purpose: Make Quick Run a normal As-you-Go workspace action.

Classification: HARD V1 UX CRITERION

Files:

```
public/app/hotkeys-model.js
public/app/interactions/keyboard-controller.js
public/workspace-20260730b.js
```

## 5.1 Add workspace action

Add `workspace.quick-run` to the existing hotkey catalog.

Pick the actual default chord only if already approved by the creator; otherwise leave the binding explicit/TODO rather than inventing one silently.

## 5.2 Keyboard controller seam

The ordinary keyboard controller should invoke `quickRun.open()` only when:

- Quick Run is closed;
- no existing editor/confirm/prompt modal owns the key;
- event is not native typing inside another editable control.

While Quick Run is open, its controller gets first refusal for its own keys.

## 5.3 Focus scope proof

Verify:

```
As-you-Go focused
+ hotkey
→ Quick Run opens
```

and:

```
another desktop app focused
+ same keys
→ As-you-Go renderer does not magically receive it
```

The second result is expected v1 behavior.

Documentation note: OS-global activation requires a future Papers accelerator/routing feature; it must not move Quick Run indexing into Papers.

# STAGE 6 — Query, filtering and keyboard navigation

Purpose: Finish the pure interaction semantics before actions.

Classification: CORE FEATURE

## 6.1 Printable typing

Every query change:

1. normalize query;
2. run pure matcher;
3. calculate All results;
4. derive chip availability;
5. apply current type filter;
6. select/preserve highlight;
7. patch Quick Run DOM only.

## 6.2 Tab behavior

Tab must never insert a tab character into the search input.

Test complete wraparound:

```
All → Folders → Shortcuts → Links → Layout Items → All
```

but skip types with no matches. Reverse with Shift+Tab.

## 6.3 Highlight and scrolling

Arrow navigation must keep the highlighted row visible.

Wheel/trackpad scrolling must have an explicitly tested rule:

- scrolling list changes viewport normally;
- when a row becomes selected by intended scroll behavior, its selection is deterministic;
- keyboard highlight never points to an off-list stale row.

Do not rely on `:hover` as authoritative keyboard selection.

## 6.4 Mouse

If pointer selection is supported:

- moving over row may update highlight;
- click executes same default path as Enter;
- there is one execution implementation, not duplicate mouse/keyboard logic.

## STAGE 6 EVIDENCE

DOM/controller test sequence:

```
query produces 5 rows
highlight row 1
Down -> 2
Down -> 3
Up -> 2
Tab -> next available type
first result in that type highlighted
Shift+Tab -> prior type
Escape -> controller closed and query cleared
```

# STAGE 7 — Default actions for Folder, Shortcut and Link

Purpose: Reuse current As-you-Go behavior rather than reinvent execution.

Classification: CORE FEATURE

Primary existing module: `public/app/workspace-commands.js`

The current command layer already navigates folders through session navigation, launches ordinary shortcuts, and routes HTTP/HTTPS shortcuts through `host.openWebLink()`.

## 7.1 Execution-time authority gate

Before every action:

```
selected resultKey
→ read CURRENT state
→ resolve current object by stable IDs
→ verify it is still active/non-binned and still of expected type
→ only then execute
```

If stale, report that the Quick Run result changed or no longer exists. Do not execute a stale indexed payload. Requery immediately.

## 7.2 Folder Enter

Given `folder:<groupId>`, re-read the current groupId.

Verify:

- group exists;
- not binned;
- no binned ancestor.

Then perform the same navigation semantics as current `navigateToFolder()`.

On success: close Quick Run, record usage.

## 7.3 Shortcut Enter

Given `shortcut:<placementId>`, re-read the placement.

Verify:

- placement exists;
- active;
- under active hierarchy;
- underlying shortcut still non-web.

Launch using the existing shortcut execution path.

## 7.4 Link Enter

Given `link:<placementId>`, re-read placement and current shortcut. Verify `isWebLink()` still true.

If its target was edited from URL to non-web between query and Enter:

- do not execute from stale classification;
- rebuild/requery;
- tell controller the result changed.

Otherwise open through the existing `host.openWebLink()` path.

# STAGE 8 — Ctrl+Enter reveal-inside-As-you-Go

Purpose: Implement the deliberately new meaning of Reveal.

Classification: CORE FEATURE

Do not route this through:

```
workspace.reveal-selection
commands.revealSelection()
revealShortcut()
host.revealShortcut()
```

Those existing paths reveal the underlying target in the OS/file manager.

Suggested new module or command seam:

```
public/app/quick-run/quick-run-reveal.js
```

or a clearly named Quick Run-specific command inside `workspace-commands.js`.

## 8.1 Folder reveal

Navigate to the containing parent folder, then select the folder occurrence.

If the folder is at root: navigate root, select folder.

## 8.2 Shortcut/Link reveal

Navigate to that exact placement's parent folder, then select `placementId` — not another placement of the same shortcut.

This is why one-result-per-placement is mandatory.

## 8.3 Layout Item reveal

Navigate to the containing layout's folder. Then:

- reveal/select the containing window-layout card;
- visually identify/highlight the specific member within the card.

Do not activate/focus the native application as part of Ctrl+Enter.

## 8.4 Explorer vs graph presentation

Quick Run reveal must be truthful in both As-you-Go layouts. Define the expected visible result separately for `explorer` and `graph`.

For graph mode, use existing graph/item visibility/centering primitives if available; do not create a second graph camera implementation inside Quick Run.

If no existing "center this node" primitive exists, extract one from the graph controller rather than querying/manipulating SVG transforms ad hoc.

## 8.5 Evidence

After Ctrl+Enter:

```
session.currentId == result parent
session.selected contains exact occurrence ID
target occurrence is visibly identifiable
Quick Run is closed
```

For a Layout Item also assert the correct memberId, not merely the correct layout, receives the reveal cue.

# STAGE 9 — Papers activateWindowCapability

Purpose: Add the one host operation Quick Run cannot perform locally.

Classification: HARD LAYOUT-ITEM LAUNCH CRITERION

Quick Run needs: activate/focus this already-resolved exact window capability; restore it first if minimized.

Do not make the Backpack implement observe → decide → restore/raise as separate round trips if the helper can make the decision atomically.

The current Papers capability stack already has enumerated helper methods and a single-request atomic toggle path; activation should follow the same narrow typed design.

## 9.1 New method name

Recommended: `activate`

```
Page-facing Backpack bridge: activateWindowCapability(capability)
Project request:             papers:project:window-activate-capability
Papers IPC:                  papers:window-capability:activate
Helper method:               activate
```

## 9.2 Required native contract

In one helper request:

```
validate token identity
→ read current native state
→ if minimized:
     restore
  else:
     raise/focus
→ return typed success
```

No thumbnail. No preview frame seed. No desktop enumeration. No arbitrary HWND from renderer.

The current native helper already defines `Restore-WhWindow()` as restore plus Raise and has a native Raise operation used when applying bounds, so activation should reuse those trusted primitives rather than inventing another focus mechanism.

## 9.3 Files expected to change — As-you-Go

```
public/app/host/host-bridge.js
```

Add `activateWindowCapability(capability)` beside existing observe/toggle/minimize/restore/resolve methods. The bridge currently exposes the capability operations through enumerated Papers project request names.

## 9.4 Files expected to change — Papers

```
src/preload/backpackProject.ts
src/main/ipc/windowCapabilityIpc.ts
src/main/windows/windowCapabilityService.ts
src/main/windows/windowCapabilityClient.ts
src/main/windows/windowCapabilityTypes.ts
src/main/windows/windowHelperFactory.ts
resources/window-helper/window-helper.ps1
resources/window-helper/window-capability.ps1
```

The existing preload already parses opaque capabilities and maps project requests to enumerate/bind/observe/toggle/minimize/restore/etc.; activation should follow that exact trust boundary.

## 9.5 Helper hash pins

Because the helper scripts are resource-hash pinned, after changing helper files update both expected resource hash locations used by Papers:

```
src/main/windows/windowHelperResource.ts
resources/window-helper/manifest.json
```

Do not finish the Papers commit until actual helper bytes, compiled expected hash and manifest hash all agree.

## 9.6 Typed outcomes

At minimum support:

```
success
missing
denied
helper-unavailable
malformed/internal typed failure as existing protocol allows
```

`ambiguous` belongs to descriptor resolution before activation, not to activation of an already-issued exact capability.

## 9.7 Host tests

Pin:

### Normal window

```
activate
→ Raise called
→ Restore not called
```

### Minimized window

```
activate
→ Restore called
→ window raised/focused
```

### Stale/reused identity

```
activate
→ missing/denied
→ no other HWND raised
```

### Renderer authority

Malformed page capability cannot smuggle HWND, PID or path through the new operation.

## STAGE 9 GATE

Do not enable Layout Item Enter until the complete operation works end-to-end through the packaged Papers capability stack.

# STAGE 10 — Layout Item default action and availability state

Purpose: Make persisted window members searchable without live probing.

Classification: HARD FEATURE CRITERION

## 10.1 Availability state

Each Quick Run layout-member occurrence may have ephemeral session availability:

```
unknown
available
unavailable
```

Default: `unknown`

Do not infer "not running" from persisted `member.state`. Persisted normal/minimized is arrangement state, not a guarantee that the native window currently exists.

## 10.2 No probes while searching

Typing `c`, `ch`, `chr`, `chrome` must cause:

```
0 windowCandidates
0 resolveWindowDescriptor
0 observeWindowCapability
0 activateWindowCapability
0 thumbnail calls
```

## 10.3 Selection-time resolution

On Enter for `layout-member:<layoutId>:<memberId>`:

1. re-read layout by layoutId;
2. verify layout is still active/non-binned;
3. re-read member by memberId;
4. verify descriptor still matches the indexed result identity;
5. use existing cached `capabilityForMember()`/equivalent fast path if valid;
6. otherwise call `host.resolveWindowDescriptor(currentDescriptor)`;
7. only after successful unique resolution call `host.activateWindowCapability(capability)`.

The existing member capability path already caches by layout/member and resolves the persisted descriptor only on a miss. Reuse/extract that seam rather than building Quick Run-specific native resolution.

## 10.4 Exact resolution outcomes

### Unique and activation succeeds

```
availability = available
close Quick Run
record successful use
```

### Missing

```
availability = unavailable
reason = not-running/missing
keep Quick Run open
do not remove persisted result
do not silently do nothing
```

### Ambiguous

```
availability = unavailable
reason = multiple-matching-windows
keep Quick Run open
do not choose one
```

### Helper unavailable

```
availability = unavailable
reason = helper unavailable
keep Quick Run open
```

### Denied

```
availability = unavailable
reason = permission denied/unsupported
keep Quick Run open
```

## 10.5 Availability invalidation

Availability is ephemeral UI knowledge, not durable Backpack truth.

Reset to `unknown` when:

- descriptor changes;
- member is removed/re-added;
- page reloads;
- an operation reports stale/missing after previously successful use.

Do not write availability into persisted layout members.

## 10.6 Fresh capability test

Fixture: member exists in persisted layout, no runtime capability cached.

Search must show it. Only Enter may call descriptor resolution.

## 10.7 Ambiguity test

Two native windows satisfy the descriptor. Expected:

```
result remains in Quick Run
row becomes unavailable
message says multiple matches
0 activate calls
```

# STAGE 11 — Shift+Enter: add Layout Item to active window layout

Purpose: Implement the only non-default modifier action enabled in v1.

Classification: CORE FEATURE

The model's `addWindowLayoutMember()` is data-only and takes a persisted member shape; it does not itself launch or mutate a native window. Reuse that model operation.

## 11.1 Preconditions

Before enabling Shift+Enter for a Layout Item:

- source occurrence still exists;
- active runtime recording context has a valid active layout;
- destination layout exists and is active/non-binned;
- destination is not read-only due to surface handoff/conflict;
- duplicate rule allows the addition.

## 11.2 Do not resolve native window unnecessarily

The source result already contains a persisted descriptor. Adding the same descriptor-bound window to another layout is primarily a data operation.

Do not run desktop enumeration merely to copy the descriptor if the current model contract allows the persisted descriptor to be reused.

If initial bounds/state are required for a truthful member creation, use already-known persisted source arrangement as the v1 starting arrangement unless a separate product requirement explicitly demands fresh observation.

## 11.3 New member identity

Never copy the source `member.id`. Destination receives a new membership ID. The descriptor is reused.

## 11.4 Duplicate rule

Pin one explicit rule. Recommended:

```
same descriptor already present in destination layout
→ do not add
→ visible "Already in active layout"
```

Do not silently create two identical members inside one layout unless current window-layout semantics explicitly allow that and the creator approves it.

## 11.5 No active layout

Shift+Enter is visibly disabled. Reason: `No active window layout`.

## 11.6 Non-Layout results

Folder/Shortcut/Link show Shift+Enter unavailable.

Do not launch a Shortcut hoping to infer which new window it creates. That is a different feature.

# STAGE 12 — Stale index and execution-race defenses

Purpose: Guarantee Quick Run never executes an object merely because it existed when the query was ranked.

Classification: HARD CORRECTNESS CRITERION

## 12.1 Every action revalidates

Mandatory for Enter, Ctrl+Enter, Shift+Enter and mouse activation.

Pattern:

```
resultKey
→ parse stable IDs
→ CURRENT state lookup
→ current active/non-binned check
→ current type/classification check
→ act
```

## 12.2 Rename race

```
Quick Run query shows "Chrome"
peer renames it before Enter
Enter
```

Expected: old indexed copy is not trusted; current object wins; query/index reruns; no stale action target.

## 12.3 Move race

Shortcut placement moves to another folder while highlighted. Ctrl+Enter must reveal its new parent, not old breadcrumb.

## 12.4 Bin race

Item is binned while highlighted. Enter must not resurrect/open it from stale Quick Run state. Requery removes it.

## 12.5 Member removal race

Layout member is removed while highlighted. Enter:

```
0 descriptor resolution
0 native activation
result disappears/requery
```

## 12.6 Classification race

Link target changes to a local shortcut target before Enter. Do not open stale URL. Re-read current shortcut and route according to current type.

# STAGE 13 — Multi-surface correctness

Purpose: Make Quick Run behave correctly with As-you-Go open in multiple Papers surfaces.

Classification: CORE FEATURE

Quick Run UI state is local to one surface:

```
open/closed
query
filter
highlight
availability UI
```

Do not synchronize those through the shared document. Searchable content comes from the current installed document state.

## 13.1 Peer rename

Surface A has Quick Run open. Surface B renames a folder. After A installs the peer document:

```
index updates
current query reruns
old name disappears
new name appears if matching
```

## 13.2 Peer move

Breadcrumb updates without moving A's local current navigation.

## 13.3 Peer layout observation

Surface B updates only native member bounds/state. Surface A: `0 Quick Run rebuilds`.

## 13.4 Usage metadata conflict

If usage history is stored in shared `view.quickRunUsage`, test two surfaces using Quick Run concurrently.

The result may tolerate last-write/merged tie-break metadata loss only if no workspace item data is lost.

If current coordinator merge semantics make frequent usage writes problematic, move usage metadata to a better bounded per-project local store before launch rather than weakening document consistency.

# STAGE 14 — Performance integration gate

Purpose: Prove the real UI remains responsive with graph physics and normal workspace load.

Classification: HARD LAUNCH QUALITY GATE

The pure Stage 0 benchmark is necessary but not sufficient.

## 14.1 Real renderer corpus

Load a synthetic/fixture workspace representing 10,000–20,000 searchable occurrences with graph mode active.

## 14.2 Measure keystroke-to-results

Measure:

```
keydown/input event timestamp
→ Quick Run result DOM committed
```

Target `p95 <= 16 ms`; preferred `p95 <= 12 ms` on creator-relevant hardware.

No repeated long tasks above one frame for ordinary queries.

## 14.3 Graph isolation evidence

During 100 rapid Quick Run query changes assert:

```
0 native window resolutions
0 thumbnails
0 host capability requests
0 graph simulation restarts caused by Quick Run
0 full workspace renders caused by query change
```

## 14.4 Rebuild performance

Trigger a semantic rename in a 20k-result workspace. Measure:

```
semantic mutation
→ new index active
→ current query reranked
```

Record duration.

If rebuild itself produces unacceptable visible typing stalls while Quick Run is open, build index asynchronously or move rebuild/search projection to the Worker architecture.

## 14.5 State-only storm

Simulate 1000 member bounds/state updates. Expected: `0 semantic index rebuilds`.

This is a hard regression test.

# STAGE 15 — Accessibility and keyboard quality

Purpose: Make Quick Run genuinely keyboard-first rather than merely key-operable.

Classification: LAUNCH QUALITY GATE

## 15.1 Focus

On open: `document.activeElement == Quick Run input`.

On close: return focus to the prior appropriate As-you-Go workspace element.

## 15.2 Semantics

Use appropriate combobox/listbox semantics or equivalent accessible pattern.

Required:

- input has meaningful accessible name;
- list exposes result count;
- active row is announced;
- disabled modifier actions have accessible reason where surfaced;
- availability state can be conveyed without relying only on color.

## 15.3 No keyboard leakage

While Quick Run is open, `Ctrl+Enter`, `Enter`, `Delete`, `G`, `Ctrl+G` must not trigger underlying workspace actions unless they are explicitly Quick Run commands.

## 15.4 IME/input correctness

Do not intercept Enter/keys incorrectly during active text composition.

Test with an IME/composition event sequence if the creator uses or may use non-Latin input.

# STAGE 16 — Error/status behavior

Purpose: Make failures visible and truthful.

Classification: CORE FEATURE

## 16.1 Successful action

Close Quick Run after successful folder navigate, shortcut launch, link open, native window activation, reveal, or add-to-layout.

## 16.2 Failed Layout Item activation

Keep Quick Run open. Show row/status reason. Examples:

```
Window is not currently available
Multiple matching windows
Window helper unavailable
Window access denied
```

Never silently close Quick Run on failure.

## 16.3 Stale result

If a result disappears between query and execution:

```
That item changed or no longer exists
```

Requery automatically.

## 16.4 Host failures

Do not expose raw helper/internal stack traces as the main Quick Run UX. Use typed existing host outcomes.

# STAGE 17 — Tests that must exist before completion

Classification: HARD DEFINITION-OF-DONE REQUIREMENTS

## Index domain

- [ ] folder indexed.
- [ ] nested folder breadcrumb correct.
- [ ] binned folder excluded.
- [ ] descendants under binned folder excluded.
- [ ] one ordinary shortcut placement indexed.
- [ ] linked shortcut with 3 placements gives 3 results.
- [ ] placement breadcrumbs independent.
- [ ] HTTP shortcut classified as Link.
- [ ] HTTPS shortcut classified as Link.
- [ ] non-web shortcut classified as Shortcut.
- [ ] one layout member indexed.
- [ ] same descriptor in two layouts gives 2 results.
- [ ] whole layout never appears.
- [ ] binned layout member excluded.
- [ ] prompts excluded.
- [ ] Bin entries excluded.
- [ ] Sets excluded, with a test/comment referencing the recorded product decision.

## Ranking

- [ ] exact beats prefix.
- [ ] prefix beats word-prefix.
- [ ] word-prefix beats subsequence.
- [ ] subsequence beats no match.
- [ ] recency never moves a lower tier above a higher tier.
- [ ] frequency never moves a lower tier above a higher tier.
- [ ] deterministic fallback stable.
- [ ] duplicate names remain separate by occurrence/resultKey.

## Filters

- [ ] chips only for matched types.
- [ ] Tab forward.
- [ ] Shift+Tab backward.
- [ ] zero-match active filter falls back to All.
- [ ] fallback highlights first All row.

## Empty query

- [ ] empty query gives zero results.
- [ ] no recents home screen.
- [ ] no host calls.

## Actions

- [ ] Folder Enter navigates.
- [ ] Shortcut Enter launches.
- [ ] Link Enter opens URL.
- [ ] Ctrl+Enter Folder reveals exact folder occurrence.
- [ ] Ctrl+Enter Shortcut reveals exact placement.
- [ ] Ctrl+Enter Link reveals exact placement.
- [ ] Ctrl+Enter Layout Item reveals containing layout + member.
- [ ] Shift+Enter disabled for Folder.
- [ ] Shift+Enter disabled for Shortcut.
- [ ] Shift+Enter disabled for Link.
- [ ] Shift+Enter Layout Item adds new membership when valid.
- [ ] no active layout disables Shift+Enter.
- [ ] duplicate destination membership reports visible status.

## Stale-index execution

- [ ] rename-before-Enter.
- [ ] move-before-Ctrl+Enter.
- [ ] bin-before-Enter.
- [ ] delete-before-Enter.
- [ ] layout-member-remove-before-Enter.
- [ ] Link→Shortcut target edit before Enter.

Every test proves current-state revalidation.

## Availability/native

- [ ] untouched Layout Item is unknown.
- [ ] searching does zero native resolution.
- [ ] first Enter resolves.
- [ ] unique resolution + activate success -> available.
- [ ] missing -> unavailable.
- [ ] ambiguous -> unavailable.
- [ ] ambiguous -> zero activate calls.
- [ ] result remains searchable after missing/ambiguous outcome.
- [ ] descriptor change resets prior availability.

## Papers activation

- [ ] normal target raises/focuses.
- [ ] minimized target restores then activates.
- [ ] stale identity cannot activate replacement HWND.
- [ ] malformed capability rejected.
- [ ] page cannot supply HWND/PID/path.
- [ ] helper-unavailable typed failure.
- [ ] helper SHA-256 pins updated and validated.

## Invalidation

- [ ] folder rename rebuilds.
- [ ] folder move rebuilds.
- [ ] shortcut rename rebuilds.
- [ ] shortcut target classification change rebuilds.
- [ ] placement move rebuilds.
- [ ] layout member add/remove rebuilds.
- [ ] descriptor change rebuilds.
- [ ] layout name change rebuilds member breadcrumbs.
- [ ] layout bounds update does not rebuild.
- [ ] layout minimize/restore state update does not rebuild.
- [ ] graph position update does not rebuild.
- [ ] selection update does not rebuild.
- [ ] capability cache update does not rebuild.
- [ ] icon hydration does not rebuild.
- [ ] Quick Run usage metadata does not rebuild.
- [ ] prompt change does not rebuild.
- [ ] Sets change does not rebuild while Sets excluded.

## Performance

- [ ] 10k corpus measured.
- [ ] 20k corpus measured.
- [ ] pure p95 ≤ 8 ms or Worker fallback used.
- [ ] no ordinary pure query ≥ 16 ms.
- [ ] integrated renderer p95 target satisfied.
- [ ] typing causes zero graph reheat/full render.
- [ ] state-only layout observation storm causes zero rebuilds.

# STAGE 18 — The Sets question must be recorded, not forgotten

Before final launch, confirm Section 4 records the creator's explicit answer.

**Recorded 2026-09-08: the creator explicitly confirmed Sets remain excluded from v1.**

Not allowed: "nobody remembered to ask."

Keep a test proving that exclusion so a future refactor does not accidentally surface them.

# STAGE 19 — Product documentation

Classification: HARD PRODUCT-HONESTY CRITERION

Document:

- Quick Run searches persisted As-you-Go objects, not the desktop.
- Layout Items can appear even when their application is no longer running.
- Quick Run does not continuously probe window availability.
- A Layout Item's availability is determined when the creator tries to activate it.
- Duplicate names with different breadcrumbs are intentional occurrences.
- Links are shortcuts classified by URL target.
- Whole window layouts are excluded.
- Prompts are excluded.
- Bin contents are excluded.
- Sets are excluded per the recorded creator decision.
- V1 hotkey works when As-you-Go has focus.
- OS-global invocation is a separate future Papers feature.
- Ctrl+Enter reveals inside As-you-Go, not in the operating-system file manager.
- Shift+Enter is only meaningful for Layout Items in v1.

# Definition of Done

Quick Run is complete only when all conditions below are true.

## Search behavior

- [ ] Hotkey opens one empty focused Quick Run line.
- [ ] Empty query shows no results.
- [ ] First keystroke produces ranked results.
- [ ] Search remains responsive with 10k–20k searchable occurrences.
- [ ] Exact > prefix > word-prefix > fuzzy subsequence.
- [ ] Recency/frequency only break ties inside a tier.
- [ ] Result ordering is deterministic.
- [ ] One shortcut placement = one result.
- [ ] One layout-member occurrence = one result.
- [ ] Links use the shortcut index and are classified, not duplicated.

## Filters

- [ ] All/Folders/Shortcuts/Links/Layout Items behave exactly as specified.
- [ ] Only types with matches produce chips.
- [ ] Tab/Shift+Tab cycles only available chips.
- [ ] Disappearing active filter falls back to All.

## Actions

- [ ] Folder Enter navigates.
- [ ] Shortcut Enter launches.
- [ ] Link Enter opens web link.
- [ ] Layout Item Enter uniquely resolves and activates/restores the exact native window.
- [ ] Missing/ambiguous Layout Item remains visible and reports failure honestly.
- [ ] Ctrl+Enter navigates-and-selects the exact As-you-Go occurrence.
- [ ] Ctrl+Enter never invokes OS reveal.
- [ ] Shift+Enter only works for Layout Items.
- [ ] Shift+Enter never silently does nothing for unsupported result types.

## Native boundary

- [ ] Typing causes zero native probes.
- [ ] Indexing causes zero native probes.
- [ ] Layout-item capability resolution begins only on execution.
- [ ] Papers exposes a narrowly typed `activateWindowCapability`.
- [ ] Activation restores only when minimized and otherwise raises/focuses.
- [ ] Capability identity remains fail-closed.
- [ ] Helper resource hash pins are correct.

## Correctness under mutation

- [ ] Every action revalidates against current state.
- [ ] Rename/move/bin/delete races cannot execute stale index payload.
- [ ] Peer document semantic changes refresh Quick Run.
- [ ] High-frequency member bounds/state updates do not rebuild the index.
- [ ] Graph/session/view changes do not unnecessarily rebuild the index.

## Performance

- [ ] Pure 20k benchmark meets budget or Worker fallback is implemented.
- [ ] Integrated typing stays inside agreed frame-latency budget.
- [ ] Quick Run typing never reheats graph physics.
- [ ] Quick Run typing never calls full workspace `render()`.
- [ ] No native/IPC work occurs on keystrokes.

## Scope/product honesty

- [ ] No prompts.
- [ ] No whole layouts.
- [ ] No Bin.
- [ ] Sets decision explicitly recorded (excluded; confirmed 2026-09-08).
- [ ] No OS-global hotkey in v1.
- [ ] No Papers-level universal search architecture.
- [ ] No live window availability scanning.

# Creator acceptance walk

Run this on a real creator-sized workspace, not only test fixtures.

## Setup

Create or use a workspace containing:

- several nested folders;
- at least one shortcut linked into two folders;
- at least one web link;
- at least two window layouts;
- at least one same application/window represented in multiple layout occurrences where valid;
- one persisted layout member whose native application is currently closed;
- enough synthetic/real data to stress normal search performance.

## Walk

1. Focus the As-you-Go workspace.
2. Press the configured Quick Run hotkey.
3. Verify one empty search line appears and nothing else is selected or changed.
4. Type the beginning of a folder name.
5. Verify results appear immediately.
6. Verify exact/prefix ordering.
7. Verify each row contains icon, name and breadcrumb.
8. Search for a duplicated linked shortcut.
9. Verify each placement appears separately with its own breadcrumb.
10. Press Tab repeatedly.
11. Verify only matched type chips participate.
12. Cause the selected chip type to lose all matches by typing another character.
13. Verify filter falls back to All and first All result highlights.
14. Use ArrowUp/ArrowDown.
15. Verify highlight changes immediately and stays visible.
16. Select a Folder and press Enter.
17. Verify As-you-Go navigates into it.
18. Reopen Quick Run and launch a normal Shortcut.
19. Reopen Quick Run and open a Link.
20. Reopen Quick Run and select a shortcut placement with Ctrl+Enter.
21. Verify As-you-Go navigates to the exact placement and selects it.
22. Verify no OS file-manager reveal occurred.
23. Reopen Quick Run and select a Layout Item with Ctrl+Enter.
24. Verify its containing layout is revealed and the exact member is identifiable.
25. Reopen Quick Run and select a currently running Layout Item with Enter.
26. Verify the application window immediately becomes active.
27. Minimize that native application.
28. Invoke it again from Quick Run.
29. Verify it restores and becomes active.
30. Search for the persisted member whose application is closed.
31. Verify it still appears without being falsely labelled "Not running" before selection.
32. Press Enter.
33. Verify Quick Run stays open and truthfully marks/reports that the window is unavailable.
34. If possible, create two ambiguous matching native windows for one descriptor.
35. Press Enter on that result.
36. Verify neither native window is chosen automatically.
37. Activate a window layout.
38. Reopen Quick Run.
39. Select a Layout Item from another layout.
40. Press Shift+Enter.
41. Verify a new membership is added to the active layout according to the duplicate rule.
42. Highlight a Folder/Shortcut/Link and hold Shift.
43. Verify the add-to-layout action is visibly unavailable.
44. Rename an indexed object from another As-you-Go surface while Quick Run remains open.
45. Verify the result refreshes without disturbing that surface's local navigation.
46. Generate repeated window-layout observation bounds/state changes.
47. Verify Quick Run remains responsive and the semantic index does not rebuild.
48. Enter graph mode.
49. Type rapidly into Quick Run.
50. Verify graph physics does not reheat or hitch because of search.
51. Test a 10k–20k occurrence workspace.
52. Confirm measured query and integrated input latency meet the performance gates.
53. Press Escape from a populated Quick Run.
54. Verify the UI disappears, no result executes, and the underlying workspace remains otherwise untouched.
55. Reopen Quick Run and verify no empty-query recents/home screen appears.
56. Confirm the recorded Sets product decision matches the shipped behavior.

The feature is done only when this entire acceptance walk succeeds, the performance measurements pass, and the creator confirms that Quick Run feels immediate enough to use as the primary fast-access path inside As-you-Go.

# Open items to settle before implementation begins

- [x] **Sets decision** — resolved 2026-09-08: excluded from v1.
- [ ] **Pin the default workspace hotkey chord.** Not chosen yet; do not invent one silently.
