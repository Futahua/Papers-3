/** Assignment 002 — drag harness (in-repo, named, disposable; reported in the
 * WORKER COMPLETION and COMPLETION ADDENDUM entries).
 *
 * Reproduces the creator's gesture the way pointer-controller performs it:
 * many small steps, each pinning fx/fy AND x/y on the held member and reheating
 * the simulation to 0.12, with several ticks per step. Shipped constants and
 * the app's exact force order. The visible outline pipeline (ringHull ->
 * resampleHull -> floorOutline(memberFloorHull) -> easeOutline 0.25) runs every
 * tick, and hullOf reads the eased outline like the wired app.
 *
 * Two paths run the SAME deterministic scene and foreign markers:
 *  - LEGACY: a harness-local replica of the accepted Assignment 001 geometry
 *    (the symmetric mean-centred ellipse), so the baseline failure is
 *    reproducible from this file without touching production exports.
 *  - CORRECTED: the production forceRingShape with the anchored ellipse.
 * The file is self-verifying: it exits non-zero if the legacy path does not
 * fail the way the handoff describes, or if the corrected path sweeps the far
 * side, encloses the legacy-swept markers, loses the pointer, or excludes a
 * member tile.
 */
import {
  forceSimulation, forceManyBody, forceCollide, forceLink, forceX, forceY,
} from './public/vendor/d3-force.js';
import {
  reconcileRing, forceRingShape, ringHull, resampleHull, memberFloorHull,
  floorOutline, easeOutline, enclosingEllipse, ellipsePoint,
} from './public/set-ring-model.js';
import { forceSetGravity, forceSetExclusion, forceSetSeparation } from './public/set-gravity-model.js';

const RING_NODE_RADIUS = 30;
const RING_LINK_DISTANCE = 60;
const PADDING = 40;
const TILE = 72;
const W = 800;
const H = 600;

function tile(id, x, y) {
  return { id, x, y, width: TILE, height: TILE, vx: 0, vy: 0 };
}

/** The exact enclosingEllipse from HEAD (the accepted Assignment 001
 * geometry): symmetric growth around the members' mean. Harness-local so the
 * baseline failure is reproducible without changing production exports. */
function legacyEllipse(members, padding) {
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

  const mean = (sxx + syy) / 2;
  const delta = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + (sxy * sxy)));
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  let half = 0;
  for (const member of members) {
    half = Math.max(half, Math.hypot(member.width ?? 0, member.height ?? 0) / 2);
  }

  let a = Math.sqrt(mean + delta) + half + padding;
  let b = Math.sqrt(Math.max(0, mean - delta)) + half + padding;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let needA = 0;
  let needB = 0;
  for (const member of members) {
    const dx = member.x - cx;
    const dy = member.y - cy;
    const localX = (dx * cos) - (dy * sin);
    const localY = (dx * sin) + (dy * cos);
    needA = Math.max(needA, Math.abs(localX) + half + padding);
    needB = Math.max(needB, Math.abs(localY) + half + padding);
  }
  a = Math.max(a, needA);
  b = Math.max(b, needB);

  return { x: cx, y: cy, a, b, angle };
}

/** A local replica of forceRingShape that holds the ring on the LEGACY
 * symmetric ellipse, with the same alpha-floor gating the production force
 * uses (floor while dragging, cooling otherwise). */
function legacyRingForce({ membersOf, padding = 40, strength = 0.35, minAlpha = 0.25, isDragging = () => true }) {
  let nodes = [];
  function force(alpha) {
    const floor = isDragging() ? minAlpha : 0;
    const shapes = new Map();
    for (const node of nodes) {
      if (!node.ring) continue;
      if (!shapes.has(node.setId)) {
        shapes.set(node.setId, legacyEllipse(membersOf(node.setId) ?? [], padding));
      }
      const shape = shapes.get(node.setId);
      if (!shape) continue;
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

/** Signed distance from a point to a convex polygon's boundary: positive
 * inside, zero on the boundary, negative outside. Exact for convex polygons
 * (the half-plane test decides the sign; the nearest-segment distance gives
 * the true magnitude, valid because the nearest boundary point of a convex
 * polygon always lies on an edge). Boundary-inclusive, winding-independent. */
function convexMargin(poly, point) {
  if (!poly || poly.length < 3) return -Infinity;
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    area += (poly[j].x * poly[i].y) - (poly[i].x * poly[j].y);
  }
  // The cross below is cross(p-a, b-a), the negative of the standard
  // cross(b-a, p-a): interior points give a positive value on a clockwise
  // polygon and a negative one on a counter-clockwise one.
  const sign = area < 0 ? 1 : -1;
  let minCross = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const cross = ((point.x - a.x) * ey - (point.y - a.y) * ex) / len;
    minCross = Math.min(minCross, sign * cross);
  }
  if (minCross >= 0) return minCross;
  // Outside: the true distance is the nearest-segment distance (the nearest
  // boundary point of a convex polygon lies on an edge), not the worst
  // edge-line distance that minCross reports.
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

function extents(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function buildScene({ exclusionOn = true, ringOn = true, floorOn = true, easeRate = 0.25, omit = [], legacy = false } = {}) {
  const omitForce = (name) => omit.includes(name);
  const members = [];
  const cx = W / 2;
  const cy = H / 2;
  // A compact cluster, like a real set: several tiles around the canvas centre.
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    members.push(tile(`m${i}`, cx + Math.cos(angle) * 45, cy + Math.sin(angle) * 45));
  }
  const ring = reconcileRing({ setId: 's1', members, existing: [], padding: PADDING, linkDistance: RING_LINK_DISTANCE });
  const links = [...ring.links];
  const nodes = [...members, ...ring.nodes];
  let dragging = false;
  let heldId = null;
  let foreigners = [];

  const membersOf = () => members;
  const setsOf = (id) => (id.startsWith('m') ? ['s1'] : []);

  const ringForce = legacy
    ? legacyRingForce({ membersOf, padding: PADDING, isDragging: () => dragging })
    : forceRingShape({ membersOf, padding: PADDING, isDragging: () => dragging });

  const simulation = forceSimulation(nodes).stop()
    .force('cx', omitForce('cx') ? null : forceX(W / 2).strength(0.05))
    .force('cy', omitForce('cy') ? null : forceY(H / 2).strength(0.05))
    .force('charge', omitForce('charge') ? null : forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', omitForce('collide') ? null : forceCollide().radius((n) => (n.ring ? RING_NODE_RADIUS : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', omitForce('link') ? null : forceLink(links).id((n) => n.id).distance((l) => (l.source.ring ? RING_LINK_DISTANCE : 145)).strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', ringOn && !omitForce('ring') ? ringForce : null)
    .force('setGravity', omitForce('setGravity') ? null : forceSetGravity({ setsOf, isHeld: (id) => id === heldId }))
    .force('setSeparation', omitForce('setSeparation') ? null : forceSetSeparation({ setsOf, isHeld: (id) => id === heldId }))
    .force('setExclusion', exclusionOn && !omitForce('setExclusion') ? forceSetExclusion({ setsOf, membersOf, hullOf: () => ring.nodes, isHeld: (id) => id === heldId }) : null)
    .alphaDecay(0.028)
    .velocityDecay(0.32);

  const outlines = new Map();
  const targets = new Map();
  const drawOutlines = () => {
    const floor = floorOn ? memberFloorHull(members, PADDING) : null;
    const target = floorOutline(resampleHull(ringHull(ring.nodes)), floor);
    targets.set('s1', target);
    outlines.set('s1', easeOutline(outlines.get('s1'), target, { rate: easeRate }));
  };

  return {
    nodes, members, ring, simulation, drawOutlines, outlines, targets, membersOf, setsOf, legacy,
    setDragging: (v, id) => { dragging = v; heldId = id; },
    isDragging: () => dragging,
    getForeigners: () => foreigners,
    setForeigners: (f) => { foreigners = f; },
    addNodes: (extra) => { nodes.push(...extra); },
  };
}

/** The ellipse the ring force actually uses right now: the anchored ellipse
 * while a corrected drag is in progress, the symmetric (legacy) ellipse in the
 * legacy path. */
function activeEllipse(scene) {
  const { members, legacy } = scene;
  return legacy
    ? legacyEllipse(members, PADDING)
    : enclosingEllipse(members, PADDING, { anchored: scene.isDragging() });
}

/** Records everything the assignment asks for at the current state. */
function measure(scene) {
  const { members, ring, outlines, targets } = scene;
  const record = {};
  record.eased = extents(outlines.get('s1') ?? []);
  record.target = extents(targets.get('s1') ?? []);
  record.floor = extents(memberFloorHull(members, PADDING) ?? []);
  const ellipse = activeEllipse(scene);
  record.ellipse = ellipse ? {
    minX: ellipse.x - ellipse.a, minY: ellipse.y - ellipse.b,
    maxX: ellipse.x + ellipse.a, maxY: ellipse.y + ellipse.b,
  } : null;
  record.ringExtent = extents(ringHull(ring.nodes));

  // Containment against the TARGET and the EASED (visible) outlines, using the
  // boundary-inclusive convex margin. Full tile corners and padded corners are
  // measured separately; the margin is signed (negative = genuinely outside).
  const corners = (m, extra) => {
    const hw = (m.width ?? TILE) / 2 + extra;
    const hh = (m.height ?? TILE) / 2 + extra;
    return [
      { x: m.x - hw, y: m.y - hh }, { x: m.x + hw, y: m.y - hh },
      { x: m.x + hw, y: m.y + hh }, { x: m.x - hw, y: m.y + hh },
    ];
  };
  const worstMargin = (ms, extra, poly) => Math.min(
    ...ms.flatMap((m) => corners(m, extra).map((c) => convexMargin(poly, c))),
  );
  record.tilesMarginTarget = worstMargin(members, 0, targets.get('s1'));
  record.paddedMarginTarget = worstMargin(members, PADDING, targets.get('s1'));
  record.tilesMarginEased = worstMargin(members, 0, outlines.get('s1'));
  record.paddedMarginEased = worstMargin(members, PADDING, outlines.get('s1'));
  // A tiny negative margin (within the convex test's rounding) is treated as
  // on-boundary; anything beyond is genuinely outside.
  const ON_BOUNDARY_TOL = 0.5;
  record.tilesInside = record.tilesMarginTarget >= -ON_BOUNDARY_TOL;
  record.paddedInside = record.paddedMarginTarget >= -ON_BOUNDARY_TOL;
  record.tilesInsideEased = record.tilesMarginEased >= -ON_BOUNDARY_TOL;
  record.paddedInsideEased = record.paddedMarginEased >= -ON_BOUNDARY_TOL;
  record.allInside = record.tilesInside && record.paddedInside;

  record.foreignersInside = scene.getForeigners()
    .filter((f) => convexMargin(outlines.get('s1'), f) > -ON_BOUNDARY_TOL)
    .map((f) => f.id);
  return record;
}

/** Runs a full drag: settle, then `steps` pointer moves of (dx, dy), 3 ticks
 * per step with a 0.12 reheat. Returns the log plus before/after state. */
function dragScenario({ dx = 6, dy = 5, steps = 40, tickPerStep = 3, foreignOffset = 70, ...options } = {}) {
  const scene = buildScene(options);
  const { simulation, members, drawOutlines } = scene;

  for (let i = 0; i < 400; i += 1) { simulation.tick(); drawOutlines(); }
  const initial = measure(scene);

  // The held member: an edge member on the cluster's top-left side, so the
  // drag away from the cluster runs diagonally bottom-right.
  const held = members[0];
  const start = { x: held.x, y: held.y };

  // Foreigners on the side OPPOSITE to the drag direction, outside the initial
  // outline and outside the drag corridor. Static markers, not simulation
  // nodes: the question is whether the outline sweeps over where such an item
  // sits, and a real item would itself be shoved around, muddying the geometry.
  const i = initial.eased;
  const yMid = (i.minY + i.maxY) / 2;
  const xMid = (i.minX + i.maxX) / 2;
  const foreignPositions = [];
  if (dx > 0 || (dx === 0 && dy === 0)) {
    foreignPositions.push(
      { x: i.minX - 50, y: yMid - 40 },
      { x: i.minX - 80, y: yMid },
      { x: i.minX - 110, y: yMid + 40 },
      { x: i.minX - 60, y: yMid - 20 },
    );
  } else if (dx < 0) {
    foreignPositions.push(
      { x: i.maxX + 50, y: yMid - 40 },
      { x: i.maxX + 80, y: yMid },
      { x: i.maxX + 110, y: yMid + 40 },
      { x: i.maxX + 60, y: yMid - 20 },
    );
  } else {
    foreignPositions.push(
      { x: xMid - 40, y: i.minY - 50 },
      { x: xMid, y: i.minY - 80 },
      { x: xMid + 40, y: i.minY - 110 },
      { x: xMid - 20, y: i.minY - 60 },
    );
  }
  const foreigners = foreignPositions.map((p, i2) => ({ id: `foreign${i2}`, x: p.x, y: p.y }));
  scene.setForeigners(foreigners);
  const foreignStart = new Map(foreigners.map((f) => [f.id, { x: f.x, y: f.y }]));

  const stepsLog = [];
  let maxPointerError = 0;
  scene.setDragging(true, held.id);
  for (let s = 1; s <= steps; s += 1) {
    held.fx = start.x + dx * s;
    held.fy = start.y + dy * s;
    held.x = held.fx;
    held.y = held.fy;
    simulation.alpha(0.12);
    for (let t = 0; t < tickPerStep; t += 1) {
      simulation.tick();
      drawOutlines();
    }
    const m = measure(scene);
    m.tick = s;
    m.pointerError = Math.hypot(held.x - held.fx, held.y - held.fy);
    maxPointerError = Math.max(maxPointerError, m.pointerError);
    m.held = { x: held.x, y: held.y };
    stepsLog.push(m);
  }
  scene.setDragging(false, null);
  held.fx = null;
  held.fy = null;
  for (let t = 0; t < 300; t += 1) { simulation.tick(); drawOutlines(); }
  const release = measure(scene);
  release.held = { x: held.x, y: held.y };
  const foreignEnd = new Map(foreigners.map((f) => [f.id, { x: f.x, y: f.y }]));
  return {
    scene, initial, stepsLog, release, held, start, foreigners, foreignStart, foreignEnd,
    maxPointerError, everSwept: new Set(stepsLog.flatMap((s) => s.foreignersInside)),
  };
}

function summary(name, r) {
  const i = r.initial;
  const last = r.stepsLog[r.stepsLog.length - 1];
  const first = r.stepsLog[0];
  console.log(`\n== ${name} ==`);
  console.log(`initial eased extents: x [${i.eased.minX.toFixed(0)}, ${i.eased.maxX.toFixed(0)}]  y [${i.eased.minY.toFixed(0)}, ${i.eased.maxY.toFixed(0)}]`);
  console.log(`held ${r.held.id}: start (${r.start.x.toFixed(0)}, ${r.start.y.toFixed(0)}) -> end (${last.held.x.toFixed(0)}, ${last.held.y.toFixed(0)}); max pointer error ${r.maxPointerError.toFixed(4)}`);
  console.log(`final eased: x [${last.eased.minX.toFixed(0)}, ${last.eased.maxX.toFixed(0)}]  y [${last.eased.minY.toFixed(0)}, ${last.eased.maxY.toFixed(0)}]`);
  console.log(`dragged-side travel: right ${(last.eased.maxX - i.eased.maxX).toFixed(1)}px, down ${(last.eased.maxY - i.eased.maxY).toFixed(1)}px | opposite-side travel: left ${(i.eased.minX - last.eased.minX).toFixed(1)}px, top ${(i.eased.minY - last.eased.minY).toFixed(1)}px`);
  console.log(`ellipse (as the ring force uses it): first min (${first.ellipse.minX.toFixed(1)}, ${first.ellipse.minY.toFixed(1)}) -> last min (${last.ellipse.minX.toFixed(1)}, ${last.ellipse.minY.toFixed(1)}); far-side growth ${(first.ellipse.minX - last.ellipse.minX).toFixed(1)} left, ${(first.ellipse.minY - last.ellipse.minY).toFixed(1)} up`);
  console.log(`containment margins (signed, px): tiles-in-target ${last.tilesMarginTarget.toFixed(2)}, padding-in-target ${last.paddedMarginTarget.toFixed(2)}, tiles-in-EASED ${last.tilesMarginEased.toFixed(2)}, padding-in-EASED ${last.paddedMarginEased.toFixed(2)}`);
  console.log(`foreigners inside at final step: ${last.foreignersInside.length}; ever swept: ${[...r.everSwept].join(',') || 'none'}`);
  console.log(`after release: eased x [${r.release.eased.minX.toFixed(0)}, ${r.release.eased.maxX.toFixed(0)}]  y [${r.release.eased.minY.toFixed(0)}, ${r.release.eased.maxY.toFixed(0)}]; far-side drift vs initial: left ${(i.eased.minX - r.release.eased.minX).toFixed(1)}px, top ${(i.eased.minY - r.release.eased.minY).toFixed(1)}px`);
}

function traceTable(name, r) {
  const i = r.initial;
  console.log(`\n== ${name} — per-step trace (every 5th step) ==`);
  console.log('step held(dx,dy)  eased.minX  eased.maxX  leftTravel  rightTravel  ellipse.minX  tilesIn  swept');
  for (const s of r.stepsLog) {
    if (s.tick % 5 !== 0 && s.tick !== r.stepsLog.length) continue;
    const left = i.eased.minX - s.eased.minX;
    const right = s.eased.maxX - i.eased.maxX;
    console.log(
      `${String(s.tick).padStart(4)} (${(s.held.x - r.start.x).toFixed(0)},${(s.held.y - r.start.y).toFixed(0)})` +
      `  ${s.eased.minX.toFixed(1).padStart(9)}  ${s.eased.maxX.toFixed(1).padStart(9)}` +
      `  ${left.toFixed(1).padStart(9)}  ${right.toFixed(1).padStart(10)}` +
      `  ${s.ellipse.minX.toFixed(1).padStart(11)}  ${s.tilesInside ? 'yes' : 'NO'}  ${s.foreignersInside.length}`,
    );
  }
}

/** Self-verification. The same deterministic scene and markers must show the
 * legacy failure and the corrected success, or the process exits non-zero. */
const failures = [];
function check(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`ASSERT FAIL: ${message}`);
  }
}

// LEGACY path: must fail the way the handoff describes.
const legacyRun = dragScenario({ legacy: true });
summary('LEGACY (Assignment 001 symmetric ellipse): drag m0 diagonal bottom-right 240x200', legacyRun);
{
  const i = legacyRun.initial;
  const last = legacyRun.stepsLog[legacyRun.stepsLog.length - 1];
  const farSideTravel = i.eased.minX - last.eased.minX;
  check(farSideTravel > 50, `legacy far side must sweep outward (>50px), got ${farSideTravel.toFixed(1)}px`);
  check(legacyRun.everSwept.size > 0, `legacy must enclose at least one opposite-side marker, got none`);
}

// CORRECTED path: the same scene must pin the far side, keep the markers out,
// hold the pointer, and contain every member tile.
const correctedRun = dragScenario({});
summary('CORRECTED (anchored ellipse): drag m0 diagonal bottom-right 240x200', correctedRun);
{
  const i = correctedRun.initial;
  const last = correctedRun.stepsLog[correctedRun.stepsLog.length - 1];
  const farSideTravel = i.eased.minX - last.eased.minX;
  // The far side may move within the justified tolerance (ring re-orientation
  // and the drawn outline's resolution), far below the legacy sweep.
  check(farSideTravel < 25, `corrected far side must not move outward beyond 25px, got ${farSideTravel.toFixed(1)}px`);
  check(correctedRun.everSwept.size === 0, `corrected must never enclose the opposite-side markers, got ${[...correctedRun.everSwept].join(',')}`);
  check(correctedRun.maxPointerError < 0.01, `held member must track the pointer, max error ${correctedRun.maxPointerError}`);
  for (const s of correctedRun.stepsLog) {
    check(s.tilesInside && s.tilesInsideEased, `every member tile must stay inside the outline at step ${s.tick}`);
  }
}

// Symmetry: horizontal-only, vertical-only, and opposite-direction drags.
for (const [label, opts] of [
  ['HORIZONTAL drag right 240px', { dx: 6, dy: 0, steps: 40 }],
  ['VERTICAL drag down 200px', { dx: 0, dy: 5, steps: 40 }],
  ['OPPOSITE drag up-left 240x200', { dx: -6, dy: -5, steps: 40 }],
]) {
  const r = dragScenario(opts);
  summary(`CORRECTED: ${label}`, r);
  const i = r.initial;
  const last = r.stepsLog[r.stepsLog.length - 1];
  // For these the far side is the right/bottom (dx<0) or top (dy>0, dx=0).
  const farSideTravel = dxTravel(i, last, opts);
  check(farSideTravel < 25, `corrected far side must not move outward beyond 25px (${label}), got ${farSideTravel.toFixed(1)}px`);
  check(r.everSwept.size === 0, `corrected must never enclose markers (${label})`);
  check(r.maxPointerError < 0.01, `held member must track the pointer (${label})`);
}

function dxTravel(i, last, { dx, dy }) {
  if (dx < 0) return last.eased.maxX - i.eased.maxX;
  if (dx === 0 && dy > 0) return i.eased.minY - last.eased.minY;
  if (dx === 0 && dy < 0) return last.eased.maxY - i.eased.maxY;
  return i.eased.minX - last.eased.minX;
}

// Ablations on the corrected path: the sweep is geometry, not exclusion lag or
// easing.
summary('CORRECTED, ABLATION: exclusion off', dragScenario({ exclusionOn: false }));
summary('CORRECTED, ABLATION: easing off (rate 1)', dragScenario({ easeRate: 1 }));
summary('CORRECTED, ABLATION: member floor off', dragScenario({ floorOn: false }));

traceTable('CORRECTED', correctedRun);

if (failures.length > 0) {
  console.error(`\nHARNESS SELF-VERIFICATION FAILED: ${failures.length} assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nHARNESS SELF-VERIFICATION PASSED: legacy failure reproduced, corrected success proven on the same scene.');
}
