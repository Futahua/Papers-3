import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const CONTROL_PROJECT = 'bp-11111111-1111-4111-8111-111111111111';

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
  const dataDir = join(userDataDir, 'PapersData');
  const backpackDir = join(dataDir, 'backpacks', CONTROL_PROJECT);
  const backpack = {
    id: CONTROL_PROJECT,
    name: 'Control Target',
    type: 'environment',
    createdAt: '2026-09-02T00:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  };
  await mkdir(backpackDir, { recursive: true });
  await writeFile(join(dataDir, 'registry.json'), JSON.stringify({
    schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null,
  }));
  await writeFile(join(backpackDir, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
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

  it('delivers a real window-created event to one subscribed client while requests stay usable', async () => {
    const actor = await connectPapersControl(await readDescriptor(descriptorPath));
    const cli = spawn(process.execPath, [
      join(process.cwd(), 'tools', 'papersctl.mjs'),
      'events.subscribe', '--events', 'window.created', '--descriptor', descriptorPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    cli.stdout.setEncoding('utf8');
    let stdout = '';
    cli.stdout.on('data', (chunk: string) => { stdout += chunk; });
    try {
      await waitFor(async () => stdout.includes('"type":"subscription"'), 10_000, 'papersctl event subscription');
      const created = await actor.call('window.create') as { ok: boolean; result?: { windowId: number } };
      expect(created).toMatchObject({ ok: true, result: { windowId: expect.any(Number) } });
      await waitFor(async () => stdout.includes(`"event":"window.created"`) && stdout.includes(`"windowId":${created.result?.windowId}`), 10_000, 'papersctl window-created event');
      await expect(actor.call('inspect.windows')).resolves.toMatchObject({ ok: true, result: expect.any(Array) });
    } finally {
      actor.close();
      cli.kill();
    }
  });

  it('requires exact named confirmation and performs real archive then removal through papersctl', async () => {
    const archive = await execFileAsync(process.execPath, [
      join(process.cwd(), 'tools', 'papersctl.mjs'),
      'backpack.archive', '--project', CONTROL_PROJECT,
      '--confirmation', 'ARCHIVE BACKPACK "Control Target"',
      '--descriptor', descriptorPath,
    ]);
    expect(JSON.parse(archive.stdout)).toEqual({
      action: 'backpack.archive', projectId: CONTROL_PROJECT, name: 'Control Target',
    });

    const remove = await execFileAsync(process.execPath, [
      join(process.cwd(), 'tools', 'papersctl.mjs'),
      'backpack.remove', '--project', CONTROL_PROJECT,
      '--confirmation', 'DELETE BACKPACK "Control Target"',
      '--descriptor', descriptorPath,
    ]);
    expect(JSON.parse(remove.stdout)).toEqual({
      action: 'backpack.remove', projectId: CONTROL_PROJECT, name: 'Control Target',
    });
    await waitFor(async () => {
      const registry = JSON.parse(await readFile(join(launched.userDataDir, 'PapersData', 'registry.json'), 'utf8'));
      return registry.backpacks.length === 0;
    }, 10_000, 'confirmed Backpack removal');
  });
});
