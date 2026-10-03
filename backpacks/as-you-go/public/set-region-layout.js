import {
  boundsOverlap,
  intersectConvex,
  normalizePolygon,
  polygonBounds,
  signedArea,
} from './set-region-model.js';
import { decomposeArrangement } from './set-region-arrangement.js';

const EPSILON = 1e-7;

/** How much geometric work one overlapping component may cost before its exact
 * arrangement is abandoned for the layered fallback.
 *
 * This replaces the set-count ceiling that stood here. Cardinality was never
 * the thing that made a component expensive — geometry was. Over a 140-sample
 * corpus spanning 2 to 8 sets and five overlap densities
 * (set-region-work-calibration.mjs), correlation with elapsed time was:
 *
 *   clipping operations  r = 0.9984
 *   vertices processed   r = 0.9977
 *   fragments generated  r = 0.9946
 *   peak live fragments  r = 0.9337
 *   output vertices      r = 0.9312
 *   set count            r = 0.7338   <- the weakest predictor by a wide margin
 *
 * Only one dimension is enforced (all of these are deterministic work
 * estimates, not measurements of what the loops actually visit): several unrelated ceilings would be several
 * things to get wrong, and the rest of the ledger stays measured and available
 * for recalibration. Clips and vertices are statistically indistinguishable
 * here and both separate cleanly, but vertices also carries the size of what is
 * being clipped, so it stays honest if fragment complexity ever changes.
 * Fragment counts, by contrast, do NOT separate: at a 4ms target their safe and
 * over-budget ranges overlap, which is why peak live fragments is recorded for
 * allocation pressure but never used as the time gate.
 *
 * 210,000 is the <=4ms band: the highest vertex count that stayed within 4ms was
 * 200,577 and the lowest that exceeded it was 218,508, so the threshold sits in
 * a clean gap rather than splitting a contested range. Four milliseconds keeps
 * regions to about a quarter of a 16.7ms frame, leaving the rest for physics,
 * hue solving, effects and the DOM write.
 *
 * The consequence worth stating plainly, on production-resolution outlines: a
 * twelve-set sparse chain costs 152k vertices and stays exact, while a six-set
 * dense pile costs 536k and degrades. The old set-count rule would have rejected
 * the first and accepted the second. */
export const DEFAULT_WORK_BUDGET = Object.freeze({ vertices: 210_000 });

/** Bounding boxes are only the broad phase. Two outlines lying diagonally to
 * each other have intersecting boxes and no common area, and must not be joined
 * into one component — so the pair is confirmed with a real convex clip. */
function overlaps(first, second) {
  if (!boundsOverlap(first.bounds, second.bounds)) return false;
  const lens = intersectConvex(first.outline, second.outline);
  return lens.length >= 3 && Math.abs(signedArea(lens)) > EPSILON;
}

/** Sweeps on x so separated sets never pay for each other: once a candidate
 * starts to the right of where the current set ends, neither it nor anything
 * after it can touch. */
export function overlapPairs(sets) {
  const order = sets.map((_, index) => index)
    .sort((a, b) => sets[a].bounds.minX - sets[b].bounds.minX);
  const pairs = [];
  for (let i = 0; i < order.length; i += 1) {
    const current = sets[order[i]];
    for (let j = i + 1; j < order.length; j += 1) {
      const candidate = sets[order[j]];
      if (candidate.bounds.minX > current.bounds.maxX) break;
      if (overlaps(current, candidate)) pairs.push([order[i], order[j]]);
    }
  }
  return pairs;
}

/** Overlap is transitive for grouping: A-B and B-C put A and C in one component
 * even where A and C never touch, because C's boundary still cuts cells that A
 * helped create. */
export function connectedComponents(count, pairs) {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  for (const [a, b] of pairs) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }
  const grouped = new Map();
  for (let index = 0; index < count; index += 1) {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(index);
  }
  return [...grouped.values()];
}

const singleSetRegion = (set) => ({
  id: set.id,
  setIds: [set.id],
  polygons: [set.outline],
});

/** Cache keys compare at the precision the renderer actually draws — regionPath
 * emits two decimals — so sub-pixel physics jitter does not rebuild geometry.
 * The polygons handed to decomposition stay full precision. */
const geometryKeyFor = (members) => members
  .map((set) => `${set.id}:${set.outline.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join('|')}`)
  .join(';');

/** Turns live set outlines into the flat region list the renderer already
 * consumes, computing exact Venn geometry only where sets genuinely overlap and
 * caching each overlap component separately, so a set moving in one cluster
 * leaves every other cluster's region objects untouched. */
export function createRegionLayout({
  budget = DEFAULT_WORK_BUDGET,
  arrange = decomposeArrangement,
} = {}) {
  const cache = new Map();

  function regionsFor(members) {
    // A lone set is its own region: no clipping, no arrangement at all. This is
    // what keeps a workspace of separated sets linear.
    if (members.length === 1) return [singleSetRegion(members[0])];
    const attempt = arrange(members.map(({ id, outline }) => ({ id, outline })), { budget });
    if (attempt.status === 'exact') return attempt.regions;
    // The component cost more than its budget. Fall back to one translucent
    // body per set rather than returning nothing — the eleventh set used to make
    // every region vanish. The arrangement aborts atomically, so there is never
    // a half-built partition to leak here. These ids match what the same sets
    // produce when they are apart, so hues and effect ownership survive the
    // transition in both directions.
    return members.map(singleSetRegion);
  }

  return {
    update(inputSets) {
      const sets = (inputSets ?? [])
        .map((set) => ({ id: String(set.id), outline: normalizePolygon(set.outline) }))
        .filter((set) => set.outline.length >= 3)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((set) => ({ ...set, bounds: polygonBounds(set.outline) }));
      if (sets.length === 0) {
        cache.clear();
        return [];
      }

      const components = connectedComponents(sets.length, overlapPairs(sets));
      const live = new Set();
      const regions = [];
      for (const indices of components) {
        const members = indices
          .map((index) => sets[index])
          .sort((a, b) => a.id.localeCompare(b.id));
        const componentId = members.map((set) => set.id).join('|');
        const geometryKey = geometryKeyFor(members);
        live.add(componentId);
        const cached = cache.get(componentId);
        if (cached && cached.geometryKey === geometryKey) {
          regions.push(...cached.regions);
          continue;
        }
        const produced = regionsFor(members);
        cache.set(componentId, { geometryKey, regions: produced });
        regions.push(...produced);
      }
      for (const componentId of [...cache.keys()]) {
        if (!live.has(componentId)) cache.delete(componentId);
      }
      return regions.sort((a, b) => a.id.localeCompare(b.id));
    },
    /** Test and diagnostic seam: how many components are currently cached. */
    componentCount() {
      return cache.size;
    },
  };
}
