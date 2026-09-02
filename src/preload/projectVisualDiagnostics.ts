export const VISUAL_RENDERER_SIGNAL_CHANNEL = 'papers:visual:renderer-signal';
export const VISUAL_RENDERER_DIAGNOSTIC_CHANNEL = 'papers:visual:renderer-diagnostic';

export interface ProjectVisualDiagnosticIpc {
  send(channel: string, payload: unknown): void;
}

export interface ProjectVisualDiagnosticBridge {
  report(kind: string, message: string): void;
  reportStateHydrated(revision: string, summary?: unknown): void;
  reportHydrationFailed(revision: string | undefined, stage: string, code: string): void;
}

const MAX_REVISION_LENGTH = 256;
const MAX_SUMMARY_ENTRIES = 32;
const MAX_SUMMARY_KEY_LENGTH = 64;
const MAX_SUMMARY_VALUE = 1_000_000;
const MAX_STAGE_LENGTH = 64;
const MAX_CODE_LENGTH = 128;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const SAFE_SUMMARY_KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SAFE_METADATA_TOKEN = /^[A-Za-z][A-Za-z0-9._~-]*$/;

function safeToken(raw: unknown, pattern: RegExp, maxLength: number): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= maxLength && pattern.test(raw);
}

function safeSummary(raw: unknown): Record<string, number> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_SUMMARY_ENTRIES) return undefined;
  const result: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (key.length > MAX_SUMMARY_KEY_LENGTH || !SAFE_SUMMARY_KEY.test(key)
      || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_SUMMARY_VALUE) {
      return undefined;
    }
    result[key] = value;
  }
  return result;
}

export function reportProjectFirstPaint(ipc: ProjectVisualDiagnosticIpc): void {
  ipc.send(VISUAL_RENDERER_SIGNAL_CHANNEL, { kind: 'lifecycle', phase: 'first-paint' });
}

export function reportProjectLayoutSignal(
  ipc: ProjectVisualDiagnosticIpc,
  phase: 'layout-stable' | 'render-failed',
  detail?: string,
): void {
  ipc.send(VISUAL_RENDERER_SIGNAL_CHANNEL, {
    kind: 'lifecycle',
    phase,
    ...(detail ? { detail } : {}),
  });
}

export function createProjectVisualDiagnosticBridge(ipc: ProjectVisualDiagnosticIpc): ProjectVisualDiagnosticBridge {
  return {
    report(kind, message) {
      if (kind !== 'uncaught-error' && kind !== 'unhandled-rejection') return;
      if (typeof message !== 'string' || message.length === 0) return;
      ipc.send(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, { kind, message: message.slice(0, 4096) });
    },
    reportStateHydrated(revision, summary) {
      if (!safeToken(revision, SAFE_REVISION, MAX_REVISION_LENGTH)) return;
      const parsedSummary = safeSummary(summary);
      if (summary !== undefined && parsedSummary === undefined) return;
      ipc.send(VISUAL_RENDERER_SIGNAL_CHANNEL, {
        kind: 'lifecycle',
        phase: 'state-hydrated',
        revision,
        ...(parsedSummary ? { summary: parsedSummary } : {}),
      });
    },
    reportHydrationFailed(revision, stage, code) {
      if (revision !== undefined && !safeToken(revision, SAFE_REVISION, MAX_REVISION_LENGTH)) return;
      if (!safeToken(stage, SAFE_METADATA_TOKEN, MAX_STAGE_LENGTH)
        || !safeToken(code, SAFE_METADATA_TOKEN, MAX_CODE_LENGTH)) return;
      ipc.send(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
        kind: 'hydration-failed',
        ...(revision !== undefined ? { revision } : {}),
        stage,
        code,
      });
    },
  };
}
