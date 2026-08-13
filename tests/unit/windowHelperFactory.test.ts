import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createWindowHelperFactory, type WindowHelperStartSnapshot } from '../../src/main/windows/windowHelperFactory';
import {
  resolveWindowHelperResourcePaths,
  WINDOW_HELPER_PROTOCOL_VERSION,
  WINDOW_HELPER_SCRIPT_FILE,
  WINDOW_HELPER_ADAPTER_FILE,
  WINDOW_HELPER_EXPECTED_HASHES,
} from '../../src/main/windows/windowHelperResource';
import type { ChildLikeProcess } from '../../src/main/windows/helperProcessTransport';
import type { TransportSink, TransportSource } from '../../src/main/windows/jsonLineTransport';

const REPO_ROOT = path.join(__dirname, '../..');
const REAL_SYSTEM_ROOT = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';

function fakeSink(): {
  sink: TransportSink & { onError(cb: (error: Error) => void): void };
  writes: Uint8Array[];
  ended: number;
} {
  const writes: Uint8Array[] = [];
  let errorCb: ((error: Error) => void) | null = null;
  let ended = 0;
  return {
    sink: {
      write(bytes: Uint8Array) {
        writes.push(bytes);
        return true;
      },
      onDrain(cb: () => void) {
        void cb;
      },
      onError(cb: (error: Error) => void) {
        errorCb = cb;
      },
      end() {
        ended += 1;
      },
    },
    writes,
    get ended() {
      return ended;
    },
  };
}

function fakeSource(): { source: TransportSource; push(bytes: Uint8Array): void; pushText(text: string): void } {
  let chunkCb: ((chunk: Uint8Array) => void) | null = null;
  let endCb: ((error?: Error) => void) | null = null;
  return {
    source: {
      onChunk(cb: (chunk: Uint8Array) => void) {
        chunkCb = cb;
      },
      onEnd(cb: (error?: Error) => void) {
        endCb = cb;
      },
      end() {},
    },
    push(bytes: Uint8Array) {
      chunkCb?.(bytes);
    },
    pushText(text: string) {
      this.push(new TextEncoder().encode(text));
    },
  };
}

function fakeChild() {
  const stdin = fakeSink();
  const stdout = fakeSource();
  const stderr = fakeSource();
  const exitCbs: Array<(code: number | null, signal: string | null) => void> = [];
  const errorCbs: Array<(error: Error) => void> = [];
  const requests: Array<Record<string, unknown>> = [];
  let kills = 0;
  const sink = stdin.sink;
  sink.write = (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes).trim();
    if (text.length > 0) {
      requests.push(JSON.parse(text) as Record<string, unknown>);
    }
    return true;
  };
  const child: ChildLikeProcess = {
    stdin: sink,
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
    requests,
    exit: (code: number | null, signal: string | null = null) => {
      for (const cb of [...exitCbs]) cb(code, signal);
    },
    error: (error: Error) => {
      for (const cb of [...errorCbs]) cb(error);
    },
    getKills: () => kills,
  };
}

function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A temp directory with the canonical manifest but hash-invalid files:
 * guaranteed to fail resource validation while being structurally real. */
function invalidResourceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-factory-bad-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    protocolVersion: WINDOW_HELPER_PROTOCOL_VERSION,
    executable: 'powershell.exe',
    spawnArguments: ['-NoProfile', '-NonInteractive', '-File'],
    files: [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE],
    hashes: WINDOW_HELPER_EXPECTED_HASHES,
  }));
  fs.writeFileSync(path.join(dir, WINDOW_HELPER_SCRIPT_FILE), '# helper\n');
  fs.writeFileSync(path.join(dir, WINDOW_HELPER_ADAPTER_FILE), '# adapter\n');
  return dir;
}

function harness(overrides: Parameters<typeof createWindowHelperFactory>[0] = {}) {
  const fake = fakeChild();
  let spawns = 0;
  let resolverCalls = 0;
  const capturedSnapshots: WindowHelperStartSnapshot[] = [];
  const factory = createWindowHelperFactory({
    resolvePaths: () => {
      resolverCalls += 1;
      return resolveWindowHelperResourcePaths({ appPath: REPO_ROOT, resourcesPath: '', packaged: false });
    },
    createProcess: (snapshot) => {
      spawns += 1;
      capturedSnapshots.push(snapshot);
      return fake.child;
    },
    systemRoot: REAL_SYSTEM_ROOT,
    ...overrides,
  });
  return { fake, factory, getSpawns: () => spawns, getResolverCalls: () => resolverCalls, capturedSnapshots };
}

describe('windowHelperFactory composition', () => {
  it('starts ready with exactly one child and routes a list through the wire', async () => {
    const h = harness();
    expect(await h.factory.start()).toBe('ready');
    expect(h.getSpawns()).toBe(1);
    expect(h.getResolverCalls()).toBe(1);
    expect(h.factory.isReady()).toBe(true);

    const pending = h.factory.list();
    await drainMicrotasks();
    expect(h.fake.requests).toHaveLength(1);
    expect(h.fake.requests[0]).toMatchObject({ method: 'list' });

    const requestId = h.fake.requests[0]!['requestId'];
    h.fake.stdout.pushText(JSON.stringify({
      requestId,
      method: 'list',
      outcome: 'success',
      windows: [],
    }) + '\n');
    expect(await pending).toMatchObject({ outcome: 'success', windows: [] });
    await h.factory.stop();
  });

  it('start is idempotent: a ready start performs no second resolve, validation or spawn', async () => {
    const h = harness();
    expect(await h.factory.start()).toBe('ready');
    expect(await h.factory.start()).toBe('ready');
    expect(h.getResolverCalls()).toBe(1);
    expect(h.getSpawns()).toBe(1);
    await h.factory.stop();
  });

  it('concurrent starts coalesce onto exactly one resolve and one child', async () => {
    const h = harness();
    const outcomes = await Promise.all([h.factory.start(), h.factory.start(), h.factory.start()]);
    expect(outcomes).toEqual(['ready', 'ready', 'ready']);
    expect(h.getResolverCalls()).toBe(1);
    expect(h.getSpawns()).toBe(1);
    await h.factory.stop();
  });

  it('stop ends the child stdin and terminates the child exactly once', async () => {
    const h = harness();
    await h.factory.start();
    await h.factory.stop();
    expect(h.factory.isReady()).toBe(false);
    expect(h.fake.stdin.ended).toBe(1);
    expect(h.fake.getKills()).toBe(1);
  });

  it('an owned stop is idempotent', async () => {
    const h = harness();
    await h.factory.start();
    await h.factory.stop();
    await h.factory.stop();
    expect(h.fake.getKills()).toBe(1);
  });

  it('capability calls before start return helper-unavailable without touching the child', async () => {
    const h = harness();
    expect(await h.factory.list()).toMatchObject({ outcome: 'helper-unavailable' });
    expect(h.getSpawns()).toBe(0);
  });

  it('a crashed helper yields helper-unavailable and a restart validates once more and builds a fresh child without replay', async () => {
    const h = harness();
    await h.factory.start();

    const pending = h.factory.list();
    await drainMicrotasks();
    expect(h.fake.requests).toHaveLength(1);

    h.fake.exit(1, null);
    expect(await pending).toMatchObject({ outcome: 'helper-unavailable' });
    expect(h.factory.isReady()).toBe(false);
    expect(await h.factory.list()).toMatchObject({ outcome: 'helper-unavailable' });

    expect(await h.factory.start()).toBe('ready');
    expect(h.getResolverCalls()).toBe(2);
    expect(h.getSpawns()).toBe(2);
    expect(h.capturedSnapshots[0]).not.toBe(h.capturedSnapshots[1]);
    const second = h.factory.list();
    await drainMicrotasks();
    expect(h.fake.requests).toHaveLength(2);
    const requestId = h.fake.requests[1]!['requestId'];
    h.fake.stdout.pushText(JSON.stringify({
      requestId,
      method: 'list',
      outcome: 'success',
      windows: [],
    }) + '\n');
    expect(await second).toMatchObject({ outcome: 'success' });
    await h.factory.stop();
  });

  it('an invalid resource fails before any spawn (same-harness counter)', async () => {
    const dir = invalidResourceDir();
    const h = harness({
      resolvePaths: () => ({
        directory: dir,
        helperPath: path.join(dir, WINDOW_HELPER_SCRIPT_FILE),
        adapterPath: path.join(dir, WINDOW_HELPER_ADAPTER_FILE),
        manifestPath: path.join(dir, 'manifest.json'),
      }),
    });
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(0);
    expect(h.factory.isReady()).toBe(false);
  });

  it('a missing resource directory fails before any spawn (same-harness counter)', async () => {
    const missing = path.join(os.tmpdir(), 'wh-factory-missing-' + Math.random().toString(36).slice(2));
    const h = harness({
      resolvePaths: () => ({
        directory: missing,
        helperPath: path.join(missing, WINDOW_HELPER_SCRIPT_FILE),
        adapterPath: path.join(missing, WINDOW_HELPER_ADAPTER_FILE),
        manifestPath: path.join(missing, 'manifest.json'),
      }),
    });
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(0);
  });

  it('a missing Windows PowerShell runtime fails before any spawn (same-harness counter)', async () => {
    const h = harness({ systemRoot: path.join(os.tmpdir(), 'no-runtime-' + Math.random().toString(36).slice(2)) });
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(0);
    expect(h.getResolverCalls()).toBe(0);
  });

  it('a non-win32 platform is unavailable before any spawn', async () => {
    const h = harness({ platform: 'linux' });
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(0);
    expect(h.getResolverCalls()).toBe(0);
  });

  it('a throwing resolver becomes helper-unavailable with zero child attempts', async () => {
    const h = harness({
      resolvePaths: () => {
        throw new Error('boom resolver');
      },
    });
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(0);
  });

  it('a gated in-flight stop rejects starts with zero spawn; concurrent stops share one teardown', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({ stopGate: () => gate });
    expect(await h.factory.start()).toBe('ready');
    expect(h.getSpawns()).toBe(1);

    // Stop remains genuinely pending at the gate.
    const stopA = h.factory.stop();
    // Start while the stop is in flight: rejected, ZERO new resolve/spawn.
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(1);
    expect(h.getResolverCalls()).toBe(1);
    // A concurrent second stop shares the SAME in-flight teardown.
    const stopB = h.factory.stop();
    expect(stopB).toBe(stopA);
    // Start is still rejected while the shared stop is pending.
    expect(await h.factory.start()).toBe('helper-unavailable');
    expect(h.getSpawns()).toBe(1);

    release();
    await stopA;
    await stopB;
    expect(h.factory.isReady()).toBe(false);
    // The one created child was owned/terminated exactly once.
    expect(h.fake.getKills()).toBe(1);
    expect(h.fake.stdin.ended).toBe(1);

    // Retry after the stop settles: exactly one fresh snapshot/spawn.
    expect(await h.factory.start()).toBe('ready');
    expect(h.getResolverCalls()).toBe(2);
    expect(h.getSpawns()).toBe(2);

    // Final cleanup owns both generations exactly once - no unreachable child.
    await h.factory.stop();
    expect(h.fake.getKills()).toBe(2);
    expect(h.fake.stdin.ended).toBe(2);
    expect(h.factory.isReady()).toBe(false);
  });

  it('a stop that overtakes an in-flight start resolves helper-unavailable and owns the child', async () => {
    const h = harness();
    // Genuinely overlapping: stop is invoked while start is still settling.
    const startPromise = h.factory.start();
    await h.factory.stop();
    expect(await startPromise).toBe('helper-unavailable');
    expect(h.factory.isReady()).toBe(false);
    // The one created child was owned and terminated by the stop.
    expect(h.fake.getKills()).toBe(1);
    expect(h.fake.stdin.ended).toBe(1);
    // After both settle, a new start is a fresh resolve/validation/spawn.
    expect(await h.factory.start()).toBe('ready');
    expect(h.getSpawns()).toBe(2);
    expect(h.getResolverCalls()).toBe(2);
    await h.factory.stop();
    await h.factory.stop();
    expect(h.factory.isReady()).toBe(false);
  });

  it('an alternating resolver is consulted exactly once and the spawn uses that snapshot', async () => {
    let calls = 0;
    const first = resolveWindowHelperResourcePaths({ appPath: REPO_ROOT, resourcesPath: '', packaged: false });
    const h = harness({
      resolvePaths: () => {
        calls += 1;
        if (calls > 1) throw new Error('a second resolve must never happen');
        return first;
      },
    });
    expect(await h.factory.start()).toBe('ready');
    expect(calls).toBe(1);
    expect(h.capturedSnapshots).toHaveLength(1);
    // The child was created from EXACTLY the first resolved object.
    expect(h.capturedSnapshots[0]!.paths).toBe(first);
    expect(h.capturedSnapshots[0]!.runtimePath).toContain('WindowsPowerShell');
    await h.factory.stop();
  });

  it('retains transport bounds: an oversized helper line terminates the session fail-closed', async () => {
    const h = harness({ maxLineBytes: 64 });
    await h.factory.start();
    const pending = h.factory.list();
    await drainMicrotasks();
    const requestId = h.fake.requests[0]!['requestId'];
    h.fake.stdout.pushText(JSON.stringify({
      requestId,
      method: 'list',
      outcome: 'success',
      windows: [],
    }) + '\n' + 'x'.repeat(200) + '\n');
    await drainMicrotasks();
    await pending.catch(() => undefined);
    expect(h.factory.isReady()).toBe(false);
    expect(await h.factory.list()).toMatchObject({ outcome: 'helper-unavailable' });
  });

  it('exported surface is capability methods plus start/stop/isReady and the session revision only', () => {
    const h = harness();
    const surface = Object.keys(h.factory).sort();
    expect(surface).toEqual([
      'apply', 'cloak', 'close', 'hover', 'isReady', 'list', 'minimize', 'observe', 'restore', 'revision', 'start', 'stop', 'thumbnail', 'uncloak',
    ]);
    const raw = h.factory as unknown as Record<string, unknown>;
    for (const forbidden of ['spawn', 'send', 'transport', 'child', 'createProcess', 'resolvePaths', 'getClient', 'supervisor']) {
      expect(raw).not.toHaveProperty(forbidden);
    }
  });

  it('bumps the session revision only when a FRESH helper session is created (019G invalidation seam)', async () => {
    const h = harness();
    expect(h.factory.revision).toBe(0);
    expect(await h.factory.start()).toBe('ready');
    expect(h.factory.revision).toBe(1);
    // An idempotent ready start performs no new session: revision unchanged.
    expect(await h.factory.start()).toBe('ready');
    expect(h.factory.revision).toBe(1);
    // A crash + restart builds a fresh session: revision bumped.
    const pending = h.factory.list();
    await drainMicrotasks();
    h.fake.exit(1, null);
    await pending;
    expect(await h.factory.start()).toBe('ready');
    expect(h.factory.revision).toBe(2);
    await h.factory.stop();
    // A post-stop restart is a fresh session too.
    expect(await h.factory.start()).toBe('ready');
    expect(h.factory.revision).toBe(3);
    await h.factory.stop();
  });

  it('routes a thumbnail request through the wire and delivers its payload (019G)', async () => {
    const h = harness();
    expect(await h.factory.start()).toBe('ready');
    const token = 'T'.padEnd(33, 'a') as unknown as Parameters<typeof h.factory.thumbnail>[0];
    const pending = h.factory.thumbnail(token, 240, 135);
    await drainMicrotasks();
    expect(h.fake.requests).toHaveLength(1);
    expect(h.fake.requests[0]).toMatchObject({ method: 'thumbnail', target: token, maxWidth: 240, maxHeight: 135 });
    const requestId = h.fake.requests[0]!['requestId'];
    // ONE complete valid PNG buffer whose IHDR claims 240x135, so the strict
    // response parser (signature + IHDR + byte bound) accepts it.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'latin1');
    ihdr.writeUInt32BE(240, 8);
    ihdr.writeUInt32BE(135, 12);
    ihdr[16] = 8;
    ihdr[17] = 6;
    const png = Buffer.concat([sig, ihdr]).toString('base64');
    h.fake.stdout.pushText(JSON.stringify({
      requestId,
      method: 'thumbnail',
      outcome: 'success',
      thumbnail: { image: png, width: 240, height: 135 },
      target: token,
    }) + '\n');
    expect(await pending).toMatchObject({ outcome: 'success', thumbnail: { image: png, width: 240, height: 135 } });
    await h.factory.stop();
  });

  it('resolves a throwing-capture denied thumbnail that echoes its target (019GR4)', async () => {
    const h = harness();
    expect(await h.factory.start()).toBe('ready');
    const token = 'T'.padEnd(33, 'b') as unknown as Parameters<typeof h.factory.thumbnail>[0];
    const pending = h.factory.thumbnail(token, 240, 135);
    await drainMicrotasks();
    expect(h.fake.requests).toHaveLength(1);
    expect(h.fake.requests[0]).toMatchObject({ method: 'thumbnail', target: token, maxWidth: 240, maxHeight: 135 });
    const requestId = h.fake.requests[0]!['requestId'];
    // A generic denied envelope (helper catch) that echoes the accepted target:
    // the strict parser requires the target, so the client resolves it.
    h.fake.stdout.pushText(JSON.stringify({
      requestId,
      method: 'thumbnail',
      outcome: 'denied',
      target: token,
      error: 'boom capture failure',
    }) + '\n');
    const result = await pending;
    expect(result.outcome).toBe('denied');
    expect(result.error).toContain('boom');
    // The token is a main-internal correlation field and never leaks.
    expect(result).not.toHaveProperty('target');
    await h.factory.stop();
  });
});
