import { describe, expect, it } from 'vitest';

import {
  LOCAL_SERVICE_DECLARATION_FILE,
  createLocalServiceBridge,
  isLoopbackHost,
  type LocalServiceBridgeDependencies,
} from '../../src/main/backpacks/localServiceBridge';

/**
 * A backpack project page is served from `papers-backpack://<projectId>`, which
 * Chromium treats as an opaque, non-http origin. Measured against a real Papers:
 *
 *   - `connect-src 'none'` refuses EVERY connection before the network layer, so
 *     the request is never sent and the page sees `TypeError: Failed to fetch`;
 *   - with that relaxed, the request IS sent and carries
 *     `Origin: papers-backpack://<projectId>`, which no ordinary service allows,
 *     so it then dies on CORS.
 *
 * This bridge is the honest carrier for the credential neither of those can
 * carry: it makes the request from the main process, where there is no page
 * origin to police and no CSP, and it attaches the project's own declared
 * credential. The service still validates that credential, so a missing or wrong
 * one still refuses - which is the property that must survive.
 */
function harness(overrides: Partial<LocalServiceBridgeDependencies> = {}) {
  const reads: string[] = [];
  const requests: Array<{ url: string; method: string; body: string | null; headers: Record<string, string>; redirect: string }> = [];
  const reports: Array<{ outcome: string; detail: string }> = [];
  const deps: LocalServiceBridgeDependencies = {
    // A declaration the project ships. The host reads it and enforces it; it
    // never contains anything the host understands. `secret` names which
    // declared credential the service wants - a service with no `secret` is
    // reached with no credential at all.
    declaration: {
      schemaVersion: 1,
      services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
      secrets: [{ id: 'operator', file: 'C:\\data\\token', header: 'authorization', scheme: 'Bearer' }],
    },
    // The scopes the host approves for credential files. `C:\data` here so the
    // default declaration's credential is inside one; the scope tests replace it.
    secretRoots: ['C:\\data'],
    readSecretFile: (file) => { reads.push(file); return 'THE-TOKEN'; },
    performRequest: async (request) => {
      requests.push(request);
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      };
    },
    report: (report) => { reports.push(report); },
    ...overrides,
  };
  return { deps, reads, requests, reports };
}

describe('loopback classification', () => {
  it('accepts only loopback hosts', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', '127.0.0.2', '127.1.2.3']) {
      expect(isLoopbackHost(host), `${host} should be loopback`).toBe(true);
    }
    for (const host of ['example.com', '10.0.0.5', '192.168.1.10', '0.0.0.0', '169.254.1.1', '']) {
      expect(isLoopbackHost(host), `${host} should NOT be loopback`).toBe(false);
    }
  });
});

describe('the bridge refuses anything the project did not declare', () => {
  it('refuses an origin that is not in the project declaration', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:9999/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not declared');
    expect(h.requests).toHaveLength(0);
  });

  it('refuses a non-loopback origin even when the project declares it', async () => {
    // A declaration is not a permission to leave the machine. This capability
    // reaches services ON THIS MACHINE, and nothing else.
    const h = harness({
      declaration: { schemaVersion: 1, services: [{ origin: 'http://example.com' }] },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://example.com/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('loopback');
    expect(h.requests).toHaveLength(0);
  });

  it('refuses a malformed URL rather than guessing', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    for (const url of ['', 'not a url', 'file:///etc/passwd', 'papers-backpack://x/y']) {
      const result = await bridge.fetch({ url });
      expect(result.ok, `${url} must be refused`).toBe(false);
    }
    expect(h.requests).toHaveLength(0);
  });

  it('refuses when the project declares nothing at all', async () => {
    const h = harness({ declaration: null });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('declares no local service');
  });
});

describe('credentials', () => {
  it('reads the declared secret and attaches it to the request', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(true);
    expect(h.reads).toEqual(['C:\\data\\token']);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]?.headers['authorization']).toBe('Bearer THE-TOKEN');
  });

  it('does NOT leak the secret to the page', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    // The response the page receives is the service's response, and nothing else.
    // The credential never becomes readable by page script.
    expect(JSON.stringify(result)).not.toContain('THE-TOKEN');
    expect(result.headers?.['authorization']).toBeUndefined();
  });

  it('strips any authorization the PAGE tried to set, so a page cannot forge or probe', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    await bridge.fetch({
      url: 'http://127.0.0.1:4181/v1/snapshot',
      headers: { authorization: 'Bearer PAGE-SUPPLIED', cookie: 'session=stolen' },
    });

    expect(h.requests[0]?.headers['authorization']).toBe('Bearer THE-TOKEN');
    expect(h.requests[0]?.headers['cookie']).toBeUndefined();
  });

  it('strips page-supplied cookies, because a page cannot carry a session to a loopback origin', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    await bridge.fetch({
      url: 'http://127.0.0.1:4181/v1/snapshot',
      headers: { Cookie: 'proxima_session=abc' },
    });

    expect(h.requests[0]?.headers['cookie']).toBeUndefined();
  });

  it('sends no credential when the declaration names none', async () => {
    const h = harness({
      declaration: { schemaVersion: 1, services: [{ origin: 'http://127.0.0.1:4181' }] },
    });
    const bridge = createLocalServiceBridge(h.deps);
    await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/health' });

    expect(h.requests[0]?.headers['authorization']).toBeUndefined();
    expect(h.reads).toHaveLength(0);
  });

  it('reports honestly when the declared secret file cannot be read', async () => {
    const h = harness({ readSecretFile: () => null });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('credential');
    // The request must NOT be sent unauthenticated: a silently unauthenticated
    // request would be refused by the service anyway, but sending one pretends
    // the bridge did its job.
    expect(h.requests).toHaveLength(0);
  });
});

describe('honest failure', () => {
  it('surfaces a refused connection as a failure so the caller can be honest', async () => {
    const h = harness({
      performRequest: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:4181'); },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('passes a service REFUSAL through as a real response, not as a bridge failure', async () => {
    // 401 is the service doing its job. The bridge must not turn it into an
    // exception, and must not hide it: the page needs to see that it was refused.
    const h = harness({
      performRequest: async () => ({
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":false,"code":"UNAUTHORISED"}',
      }),
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(401);
    expect(result.body).toContain('UNAUTHORISED');
  });

  it('never reports success for a request it did not send', async () => {
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot', method: 'TRACE' });

    expect(result.ok).toBe(false);
    expect(h.requests).toHaveLength(0);
  });
});

describe('the declaration file name', () => {
  it('is named for what it is, not for any particular project', () => {
    expect(LOCAL_SERVICE_DECLARATION_FILE).toBe('local-service.json');
  });
});

/**
 * BLOCKER 1: an initial-URL-only loopback check is not a loopback check.
 *
 * A declared, loopback, running service can answer a request with a 302 whose
 * Location is anywhere. If the transport follows redirects on its own, the
 * machine makes an outbound request that this bridge never validated - the
 * check passed, and the traffic still left. Measured against a real Electron:
 * `net.fetch` follows by default, so the fix cannot be the loopback test alone.
 */
describe('a redirect target is revalidated as if it were the initial request', () => {
  it('never follows a redirect off loopback - the transport is told not to chase', async () => {
    // MEASURED, against a real Electron: `net.fetch` with `redirect: 'manual'`
    // THROWS 'Redirect was cancelled' rather than handing back the 3xx. So the
    // redirect is not chased AND its Location is never read here. The security
    // property - this machine never goes where the project did not declare -
    // holds, and is proven end to end in the merged e2e, where a real undeclared
    // loopback service receives nothing at all.
    const h = harness({
      performRequest: async (request) => {
        h.requests.push(request);
        throw new Error('Redirect was cancelled');
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    // Refused, as a service the bridge could not complete a request against.
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('could not be reached');
    // Exactly one request, and the transport was told to hand redirects back.
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.redirect).toBe('manual');
  });

  it('refuses a redirect rather than passing it on or chasing it', async () => {
    // The conservative half of the rule, and the one actually measured: a 3xx
    // that reaches the bridge is refused outright, so no Location is ever acted
    // on. The bridge has no code path that issues a second request.
    const h = harness({
      performRequest: async (request) => {
        h.requests.push(request);
        return {
          status: 302,
          headers: { location: 'http://127.0.0.1:4199/elsewhere' } as Record<string, string>,
          body: '',
        };
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    // Refused for the hop's own reason: the target origin is not declared. The
    // bridge judges the Location it received rather than acting on it blindly.
    expect(result.detail).toContain('not declared by this project');
    // NOT chased: one request, never two.
    expect(h.requests).toHaveLength(1);
  });

  it('refuses a redirect chain instead of following it forever', async () => {
    const h = harness({
      performRequest: async (request) => {
        h.requests.push(request);
        return { status: 302, headers: { location: '/again' } as Record<string, string>, body: '' };
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail?.toLowerCase()).toContain('redirect');
    // Bounded: a loop must terminate, and must not spin.
    expect(h.requests.length).toBeLessThanOrEqual(6);
  });

  it('asks the transport not to follow redirects itself', async () => {
    // The policy can only be enforced here if the transport hands the 3xx back.
    // `net.fetch` follows by default, so this is a real requirement, not a hint.
    const h = harness();
    const bridge = createLocalServiceBridge(h.deps);
    await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(h.requests[0]!.redirect).toBe('manual');
  });
});

/**
 * BLOCKER 2: a declaration must not be able to name any file on the machine.
 *
 * `secrets[].file` was an unvalidated absolute path handed straight to the
 * reader, so a project could declare `C:\Users\...\credentials` or any other
 * readable file and have its contents attached to a request. The declaration is
 * project-authored input, so it is not a trustworthy source of host paths.
 */
describe('a declared credential file must live in an approved scope', () => {
  const roots = ['C:\\projects\\demo', 'C:\\PapersData\\backpacks\\bp-1'];

  it('reads a credential inside the project root', async () => {
    const h = harness({
      secretRoots: roots,
      declaration: {
        schemaVersion: 1,
        services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
        secrets: [{ id: 'operator', file: 'C:\\projects\\demo\\token', scheme: 'Bearer' }],
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(true);
    expect(h.reads).toEqual(['C:\\projects\\demo\\token']);
  });

  it('reads a credential in the per-project host config directory', async () => {
    // The host's established per-project area, so a credential that must not sit
    // in the project's own tree still has an approved home.
    const h = harness({
      secretRoots: roots,
      declaration: {
        schemaVersion: 1,
        services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
        secrets: [{ id: 'operator', file: 'C:\\PapersData\\backpacks\\bp-1\\token', scheme: 'Bearer' }],
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(true);
    expect(h.reads).toHaveLength(1);
  });

  it('refuses an absolute path outside every approved root, and reads nothing', async () => {
    const h = harness({
      secretRoots: roots,
      declaration: {
        schemaVersion: 1,
        services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
        secrets: [{ id: 'operator', file: 'C:\\Users\\someone\\.ssh\\id_rsa', scheme: 'Bearer' }],
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('approved');
    // NOTHING was read, and NOTHING was sent.
    expect(h.reads).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });

  it.each([
    ['a parent traversal out of the root', 'C:\\projects\\demo\\..\\..\\secrets.txt'],
    ['a sibling directory sharing a name prefix', 'C:\\projects\\demo-evil\\token'],
    ['the root itself', 'C:\\projects\\demo'],
    ['a UNC path', '\\\\server\\share\\token'],
  ])('refuses %s', async (_label, file) => {
    const h = harness({
      secretRoots: roots,
      declaration: {
        schemaVersion: 1,
        services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
        secrets: [{ id: 'operator', file, scheme: 'Bearer' }],
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(h.reads).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });

  it('refuses every credential when the host approves no scope at all', async () => {
    // Fail-closed: a caller that does not say where credentials may live gets no
    // credentials read. An omitted scope must not mean "anywhere".
    const h = harness({
      secretRoots: [],
      declaration: {
        schemaVersion: 1,
        services: [{ origin: 'http://127.0.0.1:4181', secret: 'operator' }],
        secrets: [{ id: 'operator', file: 'C:\\projects\\demo\\token', scheme: 'Bearer' }],
      },
    });
    const bridge = createLocalServiceBridge(h.deps);
    const result = await bridge.fetch({ url: 'http://127.0.0.1:4181/v1/snapshot' });

    expect(result.ok).toBe(false);
    expect(h.reads).toHaveLength(0);
  });
});
