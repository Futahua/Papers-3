/**
 * The local-service bridge: a backpack project page reaching an HTTP service the
 * creator runs on this machine.
 *
 * WHY IT HAS TO EXIST, MEASURED AGAINST A REAL PAPERS
 * A project page is served from `papers-backpack://<projectId>`, which Chromium
 * treats as an opaque, non-http origin. Two layers refuse, in this order:
 *
 *   1. `connect-src 'none'` on every asset the host serves. This refuses the
 *      connection BEFORE the network layer: nothing is sent, and the page sees
 *      `TypeError: Failed to fetch`. Measured with a listener on loopback that
 *      received zero requests.
 *   2. With that relaxed, the request IS sent and carries
 *      `Origin: papers-backpack://<projectId>` - measured, not assumed. No
 *      ordinary service allows that origin, so the response is then blocked by
 *      CORS.
 *
 * Neither layer can carry a credential, and a page cannot read a token file. So
 * the request is made from the MAIN process, where there is no page origin to
 * police and no CSP, and the project's own declared credential is attached here.
 *
 * WHAT THIS IS NOT
 * It is not a hole for one project. Nothing in this file or its callers knows any
 * project's name, port, or protocol: the project ships a declaration, the host
 * enforces it, and the credential is a file the project names. Any backpack
 * project can use it.
 *
 * THE PROPERTY THAT MUST SURVIVE
 * The service still validates the credential. This bridge does not authenticate
 * anything itself and does not soften a refusal: a 401 from the service is passed
 * back to the page as a 401. The only failure this bridge invents is its OWN -
 * "the service is not running", "the credential could not be read" - and those
 * must be reported as failures so the caller's honest banner still appears.
 *
 * Loopback only. A declaration is not a permission to leave the machine.
 */

import * as fs from 'node:fs';

/** The file a project ships to declare the local services it may reach. */
export const LOCAL_SERVICE_DECLARATION_FILE = 'local-service.json';

export const LOCAL_SERVICE_SCHEMA_VERSION = 1;
/** Bounded so a declaration cannot become an unbounded surface. */
export const MAX_DECLARED_SERVICES = 8;
export const MAX_DECLARED_SECRETS = 8;

export interface DeclaredService {
  /** Scheme + host + port, e.g. `http://127.0.0.1:4181`. No path. */
  origin: string;
  /** The id of a declared secret to attach, if the service wants one. */
  secret?: string;
}

export interface DeclaredSecret {
  id: string;
  /**
   * Path to the file holding the credential.
   *
   * A DECLARATION IS PROJECT-AUTHORED INPUT, so this is not a trustworthy source
   * of host paths: it is confined to the roots the host approves (the project's
   * own tree, and the host's per-project config directory). See
   * `readSecretWithinRoots`.
   */
  file: string;
  /** Header to attach it to. Defaults to `authorization`. */
  header?: string;
  /** Value prefix, e.g. `Bearer`. */
  scheme?: string;
}

export interface LocalServiceDeclaration {
  schemaVersion: number;
  services: DeclaredService[];
  secrets?: DeclaredSecret[];
}

export interface LocalServiceRequest {
  url: string;
  method?: string;
  /** Page-supplied headers. Never trusted for credentials. */
  headers?: Record<string, string>;
  body?: string | null;
}

export interface LocalServiceResponse {
  ok: boolean;
  /** Present only when ok: the service's own status. */
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Present only when !ok: why the BRIDGE could not complete the request. */
  detail?: string;
}

export interface LocalServiceBridgeDependencies {
  /** The project's declaration, or null when it ships none. */
  declaration: LocalServiceDeclaration | null;
  /**
   * The ONLY directories a declared credential file may live in.
   *
   * The host computes these - the project's own root, and the host's per-project
   * config directory - so a declaration cannot reach a file the project has no
   * business reading. An EMPTY list approves nothing: an omitted scope must
   * never come to mean "anywhere", which is exactly the bug this closes.
   */
  secretRoots: readonly string[];
  /** Read a declared credential file. Returns null when it cannot be read. */
  readSecretFile(file: string): string | null;
  /**
   * Perform ONE request and hand back its response WHATEVER it is, including a
   * redirect. The redirect policy lives in this bridge, so the transport must not
   * follow on its own - pass `redirect: 'manual'`.
   */
  performRequest(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
    redirect: 'manual';
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  report?(report: { outcome: string; detail: string }): void;
}

export interface LocalServiceBridge {
  fetch(request: LocalServiceRequest): Promise<LocalServiceResponse>;
}

/** Methods a page may use. TRACE/TRACK/CONNECT are not among them. */
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Headers a page may set. Credential-bearing ones are deliberately absent. */
const ALLOWED_REQUEST_HEADERS = new Set(['content-type', 'accept', 'last-event-id', 'cache-control']);

/** Response headers that are safe and useful to hand back. */
const ALLOWED_RESPONSE_HEADERS = new Set(['content-type', 'cache-control', 'etag', 'last-modified']);

/**
 * Loopback only, and strict about it: `127.0.0.0/8`, `::1`, and the literal name
 * `localhost`. Deliberately NOT `0.0.0.0` (a bind address, not a destination) and
 * not link-local.
 */
export function isLoopbackHost(host: string): boolean {
  if (typeof host !== 'string' || host.length === 0) return false;
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const parts = normalized.split('.');
  if (parts.length !== 4) return false;
  if (parts[0] !== '127') return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

/** The most redirects this bridge will follow before refusing a chain. */
export const MAX_REDIRECT_HOPS = 5;

/** 3xx answers that carry a Location this bridge must judge for itself. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The Location of a redirect answer, whatever case the service spelled it in. */
function locationOf(headers: Record<string, string>): string | null {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'location') continue;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Resolve a Location against the hop it came from, so a relative redirect stays
 * on the service that sent it. A relative Location must never be read as an
 * absolute destination.
 */
function resolveTarget(location: string, from: string): URL | null {
  try {
    return new URL(location, from);
  } catch {
    return null;
  }
}

/** 303 always drops the body; 301/302 do so for POST, by the usual idiom. */
function hopDropsBody(status: number, method: string): boolean {
  if (status === 303) return method !== 'HEAD' && method !== 'GET';
  if (status === 301 || status === 302) return method === 'POST';
  return false;
}

/** Does this path name a FILE inside one of the approved roots? */
function isInsideAnyRoot(file: string, roots: readonly string[]): boolean {
  const normalized = normalizeForComparison(file);
  if (normalized.length === 0) return false;
  return roots.some((root) => {
    const candidate = normalizeForComparison(root);
    if (candidate.length === 0) return false;
    // Strictly INSIDE: the root itself is a directory, and a credential is a
    // file. Equal paths are not a file in the scope, they are the scope.
    return normalized.startsWith(`${candidate}/`);
  });
}

/**
 * Fold separators and `.`/`..` segments so the comparison is about where the path
 * actually points.
 *
 * Deliberately LEXICAL: it does not touch the filesystem. The threat here is a
 * declaration naming a path OUTSIDE the project's scope - an absolute path to
 * somebody's credentials file - and string containment answers that. Following
 * symlinks would add filesystem races to a check whose whole job is to be decided
 * before any file is touched.
 */
function normalizeForComparison(input: string): string {
  if (typeof input !== 'string') return '';
  const unified = input.replace(/\\/g, '/');
  const isUnc = unified.startsWith('//');
  const isAbsolute = unified.startsWith('/');
  const segments = unified.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // A traversal above the root leaves nothing to resolve against, so the path
      // cannot be inside any root.
      if (out.length === 0) return '';
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) return '';
  const body = out.join('/');
  // A drive letter survives in `body` (`c:/a` vs `d:/a`), so two volumes cannot
  // collide; the whole comparison is lowercased because Windows paths are.
  if (isUnc) return `//${body.toLowerCase()}`;
  return (isAbsolute ? `/${body}` : body).toLowerCase();
}

/**
 * Read a declared credential ONLY from inside an approved root.
 *
 * Returns why it refused, so the caller can say something true: a path outside
 * the approved scope is a different fact from a file that could not be read, and
 * the creator needs to be able to tell them apart when their own declaration is
 * wrong.
 */
export type SecretReadOutcome =
  | { ok: true; secret: string }
  | { ok: false; reason: 'outside-approved-scope' | 'unreadable' };

export function readSecretWithinRoots(
  file: string,
  roots: readonly string[],
  read: (file: string) => string | null,
): SecretReadOutcome {
  if (typeof file !== 'string' || file.length === 0) return { ok: false, reason: 'outside-approved-scope' };
  if (!Array.isArray(roots) || roots.length === 0) return { ok: false, reason: 'outside-approved-scope' };
  // Decided on the PATH, before any file is touched, so a refusal is not a probe
  // for which paths exist.
  if (!isInsideAnyRoot(file, roots)) return { ok: false, reason: 'outside-approved-scope' };
  const secret = read(file);
  if (secret === null || secret.length === 0) return { ok: false, reason: 'unreadable' };
  return { ok: true, secret };
}

function parseDeclaration(raw: unknown): LocalServiceDeclaration | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record['schemaVersion'] !== LOCAL_SERVICE_SCHEMA_VERSION) return null;
  const services = record['services'];
  if (!Array.isArray(services) || services.length === 0 || services.length > MAX_DECLARED_SERVICES) return null;
  const parsedServices: DeclaredService[] = [];
  for (const entry of services) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const service = entry as Record<string, unknown>;
    if (typeof service['origin'] !== 'string') return null;
    if (service['secret'] !== undefined && typeof service['secret'] !== 'string') return null;
    parsedServices.push({
      origin: service['origin'],
      ...(service['secret'] === undefined ? {} : { secret: service['secret'] as string }),
    });
  }
  const secrets = record['secrets'];
  const parsedSecrets: DeclaredSecret[] = [];
  if (secrets !== undefined) {
    if (!Array.isArray(secrets) || secrets.length > MAX_DECLARED_SECRETS) return null;
    for (const entry of secrets) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const secret = entry as Record<string, unknown>;
      if (typeof secret['id'] !== 'string' || typeof secret['file'] !== 'string') return null;
      if (secret['header'] !== undefined && typeof secret['header'] !== 'string') return null;
      if (secret['scheme'] !== undefined && typeof secret['scheme'] !== 'string') return null;
      parsedSecrets.push({
        id: secret['id'],
        file: secret['file'],
        ...(secret['header'] === undefined ? {} : { header: secret['header'] as string }),
        ...(secret['scheme'] === undefined ? {} : { scheme: secret['scheme'] as string }),
      });
    }
  }
  return { schemaVersion: LOCAL_SERVICE_SCHEMA_VERSION, services: parsedServices, secrets: parsedSecrets };
}

/** Read and validate a project's declaration. Exported so the caller can load
 * it from disk and hand the parsed value to the bridge. */
export function parseLocalServiceDeclaration(text: string): LocalServiceDeclaration | null {
  try {
    return parseDeclaration(JSON.parse(text));
  } catch {
    return null;
  }
}

export function createLocalServiceBridge(
  dependencies: LocalServiceBridgeDependencies,
): LocalServiceBridge {
  const emit = (outcome: string, detail: string): void => {
    dependencies.report?.({ outcome, detail });
  };

  const fail = (detail: string): LocalServiceResponse => {
    emit('bridge-refused', detail);
    return { ok: false, detail };
  };

  return {
    async fetch(request: LocalServiceRequest): Promise<LocalServiceResponse> {
      const declaration = dependencies.declaration;
      if (!declaration) {
        return fail('this project declares no local service');
      }

      let parsed: URL;
      try {
        parsed = new URL(request.url);
      } catch {
        return fail('the requested address is not a valid URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail(`the requested address uses ${parsed.protocol}, which this capability does not carry`);
      }
      if (!isLoopbackHost(parsed.hostname)) {
        // A declaration is not a permission to leave the machine.
        return fail(`${parsed.hostname} is not a loopback address; this capability reaches services on this machine only`);
      }

      const origin = parsed.origin;
      const service = declaration.services.find((candidate) => candidate.origin === origin);
      if (!service) {
        return fail(`${origin} is not declared by this project`);
      }

      const method = (request.method ?? 'GET').toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        return fail(`${method} is not a method this capability carries`);
      }

      // Page-supplied headers are filtered hard. Credentials are NEVER taken from
      // the page: a page that could set its own authorization could probe the
      // service or forge an identity, and a page cannot carry a loopback session
      // cookie anyway.
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        const lower = name.toLowerCase();
        if (!ALLOWED_REQUEST_HEADERS.has(lower)) continue;
        if (typeof value !== 'string') continue;
        headers[lower] = value;
      }
      delete headers['cookie'];
      delete headers['authorization'];

      // Held apart from the page's headers so a redirect to a DIFFERENT declared
      // origin can be given the page's headers without the project's credential.
      const credentials: Record<string, string> = {};

      if (service.secret !== undefined) {
        const declared = (declaration.secrets ?? []).find((candidate) => candidate.id === service.secret);
        if (!declared) {
          return fail(`the service needs the credential "${service.secret}", which this project does not declare`);
        }
        // Confined to the roots the host approves. A declaration that names a path
        // outside them is refused WITHOUT reading it.
        const outcome = readSecretWithinRoots(declared.file, dependencies.secretRoots, dependencies.readSecretFile);
        if (!outcome.ok) {
          // Two different facts, said differently. A path outside the approved
          // scope means the DECLARATION is wrong and the creator can fix it; an
          // unreadable file means the file is missing or unreadable. Neither
          // outcome sends the request: an unauthenticated request would be refused
          // by the service anyway, and sending one would let the bridge pretend it
          // had done its job.
          return fail(outcome.reason === 'outside-approved-scope'
            ? 'the credential this service needs is declared outside the project\'s approved scope'
            : 'the credential this service needs could not be read');
        }
        const header = (declared.header ?? 'authorization').toLowerCase();
        credentials[header] = declared.scheme ? `${declared.scheme} ${outcome.secret}` : outcome.secret;
      }

      // Follow redirects HERE, so every hop is judged by the same rules as the
      // request the creator's page asked for. `net.fetch` follows by default,
      // which would send this machine to a destination nothing validated.
      let currentUrl = request.url;
      let currentMethod = method;
      let currentBody = typeof request.body === 'string' ? request.body : null;
      let response: { status: number; headers: Record<string, string>; body: string };
      for (let hop = 0; ; hop += 1) {
        // Credentials apply to the origin the project declared for, and nowhere
        // else: a permitted hop to another declared service must not receive them.
        const hopHeaders = new URL(currentUrl).origin === origin
          ? { ...headers, ...credentials }
          : { ...headers };
        try {
          response = await dependencies.performRequest({
            url: currentUrl,
            method: currentMethod,
            headers: hopHeaders,
            body: currentBody,
            redirect: 'manual',
          });
        } catch (error) {
          // The bridge's OWN failure - the service is not running, DNS failed, the
          // socket was refused. This must be a failure so the caller's honest
          // banner still appears.
          return fail(`the service could not be reached: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (!REDIRECT_STATUSES.has(response.status)) break;

        const location = locationOf(response.headers);
        if (location === null) {
          // A redirect with nowhere to go is a broken answer, not a destination.
          return fail(`the service answered ${response.status} without a location to follow`);
        }
        if (hop >= MAX_REDIRECT_HOPS) {
          return fail(`the service redirected more than ${MAX_REDIRECT_HOPS} times; this bridge stops following`);
        }

        const target = resolveTarget(location, currentUrl);
        if (target === null) {
          return fail(`the service redirected to "${location}", which is not a valid URL`);
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return fail(`the service redirected to ${target.protocol}, which this capability does not carry`);
        }
        if (!isLoopbackHost(target.hostname)) {
          // THE FIX: the initial-URL check is not enough. This is the same rule
          // applied to the hop, so a loopback service cannot send the machine
          // anywhere the project did not declare.
          return fail(`${target.hostname} is not a loopback address; this capability reaches services on this machine only`);
        }
        if (!declaration.services.some((candidate) => candidate.origin === target.origin)) {
          return fail(`${target.origin} is not declared by this project`);
        }

        emit('redirect-followed', `${response.status} ${currentUrl} -> ${target.toString()}`);
        // A 303, and the POST-to-GET idiom of 301/302, drop the body; 307 and 308
        // are defined to preserve both method and body.
        currentBody = hopDropsBody(response.status, currentMethod) ? null : currentBody;
        currentMethod = hopDropsBody(response.status, currentMethod) ? 'GET' : currentMethod;
        currentUrl = target.toString();
      }

      // The service's own answer, passed through untouched. A 401 stays a 401:
      // the service does the refusing, and its refusal is the honest one.
      const safeHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers ?? {})) {
        if (ALLOWED_RESPONSE_HEADERS.has(name.toLowerCase())) safeHeaders[name.toLowerCase()] = value;
      }
      emit('proxied', `${method} ${origin}${parsed.pathname} -> ${response.status}`);
      return { ok: true, status: response.status, headers: safeHeaders, body: response.body };
    },
  };
}

/** Load a project's declaration from its root. Absent or invalid is null, never
 * a guess. */
export function loadLocalServiceDeclaration(root: string): LocalServiceDeclaration | null {
  try {
    const text = fs.readFileSync(`${root}/${LOCAL_SERVICE_DECLARATION_FILE}`, 'utf8');
    return parseLocalServiceDeclaration(text);
  } catch {
    return null;
  }
}
