/** Boundaries for titles supplied by an embedded project document. */
export const MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS = 512;

/**
 * Keep the complete semantic title (within a generous generic safety bound)
 * while the tab itself applies visual ellipsis with CSS. Array.from is
 * intentional so Unicode surrogate pairs and emoji are never split.
 */
export function normalizeWorkspaceSurfaceTitle(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const source = candidate || fallback.trim() || 'Papers';
  const points = Array.from(source);
  if (points.length <= MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS) return source;
  return `${points.slice(0, MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS - 1).join('')}…`;
}
