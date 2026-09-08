# Adopted Window Surfaces — Complete Implementation Checklist

> Authored by the audit reviewer on 2026-09-08 and saved here verbatim (only
> rendering artefacts removed). Written to stand alone: a future reader needs no
> access to the conversation that produced it.

Feature: Adopt foreign application windows as first-class Papers workspace surfaces
Architecture: Managed top-level follower windows; no cross-process reparenting
Starting baselines:

- Papers-3 main: cbe2a75
- as-you-go-backpack main: 8000c88

Status: Future feature. No implementation should begin without reading this document end-to-end.

# 0. Product contract

An adopted window surface is a real top-level window owned by another application.

Papers does not reparent it, convert it to WS_CHILD, own its message loop, or pretend it is an Electron WebContents.

Papers instead owns:

- which Papers workspace/tab/group the foreign window belongs to;
- whether it is currently visible;
- the screen rectangle where it lives;
- its Z-order relationship with the Papers host;
- recovery if Papers crashes while the window is hidden or moved;
- persistent descriptor-based reconnection across helper/Papers restarts.

The foreign application continues to own:

- its HWND;
- its process;
- its native input/focus;
- its accessibility tree;
- its dialogs and owned windows;
- its own application lifecycle.

The visual goal is:

A foreign application can appear as a Papers tab or split pane and follow that pane closely enough that, during normal use, it feels like part of the Papers workspace.

The architectural truth remains:

It is always a separate top-level application window.

# 1. Non-negotiable invariants

These are HARD LAUNCH CRITERIA.

- [ ] No SetParent, WS_CHILD, cross-process reparenting, or foreign-window style mutation is required for the feature to function.
- [ ] Papers never persists an HWND or helper-session runtime capability as durable surface identity.
- [ ] Persisted foreign-window identity uses the existing descriptor model and is re-resolved fail-closed.
- [ ] Every native mutation revalidates the exact current foreign-window identity.
- [ ] A foreign window is never made HWND_TOPMOST merely to preserve the embedding illusion.
- [ ] When Papers is behind another application, adopted windows must remain behind that unrelated application.
- [ ] Closing/removing a foreign tab releases the application window; it does not close the application.
- [ ] Papers crashing while foreign windows are hidden or moved must not permanently strand them.
- [ ] A crash recovery guardian and durable recovery journal exist before long-lived hiding ships.
- [ ] A hidden adopted window can recover even if the Papers main process dies without executing graceful cleanup.
- [ ] Helper changes update both SHA-256 pin locations: `Papers-3/src/main/windows/windowHelperResource.ts` and `Papers-3/resources/window-helper/manifest.json`.
- [ ] Existing project surfaces continue to work with old topology files after schema migration.
- [ ] A foreign surface has no fake Backpack projectId and is not registered as if it were a WebContents IPC sender.
- [ ] Elevated windows which Papers cannot safely control fail adoption cleanly.
- [ ] Ambiguous descriptor resolution never silently chooses one matching application window.
- [ ] Closing or restarting Papers restores/reconnects adopted applications without changing which executable/window identity was adopted.

# 2. Product honesty — what this feature does NOT make seamless

These limitations must be documented in the product before launch.

- [ ] Tell the creator/user that adopted applications remain separate Windows top-level windows.
- [ ] Tell the creator/user that Alt-Tab and the taskbar may continue to expose the adopted application separately.
- [ ] Tell the creator/user that clicking the adopted application makes that application — not Papers — the foreground application.
- [ ] Tell the creator/user that Papers renderer overlays cannot freely paint over a foreign top-level HWND.
- [ ] Tell the creator/user that the application's own titlebar/borders remain unless a future explicitly scoped feature changes that.
- [ ] Tell the creator/user that native menus, tooltips, dialogs, owned windows and popups may appear outside the Papers pane.
- [ ] Tell the creator/user that modal dialogs are not automatically adopted with the parent window.
- [ ] Tell the creator/user that drag-and-drop between Papers WebContents and foreign applications is not guaranteed as one unified DnD system.
- [ ] Tell the creator/user that screen readers/accessibility will still perceive the foreign application as its own application/window tree.
- [ ] Tell the creator/user that some applications may refuse or repeatedly override externally imposed bounds.
- [ ] Tell the creator/user that always-on-top applications may not participate correctly.
- [ ] Tell the creator/user that exclusive/full-screen applications are unsupported.
- [ ] Tell the creator/user that elevated/admin windows are unsupported when Papers is not equivalently elevated.
- [ ] Tell the creator/user that applications with unusual self-positioning/focus behavior may be rejected as unsuitable for adoption.
- [ ] Tell the creator/user that identical windows which cannot be distinguished by the persisted identity model may require explicit reconnection.

Launch gate: the product must make these limitations discoverable before the feature is presented as finished.

# 3. Do NOT attempt in the first useful slice

This section exists specifically to prevent scope creep.

Do not add any of the following while proving or shipping the first adopted-window implementation:

- [ ] SetParent.
- [ ] WS_CHILD.
- [ ] WS_POPUP/style surgery.
- [ ] Foreign titlebar stripping.
- [ ] Custom non-client-area emulation.
- [ ] Full-screen application support.
- [ ] Elevated/admin-window support.
- [ ] Automatic adoption of modal dialogs.
- [ ] Automatic adoption of child/owned popups.
- [ ] Global drag-and-drop integration.
- [ ] Taskbar-hiding hacks.
- [ ] Alt-Tab suppression.
- [ ] Automatic relaunch of a closed foreign application.
- [ ] App-specific integrations for Chrome, VS Code, Office, etc.
- [ ] Cross-Papers-window foreign-surface transfer.
- [ ] True cross-process embedding.
- [ ] Accessibility-tree merging.
- [ ] Application-specific window-decoration removal.

Finish the generic follower architecture first.

# STAGE 0 — Viability proof

Purpose: Prove that top-level follower windows can convincingly track Papers before changing topology, persistence or crash recovery.

Classification: HARD GO/NO-GO GATE

No durable adopted-window feature work may proceed until this passes.

## 0.1 Build only a disposable experimental follower

Use the existing Papers window capability picker/resolution path to select one foreign top-level window.

Do not:

- persist it;
- hide it;
- change topology;
- change foreign styles;
- reparent it.

Build a temporary developer-only controller capable of:

1. resolving one selected foreign HWND through the existing capability system;
2. reading one Papers pane/content rectangle;
3. moving/resizing the foreign window to that rectangle;
4. placing it into the correct non-topmost Z-order relationship;
5. restoring its original bounds/state on release.

## 0.2 Prototype the new non-activating placement behavior

Do not use the existing placement behavior blindly if it raises/activates the target.

Prototype the exact required native invariant:

Reposition a verified foreign window to a target screen rectangle without activating it and without making it topmost.

The foreign window must form a contiguous Z-order block immediately above the Papers host while Papers is the active workspace, but ordinary unrelated applications must still be able to appear above both.

## 0.3 Prove geometry on real applications

Test at minimum:

- Notepad or another conventional Win32 application.
- VS Code or another Electron application.
- Chrome/Chromium or another complex multi-process desktop application.

For each application:

- [ ] Adopt the window.
- [ ] Move Papers continuously around one monitor.
- [ ] Resize Papers continuously.
- [ ] Resize the pane.
- [ ] Move Papers between monitors.
- [ ] Test 100%, 125%, 150%, and any creator-relevant Windows scaling configuration available.
- [ ] Minimize Papers.
- [ ] Restore Papers.
- [ ] Focus the foreign application.
- [ ] Focus Papers chrome.
- [ ] Raise another unrelated application over Papers.
- [ ] Return to Papers.
- [ ] Release the foreign application.

## 0.4 Required evidence

Record actual rectangles, not visual impressions.

For every stable layout update:

```
expected foreign screen rectangle
actual foreign window rectangle
delta x/y/width/height
```

Required assertion after settling:

```
abs(x delta) <= 1 physical pixel
abs(y delta) <= 1 physical pixel
abs(width delta) <= 1 physical pixel
abs(height delta) <= 1 physical pixel
```

No cumulative drift is permitted across repeated monitor transitions.

Z-order evidence must prove:

- [ ] while Papers is foreground, no unrelated ordinary top-level window sits between the adopted window set and Papers;
- [ ] the adopted window is not topmost;
- [ ] raising another application puts that application above Papers and the adopted window;
- [ ] Papers' follower-maintenance loop does not pull adopted windows back over the unrelated foreground application.

Release evidence must prove:

- [ ] original position is restored;
- [ ] original size is restored;
- [ ] original minimized/normal state is restored;
- [ ] the application remains usable after release.

## STAGE 0 PASS GATE

Proceed only if all three test applications can remain convincingly aligned without:

- topmost hacks;
- style mutation;
- visible oscillation;
- repeated activation stealing;
- unrecoverable focus fights;
- DPI drift.

## STAGE 0 STOP CONDITION

STOP AND RECONSIDER THE PRODUCT ARCHITECTURE if any of the following proves fundamental rather than app-specific:

- ordinary apps cannot stay aligned during normal Papers movement;
- correct Z-order requires HWND_TOPMOST;
- clicking Papers chrome consistently makes adopted panes disappear behind Papers;
- moving across DPI boundaries cannot converge accurately;
- maintaining position causes activation/focus flashing;
- normal applications continuously fight imposed bounds;
- release cannot reliably return the foreign app to its pre-adoption state.

Do not respond to a failed Stage 0 by adding SetParent as a quick workaround.

# STAGE 1 — Formal native adopted-window placement primitive

Purpose: Turn the successful Stage 0 experiment into a bounded, typed, tested Papers primitive.

Classification: HARD LAUNCH CRITERION

## 1.1 Add a distinct helper method

Do not overload ordinary layout apply semantics if it raises or activates windows.

Add a dedicated method, proposed name:

```
place-adopted
```

Its contract must include:

- exact verified target capability;
- desired screen bounds;
- trusted Papers host HWND or equivalent main-owned Z-order context;
- no renderer-supplied raw HWND;
- SWP_NOACTIVATE-equivalent behavior;
- explicitly non-topmost placement.

Files expected to change:

### Papers

- `src/main/windows/windowCapabilityTypes.ts`
- `src/main/windows/windowCapabilityClient.ts`
- `src/main/windows/windowHelperFactory.ts`
- `src/main/windows/windowCapabilityService.ts`
- `resources/window-helper/window-helper.ps1`
- `resources/window-helper/window-capability.ps1`

Add IPC only if the primitive needs to cross an existing main/preload boundary. Prefer keeping adopted-surface placement main-owned.

## 1.2 Preserve identity fencing

Before every placement:

- [ ] verify runtime token exists;
- [ ] verify underlying HWND still exists;
- [ ] verify process/window identity still matches the capability;
- [ ] return missing/denied rather than moving a different window.

Never accept:

- raw HWND from renderer;
- arbitrary PID;
- arbitrary executable path;
- arbitrary Z-order target from renderer.

## 1.3 Hash-pin update — mandatory after helper edits

Any edit to either:

- `resources/window-helper/window-helper.ps1`
- `resources/window-helper/window-capability.ps1`

requires updating the SHA-256 values in both:

1. `src/main/windows/windowHelperResource.ts` — `WINDOW_HELPER_EXPECTED_HASHES`
2. `resources/window-helper/manifest.json` — `hashes`

The runtime intentionally rejects mismatches.

Add/retain tests proving:

- [ ] modified helper + old compiled hash fails validation;
- [ ] modified helper + compiled hash updated but manifest stale fails;
- [ ] modified helper + manifest updated but compiled hash stale fails;
- [ ] both pins + actual file bytes matching succeeds.

## 1.4 Placement tests

Unit/native-integration assertions:

- [ ] placement changes bounds;
- [ ] placement does not activate the window;
- [ ] placement does not make the window topmost;
- [ ] stale capability cannot move a replacement HWND;
- [ ] denied/elevated target returns typed failure;
- [ ] repeated identical placement is idempotent;
- [ ] malformed/out-of-range bounds fail before native mutation.

## STAGE 1 GATE

Proceed only when `place-adopted` is a normal proven capability primitive with the same fail-closed identity guarantees as existing window mutation methods.

# STAGE 2 — Define the foreign-surface domain model

Purpose: Give Papers a first-class concept of a foreign window without pretending it is a Backpack project/WebContents.

Classification: HARD ARCHITECTURE GATE

## 2.1 Canonicalize the persisted window descriptor

Current reusable identity comes from the existing window capability/member descriptor model.

Do not invent a second descriptor format.

If necessary, extract the persisted-safe descriptor type from its current main-process service location into a neutral/shared module usable by workspace topology without importing service implementation.

The persisted type must continue to contain only durable matching identity, such as:

```
version
title
executableFingerprint
```

It must not contain:

```
HWND
runtime token
bindingId
helper token
```

### Existing references

Papers:

- `src/main/windows/windowCapabilityService.ts`
- `src/main/windows/windowCapabilityTypes.ts`

As-you-Go reference implementation:

- `public/workspace-model-20260730b.js` — window-layout members already persist descriptor identity and explicitly reject runtime HWND/token identity.

As-you-Go must not become the owner of adopted surfaces. Its member model is reference/reuse evidence only.

## 2.2 Add foreign logical surface type without corrupting sender identity

Current areas to audit:

- `src/main/windows/logicalSurfaceRegistry.ts`
- `src/main/windows/surfaceContextRegistry.ts`
- `src/main/backpacks/backpackProjectSurfaceCollection.ts`

Do not simply add `foreign` to the existing sender-oriented SurfaceKind and provide a fake projectId.

Separate:

### Logical workspace content kind

```
project
foreign-window
```

from:

### Electron/IPC sender kind

```
host
project
detached
widget
```

A foreign HWND has no renderer sender.

## 2.3 Add a sibling controller/collection

Create Papers-owned modules, suggested names:

```
src/main/windows/foreignWindowSurfaceController.ts
src/main/windows/foreignWindowSurfaceCollection.ts
```

Do not put foreign windows inside `BackpackProjectSurfaceCollection`.

The controller should own ephemeral state such as:

```
surfaceId
descriptor
runtime capability | null
state: disconnected | resolving | live-visible | live-hidden | releasing
current pane bounds
original pre-adoption observation
current host window id
```

Only descriptor/surface topology is durable.

Runtime capability must be discarded on:

- helper restart;
- target missing;
- identity mismatch;
- Papers restart.

## 2.4 State-machine tests

Pin valid transitions.

Examples:

```
disconnected -> resolving -> live-visible
disconnected -> resolving -> disconnected
live-visible -> live-hidden
live-hidden -> live-visible
live-* -> disconnected (foreign app closed)
live-* -> releasing -> retired/released
```

Assert illegal transitions do not perform native mutation.

## STAGE 2 GATE

Proceed only when a foreign surface can exist logically without:

- projectId;
- WebContents;
- sender registration;
- raw HWND persistence.

# STAGE 3 — Workspace topology schema v2

Purpose: Make foreign surfaces durable first-class members of existing Papers groups/splits.

Classification: HARD BACKWARD-COMPATIBILITY CRITERION

Primary file:

- `Papers-3/src/shared/workspaceTopology.ts`

Current topology group/layout operations should be reused wherever they operate only on surfaceId.

## 3.1 Define discriminated surface union

Upgrade durable topology to schema version 2.

Target shape:

```
type WorkspaceSurfaceV2 =
  | {
      kind: 'project';
      surfaceId: string;
      surfaceKey?: string;
      projectId: string;
      title: string;
    }
  | {
      kind: 'foreign-window';
      surfaceId: string;
      surfaceKey?: string;
      title: string;
      descriptor: PersistedWindowMemberDescriptor;
    };
```

Do not put recovery/runtime state in topology.

## 3.2 Keep existing group geometry generic

Existing structures remain conceptually unchanged:

```
WorkspaceTabGroup.surfaceIds
WorkspaceTabGroup.activeSurfaceId
WorkspaceLayoutNode group/split tree
```

Existing operations should continue to operate by surfaceId, including:

- open/insert;
- activate;
- reorder;
- move;
- close;
- split;
- cross-group movement.

Modify only code that assumes every surface has projectId.

## 3.3 Build deterministic v1 -> v2 migration

Every v1 surface becomes `kind: 'project'` with all existing `surfaceId`, `surfaceKey`, `projectId` and `title` preserved exactly.

Migration requirements:

- [ ] no new surface IDs;
- [ ] no changed group IDs;
- [ ] no changed activeSurfaceId;
- [ ] no changed split geometry;
- [ ] no changed focusedGroupId;
- [ ] no changed surface ordering;
- [ ] no changed surfaceKey;
- [ ] migration is deterministic;
- [ ] parsing a valid existing v1 topology never silently drops a project surface.

## 3.4 Persistence compatibility tests

Fixture tests must include:

- empty v1 topology;
- one project;
- multiple projects in one group;
- multiple groups;
- nested splits;
- multiple surfaces for the same project;
- existing surfaceKeys;
- reordered tabs.

Required assertion:

```
migrate(v1).project semantics == v1 semantics
```

After serialization/reload:

```
parse(write(migrate(v1))) == migrated v2
```

## STAGE 3 STOP CONDITION

STOP if migration requires inventing project identities, losing group geometry, or breaking old topology loads.

Do not ship v2 as a flag-day format that refuses v1 user data.

# STAGE 4 — Crash guardian and recovery journal

Purpose: Make it impossible for Papers to strand hidden/moved applications during a crash.

Classification: HARD LAUNCH CRITERION — NOT POLISH

No persistent foreign tabs may ship before this entire stage passes.

## 4.1 Define a durable recovery journal

Suggested main-process module:

```
src/main/windows/adoptedWindowRecoveryJournal.ts
```

Suggested userData file:

```
adopted-window-recovery.json
```

Journal entries should contain only recovery-safe information:

```
schemaVersion
adoption/surface identity
persisted window descriptor
original bounds
original native state
original visibility
last known processId as a non-authoritative recovery hint, if useful
timestamp/epoch
```

Do not persist:

```
HWND as authority
helper runtime token
bindingId as durable identity
```

Bound the maximum number of entries.

Use atomic write semantics:

```
write temporary file
flush/close
rename over journal
```

Malformed journal entries must be ignored/reported individually rather than crashing Papers startup.

## 4.2 Journal-before-mutation invariant

Before Papers first moves, hides, or otherwise changes the adopted window's recoverable presentation, the original state must already be durably journaled.

Required ordering:

```
1. resolve/observe exact foreign window
2. capture original state/bounds
3. persist recovery journal
4. arm guardian
5. guardian acknowledges
6. only now allow move/hide
```

Crash at any boundary before step 6 must leave the foreign application unchanged or recoverable.

## 4.3 Add an out-of-process guardian

The existing window helper process may act as the first guardian implementation if it can prove the required crash behavior.

Guardian responsibilities:

- remember every actively adopted session window;
- remember its original bounds/state/visibility;
- on normal release, restore it and remove it from guardian ownership;
- when the Papers pipe/process disappears unexpectedly, restore all guarded windows before exiting.

Add helper-level commands if needed, e.g. `guard-adopted` and `release-adopted`.

Do not depend only on Electron before-quit, will-quit, or renderer cleanup.

## 4.4 Helper EOF/finally recovery

`window-helper.ps1` must have deterministic cleanup for guardian-owned adopted windows on:

- stdin EOF;
- parent Papers process exit;
- normal helper stop where windows remain guarded;
- transport failure where the helper process itself remains alive.

Cleanup must:

1. show any window Papers hid;
2. restore safe pre-adoption bounds/state;
3. never close the foreign application.

## 4.5 Next-launch recovery

The journal is the backup when normal guardian recovery did not finish.

On Papers startup, before enabling new adoption:

- [ ] read journal;
- [ ] attempt recovery of every unresolved entry;
- [ ] revalidate identity;
- [ ] restore only a unique matching window;
- [ ] clear the journal entry only after proven restoration or proven target disappearance.

Existing normal candidate resolution may ignore hidden windows. Therefore add a main-only recovery path capable of locating previously Papers-hidden windows without exposing arbitrary hidden-window enumeration to renderers.

It must fail closed on identity ambiguity.

If a recorded processId is used as a recovery hint:

- it is never sufficient by itself;
- descriptor/process identity must still match;
- PID reuse must not grant authority over another application window.

## 4.6 Crash matrix

Automate where possible and perform real Windows destructive tests.

Required scenarios:

### Normal release

Adopt, move, hide, release. Evidence:

```
window visible
original bounds restored
journal entry removed
guardian entry removed
```

### Graceful Papers quit

Foreign surface active; another foreign surface hidden; quit Papers. Evidence:

```
both foreign windows usable after exit
no journal residue after successful restoration
```

### Kill Papers main process

Force-terminate Papers without graceful JS cleanup. Evidence:

```
guardian detects loss
all adopted hidden windows become visible
original placement restored
```

### Kill helper/guardian while Papers survives

Evidence:

- Papers marks adopted surfaces disconnected/degraded;
- journal remains;
- no new unsafe mutations occur;
- after helper recovery/re-resolution, surfaces recover or require explicit reconnect.

### Kill both Papers and helper

Evidence on next launch:

- journal is detected;
- uniquely identifiable surviving windows are restored;
- ambiguous windows are not guessed;
- user receives a recovery status.

### System restart

No stale journal may cause an unrelated new process/window to be mutated after reboot.

## STAGE 4 PASS GATE

Do not proceed to persistent hidden tabs until forced process termination has been demonstrated on a real Windows machine without leaving an application inaccessible.

# STAGE 5 — First genuinely useful feature: foreign windows as tabs in one group

Purpose: Deliver the first creator-usable slice.

Classification: FIRST PRODUCT SLICE

This stage may hide inactive foreign tabs only because Stage 4 recovery is already proven.

## 5.1 Add "Adopt Window" UI

Use the existing Papers-owned native window picker/capability mechanism.

Do not create another desktop-enumeration system.

Flow:

```
creator chooses Adopt Window
-> Papers native picker
-> exact candidate selected
-> Papers receives capability + persisted descriptor
-> foreign WorkspaceSurfaceV2 created
-> surface inserted in focused tab group
-> controller takes recoverable ownership
```

No raw helper token enters durable topology.

## 5.2 Create foreign tab presentation

The tab header should show at minimum:

- title/application label;
- icon if already safely available;
- disconnected indicator when target is missing.

Do not make the foreign app itself render the tab. Papers owns all chrome.

## 5.3 Define activation semantics

When a group activates:

### Project surface

- project WebContents presentation is visible;
- every foreign surface in that group is hidden.

### Foreign surface

- all other foreign surfaces in that group are hidden;
- its capability is resolved if necessary;
- its current pane bounds are applied;
- it is shown without making it globally topmost.

If the exact target cannot be resolved:

- keep tab;
- mark disconnected;
- show explicit Reconnect/Release actions;
- never choose another ambiguous window automatically.

## 5.4 Define close semantics

Closing a foreign tab means:

```
release adopted application
-> restore pre-adoption presentation
-> remove recovery ownership
-> delete topology surface
```

It does not invoke the existing window-capability close operation.

If the creator wants to close the application, that must be a separate explicit command.

## 5.5 Foreign application closes itself

Detect target disappearance. Required behavior:

```
foreign tab remains
state = disconnected
topology remains durable
no replacement window automatically selected
```

Provide `Reconnect` and `Release/Remove tab`.

If reconnect resolves exactly one descriptor match, update runtime capability and resume.

## 5.6 Evidence

With `[ Papers project A ] [ Notepad ] [ VS Code ]` in one tab group:

- [ ] switching to Notepad hides VS Code and project content occupies no conflicting foreign rectangle;
- [ ] switching to VS Code hides Notepad;
- [ ] switching to project A hides both foreign windows;
- [ ] returning to a foreign tab restores it in-place;
- [ ] an unrelated foreground app can cover Papers and all adopted tabs;
- [ ] returning to Papers restores correct active-tab composition;
- [ ] closing the Notepad tab leaves Notepad running outside Papers at its original position.

## STAGE 5 GATE

The creator must be able to use foreign applications as ordinary tabs for an extended session without manual window arrangement.

This is the earliest slice that should be presented as genuinely useful.

# STAGE 6 — Split/group integration

Purpose: Make adopted surfaces participate in the full Papers grouping model.

Classification: CORE FEATURE

## 6.1 Reuse topology operations

Do not create separate "foreign groups."

Existing topology operations should treat foreign surfaces by surfaceId.

Verify:

- reorder foreign and project tabs together;
- move foreign tab between groups;
- split foreign surface out of a group;
- drag foreign surface into an existing split;
- change split weights;
- activate different surfaces independently in different groups.

## 6.2 Support multiple simultaneously visible foreign surfaces

Both foreign HWNDs may be visible simultaneously (for example VS Code active in group A and a browser active in group B).

Their Z-order must form one contiguous Papers-owned adopted-window layer, not fight each other.

Because panes do not overlap, their relative ordering inside that layer should not affect appearance.

## 6.3 Create a pane-bounds reporting contract

Renderer/Papers layout code must report each active foreign pane's content rectangle, excluding:

- tab strip;
- split separators;
- Papers toolbar/chrome;
- neighboring panes.

Do not let foreign HWNDs overlap Papers tab controls.

Only Papers-owned renderer/layout state may report pane geometry. Foreign content never supplies its own target rectangle.

## 6.4 Coordinate contract

Define one canonical coordinate representation for the native placement boundary.

Document explicitly:

- whether values are DIP or physical pixels;
- which component converts them;
- how host client coordinates become screen coordinates;
- how monitor-DPI transitions are handled.

Do not allow separate renderer and helper implementations to independently guess conversions.

## 6.5 Follow host movement

The foreign surface controller must respond to:

- Papers window move;
- Papers window resize;
- maximize/restore;
- pane ResizeObserver/layout changes;
- split weight changes;
- tab-strip/chrome geometry changes;
- monitor/DPI transition.

Deduplicate unchanged placement requests.

## 6.6 Z-order invariant

When Papers or one of its adopted surfaces is the user's active workspace:

```
active adopted foreign windows
Papers host
```

must remain a contiguous block.

When an unrelated application becomes foreground:

```
unrelated foreground app
active adopted foreign windows
Papers host
```

The placement controller must not keep raising adopted windows merely because a timer/layout tick fires while Papers is background.

## 6.7 Minimize/restore Papers

When Papers host is minimized:

- hide or otherwise suppress all adopted foreign surfaces belonging to it;
- do not leave them floating on the desktop.

When Papers is restored:

- show only foreign surfaces that are active in currently visible groups;
- restore their current pane placement;
- keep inactive foreign tabs hidden.

This suppression is Papers-session presentation state, not release from adoption.

## 6.8 Evidence

Automated/native test matrix:

- 2 project surfaces + 2 foreign surfaces;
- 2 groups;
- horizontal split;
- vertical split;
- nested split;
- repeated split resizing;
- tab reorder;
- foreign tab moved between groups;
- project/foreign activation in each group.

At every step assert:

```
visible foreign HWND set
==
foreign surfaces active in visible groups
```

and:

```
each visible foreign HWND bounds
==
its group pane content bounds ± 1 physical pixel
```

# STAGE 7 — Focus and interaction semantics

Purpose: Make normal interaction predictable despite separate native windows.

Classification: CORE FEATURE

## 7.1 Papers chrome remains reachable

Foreign window bounds must never cover:

- tab strip;
- group controls;
- split handles intended to remain Papers UI;
- main titlebar/chrome.

Evidence:

- creator can always click the tab strip to leave a foreign app;
- creator can drag the split handle while a foreign app is active;
- Papers chrome does not disappear under the adopted HWND.

## 7.2 Focus behavior

Define and test:

- clicking the foreign pane activates the foreign app;
- clicking Papers tab/chrome activates Papers;
- switching to a foreign tab may show it without forcing foreground unless product behavior explicitly chooses to focus it;
- focus changes never cause repeated show/hide oscillation.

Do not attempt to synthesize one unified keyboard focus tree.

## 7.3 Foreign window self-minimizes/maximizes

Decide a bounded policy. Recommended v1:

### Self-minimize

- controller detects minimized state;
- tab stays present;
- activating the tab restores/replaces it in its pane.

### Self-maximize

Do not allow it to remain desktop-maximized while considered adopted. Choose one of:

- restore it back into pane bounds automatically; or
- mark adoption incompatible/release it.

Pin the chosen policy in tests.

## 7.4 Foreign window tries to move itself

Observe geometry drift.

If the app moves itself away from the pane:

- reapply pane bounds while adopted;
- rate-limit correction;
- detect repeated fighting.

If an app repeatedly overrides placement beyond a bounded threshold:

```
state = incompatible
release window
show explanatory UI
```

Do not run an unbounded geometry war.

# STAGE 8 — Recovery, reconnection and degraded-state UX

Purpose: Make failure states truthful rather than magical.

Classification: HARD LAUNCH CRITERION

## 8.1 Disconnected tab

Show distinct states for:

```
resolving
live
missing
ambiguous
denied
helper unavailable
incompatible
```

Do not map every error to "app closed."

## 8.2 Reconnect

Reconnect must use persisted descriptor resolution. Outcomes:

### Exactly one match

- bind new runtime capability;
- resume adoption;
- retain surfaceId and topology position.

### No match

- remain disconnected.

### Multiple matches

- require creator to explicitly select one;
- update persisted descriptor only through an explicit successful rebind.

## 8.3 Helper restart

On helper revision/restart:

- all runtime capabilities become invalid;
- adopted surfaces keep durable descriptors/topology;
- resolve each required visible surface again;
- hidden inactive tabs may resolve lazily unless recovery requires otherwise.

No raw old token may be retried against a fresh helper session.

## 8.4 Papers host window closes

Before destroying its presentation:

- release all foreign surfaces belonging to that host, unless an explicitly implemented later cross-window ownership transfer has already completed;
- recovery guardian remains armed until release is verified.

# STAGE 9 — Security and authority review

Purpose: Preserve the existing fail-closed native-control boundary.

Classification: HARD LAUNCH CRITERION

## 9.1 Renderer cannot manufacture native authority

Assert that no renderer can request:

```
move HWND 12345 here
hide PID 1002
adopt C:\foo.exe
```

All native control begins from a Papers-issued capability derived from trusted enumeration/picking/resolution.

## 9.2 Elevated windows

Test non-elevated Papers against an elevated target. Expected result:

```
adoption denied/unsupported
no partial topology record
no recovery journal entry left armed
no window moved/hidden
```

Do not automatically elevate Papers/helper.

## 9.3 Current Papers windows excluded

Do not accidentally allow adoption of:

- Papers host itself;
- its picker;
- compact widget;
- detached project surfaces;
- helper/overlay windows,

unless explicitly and safely admitted by an existing trusted exception.

## 9.4 Recovery interfaces remain main-only

Hidden-window recovery enumeration must never become a general renderer API.

Journal recovery accepts only entries Papers previously created.

# STAGE 10 — Performance and stability

Purpose: Make the illusion stable enough for daily use.

Classification: LAUNCH QUALITY GATE

## 10.1 No blind polling when avoidable

Use event-driven updates for:

- Papers host move/resize;
- pane geometry;
- topology activation.

If foreign observation polling is required, bound it and deduplicate. No per-frame helper call loop.

## 10.2 Placement dedupe

For every controller:

```
if desiredBounds == lastSuccessfullyAppliedBounds
and z-order state is already valid
then do not issue another native placement
```

Do not generate endless helper traffic while nothing changes.

## 10.3 Geometry stress

Run at least:

- 1,000 pane-resize updates;
- repeated maximize/restore;
- repeated cross-monitor moves;
- repeated tab switching;
- repeated group splitting/merging where supported.

Evidence:

- no increasing geometry drift;
- no runaway helper pending count;
- no leaked controllers;
- no leaked journal entries;
- no permanently hidden foreign windows.

## 10.4 Long session

Run for multiple hours with:

- at least 3 adopted applications;
- at least 2 groups;
- project and foreign tabs mixed;
- normal system sleep/wake if available;
- display disconnect/reconnect if available.

Afterward:

- every foreign surface remains mapped to the correct application;
- no foreign window unexpectedly topmost;
- release-all restores all applications.

# STAGE 11 — First-slice compatibility matrix

Before launch, record results for representative application families. At minimum:

| Application type | Required result |
| --- | --- |
| Basic Win32 app | Supported |
| Electron app | Supported |
| Chromium browser | Supported |
| Multi-window app | Supported only when selected HWND remains uniquely bound |
| App with native modal dialog | Main surface works; dialog documented as external/unmanaged |
| Always-on-top app | Reject or explicitly mark unsupported |
| Self-positioning/fixed-size app | Either stable or detect/release as incompatible |
| Full-screen app | Unsupported |
| Elevated/admin app from normal Papers | Denied |
| Closed/reopened app with unique descriptor | Reconnectable |
| Two indistinguishable matching windows | Ambiguous; creator must choose |

Do not label a category supported until it has actually passed.

# STAGE 12 — Cross-window transfer — later extension, not first launch

Classification: NICE-TO-HAVE / POST-V1

Only begin after same-window tabs/groups/splits are reliable.

Goal:

```
drag adopted tab from Papers window A
to Papers window B
```

Required architecture:

```
old controller owns recovery guard
-> destination prepares ownership
-> destination resolves/accepts capability
-> guardian ownership transfers atomically
-> topology moves
-> old host stops positioning/hiding
-> new host starts
```

At no point may both controllers independently hide/place the same foreign HWND.

If transfer fails:

```
old owner retains authority
foreign window remains recoverable
topology rolls back
```

Do not implement this as "both windows can control it and eventually converge."

# STAGE 13 — As-you-Go integration boundary

The core adopted-window feature belongs to Papers, not to As-you-Go.

No As-you-Go changes are required for the initial/full Papers feature.

Reuse conceptually:

- descriptor-bound persisted window identity;
- opaque runtime capability issuance;
- helper-restart recovery;
- exact identity revalidation.

Reference files:

### As-you-Go

- `public/workspace-model-20260730b.js` — descriptor-only durable window-layout member identity.
- `public/app/host/host-bridge.js` — existing capability-facing host bridge patterns.

Do not reuse:

- activeWindowLayoutId;
- recording controller;
- 500 ms layout recording semantics;
- window-layout card/widget protocol;
- saved desktop arrangement bounds.

A future optional affordance such as "Adopt this As-you-Go layout member into Papers as a tab" may use a new explicit Papers host API, but it is outside this feature's launch scope.

# STAGE 14 — Tests that must exist before feature completion

Classification: HARD DEFINITION-OF-DONE REQUIREMENTS

## Topology

- [ ] v1 project-only fixture migrates losslessly to v2.
- [ ] v2 project surface round-trips.
- [ ] v2 foreign surface round-trips.
- [ ] project + foreign surfaces may share group.
- [ ] foreign surface may move/reorder/split through generic topology functions.
- [ ] foreign surface does not require projectId.

## Native placement

- [ ] non-activating placement.
- [ ] non-topmost placement.
- [ ] exact identity fencing.
- [ ] stale token fails.
- [ ] malformed rectangle fails.
- [ ] denied/elevated target fails.

## Controller

- [ ] activation shows exactly one foreign tab per active group.
- [ ] inactive foreign tabs hidden.
- [ ] project tab activation hides group foreign tabs.
- [ ] target close -> disconnected.
- [ ] unique reconnect -> same logical surface.
- [ ] ambiguous reconnect -> no mutation.

## Recovery

- [ ] journal written before first presentation mutation.
- [ ] normal release restores and clears journal.
- [ ] graceful Papers exit restores all.
- [ ] Papers hard-kill restores via guardian.
- [ ] helper death leaves recoverable journal state.
- [ ] next-launch recovery repairs uniquely identified hidden windows.
- [ ] old journal cannot mutate unrelated newly launched windows.
- [ ] malformed journal cannot crash startup.

## Geometry

- [ ] pane rectangle match within ±1 physical pixel after settling.
- [ ] monitor/DPI transition has no cumulative drift.
- [ ] minimize/restore host suppresses/restores correct set.
- [ ] unrelated foreground app stays above Papers/adopted block.

## Helper provenance

- [ ] old hash pin + edited script fails.
- [ ] only-one-pin-updated fails.
- [ ] both compiled/manifest pins + exact resources succeeds.

# STAGE 15 — Product documentation before launch

Classification: HARD PRODUCT-HONESTY CRITERION

Documentation/UI must explicitly say:

> Adopted apps remain their own Windows application windows. Papers manages their
> placement, visibility and workspace membership; it does not convert them into
> native Papers/Electron content.

Document:

- separate Alt-Tab/taskbar behavior;
- separate focus/accessibility;
- popup/dialog limitations;
- unsupported fullscreen/elevated apps;
- what closing the Papers tab does;
- how to release an app;
- what a disconnected tab means;
- how crash recovery works;
- how to recover/reconnect manually if identity is ambiguous.

Include an emergency user-facing command:

```
Release all adopted windows
```

It must:

1. restore/show every currently guarded window;
2. stop placement management;
3. remove active adoption sessions;
4. preserve or remove topology according to an explicit UI choice;
5. never close the applications.

This command is a HARD LAUNCH CRITERION.

# Definition of Done

The feature is complete only when all statements below are true.

## Product behavior

- [ ] The creator can choose an ordinary external application window and adopt it into Papers.
- [ ] The foreign application appears as a normal tab alongside Papers project surfaces.
- [ ] Foreign and Papers surfaces can coexist in the same group.
- [ ] Foreign surfaces can participate in Papers splits.
- [ ] Multiple active groups may each display an adopted application.
- [ ] Tab switching reliably shows only the correct foreign surfaces.
- [ ] Foreign windows track their pane while Papers moves/resizes.
- [ ] Moving Papers between supported DPI/monitor configurations does not visibly drift.
- [ ] Adopted windows never need to be globally topmost.
- [ ] Another unrelated foreground application can cover Papers and adopted windows normally.
- [ ] Closing a foreign tab releases rather than closes the application.
- [ ] A foreign app which closes itself becomes a truthful disconnected tab.
- [ ] Unique descriptor reconnection works.
- [ ] Ambiguous reconnection fails closed.

## Safety/recovery

- [ ] Every presentation mutation is preceded by durable recovery ownership.
- [ ] Forced Papers termination cannot permanently leave inactive adopted apps hidden.
- [ ] Guardian recovery is proven on the live Windows architecture.
- [ ] Durable journal recovery is proven.
- [ ] "Release all adopted windows" is available.
- [ ] Helper restart cannot transfer old capability authority to another HWND.
- [ ] Elevated/denied targets fail without partial adoption.

## Compatibility

- [ ] Existing topology v1 data migrates without project/tab/group loss.
- [ ] Existing project tabs/groups/splits behave identically after schema v2.
- [ ] Existing Backpack project surface collection remains project-specific.
- [ ] IPC sender registry is not polluted with fake foreign senders/project IDs.
- [ ] Window-layout behavior in As-you-Go remains unchanged.

## Engineering

- [ ] Full Papers test suite passes.
- [ ] Typecheck passes.
- [ ] Helper resources and both SHA-256 pin locations agree.
- [ ] Native placement integration tests pass.
- [ ] Crash matrix passes.
- [ ] Multi-hour soak test passes.
- [ ] No unbounded helper requests, controller leaks or recovery-journal leaks remain.
- [ ] Unsupported cases are documented rather than hidden.

## Final creator acceptance

Run this acceptance walk:

1. Open Papers with an existing project.
2. Adopt Notepad into the current group.
3. Adopt VS Code into the same group.
4. Switch repeatedly among Papers, Notepad and VS Code.
5. Split VS Code into another group.
6. Resize both panes.
7. Move Papers across monitors.
8. Raise another unrelated application over Papers.
9. Return to Papers.
10. Minimize and restore Papers.
11. Close one adopted tab and verify the application survives outside Papers.
12. Re-adopt it.
13. Force-kill Papers while another adopted tab is inactive/hidden.
14. Verify the foreign applications become usable again without manual Task Manager surgery.
15. Restart Papers.
16. Verify topology/recovery state is truthful.
17. Use Release all adopted windows.
18. Verify every application is visible, independently usable and no longer managed by Papers.

The feature is done only if this entire walk succeeds and the creator agrees that the windows feel like Papers workspace surfaces while the documented native-window seams remain acceptable.
