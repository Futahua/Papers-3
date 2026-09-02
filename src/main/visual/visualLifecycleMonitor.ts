import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  visualHydrationRevisionSchema,
  visualHydrationFailureCodeSchema,
  visualHydrationFailureStageSchema,
  visualHydrationSummarySchema,
  type VisualDiagnosticBuffer,
  type VisualDiagnosticPayload,
} from './visualDiagnostics';

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

const rendererHydrationSignalSchema = z.object({
  kind: z.literal('lifecycle'),
  phase: z.literal('state-hydrated'),
  revision: visualHydrationRevisionSchema,
  summary: visualHydrationSummarySchema.optional(),
}).strict();
const rendererPresentationSignalSchema = z.object({
  kind: z.literal('lifecycle'),
  phase: z.enum(['first-paint', 'layout-stable', 'render-failed']),
  detail: z.string().max(2048).optional(),
}).strict();
const rendererHydrationFailureSignalSchema = z.object({
  kind: z.literal('lifecycle'),
  phase: z.literal('render-failed'),
  revision: visualHydrationRevisionSchema.optional(),
  stage: visualHydrationFailureStageSchema,
  code: visualHydrationFailureCodeSchema,
}).strict();
const rendererDiagnosticPayloadSchema = z.object({
  kind: z.enum(['uncaught-error', 'unhandled-rejection']),
  message: z.string().min(1).max(4096),
}).strict().or(z.object({
  kind: z.literal('hydration-failed'),
  revision: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/).optional(),
  stage: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9._~-]*$/),
  code: z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._~-]*$/),
}).strict());

interface RecentRendererDiagnostic {
  source: RendererDiagnosticSource;
  target: VisualDiagnosticTarget;
  kind: 'uncaught-error' | 'unhandled-rejection';
  fingerprint: string;
  observedAt: number;
}

const MAX_RECENT_RENDERER_DIAGNOSTICS = 64;
const recentRendererDiagnostics = new WeakMap<VisualDiagnosticBuffer, RecentRendererDiagnostic[]>();

/** Validate a renderer signal at the main-process boundary. The caller owns
 * the target resolution; a renderer only supplies the predefined phase. */
export function recordRendererVisualSignal(
  buffer: VisualDiagnosticBuffer,
  target: VisualDiagnosticTarget,
  payload: unknown,
): void {
  const phase = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { phase?: unknown }).phase
    : undefined;
  if (phase === 'state-hydrated') {
    buffer.append(target, rendererHydrationSignalSchema.parse(payload));
    return;
  }
  if (phase === 'render-failed' && payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    && ('stage' in payload || 'code' in payload || 'revision' in payload)) {
    buffer.append(target, rendererHydrationFailureSignalSchema.parse(payload));
    return;
  }
  buffer.append(target, rendererPresentationSignalSchema.parse(payload));
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
  if (parsed.kind === 'hydration-failed') {
    buffer.append(target, parsed);
    return;
  }
  const observedAt = Date.now();
  const recent = recentRendererDiagnostics.get(buffer) ?? [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (observedAt - recent[index]!.observedAt > 1000) recent.splice(index, 1);
  }
  const duplicateIndex = recent.findIndex((candidate) => candidate.source !== source
    && candidate.target.windowId === target.windowId
    && candidate.target.surfaceId === target.surfaceId
    && candidate.kind === parsed.kind
    // Compare a fingerprint of the pre-redaction message so two different
    // private paths or credential values cannot collide after redaction while
    // the transient matcher itself never retains the raw message.
    && candidate.fingerprint === messageFingerprint(parsed.message));
  if (duplicateIndex >= 0) {
    // Consume the pair. Keeping the first source candidate around would make
    // a later genuine same-source repeat look like another duplicate.
    recent.splice(duplicateIndex, 1);
    recentRendererDiagnostics.set(buffer, recent);
    return;
  }
  if (recent.length >= MAX_RECENT_RENDERER_DIAGNOSTICS) recent.shift();
  recent.push({ source, target: { ...target }, kind: parsed.kind, fingerprint: messageFingerprint(parsed.message), observedAt });
  recentRendererDiagnostics.set(buffer, recent);
  buffer.append(target, parsed);
}

function messageFingerprint(message: string): string {
  return createHash('sha256').update(message, 'utf8').digest('hex');
}

/** Narrow test seam for the transient matcher. It deliberately exposes only
 * fingerprints and bounded metadata, never the pre-redaction message. It is
 * not connected to control/MCP output. */
export function recentRendererDiagnosticMatcherSnapshotForTest(buffer: VisualDiagnosticBuffer): Array<{
  source: RendererDiagnosticSource;
  target: VisualDiagnosticTarget;
  kind: 'uncaught-error' | 'unhandled-rejection';
  fingerprint: string;
  observedAt: number;
}> {
  return (recentRendererDiagnostics.get(buffer) ?? []).map((candidate) => ({
    source: candidate.source,
    target: { ...candidate.target },
    kind: candidate.kind,
    fingerprint: candidate.fingerprint,
    observedAt: candidate.observedAt,
  }));
}

export function visualConsoleLevel(level: unknown): 'debug' | 'info' | 'log' | 'warn' | 'error' {
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
    const level = visualConsoleLevel(args[1]);
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
