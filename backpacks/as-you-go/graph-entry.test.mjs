import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { forceSimulation, forceX } from './public/vendor/d3-force.js';

const source = readFileSync(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
// Run the production functions with isolated DOM/drawing collaborators.
const update = source.slice(source.indexOf('  function updateGraphView('), source.indexOf('  function refreshSelection('));
const reheat = source.slice(source.indexOf('  function reheat('), source.indexOf('  function fitGraph('));

function fixture(remembered = true, realSimulation = null) {
  let alpha = 0;
  let restarts = 0;
  let stops = 0;
  const noop = () => {};
  const context = vm.createContext({
    viewport: { clientWidth: 1000, clientHeight: 700 },
    initialized: true, updatePending: false, pendingInitialFit: false,
    state: { view: {} }, session: { currentId: 'root', graphExpanded: [], binMode: false },
    ROOT_ID: 'root', store: { setTrailExpanded: noop },
    currentTrailContextKey: () => 'root', graphContextId: (id) => id,
    pathTo: () => [], pathToBin: () => [],
    getBreadcrumbRootScale: () => 1, getBreadcrumbMiddleScale: () => 1,
    visibleGraphItems: () => context.items,
    getGraphPosition: () => null,
    getGraphRestPosition: () => remembered ? { x: 30, y: 40 } : null,
    // Permit the regression to execute the pre-revert freeze path as well.
    hasSettledGraphPositions: (items, lookup) => items.every((item) => lookup(item.id)),
    lastGraphContextKey: null, lastGraphStructureKey: null,
    restPositionsStructureKey: null, activeGraphStructureKey: null,
    lastSavedRest: new Map(), nodes: new Map(),
    lastGraphLayoutKey: null, items: [{ id: 'a', kind: 'group' }],
    syncNodes: noop, syncEdges: noop, syncOriginEdges: noop,
    syncSimulation: noop, syncSetRings: noop,
    simulation: realSimulation ?? {
      alpha(value) { if (value === undefined) return alpha; alpha = value; return this; },
      restart() { restarts++; return this; },
      stop() { stops++; return this; },
    },
  });
  vm.runInContext(`${reheat}\n${update}`, context);
  return {
    enter(initialFit = false) { context.updateGraphView(initialFit); },
    navigate(id) { context.session.currentId = id; },
    receivePositions(value) { context.state.view.graphRestPositions = { root: { a: { x: value, y: value } } }; },
    addItem() { context.items.push({ id: 'b', kind: 'group' }); },
    resize() { context.viewport.clientWidth += 100; },
    changeSets() { context.state.view.itemSets = [{ id: 'set', memberIds: ['a'] }]; },
    cool() { alpha = 0; },
    result: () => ({ alpha, restarts, stops }),
  };
}

test('opening with remembered positions resumes the original physics', () => {
  const graph = fixture();
  graph.enter(true);
  assert.deepEqual(graph.result(), { alpha: 0.7, restarts: 1, stops: 0 });
});

test('reentering a remembered folder reheats but unchanged renders do not', () => {
  const graph = fixture();
  graph.enter();
  graph.cool();
  graph.enter();
  graph.navigate('child');
  graph.enter();
  graph.navigate('root');
  graph.enter();
  assert.deepEqual(graph.result(), { alpha: 0.35, restarts: 3, stops: 0 });
});

test('layout edits, set membership, and viewport changes still reheat', () => {
  const graph = fixture();
  graph.enter();
  graph.addItem();
  graph.enter();
  graph.changeSets();
  graph.enter();
  graph.resize();
  graph.enter();
  assert.deepEqual(graph.result(), { alpha: 0.35, restarts: 4, stops: 0 });
});

test('two surfaces cool naturally while position commits keep arriving', () => {
  const simulations = [0, 100].map((x) => forceSimulation([{ id: 'a', x, y: 0 }])
    .force('x', forceX(50)).alphaDecay(0.028).velocityDecay(0.32).stop());
  try {
    const surfaces = simulations.map((simulation) => fixture(true, simulation));
    surfaces.forEach((surface) => surface.enter(true));
    // Thirty seconds of ticks, exchanging position commits every 1.5 seconds.
    // Explicitly stop d3 timers: this reproduction uses no wall-clock sleeps.
    for (let frame = 0; frame < 1800; frame++) {
      simulations.forEach((simulation) => simulation.stop().tick());
      if (frame % 90 === 89) surfaces.forEach((surface, i) => {
        surface.receivePositions(simulations[1 - i].nodes()[0].x);
        surface.enter();
      });
    }
    simulations.forEach((simulation) => assert.ok(simulation.alpha() < simulation.alphaMin(),
      `position broadcasts kept physics hot: alpha=${simulation.alpha()}`));
  } finally {
    simulations.forEach((simulation) => simulation.stop());
  }
});

test('opening without remembered positions still starts physics', () => {
  const graph = fixture(false);
  graph.enter(true);
  assert.deepEqual(graph.result(), { alpha: 0.7, restarts: 1, stops: 0 });
});
