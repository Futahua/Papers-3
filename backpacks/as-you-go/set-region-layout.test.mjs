import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRegionLayout,
  connectedComponents,
  overlapPairs,
  DEFAULT_WORK_BUDGET,
} from './public/set-region-layout.js';
import { decomposeArrangement } from './public/set-region-arrangement.js';
import { regionArea } from './public/set-region-model.js';

const square = (x, y, size = 10) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

const circle = (cx, cy, radius, count = 48) => Array.from({ length: count }, (_, index) => {
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
});

/** Wraps the real arrangement so a test can assert what was handed to it — the
 * point of the component split is that the expensive path is not reached. */
function spyLayout(options = {}) {
  const calls = [];
  const layout = createRegionLayout({
    ...options,
    arrange: (sets, arrangeOptions) => {
      calls.push(sets.map(({ id }) => id));
      return decomposeArrangement(sets, arrangeOptions);
    },
  });
  return { layout, calls };
}

const componentIdsOf = (calls) => calls.map((ids) => ids.join('|')).sort();

const disjointSets = (count) => Array.from({ length: count }, (_, index) => ({
  id: `S${String(index).padStart(3, '0')}`,
  outline: circle(index * 500, 0, 100),
}));

test('a hundred disjoint sets stay a hundred singleton regions and never reach decomposition', () => {
  const { layout, calls } = spyLayout();
  const started = process.hrtime.bigint();
  const regions = layout.update(disjointSets(100));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(regions.length, 100);
  assert.ok(regions.every((region) => region.setIds.length === 1));
  assert.ok(regions.every((region) => region.polygons.length === 1));
  // The whole point: no 2**100 mask enumeration, and no decomposition at all.
  assert.deepEqual(calls, []);
  assert.equal(layout.componentCount(), 100);
  // Ten disjoint sets alone cost 33ms under the global enumerator.
  assert.ok(elapsedMs < 200, `expected linear-ish work, took ${elapsedMs.toFixed(1)}ms`);
});

test('disjoint set counts scale roughly linearly rather than exponentially', () => {
  const timings = [10, 32, 100].map((count) => {
    const layout = createRegionLayout();
    const sets = disjointSets(count);
    const started = process.hrtime.bigint();
    assert.equal(layout.update(sets).length, count);
    return Number(process.hrtime.bigint() - started) / 1e6;
  });
  // Deliberately loose: this catches a return to exponential work, not jitter.
  assert.ok(
    timings.every((ms) => ms < 200),
    `timings were ${timings.map((ms) => ms.toFixed(1)).join(', ')}ms`,
  );
});

test('separate overlap clusters become separate components', () => {
  const { layout, calls } = spyLayout();
  const regions = layout.update([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
    { id: 'C', outline: square(100, 0) },
    { id: 'D', outline: square(105, 0) },
    { id: 'E', outline: square(300, 0) },
  ]);
  assert.deepEqual(componentIdsOf(calls), ['A|B', 'C|D']);
  assert.equal(layout.componentCount(), 3);
  assert.ok(regions.some(({ id }) => id === 'A|B'));
  assert.ok(regions.some(({ id }) => id === 'C|D'));
  // E never mixes into anyone else's decomposition.
  assert.deepEqual(regions.find(({ id }) => id === 'E').setIds, ['E']);
});

test('overlap is transitive across a chain', () => {
  const { layout, calls } = spyLayout();
  layout.update([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(8, 0) },
    { id: 'C', outline: square(16, 0) },
  ]);
  // A and C do not touch, but B joins them into one component.
  assert.deepEqual(componentIdsOf(calls), ['A|B|C']);
  assert.equal(layout.componentCount(), 1);
});

test('intersecting bounding boxes with disjoint polygons stay separate components', () => {
  // Two diagonal triangles: their boxes overlap across (2,2)-(10,10), the
  // polygons never do — one lies under x+y=10, the other over x+y=12.
  const lower = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  const upper = [{ x: 10, y: 10 }, { x: 2, y: 10 }, { x: 10, y: 2 }];
  assert.deepEqual(overlapPairs([
    { id: 'A', outline: lower, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    { id: 'B', outline: upper, bounds: { minX: 2, minY: 2, maxX: 10, maxY: 10 } },
  ]), []);

  const { layout, calls } = spyLayout();
  const regions = layout.update([{ id: 'A', outline: lower }, { id: 'B', outline: upper }]);
  assert.deepEqual(calls, []);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'B']);
});

test('moving one component leaves another component region objects untouched', () => {
  const layout = createRegionLayout();
  const far = [
    { id: 'D', outline: square(1000, 0) },
    { id: 'E', outline: square(1005, 0) },
  ];
  const isFar = (region) => region.setIds.every((id) => id === 'D' || id === 'E');

  const before = layout.update([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
    ...far,
  ]).filter(isFar);
  assert.ok(before.length >= 3);

  const after = layout.update([
    { id: 'A', outline: square(0, 1) },
    { id: 'B', outline: square(5, 0) },
    ...far,
  ]).filter(isFar);

  // Identity, not equality: the untouched component was never recomputed.
  assert.deepEqual(after.map(({ id }) => id), before.map(({ id }) => id));
  for (let index = 0; index < before.length; index += 1) {
    assert.equal(after[index], before[index]);
  }
});

test('an eleventh disjoint set does not make the existing regions disappear', () => {
  const layout = createRegionLayout();
  const sets = Array.from({ length: 11 }, (_, index) => ({
    id: `S${String(index).padStart(2, '0')}`,
    outline: square(index * 100, 0),
  }));
  const regions = layout.update(sets);
  // The old mask enumerator returned [] above ten sets, so an eleventh made
  // every region vanish. Nothing enumerates masks any more.
  assert.equal(regions.length, 11);
  assert.ok(regions.every((region) => region.polygons.length === 1));
});

/** The mutation test the budget design turns on: the SAME fixture must be exact
 * under a generous budget and fall back under a starved one. If a fixture is
 * exact either way, the budget is not what decided it. */
const overlappingPair = [
  { id: 'A', outline: square(0, 0, 20) },
  { id: 'B', outline: square(10, 0, 20) },
];

test('a starved budget makes even a two-set overlap fall back cleanly', () => {
  const layout = createRegionLayout({ budget: { vertices: 1 } });
  const regions = layout.update(overlappingPair);
  // One body per set, never empty, never a partial arrangement.
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'B']);
  assert.ok(regions.every((region) => region.setIds.length === 1));
  assert.ok(regions.every((region) => region.polygons.length === 1));
});

test('the same fixture is exact under a generous budget', () => {
  const layout = createRegionLayout({ budget: { vertices: Infinity } });
  const regions = layout.update(overlappingPair);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'A|B', 'B']);
});

test('the default budget keeps an ordinary overlapping component exact', () => {
  const { layout, calls } = spyLayout();
  const regions = layout.update(['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 60, (index % 2) * 40, 100),
  })));
  assert.equal(calls.length, 1);
  assert.ok(regions.some((region) => region.setIds.length > 1));
  assert.ok(regions.some(({ id }) => id === 'A|B'));
});

test('complexity follows geometry, not set count', () => {
  // Eight sets in a sparse chain: more sets than the old ceiling of four ever
  // allowed, and cheap enough to stay exact.
  const sparse = createRegionLayout().update(Array.from({ length: 8 }, (_, index) => ({
    id: `S${index}`,
    outline: circle(index * 185, 0, 100),
  })));
  assert.ok(
    sparse.some((region) => region.setIds.length > 1),
    'a sparse eight-set chain should still get exact overlap regions',
  );

  // And a component small enough for the old rule still degrades if its actual
  // geometry is pathological — here forced by a budget below its real cost.
  const dense = createRegionLayout({ budget: { vertices: 5000 } })
    .update(['A', 'B', 'C', 'D'].map((id, index) => ({
      id,
      outline: circle(index * 25, (index % 2) * 15, 100),
    })));
  assert.ok(dense.every((region) => region.setIds.length === 1), 'expected the layered fallback');
  assert.equal(dense.length, 4);
});

test('the default budget is the calibrated vertex ceiling', () => {
  assert.deepEqual(DEFAULT_WORK_BUDGET, { vertices: 210_000 });
});

/** The layout is composition over the arrangement, so what it has to preserve
 * is that routing through components does not alter the regions a component
 * would produce on its own. Expected memberships are fixed here rather than
 * compared against a second engine. */
const SINGLE_COMPONENT_MEMBERSHIPS = {
  2: ['A', 'A|B', 'B'],
  3: ['A', 'A|B', 'A|B|C', 'A|C', 'B', 'B|C', 'C'],
  4: ['A', 'A|B', 'A|B|C', 'A|B|C|D', 'A|C', 'B', 'B|C', 'B|C|D', 'B|D', 'C', 'C|D', 'D'],
};

test('routing through components does not change a component own regions', () => {
  for (const count of [2, 3, 4]) {
    const sets = Array.from({ length: count }, (_, index) => ({
      id: 'ABCD'[index],
      outline: circle(index * 60, (index % 2) * 40, 100),
    }));
    const viaLayout = createRegionLayout().update(sets);
    assert.deepEqual(
      viaLayout.map(({ id }) => id),
      SINGLE_COMPONENT_MEMBERSHIPS[count],
      `region identity changed for ${count} sets`,
    );
    // These sets form one component, so the layout must hand back exactly what
    // the arrangement produces for them, region for region.
    const direct = decomposeArrangement(sets).regions;
    for (const region of viaLayout) {
      const match = direct.find(({ id }) => id === region.id);
      assert.ok(
        Math.abs(regionArea(region) - regionArea(match)) < 1e-6,
        `${count} sets: ${region.id} area diverged`,
      );
    }
  }
});

test('connected components union transitively and cover every set exactly once', () => {
  const groups = connectedComponents(5, [[0, 1], [1, 2], [3, 4]]);
  const normalized = groups
    .map((group) => group.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
  assert.deepEqual(normalized, [[0, 1, 2], [3, 4]]);
  assert.equal(normalized.flat().length, 5);
});

test('removing sets drops their component caches', () => {
  const layout = createRegionLayout();
  layout.update([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(100, 0) },
  ]);
  assert.equal(layout.componentCount(), 2);
  layout.update([{ id: 'A', outline: square(0, 0) }]);
  assert.equal(layout.componentCount(), 1);
  assert.deepEqual(layout.update([]), []);
  assert.equal(layout.componentCount(), 0);
});
