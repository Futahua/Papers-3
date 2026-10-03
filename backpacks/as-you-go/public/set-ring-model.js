/** A set's outline as a ring of nodes in the same simulation.
 *
 * The boundary is not computed geometry. It is a closed chain of small
 * invisible nodes, linked to their neighbours and subject to the same charge
 * and collision as every icon, and what the user sees is a curve drawn through
 * where those nodes ended up.
 *
 * That inversion is the whole design, and it makes free what the previous
 * approach could not achieve at all. Computing an envelope means solving for a
 * shape that is smooth, closed, connected and of even thickness — four
 * properties that fight each other, and that a session of grid sampling,
 * contour extraction and morphological closing never got right at once. A
 * chain of linked nodes has all four by construction: it is continuous because
 * the links hold, smooth because the link distance is even, the same thickness
 * everywhere because it is made of identical nodes, and closed because the
 * chain loops.
 *
 * The behaviours asked for follow from ordinary physics rather than rules:
 *
 * - Push a member into the ring and it dents inward, because the ring nodes
 *   are pushed by the same collision that separates icons.
 * - Pull a member outward and the ring stretches to follow, growing new links
 *   as its perimeter grows — "as big as needed" is literally more nodes.
 * - An outsider cannot get in and a member cannot get out, because the ring
 *   nodes collide with icons like anything else. Containment is a consequence,
 *   not something enforced.
 * - Two sets overlap by their rings crossing, which needs no special case.
 *
 * No DOM, store, or browser APIs. */

/** The presentation anchor for a drawn outline: the arithmetic mean of its
 * visible vertices. It is stable for the resampled/eased polygon and avoids
 * inventing a second stored position for a set. */
export function outlineCentroid(outline) {
  if (!Array.isArray(outline) || outline.length === 0) return null;
  const total = outline.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
  }), { x: 0, y: 0 });
  return { x: total.x / outline.length, y: total.y / outline.length };
}

/** How many nodes a ring of this perimeter needs at the given link distance.
 *
 * Spacing is what keeps the ring gapless: too few nodes and the links stretch
 * until the boundary reads as a dotted line rather than a body. The count is
 * therefore derived from the perimeter rather than fixed per set. */
export function ringNodeCount(perimeter, linkDistance, { minimum = 8 } = {}) {
  if (!Number.isFinite(perimeter) || perimeter <= 0) return minimum;
  return Math.max(minimum, Math.round(perimeter / linkDistance));
}

/** The circle that encloses these members, plus the padding the ring sits at.
 *
 * A circle rather than a tight hull: the ring is going to be pushed into shape
 * by the members and whatever else is nearby, so this only has to be a starting
 * position loose enough that the ring settles inward rather than having to
 * fight its way out from between the members. */
export function enclosingCircle(members, padding) {
  if (!members || members.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const member of members) {
    x += member.x;
    y += member.y;
  }
  const centre = { x: x / members.length, y: y / members.length };

  let radius = 0;
  for (const member of members) {
    const reach = Math.hypot(member.x - centre.x, member.y - centre.y)
      + Math.hypot(member.width ?? 0, member.height ?? 0) / 2;
    radius = Math.max(radius, reach);
  }
  return { ...centre, radius: radius + padding };
}

/** The ellipse that encloses these members, oriented along how they are spread.
 *
 * A circle has one radius and so no way to express direction: dragging two
 * members apart along one axis inflates the boundary on both. Measured, two
 * 72px tiles 800px apart gave a ring 982px tall, when it should have stayed
 * about 112 — the set ballooned across the drag instead of stretching along it.
 *
 * The orientation comes from the members' own covariance, so the long axis is
 * whichever way they actually lie rather than a fixed one. A single member, or
 * several stacked in a perfect line, degenerates to a circle, which is right:
 * there is no spread to point along.
 *
 * The ellipse must reach one way without reaching the other. Growing each axis
 * by the worst member, symmetrically around the members' mean, makes a
 * diagonally dragged outlier extend the boundary backward as much as forward —
 * measured, a 240px drag swept the opposite side 113px outward and enclosed
 * foreign items there. So, while a member is being dragged (anchored), each
 * axis is sized by the member demand on EACH side separately: the semi-axis
 * spans half the two sides' demands (floored at the covariance estimate, which
 * keeps a settled set's natural size), and the centre shifts toward the
 * outlier by half the imbalance. The side opposite the outlier then sits
 * exactly at the stationary members' extent plus padding, and stays there
 * however far the drag goes.
 *
 * When nothing is held the ellipse returns to the symmetric mean-centred form.
 * The shift is only stable while the outlier is pinned: if the ring's centre
 * chased the members' own drift (no drag), the ring's collide shell would
 * sweep free members outward — measured, the always-heated ring settle runs
 * away with a shifted centre, and holds with the symmetric one. Dragging is
 * exactly the case that needs the one-sided shape, so the two behaviours are
 * the same code path with the anchor flag.
 *
 * @param anchored Whether the set is being dragged (a member is pinned). */
export function enclosingEllipse(members, padding, { anchored = false } = {}) {
  if (!members || members.length === 0) return null;
  const count = members.length;
  let cx = 0;
  let cy = 0;
  for (const member of members) { cx += member.x; cy += member.y; }
  cx /= count;
  cy /= count;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const member of members) {
    const dx = member.x - cx;
    const dy = member.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= count;
  syy /= count;
  sxy /= count;

  // Eigenvalues of the 2x2 covariance give the spread along each principal
  // axis; the eigenvector angle gives which way those axes point.
  const mean = (sxx + syy) / 2;
  const delta = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + (sxy * sxy)));
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  let half = 0;
  for (const member of members) {
    half = Math.max(half, Math.hypot(member.width ?? 0, member.height ?? 0) / 2);
  }

  // Covariance gives the *typical* spread, not the extent — it is a standard
  // deviation, so members further out than average fall outside the ellipse it
  // describes. Measured on a seven-member set after a folder was expanded, one
  // member sat at 1.09 in ellipse units and another at 0.99: outside its own
  // set's boundary, permanently, which is exactly what was seen on screen.
  //
  // So the axes are grown until every member is genuinely inside. The
  // covariance still decides the orientation and the ratio between the axes —
  // that is what makes the boundary stretch along the members rather than
  // ballooning — and this only fixes the scale.
  const baseA = Math.sqrt(mean + delta) + half + padding;
  const baseB = Math.sqrt(Math.max(0, mean - delta)) + half + padding;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  // The reach each side of an axis demands: the members' offset on that side
  // plus the tile half and the padding. Both sides always demand at least the
  // tile-plus-padding reach, so a lone member keeps a circle centred on it.
  // Grown per axis, not uniformly. Scaling both by the worst overshoot makes a
  // set that only needed to reach further along one axis inflate all round —
  // two members 140px apart came out 455x257 — and a boundary bigger than its
  // contents is what lets bystanders sit inside it.
  const reach = half + padding;
  let needNegX = reach;
  let needPosX = reach;
  let needNegY = reach;
  let needPosY = reach;
  for (const member of members) {
    const dx = member.x - cx;
    const dy = member.y - cy;
    // Into the ellipse's own frame. The tile's half-diagonal is included so the
    // whole icon is enclosed rather than its centre.
    const localX = (dx * cos) - (dy * sin);
    const localY = (dx * sin) + (dy * cos);
    if (localX < 0) needNegX = Math.max(needNegX, -localX + reach);
    else needPosX = Math.max(needPosX, localX + reach);
    if (localY < 0) needNegY = Math.max(needNegY, -localY + reach);
    else needPosY = Math.max(needPosY, localY + reach);
  }
  // Half the per-side span on each axis, floored at the covariance estimate.
  // While the set is anchored the centre shifts by half the imbalance, so the
  // side opposite the outlier is pinned at that side's stationary demand; when
  // nothing is held the centre stays at the mean and each axis takes the worst
  // single side (the settled form), because a ring chasing a drifting centre
  // would sweep free members (measured).
  //
  // The anchored shape is sized to the members' demands exactly, which puts
  // the tile-plus-padding corners tangent to the ellipse. The drawn outline is
  // a polygon through the ring nodes resampled to 48 points, and a polygon
  // cuts its own corners: at the sharpest exposed corners — the member floor's
  // 90-degree corners, whose extent the per-side demands describe — the
  // resample chords can remove part of a sample step. So the anchored ellipse
  // gets a resolution allowance derived from half the floored outline's
  // bounding-box perimeter divided across its 48 samples:
  // (needNegX + needPosX + needNegY + needPosY) / 48. The bounding-box
  // perimeter is a lower bound on the true perimeter, so this reduces rather
  // than promises to eliminate corner shaving. It applies equally to both
  // axes and therefore extends the nominal far side by the same allowance;
  // the full-force harness measures that total world-side motion at no more
  // than 18.6px, versus the legacy 112.8px sweep. Ring-node spacing and
  // resample chords still cut the outer padding by up to ~12px during a drag;
  // member tiles remain inside, and that residual is reported explicitly.
  const a = anchored
    ? Math.max(baseA, (needNegX + needPosX) / 2)
    : Math.max(baseA, needNegX, needPosX);
  const b = anchored
    ? Math.max(baseB, (needNegY + needPosY) / 2)
    : Math.max(baseB, needNegY, needPosY);
  const margin = anchored
    ? (needNegX + needPosX + needNegY + needPosY) / 48
    : 0;
  const finalA = a + margin;
  const finalB = b + margin;
  const shiftX = anchored ? (needPosX - needNegX) / 2 : 0;
  const shiftY = anchored ? (needPosY - needNegY) / 2 : 0;

  return {
    x: cx + (shiftX * Math.cos(angle)) - (shiftY * Math.sin(angle)),
    y: cy + (shiftX * Math.sin(angle)) + (shiftY * Math.cos(angle)),
    a: finalA,
    b: finalB,
    angle,
  };
}

/** Ellipse perimeter, by Ramanujan's approximation.
 *
 * There is no closed form, and the error here is under 1e-5 for any shape a
 * set will take — far below the precision the node count needs. */
export function ellipsePerimeter(ellipse) {
  if (!ellipse) return 0;
  const { a, b } = ellipse;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + ((3 * h) / (10 + Math.sqrt(4 - (3 * h)))));
}

/** A point on the ellipse at the given parameter angle, in world space. */
export function ellipsePoint(ellipse, t) {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const ex = Math.cos(t) * ellipse.a;
  const ey = Math.sin(t) * ellipse.b;
  return {
    x: ellipse.x + (ex * cos) - (ey * sin),
    y: ellipse.y + (ex * sin) + (ey * cos),
  };
}

/** Positions for a ring of `count` nodes around a circle.
 *
 * Evenly spaced and starting at a fixed angle, so a ring that is rebuilt lands
 * in the same place rather than rotating between renders. */
export function ringPositions(circle, count) {
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    positions.push({
      x: circle.x + Math.cos(angle) * circle.radius,
      y: circle.y + Math.sin(angle) * circle.radius,
    });
  }
  return positions;
}

/** Reconciles a set's ring nodes against what its members now need.
 *
 * Existing nodes keep their positions, so a ring that is already settled does
 * not jump when one node is added — the new one is placed on the circle and the
 * neighbours absorb it. Nodes are added at the end and removed from the end for
 * the same reason: reordering the whole ring would make it snap.
 *
 * Returns the node list and the links closing it into a loop. */
export function reconcileRing({
  setId,
  members,
  existing = [],
  padding = 40,
  // Spacing between neighbouring ring nodes, and so the node count for a given
  // perimeter. It is a cost decision as much as a shape one: every ring node
  // joins the simulation, and 34 gives ~72 nodes on a large ring where 60 gives
  // ~34 for the same outline.
  //
  // The count only has to capture the *shape*. Smoothness comes from drawing a
  // spline through the nodes, which is safe here in a way it was not before —
  // containment is ring nodes colliding, not polygon hit-testing, so the curve
  // is a pure rendering of where the nodes are and cannot disagree with
  // anything. A polygon at this spacing turns about 15 degrees per node; the
  // spline hides that entirely.
  linkDistance = 60,
} = {}) {
  const circle = enclosingCircle(members, padding);
  if (!circle) return { nodes: [], links: [], circle: null };

  // Sized from the ellipse the shape force actually pulls onto, not from the
  // circle. Sizing from the circle over-counts badly as a set is stretched —
  // two members 600px apart gave 41 nodes for a boundary needing 28 — and the
  // surplus has nowhere to go but to bunch, which is what made the outline
  // spiky and the set convulse.
  const ellipse = enclosingEllipse(members, padding);
  const wanted = ringNodeCount(ellipsePerimeter(ellipse), linkDistance);

  const nodes = existing.slice(0, wanted);
  if (nodes.length < wanted) {
    // Only the positions for the slots being filled, so existing nodes are not
    // dragged onto the ideal boundary every time the count changes. Seeded on
    // the ellipse, so a new node lands where the shape force is going to hold
    // it rather than being pulled across the set on its first tick.
    const positions = Array.from({ length: wanted }, (unused, i) => (
      ellipsePoint(ellipse, (2 * Math.PI * i) / wanted)));
    for (let i = nodes.length; i < wanted; i += 1) {
      nodes.push({
        id: `${setId}:ring:${i}`,
        setId,
        ring: true,
        // Its place around the loop, so a node sitting exactly on the centre
        // still has a direction to be pushed out along.
        ringIndex: i,
        x: positions[i].x,
        y: positions[i].y,
        vx: 0,
        vy: 0,
      });
    }
  }

  // Refreshed on every node, not just new ones: the count changes as the ring
  // grows, and a stale one would give a collapsed node the wrong direction out.
  for (const node of nodes) node.ringCount = nodes.length;

  // Closed loop: every node linked to the next, and the last back to the first.
  // The wrap-around link is what makes it a ring rather than a chain with two
  // loose ends, and a chain would let the boundary open up under load.
  const links = nodes.map((node, i) => ({
    source: node.id,
    target: nodes[(i + 1) % nodes.length].id,
  }));

  return { nodes, links, circle };
}

/** The convex hull of the ring nodes, counter-clockwise, by monotone chain.
 *
 * This exists because angular order around the loop is not preserved by
 * anything. RING-TANGLE.md measured it on branch 3: after a drag, neighbouring
 * ring nodes sat 317 degrees apart, five backward jumps around a ten-node ring.
 * The links hold neighbours ~60px apart and the shape force holds them ~91px
 * from the centre, and a tangled ring satisfies both constraints exactly as
 * well as an untangled one — so nothing in the physics objects, and the fault
 * only appears when the chain is drawn.
 *
 * A hull cannot self-intersect by construction rather than by tuning, so the
 * spline through it is always a simple closed curve however badly the chain
 * beneath it has knotted. That is the invariant, and it is held at the
 * rendering layer without touching a single force.
 *
 * The order it returns is its own, not ringIndex: the hull is a shape derived
 * from where the nodes are, and the chain's idea of its own sequence is exactly
 * the thing that cannot be trusted here.
 *
 * The cost is real and was measured before choosing this: a hull is convex, so
 * a set whose members fall into two distant clusters is drawn as one blob, and
 * a foreign item at the midpoint reads as inside. Two clusters 600px apart do
 * this. That is a known trade of a tear for a bulge, and if it shows on screen
 * the answer is a hull per cluster rather than abandoning the hull. */
export function ringHull(nodes) {
  const points = (nodes ?? [])
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
    .map((node) => ({ x: node.x, y: node.y }))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (points.length < 3) return points;

  // Duplicate positions would put a zero-length edge on the hull, which makes
  // the cross product below zero and the winding undecidable.
  const unique = points.filter((point, i) => (
    i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y));
  if (unique.length < 3) return unique;

  const cross = (o, a, b) => ((a.x - o.x) * (b.y - o.y)) - ((a.y - o.y) * (b.x - o.x));

  // Monotone chain: sweep left to right for the lower boundary, then right to
  // left for the upper, and the two joined nose to tail close the loop. Each
  // half keeps only left turns, so a point that would make the boundary bend
  // back on itself is popped — that is why the result cannot self-intersect.
  //
  // `>= 0` pops collinear points as well as reflex ones. Keeping them would put
  // redundant nodes along a straight edge, and the spline would bow through
  // them rather than running flat.
  const build = (sequence) => {
    const half = [];
    for (const point of sequence) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) >= 0) {
        half.pop();
      }
      half.push(point);
    }
    // The last point of each half is the first of the other, so it is dropped
    // here rather than appearing twice in the closed loop.
    half.pop();
    return half;
  };

  return [...build(unique), ...build([...unique].reverse())];
}

/** A hull resampled to a fixed number of points, evenly along its perimeter.
 *
 * The hull's point count changes as the physics moves — 8 points one frame, 14
 * the next — and two outlines with different counts cannot be interpolated
 * between, because there is no correspondence between their points. Resampling
 * both to the same count gives every drawn outline the same shape of data, so
 * one can be eased towards another.
 *
 * Walking by arc length rather than by vertex keeps the samples spread evenly
 * around the outline instead of bunching wherever the hull happened to have
 * corners, which is what stops the eased shape from swimming as corners appear
 * and disappear. */
export function resampleHull(hull, count = 48) {
  if (!hull || hull.length < 3) return null;

  const spans = [];
  let perimeter = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    spans.push(length);
    perimeter += length;
  }
  if (perimeter < 1e-6) return null;

  const points = [];
  const step = perimeter / count;
  let edge = 0;
  let walked = 0;
  for (let i = 0; i < count; i += 1) {
    const distance = i * step;
    while (edge < spans.length - 1 && walked + spans[edge] < distance) {
      walked += spans[edge];
      edge += 1;
    }
    const a = hull[edge];
    const b = hull[(edge + 1) % hull.length];
    const t = spans[edge] < 1e-6 ? 0 : (distance - walked) / spans[edge];
    points.push({ x: a.x + ((b.x - a.x) * t), y: a.y + ((b.y - a.y) * t) });
  }
  return points;
}

/** The direction from an inside point to the nearest point on a convex hull's
 * boundary — the shortest way out of that single hull.
 *
 * The nearest boundary point of a convex polygon from an interior point lies
 * on an edge (the perpendicular foot), so walking the edges and keeping the
 * closest projection is exact. Returns a unit direction, falling back to +x
 * for a degenerate hull. */
function nearestExitDirection(hull, point) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared < 1e-12) continue;
    let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(point.x - px, point.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: (point.x - px) / dist, y: (point.y - py) / dist };
    }
  }
  return best ?? { x: 1, y: 0 };
}

/** Whether `point` lies inside the simple polygon `hull` (boundary inclusive
 * via the standard half-open ray cast: a point exactly on an edge reads as
 * inside, which is why the escape response crosses the boundary rather than
 * resting on it). */
function pointInHull(hull, point) {
  if (!hull || hull.length < 3) return false;
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i, i += 1) {
    const a = hull[i];
    const b = hull[j];
    if ((a.y > point.y) === (b.y > point.y)) continue;
    const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossX) inside = !inside;
  }
  return inside;
}

/** The distance at which a ray from `point` along the unit direction `d`
 * crosses `hull`'s boundary — the actual ray-polygon crossing, not the
 * support-plane distance.
 *
 * The support distance (how far the hull extends along `d`) overstates travel
 * for every direction except an active edge normal: a ray from the centre of a
 * 100x100 square along (0.8, 0.6) exits through x=100 at t=62.5, where the
 * support formula reports 70. The shortest-escape claim needs the real
 * crossing, so each edge is intersected with the ray and the forward crossings
 * are collected. Infinity means the ray never crosses the hull (the point is
 * outside it and the ray moves away). */
function rayCrossings(hull, point, d) {
  let near = Infinity;
  let far = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = d.x * ey - d.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - point.x) * ey - (a.y - point.y) * ex) / denom;
    if (t < -1e-9) continue;
    const s = ((a.x - point.x) * d.y - (a.y - point.y) * d.x) / denom;
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    if (t < near) near = t;
    if (t > far) far = t;
  }
  return { near, far };
}

/** The distance along the unit direction `d` at which a ray from `point` is
 * finally outside `hull` — the actual ray-polygon crossing, not the
 * support-plane distance. For an interior point this is the single boundary
 * crossing; from a point already outside it is the far side of the hull the
 * ray runs through (or Infinity when the ray never crosses it). A point on the
 * boundary crossing at t=0 counts, so an item resting exactly on its own
 * outline has a zero allowed bound outward and cannot be flung out of its own
 * set. */
export function rayExitDistance(hull, point, d) {
  return rayCrossings(hull, point, d).far;
}

/** Where an edge crosses another polygon, as parameters along that edge.
 *
 * Splitting an edge at every crossing is what makes the interval classification
 * below sound: between two consecutive crossings the edge is wholly inside or
 * wholly outside the other polygon, so one midpoint test decides the whole
 * interval. */
function edgeCutParameters(a, b, hull) {
  const cuts = [];
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  for (let i = 0; i < hull.length; i += 1) {
    const c = hull[i];
    const d = hull[(i + 1) % hull.length];
    const fx = d.x - c.x;
    const fy = d.y - c.y;
    const denom = (ex * fy) - (ey * fx);
    if (Math.abs(denom) < 1e-12) continue;
    const t = (((c.x - a.x) * fy) - ((c.y - a.y) * fx)) / denom;
    const s = (((c.x - a.x) * ey) - ((c.y - a.y) * ex)) / denom;
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    cuts.push(Math.max(0, Math.min(1, t)));
  }
  return cuts;
}

/** The nearest point of a segment to `point`, and its distance. */
function nearestOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  let t = 0;
  if (lengthSquared > 1e-12) {
    t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const q = { x: a.x + (dx * t), y: a.y + (dy * t) };
  return { point: q, distance: Math.hypot(point.x - q.x, point.y - q.y) };
}

/** The shortest valid escape from a trespassed region: the nearest point that
 * is outside every forbidden hull while still inside every allowed hull, and
 * the direction to it.
 *
 * A trespasser must leave the sets it does not belong to without being thrown
 * out of the sets it does. The nearest such point is what the response aims
 * at; the direction alone is not enough, because a shortest direction found by
 * sampling a candidate list can be far from optimal for a UNION of hulls: a
 * minimax compromise direction between two overlapping hulls beats every
 * individual edge normal and nearest-exit direction (a seeded audit found a
 * 2.30x case, preserved as a regression fixture).
 *
 * So the answer is computed on the geometry instead of searched over
 * directions. The valid region's boundary is made of pieces of the forbidden
 * hulls' edges: leaving the forbidden union means reaching its exposed
 * boundary — a part of some forbidden edge that is not buried inside another
 * forbidden hull. Every forbidden edge is therefore split at its intersections
 * with the other forbidden hulls and with the allowed hulls, each resulting
 * interval is classified once by its midpoint (outside every OTHER forbidden
 * hull, inside every allowed hull), and `point` is projected onto the surviving
 * intervals. The nearest projection is the exact optimum: the closest point of
 * the valid set lies on that set's boundary, and its boundary is exactly the
 * union of those intervals (plus allowed-hull boundary pieces, which are never
 * strictly better — a point there is also on a forbidden edge or already
 * outside). Allowed-hull edges are split and tested the same way so a corridor
 * that runs along the allowed boundary is still found.
 *
 * Returns { x, y, distance } — the unit direction to that nearest valid point
 * and its distance — or null when the point is already outside every forbidden
 * hull, or when no valid point exists (the allowed region is entirely buried in
 * forbidden territory). */
export function shortestValidEscape(
  point,
  forbiddenHulls,
  allowedHulls = [],
  { clearance = 0.5 } = {},
) {
  const forbidden = (forbiddenHulls ?? []).filter((hull) => hull && hull.length >= 3);
  if (forbidden.length === 0) return null;
  if (!forbidden.some((hull) => pointInHull(hull, point))) return null;
  const allowed = (allowedHulls ?? []).filter((hull) => hull && hull.length >= 3);

  // The classification epsilon: a candidate point is nudged off the boundary it
  // sits on before being tested, so "on the edge of the hull I am leaving" does
  // not read as still inside it. Small next to any on-screen distance, large
  // next to the intersection arithmetic above.
  const EPS = 1e-6;
  const valid = (q, skipForbidden) => {
    for (let i = 0; i < forbidden.length; i += 1) {
      if (i === skipForbidden) continue;
      if (pointInHull(forbidden[i], q)) return false;
    }
    for (const hull of allowed) {
      if (!pointInHull(hull, q)) return false;
    }
    return true;
  };

  let best = null;
  let bestDistance = Infinity;

  // Every edge of every hull is a candidate carrier of the nearest valid point.
  // A forbidden edge is skipped against its OWN hull (the whole edge lies on
  // that hull's boundary, so testing containment against it is meaningless);
  // an allowed edge is tested against all of them.
  const carriers = [];
  forbidden.forEach((hull, index) => carriers.push({ hull, own: index }));
  allowed.forEach((hull) => carriers.push({ hull, own: -1 }));

  for (const carrier of carriers) {
    const { hull } = carrier;
    for (let i = 0; i < hull.length; i += 1) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-9) continue;

      const cuts = [0, 1];
      for (let k = 0; k < forbidden.length; k += 1) {
        if (k === carrier.own) continue;
        cuts.push(...edgeCutParameters(a, b, forbidden[k]));
      }
      for (const other of allowed) {
        if (other === hull) continue;
        cuts.push(...edgeCutParameters(a, b, other));
      }
      cuts.sort((p, q) => p - q);

      for (let c = 0; c < cuts.length - 1; c += 1) {
        const t0 = cuts[c];
        const t1 = cuts[c + 1];
        if (t1 - t0 < 1e-9) continue;
        const mid = (t0 + t1) / 2;
        const at = (t) => ({ x: a.x + ((b.x - a.x) * t), y: a.y + ((b.y - a.y) * t) });
        // One midpoint decides the interval: it holds no crossing inside it.
        // The midpoint is nudged along the carrier hull's outward edge normal
        // so a forbidden edge reads as just outside the hull it bounds; for an
        // allowed carrier the point is tested where it lies.
        const m = at(mid);
        const nx = (b.y - a.y) / length;
        const ny = -(b.x - a.x) / length;
        // Both sides of the carrier edge are probed, and the carrier's own hull
        // is NOT exempted from the test. Exempting it would treat "resting on
        // this hull's boundary" as having left it, which is false wherever the
        // edge runs THROUGH the forbidden union rather than bounding it: in the
        // adverse A/B fixture, B's own bottom edge would then read as a valid
        // exit and the item would slide along it to y=0, still inside B,
        // instead of leaving B at x=10. The EPS nudge is what distinguishes the
        // two sides, so a genuine exit still reads as outside.
        const probe = [
          { x: m.x + (nx * EPS), y: m.y + (ny * EPS) },
          { x: m.x - (nx * EPS), y: m.y - (ny * EPS) },
        ];
        if (!probe.some((q) => valid(q, -1))) continue;

        // The exact optimum on this interval. The clearance is deliberately NOT
        // applied here: insetting or lifting each interval before comparing
        // them lets a fixed margin decide the geometry, which discards narrow
        // but genuine corridors and picks far worse routes (measured: a 2.4px
        // exit replaced by a 74px one). The geometry answers first and alone;
        // the margin is added to the winner, along the escape direction, below.
        const near = nearestOnSegment(point, at(t0), at(t1));
        if (near.distance < bestDistance) {
          bestDistance = near.distance;
          best = near.point;
        }
      }
    }
  }

  if (!best) return null;

  // The item can be ON the nearest valid point already — resting exactly on the
  // boundary of a hull that, by the boundary-inclusive containment predicate,
  // still CONTAINS it. Returning null there would report "nothing to do" for an
  // item the force still sees as trespassing, and it would sit on that edge for
  // ever (measured: a B-only item stalled at margin -0.4 into A, escape null,
  // desired 0.0, for the whole settled run). The route has no length but it
  // does have a direction — the outward edge normal — so the clearance alone
  // carries the item off the boundary.
  if (bestDistance < 1e-9) {
    const outward = nearestExitDirection(
      forbidden.find((hull) => pointInHull(hull, point)) ?? forbidden[0],
      point,
    );
    const q = {
      x: point.x + (outward.x * clearance),
      y: point.y + (outward.y * clearance),
    };
    if (!valid(q, -1)) return null;
    return { x: outward.x, y: outward.y, distance: clearance, target: q };
  }

  // The optimum sits ON the boundary — of the hull being left, and where two
  // forbidden boundaries cross, on both at once. A point there is not strictly
  // outside the forbidden union, and an item resting on that knife edge is
  // pushed straight back in by easing and collision (a seeded audit found
  // 18/383 escapes landing on exactly such a pinch). The same is true of a
  // corridor so narrow that spending all the room stops the item exactly on its
  // own set's outer boundary, where containment then reads it as outside.
  //
  // So the margin is added ALONG the escape direction, past the boundary rather
  // than sideways off it. This cannot leave the valid pocket the geometry just
  // chose — it only travels further out of the forbidden union — so the route
  // stays optimal while the landing becomes strictly clear. The margin shrinks
  // when the room ahead is smaller than it, and a pocket with no room at all
  // keeps the exact boundary point, which is still the true optimum.
  const ux = (best.x - point.x) / bestDistance;
  const uy = (best.y - point.y) / bestDistance;
  let distance = bestDistance;
  for (const scale of [1, 0.5, 0.25, 0.1]) {
    const step = clearance * scale;
    const q = { x: best.x + (ux * step), y: best.y + (uy * step) };
    if (!valid(q, -1)) continue;
    distance = bestDistance + step;
    break;
  }
  return {
    x: ux,
    y: uy,
    distance,
    target: { x: point.x + (ux * distance), y: point.y + (uy * distance) },
  };
}

/** Eases a drawn outline towards the shape the physics currently implies.
 *
 * The hull guarantees the outline is simple; it says nothing about it being
 * steady. Each frame recomputes the hull from scratch, so a ring that collapses
 * inward, loses nodes, or briefly degenerates makes the drawn shape shrink or
 * blink out between one frame and the next — which reads as the set popping
 * even though nothing about the membership changed.
 *
 * So the drawn outline is a state of its own, chased towards the target rather
 * than replaced by it. `previous` is what was drawn last frame; the return
 * value is what to draw now, and to pass back next frame.
 *
 * `rate` is per frame at 60fps. Low enough that a collapse becomes a settle
 * rather than a snap, high enough that the outline still keeps up with a
 * dragged member — the ring already lags by design, and stacking a slow ease on
 * top of that would read as the outline being detached from its set.
 *
 * A null target means the physics has nothing to draw this frame — a
 * degenerate ring, or members gone off screen. The previous shape is returned
 * unchanged rather than blanked, so the outline holds its last good form
 * instead of vanishing; the caller decides when a set is really gone. */
export function easeOutline(previous, target, { rate = 0.25 } = {}) {
  if (!target) return previous ?? null;
  if (!previous || previous.length !== target.length) return target;

  const eased = [];
  for (let i = 0; i < target.length; i += 1) {
    eased.push({
      x: previous[i].x + ((target[i].x - previous[i].x) * rate),
      y: previous[i].y + ((target[i].y - previous[i].y) * rate),
    });
  }
  // Interpolating two convex outlines point by point does NOT give a convex
  // outline. Perimeter resampling numbers points by distance travelled rather
  // than by edge direction, so the same index on two differently shaped hulls
  // need not be the same corner, and the shape midway between them can turn
  // back on itself. Two convex 48-point hulls have been measured easing into an
  // outline with four reflex turns.
  //
  // That matters well beyond how it looks: region decomposition and set
  // separation both take this outline to be convex, and both quietly misbehave
  // when it is not. Hulling here, at the one place the outline is produced,
  // rather than defensively inside each consumer, keeps a single definition of
  // what shape.outline is.
  //
  // Resampled back to the incoming count for the reason floorOutline gives:
  // the next frame of easing needs point-for-point correspondence.
  const hulled = ringHull(eased);
  if (hulled.length < 3) return eased;
  return resampleHull(hulled, target.length) ?? eased;
}

/** The area a closed outline encloses, by the shoelace formula. */
export function outlineArea(points) {
  if (!points || points.length < 3) return 0;
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    total += (points[j].x * points[i].y) - (points[i].x * points[j].y);
  }
  return Math.abs(total) / 2;
}

/** The hull of the members' own tiles — the smallest an outline may ever be.
 *
 * Every corner of every member tile, hulled. A set's outline is a statement
 * about which items are in it, so it can never be smaller than the items
 * themselves: shrinking past them would draw a boundary that visibly excludes
 * its own members, which is a false statement about the set rather than merely
 * an ugly one.
 *
 * Corners rather than centres, because a tile is a rectangle and an outline
 * that passed through the centres would cut every icon in half. */
export function memberFloorHull(members, padding = 0) {
  const corners = [];
  for (const member of members ?? []) {
    if (!Number.isFinite(member.x) || !Number.isFinite(member.y)) continue;
    const halfWidth = ((member.width ?? 0) / 2) + padding;
    const halfHeight = ((member.height ?? 0) / 2) + padding;
    corners.push(
      { x: member.x - halfWidth, y: member.y - halfHeight },
      { x: member.x + halfWidth, y: member.y - halfHeight },
      { x: member.x + halfWidth, y: member.y + halfHeight },
      { x: member.x - halfWidth, y: member.y + halfHeight },
    );
  }
  if (corners.length < 3) return null;
  const hull = ringHull(corners);
  return hull.length >= 3 ? hull : null;
}

/** Holds an outline out to at least the shape its own members occupy.
 *
 * A set whose members pile together has a ring with almost no area, and a hull
 * of near-coincident points draws as a sliver or nothing at all. That is the
 * collapse: the set still exists and still has members, but its outline has no
 * room to be seen.
 *
 * The floor is the members' own hull rather than a fixed area, because what the
 * outline must never do is dip inside the items it is drawn around — an outline
 * smaller than its members states something false about the set, not merely
 * something ugly. A constant cannot express that: too large for one small item,
 * too small for ten big ones.
 *
 * The union of the two point sets, hulled. Radial projection was tried first
 * and is wrong: it can only push a sample that already exists along a given
 * direction, so a collapsed outline whose samples span 124 degrees leaves the
 * rest of the circle with nothing to push, and the result stays thin — measured
 * at 6441 against a floor of 32224. A hull over both sets has no such gap,
 * because the floor's own corners are in the input.
 *
 * Both operands are convex, so their union's hull is exactly the smaller of the
 * two shapes' envelope: an outline already clear of the floor is returned
 * unchanged, and one that has fallen inside is lifted to the floor only where
 * it had. */
export function floorOutline(points, floor) {
  if (!points || points.length < 3) return points;
  if (!floor || floor.length < 3) return points;

  const combined = ringHull([...points, ...floor]);
  if (combined.length < 3) return points;
  // Resampled back to the incoming count so the frame-to-frame easing still has
  // point-for-point correspondence between one outline and the next.
  return resampleHull(combined, points.length) ?? points;
}

/** A closed smooth path through the ring nodes.
 *
 * Catmull-Rom converted to cubic béziers, which passes exactly through every
 * node rather than being pulled off them the way a B-spline is. The ring is
 * where the physics put it, so the drawing should not move it.
 *
 * Smoothing the *rendering* was rejected on the previous approach, and for a
 * good reason there: the drawn curve would have differed from the polygon that
 * decided clicks and containment, so the user would have been interacting with
 * a shape they could not see. Here nothing is hit-tested against this path.
 * Containment is ring nodes colliding with icons, so the curve is a pure
 * rendering of positions and has no second opinion to disagree with. */
export function ringPath(nodes, { tension = 6, hulled = false } = {}) {
  // Through the hull, not the chain. A spline follows whatever order it is
  // given, so drawing the raw chain after it has reordered is what rendered as
  // the lens and the angular spikes; the hull has no order to lose.
  //
  // `hulled` is for callers that have already prepared the outline — resampled
  // and eased across frames — where re-hulling would be wasted work and would
  // also undo the even spacing that the easing depends on.
  const points = hulled ? (nodes ?? []) : ringHull(nodes);
  if (points.length < 3) return '';

  const at = (i) => points[(i + points.length) % points.length];
  const round = (value) => Math.round(value * 100) / 100;

  let path = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length; i += 1) {
    const previous = at(i - 1);
    const current = at(i);
    const next = at(i + 1);
    const after = at(i + 2);
    // The control points are the neighbours' offsets scaled down: a sixth of
    // the span is the standard Catmull-Rom to bézier conversion, and larger
    // values bow the curve out past the nodes.
    const c1 = {
      x: current.x + (next.x - previous.x) / tension,
      y: current.y + (next.y - previous.y) / tension,
    };
    const c2 = {
      x: next.x - (after.x - current.x) / tension,
      y: next.y - (after.y - current.y) / tension,
    };
    path += ` C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(next.x)} ${round(next.y)}`;
  }
  return `${path} Z`;
}

/** A force pulling each ring node towards its own set's members.
 *
 * Without it the ring is only held by its links and would drift off the set it
 * belongs to, or be pushed away entirely by the charge of the members it is
 * supposed to surround. The pull is towards the enclosing circle rather than
 * the centre, so the ring settles *around* the members instead of collapsing
 * onto them.
 *
 * Members are not pulled by this at all. The ring finds the members; the
 * members are never rearranged to suit the ring — that was the mistake the
 * membrane approach made, and it is what made dragging feel like a negotiation.
 */
export function forceRingShape({
  membersOf,
  padding = 40,
  strength = 0.35,
  // The pull never drops below this however cool the simulation gets.
  //
  // d3 decays alpha towards zero, so a shape force scaled by alpha alone fades
  // out exactly when the graph settles — and a dragged member then walks away
  // from a ring that has stopped chasing it. Measured on a realistic drag (many
  // small steps at reheat 0.12, which is what pointer-controller does), the
  // ring finished 205px behind its member and shrank from 183 wide to 120.
  minAlpha = 0.25,
  // Whether the user is dragging anything right now.
  //
  // The floor above is what stops a ring lagging behind a member being pulled
  // across the screen, and it does that by refusing to cool. But d3 cools
  // everything else, so once a scene settles this force is the only one still
  // injecting velocity — and ring nodes collide with icons at strength 0.9, so
  // it drives the icons, they move, the ring chases them, and the loop pumps
  // energy with nothing left to damp it.
  //
  // Measured on an asymmetric two-set scene, all forces at the app's constants:
  // a set whose members started 10px apart stretched to 7495px over 4000 ticks,
  // and both outlines crossed. Removing any single force stopped it, which is
  // the signature of a feedback loop rather than one force being wrong; ring
  // and collide together diverge (7495) where either alone is stable (100, 111).
  //
  // Tuning was tried first and rejected: neither the floor's value nor a speed
  // cap behaves monotonically — minAlpha 0.10 settles at 216 while 0.05 gives
  // 1795, and a cap of 6 or 16 holds where 8 diverges. A threshold that works by
  // luck is not a fix.
  //
  // So the floor applies only while it is earning its keep. Nothing held means
  // nothing to chase, and the force cools with the rest of the simulation.
  //
  // Defaulted to always-on, which is the old behaviour: a caller that cannot
  // see the app's drag state must get the floor rather than silently lose it.
  // Defaulting the other way makes the failure a ring that lags during drags —
  // the exact fault the floor was added to fix, reintroduced quietly.
  isDragging = () => true,
} = {}) {
  let nodes = [];

  function force(alpha) {
    const floor = isDragging() ? minAlpha : 0;
    const shapes = new Map();
    for (const node of nodes) {
      if (!node.ring) continue;
      if (!shapes.has(node.setId)) {
        // While the set is being dragged the enclosing shape is one-sided —
        // it reaches toward the held member without extending the opposite
        // side. Settled, it is the symmetric form; a shifted centre that
        // follows the members' own drift would sweep the free members.
        shapes.set(node.setId, enclosingEllipse(membersOf(node.setId) ?? [], padding, { anchored: isDragging() }));
      }
      const shape = shapes.get(node.setId);
      if (!shape) continue;

      // Towards this node's own slot on the rim, as a point.
      //
      // The version this replaces applied (radius - distance) along the node's
      // own outward unit vector. That can only move a node in or out along the
      // line it already sits on, never around the circle, so when the members
      // move the ring can only resize in place — it cannot redistribute to
      // follow. Aiming at an absolute point gives the correction a tangential
      // component, which is what lets the ring travel.
      //
      // The slot angle also gives a node sitting exactly on the centre a
      // direction to open out along, which a zero-length radial vector cannot.
      //
      // Measured together with the alpha floor below, on the drag pattern
      // pointer-controller actually performs: 42px behind the member, keeping
      // its size, against 205px and a collapse from 197px wide to 122 for the
      // original. The two changes were not separable in testing — removing the
      // floor alone reddens three tests, and the exact split of credit between
      // them is NOT established.
      const angle = (2 * Math.PI * (node.ringIndex ?? 0)) / Math.max(1, node.ringCount ?? 1);
      const target = ellipsePoint(shape, angle);
      const pull = strength * Math.max(alpha, floor);
      node.vx += (target.x - node.x) * pull;
      node.vy += (target.y - node.y) * pull;
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Where a trespassing item should be put down, just outside the boundary.
 *
 * The ring cannot win an argument with a drag. A dragged node has its position
 * set outright rather than nudged, so collision has nothing to push back
 * against — making the boundary stiff enough to resist one only made the whole
 * set convulse, and foreign items still ended up inside.
 *
 * So this does not fight the drag at all. The item goes wherever it is put, and
 * once the gesture is over anything sitting inside a set it does not belong to
 * is moved out along the shortest path. What the user sees while dragging is
 * free; what they see when they let go is correct.
 *
 * Returns null when the item is already outside, so callers can leave settled
 * layouts alone rather than nudging everything every tick.
 */
export function ejectionTarget(point, ringNodes, { clearance = 24 } = {}) {
  // The hull's edges, so the item is put down outside the curve the user can
  // see. Walking the chain here would measure the shortest way out of a shape
  // that is not being drawn, and on a tangled ring that lands the item visibly
  // inside the outline it was supposed to be ejected from.
  const ring = ringHull(ringNodes);
  if (ring.length < 3) return null;
  if (!pointInsideRing(point, ring)) return null;

  // The nearest point on the boundary itself, not on the line to some centre:
  // a set with an elongated or dented outline has no centre worth pushing away
  // from, and the shortest way out of a long thin shape is sideways.
  let best = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const closest = closestPointOnSegment(point, ring[j], ring[i]);
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y);
    if (!best || distance < best.distance) best = { ...closest, distance };
  }
  if (!best) return null;

  // Push past the edge rather than onto it, so the item lands clear of the
  // outline instead of resting on it where the next tick might take it back in.
  const dx = best.x - point.x;
  const dy = best.y - point.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: best.x + clearance, y: best.y };
  return {
    x: best.x + (dx / length) * clearance,
    y: best.y + (dy / length) * clearance,
  };
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) return { x: a.x, y: a.y };
  let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + (t * dx), y: a.y + (t * dy) };
}

/** Ray casting against the hull — the same shape that is drawn.
 *
 * This used to walk the chain in ringIndex order, which is a polygon only while
 * the loop has not reordered itself. RING-TANGLE.md measured that it does
 * reorder, and a ray cast over a crossed loop reports points plainly inside the
 * outline as outside, silently.
 *
 * Reading the hull instead is not just more robust, it is required for
 * correctness of a different kind: the user clicks and drops against the curve
 * they can see. If containment kept using the chain while the drawing used the
 * hull, the two would disagree — which is precisely the fault that retired the
 * geometry branch, where the drawn shape and the hit-tested shape were not the
 * same thing. One shape, read by everyone. */
export function pointInsideRing(point, ringNodes) {
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

/** Caps how far any node may travel in a single tick.
 *
 * Registered after the other forces so it sees their combined effect: it is a
 * governor on the result, not another opinion about where things should go.
 *
 * Dragging several foreign items through a set at once is what needs it. Each
 * one pushes the members, the members drag the ring after them, and with four
 * in flight the feedback compounds — measured, the ring went from moving 0.3px
 * per tick when settled to 17.5px on average and 164px in a single tick, which
 * is the violent convulsing seen on screen. Nothing there is wrong
 * individually; it is the sum that explodes.
 *
 * A cap is the honest fix rather than weakening any one force, because the
 * problem is the total. 8px per tick is roughly half a tile at 60fps: fast
 * enough that the boundary still keeps up with a dragged member — measured,
 * members are flung 70px from home against 455 uncapped — and slow enough that
 * nothing can cross the screen in a frame.
 */
export function forceSpeedLimit({ maxPerTick = 8 } = {}) {
  let nodes = [];

  function force() {
    for (const node of nodes) {
      const speed = Math.hypot(node.vx ?? 0, node.vy ?? 0);
      if (speed <= maxPerTick) continue;
      const scale = maxPerTick / speed;
      node.vx *= scale;
      node.vy *= scale;
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}
