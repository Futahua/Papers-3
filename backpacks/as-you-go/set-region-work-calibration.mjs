/** Calibration harness for the region arrangement's work budget.
 *
 * Phase 3A deliberately separates measuring from deciding: this collects a
 * corpus of (work counters, elapsed time) pairs across set counts and overlap
 * densities, then reports which deterministic counter actually predicts
 * runtime. The production budget in Checkpoint 3B is chosen from these numbers
 * rather than guessed, and elapsed time appears only here — never in the
 * algorithm, where it would make behaviour depend on machine and load.
 *
 *   node set-region-work-calibration.mjs
 */
import { decomposeArrangement } from './public/set-region-arrangement.js';

const VERTICES = 48; // what resampleHull produces in production

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Convex by construction: sorted angles on a circle under an affine map. */
function convexBlob(random, spread) {
  const angles = Array.from({ length: VERTICES }, (_, index) => (index / VERTICES) * Math.PI * 2);
  const scaleX = 80 + (random() * 40);
  const scaleY = 80 + (random() * 40);
  const rotation = random() * Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = random() * spread;
  const cy = random() * spread;
  return angles.map((angle) => {
    const x = scaleX * Math.cos(angle);
    const y = scaleY * Math.sin(angle);
    return { x: cx + (x * cos) - (y * sin), y: cy + (x * sin) + (y * cos) };
  });
}

const buildSets = (count, spread, seed) => {
  const random = lcg(seed);
  return Array.from({ length: count }, (_, index) => ({
    id: `S${index}`,
    outline: convexBlob(random, spread),
  }));
};

function measure(sets) {
  for (let i = 0; i < 5; i += 1) decomposeArrangement(sets); // warm
  const runs = [];
  let result = null;
  for (let i = 0; i < 15; i += 1) {
    const started = process.hrtime.bigint();
    result = decomposeArrangement(sets);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  runs.sort((a, b) => a - b);
  return { result, ms: runs[Math.floor(runs.length / 2)] };
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

const COUNTERS = ['clips', 'fragments', 'vertices', 'peakFragments', 'outputVertices'];
const rows = [];

// Dense to sparse. At spread 40 the blobs sit almost on top of each other; at
// 700 they barely touch, which is what separates geometry from cardinality.
for (const count of [2, 3, 4, 5, 6, 7, 8]) {
  for (const spread of [40, 90, 160, 300, 700]) {
    for (const seed of [1, 2, 3]) {
      const sets = buildSets(count, spread, seed);
      const { result, ms } = measure(sets);
      if (result.status !== 'exact') continue;
      rows.push({
        count,
        spread,
        regions: result.regions.length,
        ms,
        ...result.work,
      });
    }
  }
}

console.log('sets spread regions     clips  fragments   vertices  peakFrag  outVerts     ms');
for (const row of rows) {
  console.log(
    String(row.count).padStart(4),
    String(row.spread).padStart(6),
    String(row.regions).padStart(7),
    String(row.clips).padStart(9),
    String(row.fragments).padStart(10),
    String(row.vertices).padStart(10),
    String(row.peakFragments).padStart(9),
    String(row.outputVertices).padStart(9),
    row.ms.toFixed(3).padStart(6),
  );
}

const times = rows.map((row) => row.ms);
console.log('\ncorrelation with elapsed time (Pearson r over %d samples)', rows.length);
const ranked = COUNTERS
  .map((counter) => ({ counter, r: pearson(rows.map((row) => row[counter]), times) }))
  .sort((a, b) => b.r - a.r);
for (const { counter, r } of ranked) {
  console.log(`  ${counter.padEnd(16)} r = ${r.toFixed(4)}`);
}
console.log(`  ${'set count'.padEnd(16)} r = ${pearson(rows.map((row) => row.count), times).toFixed(4)}`);

// What budget on the best predictor corresponds to a chosen frame cost?
const best = ranked[0].counter;
console.log(`\nbest predictor: ${best}`);
for (const target of [2, 4, 6, 8]) {
  const under = rows.filter((row) => row.ms <= target);
  const over = rows.filter((row) => row.ms > target);
  if (!under.length || !over.length) continue;
  const highestSafe = Math.max(...under.map((row) => row[best]));
  const lowestUnsafe = Math.min(...over.map((row) => row[best]));
  console.log(
    `  <= ${target}ms: highest safe ${best} = ${highestSafe}, `
    + `lowest over-budget ${best} = ${lowestUnsafe}`
    + (lowestUnsafe > highestSafe ? '  (cleanly separated)' : '  (OVERLAPPING — poor predictor)'),
  );
}
