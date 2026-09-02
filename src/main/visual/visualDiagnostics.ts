import { z } from 'zod';

export const visualLifecyclePhases = [
  'navigation-started',
  'dom-ready',
  'state-hydrated',
  'first-paint',
  'layout-stable',
  'render-failed',
] as const;
export type VisualLifecyclePhase = (typeof visualLifecyclePhases)[number];

const visualDiagnosticPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lifecycle'),
    phase: z.enum(visualLifecyclePhases),
    detail: z.string().max(2048).optional(),
  }).strict(),
  z.object({
    kind: z.literal('console'),
    level: z.enum(['debug', 'info', 'log', 'warn', 'error']),
    message: z.string().min(1).max(4096),
  }).strict(),
  z.object({
    kind: z.literal('uncaught-error'),
    message: z.string().min(1).max(4096),
  }).strict(),
  z.object({
    kind: z.literal('unhandled-rejection'),
    message: z.string().min(1).max(4096),
  }).strict(),
  z.object({
    kind: z.literal('navigation-failed'),
    errorCode: z.number().int(),
    message: z.string().min(1).max(2048),
  }).strict(),
  z.object({
    kind: z.literal('resource-failed'),
    resourceKind: z.enum(['script', 'style', 'image', 'font', 'other']),
    errorCode: z.number().int().optional(),
    message: z.string().min(1).max(2048),
  }).strict(),
  z.object({
    kind: z.literal('renderer-gone'),
    reason: z.string().min(1).max(256),
  }).strict(),
  z.object({
    kind: z.literal('hydration-failed'),
    message: z.string().min(1).max(2048),
  }).strict(),
]);

export type VisualDiagnosticPayload = z.infer<typeof visualDiagnosticPayloadSchema>;

export const visualDiagnosticRecordSchema = z.object({
  sequence: z.number().int().positive(),
  observedAt: z.string().datetime(),
  target: z.object({
    windowId: z.number().int(),
    surfaceId: z.string().min(1).max(128).optional(),
  }).strict(),
  payload: visualDiagnosticPayloadSchema,
}).strict();

export type VisualDiagnosticRecord = z.infer<typeof visualDiagnosticRecordSchema>;

export interface VisualDiagnosticBuffer {
  append(target: { windowId: number; surfaceId?: string }, payload: unknown): VisualDiagnosticRecord;
  snapshot(): VisualDiagnosticRecord[];
  clear(): void;
}

const DEFAULT_CAPACITY = 128;
const MAX_CAPACITY = 512;

/** Keep diagnostic evidence bounded and useful after a renderer has failed.
 * This is an in-memory ring: it never writes project state and never records
 * continuously on its own. Producers append only on explicit lifecycle or
 * renderer events. */
export function createVisualDiagnosticBuffer(options: {
  capacity?: number;
  now?: () => Date;
} = {}): VisualDiagnosticBuffer {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new Error(`diagnostic buffer capacity must be an integer from 1 to ${MAX_CAPACITY}`);
  }
  const now = options.now ?? (() => new Date());
  const records: VisualDiagnosticRecord[] = [];
  let sequence = 0;

  return {
    append(target, payload) {
      const parsedTarget = z.object({
        windowId: z.number().int(),
        surfaceId: z.string().min(1).max(128).optional(),
      }).strict().parse(target);
      const parsedPayload = visualDiagnosticPayloadSchema.parse(redactDiagnosticPayload(payload));
      const record = visualDiagnosticRecordSchema.parse({
        sequence: ++sequence,
        observedAt: now().toISOString(),
        target: parsedTarget,
        payload: parsedPayload,
      });
      records.push(record);
      if (records.length > capacity) records.shift();
      return cloneRecord(record);
    },
    snapshot() {
      return records.map(cloneRecord);
    },
    clear() {
      records.length = 0;
    },
  };
}

function cloneRecord(record: VisualDiagnosticRecord): VisualDiagnosticRecord {
  return {
    ...record,
    target: { ...record.target },
    payload: { ...record.payload } as VisualDiagnosticPayload,
  };
}

function redactDiagnosticPayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = { ...(raw as Record<string, unknown>) };
  for (const key of ['message', 'detail', 'reason']) {
    if (typeof value[key] === 'string') value[key] = redactDiagnosticText(value[key]);
  }
  return value;
}

/** Console/errors may contain accidental local paths, URLs or credential-like
 * assignments. Keep the diagnostic signal while removing those disclosures. */
export function redactDiagnosticText(text: string): string {
  return text
    // Redact credentials first so an unquoted path scan cannot consume the
    // key/value tail that follows a path with spaces.
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=<redacted>')
    // Keep the contract scheme-agnostic; diagnostic messages may contain
    // custom app/resource URLs as well as http/file URLs.
    .replace(/\b(?![A-Za-z]:[\\/])[a-z][a-z0-9+.-]*:(?!:ERR_[A-Z0-9_]+\b)[^\s"'<>]+/gi, '<url>')
    // Quoted drive/UNC paths may contain spaces. The quote is part of the
    // diagnostic syntax, not evidence that the path should be retained.
    .replace(/(^|[\s("'\[])(["'])(?:[A-Za-z]:[\\/]|\\\\)[^"'\r\n]*\2/g, '$1<path>')
    // Unquoted drive paths are stopped before a credential-like assignment;
    // this handles `C:\\Program Files\\Papers\\out\\main.js token = ...`.
    .replace(/(^|[\s("'\[])([A-Za-z]:[\\/](?:(?!\s+(?:(?:token|password|secret|api[_-]?key)\s*[:=]|[A-Za-z]:[\\/]|\\\\))[^<>:"|?*\r\n])+)/gi, '$1<path>')
    // Unquoted UNC paths conventionally contain no spaces; quoted UNC paths
    // were handled above.
    .replace(/(^|[\s("'\[])(\\\\[^\s"'<>]+)/g, '$1<path>')
    .slice(0, 4096);
}
