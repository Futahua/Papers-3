/** Sets as gravity rather than geometry.
 *
 * The layout already works this way: the graph is an equilibrium of a pull
 * towards the viewport centre, mutual repulsion, and link distances. These
 * tests are about adding one more term of that kind and checking it settles,
 * rather than about any shape being drawn afterwards. */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centreOfMass, forceSetGravity, forceSetExclusion, forceSetSeparation,
} from './public/set-gravity-model.js';

function node(id, x, y) {
  return { id, x, y, vx: 0, vy: 0 };
}

/** Runs the force the way d3 does: adjust velocities, then integrate.
 *
 * velocityDecay 0.32 and the alpha schedule match the real simulation, so a
 * result here means the same thing there. */
function settle(nodes, force, { ticks = 300, velocityDecay = 0.32 } = {}) {
  force.initialize(nodes);
  let alpha = 1;
  for (let i = 0; i < ticks; i += 1) {
    alpha += (0 - alpha) * 0.028;
    force(alpha);
    for (const n of nodes) {
      n.vx *= 1 - velocityDecay;
      n.vy *= 1 - velocityDecay;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  return nodes;
}

function spread(nodes) {
  const centre = centreOfMass(nodes);
  return Math.max(...nodes.map((n) => Math.hypot(n.x - centre.x, n.y - centre.y)));
}

test('the centre of mass is the members own mean', () => {
  assert.deepEqual(centreOfMass([node('a', 0, 0), node('b', 100, 0)]), { x: 50, y: 0 });
  assert.deepEqual(centreOfMass([node('a', 0, 0), node('b', 60, 0), node('c', 0, 60)]), { x: 20, y: 20 });
  assert.equal(centreOfMass([]), null, 'an empty set has no centre');
});

test('members of a set gather', () => {
  // The whole premise: scattered members of one set draw together on their own,
  // with no shape computed and nothing imposed on them.
  const nodes = [node('a', -400, 0), node('b', 400, 0), node('c', 0, -400), node('d', 0, 400)];
  const before = spread(nodes);
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }));
  const after = spread(nodes);
  assert.ok(after < before * 0.7, `they gathered (${before.toFixed(0)} -> ${after.toFixed(0)})`);
});

test('items in no set are left alone', () => {
  const nodes = [node('a', -300, 0), node('b', 300, 0)];
  const before = nodes.map((n) => ({ ...n }));
  settle(nodes, forceSetGravity({ setsOf: () => [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    assert.equal(nodes[i].x, before[i].x, `${nodes[i].id} did not move in x`);
    assert.equal(nodes[i].y, before[i].y, `${nodes[i].id} did not move in y`);
  }
});

test('two sets gather separately rather than into one clump', () => {
  // Each set has its own centre. Without that they would all fall towards a
  // single point and the sets would be indistinguishable.
  const nodes = [
    node('a1', -300, -100), node('a2', -100, -300),
    node('b1', 300, 100), node('b2', 100, 300),
  ];
  const setsOf = (id) => (id.startsWith('a') ? ['sa'] : ['sb']);
  settle(nodes, forceSetGravity({ setsOf }));

  const a = centreOfMass(nodes.filter((n) => n.id.startsWith('a')));
  const b = centreOfMass(nodes.filter((n) => n.id.startsWith('b')));
  const withinA = Math.hypot(nodes[0].x - a.x, nodes[0].y - a.y);
  const between = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(between > withinA * 4, `the two sets stayed apart (between ${between.toFixed(0)}, within ${withinA.toFixed(0)})`);
});

test('a shared member settles between the sets it belongs to', () => {
  // Membership of two sets means being pulled towards both centres, so the
  // shared item ends up in the overlap. The Venn falls out of the arithmetic
  // rather than needing a rule of its own.
  const nodes = [
    node('a', -300, 0), node('shared', 0, 0), node('b', 300, 0),
  ];
  const setsOf = (id) => (id === 'shared' ? ['sa', 'sb'] : id === 'a' ? ['sa'] : ['sb']);
  settle(nodes, forceSetGravity({ setsOf }));

  const shared = nodes.find((n) => n.id === 'shared');
  const left = nodes.find((n) => n.id === 'a');
  const right = nodes.find((n) => n.id === 'b');
  assert.ok(shared.x > left.x && shared.x < right.x, 'the shared member is between the two');
  assert.ok(
    Math.abs(Math.abs(shared.x - left.x) - Math.abs(shared.x - right.x)) < 40,
    'and roughly equidistant from each',
  );
});

test('a held member is not pulled, and the set follows it', () => {
  // The yielding. A held item goes exactly where the pointer puts it, but it
  // still counts towards its set's centre, so picking up one member draws the
  // others after it rather than leaving them behind.
  const nodes = [node('held', 600, 0), node('a', 0, 0), node('b', 0, 100)];
  const held = nodes[0];
  const startX = held.x;
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'], isHeld: (id) => id === 'held' }));

  assert.equal(held.x, startX, 'the held member did not move');
  assert.equal(held.y, 0, 'in either axis');
  for (const id of ['a', 'b']) {
    const follower = nodes.find((n) => n.id === id);
    assert.ok(follower.x > 100, `${id} moved towards the held member (x=${follower.x.toFixed(0)})`);
  }
});

test('a set of one is left where it is', () => {
  // Nothing to gather towards. Pulling a lone member to its own position would
  // be a no-op with a rounding error, so it is skipped outright.
  const nodes = [node('only', 250, -80)];
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }));
  assert.equal(nodes[0].x, 250);
  assert.equal(nodes[0].y, -80);
});

test('the gathering settles instead of collapsing or oscillating', () => {
  // The centre is the members' own mean, so it moves with them: as they
  // converge the force falls away rather than continuing to squeeze. A fixed
  // centre would pull them all onto one point.
  const nodes = [node('a', -200, 0), node('b', 200, 0), node('c', 0, 200)];
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }), { ticks: 2000 });

  const finalSpread = spread(nodes);
  assert.ok(finalSpread > 1, `the set did not collapse to a point (spread ${finalSpread.toFixed(1)})`);
  for (const n of nodes) {
    assert.ok(
      Math.hypot(n.vx, n.vy) < 0.5,
      `${n.id} came to rest rather than oscillating (speed ${Math.hypot(n.vx, n.vy).toFixed(2)})`,
    );
  }
});

// ===========================================================================
// Exclusion. A boundary can only exclude what lies outside the region its
// members occupy: a bystander resting BETWEEN two members is interior however
// the outline is drawn. So the layout has to express membership too, not just
// the drawing.
// ===========================================================================

test('a non-member sitting inside the outline is pushed out of the cloud', () => {
  const members = [
    { id: 'a', x: 0, y: -150 },
    { id: 'b', x: 0, y: 0 },
    { id: 'c', x: 0, y: 150 },
  ];
  // Right in the middle of them, where no closed curve around the members can
  // leave it out. The outline stands in for the visible shape around them.
  const outline = [{ x: -60, y: -220 }, { x: 60, y: -220 }, { x: 60, y: 220 }, { x: -60, y: 220 }];
  const outsider = { id: 'x', x: 40, y: 0 };
  const nodes = [...members, outsider];

  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
    hullOf: () => outline,
  });
  force.initialize(nodes);
  const nearestBefore = Math.min(...members.map((m) => Math.hypot(outsider.x - m.x, outsider.y - m.y)));

  for (let i = 0; i < 300; i += 1) {
    force(0.3);
    outsider.vx *= 0.6;
    outsider.vy *= 0.6;
    outsider.x += outsider.vx;
    outsider.y += outsider.vy;
  }

  const nearestAfter = Math.min(...members.map((m) => Math.hypot(outsider.x - m.x, outsider.y - m.y)));
  assert.ok(
    nearestAfter > nearestBefore,
    `the outsider did not move away (${nearestBefore.toFixed(0)} -> ${nearestAfter.toFixed(0)})`,
  );
  assert.ok(nearestAfter > 100, `it is still among the members at ${nearestAfter.toFixed(0)}px`);
});

test('a set with no visible outline yet is a no-op for exclusion', () => {
  // Before the first render there is no visible outline — hullOf is null for
  // every set — and the force must not pretend the physics ring is the visible
  // shape. A set with no outline contributes nothing, so an item that would
  // otherwise be inside it is simply not touched.
  const members = [{ id: 'a', x: 0, y: 0 }];
  const inside = { id: 'x', x: 0, y: 0 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
    hullOf: () => null,
  });
  force.initialize([...members, inside]);
  force(1);
  assert.equal(inside.vx ?? 0, 0, 'no outline, no exclusion impulse');
  assert.equal(inside.vy ?? 0, 0, 'in either axis');
});

test('members are never pushed by the exclusion force', () => {
  // They are gathered by forceSetGravity; a force shoving them apart would be
  // arguing with it, and the set would never settle.
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 60, y: 0 }];
  const force = forceSetExclusion({ setsOf: () => ['s1'], membersOf: () => members });
  force.initialize(members);
  force(1);
  for (const member of members) {
    assert.equal(member.vx ?? 0, 0, `${member.id} was pushed`);
    assert.equal(member.vy ?? 0, 0, `${member.id} was pushed`);
  }
});

test('a held item is left where the user is putting it', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 120 }];
  const dragged = { id: 'x', x: 0, y: 60 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
    isHeld: (id) => id === 'x',
  });
  force.initialize([...members, dragged]);
  force(1);
  assert.equal(dragged.vx ?? 0, 0, 'a drag is not fought');
  assert.equal(dragged.vy ?? 0, 0, 'a drag is not fought');
});

test('an item already clear of the set is left alone', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 100 }];
  const distant = { id: 'x', x: 600, y: 50 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
  });
  force.initialize([...members, distant]);
  force(1);
  assert.equal(distant.vx ?? 0, 0, 'nothing to correct');
});

test('an item belonging to the set is not treated as a trespasser', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 120 }, { id: 'c', x: 20, y: 60 }];
  const force = forceSetExclusion({ setsOf: () => ['s1'], membersOf: () => members });
  force.initialize(members);
  force(1);
  const middle = members.find((m) => m.id === 'c');
  assert.equal(middle.vx ?? 0, 0, 'a member in the middle of its own set stays');
});

test('a foreigner deep inside a large set is still pushed out', () => {
  // Proximity to the nearest member is a proxy for "inside", and it fails
  // exactly where a set is bigger than the clearance: eight members on a 320px
  // radius leave an interior far wider than 150px, so an item parked in the
  // middle is near nothing and the proxy says it is fine. Asking the ring
  // whether the point is enclosed is the question that actually matters.
  const members = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;
    members.push({ id: `m${i}`, x: Math.cos(angle) * 320, y: Math.sin(angle) * 320 });
  }
  // A ring standing in for the drawn outline, comfortably outside the members.
  const ring = [];
  for (let i = 0; i < 40; i += 1) {
    const angle = (2 * Math.PI * i) / 40;
    ring.push({ ringIndex: i, x: Math.cos(angle) * 400, y: Math.sin(angle) * 400 });
  }
  const middle = { id: 'x', x: 0, y: 0 };

  const withoutRing = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
  });
  withoutRing.initialize([...members, middle]);
  withoutRing(1);
  assert.equal(middle.vx ?? 0, 0, 'the proxy alone leaves it sitting there');

  const withRing = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
    hullOf: () => ring,
  });
  withRing.initialize([...members, middle]);
  withRing(1);
  assert.ok(
    Math.hypot(middle.vx ?? 0, middle.vy ?? 0) > 0,
    'asking the ring gets it moving',
  );
});


test('the rings of unrelated sets are pushed apart, but a shared set is not', () => {
  // Two sets sharing no members settled with their outlines crossing and the
  // lens between them empty. Nothing acted between two sets: ring nodes carry
  // zero charge, and collision only separates node from node at 60px, which two
  // rings satisfy while the curves drawn through them still overlap.
  const ringNode = (id, setId, x, y) => ({ id, setId, ring: true, ringIndex: 0, x, y, vx: 0, vy: 0 });

  // Two ring nodes of different sets, well inside the 90px clearance.
  const a = ringNode('A:ring:0', 'A', 0, 0);
  const b = ringNode('B:ring:0', 'B', 40, 0);
  const memberA = { id: 'ma', x: -100, y: 0, vx: 0, vy: 0 };
  const memberB = { id: 'mb', x: 140, y: 0, vx: 0, vy: 0 };

  const apart = forceSetSeparation({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
  });
  apart.initialize([a, b, memberA, memberB]);
  apart(1);
  assert.ok(a.vx < 0, 'the left ring node is pushed left');
  assert.ok(b.vx > 0, 'and the right one right');

  // The same geometry, but the two sets share a member. That overlap is the
  // Venn and has to survive: the shared item is pulled towards both centres and
  // must sit in the region belonging to both.
  const c = ringNode('A:ring:0', 'A', 0, 0);
  const d = ringNode('B:ring:0', 'B', 40, 0);
  const shared = { id: 'sh', x: 20, y: 0, vx: 0, vy: 0 };

  const related = forceSetSeparation({ setsOf: () => ['A', 'B'] });
  related.initialize([c, d, shared]);
  related(1);
  assert.equal(c.vx ?? 0, 0, 'sets sharing a member are left alone');
  assert.equal(d.vx ?? 0, 0, 'on both sides');
});

test('separation reaches only as far as its clearance', () => {
  // A settled pair of distant sets must pay nothing, or every scene with more
  // than one set would be permanently agitated.
  const far = (id, setId, x) => ({ id, setId, ring: true, ringIndex: 0, x, y: 0, vx: 0, vy: 0 });
  const a = far('A:ring:0', 'A', 0);
  const b = far('B:ring:0', 'B', 400);
  const force = forceSetSeparation({
    setsOf: (id) => (id === 'ma' ? ['A'] : ['B']),
  });
  force.initialize([a, b, { id: 'ma', x: -50, y: 0 }, { id: 'mb', x: 450, y: 0 }]);
  force(1);
  assert.equal(a.vx ?? 0, 0, 'nothing is pushed at 400px');
  assert.equal(b.vx ?? 0, 0, 'in either direction');
});

// ===========================================================================
// The hull pass. forceSetSeparation has a second pass that reads the drawn
// outlines (the hulls), because ring nodes being clear of each other does not
// make the drawn shapes clear: a hull spans outward across a concavity, so it
// occupies space no ring node is in. These tests pin that pass.
// ===========================================================================

test('overlapping hulls of unrelated sets part on the minimum-overlap axis, opposite signs', () => {
  // The hull pass in isolation. The ring nodes are parked far apart — well
  // past the 90px clearance — so the node-distance pass cannot account for
  // anything; the only thing that can move them is the drawn hulls overlapping.
  // Two 100x400 hulls overlapping by 20px in x must part along x, with A going
  // left and B going right. Both driven the same way, or any movement on the
  // orthogonal axis, would mean the shapes were not being separated at all.
  const far = (id, setId, x) => ({ id, setId, ring: true, ringIndex: 0, x, y: 0, vx: 0, vy: 0 });
  const a = far('A:ring:0', 'A', 0);
  const b = far('B:ring:0', 'B', 5000);
  const hullA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 400 }, { x: 0, y: 400 }];
  const hullB = [{ x: 80, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 400 }, { x: 80, y: 400 }];
  const force = forceSetSeparation({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([a, b, { id: 'ma', x: 0, y: 200 }, { id: 'mb', x: 130, y: 200 }]);
  force(1);

  assert.ok(a.vx < 0, `A is pushed left, away from B (got ${a.vx})`);
  assert.ok(b.vx > 0, `B is pushed right, away from A (got ${b.vx})`);
  assert.ok(Math.abs(a.vy) < 1e-9 && Math.abs(b.vy) < 1e-9, 'no leakage onto the orthogonal axis');
  assert.ok(Math.abs(Math.abs(a.vx) - Math.abs(b.vx)) < 1e-9, 'equal and opposite');
});

test('sets sharing a member are exempt from the hull pass too', () => {
  // The node pass already exempts related sets; the hull pass must respect the
  // same rule, or it would tear apart the Venn overlap that the gravity force
  // builds. Two overlapping hulls whose sets share an item are left alone.
  const far = (id, setId, x) => ({ id, setId, ring: true, ringIndex: 0, x, y: 0, vx: 0, vy: 0 });
  const a = far('A:ring:0', 'A', 0);
  const b = far('B:ring:0', 'B', 5000);
  const hullA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 400 }, { x: 0, y: 400 }];
  const hullB = [{ x: 80, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 400 }, { x: 80, y: 400 }];
  const shared = { id: 'shared', x: 90, y: 200, vx: 0, vy: 0 };
  const force = forceSetSeparation({
    setsOf: () => ['A', 'B'],
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([a, b, shared]);
  force(1);

  assert.equal(a.vx ?? 0, 0, 'a set sharing a member is not pushed by the hull pass');
  assert.equal(b.vx ?? 0, 0, 'on either side');
});

test('the hull pass leaves hulls that do not overlap alone', () => {
  // Separated hulls must pay nothing: a settled scene with no crossing outlines
  // should not be permanently agitated by the pass.
  const far = (id, setId, x) => ({ id, setId, ring: true, ringIndex: 0, x, y: 0, vx: 0, vy: 0 });
  const a = far('A:ring:0', 'A', 0);
  const b = far('B:ring:0', 'B', 5000);
  const hullA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 400 }, { x: 0, y: 400 }];
  const hullB = [{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 300, y: 400 }];
  const force = forceSetSeparation({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([a, b, { id: 'ma', x: 0, y: 200 }, { id: 'mb', x: 300, y: 200 }]);
  force(1);

  assert.equal(a.vx ?? 0, 0, 'disjoint hulls are not pushed');
  assert.equal(b.vx ?? 0, 0, 'on either side');
});

// ===========================================================================
// The droplet rule. The visible outline is floored to enclose the members, so
// a ring-node-only impulse can never part outlines whose member regions
// overlap: the members themselves must translate, as one uniform per-set
// delta, or the collision response would squash the set instead of moving it.
// ===========================================================================

/** Minimal SAT overlap check for asserting outline disjointness in the tests. */
function hullsOverlap(a, b) {
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i += 1) {
      const p = shape[i];
      const q = shape[(i + 1) % shape.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const length = Math.hypot(ex, ey);
      if (length < 1e-9) continue;
      const axisX = -ey / length;
      const axisY = ex / length;
      let minA = Infinity; let maxA = -Infinity;
      for (const pt of a) {
        const v = (pt.x * axisX) + (pt.y * axisY);
        minA = Math.min(minA, v);
        maxA = Math.max(maxA, v);
      }
      let minB = Infinity; let maxB = -Infinity;
      for (const pt of b) {
        const v = (pt.x * axisX) + (pt.y * axisY);
        minB = Math.min(minB, v);
        maxB = Math.max(maxB, v);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function dropletScene(hullA, hullB) {
  const a = { id: 'A:ring:0', setId: 'A', ring: true, ringIndex: 0, x: 0, y: 0, vx: 0, vy: 0 };
  const b = { id: 'B:ring:0', setId: 'B', ring: true, ringIndex: 0, x: 5000, y: 0, vx: 0, vy: 0 };
  const a1 = { id: 'a1', x: -60, y: -40, vx: 0, vy: 0 };
  const a2 = { id: 'a2', x: -60, y: 40, vx: 0, vy: 0 };
  const b1 = { id: 'b1', x: 60, y: -40, vx: 0, vy: 0 };
  const b2 = { id: 'b2', x: 60, y: 40, vx: 0, vy: 0 };
  const nodes = [a, b, a1, a2, b1, b2];
  const setsOf = (id) => {
    if (id.startsWith('a')) return ['A'];
    if (id.startsWith('b')) return ['B'];
    return [];
  };
  return { nodes, setsOf };
}

test('the hull pass translates whole droplets: one uniform delta per set, shape preserved', () => {
  // Ring nodes far apart so only the hull pass can act; hulls overlapping by
  // 20px in x. Every node of A — ring and members — must receive the same
  // delta, every node of B the opposite, with nothing on the orthogonal axis.
  // Uniformity is what keeps internal offsets, hull area and outline geometry
  // untouched by the collision response itself.
  const hullA = [{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: 0, y: 50 }, { x: -100, y: 50 }];
  const hullB = [{ x: -20, y: -50 }, { x: 80, y: -50 }, { x: 80, y: 50 }, { x: -20, y: 50 }];
  const { nodes, setsOf } = dropletScene(hullA, hullB);
  const force = forceSetSeparation({ setsOf, hullOf: (setId) => (setId === 'A' ? hullA : hullB) });
  force.initialize(nodes);
  force(1);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const aRing = byId.get('A:ring:0');
  const bRing = byId.get('B:ring:0');
  const a1n = byId.get('a1');
  const a2n = byId.get('a2');
  const b1n = byId.get('b1');
  const b2n = byId.get('b2');

  assert.equal(a1n.vx, aRing.vx, 'member a1 shares A droplet delta');
  assert.equal(a2n.vx, aRing.vx, 'member a2 shares A droplet delta');
  assert.equal(b1n.vx, bRing.vx, 'member b1 shares B droplet delta');
  assert.equal(b2n.vx, bRing.vx, 'member b2 shares B droplet delta');
  assert.equal(a1n.vy, 0, 'no orthogonal leakage on members');
  assert.equal(b1n.vy, 0, 'no orthogonal leakage on members');
  assert.ok(aRing.vx < 0, 'A is pushed away from B');
  assert.ok(bRing.vx > 0, 'B is pushed away from A');
  assert.equal(aRing.vx, -bRing.vx, 'equal and opposite');
});

test('a set with a held member is anchored; the other droplet absorbs the separation', () => {
  const hullA = [{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: 0, y: 50 }, { x: -100, y: 50 }];
  const hullB = [{ x: -20, y: -50 }, { x: 80, y: -50 }, { x: 80, y: 50 }, { x: -20, y: 50 }];
  const base = dropletScene(hullA, hullB);
  const force = forceSetSeparation({
    setsOf: base.setsOf,
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
    // B's member is under the pointer: B is anchored, A absorbs.
    isHeld: (id) => id === 'b1',
  });
  force.initialize(base.nodes);
  force(1);

  const byId = new Map(base.nodes.map((n) => [n.id, n]));
  const aRing = byId.get('A:ring:0');
  const bRing = byId.get('B:ring:0');
  const a1n = byId.get('a1');
  const a2n = byId.get('a2');
  const b1n = byId.get('b1');
  const b2n = byId.get('b2');

  for (const n of [bRing, b1n, b2n]) {
    assert.equal(n.vx ?? 0, 0, `the anchored droplet takes no impulse (${n.id})`);
  }
  assert.equal(a1n.vx, aRing.vx, 'the unheld droplet moves uniformly (members and ring)');
  assert.equal(a2n.vx, aRing.vx, 'the unheld droplet moves uniformly (members and ring)');
  assert.ok(aRing.vx < 0, 'the unheld droplet moves away');

  // The unheld droplet absorbs both halves: with B anchored, A must move twice
  // as fast as either side moves when both are free.
  const free = dropletScene(hullA, hullB);
  const freeForce = forceSetSeparation({ setsOf: free.setsOf, hullOf: (setId) => (setId === 'A' ? hullA : hullB) });
  freeForce.initialize(free.nodes);
  freeForce(1);
  const freeA = free.nodes.find((n) => n.id === 'A:ring:0');
  assert.equal(aRing.vx, freeA.vx * 2, 'the anchored side is absorbed by the unheld droplet');
});

test('two anchored droplets are left alone', () => {
  const hullA = [{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: 0, y: 50 }, { x: -100, y: 50 }];
  const hullB = [{ x: -20, y: -50 }, { x: 80, y: -50 }, { x: 80, y: 50 }, { x: -20, y: 50 }];
  const { nodes, setsOf } = dropletScene(hullA, hullB);
  const force = forceSetSeparation({
    setsOf,
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
    isHeld: (id) => id === 'a1' || id === 'b1',
  });
  force.initialize(nodes);
  force(1);
  for (const n of nodes) {
    assert.equal(n.vx ?? 0, 0, 'nothing is pushed while both droplets are under the pointer');
  }
});

test('the Venn exemption spares members too, including membership inherited through folders', () => {
  // Sets sharing an effective member must not be separated — their overlap is
  // the point. The impulse must not reach the members of either set.
  const hullA = [{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: 0, y: 50 }, { x: -100, y: 50 }];
  const hullB = [{ x: -20, y: -50 }, { x: 80, y: -50 }, { x: 80, y: 50 }, { x: -20, y: 50 }];
  const a = { id: 'A:ring:0', setId: 'A', ring: true, ringIndex: 0, x: 0, y: 0, vx: 0, vy: 0 };
  const b = { id: 'B:ring:0', setId: 'B', ring: true, ringIndex: 0, x: 5000, y: 0, vx: 0, vy: 0 };
  const a1 = { id: 'a1', x: -60, y: 0, vx: 0, vy: 0 };
  const shared = { id: 'shared', x: 60, y: 0, vx: 0, vy: 0 };
  const force = forceSetSeparation({
    // Effective membership through folder inheritance: the shared item belongs
    // to both sets even though it only "names" one.
    setsOf: (id) => (id === 'a1' ? ['A'] : id === 'shared' ? ['A', 'B'] : []),
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([a, b, a1, shared]);
  force(1);
  assert.equal(a.vx ?? 0, 0, 'ring of A not pushed');
  assert.equal(b.vx ?? 0, 0, 'ring of B not pushed');
  assert.equal(a1.vx ?? 0, 0, 'member of A not pushed');
  assert.equal(shared.vx ?? 0, 0, 'the shared member is not pushed');
});

test('disjoint droplet hulls receive no impulse even with members present', () => {
  const hullA = [{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: 0, y: 50 }, { x: -100, y: 50 }];
  const hullB = [{ x: 300, y: -50 }, { x: 400, y: -50 }, { x: 400, y: 50 }, { x: 300, y: 50 }];
  const { nodes, setsOf } = dropletScene(hullA, hullB);
  const force = forceSetSeparation({
    setsOf,
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize(nodes);
  force(1);
  for (const n of nodes) {
    assert.equal(n.vx ?? 0, 0, 'already-disjoint droplets are not agitated');
  }
});

test('attraction can still bring two sets to rest adjacent without crossing', () => {
  // Non-penetration is not a standing repulsion. With a gentle pull drawing
  // both sets inward, they settle beside each other — outlines disjoint, but
  // close, not fleeing across the workspace. A constant alpha keeps the run
  // convergent; both forces scale with alpha equally, so the equilibrium is
  // the same the app would reach.
  const hullOf = (setId) => {
    const ms = members.filter((m) => m.set === setId);
    const cx = ms.reduce((s, m) => s + m.x, 0) / ms.length;
    const cy = ms.reduce((s, m) => s + m.y, 0) / ms.length;
    return [
      { x: cx - 30, y: cy - 30 }, { x: cx + 30, y: cy - 30 },
      { x: cx + 30, y: cy + 30 }, { x: cx - 30, y: cy + 30 },
    ];
  };
  const a = { id: 'A:ring:0', setId: 'A', ring: true, ringIndex: 0, x: 0, y: 0, vx: 0, vy: 0 };
  const b = { id: 'B:ring:0', setId: 'B', ring: true, ringIndex: 0, x: 5000, y: 0, vx: 0, vy: 0 };
  const members = [
    { id: 'a1', set: 'A', x: -160, y: -20, vx: 0, vy: 0 },
    { id: 'a2', set: 'A', x: -160, y: 20, vx: 0, vy: 0 },
    { id: 'b1', set: 'B', x: 160, y: -20, vx: 0, vy: 0 },
    { id: 'b2', set: 'B', x: 160, y: 20, vx: 0, vy: 0 },
  ];
  const all = [a, b, ...members];
  const force = forceSetSeparation({
    setsOf: (id) => (id.startsWith('a') ? ['A'] : id.startsWith('b') ? ['B'] : []),
    hullOf,
  });
  force.initialize(all);

  for (let i = 0; i < 4000; i += 1) {
    force(0.4);
    for (const n of members) {
      // Gentle external attraction towards the shared origin — the stand-in
      // for graph/layout forces pulling the two sets together.
      n.vx += (0 - n.x) * 0.0006 * 0.4;
      n.vy += (0 - n.y) * 0.0006 * 0.4;
    }
    for (const n of all) {
      n.vx *= 0.68;
      n.vy *= 0.68;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  const centre = (set) => {
    const ms = members.filter((m) => m.set === set);
    return { x: ms.reduce((s, m) => s + m.x, 0) / ms.length, y: ms.reduce((s, m) => s + m.y, 0) / ms.length };
  };
  const ca = centre('A');
  const cb = centre('B');
  const gap = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  // The outlines are 30px either side of each set's member centre; disjoint
  // requires the centres at least ~60px apart. A sub-pixel squeeze is the
  // equilibrium of pull vs non-penetration, so 59 is the behavioural floor.
  assert.ok(gap > 59, `the outlines do not cross at rest (gap ${gap.toFixed(2)}px)`);
  assert.ok(gap < 160, `and they rest adjacent, not fleeing (gap ${gap.toFixed(0)}px)`);
});

// ===========================================================================
// The coordinated exclusion. A foreign item inside several overlapping set
// hulls must receive ONE escape that leaves ALL of them — the old centre-away
// route pushed once per set and cancelled in the Venn lens. The shared item
// (belonging to every containing set) is still exempt, held items are still
// left alone, and the effort does not fade to nothing while a violation
// exists.
// ===========================================================================

/** A rect as the visible outline, so hullOf(setId) returns the rect. */
function ringRect(setId, x0, y0, x1, y1) {
  return [
    { id: `${setId}:ring:0`, setId, ring: true, x: x0, y: y0 },
    { id: `${setId}:ring:1`, setId, ring: true, x: x1, y: y0 },
    { id: `${setId}:ring:2`, setId, ring: true, x: x1, y: y1 },
    { id: `${setId}:ring:3`, setId, ring: true, x: x0, y: y1 },
  ];
}

test('an item inside two overlapping hulls is pushed along one coordinated escape, not cancelling vectors', () => {
  // The Venn lens, geometrically: two overlapping squares. A setless item at
  // the symmetric midpoint is inside both; the old per-set centre-away pushes
  // are equal and opposite (they cancel to zero), so the coordinated rule must
  // produce ONE vertical push — the shortest route out of the union — instead.
  const ringsA = ringRect('A', 0, 0, 100, 100);
  const ringsB = ringRect('B', 60, 0, 160, 100);
  const item = { id: 'x', x: 80, y: 50, vx: 0, vy: 0 };
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 130, y: 50 }];
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? ringsA : ringsB),
  });
  force.initialize([item, ...ringsA, ...ringsB, ...membersA, ...membersB]);
  force(1);

  assert.ok(Math.abs(item.vx) < 1e-6, `the horizontal component is zero, not a cancelling pair (vx ${item.vx})`);
  assert.ok(Math.abs(item.vy) > 1, `the item is pushed vertically out of both hulls (vy ${item.vy})`);
});

test('the exclusion effort does not fade to nothing while a violation exists', () => {
  // d3 cools alpha towards zero; a push scaled by alpha alone would dwindle to
  // a few hundredths of a pixel per tick in a settled scene — too weak to move
  // an item through the ring and cluster collision that hold it. The force
  // keeps its swept floor effort (0.35 * 0.05 * 150) while the item is still
  // inside, and stops entirely once it is out.
  const ringsA = ringRect('A', 0, 0, 100, 100);
  const ringsB = ringRect('B', 60, 0, 160, 100);
  const item = { id: 'x', x: 80, y: 50, vx: 0, vy: 0 };
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 130, y: 50 }];
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? ringsA : ringsB),
  });
  force.initialize([item, ...ringsA, ...ringsB, ...membersA, ...membersB]);
  force(0.001);
  assert.ok(Math.abs(item.vy) > 1, `the push stays near its floor effort at settled alpha (vy ${item.vy})`);
  item.vy = 0;
  // Once outside every hull and clear of the members, nothing is pushed.
  item.x = 300;
  item.y = 300;
  force(0.001);
  assert.equal(item.vx ?? 0, 0, 'an item already out and clear receives no impulse');
});

test('the shared member of both sets is exempt from exclusion', () => {
  // Belonging to every containing hull is the Venn: the item is allowed in
  // the lens, so the coordinated rule must not push it.
  const ringsA = ringRect('A', 0, 0, 100, 100);
  const ringsB = ringRect('B', 60, 0, 160, 100);
  const shared = { id: 'shared', x: 80, y: 50, vx: 0, vy: 0 };
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 130, y: 50 }];
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'shared' ? ['A', 'B'] : id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? ringsA : ringsB),
  });
  force.initialize([shared, ...ringsA, ...ringsB, ...membersA, ...membersB]);
  force(1);
  assert.equal(shared.vx ?? 0, 0, 'the shared item receives no exclusion impulse');
  assert.equal(shared.vy ?? 0, 0, 'in either axis');
});

test('an A-only item is pushed out of B but the escape preserves its own set', () => {
  // The item belongs to A and is inside B: the escape must leave B, and the
  // single coordinated push must not fling it out of A (its allowed region).
  const ringsA = ringRect('A', 0, 0, 100, 100);
  const ringsB = ringRect('B', 60, 0, 160, 100);
  const item = { id: 'aonly', x: 80, y: 50, vx: 0, vy: 0 };
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 130, y: 50 }];
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'aonly' ? ['A'] : id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? ringsA : ringsB),
  });
  force.initialize([item, ...ringsA, ...ringsB, ...membersA, ...membersB]);
  force(1);
  assert.ok(Math.abs(item.vx) > 0 || Math.abs(item.vy) > 0, 'the item is pushed');
  assert.ok(Math.abs(item.vx) < 100, `the push is bounded, not a fling (vx ${item.vx})`);
});

test('a held foreign item is left under the pointer', () => {
  const ringsA = ringRect('A', 0, 0, 100, 100);
  const ringsB = ringRect('B', 60, 0, 160, 100);
  const item = { id: 'x', x: 80, y: 50, vx: 0, vy: 0 };
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 130, y: 50 }];
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? ringsA : ringsB),
    isHeld: (id) => id === 'x',
  });
  force.initialize([item, ...ringsA, ...ringsB, ...membersA, ...membersB]);
  force(1);
  assert.equal(item.vx ?? 0, 0, 'a held item is not pushed');
  assert.equal(item.vy ?? 0, 0, 'in either axis');
});

test('exclusion follows the visible outline, not the raw physics ring', () => {
  // The visible outline (hullOf) is what the creator sees; the raw ring nodes
  // are the physics shape the outline eases towards, and the two differ while
  // the ease trails. The force must ask the visible outline who is inside: an
  // item inside the raw ring but OUTSIDE the visible outline — and beyond the
  // proximity range — is not inside the drawn set, and an item inside the
  // outline is, regardless of the ring nodes.
  const ringNodes = ringRect('A', 0, 0, 300, 300); // the physics ring, far larger
  const outline = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }]; // the drawn shape
  const members = [{ id: 'ma', x: 30, y: 30 }];
  const outsideOutline = { id: 'x', x: 250, y: 250 }; // inside the ring, outside the outline, far from the members
  const insideOutline = { id: 'y', x: 20, y: 20 }; // outside the ring, inside the outline
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'ma' ? ['A'] : []),
    membersOf: () => members,
    hullOf: () => outline,
  });
  force.initialize([outsideOutline, insideOutline, ...members]);
  force(1);
  // The item inside the raw ring but outside the drawn shape is not pushed:
  // the ring alone cannot make it a trespasser. The pre-repair ringOf-based
  // force enclosed it through the physics nodes.
  assert.equal(outsideOutline.vx ?? 0, 0, 'the ring-only occupant is not inside the visible set');
  assert.equal(outsideOutline.vy ?? 0, 0, 'in either axis');
  // The item inside the drawn shape is pushed, regardless of the ring nodes.
  assert.ok(
    Math.abs(insideOutline.vx ?? 0) + Math.abs(insideOutline.vy ?? 0) > 0,
    'the outline occupant is pushed out',
  );
});

test('the adverse A/B rectangles settle with the A-only item still inside A', () => {
  // The explicit counterexample, run as a settled force: A spans x=[0,100],
  // B spans x=[10,110], the y axis shared, and an A-only item starts at x=95
  // in the lens. The shortest exit from B (rightward to x=110) would eject it
  // from A; the valid escape is leftward through B's x=10 boundary. After the
  // response runs to rest the item must be outside B and still inside A.
  const hullA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const hullB = [{ x: 10, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 100 }, { x: 10, y: 100 }];
  const membersA = [{ id: 'ma', x: 30, y: 50 }];
  const membersB = [{ id: 'mb', x: 60, y: 50 }];
  const item = { id: 'aonly', x: 95, y: 50, vx: 0, vy: 0 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'aonly' ? ['A'] : id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([item, ...membersA, ...membersB]);
  const settleTicks = 600;
  const settledAlpha = 0.05;
  let sawLeftward = false;
  for (let i = 0; i < settleTicks; i += 1) {
    force(settledAlpha);
    if (item.vx < 0) sawLeftward = true;
    // d3's integration: x += vx * retained, then the velocity is re-read next
    // tick with the force's impulse added.
    item.vx *= 0.68;
    item.vy *= 0.68;
    item.x += item.vx;
    item.y += item.vy;
  }
  assert.ok(sawLeftward, 'the escape went leftward, through B\'s x=10 boundary');
  // Boundary inclusive with a floating-point epsilon: the item rests on A's
  // left edge, which the response is bounded to reach but not cross.
  const inA = item.x >= -1e-6 && item.x <= 100 && item.y >= -1e-6 && item.y <= 100;
  const inB = item.x >= 10 && item.x <= 110 && item.y >= 0 && item.y <= 100;
  assert.ok(inA, `the item settled inside A at (${item.x.toFixed(1)},${item.y.toFixed(1)})`);
  assert.ok(!inB, `and outside B at (${item.x.toFixed(1)},${item.y.toFixed(1)})`);
  assert.ok(item.x < 95, `it moved out of the lens (x ${item.x.toFixed(1)})`);
});

// ===========================================================================
// Relation discovery. Which sets share a member used to be rediscovered by
// asking every pair of sets whether they intersect; it is now derived from each
// member's own membership list. These pin the behaviour that equivalence rests
// on, since the two formulations must agree exactly or sets start separating
// that should not.

/** Module-scope twin of the helper the older separation test keeps local. */
const relationRingNode = (id, setId, x, y) => ({
  id, setId, ring: true, ringIndex: 0, x, y, vx: 0, vy: 0,
});
/** Drives one tick and reports whether the two rings were pushed apart. Related
 * sets are skipped by the proximity pass, so movement is the observable proxy
 * for "these were treated as unrelated". */
function separated(setsOf, extraMembers = []) {
  const a = relationRingNode('A:ring:0', 'A', 0, 0);
  const b = relationRingNode('B:ring:0', 'B', 40, 0);
  const force = forceSetSeparation({ setsOf });
  force.initialize([a, b, ...extraMembers]);
  force(1);
  return (a.vx ?? 0) !== 0 || (b.vx ?? 0) !== 0;
}

test('sets with no shared member are unrelated and separate', () => {
  const members = [
    { id: 'ma', x: -100, y: 0, vx: 0, vy: 0 },
    { id: 'mb', x: 140, y: 0, vx: 0, vy: 0 },
  ];
  const setsOf = (id) => (id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []);
  assert.equal(separated(setsOf, members), true);
});

test('one directly shared member relates both sets', () => {
  const shared = [{ id: 'sh', x: 20, y: 0, vx: 0, vy: 0 }];
  assert.equal(separated(() => ['A', 'B'], shared), false);
});

test('membership inherited onto one member relates its sets', () => {
  // The member itself is what names both sets; nothing asks the sets directly.
  const members = [
    { id: 'ma', x: -100, y: 0, vx: 0, vy: 0 },
    { id: 'inherited', x: 20, y: 0, vx: 0, vy: 0 },
  ];
  const setsOf = (id) => (id === 'inherited' ? ['A', 'B'] : id === 'ma' ? ['A'] : []);
  assert.equal(separated(setsOf, members), false);
});

test('a member in three sets relates every pair among them', () => {
  const nodes = [
    relationRingNode('A:ring:0', 'A', 0, 0),
    relationRingNode('B:ring:0', 'B', 40, 0),
    relationRingNode('C:ring:0', 'C', 80, 0),
    { id: 'triple', x: 40, y: 0, vx: 0, vy: 0 },
  ];
  const force = forceSetSeparation({ setsOf: (id) => (id === 'triple' ? ['A', 'B', 'C'] : []) });
  force.initialize(nodes);
  force(1);
  // A-B, B-C and A-C must all be related, including the pair whose rings are
  // furthest apart — a pairwise scan and a per-member derivation agree only if
  // every pair is generated, not just adjacent ones.
  for (const node of nodes) {
    assert.equal(node.vx ?? 0, 0, `${node.id} was pushed despite sharing a member`);
  }
});

test('duplicate entries from setsOf cannot change the outcome', () => {
  const members = [
    { id: 'ma', x: -100, y: 0, vx: 0, vy: 0 },
    { id: 'mb', x: 140, y: 0, vx: 0, vy: 0 },
  ];
  // Characterisation, not mutation-sensitive: removing the dedupe in the source
  // leaves this green, because a self-pair is unreachable (the proximity pass
  // skips same-set nodes first) and repeated cross-pairs collapse in the Set.
  // It is pinned so that a future change which DOES make duplicates observable
  // has to break a test to do it.
  const withDuplicates = (id) => (id === 'ma' ? ['A', 'A', 'A'] : id === 'mb' ? ['B', 'B'] : []);
  assert.equal(separated(withDuplicates, members), true);

  const sharedDuplicated = [{ id: 'sh', x: 20, y: 0, vx: 0, vy: 0 }];
  assert.equal(separated(() => ['B', 'A', 'B', 'A'], sharedDuplicated), false);
});

test('a set whose members are all off-screen never enters a relation', () => {
  // membersBySet only ever held sets with a visible member, and deriving
  // relations from members preserves that: nothing invents a pair for a set
  // that contributed no member this tick.
  const members = [{ id: 'ma', x: -100, y: 0, vx: 0, vy: 0 }];
  const setsOf = (id) => (id === 'ma' ? ['A'] : []);
  assert.equal(separated(setsOf, members), true);
});

// ===========================================================================
// The hull pass broad phase. Bounding boxes are sorted on minX and the inner
// scan stops once a candidate starts to the right of where the current hull
// ends. That is exact — boxes that miss cannot contain shapes that meet — but
// it is only exact if the sweep actually reaches every pair whose boxes do meet,
// including pairs that are not neighbours in x order.

const sweepRing = (id, setId, x) => ({ id, setId, ring: true, ringIndex: 0, x, y: 0, vx: 0, vy: 0 });
const boxHull = (left, right, top = 0, bottom = 400) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

test('the sweep still finds an overlapping pair that is not adjacent in x order', () => {
  // A spans 0..300 and C spans 200..500, so they overlap. B sits between them
  // in minX order at 100..150 and overlaps neither. If the scan stopped at the
  // first non-overlapping candidate instead of testing on to the end of A's
  // extent, A and C would silently never be separated.
  const hulls = {
    A: boxHull(0, 300),
    B: boxHull(100, 150, 900, 1000),
    C: boxHull(200, 500),
  };
  const nodes = ['A', 'B', 'C'].map((setId, index) => sweepRing(`${setId}:ring:0`, setId, index * 5000));
  const force = forceSetSeparation({
    setsOf: () => [],
    hullOf: (setId) => hulls[setId],
  });
  force.initialize(nodes);
  force(1);

  const [a, b, c] = nodes;
  assert.ok(a.vx < 0, `A is pushed away from C (got ${a.vx})`);
  assert.ok(c.vx > 0, `C is pushed away from A (got ${c.vx})`);
  assert.equal(b.vx ?? 0, 0, 'B overlaps neither and is left alone');
});

test('the sweep separates hulls that meet only in x, and leaves ones that miss in y', () => {
  // Same x extent for both pairs; only the y bounds differ. Characterisation,
  // not mutation-sensitive: deleting the y rejection from the source leaves this
  // green, because hullOverlap rejects those pairs too. The y test is a cost
  // filter — it stops a tall column of unrelated sets paying for a full SAT
  // sweep each — whereas the x break is what is load-bearing for correctness.
  const meeting = {
    A: boxHull(0, 100, 0, 100),
    B: boxHull(80, 180, 0, 100),
  };
  const missing = {
    A: boxHull(0, 100, 0, 100),
    B: boxHull(80, 180, 900, 1000),
  };
  for (const [label, hulls, expectPush] of [['meeting', meeting, true], ['missing', missing, false]]) {
    const nodes = ['A', 'B'].map((setId, index) => sweepRing(`${setId}:ring:0`, setId, index * 5000));
    const force = forceSetSeparation({ setsOf: () => [], hullOf: (setId) => hulls[setId] });
    force.initialize(nodes);
    force(1);
    const moved = (nodes[0].vx ?? 0) !== 0 || (nodes[1].vx ?? 0) !== 0;
    assert.equal(moved, expectPush, `${label}: expected pushed=${expectPush}`);
  }
});

test('the broad phase does not change which pairs separate across a spread of sets', () => {
  // Eight sets in a row, each overlapping only its neighbour. Every adjacent
  // pair must part and no distant pair may move, which is the property a broken
  // break condition would violate in one direction or the other.
  const hulls = {};
  const ids = Array.from({ length: 8 }, (unused, index) => `S${index}`);
  ids.forEach((id, index) => { hulls[id] = boxHull(index * 80, (index * 80) + 100); });
  const nodes = ids.map((setId, index) => sweepRing(`${setId}:ring:0`, setId, index * 5000));
  const force = forceSetSeparation({ setsOf: () => [], hullOf: (setId) => hulls[setId] });
  force.initialize(nodes);
  force(1);

  // The end sets are pushed outward; everything moves, because every set has at
  // least one overlapping neighbour.
  assert.ok(nodes[0].vx < 0, 'the leftmost set is pushed left');
  assert.ok(nodes[7].vx > 0, 'the rightmost set is pushed right');
  for (const node of nodes) {
    assert.ok(Math.abs(node.vy ?? 0) < 1e-9, `${node.id} leaked onto the orthogonal axis`);
  }
});
