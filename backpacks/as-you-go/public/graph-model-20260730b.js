import { adjacencyFromPairs, classifyColourability } from './hue-colourability.js';
import { itemsIn, binnedItems, itemsInBinnedGroup, ROOT_ID } from './workspace-model-20260730b.js';
import { belongsToSet } from './sets-model.js';

/** A shortcut's identity for graph purposes is its shared shortcut record
 * (`shortcutId`), not any one placement — a linked shortcut visible from
 * several currently-expanded folders at once must collapse to one node.
 * Groups have no such sharing, so a group's own id is its identity. */
function identityOf(candidate) {
  return candidate.kind === 'shortcut' ? candidate.shortcutId : candidate.id;
}

/** Breadcrumb bodies encode their position in the path through size. The
 * root is 30%, the exact path midpoint is 60%, and the immediate parent is
 * 100%. Longer paths distribute smoothly through those anchors. A one-node
 * path is both root and immediate parent, so proximity wins and it stays at
 * the normal 100% size. */
export function breadcrumbNodeScale(index, count, { rootScale = 0.3, middleScale = 0.6 } = {}) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count <= 0) return 1;
  if (count === 1) return 1;
  const root = Math.max(0.3, Math.min(1, Number(rootScale) || 0.3));
  const middle = Math.max(root, Math.min(1, Number(middleScale) || 0.6));
  const t = Math.max(0, Math.min(1, index / (count - 1)));
  const scale = t <= 0.5
    ? root + (2 * (middle - root) * t)
    : middle + (2 * (1 - middle) * (t - 0.5));
  return Math.round(scale * 1000) / 1000;
}

/** An ordinary expanded branch reads from its large root toward its small
 * revealed end. Two visible generations use 100% -> middle; longer branches
 * interpolate monotonically through middle toward root. Every icon revealed
 * at a generation shares that generation's scale, regardless of item kind. */
function expandedBranchScale(depth, count, scales) {
  if (count <= 1 || depth <= 0) return 1;
  if (count === 2) return breadcrumbNodeScale(1, 3, scales);
  return breadcrumbNodeScale(Math.max(0, count - 1 - depth), count, scales);
}

function createVisibleBranchCountResolver(childrenOf, expanded) {
  const visiting = new Set();
  function count(folderId) {
    if (visiting.has(folderId)) return 1;
    visiting.add(folderId);
    const visibleFolderChildren = expanded.has(folderId)
      ? childrenOf(folderId).filter((child) => child.kind === 'group')
      : [];
    const value = visibleFolderChildren.length === 0
      ? 1
      : 1 + Math.max(...visibleFolderChildren.map((child) => count(child.id)));
    visiting.delete(folderId);
    return value;
  }
  return count;
}

/** Walks the Bin from binCurrentId ('bin' for the top-level list, or a
 * binned folder's id after drilling into it — see the renderer's
 * dedicated Bin breadcrumb/navigation). Every item at that level is a
 * root (depth 0), and expanding a nested folder reveals its still-intact
 * contents beneath it in place — those were never independently binned,
 * just hidden by their binned ancestor, so they're each their own
 * restorable/deletable tile. Unlike the normal graph there's no
 * shared-identity dedup: two placements of the same linked shortcut
 * binned separately are two independent tiles. */
function collectVisibleBin(state, expanded, binCurrentId = 'bin', ancestors = [], trailExpanded = new Set(), breadcrumbScales = undefined) {
  const result = [];
  const ancestorIds = new Set(ancestors.map((entry) => entry.id));
  const visibleBranchCount = createVisibleBranchCountResolver(
    (folderId) => itemsInBinnedGroup(state, folderId),
    expanded,
  );

  const byIdentity = new Map();
  ancestors.forEach((entry, index) => {
    const chainParentId = index === 0 ? null : ancestors[index - 1].id;
    byIdentity.set(entry.id, {
      id: entry.id,
      kind: 'group',
      depth: index,
      siblingIndex: 0,
      siblingCount: 1,
      parents: chainParentId ? [chainParentId] : [],
      ancestor: true,
      trail: true,
      trailScale: breadcrumbNodeScale(index, ancestors.length, breadcrumbScales),
    });
  });

  function walkBinChildren(groupId, depth, trailBranch, trailScale = 1, branchCount = 1) {
    const children = groupId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, groupId);
    children.forEach((child, siblingIndex) => {
      // The folder we are drilled into is part of an expanded ancestor's
      // child list; the current folder never renders.
      if (child.id === binCurrentId) return;
      const isOpen = child.kind === 'group'
        && (trailBranch ? trailExpanded.has(child.id) : expanded.has(child.id));
      const childBranchCount = !trailBranch && depth === 0 && isOpen
        ? visibleBranchCount(child.id)
        : branchCount;
      result.push({
        id: child.id,
        parentId: groupId === 'bin' ? 'bin' : groupId,
        kind: child.kind,
        depth,
        siblingIndex,
        siblingCount: children.length,
        trail: trailBranch,
        trailScale: trailBranch
          ? trailScale
          : expandedBranchScale(depth, childBranchCount, breadcrumbScales),
      });
      if (isOpen) {
        // A deeper breadcrumb owns its own expanded branch and scale. Do not
        // walk into it from an earlier (smaller) ancestor first.
        if (!(trailBranch && ancestorIds.has(child.id))) {
          walkBinChildren(child.id, depth + 1, trailBranch, trailScale, childBranchCount);
        }
      }
    });
  }

  const roots = binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, binCurrentId);
  roots.forEach((candidate, siblingIndex) => {
    if (candidate.id === binCurrentId) return;
    const isOpen = candidate.kind === 'group' && expanded.has(candidate.id);
    const branchCount = isOpen ? visibleBranchCount(candidate.id) : 1;
    result.push({
      id: candidate.id,
      parentId: 'bin',
      kind: candidate.kind,
      depth: 0,
      siblingIndex,
      siblingCount: roots.length,
      trail: false,
      trailScale: 1,
      // The folder this item was actually inside when it was sent to the
      // Bin (not its Bin-graph parent, which is always 'bin' at this
      // depth) — lets the renderer draw a "where did this come from" edge.
      // Only set for a linked shortcut (more than one active placement) —
      // that's the only case where binning produces several
      // identical-looking tiles with no way to tell which placement came
      // from where. An ordinary single-placement item's origin is obvious
      // (there's only one), so it doesn't need a ghost/edge cluttering the
      // Bin. Only meaningful at the true top level (drilled-in roots
      // already show their real parent via the breadcrumb, not an edge).
      originParentId: binCurrentId === 'bin' && candidate.kind === 'shortcut' && candidate.wasLinked
        ? (candidate.bin?.parentId ?? null)
        : null,
    });
    if (candidate.kind === 'group' && expanded.has(candidate.id)) {
      walkBinChildren(candidate.id, 1, false, 1, branchCount);
    }
  });

  // The ancestor chain as ordinary Bin bodies, then each expanded ancestor's
  // children in place (the Bin head's children are the top-level Bin list).
  // Expanded ancestor descendants are trail items like everywhere else.
  result.unshift(...[...byIdentity.values()].map(({ parents, ...entry }) => ({
    ...entry,
    parentId: parents[0],
    parentIds: parents,
  })));
  ancestors.forEach((entry, index) => {
    if (trailExpanded.has(entry.id)) {
      walkBinChildren(entry.id, index + 1, true, breadcrumbNodeScale(index, ancestors.length, breadcrumbScales));
    }
  });

  return result;
}

export function visibleGraphItems(
  state,
  parentId,
  expandedSet,
  binMode = false,
  binCurrentId = 'bin',
  ancestors = [],
  trailExpanded = new Set(),
  breadcrumbScales = undefined,
) {
  if (binMode) return collectVisibleBin(state, expandedSet, binCurrentId, ancestors, trailExpanded, breadcrumbScales);
  return collectVisible(state, parentId, expandedSet, ancestors, trailExpanded, breadcrumbScales);
}

/** Set outlines are owned by direct members visible at the current level.
 * Inherited descendants still belong to the set, but they do not make its
 * outline follow the user into a member folder. */
export function directSetMemberIdsVisible(set, visibleIds) {
  const direct = new Set(set?.memberIds ?? []);
  return (Array.isArray(visibleIds) ? visibleIds : []).filter((id) => direct.has(id));
}

/** The visible items that participate in the set system for this view.
 *
 * Trail-derived bodies — ancestors and everything revealed beneath an
 * expanded ancestor — are outside the set system: they render no ring,
 * glyph, region or effect, and receive no gravity, containment, separation,
 * exclusion or ejection. One helper, so every consumer agrees; it filters
 * the current rendering inputs only and never mutates or persists a set.
 * Persisted membership is untouched: when the same item is later ordinary,
 * its sets act on it normally again. */
export function setEligibleItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item.trail !== true);
}

/** Once a set is eligible to draw at a level, its ring encloses every visible
 * member, including descendants inherited through a member folder. */
export function inheritedSetMemberIdsVisible(set, visibleIds, ancestorsOfNode) {
  return (Array.isArray(visibleIds) ? visibleIds : [])
    .filter((id) => belongsToSet(set, id, ancestorsOfNode));
}

/** Walks every currently-visible folder (the current one, plus every
 * expanded folder reachable from it) and emits one entry per distinct
 * identity, recording every parent it was actually found under so
 * graphEdges can draw an edge from each of them. A shortcut linked into two
 * expanded folders therefore appears once, with two parents recorded.
 *
 * `ancestors` prepends the current folder's ancestor chain as ordinary
 * entries (the trail as folder contents): each ancestor is a real folder
 * body, marked `ancestor: true` so the workspace can give it the --text
 * outline, keep it out of selection/deletion, and never persist anything
 * about it. The current folder itself never appears — the chain is the
 * path TO here — and expanding an ancestor walks its children in place,
 * skipping the current folder.
 *
 * `trail: true` is the broader derived-branch provenance: every ancestor
 * body AND everything reached by walking an expanded ancestor (recursively)
 * is a trail item. Ordinary current-folder traversal yields `trail: false`.
 * A shared shortcut identity visible through both paths merges into one
 * body, and real provenance wins — the merged body stays `trail: false`,
 * keeps its sets and its opacity. The set system and the Trail opacity
 * slider both read this flag.
 *
 * Expansion is split by provenance (Assignment 007): the ordinary
 * current-folder walk consults only `expanded`, and every trail branch
 * consults only `trailExpanded`, recursively. The two sets never seed or
 * mutate each other, and a view with no saved trail choice passes an empty
 * trail set — every trail folder starts collapsed. */
function collectVisible(state, parentId, expanded, ancestors = [], trailExpanded = new Set(), breadcrumbScales = undefined) {
  const byIdentity = new Map();
  const visitedFolders = new Set();
  const ancestorIds = new Set(ancestors.map((entry) => entry.id));
  const visibleBranchCount = createVisibleBranchCountResolver(
    (folderId) => itemsIn(state, folderId).filter((item) => item.kind !== 'window-layout'),
    expanded,
  );

  ancestors.forEach((entry, index) => {
    const chainParentId = index === 0 ? null : ancestors[index - 1].id;
    byIdentity.set(entry.id, {
      id: entry.id,
      kind: 'group',
      depth: index,
      siblingIndex: 0,
      siblingCount: 1,
      parents: chainParentId ? [chainParentId] : [],
      ancestor: true,
      trail: true,
      trailScale: breadcrumbNodeScale(index, ancestors.length, breadcrumbScales),
    });
  });

  function walk(folderId, depth, trailBranch, trailScale = 1, branchCount = 1) {
    if (visitedFolders.has(folderId)) return;
    visitedFolders.add(folderId);
    // Window layouts are native widgets now, not spatial graph bodies. Keep
    // their durable records in the model/Quick Run, but never feed them into
    // graph physics, spacing, selection, or graph-position persistence.
    const children = itemsIn(state, folderId).filter((item) => item.kind !== 'window-layout');
    children.forEach((child, siblingIndex) => {
      // An ancestor's children include the folder we are standing in —
      // that is the whole point of the chain — but the current folder
      // never renders. A folder cannot be its own child, so this check
      // is inert for the normal walk.
      if (child.id === parentId) return;
      const identity = identityOf(child);
      const isOpen = child.kind === 'group'
        && (trailBranch ? trailExpanded.has(child.id) : expanded.has(child.id));
      const childBranchCount = !trailBranch && depth === 0 && isOpen
        ? visibleBranchCount(child.id)
        : branchCount;
      const ordinaryScale = expandedBranchScale(depth, childBranchCount, breadcrumbScales);
      let entry = byIdentity.get(identity);
      if (!entry) {
        entry = {
          id: identity,
          kind: child.kind,
          depth,
          siblingIndex,
          siblingCount: children.length,
          parents: [],
          trail: trailBranch,
          trailScale: trailBranch ? trailScale : ordinaryScale,
        };
        byIdentity.set(identity, entry);
      } else if (!trailBranch) {
        // Real provenance wins: a shared shortcut visible through both the
        // ordinary current-folder path and a trail path is one ordinary
        // body, so the merged entry is never flipped to trail.
        entry.trail = false;
        entry.trailScale = ordinaryScale;
      } else if (entry.trail) {
        // A shared trail-only body can be reached from more than one expanded
        // breadcrumb. Let the nearer (larger) branch win at a glance.
        entry.trailScale = Math.max(entry.trailScale ?? 0.3, trailScale);
      }
      entry.parents.push(folderId);
      // Each expanded breadcrumb is walked separately below with its own
      // depth-derived scale. Crossing into it here would let an earlier
      // ancestor claim the folder in visitedFolders at the wrong size.
      if (isOpen && !(trailBranch && ancestorIds.has(child.id))) {
        walk(child.id, depth + 1, trailBranch, trailScale, childBranchCount);
      }
    });
  }
  walk(parentId, 0, false, 1);
  // An expanded ancestor reveals its children in place, exactly like any
  // expanded folder in the current view — but those children are trail
  // items, and so are everything reached by expanding them further.
  ancestors.forEach((entry, index) => {
    if (trailExpanded.has(entry.id)) {
      walk(entry.id, index + 1, true, breadcrumbNodeScale(index, ancestors.length, breadcrumbScales));
    }
  });

  return [...byIdentity.values()].map(({ parents, ...entry }) => ({
    ...entry,
    parentId: parents[0],
    parentIds: parents,
  }));
}

export function graphEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  const edges = [];
  const seenKeys = new Set();
  for (const item of items) {
    const parentIds = item.parentIds ?? [item.parentId];
    for (const parentId of parentIds) {
      // An edge draws exactly when both endpoints are visible. The old
      // skip of ROOT_ID/'bin' parents existed only because those heads
      // were never nodes; an ancestor chain makes them visible tiles, so
      // their edges draw like any other — and a head that is not in the
      // list (e.g. at the root view) still gets no edge, because its id
      // is not in `ids`.
      if (!ids.has(parentId)) continue;
      const key = `${parentId}->${item.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      edges.push({ id: key, source: parentId, target: item.id });
    }
  }
  return edges;
}

/** For each top-level binned item, an edge back to the folder it was
 * actually inside when binned — separate from graphEdges() (which only
 * connects a Bin-graph node to its Bin-graph parent, always 'bin' at the
 * root) because a shortcut linked into several folders and binned all at
 * once otherwise produces several identical-looking tiles with no way to
 * tell which placement came from where. Rendered as a distinct (red)
 * edge kind by the caller. Targets a ghost node id
 * ('bin-origin:<folderId>') when the origin folder itself isn't visible
 * in the current Bin walk (the common case — it's still a normal, active
 * folder outside the Bin). */
export function binOriginEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  const edges = [];
  const seenKeys = new Set();
  for (const item of items) {
    if (item.depth !== 0 || !item.originParentId) continue;
    const realTarget = ids.has(item.originParentId) ? item.originParentId : null;
    const source = realTarget ?? `bin-origin:${item.originParentId}`;
    const key = `${source}->${item.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    edges.push({ id: key, source, target: item.id, ghost: !realTarget, ghostGroupId: item.originParentId });
  }
  return edges;
}

const RADIUS = 28;
const SPACING = (2 * Math.PI) / 40;

export function seedPosition(itemId, parent, index, count, originX = 0, originY = 0) {
  if (!parent) {
    const total = Math.max(count, 1);
    const angle = (2 * Math.PI * index) / total;
    const ringRadius = RADIUS * 2.4 * Math.max(1, total / 4);
    return {
      x: Math.cos(angle) * ringRadius + originX,
      y: Math.sin(angle) * ringRadius + originY,
    };
  }
  const golden = 2.39996;
  const a = golden * (index + 1);
  const r = RADIUS * 0.26 * Math.sqrt(index + 1);
  return {
    x: parent.x + Math.cos(a) * r,
    y: parent.y + Math.sin(a) * r,
  };
}

export function hashString(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  return h >>> 0;
}

export function allFinite(nodes) {
  return nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
}

export function allUniquePositions(nodes) {
  const keys = new Set(nodes.map((n) => `${n.x}|${n.y}`));
  return keys.size === nodes.length;
}

/** A folder is "near" another when they are within this many canvas pixels. */
export const FOLDER_DISTANCE = 220;

/** Hard minimum hue separation in degrees for nearby folders (8 slots at 45°).
 * 45° is a perceptual, not just numeric, step apart on the color wheel. */
export const MIN_HUE_SEPARATION = 45;

/** Original folder easing. Folders are small outlines and retain their accepted
 * pre-Assignment-015 colour response. */
const BASE_MOVE = 0.15;
/** Sets fill a large area, so their hue follows position gently over time. */
const SET_BASE_MOVE = 0.03;

/** Projection treats separations within this of MIN_HUE_SEPARATION as done. */
const PROJECTION_EPSILON = 1e-6;
/** Discrete hue slots available at the minimum separation. Colouring a
 * proximity component with this many colours is exactly equivalent to placing
 * its hues, which is why 8-colourability is the certificate. */
const HUE_SLOTS = Math.floor(360 / MIN_HUE_SEPARATION);
/** Deterministic work the classifier may spend per component. Generous next to
 * the projection it can remove, and bounded so a pathological component costs a
 * known amount and then reports unknown. */
const COLOURABILITY_BUDGET = 20000;

/** Max projection passes over the near-pair list per call. */
const MAX_PROJECTION_PASSES = 100;

/** Original folder radius colour terms, retained exactly. */
const RADIUS_SPAN = 500;
const RADIUS_WEIGHT = 120;

/** Set hue drift in degrees per pixel travelled. A 600px/s drag produces a
 * 72°/s target change, then the 0.03 easing limits the rendered change. */
const SET_DRIFT_DEGREES_PER_PIXEL = 0.12;

/** Angular distance between two hues on the 0..360 circle, in degrees. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function wrapDeg(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/** Shortest signed angle from `from` to `to`, in (-180, 180]. */
function signedAngle(from, to) {
  const d = wrapDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** Original folder position-derived base hue: the angle around `center` plus a
 * radius term, restored byte-for-byte from the pre-015 implementation. */
function positionBase(x, y, center) {
  const angle = wrapDeg((Math.atan2(y - center.cy, x - center.cx) * 180) / Math.PI);
  const radius = Math.hypot(x - center.cx, y - center.cy);
  return wrapDeg(angle + (radius / RADIUS_SPAN) * RADIUS_WEIGHT);
}

function baseFor(entity, center) {
  return positionBase(entity.x, entity.y, center);
}

function moveRateFor(entity) {
  return entity.id.startsWith('set:') ? SET_BASE_MOVE : BASE_MOVE;
}

function seedHueFor(id) {
  return (hashString(id) / 0x100000000) * 360;
}

function distanceTravelled(previous, current) {
  return Math.hypot(current.x - previous.x, current.y - previous.y);
}

/** Deterministic hue-space direction for a pair whose hues are identical:
 * derives from relative canvas position, falling back to ID order. */
function tieBreakDirection(a, b) {
  const dy = b.y - a.y;
  if (Math.abs(dy) > PROJECTION_EPSILON) return Math.sign(dy);
  const dx = b.x - a.x;
  if (Math.abs(dx) > PROJECTION_EPSILON) return Math.sign(dx);
  return a.id < b.id ? 1 : -1;
}

/** Connected components of the near-pair graph that contain a violated pair,
 * as arrays of folder ids. A component is maximal, so recoloring it cannot
 * disturb folders outside it (there are no near pairs across components). */
function componentsNearViolations(nearPairs, violatedIds) {
  const adjacency = new Map();
  for (const [a, b] of nearPairs) {
    if (!adjacency.has(a.id)) adjacency.set(a.id, []);
    if (!adjacency.has(b.id)) adjacency.set(b.id, []);
    adjacency.get(a.id).push(b.id);
    adjacency.get(b.id).push(a.id);
  }
  const seen = new Set();
  const components = [];
  for (const startId of violatedIds) {
    if (seen.has(startId)) continue;
    const stack = [startId];
    const component = [];
    seen.add(startId);
    while (stack.length > 0) {
      const id = stack.pop();
      component.push(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Greedy slot coloring (largest-degree first, ID tie-break). Returns a
 * Map(id -> slot) or null when k colors are not enough in this order. */
function greedySlotColoring(nodes, adjacency, k) {
  const order = [...nodes].sort((a, b) => {
    const degreeA = adjacency.get(a.id)?.length ?? 0;
    const degreeB = adjacency.get(b.id)?.length ?? 0;
    if (degreeA !== degreeB) return degreeB - degreeA;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const slots = new Map();
  for (const node of order) {
    const used = new Set();
    for (const other of order) {
      if (other === node || !slots.has(other.id)) continue;
      if (adjacency.get(node.id)?.includes(other.id)) used.add(slots.get(other.id));
    }
    let chosen = -1;
    for (let slot = 0; slot < k; slot += 1) {
      if (!used.has(slot)) { chosen = slot; break; }
    }
    if (chosen === -1) return null;
    slots.set(node.id, chosen);
  }
  return slots;
}

/** Deterministic fallback for an infeasible dense neighborhood: color the
 * component with the fewest slots that work (largest-first greedy) and pick
 * the slot rotation that best matches the folders' position bases, so the
 * effective minimum separation is 360 / slotCount rather than oscillating. */
/** `knownAdjacency`, when given, is the component graph the caller already
 * built from nearPairs. It describes the same edges this function would
 * rediscover — both come from the same strict FOLDER_DISTANCE test over the
 * same coordinates — so reusing it removes a second all-pairs distance scan
 * without changing which vertices are adjacent. Sets are converted to sorted
 * arrays because the greedy colouring reads length and includes. */
function slotColorComponent(componentIds, folderById, colors, center, hueState, knownAdjacency = null) {
  const ids = [...componentIds].sort();
  const nodes = ids.map((id) => folderById.get(id));
  let adjacency;
  if (knownAdjacency) {
    adjacency = new Map(ids.map((id) => [id, [...(knownAdjacency.get(id) ?? [])].sort()]));
  } else {
    adjacency = new Map(ids.map((id) => [id, []]));
    for (const [a, b] of [...ids.map((id, i) => ids.slice(i + 1).map((other) => [id, other]))].flat()) {
      const fa = folderById.get(a);
      const fb = folderById.get(b);
      if (Math.hypot(fa.x - fb.x, fa.y - fb.y) < FOLDER_DISTANCE) {
        adjacency.get(a).push(b);
        adjacency.get(b).push(a);
      }
    }
  }
  let slotCount = 1;
  let slots = null;
  for (; slotCount <= ids.length; slotCount += 1) {
    slots = greedySlotColoring(nodes, adjacency, slotCount);
    if (slots) break;
  }
  const gap = 360 / slotCount;
  let bestRotation = 0;
  let bestCost = Infinity;
  for (const candidate of ids) {
    const rotation = wrapDeg(
      folderById.get(candidate).id.startsWith('set:')
        ? (hueState.get(candidate)?.target ?? colors.get(candidate))
        : baseFor(folderById.get(candidate), center)
      - slots.get(candidate) * gap,
    );
    let cost = 0;
    for (const id of ids) {
      const hue = wrapDeg(rotation + slots.get(id) * gap);
      const base = folderById.get(id).id.startsWith('set:')
        ? (hueState.get(id)?.target ?? colors.get(id))
        : baseFor(folderById.get(id), center);
      cost += Math.abs(signedAngle(base, hue));
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestRotation = rotation;
    }
  }
  for (const id of ids) {
    colors.set(id, wrapDeg(bestRotation + slots.get(id) * gap));
  }
  // Reported for diagnostics only; no caller changes behaviour on it.
  return slotCount;
}

/**
 * Updates folder hues from their original position mapping and set hues from
 * stable-id seeds plus accumulated travel distance, then
 * projects every pair within FOLDER_DISTANCE apart until no pair is closer
 * than MIN_HUE_SEPARATION. Pair traversal alternates forward/reverse between
 * passes to reduce solver-order bias; ties use a deterministic direction.
 * Hues stay floating-point (CSS hsl() accepts fractional degrees). When a
 * dense neighborhood cannot keep MIN_HUE_SEPARATION (its proximity graph needs
 * more than eight colors), the affected component is re-colored with the fewest
 * slots that work, for an effective minimum separation of 360 / slotCount.
 *
 * `folders` is an array of { id, x, y }; `colors` is the id -> displayed hue
 * map. `hueState` is session-only set state: callers keep it alive while a set
 * may disappear and reappear, and never persist it.
 */
/** Every pair of entities closer than FOLDER_DISTANCE, in exactly the order an
 * all-pairs double loop over the id-sorted list would emit them: ascending i,
 * then ascending j within each i.
 *
 * The order is not incidental. Projection walks these pairs and mutates hues as
 * it goes, so a different sequence over the same pairs converges to different
 * colours. Any faster discovery has to reproduce the sequence element for
 * element, which is what the equivalence tests check.
 *
 * A uniform grid of exactly FOLDER_DISTANCE is what makes the shortcut safe: if
 * two entities are closer than that, neither their column nor their row indices
 * can differ by more than one, so the nine cells around an entity contain every
 * partner it could possibly have. The distance test itself is unchanged, so
 * boundary cases decide exactly as they did.
 *
 * Discovery was 146,070 distance tests at 128 clustered sets, for 4,003 pairs.
 */
export function findNearPairs(list, distance = FOLDER_DISTANCE) {
  const cells = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const key = `${Math.floor(list[index].x / distance)},${Math.floor(list[index].y / distance)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
  }

  const nearPairs = [];
  const candidates = [];
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    const cx = Math.floor(a.x / distance);
    const cy = Math.floor(a.y / distance);
    candidates.length = 0;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = cells.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (const j of bucket) if (j > i) candidates.push(j);
      }
    }
    // Ascending j, so the emitted sequence matches the double loop exactly.
    candidates.sort((left, right) => left - right);
    for (const j of candidates) {
      const b = list[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < distance) nearPairs.push([a, b]);
    }
  }
  return nearPairs;
}
/** Splits nearPairs into one list per connected proximity component, each list
 * preserving its pairs relative order within the global sequence.
 *
 * Components come out in order of first appearance, which keeps diagnostics
 * stable. The projections themselves commute, so emission order cannot affect
 * the result. */
export function groupPairsByComponent(nearPairs) {
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) {
      parent.set(root, parent.get(parent.get(root)));
      root = parent.get(root);
    }
    return root;
  };
  for (const [a, b] of nearPairs) {
    if (!parent.has(a.id)) parent.set(a.id, a.id);
    if (!parent.has(b.id)) parent.set(b.id, b.id);
    const rootA = find(a.id);
    const rootB = find(b.id);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  const grouped = new Map();
  for (const pair of nearPairs) {
    const root = find(pair[0].id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(pair);
  }
  return [...grouped.values()];
}
/** Runs the hard projection over near pairs, scheduled one proximity component
 * at a time.
 *
 * Disconnected components share no constraint and mutate disjoint colour
 * entries, so their operations commute and this is exactly equivalent to the
 * single global sweep it replaces — not merely close. A component that finishes
 * a pass with no correction can never be made dirty again, because nothing
 * outside it touches its hues, so it is frozen rather than re-walked while some
 * other component grinds on to the cap. Previously one pathological
 * neighbourhood kept every settled neighbourhood in the loop with it.
 *
 * Two things carry the equivalence. Each component keeps its pairs as a
 * SUBSEQUENCE of the global nearPairs order rather than an adjacency-derived
 * one, because projection is order-sensitive. And pass parity belongs to each
 * component own history starting at zero, not to a shared counter, so a
 * component always sees the forward/reverse alternation it would have seen.
 *
 * Exported so the equivalence can be tested against a reference implementation
 * of the old global projector; production calls it only from
 * assignSpatialFolderHues. */
export function projectNearPairs(nearPairs, colors, {
  collectComponents = false,
  classifyBudget = COLOURABILITY_BUDGET,
} = {}) {
  let pairVisits = 0;
  let componentPasses = 0;
  let maxPasses = 0;
  let classificationWork = 0;
  let classificationCliqueWork = 0;
  let classificationSearchWork = 0;
  let bypassedPairs = 0;
  const components = [];
  const certifiedInfeasible = [];
  for (const componentPairs of groupPairsByComponent(nearPairs)) {
    // Only a proof bypasses projection. A component that is merely slow, dense,
    // large, or undecided within the budget takes the ordinary path: `unknown`
    // is treated exactly as `feasible`, and pass count and density decide
    // nothing. The stretched workload is the reason — every one of its
    // components runs to the cap and every one of them is colourable.
    const adjacency = adjacencyFromPairs(componentPairs);
    const verdict = classifyColourability(adjacency, {
      colours: HUE_SLOTS,
      budget: classifyBudget,
    });
    classificationWork += verdict.work;
    classificationCliqueWork += verdict.cliqueWork;
    classificationSearchWork += verdict.searchWork;
    if (verdict.verdict === 'infeasible') {
      // Projection cannot succeed here, so it is not run. The component still
      // reaches slotColorComponent, exactly as it would have after the cap: the
      // slot colouring reads set targets from hueState and other bases from
      // position, never from the hues projection would have produced.
      certifiedInfeasible.push({ ids: [...adjacency.keys()], adjacency });
      bypassedPairs += componentPairs.length;
      if (collectComponents) {
        const members = new Set();
        for (const [a, b] of componentPairs) {
          members.add(a.id);
          members.add(b.id);
        }
        components.push({
          size: members.size,
          pairCount: componentPairs.length,
          passes: 0,
          pairVisits: 0,
          converged: false,
          bypassed: true,
        });
      }
      continue;
    }
    let passes = 0;
    let visits = 0;
    let converged = false;
    for (let pass = 0; pass < MAX_PROJECTION_PASSES; pass += 1) {
      let violated = false;
      const order = pass % 2 === 0 ? componentPairs : [...componentPairs].reverse();
      passes += 1;
      visits += order.length;
      for (const [a, b] of order) {
        const hueA = colors.get(a.id);
        const hueB = colors.get(b.id);
        if (typeof hueA !== 'number' || typeof hueB !== 'number') continue;
        const delta = signedAngle(hueA, hueB);
        const separation = Math.abs(delta);
        if (separation < MIN_HUE_SEPARATION) {
          const direction = separation > PROJECTION_EPSILON ? Math.sign(delta) : tieBreakDirection(a, b);
          const correction = (MIN_HUE_SEPARATION - separation) / 2;
          colors.set(a.id, wrapDeg(hueA - direction * correction));
          colors.set(b.id, wrapDeg(hueB + direction * correction));
          violated = true;
        }
      }
      if (!violated) {
        converged = true;
        break;
      }
    }
    pairVisits += visits;
    componentPasses += passes;
    if (passes > maxPasses) maxPasses = passes;
    if (collectComponents) {
      const members = new Set();
      for (const [a, b] of componentPairs) {
        members.add(a.id);
        members.add(b.id);
      }
      components.push({
        size: members.size,
        pairCount: componentPairs.length,
        passes,
        pairVisits: visits,
        converged,
      });
    }
  }
  return {
    pairVisits,
    componentPasses,
    maxPasses,
    components,
    certifiedInfeasible,
    classificationWork,
    classificationCliqueWork,
    classificationSearchWork,
    bypassedPairs,
  };
}
/** The optional fifth argument is a diagnostics sink. When absent — which is
 * every production call — nothing extra is computed and the function behaves
 * exactly as before. When present it is filled with the work the solver did,
 * so a benchmark can tell pair discovery apart from projection effort without
 * timing internals or guessing. */
export function assignSpatialFolderHues(folders, colors, center, hueState = new Map(), diagnostics = null) {
  const list = [...folders].sort((a, b) => a.id.localeCompare(b.id));
  const folderById = new Map(list.map((folder) => [folder.id, folder]));
  const nearPairs = findNearPairs(list);

  if (diagnostics) {
    diagnostics.spatialEntities = list.length;
    diagnostics.possiblePairs = (list.length * (list.length - 1)) / 2;
    diagnostics.nearPairs = nearPairs.length;
    // NONTRIVIAL components only: adjacency is built from nearPairs, so an
    // entity with no near neighbour appears nowhere here. 128 separated sets
    // report zero components rather than 256 singletons. Isolates are counted
    // separately, since they are exactly the entities projection never touches.
    const adjacency = new Map();
    for (const [a, b] of nearPairs) {
      if (!adjacency.has(a.id)) adjacency.set(a.id, []);
      if (!adjacency.has(b.id)) adjacency.set(b.id, []);
      adjacency.get(a.id).push(b.id);
      adjacency.get(b.id).push(a.id);
    }
    const seen = new Set();
    const components = [];
    for (const startId of adjacency.keys()) {
      if (seen.has(startId)) continue;
      const stack = [startId];
      const members = [];
      seen.add(startId);
      while (stack.length > 0) {
        const id = stack.pop();
        members.push(id);
        for (const neighbor of adjacency.get(id) ?? []) {
          if (seen.has(neighbor)) continue;
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
      const memberSet = new Set(members);
      let edges = 0;
      for (const [a, b] of nearPairs) if (memberSet.has(a.id) && memberSet.has(b.id)) edges += 1;
      const complete = (members.length * (members.length - 1)) / 2;
      components.push({
        size: members.length,
        edges,
        density: complete > 0 ? edges / complete : 1,
        // Narrowly truthful: a complete graph larger than the number of 45
        // degree slots cannot be coloured, and that is all this establishes.
        // Density does NOT decide it — the extremal 8-colourable graph on 17
        // nodes has exactly 126 edges, which is what the largest observed
        // component has. Proving infeasibility needs a real certificate.
        completeCliqueOverCapacity:
          members.length > Math.floor(360 / MIN_HUE_SEPARATION) && edges === complete,
      });
    }
    diagnostics.nearComponents = components;
    diagnostics.isolatedEntities = list.length - seen.size;
  }

  // Folders retain their position mapping. Sets seed from stable identity and
  // advance only by distance travelled; absolute coordinates never enter this
  // target after the initial seed.
  for (const folder of list) {
    const current = colors.get(folder.id);
    if (folder.id.startsWith('set:')) {
      let state = hueState.get(folder.id);
      if (!state) {
        state = { x: folder.x, y: folder.y, target: seedHueFor(folder.id) };
        hueState.set(folder.id, state);
      } else {
        state.target = wrapDeg(state.target + distanceTravelled(state, folder) * SET_DRIFT_DEGREES_PER_PIXEL);
        state.x = folder.x;
        state.y = folder.y;
      }
      const target = state.target;
      if (typeof current !== 'number') colors.set(folder.id, target);
      else colors.set(folder.id, wrapDeg(current + signedAngle(current, target) * SET_BASE_MOVE));
      continue;
    }
    const base = baseFor(folder, center);
    if (typeof current !== 'number') {
      colors.set(folder.id, base);
      continue;
    }
    colors.set(folder.id, wrapDeg(current + signedAngle(current, base) * moveRateFor(folder)));
  }

  // Hard projection: fully resolve every violating pair (never damped).
  // Scheduled per proximity component; see projectNearPairs.
  const projection = projectNearPairs(nearPairs, colors, { collectComponents: Boolean(diagnostics) });
  const projectionPairVisits = projection.pairVisits;
  const projectionComponentPasses = projection.componentPasses;
  const projectionMaxPasses = projection.maxPasses;
  const projectionComponents = projection.components;
  // Infeasible dense neighborhoods: deterministically slot-color the maximal
  // components that still violate the MIN_HUE_SEPARATION invariant.
  // Certified-infeasible components go straight to the slot colouring the
  // projector would have reached anyway, reusing the graph the classifier
  // already built rather than rediscovering it by distance.
  const directlyColoured = new Set();
  const directFallbacks = [];
  for (const component of projection.certifiedInfeasible) {
    const slotCount = slotColorComponent(
      component.ids, folderById, colors, center, hueState, component.adjacency,
    );
    directFallbacks.push({ size: component.ids.length, slotCount, direct: true });
    for (const id of component.ids) directlyColoured.add(id);
  }

  const violatedIds = new Set();
  for (const [a, b] of nearPairs) {
    // Already resolved above; re-detecting them would slot-colour them twice.
    if (directlyColoured.has(a.id) || directlyColoured.has(b.id)) continue;
    const hueA = colors.get(a.id);
    const hueB = colors.get(b.id);
    if (typeof hueA === 'number' && typeof hueB === 'number'
      && Math.abs(signedAngle(hueA, hueB)) < MIN_HUE_SEPARATION - PROJECTION_EPSILON) {
      violatedIds.add(a.id);
      violatedIds.add(b.id);
    }
  }
  if (diagnostics) {
    // NOTE: projectionPasses now means the MAXIMUM any single component needed,
    // not a count of global sweeps, because there are no global sweeps any more.
    // Aggregate effort is projectionComponentPasses.
    diagnostics.projectionPasses = projectionMaxPasses;
    diagnostics.projectionMaxPasses = projectionMaxPasses;
    diagnostics.projectionComponentPasses = projectionComponentPasses;
    diagnostics.projectionPairVisits = projectionPairVisits;
    diagnostics.projectionComponents = projectionComponents;
    diagnostics.classificationWork = projection.classificationWork;
    diagnostics.classificationCliqueWork = projection.classificationCliqueWork;
    diagnostics.classificationSearchWork = projection.classificationSearchWork;
    diagnostics.certifiedInfeasibleComponents = projection.certifiedInfeasible.length;
    diagnostics.bypassedProjectionPairs = projection.bypassedPairs;
    diagnostics.violatingIdsAfterProjection = violatedIds.size;
    // Direct fallbacks are recorded alongside the ones projection uncovered, so
    // "this component was slot-coloured" stays visible however it got there.
    diagnostics.fallbackComponents = [...directFallbacks];
  }
  if (violatedIds.size > 0) {
    for (const component of componentsNearViolations(nearPairs, [...violatedIds])) {
      const slotCount = slotColorComponent(component, folderById, colors, center, hueState);
      if (diagnostics) diagnostics.fallbackComponents.push({ size: component.length, slotCount });
    }
  }

  return colors;
}
