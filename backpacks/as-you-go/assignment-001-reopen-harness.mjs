/** Assignment 001 (reopened) — reproduction and ablation harness.
 *
 * In-repo harness (reported, disposable; named in the WORKER COMPLETION entry).
 * Replicates the app's set-ring composition with the shipped constants and the
 * exact force order from ensureSimulation, so the visible outline behaviour
 * measured here is the behaviour the creator sees. It is NOT production code.
 *
 * Force order (workspace-20260730b.js): cx, cy, charge, collide, link, ring,
 * setGravity, setSeparation, setExclusion. Constants: alphaDecay 0.028,
 * velocityDecay 0.32, collide strength 0.9, RING_NODE_RADIUS 30,
 * RING_LINK_DISTANCE 60, charge -280 / 0, ring padding 40, gravity 0.08/120,
 * separation 0.5/90, exclusion 0.35/150, outline ease rate 0.25, tile 72x72.
 */
import { forceSimulation, forceX, forceY, forceManyBody, forceCollide, forceLink } from 'd3-force';
import {
  reconcileRing, forceRingShape, ringHull, resampleHull,
  memberFloorHull, floorOutline, easeOutline,
} from './public/set-ring-model.js';
import { forceSetGravity, forceSetExclusion, forceSetSeparation } from './public/set-gravity-model.js';

const RING_NODE_RADIUS = 30;
const RING_LINK_DISTANCE = 60;
const PADDING = 40;
const TILE = 72;
const W = 800;
const H = 600;

/** SAT overlap depth between two convex point lists, or null when disjoint.
 * Measurement-only copy of the production hullOverlap, for the visible shapes. */
function satOverlap(a, b) {
  let best = null;
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
      for (const pt of a) { const v = pt.x * axisX + pt.y * axisY; minA = Math.min(minA, v); maxA = Math.max(maxA, v); }
      let minB = Infinity; let maxB = -Infinity;
      for (const pt of b) { const v = pt.x * axisX + pt.y * axisY; minB = Math.min(minB, v); maxB = Math.max(maxB, v); }
      const depth = Math.min(maxA - minB, maxB - minA);
      if (depth <= 0) return null;
      if (!best || depth < best.depth) {
        const flip = (maxB - minA) < (maxA - minB) ? -1 : 1;
        best = { depth, x: axisX * flip, y: axisY * flip };
      }
    }
  }
  return best;
}

function rectTile(id, x, y) {
  return { id, x, y, width: TILE, height: TILE, vx: 0, vy: 0 };
}

/** The screenshot-like scene: one large many-member set, one small lower-left
 * set whose member sits close enough that the padded outlines overlap. */
function buildScene({ large = 12, small = 1, smallAt = { x: 350, y: 430 } } = {}) {
  const nodes = [];
  const members = { A: [], B: [] };
  const cx = W / 2;
  const cy = H / 2;
  // Large set: a compact blob of tiles around the canvas centre.
  for (let i = 0; i < large; i += 1) {
    const angle = (i / large) * Math.PI * 2;
    const radius = 40 + (i % 3) * 34;
    const n = rectTile(`A:${i}`, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    nodes.push(n);
    members.A.push(n);
  }
  // Small set: a single tile lower-left of the blob.
  for (let i = 0; i < small; i += 1) {
    const n = rectTile(`B:${i}`, smallAt.x + i * 90, smallAt.y);
    nodes.push(n);
    members.B.push(n);
  }
  const setIdsOf = new Set(['A', 'B']);
  const nodeSet = new Map(nodes.map((n) => [n.id, n]));

  const membersOf = (setId) => members[setId] ?? [];
  // Effective membership: overrideable so the related/inherited case can be tested.
  const membership = new Map();
  for (const setId of ['A', 'B']) {
    for (const m of members[setId]) membership.set(m.id, setId);
  }

  const setsOf = (nodeId) => {
    if (nodeSet.has(nodeId) && membership.has(nodeId)) return [membership.get(nodeId)];
    return [];
  };

  // Rings, reconciled like the app does (on structural setup, not per frame).
  const rings = new Map();
  const links = [];
  for (const setId of ['A', 'B']) {
    const ring = reconcileRing({ setId, members: membersOf(setId), existing: [], padding: PADDING, linkDistance: RING_LINK_DISTANCE });
    rings.set(setId, ring);
    nodes.push(...ring.nodes);
    links.push(...ring.links);
  }
  const ringBySet = new Map();
  for (const node of nodes) if (node.ring) ringBySet.set(node.id, node);

  return { nodes, links, members, membersOf, setsOf, rings, setIdsOf };
}

/** Builds the d3 simulation with the app's force order. `options` toggles the
 * ablations: hullOn (SAT pass), ringOn (forceRingShape), floorOn (member floor
 * in the drawn outline), memberImpulse (diagnostic: SAT impulse also to members),
 * isHeld (drag anchoring). */
function buildSimulation(scene, {
  hullOn = true,
  ringOn = true,
  floorOn = true,
  memberImpulse = null,
  isHeld = () => false,
  diagnostic = false,
} = {}) {
  const { nodes, links, membersOf, setsOf, rings } = scene;
  const outlines = new Map();
  const targets = new Map();

  // The drawn outline, replicating drawSetRings exactly (per tick).
  const drawOutlines = () => {
    for (const setId of ['A', 'B']) {
      const ring = rings.get(setId);
      const members = membersOf(setId);
      const floor = floorOn ? memberFloorHull(members, PADDING) : null;
      const target = ring ? floorOutline(resampleHull(ringHull(ring.nodes)), floor) : null;
      targets.set(setId, target);
      outlines.set(setId, easeOutline(outlines.get(setId), target));
    }
  };

  const separation = diagnostic
    ? diagnosticSeparation({ setsOf, hullOf: (setId) => outlines.get(setId), memberImpulse, isHeld })
    : forceSetSeparation({
        setsOf,
        ...(hullOn ? { hullOf: (setId) => outlines.get(setId) } : {}),
        isHeld,
      });

  const simulation = forceSimulation(nodes)
    .force('cx', forceX(W / 2).strength(0.05))
    .force('cy', forceY(H / 2).strength(0.05))
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide().radius((n) => (n.ring ? RING_NODE_RADIUS : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', forceLink(links).id((n) => n.id).distance((l) => (l.source.ring ? RING_LINK_DISTANCE : 145)).strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', ringOn ? forceRingShape({ membersOf, padding: PADDING, isDragging: () => false }) : null)
    .force('setGravity', forceSetGravity({ setsOf, isHeld }))
    .force('setSeparation', separation)
    .force('setExclusion', forceSetExclusion({ setsOf, membersOf, hullOf: (setId) => rings.get(setId)?.nodes ?? null, isHeld }))
    .alphaDecay(0.028)
    .velocityDecay(0.32);

  return { simulation, outlines, targets, drawOutlines };
}

/** Measures the two visible outlines and their member floors. */
function measure(scene, outlines, targets) {
  const outlineA = outlines.get('A');
  const outlineB = outlines.get('B');
  const targetA = targets.get('A');
  const targetB = targets.get('B');
  const floorA = memberFloorHull(scene.membersOf('A'), PADDING);
  const floorB = memberFloorHull(scene.membersOf('B'), PADDING);
  const o = satOverlap(outlineA ?? [], outlineB ?? []);
  const t = satOverlap(targetA ?? [], targetB ?? []);
  const f = satOverlap(floorA ?? [], floorB ?? []);
  const membersA = scene.membersOf('A');
  const membersB = scene.membersOf('B');
  const centre = (ms) => {
    if (!ms.length) return null;
    return { x: ms.reduce((s, n) => s + n.x, 0) / ms.length, y: ms.reduce((s, n) => s + n.y, 0) / ms.length };
  };
  const ca = centre(membersA);
  const cb = centre(membersB);
  return {
    tick: 0,
    outlineDepth: o ? o.depth : 0,
    targetDepth: t ? t.depth : 0,
    floorDepth: f ? f.depth : 0,
    outlineDir: o ? { x: o.x, y: o.y } : null,
    distAB: ca && cb ? Math.hypot(ca.x - cb.x, ca.y - cb.y) : null,
    memberA: ca,
    memberB: cb,
  };
}

/** Runs `ticks` of the simulation, drawing outlines and sampling every `every`
 * ticks. Returns the sampled metrics plus final node speeds. */
function run(scene, { ticks = 1500, every = 50, ...options } = {}) {
  const { simulation, outlines, targets, drawOutlines } = buildSimulation(scene, options);
  const samples = [];
  let last = measure(scene, outlines, targets);
  for (let i = 0; i < ticks; i += 1) {
    simulation.tick();
    drawOutlines();
    const m = measure(scene, outlines, targets);
    m.tick = i;
    last = m;
    if (i % every === 0 || i === ticks - 1) samples.push({ ...m });
  }
  const speeds = scene.nodes.filter((n) => n.ring).map((n) => Math.hypot(n.vx, n.vy));
  const maxRingSpeed = Math.max(...speeds);
  const memberSpeeds = scene.nodes.filter((n) => !n.ring).map((n) => Math.hypot(n.vx, n.vy));
  const maxMemberSpeed = Math.max(...memberSpeeds);
  return { samples, last, maxRingSpeed, maxMemberSpeed };
}

/** Diagnostic force: a faithful copy of forceSetSeparation (node pass AND hull
 * pass, anchored policy) with the member impulse toggled, so the ring-only
 * "before" can be measured against the production "after" with every other
 * variable identical. Causal measurement only. */
function diagnosticSeparation({ setsOf, hullOf = () => null, isHeld = () => false, clearance = 90, strength = 0.5, memberImpulse = true }) {
  let nodes = [];
  function force(alpha) {
    const ring = nodes.filter((node) => node.ring);
    if (ring.length < 2) return;
    const membersBySet = new Map();
    for (const node of nodes) {
      if (node.ring) continue;
      for (const setId of setsOf(node.id) ?? []) {
        if (!membersBySet.has(setId)) membersBySet.set(setId, new Set());
        membersBySet.get(setId).add(node);
      }
    }
    const anchored = new Set();
    for (const [setId, members] of membersBySet) {
      for (const member of members) {
        if (isHeld(member.id)) { anchored.add(setId); break; }
      }
    }
    const related = new Set();
    const setIds = [...membersBySet.keys()];
    for (let i = 0; i < setIds.length; i += 1) {
      for (let j = i + 1; j < setIds.length; j += 1) {
        const a = membersBySet.get(setIds[i]);
        const b = membersBySet.get(setIds[j]);
        for (const member of a) {
          if (!b.has(member)) continue;
          related.add(`${setIds[i]} ${setIds[j]}`);
          related.add(`${setIds[j]} ${setIds[i]}`);
          break;
        }
      }
    }
    // Node pass, identical to production (anchored pairs skipped).
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
            if (!(a.id < b.id)) continue;
            if (a.setId === b.setId) continue;
            if (related.has(`${a.setId} ${b.setId}`)) continue;
            if (anchored.has(a.setId) || anchored.has(b.setId)) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            if (distance > clearance || distance < 1e-6) continue;
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
    // Hull pass, with the optional member impulse.
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
    const ids = [...hulls.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (related.has(`${ids[i]} ${ids[j]}`)) continue;
        const overlap = satOverlap(hulls.get(ids[i]), hulls.get(ids[j]));
        if (!overlap) continue;
        const anchoredI = anchored.has(ids[i]);
        const anchoredJ = anchored.has(ids[j]);
        if (anchoredI && anchoredJ) continue;
        let pushI = overlap.depth * strength * alpha;
        let pushJ = pushI;
        if (anchoredI) { pushI = 0; pushJ *= 2; }
        if (anchoredJ) { pushJ = 0; pushI *= 2; }
        const targets = (setId) => (memberImpulse
          ? [...bySet.get(setId), ...(membersBySet.get(setId) ?? [])]
          : bySet.get(setId));
        for (const node of targets(ids[i])) {
          node.vx = (node.vx ?? 0) - (overlap.x * pushI);
          node.vy = (node.vy ?? 0) - (overlap.y * pushI);
        }
        for (const node of targets(ids[j])) {
          node.vx = (node.vx ?? 0) + (overlap.x * pushJ);
          node.vy = (node.vy ?? 0) + (overlap.y * pushJ);
        }
      }
    }
  }
  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Prints a metrics trajectory table. */
function report(name, result) {
  const header = 'tick   easedDepth targetDepth floorDepth  distAB';
  console.log(`\n== ${name} ==`);
  console.log(header);
  for (const s of result.samples) {
    console.log(
      `${String(s.tick).padStart(4)}  ${s.outlineDepth.toFixed(1).padStart(9)}  ${s.targetDepth.toFixed(1).padStart(10)}  ${s.floorDepth.toFixed(1).padStart(9)}  ${s.distAB ? s.distAB.toFixed(0).padStart(7) : '-'}`,
    );
  }
  console.log(`final: eased ${result.last.outlineDepth.toFixed(1)}px, target ${result.last.targetDepth.toFixed(1)}px, floor ${result.last.floorDepth.toFixed(1)}px, distAB ${result.last.distAB?.toFixed(0)}px`);
  console.log(`final ring node max speed ${result.maxRingSpeed.toFixed(4)}, member max speed ${result.maxMemberSpeed.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
// Main runs
// ---------------------------------------------------------------------------
const scene = buildScene();
console.log('scene: A has 12 members clustered at centre, B has 1 member lower-left;');
console.log(`initial member distance A-B centre: ${Math.hypot(scene.membersOf('A').reduce((s, n) => s + n.x, 0) / 12 - scene.membersOf('B')[0].x, scene.membersOf('A').reduce((s, n) => s + n.y, 0) / 12 - scene.membersOf('B')[0].y).toFixed(0)}px`);

// BEFORE: ring-only hull pass (the committed behaviour), full stack.
report('1. BEFORE: ring-only hull pass (committed)', run(scene, { diagnostic: true, memberImpulse: false }));

// BEFORE with the graph link pinning the small set (screenshot signature).
{
  const pinned = buildScene();
  pinned.links.push({ source: 'B:0', target: 'A:0' });
  report('1b. BEFORE (ring-only) with graph link B:0-A:0', run(pinned, { diagnostic: true, memberImpulse: false }));
}

// AFTER: production forceSetSeparation (members + ring, uniform per-set delta).
report('2. AFTER: production force (members+ring impulse)', run(scene, {}));

// AFTER with the graph link.
{
  const pinned = buildScene();
  pinned.links.push({ source: 'B:0', target: 'A:0' });
  report('2b. AFTER (production) with graph link B:0-A:0', run(pinned, {}));
}

// RELATED pair via effective membership (B's member also in A) — exemption must
// survive the correction.
{
  const relatedScene = buildScene();
  const originalSetsOf = relatedScene.setsOf;
  relatedScene.setsOf = (nodeId) => {
    const own = originalSetsOf(nodeId);
    if (own.length === 0) return [];
    if (nodeId.startsWith('B:')) return ['A', 'B'];
    return own;
  };
  report('3. AFTER (production), RELATED (B member inherited into A): Venn preserved', run(relatedScene, {}));
}

// Ablations on the corrected force.
report('4. AFTER, ABLATION: hull pass off', run(scene, { hullOn: false }));
report('5. AFTER, ABLATION: ring-shape force off', run(scene, { ringOn: false }));
report('6. AFTER, ABLATION: member floor off', run(scene, { floorOn: false }));

// Drag scenario: B's member is held (fx pinned). The anchored droplet takes no
// impulse; the unheld droplet A absorbs the separation.
{
  const drag = buildScene();
  const held = drag.membersOf('B')[0];
  held.fx = held.x;
  held.fy = held.y;
  report('7. AFTER, DRAG: B held, A absorbs separation', run(drag, { isHeld: (id) => id === held.id }));
  console.log(`   held B member stayed at (${held.x.toFixed(1)}, ${held.y.toFixed(1)}), fx=${held.fx.toFixed(1)}`);
}

// 8. One-tick trace at the overlapping state (corrected force): members now
// receive the same uniform delta as their ring.
{
  const tscene = buildScene();
  const { simulation, outlines, targets, drawOutlines } = buildSimulation(tscene, {});
  drawOutlines();
  const before = measure(tscene, outlines, targets);
  simulation.tick();
  const ringSpeed = Math.max(...tscene.nodes.filter((n) => n.ring).map((n) => Math.hypot(n.vx, n.vy)));
  const memberSpeed = Math.max(...tscene.nodes.filter((n) => !n.ring).map((n) => Math.hypot(n.vx, n.vy)));
  drawOutlines();
  const after = measure(tscene, outlines, targets);
  console.log(`\n== 8. ONE-TICK TRACE (corrected, initial overlapping state) ==`);
  console.log(`outline overlap before ${before.outlineDepth.toFixed(1)}px -> after ${after.outlineDepth.toFixed(1)}px`);
  console.log(`max ring node speed ${ringSpeed.toFixed(3)}, max member speed ${memberSpeed.toFixed(3)}`);
}

// 9. Cost: production force (members+ring) vs ring-only, per force(0.5) tick.
{
  const { performance } = await import('node:perf_hooks');
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const timeIt = (S, ringNodes, memberCount, ringOnly) => {
    const nodes = [];
    const hulls = new Map();
    for (let s = 0; s < S; s += 1) {
      const cx = s * 300;
      for (let i = 0; i < ringNodes; i += 1) nodes.push({ id: `s${s}:ring:${i}`, setId: `s${s}`, ring: true, x: cx, y: i * 2000, vx: 0, vy: 0 });
      for (let i = 0; i < memberCount; i += 1) nodes.push({ id: `s${s}:m${i}`, x: cx + i * 90, y: 0, vx: 0, vy: 0 });
      hulls.set(`s${s}`, [{ x: cx - 50, y: -200 }, { x: cx + 50, y: -200 }, { x: cx + 50, y: 200 }, { x: cx - 50, y: 200 }]);
    }
    const samples = [];
    for (let w = 0; w < 200; w += 1) {
      const f = ringOnly
        ? diagnosticSeparation({ setsOf: (id) => (id.startsWith('s') ? [id.split(':')[0]] : []), hullOf: (setId) => hulls.get(setId), memberImpulse: false })
        : forceSetSeparation({ setsOf: (id) => (id.startsWith('s') ? [id.split(':')[0]] : []), hullOf: (setId) => hulls.get(setId) });
      f.initialize(nodes.map((n) => ({ ...n })));
      f(0.5);
    }
    for (let w = 0; w < 500; w += 1) {
      const f = ringOnly
        ? diagnosticSeparation({ setsOf: (id) => (id.startsWith('s') ? [id.split(':')[0]] : []), hullOf: (setId) => hulls.get(setId), memberImpulse: false })
        : forceSetSeparation({ setsOf: (id) => (id.startsWith('s') ? [id.split(':')[0]] : []), hullOf: (setId) => hulls.get(setId) });
      f.initialize(nodes.map((n) => ({ ...n })));
      const t0 = performance.now();
      f(0.5);
      samples.push(performance.now() - t0);
    }
    return median(samples);
  };
  console.log(`\n== 9. COST per force(0.5) tick (median of 500 after 200 warm-up; 6 members + 8 ring nodes per set, overlapping hulls) ==`);
  console.log('sets | ring-only | production | member-impulse delta');
  for (const S of [4, 8, 16, 32]) {
    const beforeCost = timeIt(S, 8, 6, true);
    const afterCost = timeIt(S, 8, 6, false);
    console.log(`${String(S).padStart(4)} | ${beforeCost.toFixed(4).padStart(9)}ms | ${afterCost.toFixed(4).padStart(10)}ms | ${(afterCost - beforeCost).toFixed(4).padStart(9)}ms`);
  }
}
