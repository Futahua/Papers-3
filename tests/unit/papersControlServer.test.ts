import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { startPapersControlServer } from '../../src/main/control/papersControlServer';

async function call(pipe: string, payload: unknown): Promise<Record<string, unknown>> {
  const socket = createConnection(pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  socket.write(`${JSON.stringify(payload)}\n`);
  const [chunk] = await once(socket, 'data') as [string];
  socket.end();
  return JSON.parse(chunk.trim()) as Record<string, unknown>;
}

describe('Papers developer control server', () => {
  it('requires the descriptor token and removes the descriptor on close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papers-control-'));
    const descriptorPath = join(root, 'control.json');
    const createWindow = vi.fn(async () => ({ windowId: 7 }));
    const server = await startPapersControlServer({
      descriptorPath,
      dependencies: { snapshot: () => ({ ready: true }), windows: () => [], createWindow },
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
});
