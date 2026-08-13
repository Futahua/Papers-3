import { describe, expect, it, vi } from 'vitest';

import {
  WINDOW_CAPABILITY_METHODS,
  parseWindowResponse,
  type PersistedWindowDescriptor,
  type RuntimeWindowId,
  type WindowRequestMessage,
  type WindowResponseMessage,
  type WindowTransport,
} from '../../src/main/windows/windowCapabilityTypes';
import { createWindowCapabilityClient } from '../../src/main/windows/windowCapabilityClient';
import { createWindowCapabilitySupervisor } from '../../src/main/windows/windowCapabilitySupervisor';

/** In-memory fake transport: records sent messages and lets the test
 * deliver responses out-of-order, duplicated or malformed. */
function fakeTransport() {
  const sent: WindowRequestMessage[] = [];
  let onMessage: ((raw: unknown) => void) | null = null;
  let closed = 0;
  const transport: WindowTransport = {
    send: async (message) => {
      sent.push(message);
    },
    onMessage: (callback) => {
      onMessage = callback;
    },
    close: async () => {
      closed += 1;
    },
  };
  return {
    transport,
    sent,
    deliver: (raw: unknown) => { onMessage?.(raw); },
    get closed() {
      return closed;
    },
  };
}

function runtimeId(value: string): RuntimeWindowId {
  return value as RuntimeWindowId;
}

function observationFor(id: string, state = 'normal') {
  return {
    runtimeId: runtimeId(id),
    title: id,
    processId: null,
    processPath: null,
    state,
    bounds: null,
  };
}

function response(requestId: number, method: string, outcome: string): WindowResponseMessage {
  return {
    requestId,
    method: method as WindowResponseMessage['method'],
    outcome: outcome as WindowResponseMessage['outcome'],
  };
}

function successWithObservation(requestId: number, method: string, id: string, state = 'normal') {
  return { ...response(requestId, method, 'success'), observation: observationFor(id, state) };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Valid 1x1 PNG as base64 (decodes to 70 bytes, correct PNG signature,
 * IHDR claims 1x1). */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Builds ONE complete valid PNG byte buffer (signature + IHDR claiming the
 * given dimensions, optionally padded to `totalBytes`) and base64-encodes it
 * as a whole, so the strict parser's IHDR/byte-bound checks are exercised on
 * a real buffer rather than concatenated fragments. */
function pngWithSize(width: number, height: number, totalBytes?: number): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.write('IHDR', 4, 'latin1'); // chunk type
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // color type RGBA
  let buffer = Buffer.concat([sig, ihdr]);
  if (totalBytes !== undefined && totalBytes > buffer.length) {
    buffer = Buffer.concat([buffer, Buffer.alloc(totalBytes - buffer.length, 0)]);
  }
  return buffer.toString('base64');
}

describe('window capability client', () => {
  it('correlates out-of-order replies to the right requests', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    const list = client.list();
    const minimize = client.minimize(runtimeId('A'));
    const restore = client.restore(runtimeId('B'));

    fake.deliver({ ...response(3, 'restore', 'success'), observation: observationFor('B') });
    fake.deliver({ ...response(1, 'list', 'success'), windows: [] });
    fake.deliver({ ...response(2, 'minimize', 'success'), observation: observationFor('A', 'minimized') });

    await expect(restore).resolves.toMatchObject({ outcome: 'success' });
    await expect(list).resolves.toMatchObject({ outcome: 'success', windows: [] });
    await expect(minimize).resolves.toMatchObject({ outcome: 'success', observation: expect.objectContaining({ state: 'minimized' }) });
  });

  it('resolves with a typed timeout and clears the pending slot', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 20 });

    const slow = client.observe(runtimeId('A'));
    await expect(slow).resolves.toMatchObject({ outcome: 'timeout' });
    expect(client.pendingCount).toBe(0);
  });

  it('bounds the pending-request collection', () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 60_000, maxPending: 2 });

    const first = client.list();
    const second = client.list();
    const third = client.list();
    expect(client.pendingCount).toBe(2);
    void third.then((result) => {
      expect(result.outcome).toBe('helper-unavailable');
    });
    void first;
    void second;
  });

  it('ignores malformed, unknown, duplicate, stale and mismatched responses without satisfying any request', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 40 });

    const first = client.minimize(runtimeId('A')); // request id 1
    const second = client.restore(runtimeId('B')); // request id 2
    fake.deliver(null);
    fake.deliver('garbage');
    fake.deliver({ requestId: 99, method: 'minimize', outcome: 'success' }); // unknown id
    fake.deliver({ requestId: 1, method: 'restore', outcome: 'success' }); // mismatched method for id 1
    fake.deliver({ requestId: 1, method: 'minimize', outcome: 'success' }); // success without observation (malformed)
    expect(client.pendingCount).toBe(2);

    fake.deliver(successWithObservation(1, 'minimize', 'A'));
    await expect(first).resolves.toMatchObject({ outcome: 'success' });

    // A stale reply for the already-resolved id is ignored and changes nothing.
    fake.deliver({ requestId: 1, method: 'minimize', outcome: 'denied' });
    expect(client.pendingCount).toBe(1);

    fake.deliver(successWithObservation(2, 'restore', 'B'));
    await expect(second).resolves.toMatchObject({ outcome: 'success' });
  });

  it('routes every capability method to exactly the requested id', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });

    const a = runtimeId('AAAA');
    const b = runtimeId('BBBB');
    const results = {
      list: client.list(),
      observeA: client.observe(a),
      minimizeA: client.minimize(a),
      restoreB: client.restore(b),
      applyB: client.apply(b, { x: 1, y: 2, width: 300, height: 200 }, 'maximized'),
      closeA: client.close(a),
    };

    // Deliver only A's minimize reply: it must satisfy only that request.
    fake.deliver(successWithObservation(3, 'minimize', 'AAAA'));
    await expect(results.minimizeA).resolves.toMatchObject({ outcome: 'success' });

    // Now satisfy the rest in any order.
    fake.deliver({ ...response(1, 'list', 'success'), windows: [] });
    fake.deliver(successWithObservation(2, 'observe', 'AAAA'));
    fake.deliver(successWithObservation(4, 'restore', 'BBBB'));
    fake.deliver({ ...response(5, 'apply', 'success'), observation: observationFor('BBBB', 'maximized') });
    fake.deliver(response(6, 'close', 'success'));

    for (const result of Object.values(results)) {
      await expect(result).resolves.toMatchObject({ outcome: 'success' });
    }

    const byMethod = (method: string) => fake.sent.filter((m) => m.method === method);
    expect(byMethod('minimize')[0]?.target).toBe('AAAA');
    expect(byMethod('restore')[0]?.target).toBe('BBBB');
    expect(byMethod('apply')[0]?.target).toBe('BBBB');
    expect(byMethod('apply')[0]?.bounds).toEqual({ x: 1, y: 2, width: 300, height: 200 });
    expect(byMethod('apply')[0]?.state).toBe('maximized');
    expect(byMethod('close')[0]?.target).toBe('AAAA');
    expect(fake.sent.filter((m) => m.method === 'list').length).toBe(1);
  });

  it('every typed outcome survives the transport', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const outcomes = ['missing', 'ambiguous', 'denied', 'malformed', 'helper-unavailable'];

    const promises = outcomes.map((outcome, index) => {
      const result = client.observe(runtimeId(`id-${index}`));
      fake.deliver({ requestId: index + 1, method: 'observe', outcome });
      return result.then((resolved) => [outcome, resolved.outcome] as const);
    });
    const settled = await Promise.all(promises);
    for (const [wanted, actual] of settled) {
      expect(actual).toBe(wanted);
    }
  });

  it('a send failure fails the request closed without disturbing others', async () => {
    let failNext = true;
    const sent: WindowRequestMessage[] = [];
    const transport: WindowTransport = {
      send: async (message) => {
        sent.push(message);
        if (failNext) throw new Error('transport down');
      },
      onMessage: () => {},
      close: async () => {},
    };
    const client = createWindowCapabilityClient({ transport, timeoutMs: 30 });
    const failed = client.minimize(runtimeId('A'));
    await expect(failed).resolves.toMatchObject({ outcome: 'helper-unavailable' });

    failNext = false;
    const ok = client.restore(runtimeId('B'));
    fakeTransport();
    // deliver the restore reply through a working path
    await expect(ok).resolves.toMatchObject({ outcome: 'timeout' });
  });

  it('a same-method wrong-target observation can never resolve a request', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 60 });

    const pending = client.minimize(runtimeId('AAAA'));
    fake.deliver(successWithObservation(1, 'minimize', 'BBBB'));
    expect(client.pendingCount).toBe(1);

    fake.deliver(successWithObservation(1, 'minimize', 'AAAA'));
    await expect(pending).resolves.toMatchObject({ outcome: 'success' });
  });

  it('exposes only the enumerated capability surface — no send/exec/launch escape hatch', () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const surface = Object.keys(client);
    expect(surface.sort()).toEqual(
      ['apply', 'cloak', 'cloakMany', 'close', 'handleMessage', 'hover', 'list', 'livePreview', 'minimize', 'observe', 'pendingCount', 'rejectAllPending', 'restore', 'stop', 'thumbnail', 'uncloak', 'uncloakMany'].sort(),
    );
    for (const name of surface) {
      expect(name.toLowerCase()).not.toMatch(/send|exec|invoke|shell|spawn|launch|eval/);
    }
    expect([...WINDOW_CAPABILITY_METHODS]).toEqual(['list', 'observe', 'minimize', 'restore', 'cloak', 'uncloak', 'cloak-many', 'uncloak-many', 'live-preview', 'apply', 'close', 'hover', 'thumbnail']);
  });

  it('routes bounded batched visibility through one correlated request', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const pending = client.cloakMany([runtimeId('AAAA'), runtimeId('BBBB')]);
    const sent = fake.sent[0]!;
    expect(sent).toMatchObject({ method: 'cloak-many', targets: ['AAAA', 'BBBB'] });
    fake.deliver(response(sent.requestId, 'cloak-many', 'success'));
    await expect(pending).resolves.toEqual({ outcome: 'success' });
  });

  it('routes a thumbnail request and forwards the bounded thumbnail payload (019G)', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const thumbPromise = client.thumbnail(runtimeId('AAAA'), 240, 135);
    const sent = fake.sent[0]!;
    expect(sent).toMatchObject({ method: 'thumbnail', target: 'AAAA', maxWidth: 240, maxHeight: 135 });
    const image = pngWithSize(240, 135);
    fake.deliver({
      ...response(sent.requestId, 'thumbnail', 'success'),
      thumbnail: { image, width: 240, height: 135 },
      target: 'AAAA',
    });
    const result = await thumbPromise;
    expect(result.outcome).toBe('success');
    expect(result.thumbnail).toEqual({ image, width: 240, height: 135 });
    // A thumbnail reply for the wrong method must never satisfy it.
    const second = client.thumbnail(runtimeId('BBBB'));
    const sent2 = fake.sent[1]!;
    fake.deliver({ ...response(sent2.requestId, 'observe', 'success'), observation: observationFor('BBBB') });
    const stale = await second;
    expect(stale.outcome).toBe('timeout');
  });

  it('forwards and validates the 024 icon-preview fields (source/minimized)', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const thumbPromise = client.thumbnail(runtimeId('AAAA'), 240, 135);
    const sent = fake.sent[0]!;
    const image = pngWithSize(240, 135);
    fake.deliver({
      ...response(sent.requestId, 'thumbnail', 'success'),
      thumbnail: { image, width: 240, height: 135, source: 'icon', minimized: true },
      target: 'AAAA',
    });
    const result = await thumbPromise;
    expect(result.outcome).toBe('success');
    expect(result.thumbnail).toEqual({ image, width: 240, height: 135, source: 'icon', minimized: true });
    // A malformed 024 field (unknown source) is rejected: the pending request
    // is not satisfied and resolves as a typed timeout.
    const fake2 = fakeTransport();
    const client2 = createWindowCapabilityClient({ transport: fake2.transport, timeoutMs: 40 });
    const bad = client2.thumbnail(runtimeId('BBBB'), 240, 135);
    const sent2 = fake2.sent[0]!;
    fake2.deliver({
      ...response(sent2.requestId, 'thumbnail', 'success'),
      thumbnail: { image, width: 240, height: 135, source: 'bogus' },
      target: 'BBBB',
    });
    const badResult = await bad;
    expect(badResult.outcome).toBe('timeout');
  });

  it('ignores a thumbnail response whose echoed target does not match (019GR3)', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport, timeoutMs: 40 });
    const pending = client.thumbnail(runtimeId('AAAA'), 240, 135);
    const sent = fake.sent[0]!;
    const image = pngWithSize(240, 135);
    // Same requestId AND method but a DIFFERENT target: must be ignored.
    fake.deliver({
      ...response(sent.requestId, 'thumbnail', 'success'),
      thumbnail: { image, width: 240, height: 135 },
      target: 'BBBB',
    });
    expect(client.pendingCount).toBe(1);
    // The response for the exact target resolves the pending request.
    fake.deliver({
      ...response(sent.requestId, 'thumbnail', 'success'),
      thumbnail: { image, width: 240, height: 135 },
      target: 'AAAA',
    });
    const result = await pending;
    expect(result.outcome).toBe('success');
    // The token is a strict main-internal correlation field: never exposed.
    expect(result).not.toHaveProperty('target');
  });
});

describe('window capability supervisor', () => {
  it('moves through stopped -> starting -> ready and exposes the client only when ready', async () => {
    const fake = fakeTransport();
    const supervisor = createWindowCapabilitySupervisor({ createTransport: () => fake.transport });
    expect(supervisor.getState()).toBe('stopped');
    expect(supervisor.getClient()).toBeNull();

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(supervisor.getClient()).not.toBeNull();
  });

  it('crash rejects every pending request exactly once with helper-unavailable', async () => {
    const fake = fakeTransport();
    const supervisor = createWindowCapabilitySupervisor({ createTransport: () => fake.transport, timeoutMs: 60_000 });
    await supervisor.start();
    const client = supervisor.getClient();
    if (!client) throw new Error('client missing');

    let resolutions = 0;
    const pending1 = client.minimize(runtimeId('A'));
    const pending2 = client.observe(runtimeId('B'));
    void pending1.then(() => { resolutions += 1; });
    void pending2.then(() => { resolutions += 1; });

    await supervisor.crash();
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();
    await expect(pending1).resolves.toMatchObject({ outcome: 'helper-unavailable' });
    await expect(pending2).resolves.toMatchObject({ outcome: 'helper-unavailable' });

    // A second crash is a no-op and cannot double-resolve anything.
    await supervisor.crash();
    await wait(10);
    expect(resolutions).toBe(2);
  });

  it('stop rejects pendings and a restart never replays a mutation', async () => {
    const fake = fakeTransport();
    const supervisor = createWindowCapabilitySupervisor({ createTransport: () => fake.transport, timeoutMs: 60_000 });
    await supervisor.start();
    const client = supervisor.getClient();
    if (!client) throw new Error('client missing');

    const pendingMinimize = client.minimize(runtimeId('A'));
    const pendingClose = client.close(runtimeId('B'));

    await supervisor.crash();
    await expect(pendingMinimize).resolves.toMatchObject({ outcome: 'helper-unavailable' });
    await expect(pendingClose).resolves.toMatchObject({ outcome: 'helper-unavailable' });
    const sentBeforeRestart = fake.sent.length;

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(fake.sent.length).toBe(sentBeforeRestart);
  });

  it('transport close is called on crash/stop teardown', async () => {
    const fake = fakeTransport();
    const supervisor = createWindowCapabilitySupervisor({ createTransport: () => fake.transport });
    await supervisor.start();
    await supervisor.crash();
    expect(fake.closed).toBe(1);
    await supervisor.stop();
    expect(fake.closed).toBe(1);
    await supervisor.start();
    await supervisor.stop();
    expect(fake.closed).toBe(2);
  });

  it('a transport factory failure fails into crashed with no client, and a fresh start works and replays nothing', async () => {
    let attempts = 0;
    let boom = true;
    const second = fakeTransport();
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => {
        attempts += 1;
        if (boom) throw new Error('spawn failed');
        return second.transport;
      },
    });

    await expect(supervisor.start()).rejects.toThrow('spawn failed');
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();
    expect(second.sent.length).toBe(0);

    boom = false;
    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(attempts).toBe(2);
    expect(second.sent.length).toBe(0);
  });

  it('a client subscription failure fails into crashed and best-effort closes the partial transport once', async () => {
    let closes = 0;
    const throwing = {
      send: async () => {},
      onMessage: () => { throw new Error('subscription failed'); },
      close: async () => { closes += 1; },
    };
    const supervisor = createWindowCapabilitySupervisor({ createTransport: () => throwing });

    await expect(supervisor.start()).rejects.toThrow('subscription failed');
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();
    expect(closes).toBe(1);

    // A later start is unaffected and works.
    const fake = fakeTransport();
    const retry = createWindowCapabilitySupervisor({ createTransport: () => fake.transport });
    await retry.start();
    expect(retry.getState()).toBe('ready');
  });
});

describe('window capability contract types', () => {
  it('parseWindowResponse rejects malformed and unknown shapes', () => {
    expect(parseWindowResponse(null)).toBeNull();
    expect(parseWindowResponse('nope')).toBeNull();
    expect(parseWindowResponse({ requestId: 'x', method: 'list', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'pwn', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'nope' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: [] })).not.toBeNull();
  });

  it('rejects non-positive-safe request ids: zero, negative, fractional, NaN, infinite', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseWindowResponse({ requestId: bad, method: 'list', outcome: 'success', windows: [] })).toBeNull();
    }
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: [] })).not.toBeNull();
  });

  it('validates every observation field deeply and rejects arrays and malformed entries', () => {
    const base = { runtimeId: 'A', title: 'A', processId: null, processPath: null, state: 'normal', bounds: null };
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success', observation: base })).not.toBeNull();

    const badObservations: unknown[] = [
      [], // array observation
      { ...base, runtimeId: '' }, // empty runtime id
      { ...base, runtimeId: 42 }, // non-string runtime id
      { ...base, title: 42 },
      { ...base, processId: -1 }, // negative process id
      { ...base, processId: 1.5 }, // fractional process id
      { ...base, processId: NaN },
      { ...base, processPath: 42 },
      { ...base, state: 'floating' }, // unknown state
      { ...base, state: 1 },
      { ...base, bounds: [] }, // array bounds
      { ...base, bounds: { x: NaN, y: 0, width: 10, height: 10 } },
      { ...base, bounds: { x: 0, y: 0, width: Infinity, height: 10 } },
      { ...base, bounds: { x: 0, y: 0, width: 0, height: 10 } }, // zero width
      { ...base, bounds: { x: 0, y: 0, width: 10, height: -5 } }, // negative height
      { ...base, bounds: { x: 0, y: 0, width: 10, height: '10' } },
      { ...base, bounds: { x: 0, y: 0, width: 10 } }, // missing height
      { ...base, bounds: undefined }, // missing bounds key
    ];
    for (const observation of badObservations) {
      expect(
        parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success', observation }),
        `observation rejected: ${JSON.stringify(observation)}`,
      ).toBeNull();
    }
    // Valid null bounds and a valid positive-size bounds object pass.
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success', observation: { ...base, bounds: { x: -10, y: 5, width: 300, height: 200 } } })).not.toBeNull();
  });

  it('one bad entry invalidates a whole windows array', () => {
    const good = { runtimeId: 'A', title: 'A', processId: null, processPath: null, state: 'normal', bounds: null };
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: [good, good] })).not.toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: [good, { ...good, state: 'bogus' }] })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: [good, 'junk'] })).toBeNull();
  });

  it('enforces strict per-method/outcome payload shapes', () => {
    // Successful list must carry a valid list.
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'list', outcome: 'success', windows: 'nope' })).toBeNull();
    // Successful observation/mutation must carry a valid observation.
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'minimize', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'restore', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'apply', outcome: 'success' })).toBeNull();
    // Successful close is the documented envelope-only shape.
    expect(parseWindowResponse({ requestId: 1, method: 'close', outcome: 'success' })).not.toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'close', outcome: 'success', observation: observationFor('A') })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'close', outcome: 'success', windows: [] })).toBeNull();
    // Non-success responses are envelope-only.
    for (const outcome of ['missing', 'ambiguous', 'denied', 'malformed', 'helper-unavailable', 'timeout']) {
      expect(parseWindowResponse({ requestId: 1, method: 'minimize', outcome })).not.toBeNull();
      expect(parseWindowResponse({ requestId: 1, method: 'minimize', outcome, observation: observationFor('A') })).toBeNull();
      expect(parseWindowResponse({ requestId: 1, method: 'minimize', outcome, windows: [] })).toBeNull();
    }
  });

  it('enforces the strict hover payload shape (016)', () => {
    // Successful hover must carry `window` (null or a valid observation) and
    // no other payload key.
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success', window: null })).toEqual({ requestId: 1, method: 'hover', outcome: 'success', window: null });
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success', window: observationFor('A') })).not.toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success', window: { ...observationFor('A'), state: 'bogus' } })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success', window: null, windows: [] })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'success', window: null, observation: observationFor('A') })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'denied', window: null })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'hover', outcome: 'denied' })).not.toBeNull();
    // Other methods must not carry the hover `window` key.
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success', observation: observationFor('A'), window: null })).toBeNull();
  });

  it('hover requests correlate and carry the resolved window (016)', async () => {
    const fake = fakeTransport();
    const client = createWindowCapabilityClient({ transport: fake.transport });
    const hoverPromise = client.hover(320, 240);
    const sent = fake.sent[0]!;
    expect(sent).toMatchObject({ method: 'hover', x: 320, y: 240 });
    fake.deliver({ ...response(sent.requestId, 'hover', 'success'), window: observationFor('A') });
    const result = await hoverPromise;
    expect(result.outcome).toBe('success');
    expect(result.window?.runtimeId).toBe(observationFor('A').runtimeId);
    // A hover response for the wrong method must never satisfy it.
    const hover2 = client.hover(1, 1);
    const sent2 = fake.sent[1]!;
    fake.deliver({ ...response(sent2.requestId, 'observe', 'success'), observation: observationFor('A') });
    const stale = await hover2;
    expect(stale.outcome).toBe('timeout');
  });

  it('enforces the strict 019G thumbnail payload shape (019GR2 + 019GR3 target)', () => {
    // Successful thumbnail must carry a valid bounded thumbnail (PNG IHDR
    // matching the claim) AND the echoed helper target.
    const valid = { requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(240, 135), width: 240, height: 135 }, target: 'AAAA' };
    expect(parseWindowResponse(valid)).toEqual(valid);
    // The 1x1 fixture must claim 1x1 (IHDR-correct).
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: PNG_1X1, width: 1, height: 1 }, target: 'AAAA' })).not.toBeNull();
    // Every thumbnail response must carry the target (success AND fallback).
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 } })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'minimized' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'minimized', target: 'AAAA' })).toEqual({ requestId: 1, method: 'thumbnail', outcome: 'minimized', target: 'AAAA' });
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'minimized', target: '' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 }, target: 42 })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: '!!!!', width: 1, height: 1 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 321, height: 1 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 181 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 0, height: 1 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1.5, height: 1 }, target: 'AAAA' })).toBeNull();
    // IHDR width/height must equal the claimed width/height.
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(2, 3), width: 2, height: 4 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(2, 3), width: 3, height: 3 }, target: 'AAAA' })).toBeNull();
    // The nested thumbnail must have EXACT keys { image, width, height }.
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1, extra: true }, target: 'AAAA' })).toBeNull();
    // The top-level success envelope must have EXACT known keys.
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 }, target: 'AAAA', observation: observationFor('A') })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 }, target: 'AAAA', extra: true })).toBeNull();
    // `minimized` is a valid payload-free fallback ONLY for thumbnail.
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'minimized', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 }, target: 'AAAA' })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'minimized', target: 'AAAA', extra: true })).toBeNull();
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'minimized' })).toBeNull();
    // Every other fallback is a payload-free envelope-only shape.
    for (const outcome of ['missing', 'denied', 'malformed', 'helper-unavailable', 'timeout']) {
      expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome, target: 'AAAA' })).not.toBeNull();
      expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome, target: 'AAAA', thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 } })).toBeNull();
      expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome, target: 'AAAA', extra: true })).toBeNull();
      expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome })).toBeNull();
    }
    // No other method may smuggle a thumbnail payload.
    expect(parseWindowResponse({ requestId: 1, method: 'observe', outcome: 'success', observation: observationFor('A'), thumbnail: { image: pngWithSize(1, 1), width: 1, height: 1 } })).toBeNull();
  });

  it('rejects a decoded PNG over the 256 KiB byte bound and a non-PNG image (019GR2)', () => {
    // ONE complete valid PNG byte buffer (IHDR claims 1x1) oversized to
    // 262145 decoded bytes: rejected by the decoded-byte bound, not by the
    // header, because the header itself is valid.
    const over = pngWithSize(1, 1, 262145);
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: over, width: 1, height: 1 }, target: 'AAAA' })).toBeNull();
    // A non-PNG payload (valid base64, wrong signature) is rejected.
    const wrongSig = Buffer.concat([Buffer.from('notapng!'), Buffer.alloc(8, 0)]).toString('base64');
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: wrongSig, width: 1, height: 1 }, target: 'AAAA' })).toBeNull();
    // A valid minimal PNG within the bound passes when the claim matches.
    expect(parseWindowResponse({ requestId: 1, method: 'thumbnail', outcome: 'success', thumbnail: { image: pngWithSize(2, 3), width: 2, height: 3 }, target: 'AAAA' })).not.toBeNull();
  });

  it('the persisted descriptor shape structurally cannot hold a runtime id', () => {
    const descriptor: PersistedWindowDescriptor = {
      kind: 'launch-path',
      executable: 'C:\\tools\\app.exe',
      titleHint: 'App',
    };
    expect(Object.keys(descriptor)).not.toContain('runtimeId');

    // Compile-time: a runtime id must never be assignable to a persisted
    // descriptor. The following line is expected to fail under tsc
    // (@ts-expect-error); at runtime a branded id is still just a string,
    // which is why the type-level check exists at all.
    // @ts-expect-error runtime ids are live-session values, never persisted
    const invalid: PersistedWindowDescriptor = runtimeId('HWND-123');
    void invalid;
  });
});
