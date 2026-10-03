/**
 * Creator bar: clicking a member icon moves the real window immediately.
 *
 * The individual toggle used to be observe -> carry the answer back to the
 * renderer -> decide there -> come back and mutate. On a helper that runs one
 * request at a time that is a wasted round trip, and it races: two fast clicks
 * can both read the same pre-mutation state and issue the same absolute action.
 *
 * `toggle` reads the live state and acts on it inside ONE helper request, and
 * answers with the direction taken plus the PRE-mutation observation - the
 * pre-mutation bounds are the window's restore rectangle, and a window that has
 * just been minimized has none to offer.
 */
import { describe, expect, it } from 'vitest';

import {
  parseWindowResponse,
  type RuntimeWindowId,
  type WindowCapabilityResult,
  type WindowRequestMessage,
  type WindowTransport,
} from '../../src/main/windows/windowCapabilityTypes';
import { createWindowCapabilityClient } from '../../src/main/windows/windowCapabilityClient';

const id = (value: string) => value as RuntimeWindowId;

function observation(target: string, state = 'normal') {
  return {
    runtimeId: id(target),
    title: target,
    processId: null,
    processPath: null,
    state,
    bounds: { x: 10, y: 20, width: 300, height: 200 },
  };
}

function fakeTransport() {
  const sent: WindowRequestMessage[] = [];
  let onMessage: ((raw: unknown) => void) | null = null;
  const transport: WindowTransport = {
    send: async (message) => { sent.push(message); },
    onMessage: (callback) => { onMessage = callback; },
    close: async () => {},
  };
  return { transport, sent, deliver: (raw: unknown) => { onMessage?.(raw); } };
}

describe('toggle response parsing', () => {
  it('accepts a success carrying the before observation and the direction taken', () => {
    const parsed = parseWindowResponse({
      requestId: 1, method: 'toggle', outcome: 'success',
      observation: observation('AAAA'), action: 'minimize',
    });
    expect(parsed).toMatchObject({ method: 'toggle', outcome: 'success', action: 'minimize' });
    expect(parsed?.observation?.bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('rejects a success with no action: the caller cannot infer the direction', () => {
    expect(parseWindowResponse({
      requestId: 1, method: 'toggle', outcome: 'success', observation: observation('AAAA'),
    })).toBeNull();
  });

  it('rejects a success with no observation: the restore bounds would be lost', () => {
    expect(parseWindowResponse({
      requestId: 1, method: 'toggle', outcome: 'success', action: 'restore',
    })).toBeNull();
  });

  it('rejects an unknown action', () => {
    for (const action of ['maximize', 'close', '', 'Minimize', 1, null]) {
      expect(parseWindowResponse({
        requestId: 1, method: 'toggle', outcome: 'success', observation: observation('AAAA'), action,
      })).toBeNull();
    }
  });

  it('keeps non-success envelope-only, and never carrying an action', () => {
    expect(parseWindowResponse({ requestId: 1, method: 'toggle', outcome: 'missing' }))
      .toMatchObject({ method: 'toggle', outcome: 'missing' });
    expect(parseWindowResponse({ requestId: 1, method: 'toggle', outcome: 'missing', action: 'minimize' }))
      .toBeNull();
  });

  it('refuses an action on any other method: it is an unknown key there', () => {
    expect(parseWindowResponse({
      requestId: 1, method: 'minimize', outcome: 'success', observation: observation('AAAA'), action: 'minimize',
    })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'missing', action: 'restore' }))
      .toBeNull();
  });
});

describe('toggle through the client', () => {
  it('sends exactly one request and resolves with action plus before-observation', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const pending = client.toggle(id('AAAA'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ method: 'toggle', target: 'AAAA' });

    fake.deliver({
      requestId: fake.sent[0]!.requestId, method: 'toggle', outcome: 'success',
      observation: observation('AAAA', 'minimized'), action: 'restore',
    });
    const result: WindowCapabilityResult = await pending;
    expect(result.outcome).toBe('success');
    expect(result.action).toBe('restore');
    expect(result.observation?.state).toBe('minimized');
    client.stop();
  });

  it('does not let a reply for a different window satisfy the request', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 40 });
    const pending = client.toggle(id('AAAA'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    fake.deliver({
      requestId: fake.sent[0]!.requestId, method: 'toggle', outcome: 'success',
      observation: observation('BBBB'), action: 'minimize',
    });
    await expect(pending).resolves.toMatchObject({ outcome: 'timeout' });
    client.stop();
  });
});
