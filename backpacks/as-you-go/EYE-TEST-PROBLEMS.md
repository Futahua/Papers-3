# As you Go — creator eye-test problems

This file records unresolved creator-observed behavior for this machine-local Backpack.
Creator eye-test observations outrank earlier automated acceptance claims. These problems
do not define Papers-wide behavior and are not permission to generalize As you Go into the
Papers binary.

## 2026-08-11 — Window layout eye test (release-eyetest-019r1)

### P1 — Layout card is visually cluttered and communicates window state incorrectly

Status: unresolved; creator rejected the current presentation.

- Remove the large decorative folder illustration from the layout card.
- Reduce the card's visual clutter and let useful content determine its size.
- Remove the intrusive native-looking horizontal scrollbar presentation.
- An open/normal member window should show a small bar below its icon.
- A minimized member window should show no bar at all.

Evidence:
`D:\Programs\evTEMP\codex-clipboard-ee7849bf-d2c0-4aeb-a825-420af7d9a7d8.png`

### P2 — Cursor picker visibly fails and blocks the desktop

Status: unresolved functional blocker; creator rejected the automated acceptance result.

- Clicking the cursor-picker control creates an invisible full-screen surface that blocks
  the desktop.
- No green, blue or red overlay is visibly rendered during the real creator eye test.
- The creator cannot visually select any window.
- Pressing Enter merely dismisses or moves away the invisible blocking surface.
- Investigate and reuse the proven window-modification/highlighting mechanism in
  `D:\333\SlopTop\sloptop_engine.ahk` instead of assuming the current Electron overlay is
  an acceptable visual implementation.

Earlier automated pointer/state receipts did not prove creator-visible rendering. They are
diagnostic evidence only and do not close this problem.

### P3 — AutoCAD control fails; minimized-window previews defeat their purpose

Status: unresolved.

- Layout capture/minimize/restore works consistently for most tested windows but fails for
  AutoCAD (`acad`). The AutoCAD-specific native behavior must be reproduced and diagnosed.
- Thumbnail preview currently works only while the target window is not minimized.
- A minimized window must still provide a useful preview; icon/name-only fallback is not the
  accepted product behavior because preview is most useful when the window itself is hidden.

This explicitly supersedes the earlier acceptance rule that treated a minimized result with
no thumbnail as sufficient.

### P4 — Attached and detached presentations are inconsistent and unusable

Status: unresolved; creator described the result as absolutely horrid.

Attached surface problems:

- Giant decorative folder art and an oversized title dominate the member controls.
- Members and controls are compressed into a cluttered inner box.
- The scrollbar is visually disproportionate.
- Card proportions follow decoration rather than content.

Detached surface problems:

- Detaching transforms the card into a different interface instead of moving the same card.
- A huge, mostly empty window contains unrelated slider, duplicate and delete furniture.
- Real member icons become blank placeholders.
- The layout identity degrades to `unknown-layout`.
- Controls become extremely small and the styling/spacing/scale no longer match the attached
  card.
- The OS title bar redundantly says `Window layout`.

Required direction: attached and detached states use one consistent, compact, content-sized
card that preserves the exact layout name, icons, members, controls and appearance. Detaching
changes where the card lives, not what the card is.

Evidence:

- `D:\Programs\evTEMP\codex-clipboard-8006f285-a340-4cc9-8696-41342e19e43a.png`
- `D:\Programs\evTEMP\codex-clipboard-98d84eb7-9512-4511-8d22-97015086afea.png`

### P5 — Simplify layout identity and controls; support member reordering

Status: requested creator change.

- Remove layout name customization.
- Remove layout icon customization.
- Allow the creator to reorder the member application icons within a layout.
- Make the action buttons tighter and more compact.
- Do not draw an individual box around every action button; present the controls as one
  lightweight, visually coherent row.

This is layout-specific product direction. It does not remove naming or icon customization
from ordinary As you Go folders or shortcuts.

## 2026-08-12 — Creator eye test after wave 032

This eye test rejects wave 032 as a completed milestone. The observations below supersede
worker reports and automated/live-gate acceptance claims wherever they conflict.

### Accepted behavior

- Cursor picking now has the correct fundamental add/remove interaction.
- AutoCAD (`acad`) preview/capture behavior is solved.
- Useful previews work both before and after a target is minimized.
- Member-icon reordering works correctly.
- The previously accepted removal of individual action-button outlines remains accepted.

These acceptances are narrow. They do not close the unresolved lifecycle, performance,
overlay, sizing, detached-widget, or control-semantics problems below.

### C1 — Picker startup and hover response are unacceptably slow

Status: unresolved performance defect.

- Picker initialization takes approximately five seconds before a window can be picked.
- After initialization, the visible hover selection significantly lags behind mouse movement.
- Preserve the now-correct blue-add/red-remove, multi-select, Enter-confirm and cancellation
  behavior while making startup and continued hover tracking feel immediate and direct.
- A passing functional picker gate does not close this problem unless it measures production-
  path initialization and cursor-to-highlight latency.

### C2 — Picker overlay intermittently becomes a malformed large blue surface

Status: unresolved intermittent visual/lifecycle defect; trigger unknown.

- The overlay sometimes covers almost the entire target window with a translucent blue wash
  and bright cyan border instead of remaining a clean temporary hover/staging indication.
- Reproduce across repeated picker open/hover/stage/cancel/confirm cycles and investigate
  geometry, stale state, window reuse, teardown, and timing.
- The overlay must never remain stuck, use stale target bounds, or resemble a persistent
  full-window blocking surface.

Evidence:
`D:\Programs\evTEMP\codex-clipboard-e921c9a0-bbb8-48d8-a909-07182037348a.png`

### C3 — Member-list interaction destroys preview and running state

Status: unresolved lifecycle/state defect.

- Previewing itself works before and after minimizing.
- Interacting with and then closing the member list stops window previews.
- Closing the list also throws away the small active/running bar beneath member icons.
- List visibility is presentation state only. Closing it must not stop capture/preview services,
  discard membership/runtime observations, or clear the active indicator.
- Preserve the accepted rule: the bar appears for an open/non-minimized member and disappears
  for a minimized member.

### C4 — Card does not resize or reflow beyond four member icons

Status: unresolved content-sizing defect.

- The layout visually caps at one row of four icons.
- Adding members does not make the frame resize or reflow to represent the complete list.
- The card must adapt its dimensions and/or rows to member count while remaining compact and
  content-sized; no member may be hidden by a hard four-icon presentation cap.

### C5 — Detached widget remains visually unimplemented

Status: visually rejected.

- No meaningful detached-widget improvement was visible in the creator eye test.
- It remains an oversized, mostly empty window whose controls and member icons look like
  disconnected window furniture.
- The detached widget is **this card only**: the same compact member card shown inside the
  workspace, matching it **1:1** in component, dimensions, background, border, spacing,
  icons, controls, state and behavior. It is not a new detached interface and not a host panel
  containing a reconstruction of the card. Detaching changes the card's location only.
- Reuse/render the same card component and state path for attached and detached modes. Do not
  maintain two visually similar implementations that can drift.
- The detached window must content-fit the card itself. There must be no empty surrounding
  canvas, unrelated header, slider, duplicate/delete furniture, alternate toolbar, padding
  field, or other detached-only UI around it.
- Internal spacing must remain even, with safe padding at every card edge. No member or control
  may be clipped; specifically, the lock icon was observed partially cut off at the trailing
  edge. Both member icons and controls must compactly wrap/reflow as width or count requires,
  while attached and detached rendering remain 1:1.
- A later correction build still showed unrelated buttons on the detached widget. Remove all
  detached-only/host furniture: the widget contains the shared card and its legitimate card
  controls only.
- The exact icon count was not measured, but the build waited too long before starting another
  row: the card had already become an overly long strip. Wrapping must preserve a deliberately
  compact, balanced rectangular card, not merely occur at some eventual maximum. Use the same
  bounded width and early reflow rule in attached and detached modes.
- The creator clarified that this must not be implemented with a hardcoded icon/column count.
  The detached window must be resizable, and the shared member grid must wrap responsively from
  the actual available width. Narrower widths create more balanced rows; wider widths create
  fewer only while retaining compact proportions. Every supported width preserves even gaps,
  safe padding, full controls and no clipping or overflow. Attached and detached modes use the
  same responsive card component and layout behavior.
- The attached card is proportionable/resizable through the same shared presentation geometry.
  While the widget is detached, its attached workspace representation becomes a greyed-out,
  noninteractive placeholder; only the lock/detach toggle remains clickable so it can be
  reattached. The detached widget is the sole live card during that period.
- Any detached resize or resulting responsive reflow must persist to the shared card geometry.
  On reattach, the attached card follows the detached widget's latest size, proportion and member
  arrangement immediately. Attached and detached modes must not have independent sizing state or
  reset geometry during transitions.

Reference for a good compact natural width (not a fixed eight-column rule):
`D:\Programs\evTEMP\codex-clipboard-657f9ec3-80a1-42f1-9318-51a2bbe4d725.png`

## 2026-08-12 — Creator eye test after wave 037

Status: wave 037 rejected; all observations below are unresolved except behavior explicitly
preserved from earlier narrow acceptances.

1. Newly created layouts initially show blank member-icon slots; icons arrive noticeably later.
   Initial icon readiness must not expose an incomplete card or cause layout shift.
2. Separate layouts visibly share window state: moving a member in one updates another. Layout
   arrangements, runtime UI state and mutations must be isolated by layout plus member identity.
3. A one-member layout remains a wide mostly-empty card instead of content-fitting.
4. Detached widget still nests the card inside a large blank native host canvas.
5. Neither attached nor detached card can be resized by dragging edges. Reflow also orphaned a
   running bar onto its own row; icon+indicator must remain one member cell.
6. Right-clicking a member icon should offer `Remove from this layout` in addition to the two
   existing removal paths.
7. The Electron cursor-picker overlay architecture is rejected. It creates invisible desktop-
   wide interference, conflicts with the creator's AHK modes and prevents moving windows during
   the session. Investigate and integrate the mode directly into
   `D:\333\SlopTop\sloptop_engine.ahk`: picker button activates the mode; while Ctrl+Shift is
   held, unselected hover is faint purple, click adds a green border, selected hover is faint
   red, click removes the green selection, and overlapping selections keep overlapping borders.
   Other AHK hotkeys and ordinary window movement must continue to work.
8. Reordering is intermittently unreliable across repeated drags. The first reorder succeeds;
   an immediate second reorder can fail with `host request timeout`, after which reordering only
   begins working again after several additional drag attempts. Reordering must succeed on every
   valid consecutive drag without host-request timeouts, dropped requests, retry rituals, stale
   in-flight state, or a required cooldown. Exercise a sustained sequence of consecutive reorder
   operations—including rapid second and later drags—and prove request/ack correlation, timeout
   cleanup, persisted order and rendered order remain synchronized after every operation.

Evidence:

- `D:\Programs\evTEMP\codex-clipboard-a13fb3ba-e4f1-400b-a397-ba948422e152.png`
- `D:\Programs\evTEMP\codex-clipboard-774dbfe1-e903-4043-86ae-3bc922f5a41e.png`
- `D:\Programs\evTEMP\codex-clipboard-13e25c98-aa4d-488e-9aad-22ac4aac6f6d.png`
- `D:\Programs\evTEMP\codex-clipboard-8a0a5a13-9427-492d-9a32-474a1dde9d8a.png`
- `D:\Programs\evTEMP\codex-clipboard-0f8addf4-d5bc-434b-b9cf-258b9e14c6ca.png`

The Manager completed source investigation before redispatch. Its authoritative architecture
and mandatory long-session gates are in
`brain\manager-investigation-038.md` under the August 10th coordination logs. The next eye check
is forbidden until those gates pass after an hours-long unattended session.
- Remove the redundant `Window layout` label/title from both attached and detached
  presentations, including redundant detached window chrome where controlled by the product.
- The lock icon has one simple meaning: clicking it toggles the detached widget on or off.
  Do not present or implement it as editing, pinning, or a separate lock state.

Evidence:

- `D:\Programs\evTEMP\codex-clipboard-5615fe67-6f56-46a9-8508-6b7590f1a4a0.png`
- `D:\Programs\evTEMP\codex-clipboard-3e76fbb6-4598-444e-b92a-2e293110e66d.png`
- `D:\Programs\evTEMP\codex-clipboard-d820355e-9c1c-4eab-8f62-b19a541bcc92.png`

## 2026-08-13 — Direct Manager recovery implementation

Status: implemented in source and mechanically verified; **not creator accepted** and not yet
installed as a new Papers build.

- The picker now lives in the existing AHK loop without a screen-wide input-owning Electron
  overlay. Session discovery is warmed before Ctrl+Shift hover begins, dead-localhost calls have
  strict timeouts, hover updates are sent only when the topmost target changes, and malformed
  overlay geometry is clipped to the virtual desktop.
- Papers now seeds existing picker members concurrently after the AHK handshake rather than
  resolving and observing them serially. This removes layout-size-dependent startup delay from
  that phase. Unit coverage proves multiple member resolutions are simultaneously in flight.
- Attached and detached presentations keep one shared titleless card, with a 280px compact cap,
  content-fit single-member sizing, resizable attached and detached hosts, and responsive balanced
  rows computed from actual card width rather than a hardcoded icon count. Visual fixture checks
  covered 1, 8, 9 and 14 members with no horizontal overflow (9 becomes 5+4; 14 becomes 7+7).
- Fresh widget startup no longer renders the known-empty card before its authoritative snapshot.
  Missing icons have a stable generic window fallback so the card does not expose a blank slot.
- Wrapped-row reorder now uses row-major pointer position. Widget reorder commands have bounded
  acknowledgement retries and authoritative resynchronization, so a lost acknowledgement cannot
  permanently wedge later drags.
- Closing a member list restores the still-hovered preview immediately. Picker cleanup is scoped
  to the layout that actually owned the picker instead of clearing an arbitrary active layout.
- Card resize observers are explicitly detached with graph/card teardown.

Mechanical evidence:

- Papers focused picker/session tests: 33 passed; Papers TypeScript typecheck passed.
- Backpack focused window-layout suite: 153 passed.
- Backpack expanded card/window-layout suite: 191 passed, with one pre-existing unrelated
  breadcrumb-style expectation failing.
- Backpack complete registered suite: 900 of 903 passed; the three known failures predate this
  recovery (one breadcrumb styling expectation and two toolbar percentage-position expectations).

This record does not promote the work to creator acceptance. A genuine eye test requires the
updated Papers host/AHK path to be installed or restarted under explicit release/runtime
authorization, followed by the real creator workflow. Do not request that eye test from source
or test evidence alone.

## 2026-08-13 — Creator correction after unsafe live picker regression

Status: source correction in progress; **not installed, not live-tested, and not creator
accepted**.

- The attempted mixed-authority picker became unsafe in the creator's real desktop: purple
  surfaces oscillated/lingered, green became a flashing opaque fill, click regressed, Escape
  became unavailable, and the creator ultimately had to reset the PC.
- The corrected architecture is two one-shot boundaries only. Papers sends an activation token
  plus the current member snapshot to the already-running AHK. AHK then owns hit-testing,
  hover visuals, click toggling and the complete green set locally. Enter returns one final
  native selection snapshot; Papers resolves it and performs descriptor/capability/persistence
  routing afterward. No hover or click may synchronously call Papers, PowerShell or HTTP.
- Picker activation requires no modifier. Unselected topmost hover is a steady faint purple
  tint; click selects it. A selected window has a green **border only**; selected hover is a
  steady faint red removal preview; click removes it. Escape must clear locally and cancel
  immediately. Existing SlopTop modifier modes retain their ordinary behavior while picker
  mode is open.
- Green borders belong to their selected windows' z-order. Foreground windows may obstruct a
  lower window's green border; outlines must never be drawn through unrelated windows because
  that falsely communicates which surface is in front.
- The final snapshot is all-or-nothing. If Papers cannot uniquely rebind every green native
  identity at Enter, no layout mutation is applied.
- The AHK integration remains safety-disabled until syntax, focused host tests and a controlled
  non-creator-data validation pass. Do not infer permission to restart the creator's AHK,
  install/release Papers, inject input, or begin a real eye test from source completion alone.

### Next creator checkpoint

Do not request another eye test from source presence, passing tests, isolated screenshots, or
the previous wave's acceptance mapping. Correct C1-C5, exercise the repeated lifecycle paths,
and verify attached/detached visual identity at representative member counts above four. The
next eye-check request is earned only after those specific creator-observed failures have no
known implementation or production-path contradiction.

## 2026-09-07 — Detached widget: hover flicker and dead member icons

Both defects trace to one root: the multiple-tab feature made the number of workspace
surfaces plural, but widget-channel authority stayed singular in intent only. The creator
independently noted this "breaks sometimes after multiple tab feature was added", and the
persisted topology confirms the project was open in **two** surfaces at once.

### F1 — Hovering the member icons made every icon flicker at once — FIXED (creator-confirmed)

Creator: "as I hover over the icons something repeatedly triggers the hover action that makes
the highlight flickers and I cant perform actions on the icons"; later "all of them flickers",
the widget window itself stayed put, and the attached card was never tried.

Simultaneous whole-strip flicker is a wholesale card rebuild, not a per-element hover
transition. Hover was never the trigger — it only made an already-running loop visible.

- The compact widget loads the workspace bundle, so it also constructed the WORKSPACE-side
  responder. The widget skips `bootstrapWorkspace()`, so that responder held no layout and
  answered the widget's OWN `snapshot-request` with `unknown-layout`, re-arming the widget's
  bounded retry, which requested again — endlessly.
- Each responder owns a private revision map starting at 0, so two workspace surfaces answered
  with `r=3, r=0, r=3, r=0` for identical content. The widget guarded on
  `revision === lastRevision` only, so every one passed and rebuilt the card.

Fixed by an inert channel on the widget surface and a render-identity guard keyed on what the
card DOM is actually built from. Creator verdict: "flicker stopped".

### F2 — Member icons acknowledge the click but the window never moves — fix pending eye test

Creator: "It reacts visually but the window doesn't respond", while minimize-all, restore-all
and the list glyph all work.

A member click sends `member-toggle`, which reads the window's LIVE state and inverts it. Group
actions send absolute `group-action` commands. With two responders both passing their own
`baseRevision` check, the toggle is applied twice — minimize then restore, net nothing — while
absolute operations are idempotent under duplication. That asymmetry is the whole symptom.

Fixed by electing exactly one authority: the responder now gates every protocol effect on the
existing document-WRITER election, re-read per message so a handover needs no reconnection.

**Known limitation, not hidden:** revision counters remain per-responder, so the first command
after a writer handover is refused as `stale`; the widget resyncs and the next one lands. One
command is dropped per handover. Closing that needs durable revision authority, or correlated
ACK/retry with de-duplication — a plain retry would UNDO a toggle the dead writer had applied.

### F2 follow-up — dividing the authority boundary correctly

The first authority cut gated every inbound channel message at once, which was too broad and
introduced three regressions of its own. Two kinds of effect arrive on that channel and they
need opposite policies:

- **Authoritative** (WRITER only): native commands, revision ownership, snapshot replies and
  durable card-size persistence.
- **Local presence** (every ordinary workspace surface): "a widget for this layout is
  open/closed". That drives whether *this* surface shows the greyed placeholder, so gating it
  let a non-writer tab keep displaying a live attached card, and could strand the flag on a
  surface demoted between a widget's open and its close.

Two further consequences of the over-gate, both fixed:

- Any surface may originate a layout edit and forward it to the writer, but its `noteCommitted`
  was suppressed and the writer never re-issued it — a change made in a non-writer tab left the
  widget on a **stale layout**. The writer now diffs durable layout state where it *installs*
  an accepted document, so the widget is told after the writer really holds the state.
- Member icons resolved in a non-writer tab could no longer be published, and the writer may
  not even be displaying that layout, so the widget could sit on placeholders. The authority
  now hydrates its own missing icons when it answers a widget.

When writer election fails outright, mutation still fails closed — inventing a fallback
authority would recreate the plural-execution bug — but the widget is now told why instead of
being left blank, since its retry only ever arms on an explicit `unknown-layout`, never on
silence.

### F2 root cause — the member click asked the wrong source which layout was active

The authority fix above was real but was NOT the cause of F2. The creator re-tested after
exiting and re-entering the backpack and building a brand new layout: unchanged. Papers serves
each backpack open under a fresh URL namespace with no cache policy, so the new code had loaded.

The individual member click gated on the DURABLE `state.activeWindowLayoutId`, while
`ensureRecording()` decided from the recording controller's own live `activeLayoutId`. Those
answer different questions and can disagree, because `activeWindowLayoutId` is shared top-level
document state: `installPeerDocument()` takes it straight from another surface's document —
including on the elected writer accepting a forwarded mutation — while the runtime's
`activeLayoutId` is a closure variable no document install can reach. That is the multi-tab
correlation the creator remembered.

Once diverged the click deadlocked. Durable said "not current", so it called `ensureRecording`
and returned; `ensureRecording` asked the runtime, which said "already current", so it only
reconciled — and `reconcileActive` deliberately never writes state. Nothing changed, so every
later click repeated it, permanently and silently, never reaching a capability call. Group
actions never consult this gate, which is why they kept working while every icon looked dead —
and because minimize-all calls `ensureRecording` only *after* it finishes, using the group
buttons actively kept the individual click broken.

The Papers host was audited end to end for this (preload → windowCapabilityIpc →
windowCapabilityService → helper → the Win32 calls) and introduces no single-member vs group
distinction: by the time Papers sees either, both are the same absolute capability mutation.
The failure happens before Papers is reached. The host's design is still implicated in *why*
the field was unsafe — Papers gives each project surface its own runtime, so one project-wide
shared active id was the wrong shape once tabs existed.

Fix: one predicate, `isActiveRecordingContext(layoutId)`, reading the recording controller.
Applied to all five sites that were asking "is the controller on this layout?" — the click
gate, the stale-binding reconcile, member removal, retirement and unlink. The sixth reader,
`bootstrapWindowLayoutRecording()`, deliberately keeps the durable id: "what should we resume
on load?" is the one question the persisted field is the right answer to.

**Not changed:** the two-step interaction is intentional (explicit comment above the gate, and
`runSwitch` applies the layout's saved arrangement), so a click on a layout that is genuinely
not the current context still selects it first and toggles on the next click. No schema change,
no migration, Papers untouched.

**Deferred, deliberately:** making the active recording context per-surface is the
architecturally correct shape, since each project surface already has its own runtime. It costs
a schema migration plus redesign of bootstrap resume, detach/handoff (which retains the id on
purpose) and widget-to-surface ownership routing. That is a design change, not a bug fix.

### F3 — First click after moving to another icon minimizes/restores late

Creator, after F2 was fixed: "i click one 10 times consecutively, its responsive. then I click
the second one, click registers noticably slower, then the next consecutive clicks are
resposive. switch it and the other one sloths." Clarified: the delay is the real window
minimizing/restoring, not the icon's visual feedback.

The Papers window helper is strictly serial — it reads ONE stdin line, runs the whole request
synchronously, writes the reply, and only then reads the next. Moving to another icon starts a
fresh hover pipeline (100 ms dwell, 120 ms debounce), and when that member's capability is cold
it costs a desktop `list`, a `bind`/`observe`, and then a full `PrintWindow` capture. The
click's own observe and minimize/restore queue behind all of it, so the window moves late.

It ping-pongs because a successful toggle changes member state, which changes the widget's
render identity, and `renderWidgetCard()` unconditionally clears the preview-capability cache.
So every click deliberately re-cools every member: staying on one icon starts no new hover
pipeline and is fast, while moving is cold again — and toggling that one re-cools the first.

Two fixes, one per repo:

- **As you Go:** an ordinary member press was the only interaction that did not cancel the
  preview pipeline (Ctrl-drag, context menu, picker, scroll and resize all did). A capture could
  therefore be launched *after* the creator had already asked for the window to move. One
  capture-phase `pointerdown` listener now cancels it for both the attached card and the widget.
- **Papers:** speculative captures are deferred in `windowCapabilityClient` while any control
  request is outstanding. Control requests still dispatch immediately and independently, so one
  lost helper reply cannot stall the others — an earlier attempt that serialized *everything*
  broke exactly that property and was caught by the existing suite.

**Papers was touched for the first time here, on a proven gap:** the helper's serialization is
real, and no amount of Backpack-side work can stop a capture that has already entered it.

**Known limit:** a capture already executing cannot be preempted — PowerShell is synchronous
inside `PrintWindow`, so its stdin loop cannot even read a cancel until the capture finishes.
At most one capture can now be ahead of a click instead of an unbounded run of them. Real
preemption would need a background runspace or a separate process, which was judged the wrong
trade for a latency bug: helper restarts intentionally invalidate capability and thumbnail
state.

Not yet creator-verified.
