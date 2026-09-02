import type { IpcMain } from 'electron';

import { recordRendererVisualSignal, type VisualDiagnosticTarget } from '../visual/visualLifecycleMonitor';
import type { VisualDiagnosticBuffer } from '../visual/visualDiagnostics';

export interface VisualDiagnosticsIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>;
  resolveTarget(sender: { id: number }): VisualDiagnosticTarget | null;
  bufferForWindow(windowId: number): VisualDiagnosticBuffer | null;
}

export interface VisualDiagnosticSender {
  id: number;
}

export interface VisualDiagnosticsAuthorityDependencies {
  hostWindowForSender(senderId: number): number | null;
  isCurrentHostSender(sender: VisualDiagnosticSender, windowId: number): boolean;
  projectContextForSender(senderId: number): { windowId: number; surfaceId: string } | null;
  isLiveSurface(surfaceId: string, windowId: number): boolean;
  isCurrentProjectSender(sender: VisualDiagnosticSender, windowId: number, surfaceId: string): boolean;
}

/** Resolve renderer input to the current native presentation. A live logical
 * binding alone is insufficient because replacement cleanup can lag behind. */
export function resolveVisualDiagnosticTarget(
  sender: VisualDiagnosticSender,
  deps: VisualDiagnosticsAuthorityDependencies,
): VisualDiagnosticTarget | null {
  const hostWindowId = deps.hostWindowForSender(sender.id);
  if (hostWindowId !== null) {
    return deps.isCurrentHostSender(sender, hostWindowId) ? { windowId: hostWindowId } : null;
  }
  const context = deps.projectContextForSender(sender.id);
  if (!context || !deps.isLiveSurface(context.surfaceId, context.windowId)) return null;
  return deps.isCurrentProjectSender(sender, context.windowId, context.surfaceId)
    ? { windowId: context.windowId, surfaceId: context.surfaceId }
    : null;
}

export const VISUAL_RENDERER_SIGNAL_CHANNEL = 'papers:visual:renderer-signal';

/** Main-process-only receiver for predefined renderer lifecycle signals. The
 * sender, not the renderer payload, determines the window/surface target. */
export function registerVisualDiagnosticsIpc(deps: VisualDiagnosticsIpcDependencies): void {
  deps.ipcMain.on(VISUAL_RENDERER_SIGNAL_CHANNEL, (event, payload) => {
    const target = deps.resolveTarget(event.sender);
    if (!target) return;
    const buffer = deps.bufferForWindow(target.windowId);
    if (!buffer) return;
    try {
      recordRendererVisualSignal(buffer, target, payload);
    } catch {
      // Renderer input is untrusted; malformed signals are ignored and never
      // become a main-process exception or a product-state mutation.
    }
  });
}
