import { describe, expect, it } from 'vitest';

import { createHelperProcessTransport, type ChildLikeProcess } from '../../src/main/windows/helperProcessTransport';
import type { TransportSink, TransportSource } from '../../src/main/windows/jsonLineTransport';

function fakeSink() {
  const writes: Uint8Array[] = [];
  let drainCb: (() => void) | null = null;
  let errorCb: ((error: Error) => void) | null = null;
  let backpressure = false;
  let failOnWrite: Error | null = null;
  let asyncReject = false;
  let ended = 0;
  let drainCalls = 0;
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
      onError(cb: (error: Error) => void) {
        errorCb = cb;
      },
      end() {
        ended += 1;
      },
    },
    writes,
    drain() {
      drainCalls += 1;
      drainCb?.();
    },
    emitError(error: Error) {
      errorCb?.(error);
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
    get drainCalls() {
      return drainCalls;
    },
  };
}

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

function fakeChild() {
  const stdin = fakeSink();
  const stdout = fakeSource();
  const stderr = fakeSource();
  const exitCbs: Array<(code: number | null, signal: string | null) => void> = [];
  const errorCbs: Array<(error: Error) => void> = [];
  let kills = 0;
  const child: ChildLikeProcess = {
    stdin: stdin.sink,
    stdout: stdout.source,
    stderr: stderr.source,
    onExit(cb) {
      exitCbs.push(cb);
    },
    onError(cb) {
      errorCbs.push(cb);
    },
    kill() {
      kills += 1;
    },
  };
  return {
    child,
    stdin,
    stdout,
    stderr,
    exit: (code: number | null, signal: string | null = null) => {
      for (const cb of [...exitCbs]) cb(code, signal);
    },
    error: (error: Error) => {
      for (const cb of [...errorCbs]) cb(error);
    },
    getKills: () => kills,
  };
}

function harness(overrides: Partial<Parameters<typeof createHelperProcessTransport>[0]> = {}) {
  const fake = fakeChild();
  const transport = createHelperProcessTransport({
    createProcess: () => fake.child,
    ...overrides,
  });
  const messages: unknown[] = [];
  const terminals: Array<Error | undefined> = [];
  transport.onMessage((raw) => messages.push(raw));
  transport.onTerminal?.((error) => terminals.push(error));
  return { transport, fake, messages, terminals };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const closeLine = `${JSON.stringify({ requestId: 1, method: 'close', outcome: 'success' })}\n`;
const observeLine = `${JSON.stringify({
  requestId: 2,
  method: 'observe',
  outcome: 'success',
  observation: { runtimeId: 'A', title: 'A', processId: null, processPath: null, state: 'normal', bounds: null },
})}\n`;

describe('helper-process transport: stream adaptation', () => {
  it('adapts fragmented and coalesced stdout through the existing framing/schema gate', async () => {
    const h = harness();
    const bytes = new TextEncoder().encode(`${observeLine}${closeLine}`);
    const mid = Math.floor(bytes.byteLength / 2);
    h.fake.stdout.push(bytes.subarray(0, mid));
    h.fake.stdout.push(bytes.subarray(mid));
    await wait(5);
    expect(h.messages.map((m) => (m as { requestId: number }).requestId)).toEqual([2, 1]);
  });

  it('adapts stdin backpressure faithfully: false write waits for drain', async () => {
    const h = harness();
    h.fake.stdin.setBackpressure(true);
    let resolved = false;
    const pending = h.transport.send({ requestId: 9, method: 'list' }).then(() => { resolved = true; });
    await wait(10);
    expect(resolved).toBe(false);
    h.fake.stdin.drain();
    await pending;
    expect(resolved).toBe(true);
  });

  it('adapts sync and async stdin write failures as terminal once', async () => {
    const sync = harness();
    sync.fake.stdin.failWrite(new Error('sync stdin failure'));
    await expect(sync.transport.send({ requestId: 1, method: 'list' })).rejects.toThrow('sync stdin failure');
    expect(sync.terminals.length).toBe(1);

    const async = harness();
    async.fake.stdin.failWrite(new Error('async stdin failure'), true);
    await expect(async.transport.send({ requestId: 1, method: 'list' })).rejects.toThrow('async stdin failure');
    expect(async.terminals.length).toBe(1);
    expect(async.fake.getKills()).toBe(1);
  });

  it('adapts outbound requests onto the child stdin', async () => {
    const h = harness();
    await h.transport.send({ requestId: 7, method: 'close', target: 'A' as never });
    const text = new TextDecoder().decode(h.fake.stdin.writes[0]);
    expect(text).toBe(`${JSON.stringify({ requestId: 7, method: 'close', target: 'A' })}\n`);
  });
});

describe('helper-process transport: terminal arbitration', () => {
  it('stdout EOF, stdout error, child error and child exit collapse to one terminal with the first cause', async () => {
    const byEof = harness();
    byEof.fake.stdout.finish();
    expect(byEof.terminals.length).toBe(1);
    byEof.fake.exit(1);
    expect(byEof.terminals.length).toBe(1);

    const byError = harness();
    byError.fake.error(new Error('child error cause'));
    expect(byError.terminals.length).toBe(1);
    expect(byError.terminals[0]?.message).toBe('child error cause');
    byError.fake.stdout.finish();
    expect(byError.terminals.length).toBe(1);

    const byExit = harness();
    byExit.fake.exit(3);
    expect(byExit.terminals.length).toBe(1);
    expect(byExit.terminals[0]?.message).toContain('code 3');
    byExit.fake.error(new Error('later'));
    expect(byExit.terminals.length).toBe(1);
  });

  it('every terminal order terminates the child exactly once and closes endpoints at most once', async () => {
    for (const order of ['exit-first', 'error-first', 'eof-first'] as const) {
      const h = harness();
      if (order === 'exit-first') h.fake.exit(0);
      if (order === 'error-first') h.fake.error(new Error('boom'));
      if (order === 'eof-first') h.fake.stdout.finish();
      h.fake.exit(0);
      h.fake.error(new Error('boom'));
      h.fake.stdout.finish();
      expect(h.terminals.length).toBe(1);
      expect(h.fake.getKills()).toBe(1);
      expect(h.fake.stdin.ended).toBe(1);
      expect(h.fake.stdout.ended).toBe(1);
    }
  });

  it('explicit close is idempotent: twice ends/terminates once, events after close do nothing', async () => {
    const h = harness();
    await h.transport.close();
    await h.transport.close();
    expect(h.terminals.length).toBe(1);
    expect(h.fake.getKills()).toBe(1);
    expect(h.fake.stdin.ended).toBe(1);

    h.fake.stdout.pushText(closeLine);
    h.fake.exit(2);
    h.fake.error(new Error('after close'));
    h.fake.stdout.finish();
    expect(h.messages.length).toBe(0);
    expect(h.terminals.length).toBe(1);
    expect(h.fake.getKills()).toBe(1);
  });
});

describe('helper-process transport: construction failures', () => {
  it('factory throw exposes no transport', () => {
    expect(() => createHelperProcessTransport({
      createProcess: () => { throw new Error('factory failed'); },
    })).toThrow('factory failed');
  });

  it('missing required stdio terminates the partial child once and exposes no transport', () => {
    let kills = 0;
    const stdin = fakeSink();
    const stderr = fakeSource();
    const incomplete = {
      stdin: stdin.sink,
      stderr: stderr.source,
      onExit: () => {},
      onError: () => {},
      kill: () => { kills += 1; },
    } as unknown as ChildLikeProcess;
    expect(() => createHelperProcessTransport({ createProcess: () => incomplete }))
      .toThrow('missing required stdio');
    expect(kills).toBe(1);
    expect(stdin.ended).toBe(1);
    expect(stderr.ended).toBe(1);
  });

  it('a missing or non-function method in ANY required stream group fails construction closed, ends available endpoints and kills once', () => {
    const cases: Array<{ name: string; breakIt: (c: ChildLikeProcess) => void }> = [
      { name: 'stdin.write', breakIt: (c) => { (c.stdin as { write?: unknown }).write = undefined; } },
      { name: 'stdin.onDrain', breakIt: (c) => { (c.stdin as { onDrain?: unknown }).onDrain = undefined; } },
      { name: 'stdin.onError', breakIt: (c) => { (c.stdin as { onError?: unknown }).onError = undefined; } },
      { name: 'stdin.end', breakIt: (c) => { (c.stdin as { end?: unknown }).end = undefined; } },
      { name: 'stdout.onChunk', breakIt: (c) => { (c.stdout as { onChunk?: unknown }).onChunk = undefined; } },
      { name: 'stdout.onEnd', breakIt: (c) => { (c.stdout as { onEnd?: unknown }).onEnd = undefined; } },
      { name: 'stdout.end', breakIt: (c) => { (c.stdout as { end?: unknown }).end = undefined; } },
      { name: 'stderr.onChunk', breakIt: (c) => { (c.stderr as { onChunk?: unknown }).onChunk = undefined; } },
      { name: 'stderr.onEnd', breakIt: (c) => { (c.stderr as { onEnd?: unknown }).onEnd = undefined; } },
      { name: 'stderr.end', breakIt: (c) => { (c.stderr as { end?: unknown }).end = undefined; } },
      { name: 'process.onExit', breakIt: (c) => { (c as { onExit?: unknown }).onExit = undefined; } },
      { name: 'process.onError', breakIt: (c) => { (c as { onError?: unknown }).onError = undefined; } },
      { name: 'process.kill', breakIt: (c) => { (c as { kill?: unknown }).kill = undefined; } },
    ];
    for (const { name, breakIt } of cases) {
      const fake = fakeChild();
      breakIt(fake.child);
      expect(() => createHelperProcessTransport({ createProcess: () => fake.child }))
        .toThrow('missing required stdio');
      expect(fake.stdin.ended + fake.stdout.ended + fake.stderr.ended).toBeGreaterThanOrEqual(1);
      if (name === 'process.kill') {
        expect(fake.getKills()).toBe(0);
      } else {
        expect(fake.getKills()).toBe(1);
      }
    }
  });

  it('async promise-rejecting end() calls are best-effort: terminal once, every end called once, killed once, cause preserved', async () => {
    const fake = fakeChild();
    let stdinEnds = 0;
    let stdoutEnds = 0;
    let stderrEnds = 0;
    fake.stdin.sink.end = () => { stdinEnds += 1; return Promise.reject(new Error('async stdin end failed')); };
    fake.stdout.source.end = () => { stdoutEnds += 1; return Promise.reject(new Error('async stdout end failed')); };
    fake.stderr.source.end = () => { stderrEnds += 1; return Promise.reject(new Error('async stderr end failed')); };
    const transport = createHelperProcessTransport({ createProcess: () => fake.child });
    const terminals: Array<Error | undefined> = [];
    transport.onTerminal?.((error) => terminals.push(error));

    await transport.close();
    await wait(10); // bounded microtask turn for the rejected ends to settle
    expect(terminals.length).toBe(1);
    expect(terminals[0]?.message).toContain('transport closed');
    expect(stdinEnds).toBe(1);
    expect(stdoutEnds).toBe(1);
    expect(stderrEnds).toBe(1);
    expect(fake.getKills()).toBe(1);
  });

  it('stream subscription throw cleans partial ownership once', () => {
    let kills = 0;
    const throwingSink: TransportSink & { onError: (cb: (error: Error) => void) => void } = {
      write: () => true,
      onDrain: () => { throw new Error('subscription failed'); },
      onError: () => {},
      end: () => {},
    };
    const quietSource: TransportSource = {
      onChunk: () => {},
      onEnd: () => {},
      end: () => {},
    };
    const child: ChildLikeProcess = {
      stdin: throwingSink,
      stdout: quietSource,
      stderr: quietSource,
      onExit: () => {},
      onError: () => {},
      kill: () => { kills += 1; },
    };
    expect(() => createHelperProcessTransport({ createProcess: () => child }))
      .toThrow('subscription failed');
    expect(kills).toBe(1);
  });
});

describe('helper-process transport: bounded stderr diagnostics', () => {
  it('bounds stderr by encoded bytes, truncates deterministically, and never becomes a protocol message', async () => {
    // Below and exactly at the cap: full diagnostic preserved on exit.
    const below = harness({ maxStderrBytes: 8 });
    below.fake.stderr.pushText('abcd');
    below.fake.exit(1);
    expect(below.terminals[0]?.message).toContain('abcd');
    expect(below.messages.length).toBe(0);

    const exact = harness({ maxStderrBytes: 4 });
    exact.fake.stderr.pushText('wxyz');
    exact.fake.exit(1);
    expect(exact.terminals[0]?.message).toContain('wxyz');

    // Over the cap: truncated to 4 encoded bytes plus a marker, never the
    // excess.
    const over = harness({ maxStderrBytes: 4 });
    over.fake.stderr.pushText('abcdefghij');
    over.fake.exit(1);
    expect(over.terminals[0]?.message).toContain('abcd');
    expect(over.terminals[0]?.message).not.toContain('efghij');
    expect(over.messages.length).toBe(0);

    // Non-ASCII bytes are counted as encoded bytes, not characters.
    const utf8 = harness({ maxStderrBytes: 3 });
    utf8.fake.stderr.pushText('ééé'); // 2 bytes per char
    utf8.fake.exit(1);
    expect(utf8.terminals[0]?.message).not.toContain('ééé');
  });
});

describe('helper-process transport: supervisor integration and surface', () => {
  it('supervisor crash rejects pending once; same-supervisor restart creates a SECOND fake process and replays nothing', async () => {
    const { createWindowCapabilitySupervisor } = await import('../../src/main/windows/windowCapabilitySupervisor');
    const created: Array<ReturnType<typeof fakeChild>> = [];
    const supervisor = createWindowCapabilitySupervisor({
      createTransport: () => createHelperProcessTransport({
        createProcess: () => {
          const fake = fakeChild();
          created.push(fake);
          return fake.child;
        },
      }),
      timeoutMs: 60_000,
    });
    await supervisor.start();
    const client = supervisor.getClient();
    if (!client) throw new Error('client missing');

    const pending = client.minimize('A' as never);
    created[0]!.stdout.finish(); // terminal -> crashed
    expect(supervisor.getState()).toBe('crashed');
    await expect(pending).resolves.toMatchObject({ outcome: 'helper-unavailable' });
    expect(created[0]!.getKills()).toBe(1);
    const writesBefore = created[0]!.stdin.writes.length;

    await supervisor.start();
    expect(supervisor.getState()).toBe('ready');
    expect(created.length).toBe(2);
    expect(created[0]!.stdin.writes.length).toBe(writesBefore);
    expect(created[1]!.stdin.writes.length).toBe(0);
  });

  it('an independent stdin error is the first preserved terminal cause and collapses later signals', async () => {
    const h = harness();
    h.fake.stdin.emitError(new Error('stdin error cause'));
    expect(h.terminals.length).toBe(1);
    expect(h.terminals[0]?.message).toBe('stdin error cause');
    h.fake.stdout.finish();
    h.fake.error(new Error('later'));
    h.fake.exit(2);
    expect(h.terminals.length).toBe(1);
    expect(h.fake.getKills()).toBe(1);
  });

  it('an independent stdin error interrupts a write that already returned false and is awaiting drain', async () => {
    const h = harness();
    h.fake.stdin.setBackpressure(true);
    const pending = h.transport.send({ requestId: 1, method: 'list' });
    // Wait until the write was ACTUALLY invoked (proving the active
    // write/drain phase, not a queued pre-write send).
    for (let i = 0; i < 50 && h.fake.stdin.writes.length === 0; i += 1) {
      await wait(5);
    }
    expect(h.fake.stdin.writes.length).toBe(1);
    expect(h.fake.stdin.drainCalls).toBe(0);

    h.fake.stdin.emitError(new Error('stdin error cause'));
    await expect(pending).rejects.toThrow('stdin error cause');
    expect(h.fake.stdin.writes.length).toBe(1);
    expect(h.fake.stdin.drainCalls).toBe(0);
    expect(h.terminals.length).toBe(1);
    expect(h.terminals[0]?.message).toBe('stdin error cause');
    expect(h.fake.getKills()).toBe(1);
    expect(h.fake.stdin.ended).toBe(1);
    expect(h.fake.stdout.ended).toBe(1);
    expect(h.fake.stderr.ended).toBe(1);
  });

  it('every terminal path ends stdin, stdout and stderr at most once and kills once, even when ends throw', async () => {
    for (const trigger of ['close', 'eof', 'child-error', 'child-exit', 'stdin-error'] as const) {
      const h = harness();
      if (trigger === 'close') await h.transport.close();
      if (trigger === 'eof') h.fake.stdout.finish();
      if (trigger === 'child-error') h.fake.error(new Error('boom'));
      if (trigger === 'child-exit') h.fake.exit(1);
      if (trigger === 'stdin-error') h.fake.stdin.emitError(new Error('boom'));
      expect(h.terminals.length).toBe(1);
      expect(h.fake.getKills()).toBe(1);
      expect(h.fake.stdin.ended).toBe(1);
      expect(h.fake.stdout.ended).toBe(1);
      expect(h.fake.stderr.ended).toBe(1);
    }

    // End failures are best-effort: one kill and one terminal still happen.
    const throwing = fakeChild();
    throwing.stdin.sink.end = () => { throw new Error('end failed'); };
    throwing.stdout.source.end = () => { throw new Error('end failed'); };
    throwing.stderr.source.end = () => { throw new Error('end failed'); };
    const transport = createHelperProcessTransport({ createProcess: () => throwing.child });
    await transport.close();
    expect(throwing.getKills()).toBe(1);
  });

  it('stderr pushed after close is ignored and changes neither diagnostics nor terminal state', async () => {
    const h = harness();
    await h.transport.close();
    h.fake.stderr.pushText('ignored-after-close');
    h.fake.exit(1);
    h.fake.stderr.pushText('more');
    expect(h.terminals.length).toBe(1);
    expect(h.fake.getKills()).toBe(1);
    expect(h.messages.length).toBe(0);
  });

  it('invalid stderr caps and line/buffer caps throw before any factory invocation, subscription, end or kill', () => {
    let factoryCalls = 0;
    let kills = 0;
    const probe = () => {
      factoryCalls += 1;
      const fake = fakeChild();
      const child = fake.child;
      const originalKill = child.kill.bind(child);
      child.kill = () => { kills += 1; originalKill(); };
      return child;
    };
    for (const bad of [-1, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => createHelperProcessTransport({ createProcess: probe, maxStderrBytes: bad }))
        .toThrow('non-negative safe integer');
    }
    expect(() => createHelperProcessTransport({ createProcess: probe, maxLineBytes: -1 }))
      .toThrow('positive safe integer');
    expect(() => createHelperProcessTransport({ createProcess: probe, maxReceiveBufferBytes: 0 }))
      .toThrow('positive safe integer');
    expect(factoryCalls).toBe(0);
    expect(kills).toBe(0);
  });

  it('stderr cap 0 retains no diagnostic bytes but still marks deterministic truncation', async () => {
    const h = harness({ maxStderrBytes: 0 });
    h.fake.stderr.pushText('anything');
    h.fake.exit(1);
    expect(h.terminals[0]?.message).toContain('\u2026');
    expect(h.terminals[0]?.message).not.toContain('anything');
  });

  it('the returned transport exposes exactly the WindowTransport keys and module exports no launcher or raw handle', async () => {
    const fake = fakeChild();
    const transport = createHelperProcessTransport({ createProcess: () => fake.child });
    expect(Object.keys(transport).sort()).toEqual(['close', 'onMessage', 'onTerminal', 'send']);
    expect((transport as unknown as Record<string, unknown>)['child']).toBeUndefined();
    expect((transport as unknown as Record<string, unknown>)['stdin']).toBeUndefined();
    expect((transport as unknown as Record<string, unknown>)['stdout']).toBeUndefined();
    expect((transport as unknown as Record<string, unknown>)['stderr']).toBeUndefined();
    expect((transport as unknown as Record<string, unknown>)['kill']).toBeUndefined();

    const mod = await import('../../src/main/windows/helperProcessTransport');
    for (const key of Object.keys(mod)) {
      expect(key.toLowerCase()).not.toMatch(/spawn|exec|fork|launch/);
      const value = (mod as Record<string, unknown>)[key];
      if (typeof value === 'function') {
        expect((value as { name: string }).name.toLowerCase()).not.toMatch(/spawn|exec|fork|launch/);
      }
    }
  });
});
