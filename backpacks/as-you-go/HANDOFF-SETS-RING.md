# Handoff: item sets, branch `feat/sets-ring`

Read this whole file before touching anything.

## Where the code is

```
D:\Letters\MatTroiSeConMoc\Papers\Backpack projects\As you Go
```

That directory is the git repository and the working directory. Do not edit
outside it — the Papers host source lives elsewhere and is out of scope, as is
`state.json` (the user's real data, gitignored).

- Repository: https://github.com/Futahua/as-you-go-backpack
- Branch: `feat/sets-ring`. Base: `main` at `37542c9`.
- Accepted implementation: Assignments 001–003 are code-verified and
  creator-approved. **595 tests passing** before the final commit.
- `ee59878` is an incomplete historical snapshot; the later work on this branch
  completes and corrects it. Do not deploy or cherry-pick that snapshot alone.

Three earlier attempts are pushed as snapshots and should be read, not merged:

| Branch | What it was | Why it stopped |
| --- | --- | --- |
| `retired/1-item-sets-geometry` | sets as computed geometry | thin connector necks, concave bites, 87.8ms rebuilds |
| `retired/2-set-gravity` | sets as physics | right idea, wiring half-finished |
| `retired/3-sets-ring-tangle` | the ring, first pass | outline lagged behind dragged members |

The prior-art file on branch 3 is **`RING-TANGLE.md`**, at the repo root. (An
earlier version of this handoff called it `RING-LAG.md`; there is no such file.)
It records what was ruled out there by measurement, so it does not have to be
re-diagnosed, and it carries a correction worth reading: its first diagnosis
(that the ring tangles) was **wrong**, and came from reproducing a drag as one
large jump instead of many small steps.

## Running it

```bash
npm test
```

No build step, no framework — plain ES modules served as static files inside
the Papers host.

**Do not write the Papers path down.** It moves. In one working week it was
`PAPERS 3\Papers-3\release\win-unpacked`, then `Products\Papers\Runtime`, then
`Products\Papers\Source\release\win-unpacked`, and the Start Menu shortcut
`Papers.exe.lnk` was left pointing at a build from three weeks earlier. Every
pinned path in this file has gone stale at least once, and a stale path is
expensive in a specific way: the wrong build reads the same source files but
serves an older bundle, so the app looks fine and the fix looks broken.

Find it instead. If Papers is running, the running build is the one that matters:

```powershell
Get-Process -Name papers | Select-Object Id, Path, MainWindowTitle
```

Several processes share one binary — Electron's helpers — so any non-empty
`Path` is the answer, and the one with `MainWindowTitle` is the visible window.
If it is not running, take the newest build rather than a remembered directory:

```powershell
Get-ChildItem <papers-source-root> -Recurse -Filter Papers.exe |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3 FullName, LastWriteTime
```

Check the date before trusting the result: many `release-*` directories sit side
by side and only one of them is current.

Papers reads the backpack's files from disk, so edits are live once reloaded.
The backpack itself may also be reached through a compatibility junction rather
than its real location — `MatTroiSeConMoc\Papers` currently points at
`MatTroiSeConMoc\Products\Papers\Runtime` — so two paths can be the same
directory. `Get-Item <path> -Force` shows `ReparsePoint` and its target when
that is what you are looking at.

**Use Ctrl+Shift+R, not Ctrl+R.** Papers serves the backpack through a custom
scheme with no cache headers, and Chromium holds the ES modules. A plain reload
shows stale code. This has already cost one session an entire afternoon, during
which the outlines on screen were rendering from an earlier load.

**The packaged build has no devtools**, so `console.log` is useless for
diagnosis. Put diagnostics in the status bar — it is visible and already
carries error text. (`syncSetRings` still has a `console.info` on every
reconcile that nobody can see; harmless, but do not add more.)

## What a set is

A named grouping over workspace items, drawn as an outline on the graph view.
Membership is independent of folder location and is inherited through folders.
An item may belong to several sets, or none.

The user's model: sets behave "like water droplets but strong", and "icons are
ants" sitting on the surface.

### Hotkeys

| Key | Behaviour |
| --- | --- |
| `G` | Group the current selection into a new set |
| `Ctrl+G` | Open the membership picker — click items to cycle their sets |
| `Enter` | Confirm the picker, applying only what changed |
| `Escape` | Cancel the picker; else clear the set selection; else clear the item selection — one press undoes one thing |
| `Ctrl+A` | Scoped to the picked set: its members inside one, the setless items outside every set |
| `Delete` | On a selected set, removes the grouping and leaves the items. Checked **before** the item branch, so a live set selection wins |
| Click inside an outline | Selects that set (smallest first where they nest) |
| `Alt+click` a folder | Batch-expand the inverse of the selection |

`G` is deliberately unmodified, so it must not fire while typing; every modal
layer returns early before the workspace bindings are reached.

## The architecture

**The outline is a ring of nodes in the simulation, but what is drawn is the
convex hull of those nodes.** A closed chain of small invisible nodes, linked to
their neighbours and subject to the same collision as the icons; the hull is
taken over where they ended up, and a spline is drawn through that.

The hull is not only a rendering choice. It is the single shape every consumer
reads — drawing, click hit-testing, nesting order, ejection, and the exclusion
force. That is deliberate: on the retired geometry branch the drawn shape and
the hit-tested shape disagreed, and the user was interacting with something they
could not see. **If you add a consumer, give it the hull.**

Five forces act:

| Force | What it does |
| --- | --- |
| `forceRingShape` | holds each ring on the ellipse enclosing its own members |
| `forceSetGravity` | gathers a set's members towards their common centre |
| `forceSetExclusion` | pushes non-members out of a set they are inside |
| `forceSetSeparation` | keeps unrelated sets from crossing |
| charge / collide / link | the graph's own layout, unchanged |

`forceSpeedLimit` exists in `set-ring-model.js`, tested, and is **still
deliberately not wired**. Read `bda8229` before re-enabling it. Re-measured this
session and it remains the wrong instrument: it does not behave monotonically —
a cap of 6 or 16 holds where 8 diverges.

## Assignment 001 — visible set separation, fixed and creator-accepted

`ee59878` is a work in progress that **must not ship as is** — but not for the
reason its own message gives.

The user's report, with a screenshot: *"physics may not overlap anymore, but the
rendering trick certainly does."* Two set outlines met along a shared border
with nothing between them.

The diagnosis of the *mechanism* is certain. `forceSetSeparation` pushes **ring
nodes** apart, and what the user sees is the **hull** drawn around them. A hull
spans outward across a concavity, so it occupies space no ring node is in — two
rings whose every node is comfortably clear can still be *drawn* as two shapes
that overlap.

The direction of the fix is the user's own, and it is right: **make the force
read the shape on screen.** Same principle as drawing and hit-testing the hull.

`ee59878` adds that second pass, over the drawn hulls, using the separating axis
theorem (exact for convex shapes, and a hull is convex). **The wrong-sign claim
in its message was false.** Verified during Assignment 001:

- The committed signs are correct. The scenario the message cites — two 100x400
  hulls overlapping by 20px in x, nodes far apart so only the hull pass can act
  — produces A.x = -10, B.x = +10: equal and opposite, with zero vertical
  leakage. Driving both sets the same way is structurally impossible with the
  committed force (set i subtracts the overlap direction, set j adds it).
- The `-15/-20` "both driven the same way" reading matches a draft or harness
  that subtracted the direction for **both** sets, not the committed code.
  Mutating the B-side push sign reproduces it exactly ("B pushed x: -10").
- The real defect was composition: the entry constructed `forceSetSeparation`
  without `hullOf`, so the (correct) hull pass never ran. The current working
  tree wires it to read `shape.outline` — the eased, resampled, member-floored
  outline that is actually drawn — with a null outline as a safe no-op.
- The first live check still overlapped. The outline is floored to enclose its
  members, so moving ring nodes alone cannot separate two member floors held
  together by graph attraction. The final correction translates each unrelated
  set's visible members and ring nodes with one uniform per-set impulse. That
  preserves the droplet's shape, stops when the outlines are disjoint, and
  leaves internal and graph attraction intact. A set with a dragged member is
  anchored; the other set absorbs the response. Shared-member Venn sets remain
  exempt.

The pass is now regression-protected and measured:

- **Behavioral tests cover it** (`set-gravity-model.test.mjs`): opposite-sign
  separation on the minimum-overlap axis with negligible orthogonal leakage,
  uniform member-and-ring translation without shape change, held-set anchoring,
  the shared-member Venn exemption (including inherited membership), attraction
  settling adjacent without crossing, and disjoint hulls as a no-op. Both sign
  rules and the member translation are mutation-checked.
- **Cost is measured, not reasoned.** The pass is O(sets² × hull-edges²).
  Medians of 1500 samples with 48-point hulls: 4 sets 0.004ms, 8 sets 0.017ms,
  16 sets 0.078ms, 32 sets 0.311ms hull-only — at 32 sets it *exceeds* the
  node pass (0.14ms), so "small next to the node pass" does not hold at scale.
  Whole-force medians (48 ring nodes, 48 hull points per set): 4 sets 0.088ms,
  8 sets 0.204ms, 16 sets 0.461ms, against a 16.7ms 60fps frame budget. The
  expected ordinary set count is not documented in this repository.
- **The screenshot-shaped full-force harness proves the mechanism.** With a
  graph link holding the small set near the large one, ring-only separation
  settled at 78.6px of visible overlap; member-and-ring translation settled at
  0.0px. The added member impulse measured 0.0004–0.006ms per tick through 32
  sets. Focused tests pass 25/25 and the full suite passes 574/574.
- **Creator eye check accepted it.** After Ctrl+Shift+R, the large and small
  droplets rested immediately beside one another without intersecting or losing
  their shapes. The creator's verdict was “looks good enough.”

Assignment 001 is closed. Commit `ee59878` remains an incomplete historical
snapshot and must not be deployed or cherry-picked without its later fixes.

## The other open problems

### 2. Dragging a member extends the set the wrong way — fixed and creator-accepted

The cause was `enclosingEllipse`: while a member was dragged diagonally away,
each axis grew symmetrically around the members' mean. A 240px bottom-right drag
made the opposite side sweep 112.8px backward and enclose two deliberately
placed foreign markers.

During a drag, the ellipse is now sized per side and its centre shifts toward
the outlier. The dragged-side supports extend while the stationary supports
remain nearly fixed. When the drag ends it returns to the stable symmetric
settled form; the one-sided centre is deliberately gated on drag state because
letting it chase free members made an always-heated ring run away.

The checked-in self-verifying harness reproduces both paths on the same scene:
legacy sweeps 112.8px and catches `foreign0`/`foreign3`; corrected diagonal drag
moves the opposite side inward by 0.8px and catches none. Across horizontal and
vertical drags the corrected outward motion stays within 18.6px, pointer error
is 0, and member tiles retain 28–46px of visible margin. Ring-node spacing and
resampling may shave up to ~12px from the outer 40px padding at an extreme
dragged corner; tiles remain inside. Focused tests pass 37/37 and the full suite
passes 578/578.

Creator eye check after Ctrl+Shift+R showed the droplet stretching cleanly from
its stationary cluster to the far dragged folder without the reverse balloon.
The creator's verdict was “beautiful.” Assignment 002 is closed.

### 3. Foreign items collect in the intersection

**Fixed and creator-accepted.** The failure had two causes. The
old exclusion added one centre-away push per containing set, so the two pushes
cancelled exactly for a symmetric foreign item in the Venn lens. The remaining
alpha-scaled effort then cooled below the collision barrier and could not finish
an escape.

`forceSetExclusion` now reads the exact visible outline, collects all forbidden
hulls before responding, and follows one coordinated, allowed-region-aware
route. `shortestValidEscape` computes the nearest point on the exposed boundary
of the forbidden union rather than sampling centre directions or edge normals;
an A-only item must leave B while remaining strictly inside A, and the mirrored
B-only rule is the same. The response brakes at that destination, keeps a small
measured `minAlpha` floor of 0.05 only while a violation exists, skips held
items, and stops once the item is valid. Shared AB members remain exempt, so the
Venn itself is preserved.

The named Assignment 003 harness reproduces the legacy symmetric stranding and
proves the corrected N, A-only, B-only, inherited-folder, AB, held/release,
mirror, rotation, no-op, and re-entry cases. The adverse narrow-corridor case
settles at (6.3, 50.0), strictly inside A and outside B. A seeded rotated-hull
oracle audit and the former 2.3012x counterexample cover the geometry. Focused
tests pass 79/79 and the full suite passes 595/595. Synthetic heavily
overlapping hulls can have a genuine single-point pinch where the mathematical
nearest exit is the boundary crossing itself; this did not occur in any
app-shaped or membership-class run and remains a disclosed edge case.

After Ctrl+Shift+R, the creator's live Papers check was “perfect.” Assignment
003 is closed.

### 4. A set can convulse until it pops — no longer an active problem

Removed from the agenda by the creator. The rendering half is fixed by
construction — a hull cannot express spikes or lobes — but the underlying
agitation was never reproduced in a harness matching the app. This section is
historical: the convulsion must not be assigned, investigated, tuned, or used
to expand current work unless the creator explicitly reopens it. The old
caution — do not read "it looks fine" as "it is fixed" — is what suspended the
investigation, not a claim that the agitation is gone.

## What was fixed this session

| Commit | What |
| --- | --- |
| `092f47a` | Draw and hit-test the hull, not the chain. Kills the tearing at the rendering layer |
| `7e03839` | Ease the outline across frames, and floor it at the members' own shape |
| `c576ae6` | Let `forceRingShape` cool when nothing is held — a settled scene was pumping itself apart |
| `5accc4d` | `forceSetSeparation`, so unrelated sets stop crossing |
| `ee59878` | **Incomplete.** Hull-level separation (signs verified correct), pass left unwired and untested |

Two findings worth carrying forward:

**A settled scene never settled.** `forceRingShape` floors its alpha so it never
cools, which is what keeps a ring with a dragged member — but d3 cools
everything else, so on a quiet scene it was the only force still injecting
velocity, driving icons through the ring nodes' collision and chasing them as
they moved. A set 10px tall stretched to 7495px over 4000 ticks. The floor is
now gated on something actually being held. Its default is `() => true`, the old
behaviour, so a caller that cannot see drag state keeps the floor rather than
silently losing it.

**The measured cost of the hull.** A set whose members form two distant clusters
draws as one blob, and a foreigner at the midpoint reads as inside. Two clusters
600px apart do this. If it shows on screen the answer is a hull per cluster —
which is what branch 3's notes say the user's sketch showed — not abandoning the
hull. Conditional only, per the creator: do not promote this to active work
unless the creator observes the behavior in real use.

## Files

| File | What |
| --- | --- |
| `public/sets-model.js` | membership, inheritance, exclusions, tri-state matrix. Pure |
| `public/set-ring-model.js` | ring construction, hull, resampling, easing, member floor, spline, shape force, ejection, speed limit |
| `public/set-gravity-model.js` | set attraction, exclusion, and separation forces |
| `public/app/components/set-membership-mode.js` | the Ctrl+G picker |
| `public/app/workspace-commands.js` | `groupSelectionIntoSet`, `selectSets`, `deleteSelectedSets`, `shareSelectionWithSets` |
| `public/app/interactions/keyboard-controller.js` | the bindings above |
| `public/workspace-20260730b.js` | ring reconciliation, drawing, simulation wiring, hit testing |
| `public/styles/graph.css` | `.graph-set-outline` and its picking and retiring states |

## How this work is expected to be done

These are not general advice. Each one cost this branch real time.

- **Reproduce the gesture the user actually makes.** A drag is many small steps
  that pin `fx`/`fy` **and** `x`/`y` and reheat to 0.12 — not one large jump,
  and not `fx` alone. Three test harnesses were wrong this way, and one of them
  produced a completely wrong diagnosis that took a branch retirement to
  correct.
- **Use the constants the app ships.** `forceCollide` at strength 0.9, ring
  radius 30, link distance 60, charge −280 and 0 for ring nodes. A run at d3's
  defaults disagreed with the app and sent two investigations the wrong way.
- **Ablate before blaming.** The runaway looked exactly like a gravity fault.
  Leave-one-out showed removing *any* single force stopped it — the signature of
  a feedback loop, not of one force being wrong. Guessing would have "fixed"
  gravity and left the loop.
- **Do not tune your way out.** Both `minAlpha` and the speed cap behave
  non-monotonically: `minAlpha` 0.10 settles at 216 where 0.05 gives 1795. A
  threshold that works is working by luck. Find the mechanism.
- **Check the file on disk is the one being measured.** A `git checkout` once
  reverted a fix mid-investigation and the next measurement was of the old code.
- **Mutation-check every load-bearing rule**, and assert the mutation applied.
  These files are **CRLF**, and `sed`-style replacements silently fail against
  them, reporting "the fix is not load-bearing" when nothing changed. This
  session a patch also injected three **NUL bytes** into template literals; the
  code still worked, because a NUL is a consistent separator, which is exactly
  how it would have shipped unnoticed. Grep for `\x00` after scripted edits.
- **Write the test against a case that can fail.** A containment test passed
  with the feature disabled, because the proxy it replaced is sufficient in a
  small set — it took a large one to make the test mean anything.
- **Never let an error hide.** The worst bug here was a command that threw on
  every press, invisible because the caller used optional chaining and dropped
  the returned promise. A broken command and an unbound key looked identical.
  Route failures to the status bar.
- Comments explain *why*, not *what*.
- Do not merge or modify `main` without being asked.
