/**
 * Replay a captured picker result through the REAL session, offline.
 *
 * Three diagnostics in a row named the wrong reason for refusing a pick, and the
 * captured payload turned out to be valid on inspection. This test takes the
 * exact bytes the engine wrote and asks the real protocol what it makes of them,
 * so the answer stops depending on my reading of the checks.
 *
 * It skips itself when no capture exists.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import {
  createSlopTopPickerSession,
  parseResultReason,
  type SlopTopPickerTransport,
} from '../../src/main/windows/slopTopPickerProtocol';

const CAPTURE = process.env['PAPERS_PICKER_CAPTURE']
  ?? 'C:\\Users\\Public\\Documents\\PapersNativeBridgeReceipts\\last-picker-result.json';

function captured(): { raw: unknown; token: string } | null {
  if (!existsSync(CAPTURE)) return null;
  const text = readFileSync(CAPTURE, 'utf8');
  const raw = JSON.parse(text) as Record<string, unknown>;
  const token = typeof raw['token'] === 'string' ? raw['token'] : '';
  return { raw, token };
}

describe.skipIf(captured() === null)('captured picker result replays through the real session', () => {
  it('is either accepted, or refused for a reason this test can print', async () => {
    const capture = captured()!;
    let result: unknown = null;
    let activationToken = '';
    const transport: SlopTopPickerTransport = {
      activate: (request) => { activationToken = request.token; },
      readAck: () => ({ version: 3, token: activationToken, active: true }),
      // The captured token belongs to the session that produced it; a fresh
      // session has its own. Rewriting it isolates the PAYLOAD's shape from the
      // token check, which is the only way to tell the two apart offline.
      readResult: () => ({ ...(capture.raw as Record<string, unknown>), token: activationToken }),
      requestCancel: () => undefined,
      cleanup: () => undefined,
    };
    const service = {
      prepareNativePicker: async () => ({
        outcome: 'success' as const,
        seeds: [],
        seededIndices: [] as number[],
      }),
      bindNativePickerSelection: async () => ({ outcome: 'success' as const, windows: [] }),
    };
    const session = createSlopTopPickerSession(service as never, transport, { resultPollMs: 2 });
    await session.begin({
      memberDescriptors: [],
      onResult: (next) => { result = next; },
    });
    // The session's own token is random, so the captured token cannot match it -
    // this test's job is to REPORT the shape, not to pretend it is live.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const reason = parseResultReason({ ...(capture.raw as Record<string, unknown>), token: activationToken }, activationToken);
    // eslint-disable-next-line no-console
    console.log('REFUSAL REASON:', reason);
    expect(reason).toBe('ok');
  });
});
