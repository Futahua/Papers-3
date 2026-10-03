import assert from 'node:assert/strict';
import test from 'node:test';
import { glyphPath, layoutTitleGlyphs, normalizeGlyphTitle } from './public/set-glyph-model.js';
import { forceSetExclusion } from './public/set-gravity-model.js';
import { outlineCentroid, pointInsideRing, ringHull } from './public/set-ring-model.js';

const square = [
  { x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 240 }, { x: 0, y: 240 },
];

const ellipse = (radiusX, radiusY, count = 96) => Array.from({ length: count }, (_, index) => {
  const angle = -Math.PI / 2 + index * 2 * Math.PI / count;
  return { x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) };
});

test('untitled returns no decorative glyph border and named emits one compact path', () => {
  assert.deepEqual(layoutTitleGlyphs(square, '   ').placements, []);
  const named = layoutTitleGlyphs(square, 'As You Go');
  assert.ok(named.placements.length > 0);
  assert.ok(glyphPath(named).startsWith('M'));
});

test('named layout repeats complete titles, stays upright, and keeps bottom traversal readable', () => {
  const layout = layoutTitleGlyphs(square, 'ABC', { preferredHeight: 14, gap: 5 });
  assert.ok(layout.completeRepeats >= 2, 'large outline carries the title at least twice');
  assert.ok(layout.placements.every(({ rotation }) => rotation >= -90 && rotation <= 90));
  const bottom = layout.placements
    .filter((placement) => placement.y === 240)
    .sort((a, b) => a.x - b.x);
  assert.ok(bottom.length >= 2);
  assert.deepEqual(bottom.slice(0, 3).map(({ char }) => char), ['A', 'B', 'C']);
  assert.equal(new Set(layout.placements.map(({ distance }) => distance)).size, layout.placements.length);
});

test('glyph spacing stays uniform across forward and reversed perimeter runs', () => {
  for (const outline of [ellipse(150, 125), ellipse(350, 90), ellipse(90, 350)]) {
    for (const title of ['A', 'AB', 'THINGS', 'LONGER TITLE']) {
      const layout = layoutTitleGlyphs(outline, title);
      const { placements } = layout;
      const gaps = placements.slice(1).map((placement, index) => Math.hypot(
        placement.x - placements[index].x,
        placement.y - placements[index].y,
      ));
      const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      assert.ok(Math.max(...gaps) < mean * 1.2, `${title}: perimeter gap is discontinuous`);
      assert.ok(placements.every((placement, index) => index === 0 || placement.distance > placements[index - 1].distance));

      for (const half of ['top', 'bottom']) {
        const halfPlacements = placements
          .filter(({ y }) => half === 'top' ? y < 0 : y >= 0)
          .sort((a, b) => a.x - b.x);
        const halfGaps = halfPlacements.slice(1).map((placement, index) => Math.hypot(
          placement.x - halfPlacements[index].x,
          placement.y - halfPlacements[index].y,
        ));
        const halfMean = halfGaps.reduce((sum, gap) => sum + gap, 0) / halfGaps.length;
        assert.ok(Math.max(...halfGaps) < halfMean * 1.2, `${title}: ${half} spacing is discontinuous`);
      }
      assert.ok(layout.completeRepeats >= 1);
    }
  }
});

test('top anchoring changes smoothly when a non-anchor vertex moves slightly', () => {
  const deformed = square.map((point, index) => index === 1 ? { x: point.x, y: point.y + 1.5 } : { ...point });
  const before = layoutTitleGlyphs(square, 'READABILITY');
  const after = layoutTitleGlyphs(deformed, 'READABILITY');
  assert.equal(before.phase, 0);
  assert.equal(after.phase, 0);
  assert.ok(Math.hypot(after.placements[0].x - before.placements[0].x, after.placements[0].y - before.placements[0].y) < 1);
});

test('closed seam has distinct placements and independent named-set paths', () => {
  const first = layoutTitleGlyphs(square, 'ONE');
  const secondOutline = square.map(({ x, y }) => ({ x: x + 400, y: y + 30 }));
  const second = layoutTitleGlyphs(secondOutline, 'TWO');
  const positions = first.placements.map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`);
  assert.equal(new Set(positions).size, positions.length);
  assert.ok(first.placements.every((placement) => placement.distance >= 0 && placement.distance < first.perimeter));
  assert.notEqual(glyphPath(first), glyphPath(second));
  assert.equal(glyphPath(layoutTitleGlyphs(square, '   ')), '');
});

test('long titles scale down without truncating and unsupported characters use ?', () => {
  const title = 'A very long title 你好';
  const layout = layoutTitleGlyphs(square, title, { preferredHeight: 20, gap: 4 });
  assert.ok(layout.completeRepeats >= 1);
  assert.equal(layout.title.includes('?'), true);
  assert.equal(layout.title.length, [...title.trim()].length);
  assert.ok(layout.scale <= 20);
});

test('glyph layout is decorative only: the physical outline input is unchanged', () => {
  const before = structuredClone(square);
  const titled = layoutTitleGlyphs(square, 'Named');
  const untitled = layoutTitleGlyphs(square, '');
  assert.deepEqual(square, before);
  assert.deepEqual(titled.perimeter, untitled.perimeter);
  assert.deepEqual(titled.placements.length > 0, true);
  assert.deepEqual(untitled.placements, []);
});

test('titled and untitled presentation feed identical physical consumers', () => {
  const titledOutline = structuredClone(square);
  const untitledOutline = structuredClone(square);
  const titled = layoutTitleGlyphs(titledOutline, 'Physical');
  const untitled = layoutTitleGlyphs(untitledOutline, '');
  const titledHull = ringHull(titledOutline);
  const untitledHull = ringHull(untitledOutline);
  assert.deepEqual(titledHull, untitledHull);
  assert.deepEqual(outlineCentroid(titledHull), outlineCentroid(untitledHull));
  assert.equal(pointInsideRing({ x: 120, y: 120 }, titledHull), pointInsideRing({ x: 120, y: 120 }, untitledHull));

  const run = (layout) => {
    const nodes = [{ id: 'foreign', x: 120, y: 120, vx: 0, vy: 0 }];
    const force = forceSetExclusion({
      setsOf: () => [],
      membersOf: () => [{ id: 'member', x: 120, y: 120 }],
      hullOf: () => ringHull(square),
    });
    force.initialize(nodes);
    force(1);
    return { vx: nodes[0].vx, vy: nodes[0].vy, glyphs: layout.placements.length };
  };
  assert.deepEqual(run(titled).vx, run(untitled).vx);
  assert.deepEqual(run(titled).vy, run(untitled).vy);
  assert.ok(titled.placements.length > 0);
  assert.equal(untitled.placements.length, 0);
});

test('multiple named sets keep separate decorative paths while an untitled set remains border-only', () => {
  const layouts = [
    layoutTitleGlyphs(square, 'Ideas'),
    layoutTitleGlyphs(square.map(({ x, y }) => ({ x: x + 500, y })), 'As You Go'),
    layoutTitleGlyphs(square.map(({ x, y }) => ({ x: x + 250, y: y + 400 })), ''),
  ];
  assert.ok(layouts[0].placements.length > 0 && layouts[1].placements.length > 0);
  assert.equal(glyphPath(layouts[2]), '');
  assert.notEqual(glyphPath(layouts[0]), glyphPath(layouts[1]));
});

test('lowercase uses the project glyph alphabet and whitespace remains a gap', () => {
  assert.deepEqual(normalizeGlyphTitle('a b!'), ['A', ' ', 'B', '!']);
  const layout = layoutTitleGlyphs(square, 'A A');
  const rendered = glyphPath(layout);
  const withoutSpacePlacements = glyphPath({
    ...layout,
    placements: layout.placements.filter(({ char }) => char !== ' '),
  });
  assert.equal(rendered, withoutSpacePlacements, 'spaces emit no rendered stroke geometry');
});

test('authored glyphs emit no duplicate exact-overlap segments', () => {
  const characters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?.,!:-+/()[]'"];
  for (const char of characters) {
    const path = glyphPath({ placements: [{ char, x: 0, y: 0, rotation: 0, scale: 14 }] });
    const segments = path.split('M').filter(Boolean).map((segment) => `M${segment}`);
    assert.equal(new Set(segments).size, segments.length, `duplicate rendered segment in ${char}`);
  }
});
