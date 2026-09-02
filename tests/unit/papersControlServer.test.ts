import { once } from 'node:events';
import { access, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createFrameReader, createPapersControlEventHub, startPapersControlServer } from '../../src/main/control/papersControlServer';

/**
 * Reads a complete newline-terminated frame rather than assuming one `data`
 * event is one message. The old helper made that assumption and so could not
 * expose the framing bug it shared with the client.
 */
function lineReader(socket: Socket): { readLine(): Promise<string> } {
  let buffer = '';
  const waiting: Array<(line: string) => void> = [];
  const settle = (): void => {
    while (waiting.length > 0) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      waiting.shift()?.(line);
    }
  };
  socket.on('data', (chunk: string) => { buffer += chunk; settle(); });
  return {
    readLine() {
      const newline = buffer.indexOf('\n');
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return Promise.resolve(line);
      }
      return new Promise<string>((resolve) => { waiting.push(resolve); });
    },
  };
}

async function connect(pipe: string): Promise<{ socket: Socket; readLine(): Promise<string> }> {
  const socket = createConnection(pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  return { socket, ...lineReader(socket) };
}

async function call(pipe: string, payload: unknown): Promise<Record<string, unknown>> {
  const { socket, readLine } = await connect(pipe);
  socket.write(`${JSON.stringify(payload)}\n`);
  const line = await readLine();
  socket.end();
  return JSON.parse(line) as Record<string, unknown>;
}

describe('Papers developer control server', () => {
  it('requires the descriptor token and removes the descriptor on close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const createWindow = vi.fn(async () => ({ windowId: 7 }));
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({ ready: true }), windows: () => [], createWindow },
    });
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as typeof server.descriptor;

    await expect(call(descriptor.pipe, {
      id: 1,
      token: 'wrong',
      protocolVersion: 1,
      method: 'window.create',
      params: {},
    })).resolves.toMatchObject({ id: 1, ok: false, error: 'unauthorized' });
    expect(createWindow).not.toHaveBeenCalled();

    await expect(call(descriptor.pipe, {
      id: 2,
      token: descriptor.token,
      protocolVersion: 1,
      method: 'window.create',
      params: {},
    })).resolves.toMatchObject({ id: 2, ok: true, result: { windowId: 7 } });
    expect(createWindow).toHaveBeenCalledOnce();

    await server.close();
    await expect(readFile(descriptorPath, 'utf8')).rejects.toThrow();
  });

  it('shuts down promptly even while an idle client holds a connection open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({}), windows: () => [], createWindow: async () => ({ windowId: 1 }) },
    });

    // Connect and send NOTHING. server.close() alone waits for existing
    // connections, so without tracking and destroying sockets this would hang
    // for as long as the client felt like staying -- and Papers awaits this
    // close before quitting.
    const idle = createConnection(server.descriptor.pipe);
    await once(idle, 'connect');

    await expect(Promise.race([
      server.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 2000)),
    ])).resolves.toBe('closed');
    // The server ended it; the client observes that rather than lingering.
    await Promise.race([once(idle, 'close'), new Promise((r) => setTimeout(r, 1000))]);
    expect(idle.destroyed).toBe(true);
  });

  it('rolls back the listening pipe and leaves no artifact when publishing the descriptor fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    let pipeName: string | null = null;

    await expect(startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({}), windows: () => [], createWindow: async () => ({ windowId: 1 }) },
      publishDescriptor: async (temporary) => {
        // The listen() has already succeeded at this point, which is exactly
        // the window that used to leave a hidden pipe listening with no
        // descriptor and no registered cleanup.
        pipeName = temporary;
        throw new Error('publication failed');
      },
    })).rejects.toThrow(/publication failed/);

    expect(pipeName).not.toBeNull();
    // No descriptor and no temporary file left behind.
    await expect(access(descriptorPath)).rejects.toBeTruthy();
    expect((await readdir(root)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('reads a request that arrives split across deliveries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({}), windows: () => [], createWindow: async () => ({ windowId: 5 }) },
    });
    const { socket, readLine } = await connect(server.descriptor.pipe);

    const frame = `${JSON.stringify({
      id: 1,
      token: server.descriptor.token,
      protocolVersion: server.descriptor.protocolVersion,
      method: 'window.create',
      params: {},
    })}
`;
    // A stream carries bytes, not messages.
    socket.write(frame.slice(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.write(frame.slice(10));

    expect(JSON.parse(await readLine())).toMatchObject({ id: 1, ok: true });
    socket.end();
    await server.close();
  });

  it('accepts two requests coalesced into one delivery, capping per frame rather than cumulatively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({}), windows: () => [], createWindow: async () => ({ windowId: 9 }) },
    });
    const { socket, readLine } = await connect(server.descriptor.pipe);

    // Two individually legal frames, each padded past half the 64 KiB limit,
    // arriving in one delivery. Under a cumulative cap the pair is rejected as
    // one oversized request even though neither exceeds the limit -- so what
    // matters here is that BOTH are answered, each by its own id, and that
    // neither is refused for size.
    const padded = (id: number) => `${JSON.stringify({
      id,
      token: server.descriptor.token,
      protocolVersion: server.descriptor.protocolVersion,
      method: 'window.create',
      params: { pad: 'x'.repeat(40 * 1024) },
    })}\n`;
    socket.write(padded(1) + padded(2));

    const first = JSON.parse(await readLine()) as { id: unknown; error?: string };
    const second = JSON.parse(await readLine()) as { id: unknown; error?: string };
    expect([first.id, second.id]).toEqual([1, 2]);
    expect(first.error ?? '').not.toContain('too large');
    expect(second.error ?? '').not.toContain('too large');

    socket.end();
    await server.close();
  });

  it('refuses a single frame larger than the limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { surfaces: () => [], surface: () => null, snapshot: () => ({}), windows: () => [], createWindow: async () => ({ windowId: 1 }) },
    });
    const { socket, readLine } = await connect(server.descriptor.pipe);

    socket.write(`${JSON.stringify({
      id: 1,
      token: server.descriptor.token,
      protocolVersion: server.descriptor.protocolVersion,
      method: 'window.create',
      params: { pad: 'x'.repeat(80 * 1024) },
    })}\n`);

    expect(JSON.parse(await readLine())).toMatchObject({ ok: false, error: 'request too large' });
    await server.close();
  });
});

  it('does not resolve close until a command that already started has settled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    let release: (() => void) | null = null;
    let created = false;
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: {
        snapshot: () => ({}),
        windows: () => [],
        surfaces: () => [],
        surface: () => null,
        createWindow: async () => {
          await new Promise<void>((resolve) => { release = resolve; });
          created = true;
          return { windowId: 1 };
        },
      },
    });
    const { socket } = await connect(server.descriptor.pipe);
    socket.write(`${JSON.stringify({
      id: 1,
      token: server.descriptor.token,
      protocolVersion: server.descriptor.protocolVersion,
      method: 'window.create',
      params: {},
    })}\n`);

    // Wait until the command is genuinely in flight.
    await vi.waitFor(() => expect(release).not.toBeNull());

    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A barrier alone would let close() resolve here, while window.create is
    // still running and about to register a window against services that
    // global teardown is already dismantling.
    expect(closed).toBe(false);

    release!();
    await closing;
    expect(closed).toBe(true);
    expect(created).toBe(true);
  });

  it('admits no command received after close() begins, even while cleanup is still pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    let created = 0;
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: {
        snapshot: () => ({}),
        windows: () => [],
        surfaces: () => [],
        surface: () => null,
        createWindow: async () => { created += 1; return { windowId: created }; },
      },
    });
    const { socket, readLine } = await connect(server.descriptor.pipe);

    // Papers has begun quitting. The barrier must be up immediately, not once
    // the descriptor unlink has finished -- otherwise an already-connected
    // client can still start a mutation after the shutdown request.
    const closing = server.close();
    socket.write(`${JSON.stringify({
      id: 1,
      token: server.descriptor.token,
      protocolVersion: server.descriptor.protocolVersion,
      method: 'window.create',
      params: {},
    })}\n`);

    await closing;
    expect(created).toBe(0);
    void readLine;
  });

  it('fans events out only to the subscribed authenticated connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const eventHub = createPapersControlEventHub();
    const server = await startPapersControlServer({
      descriptorPath,
      eventHub,
      dependencies: {
        snapshot: () => ({}), windows: () => [], surfaces: () => [], surface: () => null,
        createWindow: async () => ({ windowId: 1 }),
        publishEvent: (event, payload) => eventHub.publish(event, payload),
      },
    });
    const first = await connect(server.descriptor.pipe);
    const second = await connect(server.descriptor.pipe);
    const request = (id: number) => JSON.stringify({
      id, token: server.descriptor.token, protocolVersion: server.descriptor.protocolVersion,
      method: 'events.subscribe', params: { events: ['window.created'] },
    }) + '\n';
    try {
      first.socket.write(request(1));
      await expect(first.readLine()).resolves.toContain('"ok":true');
      eventHub.publish('window.created', { windowId: 9 });
      await expect(first.readLine()).resolves.toContain('"windowId":9');
      await expect(Promise.race([
        second.readLine(),
        new Promise((resolve) => setTimeout(() => resolve('no event'), 100)),
      ])).resolves.toBe('no event');
      expect(() => eventHub.publish('window.created', { windowId: 9, url: 'papers-backpack://secret' }))
        .toThrow();
    } finally {
      first.socket.destroy();
      second.socket.destroy();
      await server.close();
    }
  });

  it('routes visual records by exact target and drops under backpressure', () => {
    const eventHub = createPapersControlEventHub();
    const hostWrite = vi.fn((_payload: string) => true);
    const surfaceAWrite = vi.fn((_payload: string) => true);
    const blockedWrite = vi.fn((_payload: string) => false);
    const host = { destroyed: false, writableNeedDrain: false, write: hostWrite } as unknown as Socket;
    const surfaceA = { destroyed: false, writableNeedDrain: false, write: surfaceAWrite } as unknown as Socket;
    const blocked = { destroyed: false, writableNeedDrain: true, write: blockedWrite } as unknown as Socket;
    eventHub.attach(host);
    eventHub.attach(surfaceA);
    eventHub.attach(blocked);
    eventHub.subscribe(host, ['visual.lifecycle'], { windowId: 4 });
    eventHub.subscribe(surfaceA, ['visual.diagnostic'], { windowId: 4, surfaceId: 'surface-a' });
    eventHub.subscribe(blocked, ['visual.diagnostic'], { windowId: 4 });

    const lifecycle = {
      sequence: 1,
      observedAt: '2026-09-02T00:00:00.000Z',
      target: { windowId: 4 },
      payload: { kind: 'lifecycle' as const, phase: 'dom-ready' as const },
    };
    const diagnostic = {
      sequence: 2,
      observedAt: '2026-09-02T00:00:01.000Z',
      target: { windowId: 4, surfaceId: 'surface-a' },
      payload: { kind: 'console' as const, level: 'error' as const, message: 'render failed' },
    };
    const otherSurface = {
      ...diagnostic,
      sequence: 3,
      target: { windowId: 4, surfaceId: 'surface-b' },
    };

    eventHub.publish('visual.lifecycle', lifecycle);
    eventHub.publish('visual.diagnostic', diagnostic);
    eventHub.publish('visual.diagnostic', otherSurface);

    expect(hostWrite).toHaveBeenCalledOnce();
    expect(surfaceAWrite).toHaveBeenCalledOnce();
    expect(blockedWrite).not.toHaveBeenCalled();
    expect(String(surfaceAWrite.mock.calls[0]?.[0])).toContain('surface-a');
    expect(String(surfaceAWrite.mock.calls[0]?.[0])).not.toContain('surface-b');
  });

/**
 * Framing, tested with exact chunk sequences. A real socket chooses its own
 * delivery boundaries, so a socket-level test cannot reliably deliver two
 * requests together -- which is the case a cumulative cap gets wrong. These
 * drive the reader directly.
 */
describe('control frame reader', () => {
  function reader(maxFrameBytes = 64) {
    const frames: string[] = [];
    let oversize = 0;
    const subject = createFrameReader({
      maxFrameBytes,
      onFrame: (line) => frames.push(line),
      onOversize: () => { oversize += 1; },
    });
    return { subject, frames, oversized: () => oversize };
  }

  it('assembles a frame split across deliveries', () => {
    const r = reader();
    r.subject.push('{"a":');
    expect(r.frames).toEqual([]);
    r.subject.push('1}' + '\n');
    expect(r.frames).toEqual(['{"a":1}']);
  });

  it('splits two frames that arrive in one delivery', () => {
    const r = reader();
    r.subject.push('{"a":1}' + '\n' + '{"a":2}' + '\n');
    expect(r.frames).toEqual(['{"a":1}', '{"a":2}']);
    expect(r.oversized()).toBe(0);
  });

  it('caps per frame, not cumulatively: two legal frames delivered together both pass', () => {
    const r = reader(64);
    // Each frame is 40 bytes -- legal. Their sum is 80, which a cumulative cap
    // would refuse as one oversized request.
    const frame = 'x'.repeat(40) + '\n';
    r.subject.push(frame + frame);
    expect(r.frames).toHaveLength(2);
    expect(r.oversized()).toBe(0);
  });

  it('refuses a single frame over the cap', () => {
    const r = reader(64);
    r.subject.push('x'.repeat(65) + '\n');
    expect(r.frames).toEqual([]);
    expect(r.oversized()).toBe(1);
  });

  it('refuses an unterminated residual that grows past the cap', () => {
    const r = reader(64);
    // No newline ever arrives; the buffer must not grow without bound.
    r.subject.push('x'.repeat(65));
    expect(r.oversized()).toBe(1);
  });

  it('stops reading after refusing, so a destroyed socket delivers nothing more', () => {
    const r = reader(64);
    r.subject.push('x'.repeat(65) + '\n');
    r.subject.push('{"a":1}' + '\n');
    expect(r.frames).toEqual([]);
    expect(r.oversized()).toBe(1);
  });
});
