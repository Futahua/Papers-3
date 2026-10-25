/** A page's overlay rectangle (native previews, editors, browser tabs) is in its CSS pixels; native views
 * are placed in window pixels. A zoomed page (Ctrl+wheel, or a zoom level Papers remembers) would
 * otherwise get its preview drawn smaller and nearer the top-left than its pane. */
export function zoomedRect(request: unknown, zoom: number): unknown {
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 0.001) return request;
  if (!request || typeof request !== 'object') return request;
  const params = (request as { params?: unknown }).params;
  const rect = params && typeof params === 'object' ? (params as { rect?: unknown }).rect : null;
  if (!rect || typeof rect !== 'object') return request;
  const scaled: Record<string, unknown> = { ...(rect as Record<string, unknown>) };
  for (const key of ['x', 'y', 'width', 'height']) if (typeof scaled[key] === 'number') scaled[key] = (scaled[key] as number) * zoom;
  return { ...(request as object), params: { ...(params as object), rect: scaled } };
}
