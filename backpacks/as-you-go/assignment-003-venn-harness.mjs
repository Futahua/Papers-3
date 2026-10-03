/** Assignment 003 — Venn lens harness (in-repo, named, disposable; reported in
 * the WORKER COMPLETION entry).
 *
 * Two related sets (a genuinely shared member) overlap as a Venn. The lens is
 * reserved for the shared item. This harness settles that scene with the
 * shipped constants and the app's exact force order, then places diagnostic
 * items in the lens and traces, per tick, which visible hulls contain each
 * item, its own effective membership, every exclusion-force contribution
 * BEFORE summation, its velocity, and its final region (outside both /
 * A-only / B-only / lens).
 *
 * The scene is settled first — the overlap is not manufactured by a jump.
 * Distinct runs are used for items that would disturb one another (the
 * setless N runs alone; A-only and B-only together; the shared item is the
 * AB case already in the scene).
 */
import {
  forceSimulation, forceManyBody, forceCollide, forceLink, forceX, forceY,
} from './public/vendor/d3-force.js';
import {
  reconcileRing, forceRingShape, ringHull, memberFloorHull,
  shortestValidEscape, rayExitDistance,
} from './public/set-ring-model.js';
import {
  forceSetGravity, forceSetSeparation, forceSetExclusion, centreOfMass,
} from './public/set-gravity-model.js';

const RING_NODE_RADIUS = 30;
const RING_LINK_DISTANCE = 60;
const PADDING = 40;
// The boundary resolution the region classifier claims (see regionOf).
const REGION_EPS = 0.05;
const TILE = 72;
const W = 800;
const H = 600;

function tile(id, x, y) {
  return { id, x, y, width: TILE, height: TILE, vx: 0, vy: 0 };
}

/** Boundary-inclusive convex containment with a signed margin (exact for the
 * convex resampled hulls). Positive inside, zero on the boundary, negative
 * outside. */
function convexMargin(poly, point) {
  if (!poly || poly.length < 3) return -Infinity;
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

function pointInHull(poly, point) {
  return convexMargin(poly, point) >= -0.5;
}

/** The scene: two related sets A and B sharing one real member, so the Venn
 * exemption is active between them. Full app force order and constants. The
 * clusters sit at (270,300) and (630,300): measured with the corrected
 * exclusion, this is where the rings settle with the shared member inside both
 * hulls (the lens) after the members have cleared each other's regions. */
function buildVennScene({ diagnostics = [], inheritedFolderMembership = false, exclusionOn = true, ringCollisionOn = true, candidateMode = null, diagnosticSets = {}, constantPush = false, alphaFloor = 0, legacy = false, mirrored = false, rotated = false, reheat = false } = {}) {
  const members = { A: [], B: [] };
  // Cluster anchors: A left, B right. The mirror swaps them; the rotation
  // turns the whole scene 90 degrees around the canvas centre (450,300), so
  // the same membership classes must reach the same regions — no directional
  // bias in the geometry or the response.
  const transform = (p) => {
    let x = p.x;
    let y = p.y;
    if (mirrored) x = 900 - x;
    if (rotated) {
      const nx = 450 + (y - 300);
      const ny = 300 - (x - 450);
      x = nx;
      y = ny;
    }
    return { x, y };
  };
  const spot = (cx, cy, dx, dy) => transform({ x: cx + dx, y: cy + dy });
  // A's own cluster (left), B's own cluster (right), and the shared member
  // between them.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const pa = spot(270, 300, Math.cos(angle) * 55, Math.sin(angle) * 55);
    const pb = spot(630, 300, Math.cos(angle) * 55, Math.sin(angle) * 55);
    members.A.push(tile(`A:${i}`, pa.x, pa.y));
    members.B.push(tile(`B:${i}`, pb.x, pb.y));
  }
  const sharedPos = transform({ x: 450, y: 300 });
  const shared = tile('shared', sharedPos.x, sharedPos.y);
  members.A.push(shared);
  members.B.push(shared);

  // The diagnostics are placed in the UNROTATED frame and carried through the
  // same transform as the clusters. Without this the mirror and rotation runs
  // move the sets but leave the diagnostic items where they were, so the item
  // is no longer in the same place relative to the lens and the run stops being
  // the symmetry check it claims to be (measured: the rotated A-only item sat
  // outside A's reachable pocket and was reported as a directional bias).
  for (const d of diagnostics) {
    const moved = transform({ x: d.x, y: d.y });
    d.x = moved.x;
    d.y = moved.y;
  }

  const rings = new Map();
  const links = [];
  const nodes = [...members.A, ...members.B, ...diagnostics];
  for (const setId of ['A', 'B']) {
    const ring = reconcileRing({
      setId, members: members[setId], existing: [], padding: PADDING, linkDistance: RING_LINK_DISTANCE,
    });
    rings.set(setId, ring);
    nodes.push(...ring.nodes);
    links.push(...ring.links);
  }

  let heldId = null;
  const membersOf = (setId) => members[setId] ?? [];

  // Effective membership, the same rule as the app's setIdsContaining:
  // inherited through folders counts. The inherited case models an item whose
  // own set is a folder inside A — its effective membership is still A.
  const effective = new Map();
  for (const m of members.A) effective.set(m.id, m.id === 'shared' ? ['A', 'B'] : ['A']);
  for (const m of members.B) effective.set(m.id, m.id === 'shared' ? ['A', 'B'] : ['B']);
  for (const d of diagnostics) {
    if (diagnosticSets[d.id]) {
      effective.set(d.id, diagnosticSets[d.id]);
    } else if (d.id.startsWith('aonly') || d.id.startsWith('valid')) effective.set(d.id, ['A']);
    else if (d.id.startsWith('bonly')) effective.set(d.id, ['B']);
    else if (d.id.startsWith('nonly')) effective.set(d.id, []);
    else if (d.id.startsWith('inherited')) effective.set(d.id, inheritedFolderMembership ? ['A'] : []);
  }
  const setsOf = (nodeId) => effective.get(nodeId) ?? [];

  const simulation = forceSimulation(nodes).stop()
    .force('cx', forceX(W / 2).strength(0.05))
    .force('cy', forceY(H / 2).strength(0.05))
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide().radius((n) => (n.ring ? (ringCollisionOn ? RING_NODE_RADIUS : 0) : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', forceLink(links).id((n) => n.id).distance((l) => (l.source.ring ? RING_LINK_DISTANCE : 145)).strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', forceRingShape({ membersOf, padding: PADDING, isDragging: () => heldId != null }))
    .force('setGravity', forceSetGravity({ setsOf, isHeld: (id) => id === heldId }))
    .force('setSeparation', forceSetSeparation({ setsOf, isHeld: (id) => id === heldId }))
    .force('setExclusion', exclusionOn
      ? (legacy
        ? legacyExclusionForce({ setsOf, membersOf, ringOf: (setId) => rings.get(setId)?.nodes ?? null, isHeld: (id) => id === heldId })
        : candidateMode
          ? candidateExclusionForce({ setsOf, membersOf, rings, mode: candidateMode, constantPush, alphaFloor })
          : forceSetExclusion({ setsOf, membersOf, hullOf: (setId) => rings.get(setId)?.nodes ?? null, isHeld: (id) => id === heldId }))
      : null)
    .alphaDecay(0.028)
    .velocityDecay(0.32);

  const scene = {
    nodes, members, shared, rings, simulation, membersOf, setsOf,
    ringHullOf: (setId) => ringHull(rings.get(setId).nodes),
    setHeld: (id) => { heldId = id; },
    isHeld: (id) => id === heldId,
  };
  return scene;
}

/** The visible hull the app draws for a set (ring ∪ member floor). The
 * exclusion force reads the ring hull; the drawn outline adds the floor. */
function drawnHull(scene, setId) {
  const floor = memberFloorHull(scene.membersOf(setId), PADDING);
  return ringHull([...scene.rings.get(setId).nodes, ...(floor ?? [])]);
}

/** The ACTUAL corrected exclusion response for an item on the current tick,
 * mirroring the production force's decision path exactly: the forbidding
 * visible hulls (contained or near), the coordinated allowed-region-aware
 * escape, the bounded desired travel, and the velocity-correction impulse
 * that lands the item's velocity at it. This is what the trace shows for
 * corrected runs — not the legacy per-set contributions, which the force no
 * longer makes. */
function correctedExclusionTrace(scene, item, alpha) {
  const own = new Set(scene.setsOf(item.id));
  const forbidden = [];
  for (const setId of ['A', 'B']) {
    if (own.has(setId)) continue;
    const members = scene.membersOf(setId).filter((m) => m.id !== item.id);
    if (members.length === 0) continue;
    const hull = scene.ringHullOf(setId);
    const enclosed = pointInHull(hull, item);
    let nearest = Infinity;
    for (const member of members) {
      nearest = Math.min(nearest, Math.hypot(item.x - member.x, item.y - member.y));
    }
    if (!enclosed && nearest >= 150) continue;
    forbidden.push({ setId, hull, members, enclosed, nearest });
  }
  if (forbidden.length === 0) return { active: false };
  // Mirrors production: once nothing CONTAINS the item, an item sitting inside
  // one of its own sets is done — the proximity nudge must not walk it out.
  const trespassing = forbidden.some((f) => f.enclosed);
  if (!trespassing) {
    const insideOwn = [...own].some((sid) => {
      const hull = scene.ringHullOf(sid);
      return hull ? pointInHull(hull, item) : false;
    });
    if (insideOwn) return { active: false };
  }
  const urgency = Math.max(...forbidden.map((f) => (f.enclosed ? 1 : (150 - f.nearest) / 150)));
  const escape = shortestValidEscape(
    item,
    forbidden.map((f) => f.hull),
    [...own].map((sid) => scene.ringHullOf(sid)).filter(Boolean),
  );
  let dx;
  let dy;
  if (escape) {
    dx = escape.x;
    dy = escape.y;
  } else {
    const closest = forbidden.reduce((a, b) => (b.nearest < a.nearest ? b : a));
    const centre = centreOfMass(closest.members);
    let ox = item.x - centre.x;
    let oy = item.y - centre.y;
    let d = Math.hypot(ox, oy);
    if (d < 1e-6) { ox = 1; oy = 0; d = 1; }
    dx = ox / d;
    dy = oy / d;
  }
  const push = urgency * 0.35 * Math.max(alpha, 0.05) * 150;
  // Mirrors production: the escape's own distance is the destination (the
  // helper already returns a strictly-valid landing), and only the proximity
  // branch is clipped to the item's own allowed boundary.
  let allowedBound = Infinity;
  let desired;
  if (escape) {
    desired = Math.min(push, escape.distance);
  } else {
    for (const setId of own) {
      const hull = scene.ringHullOf(setId);
      const exit = rayExitDistance(hull, item, { x: dx, y: dy });
      if (exit < allowedBound) allowedBound = exit;
    }
    const nearest = Math.min(...forbidden.map((f) => f.nearest));
    desired = Math.min(push, Math.max(0, 150 - nearest), allowedBound);
  }
  const retained = 1 - 0.32;
  const vAlong = item.vx * dx + item.vy * dy;
  const impulse = desired / retained - vAlong;
  return {
    active: true,
    forbidden: forbidden.map((f) => `${f.setId}(${f.enclosed ? 'in' : 'near'})`).join(' '),
    direction: { x: dx, y: dy },
    escapeDistance: escape ? escape.distance : null,
    allowedBound,
    desired,
    impulse,
    exit: escape
      ? { x: item.x + dx * escape.distance, y: item.y + dy * escape.distance }
      : null,
  };
}

/** The region of an item: lens (inside both), A-only (inside A only),
 * B-only, or outside. Classified by the same ring hulls the exclusion force
 * reads. */
function regionOf(scene, item) {
  // Classified by the exact signed distance, not the ray cast. The two agree
  // everywhere except within a hair of the boundary, where the ray cast's
  // strict comparison flips: an item that escaped and settled 0.4px CLEAR of a
  // hull was still being reported inside it, which reads as a stranded item
  // when the measurement says it left. REGION_EPS is the resolution this
  // classification claims — well under the escape's own 0.5px clearance, so a
  // completed escape always reads as outside, and well under a pixel, so
  // nothing visible is being waved through.
  const inA = convexMargin(scene.ringHullOf('A'), item) > REGION_EPS;
  const inB = convexMargin(scene.ringHullOf('B'), item) > REGION_EPS;
  if (inA && inB) return 'lens';
  if (inA) return 'A-only';
  if (inB) return 'B-only';
  return 'outside';
}

/** Each forbidden set's exclusion contribution for an item, computed with the
 * exact forceSetExclusion math (strength 0.35, clearance 150, centre-away
 * direction, urgency 1 when enclosed). Returns the per-set vector BEFORE any
 * summation, so cancellation is visible. */
function exclusionContribution(scene, item, alpha) {
  const own = new Set(scene.setsOf(item.id));
  const out = [];
  for (const setId of ['A', 'B']) {
    if (own.has(setId)) continue;
    const members = scene.membersOf(setId).filter((m) => m.id !== item.id);
    if (members.length === 0) continue;
    const hull = scene.ringHullOf(setId);
    const enclosed = pointInHull(hull, item);
    let nearest = Infinity;
    for (const member of members) {
      nearest = Math.min(nearest, Math.hypot(item.x - member.x, item.y - member.y));
    }
    if (!enclosed && nearest >= 150) continue;
    const centre = centreOfMass(members);
    let dx = item.x - centre.x;
    let dy = item.y - centre.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 1e-6) { dx = 1; dy = 0; distance = 1; }
    const urgency = enclosed ? 1 : (150 - nearest) / 150;
    const push = urgency * 0.35 * alpha;
    out.push({
      setId, enclosed, nearest,
      vx: (dx / distance) * push * 150,
      vy: (dy / distance) * push * 150,
    });
  }
  return out;
}

/** The direction from an inside point to the nearest point on a convex hull's
 * boundary — the shortest way out of that single hull. */
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

/** The shortest valid coordinated escape: the direction that leaves EVERY
 * forbidden hull with the smallest maximum exit distance. The exit distance
 * along a direction is the farthest of the hulls' far-boundary crossings. */
function unionExitDirection(hulls, point) {
  const project = (p, d) => p.x * d.x + p.y * d.y;
  const exitAlong = (hull, d) => {
    let far = -Infinity;
    for (const v of hull) far = Math.max(far, project(v, d));
    return far - project(point, d);
  };
  const candidates = [];
  for (const hull of hulls) {
    candidates.push(nearestExitDirection(hull, point));
    for (let i = 0; i < hull.length; i += 1) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-9) continue;
      candidates.push({ x: ey / len, y: -ex / len });
      candidates.push({ x: -ey / len, y: ex / len });
    }
  }
  let best = null;
  let bestMax = Infinity;
  for (const d of candidates) {
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-9) continue;
    const u = { x: d.x / len, y: d.y / len };
    const max = Math.max(...hulls.map((h) => exitAlong(h, u)));
    if (max < bestMax) {
      bestMax = max;
      best = u;
    }
  }
  return best ?? { x: 1, y: 0 };
}

/** Harness-local candidate exclusion forces, to gather evidence before any
 * production edit:
 *  - 'closestExit': for each forbidden hull, push along that hull's shortest
 *    exit direction, summed per set (the per-set pushes can still cancel).
 *  - 'coordinated': one push along the shortest valid escape from the union
 *    of all forbidden hulls.
 * Both use the production push strength (0.35 * alpha * 150) with urgency 1
 * for an enclosed item. */
function candidateExclusionForce({ setsOf, membersOf, rings, mode, constantPush = false, alphaFloor = 0 }) {
  let nodes = [];
  function force(alpha) {
    const hulls = new Map();
    const hullOf = (setId) => {
      if (!hulls.has(setId)) hulls.set(setId, ringHull(rings.get(setId).nodes));
      return hulls.get(setId);
    };
    for (const node of nodes) {
      if (node.ring) continue;
      const own = new Set(setsOf(node.id) ?? []);
      const forbidden = [];
      for (const setId of ['A', 'B']) {
        if (own.has(setId)) continue;
        const hull = hullOf(setId);
        const margin = convexMargin(hull, node);
        if (margin >= -0.5) forbidden.push({ setId, hull, margin });
      }
      if (forbidden.length === 0) continue;
      const effort = constantPush ? 1 : Math.max(alpha, alphaFloor);
      const push = 0.35 * effort * 150;
      if (mode === 'closestExit') {
        for (const f of forbidden) {
          const dir = nearestExitDirection(f.hull, node);
          node.vx = (node.vx ?? 0) + dir.x * push;
          node.vy = (node.vy ?? 0) + dir.y * push;
        }
      } else if (mode === 'coordinated') {
        const dir = unionExitDirection(forbidden.map((f) => f.hull), node);
        node.vx = (node.vx ?? 0) + dir.x * push;
        node.vy = (node.vy ?? 0) + dir.y * push;
      }
    }
  }
  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** The distance from an item to the nearest boundary of a hull, signed
 * (positive inside). */
function marginTo(scene, item, setId) {
  return convexMargin(scene.ringHullOf(setId), item);
}

/** Harness-local LEGACY exclusion force: the exact accepted Assignment 003
 * baseline (centre-away per set, alpha-scaled, no coordination, no floor), so
 * the old failure is reproducible from this file without touching production
 * exports. */
function legacyExclusionForce({ setsOf, membersOf, ringOf = () => null, isHeld = () => false, strength = 0.35, clearance = 150 }) {
  let nodes = [];
  function force(alpha) {
    const hulls = new Map();
    const hullOf = (setId) => {
      if (!hulls.has(setId)) {
        const ring = ringOf(setId);
        hulls.set(setId, ring ? ringHull(ring) : null);
      }
      return hulls.get(setId);
    };
    for (const node of nodes) {
      if (node.ring) continue;
      if (isHeld(node.id)) continue;
      const own = new Set(setsOf(node.id) ?? []);
      for (const setId of ['A', 'B']) {
        if (own.has(setId)) continue;
        const members = (membersOf(setId) ?? []).filter((member) => member.id !== node.id);
        if (members.length === 0) continue;
        const hull = hullOf(setId);
        const enclosed = hull ? pointInHull(hull, node) : false;
        let nearest = Infinity;
        for (const member of members) {
          nearest = Math.min(nearest, Math.hypot(node.x - member.x, node.y - member.y));
        }
        if (!enclosed && nearest >= clearance) continue;
        const centre = centreOfMass(members);
        let dx = node.x - centre.x;
        let dy = node.y - centre.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) { dx = 1; dy = 0; distance = 1; }
        const urgency = enclosed ? 1 : (clearance - nearest) / clearance;
        const push = urgency * strength * alpha;
        node.vx = (node.vx ?? 0) + ((dx / distance) * push * clearance);
        node.vy = (node.vy ?? 0) + ((dy / distance) * push * clearance);
      }
    }
  }
  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Runs the scenario: settle the base scene, place the diagnostics in the
 * settled lens (at the point where the two centre-away exclusion vectors
 * cancel), then trace `ticks` more. Returns the per-tick log and the final
 * regions. */
function runVennScenario({ diagnostics, ticks = 2000, sampleEvery = 100, options = {} } = {}) {
  const scene = buildVennScene({ diagnostics, ...options });
  // Settle the base scene (A, B, the shared member) first.
  for (let i = 0; i < 800; i += 1) scene.simulation.tick();

  // Place the diagnostics in the settled lens. The cancellation point for a
  // setless item is the midpoint of the two sets' centres of mass, where the
  // two centre-away unit vectors are exactly opposite.
  const cA = centreOfMass(scene.membersOf('A'));
  const cB = centreOfMass(scene.membersOf('B'));
  const lensProbe = { x: (cA.x + cB.x) / 2, y: (cA.y + cB.y) / 2 };
  // The side offsets place each class on its own set's side of the lens; in a
  // mirrored scene the sides swap, so the offsets mirror too.
  const side = options.mirrored ? (v) => -v : (v) => v;
  const placements = {
    'nonly:0': { x: lensProbe.x, y: lensProbe.y },
    'aonly:0': { x: lensProbe.x + side(-12), y: lensProbe.y - 10 },
    'bonly:0': { x: lensProbe.x + side(12), y: lensProbe.y + 10 },
    'inherited:0': { x: lensProbe.x + side(-6), y: lensProbe.y + 14 },
  };
  for (const d of diagnostics) {
    if (placements[d.id]) {
      d.x = placements[d.id].x;
      d.y = placements[d.id].y;
    }
  }
  // The app's interactions reheat the simulation to 0.12; a reheat run models
  // the active phase after the diagnostics are dropped in.
  if (options.reheat) scene.simulation.alpha(0.12);

  const log = [];
  const legacyRun = options.legacy === true;
  for (let t = 0; t <= ticks; t += 1) {
    if (t > 0) scene.simulation.tick();
    if (t % sampleEvery === 0 || t === ticks) {
      const row = { tick: t, lensProbe, items: [] };
      for (const item of diagnostics) {
        const region = regionOf(scene, item);
        if (legacyRun) {
          const contributions = exclusionContribution(scene, item, scene.simulation.alpha());
          row.items.push({
            id: item.id,
            x: item.x, y: item.y,
            own: scene.setsOf(item.id),
            region,
            marginA: marginTo(scene, item, 'A'),
            marginB: marginTo(scene, item, 'B'),
            contributions,
            totalVx: contributions.reduce((s, c) => s + c.vx, 0),
            totalVy: contributions.reduce((s, c) => s + c.vy, 0),
            speed: Math.hypot(item.vx, item.vy),
          });
        } else {
          const trace = correctedExclusionTrace(scene, item, scene.simulation.alpha());
          row.items.push({
            id: item.id,
            x: item.x, y: item.y,
            own: scene.setsOf(item.id),
            region,
            marginA: marginTo(scene, item, 'A'),
            marginB: marginTo(scene, item, 'B'),
            trace,
            speed: Math.hypot(item.vx, item.vy),
          });
        }
      }
      log.push(row);
    }
  }
  const finals = {};
  for (const item of diagnostics) finals[item.id] = regionOf(scene, item);
  // Re-entry check for corrected runs: once an item has exited a region it
  // must not come back into the lens (or into a hull it has left).
  const reEntries = {};
  if (!legacyRun) {
    for (const item of diagnostics) {
      const seen = [];
      let last = null;
      let exited = false;
      for (const row of log) {
        const entry = row.items.find((it) => it.id === item.id);
        if (!entry) continue;
        if (last && entry.region !== last && last !== 'lens') exited = true;
        if (exited && entry.region === 'lens') reEntries[item.id] = (reEntries[item.id] ?? 0) + 1;
        seen.push(entry.region);
        last = entry.region;
      }
    }
  }
  return { scene, log, finals, cA, cB, lensProbe, reEntries };
}

function summary(name, run) {
  const last = run.log[run.log.length - 1];
  console.log(`\n== ${name} ==`);
  console.log(`lens probe (cancellation point): (${run.lensProbe.x.toFixed(0)},${run.lensProbe.y.toFixed(0)})`);
  for (const item of last.items) {
    if (item.contributions) {
      const contributions = item.contributions.map(
        (c) => `${c.setId}(${c.enclosed ? 'in' : 'near'},${c.vx.toFixed(2)},${c.vy.toFixed(2)})`,
      ).join(' ');
      console.log(
        `${item.id} at (${item.x.toFixed(0)},${item.y.toFixed(0)}) own[${item.own.join(',')}] region ${item.region}` +
        ` | margins A ${item.marginA.toFixed(1)} B ${item.marginB.toFixed(1)}` +
        ` | exclusion: ${contributions || 'none'} | sum (${item.totalVx.toFixed(2)},${item.totalVy.toFixed(2)})`,
      );
    } else {
      const t = item.trace;
      console.log(
        `${item.id} at (${item.x.toFixed(0)},${item.y.toFixed(0)}) own[${item.own.join(',')}] region ${item.region}` +
        ` | margins A ${item.marginA.toFixed(1)} B ${item.marginB.toFixed(1)}` +
        (t.active
          ? ` | response: dir(${t.direction.x.toFixed(2)},${t.direction.y.toFixed(2)}) exit ${t.escapeDistance == null ? 'n/a' : t.escapeDistance.toFixed(1)}` +
            ` bound ${t.allowedBound === Infinity ? 'inf' : t.allowedBound.toFixed(1)} desired ${t.desired.toFixed(1)} impulse ${t.impulse.toFixed(2)}` +
            ` | forbidden: ${t.forbidden}`
          : ' | no response'),
      );
    }
  }
  const reEntryNote = Object.keys(run.reEntries ?? {}).length > 0
    ? ` RE-ENTRIES: ${Object.entries(run.reEntries).map(([id, n]) => `${id}=${n}`).join(' ')}`
    : ' (no re-entry into the lens after escape)';
  console.log(`final regions: ${Object.entries(run.finals).map(([id, r]) => `${id}=${r}`).join(' ')}${reEntryNote}`);
}

function traceTable(name, run) {
  console.log(`\n== ${name} — per-tick trace (sampled) ==`);
  for (const row of run.log) {
    for (const item of row.items) {
      if (item.contributions) {
        const contributions = item.contributions.map((c) => `${c.setId}:(${c.vx.toFixed(2)},${c.vy.toFixed(2)})`).join(' ');
        console.log(
          `t${String(row.tick).padStart(4)} ${item.id} (${item.x.toFixed(0)},${item.y.toFixed(0)}) ${item.region.padEnd(7)}` +
          ` mA ${item.marginA.toFixed(1).padStart(6)} mB ${item.marginB.toFixed(1).padStart(6)}` +
          ` excl[${contributions || 'none'}] sum(${item.totalVx.toFixed(2)},${item.totalVy.toFixed(2)})`,
        );
      } else {
        const t = item.trace;
        const response = t.active
          ? `dir(${t.direction.x.toFixed(2)},${t.direction.y.toFixed(2)}) exit=${t.escapeDistance == null ? '-' : t.escapeDistance.toFixed(1)}` +
            ` travel=${t.desired.toFixed(1)} impulse=${t.impulse.toFixed(2)}`
          : 'no response';
        console.log(
          `t${String(row.tick).padStart(4)} ${item.id} (${item.x.toFixed(0)},${item.y.toFixed(0)}) ${item.region.padEnd(7)}` +
          ` mA ${item.marginA.toFixed(1).padStart(6)} mB ${item.marginB.toFixed(1).padStart(6)}` +
          ` v=${item.speed.toFixed(1).padStart(5)} ${response}`,
        );
      }
    }
  }
}

/** The N item, alone in the lens, symmetric about the two set centres. */
const N = [tile('nonly:0', 450, 300)];
const legacyN = runVennScenario({ diagnostics: N, options: { legacy: true } });
summary('LEGACY exclusion: setless N in the lens (symmetric, alone)', legacyN);
traceTable('LEGACY N trace', legacyN);

const correctedN = runVennScenario({ diagnostics: N });
summary('CORRECTED exclusion: setless N in the lens (symmetric, alone)', correctedN);
traceTable('CORRECTED N trace', correctedN);

// Trajectory vs computed target: the N's actual path, per tick for the first
// 120 ticks, with the escape target (the exit point the response is bounded
// by) and the cumulative path length, so the escape can be seen to be the
// natural short one rather than a long fling past the exit.
{
  const scene = buildVennScene({ diagnostics: [tile('nonly:0', 450, 300)] });
  for (let i = 0; i < 800; i += 1) scene.simulation.tick();
  const n = scene.nodes.find((nd) => nd.id === 'nonly:0');
  const cA = centreOfMass(scene.membersOf('A'));
  const cB = centreOfMass(scene.membersOf('B'));
  n.x = (cA.x + cB.x) / 2;
  n.y = (cA.y + cB.y) / 2;
  const start = { x: n.x, y: n.y };
  let path = 0;
  let prev = { x: n.x, y: n.y };
  let firstExitTick = -1;
  let exitPoint = null;
  const rows = [];
  for (let t = 0; t <= 120; t += 1) {
    if (t > 0) {
      scene.simulation.tick();
      path += Math.hypot(n.x - prev.x, n.y - prev.y);
    }
    prev = { x: n.x, y: n.y };
    const region = regionOf(scene, n);
    const trace = correctedExclusionTrace(scene, n, scene.simulation.alpha());
    if (region !== 'lens' && firstExitTick < 0) {
      firstExitTick = t;
      exitPoint = trace.active && trace.exit ? trace.exit : null;
    }
    if (t % 5 === 0 || t === 120) {
      rows.push(`t${String(t).padStart(3)} (${n.x.toFixed(0)},${n.y.toFixed(0)}) ${region.padEnd(7)}` +
        ` path ${path.toFixed(0).padStart(3)} v ${Math.hypot(n.vx, n.vy).toFixed(1).padStart(4)}` +
        (trace.active
          ? ` dir(${trace.direction.x.toFixed(2)},${trace.direction.y.toFixed(2)}) exit=${trace.escapeDistance == null ? '-' : trace.escapeDistance.toFixed(1)}`
          : ' no response'));
    }
  }
  const directToExit = exitPoint ? Math.hypot(exitPoint.x - start.x, exitPoint.y - start.y) : NaN;
  const endPoint = { x: n.x, y: n.y };
  const totalPath = path;
  console.log(`\n== TRAJECTORY: corrected N from (${start.x.toFixed(0)},${start.y.toFixed(0)}) ==`);
  console.log(rows.join('\n'));
  console.log(`first exit of the lens at t${firstExitTick}, escape target ${exitPoint ? `(${exitPoint.x.toFixed(0)},${exitPoint.y.toFixed(0)})` : 'n/a'},` +
    ` direct distance to the target ${directToExit.toFixed(0)}px, total path to rest ${totalPath.toFixed(0)}px,` +
    ` rest at (${endPoint.x.toFixed(0)},${endPoint.y.toFixed(0)}) region ${regionOf(scene, n)}`);
}

/** A-only and B-only together (mirrors), plus the inherited-membership case. */
const ABItems = [
  tile('aonly:0', 442, 288),
  tile('bonly:0', 458, 312),
  tile('inherited:0', 448, 305),
];
const legacyAB = runVennScenario({ diagnostics: ABItems, options: { legacy: true, inheritedFolderMembership: true } });
summary('LEGACY exclusion: A-only, B-only, inherited-A in the lens', legacyAB);

const correctedAB = runVennScenario({ diagnostics: ABItems, options: { inheritedFolderMembership: true } });
summary('CORRECTED exclusion: A-only, B-only, inherited-A in the lens', correctedAB);

// The shared item (the AB case) must stay in the lens with no exclusion
// impulse — it is its own run (it is already in the scene).
{
  const scene = buildVennScene({});
  for (let i = 0; i < 800; i += 1) scene.simulation.tick();
  const shared = scene.shared;
  const contributions = exclusionContribution(scene, shared, scene.simulation.alpha());
  console.log(`\n== AB case: the shared item ==`);
  console.log(`shared at (${shared.x.toFixed(0)},${shared.y.toFixed(0)}) region ${regionOf(scene, shared)}; exclusion contributions: ${contributions.length === 0 ? 'NONE (belongs to both — exempt)' : contributions.map((c) => c.setId).join(',')}`);
}

// ===========================================================================
// Held item, no-ops, mirror/rotation, and self-verification.
// ===========================================================================

// Held foreign item: zero pointer error while pinned; escapes after release.
{
  const scene = buildVennScene({ diagnostics: [tile('nonly:0', 450, 300)] });
  for (let i = 0; i < 800; i += 1) scene.simulation.tick();
  const n = scene.nodes.find((nd) => nd.id === 'nonly:0');
  const cA = centreOfMass(scene.membersOf('A'));
  const cB = centreOfMass(scene.membersOf('B'));
  n.x = (cA.x + cB.x) / 2;
  n.y = (cA.y + cB.y) / 2;
  n.fx = n.x;
  n.fy = n.y;
  let maxPointerError = 0;
  for (let i = 0; i < 300; i += 1) {
    scene.simulation.tick();
    maxPointerError = Math.max(maxPointerError, Math.hypot(n.x - n.fx, n.y - n.fy));
  }
  const duringHold = regionOf(scene, n);
  n.fx = null;
  n.fy = null;
  for (let i = 0; i < 1200; i += 1) scene.simulation.tick();
  const afterRelease = regionOf(scene, n);
  console.log(`\n== HELD: N pinned in the lens — max pointer error ${maxPointerError.toFixed(4)}, region during hold ${duringHold}, after release ${afterRelease} at (${n.x.toFixed(0)},${n.y.toFixed(0)})`);
}

// No-op: an already-valid item (A-only in A's exclusive region, outside B) and
// an item already outside both (and clear of every member) must receive no
// exclusion response.
{
  const valid = { id: 'valid:0', x: 450, y: 300, width: 72, height: 72, vx: 0, vy: 0 };
  const outside = { id: 'outside:0', x: 450, y: 300, width: 72, height: 72, vx: 0, vy: 0 };
  const scene = buildVennScene({ diagnostics: [valid, outside] });
  for (let i = 0; i < 800; i += 1) scene.simulation.tick();
  valid.x = 170;
  valid.y = 200;
  outside.x = 750;
  outside.y = 550;
  const validRegion = regionOf(scene, valid);
  const outsideRegion = regionOf(scene, outside);
  const validTrace = correctedExclusionTrace(scene, valid, 0.12);
  const outsideTrace = correctedExclusionTrace(scene, outside, 0.12);
  const nearAll = (item) => {
    let nearest = Infinity;
    for (const setId of ['A', 'B']) {
      for (const member of scene.membersOf(setId)) {
        nearest = Math.min(nearest, Math.hypot(item.x - member.x, item.y - member.y));
      }
    }
    return nearest;
  };
  console.log(`\n== NO-OP: valid A-only item (region ${validRegion}, nearest member ${nearAll(valid).toFixed(0)}px)` +
    ` response ${validTrace.active ? 'ACTIVE' : 'none'}; outside item (region ${outsideRegion}, nearest member ${nearAll(outside).toFixed(0)}px)` +
    ` response ${outsideTrace.active ? 'ACTIVE' : 'none'}`);
}

// Mirror: swap the two clusters (A's cluster on the right, B's on the left);
// the same classes must reach the same regions (A-only still A-only, etc.) and
// N must still escape — no directional bias in the geometry or the response.
const mirrorRun = runVennScenario({
  diagnostics: [tile('nonly:0', 450, 300), tile('aonly:0', 438, 300), tile('bonly:0', 462, 300), tile('inherited:0', 444, 300)],
  options: { mirrored: true, inheritedFolderMembership: true },
});
console.log(`\n== MIRROR (clusters swapped): corrected exclusion — final ${Object.entries(mirrorRun.finals).map(([id, region]) => `${id}=${region}`).join(' ')}`);

// Rotation: the whole scene turned 90 degrees; the same classes must reach the
// same regions again.
const rotationRun = runVennScenario({
  diagnostics: [tile('nonly:0', 450, 300), tile('aonly:0', 438, 300), tile('bonly:0', 462, 300), tile('inherited:0', 444, 300)],
  options: { rotated: true, inheritedFolderMembership: true },
});
console.log(`\n== ROTATION (90 degrees): corrected exclusion — final ${Object.entries(rotationRun.finals).map(([id, region]) => `${id}=${region}`).join(' ')}`);

// The adverse A/B rectangles, as a settled force-level run: A spans
// x=[0,100], B spans x=[10,110] with the y axis shared, and an A-only item
// starts at x=95 in the lens. The shortest exit from B (rightward to x=110)
// would eject it from A; the valid escape goes leftward through B's x=10
// boundary. The force alone must settle it inside A, outside B.
{
  const hullA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const hullB = [{ x: 10, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 100 }, { x: 10, y: 100 }];
  const membersA = [{ id: 'ma', x: 30, y: 50, width: 72, height: 72, vx: 0, vy: 0 }];
  const membersB = [{ id: 'mb', x: 60, y: 50, width: 72, height: 72, vx: 0, vy: 0 }];
  const item = { id: 'aonly:adv', x: 95, y: 50, width: 72, height: 72, vx: 0, vy: 0 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'aonly:adv' ? ['A'] : id === 'ma' ? ['A'] : id === 'mb' ? ['B'] : []),
    membersOf: (setId) => (setId === 'A' ? membersA : membersB),
    hullOf: (setId) => (setId === 'A' ? hullA : hullB),
  });
  force.initialize([item, ...membersA, ...membersB]);
  const pathRows = [];
  let path = 0;
  let prev = { x: item.x, y: item.y };
  let sawLeftward = false;
  for (let i = 0; i < 600; i += 1) {
    force(0.05);
    if (item.vx < 0) sawLeftward = true;
    item.vx *= 0.68;
    item.vy *= 0.68;
    item.x += item.vx;
    item.y += item.vy;
    path += Math.hypot(item.x - prev.x, item.y - prev.y);
    prev = { x: item.x, y: item.y };
    if (i % 60 === 0 || i === 599) pathRows.push(`t${String(i).padStart(3)} (${item.x.toFixed(1)},${item.y.toFixed(1)})`);
  }
  const inA = item.x >= 0 && item.x <= 100 && item.y >= 0 && item.y <= 100;
  const inB = item.x >= 10 && item.x <= 110 && item.y >= 0 && item.y <= 100;
  console.log(`\n== ADVERSE A/B RECTANGLES (settled, force-level) ==`);
  console.log(pathRows.join('\n'));
  console.log(`escape leftward: ${sawLeftward ? 'yes' : 'NO'}; settled at (${item.x.toFixed(1)},${item.y.toFixed(1)}), path ${path.toFixed(0)}px;` +
    ` inside A: ${inA ? 'yes' : 'NO'}; inside B: ${inB ? 'YES (FAIL)' : 'no'}`);
}

// Self-verification: the same scene must show the legacy failure and the
// corrected success, or the process exits non-zero.
const failures = [];
function check(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`ASSERT FAIL: ${message}`);
  }
}
check(legacyN.finals['nonly:0'] === 'lens', `legacy N must strand in the lens, got ${legacyN.finals['nonly:0']}`);
check(correctedN.finals['nonly:0'] === 'outside', `corrected N must leave both hulls, got ${correctedN.finals['nonly:0']}`);
check(correctedAB.finals['aonly:0'] === 'A-only', `A-only must end in A's exclusive region, got ${correctedAB.finals['aonly:0']}`);
check(correctedAB.finals['bonly:0'] === 'B-only', `B-only must end in B's exclusive region, got ${correctedAB.finals['bonly:0']}`);
check(correctedAB.finals['inherited:0'] === 'A-only', `inherited membership must behave like direct membership, got ${correctedAB.finals['inherited:0']}`);
check(mirrorRun.finals['nonly:0'] === 'outside', `mirror: N must still escape, got ${mirrorRun.finals['nonly:0']}`);
check(mirrorRun.finals['aonly:0'] === 'A-only', `mirror: A-only must stay in A, got ${mirrorRun.finals['aonly:0']}`);
check(mirrorRun.finals['bonly:0'] === 'B-only', `mirror: B-only must stay in B, got ${mirrorRun.finals['bonly:0']}`);
check(rotationRun.finals['nonly:0'] === 'outside', `rotation: N must still escape, got ${rotationRun.finals['nonly:0']}`);
check(rotationRun.finals['aonly:0'] === 'A-only', `rotation: A-only must stay in A, got ${rotationRun.finals['aonly:0']}`);
check(rotationRun.finals['bonly:0'] === 'B-only', `rotation: B-only must stay in B, got ${rotationRun.finals['bonly:0']}`);
check((correctedN.reEntries['nonly:0'] ?? 0) === 0, `corrected N must not re-enter the lens after escaping (${correctedN.reEntries['nonly:0'] ?? 0} re-entries)`);

if (failures.length > 0) {
  console.error(`\nHARNESS SELF-VERIFICATION FAILED: ${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nHARNESS SELF-VERIFICATION PASSED: legacy stranding reproduced and corrected regions proven on the same scene.');
}

// ===========================================================================
// Ablations, before any production edit.
// ===========================================================================

// 1. Exclusion off: the N item drifts with charge/forceY only.
{
  const r = runVennScenario({ diagnostics: [tile('nonly:0', 450, 300)], options: { exclusionOn: false }, ticks: 800 });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: exclusion off — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 2. Ring collision off: does the A-only item exit B?
{
  const r = runVennScenario({
    diagnostics: [tile('aonly:0', 442, 288), tile('bonly:0', 458, 312)],
    options: { ringCollisionOn: false },
  });
  const last = r.log[r.log.length - 1];
  const out = last.items.map((it) => `${it.id}=${it.region}`).join(' ');
  console.log(`\n== ABLATION: ring collision off — final ${out}`);
}

// 3. One forbidden set at a time: N treated as a B member (only A forbids it).
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    ticks: 800,
    options: { diagnosticSets: { 'nonly:0': ['B'] } },
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: N as a B member (only A forbids) — ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 4. Candidate: closest-hull exit per set (per-set pushes still summed).
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300), tile('aonly:0', 442, 288), tile('bonly:0', 458, 312)],
    options: { candidateMode: 'closestExit' },
  });
  const out = Object.entries(r.finals).map(([id, region]) => `${id}=${region}`).join(' ');
  console.log(`\n== CANDIDATE: closest-hull exit per set — final ${out}`);
}

// 5b. Coordinated candidate + ring collision off: is the ring the blocker?
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    options: { candidateMode: 'coordinated', ringCollisionOn: false },
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: coordinated + ring collision off — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 5c. Coordinated candidate with a constant (non-decaying) push: can the push
// pass the ring at all, or does the ring hold regardless of strength?
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    options: { candidateMode: 'coordinated', constantPush: true },
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: coordinated with constant push — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 5d. Coordinated candidate with the simulation reheated after placement (the
// app's interactions reheat to 0.12): does the active-phase push escape?
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    options: { candidateMode: 'coordinated', reheat: true },
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: coordinated + reheat 0.12 — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 5e. Coordinated candidate, much longer settled run.
{
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    options: { candidateMode: 'coordinated' },
    ticks: 10000,
    sampleEvery: 1000,
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== ABLATION: coordinated, 10000 settled ticks — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}

// 5f. Coordinated candidate with an alpha floor (the exclusion keeps its
// effort while a violation persists — self-terminating once the item exits).
for (const floor of [0.25, 0.5, 1]) {
  const r = runVennScenario({
    diagnostics: [tile('nonly:0', 450, 300)],
    options: { candidateMode: 'coordinated', alphaFloor: floor },
    ticks: 1500,
    sampleEvery: 500,
  });
  const last = r.log[r.log.length - 1].items[0];
  console.log(`\n== CANDIDATE: coordinated + alpha floor ${floor} — N ends ${r.finals['nonly:0']} at (${last.x.toFixed(0)},${last.y.toFixed(0)})`);
}
// 5g. Coordinated + floor for the membership classes.
{
  const r = runVennScenario({
    diagnostics: [tile('aonly:0', 442, 288), tile('bonly:0', 458, 312), tile('inherited:0', 448, 305)],
    options: { candidateMode: 'coordinated', alphaFloor: 0.25, inheritedFolderMembership: true },
  });
  const out = Object.entries(r.finals).map(([id, region]) => `${id}=${region}`).join(' ');
  const last = r.log[r.log.length - 1];
  const detail = last.items.map((it) => `${it.id} (${it.x.toFixed(0)},${it.y.toFixed(0)})`).join(' ');
  console.log(`\n== CANDIDATE: coordinated + floor 0.25, membership classes — final ${out}; ${detail}`);
}