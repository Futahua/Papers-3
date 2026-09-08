# Window Layout Consistency & Auto-Tracking — Complete Implementation Checklist

> Authored by the audit reviewer on 2026-09-08 and saved here (only rendering
> artefacts removed). Written to stand alone: a future reader needs no access to
> the conversation that produced it.

Feature family: Window-layout consistency

Covers:

- **A.** Correct live identity for multi-window / multi-tab applications
- **B.** Immediate removal of genuinely dead native window instances
- **C.** Correct restart/reboot lifecycle
- **D.** Auto-tracking startup widget with filled/outline tracking toggle

Starting baselines:

- Papers-3 main: cbe2a75
- Papers future-feature docs on top: 0397d48, 385b819
- as-you-go-backpack main: 8000c88

Status: Future work.

This document is intended to stand alone. A future implementation agent should read it completely before modifying either repository.

## Reviewer's revised lifecycle position

The reviewer initially proposed a saved-versus-session layout split, then withdrew it after the creator clarified that layouts are not named artefacts they value.

The code technically persists a name and defaults it to "Window layout", but it is not presently treated like a creator-authored named artifact: `createWindowLayout()` invents the default, and the generic `renameItem()` path does not rename window layouts. The creator's correction therefore changes the product semantics materially.

The cleaner final model is **one window-layout kind with live-instance memberships and an optional auto-tracking mode**. The layout container may persist once auto mode exists; its members do not gain fake durability. When an exact native window instance dies, that membership disappears immediately. After a reboot, old native instances are necessarily gone, so their memberships disappear; the same layout record can remain and, when tracking is enabled, refill itself from the new live application windows.

Preserve the existing name, saved bounds, and descriptor fields for compatibility rather than deleting them in this work, but do not preserve a separate class of "durable saved layouts" against the creator's stated semantics.

The sequencing is non-negotiable: **A must land before B.** Today's helper literally keys a live token by `HWND|PID|exact title` and denies the token when that title changes, so aggressive retirement on today's identity would make an ordinary Chrome tab switch look like native-window invalidation. Also, because the creator made C conditional on D, do not expose the new pruning/reboot lifecycle as a user-facing change until auto-tracking and its startup widget are present.

One additional product limitation should be explicit: dialogs, owned popups, tool windows, Papers surfaces, and short-lived splash windows can be excluded structurally. An arbitrary third-party installer's main top-level window is not universally distinguishable from an ordinary application window by Win32 alone. The v1 auto-tracker should therefore use a conservative application eligibility classifier; unknown/unclassified executables should remain manually addable but should not be automatically captured.

# 0. Final product semantics

A window layout is a Papers/As-you-Go container holding occurrences of specific live native application-window instances.

It is not a promise that an arbitrary Chrome/Obsidian window can be uniquely reconstructed after that native window has ceased to exist.

The container itself may persist. Its membership is live-instance-oriented.

The final behavior is:

```
specific native window instance alive
→ member remains

exact native window instance proven destroyed
→ remove that member immediately everywhere it occurs

Papers/helper restarts while native app window survives
→ recover the same exact instance
→ member remains

full OS reboot
→ previous native instances no longer exist
→ old memberships disappear

layout container
→ may remain

tracking ON
→ eligible live application windows refill/add automatically

tracking OFF
→ no new windows are automatically added
```

# 1. Important current-baseline facts

These are the conditions this work is correcting.

## 1.1 Current persisted member identity

At `as-you-go-backpack@8000c88`, `public/workspace-model-20260730b.js`:

A persisted arrangement member currently contains:

```
member.id
descriptor.version
descriptor.title
descriptor.executableFingerprint
bounds
state
```

Runtime IDs/HWNDs/tokens are deliberately not persisted.

Relevant baseline region: `workspace-model-20260730b.js:58-102`

## 1.2 Current live helper identity is title-sensitive

At `Papers-3@cbe2a75`, `resources/window-helper/window-helper.ps1`:

Current session-token identity is `HWND | PID | exact title` (`window-helper.ps1:204-233`).

Every operation revalidates the current title against the title stored when the token was issued (`window-helper.ps1:251-271`).

Therefore:

```
Chrome tab title changes
→ HWND may be unchanged
→ PID may be unchanged
→ exact title changes
→ existing capability becomes denied/invalid
```

This must be fixed before any more aggressive retirement behavior exists.

## 1.3 Current persisted descriptor resolution is exact-title based

At `Papers-3@cbe2a75`, `src/main/windows/windowCapabilityService.ts:835-848`.

Resolution currently requires exactly one visible candidate matching `executableFingerprint` AND exact title.

Outcomes:

```
0 matches  -> missing
>1 matches -> ambiguous
1 match    -> bind
```

This cannot uniquely identify multiple Chrome/Obsidian windows generically.

## 1.4 Current retirement is intentionally conservative

At `as-you-go-backpack@8000c88`, `public/app/window-layout-runtime.js:191-270`.

Current behavior deliberately distinguishes success, missing, ambiguous, timeout, denied, helper-unavailable and malformed.

A stale capability is invalidated and re-resolved before a miss counts. The implementation currently requires repeated confirmed descriptor misses before retirement.

That conservative behavior must remain until the new exact-instance identity exists.

## 1.5 Layout records technically have a name field

`public/workspace-model-20260730b.js:638-654` currently creates `name = "Window layout"`.

But the normal `renameItem()` path handles groups and shortcuts rather than window layouts (`workspace-model-20260730b.js:1277-1288`).

Do not treat this technical/default name as a reason to invent a separate durable "saved layout" product class. Preserve it for compatibility unless separately removing it is explicitly approved.

# 2. Non-negotiable sequencing

Classification: HARD SAFETY GATE

## Absolute rule

**IMMEDIATE MEMBER RETIREMENT MUST NOT SHIP BEFORE EXACT LIVE WINDOW-INSTANCE IDENTITY.**

No exception.

With today's title-keyed identity:

```
Chrome tab switch
→ title changes
→ existing token fails identity check
```

If "first failure means remove member" were enabled now, healthy Chrome and Obsidian windows could disappear from the creator's layouts during ordinary use.

## Required release order

```
A. exact native instance identity
        ↓
typed terminal-vs-nonterminal outcomes
        ↓
native lifecycle watcher / auto-tracking infrastructure
        ↓
tracking widget + durable toggle
        ↓
B. immediate exact-instance retirement
        ↓
C. reboot/startup reconciliation
```

Do not ship a user-visible intermediate release that changes B/C semantics before A and D exist.

# 3. Final layout lifecycle model

Classification: HARD PRODUCT CONTRACT

Do not introduce separate saved and session layout kinds. Use one existing window-layout record kind. Add tracking state to the same model.

A layout may therefore be tracking ON or tracking OFF, but it remains the same layout type.

## 3.1 Empty layouts

Once auto mode is part of the feature, an empty layout is not automatically garbage.

An empty container may remain because the creator can turn tracking on and refill it.

Do not automatically delete the layout record merely because its last member dies.

## 3.2 Membership lifetime

Membership identity is the exact live native window instance.

When that instance dies, remove every occurrence of that exact instance.

If the same window was intentionally present in several layouts, remove all those occurrences.

Do not remove every member having the same executable/title.

## 3.3 Reboot

No special "reboot deletion timer" is required.

If instance identity is correctly tied to the native HWND lifetime:

```
OS reboot
→ all old HWND instances die
→ old windowInstanceIds no longer exist
→ reconciliation removes those memberships
```

The layout record itself may remain.

Tracking-enabled layouts then repopulate from the current live-window baseline. Tracking-disabled layouts remain empty until manually populated or tracking is re-enabled.

# 4. Auto-tracking ownership model

Classification: HARD PRODUCT CONTRACT

V1 supports at most one auto-tracking layout at a time per As-you-Go workspace.

This avoids:

```
new Chrome window
→ silently inserted into 4 different layouts
```

and matches the creator's singular startup-widget request.

Every layout is capable of becoming the tracking layout. Turning tracking ON for layout B must turn tracking OFF for layout A.

## 4.1 Durable state

Recommended layout-level shape:

```
layout.tracking = {
  enabled: true | false,
  suppressedInstanceIds: [...]
}
```

and one workspace-level pointer:

```
startupWindowLayoutId
```

The pointer identifies the layout whose compact widget should reopen on startup.

Alternative equivalent normalized shapes are acceptable, but the invariants must remain:

- tracking state is durable As-you-Go workspace state;
- it is not widget-local state;
- exactly one layout may have `tracking.enabled === true`;
- closing a widget does not silently change tracking;
- reopening a widget reflects current durable tracking state.

## 4.2 Initial migration/default

On the first load after this feature ships, if no startup tracking layout has ever been initialized:

1. leave every existing layout unchanged;
2. create one new ordinary window layout;
3. set it as `startupWindowLayoutId`;
4. set its tracking state to enabled;
5. request its compact widget immediately.

Do not commandeer an existing creator layout and begin auto-populating it.

## 4.3 User turning tracking off

When the creator presses the circle:

```
filled → outline
tracking true → false
```

Existing members remain. Future windows are not auto-added.

The explicit OFF state persists across reload/reboot. The startup widget still reopens, showing the outline state.

Do not silently re-enable tracking merely because Papers restarted.

# 5. DO NOT ATTEMPT IN THIS WORK

This section is explicit scope control.

Do not add:

- [ ] persisted HWND authority;
- [ ] PID-only identity;
- [ ] title-substring identity as generic authority;
- [ ] per-process "window #2" ordinal as durable authority;
- [ ] app-specific Chrome/Obsidian APIs;
- [ ] browser-extension integration;
- [ ] automatic app launching/relaunching;
- [ ] auto-tracking in several layouts simultaneously;
- [ ] continuous `windowCandidates()` polling from As-you-Go;
- [ ] continuous desktop enumeration on the existing control helper;
- [ ] deletion on timeout;
- [ ] deletion on ambiguity;
- [ ] deletion on denied;
- [ ] deletion on helper restart;
- [ ] deletion merely because a descriptor no longer matches;
- [ ] title-based cross-layout deletion;
- [ ] automatic addition of dialogs/tooltips/tool windows;
- [ ] auto-addition of Papers' own windows;
- [ ] automatic "best guess" matching after a native instance disappeared;
- [ ] layout record deletion merely because member count reaches zero;
- [ ] removal of the legacy/default layout name field as part of this work;
- [ ] reworking Quick Run in this slice;
- [ ] reworking adopted-window-surfaces in this slice.

# STAGE 0 — Native instance-identity viability proof

Purpose: Prove a generic exact-window identity can survive title changes and helper restarts without persisting HWNDs.

Classification: HARD GO / NO-GO GATE

Do not change production retirement semantics before this stage passes.

## 0.1 Prototype an opaque Papers-owned window instance tag

Preferred design:

```
Papers assigns a random opaque windowInstanceId
↓
trusted native layer attaches it to the exact top-level HWND
↓
title changes do not affect it
↓
HWND destruction destroys the association
```

Candidate mechanism: `SetProp` / `GetProp`, or another equivalent trusted per-HWND property.

The durable/member representation stores only the opaque instance ID string. It never stores HWND as authority.

## 0.2 Required prototype applications

Test:

- Notepad or conventional Win32 app;
- Chrome with two top-level windows;
- Obsidian with detachable/multiple windows;
- VS Code or another Electron app.

## 0.3 Exact tests

### Title mutation

For one Chrome HWND:

1. assign instance ID;
2. record it;
3. switch tabs repeatedly until title changes several times;
4. retrieve instance ID after every change.

Required: `instanceId_before === instanceId_after`

### Two windows same executable

Create Chrome A and Chrome B. Required: `instanceId(A) != instanceId(B)` even though executable fingerprints match.

### Helper restart

Keep Chrome A alive. Restart the Papers helper.

Required: fresh helper can rediscover Chrome A's same instanceId, without relying on exact title.

### Papers restart on same Windows session

Keep Chrome A alive. Restart Papers.

Required: same exact native instance is rediscoverable, if the chosen tag mechanism is intended to survive Papers/helper process death.

### Native window destroy

Close Chrome A. Required: `instanceId(A)` cannot be found on any surviving top-level HWND.

### HWND reuse

If a later unrelated/replacement window reuses the same numeric HWND, required: old instanceId does not authorize new window.

### Elevated target

Non-elevated Papers against elevated target. Required:

```
cannot tag/control
→ typed denied/unsupported
→ never fall back to HWND persistence
```

## STAGE 0 STOP CONDITION

STOP and reconsider the identity architecture if common non-elevated Chrome/Obsidian/Win32 windows cannot carry a stable Papers-owned per-instance tag across ordinary title changes.

Do not fall back to title substring/PID/ordinal and call it solved.

# STAGE 1 — Replace title-based live token identity

Purpose: Fix A at the helper/capability boundary.

Classification: HARD SAFETY CRITERION

Files expected to change in Papers:

```
resources/window-helper/window-helper.ps1
resources/window-helper/window-capability.ps1
src/main/windows/windowCapabilityTypes.ts
src/main/windows/windowCapabilityClient.ts
src/main/windows/windowHelperFactory.ts
src/main/windows/windowCapabilityService.ts
```

## 1.1 Extend observation

A successful live observation must expose:

```
windowInstanceId
runtimeId/capability data as currently required
title
processId
processPath
state
bounds
```

Title remains display metadata. It is not identity.

## 1.2 Token key

Replace conceptual identity `HWND + PID + title` with `windowInstanceId + process/native corroboration`.

The helper may internally remember HWND. That HWND remains ephemeral.

## 1.3 Mutation revalidation

Immediately before every observe or mutation, require:

```
token exists
HWND still exists
current HWND's Papers instance tag == token.instanceId
PID/process identity still corroborates
```

Do not require `current title == original title`.

## 1.4 Title-change regression test

Bind Chrome. Change active tab title. Then run observe, toggle, minimize, restore, thumbnail and live preview using the same capability as appropriate.

Required: no identity failure solely due to title change.

## 1.5 Two-window isolation

Bind Chrome A and Chrome B. Changing A's title must not affect B's token, swap capabilities, or cause A's capability to act on B.

## 1.6 Helper hash pins

Any modification to `window-helper.ps1` or `window-capability.ps1` requires updating:

```
src/main/windows/windowHelperResource.ts
resources/window-helper/manifest.json
```

The manifest currently contains exactly the helper/adaptor file hashes and the compiled resource module independently pins the same bytes.

Tests must prove:

- [ ] actual bytes != compiled pin → startup rejects;
- [ ] manifest != compiled pin → startup rejects;
- [ ] one pin updated but not other → startup rejects;
- [ ] all three agree → validation succeeds.

## STAGE 1 GATE

Do not proceed to aggressive retirement until a Chrome/Obsidian title change is proven incapable of invalidating a healthy live capability.

# STAGE 2 — Add exact instance identity to persisted layout membership

Purpose: Let As-you-Go refer to the exact live instance without persisting HWND/token authority.

Classification: HARD MODEL GATE

Primary As-you-Go file: `public/workspace-model-20260730b.js`

## 2.1 New member shape

Recommended:

```
{
  id,
  windowInstanceId,
  descriptor: {
    version: 1,
    title,
    executableFingerprint
  },
  bounds,
  state
}
```

`windowInstanceId` is an opaque Papers-issued ID. It is not an HWND.

Descriptor remains useful as display metadata, executable identity, and a legacy migration/reconnect hint. It no longer defines the exact live window when instance ID exists.

## 2.2 Arrangement version

Prefer bumping `arrangement.version 2 → 3` to make the member identity change explicit.

Do not require a repo-wide workspace schema bump unless existing project migration conventions require it.

## 2.3 Legacy version-2 migration

Existing members have no `windowInstanceId`. Normalize them as legacy/unbound.

Do not fabricate instance IDs. Do not immediately delete them.

## 2.4 Safe legacy upgrade

For each legacy member, if old descriptor resolution finds exactly one safe candidate:

```
bind
→ obtain instanceId
→ persist member upgrade
```

If result is missing, ambiguous, timeout, denied or helper-unavailable, retain the member as legacy-unbound.

Do not apply immediate terminal retirement rules to an unbound legacy member.

## 2.5 New additions

Every newly picker-added or auto-tracked member after this feature must have a real `windowInstanceId`.

No new descriptor-only membership may be created.

## STAGE 2 EVIDENCE

Model tests:

- [ ] v2 member loads without corruption;
- [ ] v3 instance member round-trips;
- [ ] runtimeId/HWND/token still stripped;
- [ ] opaque windowInstanceId survives;
- [ ] duplicate member IDs rejected;
- [ ] two Chrome members may share executable fingerprint/title but carry different instance IDs.

# STAGE 3 — Replace descriptor-based cross-layout retirement

Purpose: Ensure one window closing never deletes a sibling Chrome/Obsidian window.

Classification: HARD SAFETY CRITERION

Current code to replace:

```
public/workspace-model-20260730b.js:690-714
removeClosedWindowFromAllLayouts(state, descriptor)
```

Current implementation matches title + executableFingerprint. That is no longer acceptable.

## 3.1 New model operation

Replace with `removeWindowInstanceFromAllLayouts(state, windowInstanceId)`.

Semantics:

```
same exact windowInstanceId
→ remove all occurrences

same executable, other instanceId
→ keep
```

## 3.2 Legacy members

A legacy member with no instance ID must never be deleted merely because another descriptor-similar instance dies.

## 3.3 Cache cleanup

For every removed occurrence clear:

- control capability cache;
- member icon cache;
- preview capability cache;
- selection state;
- selection anchor;
- runtime recording membership.

Reuse the existing cleanup seams around `workspace-20260730b.js:2187-2230`, but key retirement by instance ID.

## 3.4 Multi-layout evidence

Put Chrome A into layout X and layout Y. Put Chrome B into layout Y. Destroy Chrome A.

Required:

```
X loses A
Y loses A
Y keeps B
```

# STAGE 4 — Typed terminal-vs-nonterminal capability outcomes

Purpose: Give B a protocol fact strong enough to justify destructive removal.

Classification: HARD SAFETY CRITERION

Current `missing` conflates "unknown old session token" and "actual HWND gone" at `resources/window-helper/window-helper.ps1:254-261`. That is insufficient.

## 4.1 Add typed missing reason

Recommended result shape:

```
{
  outcome: 'missing',
  reason:
    | 'window-gone'
    | 'session-token-unknown'
    | 'instance-mismatch'
}
```

or an equivalent strict enum. Do not parse human error text.

## 4.2 Meaning

### window-gone

Allowed only when Papers has strong evidence that the exact instance previously bound by this token is no longer alive. This is terminal.

### instance-mismatch

If the underlying numeric HWND now belongs to a different tagged native instance, the old member's instance is terminally gone. Treat as terminal for the old instance, while never granting authority over the replacement.

### session-token-unknown

Helper session forgot the token. Target may still be alive. This is not terminal. Re-resolve by `windowInstanceId`.

## 4.3 Never-terminal outcomes

The following must never directly delete membership:

```
ambiguous
timeout
denied
helper-unavailable
malformed
session-token-unknown
title change
descriptor no-match
```

## 4.4 Strict parser propagation

Update as needed:

```
windowCapabilityTypes.ts
windowCapabilityClient.ts
windowHelperFactory.ts
windowCapabilityService.ts
windowCapabilityIpc.ts
preload/backpackProject.ts
As-you-Go host-bridge.js
```

Every layer must preserve the typed reason.

## STAGE 4 GATE

No destructive auto-retirement code may infer terminality from generic `outcome !== success`.

# STAGE 5 — Exact-instance re-resolution after helper restart

Purpose: Recover live members after Papers helper churn without falling back to volatile titles.

Classification: HARD RELIABILITY CRITERION

Add Papers service capability `resolveWindowInstance(windowInstanceId)` or an equivalent internal recovery path.

## 5.1 Resolution rule

Perform a trustworthy native scan for the Papers-owned instance tag. Results:

```
exactly one matching instance
→ bind fresh capability

none after complete successful scan
→ instance absent

infrastructure failure
→ unknown/nonterminal
```

Because instance IDs are unique per live native window, ambiguous should not occur unless the tag mechanism itself is broken/corrupted.

If duplicate instance IDs are observed:

```
fail closed
report protocol/integrity error
do not bind either
```

## 5.2 Runtime recovery

If observe returns `missing` / `session-token-unknown`:

```
invalidate capability
→ resolve by instanceId
→ success: continue
→ infrastructure failure: retain member
```

Do not resolve by exact title first.

## 5.3 Papers restart same boot

Keep Chrome/Obsidian windows open. Restart helper/Papers.

Required:

```
members survive
new capabilities bind same instanceIds
no layout deletion
```

# STAGE 6 — Native window lifecycle watcher

Purpose: Detect real eligible application-window creation/destruction without polling the control helper.

Classification: HARD AUTO-TRACKING / RETIREMENT INFRASTRUCTURE

Do not implement this by repeatedly calling `host.windowCandidates()` from As-you-Go.

## 6.1 Separate watcher process

Build a dedicated Papers-owned watcher.

Suggested modules:

```
src/main/windows/windowLifecycleTypes.ts
src/main/windows/windowLifecycleWatcherClient.ts
src/main/windows/windowLifecycleWatcherSpawn.ts
src/main/windows/windowLifecycleWatcherSupervisor.ts
```

Suggested resource:

```
resources/window-helper/window-watcher.ps1
```

The watcher may share native definitions from `window-capability.ps1`, but must not share the control helper's synchronous request queue.

## 6.2 Detection API

Use event-driven Windows lifecycle monitoring, preferably `SetWinEventHook` for relevant top-level-window lifecycle events.

At minimum:

```
CREATE/SHOW candidate trigger
DESTROY terminal trigger
```

Optional: `NAMECHANGE` for display metadata only. Title changes must not affect instance identity.

## 6.3 Watcher event protocol

Every event must contain:

```
trackerSessionId
monotonic sequence
event kind
windowInstanceId
sanitized observation/descriptor fields
```

Never expose raw HWND to renderer code.

## 6.4 Baseline + delta ordering

Watcher startup must avoid this race:

```
enumerate baseline
window created halfway through enumeration
hook starts after scan
→ window lost forever
```

Required startup:

1. install lifecycle hook;
2. begin buffering events;
3. enumerate complete current baseline;
4. emit baseline with completion marker;
5. flush buffered deltas in sequence;
6. continue live events.

## 6.5 Watcher restart

Supervisor restart produces a new `trackerSessionId`. Consumers must request/reconcile a fresh complete baseline.

Do not assume no events were missed.

## 6.6 Resource provenance

If adding `window-watcher.ps1` to the packaged helper resource directory, update:

```
resources/window-helper/manifest.json
src/main/windows/windowHelperResource.ts
```

to treat the exact file set and all hashes as canonical. Update packaged-resource configuration if necessary. Add tamper/hash tests for the new file.

# STAGE 7 — Canonical auto-tracking eligibility

Purpose: Ensure "automatically add windows" means real application surfaces, not every HWND.

Classification: HARD PRODUCT/SAFETY GATE

Use one Papers-owned eligibility classifier. Do not implement a second competing As-you-Go title blacklist.

## 7.1 Base task-worthiness

Reuse the canonical helper task-worthiness logic in `resources/window-helper/window-capability.ps1:706+`.

It already excludes DWM-cloaked surfaces, shell desktop/WorkerW, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, unsuitable owned popups and TextInputHost-style system UI, while retaining legitimate minimized application windows.

## 7.2 Papers exclusions

Additionally exclude all Papers-owned windows:

- host shell;
- project surfaces;
- detached surfaces;
- compact widgets;
- preview windows;
- picker windows;
- helper/watcher UI if any;
- any same-process auxiliary window not explicitly allowed.

Use Papers' own process/surface registry, not titles.

## 7.3 Dialogs and owned popups

Owned/modal child-style surfaces do not auto-track as independent members.

A native application's main task window may remain tracked while its dialog exists.

## 7.4 Splash/transient stabilization

A CREATE event is only a trigger. Do not add immediately.

Required candidate pipeline:

```
CREATE/SHOW
→ wait stabilization interval
→ verify HWND still alive
→ verify same instance ID
→ verify task-worthy
→ verify application eligibility
→ add
```

Initial recommended stabilization: `500 ms`. Make it a named constant with tests.

If normal creator applications feel artificially delayed, measure before changing it.

## 7.5 Installer/application classification

Generic Win32 cannot perfectly distinguish every third-party setup application's main top-level window from an ordinary app. V1 must therefore be conservative.

Auto-add only when:

1. window is task-worthy;
2. process identity/path is trustworthy;
3. process is not Papers/system shell;
4. process is not a known Windows installer/update host;
5. executable qualifies under the chosen conservative "application" classifier.

Recommended v1 policy:

```
known/registered installed application
OR
explicitly trusted application classification
```

Unknown/unclassified executables remain manually addable through the existing picker but are not auto-added.

Do not silently weaken this rule just to increase capture count.

## 7.6 Required test corpus

Must remain excluded:

- [ ] Papers window;
- [ ] Papers widget;
- [ ] tooltip;
- [ ] owned modal dialog;
- [ ] splash window that disappears during stabilization;
- [ ] WorkerW/Progman;
- [ ] TextInputHost;
- [ ] common Windows Installer/MSI surface;
- [ ] common updater/setup-host test fixture.

Must be included:

- [ ] Chrome main window;
- [ ] second Chrome main window;
- [ ] Obsidian main/detached window;
- [ ] VS Code main window;
- [ ] Notepad;
- [ ] legitimate minimized app window.

## STAGE 7 STOP CONDITION

If the classifier routinely captures transient/system/installer windows on the creator's normal machine, do not ship auto mode.

# STAGE 8 — Expose lifecycle stream safely to As-you-Go

Purpose: Let the Backpack own membership policy while Papers owns native observation.

Classification: HARD ARCHITECTURE GATE

Papers owns:

```
which native window exists
which exact instance died
whether candidate is eligible
```

As-you-Go owns:

```
which layout receives it
tracking toggle state
membership persistence
manual suppression
```

## 8.1 Preload / IPC

Expected Papers files:

```
src/preload/backpackProject.ts
src/main/ipc/windowCapabilityIpc.ts
```

or a dedicated `src/main/ipc/windowLifecycleIpc.ts`.

Expose bounded project APIs such as:

```
papers:project:window-lifecycle-snapshot
papers:project window-lifecycle event subscription
```

## 8.2 As-you-Go host bridge

Expected: `public/app/host/host-bridge.js`

Add:

```
windowLifecycleSnapshot()
onWindowLifecycleEvent(callback)
resolveWindowInstance(instanceId)
```

or equivalent.

## 8.3 No raw HWND

Renderer-visible lifecycle data may contain instanceId, title, descriptor, state, bounds, event type and sequence/session.

Never: raw HWND as authority, or an arbitrary PID mutation handle.

## 8.4 Multiple As-you-Go surfaces

All surfaces may receive events. Only the elected document WRITER may mutate layout state.

Reuse the existing surface coordinator writer election. A VIEW surface must not independently auto-add/remove members.

## 8.5 Writer handover

When a VIEW becomes WRITER:

```
request fresh complete lifecycle snapshot
→ reconcile current state
→ only then process new deltas
```

Do not rely solely on events it may have missed while non-authoritative.

# STAGE 9 — Add durable tracking state to window-layout model

Purpose: Give the widget toggle a real shared source of truth.

Classification: HARD MODEL GATE

Expected As-you-Go file: `public/workspace-model-20260730b.js`

## 9.1 Tracking state

Recommended per-layout shape:

```
tracking: {
  enabled: false,
  suppressedInstanceIds: []
}
```

Add normalized bounds to suppression length, e.g. max 512 IDs, to prevent unbounded workspace growth.

## 9.2 Exactly one enabled layout

Model operation: `setWindowLayoutTracking(state, layoutId, enabled)`

When enabling layout B:

```
B.tracking.enabled = true
every other layout.tracking.enabled = false
startupWindowLayoutId = B.id
```

When disabling:

```
B.tracking.enabled = false
startupWindowLayoutId remains B.id
```

so its widget can reopen with the outline state.

## 9.3 Startup pointer

Add normalized `startupWindowLayoutId` to workspace state.

It must name an existing, non-binned window layout or normalize to null.

## 9.4 Suppression

Manual removal from the currently tracking layout adds `windowInstanceId` to that layout's suppression set. The same live instance must not immediately re-add itself.

When that exact native instance is destroyed, remove its suppression entry.

A newly created Chrome window receives a different instance ID and remains eligible.

## 9.5 Tracking OFF semantics

Turning tracking off:

- stops future automatic additions;
- does not remove current members;
- does not clear suppression;
- does not close/minimize native windows.

## 9.6 Widget close semantics

Closing the compact widget does NOT change `tracking.enabled`.

The widget is presentation. The layout is durable authority.

# STAGE 10 — Circle tracking toggle in the compact widget

Purpose: Implement creator-visible auto-mode control.

Classification: CORE UX / LAUNCH CRITERION

Expected As-you-Go files:

```
public/workspace-20260730b.js
public/app/window-layout-widget-channel.js
public/styles/items.css
```

## 10.1 Appearance

Top/corner control:

```
● filled circle   = tracking ON
○ outline circle  = tracking OFF
```

Do not substitute a checkbox-looking rectangle.

## 10.2 Accessibility

Button must have:

```
role/button semantics
aria-pressed=true|false
accessible label: "Automatically track application windows"
```

State may not rely only on fill color.

## 10.3 Widget protocol

Add bounded command `set-tracking`.

The widget sends intent only. The authoritative workspace writer commits the state. The widget never directly writes workspace state.

Reuse the existing singular widget-channel authority architecture.

## 10.4 Snapshot

Widget snapshot must carry `trackingEnabled`.

It must not carry `suppressedInstanceIds`, because suppression is policy state, not presentation.

## 10.5 Surgical visual update

Do not rebuild all member DOM merely because tracking toggled.

Update `aria-pressed`, data state/class, and circle fill/outline surgically where possible.

Past member-hover behavior makes unnecessary full-card replacement an avoidable risk.

## 10.6 Toggle ON

When enabled:

1. commit tracking state;
2. request current complete Papers lifecycle snapshot;
3. reconcile existing members;
4. add all currently eligible unsuppressed native instances;
5. subscribe/continue live additions.

## 10.7 Toggle OFF

Commit off. Do not remove members. Future appearance events do nothing until re-enabled.

# STAGE 11 — Startup widget creation/reopening

Purpose: Implement "on startup create the widget immediately."

Classification: HARD CREATOR UX CRITERION

The durable layout record must be created by As-you-Go. The native compact BrowserWindow is created by Papers through the existing host bridge `host.widgetOpen(layoutId)` (current bridge: `public/app/host/host-bridge.js:256-268`).

## 11.1 First feature migration

After As-you-Go state has loaded and authority is available, if `startupWindowLayoutId == null`:

1. create one new ordinary window layout;
2. set `startupWindowLayoutId`;
3. set tracking enabled;
4. commit;
5. request `host.widgetOpen(newLayoutId)`.

Do not reuse an existing pre-feature layout.

## 11.2 Subsequent startup

If startup layout exists, call `host.widgetOpen(startupWindowLayoutId)` immediately after safe bootstrap.

Render circle according to persisted state.

## 11.3 Tracking state across reboot

First-created default: ON.

If the creator later turns it OFF, that OFF persists across reboot. On next startup:

- widget still opens;
- circle is outline;
- no auto-additions occur until creator turns it back on.

Do not override explicit user choice.

## 11.4 Missing startup layout

If the pointed layout was deleted/binned, create a fresh ordinary layout.

Preserve an explicit workspace tracking preference if the final state shape separates that preference; otherwise default the new replacement to ON only according to a documented migration rule.

Do not reference a missing layout indefinitely.

# STAGE 12 — Auto-add current baseline and new windows

Purpose: Make the tracking widget useful immediately.

Classification: CORE FEATURE

## 12.1 Baseline reconciliation

When tracking becomes active, use one complete host snapshot. Do not wait only for future CREATE events.

This supports:

```
Chrome already open
As-you-Go loads later
→ Chrome still gets added
```

## 12.2 Addition predicate

For each current/live candidate:

```
tracking enabled
AND candidate eligible
AND instance not already in target layout
AND instance not suppressed
→ add
```

## 12.3 New member data

Auto-added member receives:

```
new member.id
windowInstanceId
descriptor
current bounds
current state
```

Never reuse a member ID from another layout.

## 12.4 No duplicate instance

Repeated lifecycle event for the same instance yields 0 new memberships.

## 12.5 Existing occurrence in another layout

V1 rule: an exact instance may still occur in several layouts if manually placed.

The auto-tracker deduplicates only against its own target layout. Do not remove/move the member from another layout.

# STAGE 13 — Immediate terminal retirement

Purpose: Implement creator item B safely.

Classification: HARD SAFETY CRITERION

**THIS STAGE MAY NOT BE ENABLED UNTIL STAGES 0–12 PASS.**

## 13.1 Exact predicate

Immediate retirement occurs only when:

```
member has exact windowInstanceId
AND
Papers supplies trusted terminal evidence
that the same exact instance ceased to exist
```

Terminal sources may include:

- watcher DESTROY for exact instance ID;
- current-session capability result with typed `window-gone`;
- exact instance replaced under reused HWND.

## 13.2 Never-retire list

Never immediately remove on:

```
ambiguous
timeout
denied
helper-unavailable
malformed
session-token-unknown
descriptor missing
title change
locked desktop
watcher restart
lifecycle stream gap
```

## 13.3 Runtime observation

Replace old two-miss logic for instance-bound members with:

```
terminal window-gone
→ retire now

nonterminal failure
→ retain

session token stale
→ re-resolve instance
```

Keep conservative legacy behavior for unbound v2 members.

## 13.4 Watcher DESTROY

On exact destroy:

1. authoritative As-you-Go writer receives event;
2. call `removeWindowInstanceFromAllLayouts`;
3. clear caches for all occurrences;
4. prune suppression for that instance;
5. reconcile active recording context if affected;
6. commit once;
7. broadcast updated widget snapshots.

## 13.5 Idempotence

Watcher DESTROY and a later observe `window-gone` may both arrive. The second retirement must be a no-op.

## STAGE 13 EVIDENCE

Chrome A and B share an executable. Close A. Within bounded watcher latency:

```
A disappears from layouts
B remains
```

No two-consecutive-miss delay.

# STAGE 14 — Multi-tab / multi-window application acceptance

Purpose: Prove A is actually solved.

Classification: HARD LAUNCH GATE

## 14.1 Chrome

Create two Chrome top-level windows. Add both. Perform:

- 20 tab switches in A;
- 20 tab switches in B;
- title changes;
- minimize/restore each;
- rapid individual widget toggles;
- helper restart.

Required:

```
both memberships remain
instance IDs never swap
no title change triggers retirement
```

Then close A. Required: only A retires immediately.

## 14.2 Chrome detached tab

Detach a tab into a new Chrome window. Expected: the new top-level instance gets a new `windowInstanceId`.

If tracking ON, the new window auto-adds. If tracking OFF, it does not.

## 14.3 Obsidian

Repeat with multiple windows, pane/tab/title changes, window close, and helper restart.

## 14.4 HWND-reuse test

Destroy one tracked test window. Create replacements until the test harness can simulate/reuse a numeric HWND.

Old member authority must never attach to the replacement.

# STAGE 15 — Reboot and Papers-restart reconciliation

Purpose: Implement creator item C with the corrected semantics.

Classification: HARD LIFECYCLE GATE

## 15.1 Papers restart, same OS session

If tracked native applications remain alive:

```
same windowInstanceIds recovered
members remain
```

Do not treat Papers restart as native-window death.

## 15.2 Full OS reboot

After a real reboot, old window instances necessarily no longer exist. When the watcher baseline completes:

```
old instance-bound members absent
→ terminal reconciliation removes them
```

Layout records remain.

## 15.3 Tracking enabled after reboot

If `tracking.enabled === true`, complete baseline:

```
remove dead old instance memberships
+
add currently eligible new instance windows
```

Final layout reflects current live applications.

## 15.4 Tracking disabled after reboot

If OFF:

```
old dead instance memberships removed
no new members auto-added
layout may remain empty
widget opens outline
```

This is intentional.

## 15.5 Suppression across reboot

Old suppressed instance IDs correspond to dead old instances. After complete baseline proves those instances absent, prune suppression IDs.

A new Chrome window after reboot has a new instance ID and is eligible if tracking becomes enabled.

## 15.6 No boot-ID guesswork

Do not delete based merely on wall-clock/restart detection. Use exact native-instance reconciliation.

That automatically distinguishes:

```
Papers restarted, app survived
from
OS reboot/app window died
```

# STAGE 16 — Manual removal suppression

Purpose: Prevent the tracker from fighting the creator.

Classification: HARD UX CRITERION

## 16.1 Remove from tracking layout

Creator removes a live member:

```
remove membership
add windowInstanceId to suppressedInstanceIds
```

## 16.2 Same window remains alive

Watcher updates / baseline refreshes: do not re-add.

## 16.3 Toggle tracking OFF then ON

Same live suppressed instance: still do not re-add.

Do not let toggle cycling undo a creator removal.

## 16.4 Window closes

On exact instance DESTROY, remove the suppression entry.

## 16.5 New window from same application

Chrome A was suppressed. Close A. Create Chrome C.

Required:

```
instanceId(C) != instanceId(A)
C may auto-add
```

Do not suppress by executable fingerprint.

# STAGE 17 — Title/display metadata behavior

Purpose: Separate mutable display data from authority.

Classification: CORE CONSISTENCY

Title changes must never affect membership identity.

Decide one explicit display policy. Recommended v1:

```
member descriptor/title remains last known display title
and may be refreshed from trusted live observation
```

If title metadata is updated:

- update title only;
- keep same instance ID;
- do not create a new member;
- do not reset suppression;
- do not treat as removal/addition.

If title persistence creates excessive document churn during browser tab switching, keep live title ephemeral in runtime/widget state and persist less frequently.

Do not let display freshness become an identity requirement.

# STAGE 18 — Multi-surface authority

Purpose: Prevent duplicate auto-add/remove writes.

Classification: HARD CORRECTNESS

As-you-Go already has one elected document writer. Use it.

## 18.1 Non-authoritative surfaces

May observe lifecycle events. Must not commit auto-add, retirement, or tracking-state changes originating elsewhere.

## 18.2 Widget toggle

Widget sends command. Only the writer commits the tracking change.

## 18.3 Writer dies

New writer:

1. acquires document authority;
2. requests complete Papers lifecycle snapshot;
3. reconciles exact live instance set;
4. then consumes new events.

## 18.4 Event sequence gaps

If the event sequence jumps:

```
do not infer deaths
request complete snapshot
reconcile
```

A missing event is infrastructure uncertainty, not native-window death.

# STAGE 19 — Runtime/control integration

Purpose: Ensure the recording controller uses instance identity consistently.

Classification: CORE FEATURE

Expected As-you-Go files:

```
public/app/window-layout-runtime.js
public/workspace-20260730b.js
```

## 19.1 Capability cache key

Current cache may remain `layoutId + memberId`, but the recovery identity behind each member is now `windowInstanceId`.

## 19.2 Stale capability

On session token loss, resolve by `windowInstanceId`, not exact title descriptor.

## 19.3 Recording observation

Successful observation may update state, bounds, and live title metadata as defined. Never change instance ID.

## 19.4 Member picker/manual add

All fresh manual adds must obtain the exact instance ID at bind time.

## 19.5 Existing descriptor resolution

Keep old descriptor resolution only for legacy migration, explicitly approved reconnect UX, and other existing features that still need it.

It is no longer the primary live identity of a v3 member.

# STAGE 20 — Auto-tracking performance and resource cost

Purpose: Ensure continuous tracking does not recreate prior helper-latency problems.

Classification: HARD PERFORMANCE GATE

## 20.1 No control-helper polling

Assert over a 5-minute idle session:

```
0 periodic windowCandidates calls caused by auto tracking
```

## 20.2 Watcher CPU

Idle watcher target: near-zero sustained CPU. Measure on creator hardware.

Suggested gate: `< 0.5%` average CPU while desktop idle, excluding short lifecycle bursts.

## 20.3 Event storm

Create/destroy 100 transient test windows. Required:

- bounded memory;
- no control-helper queue growth;
- no duplicate layout members;
- stabilization filters transient windows;
- no graph/full workspace render per raw WinEvent callback.

## 20.4 Batch commits

If several eligible windows appear during application startup, batch additions over a small bounded commit window rather than saving once per event where possible.

Example: `50–100 ms` mutation batching, which must not delay visible auto-add excessively.

## 20.5 Graph impact

Auto-added members update one layout card. Do not force unrelated graph nodes to rebuild.

# STAGE 21 — Known limitations / product honesty

Classification: HARD DOCUMENTATION CRITERION

Document explicitly:

- exact native identity is guaranteed for the lifetime of a specific tagged window instance;
- Chrome/Obsidian tab title changes do not create new identities;
- two top-level windows of one app are distinct instances;
- once a native window is destroyed, generic Windows APIs cannot prove that a later newly created Chrome window is "the same conceptual window";
- a new native window therefore receives a new instance ID;
- auto tracking can add the replacement when enabled;
- tracking OFF means replacements are not automatically restored;
- legacy pre-feature descriptor-only members may need safe migration/rebind;
- an arbitrary third-party installer main window cannot always be distinguished perfectly from an ordinary desktop app by generic Win32 metadata;
- v1 auto tracking is intentionally conservative and may omit unclassified/portable apps rather than capture unsafe/transient surfaces;
- omitted applications remain manually addable.

# STAGE 22 — Tests that must exist

Classification: HARD DEFINITION-OF-DONE REQUIREMENTS

## Instance identity

- [ ] title change preserves instance ID.
- [ ] same-executable windows get different IDs.
- [ ] helper restart recovers same live instance.
- [ ] Papers restart same boot recovers same live instance.
- [ ] destroyed HWND loses old identity.
- [ ] reused HWND cannot inherit old identity.
- [ ] elevated inaccessible target fails closed.

## Helper token semantics

- [ ] title no longer participates in token validity.
- [ ] PID/instance mismatch fails.
- [ ] stale session token reports session-token-unknown.
- [ ] dead exact window reports window-gone.
- [ ] typed reasons survive parser/service/IPC/preload.

## Model

- [ ] v2 member migration safe.
- [ ] v3 member persists instance ID.
- [ ] raw HWND/runtime token rejected.
- [ ] cross-layout removal keyed by instance ID.
- [ ] sibling same-app member survives another's removal.
- [ ] empty layout retained.

## Tracking state

- [ ] one layout enabled at a time.
- [ ] toggle ON disables previous tracker.
- [ ] toggle OFF preserves members.
- [ ] toggle OFF survives reboot.
- [ ] startup pointer survives.
- [ ] invalid startup pointer repairs.

## Widget

- [ ] filled circle means ON.
- [ ] outline means OFF.
- [ ] aria-pressed correct.
- [ ] widget toggle commits only through writer.
- [ ] closing widget does not disable tracking.
- [ ] reopening reflects persisted state.
- [ ] toggling does not rebuild member DOM unnecessarily.

## Watcher

- [ ] race-free baseline + event handoff.
- [ ] monotonically sequenced events.
- [ ] restart produces new session ID.
- [ ] gap forces snapshot reconciliation.
- [ ] no raw HWND exposed.
- [ ] destroy identifies exact instance.
- [ ] title change not emitted as destroy.

## Eligibility

- [ ] Papers surfaces excluded.
- [ ] tooltips excluded.
- [ ] tool windows excluded.
- [ ] no-activate surfaces excluded.
- [ ] WorkerW/Progman excluded.
- [ ] dialogs/owned popups excluded.
- [ ] short splash excluded.
- [ ] known installer/update hosts excluded.
- [ ] Chrome included.
- [ ] Obsidian included.
- [ ] VS Code included.
- [ ] minimized ordinary app included.

## Auto add

- [ ] current baseline app added when tracking turns ON.
- [ ] new eligible window added once.
- [ ] duplicate event adds zero duplicate member.
- [ ] tracking OFF adds nothing.
- [ ] manually suppressed instance not re-added.
- [ ] new replacement instance is eligible.

## Retirement

- [ ] exact destroy removes immediately.
- [ ] timeout does not remove.
- [ ] ambiguous does not remove.
- [ ] denied does not remove.
- [ ] helper unavailable does not remove.
- [ ] helper restart does not remove.
- [ ] title change does not remove.
- [ ] session-token-unknown does not remove.
- [ ] duplicate terminal event is idempotent.

## Reboot

- [ ] Papers restart with live app preserves membership.
- [ ] actual OS reboot removes old instance memberships.
- [ ] tracking ON repopulates current live windows.
- [ ] tracking OFF remains empty/no additions.
- [ ] layout container remains.
- [ ] old suppression IDs pruned.

## Multi-surface

- [ ] exactly one writer auto-adds.
- [ ] exactly one writer retires.
- [ ] writer handover snapshot reconciles.
- [ ] nonwriter cannot double-add.

## Performance

- [ ] no repeated control-helper enumeration.
- [ ] watcher idle CPU within budget.
- [ ] event storm bounded.
- [ ] no control latency regression.
- [ ] no unbounded workspace/save storm.

# STAGE 23 — DO-NOT-SHIP failure cases

Stop the rollout if any of these occur:

- Chrome tab switch removes a member.
- Obsidian pane/tab title change invalidates capability.
- helper restart deletes members.
- one Chrome window closing removes another Chrome window.
- timeout/denied/helper-unavailable deletes member.
- lifecycle event gap is interpreted as death.
- auto mode captures Papers' own windows.
- auto mode repeatedly captures dialogs/splash screens.
- manually removed window immediately comes back.
- tracking OFF does not survive reboot.
- widget circle state disagrees with durable layout state.
- startup creates multiple tracking-enabled layouts.
- watcher significantly delays control helper operations.
- old raw descriptor logic still performs cross-layout retirement by title+fingerprint.

# Definition of Done

This entire consistency feature is complete only when all statements below are true.

## Identity

- [ ] A live top-level native window has a Papers-owned exact instance ID independent of title.
- [ ] Chrome/Obsidian title changes do not alter identity.
- [ ] Two windows of one process/application remain distinct.
- [ ] helper/Papers restart can recover a still-live exact instance.
- [ ] destroyed/reused HWND cannot inherit old authority.
- [ ] no HWND is persisted as durable authority.

## Retirement

- [ ] exact native instance death removes every occurrence immediately.
- [ ] same-app sibling instances remain.
- [ ] timeout/ambiguous/denied/helper failure never destructively retire.
- [ ] stale helper token recovers by instance ID.
- [ ] legacy descriptor-only members remain conservative until safely upgraded.

## Auto tracking

- [ ] exactly one layout may track automatically in v1.
- [ ] startup widget is created/reopened automatically.
- [ ] first-created tracking state defaults ON.
- [ ] filled circle = ON.
- [ ] outline circle = OFF.
- [ ] OFF persists through reboot.
- [ ] ON adds current eligible windows and future eligible windows.
- [ ] OFF adds none.
- [ ] closing the widget does not change tracking.
- [ ] manually removed instance remains suppressed while alive.
- [ ] new replacement instance can be added.

## Filtering

- [ ] real app main windows included.
- [ ] Papers surfaces excluded.
- [ ] dialogs/popups excluded.
- [ ] tooltips/tool windows excluded.
- [ ] transient splashes excluded.
- [ ] known installer/system setup windows excluded.
- [ ] unclassified unsafe candidates are omitted rather than guessed.

## Restart/reboot

- [ ] Papers restart while apps survive retains memberships.
- [ ] full reboot removes memberships for old dead instances.
- [ ] layout records may remain empty.
- [ ] enabled tracking layout refills from current live eligible windows.
- [ ] disabled tracking layout remains empty until creator acts.
- [ ] startup widget always reflects persisted toggle truth.

## Architecture

- [ ] native watcher is event-driven/separate from control-helper polling.
- [ ] only As-you-Go writer mutates membership.
- [ ] widget remains a presentation, not a data owner.
- [ ] helper resource hash provenance remains intact.
- [ ] existing manual picker/group actions still work.
- [ ] current control responsiveness is not regressed.

# Creator acceptance walk

Perform this on the real Windows machine with the packaged Papers build.

## Startup/default

1. Start Papers and open As-you-Go after upgrading from the old baseline.
2. Verify a compact window-layout widget appears automatically.
3. Verify its corner circle is filled.
4. Verify only one layout is auto-tracking.
5. Verify existing pre-feature layouts were not silently commandeered.

## Baseline population

1. With Chrome, Obsidian and VS Code already open, enable tracking if necessary.
2. Verify each eligible main application window appears once.
3. Verify Papers itself does not appear.
4. Verify tooltips/dialogs do not appear.

## Chrome identity

1. Open two separate Chrome top-level windows.
2. Verify both appear as separate members.
3. Switch tabs in Chrome A repeatedly so its title changes.
4. Verify Chrome A remains present.
5. Switch tabs in Chrome B repeatedly.
6. Verify Chrome B remains present.
7. Minimize/restore/toggle both from the widget.
8. Verify every action still reaches the correct native window.

## Obsidian identity

1. Create multiple/detached Obsidian windows.
2. Change active notes/tabs so titles change.
3. Verify memberships remain bound to the same exact top-level windows.

## Immediate retirement

1. Close Chrome A.
2. Verify its member disappears immediately without waiting for two observations.
3. Verify Chrome B remains.
4. If Chrome A occurs in another layout, verify that occurrence also disappears.
5. Verify no unrelated same-executable member disappears.

## Nonterminal failures

1. Simulate/reproduce helper restart while Chrome B remains open.
2. Verify Chrome B does not disappear.
3. Verify fresh capability recovers the same instance.
4. Simulate a capability timeout.
5. Verify member remains.
6. Simulate denied/helper-unavailable.
7. Verify member remains.

## Manual suppression

1. With tracking ON, manually remove Chrome B from the tracking layout.
2. Wait through watcher events/baseline refresh.
3. Verify Chrome B does not return.
4. Turn tracking OFF and ON.
5. Verify same Chrome B still does not return.
6. Close Chrome B.
7. Open a brand-new Chrome window.
8. Verify the new instance may auto-add.

## Tracking toggle

1. Click the filled circle.
2. Verify it becomes outline.
3. Open a new Notepad/eligible app window.
4. Verify it is not added.
5. Verify existing layout members remain.
6. Click outline circle.
7. Verify it becomes filled.
8. Verify current eligible live windows are reconciled/added.

## Popup/splash filtering

1. Trigger a file picker or modal dialog from an app.
2. Verify the dialog is not added as a member.
3. Launch an app with a visible splash screen.
4. Verify the splash is not added.
5. Run a known installer/update flow used in the eligibility tests.
6. Verify the installer surfaces intended to be excluded are not tracked.

## Widget lifecycle

1. Close the compact widget.
2. Verify tracking state does not change.
3. Reopen it.
4. Verify circle reflects durable state exactly.

## Papers restart

1. Leave Chrome/Obsidian windows alive.
2. Restart Papers without rebooting Windows.
3. Reopen As-you-Go.
4. Verify the startup widget appears.
5. Verify surviving native windows retain their memberships/exact identity.
6. Verify no title-based rebinding occurs.

## Full reboot

1. Set tracking ON.
2. Reboot Windows.
3. Allow Papers/As-you-Go to start.
4. Verify old pre-reboot memberships are removed.
5. Verify the layout container remains.
6. Launch/open eligible applications.
7. Verify new native instances populate the tracking layout.
8. Verify no old instance IDs remain authoritative.

## Tracking OFF reboot

1. Turn tracking OFF.
2. Reboot again.
3. Verify startup widget reappears with outline circle.
4. Verify old dead memberships disappear.
5. Verify new applications are not automatically added until tracking is turned back ON.

## Multiple Papers/As-you-Go surfaces

1. Open the project in two ordinary As-you-Go surfaces.
2. Create one new eligible native application window.
3. Verify exactly one membership is committed.
4. Close the current document-writer surface.
5. Verify new writer reconciles from a fresh lifecycle snapshot.
6. Create another native application window.
7. Verify exactly one new membership appears.

## Final performance check

1. Keep tracking enabled during normal creator use for at least 30 minutes.
2. Verify window toggles remain as responsive as before the watcher feature.
3. Verify no periodic `windowCandidates()` traffic from the tracker.
4. Verify idle watcher CPU remains within the agreed budget.
5. Verify no runaway save/event loop appears.

The feature is done only when this complete acceptance walk passes and ordinary Chrome/Obsidian title changes are demonstrably incapable of invalidating or deleting their window-layout memberships.

# Open items flagged by the reviewer

- [ ] **Resolve the window-tag lifetime contradiction.** Stage 0 requires the instance tag to survive Papers/helper process death (0.3 "Papers restart on same Windows session") while also being destroyed with the HWND. Confirm which property mechanism actually gives both, and record the answer before Stage 1.
- [ ] **Define exact startup and reboot state transitions** as a single table, rather than leaving them distributed across Stages 11 and 15.
- [ ] **Separate mandatory gates from recommendations** where a stage mixes both.
