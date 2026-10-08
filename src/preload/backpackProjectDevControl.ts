// Diagnostics add observations to the production bridge; they never replace it.
// A distinct build identity keeps this source inlined into the sandboxed entry.
import './backpackProject?diagnostics';
import { contextBridge, ipcRenderer } from 'electron';
import {
  createProjectVisualDiagnosticBridge,
  reportProjectFirstPaint,
  type ProjectVisualDiagnosticBridge,
} from './projectVisualDiagnostics';
import { installProjectVisualLayoutObserver } from './projectVisualLayoutObserver';
import { installProjectVisualSemanticKeyObserver } from './projectVisualSemanticKeys';
import { VISUAL_DOCUMENT_INSTANCE_CHANNEL, VISUAL_FENCE_REQUEST_CHANNEL, VISUAL_FENCE_RESPONSE_CHANNEL, VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL } from '@shared/visualSemanticKeyConstants';

const MAIN_WORLD_DIAGNOSTIC_BRIDGE = 'papersVisualDiagnosticBridgeV1';

function installVisualDiagnosticListeners(
  ipc: { send(channel: string, payload: unknown): void; on?(channel: string, listener: (...args: unknown[]) => void): void },
  mainWorld: {
    exposeInMainWorld(apiKey: string, api: ProjectVisualDiagnosticBridge): void;
    executeInMainWorld(script: { func: () => void }): unknown;
  },
): void {
  let refreshSemanticKeys = (): void => undefined;
  let refreshLayoutObserver = (): void => undefined;
  let stableLayoutEpoch: number | null = null;
  const diagnosticBridge = createProjectVisualDiagnosticBridge(ipc, () => refreshSemanticKeys());
  mainWorld.exposeInMainWorld(MAIN_WORLD_DIAGNOSTIC_BRIDGE, diagnosticBridge);
  // Keep first-paint emission Papers-owned while observing the document's
  // browser-provided Paint Timing entries in this preload world.
  try {
    let firstPaintReported = false;
    const reportFirstPaint = (entryName: unknown): void => {
      if (firstPaintReported || entryName !== 'first-paint') return;
      firstPaintReported = true;
      reportProjectFirstPaint(ipc);
    };
    const paintObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => reportFirstPaint(entry.name));
      if (firstPaintReported) paintObserver.disconnect();
    });
    paintObserver.observe({ type: 'paint', buffered: true });
    performance.getEntriesByType('paint').forEach((entry) => reportFirstPaint(entry.name));
    if (firstPaintReported) paintObserver.disconnect();
  } catch {
    // Paint Timing is a browser-provided optional signal. Absence of the
    // API leaves first-paint unknown; it is never inferred from load or DOM readiness.
  }
  try {
    refreshLayoutObserver = installProjectVisualLayoutObserver(ipc, {
      document,
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      ResizeObserver: typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
      MutationObserver: typeof MutationObserver === 'undefined' ? undefined : MutationObserver,
      onLayoutEpoch: () => { stableLayoutEpoch = null; },
      onLayoutStable: (epoch) => { stableLayoutEpoch = epoch; refreshSemanticKeys(); },
    });
  } catch {
    // Missing observer APIs leave layout stability unknown; no success is synthesized.
  }
  ipc.on?.(VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL, () => refreshLayoutObserver());
  try {
    refreshSemanticKeys = installProjectVisualSemanticKeyObserver(ipc, {
      document,
      MutationObserver: typeof MutationObserver === 'undefined' ? undefined : MutationObserver,
      documentInstanceId: documentInstanceId ?? undefined,
      devicePixelRatio: window.devicePixelRatio,
      stableLayoutEpoch: () => stableLayoutEpoch,
    });
  } catch {
    // Semantic observation is diagnostic-only and must never affect startup.
  }
  try {
    void Promise.resolve(mainWorld.executeInMainWorld({ func: () => {
      const page = window as unknown as {
        papersVisualDiagnosticBridgeV1?: ProjectVisualDiagnosticBridge;
        __papersVisualDiagnosticObserverV1?: boolean;
      };
      // The isolated-world bridge can become visible to the page a moment
      // after this document-start callback runs. Install the listeners
      // unconditionally and resolve the bridge when an event is delivered;
      // otherwise an early bridge lookup would silently miss bootstrap
      // failures from the project's first script.
      if (page.__papersVisualDiagnosticObserverV1) return;
      Object.defineProperty(page, '__papersVisualDiagnosticObserverV1', { value: true, configurable: false, enumerable: false });
      const report = (kind: 'uncaught-error' | 'unhandled-rejection', message: unknown) => {
        const bridge = page.papersVisualDiagnosticBridgeV1;
        if (!bridge) return;
        bridge.report(kind, typeof message === 'string' && message.length > 0 ? message.slice(0, 4096) :
          (kind === 'uncaught-error' ? 'uncaught error' : 'unhandled rejection'));
      };
      window.addEventListener('error', (event) => report('uncaught-error', event.message));
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        report('unhandled-rejection', reason instanceof Error ? reason.message :
          reason !== null && typeof reason === 'object' && typeof reason.message === 'string' ? reason.message :
            typeof reason === 'string' ? reason : 'unhandled rejection');
      });
    } })).catch(() => undefined);
  } catch {
    // A build without main-world execution leaves diagnostics inert.
  }
}

let documentInstanceId: string | null = null;
const pendingDocumentScopedMessages: Array<{ channel: string; payload: unknown }> = [];
const documentScopedIpc = {
  send(channel: string, payload: unknown): void {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (documentInstanceId === null) {
      if (pendingDocumentScopedMessages.length < 128) pendingDocumentScopedMessages.push({ channel, payload });
      return;
    }
    ipcRenderer.send(channel, { ...(payload as Record<string, unknown>), documentInstanceId });
  },
  on(channel: string, listener: (...args: unknown[]) => void): void {
    ipcRenderer.on(channel, listener as never);
  },
};
ipcRenderer.on(VISUAL_DOCUMENT_INSTANCE_CHANNEL, (_event, payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
  const next = (payload as { documentInstanceId?: unknown }).documentInstanceId;
  if (typeof next !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(next)) return;
  documentInstanceId = next;
  for (const message of pendingDocumentScopedMessages.splice(0)) {
    if (message.payload !== null && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
      ipcRenderer.send(message.channel, { ...(message.payload as Record<string, unknown>), documentInstanceId });
    }
  }
});
installVisualDiagnosticListeners(documentScopedIpc, contextBridge);

ipcRenderer.on(VISUAL_FENCE_REQUEST_CHANNEL, (_event, payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
  const requestId = (payload as { requestId?: unknown }).requestId;
  const requestedDocumentInstanceId = (payload as { documentInstanceId?: unknown }).documentInstanceId;
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128
    || documentInstanceId === null || requestedDocumentInstanceId !== documentInstanceId) return;
  ipcRenderer.send(VISUAL_FENCE_RESPONSE_CHANNEL, { requestId, documentInstanceId, ready: true });
});
