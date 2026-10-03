/** Scope helpers for an embedded As you Go surface.
 *
 * The document remains the complete canonical AYG document. These predicates
 * only decide which real records a bound surface may display or mutate; they
 * never create a second document or rewrite ids. */
export function scopeRootFromUrl(locationRef = window.location) {
  const value = new URLSearchParams(locationRef.search).get('as-you-go-scope-root');
  return value && value.length <= 128 ? value : null;
}

export function groupInScope(state, candidateId, scopeRootId) {
  if (!scopeRootId) return true;
  if (candidateId === scopeRootId) return true;
  const seen = new Set();
  let current = state.groups?.find((candidate) => candidate.id === candidateId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === scopeRootId) return true;
    current = state.groups?.find((candidate) => candidate.id === current.parentId) ?? null;
  }
  return false;
}

export function itemInScope(state, candidateId, scopeRootId) {
  if (!scopeRootId) return true;
  const group = state.groups?.find((candidate) => candidate.id === candidateId);
  if (group) return groupInScope(state, group.id, scopeRootId);
  const layout = state.windowLayouts?.find((candidate) => candidate.id === candidateId);
  if (layout) return groupInScope(state, layout.parentId, scopeRootId);
  const shortcut = state.shortcuts?.find((candidate) => candidate.id === candidateId);
  const placements = shortcut?.placements?.filter((placement) => !placement.bin) ?? [];
  return placements.length > 0 && placements.every((placement) =>
    groupInScope(state, placement.parentId, scopeRootId));
}

export function destinationInScope(state, destinationId, scopeRootId) {
  return Boolean(destinationId) && groupInScope(state, destinationId, scopeRootId);
}

export function scopeContainsAny(state, ids, scopeRootId) {
  return ids.every((id) => itemInScope(state, id, scopeRootId));
}
