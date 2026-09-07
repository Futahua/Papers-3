/**
 * Creator-observed latency, As you Go window layout: clicking one member icon
 * ten times running was responsive, but the first click after moving to a
 * different icon made the REAL application window minimize/restore noticeably
 * late. Alternating between two icons was slow every time.
 *
 * The helper is strictly serial - it reads one stdin line, runs the whole
 * request synchronously, writes the reply, and only then reads the next - so
 * whatever reaches it first owns it until it finishes. Moving to another icon
 * starts a hover preview whose thumbnail capture (native-size bitmap,
 * PrintWindow, possible DWM fallback, scale, PNG encode, base64) is by far the
 * most expensive operation here, and the click's own minimize/restore then had
 * to wait behind it.
 *
 * Speculative captures are now held back while any control request is
 * outstanding. These tests pin that ordering, and equally pin what must NOT
 * change: control requests still dispatch immediately and independently, so one
 * lost helper reply cannot stall the rest.
 */
import { describe, expect, it } from 'vitest';

import type {
  RuntimeWindowId,
  WindowRequestMessage,
  WindowTransport,
} from '../../src/main/windows/windowCapabilityTypes';
import { createWindowCapabilityClient } from '../../src/main/windows/windowCapabilityClient';

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

const id = (value: string) => value as RuntimeWindowId;
const methodsSent = (sent: WindowRequestMessage[]) => sent.map((message) => message.method);

function observation(target: string, state = 'normal') {
  return { runtimeId: id(target), title: target, processId: null, processPath: null, state, bounds: null };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('window capability request priority', () => {
  it('holds a speculative thumbnail back while a control request is outstanding', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    const minimize = client.minimize(id('AAAA'));
    await settle();
    // A hover capture for the icon the pointer just moved to.
    const thumbnail = client.thumbnail(id('BBBB'), 240, 135);
    await settle();

    expect(methodsSent(fake.sent)).toEqual(['minimize']);

    fake.deliver({ requestId: 1, method: 'minimize', outcome: 'success', observation: observation('AAAA', 'minimized') });
    await expect(minimize).resolves.toMatchObject({ outcome: 'success' });
    await settle();

    expect(methodsSent(fake.sent)).toEqual(['minimize', 'thumbnail']);
    fake.deliver({ requestId: 2, method: 'thumbnail', outcome: 'missing', target: id('BBBB') });
    await expect(thumbnail).resolves.toMatchObject({ outcome: 'missing' });
    client.stop();
  });

  it('never lets a run of captures accumulate ahead of a click', async () => {
    // Ping-ponging between icons queued capture after capture. Whatever is
    // already executing cannot be preempted, but at most ONE capture may be
    // ahead of a control request.
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    client.thumbnail(id('AAAA'), 240, 135);
    client.thumbnail(id('BBBB'), 240, 135);
    client.thumbnail(id('CCCC'), 240, 135);
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['thumbnail']);

    const restore = client.restore(id('DDDD'));
    await settle();
    // The control request goes straight out, ahead of the two queued captures.
    expect(methodsSent(fake.sent)).toEqual(['thumbnail', 'restore']);

    fake.deliver({ requestId: 4, method: 'restore', outcome: 'success', observation: observation('DDDD') });
    await expect(restore).resolves.toMatchObject({ outcome: 'success' });
    client.stop();
  });

  it('keeps control requests concurrent and independently satisfiable', async () => {
    // The property the pre-existing suite relies on: control work is NOT
    // serialized, so one missing reply cannot stall the others.
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    const a = client.minimize(id('AAAA'));
    const b = client.restore(id('BBBB'));
    const c = client.observe(id('CCCC'));
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['minimize', 'restore', 'observe']);

    // Answer out of order; each satisfies only its own request.
    fake.deliver({ requestId: 3, method: 'observe', outcome: 'success', observation: observation('CCCC') });
    await expect(c).resolves.toMatchObject({ outcome: 'success' });
    fake.deliver({ requestId: 1, method: 'minimize', outcome: 'success', observation: observation('AAAA', 'minimized') });
    await expect(a).resolves.toMatchObject({ outcome: 'success' });
    fake.deliver({ requestId: 2, method: 'restore', outcome: 'success', observation: observation('BBBB') });
    await expect(b).resolves.toMatchObject({ outcome: 'success' });
    client.stop();
  });

  it('releases one deferred capture at a time once the helper is free', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    client.thumbnail(id('AAAA'), 240, 135);
    client.thumbnail(id('BBBB'), 240, 135);
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['thumbnail']);

    fake.deliver({ requestId: 1, method: 'thumbnail', outcome: 'missing', target: id('AAAA') });
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['thumbnail', 'thumbnail']);
    client.stop();
  });

  it('a deferred capture is not charged for the time it waited', async () => {
    // The timeout starts on dispatch. Otherwise a capture held behind a slow
    // control request would report a timeout it never actually experienced.
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 40 });

    const minimize = client.minimize(id('AAAA'));
    const thumbnail = client.thumbnail(id('BBBB'), 240, 135);
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The control request timed out on its own clock; the capture has not been
    // dispatched yet, so its clock has not begun.
    await expect(minimize).resolves.toMatchObject({ outcome: 'timeout' });
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['minimize', 'thumbnail']);
    fake.deliver({ requestId: 2, method: 'thumbnail', outcome: 'missing', target: id('BBBB') });
    await expect(thumbnail).resolves.toMatchObject({ outcome: 'missing' });
    client.stop();
  });

  it('a stopped client fails deferred captures instead of stranding them', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    client.minimize(id('AAAA'));
    const stranded = client.thumbnail(id('BBBB'), 240, 135);
    await settle();
    expect(methodsSent(fake.sent)).toEqual(['minimize']);

    client.stop();
    await expect(stranded).resolves.toMatchObject({ outcome: 'helper-unavailable' });
  });

  it('counts deferred captures against the pending bound', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, maxPending: 3 });

    client.minimize(id('AAAA'));
    client.thumbnail(id('BBBB'), 240, 135);
    client.thumbnail(id('CCCC'), 240, 135);
    await settle();
    expect(client.pendingCount).toBe(3);

    // A caller cannot smuggle unbounded work past the limit by deferring it.
    await expect(client.thumbnail(id('DDDD'), 240, 135)).resolves.toMatchObject({
      outcome: 'helper-unavailable',
    });
    client.stop();
  });
});
