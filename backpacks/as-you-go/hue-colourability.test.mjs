import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjacencyFromPairs,
  classifyColourability,
  turanMaxEdges,
} from './public/hue-colourability.js';

const completeGraph = (n, prefix = 'n') => {
  const ids = Array.from({ length: n }, (unused, index) => `${prefix}${String(index).padStart(2, '0')}`);
  const adjacency = new Map(ids.map((id) => [id, new Set(ids.filter((other) => other !== id))]));
  return adjacency;
};

/** The balanced complete k-partite graph on n vertices: the densest graph that
 * is still k-colourable, and therefore the exact boundary case. */
const turanGraph = (n, colours) => {
  const base = Math.floor(n / colours);
  const larger = n % colours;
  const parts = [];
  let next = 0;
  for (let part = 0; part < colours; part += 1) {
    const size = part < larger ? base + 1 : base;
    parts.push(Array.from({ length: size }, () => `v${String(next++).padStart(2, '0')}`));
  }
  const adjacency = new Map(parts.flat().map((id) => [id, new Set()]));
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      for (const a of parts[i]) {
        for (const b of parts[j]) {
          adjacency.get(a).add(b);
          adjacency.get(b).add(a);
        }
      }
    }
  }
  return adjacency;
};

const edgeCount = (adjacency) => {
  let total = 0;
  for (const neighbours of adjacency.values()) total += neighbours.size;
  return total / 2;
};

test('the Turan bound matches the graph it describes', () => {
  // The number this whole investigation turned on: the densest 8-colourable
  // graph on 17 vertices has exactly 126 edges, which is exactly what the
  // largest observed proximity component has.
  assert.equal(turanMaxEdges(17, 8), 126);
  assert.equal(edgeCount(turanGraph(17, 8)), 126);
  // K9 has 36 edges, one more than any 8-colourable graph on 9 vertices.
  assert.equal(turanMaxEdges(9, 8), 35);
  assert.equal(edgeCount(completeGraph(9)), 36);
  // Degenerate inputs.
  assert.equal(turanMaxEdges(0, 8), 0);
  assert.equal(turanMaxEdges(1, 8), 0);
  assert.equal(turanMaxEdges(8, 8), 28, 'at or below the colour count every edge is allowed');
});

test('graphs no larger than the colour count are feasible without search', () => {
  for (let n = 1; n <= 8; n += 1) {
    const verdict = classifyColourability(completeGraph(n));
    assert.equal(verdict.verdict, 'feasible', `K${n}`);
    assert.equal(verdict.certificate, 'size');
    assert.equal(verdict.work, 0, 'the cheapest certificate must cost nothing');
  }
});

test('cliques larger than the colour count are proved infeasible', () => {
  for (const n of [9, 10, 12, 17, 24]) {
    const verdict = classifyColourability(completeGraph(n));
    assert.equal(verdict.verdict, 'infeasible', `K${n}`);
    assert.ok(['turan', 'clique'].includes(verdict.certificate), `K${n} used ${verdict.certificate}`);
  }
});

test('the Turan graph itself is feasible, so density alone proves nothing', () => {
  // This is the case that makes size and density unusable as certificates. It
  // has the maximum edges an 8-colourable graph on 17 vertices can have, and it
  // is 8-colourable. Anything that called it infeasible would be wrong.
  const graph = turanGraph(17, 8);
  assert.equal(edgeCount(graph), turanMaxEdges(17, 8));
  const verdict = classifyColourability(graph);
  assert.equal(verdict.verdict, 'feasible');
  assert.equal(verdict.certificate, 'search', 'only a real search can decide this one');
});

test('one edge beyond the Turan bound is proved infeasible without search', () => {
  const graph = turanGraph(17, 8);
  // Join two vertices inside the same part, pushing the graph over the bound.
  const parts = [...graph.keys()].filter((id) => !graph.get('v00').has(id) && id !== 'v00');
  assert.ok(parts.length >= 1, 'expected a same-part vertex to attach to');
  graph.get('v00').add(parts[0]);
  graph.get(parts[0]).add('v00');
  assert.ok(edgeCount(graph) > turanMaxEdges(17, 8));
  const verdict = classifyColourability(graph);
  assert.equal(verdict.verdict, 'infeasible');
  assert.equal(verdict.certificate, 'turan');
  assert.equal(verdict.work, 0);
});

test('a sparse graph well under the bound is found colourable by search', () => {
  // A long cycle: 2-colourable when even, 3 when odd, and comfortably feasible.
  const n = 21;
  const ids = Array.from({ length: n }, (unused, index) => `c${String(index).padStart(2, '0')}`);
  const adjacency = new Map(ids.map((id) => [id, new Set()]));
  for (let index = 0; index < n; index += 1) {
    const a = ids[index];
    const b = ids[(index + 1) % n];
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const verdict = classifyColourability(adjacency);
  assert.equal(verdict.verdict, 'feasible');
  assert.equal(verdict.certificate, 'search');
});

test('an exhausted budget reports unknown rather than guessing', () => {
  // Unknown is a real verdict, and callers must treat it as they treat
  // feasible. A budget of one cannot decide anything past the free certificates.
  const verdict = classifyColourability(turanGraph(17, 8), { budget: 1 });
  assert.equal(verdict.verdict, 'unknown');
  assert.equal(verdict.certificate, 'budget');
});

test('the classifier is deterministic for a given graph and budget', () => {
  const graph = turanGraph(19, 8);
  const runs = Array.from({ length: 5 }, () => classifyColourability(graph));
  for (const run of runs) assert.deepEqual(run, runs[0]);
});

test('adjacency is derived from a component pair list', () => {
  const node = (id) => ({ id, x: 0, y: 0 });
  const a = node('a');
  const b = node('b');
  const c = node('c');
  const adjacency = adjacencyFromPairs([[a, b], [b, c]]);
  assert.deepEqual([...adjacency.keys()].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...adjacency.get('b')].sort(), ['a', 'c']);
  assert.deepEqual([...adjacency.get('a')], ['b']);
  assert.deepEqual(adjacencyFromPairs([]), new Map());
});

// ===========================================================================
// The budget is part of the contract, not a hint. A classifier that runs on the
// per-frame path has to have a cost ceiling as rigorous as the certificate it
// produces, so these pin the ledger rather than only the verdict.

test('reported work never exceeds the budget, on any graph or budget', () => {
  const graphs = [
    ['K9', completeGraph(9)],
    ['K17', completeGraph(17)],
    ['T8(17)', turanGraph(17, 8)],
    ['T8(24)', turanGraph(24, 8)],
    ['T8(31)', turanGraph(31, 8)],
  ];
  for (const [label, graph] of graphs) {
    for (const budget of [0, 1, 2, 5, 17, 100, 5000, 20000]) {
      const verdict = classifyColourability(graph, { budget });
      assert.ok(
        verdict.work >= 0 && verdict.work <= budget,
        `${label} at budget ${budget}: charged ${verdict.work}`,
      );
    }
  }
});

test('a zero budget decides only what the free certificates can', () => {
  // Size and the Turan bound cost nothing, so they still decide.
  assert.equal(classifyColourability(completeGraph(8), { budget: 0 }).verdict, 'feasible');
  assert.equal(classifyColourability(completeGraph(9), { budget: 0 }).verdict, 'infeasible');
  // Anything needing a search cannot be decided without spending.
  const boundary = classifyColourability(turanGraph(17, 8), { budget: 0 });
  assert.equal(boundary.verdict, 'unknown');
  assert.equal(boundary.work, 0);
});

test('the search charges its own work, not just the clique search preceding it', () => {
  // The regression this exists for: total work was reported as the budget minus
  // the budget handed to DSATUR, which is identically the clique-search cost, so
  // every DSATUR assignment was invisible. The two halves are now reported
  // separately, which makes the accounting checkable instead of asserted.
  const graph = turanGraph(17, 8);
  const verdict = classifyColourability(graph);
  assert.equal(verdict.certificate, 'search');
  assert.equal(
    verdict.work,
    verdict.cliqueWork + verdict.searchWork,
    'the halves must account for the whole',
  );
  assert.ok(verdict.searchWork > 0, `the search charged nothing (${verdict.searchWork})`);
  assert.ok(verdict.cliqueWork > 0, `the clique search charged nothing (${verdict.cliqueWork})`);
});

test('a clique-decided graph charges nothing to the search', () => {
  // K9 is settled before DSATUR is reached, so the search half must be zero —
  // the mirror of the case above, which pins that the split tracks reality
  // rather than being a fixed division of one number.
  const verdict = classifyColourability(completeGraph(12), { budget: 20000 });
  assert.equal(verdict.verdict, 'infeasible');
  assert.equal(verdict.searchWork, 0);
  assert.equal(verdict.work, verdict.cliqueWork);
});
test('work grows with the budget until the graph is decided, then stops', () => {
  const graph = turanGraph(19, 8);
  const decided = classifyColourability(graph);
  assert.notEqual(decided.certificate, 'budget', 'fixture should be decidable');

  // Below the deciding cost, the classifier spends everything it is given and
  // reports unknown; at or above it, the cost is fixed.
  const starved = classifyColourability(graph, { budget: Math.floor(decided.work / 2) });
  assert.equal(starved.verdict, 'unknown');
  assert.equal(starved.work, Math.floor(decided.work / 2), 'a starved run should spend its whole budget');

  const generous = classifyColourability(graph, { budget: decided.work * 10 });
  assert.equal(generous.work, decided.work, 'a decided graph costs the same however much is offered');
  assert.equal(generous.verdict, decided.verdict);
});

test('an unknown verdict never claims a certificate it did not earn', () => {
  for (const budget of [1, 3, 9]) {
    const verdict = classifyColourability(turanGraph(24, 8), { budget });
    if (verdict.verdict === 'unknown') assert.equal(verdict.certificate, 'budget');
    else assert.notEqual(verdict.certificate, 'budget');
  }
});

test('a feasible graph is never called infeasible merely because the budget ran out', () => {
  // The soundness case for propagating exhaustion rather than backtracking on
  // it. T8(17) IS 8-colourable. Give it enough budget to finish the clique
  // search but not the colouring search: every DSATUR branch then fails to
  // charge, and a search that treats "could not spend" as "no colouring here"
  // would exhaust its branches and report infeasible — declaring a colourable
  // graph impossible, and in production bypassing projection for a component
  // that projection could have solved.
  const graph = turanGraph(17, 8);
  const full = classifyColourability(graph);
  assert.equal(full.verdict, 'feasible');
  assert.ok(full.searchWork > 0);

  const starved = classifyColourability(graph, { budget: full.cliqueWork + 1 });
  assert.equal(
    starved.verdict,
    'unknown',
    `a budget between the clique and search costs must yield unknown, got ${starved.verdict}`,
  );
  assert.equal(starved.certificate, 'budget');

  // And at exactly the clique cost, before the search can charge anything.
  const atClique = classifyColourability(graph, { budget: full.cliqueWork });
  assert.notEqual(atClique.verdict, 'infeasible', 'never infeasible on an unfinished search');
});

test('an infeasible verdict is only ever reported from a completed search', () => {
  // Sweeping the budget across the whole decision range: no budget may produce
  // an infeasible verdict for a graph that is actually colourable.
  const graph = turanGraph(17, 8);
  const full = classifyColourability(graph);
  for (let budget = 0; budget <= full.work + 50; budget += 7) {
    const verdict = classifyColourability(graph, { budget });
    assert.notEqual(
      verdict.verdict,
      'infeasible',
      `budget ${budget} wrongly proved a colourable graph impossible`,
    );
  }
});
