import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

let launched: LaunchedApp;
let descriptorPath: string;
const execFileAsync = promisify(execFile);

/**
 * Uses the SHARED control client, so this proves the real framing
 * implementation rather than a second hand-written approximation that could
 * agree with a broken server.
 */
async function call(method: string): Promise<unknown> {
  const descriptor = await readDescriptor(descriptorPath);
  const connection = await connectPapersControl(descriptor);
  try {
    const response = await connection.call(method) as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'control request failed');
    return response.result;
  } finally {
    connection.close();
  }
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
  it('uses the real papersctl executable against the running app', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), 'tools', 'papersctl.mjs'),
      'inspect.snapshot',
      '--descriptor', descriptorPath,
    ]);

    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, windows: [{ hostAlive: true }] });
  });

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
