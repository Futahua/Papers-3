import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared production control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const ALPHA = 'bp-11111111-1111-4111-8111-111111111111';
const BETA = 'bp-22222222-2222-4222-8222-222222222222';
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
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-keyboard-accessibility-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projects = [
    await seedProject(userDataDir, ALPHA, 'Alpha'),
    await seedProject(userDataDir, BETA, 'Beta'),
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
      updatedAt: '2026-09-01T00:00:00.000Z',
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
  }, 10_000, 'keyboard accessibility control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('A1.2k keyboard tab accessibility', () => {
  it('selects every workspace tab by keyboard and keeps canonical/native state aligned', async () => {
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; surfaceId: string; windowId: number }>;
      return surfaces.length === 2 && surfaces.some((surface) => surface.projectId === ALPHA)
        && surfaces.some((surface) => surface.projectId === BETA);
    }, 15_000, 'two hydrated keyboard-test surfaces');
    const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; surfaceId: string; windowId: number }>;
    const windowId = surfaces[0]!.windowId;
    const byProject = new Map(surfaces.map((surface) => [surface.projectId, surface.surfaceId]));
    const hostPage = await launched.app.firstWindow();

    for (const [projectId, title] of [[ALPHA, 'Alpha'], [BETA, 'Beta']] as const) {
      const tab = hostPage.getByRole('tab', { name: title });
      expect(await tab.count()).toBe(1);
      expect(await tab.getAttribute('aria-label')).toBeTruthy();
      await tab.focus();
      expect(await tab.evaluate((element) => document.activeElement === element)).toBe(true);
      await tab.press('Enter');
      await waitFor(async () => (await tab.getAttribute('aria-selected')) === 'true', 10_000, `${title} selected by keyboard`);
      await waitFor(async () => {
        const current = await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>;
        return current.some((surface) => surface.projectId === projectId && surface.presentation === 'visible');
      }, 10_000, `${title} native presentation selected by keyboard`);
      const workspace = await call('inspect.workspace', { windowId }) as {
        topology: { groups: Array<{ activeSurfaceId: string | null }>; focusedGroupId: string };
      };
      expect(workspace.topology.groups[0]?.activeSurfaceId).toBe(byProject.get(projectId));
      expect(workspace.topology.focusedGroupId).toBe('group-main');
    }

    const activeTabs = await hostPage.getByRole('tab').evaluateAll((tabs) => tabs
      .filter((tab) => tab.getAttribute('aria-selected') === 'true')
      .map((tab) => ({ name: tab.getAttribute('aria-label'), selected: tab.getAttribute('aria-selected') })));
    expect(activeTabs).toEqual([{ name: expect.any(String), selected: 'true' }]);
    expect(await evalInHost<string[]>(launched.app, `[...document.querySelectorAll('[role="tab"]')]
      .map((tab) => tab.getAttribute('aria-label') ?? '').filter(Boolean)`)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  }, 45_000);
});
