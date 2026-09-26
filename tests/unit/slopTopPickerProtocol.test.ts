import { describe, expect, it } from 'vitest';

import {
  createSlopTopPickerSession,
  type SlopTopPickerActivation,
  type SlopTopPickerTransport,
} from '../../src/main/windows/slopTopPickerProtocol';

const descriptor = { version: 1 as const, title: 'Target', executableFingerprint: 'a'.repeat(64) };
const existing = { version: 1 as const, title: 'Existing', executableFingerprint: 'b'.repeat(64) };
const candidate = { id: 'candidate-1', title: 'Target', applicationLabel: 'Target', icon: null, state: 'normal' as const };
const seed = { processId: 123, x: 100, y: 100, width: 400, height: 300, seedId: 0 };
// The committed result carries plain identities; only the activation seeds carry seedId.
const identity = { processId: 123, x: 100, y: 100, width: 400, height: 300 };

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
      ack = { version: 3, token: next.token, active: true };
    },
    readAck: () => ack,
    readResult: () => result,
    requestCancel: (token) => { cancelledToken = token; },
    cleanup: (token) => { cleanedToken = token; },
  };
  const service = {
    prepareNativePicker: async () => ({ outcome: 'success' as const, seeds: [seed], seededIndices: [0] }),
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
    expect(activation).toMatchObject({ version: 3, seeds: [seed] });
    test.setResult({ version: 3, token: activation!.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({
      outcome: 'committed',
      adds: [{ descriptor, capability: { version: 1, bindingId: 'binding-1' }, candidate }],
      removes: [],
    });
    expect(session.active).toBe(false);
    expect(test.cleanedToken()).toBe(activation!.token);
  });

  it('removes only a member the picker reports as explicitly deselected', async () => {
    const test = harness();
    test.service.prepareNativePicker = async () => ({ outcome: 'success' as const, seeds: [seed], seededIndices: [0] });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [existing], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [0] });
    await waitFor(() => delivered !== null);
    expect(delivered).toMatchObject({
      outcome: 'committed',
      adds: [{ descriptor }],
      removes: [{ descriptor: existing }],
    });
  });

  it('never removes a member the picker was never shown', async () => {
    const test = harness();
    // The requested member could not be matched against the live desktop, so it
    // was not seeded and never painted green. Its absence from the final set is
    // not a removal gesture - reading it as one deleted eight members the moment
    // the creator picked a single new window.
    test.service.prepareNativePicker = async () => ({ outcome: 'success' as const, seeds: [seed], seededIndices: [] });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [existing], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [] });
    await waitFor(() => delivered !== null);
    expect(delivered).toMatchObject({
      outcome: 'committed',
      adds: [{ descriptor }],
      removes: [],
    });
  });

  it('fails the whole commit when a removal names a member the picker was never shown', async () => {
    const test = harness();
    // Only member 0 was seeded, so a deselection of member 1 cannot be honest.
    test.service.prepareNativePicker = async () => ({ outcome: 'success' as const, seeds: [seed], seededIndices: [0] });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [existing], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [1] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({ outcome: 'failed', error: 'the picker reported a removal for a member it was never shown' });
  });

  it('fails when the same member is reported as both removed and selected', async () => {
    const test = harness();
    test.service.bindNativePickerSelection = async () => ({
      outcome: 'success' as const,
      windows: [{ descriptor: existing, capability: { version: 1 as const, bindingId: 'binding-existing' }, candidate }],
    });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [existing], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [0] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({ outcome: 'failed', error: 'the picker reported a member as both removed and selected' });
  });

  it('keeps same-title, same-executable W1 removal exact while adding W2', async () => {
    const test = harness();
    const w1 = { version: 1 as const, title: 'Editor', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W1111111111111111' };
    const w2 = { version: 1 as const, title: 'Editor', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W2222222222222222' };
    const w2Candidate = { ...candidate, id: 'candidate-w2', title: 'Editor' };
    test.service.bindNativePickerSelection = async () => ({
      outcome: 'success' as const,
      windows: [{ descriptor: w2, capability: { version: 1 as const, bindingId: 'binding-w2' }, candidate: w2Candidate }],
    });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [w1], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [0] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({
      outcome: 'committed',
      adds: [{ descriptor: w2, capability: { version: 1, bindingId: 'binding-w2' }, candidate: w2Candidate }],
      removes: [{ descriptor: w1 }],
    });
  });

  it('fails closed when a mixed WID/legacy fallback is ambiguous', async () => {
    const test = harness();
    const legacy = { version: 1 as const, title: 'Editor', executableFingerprint: 'a'.repeat(64) };
    const modern = { ...legacy, windowInstanceId: 'W1111111111111111' };
    test.service.bindNativePickerSelection = async () => ({
      outcome: 'success' as const,
      windows: [modern, { ...modern, windowInstanceId: 'W2222222222222222' }].map((descriptor, index) => ({
        descriptor,
        capability: { version: 1 as const, bindingId: `binding-${index}` },
        candidate,
      })),
    });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [legacy], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', deselectedSeedIds: [], windows: [identity, { ...identity, x: 600 }] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({ outcome: 'failed', error: 'the final picker set has ambiguous window identities' });
  });

  it('matches one legacy descriptor to one modern descriptor by the full legacy key', async () => {
    const test = harness();
    const legacy = { version: 1 as const, title: 'Editor', executableFingerprint: 'a'.repeat(64) };
    const modern = { ...legacy, windowInstanceId: 'W1111111111111111' };
    test.service.bindNativePickerSelection = async () => ({
      outcome: 'success' as const,
      windows: [{ descriptor: modern, capability: { version: 1 as const, bindingId: 'binding-modern' }, candidate }],
    });
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [legacy], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', windows: [identity], deselectedSeedIds: [] });
    await waitFor(() => delivered !== null);
    expect(delivered).toEqual({ outcome: 'committed', adds: [], removes: [] });
  });

  it('ignores stale or malformed results and cancels through the one-shot transport', async () => {
    const test = harness();
    const session = createSlopTopPickerSession(test.service as never, test.transport, { resultPollMs: 2 });
    let delivered: unknown = null;
    await session.begin({ memberDescriptors: [], onResult: (next) => { delivered = next; } });
    const activation = test.activation()!;
    test.setResult({ version: 3, token: `${activation.token}-stale`, outcome: 'committed', windows: [identity], deselectedSeedIds: [] });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(delivered).toBeNull();
    test.setResult({ version: 3, token: activation.token, outcome: 'committed', deselectedSeedIds: [], windows: [{ ...identity, width: 0 }] });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(delivered).toBeNull();
    await session.cancel();
    expect(delivered).toEqual({ outcome: 'cancelled' });
    expect(test.cancelledToken()).toBe(activation.token);
  });

  it('fails closed when AHK does not acknowledge activation', async () => {
    const test = harness();
    test.transport.activate = (next) => { test.setAck({ version: 3, token: `${next.token}-wrong`, active: true }); };
    const session = createSlopTopPickerSession(test.service as never, test.transport, { ackTimeoutMs: 15, resultPollMs: 2 });
    let delivered: unknown = null;
    await expect(session.begin({ memberDescriptors: [], onResult: (next) => { delivered = next; } }))
      .resolves.toEqual({ outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' });
    expect(delivered).toEqual({ outcome: 'failed', error: 'SlopTop did not acknowledge the picker activation.' });
    expect(session.active).toBe(false);
  });
});
