import type { IpcMain } from 'electron';

import { recordRendererVisualSignal, type VisualDiagnosticTarget } from '../visual/visualLifecycleMonitor';
import type { VisualDiagnosticBuffer } from '../visual/visualDiagnostics';

export interface VisualDiagnosticsIpcDependencies {
  ipcMain: Pick<IpcMain, 'on'>;
  resolveTarget(sender: { id: number }): VisualDiagnosticTarget | null;
  bufferForWindow(windowId: number): VisualDiagnosticBuffer | null;
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
