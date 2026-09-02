import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInBackpackProject, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const PROJECT = 'bp-11111111-1111-4111-8111-111111111111';
let launched: LaunchedApp;
let descriptorPath: string;

async function call(method: string, params: unknown = {}): Promise<unknown> {
  const connection = await connectPapersControl(await readDescriptor(descriptorPath));
  try {
    const response = await connection.call(method, params) as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'control request failed');
    return response.result;
  } finally {
    connection.close();
  }
}

beforeAll(async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'papers3-project-visual-'));
  descriptorPath = join(userDataDir, 'dev-control.json');
  const dataDir = join(userDataDir, 'PapersData');
  const projectRoot = join(dataDir, 'neutral-project');
  const backpackDir = join(dataDir, 'backpacks', PROJECT);
  const backpack = {
    id: PROJECT, name: 'Neutral project', type: 'environment',
    createdAt: '2026-09-02T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null,
  };
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await mkdir(backpackDir, { recursive: true });
  await writeFile(join(dataDir, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
  await writeFile(join(backpackDir, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  await writeFile(join(dataDir, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [PROJECT]: { root: projectRoot } } }));
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: PROJECT, entry: 'public/index.html' }));
  await writeFile(join(projectRoot, 'public', 'index.html'), '<!doctype html><script src="app.js"></script><h1>Neutral project</h1>');
  await writeFile(join(projectRoot, 'public', 'app.js'), `Promise.reject(new Error('C:\\\\private\\\\project-promise.js password=secret'));
    throw new Error('C:\\\\private\\\\project.js token=secret');`);
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readFile(descriptorPath, 'utf8'); return true; } catch { return false; }
  }, 10_000, 'project visual control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
});

describe('project renderer visual diagnostics', () => {
  it('captures main-world failures through the exact window and surface target', async () => {
    const windowId = await launched.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.id);
    const opened = await evalInHost<{ url: string; surfaceId: string }>(
      launched.app,
      `window.papersHost.backpackProject.open(${JSON.stringify(PROJECT)})`,
    );
    const before = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{ sequence: number }>;
    const beforeSequence = Math.max(0, ...before.map((record) => record.sequence));
    await evalInHost(
      launched.app,
      `window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(opened.url)}).then(() => true)`,
    );
    expect(await evalInBackpackProject(launched.app, 'Boolean(window.__papersVisualDiagnosticObserverV1)')).toBe(true);
    await waitFor(async () => {
      const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{ sequence: number; payload: { kind?: string } }>;
      return records.filter((record) => record.sequence > beforeSequence
        && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection')).length >= 2;
    }, 10_000, 'project renderer failure diagnostics');
    const records = await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId }) as Array<{ sequence: number; target: { windowId: number; surfaceId?: string }; payload: { kind?: string; message?: string } }>;
    const failures = records.filter((record) => record.sequence > beforeSequence
      && (record.payload.kind === 'uncaught-error' || record.payload.kind === 'unhandled-rejection'));
    expect(failures).toHaveLength(2);
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: { kind: 'uncaught-error', message: 'Uncaught Error: <path> token=<redacted>' } }),
      expect.objectContaining({ target: { windowId, surfaceId: opened.surfaceId }, payload: { kind: 'unhandled-rejection', message: '<path> password=<redacted>' } }),
    ]));
  });
});
