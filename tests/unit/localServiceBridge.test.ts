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
  const requests: Array<{ url: string; method: string; body: string | null; headers: Record<string, string> }> = [];
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
