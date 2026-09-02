import { redactDiagnosticText, type VisualDiagnosticBuffer } from './visualDiagnostics';
import type { VisualDiagnosticTarget } from './visualLifecycleMonitor';
import type { VisualDiagnosticSender } from '../ipc/visualDiagnosticsIpc';

export interface VisualResourceFailureDetails {
  webContentsId?: number;
  resourceType?: string;
  error?: string;
}

/** The narrow Electron webRequest surface used by the visual monitor. */
export interface VisualResourceSource {
  onErrorOccurred(listener: ((details: VisualResourceFailureDetails) => void) | null): void;
}

export interface VisualResourceMonitor {
  detach(): void;
}

export type VisualResourceTargetResolver = (sender: VisualDiagnosticSender) => VisualDiagnosticTarget | null;

function resourceKind(resourceType: string | undefined): 'script' | 'style' | 'image' | 'font' | 'other' {
  switch (resourceType) {
    case 'script': return 'script';
    case 'stylesheet': return 'style';
    case 'image': return 'image';
    case 'font': return 'font';
    default: return 'other';
  }
}

/** Attribute network failures only after the main-process authority has
 * resolved the originating WebContents to its current Papers surface. The
 * source URL is deliberately not copied into the diagnostic payload. */
export function attachVisualResourceMonitor(
  source: VisualResourceSource,
  resolveTarget: VisualResourceTargetResolver,
  bufferForWindow: (windowId: number) => VisualDiagnosticBuffer | null,
): VisualResourceMonitor {
  const listener = (details: VisualResourceFailureDetails): void => {
    const webContentsId = details.webContentsId;
    if (typeof webContentsId !== 'number' || !Number.isSafeInteger(webContentsId) || webContentsId < 1) return;
    const target = resolveTarget({ id: webContentsId });
    if (!target) return;
    const buffer = bufferForWindow(target.windowId);
    if (!buffer) return;
    const message = typeof details.error === 'string' && details.error.trim().length > 0
      ? details.error
      : 'resource load failed';
    // `error` has no documented maximum. Redact before applying the
    // resource-failed schema's stricter 2048-character bound, then guard the
    // observer boundary so malformed external detail cannot escape as a main
    // process exception.
    const boundedMessage = redactDiagnosticText(message).slice(0, 2048);
    try {
      buffer.append(target, {
        kind: 'resource-failed',
        resourceKind: resourceKind(details.resourceType),
        message: boundedMessage,
      });
    } catch {
      // Observation must never become a product failure.
    }
  };

  source.onErrorOccurred(listener);
  return {
    detach() {
      source.onErrorOccurred(null);
    },
  };
}
