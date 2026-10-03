# Why branch 3 was retired: the ring did not follow its members

Snapshot of the ring-as-physics build at the point where a live run in Papers
found a fault the unit tests could not. 533 tests passed, which is exactly the
problem: none of them dragged a member the way a user does.

**Corrected on branch 4.** The first diagnosis written here — that the ring
tangles, crossing itself into a lens — was WRONG. It came from reproducing the
drag as one large jump, which does tangle the ring but is not what dragging
does. Under the real pattern (many small steps, each pinning fx/fy and
reheating to 0.12) the ring never tangles. It simply falls behind and shrinks.
The section below is kept because what was ruled out is still useful; the
tangle claim is not.

## What was seen

`G` created a set and an outline drew around the member. Dragging that member
an inch left the ring behind: it detached, collapsed into a flat lens, and
stayed there. The user reported it "followed briefly, then stopped".

## What it actually is

**Lag.** The ring falls behind its member and shrinks as it goes, and a small
collapsed loop drawn as a spline reads as the lens seen on screen.

Measured on the drag pattern pointer-controller actually performs — steps of
20px, each pinning fx/fy and reheating to 0.12:

```
                        lag behind member    ring width
original                        205          197 -> 122
fixed (branch 4)                 42          182 -> 201
```

Two things were wrong in `forceRingShape`, and they could not be separated:

1. **The correction was scaled by alpha alone.** d3 decays alpha towards zero,
   so the force faded out exactly as the graph settled — and a member dragged
   after that walked away from a ring that had stopped chasing it.
2. **The correction was purely radial.** `(radius - distance)` applied along
   each node's own outward unit vector can only move a node in or out along the
   line it already sits on, never around the circle. The ring could resize in
   place but could not redistribute to follow.

Removing the alpha floor alone reddens three tests. The exact split of credit
between the two is not established, and the fix says so rather than guessing.

### What the wrong diagnosis cost, and how to avoid repeating it

The first reading here was that the ring tangled. It came from moving the
member in one 500px jump, which genuinely does tangle it — spacing goes from an
even 36 degrees to gaps over 300, the chain crosses itself. But that is not
dragging, and under a real drag the order is never disturbed.

Several isolation runs then disagreed with each other, because they used
`forceCollide` at its default strength where the app uses 0.9, and because one
run measured a file that a `git checkout` had already reverted. Four
conclusions in a row were wrong.

The lesson is about the harness, not the physics: reproduce the gesture the
user makes, with the constants the app ships, and check the file on disk is the
one being measured.

## What it is not

Ruled out by measurement, so as not to be re-diagnosed:

- **The alpha decay was one of the two real causes**, not a red herring. This
  entry originally dismissed it on the strength of the jump reproduction.
- **Not the links or the collision.** Removing either makes it *worse*: with
  both stripped the ring collapses to 20x26. They are holding the shape
  together, not fighting it.
- **Not a membership lookup failure.** `membersOnScreen` reads live node
  positions and resolves correctly throughout; the ring is being pulled towards
  the right circle the whole time.
- **Not the enclosing circle's size.** Links imply a radius of 95.5 against the
  shape force's 90.9. Real, but far too small to explain a 67px offset.

## The specification, and what it rules out

The user's four-panel sketch ("Imagine" as beads, "Actually" as the smooth line
drawn through them) is the spec. Reading it decides the fix:

1. **A ring of beads around the members, a non-member outside it.** The left
   column is drawn as discrete beads and the right as one smooth curve — the
   chain is the construction, the curve is the rendering. That is why drawing a
   spline through the nodes is legitimate here and was not on the geometry
   branch: there is no second shape to disagree with.
2. **Push a member into the wall and the boundary dents.** A smooth concave
   bite, with the beads still in order around the loop. Local deformation, not
   reordering.
3. **Pull a member outward and the ring stretches, growing more beads.** "It
   can get as big as needed" is literally more nodes. `reconcileRing` already
   derives count from perimeter, so that half exists.

   But the panel shows an **ellipse stretched along the drag**, and the
   implementation grows **radially in every direction**, which is not the same
   thing and is not wanted. `enclosingCircle` returns one centroid and one
   scalar radius; a circle cannot express direction, so spreading members along
   one axis inflates the ring on both. Measured, two 72px tiles side by side:

   ```
   separation    ring height
            0           182
          200           382
          800           982     <- should still be about 112
   ```

   At 800px apart the set is 982px tall for two tiles in a row. The fix has to
   replace the enclosing circle with something orientable — an enclosing
   ellipse, or per-node targets derived from the members' own spread — so the
   boundary stretches along the drag instead of ballooning across it.
4. **Two rings crossing is an overlap**, with no special case.

Neither of the two fixes proposed here was the one that worked. The lag was
fixed by flooring alpha and aiming each node at its slot as a point rather than
correcting it radially — see "What it actually is" above.

The user has since said the boundary **does not need to dent**, so panel 2's
concave bite is not a requirement. Panel 3 remains one: growth must be
directional, and still is not.

## The other thing measured here

Containment is weaker than the architecture claims. "An outsider cannot get in
because ring nodes collide with icons like anything else" holds only for nodes
the simulation is free to move:

| Situation | Result |
| --- | --- |
| Ring encloses its own settled members | holds |
| Outsider pushed by a gentle force (0.001/tick) | held out |
| Outsider pushed firmly (0.01/tick) | breaches |
| Outsider **dragged** | passes straight through |

Dragging pins `fx`/`fy`, which sets position outright, so collision can shove
the ring aside but has nothing to push back against. Containment is resistance,
not prevention; anything needing a hard boundary must enforce it in the drag
code. Three tests in `set-ring-model.test.mjs` pin this, including the drag case
asserted *as* a failure so that making the ring impassable breaks the test and
forces this note to be rewritten.

## Cost, for reference

Well inside budget, and not a reason to change anything:

| Ring nodes | ms/tick | per node |
| --- | --- | --- |
| 158 | 0.29 | 1.84us |
| 692 | 1.67 | 2.41us |

692 ring nodes is 10.4% of a 16ms frame.
