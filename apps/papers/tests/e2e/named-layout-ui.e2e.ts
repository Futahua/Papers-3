import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, evalInHostWindow, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared production control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const ALPHA = 'bp-11111111-1111-4111-8111-111111111111';
const BETA = 'bp-22222222-2222-4222-8222-222222222222';
const GAMMA = 'bp-33333333-3333-4333-8333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';

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

async function seedProject(userDataDir: string, id: string, name: string): Promise<{ id: string; name: string; root: string }> {
  const root = path.join(userDataDir, `project-${name.toLowerCase()}`);
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: id, entry: 'public/index.html' }));
  await fs.writeFile(path.join(root, 'public', 'index.html'), `<!doctype html><h1>${name}</h1>`);
  return { id, name, root };
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-named-layout-ui-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projects = [
    await seedProject(userDataDir, ALPHA, 'Alpha'),
    await seedProject(userDataDir, BETA, 'Beta'),
    await seedProject(userDataDir, GAMMA, 'Gamma'),
  ];
  const createdAt = '2026-09-01T00:00:00.000Z';
  const backpacks = projects.map(({ id, name }) => ({
    id, name, type: 'environment', createdAt, lastEnteredAt: null, archived: false, workspacePath: null,
  }));
  const dataDir = path.join(userDataDir, 'PapersData');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(dataDir, 'backpack-projects.json'), JSON.stringify({
    schemaVersion: 1,
    projects: Object.fromEntries(projects.map(({ id, root }) => [id, { root }])),
  }));
  for (const backpack of backpacks) {
    const directory = path.join(dataDir, 'backpacks', backpack.id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  }
  await fs.writeFile(path.join(dataDir, 'workspace-topologies.json'), JSON.stringify({
    schemaVersion: 2,
    lastWorkspaceId: WORKSPACE_ID,
    workspaces: [{
      workspaceId: WORKSPACE_ID,
      updatedAt: createdAt,
      topology: {
        schemaVersion: 1,
        surfaces: [
          { surfaceId: 'old-alpha', projectId: ALPHA, title: 'Alpha' },
          { surfaceId: 'old-beta', projectId: BETA, title: 'Beta' },
        ],
        groups: [{ groupId: 'group-main', surfaceIds: ['old-alpha', 'old-beta'], activeSurfaceId: 'old-beta' }],
        root: { kind: 'group', groupId: 'group-main' },
        focusedGroupId: 'group-main',
      },
    }],
  }));
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try {
      await readDescriptor(descriptorPath);
      return true;
    } catch {
      return false;
    }
  }, 10_000, 'named-layout UI control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('Retired named-layout menu and storage compatibility', () => {
  it('omits the menu while existing layout APIs retain isolation and safe failure', async () => {
    await waitFor(async () => (await call('inspect.surfaces') as unknown[]).length === 2, 15_000, 'initial hydrated surfaces');
    const hostPage = await launched.app.firstWindow();
    await waitFor(async () => (await hostPage.getByRole('button', { name: 'New window', exact: true }).count()) === 1, 10_000, 'host toolbar');
    expect(await hostPage.getByRole('button', { name: 'Layouts', exact: true }).count()).toBe(0);
    expect(await hostPage.locator('.layouts-popover').count()).toBe(0);
    const initialSurfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; windowId: number }>;
    const windowId = initialSurfaces[0]!.windowId;
    const initialWorkspace = await call('inspect.workspace', { windowId }) as { revision: number; topology: unknown };

    await evalInHost(launched.app, 'window.papersHost.layout.save("Work")');

    const layoutsPath = path.join(launched.userDataDir, 'PapersData', 'workspace-layouts.json');
    await waitFor(async () => {
      try {
        const persisted = JSON.parse(await fs.readFile(layoutsPath, 'utf8')) as { schemaVersion: number; layouts: Array<{ name: string }> };
        return persisted.schemaVersion === 1 && persisted.layouts.length === 1 && persisted.layouts[0]?.name === 'Work';
      } catch {
        return false;
      }
    }, 10_000, 'named layout persistence');
    const savedLayout = (await call('layout.list') as Array<{ layoutId: string }>)[0]!;

    const alpha = initialSurfaces.find((surface) => surface.projectId === ALPHA)!;
    await call('layout.split', { windowId, surfaceId: alpha.surfaceId, direction: 'right' });
    await waitFor(async () => (await call('inspect.workspace', { windowId }) as { revision: number }).revision > initialWorkspace.revision,
      10_000, 'material workspace mutation');

    const beforeLoad = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string }>;
    await evalInHost(launched.app, `window.papersHost.layout.load(${JSON.stringify(savedLayout.layoutId)})`);
    await waitFor(async () => {
      const current = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string }>;
      return current.length === 2 && current.every((surface) => !beforeLoad.some((old) => old.surfaceId === surface.surfaceId));
    }, 15_000, 'fresh IDs after compatibility API load');
    const loadedWorkspace = await call('inspect.workspace', { windowId }) as {
      topology: { groups: unknown[]; root: { kind: string } };
    };
    expect(loadedWorkspace.topology.groups).toHaveLength(1);
    expect(loadedWorkspace.topology.root.kind).toBe('group');
    expect((await call('layout.list') as Array<{ layoutId: string }>)[0]!.layoutId).toBe(savedLayout.layoutId);

    await waitFor(async () => (await call('inspect.surfaces') as Array<{ presentation: string }>)
      .some((surface) => surface.presentation === 'visible'), 10_000, 'loaded native presentation');
    const firstWindowSurfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; windowId: number; presentation: string }>;
    expect(firstWindowSurfaces.some((surface) => surface.presentation === 'visible')).toBe(true);

    const second = await call('window.create') as { windowId: number };
    await waitFor(async () => (await call('inspect.windows') as Array<{ windowId: number }>).some(({ windowId: candidate }) => candidate === second.windowId),
      15_000, 'second Papers window');
    await waitFor(async () => await evalInHostWindow<boolean>(launched.app, second.windowId,
      `Boolean(document.querySelector('button[aria-label="New window"]'))`), 10_000, 'second host toolbar');
    expect(await evalInHostWindow<boolean>(launched.app, second.windowId,
      `Boolean(document.querySelector('.layouts-control, .layouts-popover'))`)).toBe(false);
    await evalInHostWindow(launched.app, second.windowId,
      `window.papersHost.layout.load(${JSON.stringify(savedLayout.layoutId)})`);
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ windowId: number }>).filter(({ windowId: candidate }) => candidate === second.windowId).length === 2,
      15_000, 'second window layout load');
    const secondSurfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; windowId: number }>;
    expect(secondSurfaces.filter((surface) => surface.windowId === second.windowId).map((surface) => surface.surfaceId))
      .not.toEqual(expect.arrayContaining(firstWindowSurfaces.map((surface) => surface.surfaceId)));
    await waitFor(async () => {
      try {
        const persisted = JSON.parse(await fs.readFile(path.join(launched.userDataDir, 'PapersData', 'workspace-topologies.json'), 'utf8')) as {
          workspaces: Array<{ workspaceId: string }>;
        };
        return persisted.workspaces.length === 2;
      } catch {
        return false;
      }
    }, 10_000, 'independent second workspace identity');
    const persistedWorkspaces = JSON.parse(await fs.readFile(path.join(launched.userDataDir, 'PapersData', 'workspace-topologies.json'), 'utf8')) as {
      workspaces: Array<{ workspaceId: string }>;
    };
    expect(new Set(persistedWorkspaces.workspaces.map(({ workspaceId }) => workspaceId)).size).toBe(2);

    // Move the first window to an unrelated current project, then archive a
    // referenced-but-not-current project. A failed compatibility load must leave that
    // target's current topology and surface set unchanged.
    for (const surface of firstWindowSurfaces) await call('workspace.close', { windowId, surfaceId: surface.surfaceId });
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ windowId: number }>).filter(({ windowId: candidate }) => candidate === windowId).length === 0,
      15_000, 'first window cleared');
    const openedGamma = await call('workspace.open', { windowId, projectId: GAMMA }) as { surfaceId: string };
    const gammaBeforeFailure = await call('inspect.workspace', { windowId }) as { revision: number; topology: unknown };
    await evalInHost(launched.app, `window.papersHost.backpacks.setArchived(${JSON.stringify(ALPHA)}, true)`);
    await expect(evalInHost(launched.app,
      `window.papersHost.layout.load(${JSON.stringify(savedLayout.layoutId)})`)).rejects.toThrow();
    const gammaAfterFailure = await call('inspect.workspace', { windowId }) as { revision: number; topology: unknown };
    expect(gammaAfterFailure).toEqual(gammaBeforeFailure);
    expect((await call('inspect.surfaces') as Array<{ surfaceId: string }>).map(({ surfaceId }) => surfaceId)).toContain(openedGamma.surfaceId);
  }, 120_000);
});
