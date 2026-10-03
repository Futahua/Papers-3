import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decomposeArrangement,
  createWorkLedger,
  UNLIMITED_BUDGET,
} from './public/set-region-arrangement.js';
import {
  intersectConvex,
  normalizePolygon,
  regionArea,
  regionCentroid,
  signedArea,
} from './public/set-region-model.js';

const EPSILON = 1e-6;

const square = (x, y, size = 10) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

const circle = (cx, cy, radius, count = 48) => Array.from({ length: count }, (_, index) => {
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
});

/** Deterministic PRNG: fuzz cases must be reproducible from the seed alone,
 * and Math.random would make a red run unrepeatable. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Random *convex* outline, which is the arrangement's precondition and what
 * resampleHull always hands it in production.
 *
 * Points at sorted angles on a circle are convex; an affine map — scale, then
 * rotate, then translate — preserves convexity, so this stays convex while
 * still producing ellipses at arbitrary orientations rather than plain discs.
 * Jittering each vertex's radius instead, which is the obvious thing to write,
 * does NOT stay convex: a short radius between two long ones is a reflex
 * corner, and feeding that in makes a correct arrangement look broken. */
function randomConvex(random, { count = 12, spread = 90 } = {}) {
  const angles = Array.from({ length: count }, () => random() * Math.PI * 2)
    .sort((a, b) => a - b);
  const scaleX = 40 + (random() * 50);
  const scaleY = 40 + (random() * 50);
  const rotation = random() * Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Centres are packed inside a span comparable to the radii, so overlaps —
  // including three- and four-deep ones — are the common case rather than a
  // lucky accident. Scattered centres made an earlier version of this fuzz pass
  // trivially on mostly disjoint shapes.
  const cx = random() * spread;
  const cy = random() * spread;
  return angles.map((angle) => {
    const x = scaleX * Math.cos(angle);
    const y = scaleY * Math.sin(angle);
    return { x: cx + (x * cos) - (y * sin), y: cy + (x * sin) + (y * cos) };
  });
}

/** Guards the generator itself. Without this a future bad fixture would surface
 * as an arrangement failure, which is exactly the wrong place to look. */
function assertConvex(outline, label) {
  const polygon = normalizePolygon(outline);
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const c = polygon[(index + 2) % polygon.length];
    const cross = ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
    assert.ok(cross > -1e-9, `${label}: fixture is not convex at vertex ${index}`);
  }
}

const polygonArea = (polygon) => Math.abs(signedArea(polygon));

const overlapArea = (first, second) => {
  const lens = intersectConvex(first, second);
  return lens.length >= 3 ? polygonArea(lens) : 0;
};

/** Strictly inside test for a CCW convex outline. Points are chosen off-lattice
 * by the samplers below so boundary ties do not arise. */
function insideConvex(polygon, point) {
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (((b.x - a.x) * (point.y - a.y)) - ((b.y - a.y) * (point.x - a.x)) < 0) return false;
  }
  return true;
}

const regionHolding = (regions, point) => {
  const hits = regions.filter((region) => region.polygons.some((polygon) => insideConvex(polygon, point)));
  return hits;
};

/** Ground truth straight from the source outlines, independent of either
 * implementation — this is what stops the comparison being circular. */
const trueMask = (sets, point) => sets
  .filter((set) => insideConvex(normalizePolygon(set.outline), point))
  .map((set) => set.id)
  .sort()
  .join('|');

/** Samples on an irrational-ish offset so no sample lands on a fixture edge. */
function* samplePoints(sets, step = 1.7) {
  const all = sets.flatMap((set) => set.outline);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  for (let x = minX + 0.317183; x < maxX; x += step) {
    for (let y = minY + 0.412379; y < maxY; y += step) yield { x, y };
  }
}

/** The invariants a correct planar partition must satisfy, checked without
 * reference to any particular fragment decomposition. */
function assertPartitionInvariants(regions, label) {
  for (const region of regions) {
    for (const polygon of region.polygons) {
      assert.ok(polygonArea(polygon) > EPSILON, `${label}: ${region.id} has a degenerate fragment`);
    }
    for (let i = 0; i < region.polygons.length; i += 1) {
      for (let j = i + 1; j < region.polygons.length; j += 1) {
        assert.ok(
          overlapArea(region.polygons[i], region.polygons[j]) <= EPSILON,
          `${label}: ${region.id} fragments ${i} and ${j} overlap`,
        );
      }
    }
  }
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      for (const first of regions[i].polygons) {
        for (const second of regions[j].polygons) {
          assert.ok(
            overlapArea(first, second) <= EPSILON,
            `${label}: regions ${regions[i].id} and ${regions[j].id} overlap`,
          );
        }
      }
    }
  }
}

/** Expected values are fixed and independently checkable, not borrowed from a
 * second implementation. Two 10x10 squares offset by 5 cover 150; a 20x20 with
 * a 10x10 inside it covers 400; a disjoint pair covers 200. */
const FIXTURES = [
  {
    name: 'two overlapping squares',
    sets: [{ id: 'A', outline: square(0, 0) }, { id: 'B', outline: square(5, 0) }],
    ids: ['A', 'A|B', 'B'],
    unionArea: 150,
  },
  {
    name: 'three overlapping squares with a common centre',
    sets: [
      { id: 'A', outline: square(0, 0) },
      { id: 'B', outline: square(5, 0) },
      { id: 'C', outline: square(2, 4) },
    ],
    ids: ['A', 'A|B', 'A|B|C', 'A|C', 'B', 'B|C', 'C'],
    unionArea: 190,
  },
  {
    name: 'nested squares',
    sets: [{ id: 'A', outline: square(0, 0, 20) }, { id: 'B', outline: square(5, 5, 10) }],
    ids: ['A', 'A|B'],
    unionArea: 400,
  },
  {
    name: 'four overlapping production-resolution outlines',
    sets: ['A', 'B', 'C', 'D'].map((id, index) => ({
      id,
      outline: circle(index * 60, (index % 2) * 40, 100),
    })),
    ids: ['A', 'A|B', 'A|B|C', 'A|B|C|D', 'A|C', 'B', 'B|C', 'B|C|D', 'B|D', 'C', 'C|D', 'D'],
    unionArea: 72641.9416,
  },
  {
    name: 'disjoint pair',
    sets: [{ id: 'A', outline: square(0, 0) }, { id: 'B', outline: square(100, 0) }],
    ids: ['A', 'B'],
    unionArea: 200,
  },
];

test('known fixtures produce their expected memberships', () => {
  for (const { name, sets, ids } of FIXTURES) {
    const arrangement = decomposeArrangement(sets);
    assert.equal(arrangement.status, 'exact', name);
    assert.deepEqual(arrangement.regions.map(({ id }) => id), ids, `${name}: memberships changed`);
    // setIds must agree with the id it is keyed by, or the hue solver and the
    // renderer would disagree about what a region belongs to.
    for (const region of arrangement.regions) {
      assert.equal(region.setIds.join('|'), region.id, `${name}: ${region.id} setIds disagree with its id`);
    }
  }
});

test('the arrangement produces a true partition', () => {
  for (const { name, sets } of FIXTURES) {
    assertPartitionInvariants(decomposeArrangement(sets).regions, name);
  }
});

/** The strongest check here, and the one that needs no second implementation:
 * every interior sample is classified straight from the source outlines, and
 * the region covering that point must carry exactly that membership. */
test('interior points classify to the membership their source outlines imply', () => {
  for (const { name, sets } of FIXTURES) {
    const regions = decomposeArrangement(sets).regions;
    let covered = 0;
    for (const point of samplePoints(sets)) {
      const expected = trueMask(sets, point);
      const holding = regionHolding(regions, point);
      if (expected === '') {
        // Outside every set: nothing may claim it.
        assert.equal(holding.length, 0, `${name}: a region covered empty space`);
        continue;
      }
      covered += 1;
      assert.equal(holding.length, 1, `${name}: ${expected} covered ${holding.length} times`);
      assert.equal(holding[0].id, expected, `${name}: point misclassified as ${holding[0].id}`);
    }
    assert.ok(covered > 20, `${name}: only ${covered} interior samples, fixture is not exercising much`);
  }
});

test('region areas sum to the union of the source sets', () => {
  for (const { name, sets, unionArea } of FIXTURES) {
    const regions = decomposeArrangement(sets).regions;
    const total = regions.reduce((sum, region) => sum + regionArea(region), 0);
    assert.ok(
      Math.abs(total - unionArea) < 1e-3,
      `${name}: union area ${total} but expected ${unionArea}`,
    );
    // Independent of the fixed figure above: the union can never exceed the sum
    // of the parts, nor be smaller than the largest single set.
    const sumOfSets = sets.reduce((sum, set) => sum + polygonArea(normalizePolygon(set.outline)), 0);
    assert.ok(total <= sumOfSets + EPSILON, `${name}: union ${total} exceeds sum of sets ${sumOfSets}`);
    const largest = Math.max(...sets.map((set) => polygonArea(normalizePolygon(set.outline))));
    assert.ok(total >= largest - EPSILON, `${name}: union ${total} smaller than its largest member`);
  }
});

test('fuzzed convex outlines keep every partition invariant', () => {
  let deepest = 0;
  let seedsWithOverlap = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = lcg(seed);
    // Driven by the seed rather than the stream, so set count is actually
    // varied — deriving it from the first draw happened to yield 2 every time.
    const count = 2 + (seed % 4);
    const sets = Array.from({ length: count }, (_, index) => ({
      id: `S${index}`,
      outline: randomConvex(random),
    }));
    for (const set of sets) assertConvex(set.outline, `fuzz seed ${seed} ${set.id}`);
    const result = decomposeArrangement(sets);
    assert.equal(result.status, 'exact', `seed ${seed}`);
    assertPartitionInvariants(result.regions, `fuzz seed ${seed}`);

    // Classified against the source outlines rather than a second engine, so
    // this stays a real check now that the mask enumerator is gone. A coarser
    // step than the fixture sweep: these shapes span ~200 units and there are
    // forty of them.
    for (const point of samplePoints(sets, 11.3)) {
      const expected = trueMask(sets, point);
      const holding = regionHolding(result.regions, point);
      if (expected === '') {
        assert.equal(holding.length, 0, `seed ${seed}: a region covered empty space`);
        continue;
      }
      assert.equal(holding.length, 1, `seed ${seed}: ${expected} covered ${holding.length} times`);
      assert.equal(holding[0].id, expected, `seed ${seed}: point misclassified as ${holding[0].id}`);
    }

    const memberships = result.regions.map((region) => region.setIds.length);
    deepest = Math.max(deepest, ...memberships);
    if (memberships.some((depth) => depth > 1)) seedsWithOverlap += 1;
  }
  // The corpus has to contain what it claims to test. A fuzz run over mostly
  // disjoint shapes proves almost nothing about a Venn decomposition.
  assert.ok(deepest >= 4, `deepest membership was only ${deepest}`);
  assert.ok(seedsWithOverlap >= 30, `only ${seedsWithOverlap}/40 seeds overlapped at all`);
});

test('the work ledger is deterministic across repeated runs', () => {
  const sets = ['A', 'B', 'C'].map((id, index) => ({ id, outline: circle(index * 60, 0, 100) }));
  const runs = Array.from({ length: 5 }, () => decomposeArrangement(sets).work);
  for (const run of runs) assert.deepEqual(run, runs[0]);
  assert.ok(runs[0].clips > 0 && runs[0].vertices > 0 && runs[0].peakFragments > 0);
});

test('an exhausted budget aborts atomically with no partial arrangement', () => {
  const sets = [{ id: 'A', outline: square(0, 0) }, { id: 'B', outline: square(5, 0) }];
  const starved = decomposeArrangement(sets, { budget: { clips: 1 } });
  assert.equal(starved.status, 'budget-exceeded');
  assert.equal(starved.regions, undefined, 'a tripped budget must expose no geometry at all');
  assert.ok(starved.work.clips > 0);

  const generous = decomposeArrangement(sets, { budget: UNLIMITED_BUDGET });
  assert.equal(generous.status, 'exact');
  assert.deepEqual(generous.regions.map(({ id }) => id), ['A', 'A|B', 'B']);
});

test('each budget dimension can trip independently', () => {
  const sets = ['A', 'B', 'C'].map((id, index) => ({ id, outline: circle(index * 60, 0, 100) }));
  const full = decomposeArrangement(sets).work;
  for (const dimension of ['clips', 'fragments', 'vertices', 'peakFragments']) {
    const starved = decomposeArrangement(sets, { budget: { [dimension]: 1 } });
    assert.equal(starved.status, 'budget-exceeded', `${dimension} did not trip`);
    const generous = decomposeArrangement(sets, { budget: { [dimension]: full[dimension] } });
    assert.equal(generous.status, 'exact', `${dimension} tripped at its own measured cost`);
  }
});

test('a large sparse component costs less than a small dense one', () => {
  // Seven sets in a transitive chain, each meeting only its neighbour.
  const sparse = Array.from({ length: 7 }, (_, index) => ({
    id: `S${index}`,
    outline: circle(index * 185, 0, 100),
  }));
  // Four sets piled on top of each other.
  const dense = ['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 25, (index % 2) * 15, 100),
  }));

  const sparseResult = decomposeArrangement(sparse);
  const denseResult = decomposeArrangement(dense);
  assert.equal(sparseResult.status, 'exact');
  assert.equal(denseResult.status, 'exact');

  // This is the whole point of Checkpoint 3: seven sets are not automatically
  // more expensive than four. Complexity follows geometry, not cardinality.
  assert.ok(
    sparseResult.work.vertices < denseResult.work.vertices,
    `sparse 7 cost ${sparseResult.work.vertices} vertices, dense 4 cost ${denseResult.work.vertices}`,
  );
  assert.ok(sparseResult.work.peakFragments < denseResult.work.peakFragments);
});

test('the ledger charges nothing for an empty input and reports exact', () => {
  const empty = decomposeArrangement([]);
  assert.equal(empty.status, 'exact');
  assert.deepEqual(empty.regions, []);
  assert.equal(empty.work.clips, 0);

  const ledger = createWorkLedger();
  assert.deepEqual(ledger.work, {
    clips: 0, fragments: 0, vertices: 0, peakFragments: 0, outputVertices: 0, boundsTests: 0,
  });
});
