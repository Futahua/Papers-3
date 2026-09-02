import { z } from 'zod';
import type { VisualDiagnosticBuffer, VisualDiagnosticPayload } from './visualDiagnostics';

export interface VisualDiagnosticTarget {
  windowId: number;
  surfaceId?: string;
}
/** Small event surface shared by Electron WebContents and deterministic fakes.
 * The adapter never receives or forwards source URLs, sender ids, or handles. */
export interface VisualLifecycleSource {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface VisualLifecycleMonitor {
  recordRendererSignal(payload: unknown): void;
  detach(): void;
}

export type RendererDiagnosticSource = 'observer' | 'bootstrap-console';

const rendererOwnedPhases = ['state-hydrated', 'first-paint', 'layout-stable', 'render-failed'] as const;
const rendererDiagnosticPayloadSchema = z.object({
  kind: z.enum(['uncaught-error', 'unhandled-rejection']),
  message: z.string().min(1).max(4096),
}).strict();

interface RecentRendererDiagnostic {
  source: RendererDiagnosticSource;
  target: VisualDiagnosticTarget;
  kind: 'uncaught-error' | 'unhandled-rejection';
  rawMessage: string;
  observedAt: number;
}

const recentRendererDiagnostics = new WeakMap<VisualDiagnosticBuffer, RecentRendererDiagnostic[]>();

/** Validate a renderer signal at the main-process boundary. The caller owns
 * the target resolution; a renderer only supplies the predefined phase. */
export function recordRendererVisualSignal(
  buffer: VisualDiagnosticBuffer,
  target: VisualDiagnosticTarget,
  payload: unknown,
): void {
  const parsed = payload as { kind?: unknown; phase?: unknown; detail?: unknown };
  if (parsed.kind !== 'lifecycle' || !rendererOwnedPhases.includes(parsed.phase as typeof rendererOwnedPhases[number])) {
    throw new Error('renderer lifecycle signal is not an allowed phase');
  }
  buffer.append(target, {
    kind: 'lifecycle',
    phase: parsed.phase,
    ...(typeof parsed.detail === 'string' ? { detail: parsed.detail } : {}),
  });
}

/** Accept only the two renderer failure payloads. The target is supplied by
 * authenticated main-process sender resolution, never by this payload. */
export function recordRendererVisualDiagnostic(
  buffer: VisualDiagnosticBuffer,
  target: VisualDiagnosticTarget,
  payload: unknown,
  source: RendererDiagnosticSource = 'observer',
): void {
  const parsed = rendererDiagnosticPayloadSchema.parse(payload);
  const observedAt = Date.now();
  const recent = recentRendererDiagnostics.get(buffer) ?? [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (observedAt - recent[index]!.observedAt > 1000) recent.splice(index, 1);
  }
  const duplicate = recent.some((candidate) => candidate.source !== source
    && candidate.target.windowId === target.windowId
    && candidate.target.surfaceId === target.surfaceId
    && candidate.kind === parsed.kind
    // Compare the pre-redaction message so two different private paths or
    // credential values cannot collide after they become <path>/<redacted>.
    && candidate.rawMessage === parsed.message);
  recent.push({ source, target: { ...target }, kind: parsed.kind, rawMessage: parsed.message, observedAt });
  recentRendererDiagnostics.set(buffer, recent);
  if (duplicate) return;
  buffer.append(target, parsed);
}

function consoleLevel(level: unknown): 'debug' | 'info' | 'log' | 'warn' | 'error' {
  if (level === 0) return 'debug';
  if (level === 1) return 'info';
  if (level === 2) return 'warn';
  if (level === 3) return 'error';
  return 'log';
}

/** Attach only the lifecycle signals owned by the main process. Renderer-owned
 * phases arrive through recordRendererSignal and remain target-bound by this
 * closure. No interval, timer, reload, or recovery action is introduced. */
export function attachVisualLifecycleMonitor(
  source: VisualLifecycleSource,
  target: VisualDiagnosticTarget,
  buffer: VisualDiagnosticBuffer,
): VisualLifecycleMonitor {
  const listeners: Array<[string, (...args: unknown[]) => void]> = [];
  const listen = (event: string, listener: (...args: unknown[]) => void): void => {
    source.on(event, listener);
    listeners.push([event, listener]);
  };
  const record = (payload: VisualDiagnosticPayload): void => {
    buffer.append(target, payload);
  };

  listen('did-start-loading', () => record({ kind: 'lifecycle', phase: 'navigation-started' }));
  listen('dom-ready', () => record({ kind: 'lifecycle', phase: 'dom-ready' }));
  listen('did-fail-load', (...args) => {
    // Electron reports this for subframes too. Only a main-frame failure is a
    // failure of the monitored document; subframe/resource attribution has a
    // separate, later session.webRequest design.
    if (args[4] !== true) return;
    const errorCode = typeof args[1] === 'number' ? args[1] : -1;
    const message = typeof args[2] === 'string' && args[2].length > 0 ? args[2] : 'navigation failed';
    record({ kind: 'navigation-failed', errorCode, message });
  });
  listen('console-message', (...args) => {
    const message = typeof args[2] === 'string' && args[2].length > 0 ? args[2] : 'console message unavailable';
    const level = consoleLevel(args[1]);
    record({ kind: 'console', level, message });
  });
  listen('render-process-gone', (...args) => {
    const details = args[1];
    const reason = details !== null && typeof details === 'object' && typeof (details as { reason?: unknown }).reason === 'string'
      ? (details as { reason: string }).reason
      : 'unknown';
    record({ kind: 'renderer-gone', reason });
  });
  return {
    recordRendererSignal(payload) {
      recordRendererVisualSignal(buffer, target, payload);
    },
    detach() {
      for (const [event, listener] of listeners) source.removeListener(event, listener);
      listeners.length = 0;
    },
  };
}
