import { describe, expect, it } from 'vitest';

import { createJsonLineTransport } from '../../src/main/windows/jsonLineTransport';
import type { RuntimeWindowId, WindowRequestMessage } from '../../src/main/windows/windowCapabilityTypes';

function runtimeId(value: string): RuntimeWindowId {
  return value as RuntimeWindowId;
}

/** In-memory writable endpoint with switchable backpressure and failure. */
function fakeSink() {
  const writes: Uint8Array[] = [];
  let drainCb: (() => void) | null = null;
  let backpressure = false;
  let failOnWrite: Error | null = null;
  let asyncReject = false;
  let ended = 0;
  return {
    sink: {
      write(bytes: Uint8Array) {
        if (failOnWrite) {
          if (asyncReject) return Promise.reject(failOnWrite);
          throw failOnWrite;
        }
        writes.push(bytes);
        return backpressure ? false : true;
      },
      onDrain(cb: () => void) {
        drainCb = cb;
      },
      end() {
        ended += 1;
      },
    },
    writes,
    drain() {
      drainCb?.();
    },
    setBackpressure(value: boolean) {
      backpressure = value;
    },
    failWrite(error: Error, async = false) {
      failOnWrite = error;
      asyncReject = async;
    },
    get ended() {
      return ended;
    },
  };
}

/** In-memory readable endpoint; the test pushes chunks and EOF. */
function fakeSource() {
  let chunkCb: ((chunk: Uint8Array) => void) | null = null;
  let endCb: ((error?: Error) => void) | null = null;
  let ended = 0;
  return {
    source: {
      onChunk(cb: (chunk: Uint8Array) => void) {
        chunkCb = cb;
      },
      onEnd(cb: (error?: Error) => void) {
        endCb = cb;
      },
      end() {
        ended += 1;
      },
    },
    push(bytes: Uint8Array) {
      chunkCb?.(bytes);
    },
    pushText(text: string) {
      this.push(new TextEncoder().encode(text));
    },
    finish(error?: Error) {
      endCb?.(error);
    },
    get ended() {
      return ended;
    },
  };
}

function harness() {
  const sink = fakeSink();
  const source = fakeSource();
  const transport = createJsonLineTransport({ sink: sink.sink, source: source.source });
  const messages: unknown[] = [];
  const terminals: Array<Error | undefined> = [];
  transport.onMessage((raw) => messages.push(raw));
  transport.onTerminal?.((error) => terminals.push(error));
  return { transport, sink, source, messages, terminals };
}

function request(message: Partial<WindowRequestMessage> = {}): WindowRequestMessage {
  return { requestId: 1, method: 'list', ...message };
}

const observationJson = JSON.stringify({
  runtimeId: 'A',
  title: 'A',
  processId: null,
  processPath: null,
  state: 'normal',
  bounds: null,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('json-line transport framing', () => {
  it('serializes outbound messages as UTF-8 JSON followed by exactly one newline', async () => {
    const h = harness();
    await h.transport.send(request({ requestId: 7, method: 'close', target: runtimeId('A') }));
    expect(h.sink.writes.length).toBe(1);
    const text = new TextDecoder().decode(h.sink.writes[0]);
    expect(text).toBe(`${JSON.stringify({ requestId: 7, method: 'close', target: 'A' })}\n`);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.slice(0, -1).includes('\n')).toBe(false);
  });

  it('delivers fragmented UTF-8 and JSON split across arbitrary chunk boundaries', async () => {
    const h = harness();
    const line = `${JSON.stringify({ requestId: 2, method: 'observe', outcome: 'success', observation: JSON.parse(observationJson) })}\n`;
    const bytes = new TextEncoder().encode(line);
    for (const byte of bytes) {
      h.source.push(Uint8Array.of(byte));
    }
    await wait(5);
    expect(h.messages.length).toBe(1);
    expect(h.messages[0]).toMatchObject({ requestId: 2, method: 'observe', outcome: 'success' });
  });

  it('handles multiple coalesced lines in one chunk and LF/CRLF mixtures in order', async () => {
    const h = harness();
    const lineA = `${JSON.stringify({ requestId: 1, method: 'list', outcome: 'success', windows: [] })}\n`;
    const lineB = `${JSON.stringify({ requestId: 2, method: 'close', outcome: 'success' })}\r\n`;
    const lineC = `${JSON.stringify({ requestId: 3, method: 'observe', outcome: 'missing' })}\n`;
    h.source.pushText(`${lineA}${lineB}${lineC}`);
    await wait(5);
    expect(h.messages.map((m) => (m as { requestId: number }).requestId)).toEqual([1, 2, 3]);
  });

  it('delivers a UTF-8 character split across chunks', async () => {
    const h = harness();
    const observation = { ...JSON.parse(observationJson), title: 'Ưindow café' };
    const line = `${JSON.stringify({ requestId: 1, method: 'observe', outcome: 'success', observation })}\n`;
    const bytes = new TextEncoder().encode(line);
    const mid = Math.floor(bytes.byteLength / 2);
    h.source.push(bytes.subarray(0, mid));
    h.source.push(bytes.subarray(mid));
    await wait(5);
    expect(h.messages.length).toBe(1);
    expect((h.messages[0] as { observation: { title: string } }).observation.title).toBe('Ưindow café');
  });

  it('ignores empty lines, malformed JSON and schema-invalid lines fail-closed', async () => {
    const h = harness();
    h.source.pushText('\n');
    h.source.pushText('not-json\n');
    h.source.pushText('{"requestId":1,"method":"pwn","outcome":"success"}\n');
    h.source.pushText(`${JSON.stringify({ requestId: 5, method: 'minimize', outcome: 'success' })}\n`); // success without observation
    h.source.pushText(`${JSON.stringify({ requestId: 6, method: 'close', outcome: 'success' })}\n`);
    await wait(5);
    expect(h.messages.length).toBe(1);
    expect(h.messages[0]).toMatchObject({ requestId: 6, outcome: 'success' });
    expect(h.terminals.length).toBe(0);
  });
});

describe('json-line transport byte limits', () => {
  it('accepts a line exactly at the byte limit and terminates at limit+1', async () => {
    const content = JSON.stringify({ requestId: 9, method: 'close', outcome: 'success' });
    const contentBytes = new TextEncoder().encode(content).byteLength;

    const sink = fakeSink();
    const source = fakeSource();
    const transport = createJsonLineTransport({ sink: sink.sink, source: source.source, maxLineBytes: contentBytes });
    const terminals: Array<Error | undefined> = [];
    const messages: unknown[] = [];
    transport.onMessage((raw) => messages.push(raw));
    transport.onTerminal?.((error) => terminals.push(error));
    source.pushText(`${content}\n`);
    expect(terminals.length).toBe(0);
    expect(messages.length).toBe(1);

    const sink2 = fakeSink();
    const source2 = fakeSource();
    const transport2 = createJsonLineTransport({ sink: sink2.sink, source: source2.source, maxLineBytes: contentBytes });
    const terminals2: Array<Error | undefined> = [];
    transport2.onTerminal?.((error) => terminals2.push(error));
    source2.pushText(`${content}x\n`); // one byte over the limit
    expect(terminals2.length).toBe(1);
    expect(terminals2[0]?.message).toContain('payload exceeds');
  });

  it('terminates on an oversized line and on an unterminated oversized buffer', async () => {
    // 17 bytes with no LF exceeds the payload line cap -> terminal.
    const sink = fakeSink();
    const source = fakeSource();
    const transport = createJsonLineTransport({ sink: sink.sink, source: source.source, maxLineBytes: 16, maxReceiveBufferBytes: 32 });
    const terminals: Array<Error | undefined> = [];
    transport.onTerminal?.((error) => terminals.push(error));
    source.push(new Uint8Array(17).fill(0x61));
    expect(terminals.length).toBe(1);
    expect(terminals[0]?.message).toContain('payload exceeds');

    // An unfinished buffer over the buffer cap is terminal even while the
    // content stays under the line cap (trailing CRs are possible
    // delimiters, so they do not count toward the payload cap).
    const sink2 = fakeSink();
    const source2 = fakeSource();
    const transport2 = createJsonLineTransport({ sink: sink2.sink, source: source2.source, maxLineBytes: 64, maxReceiveBufferBytes: 64 });
    const terminals2: Array<Error | undefined> = [];
    transport2.onTerminal?.((error) => terminals2.push(error));
    source2.pushText(`${'a'.repeat(63)}\r\r`);
    expect(terminals2.length).toBe(1);
    expect(terminals2[0]?.message).toContain('receive buffer');
  });

  it('rejects an outbound payload over the byte limit without terminating the transport', async () => {
    const h = harness();
    await expect(h.transport.send(request({ requestId: 1, method: 'list' }))).resolves.toBeUndefined();
    const small = createJsonLineTransport({ sink: h.sink.sink, source: h.source.source, maxLineBytes: 8 });
    await expect(small.send(request({ requestId: 2, method: 'list' }))).rejects.toThrow('outbound line payload exceeds');
    expect(h.terminals.length).toBe(0);
  });

  it('maxLineBytes is the UTF-8 JSON payload cap, excluding the LF/CRLF delimiter, inbound and outbound', async () => {
    const content = JSON.stringify({ requestId: 9, method: 'close', outcome: 'success' });
    const payloadBytes = new TextEncoder().encode(content).byteLength;

    // Exact payload cap passes with both LF and CRLF framing.
    for (const framing of ['\n', '\r\n']) {
      const sink = fakeSink();
      const source = fakeSource();
      const transport = createJsonLineTransport({ sink: sink.sink, source: source.source, maxLineBytes: payloadBytes });
      const messages: unknown[] = [];
      transport.onMessage((raw) => messages.push(raw));
      source.pushText(`${content}${framing}`);
      expect(messages.length).toBe(1);
    }

    // Payload cap + 1 fails, with the CR counted only once it is proven not
    // to be a delimiter.
    const overSink = fakeSink();
    const overSource = fakeSource();
    const over = createJsonLineTransport({ sink: overSink.sink, source: overSource.source, maxLineBytes: payloadBytes });
    const overTerminals: Array<Error | undefined> = [];
    over.onTerminal?.((error) => overTerminals.push(error));
    overSource.pushText(`${content}x\n`);
    expect(overTerminals.length).toBe(1);

    // A payload of exactly cap bytes followed by CR and then a non-LF byte:
    // the CR becomes payload and the cap is re-checked fail-closed.
    const crSink = fakeSink();
    const crSource = fakeSource();
    const cr = createJsonLineTransport({ sink: crSink.sink, source: crSource.source, maxLineBytes: payloadBytes });
    const crTerminals: Array<Error | undefined> = [];
    cr.onTerminal?.((error) => crTerminals.push(error));
    crSource.pushText(`${content}\rx\n`); // CR proves it was payload -> cap+1
    expect(crTerminals.length).toBe(1);

    // Outbound: the exact payload succeeds even though the appended LF makes
    // the frame one byte larger.
    const outMessage = request({ requestId: 10, method: 'close' });
    const outSink = fakeSink();
    const outSource = fakeSource();
    const outbound = createJsonLineTransport({
      sink: outSink.sink,
      source: outSource.source,
      maxLineBytes: new TextEncoder().encode(JSON.stringify(outMessage)).byteLength,
    });
    await expect(outbound.send(outMessage)).resolves.toBeUndefined();
    const frame = new TextDecoder().decode(outSink.writes[0]);
    expect(frame.endsWith('\n')).toBe(true);
    expect(frame.length).toBe(JSON.stringify(outMessage).length + 1);
  });

  it('invalid limit configuration throws before any endpoint subscription', () => {
    const sink = fakeSink();
    const source = fakeSource();
    for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => createJsonLineTransport({ sink: sink.sink, source: source.source, maxLineBytes: bad }))
        .toThrow('positive safe integer');
    }
    expect(() => createJsonLineTransport({ sink: sink.sink, source: source.source, maxReceiveBufferBytes: 0 }))
      .toThrow('positive safe integer');
    expect(() => createJsonLineTransport({
      sink: sink.sink,
      source: source.source,
      maxLineBytes: 64,
      maxReceiveBufferBytes: 32,
    })).toThrow('at least');
    expect(source.ended).toBe(0);
    expect(sink.ended).toBe(0);
  });
});

describe('json-line transport backpressure and terminal lifecycle', () => {
  it('send waits for drain after a backpressured write and resolves once drained', async () => {
    const h = harness();
    h.sink.setBackpressure(true);
    let resolved = false;
    const pending = h.transport.send(request()).then(() => { resolved = true; });
    await wait(10);
    expect(resolved).toBe(false);

    h.sink.drain();
    await pending;
    expect(resolved).toBe(true);
  });

  it('serializes outbound sends: no write runs before drain while backpressured; order preserved after', async () => {
    const h = harness();
    h.sink.setBackpressure(true);
    const first = h.transport.send(request({ requestId: 1, method: 'list' }));
    const second = h.transport.send(request({ requestId: 2, method: 'close' }));
    await wait(10);
    expect(h.sink.writes.length).toBe(1);

    h.sink.setBackpressure(false);
    h.sink.drain();
    await Promise.all([first, second]);
    expect(h.sink.writes.length).toBe(2);
    const texts = h.sink.writes.map((w) => new TextDecoder().decode(w));
    expect(texts[0]).toContain('"requestId":1');
    expect(texts[1]).toContain('"requestId":2');
  });

  it('consecutive CR payload bytes are rechecked against the line cap immediately', () => {
    // maxReceiveBufferBytes is materially larger than maxLineBytes, so only
    // the LINE cap can fire: 17 CRs make 16 payload bytes (no terminal),
    // the 18th CR makes 17 payload bytes -> terminal at exactly cap+1 with
    // the line-payload reason, never the receive-buffer reason.
    const sink = fakeSink();
    const source = fakeSource();
    const transport = createJsonLineTransport({ sink: sink.sink, source: source.source, maxLineBytes: 16, maxReceiveBufferBytes: 256 });
    const terminals: Array<Error | undefined> = [];
    transport.onTerminal?.((error) => terminals.push(error));

    source.pushText('\r'.repeat(17));
    expect(terminals.length).toBe(0);

    source.pushText('\r');
    expect(terminals.length).toBe(1);
    expect(terminals[0]?.message).toContain('payload exceeds');
    expect(terminals[0]?.message).not.toContain('receive buffer');

    source.pushText('\r'.repeat(50));
    expect(terminals.length).toBe(1);
  });

  it('a never-settling async write is promptly rejected by EOF and by explicit close', async () => {
    const make = () => {
      let resolveStarted!: () => void;
      const writeStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
      let writeCalls = 0;
      const sink = {
        write: () => {
          writeCalls += 1;
          resolveStarted();
          return new Promise<boolean>(() => {}); // never settles
        },
        onDrain: () => {},
        end: () => {},
      };
      const source = fakeSource();
      const transport = createJsonLineTransport({ sink, source: source.source });
      const send = transport.send(request());
      return { transport, source, send, writeStarted, getWriteCalls: () => writeCalls };
    };

    const byEof = make();
    await byEof.writeStarted; // the active write-acceptance phase is in flight
    byEof.source.finish();
    await expect(Promise.race([
      byEof.send,
      wait(200).then(() => 'TIMEOUT' as const),
    ])).rejects.toThrow(/transport/); // rejects before the timeout, never 'TIMEOUT'
    expect(byEof.getWriteCalls()).toBe(1);

    const byClose = make();
    await byClose.writeStarted;
    await byClose.transport.close();
    await expect(Promise.race([
      byClose.send,
      wait(200).then(() => 'TIMEOUT' as const),
    ])).rejects.toThrow(/transport/);
    expect(byClose.getWriteCalls()).toBe(1);
  });

  it('rejects a send waiting on drain when the transport terminates', async () => {
    const h = harness();
    h.sink.setBackpressure(true);
    const pending = h.transport.send(request());
    h.source.finish(); // EOF while the send is in flight
    await expect(pending).rejects.toThrow(/transport/);
    expect(h.terminals.length).toBe(1);
  });

  it('terminal while one send is active and another queued rejects both, with no later write', async () => {
    const h = harness();
    h.sink.setBackpressure(true);
    const active = h.transport.send(request({ requestId: 1, method: 'list' }));
    const queued = h.transport.send(request({ requestId: 2, method: 'close' }));
    await wait(5);
    expect(h.sink.writes.length).toBe(1);

    h.source.finish(new Error('read failed'));
    await expect(active).rejects.toThrow('read failed');
    await expect(queued).rejects.toThrow('read failed');
    expect(h.sink.writes.length).toBe(1);
    expect(h.terminals.length).toBe(1);
    expect(h.sink.ended).toBe(1);
    expect(h.source.ended).toBe(1);
  });

  it('a late terminal observer receives the preserved terminal cause exactly once', () => {
    const h = harness();
    h.source.finish(new Error('read failed'));
    const late: Array<Error | undefined> = [];
    h.transport.onTerminal?.((error) => late.push(error));
    expect(late.length).toBe(1);
    expect(late[0]?.message).toBe('read failed');
    expect(late.length).toBe(1);
  });

  it('sync and async write failures reject the send and are terminal once', async () => {
    const sync = harness();
    sync.sink.failWrite(new Error('sync write failed'));
    await expect(sync.transport.send(request())).rejects.toThrow('sync write failed');
    expect(sync.terminals.length).toBe(1);

    const async = harness();
    async.sink.failWrite(new Error('async write failed'), true);
    await expect(async.transport.send(request())).rejects.toThrow('async write failed');
    expect(async.terminals.length).toBe(1);
    await wait(5);
    expect(async.terminals.length).toBe(1);
  });

  it('EOF, read error and explicit close are terminal once; later chunks are ignored', async () => {
    for (const mode of ['eof', 'error', 'close'] as const) {
      const h = harness();
      if (mode === 'eof') h.source.finish();
      if (mode === 'error') h.source.finish(new Error('read failed'));
      if (mode === 'close') await h.transport.close();
      expect(h.terminals.length).toBe(1);

      // Later chunks and another terminal are ignored.
      h.source.pushText(`${JSON.stringify({ requestId: 1, method: 'close', outcome: 'success' })}\n`);
      h.source.finish();
      expect(h.messages.length).toBe(0);
      expect(h.terminals.length).toBe(1);
      expect(h.sink.ended).toBe(1);
      expect(h.source.ended).toBe(1);
    }
  });

  it('sends reject after terminal, retaining the terminal cause', async () => {
    const h = harness();
    h.source.finish(new Error('read failed'));
    await expect(h.transport.send(request())).rejects.toThrow('read failed');
  });
});

describe('json-line transport through the supervisor', () => {
  it('an unexpected transport terminal crashes the supervisor and rejects pending requests exactly once', async () => {
    const { createWindowCapabilityClient } = await import('../../src/main/windows/windowCapabilityClient');
    const { createWindowCapabilitySupervisor } = await import('../../src/main/windows/windowCapabilitySupervisor');
    const sink = fakeSink();
    const source = fakeSource();
    let transport: ReturnType<typeof createJsonLineTransport> | null = null;
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => {
        transport = createJsonLineTransport({ sink: sink.sink, source: source.source });
        return transport;
      },
      timeoutMs: 60_000,
    });
    await supervisor.start();
    const client = supervisor.getClient();
    if (!client) throw new Error('client missing');
    void createWindowCapabilityClient;

    const pending = client.minimize(runtimeId('A'));
    source.finish(); // EOF -> transport terminal -> supervisor crashed
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();
    await expect(pending).resolves.toMatchObject({ outcome: 'helper-unavailable' });
  });

  it('clean stop stays stopped and a fresh restart sends nothing', async () => {
    const { createWindowCapabilitySupervisor } = await import('../../src/main/windows/windowCapabilitySupervisor');
    const sink = fakeSink();
    const source = fakeSource();
    let transport: ReturnType<typeof createJsonLineTransport> | null = null;
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => {
        transport = createJsonLineTransport({ sink: sink.sink, source: source.source });
        return transport;
      },
      timeoutMs: 60_000,
    });
    await supervisor.start();
    const client = supervisor.getClient();
    if (!client) throw new Error('client missing');
    const pending = client.restore(runtimeId('B'));
    await supervisor.stop();
    expect(supervisor.getState()).toBe('stopped');
    expect(supervisor.getClient()).toBeNull();
    await expect(pending).resolves.toMatchObject({ outcome: 'helper-unavailable' });
    const sentBefore = sink.writes.length;

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(sink.writes.length).toBe(sentBefore);
    expect(transport).not.toBeNull();
  });

  it('an onTerminal subscription throw rejects start; the SAME supervisor then starts fresh with a healthy transport and replays nothing', async () => {
    const { createWindowCapabilitySupervisor } = await import('../../src/main/windows/windowCapabilitySupervisor');
    let closes = 0;
    let attempts = 0;
    const healthySink = fakeSink();
    const healthySource = fakeSource();
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            send: async () => {},
            onMessage: () => {},
            close: async () => { closes += 1; },
            onTerminal: () => { throw new Error('subscription failed'); },
          };
        }
        return createJsonLineTransport({ sink: healthySink.sink, source: healthySource.source });
      },
    });

    await expect(supervisor.start()).rejects.toThrow('subscription failed');
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();
    expect(closes).toBe(1);

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(supervisor.getClient()).not.toBeNull();
    expect(attempts).toBe(2);
    expect(healthySink.writes.length).toBe(0);
  });

  it('a transport already terminal before registration rejects start; the SAME supervisor then starts fresh and works', async () => {
    const { createWindowCapabilitySupervisor } = await import('../../src/main/windows/windowCapabilitySupervisor');
    let attempts = 0;
    const freshSink = fakeSink();
    const freshSource = fakeSource();
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => {
        attempts += 1;
        if (attempts === 1) {
          const sink = fakeSink();
          const source = fakeSource();
          const transport = createJsonLineTransport({ sink: sink.sink, source: source.source });
          source.finish(new Error('already dead')); // terminal BEFORE the supervisor starts
          return transport;
        }
        return createJsonLineTransport({ sink: freshSink.sink, source: freshSource.source });
      },
    });

    await expect(supervisor.start()).rejects.toThrow('already dead');
    expect(supervisor.getState()).toBe('crashed');
    expect(supervisor.getClient()).toBeNull();

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(supervisor.getClient()).not.toBeNull();
    expect(attempts).toBe(2);
    expect(freshSink.writes.length).toBe(0);
  });
});
