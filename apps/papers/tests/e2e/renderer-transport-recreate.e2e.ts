import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- shared production control client is plain ESM.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const PROJECT = 'bp-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

async function projectTransports(): Promise<Array<{ id: number; url: string }>> {
  return launched.app.evaluate(({ webContents }, projectId) => webContents.getAllWebContents()
    .filter((contents) => contents.getURL().startsWith(`papers-backpack://${projectId}/`))
    .map((contents) => ({ id: contents.id, url: contents.getURL() })), PROJECT);
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-renderer-recreate-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projectRoot = path.join(userDataDir, 'recreate-project');
  await fs.mkdir(path.join(projectRoot, 'public'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({
    schemaVersion: 1, backpackId: PROJECT, entry: 'public/index.html',
  }));
  await fs.writeFile(path.join(projectRoot, 'public', 'index.html'), '<!doctype html><h1>Renderer recreate</h1>');
  const dataDir = path.join(userDataDir, 'PapersData');
  await fs.mkdir(path.join(dataDir, 'backpacks', PROJECT), { recursive: true });
  const backpack = {
    id: PROJECT, name: 'Renderer recreate', type: 'environment', createdAt: '2026-09-02T00:00:00.000Z',
    lastEnteredAt: null, archived: false, workspacePath: null,
  };
  await fs.writeFile(path.join(dataDir, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
  await fs.writeFile(path.join(dataDir, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [PROJECT]: { root: projectRoot } } }));
  await fs.writeFile(path.join(dataDir, 'backpacks', PROJECT, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readDescriptor(descriptorPath); return true; } catch { return false; }
  }, 10_000, 'renderer recreate control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('logical surface across renderer transport recreation', () => {
  it('rebinds a fresh renderer without retiring the logical surface', async () => {
    const windowId = ((await call('inspect.windows')) as Array<{ windowId: number }>)[0]!.windowId;
    expect(await evalInHost<boolean>(launched.app, `(() => {
      const card = [...document.querySelectorAll('.backpack-card')].find((item) =>
        item.querySelector('.name')?.textContent?.trim() === 'Renderer recreate');
      const enter = [...(card?.querySelectorAll('button') ?? [])].find((button) =>
        button.textContent?.trim() === 'Enter');
      enter?.click();
      return Boolean(enter);
    })()`)).toBe(true);
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ projectId: string }>).some((surface) => surface.projectId === PROJECT), 10_000, 'live project surface');

    const surface = (await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string }>).find((candidate) => candidate.projectId === PROJECT)!;
    const beforeWorkspace = await call('inspect.workspace', { windowId });
    const original = (await projectTransports())[0]!;
    expect(original).toBeDefined();

    expect(await launched.app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id);
      if (!contents || contents.isDestroyed()) return false;
      // Electron 43 exposes this runtime operation, although the installed
      // TypeScript declaration omits it from WebContents.
      (contents as unknown as { destroy(): void }).destroy();
      return true;
    }, original.id)).toBe(true);
    await waitFor(async () => {
      const transports = await projectTransports();
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string }>;
      return transports.length === 0 && surfaces.length === 1
        && surfaces[0]?.surfaceId === surface.surfaceId && surfaces[0]?.projectId === PROJECT;
    }, 10_000, 'destroyed renderer leaves logical surface');
    expect((await launched.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, original.id))).toBe(true);
    expect(await call('inspect.workspace', { windowId })).toEqual(beforeWorkspace);

    const recreated = await evalInHost<boolean>(launched.app, `window.papersHost.backpackProject.showSurface(${JSON.stringify(surface.surfaceId)}, ${JSON.stringify(original.url)}).then(() => true)`);
    expect(recreated).toBe(true);
    await waitFor(async () => {
      const transports = await projectTransports();
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; presentation: string }>;
      return transports.length === 1 && transports[0]?.id !== original.id
        && surfaces.length === 1 && surfaces[0]?.surfaceId === surface.surfaceId
        && surfaces[0]?.projectId === PROJECT && surfaces[0]?.presentation === 'visible';
    }, 10_000, 'fresh renderer bound to same logical surface');
    const fresh = (await projectTransports())[0]!;
    expect(fresh.id).not.toBe(original.id);
    expect(await call('inspect.workspace', { windowId })).toEqual(beforeWorkspace);

    // Exercise the recreated renderer after rebinding. Sender authorization
    // itself is pinned by the surface-context unit contract: old bindings are
    // removed and the fresh sender is bound to this exact logical surface.
    const postRecreationRendererValue = await launched.app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id);
      if (!contents || contents.isDestroyed()) return false;
      return await contents.executeJavaScript('window.rendererRecreated = true; window.rendererRecreated');
    }, fresh.id);
    expect(postRecreationRendererValue).toBe(true);

    await call('workspace.close', { windowId, surfaceId: surface.surfaceId });
    await waitFor(async () => (await call('inspect.surfaces') as Array<unknown>).length === 0
      && (await projectTransports()).length === 0, 10_000, 'recreated renderer exact close cleanup');
  });
});
