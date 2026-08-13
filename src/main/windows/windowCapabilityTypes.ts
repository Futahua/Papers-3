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
  'cloak',
  'uncloak',
  'cloak-many',
  'uncloak-many',
  'live-preview',
  'apply',
  'close',
  'hover',
  'thumbnail',
] as const;

export type WindowCapabilityMethod = (typeof WINDOW_CAPABILITY_METHODS)[number];

/** Typed outcomes every request can resolve to. `minimized` is produced ONLY
 * by the 019G thumbnail method (a minimized window is an honest typed
 * fallback); the parser rejects it on every other method. */
export type WindowOutcome =
  | 'success'
  | 'missing'
  | 'ambiguous'
  | 'denied'
  | 'malformed'
  | 'helper-unavailable'
  | 'timeout'
  | 'minimized';

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
 * carries the geometry/state to apply; `hover` carries a screen point;
 * `thumbnail` carries the bounded max capture dimensions (positive integers,
 * maxWidth <= 320 and maxHeight <= 180; absent -> 240x135 helper default).
 * The client never synthesizes targets. */
export interface WindowRequestMessage {
  requestId: number;
  method: WindowCapabilityMethod;
  target?: RuntimeWindowId;
  targets?: RuntimeWindowId[];
  caller?: string;
  enabled?: boolean;
  bounds?: WindowBounds;
  state?: WindowState;
  x?: number;
  y?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** Bounded real-window thumbnail (019G/024/025): a base64 PNG whose decoded
 * bytes are <= 256 KiB and start with the PNG signature, plus the actual
 * scaled output dimensions (width <= 320, height <= 180). `source` is 'capture'
 * for a PrintWindow screenshot, 'dwm' for a DWM-composited real-content capture
 * (hardware-accelerated / acad-like windows), or 'icon' for the window's own
 * program-icon image (the honest TERMINAL fallback, never acceptance evidence);
 * `minimized` reports the window's state at capture time. */
export interface WindowThumbnail {
  image: string;
  width: number;
  height: number;
  source?: 'capture' | 'dwm' | 'icon';
  minimized?: boolean;
}

/** Helper -> client. `method` echoes the request so correlation can reject a
 * mismatched reply instead of satisfying the wrong request. `window` is the
 * hover result: a valid observation or null (nothing task-worthy at the
 * point). `thumbnail` is the 019G capture result. `target` is the 019GR3
 * thumbnail correlation echo: the accepted helper token returned on EVERY
 * thumbnail response (success and fallback), required by the parser and used
 * by the client so a pending thumbnail resolves only when requestId, method
 * AND target all match. The client strips it before the result leaves the
 * transport boundary. */
export interface WindowResponseMessage {
  requestId: number;
  method: WindowCapabilityMethod;
  outcome: WindowOutcome;
  windows?: WindowObservation[];
  observation?: WindowObservation;
  window?: WindowObservation | null;
  thumbnail?: WindowThumbnail;
  target?: RuntimeWindowId;
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
  thumbnail?: WindowThumbnail;
  error?: string;
}

const WINDOW_OUTCOMES: readonly string[] = [
  'success', 'missing', 'ambiguous', 'denied', 'malformed',
  'helper-unavailable', 'timeout',
];

/** The `minimized` outcome is valid ONLY for the 019G thumbnail method. */
const THUMBNAIL_OUTCOMES: readonly string[] = [...WINDOW_OUTCOMES, 'minimized'];

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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Upper bound for the base64 text of a 256 KiB decoded PNG:
 * ceil(262144 / 3) * 4 = 349528 characters. */
const WINDOW_THUMBNAIL_MAX_BASE64_LENGTH = 349528;
export const WINDOW_THUMBNAIL_MAX_DECODED_BYTES = 256 * 1024;
export const WINDOW_THUMBNAIL_MAX_WIDTH = 320;
export const WINDOW_THUMBNAIL_MAX_HEIGHT = 180;

/** Strict 019G thumbnail payload validator: the nested object must have EXACT
 * keys { image, width, height }; `image` must be a canonical base64 PNG whose
 * decoded bytes are <= 256 KiB and start with the PNG signature; the PNG IHDR
 * chunk's positive width/height must equal the claimed width/height and stay
 * within 320x180 (signature alone is insufficient). */
export function isValidThumbnail(value: unknown): value is WindowThumbnail {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = ['height', 'image', 'width'];
  const allowedWithFlags = ['height', 'image', 'minimized', 'source', 'width'];
  const hasFlags = 'source' in value || 'minimized' in value;
  if (keys.length !== (hasFlags ? allowedWithFlags.length : allowed.length)) return false;
  const reference = hasFlags ? allowedWithFlags : allowed;
  for (let index = 0; index < reference.length; index += 1) {
    if (keys[index] !== reference[index]) return false;
  }
  const { image, width, height } = value;
  if (typeof image !== 'string' || image.length === 0) return false;
  if (image.length > WINDOW_THUMBNAIL_MAX_BASE64_LENGTH) return false;
  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) return false;
  if (width > WINDOW_THUMBNAIL_MAX_WIDTH || height > WINDOW_THUMBNAIL_MAX_HEIGHT) return false;
  if (value.source !== undefined && value.source !== 'capture' && value.source !== 'dwm' && value.source !== 'icon') return false;
  if (value.minimized !== undefined && typeof value.minimized !== 'boolean') return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(image, 'base64');
  } catch {
    return false;
  }
  if (decoded.length > WINDOW_THUMBNAIL_MAX_DECODED_BYTES) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (decoded[i] !== PNG_SIGNATURE[i]) return false;
  }
  // Decode the PNG IHDR and require its width/height to match the claim.
  if (decoded.length < 33) return false; // 8 sig + 4 len + 4 'IHDR' + 13 data + 4 crc
  if (decoded.readUInt32BE(8) !== 13) return false;
  if (decoded.toString('latin1', 12, 16) !== 'IHDR') return false;
  const ihdrWidth = decoded.readUInt32BE(16);
  const ihdrHeight = decoded.readUInt32BE(20);
  if (ihdrWidth <= 0 || ihdrHeight <= 0) return false;
  if (ihdrWidth !== width || ihdrHeight !== height) return false;
  return true;
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
  const methodName = method as WindowCapabilityMethod;
  const outcome = raw['outcome'];
  const allowedOutcomes = methodName === 'thumbnail' ? THUMBNAIL_OUTCOMES : WINDOW_OUTCOMES;
  if (typeof outcome !== 'string' || !allowedOutcomes.includes(outcome)) return null;
  if (raw['error'] !== undefined && typeof raw['error'] !== 'string') return null;
  const error = typeof raw['error'] === 'string' ? raw['error'] : undefined;

  const hasExtraPayload = raw['windows'] !== undefined || raw['observation'] !== undefined
    || raw['window'] !== undefined || raw['thumbnail'] !== undefined;

  if (method === 'close' || method === 'cloak-many' || method === 'uncloak-many' || method === 'live-preview') {
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
        if (raw['windows'] !== undefined || raw['observation'] !== undefined || raw['thumbnail'] !== undefined) return null;
        return { requestId, method: methodName, outcome, window: null, ...(error !== undefined ? { error } : {}) };
      }
      const parsed = parseWindowObservation(window);
      if (parsed === undefined) return null;
      if (raw['windows'] !== undefined || raw['observation'] !== undefined || raw['thumbnail'] !== undefined) return null;
      return { requestId, method: methodName, outcome, window: parsed, ...(error !== undefined ? { error } : {}) };
    }
    if (hasExtraPayload) return null;
    return { requestId, method: methodName, outcome: outcome as WindowOutcome, ...(error !== undefined ? { error } : {}) };
  }

  if (method === 'thumbnail') {
    // 019G thumbnail shape (019GR2 strict + 019GR3 target correlation): the
    // top-level envelope may contain ONLY the known keys; success must carry
    // exactly `thumbnail` (a valid bounded PNG payload) and every response
    // (success AND fallback) MUST carry the accepted helper `target` token,
    // which the client uses to correlate. ANY unknown key invalidates the
    // whole envelope.
    const allowedEnvelopeKeys = outcome === 'success'
      ? ['requestId', 'method', 'outcome', 'thumbnail', 'target', 'error']
      : ['requestId', 'method', 'outcome', 'target', 'error'];
    if (Object.keys(raw).some((key) => !allowedEnvelopeKeys.includes(key))) return null;
    const responseTarget = parseRuntimeWindowId(raw['target']);
    if (!responseTarget) return null;
    if (outcome === 'success') {
      if (raw['thumbnail'] === undefined) return null;
      if (!isValidThumbnail(raw['thumbnail'])) return null;
      if (raw['windows'] !== undefined || raw['observation'] !== undefined || raw['window'] !== undefined) return null;
      const thumbnail = raw['thumbnail'] as WindowThumbnail;
      return { requestId, method: methodName, outcome, thumbnail, target: responseTarget, ...(error !== undefined ? { error } : {}) };
    }
    return { requestId, method: methodName, outcome: outcome as WindowOutcome, target: responseTarget, ...(error !== undefined ? { error } : {}) };
  }

  if (outcome === 'success' && method === 'list') {
    if (!Array.isArray(raw['windows'])) return null;
    if (raw['observation'] !== undefined || raw['window'] !== undefined || raw['thumbnail'] !== undefined) return null;
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
    if (raw['windows'] !== undefined || raw['window'] !== undefined || raw['thumbnail'] !== undefined) return null;
    return { requestId, method: methodName, outcome, observation, ...(error !== undefined ? { error } : {}) };
  }

  if (hasExtraPayload) return null;
  return { requestId, method: methodName, outcome: outcome as WindowOutcome, ...(error !== undefined ? { error } : {}) };
}
