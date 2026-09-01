import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchPapers, waitFor, type LaunchedApp } from './helpers';

let launched: LaunchedApp;
let descriptorPath: string;

async function call(method: string): Promise<unknown> {
  const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as {
    pipe: string;
    token: string;
    protocolVersion: number;
  };
  const socket = createConnection(descriptor.pipe);
  await once(socket, 'connect');
  socket.setEncoding('utf8');
  socket.write(`${JSON.stringify({
    id: method,
    token: descriptor.token,
    protocolVersion: descriptor.protocolVersion,
    method,
    params: {},
  })}\n`);
  const [chunk] = await once(socket, 'data') as [string];
  socket.end();
  const response = JSON.parse(chunk.trim()) as { ok: boolean; result?: unknown; error?: string };
  if (!response.ok) throw new Error(response.error ?? 'control request failed');
  return response.result;
}

beforeAll(async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'papers3-control-e2e-'));
  descriptorPath = join(userDataDir, 'dev-control.json');
  launched = await launchPapers(userDataDir, {
    fixtures: false,
    devControlDescriptor: descriptorPath,
  });
  await waitFor(async () => {
    try { await readFile(descriptorPath, 'utf8'); return true; } catch { return false; }
  }, 10_000, 'developer control descriptor');
});

afterAll(async () => {
  await launched?.close();
});

describe('developer control plane', () => {
  it('inspects coherent state and creates a real secondary window without DOM control', async () => {
    await expect(call('inspect.snapshot')).resolves.toMatchObject({
      schemaVersion: 1,
      windows: [{ hostAlive: true, nativeWindowAlive: true }],
      hermes: { ownerWindowId: null },
    });

    await expect(call('window.create')).resolves.toEqual(expect.objectContaining({
      windowId: expect.any(Number),
    }));
    await waitFor(async () => (await call('inspect.windows') as unknown[]).length === 2, 10_000, 'second controlled window');
    await expect(call('inspect.windows')).resolves.toEqual([
      expect.objectContaining({ hostAlive: true, nativeWindowAlive: true }),
      expect.objectContaining({ hostAlive: true, nativeWindowAlive: true }),
    ]);
  });
});
