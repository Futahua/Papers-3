/**
 * The typed internal window-capability contract (Assignment 010).
 *
 * This vocabulary is what a later helper-transport proof will speak; nothing
 * here spawns a process, talks to Windows or touches the renderer. The
 * contract deliberately separates:
 *  - opaque live-session runtime ids (RuntimeWindowId), and
 *  - any future persisted matching/launch descriptor (PersistedWindowDescriptor),
 * which structurally cannot hold a runtime id.
 *
 * Outcomes are explicit and typed; zero/multiple resolution is never turned
 * into a guessed id by this code.
 */

export const WINDOW_CAPABILITY_METHODS = [
  'list',
  'observe',
  'minimize',
  'restore',
  'apply',
  'close',
  'hover',
] as const;

export type WindowCapabilityMethod = (typeof WINDOW_CAPABILITY_METHODS)[number];

/** Typed outcomes every request can resolve to. */
export type WindowOutcome =
  | 'success'
  | 'missing'
  | 'ambiguous'
  | 'denied'
  | 'malformed'
  | 'helper-unavailable'
  | 'timeout';

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'missing';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opaque live-session window identity. Structurally separate from any
 * persisted descriptor: the brand makes a RuntimeWindowId unassignable to
 * PersistedWindowDescriptor (compiler-enforced in the type test), and it is
 * never written anywhere durable. */
declare const runtimeWindowIdBrand: unique symbol;
export type RuntimeWindowId = string & { [runtimeWindowIdBrand]: true };

export interface WindowObservation {
  runtimeId: RuntimeWindowId;
  title: string;
  processId: number | null;
  processPath: string | null;
  state: WindowState;
  bounds: WindowBounds | null;
}

/** Client -> helper. `target` is an already-resolved runtime id; `apply`
 * carries the geometry/state to apply; `hover` carries a screen point. The
 * client never synthesizes targets. */
export interface WindowRequestMessage {
  requestId: number;
  method: WindowCapabilityMethod;
  target?: RuntimeWindowId;
  bounds?: WindowBounds;
  state?: WindowState;
  x?: number;
  y?: number;
}

/** Helper -> client. `method` echoes the request so correlation can reject a
 * mismatched reply instead of satisfying the wrong request. `window` is the
 * hover result: a valid observation or null (nothing task-worthy at the
 * point). */
export interface WindowResponseMessage {
  requestId: number;
  method: WindowCapabilityMethod;
  outcome: WindowOutcome;
  windows?: WindowObservation[];
  observation?: WindowObservation;
  window?: WindowObservation | null;
  error?: string;
}

/** A future persisted matching/launch descriptor: launch identity and
 * optional title hint for fail-closed resolution. Deliberately contains NO
 * runtime id — runtime ids are live-session values only. */
export interface PersistedWindowDescriptor {
  kind: 'launch-path';
  executable: string;
  arguments?: string[];
  titleHint?: string;
}

/** The injectable transport boundary. A real helper will speak JSON lines
 * over its stdin/stdout; tests use an in-memory fake that can deliver
 * out-of-order, duplicate and malformed payloads.
 *
 * `onTerminal` is the supervisor-observability seam (Assignment 011): EVERY
 * terminal condition — EOF, read/write error AND explicit close — is
 * reported exactly once, with the cause retained for late observers. The
 * supervisor's clean stop stays `stopped` because it enters `stopping`
 * before calling close(). In-memory fakes that never terminate simply omit
 * the method. */
export interface WindowTransport {
  send(message: WindowRequestMessage): Promise<void>;
  onMessage(callback: (raw: unknown) => void): void;
  close(): Promise<void>;
  onTerminal?(callback: (error?: Error) => void): void;
}

export interface WindowCapabilityResult {
  outcome: WindowOutcome;
  windows?: WindowObservation[];
  observation?: WindowObservation;
  window?: WindowObservation | null;
  error?: string;
}

const WINDOW_OUTCOMES: readonly string[] = [
  'success', 'missing', 'ambiguous', 'denied', 'malformed',
  'helper-unavailable', 'timeout',
];

const WINDOW_STATES: readonly string[] = ['normal', 'minimized', 'maximized', 'missing'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseRuntimeWindowId(raw: unknown): RuntimeWindowId | null {
  return typeof raw === 'string' && raw.length > 0 ? (raw as RuntimeWindowId) : null;
}

/** undefined = the key is absent or malformed; null = a valid null. */
function parseWindowBounds(raw: unknown): WindowBounds | null | undefined {
  if (raw === null) return null;
  if (!isPlainObject(raw)) return undefined;
  const { x, y, width, height } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** undefined = malformed; otherwise a fully validated observation. */
function parseWindowObservation(raw: unknown): WindowObservation | undefined {
  if (!isPlainObject(raw)) return undefined;
  const runtimeId = parseRuntimeWindowId(raw['runtimeId']);
  if (!runtimeId) return undefined;
  if (typeof raw['title'] !== 'string') return undefined;
  const processId = raw['processId'];
  if (processId !== null
    && !(typeof processId === 'number' && Number.isSafeInteger(processId) && processId >= 0)) return undefined;
  const processPath = raw['processPath'];
  if (processPath !== null && typeof processPath !== 'string') return undefined;
  const state = raw['state'];
  if (typeof state !== 'string' || !WINDOW_STATES.includes(state)) return undefined;
  const bounds = parseWindowBounds(raw['bounds']);
  if (bounds === undefined) return undefined;
  return {
    runtimeId,
    title: raw['title'],
    processId,
    processPath,
    state: state as WindowState,
    bounds,
  };
}

/** Validates an inbound payload as a response message with a deep schema
 * gate: every nested observation/bounds/state field is validated (no
 * unchecked casts), one bad entry invalidates a whole windows array, and
 * the per-method/outcome payload shapes are strict:
 * - successful `list` must carry a valid windows array;
 * - successful `observe`/`minimize`/`restore`/`apply` must carry a valid
 *   observation;
 * - successful `close` is the documented envelope-only shape;
 * - non-success responses are envelope-only.
 * Returns null for anything that does not fit exactly. */
export function parseWindowResponse(raw: unknown): WindowResponseMessage | null {
  if (!isPlainObject(raw)) return null;
  const requestId = raw['requestId'];
  if (!isPositiveSafeInteger(requestId)) return null;
  const method = raw['method'];
  if (typeof method !== 'string' || !(WINDOW_CAPABILITY_METHODS as readonly string[]).includes(method)) return null;
  const outcome = raw['outcome'];
  if (typeof outcome !== 'string' || !WINDOW_OUTCOMES.includes(outcome)) return null;
  if (raw['error'] !== undefined && typeof raw['error'] !== 'string') return null;
  const error = typeof raw['error'] === 'string' ? raw['error'] : undefined;
  const methodName = method as WindowCapabilityMethod;

  const hasExtraPayload = raw['windows'] !== undefined || raw['observation'] !== undefined || raw['window'] !== undefined;

  if (method === 'close') {
    // Documented close shape: envelope only, no payload.
    if (hasExtraPayload) return null;
    return { requestId, method: methodName, outcome: outcome as WindowOutcome, ...(error !== undefined ? { error } : {}) };
  }

  if (method === 'hover') {
    // Documented hover shape: success must carry `window` (a valid
    // observation or explicit null) and no other payload key; non-success
    // responses are envelope-only.
    if (outcome === 'success') {
      if (!('window' in raw)) return null;
      const window = raw['window'];
      if (window === null) {
        if (raw['windows'] !== undefined || raw['observation'] !== undefined) return null;
        return { requestId, method: methodName, outcome, window: null, ...(error !== undefined ? { error } : {}) };
      }
      const parsed = parseWindowObservation(window);
      if (parsed === undefined) return null;
      if (raw['windows'] !== undefined || raw['observation'] !== undefined) return null;
      return { requestId, method: methodName, outcome, window: parsed, ...(error !== undefined ? { error } : {}) };
    }
    if (hasExtraPayload) return null;
    return { requestId, method: methodName, outcome: outcome as WindowOutcome, ...(error !== undefined ? { error } : {}) };
  }

  if (outcome === 'success' && method === 'list') {
    if (!Array.isArray(raw['windows'])) return null;
    if (raw['observation'] !== undefined || raw['window'] !== undefined) return null;
    const windows: WindowObservation[] = [];
    for (const entry of raw['windows']) {
      const parsed = parseWindowObservation(entry);
      if (parsed === undefined) return null; // one bad entry invalidates the whole array
      windows.push(parsed);
    }
    return { requestId, method: methodName, outcome, windows, ...(error !== undefined ? { error } : {}) };
  }

  if (outcome === 'success') {
    // observe/minimize/restore/apply success must carry a valid observation.
    const observation = parseWindowObservation(raw['observation']);
    if (observation === undefined) return null;
    if (raw['windows'] !== undefined || raw['window'] !== undefined) return null;
    return { requestId, method: methodName, outcome, observation, ...(error !== undefined ? { error } : {}) };
  }

  if (hasExtraPayload) return null;
  return { requestId, method: methodName, outcome: outcome as WindowOutcome, ...(error !== undefined ? { error } : {}) };
}
