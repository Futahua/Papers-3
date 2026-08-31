/**
 * Delegate Wave relay — the narrowest host seam that lets ONE bound Backpack
 * reach the machine-local delegate-wave Control API.
 *
 * Why this exists at all: Backpack pages are served under `papers-backpack:`
 * with `connect-src 'none'`, so a Backpack cannot make any network request. That
 * policy is deliberate and stays exactly as it is. The Delegate Wave Backpack
 * therefore never talks to 127.0.0.1 itself; it asks Papers, and Papers asks
 * delegate-wave.
 *
 * What the renderer never receives:
 *
 *   - the bearer token
 *   - a URL, a path, or an HTTP method
 *   - a generic networking capability
 *   - any way to name an operation that is not in OPERATIONS below
 *
 * This is not a proxy. `request(method, path, body)` would hand network authority
 * to page code wearing a different hat. Only the enumerated semantic operations
 * exist, each pinned to one route and one method here in main.
 *
 * Authority: Papers holds delegate-wave's OPERATOR credential, so this seam can
 * ultimately cause a repository integration. The containment is not "Backpacks
 * are limited" — it is that exactly one bound Backpack id reaches exactly these
 * operations, and a Backpack cannot grant itself membership.
 */

export type DelegateWaveOperation =
  | 'organization.get'
  | 'organization.change'
  | 'overview'
  | 'briefing'
  | 'attention'
  | 'job'
  | 'propose'
  | 'authorize'
  | 'integration'
  | 'approve'
  | 'decline'
  | 'session.list'
  | 'session.timeline';

export interface DelegateWaveResult {
  ok: boolean;
  /** Typed, page-safe failure. Never carries a URL, token or stack. */
  code?: string;
  message?: string;
  result?: unknown;
}

interface OperationSpec {
  method: 'GET' | 'POST';
  /** Fixed route template. Only the named params below may be interpolated. */
  path: (params: Record<string, string>) => string;
  /** Path parameters this operation requires, each a bounded opaque id. */
  pathParams: readonly string[];
  /** Body fields this operation may forward, and how each is validated. */
  body?: Readonly<Record<string, (value: unknown) => unknown>>;
  /** Optional bounded query fields. Undefined values are omitted. */
  query?: Readonly<Record<string, (value: unknown) => string | undefined>>;
  /** A mutation needs an X-Request-ID so a retry cannot execute twice. */
  mutation: boolean;
}

const MAX_ID = 256;
const MAX_GOAL = 4_000;

function boundedId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) {
    throw new RelayInputError('an identifier is required');
  }
  // Ids are opaque to Papers, but they are interpolated into a path, so the
  // shape is constrained rather than trusted. delegate-wave ids are
  // prefix_uuid; anything outside this alphabet cannot traverse or inject.
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new RelayInputError('an identifier contains unsupported characters');
  return value;
}

function boundedText(max: number) {
  return (value: unknown): string => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
      throw new RelayInputError(`a non-empty string of at most ${max} characters is required`);
    }
    return value;
  };
}

function optionalPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RelayInputError('a positive number is required');
  }
  return value;
}

function strategy(value: unknown): string {
  if (value === null || value === undefined) return 'direct';
  if (value !== 'direct' && value !== 'managed') throw new RelayInputError('strategy must be direct or managed');
  return value;
}

function optionalText(max: number) {
  return (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string' || value.length > max) throw new RelayInputError('invalid text');
    return value;
  };
}

function optionalBoundedId(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return boundedId(value);
}

function optionalSpanId(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_ID || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new RelayInputError('process span identifier is invalid');
  }
  return value;
}

function optionalPageLimit(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) throw new RelayInputError('page limit is invalid');
  return String(parsed);
}

export class RelayInputError extends Error {}

/**
 * The complete surface. Adding a row here widens what the Delegate Wave Backpack
 * can do and is a deliberate act; nothing else in this file needs to change to
 * keep the boundary, and nothing outside it can add a row at runtime.
 *
 * Note what is absent: no project creation, no job creation, no reconcile, no
 * backup, no restore, no rollback, no retire, no cancel. Those exist in the
 * Control API and are deliberately not reachable from a page.
 */
const OPERATIONS: Readonly<Record<DelegateWaveOperation, OperationSpec>> = Object.freeze({
  'organization.get': { method: 'GET', path: () => '/v1/wave-organization', pathParams: [], mutation: false },
  'organization.change': {
    method: 'POST', path: () => '/v1/wave-organization', pathParams: [], mutation: true,
    body: {
      action: (value) => {
        if (typeof value !== 'string' || !['rename','move','archive','restore','delete','group.create','group.rename','group.delete'].includes(value)) throw new RelayInputError('Unknown organization action');
        return value;
      },
      sessionId: optionalBoundedId,
      groupId: (value) => value == null ? null : optionalSpanId(value),
      name: optionalText(240),
      confirm: (value) => value === true,
    },
  },
  'session.list': {
    method: 'GET', path: () => '/v1/sessions', pathParams: [], mutation: false,
    query: { cursor: optionalBoundedId, limit: optionalPageLimit },
  },
  'session.timeline': {
    method: 'GET', path: (p) => `/v1/sessions/${encodeURIComponent(p['sessionId']!)}/timeline`,
    pathParams: ['sessionId'], mutation: false,
    query: { streamSpanId: optionalSpanId, before: optionalBoundedId, limit: optionalPageLimit },
  },
  overview: { method: 'GET', path: () => '/v1/overview', pathParams: [], mutation: false },
  briefing: { method: 'GET', path: () => '/v1/briefing', pathParams: [], mutation: false },
  attention: { method: 'GET', path: () => '/v1/attention', pathParams: [], mutation: false },
  job: {
    method: 'GET',
    path: (p) => `/v1/jobs/${encodeURIComponent(p['jobId']!)}`,
    pathParams: ['jobId'],
    mutation: false,
  },
  integration: {
    method: 'GET',
    path: (p) => `/v1/proposals/${encodeURIComponent(p['proposalId']!)}`,
    pathParams: ['proposalId'],
    mutation: false,
  },
  propose: {
    method: 'POST',
    path: () => '/v1/work/proposals',
    pathParams: [],
    // No principal or origin. delegate-wave derives identity from the
    // authenticated credential and rejects identity fields in a request body,
    // so forwarding one from a page would be both useless and a lie.
    body: {
      projectId: boundedId,
      goal: boundedText(MAX_GOAL),
      strategy,
      maximumCost: optionalPositiveNumber,
      idempotencyKey: boundedId,
    },
    mutation: true,
  },
  authorize: {
    method: 'POST',
    path: (p) => `/v1/work/proposals/${encodeURIComponent(p['proposalId']!)}/authorize`,
    pathParams: ['proposalId'],
    mutation: true,
  },
  approve: {
    method: 'POST',
    path: (p) => `/v1/proposals/${encodeURIComponent(p['proposalId']!)}/approve`,
    pathParams: ['proposalId'],
    mutation: true,
  },
  decline: {
    method: 'POST',
    path: (p) => `/v1/proposals/${encodeURIComponent(p['proposalId']!)}/decline`,
    pathParams: ['proposalId'],
    body: { reason: optionalText(1_000) },
    mutation: true,
  },
});

export function isDelegateWaveOperation(value: unknown): value is DelegateWaveOperation {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OPERATIONS, value);
}

export interface DelegateWaveConfig {
  /** Reads process.env in production; injected in tests. */
  readonly url: string | undefined;
  readonly token: string | undefined;
  /** The one Backpack id permitted to use this seam. */
  readonly backpackId: string | undefined;
}

export function readConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): DelegateWaveConfig {
  return {
    // delegate-wave's own ControlClient default, not a second configuration
    // scheme invented here.
    url: env['DELEGATE_WAVE_CONTROL_URL'] ?? 'http://127.0.0.1:47321',
    token: env['DELEGATE_WAVE_CONTROL_TOKEN'],
    // Pinned by the machine, never by the page. A manifest flag would let any
    // Backpack declare itself the Delegate Wave one, which is the same weakness
    // as trusting a message type.
    backpackId: env['DELEGATE_WAVE_BACKPACK_ID'],
  };
}

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class DelegateWaveRelay {
  /**
   * Request ids already issued, keyed by the caller's idempotency intent, so a
   * retry of an uncertain mutation reuses its id rather than minting a second
   * one. delegate-wave persists request intent and result precisely so a repeat
   * cannot execute a second operation -- reusing the id is what makes that
   * protection reachable.
   */
  private readonly issuedRequestIds = new Map<string, string>();

  constructor(
    private readonly config: DelegateWaveConfig,
    private readonly fetchImpl: FetchLike,
    private readonly newRequestId: () => string,
  ) {}

  /**
   * The single entry point. `backpackId` is supplied by the preload from the
   * page ORIGIN, never from page data.
   */
  async call(backpackId: string, operation: unknown, params: unknown): Promise<DelegateWaveResult> {
    if (!this.config.backpackId) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Delegate Wave is not configured on this machine.' };
    }
    if (typeof backpackId !== 'string' || backpackId !== this.config.backpackId) {
      // Any other embedded page emitting this message type lands here. The
      // refusal does not disclose whether a Delegate Wave binding exists.
      return { ok: false, code: 'NOT_PERMITTED', message: 'This Backpack may not use Delegate Wave.' };
    }
    if (!isDelegateWaveOperation(operation)) {
      return { ok: false, code: 'UNKNOWN_OPERATION', message: 'That Delegate Wave operation does not exist.' };
    }
    if (!this.config.token) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Delegate Wave is not configured on this machine.' };
    }

    const spec = OPERATIONS[operation];
    const supplied = (params && typeof params === 'object' && !Array.isArray(params))
      ? params as Record<string, unknown>
      : {};

    let path: string;
    let body: Record<string, unknown> | undefined;
    try {
      const pathParams: Record<string, string> = {};
      for (const name of spec.pathParams) pathParams[name] = boundedId(supplied[name]);
      path = spec.path(pathParams);
      if (spec.query) {
        const query = new URLSearchParams();
        for (const [field, parse] of Object.entries(spec.query)) {
          const value = parse(supplied[field]);
          if (value !== undefined) query.set(field, value);
        }
        const serialized = query.toString();
        if (serialized) path += `?${serialized}`;
      }

      if (spec.body) {
        body = {};
        for (const [field, parse] of Object.entries(spec.body)) body[field] = parse(supplied[field]);
      }
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: error instanceof RelayInputError ? error.message : 'The request was malformed.',
      };
    }

    const headers: Record<string, string> = { authorization: `Bearer ${this.config.token}` };
    if (body) headers['content-type'] = 'application/json';
    if (spec.mutation) {
      // One id per logical mutation. A repeat of the same intent reuses it, so
      // delegate-wave recognises the retry instead of performing a second
      // operation.
      const intentKey = `${operation}:${JSON.stringify(body ?? {})}:${JSON.stringify(supplied['proposalId'] ?? null)}`;
      let requestId = this.issuedRequestIds.get(intentKey);
      if (!requestId) {
        requestId = this.newRequestId();
        this.issuedRequestIds.set(intentKey, requestId);
      }
      headers['x-request-id'] = requestId;
    }

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`${this.config.url!.replace(/\/$/, '')}${path}`, {
        method: spec.method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // The URL is deliberately absent from the message: the page has no
      // business learning where delegate-wave listens.
      return { ok: false, code: 'UNAVAILABLE', message: 'Delegate Wave is not responding on this machine.' };
    }

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      return { ok: false, code: 'INVALID_RESPONSE', message: 'Delegate Wave returned an unreadable response.' };
    }

    const record = (envelope && typeof envelope === 'object') ? envelope as Record<string, unknown> : {};
    if (!response.ok || record['ok'] !== true) {
      const error = (record['error'] && typeof record['error'] === 'object')
        ? record['error'] as Record<string, unknown>
        : {};
      return {
        ok: false,
        code: typeof error['code'] === 'string' ? error['code'] : 'REQUEST_FAILED',
        message: typeof error['message'] === 'string' ? error['message'] : 'Delegate Wave refused the request.',
      };
    }
    return { ok: true, result: record['result'] };
  }
}
