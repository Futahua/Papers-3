import { describe, expect, it } from 'vitest';

import {
  DelegateWaveRelay,
  isDelegateWaveOperation,
  readConfigFromEnvironment,
  type DelegateWaveConfig,
} from '../../src/main/delegateWave/delegateWaveRelay';

const BOUND = 'bp-11111111-2222-3333-4444-555555555555';
const OTHER = 'bp-99999999-8888-7777-6666-555555555555';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function relay(overrides: Partial<DelegateWaveConfig> = {}, respond?: () => unknown) {
  const captured: Captured[] = [];
  let requestIdCounter = 0;
  const config: DelegateWaveConfig = {
    url: 'http://127.0.0.1:47321',
    token: 'operator-secret-token',
    backpackId: BOUND,
    ...overrides,
  };
  const instance = new DelegateWaveRelay(
    config,
    async (url, init) => {
      captured.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
      return {
        ok: true,
        status: 200,
        json: async () => respond?.() ?? { ok: true, result: { totals: { projects: 2 } } },
      };
    },
    () => `req-${++requestIdCounter}`,
  );
  return { instance, captured };
}

describe('DelegateWaveRelay', () => {
  it('relays a read operation to its fixed route with the bearer token', async () => {
    const { instance, captured } = relay();
    const result = await instance.call(BOUND, 'overview', {});

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ totals: { projects: 2 } });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('http://127.0.0.1:47321/v1/overview');
    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.headers['authorization']).toBe('Bearer operator-secret-token');
    // A read carries no mutation identity.
    expect(captured[0]!.headers['x-request-id']).toBeUndefined();
  });

  it('refuses any Backpack that is not the bound one', async () => {
    // The whole containment. Another embedded page can emit the same message
    // type; identity comes from the page origin and is checked here.
    const { instance, captured } = relay();
    const result = await instance.call(OTHER, 'overview', {});

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_PERMITTED');
    expect(captured).toHaveLength(0);
  });

  it('never lets an unknown operation reach the network', async () => {
    const { instance, captured } = relay();
    for (const operation of ['request', 'reconcile', 'backup.restore', '/v1/jobs', '', null, 42]) {
      const result = await instance.call(BOUND, operation, { path: '/v1/anything' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNKNOWN_OPERATION');
    }
    expect(captured).toHaveLength(0);
  });

  it('exposes no generic request operation at all', () => {
    // If this ever becomes true, the seam has stopped being a relay.
    expect(isDelegateWaveOperation('request')).toBe(false);
    expect(isDelegateWaveOperation('proxy')).toBe(false);
    expect(isDelegateWaveOperation('overview')).toBe(true);
  });

  it('reports NOT_CONFIGURED without leaking whether a binding exists', async () => {
    const noToken = relay({ token: undefined });
    const missing = await noToken.instance.call(BOUND, 'overview', {});
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('NOT_CONFIGURED');
    expect(noToken.captured).toHaveLength(0);

    const unbound = relay({ backpackId: undefined });
    const unconfigured = await unbound.instance.call(BOUND, 'overview', {});
    expect(unconfigured.code).toBe('NOT_CONFIGURED');
  });

  it('gives every mutation a request id and reuses it on a retry', async () => {
    // delegate-wave persists mutation intent and result so a repeat cannot
    // execute twice. Minting a fresh id per retry would defeat exactly that.
    const { instance, captured } = relay(undefined, () => ({ ok: true, result: { id: 'wprop_1' } }));

    await instance.call(BOUND, 'approve', { proposalId: 'prop_abc' });
    await instance.call(BOUND, 'approve', { proposalId: 'prop_abc' });

    expect(captured).toHaveLength(2);
    expect(captured[0]!.headers['x-request-id']).toBeDefined();
    expect(captured[1]!.headers['x-request-id']).toBe(captured[0]!.headers['x-request-id']);
  });

  it('gives different mutations different request ids', async () => {
    const { instance, captured } = relay();
    await instance.call(BOUND, 'approve', { proposalId: 'prop_a' });
    await instance.call(BOUND, 'approve', { proposalId: 'prop_b' });
    expect(captured[1]!.headers['x-request-id']).not.toBe(captured[0]!.headers['x-request-id']);
  });

  it('forwards only the declared body fields and never an identity', async () => {
    const { instance, captured } = relay();
    const result = await instance.call(BOUND, 'propose', {
      projectId: 'proj_1',
      goal: 'Add CSV export',
      strategy: 'managed',
      maximumCost: 0.5,
      idempotencyKey: 'key-1',
      // delegate-wave derives principal and origin from the credential and
      // rejects identity in a body. A page supplying them must not be relayed.
      principal: 'someone-else',
      origin: 'forged',
      extra: 'ignored',
    });

    expect(result.ok).toBe(true);
    const body = JSON.parse(captured[0]!.body!) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['goal', 'idempotencyKey', 'maximumCost', 'projectId', 'strategy']);
    expect(body['principal']).toBeUndefined();
    expect(body['origin']).toBeUndefined();
  });

  it('rejects an identifier that could escape its route', async () => {
    const { instance, captured } = relay();
    for (const jobId of ['../../v1/backups', 'a/b', 'x?y', '', 'a'.repeat(300)]) {
      const result = await instance.call(BOUND, 'job', { jobId });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_REQUEST');
    }
    expect(captured).toHaveLength(0);
  });

  it('never returns the token, the URL or a path to the caller', async () => {
    const { instance } = relay({ token: 'operator-secret-token' });
    const results = [
      await instance.call(BOUND, 'overview', {}),
      await instance.call(OTHER, 'overview', {}),
      await instance.call(BOUND, 'nonsense', {}),
      await instance.call(BOUND, 'job', { jobId: '../escape' }),
    ];
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain('operator-secret-token');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('/v1/');
  });

  it('reports an unreachable Control API without disclosing where it listens', async () => {
    const instance = new DelegateWaveRelay(
      { url: 'http://127.0.0.1:47321', token: 't', backpackId: BOUND },
      async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:47321'); },
      () => 'req-1',
    );
    const result = await instance.call(BOUND, 'overview', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  it('passes a delegate-wave refusal through as a typed failure', async () => {
    const instance = new DelegateWaveRelay(
      { url: 'http://127.0.0.1:47321', token: 't', backpackId: BOUND },
      async () => ({
        ok: false,
        status: 409,
        json: async () => ({ ok: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'operate scope required' } }),
      }),
      () => 'req-1',
    );
    const result = await instance.call(BOUND, 'approve', { proposalId: 'prop_1' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_SCOPE');
    expect(result.message).toBe('operate scope required');
  });

  it('reads delegate-wave’s own environment convention, inventing no new one', () => {
    const config = readConfigFromEnvironment({
      DELEGATE_WAVE_CONTROL_TOKEN: 'tok',
      DELEGATE_WAVE_BACKPACK_ID: BOUND,
    } as NodeJS.ProcessEnv);
    // Same default as delegate-wave's ControlClient.
    expect(config.url).toBe('http://127.0.0.1:47321');
    expect(config.token).toBe('tok');
    expect(config.backpackId).toBe(BOUND);
  });
});
