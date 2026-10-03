import assert from 'node:assert/strict';
import test from 'node:test';
import { createSetEffectsController, rippleRadiusFromRegion } from './public/set-effects-model.js';

function fakeElement() {
  const attributes = new Map();
  const children = [];
  return {
    dataset: {},
    style: { setProperty() {} },
    childNodes: children,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? ''; },
    removeAttribute(name) { attributes.delete(name); },
    append(child) { children.push(child); },
    remove() { this.removed = true; },
  };
}

function harness(randomValues = [0, 0.4, 0.8]) {
  const created = [];
  const animations = [];
  const document = { createElementNS: () => { const element = fakeElement(); created.push(element); return element; } };
  const layer = { children: [], append(...elements) { this.children.push(...elements); } };
  const animate = (target, parameters) => {
    const animation = { target, parameters, cancelled: 0, paused: 0, cancel() { this.cancelled += 1; }, pause() { this.paused += 1; } };
    animations.push(animation);
    return animation;
  };
  let index = 0;
  const controller = createSetEffectsController({ document, animate, random: () => randomValues[index++ % randomValues.length] });
  const path = (d) => ({
    path: { ...fakeElement(), getBBox: () => d.bbox ?? ({ x: 0, y: 0, width: 20, height: 20 }) },
    setIds: d.setIds,
    id: d.id,
    center: d.center ?? { x: 10, y: 10 },
    outline: d.outline ?? [[0, 0], [20, 0], [20, 20]],
  });
  return { controller, layer, animations, created, path };
}

function regions(path) {
  return new Map([
    ['a', path({ id: 'a', setIds: ['a'], center: { x: 10, y: 10 } })],
    ['b', path({ id: 'b', setIds: ['b'], center: { x: 30, y: 10 } })],
    ['a|b', path({ id: 'a|b', setIds: ['a', 'b'], center: { x: 20, y: 10 } })],
  ]);
}

test('selection starts distinct interior effects on region surfaces', () => {
  const { controller, layer, animations, path } = harness();
  const regionMap = regions(path);
  controller.sync({ selectedSetIds: ['a', 'b'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  assert.equal(controller.activeCount, 2);
  assert.equal(controller.nodeCount, 3, 'one owned effect entry per singleton and shared region');
  assert.ok([...controller.activeEffects.values()].every((effect) => ['ripple', 'wash'].includes(effect.name)));
  assert.ok(animations.length >= 3);
  assert.equal(createdBorderPaths(layer), 0, 'no perimeter stroke paths are created');
  const animationCount = animations.length;
  const childCount = layer.children.length;
  for (let index = 0; index < 50; index += 1) {
    controller.sync({ selectedSetIds: ['b', 'a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  }
  assert.equal(animations.length, animationCount, 'steady re-render does not duplicate timelines');
  assert.equal(layer.children.length, childCount, 'steady re-render does not duplicate decorations');
});

test('shared overlap has one deterministic owner, then transfers without fighting', () => {
  const { controller, layer, path } = harness([0, 0.4]);
  const regionMap = regions(path);
  controller.sync({ selectedSetIds: ['b', 'a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  assert.equal(controller.activeEffects.get('a').entries.has('a|b'), true);
  assert.equal(controller.activeEffects.get('b').entries.has('a|b'), false);
  controller.sync({ selectedSetIds: ['b'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  assert.equal(controller.activeEffects.get('b').entries.has('a|b'), true);
});

test('deselection removes effects and re-selection re-rolls without accumulation', () => {
  const { controller, layer, animations, path } = harness([0, 0.8]);
  const regionMap = new Map([['a', path({ id: 'a', setIds: ['a'] })]]);
  controller.sync({ selectedSetIds: ['a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  const firstName = controller.activeEffects.get('a').name;
  controller.sync({ selectedSetIds: [], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  assert.equal(controller.activeCount, 0);
  assert.ok(animations.every((animation) => animation.cancelled === 1));
  controller.sync({ selectedSetIds: ['a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  assert.notEqual(controller.activeEffects.get('a').name, firstName);
});

test('retirement, missing regions, and clear cancel timelines without changing region geometry', () => {
  const { controller, layer, animations, path } = harness();
  const regionMap = new Map([['a', path({ id: 'a', setIds: ['a'] })]]);
  const before = regionMap.get('a').path.getAttribute('d');
  const beforeOutline = JSON.stringify(regionMap.get('a').outline);
  controller.sync({ selectedSetIds: ['a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  controller.sync({ selectedSetIds: ['a'], regions: new Map(), colorFor: () => 'hue', effectsLayer: layer });
  assert.equal(controller.activeCount, 1, 'selection remains active while its region is temporarily absent');
  controller.clear();
  assert.equal(controller.activeCount, 0);
  assert.ok(animations.every((animation) => animation.cancelled >= 1));
  assert.equal(regionMap.get('a').path.getAttribute('d'), before);
  assert.equal(JSON.stringify(regionMap.get('a').outline), beforeOutline);
});

test('wash removes its gradient and overlay on clear', () => {
  const { controller, layer, created, path } = harness([0.8]);
  const regionMap = new Map([['a', path({ id: 'a', setIds: ['a'] })]]);
  controller.sync({ selectedSetIds: ['a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  const overlay = created.find((element) => element.getAttribute('class') === 'graph-set-interior-wash');
  assert.ok(overlay);
  controller.clear();
  assert.equal(overlay.removed, true);
});

test('ripple radius scales with the owning region bounding box', () => {
  const smallRegion = harness([0]).path({ id: 'small', setIds: ['small'], bbox: { x: 0, y: 0, width: 100, height: 80 } });
  const largeRegion = harness([0]).path({ id: 'large', setIds: ['large'], bbox: { x: 0, y: 0, width: 400, height: 320 } });
  assert.equal(rippleRadiusFromRegion(smallRegion), 36);
  assert.equal(rippleRadiusFromRegion(largeRegion), 144);

  const { controller, animations, layer } = harness([0]);
  controller.sync({ selectedSetIds: ['small'], regions: new Map([['small', smallRegion]]), colorFor: () => 'hue', effectsLayer: layer });
  const smallRadius = animations[0].parameters.r[1];
  controller.clear();
  controller.sync({ selectedSetIds: ['large'], regions: new Map([['large', largeRegion]]), colorFor: () => 'hue', effectsLayer: layer });
  const largeRadius = animations.at(-1).parameters.r[1];
  assert.equal(largeRadius, smallRadius * 4);
});

test('interior effects touch only presentation region paths and owned decorations', () => {
  const { controller, layer, path } = harness([0]);
  const simulationNode = { x: 4, y: 6, vx: 1, vy: -1, fx: null, fy: null };
  const regionMap = new Map([['a', path({ id: 'a', setIds: ['a'] })]]);
  const beforeNode = JSON.stringify(simulationNode);
  const beforeOutline = JSON.stringify(regionMap.get('a').outline);
  controller.sync({ selectedSetIds: ['a'], regions: regionMap, colorFor: () => 'hue', effectsLayer: layer });
  controller.clear();
  assert.equal(JSON.stringify(simulationNode), beforeNode);
  assert.equal(JSON.stringify(regionMap.get('a').outline), beforeOutline);
  assert.equal(regionMap.get('a').path.getAttribute('stroke-dasharray'), '');
});

function createdBorderPaths(layer) {
  return layer.children.filter((child) => child.getAttribute?.('stroke') || child.getAttribute?.('stroke-dasharray')).length;
}
