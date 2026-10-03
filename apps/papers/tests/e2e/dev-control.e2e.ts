import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
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
async function call(method: string, params: unknown = {}): Promise<unknown> {
  const descriptor = await readDescriptor(descriptorPath);
  const connection = await connectPapersControl(descriptor);
  try {
    const response = await connection.call(method, params) as { ok: boolean; result?: unknown; error?: string };
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
  const projectRoot = join(dataDir, 'neutral-project');
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await writeFile(join(dataDir, 'backpack-projects.json'), JSON.stringify({
    schemaVersion: 1, projects: { [CONTROL_PROJECT]: { root: projectRoot } },
  }));
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({
    schemaVersion: 1, backpackId: CONTROL_PROJECT, entry: 'public/index.html',
  }));
  await writeFile(join(projectRoot, 'public', 'index.html'), '<!doctype html><script src="app.js"></script><h1>Neutral project</h1>');
  await writeFile(join(projectRoot, 'public', 'app.js'), `window.__papersProjectVisualDiagnosticTestV1 = () => {
    setTimeout(() => { throw new Error('C:\\\\private\\\\project.js token=secret'); }, 0);
    setTimeout(() => { Promise.reject(new Error('C:\\\\private\\\\project-promise.js password=secret')); }, 0);
  };`);
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

  it('captures main-world renderer failures once through the sandboxed host', async () => {
    const windowId = await launched.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.id);
    const before = await call('inspect.visual.diagnostics', { windowId }) as Array<{ sequence: number }>;
    const beforeSequence = Math.max(0, ...before.map((record) => record.sequence));

    // executeJavaScript runs in the page's main world. The observer is
    // installed there by the opt-in dev-control preload; the sandboxed
    // normal preload has no failure listeners of its own.
    expect(await evalInHost<string>(launched.app, 'typeof window.papersHost')).toBe('object');
    expect(await evalInHost<string>(launched.app, 'typeof window.papersVisualDiagnosticBridgeV1')).toBe('object');
    await evalInHost(launched.app, 'window.__papersVisualDiagnosticTestV1(); true');

    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId }) as Array<{ sequence: number; payload: { kind?: string; message?: string } }>;
      return records.filter((record) => record.sequence > beforeSequence
        && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection')).length >= 2;
    }, 10_000, 'main-world renderer failure diagnostics');
    const records = await call('inspect.visual.diagnostics', { windowId }) as Array<{ sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string } }>;
    const failures = records.filter((record) => record.sequence > beforeSequence
      && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection'));
    expect(failures).toHaveLength(2);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: { windowId }, payload: { kind: 'uncaught-error', message: 'Uncaught Error: <path> token=<redacted>' } }),
      expect.objectContaining({ target: { windowId }, payload: { kind: 'unhandled-rejection', message: '<path> password=<redacted>' } }),
    ]));
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

  it('uses the real stdio MCP adapter for a query and ordinary semantic mutation', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), 'tools', 'papersMcp.mjs'), '--descriptor', descriptorPath],
      cwd: process.cwd(),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'papers-mcp-e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const before = await client.callTool({
        name: 'papers_control',
        arguments: { method: 'inspect.windows', params: {} },
      });
      const beforeContent = before.content as Array<{ type: string; text: string }>;
      const beforeWindows = JSON.parse(beforeContent[0]!.text) as unknown[];
      const created = await client.callTool({
        name: 'papers_control',
        arguments: { method: 'window.create', params: {} },
      });
      const createdContent = created.content as Array<{ type: string; text: string }>;
      const createdWindow = JSON.parse(createdContent[0]!.text) as { windowId: number };
      await waitFor(async () => (await call('inspect.windows') as unknown[]).length === beforeWindows.length + 1, 10_000, 'MCP-created Papers window');
      expect(createdWindow.windowId).toEqual(expect.any(Number));
    } finally {
      await client.close();
    }
  });
});
