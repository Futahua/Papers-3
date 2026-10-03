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
  if (Array.from(source).length <= MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS) return source;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
  let codePoints = 0;
  let prefix = '';
  const segments = segmenter
    ? [...segmenter.segment(source)].map((part) => part.segment)
    : Array.from(source);
  for (const segment of segments) {
    const segmentCodePoints = Array.from(segment).length;
    if (codePoints + segmentCodePoints > MAX_WORKSPACE_SURFACE_TITLE_CODE_POINTS - 1) break;
    prefix += segment;
    codePoints += segmentCodePoints;
  }
  return `${prefix}…`;
}
