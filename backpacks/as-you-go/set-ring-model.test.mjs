/** The outline as a ring of nodes rather than as computed geometry.
 *
 * The properties that mattered — closed, smooth, even thickness, containing its
 * members — were four fighting requirements when the shape was solved for. Here
 * they are consequences of the chain, so most of these tests are about the ring
 * being a proper loop and staying attached to its members. */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ringNodeCount,
  enclosingCircle,
  enclosingEllipse,
  ringPositions,
  reconcileRing,
  ringPath,
  ringHull,
  resampleHull,
  easeOutline,
  floorOutline,
  memberFloorHull,
  outlineArea,
  forceRingShape,
  ejectionTarget,
  pointInsideRing,
  forceSpeedLimit,
  shortestValidEscape,
  rayExitDistance,
  outlineCentroid,
} from './public/set-ring-model.js';
// Convexity is what the region engine and set separation assume of an outline,
// so the check belongs to the same normalization they use.
import { normalizePolygon } from './public/set-region-model.js';
// The real forces, so containment is measured against the configuration the
// app actually runs rather than an idealised one.
import {
  forceSimulation, forceManyBody, forceCollide, forceLink, forceX, forceY,
} from './public/vendor/d3-force.js';
import { forceSetExclusion, forceSetGravity } from './public/set-gravity-model.js';

test('outline centroid uses the visible outline vertices', () => {
  assert.deepEqual(outlineCentroid([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }]), { x: 8 / 3, y: 2 / 3 });
  assert.equal(outlineCentroid([]), null);
});

function tile(id, x, y) {
  return { id, x, y, width: 72, height: 72 };
}

test('the node count follows the perimeter, so the ring never gaps', () => {
  // Spacing is what keeps the boundary solid. A fixed count would leave a big
  // set with its links stretched into a dotted line.
  const small = ringNodeCount(2 * Math.PI * 120, 60);
  const large = ringNodeCount(2 * Math.PI * 500, 60);
  assert.ok(large > small * 3, `a bigger ring gets more nodes (${small} -> ${large})`);
  assert.ok(ringNodeCount(0, 60) >= 8, 'and a degenerate ring still has a floor');
});

test('the enclosing circle covers every member', () => {
  const members = [tile('a', 0, 0), tile('b', 200, 0), tile('c', 0, 160)];
  const circle = enclosingCircle(members, 40);
  for (const member of members) {
    const reach = Math.hypot(member.x - circle.x, member.y - circle.y)
      + Math.hypot(member.width, member.height) / 2;
    assert.ok(reach <= circle.radius + 1e-6, `${member.id} is inside the circle`);
  }
});

test('the ring is a closed loop, not a chain with loose ends', () => {
  // The wrap-around link is what makes it a boundary. A chain with two ends
  // would open up under load, which is the gap a set must not have.
  const { nodes, links } = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 150, 0)] });
  assert.equal(links.length, nodes.length, 'one link per node closes the loop');

  const outgoing = new Map(links.map((link) => [link.source, link.target]));
  let cursor = nodes[0].id;
  const seen = new Set();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    cursor = outgoing.get(cursor);
  }
  assert.equal(seen.size, nodes.length, 'following the links visits every node');
  assert.equal(cursor, nodes[0].id, 'and returns to the start');
});

test('a growing set gains nodes and keeps the ones it had', () => {
  // "It can get as big as needed" is literally more links. Existing nodes keep
  // their positions so the settled part of the ring does not jump when one is
  // added.
  const near = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 120, 0)] });
  const far = reconcileRing({
    setId: 's1',
    members: [tile('a', 0, 0), tile('b', 900, 0)],
    existing: near.nodes,
  });

  assert.ok(far.nodes.length > near.nodes.length, `the ring grew (${near.nodes.length} -> ${far.nodes.length})`);
  for (let i = 0; i < near.nodes.length; i += 1) {
    assert.equal(far.nodes[i].id, near.nodes[i].id, `node ${i} survived the growth`);
    assert.equal(far.nodes[i].x, near.nodes[i].x, `node ${i} kept its position`);
  }
});

test('a shrinking set drops nodes rather than bunching them up', () => {
  const far = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 900, 0)] });
  const near = reconcileRing({
    setId: 's1',
    members: [tile('a', 0, 0), tile('b', 120, 0)],
    existing: far.nodes,
  });
  assert.ok(near.nodes.length < far.nodes.length, `the ring shrank (${far.nodes.length} -> ${near.nodes.length})`);
  assert.equal(near.links.length, near.nodes.length, 'and is still closed');
});

test('the ring settles around its members, not on top of them', () => {
  // The shape force pulls towards the enclosing circle's rim rather than its
  // centre, so the ring surrounds the members instead of collapsing onto them.
  const members = [tile('a', 0, 0), tile('b', 160, 0)];
  const { nodes } = reconcileRing({ setId: 's1', members });
  // Start them all at the centre, the worst case.
  for (const node of nodes) { node.x = 80; node.y = 0; node.vx = 0; node.vy = 0; }

  const force = forceRingShape({ membersOf: () => members });
  force.initialize(nodes);
  let alpha = 1;
  for (let i = 0; i < 400; i += 1) {
    alpha += (0 - alpha) * 0.028;
    force(alpha);
    for (const node of nodes) {
      node.vx *= 0.68; node.vy *= 0.68;
      node.x += node.vx; node.y += node.vy;
    }
  }

  // Against the ellipse, not a circle: the boundary is oriented along how the
  // members are spread, so "on the rim" means the ellipse equation is satisfied
  // rather than every node being one radius from the centre.
  const ellipse = enclosingEllipse(members, 40);
  for (const node of nodes) {
    const dx = node.x - ellipse.x;
    const dy = node.y - ellipse.y;
    const cos = Math.cos(-ellipse.angle);
    const sin = Math.sin(-ellipse.angle);
    const local = { x: (dx * cos) - (dy * sin), y: (dx * sin) + (dy * cos) };
    const onRim = Math.hypot(local.x / ellipse.a, local.y / ellipse.b);
    assert.ok(
      Math.abs(onRim - 1) < 0.15,
      `a ring node settled off the rim (${onRim.toFixed(2)}, 1.0 is exactly on it)`,
    );
  }
});

test('the boundary stretches along the drag rather than growing radially', () => {
  // A circle has one radius and so no way to express direction: pulling two
  // members apart along one axis inflated the boundary on both. Measured, two
  // 72px tiles 800px apart gave a ring 982px tall where it should stay ~182.
  const across = [];
  for (const separation of [0, 200, 400, 800]) {
    const members = [tile('a', -separation / 2, 0), tile('b', separation / 2, 0)];
    const ellipse = enclosingEllipse(members, 40);
    across.push(2 * ellipse.b);
    // The long axis follows the spread.
    assert.ok(
      2 * ellipse.a >= separation,
      `at ${separation} apart the boundary was only ${(2 * ellipse.a).toFixed(0)} long`,
    );
  }
  // The short axis does not: it stays put however far apart they are dragged.
  const widest = Math.max(...across);
  const narrowest = Math.min(...across);
  assert.ok(
    widest - narrowest < 5,
    `the boundary ballooned across the drag: heights ${across.map((v) => v.toFixed(0)).join(', ')}`,
  );
});

test('the boundary orients along whichever way the members lie', () => {
  const horizontal = enclosingEllipse([tile('a', -200, 0), tile('b', 200, 0)], 40);
  const vertical = enclosingEllipse([tile('a', 0, -200), tile('b', 0, 200)], 40);
  const diagonal = enclosingEllipse([tile('a', -141, -141), tile('b', 141, 141)], 40);

  const degrees = (radians) => ((radians * 180) / Math.PI + 360) % 180;
  assert.ok(Math.abs(degrees(horizontal.angle) - 0) < 2, 'horizontal spread lies flat');
  assert.ok(Math.abs(degrees(vertical.angle) - 90) < 2, 'vertical spread stands up');
  assert.ok(Math.abs(degrees(diagonal.angle) - 45) < 2, 'diagonal spread leans');

  // A lone member has no spread to point along, so it stays a circle.
  const single = enclosingEllipse([tile('a', 0, 0)], 40);
  assert.ok(Math.abs(single.a - single.b) < 1, 'one member gives a circle');
});

test('the drawn path passes through every ring node of a settled ring', () => {
  // Catmull-Rom rather than a B-spline: the ring is where the physics put it,
  // so the drawing must not move it. Each node appears as a curve endpoint.
  //
  // "Settled" is load-bearing since the path became the hull. A ring that has
  // not been deformed is convex, so every node lies on its own hull and this
  // still holds exactly; a dented one drops the nodes in the bite, which is the
  // documented cost and is asserted separately below.
  const { nodes } = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 150, 0)] });
  const path = ringPath(nodes);
  assert.match(path, /^M .* Z$/, 'the path is closed');
  for (const node of nodes) {
    const x = Math.round(node.x * 100) / 100;
    const y = Math.round(node.y * 100) / 100;
    assert.ok(path.includes(`${x} ${y}`), `the path reaches node at ${x} ${y}`);
  }
});

/** Whether any two non-adjacent edges of a closed polygon cross.
 *
 * The property the outline has to hold is "simple closed curve", and that is
 * only meaningful if it is tested directly rather than through a proxy. Proper
 * crossings only: shared endpoints between neighbouring edges are how a closed
 * loop is built, not a self-intersection. */
function selfIntersects(points) {
  const orient = (p, q, r) => Math.sign(((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x)));
  const crosses = (a, b, c, d) => {
    const d1 = orient(a, b, c);
    const d2 = orient(a, b, d);
    const d3 = orient(c, d, a);
    const d4 = orient(c, d, b);
    return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  };
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Adjacent edges share an endpoint by construction, and edge 0 wraps to
      // edge n-1, so neither pair can be a genuine crossing.
      if (j === i || j === (i + 1) % n || i === (j + 1) % n) continue;
      if (crosses(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

test('a tangled ring is still drawn as a simple closed curve', () => {
  // The angles RING-TANGLE.md measured on branch 3 after a single drag: ten
  // nodes whose order around the loop has been destroyed, with five backward
  // jumps and a 317-degree gap between neighbours. Drawn as a chain this is the
  // lens and the angular spikes that were seen on screen.
  //
  // This is the case that can fail. Walking these in ringIndex order self
  // intersects — asserted first, so the test cannot quietly pass against a
  // shape that was never tangled in the first place.
  const measured = [102, 59, 88, 121, 161, 204, 178, 209, 179, 140];
  const nodes = measured.map((degrees, i) => ({
    id: `s1:ring:${i}`,
    ringIndex: i,
    ringCount: measured.length,
    x: Math.cos((degrees * Math.PI) / 180) * 91,
    y: Math.sin((degrees * Math.PI) / 180) * 91,
  }));

  assert.ok(selfIntersects(nodes), 'the reproduced chain really is tangled');
  assert.ok(!selfIntersects(ringHull(nodes)), 'the hull drawn from it is not');

  const path = ringPath(nodes);
  assert.match(path, /^M .* Z$/, 'and it is still a closed path');
});

test('the hull survives a ring flung into spikes', () => {
  // Problem 4: under heavy dragging the outline tears into angular spikes and
  // lobes with a pinched neck. A hull cannot express any of those, by
  // construction rather than by tuning, so radius no longer has to be bounded
  // for the drawing to stay sane.
  const nodes = Array.from({ length: 24 }, (unused, i) => {
    const angle = (2 * Math.PI * i) / 24;
    const radius = i % 2 === 0 ? 60 : 280;
    return { id: `s1:ring:${i}`, ringIndex: i, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

  const hull = ringHull(nodes);
  assert.ok(!selfIntersects(hull), 'no self-intersections');
  assert.ok(hull.length <= 12, `the spikes collapse to a few corners, got ${hull.length}`);
  for (const point of hull) {
    // Every surviving point is one of the long spikes: the short ones are
    // interior and a hull cannot dip back in to reach them.
    assert.ok(Math.hypot(point.x, point.y) > 270, 'the hull rides the outer radius');
  }
});

test('containment and drawing agree about who is inside', () => {
  // The fault that retired the geometry branch was the drawn shape and the
  // hit-tested shape being two different things. Whatever the chain does, a
  // point inside the hull must read as inside — including one in a bay that the
  // tangled chain would have reported as outside.
  const nodes = [102, 59, 88, 121, 161, 204, 178, 209, 179, 140].map((degrees, i) => ({
    id: `s1:ring:${i}`,
    ringIndex: i,
    x: Math.cos((degrees * Math.PI) / 180) * 91,
    y: Math.sin((degrees * Math.PI) / 180) * 91,
  }));

  // Those ten angles span only 150 degrees, so the ring really has collapsed to
  // the crescent RING-TANGLE.md describes as "a flat lens" — it encloses no
  // area around the member, and the origin is legitimately outside it. The hull
  // reports that rather than inventing area the nodes do not enclose, and this
  // is asserted so the geometry is not silently mistaken for a bug later.
  assert.ok(!pointInsideRing({ x: 0, y: 0 }, nodes), 'a collapsed ring encloses nothing');

  // A point genuinely within the crescent must read as inside, though — that is
  // the agreement being tested, and a hull that reported everything as outside
  // would pass the assertion above for the wrong reason.
  const interior = { x: Math.cos((140 * Math.PI) / 180) * 85, y: Math.sin((140 * Math.PI) / 180) * 85 };
  assert.ok(pointInsideRing(interior, nodes), 'a point within the crescent is inside');
  assert.ok(!pointInsideRing({ x: 400, y: 400 }, nodes), 'a distant point is not');

  // An ejected item must land outside the curve that is drawn, not outside some
  // other polygon the user cannot see.
  const target = ejectionTarget(interior, nodes);
  assert.ok(target, 'an enclosed point is given somewhere to go');
  assert.ok(!pointInsideRing(target, nodes), 'and it lands outside the drawn shape');
});

test('an outline never dips inside the items it is drawn around', () => {
  // The floor is the members' own tiles: an outline smaller than its members
  // states something false about the set. Every way a ring can degenerate has
  // to still enclose every corner of every member tile.
  const members = [tile('a', 0, 0), tile('b', 40, 20)];
  const floor = memberFloorHull(members, 40);

  const degenerate = {
    'wholly collapsed': Array.from({ length: 48 }, () => ({ x: 20, y: 10 })),
    // Samples spanning only 124 degrees. This is the case that defeated radial
    // projection: over half the circle has no sample to push outward.
    sliver: resampleHull(ringHull([{ x: -30, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 1 }])),
    // The flat lens RING-TANGLE.md measured, which encloses no area at all.
    crescent: resampleHull(ringHull([102, 59, 88, 121, 161, 204, 178, 209, 179, 140]
      .map((degrees) => ({
        x: Math.cos((degrees * Math.PI) / 180) * 91,
        y: Math.sin((degrees * Math.PI) / 180) * 91,
      })))),
  };

  for (const [name, points] of Object.entries(degenerate)) {
    const held = floorOutline(points, floor);
    const indexed = held.map((point, i) => ({ ...point, ringIndex: i }));
    for (const member of members) {
      for (const [dx, dy] of [[-36, -36], [36, -36], [36, 36], [-36, 36]]) {
        const corner = { x: member.x + dx, y: member.y + dy };
        assert.ok(pointInsideRing(corner, indexed),
          `${name}: member corner ${JSON.stringify(corner)} fell outside the outline`);
      }
    }
    assert.ok(!selfIntersects(held), `${name}: the held outline is still simple`);
  }
});

test('the floor lifts a collapsed outline without inflating a healthy one', () => {
  // A floor, not a target. A set that is genuinely large must pass through
  // untouched, or every outline would be dragged towards the same size.
  const floor = memberFloorHull([tile('a', 0, 0)], 40);

  const large = resampleHull(ringHull(Array.from({ length: 20 }, (unused, i) => ({
    x: Math.cos((i * Math.PI) / 10) * 400,
    y: Math.sin((i * Math.PI) / 10) * 400,
  }))));
  const untouched = floorOutline(large, floor);
  // Resampling round-off only, well under a tenth of a percent.
  assert.ok(Math.abs(outlineArea(untouched) - outlineArea(large)) / outlineArea(large) < 0.001,
    'a large outline keeps its size');

  const collapsed = Array.from({ length: 48 }, () => ({ x: 0, y: 0 }));
  assert.ok(outlineArea(floorOutline(collapsed, floor)) > outlineArea(floor) * 0.95,
    'a collapsed one is lifted to the floor');
});

test('the drawn outline eases towards the physics rather than snapping to it', () => {
  // The hull guarantees the outline is simple; it says nothing about it being
  // steady. Without easing, a ring that collapses between two frames takes the
  // drawn shape with it, which reads as the set popping.
  const from = resampleHull(ringHull(Array.from({ length: 16 }, (unused, i) => ({
    x: Math.cos((i * Math.PI) / 8) * 300,
    y: Math.sin((i * Math.PI) / 8) * 300,
  }))));
  const to = resampleHull(ringHull(Array.from({ length: 16 }, (unused, i) => ({
    x: Math.cos((i * Math.PI) / 8) * 60,
    y: Math.sin((i * Math.PI) / 8) * 60,
  }))));

  const stepped = easeOutline(from, to);
  const before = outlineArea(from);
  const after = outlineArea(stepped);
  assert.ok(after < before, 'it moves towards the target');
  assert.ok(after > outlineArea(to), 'but does not arrive in one frame');

  // And it does arrive, rather than easing forever towards something it never
  // reaches — a boundary that never settles would read as permanently adrift.
  let current = from;
  for (let frame = 0; frame < 120; frame += 1) current = easeOutline(current, to);
  assert.ok(Math.abs(outlineArea(current) - outlineArea(to)) / outlineArea(to) < 0.01,
    'and settles on the target');
});

test('a vanished ring holds its last shape rather than blanking', () => {
  // A null target means the physics has nothing to draw this frame. Returning
  // an empty path would make the outline disappear between two frames, which is
  // exactly the abrupt vanishing this is meant to prevent; the caller decides
  // when a set is really gone, and fades it.
  const last = resampleHull(ringHull([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]));
  assert.deepEqual(easeOutline(last, null), last, 'the last good shape stands');
  assert.equal(easeOutline(null, null), null, 'and nothing is invented from nothing');
});

test('a settled scene stops moving instead of pumping itself apart', () => {
  // forceRingShape floors its alpha so it never cools, which is what keeps a
  // ring with a member being dragged. But d3 cools every other force, so on a
  // settled scene it became the only one still injecting velocity — and ring
  // nodes collide with icons at strength 0.9, so it drove them, they moved, the
  // ring chased, and the loop pumped energy with nothing to damp it.
  //
  // Measured before the gate: a set whose members started 10px apart stretched
  // to 7495px over 4000 ticks. The whole force stack is needed to show it, and
  // removing any single force hid it, so this builds the real thing.
  const members = {
    A: [tile('a1', 400, 400), tile('a2', 470, 400), tile('a3', 435, 470),
      tile('a4', 400, 330), tile('a5', 500, 340), tile('a6', 360, 430)],
    B: [tile('b1', 700, 420), tile('b2', 760, 430)],
  };
  const setOf = new Map();
  for (const [setId, list] of Object.entries(members)) {
    for (const member of list) setOf.set(member.id, [setId]);
  }
  const all = [...members.A, ...members.B];
  const membersOf = (setId) => members[setId] ?? [];

  const rings = new Map(Object.keys(members).map((setId) => (
    [setId, reconcileRing({ setId, members: membersOf(setId) })])));
  const ringNodes = [...rings.values()].flatMap((ring) => ring.nodes);
  const ringLinks = [...rings.values()].flatMap((ring) => ring.links);

  const simulation = forceSimulation([...all, ...ringNodes]).alpha(1).stop()
    .force('cx', forceX(600).strength(0.05))
    .force('cy', forceY(400).strength(0.05))
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide()
      .radius((n) => (n.ring ? 30 : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', forceLink(ringLinks).id((n) => n.id)
      .distance((l) => (l.source.ring ? 60 : 145))
      .strength((l) => (l.source.ring ? 0.9 : 0.14)))
    // Nothing is ever held here, so the gate must let this force cool.
    .force('ring', forceRingShape({ membersOf, isDragging: () => false }))
    .force('setGravity', forceSetGravity({ setsOf: (id) => setOf.get(id) ?? [] }))
    .force('setExclusion', forceSetExclusion({
      setsOf: (id) => setOf.get(id) ?? [],
      membersOf,
      hullOf: (setId) => rings.get(setId)?.nodes ?? null,
    }));

  const spreadOf = (list) => Math.max(...list.map((n) => n.y)) - Math.min(...list.map((n) => n.y));
  for (let i = 0; i < 600; i += 1) simulation.tick();
  const early = { A: spreadOf(members.A), B: spreadOf(members.B) };
  for (let i = 0; i < 3400; i += 1) simulation.tick();
  const late = { A: spreadOf(members.A), B: spreadOf(members.B) };

  // The test that can fail: a cold scene must not keep growing. Ungated, B went
  // from 427 at 600 ticks to 7495 at 4000.
  for (const setId of ['A', 'B']) {
    assert.ok(late[setId] < early[setId] + 50,
      `set ${setId} grew from ${early[setId].toFixed(0)} to ${late[setId].toFixed(0)} while nothing was moving`);
    assert.ok(Number.isFinite(late[setId]) && late[setId] < 1500,
      `set ${setId} ended ${late[setId].toFixed(0)}px tall, which is a runaway`);
  }
});

test('too few nodes yields no path rather than a degenerate one', () => {
  assert.equal(ringPath([]), '');
  assert.equal(ringPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), '');
});

test('ring nodes stay affordable at realistic scale', () => {
  // The previous approach cost 87.8ms to rebuild a two-set scene, which is five
  // frames. This has to stay far under one, because the ring is simulated every
  // tick rather than rebuilt occasionally — so the ceiling is guarded here
  // rather than discovered on a machine with its fans running.
  let total = 0;
  for (let s = 0; s < 8; s += 1) {
    const members = [tile(`a${s}`, s * 200, 0), tile(`b${s}`, s * 200, 180), tile(`c${s}`, s * 200 + 160, 90)];
    total += reconcileRing({ setId: `s${s}`, members }).nodes.length;
  }
  assert.ok(total < 200, `8 sets need ${total} ring nodes, which the simulation can carry`);
});

// ===========================================================================
// Containment. The architecture's headline claim is that a member cannot leave
// and an outsider cannot get in "for the same reason a node cannot walk through
// another node". That is true of nodes the simulation is free to move, and
// measurably NOT true of a node the user is dragging — so it is worth stating
// exactly which of the two the code delivers.
// ===========================================================================

/** Runs the app's own force configuration over members plus a ring. */
function settle(members, extra = [], links = [], ticks = 200) {
  const nodes = [...members, ...extra];
  const simulation = forceSimulation(nodes).alpha(1).stop()
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide()
      // 36 matches RING_NODE_RADIUS in the app: half a tile, so a ring node is
      // as substantial as the thing it resists. At 18 a pinned foreign tile
      // pushed through.
      .radius((n) => (n.ring ? 30 : Math.max(n.width, n.height) / 2 + 20))
      .strength(0.9))
    .force('link', forceLink(links).id((d) => d.id)
      .distance((l) => (l.source.ring ? 60 : 145))
      .strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', forceRingShape({ membersOf: () => members }));
  for (let i = 0; i < ticks; i += 1) simulation.tick();
  return simulation;
}

/** Ray casting against the ring in loop order. Ordering by ringIndex matters:
 * the node array is not the polygon unless it is walked around the loop. */
function insideRing(ringNodes, point) {
  const loop = [...ringNodes].sort((a, b) => a.ringIndex - b.ringIndex);
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const a = loop[i];
    const b = loop[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

test('the ring encloses its own members once settled', () => {
  const members = [tile('a', 0, 0), tile('b', 140, 0), tile('c', 70, 120)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 300);
  for (const member of members) {
    assert.ok(insideRing(ring, member), `member ${member.id} ended up outside its own set`);
  }
});

/** Pulls an outsider towards the set centre with the given per-tick strength,
 * and reports whether it ended up inside the ring. */
function pullInside(pull, ticks = 400) {
  const members = [tile('a', 0, 0), tile('b', 140, 0)];
  const outsider = tile('out', 700, 0);
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, [outsider, ...ring], links, 200);
  for (let i = 0; i < ticks; i += 1) {
    outsider.vx += (70 - outsider.x) * pull;
    outsider.vy += (0 - outsider.y) * pull;
    simulation.tick();
  }
  return insideRing(ring, outsider);
}

test('the ring holds an outsider out however hard it is pushed', () => {
  // With the earlier radial force this was only resistance: a drift was held
  // out and anything firmer than about 0.005 per tick went through. Pulling
  // each node to its own slot keeps the boundary in shape under load, so it
  // now holds across two orders of magnitude of push.
  assert.equal(pullInside(0.001), false, 'a gentle drift is held out');
  assert.equal(pullInside(0.01), false, 'and so is a firm push');
  assert.equal(pullInside(0.05), false, 'and a very hard one');
});


test('the ring follows a member that is dragged away', () => {
  // The fault that retired the previous branch: the outline stayed behind and
  // collapsed into a flat lens.
  //
  // The drag has to be simulated the way pointer-controller performs one —
  // many small steps, each pinning fx/fy and reheating to 0.12 — because that
  // is what exposes it. A single large jump does NOT reproduce the fault, and
  // an earlier version of this test used one, passed against the broken code,
  // and led to a wrong diagnosis.
  const member = tile('me', 0, 0);
  const members = [member];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, ring, links, 400);

  const spread = () => {
    const xs = ring.map((n) => n.x);
    const ys = ring.map((n) => n.y);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const settledSize = spread();

  for (let x = 0; x <= 400; x += 20) {
    member.fx = x;
    member.fy = -x * 0.75;
    member.x = x;
    member.y = -x * 0.75;
    simulation.alpha(0.12);
    for (let i = 0; i < 3; i += 1) simulation.tick();
  }

  const cx = ring.reduce((total, n) => total + n.x, 0) / ring.length;
  const cy = ring.reduce((total, n) => total + n.y, 0) / ring.length;
  const lag = Math.hypot(member.x - cx, member.y - cy);
  // 205px with the original force, 42 with this one. The threshold is set to
  // catch a regression towards the old behaviour, not to pin the exact figure.
  assert.ok(lag < 90, `the ring trailed ${lag.toFixed(0)}px behind its member`);

  // And it must not shrink on the way. Collapsing is what produced the lens:
  // the original force left it at 120x97 from a settled 183x174.
  const dragged = spread();
  assert.ok(
    dragged.w > settledSize.w * 0.8 && dragged.h > settledSize.h * 0.8,
    `the ring collapsed from ${settledSize.w.toFixed(0)}x${settledSize.h.toFixed(0)} `
    + `to ${dragged.w.toFixed(0)}x${dragged.h.toFixed(0)}`,
  );
});


test('a member is still enclosed while a foreign item presses on the wall', () => {
  // The other half: keeping an outsider out must not cost the set its own
  // members. A boundary that solved exclusion by shrinking away would pass the
  // test above and be useless.
  const members = [tile('a', 0, 0), tile('b', 0, 150)];
  const foreign = tile('f', 120, 75);
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, [foreign, ...ring], links, 300);

  // Both fx/fy and x/y, which is what pointer-controller sets on a drag. Pinning
  // fx alone leaves the node's current position to be resolved on the next
  // tick, and the ring gets a free tick to react that a real drag never gives
  // it — an earlier version of these tests did that and measured a boundary
  // more permeable than the app's.
  foreign.fx = 120;
  foreign.fy = 75;
  foreign.x = 120;
  foreign.y = 75;
  for (let i = 0; i < 200; i += 1) simulation.tick();

  for (const member of members) {
    assert.ok(insideRing(ring, member), `member ${member.id} was pushed out of its own set`);
  }
  assert.ok(!insideRing(ring, foreign), 'and the foreign item is still outside');
});

// ===========================================================================
// Ejection. The ring cannot win an argument with a drag — a dragged node has
// its position set outright, so collision has nothing to push back against.
// Stiffening the boundary enough to resist one made the whole set convulse and
// foreign items still got in. So the drag is left alone and the trespasser is
// moved out once the gesture is over.
// ===========================================================================

test('a trespasser is put down just outside the boundary', () => {
  const members = [tile('a', 0, 0), tile('b', 0, 200)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 400);

  // Several places inside, including right on top of a member.
  for (const point of [{ x: 0, y: 100 }, { x: 0, y: 0 }, { x: -60, y: 180 }]) {
    assert.ok(pointInsideRing(point, ring), 'the test point starts inside');
    const target = ejectionTarget(point, ring);
    assert.ok(target, 'an inside point gets somewhere to go');
    assert.ok(!pointInsideRing(target, ring), `ejecting from ${JSON.stringify(point)} left it inside`);
  }
});

test('an item already outside is left exactly where it is', () => {
  // Returning a target for everything would nudge settled layouts on every
  // tick, which is its own kind of convulsing.
  const members = [tile('a', 0, 0), tile('b', 0, 200)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 400);
  assert.equal(ejectionTarget({ x: 400, y: 100 }, ring), null);
});

test('ejection takes the shortest way out, not the way through the middle', () => {
  // From the waist of a long thin set the near edge is sideways; pushing away
  // from a centre would drag the item the whole length of the boundary.
  //
  // The ring is built by hand rather than settled, because two members left to
  // the simulation do not stay in a line — charge pushes them apart and the
  // boundary comes out nearly round, where "sideways" means nothing. This is
  // about the geometry, so the geometry is what is supplied.
  const ring = [];
  const count = 40;
  for (let i = 0; i < count; i += 1) {
    const t = (2 * Math.PI * i) / count;
    ring.push({ ringIndex: i, ringCount: count, x: Math.cos(t) * 600, y: Math.sin(t) * 80 });
  }

  const target = ejectionTarget({ x: 0, y: 0 }, ring);
  assert.ok(target, 'the waist is inside');
  assert.ok(
    Math.abs(target.y) > Math.abs(target.x),
    `ejected the long way, to (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`,
  );
  assert.ok(!pointInsideRing(target, ring), 'and it landed outside');
});

test('a degenerate ring cannot eject anything', () => {
  assert.equal(ejectionTarget({ x: 0, y: 0 }, []), null);
  assert.equal(ejectionTarget({ x: 0, y: 0 }, [{ x: 0, y: 0, ringIndex: 0 }]), null);
});

// ===========================================================================
// The speed limit. Dragging several foreign items through a set compounds:
// each pushes the members, the members pull the ring, and the sum explodes
// even though no single force is wrong.
// ===========================================================================

test('a node moving faster than the cap is slowed to it', () => {
  const fast = { id: 'a', vx: 100, vy: 0 };
  const force = forceSpeedLimit({ maxPerTick: 8 });
  force.initialize([fast]);
  force(1);
  assert.equal(Math.hypot(fast.vx, fast.vy).toFixed(2), '8.00');
  assert.ok(fast.vx > 0, 'and keeps its direction');
});

test('a node already within the cap is untouched', () => {
  // A governor that rescaled everything would drag the whole layout towards a
  // uniform speed, which is its own kind of wrongness.
  const slow = { id: 'a', vx: 2, vy: 1 };
  const force = forceSpeedLimit({ maxPerTick: 8 });
  force.initialize([slow]);
  force(1);
  assert.equal(slow.vx, 2);
  assert.equal(slow.vy, 1);
});

test('direction survives the cap exactly', () => {
  const node = { id: 'a', vx: 30, vy: 40 };
  const before = Math.atan2(node.vy, node.vx);
  const force = forceSpeedLimit({ maxPerTick: 5 });
  force.initialize([node]);
  force(1);
  assert.ok(
    Math.abs(Math.atan2(node.vy, node.vx) - before) < 1e-9,
    'a cap must slow a node, never steer it',
  );
});

test('the cap tames several items dragged through a set at once', () => {
  // The reproduction: four foreign items swept through a set on pinned
  // positions. Uncapped this reached 164px in a single tick.
  const members = [tile('a', 0, -150), tile('b', 20, 0), tile('c', -10, 150)];
  const foreign = [tile('f1', -200, -60), tile('f2', 180, 40), tile('f3', -160, 180), tile('f4', 150, -180)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });

  const simulation = forceSimulation([...members, ...foreign, ...ring]).alpha(1).stop()
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide()
      .radius((n) => (n.ring ? 30 : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', forceLink(links).id((d) => d.id)
      .distance((l) => (l.source.ring ? 60 : 145))
      .strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', forceRingShape({ membersOf: () => members }))
    // The exclusion force has to be here: it is what makes the drag compound,
    // because each foreign item shoves the members and the members drag the
    // ring. An earlier version of this test left it out, measured a peak of
    // 7.8px that was already under the cap, and so passed with the cap
    // disabled — proving nothing at all.
    .force('setExclusion', forceSetExclusion({
      setsOf: (id) => (members.some((m) => m.id === id) ? ['s1'] : []),
      membersOf: () => members,
      isHeld: (id) => foreign.some((f) => f.id === id),
    }))
    .force('speedLimit', forceSpeedLimit());
  for (let i = 0; i < 400; i += 1) simulation.tick();

  let peak = 0;
  for (let step = 0; step < 40; step += 1) {
    const before = ring.map((n) => ({ x: n.x, y: n.y }));
    foreign.forEach((item, i) => {
      const angle = (step * 0.3) + (i * 1.6);
      item.fx = Math.cos(angle) * 160;
      item.fy = Math.sin(angle) * 160;
      item.x = item.fx;
      item.y = item.fy;
    });
    simulation.alpha(0.12);
    for (let i = 0; i < 3; i += 1) simulation.tick();
    for (let i = 0; i < ring.length; i += 1) {
      peak = Math.max(peak, Math.hypot(ring[i].x - before[i].x, ring[i].y - before[i].y));
    }
  }
  // Three ticks per step, so the ceiling is three times the per-tick cap.
  assert.ok(peak < 30, `the ring still lurched ${peak.toFixed(0)}px in one step`);
});

test('the ellipse encloses every member, including outliers', () => {
  // Covariance describes the *typical* spread — it is a standard deviation, so
  // a member further out than average falls outside the ellipse it defines.
  // Measured on a seven-member set after a folder was expanded, one member sat
  // at 1.09 in ellipse units and another at 0.99: outside its own set,
  // permanently, which is what was seen on screen.
  const layouts = [
    [tile('a', 0, 0), tile('b', 140, 0)],
    [tile('a', -150, -150), tile('b', 150, 150)],
    [tile('Letters', 0, -60), tile('Real', 150, 120), tile('Me', 30, 40),
      tile('PDF', -90, 80), tile('Apps', -160, -90), tile('SKP', -110, -10), tile('Run', -20, -200)],
  ];

  for (const members of layouts) {
    const ellipse = enclosingEllipse(members, 40);
    const cos = Math.cos(-ellipse.angle);
    const sin = Math.sin(-ellipse.angle);
    for (const member of members) {
      const dx = member.x - ellipse.x;
      const dy = member.y - ellipse.y;
      const units = Math.hypot(
        ((dx * cos) - (dy * sin)) / ellipse.a,
        ((dx * sin) + (dy * cos)) / ellipse.b,
      );
      assert.ok(units <= 1, `${member.id} sits at ${units.toFixed(2)}, outside its own set`);
    }
  }
});

test('growing to fit does not inflate the boundary all round', () => {
  // Scaling both axes by the worst overshoot makes a set that only needed to
  // reach further one way swell in every direction, and a boundary bigger than
  // its contents is what lets bystanders sit inside it. Two members 140px apart
  // came out 455x257 that way.
  const ellipse = enclosingEllipse([tile('a', 0, 0), tile('b', 140, 0)], 40);
  assert.ok(2 * ellipse.b < 200, `the short axis grew to ${(2 * ellipse.b).toFixed(0)}`);
  assert.ok(2 * ellipse.a > 2 * ellipse.b, 'and the long axis is still the long one');
});

// ===========================================================================
// The coordinated, allowed-region-aware hull escape. A foreign item inside
// several overlapping set hulls must receive ONE direction that leaves ALL of
// them — the old route of one centre-away push per set cancels in the Venn
// lens — and the direction must also preserve the item's own allowed region:
// an A-only item in the lens must leave B without being flung out of A. The
// helper is the geometry: among the directions whose endpoint is outside every
// forbidden hull and inside every allowed hull, the one with the smallest
// ray-polygon exit distance.
// ===========================================================================

function rect(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function contains(hull, point) {
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

// The margin shortestValidEscape puts between its landing and the boundary it
// leaves, so the item is strictly outside the forbidden region rather than
// resting on its outline (where the boundary-inclusive containment predicate
// still reads it as inside). Mirrors the helper's own default.
const ESCAPE_CLEARANCE = 0.5;

test('the coordinated escape leaves every hull along the shortest route', () => {
  // Two overlapping squares — the Venn lens. A point inside both must leave
  // both: the union spans x [0,160] and y [0,100], so the shortest exit is
  // vertical (50px) rather than horizontal (80px), and the direction must
  // actually clear both hulls.
  const A = rect(0, 0, 100, 100);
  const B = rect(60, 0, 160, 100);
  const point = { x: 80, y: 50 };
  const escape = shortestValidEscape(point, [A, B]);
  assert.ok(escape, 'an escape exists for an interior point');
  assert.ok(Math.abs(escape.y) > 0.99, `the shortest exit is vertical, got (${escape.x.toFixed(2)},${escape.y.toFixed(2)})`);
  assert.ok(Math.abs(escape.x) < 0.01, 'no horizontal drift in the vertical escape');
  // The boundary is 50px away; the escape lands ESCAPE_CLEARANCE past it so the
  // item is strictly outside rather than resting on the outline it is leaving.
  assert.ok(
    Math.abs(escape.distance - (50 + ESCAPE_CLEARANCE)) < 1e-6,
    `the exit clears the union's nearest boundary (${escape.distance.toFixed(1)})`,
  );
  assert.ok(!contains(A, escape.target), 'the target is strictly outside A');
  assert.ok(!contains(B, escape.target), 'the target is strictly outside B');
});

test('the escape distance is the actual ray crossing, not the support-plane distance', () => {
  // From the centre of a 100x100 square the support-plane distance along a
  // diagonal direction (0.8,0.6) reports 70, while the ray actually exits
  // through x=100 at t=62.5. The exported crossing must report the ray
  // distance; the escape's travel is built from it.
  const A = rect(0, 0, 100, 100);
  const crossing = rayExitDistance(A, { x: 50, y: 50 }, { x: 0.8, y: 0.6 });
  assert.ok(Math.abs(crossing - 62.5) < 1e-6, `the ray exits at 62.5, got ${crossing.toFixed(3)}`);
  // The shortest escape from the centre is 50 along a normal — the perpendicular
  // distance, where the ray crossing and the support distance agree.
  const escape = shortestValidEscape({ x: 50, y: 50 }, [A]);
  assert.ok(
    Math.abs(escape.distance - (50 + ESCAPE_CLEARANCE)) < 1e-6,
    `the normal exit is 50 plus the clearance (${escape.distance.toFixed(1)})`,
  );
});

test('the shortest exit is rejected when it would leave the item\'s allowed hull', () => {
  // The adverse A/B rectangles: A spans x=[0,100], B spans x=[10,110], with
  // the y axis shared, and an A-only item sits at x=95 in the lens. The
  // unconstrained shortest way out of B is rightward to x=110 — which is
  // outside A. The valid escape must go leftward through B's x=10 boundary,
  // which is still inside A: the route that preserves the allowed membership
  // is longer, and it is the one the helper must pick.
  const A = rect(0, 0, 100, 100);
  const B = rect(10, 0, 110, 100);
  const point = { x: 95, y: 50 };
  const escape = shortestValidEscape(point, [B], [A]);
  assert.ok(escape, 'an escape exists');
  assert.ok(escape.x < -0.99, `the valid escape is leftward through x=10, got (${escape.x.toFixed(2)},${escape.y.toFixed(2)})`);
  assert.ok(Math.abs(escape.y) < 0.01, 'no vertical drift');
  assert.ok(
    Math.abs(escape.distance - (85 + ESCAPE_CLEARANCE)) < 1e-6,
    `the route clears B's left boundary (${escape.distance.toFixed(1)})`,
  );
  // The landing itself — not an extrapolation past it — must be strictly
  // outside the forbidden hull and strictly inside the allowed one. The
  // previous form spent all the room and stopped ON A's boundary, which the
  // product predicate reads as outside A.
  assert.ok(!contains(B, escape.target), 'the target is outside the forbidden hull');
  assert.ok(contains(A, escape.target), 'and inside the allowed hull');
  assert.ok(escape.target.x > 0, `strictly inside A (x=${escape.target.x.toFixed(2)})`);
  assert.ok(escape.target.x < 10, `strictly outside B (x=${escape.target.x.toFixed(2)})`);
});

test('the allowed-region-aware escape mirrors across the shared axis', () => {
  // The mirror of the adverse scene: B shifted left of A, the item near A's
  // left side. The unconstrained shortest exit from B is leftward to x=-10 —
  // outside A; the valid escape goes rightward through B's x=90 boundary.
  const A = rect(0, 0, 100, 100);
  const B = rect(-10, 0, 90, 100);
  const point = { x: 5, y: 50 };
  const escape = shortestValidEscape(point, [B], [A]);
  assert.ok(escape, 'an escape exists');
  assert.ok(escape.x > 0.99, `the valid escape is rightward, got (${escape.x.toFixed(2)},${escape.y.toFixed(2)})`);
  assert.ok(
    Math.abs(escape.distance - (85 + ESCAPE_CLEARANCE)) < 1e-6,
    `the route clears B's right boundary (${escape.distance.toFixed(1)})`,
  );
  assert.ok(!contains(B, escape.target), 'the target is outside the forbidden hull');
  assert.ok(contains(A, escape.target), 'and inside the allowed hull');
});

test('the allowed-region-aware escape rotates with the scene', () => {
  // The same adverse geometry rotated 90 degrees: B spans y=[10,110] with the
  // x axis shared, the item at y=95. The shortest exit (down through y=110)
  // leaves A; the valid escape goes up through B's y=10 boundary.
  const A = rect(0, 0, 100, 100);
  const B = rect(0, 10, 100, 110);
  const point = { x: 50, y: 95 };
  const escape = shortestValidEscape(point, [B], [A]);
  assert.ok(escape, 'an escape exists');
  assert.ok(escape.y < -0.99, `the valid escape is upward, got (${escape.x.toFixed(2)},${escape.y.toFixed(2)})`);
  assert.ok(
    Math.abs(escape.distance - (85 + ESCAPE_CLEARANCE)) < 1e-6,
    `the route clears B's bottom boundary (${escape.distance.toFixed(1)})`,
  );
  assert.ok(!contains(B, escape.target), 'the target is outside the forbidden hull');
  assert.ok(contains(A, escape.target), 'and inside the allowed hull');
});

test('the escape matches a dense angular oracle and lands at a valid endpoint', () => {
  // The production picks among a sparse candidate set (nearest exits plus edge
  // normals). The oracle here sweeps every 0.5 degree with its own
  // ray-crossing implementation and the same endpoint validity rule, so the
  // production's result is verified against an independent dense reference,
  // not against its own candidate set or formula.
  const scenes = [
    { forbidden: [rect(0, 0, 100, 100), rect(60, 0, 160, 100)], allowed: [], point: { x: 80, y: 50 } },
    { forbidden: [rect(10, 0, 110, 100)], allowed: [rect(0, 0, 100, 100)], point: { x: 95, y: 50 } },
    { forbidden: [rect(-10, 0, 90, 100)], allowed: [rect(0, 0, 100, 100)], point: { x: 5, y: 50 } },
    { forbidden: [rect(0, 10, 100, 110)], allowed: [rect(0, 0, 100, 100)], point: { x: 50, y: 95 } },
    // a rotated pentagon, with no allowed hull
    {
      forbidden: [[
        { x: 0, y: 40 }, { x: 38, y: 12 }, { x: 81, y: 24 }, { x: 95, y: 66 }, { x: 55, y: 100 },
      ]],
      allowed: [],
      point: { x: 50, y: 55 },
    },
  ];
  const oracleBest = (point, forbidden, allowed) => {
    let best = Infinity;
    const steps = 720;
    for (let i = 0; i < steps; i += 1) {
      const angle = (2 * Math.PI * i) / steps;
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      let exit = 0;
      for (const hull of forbidden) {
        let far = 0;
        for (let e = 0; e < hull.length; e += 1) {
          const a = hull[e];
          const b = hull[(e + 1) % hull.length];
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const denom = u.x * ey - u.y * ex;
          if (Math.abs(denom) < 1e-12) continue;
          const t = ((a.x - point.x) * ey - (a.y - point.y) * ex) / denom;
          if (t <= 1e-9) continue;
          const s = ((a.x - point.x) * u.y - (a.y - point.y) * u.x) / denom;
          if (s < -1e-9 || s > 1 + 1e-9) continue;
          if (t > far) far = t;
        }
        if (far > exit) exit = far;
      }
      const endpoint = {
        x: point.x + u.x * (exit + 1e-6),
        y: point.y + u.y * (exit + 1e-6),
      };
      if (allowed.some((h) => !contains(h, endpoint))) continue;
      if (forbidden.some((h) => contains(h, endpoint))) continue;
      if (exit < best) best = exit;
    }
    return best;
  };
  for (const scene of scenes) {
    const production = shortestValidEscape(scene.point, scene.forbidden, scene.allowed);
    assert.ok(production, `an escape exists for the scene at (${scene.point.x},${scene.point.y})`);
    const oracle = oracleBest(scene.point, scene.forbidden, scene.allowed);
    assert.ok(Number.isFinite(oracle), 'the oracle finds a valid route');
    // Like for like: the oracle measures to the boundary, production lands
    // ESCAPE_CLEARANCE past it. The production may be NEARER than the oracle by
    // up to the oracle's angular resolution, which the sweep cannot represent.
    assert.ok(
      production.distance - (oracle + ESCAPE_CLEARANCE) < 1e-6,
      `the production is no worse than the oracle (${production.distance.toFixed(3)} vs ${(oracle + ESCAPE_CLEARANCE).toFixed(3)})`,
    );
    // The landing itself is what must be valid, not a point extrapolated past
    // it: the response stops the item at this target.
    for (const hull of scene.forbidden) {
      assert.ok(!contains(hull, production.target), 'the target is outside every forbidden hull');
    }
    for (const hull of scene.allowed) {
      assert.ok(contains(hull, production.target), 'the target is inside every allowed hull');
    }
  }
});

test('the escape beats every edge normal and nearest-exit direction', () => {
  // The BRAIN's stress-audit counterexample, preserved verbatim. Both
  // quadrilaterals contain the origin. A candidate list of nearest-exit
  // directions plus edge normals — the previous implementation — answers
  // 92.43px here, while a minimax compromise direction BETWEEN the two hulls
  // gets out in 40.17px: 2.3012x shorter. The optimum for a union of convex
  // hulls simply is not spanned by the individual hulls' normals, which is why
  // the helper computes the nearest valid point on the exposed boundary
  // instead of sampling directions.
  const F1 = [
    { x: -29.045878924563322, y: -114.75461551837921 },
    { x: 82.43126664711511, y: 60.16785006713818 },
    { x: 24.58717318823913, y: 97.03157940797806 },
    { x: -86.8899723834393, y: -77.89088617753933 },
  ];
  const F2 = [
    { x: 102.28857427600677, y: -57.183630216717376 },
    { x: 123.78578655365956, y: 12.508139656843014 },
    { x: -84.11584030602035, y: 76.63774080745841 },
    { x: -105.61305258367314, y: 6.945970933898025 },
  ];
  const escape = shortestValidEscape({ x: 0, y: 0 }, [F1, F2]);
  assert.ok(escape, 'an escape exists');
  // The old candidate-sampling answer was 92.43; the true optimum is 40.17.
  // Allowing the clearance margin on top, anything near 92 is the old defect.
  assert.ok(
    escape.distance < 42,
    `the escape takes the compromise direction, not a hull normal (${escape.distance.toFixed(2)})`,
  );
  assert.ok(!contains(F1, escape.target), 'the target is outside the first hull');
  assert.ok(!contains(F2, escape.target), 'and outside the second');
});

test('the escape matches a dense oracle across seeded rotated-hull scenes', () => {
  // One favourable scene proves nothing about a general claim, so this sweeps
  // seeded rotated rectangle pairs and compares every answer against an
  // independent dense angular reference. The oracle is written separately here
  // — it binary-searches the smallest travel that lands outside every forbidden
  // hull — so the production formula is never its own judge.
  const mulberry = (seed) => {
    let a = seed >>> 0;
    return () => {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const rotatedRect = (rnd) => {
    const cx = (rnd() - 0.5) * 160;
    const cy = (rnd() - 0.5) * 160;
    const w = 60 + rnd() * 120;
    const h = 60 + rnd() * 120;
    const angle = rnd() * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(([x, y]) => ({ x: cx + (x * cos) - (y * sin), y: cy + (x * sin) + (y * cos) }));
  };
  const oracleDistance = (point, forbidden) => {
    let best = Infinity;
    const steps = 2880;
    const clear = (t, u) => {
      const q = { x: point.x + (u.x * t), y: point.y + (u.y * t) };
      return !forbidden.some((hull) => contains(hull, q));
    };
    for (let i = 0; i < steps; i += 1) {
      const angle = (2 * Math.PI * i) / steps;
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      let hi = 1;
      while (hi < 2000 && !clear(hi, u)) hi *= 2;
      if (hi >= 2000) continue;
      let lo = 0;
      for (let k = 0; k < 60; k += 1) {
        const mid = (lo + hi) / 2;
        if (clear(mid, u)) hi = mid; else lo = mid;
      }
      if (hi < best) best = hi;
    }
    return best;
  };

  const rnd = mulberry(20260803);
  let scenes = 0;
  let worstRatio = 0;
  for (let n = 0; n < 120; n += 1) {
    const F1 = rotatedRect(rnd);
    const F2 = rotatedRect(rnd);
    const point = { x: (rnd() - 0.5) * 60, y: (rnd() - 0.5) * 60 };
    const forbidden = [F1, F2];
    if (!forbidden.some((hull) => contains(hull, point))) continue;
    scenes += 1;
    const production = shortestValidEscape(point, forbidden);
    assert.ok(production, `an escape exists for seeded scene ${n}`);
    const oracle = oracleDistance(point, forbidden);
    assert.ok(Number.isFinite(oracle), `the oracle finds a route for scene ${n}`);
    // Production carries the clearance the oracle does not; beyond that it must
    // never be longer than the dense reference.
    const ratio = production.distance / (oracle + ESCAPE_CLEARANCE);
    if (ratio > worstRatio) worstRatio = ratio;
    assert.ok(
      ratio <= 1 + 1e-6,
      `scene ${n}: production ${production.distance.toFixed(3)} vs oracle ${oracle.toFixed(3)}`,
    );
  }
  assert.ok(scenes >= 60, `enough seeded scenes were trespassing (${scenes})`);
  assert.ok(worstRatio <= 1 + 1e-6, `worst ratio across ${scenes} scenes is ${worstRatio.toFixed(6)}`);
});

test('the coordinated escape is null when the point is already outside every hull', () => {
  const A = rect(0, 0, 100, 100);
  assert.equal(shortestValidEscape({ x: 300, y: 300 }, [A]), null);
  assert.equal(shortestValidEscape({ x: 300, y: 300 }, []), null);
  assert.equal(shortestValidEscape({ x: 300, y: 300 }, [A], [A]), null);
});

// ===========================================================================
// The anchored (dragged) ellipse. When a member is dragged away, the set must
// reach toward it without extending the opposite side — a symmetric ellipse
// would sweep the far side outward over whatever sits there. While anchored
// the ellipse is sized per side and shifted toward the outlier; settled, it is
// the symmetric form (the tests above), because a shifted centre following the
// members' own drift would sweep free members.
// ===========================================================================

/** The exact world-space bounding box of a rotated ellipse. The x half-extent
 * is sqrt(a^2 cos^2(theta) + b^2 sin^2(theta)) and the y half-extent is
 * sqrt(a^2 sin^2(theta) + b^2 cos^2(theta)); four axis endpoints alone would
 * underestimate it. */
function ellipseSides(ellipse) {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const hx = Math.sqrt((ellipse.a ** 2) * (cos * cos) + (ellipse.b ** 2) * (sin * sin));
  const hy = Math.sqrt((ellipse.a ** 2) * (sin * sin) + (ellipse.b ** 2) * (cos * cos));
  return {
    minX: ellipse.x - hx, maxX: ellipse.x + hx,
    minY: ellipse.y - hy, maxY: ellipse.y + hy,
  };
}

test('the anchored ellipse reaches the dragged member without extending the opposite side', () => {
  // A compact set with one member dragged 240px right. The anchored ellipse
  // must cover the dragged member (the near side reaches it) while the far
  // side stays at the stationary members' extent — it must not grow backward
  // by the drag distance the way a symmetric ellipse does.
  const members = [
    tile('dragged', 300, 0),
    tile('a', 0, -40), tile('b', 0, 0), tile('c', 0, 40),
  ];
  const anchored = ellipseSides(enclosingEllipse(members, 40, { anchored: true }));
  const symmetric = ellipseSides(enclosingEllipse(members, 40));

  assert.ok(anchored.maxX > 300, `the near side reaches the dragged member (maxX ${anchored.maxX.toFixed(0)})`);
  const dragSweep = anchored.minX - symmetric.minX;
  // The symmetric form sweeps the far side roughly as far left as the drag
  // reaches right; the anchored form keeps the far side at the stationary
  // members' extent, far short of that.
  assert.ok(
    dragSweep > 60,
    `the anchored far side sits ${dragSweep.toFixed(0)}px short of the symmetric sweep`,
  );
});

test('the anchored ellipse still contains every member with its padding', () => {
  // What the ellipse itself guarantees: every member's centre, and its
  // tile-plus-padding extent along each local axis, sit inside the anchored
  // ellipse. (The ellipse's own equation cannot contain the diagonal padded
  // corners — no ellipse centred this way can — so the full-corner claim is
  // tested against the floored drawn outline in the test below.) Several
  // seeded layouts rotate the outlier to different directions, so the rule is
  // not proven by one orientation.
  const layouts = [
    [tile('dragged', 320, 180), tile('a', -50, -40), tile('b', 20, 30), tile('c', -20, 60)],
    [tile('dragged', -320, -180), tile('a', -50, -40), tile('b', 20, 30), tile('c', -20, 60)],
    [tile('dragged', 0, 320), tile('a', -60, -20), tile('b', 40, -30), tile('c', -30, 50)],
    [tile('dragged', 260, -140), tile('a', -70, 10), tile('b', 10, -50), tile('c', -40, 40)],
  ];
  for (const members of layouts) {
    const ellipse = enclosingEllipse(members, 40, { anchored: true });
    const cos = Math.cos(-ellipse.angle);
    const sin = Math.sin(-ellipse.angle);
    for (const member of members) {
      const dx = member.x - ellipse.x;
      const dy = member.y - ellipse.y;
      const centreUnits = Math.hypot(
        ((dx * cos) - (dy * sin)) / ellipse.a,
        ((dx * sin) + (dy * cos)) / ellipse.b,
      );
      assert.ok(centreUnits <= 1 + 1e-6, `${member.id} centre at ${centreUnits.toFixed(3)} units, outside its own set while dragged`);
      // The tile-plus-padding extent along each local axis.
      const localX = (dx * cos) - (dy * sin);
      const localY = (dx * sin) + (dy * cos);
      const half = Math.hypot(member.width ?? 72, member.height ?? 72) / 2;
      assert.ok(Math.abs(localX) + half + 40 <= ellipse.a + 1e-6, `${member.id} padded X extent exceeds the anchored ellipse`);
      assert.ok(Math.abs(localY) + half + 40 <= ellipse.b + 1e-6, `${member.id} padded Y extent exceeds the anchored ellipse`);
    }
  }
});

test('the floored drawn outline keeps member tiles inside and bounds padding loss while anchored', () => {
  // The containment claim the assignment makes is about the visible outline:
  // members, full tile corners plus padding, stay inside it during a drag.
  // The drawn outline is the floored hull (ring nodes unioned with the member
  // floor), and the floor is what carries the diagonal corners — the ellipse
  // alone cannot. Build the real pipeline for the dragged layouts and check
  // every tile corner and padded corner against the floored target with the
  // boundary-inclusive convex margin.
  //
  // The tile corners must be strictly inside: a member's icon must never poke
  // out of its set. The padded corners sit at the outline's extreme, where
  // the drawn polygon's own resolution (the ring nodes spaced by the 60px
  // link distance, plus the resample chords) cuts up to ~8px into the 40px
  // buffer — a measured rendering bound, reported here rather than renamed.
  const RING_RESOLUTION_CUT = 12;
  const layouts = [
    [tile('dragged', 320, 180), tile('a', -50, -40), tile('b', 20, 30), tile('c', -20, 60)],
    [tile('dragged', -320, -180), tile('a', -50, -40), tile('b', 20, 30), tile('c', -20, 60)],
    [tile('dragged', 0, 320), tile('a', -60, -20), tile('b', 40, -30), tile('c', -30, 50)],
    [tile('dragged', 260, -140), tile('a', -70, 10), tile('b', 10, -50), tile('c', -40, 40)],
  ];
  for (const members of layouts) {
    const ring = reconcileRing({ setId: 's1', members, existing: [], padding: 40, linkDistance: 60 });
    const floor = memberFloorHull(members, 40);
    const target = floorOutline(resampleHull(ringHull(ring.nodes)), floor);
    assert.ok(target && target.length >= 3, 'a floored target exists');
    for (const member of members) {
      const half = (member.width ?? 72) / 2;
      const tileCorners = [
        { x: member.x - half, y: member.y - half }, { x: member.x + half, y: member.y - half },
        { x: member.x + half, y: member.y + half }, { x: member.x - half, y: member.y + half },
      ];
      const paddedCorners = tileCorners.map((c) => ({
        x: c.x + Math.sign(c.x - member.x) * 40,
        y: c.y + Math.sign(c.y - member.y) * 40,
      }));
      for (const corner of tileCorners) {
        const margin = convexMargin(target, corner);
        assert.ok(margin >= -0.5, `${member.id} tile corner (${corner.x.toFixed(0)},${corner.y.toFixed(0)}) is ${(-margin).toFixed(1)}px outside the floored outline`);
      }
      for (const corner of paddedCorners) {
        const margin = convexMargin(target, corner);
        assert.ok(
          margin >= -RING_RESOLUTION_CUT,
          `${member.id} padded corner (${corner.x.toFixed(0)},${corner.y.toFixed(0)}) is ${(-margin).toFixed(1)}px outside the floored outline, beyond the drawn polygon's resolution cut`,
        );
      }
    }
  }
});

/** Signed distance from a point to a convex polygon's boundary: positive
 * inside, zero on the boundary, negative outside (boundary-inclusive, exact
 * for convex polygons). */
function convexMargin(poly, point) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    area += (poly[j].x * poly[i].y) - (poly[i].x * poly[j].y);
  }
  const sign = area < 0 ? 1 : -1;
  let minCross = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    minCross = Math.min(minCross, sign * ((point.x - a.x) * ey - (point.y - a.y) * ex) / len);
  }
  if (minCross >= 0) return minCross;
  let nearest = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared < 1e-12) continue;
    let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    nearest = Math.min(nearest, Math.hypot(
      point.x - (a.x + dx * t),
      point.y - (a.y + dy * t),
    ));
  }
  return -nearest;
}

test('a balanced set does not shift under the anchor flag', () => {
  // When no side demands more room, the centre shift is zero — dragging must
  // not tilt or translate a set that is not one-sided. The anchored semi-axes
  // may still carry the explicit render-resolution allowance.
  const members = [
    tile('a', -60, -40), tile('b', 60, -40),
    tile('c', -60, 40), tile('d', 60, 40),
  ];
  const settled = enclosingEllipse(members, 40);
  const anchored = enclosingEllipse(members, 40, { anchored: true });
  assert.ok(Math.abs(anchored.x - settled.x) < 1e-9, 'the centre does not move for a balanced set');
  assert.ok(Math.abs(anchored.y - settled.y) < 1e-9, 'in either axis');
  assert.ok(anchored.a >= settled.a && anchored.a - settled.a < 20, 'the long axis keeps its size plus the render margin');
  assert.ok(anchored.b >= settled.b && anchored.b - settled.b < 20, 'the short axis keeps its size plus the render margin');
});

/** Counts corners that turn the wrong way on a CCW outline. Zero means convex. */
function reflexTurns(outline) {
  const points = normalizePolygon(outline);
  let count = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    if ((((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x))) < -1e-9) count += 1;
  }
  return count;
}

const lerpPointwise = (previous, target, rate) => previous.map((point, index) => ({
  x: point.x + ((target[index].x - point.x) * rate),
  y: point.y + ((target[index].y - point.y) * rate),
}));

// A known counterexample, not a random search. Perimeter resampling numbers
// points by distance travelled, so index i on one hull and index i on another
// need not be the same corner; the pointwise midpoint between them can turn back
// on itself even though both endpoints are convex. Region decomposition and set
// separation both take shape.outline to be convex, so this has to hold at the
// source rather than being patched up in each consumer.
const EASE_COUNTEREXAMPLE = {
  previous: [{ x: -17.62, y: -34.92 }, { x: 3.59, y: -13.43 }, { x: 15.09, y: -42.76 }],
  target: [{ x: -46.25, y: -6.64 }, { x: -44.20, y: 0.74 }, { x: -43.01, y: -40.93 }],
};

test('the counterexample really is one: raw pointwise easing goes non-convex', () => {
  const previous = resampleHull(ringHull(EASE_COUNTEREXAMPLE.previous), 48);
  const target = resampleHull(ringHull(EASE_COUNTEREXAMPLE.target), 48);
  assert.equal(reflexTurns(previous), 0, 'the starting hull is convex');
  assert.equal(reflexTurns(target), 0, 'the target hull is convex');
  // If this ever stops being true the guard below is no longer being tested.
  assert.ok(
    reflexTurns(lerpPointwise(previous, target, 0.25)) > 0,
    'expected unguarded interpolation to break convexity',
  );
});

test('eased production outlines stay convex', () => {
  const previous = resampleHull(ringHull(EASE_COUNTEREXAMPLE.previous), 48);
  const target = resampleHull(ringHull(EASE_COUNTEREXAMPLE.target), 48);
  for (const rate of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const eased = easeOutline(previous, target, { rate });
    assert.equal(reflexTurns(eased), 0, 'rate ' + rate + ' produced a non-convex outline');
    assert.equal(eased.length, 48, 'rate ' + rate + ' lost point correspondence');
  }
});

test('easing stays convex across a swept corpus of hull pairs', () => {
  let state = 20260829;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const blob = () => resampleHull(ringHull(Array.from({ length: 3 + Math.floor(random() * 6) }, () => ({
    x: (random() - 0.5) * 200,
    y: (random() - 0.5) * 200,
  }))), 48);
  for (let trial = 0; trial < 120; trial += 1) {
    const previous = blob();
    const target = blob();
    if (!previous || !target || previous.length !== 48 || target.length !== 48) continue;
    const eased = easeOutline(previous, target, { rate: 0.25 });
    assert.equal(reflexTurns(eased), 0, 'trial ' + trial + ' produced a non-convex outline');
    assert.equal(eased.length, 48, 'trial ' + trial + ' lost point correspondence');
  }
});

test('the convexity guard does not stop easing from arriving', () => {
  const previous = resampleHull(ringHull(EASE_COUNTEREXAMPLE.previous), 48);
  const target = resampleHull(ringHull(EASE_COUNTEREXAMPLE.target), 48);
  let current = previous;
  for (let frame = 0; frame < 200; frame += 1) current = easeOutline(current, target);
  // Hulling each frame must not leave the outline permanently short of, or
  // drifting past, the shape the physics is asking for.
  const settled = Math.abs(outlineArea(current) - outlineArea(target)) / outlineArea(target);
  assert.ok(settled < 0.02, 'easing settled ' + (settled * 100).toFixed(2) + '% away from the target');
});
