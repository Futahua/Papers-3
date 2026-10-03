/** Pure three-way merge policy for shared AYG document snapshots. */

export function sameJson(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function mergeChangedMap(baseValue, localValue, currentValue) {
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const result = isPlainObject(currentValue) ? { ...currentValue } : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    const localHas = Object.prototype.hasOwnProperty.call(local, key);
    if (!baseHas && localHas) result[key] = local[key];
    else if (baseHas && !localHas) delete result[key];
    else if (localHas && !sameJson(local[key], base[key])) result[key] = local[key];
  }
  return result;
}

function mergePositionMap(baseValue, localValue, currentValue, nested) {
  if (!nested) return mergeChangedMap(baseValue, localValue, currentValue);
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const current = isPlainObject(currentValue) ? currentValue : {};
  const result = {};
  const contexts = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(current)]);
  for (const context of contexts) {
    const merged = mergeChangedMap(base[context], local[context], current[context]);
    if (Object.keys(merged).length > 0) result[context] = merged;
  }
  return result;
}

/** Merge the recursive prompt/folder library by stable node id. */
function flattenPromptTree(nodes, map = new Map()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.id) continue;
    map.set(node.id, node);
    if (node.type === 'folder') flattenPromptTree(node.children, map);
  }
  return map;
}
function promptParentMap(nodes, parentId = null, map = new Map()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.id) continue;
    map.set(node.id, parentId);
    if (node.type === 'folder') promptParentMap(node.children, node.id, map);
  }
  return map;
}

/** Combine sibling ordering constraints without letting one stale reorder
 * erase a compatible reorder or positioned insertion from the other lane.
 * Relations changed from the shared base are the structural intent; when both
 * lanes change the same pair, the current writer is the deterministic winner.
 * Local-only and current-only nodes contribute all of their lane relations. */
function mergePromptOrder(baseIds, localIds, currentIds, resultIds) {
  const baseIndex = new Map(baseIds.map((id, index) => [id, index]));
  const pairKey = (a, b) => [String(a), String(b)].sort().join('\u0000');
  const relation = (ids, a, b) => {
    const ai = ids.indexOf(a);
    const bi = ids.indexOf(b);
    if (ai < 0 || bi < 0 || ai === bi) return 0;
    return ai < bi ? -1 : 1;
  };
  const changedPairs = (ids) => {
    const changed = new Set();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (!baseIndex.has(a) || !baseIndex.has(b)) continue;
        const baseRelation = baseIndex.get(a) < baseIndex.get(b) ? -1 : 1;
        if (relation(ids, a, b) !== baseRelation) changed.add(pairKey(a, b));
      }
    }
    return changed;
  };
  const localChanged = changedPairs(localIds);
  const currentChanged = changedPairs(currentIds);
  const baseSet = new Set(baseIds);
  const adjacency = new Map(resultIds.map((id) => [id, new Set()]));
  const addEdge = (from, to) => {
    if (from !== to && adjacency.has(from) && adjacency.has(to)) adjacency.get(from).add(to);
  };
  for (let i = 0; i < resultIds.length; i += 1) {
    for (let j = i + 1; j < resultIds.length; j += 1) {
      const a = resultIds[i];
      const b = resultIds[j];
      const baseRelation = baseSet.has(a) && baseSet.has(b)
        ? (baseIndex.get(a) < baseIndex.get(b) ? -1 : 1) : 0;
      const localRelation = relation(localIds, a, b);
      const currentRelation = relation(currentIds, a, b);
      const key = pairKey(a, b);
      const localIntent = localRelation && (baseRelation === 0 || localChanged.has(key));
      const currentIntent = currentRelation && (baseRelation === 0 || currentChanged.has(key));
      const winner = currentIntent ? currentRelation : localIntent ? localRelation : baseRelation;
      if (winner < 0) addEdge(a, b);
      else if (winner > 0) addEdge(b, a);
    }
  }
  const rank = (id) => {
    const local = localIds.indexOf(id);
    if (local >= 0) return local;
    const current = currentIds.indexOf(id);
    if (current >= 0) return localIds.length + current;
    return localIds.length + currentIds.length + (baseIndex.get(id) ?? resultIds.length);
  };
  const remaining = new Set(resultIds);
  const indegree = new Map(resultIds.map((id) => [id, 0]));
  for (const [from, targets] of adjacency) for (const to of targets) indegree.set(to, indegree.get(to) + 1);
  const ordered = [];
  while (remaining.size) {
    let next = [...remaining].filter((id) => indegree.get(id) === 0).sort((a, b) => rank(a) - rank(b))[0];
    if (next == null) {
      // Conflicting same-node moves can form a cycle. Drop the lowest-priority
      // incoming constraints for the stable lane winner rather than dropping
      // an entire sibling collection.
      next = [...remaining].sort((a, b) => rank(a) - rank(b))[0];
      for (const [from, targets] of adjacency) {
        if (!remaining.has(from)) continue;
        if (targets.delete(next)) indegree.set(next, indegree.get(next) - 1);
      }
    }
    remaining.delete(next);
    ordered.push(next);
    for (const to of adjacency.get(next)) indegree.set(to, indegree.get(to) - 1);
  }
  return ordered;
}

function mergePromptTree(baseValue, localValue, currentValue, global = null, parentId = null) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const baseGlobal = global?.base ?? flattenPromptTree(base);
  const localGlobal = global?.local ?? flattenPromptTree(local);
  const currentGlobal = global?.current ?? flattenPromptTree(current);
  const baseParents = global?.baseParents ?? promptParentMap(base);
  const localParents = global?.localParents ?? promptParentMap(local);
  const currentParents = global?.currentParents ?? promptParentMap(current);
  const baseById = new Map(base.map((node) => [node?.id, node]));
  const localById = new Map(local.map((node) => [node?.id, node]));
  const currentById = new Map(current.map((node) => [node?.id, node]));
  const mergeNode = (baseNode, localNode, currentNode) => {
    if (!localNode) return null;
    if (baseNode && !currentNode && !currentGlobal.has(baseNode.id)) return null;
    if (!baseNode) {
      const historicalBase = baseGlobal.get(localNode.id);
      const historicalCurrent = currentGlobal.get(localNode.id);
      if (historicalBase && historicalCurrent) return mergeNode(historicalBase, localNode, historicalCurrent);
      if (historicalBase && !historicalCurrent) return null;
      return historicalCurrent ?? localNode;
    }
    if (sameJson(localNode, baseNode)
      && !(localNode.type === 'folder' && currentNode?.type === 'folder'
        && !sameJson(localNode.children, currentNode.children))) return currentNode ?? localNode;
    if (localNode.type === 'folder' && currentNode?.type === 'folder') {
      const scalarChanges = Object.fromEntries(Object.keys(localNode)
        .filter((key) => key !== 'children' && !sameJson(localNode[key], baseNode[key]))
        .map((key) => [key, localNode[key]]));
      return {
        ...currentNode,
        ...scalarChanges,
        children: mergePromptTree(baseNode.children, localNode.children, currentNode.children, {
          base: baseGlobal, local: localGlobal, current: currentGlobal,
          baseParents, localParents, currentParents,
        }, localNode.id),
      };
    }
    const fieldChanges = Object.fromEntries(Object.keys(localNode)
      .filter((key) => key !== 'id' && !sameJson(localNode[key], baseNode[key]))
      .map((key) => [key, localNode[key]]));
    return { ...(currentNode ?? {}), ...fieldChanges, id: localNode.id, type: localNode.type };
  };
  const result = [];
  for (const currentNode of current) {
    const id = currentNode?.id;
    if (!localById.has(id)) {
      // A node created only by the current writer must survive a concurrent
      // reorder/insert. Nodes that the local snapshot moved away or deleted
      // are handled from their destination/source collection instead.
      if (baseById.has(id)) continue;
      // A local identity deletion is global, not a parent-local absence. It
      // must beat a stale current move that would otherwise look like a new
      // destination-only node.
      if (baseGlobal.has(id) && !localGlobal.has(id)) continue;
      if (localGlobal.has(id)) {
        const localMoved = localParents.get(id) !== baseParents.get(id);
        const currentMoved = currentParents.get(id) !== baseParents.get(id);
        if (localMoved && currentMoved && localParents.get(id) !== currentParents.get(id)) continue;
        // The current writer may have relocated this identity into a sibling
        // collection while the local lane edited it in its old location. Use
        // the global stable-id copy here so the node (or whole subtree) is
        // installed exactly once at the current destination with local field
        // changes merged.
        const moved = mergeNode(baseGlobal.get(id), localGlobal.get(id), currentNode);
        if (moved) result.push(moved);
        continue;
      }
      result.push(currentNode);
      continue;
    }
    const merged = mergeNode(baseById.get(id), localById.get(id), currentNode);
    if (merged) result.push(merged);
  }
  for (const localNode of local) {
    const id = localNode?.id;
    if (id == null || currentById.has(id) || baseById.has(id)) continue;
    const mergedLocal = mergeNode(baseGlobal.get(id), localNode, currentGlobal.get(id));
    if (mergedLocal) result.push(mergedLocal);
  }
  // Merge stable ordering constraints from both lanes. This preserves local
  // positioned inserts/reorders alongside compatible current moves/inserts,
  // while resolving a conflicting same-pair move deterministically.
  const resultById = new Map(result.map((node) => [node?.id, node]));
  const resultIds = result.map((node) => node?.id);
  const localIds = local.map((node) => node?.id);
  const baseIds = base.map((node) => node?.id);
  const currentIds = current.map((node) => node?.id);
  return mergePromptOrder(baseIds, localIds, currentIds, resultIds).map((id) => resultById.get(id));
}

function mergeKeyedArray(baseValue, localValue, currentValue) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const baseById = new Map(base.map((item) => [item?.id, item]));
  const localById = new Map(local.map((item) => [item?.id, item]));
  const currentById = new Map(current.map((item) => [item?.id, item]));
  const result = [];
  for (const currentItem of current) {
    const id = currentItem?.id;
    if (baseById.has(id) && !localById.has(id)) continue;
    const localItem = localById.get(id);
    if (!localItem || !baseById.has(id) || sameJson(localItem, baseById.get(id))) {
      result.push(currentItem);
      continue;
    }
    const mergedItem = {
      ...currentItem,
      ...Object.fromEntries(Object.keys(localItem)
        .filter((key) => key !== 'id' && key !== 'placements' && key !== 'arrangement'
          && !sameJson(localItem[key], baseById.get(id)?.[key]))
        .map((key) => [key, localItem[key]])),
      ...(Array.isArray(localItem.placements) ? {
        placements: mergeKeyedArray(baseById.get(id)?.placements, localItem.placements, currentItem.placements),
      } : {}),
      ...(localItem.arrangement?.members && currentItem.arrangement?.members ? {
        arrangement: {
          ...currentItem.arrangement,
          members: mergeKeyedArray(
            baseById.get(id)?.arrangement?.members,
            localItem.arrangement.members,
            currentItem.arrangement.members,
          ),
        },
      } : {}),
    };
    for (const key of Object.keys(baseById.get(id) ?? {})) {
      if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
        && Object.prototype.hasOwnProperty.call(currentItem, key)) delete mergedItem[key];
    }
    result.push(mergedItem);
  }
  for (const localItem of local) {
    const id = localItem?.id;
    if (id == null || currentById.has(id) || baseById.has(id)) continue;
    result.push(localItem);
  }
  return result;
}

function mergeSetArray(baseValue, localValue, currentValue) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const removed = new Set(base.filter((id) => !local.includes(id)));
  const result = current.filter((id) => !removed.has(id));
  for (const id of local) if (!base.includes(id) && !result.includes(id)) result.push(id);
  return result;
}

function mergeItemSet(baseItem, localItem, currentItem) {
  if (!currentItem) return null;
  if (!baseItem || sameJson(localItem, baseItem)) return currentItem;
  const result = { ...currentItem };
  for (const key of ['itemIds', 'memberIds', 'excludedIds']) {
    if (Array.isArray(localItem[key])) {
      result[key] = mergeSetArray(baseItem[key], localItem[key], currentItem[key]);
    } else if (!sameJson(localItem[key], baseItem[key])) {
      result[key] = localItem[key];
    }
  }
  for (const key of Object.keys(localItem)) {
    if (key === 'id' || key === 'itemIds' || key === 'memberIds' || key === 'excludedIds') continue;
    if (!sameJson(localItem[key], baseItem[key])) result[key] = localItem[key];
  }
  for (const key of Object.keys(baseItem)) {
    if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
      && Object.prototype.hasOwnProperty.call(currentItem, key)) delete result[key];
  }
  return result;
}

const LOCAL_VIEW_KEYS = Object.freeze([
  'currentGroupId',
  'graphExpandedGroupIds',
  'trailExpandedByContext',
  'selectedItemIds',
  'binMode',
]);

/** Remove this surface's navigation/session fallback from a forwarded board
 * snapshot. Those fields are useful when reopening a single surface, but are
 * not shared document actions and must never make another window jump folders
 * or inherit its selection. */
export function stripLocalViewFields(serialized, baseSerialized) {
  if (typeof baseSerialized !== 'string') return serialized;
  try {
    const local = JSON.parse(serialized);
    const base = JSON.parse(baseSerialized);
    if (!isPlainObject(local?.view) || !isPlainObject(base?.view)) return serialized;
    const view = { ...local.view };
    for (const key of LOCAL_VIEW_KEYS) {
      if (Object.prototype.hasOwnProperty.call(base.view, key)) view[key] = base.view[key];
      else delete view[key];
    }
    return JSON.stringify({ ...local, view });
  } catch {
    return serialized;
  }
}

/** Merge a view's action snapshot onto the writer's current snapshot. Entity
 * collections are merged by stable id so two windows cannot erase unrelated
 * edits. View/position maps intentionally use last-writer-wins: a later drag
 * is the authoritative placement. */
export function mergeSurfaceSnapshots(base, local, current) {
  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(current)) return local;
  const merged = { ...current };
  for (const key of ['groups', 'shortcuts', 'windowLayouts']) {
    if (!Array.isArray(local[key]) || !Array.isArray(current[key])) continue;
    const baseItems = new Map((Array.isArray(base[key]) ? base[key] : []).map((item) => [item?.id, item]));
    const localItems = new Map(local[key].map((item) => [item?.id, item]));
    const currentItems = new Map(current[key].map((item) => [item?.id, item]));
    const result = [...current[key]];
    const index = new Map(result.map((item, i) => [item?.id, i]));
    for (const [id, localItem] of localItems) {
      if (id == null) continue;
      const baseItem = baseItems.get(id);
      const currentItem = currentItems.get(id);
      if (!baseItems.has(id) || !sameJson(localItem, baseItem)) {
        if (!currentItems.has(id)) {
          // A deletion in the current authoritative lane wins over a stale
          // edit; do not resurrect the pre-delete identity.
          if (baseItems.has(id)) continue;
          index.set(id, result.length);
          result.push(localItem);
        } else if (!sameJson(currentItem, localItem)) {
          const mergedItem = {
            ...currentItem,
            ...Object.fromEntries(Object.keys(localItem)
              .filter((key) => key !== 'id' && key !== 'placements' && key !== 'arrangement'
                && !sameJson(localItem[key], baseItem?.[key]))
              .map((key) => [key, localItem[key]])),
          };
          for (const key of Object.keys(baseItem ?? {})) {
            if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
              && Object.prototype.hasOwnProperty.call(currentItem, key)) delete mergedItem[key];
          }
          if (Array.isArray(localItem.placements)) {
            mergedItem.placements = mergeKeyedArray(baseItem?.placements, localItem.placements, currentItem.placements);
          }
          if (localItem.arrangement?.members && currentItem.arrangement?.members) {
            mergedItem.arrangement = {
              ...currentItem.arrangement,
              members: mergeKeyedArray(
                baseItem?.arrangement?.members,
                localItem.arrangement.members,
                currentItem.arrangement.members,
              ),
            };
          }
          result[index.get(id)] = mergedItem;
        }
      }
    }
    const deleted = new Set([...baseItems.keys()].filter((id) => !localItems.has(id) && currentItems.has(id)));
    merged[key] = result.filter((item) => !deleted.has(item?.id));
  }
  const baseView = isPlainObject(base.view) ? base.view : {};
  const localView = isPlainObject(local.view) ? local.view : {};
  const currentView = isPlainObject(current.view) ? current.view : {};
  const view = { ...currentView };
  for (const [key, value] of Object.entries(localView)) {
    if (key === 'graphPositions' || key === 'graphRestPositions' || key === 'toolbarPositions') {
      if (!sameJson(value, baseView[key])) {
        view[key] = mergePositionMap(
          baseView[key],
          value,
          currentView[key],
          key !== 'toolbarPositions',
        );
      }
    } else if (key === 'surfaceLocations' && isPlainObject(value)) {
      // Each Papers tab updates only its own opaque key. Merge by key so a
      // concurrent navigation in another tab cannot erase it.
      const nextLocations = { ...(isPlainObject(currentView[key]) ? currentView[key] : {}) };
      const baseLocations = isPlainObject(baseView[key]) ? baseView[key] : {};
      for (const [surfaceKey, location] of Object.entries(value)) {
        if (!sameJson(location, baseLocations[surfaceKey])) nextLocations[surfaceKey] = location;
      }
      view[key] = nextLocations;
    } else if (key === 'itemSets' && Array.isArray(value) && Array.isArray(currentView[key])) {
      // Sets are document semantics stored under view; merge independent set
      // IDs instead of replacing the whole collection on a stale snapshot.
      const baseSets = Array.isArray(baseView[key]) ? baseView[key] : [];
      const baseById = new Map(baseSets.map((item) => [item?.id, item]));
      const localById = new Map(value.map((item) => [item?.id, item]));
      const currentById = new Map(currentView[key].map((item) => [item?.id, item]));
      const mergedSets = [...currentView[key]];
      const indexes = new Map(mergedSets.map((item, index) => [item?.id, index]));
      for (const [id, item] of localById) {
        if (id == null) continue;
        if (!baseById.has(id)) {
          if (!currentById.has(id)) { indexes.set(id, mergedSets.length); mergedSets.push(item); }
        } else if (!sameJson(item, baseById.get(id))) {
          if (currentById.has(id)) mergedSets[indexes.get(id)] = mergeItemSet(baseById.get(id), item, currentById.get(id));
          else { /* current deletion wins over a stale set edit */ }
        }
      }
      const deletedSetIds = new Set([...baseById.keys()].filter((id) => !localById.has(id)));
      view[key] = mergedSets.filter((item) => !deletedSetIds.has(item?.id));
    } else if (key === 'promptLibrary' && Array.isArray(value)) {
      view[key] = mergePromptTree(baseView[key], value, currentView[key]);
    } else if (!sameJson(value, baseView[key])) {
      view[key] = value;
    }
  }
  merged.view = view;
  if (!sameJson(local.activeWindowLayoutId, base.activeWindowLayoutId)) {
    merged.activeWindowLayoutId = local.activeWindowLayoutId;
  }
  return merged;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

