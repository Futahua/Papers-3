/** Deciding whether a proximity component can satisfy the hue separation at all.
 *
 * The hue constraint is exactly graph colouring. With a minimum separation of
 * 45 degrees there are 360/45 = 8 half-open sectors, and:
 *
 *   - an 8-colouring gives a feasible placement, by putting colour k at the
 *     centre of sector k, where any two adjacent entities are at least 45 apart;
 *   - any feasible placement gives an 8-colouring, by mapping each hue to the
 *     sector containing it, since two adjacent entities cannot share a sector
 *     when their hue distance must be at least the sector width.
 *
 * So "cannot be satisfied" means precisely "not 8-colourable", and nothing less
 * than that may be treated as proof. Size and density do not decide it: the
 * extremal 8-colourable graph on 17 vertices is the Turan graph T8(17), which
 * has exactly 126 edges — and a 17-vertex component with exactly 126 edges is
 * what this codebase actually observes. That component sits precisely on the
 * boundary and could be either.
 *
 * The verdict is deliberately three-valued. `unknown` is not a failure; it is
 * the honest answer when the bounded search has not decided, and callers must
 * treat it exactly as they treat `feasible`.
 */

/** Propagated out of the recursions the instant the ledger is spent. Returning
 * a plain false instead would unwind only one frame, leaving parents free to
 * explore further branches — so the cap would be advisory, the reported work
 * would understate what was done, and a colouring found after crossing the
 * limit would still be reported as a decision. */
const BUDGET_EXHAUSTED = Symbol('hue-colourability-budget-exhausted');

const createLedger = (limit) => ({ limit, work: 0 });

/** Charges one unit, or reports that there is nothing left to charge. */
const spend = (ledger) => {
  if (ledger.work >= ledger.limit) return false;
  ledger.work += 1;
  return true;
};

/** Maximum edges a k-colourable graph on n vertices can have: the balanced
 * complete k-partite Turan graph. More edges than this proves non-k-colourable;
 * equalling it proves nothing, since T_k(n) itself is k-colourable. */
export function turanMaxEdges(n, colours) {
  if (n <= 1 || colours < 1) return 0;
  if (n <= colours) return (n * (n - 1)) / 2;
  const base = Math.floor(n / colours);
  const larger = n % colours; // parts of size base + 1
  const total = (n * (n - 1)) / 2;
  let withinParts = 0;
  for (let part = 0; part < colours; part += 1) {
    const size = part < larger ? base + 1 : base;
    withinParts += (size * (size - 1)) / 2;
  }
  return total - withinParts;
}

/** Deterministic bounded search for a clique of exactly `size`. A clique that
 * large cannot be coloured with fewer colours than its size, so finding one on
 * `colours + 1` vertices is a complete proof of infeasibility.
 *
 * Returns true, false, or BUDGET_EXHAUSTED. */
function findClique(nodes, neighbours, size, ledger) {
  if (nodes.length < size) return false;
  // Descending degree, then id: vertices likely to be in a large clique first,
  // and stable across runs.
  const ordered = nodes
    .slice()
    .sort((a, b) => (neighbours.get(b).size - neighbours.get(a).size) || (a < b ? -1 : 1));

  const grow = (clique, candidates) => {
    if (clique.length === size) return true;
    if (clique.length + candidates.length < size) return false;
    for (let index = 0; index < candidates.length; index += 1) {
      if (!spend(ledger)) return BUDGET_EXHAUSTED;
      // Not enough candidates left to reach the target from here.
      if (clique.length + (candidates.length - index) < size) return false;
      const candidate = candidates[index];
      const next = candidates
        .slice(index + 1)
        .filter((other) => neighbours.get(candidate).has(other));
      clique.push(candidate);
      const result = grow(clique, next);
      clique.pop();
      if (result === BUDGET_EXHAUSTED) return BUDGET_EXHAUSTED;
      if (result === true) return true;
    }
    return false;
  };

  return grow([], ordered);
}

/** DSATUR with backtracking. Returns true if a colouring exists, false if the
 * search space was exhausted without one, and BUDGET_EXHAUSTED if the ledger ran
 * out first — propagated immediately, so no sibling branch is explored past the
 * cap and the charged work never exceeds it.
 *
 * The ledger counts assignments attempted, not milliseconds, so the verdict for
 * a given graph is the same on every machine and every run. */
function searchColouring(nodes, neighbours, colours, ledger) {
  const assigned = new Map();

  const step = () => {
    if (assigned.size === nodes.length) return true;
    // DSATUR: most saturated first, breaking ties on degree then id, so the
    // traversal is deterministic.
    let chosen = null;
    let chosenSaturation = -1;
    let chosenDegree = -1;
    for (const node of nodes) {
      if (assigned.has(node)) continue;
      const used = new Set();
      for (const neighbour of neighbours.get(node)) {
        const colour = assigned.get(neighbour);
        if (colour !== undefined) used.add(colour);
      }
      const saturation = used.size;
      const degree = neighbours.get(node).size;
      if (saturation > chosenSaturation
        || (saturation === chosenSaturation && degree > chosenDegree)
        || (saturation === chosenSaturation && degree === chosenDegree
          && chosen !== null && node < chosen)) {
        chosen = node;
        chosenSaturation = saturation;
        chosenDegree = degree;
      }
    }

    const used = new Set();
    for (const neighbour of neighbours.get(chosen)) {
      const colour = assigned.get(neighbour);
      if (colour !== undefined) used.add(colour);
    }
    for (let colour = 0; colour < colours; colour += 1) {
      if (used.has(colour)) continue;
      if (!spend(ledger)) return BUDGET_EXHAUSTED;
      assigned.set(chosen, colour);
      const result = step();
      assigned.delete(chosen);
      if (result === BUDGET_EXHAUSTED) return BUDGET_EXHAUSTED;
      if (result === true) return true;
    }
    return false;
  };

  return step();
}

/** Classifies a proximity component as feasible, infeasible or unknown.
 *
 * `adjacency` is a Map from id to a Set of neighbouring ids. Escalates from the
 * cheapest complete certificates to a bounded search, and stops at the first one
 * that decides. One ledger is shared by both searches, so the reported work is
 * the total charged and never exceeds the budget. */
export function classifyColourability(adjacency, { colours = 8, budget = 20000 } = {}) {
  const nodes = [...adjacency.keys()].sort();
  const neighbours = adjacency;
  const n = nodes.length;
  let edges = 0;
  for (const node of nodes) edges += neighbours.get(node).size;
  edges /= 2;

  const ledger = createLedger(budget);
  // Split so the accounting is observable rather than asserted. An earlier
  // version reported the total as budget minus the budget handed to the search,
  // which is identically the clique cost, so every DSATUR assignment was
  // invisible and the published work figures understated the classifier.
  let cliqueWork = 0;
  const decided = (verdict, certificate) => ({
    verdict,
    certificate,
    work: ledger.work,
    cliqueWork,
    searchWork: ledger.work - cliqueWork,
    n,
    edges,
  });

  // Fewer vertices than colours: give each its own.
  if (n <= colours) return decided('feasible', 'size');

  // Above the Turan bound there is no k-partite graph this dense.
  if (edges > turanMaxEdges(n, colours)) return decided('infeasible', 'turan');

  // A clique on colours + 1 vertices needs colours + 1 colours.
  const clique = findClique(nodes, neighbours, colours + 1, ledger);
  cliqueWork = ledger.work;
  if (clique === true) return decided('infeasible', 'clique');
  if (clique === BUDGET_EXHAUSTED) return decided('unknown', 'budget');

  const searched = searchColouring(nodes, neighbours, colours, ledger);
  if (searched === true) return decided('feasible', 'search');
  if (searched === false) return decided('infeasible', 'search');
  return decided('unknown', 'budget');
}

/** Builds the adjacency a classifier needs from a component's pair list. */
export function adjacencyFromPairs(componentPairs) {
  const adjacency = new Map();
  for (const [a, b] of componentPairs) {
    if (!adjacency.has(a.id)) adjacency.set(a.id, new Set());
    if (!adjacency.has(b.id)) adjacency.set(b.id, new Set());
    adjacency.get(a.id).add(b.id);
    adjacency.get(b.id).add(a.id);
  }
  return adjacency;
}
