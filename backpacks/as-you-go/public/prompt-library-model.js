/** Pure tree operations for the prompt library. This module must not touch
 * the clipboard, DOM, store, or status messages.
 *
 * The library is an ordered recursive array of nodes:
 *   prompt:  { id, type: 'prompt',  title, text, includeInBatch }
 *   folder:  { id, type: 'folder',  title, children: [...] }
 * Folders may contain prompts and other folders without a fixed depth limit.
 */

const makeId = (kind) => `${kind}-${crypto.randomUUID()}`;
const MIN_PROMPT_EDITOR_HEIGHT = 150;
const MAX_PROMPT_EDITOR_HEIGHT = 1200;

function createId(kind = 'prompt') {
  return makeId(kind);
}

function promptEditorHeightFields(raw) {
  const value = raw?.editorHeight;
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  return {
    editorHeight: Math.min(
      MAX_PROMPT_EDITOR_HEIGHT,
      Math.max(MIN_PROMPT_EDITOR_HEIGHT, Math.round(value)),
    ),
  };
}

/** Creates a prompt node. New prompts default to unchecked and empty so an
 * unfinished prompt never enters a normal batch copy. */
export function createPromptNode(overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId('prompt'),
    type: 'prompt',
    title: typeof overrides.title === 'string' ? overrides.title : 'New prompt',
    text: typeof overrides.text === 'string' ? overrides.text : '',
    includeInBatch: overrides.includeInBatch === true,
    ...promptEditorHeightFields(overrides),
  };
}

/** Creates a folder node. New folders are empty and do not override their
 * descendants' batch inclusion (neutral: includeAll and excludeAll both
 * false). */
export function createPromptFolder(overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId('folder'),
    type: 'folder',
    title: typeof overrides.title === 'string' ? overrides.title : 'New folder',
    ...folderOverrideFields(overrides),
    children: [],
  };
}

/** A folder's batch override is one of three states, stored as two booleans so
 * older saved libraries (which only ever had includeAll) migrate untouched:
 *
 *   neutral  — both false: each descendant's own checkbox decides
 *   include  — includeAll: everything inside is copied
 *   exclude  — excludeAll: nothing inside is copied
 *
 * The two can never both be true; include wins if malformed data says so. */
function folderOverrideFields(raw) {
  const includeAll = raw?.includeAll === true;
  return { includeAll, excludeAll: !includeAll && raw?.excludeAll === true };
}

/** The three-state override as a single value, for UI and cycling. */
export function folderBatchState(node) {
  if (node?.includeAll === true) return 'include';
  if (node?.excludeAll === true) return 'exclude';
  return 'neutral';
}

/** Maps a three-state value back onto the stored booleans. */
export function folderBatchFields(state) {
  return { includeAll: state === 'include', excludeAll: state === 'exclude' };
}

/** Click order for the folder checkbox: neutral → include → exclude → neutral. */
export function nextFolderBatchState(state) {
  if (state === 'neutral') return 'include';
  if (state === 'include') return 'exclude';
  return 'neutral';
}

function normalizeNode(raw, seen) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'folder') {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const children = Array.isArray(raw.children)
      ? raw.children.map((child) => normalizeNode(child, seen)).filter(Boolean)
      : [];
    return {
      id,
      type: 'folder',
      title: typeof raw.title === 'string' ? raw.title : 'New folder',
      // Folders from the PR-5 shape may lack includeAll/excludeAll; they
      // normalize to neutral, preserving child configuration.
      ...folderOverrideFields(raw),
      children,
    };
  }
  if (raw.type === 'prompt') {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      type: 'prompt',
      title: typeof raw.title === 'string' ? raw.title : 'New prompt',
      text: typeof raw.text === 'string' ? raw.text : '',
      includeInBatch: raw.includeInBatch === true,
      ...promptEditorHeightFields(raw),
    };
  }
  return null;
}

/**
 * Normalizes the prompt library tree. Malformed records and duplicate ids are
 * dropped, order is preserved, and only recognized node types are kept.
 *
 * When no library is present it migrates older shapes: a flat `promptCards`
 * array becomes root prompt nodes, and a legacy `pickupPrompt` string becomes
 * a single root prompt. Empty input normalizes to an empty library (the dialog
 * supplies a virtual fallback prompt).
 */
export function normalizePromptLibrary(raw, legacyPromptCards, legacyPrompt) {
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const rawNode of raw) {
      const node = normalizeNode(rawNode, seen);
      if (node) normalized.push(node);
    }
    return normalized;
  }
  if (Array.isArray(legacyPromptCards) && legacyPromptCards.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const card of legacyPromptCards) {
      const id = typeof card?.id === 'string' && card.id ? card.id : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({
        id,
        type: 'prompt',
        title: typeof card.title === 'string' ? card.title : 'New prompt',
        text: typeof card.text === 'string' ? card.text : '',
        includeInBatch: card.includeInBatch === true,
      });
    }
    return normalized;
  }
  if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
    return [createPromptNode({
      title: 'Agent pickup prompt',
      text: legacyPrompt,
      includeInBatch: true,
    })];
  }
  return [];
}

/** The effective library to show and copy from: the persisted tree when it has
 * nodes, otherwise one virtual root prompt built from `fallbackPrompt`. The
 * virtual prompt is not persisted until the user saves. */
export function effectivePromptLibrary(view, fallbackPrompt) {
  if (Array.isArray(view?.promptLibrary) && view.promptLibrary.length > 0) {
    return view.promptLibrary;
  }
  return [createPromptNode({
    title: 'Agent pickup prompt',
    text: typeof fallbackPrompt === 'string' ? fallbackPrompt : '',
    includeInBatch: true,
  })];
}

/** Finds a node by id anywhere in the tree, or returns null. */
export function findPromptNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === 'folder') {
      const found = findPromptNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Returns a new tree with the node identified by `id` replaced by the result
 * of `updater(node)`. Non-mutating; returns the original when not found. */
export function updatePromptNode(nodes, id, updater) {
  let updated = false;
  const walk = (list) => list.map((node) => {
    if (node.id === id) {
      updated = true;
      return updater(node);
    }
    if (node.type === 'folder') {
      const children = walk(node.children);
      return children === node.children ? node : { ...node, children };
    }
    return node;
  });
  const result = walk(nodes);
  return updated ? result : nodes;
}

/** Returns a new tree without the node `id` and its entire subtree. */
export function removePromptNode(nodes, id) {
  let removed = false;
  const walk = (list) => {
    const next = [];
    for (const node of list) {
      if (node.id === id) {
        removed = true;
        continue;
      }
      if (node.type === 'folder') {
        const children = walk(node.children);
        next.push(children === node.children ? node : { ...node, children });
      } else {
        next.push(node);
      }
    }
    return next;
  };
  const result = walk(nodes);
  return removed ? result : nodes;
}

function isDescendantOf(candidateId, ancestorId, nodes) {
  const ancestor = findPromptNode(nodes, ancestorId);
  if (!ancestor || ancestor.type !== 'folder') return false;
  return findPromptNode(ancestor.children, candidateId) != null;
}

function removeNode(nodes, id) {
  let removed = null;
  const walk = (list) => {
    const next = [];
    for (const node of list) {
      if (node.id === id) {
        removed = node;
        continue;
      }
      if (node.type === 'folder') {
        const children = walk(node.children);
        next.push(children === node.children ? node : { ...node, children });
      } else {
        next.push(node);
      }
    }
    return next;
  };
  const result = walk(nodes);
  return { nodes: removed ? result : nodes, removed };
}

function insertNode(nodes, parentId, node, beforeId) {
  if (parentId == null) {
    const next = [...nodes];
    const index = beforeId == null
      ? next.length
      : next.findIndex((candidate) => candidate.id === beforeId);
    if (index === -1) return nodes;
    next.splice(index, 0, node);
    return next;
  }
  return nodes.map((candidate) => {
    if (candidate.id === parentId) {
      const children = [...candidate.children];
      const index = beforeId == null
        ? children.length
        : children.findIndex((child) => child.id === beforeId);
      if (index === -1) return candidate;
      children.splice(index, 0, node);
      return { ...candidate, children };
    }
    if (candidate.type === 'folder') {
      const inner = insertNode(candidate.children, parentId, node, beforeId);
      if (inner !== candidate.children) return { ...candidate, children: inner };
    }
    return candidate;
  });
}

function insertNodes(nodes, parentId, nodesToInsert, beforeId) {
  if (parentId == null) {
    const next = [...nodes];
    const index = beforeId == null
      ? next.length
      : next.findIndex((candidate) => candidate.id === beforeId);
    if (index === -1) return nodes;
    next.splice(index, 0, ...nodesToInsert);
    return next;
  }
  let changed = false;
  const walk = (list) => {
    const next = [];
    let levelChanged = false;
    for (const candidate of list) {
      if (candidate.id === parentId) {
        const children = [...candidate.children];
        const index = beforeId == null
          ? children.length
          : children.findIndex((child) => child.id === beforeId);
        if (index === -1) {
          next.push(candidate);
          continue;
        }
        children.splice(index, 0, ...nodesToInsert);
        next.push({ ...candidate, children });
        levelChanged = true;
        changed = true;
      } else if (candidate.type === 'folder') {
        const inner = walk(candidate.children);
        if (inner !== candidate.children) {
          next.push({ ...candidate, children: inner });
          levelChanged = true;
          changed = true;
        } else {
          next.push(candidate);
        }
      } else {
        next.push(candidate);
      }
    }
    return levelChanged ? next : list;
  };
  const result = walk(nodes);
  return changed ? result : nodes;
}

/**
 * Deep-clones prompt/folder nodes for an internal paste, regenerating every id
 * recursively so pasted copies never collide with their source. Titles, text,
 * includeInBatch, includeAll, children, and order are preserved.
 */
export function clonePromptNodesForPaste(nodes) {
  const clone = (node) => (node.type === 'folder'
    ? {
        id: createId('folder'),
        type: 'folder',
        title: node.title,
        ...folderOverrideFields(node),
        children: node.children.map(clone),
      }
    : {
        id: createId('prompt'),
        type: 'prompt',
        title: node.title,
        text: node.text,
        includeInBatch: node.includeInBatch === true,
        ...promptEditorHeightFields(node),
      });
  return (Array.isArray(nodes) ? nodes : []).map(clone);
}

/** Inserts already-cloned nodes into the tree at a destination (folder, or
 * root when null) before `beforeId` (or appended when null). Returns the
 * original tree when the destination/beforeId is invalid. Non-mutating. */
export function insertPromptNodes(nodes, destinationParentId = null, beforeId = null, nodesToInsert) {
  const list = Array.isArray(nodesToInsert) ? nodesToInsert : [];
  if (list.length === 0) return nodes;
  return insertNodes(nodes, destinationParentId, list, beforeId);
}

/**
 * Moves several nodes (and their subtrees) to a new position atomically.
 * `nodeIds` are reduced to selected roots first (descendants under a selected
 * ancestor are removed), then validated, removed, and inserted together in
 * their current depth-first order, preserving relative order. Rejects unknown
 * ids, non-folder destinations, folder-into-descendant cycles, a destination
 * inside the moved group, and beforeId siblings that do not belong to the
 * destination. Non-mutating; returns the original tree on any failure.
 */
export function movePromptNodes(nodes, { nodeIds, destinationParentId = null, beforeId = null }) {
  const ids = Array.isArray(nodeIds) ? nodeIds : [];
  if (ids.length === 0) return nodes;
  for (const id of ids) {
    if (!findPromptNode(nodes, id)) return nodes;
  }
  if (destinationParentId != null) {
    const destination = findPromptNode(nodes, destinationParentId);
    if (!destination || destination.type !== 'folder') return nodes;
    if (ids.includes(destinationParentId)) return nodes;
    for (const id of ids) {
      const node = findPromptNode(nodes, id);
      if (node.type === 'folder' && isDescendantOf(destinationParentId, id, nodes)) return nodes;
    }
  }
  const roots = selectedRootIds(nodes, ids);
  if (roots.length === 0) return nodes;
  let without = nodes;
  const removedNodes = [];
  for (const id of roots) {
    const result = removeNode(without, id);
    without = result.nodes;
    if (result.removed) removedNodes.push(result.removed);
  }
  if (removedNodes.length === 0) return nodes;
  const siblings = destinationParentId == null
    ? without
    : (findPromptNode(without, destinationParentId)?.children ?? null);
  if (siblings == null) return nodes;
  if (beforeId != null && !siblings.some((candidate) => candidate.id === beforeId)) return nodes;
  return insertNodes(without, destinationParentId, removedNodes, beforeId);
}

/**
 * Moves a node (and its subtree) to a new position. `destinationParentId` is
 * the folder to drop into (null means root); `beforeId` is the sibling to
 * insert before (null appends). Rejects unknown ids, non-folder destinations,
 * folder-into-descendant cycles, and unknown `beforeId` siblings. Non-mutating.
 */
export function movePromptNode(nodes, { nodeId, destinationParentId = null, beforeId = null }) {
  if (nodeId == null) return nodes;
  const moved = findPromptNode(nodes, nodeId);
  if (!moved) return nodes;
  if (destinationParentId != null) {
    const destination = findPromptNode(nodes, destinationParentId);
    if (!destination || destination.type !== 'folder') return nodes;
    if (destinationParentId === nodeId) return nodes;
    if (isDescendantOf(destinationParentId, nodeId, nodes)) return nodes;
  }
  const { nodes: without, removed } = removeNode(nodes, nodeId);
  if (!removed) return nodes;
  if (beforeId != null) {
    const siblings = destinationParentId == null
      ? without
      : (findPromptNode(without, destinationParentId)?.children ?? []);
    if (!siblings.some((candidate) => candidate.id === beforeId)) return nodes;
  }
  return insertNode(without, destinationParentId, removed, beforeId);
}

/** Ids of every prompt under `folderId`, in depth-first order. */
export function descendantPromptIds(nodes, folderId) {
  const folder = findPromptNode(nodes, folderId);
  if (!folder || folder.type !== 'folder') return [];
  const ids = [];
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'prompt') ids.push(node.id);
      else walk(node.children);
    }
  };
  walk(folder.children);
  return ids;
}

/** Total number of prompt nodes anywhere in the tree. */
export function countPromptNodes(nodes) {
  let count = 0;
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'prompt') count += 1;
      else walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

/**
 * Collects the prompts that belong in a normal batch copy, in depth-first
 * visual order. Each folder carries one of three overrides down the walk:
 *
 *   include — every descendant prompt is copied whatever its own checkbox says
 *   exclude — no descendant prompt is copied, even a checked one
 *   neutral — inherit whatever the nearest overriding ancestor decided
 *
 * The nearest override wins, so an excluded folder inside an included one
 * copies nothing, and an included folder inside an excluded one copies
 * everything. No descendant checkbox is ever rewritten, so clearing an
 * override restores exactly what was configured before.
 */
export function collectIncludedPrompts(nodes, forcedByAncestor = false) {
  const included = [];
  const walk = (list, forced) => {
    for (const node of list) {
      if (node.type === 'prompt') {
        if (forced === 'exclude') continue;
        if (forced === 'include' || node.includeInBatch === true) included.push(node);
      } else {
        const own = folderBatchState(node);
        walk(node.children, own === 'neutral' ? forced : own);
      }
    }
  };
  walk(nodes, forcedByAncestor === true ? 'include' : forcedByAncestor || 'neutral');
  return included;
}

/** Batch text from included prompts in depth-first order, joined with two
 * blank lines. Folder titles are never included. Returns '' when no included
 * prompt has text. */
export function buildBatchPromptText(nodes) {
  return collectIncludedPrompts(nodes)
    .filter((node) => typeof node.text === 'string' && node.text.trim() !== '')
    .map((node) => node.text)
    .join('\n\n');
}

/** Reduces a set of ids to those with no selected ancestor (the roots of the
 * selected region). Sorted by current depth-first visual order. */
export function selectedRootIds(nodes, ids) {
  const selected = new Set(ids);
  const roots = [];
  const walk = (list) => {
    for (const node of list) {
      if (!selected.has(node.id)) {
        if (node.type === 'folder') walk(node.children);
        continue;
      }
      roots.push(node.id);
    }
  };
  walk(nodes);
  return roots;
}

/**
 * Collects the prompt texts for an explicit Copy Selected, independent of the
 * batch checkboxes. Selected folders contribute every descendant prompt;
 * selected descendants under a selected folder are not duplicated (root
 * reduction); result follows current depth-first visual order.
 */
export function collectPromptsFromSelectedRoots(nodes, ids) {
  const roots = selectedRootIds(nodes, ids);
  const rootSet = new Set(roots);
  const texts = [];
  const walk = (list) => {
    for (const node of list) {
      if (rootSet.has(node.id)) {
        if (node.type === 'prompt') {
          if (typeof node.text === 'string' && node.text.trim() !== '') texts.push(node.text);
        } else {
          for (const promptNode of collectIncludedPrompts(node.children, true)) {
            if (typeof promptNode.text === 'string' && promptNode.text.trim() !== '') {
              texts.push(promptNode.text);
            }
          }
        }
        continue;
      }
      if (node.type === 'folder') walk(node.children);
    }
  };
  walk(nodes);
  return texts.join('\n\n');
}

/** Returns an error string when the library cannot be saved, else null. */
export function validatePromptLibrary(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const ids = new Set();
  let error = null;
  let promptCount = 0;
  const walk = (level) => {
    if (error) return;
    for (const node of level) {
      if (error) return;
      if (node.type !== 'prompt' && node.type !== 'folder') {
        error = 'Unknown node type.';
        return;
      }
      if (!node.id || ids.has(node.id)) {
        error = 'Node ids must be unique.';
        return;
      }
      ids.add(node.id);
      if (node.type === 'folder') {
        if (!Array.isArray(node.children)) {
          error = 'Only folders can contain children.';
          return;
        }
        if (typeof node.title !== 'string' || node.title.trim() === '') {
          error = 'Every folder needs a title.';
          return;
        }
        walk(node.children);
      } else {
        promptCount += 1;
        if (typeof node.title !== 'string' || node.title.trim() === '') {
          error = 'Every prompt needs a title.';
          return;
        }
        if (typeof node.text !== 'string' || node.text.trim() === '') {
          error = 'Every prompt needs text.';
          return;
        }
      }
    }
  };
  walk(list);
  if (error) return error;
  if (promptCount === 0) return 'Add at least one prompt.';
  return null;
}

/** Decides what the copier should do, preserving the existing precedence:
 * selected shortcut targets win; otherwise the checked prompt batch is copied;
 * when nothing is checked the copier opens the library instead of copying. */
export function resolveCopierAction(selectedTargets, promptNodes) {
  const targets = Array.isArray(selectedTargets) ? selectedTargets : [];
  // A selection copies the selected shortcuts' targets; an empty selection
  // falls back to the checked prompt batch. `copied` and `count` name which
  // happened, so callers do not have to re-derive it from the text — the two
  // use different separators and would be counted wrongly.
  if (targets.length > 0) {
    return { kind: 'copy', text: targets.join('\n'), copied: 'paths', count: targets.length };
  }
  const text = buildBatchPromptText(promptNodes);
  if (!text) return { kind: 'open' };
  return {
    kind: 'copy',
    text,
    copied: 'prompts',
    count: collectIncludedPrompts(promptNodes).filter(
      (node) => typeof node.text === 'string' && node.text.trim() !== '',
    ).length,
  };
}

/** Gives the copy toast enough context to identify what reached the clipboard.
 * Names are deliberately supplied by the caller: this model only knows the
 * prompt batch or target strings, not the workspace records that named them. */
export function formatCopyConfirmation(outcome, names = []) {
  if (!outcome || outcome.kind !== 'copy') return '';
  const noun = outcome.copied === 'paths' ? 'path' : 'prompt';
  const countLabel = `${outcome.count} ${outcome.count === 1 ? noun : `${noun}s`}`;
  const labels = (Array.isArray(names) ? names : [])
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim());
  const shown = labels.slice(0, 4);
  if (labels.length > 4) shown.push(`+${labels.length - 4} more`);
  return `Copied ${countLabel}${shown.length > 0 ? `: ${shown.join(', ')}` : ''}.`;
}
