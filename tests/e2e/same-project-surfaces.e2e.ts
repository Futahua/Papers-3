import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- shared production control client is plain ESM.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const PROJECT = 'bp-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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

async function projectSenderIds(): Promise<number[]> {
  return launched.app.evaluate(({ webContents }, projectId) => webContents.getAllWebContents()
    .filter((contents) => contents.getURL().startsWith(`papers-backpack://${projectId}/`))
    .map((contents) => contents.id), PROJECT);
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-same-project-surfaces-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projectRoot = path.join(userDataDir, 'same-project');
  await fs.mkdir(path.join(projectRoot, 'public'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({
    schemaVersion: 1, backpackId: PROJECT, entry: 'public/index.html',
  }));
  await fs.writeFile(path.join(projectRoot, 'public', 'index.html'), `<!doctype html>
    <html><body><h1>Same project</h1><script>window.surfaceProbe = 1</script></body></html>`);
  const dataDir = path.join(userDataDir, 'PapersData');
  await fs.mkdir(path.join(dataDir, 'backpacks', PROJECT), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'registry.json'), JSON.stringify({
    schemaVersion: 1,
    backpacks: [{ id: PROJECT, name: 'Same project', type: 'environment', createdAt: '2026-09-02T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }],
    lastActiveBackpackId: null,
  }));
  await fs.writeFile(path.join(dataDir, 'backpack-projects.json'), JSON.stringify({
    schemaVersion: 1, projects: { [PROJECT]: { root: projectRoot } },
  }));
  await fs.writeFile(path.join(dataDir, 'backpacks', PROJECT, 'backpack.json'), JSON.stringify({
    schemaVersion: 1, id: PROJECT, name: 'Same project', type: 'environment', createdAt: '2026-09-02T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null,
  }));
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readDescriptor(descriptorPath); return true; } catch { return false; }
  }, 10_000, 'same-project control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('A0.4 same-project surface identity', () => {
  it('keeps two same-project surfaces and their native renderers independent', async () => {
    const windowId = ((await call('inspect.windows')) as Array<{ windowId: number }>)[0]!.windowId;
    expect(await evalInHost<boolean>(launched.app, `(() => {
      const card = [...document.querySelectorAll('.backpack-card')].find((item) =>
        item.querySelector('.name')?.textContent?.trim() === 'Same project');
      const enter = [...(card?.querySelectorAll('button') ?? [])].find((button) =>
        button.textContent?.trim() === 'Enter');
      enter?.click();
      return Boolean(enter);
    })()`)).toBe(true);
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ projectId: string }>).some((surface) => surface.projectId === PROJECT), 10_000, 'initial same-project surface');
    const initialSurface = (await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string }>).find((surface) => surface.projectId === PROJECT)!;
    await call('workspace.close', { windowId, surfaceId: initialSurface.surfaceId });
    await waitFor(async () => (await call('inspect.surfaces') as Array<unknown>).length === 0, 10_000, 'empty same-project workspace');
    const first = await call('workspace.open', { windowId, projectId: PROJECT }) as { surfaceId: string };
    const second = await call('workspace.open', { windowId, projectId: PROJECT }) as { surfaceId: string };
    expect(second.surfaceId).not.toBe(first.surfaceId);

    await waitFor(async () => (await call('inspect.surfaces') as Array<{ projectId: string }>).length === 2, 10_000, 'two same-project logical surfaces');
    await waitFor(async () => (await projectSenderIds()).length === 2, 10_000, 'two same-project native renderers');
    const initial = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; presentation: string }>;
    expect(initial).toEqual(expect.arrayContaining([
      expect.objectContaining({ surfaceId: first.surfaceId, projectId: PROJECT }),
      expect.objectContaining({ surfaceId: second.surfaceId, projectId: PROJECT }),
    ]));

    await call('layout.split', { windowId, surfaceId: first.surfaceId, direction: 'right' });
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; presentation: string }>;
      return surfaces.length === 2 && surfaces.every((surface) => surface.presentation === 'visible');
    }, 10_000, 'both same-project native presentations visible');
    const independentRendererValues = await launched.app.evaluate(async ({ webContents }, projectId) => {
      const targets = webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith(`papers-backpack://${projectId}/`));
      return Promise.all(targets.map(async (contents) => {
        await contents.executeJavaScript('window.surfaceProbe = (window.surfaceProbe ?? 0) + 1');
        return { id: contents.id, value: await contents.executeJavaScript('window.surfaceProbe = (window.surfaceProbe ?? 0) + 1; window.surfaceProbe') };
      }));
    }, PROJECT);
    expect(independentRendererValues).toHaveLength(2);
    expect(independentRendererValues.map(({ value }) => value)).toEqual([2, 2]);

    await call('workspace.activate', { windowId, surfaceId: first.surfaceId });
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; presentation: string }>;
      const workspace = await call('inspect.workspace', { windowId }) as { topology: { groups: Array<{ activeSurfaceId: string | null }> } };
      return workspace.topology.groups.some((group) => group.activeSurfaceId === first.surfaceId)
        && surfaces.find((surface) => surface.surfaceId === first.surfaceId)?.presentation === 'visible'
        && surfaces.find((surface) => surface.surfaceId === second.surfaceId)?.presentation === 'visible';
    }, 10_000, 'exact first same-project activation');
    await call('workspace.activate', { windowId, surfaceId: second.surfaceId });
    await waitFor(async () => (await call('inspect.workspace', { windowId }) as { topology: { focusedGroupId: string; groups: Array<{ activeSurfaceId: string | null }> } }).topology.groups.some((group) => group.activeSurfaceId === second.surfaceId), 10_000, 'exact second same-project activation');

    await call('workspace.close', { windowId, surfaceId: first.surfaceId });
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; presentation: string }>;
      return surfaces.length === 1 && surfaces[0]?.surfaceId === second.surfaceId
        && surfaces[0]?.projectId === PROJECT && surfaces[0]?.presentation === 'visible'
        && (await projectSenderIds()).length === 1;
    }, 10_000, 'exact same-project close leaves survivor');
  });
});
