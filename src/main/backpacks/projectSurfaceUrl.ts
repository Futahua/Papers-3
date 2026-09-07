/**
 * Adds Papers-owned, opaque surface context without interpreting project
 * navigation. Projects may use it to restore local per-tab state after the
 * runtime surface id is regenerated during startup hydration.
 */
export function withProjectSurfaceKey(url: string, surfaceKey: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('papers-surface-key', surfaceKey);
  return parsed.toString();
}
