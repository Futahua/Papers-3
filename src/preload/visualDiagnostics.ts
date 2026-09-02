export const VISUAL_RENDERER_DIAGNOSTIC_CHANNEL = 'papers:visual:renderer-diagnostic';

interface VisualDiagnosticEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

interface VisualDiagnosticIpc {
  send(channel: string, payload: unknown): void;
}

function messageFromError(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 4096);
  if (value instanceof Error && value.message.length > 0) return value.message.slice(0, 4096);
  if (value !== null && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    const message = (value as { message: string }).message;
    if (message.length > 0) return message.slice(0, 4096);
  }
  return fallback;
}

/** Install only the two renderer-owned failure listeners used by the opt-in
 * visual diagnostics contract. Stacks, source filenames and event objects are
 * deliberately not forwarded. */
export function installVisualDiagnosticListeners(
  ipc: VisualDiagnosticIpc,
  enabled: boolean,
  target: VisualDiagnosticEventTarget,
): void {
  if (!enabled) return;
  target.addEventListener('error', (event) => {
    const value = event as { message?: unknown; error?: unknown };
    ipc.send(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'uncaught-error',
      message: messageFromError(value.message ?? value.error, 'uncaught error'),
    });
  });
  target.addEventListener('unhandledrejection', (event) => {
    const value = event as { reason?: unknown };
    ipc.send(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'unhandled-rejection',
      message: messageFromError(value.reason, 'unhandled rejection'),
    });
  });
}
