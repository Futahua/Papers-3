import { describe, expect, it } from 'vitest';

import {
  createSlopTopPickerSession,
  type SlopTopPickerActivation,
  type SlopTopPickerTransport,
} from '../../src/main/windows/slopTopPickerProtocol';

const descriptor = { version: 1 as const, title: 'Target', executableFingerprint: 'a'.repeat(64) };
const existing = { version: 1 as const, title: 'Existing', executableFingerprint: 'b'.repeat(64) };
const candidate = { id: 'candidate-1', title: 'Target', applicationLabel: 'Target', icon: null, state: 'normal' as const };
const seed = { processId: 123, x: 100, y: 100, width: 400, height: 300 };

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 500;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error('condition timed out'));
      }
    }, 2);
  });
}

function harness() {
  let activation: SlopTopPickerActivation | null = null;
  let ack: unknown = null;
  let result: unknown = null;
  let cancelledToken = '';
  let cleanedToken = '';
  const transport: SlopTopPickerTransport = {
    activate: (next) => {
      activation = next;
      ack = { version: 2, token: next.token, active: true };
    },
    readAck: () => ack,
    readResult: () => result,
    requestCancel: (token) => { cancelledToken = token; },
    cleanup: (token) => { cleanedToken = token; },
  };
  const service = {
    prepareNativePicker: async () => ({ outcome: 'success' as const, seeds: [seed] }),
    bindNativePickerSelection: async () => ({
      outcome: 'success' as const,
      windows: [{ descriptor, capability: { version: 1 as const, bindingId: 'binding-1' }, candidate }],
    }),
  };
  return {
    transport,
    service,
    activation: () => activation,
    setAck: (next: unknown) => { ack = next; },
    setResult: (next: unknown) => { result = next; },
    cancelledToken: () => cancelledToken,
    cleanedToken: () => cleanedToken,
  };
}

describe('SlopTop local picker protocol', () => {
  it('sends one seed snapshot and consumes one final green-set snapshot', async () => {
    const test = harness();
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await expect(session.begin({ memberDescriptors: [], onResult: (next) => { delivered = next; } }))
      .resolves.toEqual({ outcome: 'started' });
    const activation = test.activation();
    expect(activation).toMatchObject({ version: 2, seeds: [seed] });
    test.setResult({ version: 2, token: activation!.token, outcome: 'committed', windows: [seed] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({
      outcome: 'committed',
      adds: [{ descriptor, capability: { version: 1, bindingId: 'binding-1' }, candidate }],
      removes: [],
    });
    expect(session.active).toBe(false);
    expect(test.cleanedToken()).toBe(activation!.token);
  });

  it('derives removals from the final complete set instead of click events', async () => {
    const test = harness();
    test.service.prepareNativePicker = async () => ({ outcome: 'success' as const, seeds: [seed] });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [existing], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 2, token: activation.token, outcome: 'committed', windows: [seed] });
    await waitFor(() => delivered !== null);
    expect(delivered).toMatchObject({
      outcome: 'committed',
      adds: [{ descriptor }],
      removes: [{ descriptor: existing }],
    });
  });

  it('ignores stale or malformed results and cancels through the one-shot transport', async () => {
    const test = harness();
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 2, token: `${activation.token}-stale`, outcome: 'committed', windows: [seed] });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(delivered).toBeNull();
    test.setResult({ version: 2, token: activation.token, outcome: 'committed', windows: [{ ...seed, width: 0 }] });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(delivered).toBeNull();
    await session.cancel();
    expect(delivered).toEqual({ outcome: 'cancelled' });
    expect(test.cancelledToken()).toBe(activation.token);
  });

  it('fails closed when AHK does not acknowledge activation', async () => {
    const test = harness();
    test.transport.activate = (next) => { test.setAck({ version: 2, token: `${next.token}-wrong`, active: true }); };
    const session = createSlopTopPickerSession(test.service as never, test.transport, { ackTimeoutMs: 15, resultPollMs: 2 });
    let delivered: unknown = null;
    await expect(session.begin({ memberDescriptors: [], onResult: (next) => { delivered = next; } }))
      .resolves.toEqual({ outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' });
    expect(delivered).toEqual({ outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' });
    expect(session.active).toBe(false);
  });
});
