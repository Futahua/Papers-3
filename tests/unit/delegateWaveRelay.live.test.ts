/**
 * Live bridge proof — the relay against the real, already-running delegate-wave
 * Control API on this machine.
 *
 * Skipped unless DELEGATE_WAVE_CONTROL_TOKEN and DELEGATE_WAVE_BACKPACK_ID are
 * present, so an ordinary `vitest run` on another machine is unaffected.
 *
 * READ-ONLY BY CONSTRUCTION. Only `overview` is exercised. propose, authorize,
 * approve and decline are never called here: they mutate a live operational
 * database and belong to the dogfood run, not to a transport test.
 */
import { describe, expect, it } from 'vitest';

import { DelegateWaveRelay, readConfigFromEnvironment } from '../../src/main/delegateWave/delegateWaveRelay';

const config = readConfigFromEnvironment();
const live = Boolean(config.token && config.backpackId);
const suite = live ? describe : describe.skip;

suite('DelegateWaveRelay against the running Control API', () => {
  const relay = () => new DelegateWaveRelay(
    config,
    (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Parameters<typeof DelegateWaveRelay>[1]>,
    () => crypto.randomUUID(),
  );

  it('returns the real overview through the bound Backpack identity', async () => {
    const result = await relay().call(config.backpackId!, 'overview', {});

    expect(result.ok).toBe(true);
    const overview = result.result as { totals?: Record<string, number>; projects?: unknown[] };
    // Real counts from the live database, not a shape assertion.
    expect(typeof overview.totals?.['projects']).toBe('number');
    expect(overview.totals!['projects']).toBeGreaterThan(0);
    expect(Array.isArray(overview.projects)).toBe(true);
  });

  it('refuses the same operation from a different Backpack origin', async () => {
    const result = await relay().call('bp-00000000-0000-4000-8000-000000000000', 'overview', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_PERMITTED');
    expect(result.result).toBeUndefined();
  });

  it('never returns the token or the endpoint to the caller', async () => {
    const results = [
      await relay().call(config.backpackId!, 'overview', {}),
      await relay().call('bp-00000000-0000-4000-8000-000000000000', 'overview', {}),
      await relay().call(config.backpackId!, 'request', { path: '/v1/backups' }),
    ];
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(config.token!);
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('47321');
    expect(serialized).not.toContain('Bearer');
  });

  it('cannot reach a route outside the operation map even by naming it', async () => {
    // A page that knows delegate-wave's HTTP surface still cannot use it.
    for (const attempt of ['request', 'backup.restore', 'reconcile', '/v1/backups']) {
      const result = await relay().call(config.backpackId!, attempt, { path: '/v1/backups', method: 'POST' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNKNOWN_OPERATION');
    }
  });
});
