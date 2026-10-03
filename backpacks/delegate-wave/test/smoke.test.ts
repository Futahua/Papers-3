/**
 * Proves the test runner and the transport module load. Encodes no interface
 * behaviour: what the dashboard should do, and how it should be verified, is
 * the work to be done here.
 */
import { describe, expect, it } from 'vitest';

import { call } from '../src/bridge/bridge';

describe('project bootstrap', () => {
  it('exposes the relay transport', () => {
    expect(typeof call).toBe('function');
  });

  it('reports a lost host reply as TIMEOUT rather than as a failed operation', async () => {
    // No Papers host is present under the test runner, so nothing answers. The
    // distinction matters: a mutation that timed out may still have run.
    const result = await call('overview', {}, { timeoutMs: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });
});
