/** Sets as centres of gravity.
 *
 * A set is not a shape to be computed and then imposed on the layout. It is an
 * attraction: its members are pulled towards their common centre, so they
 * gather on their own, and whatever outline gets drawn is a consequence of
 * where they ended up rather than a constraint they had to obey.
 *
 * That order matters, and getting it backwards is expensive. Computing an
 * envelope first and then forcing positions to respect it means solving for a
 * shape that spans members wherever they happen to be — which needs connectors
 * between distant ones, and those connectors are thin, and thin connectors
 * pinch around whatever they pass. None of that arises here: members that
 * belong together are already near each other, so there is nothing to bridge.
 *
 * The graph already works this way. Every node is pulled to the viewport centre
 * at a low strength, repelled from every other, and held at a distance by its
 * links; the layout is the equilibrium of those. This adds one more term of the
 * same kind — a pull towards the set's own centre instead of only the global
 * one — rather than a different kind of rule layered on top.
 *
 * The centre is the members' own mean, so it moves as they do — a set drifts
 * with its members rather than being anchored anywhere.
 *
 * That alone does not stop it collapsing, though, and it is tempting to think
 * it does: as the members converge the centre stays among them and the pull
 * continues all the way to a single point. Measured in isolation, a three
 * member set contracts to a spread of zero. In the real graph the charge and
 * collision forces push back long before that, but a force that only behaves
 * because something else is holding it up is not one worth having, so the
 * attraction stops at a rest radius instead.
 *
 * No DOM, store, or browser APIs. */

// Exclusion has to ask "is this item inside the outline?" against the same
// shape the user sees, or the force and the drawing disagree about who is in.
import { ringHull, rayExitDistance, shortestValidEscape } from './set-ring-model.js';

/** The mean position of a set of nodes.
 *
 * Held nodes are included. A set's centre should follow the member the user is
 * dragging — that is what makes the rest of the set trail after it rather than
 * stay behind and stretch. */
export function centreOfMass(members) {
  if (!members || members.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const member of members) {
    x += member.x;
    y += member.y;
  }
  return { x: x / members.length, y: y / members.length };
}

/** A d3-force that pulls each set's members towards their common centre.
 *
 * `setsOf(nodeId)` returns the set ids a node belongs to; a node in several
 * sets is pulled towards each of their centres, so it settles in between and
 * the sets overlap there. That is the Venn, and it falls out of the arithmetic
 * rather than needing a rule of its own.
 *
 * `isHeld(nodeId)` marks a node the user is dragging. A held node is not pulled
 * — it goes exactly where the pointer puts it — but it still counts towards its
 * set's centre, so picking up one member draws the others after it. That is the
 * yielding: the set follows the member, not the other way round.
 *
 * The force is written in the d3 idiom — a function of alpha that adjusts
 * velocities, with an `initialize` hook — so it composes with charge, collision
 * and links instead of fighting them from a tick handler. */
export function forceSetGravity({
  setsOf,
  isHeld = () => false,
  strength = 0.08,
  // How close is close enough. Inside this the pull stops, which is what makes
  // a set gather to a cluster rather than to a point.
  restRadius = 120,
} = {}) {
  let nodes = [];

  function force(alpha) {
    // Group by set once per tick. The centres have to be recomputed every tick
    // because the members are moving; caching them across ticks is what would
    // make a set lag behind a dragged member.
    const groups = new Map();
    for (const node of nodes) {
      for (const setId of setsOf(node.id) ?? []) {
        if (!groups.has(setId)) groups.set(setId, []);
        groups.get(setId).push(node);
      }
    }

    for (const [, members] of groups) {
      // A set of one has no centre to speak of — its member is already there,
      // and pulling it towards itself would be a no-op with a rounding error.
      if (members.length < 2) continue;
      const centre = centreOfMass(members);
      for (const node of members) {
        if (isHeld(node.id)) continue;
        const dx = centre.x - node.x;
        const dy = centre.y - node.y;
        const distance = Math.hypot(dx, dy);
        // Already close enough. Pulling further would draw the set onto a
        // single point, and the excess is what is pulled on rather than the
        // whole distance, so the force eases off as a member arrives instead of
        // stopping abruptly at the boundary.
        if (distance <= restRadius) continue;
        const excess = (distance - restRadius) / distance;
        node.vx += dx * excess * strength * alpha;
        node.vy += dy * excess * strength * alpha;
      }
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  force.strength = (value) => {
    if (value === undefined) return strength;
    strength = value;
    return force;
  };

  return force;
}

/** Pushes non-members out of the sets they have wandered into.
 *
 * The ring cannot do this on its own. A boundary is a closed curve, so it can
 * only exclude what lies outside the region its members occupy — a bystander
 * that comes to rest *between* two members is inside the cloud, and no convex
 * outline can enclose the members while leaving it out. Measured on a
 * six-member set: two foreign items sat 92 and 100px from their nearest
 * member, comfortably interior, and the ring had no choice but to contain
 * them.
 *
 * So the layout is what has to express membership, not just the drawing. A
 * foreign item inside a set is pushed away from that set's centre until it is
 * clear of the members, which is the same instinct as spitting a trespasser
 * out on release, applied continuously so it never settles there at all.
 *
 * Members are never pushed — they are pulled together by forceSetGravity, and
 * a force that shoved them apart would be arguing with it. Held items are
 * exempt too: while the user is dragging something, it goes where they put it.
 */
export function forceSetExclusion({
  setsOf,
  membersOf,
  // The visible outline of a set — the eased, resampled, member-floored shape
  // the creator actually sees drawn. Exclusion asks "is this item inside the
  // drawn set?" against the SAME shape separation uses, not the raw physics
  // ring the outline eases towards: while the ease trails, the two disagree,
  // and the force must not call something "out" that is visibly still inside.
  // A null outline (nothing drawn yet this frame, or a retired set) is a safe
  // no-op: with no visible outline the set cannot prove a visible violation,
  // so it contributes nothing until the outline exists. Separation has the
  // same source and the same fallback.
  hullOf = () => null,
  isHeld = () => false,
  strength = 0.35,
  // How far outside the member cloud a foreign item is pushed once it is out.
  // Comfortably more than a tile, so the gap reads as deliberate rather than
  // as a near miss.
  clearance = 150,
  // The effort the force keeps while a violation exists. d3 scales every
  // force by alpha, so in a settled scene this push would otherwise fade to a
  // few hundredths of a pixel per tick — far below what it takes to move an
  // item through the ring and cluster collision that hold it (measured: with
  // no floor the item strands in the lens for 6000+ ticks). The exclusion's
  // job is to remove a violation, and it has no business giving up while the
  // violation is still there; the moment the item leaves every forbidden hull
  // (and clears the members) the force does nothing at all, so the floor is
  // self-terminating rather than a standing push. The value was swept after
  // the geometry corrections: the barrier yields down to a 0.005 floor
  // (0.26px/tick, an 8.4s escape), and 0.05 is the smallest floor whose
  // escape completes within about a second (0.8s measured) — the smallest
  // floor that reads as a deliberate escape rather than a crawl, five times
  // below the original 0.25.
  minAlpha = 0.05,
  // The velocity decay the simulation was configured with (the fraction of
  // velocity lost per tick; the app passes 0.32, keeping 68%). The bounded
  // response lands the item's velocity at its desired travel per tick despite
  // this decay, and needs the value to do so.
  velocityDecay = 0.32,
} = {}) {
  let nodes = [];

  function force(alpha) {
    // One hull per set per tick. The visible outline does not move within a
    // tick, and building it inside the node loop would rebuild the same hull
    // once per item per set — the exclusion test runs against every node on
    // screen.
    const hulls = new Map();
    const hullFor = (setId) => {
      if (!hulls.has(setId)) {
        const raw = hullOf(setId);
        // ringHull is idempotent on a hull polygon (the visible outline passes
        // through unchanged) and makes raw ring chains safe for the escape
        // geometry, which assumes convex polygons.
        hulls.set(setId, raw ? ringHull(raw) : null);
      }
      return hulls.get(setId);
    };

    for (const node of nodes) {
      if (node.ring) continue;
      if (isHeld(node.id)) continue;
      const own = new Set(setsOf(node.id) ?? []);
      const forbidden = [];

      for (const setId of setIdsInPlay(nodes, setsOf)) {
        if (own.has(setId)) continue;
        const members = (membersOf(setId) ?? []).filter((member) => member.id !== node.id);
        if (members.length === 0) continue;

        // Inside the visible outline, or close enough to the members to be
        // about to be.
        //
        // Containment is the real question and the visible outline is the real
        // answer, so it is asked first. The proximity test stays as a second
        // condition rather than a replacement: it catches an item pressing on
        // the boundary from outside, which the ring would otherwise have to be
        // deformed by before anything pushed back.
        const hull = hullFor(setId);
        if (!hull) continue;
        const enclosed = pointInRing(node, hull);

        let nearest = Infinity;
        for (const member of members) {
          nearest = Math.min(nearest, Math.hypot(node.x - member.x, node.y - member.y));
        }
        if (!enclosed && nearest >= clearance) continue;
        forbidden.push({ setId, members, hull, enclosed, nearest });
      }

      if (forbidden.length === 0) continue;


      // One coordinated response, not one push per set. The old route pushed
      // the item away from each containing set's centre of mass, and in the
      // lens of two related sets those vectors are equal and opposite — they
      // cancel before summation, leaving the item stranded exactly where the
      // boundaries cross (measured: the two contributions sum to zero). So
      // every forbidding visible hull is collected first, and the item is
      // pushed along the single shortest direction that leaves ALL of them —
      // while staying inside the visible hulls of the sets it belongs to: an
      // A-only item in the lens must be pushed out of B, not flung out of A
      // by a route that happens to be shorter on the other side.
      const urgency = Math.max(...forbidden.map((f) => (
        f.enclosed ? 1 : (clearance - f.nearest) / clearance)));
      const escape = shortestValidEscape(
        node,
        forbidden.map((f) => f.hull),
        [...own].map((sid) => hullFor(sid)).filter(Boolean),
      );
      let dx;
      let dy;
      if (escape) {
        dx = escape.x;
        dy = escape.y;
      } else {
        // Outside every hull but still close to one, or no direction can exit
        // the forbidden territory without leaving the allowed region: keep the
        // old centre-away nudge from the closest set.
        const closest = forbidden.reduce((a, b) => (b.nearest < a.nearest ? b : a));
        const centre = centreOfMass(closest.members);
        let ox = node.x - centre.x;
        let oy = node.y - centre.y;
        let distance = Math.hypot(ox, oy);
        if (distance < 1e-6) { ox = 1; oy = 0; distance = 1; }
        dx = ox / distance;
        dy = oy / distance;
      }
      const push = urgency * strength * Math.max(alpha, minAlpha) * clearance;
      // The desired per-tick travel, bounded by the remaining room so the item
      // decelerates at the nearest valid point instead of being carried past
      // it: the exit the item must clear (containment case), or the remaining
      // clearance deficit to the member cloud (proximity case), and in both
      // cases the distance to the item's own allowed boundary — the item must
      // not be flung out of the sets it belongs to. The room is the ray's far
      // crossing of every own hull along the direction: the point where the
      // item would finally be outside its own region (zero when it already is
      // and the direction points further out).
      let desired;
      if (escape) {
        // The escape's own distance IS the destination: the helper returns the
        // nearest point that is strictly outside every forbidden hull and
        // strictly inside every allowed one, so the item must stop exactly
        // there. Adding a further margin and then clipping it to the allowed
        // boundary is what used to spend all the room and strand the item ON
        // its own set's outline, where the boundary-inclusive containment
        // predicate reads it as outside its own set (measured: the adverse
        // A/B fixture settled at x=-0.0, reported "inside A: NO"). The travel
        // is only limited by what the force can push this tick.
        desired = Math.min(push, escape.distance);
      } else {
        // The proximity case has no computed destination — the item is outside
        // every forbidden hull and merely too close. That is not a violation
        // at all while the item is sitting inside a set it belongs to: nudging
        // it then keeps pushing after the escape is complete and walks it out
        // of its own set (measured on the adverse A/B fixture: the item reached
        // its valid landing at x=9.5, then the nudge carried it on to A's outer
        // boundary at x=0, where containment reads it as outside A). Only the
        // proximity branch is skipped — an item a foreign hull still CONTAINS
        // takes the escape branch above and is moved regardless.
        const insideOwn = [...own].some((setId) => {
          const hull = hullFor(setId);
          return hull ? pointInRing(node, hull) : false;
        });
        if (insideOwn) continue;
        // Otherwise it keeps the clearance deficit, bounded by the room to its
        // own allowed boundary so the nudge cannot fling it out of a set.
        let allowedBound = Infinity;
        for (const setId of own) {
          const hull = hullFor(setId);
          if (!hull) continue;
          const exit = rayExitDistance(hull, node, { x: dx, y: dy });
          if (exit < allowedBound) allowedBound = exit;
        }
        const nearest = Math.min(...forbidden.map((f) => f.nearest));
        desired = Math.min(push, Math.max(0, clearance - nearest), allowedBound);
      }
      // Land the item's velocity along the direction at exactly `desired` per
      // tick despite the decay: d3 integrates x += vx * retained, so a plain
      // impulse of `desired` would only move the item 0.68x as far, and a
      // carried velocity would overshoot the room the moment it shrinks. The
      // correction impulse both accelerates and brakes — the item never moves
      // further in one tick than the room it has.
      const retained = 1 - velocityDecay;
      const vAlong = (node.vx ?? 0) * dx + (node.vy ?? 0) * dy;
      const impulse = (desired / retained) - vAlong;
      // Defaulted rather than assumed: d3 seeds vx/vy when it owns the nodes,
      // but a caller passing plain objects would otherwise turn the whole
      // layout into NaN on the first tick, silently and unrecoverably.
      node.vx = (node.vx ?? 0) + (dx * impulse);
      node.vy = (node.vy ?? 0) + (dy * impulse);
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Keeps the outlines of unrelated sets from crossing each other.
 *
 * Two sets sharing no members settled with their outlines crossing and the lens
 * between them holding no icons at all — a boundary drawn through empty space,
 * saying nothing true about either set.
 *
 * Nothing existed to prevent it. Ring nodes are given zero charge, so they do
 * not repel; collision separates node from node at 60px, which two rings can
 * satisfy while the curves drawn through them still overlap. No force acted
 * between two sets at all.
 *
 * Ring charge was the obvious lever and is the wrong one. It is global: a
 * charged ring node pushes on its own members and its own neighbours as well as
 * on other sets, which is why it was set to zero to begin with. Measured, it
 * also does not behave monotonically — -20 and -120 separate the rings where -60
 * still crosses — so any value that worked would be working by luck.
 *
 * This acts between whole sets in two ways, because there are two things that
 * can overlap and separating one does not separate the other.
 *
 * Ring nodes are pushed apart within a clearance, which keeps the physics from
 * interpenetrating. But what the user sees is the hull drawn around those
 * nodes, and a hull spans outward across any concavity — so two rings whose
 * every node is comfortably clear can still be *drawn* as two shapes that
 * overlap. Reported from a real scene: the physics no longer overlapped and the
 * rendering plainly did.
 *
 * So the drawn hulls are separated too, on the shape actually on screen rather
 * than on a proxy for it. That is the same principle as drawing and hit-testing
 * the hull: whatever the user is looking at is the thing that has to be
 * correct, so it is the thing the force reads.
 *
 * Sets that share a member are exempt, and that exemption is the point rather
 * than a special case: two sets with an item in common are *supposed* to
 * overlap, because the shared item is pulled towards both centres and has to sit
 * in the region belonging to both. Pushing those apart would break the Venn the
 * gravity force builds. Verified: with the exemption, a shared-member scene
 * still overlaps and its lens contains exactly the shared item.
 *
 * Separating the drawn hulls by moving ring nodes alone is not enough, and the
 * reason is an invariant rather than a tuning gap: the outline drawn on screen
 * is floored to enclose the members' own tiles, so when the members of two
 * unrelated sets rest close enough for those floored regions to overlap — held
 * there by graph links, or merely within the padding band — the visible shapes
 * overlap no matter what the ring nodes do. Measured on a large/small unrelated
 * pair with a graph link pinning the small set: the eased outline overlap
 * persisted at 78.6px with the ring-only impulse, and reached 0.0px once the
 * impulse also translated the members.
 *
 * So each set is treated as a droplet: the impulse moves the effective visible
 * member nodes and the ring nodes together, one uniform per-set delta, so the
 * collision response translates the droplet without changing its internal
 * offsets, hull area, or outline geometry. The impulse fires only while the
 * drawn outlines overlap and stops the moment they are disjoint, so it is
 * non-penetration, not a standing repulsion: internal attraction (a set's own
 * gravity) and external graph attraction (links, charge, exclusion) still act
 * and may bring two sets to rest beside each other, but their regions never
 * intersect.
 *
 * A set whose member is being dragged is anchored and takes no impulse at all —
 * members and ring alike, because moving its ring alone would tear the outline
 * away from the item under the pointer. The unheld droplet then absorbs the
 * full separation. If both droplets are anchored the pair is skipped: the
 * pointer wins, and the overlap persists only for as long as the drag does. */
export function forceSetSeparation({
  setsOf,
  // The drawn outline of a set, as a closed list of points. Given this, the
  // force separates the shapes on screen as well as the nodes beneath them.
  hullOf = () => null,
  // Whether an item is being dragged. A set with any held member is anchored:
  // the pointer decides where it goes, so the force leaves the whole droplet
  // alone and the other set absorbs the separation. Defaults to nothing held,
  // which is the old behaviour for callers that cannot see drag state.
  isHeld = () => false,
  // How far apart the rings of unrelated sets are held. Wider than the ring
  // link distance of 60, so the gap reads as deliberate rather than as two
  // boundaries resting against each other.
  clearance = 90,
  strength = 0.5,
} = {}) {
  let nodes = [];

  function force(alpha) {
    const ring = nodes.filter((node) => node.ring);
    if (ring.length < 2) return;

    // Which sets share at least one member, resolved once per tick. Membership
    // is read through setsOf rather than stored, so inheritance through folders
    // is respected the same way the other set forces respect it. The nodes are
    // kept as objects, not ids: the hull pass has to push them, and it can only
    // push what it holds.
    const membersBySet = new Map();
    // Sets that share a member, derived from the members themselves rather than
    // rediscovered by asking every pair of sets whether they intersect. A member
    // already names the sets it belongs to, and every pair among those names is
    // related by definition — so the answer falls out of the same walk that
    // builds membersBySet.
    //
    // Cost goes from sets^2 x members-per-set to the sum over members of their
    // set-degree squared. In the ordinary case, where a member belongs to one
    // set, that is linear and produces no pairs at all. The pair scan cost 2.9ms
    // of the non-hull separation path at 128 sets with nothing overlapping.
    const related = new Set();
    for (const node of nodes) {
      if (node.ring) continue;
      // Deduplicated for cost, not for correctness: a repeat would only ever
      // add a self-pair, which the proximity pass already skips on setId, or
      // re-add a pair the Set collapses. What it avoids is squaring the inner
      // loop over whatever multiplicity setsOf happens to return.
      const setIds = [...new Set(setsOf(node.id) ?? [])].sort();
      for (const setId of setIds) {
        if (!membersBySet.has(setId)) membersBySet.set(setId, new Set());
        membersBySet.get(setId).add(node);
      }
      for (let i = 0; i < setIds.length; i += 1) {
        for (let j = i + 1; j < setIds.length; j += 1) {
          related.add(`${setIds[i]} ${setIds[j]}`);
          related.add(`${setIds[j]} ${setIds[i]}`);
        }
      }
    }
    // A droplet whose member is under the pointer is anchored: it takes no
    // impulse at all, and the other set absorbs the separation. Computed once
    // per tick because both passes need the same answer.
    const anchored = new Set();
    for (const [setId, members] of membersBySet) {
      for (const member of members) {
        if (isHeld(member.id)) {
          anchored.add(setId);
          break;
        }
      }
    }

    // Bucketed on a grid of the clearance, so each node only considers the nine
    // cells it could possibly reach into. The pairwise version was correct and
    // unshippable: 688 ring nodes is 236k pairs, measured at 7.3ms per tick --
    // 46% of a frame, against 0.2% for the whole of the set drawing.
    const cells = new Map();
    const key = (cx, cy) => `${cx},${cy}`;
    for (const node of ring) {
      const k = key(Math.floor(node.x / clearance), Math.floor(node.y / clearance));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(node);
    }

    for (const a of ring) {
      const ax = Math.floor(a.x / clearance);
      const ay = Math.floor(a.y / clearance);
      for (let ox = -1; ox <= 1; ox += 1) {
       for (let oy = -1; oy <= 1; oy += 1) {
        for (const b of cells.get(key(ax + ox, ay + oy)) ?? []) {
        // Each unordered pair once. Both nodes are visited and each finds the
        // other, so without this every pair would be pushed twice.
        if (!(a.id < b.id)) continue;
        if (a.setId === b.setId) continue;
        if (related.has(`${a.setId} ${b.setId}`)) continue;
        // An anchored droplet must not have its ring shoved around the item
        // under the pointer; the hull pass below moves the other set whole.
        if (anchored.has(a.setId) || anchored.has(b.setId)) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > clearance || distance < 1e-6) continue;

        // Eases off as the gap closes on the clearance, so rings that are only
        // just near each other are nudged rather than shoved.
        const push = ((clearance - distance) / clearance) * strength * alpha * clearance;
        const ux = dx / distance;
        const uy = dy / distance;
        a.vx = (a.vx ?? 0) - (ux * push);
        a.vy = (a.vy ?? 0) - (uy * push);
        b.vx = (b.vx ?? 0) + (ux * push);
        b.vy = (b.vy ?? 0) + (uy * push);
        }
       }
      }
    }

    // And now the shapes on screen. Ring nodes being clear of each other does
    // not make the drawn hulls clear of each other: a hull bridges outward
    // across a concavity, so it occupies space that no ring node is in.
    const bySet = new Map();
    for (const node of ring) {
      if (!bySet.has(node.setId)) bySet.set(node.setId, []);
      bySet.get(node.setId).push(node);
    }
    const hulls = new Map();
    for (const [setId, members] of bySet) {
      const hull = hullOf(setId, members);
      if (hull && hull.length >= 3) hulls.set(setId, hull);
    }

    // Broad phase before the separating-axis test, for the same reason the ring
    // pass is bucketed: without it every pair of sets pays for a full SAT sweep
    // over two 48-point hulls whether or not they are anywhere near each other.
    // At 128 sets that is 8,128 sweeps per tick, ~2ms, on a scene where nothing
    // overlaps and the right answer is to do nothing.
    //
    // Sorting on minX and stopping the inner scan once a candidate starts to the
    // right of where the current hull ends is exact, not a heuristic: bounding
    // boxes that do not meet cannot contain shapes that do, so no real overlap
    // can be skipped. hullOverlap still decides every pair that survives.
    const ids = [...hulls.keys()];
    const bounds = new Map();
    for (const id of ids) {
      const hull = hulls.get(id);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of hull) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
      bounds.set(id, { minX, minY, maxX, maxY });
    }
    const sweep = ids.slice().sort((left, right) => bounds.get(left).minX - bounds.get(right).minX);
    for (let i = 0; i < sweep.length; i += 1) {
      const boundsI = bounds.get(sweep[i]);
      for (let j = i + 1; j < sweep.length; j += 1) {
        const boundsJ = bounds.get(sweep[j]);
        // Sorted on minX, so nothing after this one can reach back either.
        if (boundsJ.minX > boundsI.maxX) break;
        if (boundsJ.minY > boundsI.maxY || boundsI.minY > boundsJ.maxY) continue;
        if (related.has(`${sweep[i]} ${sweep[j]}`)) continue;
        const overlap = hullOverlap(hulls.get(sweep[i]), hulls.get(sweep[j]));
        if (!overlap) continue;

        // Along the axis of least overlap, which is the shortest way to part
        // two convex shapes — pushing along the line between centres instead
        // would shove two long sets lying side by side end to end.
        //
        // The impulse goes to the members as well as the ring nodes, one
        // uniform delta per set, because the visible outline is floored to
        // enclose the members: moving only the ring leaves the drawn shapes
        // overlapping exactly as much as the member regions do. A uniform delta
        // translates the droplet without changing its internal offsets.
        const anchoredI = anchored.has(sweep[i]);
        const anchoredJ = anchored.has(sweep[j]);
        // Both droplets under the pointer: nothing can move, so nothing is
        // pushed. The overlap lasts only as long as the drag does.
        if (anchoredI && anchoredJ) continue;
        let pushI = overlap.depth * strength * alpha;
        let pushJ = pushI;
        // One side anchored: it takes no impulse (members or ring — pushing its
        // ring would tear the outline away from the dragged item), and the
        // unheld droplet absorbs both halves of the separation.
        if (anchoredI) { pushI = 0; pushJ *= 2; }
        if (anchoredJ) { pushJ = 0; pushI *= 2; }

        for (const node of bySet.get(sweep[i])) {
          node.vx = (node.vx ?? 0) - (overlap.x * pushI);
          node.vy = (node.vy ?? 0) - (overlap.y * pushI);
        }
        for (const node of membersBySet.get(sweep[i]) ?? []) {
          node.vx = (node.vx ?? 0) - (overlap.x * pushI);
          node.vy = (node.vy ?? 0) - (overlap.y * pushI);
        }
        for (const node of bySet.get(sweep[j])) {
          node.vx = (node.vx ?? 0) + (overlap.x * pushJ);
          node.vy = (node.vy ?? 0) + (overlap.y * pushJ);
        }
        for (const node of membersBySet.get(sweep[j]) ?? []) {
          node.vx = (node.vx ?? 0) + (overlap.x * pushJ);
          node.vy = (node.vy ?? 0) + (overlap.y * pushJ);
        }
      }
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Whether two convex outlines overlap, and the shortest way to part them.
 *
 * The separating axis theorem: two convex shapes are disjoint exactly when some
 * axis exists on which their projections do not meet, and it is enough to test
 * the axes perpendicular to their edges. If none separates them they overlap,
 * and the axis where the projections overlap least is the shortest way out.
 *
 * Returns a unit vector pointing from the first shape towards the second, with
 * the depth to travel, or null when they are already apart. Convexity is what
 * makes this exact rather than approximate, and the drawn outline is a hull, so
 * it always holds here. */
function hullOverlap(a, b) {
  let best = null;
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i += 1) {
      const p = shape[i];
      const q = shape[(i + 1) % shape.length];
      // The edge normal, normalised so depths from different axes compare.
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const length = Math.hypot(ex, ey);
      if (length < 1e-9) continue;
      const axisX = -ey / length;
      const axisY = ex / length;

      let minA = Infinity; let maxA = -Infinity;
      for (const point of a) {
        const value = (point.x * axisX) + (point.y * axisY);
        if (value < minA) minA = value;
        if (value > maxA) maxA = value;
      }
      let minB = Infinity; let maxB = -Infinity;
      for (const point of b) {
        const value = (point.x * axisX) + (point.y * axisY);
        if (value < minB) minB = value;
        if (value > maxB) maxB = value;
      }

      // A gap on any axis proves them disjoint, so there is nothing to do.
      const depth = Math.min(maxA - minB, maxB - minA);
      if (depth <= 0) return null;
      if (!best || depth < best.depth) {
        // Oriented so it always points from a towards b.
        const flip = (maxB - minA) < (maxA - minB) ? -1 : 1;
        best = { depth, x: axisX * flip, y: axisY * flip };
      }
    }
  }
  return best;
}

/** Every set that has at least one node on screen. */
function setIdsInPlay(nodes, setsOf) {
  const ids = new Set();
  for (const node of nodes) {
    for (const setId of setsOf(node.id) ?? []) ids.add(setId);
  }
  return ids;
}

/** Ray casting against a set's hull — the shape that is drawn.
 *
 * This walked the chain in ringIndex order, which is a polygon only while the
 * loop stays ordered, and RING-TANGLE.md measured that it does not. Over a
 * crossed loop a ray cast reports points plainly inside as outside, silently,
 * and here that means exclusion simply fails to fire on an item the user can
 * see sitting inside the outline.
 *
 * Accepts pre-hulled points as well as raw nodes: ringHull is idempotent, but
 * callers in a per-tick loop should hoist it rather than rebuild per item. */
function pointInRing(point, ringNodes) {
  const ring = ringHull(ringNodes);
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) === (b.y > point.y)) continue;
    const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossX) inside = !inside;
  }
  return inside;
}
