export interface VisualSemanticObservationRefreshDeps {
  isLiveIn(surfaceId: string, windowId: number): boolean;
  runtimeForSurface(windowId: number, surfaceId: string): {
    senderId: number | null;
    refreshVisualSemanticKeys(): void;
  } | null;
  contextForSender(senderId: number): {
    windowId: number;
    surfaceId: string;
  } | null;
  bindSender(windowId: number, surfaceId: string, senderId: number): void;
}

/** Re-establish the current semantic-observation generation before asking a
 * restored canonical renderer to resend its fixed snapshot. Every identity
 * check is required: this helper must never manufacture authority for a
 * prepared, foreign, or stale renderer. */
export function refreshCurrentVisualSemanticKeys(
  deps: VisualSemanticObservationRefreshDeps,
  windowId: number,
  surfaceId: string,
): boolean {
  if (!deps.isLiveIn(surfaceId, windowId)) return false;
  const runtime = deps.runtimeForSurface(windowId, surfaceId);
  if (!runtime || runtime.senderId === null) return false;
  const context = deps.contextForSender(runtime.senderId);
  if (!context || context.windowId !== windowId || context.surfaceId !== surfaceId) return false;
  try {
    deps.bindSender(windowId, surfaceId, runtime.senderId);
    runtime.refreshVisualSemanticKeys();
    return true;
  } catch {
    return false;
  }
}
