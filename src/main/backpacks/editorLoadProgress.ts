/** Provider-reported stage progress, never an estimated overall percentage. */
export interface EditorLoadProgress {
  phase: string;
  text: string;
  value: number | null;
  maximum: number | null;
}
export function editorLoadProgress(value: Record<string, unknown>): EditorLoadProgress {
  const maximum = typeof value.maximum === 'number' && Number.isFinite(value.maximum) && value.maximum > 0 ? value.maximum : null;
  const reported = typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
  return {
    phase: typeof value.phase === 'string' ? value.phase.slice(0, 80) : 'loading',
    text: typeof value.text === 'string' ? value.text.slice(0, 512) : 'Opening document…',
    maximum,
    value: maximum !== null && reported !== null ? Math.max(0, Math.min(maximum, reported)) : null,
  };
}
