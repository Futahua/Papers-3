import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createPapersControlEventHub, startPapersControlServer } from '../../src/main/control/papersControlServer';
// @ts-expect-error -- the shared control client is plain ESM shipped with the tools.
import { connectPapersControl } from '../../tools/papersControlClient.mjs';

/**
 * The client is shared by papersctl and the end-to-end test, so its ordering
 * guarantee is worth pinning directly. The server dispatches each frame
 * independently, so a slow command and a fast one can complete out of order --
 * and a client that simply awaits "the next line" would hand the first caller
 * the second caller's reply.
 */
describe('shared Papers control client', () => {
  it('never returns another call response, even when the server would answer out of order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-client-'));
    const descriptorPath = join(root, 'control.json');
    let releaseSlow: (() => void) | null = null;

    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: {
        // window.create is deliberately slow; inspect.windows is immediate.
        surfaces: () => [],
        surface: () => null,
        createWindow: async () => {
          await new Promise<void>((resolve) => { releaseSlow = resolve; });
          return { windowId: 42 };
        },
        windows: () => [],
        snapshot: () => ({}),
      },
    });

    const connection = await connectPapersControl(server.descriptor);
    try {
      const slow = connection.call('window.create');
      const fast = connection.call('inspect.windows');

      // Let the second call be issued if it were going to be. Serialization
      // means it has not even been written yet.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(releaseSlow).not.toBeNull();
      releaseSlow!();

      const slowResponse = await slow as { id: number; ok: boolean; result?: unknown };
      const fastResponse = await fast as { id: number; ok: boolean; result?: unknown };

      // Each caller receives its own answer, matched by id.
      expect(slowResponse.id).toBe(1);
      expect(slowResponse.result).toEqual({ windowId: 42 });
      expect(fastResponse.id).toBe(2);
      expect(fastResponse.result).toEqual([]);
    } finally {
      connection.close();
      await server.close();
    }
  });

  it('keeps working after a failed call rather than wedging the connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-client-'));
    const descriptorPath = join(root, 'control.json');
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: {
        surfaces: () => [],
        surface: () => null,
        createWindow: async () => ({ windowId: 1 }),
        windows: () => [],
        snapshot: () => ({}),
      },
    });

    const connection = await connectPapersControl(server.descriptor);
    try {
      // An unknown method is refused by the request schema, so this settles as
      // an error response rather than a transport failure.
      const refused = await connection.call('renderer.executeJavaScript') as { ok: boolean };
      expect(refused.ok).toBe(false);

      // The queue must not be left broken by that.
      const after = await connection.call('inspect.windows') as { ok: boolean; result?: unknown };
      expect(after.ok).toBe(true);
      expect(after.result).toEqual([]);
    } finally {
      connection.close();
      await server.close();
    }
  });

  it('demultiplexes an event that arrives while a request is outstanding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-client-'));
    const descriptorPath = join(root, 'control.json');
    const eventHub = createPapersControlEventHub();
    let releaseCreate: (() => void) | null = null;
    const server = await startPapersControlServer({
      descriptorPath,
      eventHub,
      dependencies: {
        surfaces: () => [],
        surface: () => null,
        createWindow: async () => {
          await new Promise<void>((resolve) => { releaseCreate = resolve; });
          return { windowId: 42 };
        },
        windows: () => [],
        snapshot: () => ({}),
        publishEvent: (event, payload) => eventHub.publish(event, payload),
      },
    });

    const connection = await connectPapersControl(server.descriptor);
    const events: unknown[] = [];
    const stop = connection.onEvent((event: unknown) => events.push(event));
    try {
      await expect(connection.call('events.subscribe', { events: ['window.created'] }))
        .resolves.toMatchObject({ ok: true, result: { subscribed: ['window.created'] } });
      const creating = connection.call('window.create');
      await vi.waitFor(() => expect(releaseCreate).not.toBeNull());

      // This frame is asynchronous and precedes the response for window.create.
      eventHub.publish('window.created', { windowId: 99 });
      await vi.waitFor(() => expect(events).toEqual([
        { type: 'event', event: 'window.created', payload: { windowId: 99 } },
      ]));

      releaseCreate!();
      await expect(creating).resolves.toMatchObject({ ok: true, result: { windowId: 42 } });
    } finally {
      stop();
      connection.close();
      await server.close();
    }
  });
});
