export const VISUAL_RENDERER_DIAGNOSTIC_CHANNEL = 'papers:visual:renderer-diagnostic';
const MAIN_WORLD_DIAGNOSTIC_BRIDGE = 'papersVisualDiagnosticBridgeV1';

interface VisualDiagnosticIpc {
  send(channel: string, payload: unknown): void;
}

interface VisualDiagnosticMainWorldBridge {
  exposeInMainWorld(apiKey: string, api: { report(kind: string, message: string): void }): void;
}

/** Installs the two failure listeners in the page's main world. This helper
 * is imported only by the dev-control preload entries; the normal preloads
 * contain no diagnostics observer. Stacks, source filenames, and event
 * objects never cross the renderer boundary. */
export function installVisualDiagnosticListeners(
  ipc: VisualDiagnosticIpc,
  mainWorld: VisualDiagnosticMainWorldBridge,
): void {
  mainWorld.exposeInMainWorld(MAIN_WORLD_DIAGNOSTIC_BRIDGE, {
    report(kind, message) {
      if (kind !== 'uncaught-error' && kind !== 'unhandled-rejection') return;
      if (typeof message !== 'string' || message.length === 0) return;
      ipc.send(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, { kind, message: message.slice(0, 4096) });
    },
  });
}
