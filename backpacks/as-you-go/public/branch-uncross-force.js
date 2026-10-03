const DEFAULT_GAP = 18;
const ANCHOR_WEIGHT = 1_000_000;

function endpoint(value, byId) {
  return typeof value === 'object' && value ? value : byId.get(value);
}

/** Weighted pool-adjacent-violators projection onto x0 <= ... <= xn.
 * This is the unique least-squares closest monotone sequence. */
export function isotonicProjection(values, weights = values.map(() => 1)) {
  const blocks = [];
  values.forEach((value, index) => {
    const weight = Math.max(1e-9, Number(weights[index]) || 1);
    blocks.push({ start: index, end: index, weight, sum: value * weight });
    while (blocks.length >= 2) {
      const right = blocks.at(-1);
      const left = blocks.at(-2);
      if (left.sum / left.weight <= right.sum / right.weight) break;
      blocks.splice(-2, 2, {
        start: left.start,
        end: right.end,
        weight: left.weight + right.weight,
        sum: left.sum + right.sum,
      });
    }
  });
  const output = Array(values.length);
  for (const block of blocks) {
    const mean = block.sum / block.weight;
    for (let index = block.start; index <= block.end; index += 1) output[index] = mean;
  }
  return output;
}

/** Nearest positions whose chosen coordinate advances by at least gap. */
export function projectMonotoneChain(nodes, axis, direction, gap = DEFAULT_GAP) {
  const sign = direction < 0 ? -1 : 1;
  const transformed = nodes.map((node, index) => sign * node[axis] - index * gap);
  const weights = nodes.map((node, index) => (
    index === 0 || node.fx != null || node.fy != null ? ANCHOR_WEIGHT : 1
  ));
  const fitted = isotonicProjection(transformed, weights);
  return fitted.map((value, index) => sign * (value + index * gap));
}

function maximalChains(links, byId) {
  const resolved = links.map((link, index) => ({
    index,
    source: endpoint(link.source, byId),
    target: endpoint(link.target, byId),
  })).filter(({ source, target }) => source && target);
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of resolved) {
    if (!incoming.has(edge.target.id)) incoming.set(edge.target.id, []);
    if (!outgoing.has(edge.source.id)) outgoing.set(edge.source.id, []);
    incoming.get(edge.target.id).push(edge);
    outgoing.get(edge.source.id).push(edge);
  }
  const visited = new Set();
  const chains = [];

  function consume(first) {
    if (visited.has(first.index)) return;
    const nodes = [first.source, first.target];
    visited.add(first.index);
    let cursor = first.target;
    while ((incoming.get(cursor.id)?.length ?? 0) === 1 && (outgoing.get(cursor.id)?.length ?? 0) === 1) {
      const next = outgoing.get(cursor.id)[0];
      if (visited.has(next.index)) break;
      visited.add(next.index);
      nodes.push(next.target);
      cursor = next.target;
    }
    chains.push(nodes);
  }

  // Every fork begins independent branches. Each continues only until the next
  // fork/merge, matching the creator's numbered paths 1 and 2 rather than
  // treating their entire connected tree as a single object.
  for (const edge of resolved) {
    const sourceIn = incoming.get(edge.source.id)?.length ?? 0;
    const sourceOut = outgoing.get(edge.source.id)?.length ?? 0;
    if (sourceIn !== 1 || sourceOut !== 1) consume(edge);
  }
  for (const edge of resolved) consume(edge);
  return chains;
}

/** Marks every node with the longest maximal branch it participates in.
 * Edge count, rather than visual size, is the rigidity measure: adding depth
 * makes the same branch progressively less susceptible to center gravity. */
export function assignBranchRigidity(nodes, links) {
  const byId = new Map(nodes.filter((node) => node?.id != null).map((node) => [node.id, node]));
  for (const node of nodes) node.branchRigidity = 1;
  for (const chain of maximalChains(links, byId)) {
    const rigidity = Math.max(1, chain.length - 1);
    for (const node of chain) node.branchRigidity = Math.max(node.branchRigidity ?? 1, rigidity);
  }
  return nodes;
}

/** Smooth inverse response: 1 edge keeps the existing gravity; 4 edges feel
 * roughly half; very long branches continue stiffening without reaching an
 * immovable zero-gravity singularity. */
export function branchCenterGravityStrength(node, baseStrength = 0.05) {
  const rigidity = Math.max(1, Number(node?.branchRigidity) || 1);
  return baseStrength / (1 + 0.32 * (rigidity - 1));
}

function sharedEdgeRigidity(link) {
  const source = typeof link?.source === 'object' ? link.source : null;
  const target = typeof link?.target === 'object' ? link.target : null;
  return Math.max(1, Math.min(
    Number(source?.branchRigidity) || 1,
    Number(target?.branchRigidity) || 1,
  ));
}

/** Long branches prefer a tighter edge length. The lower bound prevents a
 * deep branch collapsing into an unreadable knot. */
export function branchLinkDistance(link, baseDistance = 145) {
  const rigidity = sharedEdgeRigidity(link);
  return Math.max(105, baseDistance / (1 + 0.06 * (rigidity - 1)));
}

/** A modest matching stiffness makes compactness win against charge without
 * recreating an impulse. Both endpoints must share the long branch, so a short
 * sibling attached to its fork keeps the original spring. */
export function branchLinkStrength(link, baseStrength = 0.14) {
  const rigidity = sharedEdgeRigidity(link);
  return Math.min(0.28, baseStrength * (1 + 0.1 * (rigidity - 1)));
}

function naturalAxis(chain) {
  const first = chain[0];
  const last = chain.at(-1);
  const rangeX = Math.max(...chain.map((node) => node.x)) - Math.min(...chain.map((node) => node.x));
  const rangeY = Math.max(...chain.map((node) => node.y)) - Math.min(...chain.map((node) => node.y));
  const axis = Math.abs(last.x - first.x) + rangeX * 0.25 >= Math.abs(last.y - first.y) + rangeY * 0.25
    ? 'x'
    : 'y';
  const delta = last[axis] - first[axis];
  if (Math.abs(delta) > 1e-6) return { axis, direction: Math.sign(delta) };
  const secondDelta = chain[1]?.[axis] - first[axis];
  return { axis, direction: Math.sign(secondDelta) || 1 };
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Convex, non-oscillating branch constraint. Each maximal non-branching path
 * is projected to its closest monotone coordinate sequence. A coordinate-
 * monotone path cannot cross itself, and the workspace cubic is monotone in
 * both x and y between its endpoints. Sibling paths are separate constraints.
 */
export function forceBranchUncross({
  gap = DEFAULT_GAP,
  maxStep = 1.8,
} = {}) {
  let nodes = [];
  let links = [];
  let byId = new Map();
  let chains = [];

  function rebuild() {
    assignBranchRigidity(nodes, links);
    chains = maximalChains(links, byId)
      // Fewer than four vertices cannot contain two non-adjacent crossing
      // segments, so constraining them would only alter harmless short limbs.
      .filter((chain) => chain.length >= 4)
      .map((chain) => ({ nodes: chain, ...naturalAxis(chain) }));
  }

  function force() {
    for (const chain of chains) {
      const desired = projectMonotoneChain(chain.nodes, chain.axis, chain.direction, gap);
      for (let index = 1; index < chain.nodes.length; index += 1) {
        const node = chain.nodes[index];
        if (node.fx != null || node.fy != null) continue;
        const velocity = chain.axis === 'x' ? 'vx' : 'vy';
        // Replace, do not accumulate, the constrained-axis velocity. This is a
        // bounded approach to a convex projection—not a repulsive impulse—so it
        // cannot accelerate into the previous fling behavior.
        node[velocity] = clamp(desired[index] - node[chain.axis], maxStep);
      }
    }
  }

  force.initialize = (nextNodes) => {
    nodes = nextNodes ?? [];
    byId = new Map(nodes.filter((node) => node?.id != null).map((node) => [node.id, node]));
    rebuild();
  };
  force.links = (nextLinks) => {
    if (nextLinks === undefined) return links;
    links = nextLinks ?? [];
    rebuild();
    return force;
  };
  return force;
}
