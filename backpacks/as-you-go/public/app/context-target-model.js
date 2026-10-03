/** Pure priority resolution for graph context-menu targets. */
export function resolveContextTarget({ itemId = null, hitSetIds = [], selectedSetIds = new Set() } = {}) {
  if (itemId) return { kind: 'item', id: itemId };
  const setId = hitSetIds.find((candidate) => selectedSetIds.has(candidate));
  if (setId) return { kind: 'set', id: setId };
  return { kind: 'blank', id: null };
}
