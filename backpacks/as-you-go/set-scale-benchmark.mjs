/** Scale harness for the two systems that became the plausible next ceilings
 * once the region renderer stopped scaling with set count.
 *
 * MEASUREMENT ONLY. Nothing here asserts, and it is deliberately not in
 * `npm test`: hardware-sensitive timings are not correctness assertions. This
 * is the analogue of set-region-work-calibration.mjs.
 *
 *   node set-scale-benchmark.mjs
 *
 * Everything is built through the production constructors rather than through
 * plausible-looking stand-ins, because the first version of this harness got
 * the answer wrong by inventing its own:
 *
 *   - ring nodes come from reconcileRing, which sizes the ring from the ellipse
 *     the shape force actually pulls onto. A fixed 24 per set was roughly twice
 *     what a compact set really gets and well under what a stretched one does,
 *     so the ring-grid cost it reported was not a production number.
 *   - hue input is set centroids plus real region centroids from
 *     createRegionLayout, which is what the solver sees on a draw frame. A
 *     hundred disjoint sets are about two hundred hue entities, not one hundred.
 *   - hue state persists across frames in production, so measuring it cold
 *     measured convergence rather than steady-state cost.
 *   - FOLDER_DISTANCE is imported, not copied, so the harness cannot drift away
 *     from the proximity radius the solver actually uses.
 *
 * What is quadratic, and where:
 *
 *   forceSetSeparation
 *     - ring-node proximity: grid-bucketed on the clearance
 *     - visible-hull SAT:    x-sweep broad phase, then SAT on survivors
 *     (the sets^2 `related` scan and the all-pairs SAT were removed in ce9f563)
 *
 *   assignSpatialFolderHues
 *     - nearPairs build:     spatial nodes^2 outright
 *     - projection:          re-walks nearPairs up to 100 passes
 */
import { forceSetSeparation } from './public/set-gravity-model.js';
import { assignSpatialFolderHues, FOLDER_DISTANCE } from './public/graph-model-20260730b.js';
import {
  reconcileRing, ringHull, resampleHull, memberFloorHull, floorOutline, easeOutline,
} from './public/set-ring-model.js';
import { findNearPairs, groupPairsByComponent } from './public/graph-model-20260730b.js';
import { adjacencyFromPairs, classifyColourability } from './public/hue-colourability.js';
import { createRegionLayout } from './public/set-region-layout.js';
import { regionCentroid } from './public/set-region-model.js';

const SEEDS = [1, 2, 3];
const COUNTS = [16, 32, 64, 128];
const MEMBERS_PER_SET = 6;
const MEMBER_SIZE = 56; // an icon tile, which is what sizes the enclosing ellipse
const RING_PADDING = 40; // reconcileRing's default, and what the floor agrees with
const RING_LINK_DISTANCE = 60; // production spacing; 34 would double the node count
const REPETITIONS = 40;
const WARMUP = 8;

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Deterministic spatial regimes over the same set centres both systems see.
 *
 * `stretched` exists because ring count follows the outline's perimeter: a
 * compact set gets ~13 nodes and a spread-out one ~39 for the same member
 * count, so a scene of large sets is a different question from a scene of many
 * sets. That is geometry driving cost, which is the distinction this whole
 * exercise is about. */
const REGIMES = {
  separated(count, random) {
    const perRow = Math.ceil(Math.sqrt(count));
    return Array.from({ length: count }, (unused, index) => ({
      x: (index % perRow) * 620 + (random() * 20),
      y: Math.floor(index / perRow) * 620 + (random() * 20),
      spread: 45,
    }));
  },
  clustered(count, random) {
    const perCluster = 4;
    const clusters = Math.ceil(count / perCluster);
    const perRow = Math.ceil(Math.sqrt(clusters));
    return Array.from({ length: count }, (unused, index) => {
      const cluster = Math.floor(index / perCluster);
      return {
        x: (cluster % perRow) * 900 + (random() * 150),
        y: Math.floor(cluster / perRow) * 900 + (random() * 150),
        spread: 45,
      };
    });
  },
  // Compact sets, but far more of them per unit area.
  dense(count, random) {
    return Array.from({ length: count }, () => ({
      x: random() * 320,
      y: random() * 320,
      spread: 45,
    }));
  },
  // Sets whose members are spread out, so each ring carries many more nodes.
  // Same count, same clustering, much more real geometry.
  stretched(count, random) {
    const perCluster = 4;
    const clusters = Math.ceil(count / perCluster);
    const perRow = Math.ceil(Math.sqrt(clusters));
    return Array.from({ length: count }, (unused, index) => {
      const cluster = Math.floor(index / perCluster);
      return {
        x: (cluster % perRow) * 1400 + (random() * 200),
        y: Math.floor(cluster / perRow) * 1400 + (random() * 200),
        spread: 260,
      };
    });
  },
};

function buildScene(count, regime, seed) {
  const random = lcg(seed);
  const centres = REGIMES[regime](count, random);
  const setIds = centres.map((unused, index) => `set:${String(index).padStart(3, '0')}`);

  const nodes = [];
  const membership = new Map();
  const hulls = new Map();
  const ringCounts = [];

  centres.forEach((centre, index) => {
    const setId = setIds[index];
    const members = Array.from({ length: MEMBERS_PER_SET }, (unused, m) => {
      const angle = (m / MEMBERS_PER_SET) * Math.PI * 2;
      const id = `${setId}:member:${m}`;
      membership.set(id, [setId]);
      return {
        id,
        x: centre.x + (Math.cos(angle) * centre.spread),
        y: centre.y + (Math.sin(angle) * centre.spread),
        width: MEMBER_SIZE,
        height: MEMBER_SIZE,
        vx: 0,
        vy: 0,
      };
    });
    nodes.push(...members);

    // The production ring, sized from the ellipse the shape force pulls onto.
    const ring = reconcileRing({
      setId,
      members,
      padding: RING_PADDING,
      linkDistance: RING_LINK_DISTANCE,
    });
    ringCounts.push(ring.nodes.length);
    nodes.push(...ring.nodes);
    // The outline production actually hands forceSetSeparation and the region
    // layout, built through the same chain drawSetRings uses:
    //
    //   ringHull -> resampleHull -> floorOutline(memberFloorHull) -> easeOutline
    //
    // An earlier version of this harness passed the raw ring polygon instead.
    // That skips the member floor, which widens the outline to enclose the icons
    // themselves, and skips the resample that fixes the vertex count — so both
    // the shape and its size were wrong, and the hull pass was measured against
    // geometry production never produces.
    const floor = memberFloorHull(members, RING_PADDING);
    const target = floorOutline(resampleHull(ringHull(ring.nodes)), floor);
    // Settled: easing from nothing returns the target, and easing again leaves a
    // converged outline where it is. Production passes the eased result, never
    // the target directly, so this goes through the same call.
    hulls.set(setId, easeOutline(easeOutline(null, target), target));
  });

  return { nodes, membership, hulls, setIds, centres, ringCounts };
}

const resetVelocities = (nodes) => {
  for (const node of nodes) {
    node.vx = 0;
    node.vy = 0;
  }
};

function timeIt(run) {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
  };
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The hue solver's real input on a draw frame: one node per set outline, plus
 * one per region the layout produced. Disjoint sets contribute a region each,
 * so the entity count is roughly double the set count before folders. */
function hueNodes(scene) {
  const layout = createRegionLayout();
  const regions = layout.update([...scene.hulls].map(([id, outline]) => ({ id, outline })));
  const setNodes = scene.centres.map((centre, index) => ({
    id: scene.setIds[index],
    x: centre.x,
    y: centre.y,
  }));
  // regionCentroid, not a point average: it is what syncSetRegions stores as
  // shape.center and hands the hue solver, and it is area-weighted.
  const regionNodes = regions
    .map((region) => ({ id: `region:${region.id}`, centre: regionCentroid(region) }))
    .filter(({ centre }) => centre && Number.isFinite(centre.x) && Number.isFinite(centre.y))
    .map(({ id, centre }) => ({ id, x: centre.x, y: centre.y }));
  return { nodes: [...setNodes, ...regionNodes], regionCount: regionNodes.length };
}

const countNearPairs = (nodes) => {
  let pairs = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < FOLDER_DISTANCE) pairs += 1;
    }
  }
  return pairs;
};

function measure(count, regime, seed) {
  const scene = buildScene(count, regime, seed);
  const setsOf = (id) => scene.membership.get(id) ?? [];

  const separationForce = forceSetSeparation({ setsOf, hullOf: (setId) => scene.hulls.get(setId) });
  separationForce.initialize(scene.nodes);
  const separation = timeIt(() => {
    resetVelocities(scene.nodes);
    separationForce(1);
  });

  const nodeOnly = forceSetSeparation({ setsOf });
  nodeOnly.initialize(scene.nodes);
  const nodePhase = timeIt(() => {
    resetVelocities(scene.nodes);
    nodeOnly(1);
  });

  const { nodes: spatial, regionCount } = hueNodes(scene);

  // Settled: state persists and has already converged, which is what a workspace
  // sitting still actually costs.
  const settledColors = new Map();
  const settledState = new Map();
  for (let i = 0; i < 30; i += 1) {
    assignSpatialFolderHues(spatial, settledColors, { cx: 0, cy: 0 }, settledState);
  }
  const settledHue = timeIt(() => {
    assignSpatialFolderHues(spatial, settledColors, { cx: 0, cy: 0 }, settledState);
  });

  // Moving: same persistent maps, but the scene drifts every frame so the set
  // drift and projection paths keep doing real work.
  const movingColors = new Map();
  const movingState = new Map();
  const movingNodes = spatial.map((node) => ({ ...node }));
  for (let i = 0; i < 30; i += 1) {
    assignSpatialFolderHues(movingNodes, movingColors, { cx: 0, cy: 0 }, movingState);
  }
  let frame = 0;
  const movingHue = timeIt(() => {
    frame += 1;
    const dx = Math.cos(frame * 0.37) * 1.5;
    const dy = Math.sin(frame * 0.37) * 1.5;
    for (const node of movingNodes) {
      node.x += dx;
      node.y += dy;
    }
    assignSpatialFolderHues(movingNodes, movingColors, { cx: 0, cy: 0 }, movingState);
  });

  // H0: what the solver actually did on one settled frame. The sink is only
  // passed here; production calls omit it and compute none of this.
  const diagnostics = {};
  assignSpatialFolderHues(spatial, settledColors, { cx: 0, cy: 0 }, settledState, diagnostics);

  // Certificate coverage over the same components projection just worked on.
  const classification = { feasible: 0, infeasible: 0, unknown: 0, byCertificate: {}, work: 0 };
  for (const componentPairs of groupPairsByComponent(findNearPairs(spatial))) {
    const verdict = classifyColourability(adjacencyFromPairs(componentPairs));
    classification[verdict.verdict] += 1;
    classification.byCertificate[verdict.certificate] = (classification.byCertificate[verdict.certificate] ?? 0) + 1;
    classification.work += verdict.work;
  }

  return {
    count,
    regime,
    seed,
    diagnostics,
    classification,
    ringTotal: scene.ringCounts.reduce((sum, value) => sum + value, 0),
    ringMedian: median(scene.ringCounts),
    ringMax: Math.max(...scene.ringCounts),
    regionCount,
    spatialNodes: spatial.length,
    nearPairs: countNearPairs(spatial),
    separation,
    nodePhase,
    settledHue,
    movingHue,
  };
}

const pad = (value, width) => String(value).padStart(width);
const ms = (value) => value.toFixed(3);

console.log(`seeds ${SEEDS.join(', ')} | ${MEMBERS_PER_SET} members of ${MEMBER_SIZE}px per set`);
console.log(`rings from reconcileRing (padding ${RING_PADDING}, linkDistance ${RING_LINK_DISTANCE})`);
console.log(`hue input = set centroids + region centroids | FOLDER_DISTANCE ${FOLDER_DISTANCE} imported`);
console.log(`${REPETITIONS} reps after ${WARMUP} warm-up, hue state persistent and pre-converged\n`);
console.log('sets regime     ring/set ringTot regions spatial nearPr | separation med/p95 | nodePh | hullSAT | hueSettled | hueMoving | combined');

const rows = [];
for (const count of COUNTS) {
  for (const regime of ['separated', 'clustered', 'dense', 'stretched']) {
    for (const seed of SEEDS) {
      const row = measure(count, regime, seed);
      rows.push(row);
      const hullSat = row.separation.median - row.nodePhase.median;
      console.log(
        pad(row.count, 4),
        regime.padEnd(10),
        pad(`${row.ringMedian}/${row.ringMax}`, 8),
        pad(row.ringTotal, 7),
        pad(row.regionCount, 7),
        pad(row.spatialNodes, 7),
        pad(row.nearPairs, 6),
        '|',
        pad(ms(row.separation.median), 7),
        pad(ms(row.separation.p95), 7),
        '|',
        pad(ms(row.nodePhase.median), 6),
        '|',
        pad(ms(hullSat), 7),
        '|',
        pad(ms(row.settledHue.median), 10),
        '|',
        pad(ms(row.movingHue.median), 9),
        '|',
        pad(ms(row.separation.median + row.movingHue.median), 8),
      );
    }
  }
}

console.log();
console.log('H0 hue solver diagnostics, one settled frame per scene:');
console.log('sets regime     entities possPr nearPr | comps maxComp maxEdge dens | maxPass compPass  pairVisits | certified | fbComps slots');
for (const row of rows) {
  const d = row.diagnostics;
  const comps = d.nearComponents ?? [];
  const biggest = comps.reduce((best, c) => (best && best.size >= c.size ? best : c), null);
  const slots = [...new Set((d.fallbackComponents ?? []).map((c) => c.slotCount))].sort((a, b) => a - b);
  console.log(
    pad(row.count, 4),
    row.regime.padEnd(10),
    pad(d.spatialEntities, 8),
    pad(d.possiblePairs, 6),
    pad(d.nearPairs, 6),
    '|',
    pad(comps.length, 5),
    pad(biggest?.size ?? 0, 7),
    pad(biggest?.edges ?? 0, 7),
    pad((biggest?.density ?? 0).toFixed(2), 4),
    '|',
    pad(d.projectionMaxPasses, 7),
    pad(d.projectionComponentPasses, 8),
    pad(d.projectionPairVisits, 11),
    '|',
    pad(d.certifiedInfeasibleComponents ?? 0, 9),
    '|',
    pad((d.fallbackComponents ?? []).length, 7),
    pad(slots.join('/') || '-', 5),
  );
}

console.log();
console.log('H3A colourability certificates per scene (measurement only, no bypass):');
console.log('sets regime      comps | feasible infeasible unknown | certificates                | work');
for (const row of rows) {
  const c = row.classification;
  const comps = c.feasible + c.infeasible + c.unknown;
  const certs = Object.entries(c.byCertificate)
    .map(([name, n]) => name + ':' + n)
    .join(' ');
  console.log(
    pad(row.count, 4),
    row.regime.padEnd(10),
    pad(comps, 6),
    '|',
    pad(c.feasible, 8),
    pad(c.infeasible, 10),
    pad(c.unknown, 7),
    '|',
    (certs || '-').padEnd(27),
    '|',
    pad(c.work, 8),
  );
}

console.log('\nworst combined median (separation + moving hue) per count and regime:');
for (const count of COUNTS) {
  for (const regime of ['separated', 'clustered', 'dense', 'stretched']) {
    const matching = rows.filter((row) => row.count === count && row.regime === regime);
    const worst = Math.max(...matching.map((row) => row.separation.median + row.movingHue.median));
    console.log(`  ${pad(count, 4)} ${regime.padEnd(10)} ${ms(worst)}ms`);
  }
}
