import assert from 'node:assert/strict';
import test from 'node:test';
import { createDragTrailController } from './public/drag-trail-model.js';

function element() {
  const attributes = new Map();
  return {
    removed: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? ''; },
    remove() { this.removed = true; },
  };
}

function harness(maxMarks = 3) {
  const created = [];
  const animations = [];
  const document = { createElementNS: () => { const next = element(); created.push(next); return next; } };
  const layer = { children: [], append(next) { this.children.push(next); } };
  const animate = (target, parameters) => {
    const animation = { target, parameters, cancelled: 0, cancel() { this.cancelled += 1; }, pause() {} };
    animations.push(animation);
    return animation;
  };
  const controller = createDragTrailController({ document, animate, maxMarks });
  controller.setLayer(layer);
  return { controller, layer, created, animations };
}

test('one bounded trail mark follows the selection centroid, not every item', () => {
  const { controller, layer } = harness();
  controller.record([{ x: 10, y: 20 }, { x: 30, y: 40 }], { color: 'hue-a' });
  assert.equal(controller.count, 1);
  assert.equal(layer.children.length, 1);
  assert.equal(layer.children[0].getAttribute('cx'), '20');
  assert.equal(layer.children[0].getAttribute('cy'), '30');
  assert.equal(layer.children[0].getAttribute('fill'), 'hue-a');
});

test('trail marks are capped and clear cancels all owned animations and nodes', () => {
  const { controller, layer, animations } = harness(2);
  for (let index = 0; index < 5; index += 1) controller.record([{ x: index, y: index }]);
  assert.equal(controller.count, 2);
  assert.equal(layer.children.filter((child) => !child.removed).length, 2);
  controller.clear();
  assert.equal(controller.count, 0);
  assert.ok(animations.every((animation) => animation.cancelled >= 1));
  assert.ok(layer.children.every((child) => child.removed));
});

test('invalid or missing drag positions clear stale trail marks', () => {
  const { controller, layer } = harness();
  controller.record([{ x: 10, y: 20 }]);
  controller.record([{ x: Number.NaN, y: 20 }]);
  assert.equal(controller.count, 0);
  assert.ok(layer.children.every((child) => child.removed));
});

test('trail sampling does not write the dragged position inputs', () => {
  const { controller } = harness();
  const points = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
  const before = structuredClone(points);
  controller.record(points);
  assert.deepEqual(points, before);
});
