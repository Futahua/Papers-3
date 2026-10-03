import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarqueeController } from './public/app/interactions/marquee-controller.js';

function createHarness({ tiles: tileDefs = null } = {}) {
  const effects = { captured: 0, released: 0 };
  const commandCalls = [];
  const tiles = tileDefs ?? [
    { id: 'a', rect: { left: 10, top: 10, right: 60, bottom: 60 } },
    { id: 'b', rect: { left: 100, top: 10, right: 150, bottom: 60 } },
  ];
  const elements = {
    grid: {
      querySelectorAll: () => tiles.map((t) => {
        const classes = new Set(t.classes ?? []);
        return {
          dataset: { id: t.id },
          getBoundingClientRect: () => t.rect,
          classList: {
            contains: (c) => classes.has(c),
          },
        };
      }),
      setPointerCapture: () => { effects.captured += 1; },
      hasPointerCapture: () => true,
      releasePointerCapture: () => { effects.released += 1; },
    },
    explorer: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    marquee: { hidden: true, style: {} },
  };
  const commands = {
    beginMarqueeSelection: ({ preserveSelection }) => {
      commandCalls.push(['begin', preserveSelection]);
      return preserveSelection ? ['a'] : [];
    },
    updateMarqueeSelection: (ids) => { commandCalls.push(['update', ids]); },
    finishMarqueeSelection: ({ moved }) => { commandCalls.push(['finish', moved]); },
  };
  const controller = createMarqueeController({
    elements,
    commands,
    itemsIntersectingMarquee: (items, bounds) =>
      items.filter((t) =>
        t.right >= bounds.left && t.left <= bounds.right
        && t.bottom >= bounds.top && t.top <= bounds.bottom
      ).map((t) => t.id),
  });
  return { controller, effects, commandCalls, elements };
}

test('start without preserve requests a clear via beginMarqueeSelection', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  assert.deepEqual(h.commandCalls, [['begin', false]]);
  assert.equal(h.effects.captured, 1);
});

test('start with preserve keeps the selection and captures the pointer', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: true });
  assert.deepEqual(h.commandCalls, [['begin', true]]);
  assert.equal(h.effects.captured, 1);
});

test('move below the threshold does not update selection or show the overlay', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 51, clientY: 51 });
  assert.equal(h.elements.marquee.hidden, true);
  assert.deepEqual(h.commandCalls, [['begin', false]]);
});

test('move above the threshold updates the selection with base plus intersections', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: true });
  // Bounds (50..55, 50..55) intersect tile a only (b starts at x=100).
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  assert.deepEqual(h.commandCalls, [
    ['begin', true],
    ['update', ['a', 'a']], // preserved base ['a'] plus intersecting tile 'a'
  ]);
  assert.equal(h.elements.marquee.hidden, false);
});

test('finish releases capture, finishes the command, and reports whether it moved', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  const moved = h.controller.finish(1);
  assert.equal(moved, true);
  assert.equal(h.effects.released, 1);
  assert.equal(h.elements.marquee.hidden, true);
  assert.deepEqual(h.commandCalls.at(-1), ['finish', true]);
  assert.equal(h.controller.isActive(1), false);
});

test('finish for an unrelated pointer is a no-op', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  const moved = h.controller.finish(2);
  assert.equal(moved, null);
  assert.equal(h.effects.released, 0);
  assert.deepEqual(h.commandCalls, [['begin', false]]);
});

test('marquee selection excludes ancestor tiles', () => {
  const h = createHarness({
    tiles: [
      { id: 'a', rect: { left: 10, top: 10, right: 60, bottom: 60 } },
      { id: 'anc', rect: { left: 100, top: 10, right: 150, bottom: 60 }, classes: ['ancestor-item'] },
    ],
  });
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 155, clientY: 55 });
  const update = h.commandCalls.find(([name]) => name === 'update');
  assert.deepEqual(update[1], ['a'], 'the ancestor tile is filtered out of the marquee');
});
test('018X2 cancel releases capture and hides the overlay WITHOUT the finish command', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  h.controller.cancel();
  assert.equal(h.effects.released, 1, 'capture is released');
  assert.equal(h.elements.marquee.hidden, true, 'overlay is hidden');
  assert.ok(h.commandCalls.every(([name]) => name !== 'finish'), 'no finish command runs on cancel');
  assert.equal(h.controller.isActive(1), false, 'gesture is reset');
  // A later finish for the cancelled pointer is a no-op (cannot finalize after a handoff).
  const moved = h.controller.finish(1);
  assert.equal(moved, null);
  assert.ok(h.commandCalls.every(([name]) => name !== 'finish'), 'later pointerup cannot finish a cancelled marquee');
});

test('018X2 cancel with no active marquee is a harmless no-op', () => {
  const h = createHarness();
  h.controller.cancel();
  assert.equal(h.effects.released, 0);
  assert.deepEqual(h.commandCalls, []);
});
