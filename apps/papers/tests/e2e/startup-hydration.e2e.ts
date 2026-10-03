import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared production control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const ALPHA = 'bp-11111111-1111-4111-8111-111111111111';
const BETA = 'bp-22222222-2222-4222-8222-222222222222';
const GAMMA = 'bp-33333333-3333-4333-8333-333333333333';
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const OLD_ALPHA = 'old-alpha';
const OLD_BETA = 'old-beta';
const OLD_GAMMA = 'old-gamma';

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

async function seedProject(
  userDataDir: string,
  id: string,
  name: string,
): Promise<{ id: string; name: string; root: string }> {
  const root = path.join(userDataDir, `project-${name.toLowerCase()}`);
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({
    schemaVersion: 1,
    backpackId: id,
    entry: 'public/index.html',
  }));
  await fs.writeFile(path.join(root, 'public', 'index.html'), `<!doctype html><h1>${name}</h1>`);
  return { id, name, root };
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-startup-hydration-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projects = [
    await seedProject(userDataDir, ALPHA, 'Alpha'),
    await seedProject(userDataDir, BETA, 'Beta'),
    await seedProject(userDataDir, GAMMA, 'Gamma'),
  ];
  const createdAt = '2026-09-01T00:00:00.000Z';
  const backpacks = projects.map(({ id, name }) => ({
    id,
    name,
    type: 'environment',
    createdAt,
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  }));
  const dataDir = path.join(userDataDir, 'PapersData');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'registry.json'), JSON.stringify({
    schemaVersion: 1,
    backpacks,
    lastActiveBackpackId: null,
  }));
  await fs.writeFile(path.join(dataDir, 'backpack-projects.json'), JSON.stringify({
    schemaVersion: 1,
    projects: Object.fromEntries(projects.map(({ id, root }) => [id, { root }])) ,
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
          { surfaceId: OLD_ALPHA, projectId: ALPHA, title: 'Alpha' },
          { surfaceId: OLD_BETA, projectId: BETA, title: 'Beta' },
          { surfaceId: OLD_GAMMA, projectId: GAMMA, title: 'Gamma' },
        ],
        groups: [
          { groupId: 'group-left', surfaceIds: [OLD_BETA, OLD_ALPHA], activeSurfaceId: OLD_ALPHA },
          { groupId: 'group-right', surfaceIds: [OLD_GAMMA], activeSurfaceId: OLD_GAMMA },
        ],
        root: {
          kind: 'split',
          orientation: 'horizontal',
          weights: [0.7, 0.3],
          children: [
            { kind: 'group', groupId: 'group-left' },
            { kind: 'group', groupId: 'group-right' },
          ],
        },
        focusedGroupId: 'group-right',
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
  }, 10_000, 'startup hydration control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('A1.2i startup workspace hydration', () => {
  it('restores a seeded v2 workspace once, preserves semantics, and keeps later windows fresh', async () => {
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; windowId: number }>;
      return surfaces.length === 3
        && [ALPHA, BETA, GAMMA].every((projectId) => surfaces.some((surface) => surface.projectId === projectId));
    }, 15_000, 'automatic seeded workspace hydration');

    const surfaces = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; windowId: number }>;
    expect(surfaces).toHaveLength(3);
    expect(surfaces.every(({ surfaceId }) => ![OLD_ALPHA, OLD_BETA, OLD_GAMMA].includes(surfaceId))).toBe(true);
    expect(new Set(surfaces.map(({ windowId }) => windowId)).size).toBe(1);
    const windowId = surfaces[0]!.windowId;
    const byProject = new Map(surfaces.map((surface) => [surface.projectId, surface.surfaceId]));

    const workspace = await call('inspect.workspace', { windowId }) as {
      revision: number;
      topology: {
        surfaces: Array<{ surfaceId: string; projectId: string; title: string }>;
        groups: Array<{ groupId: string; surfaceIds: string[]; activeSurfaceId: string | null }>;
        root: {
          kind: 'split';
          orientation: 'horizontal';
          weights: number[];
          children: Array<{ kind: 'group'; groupId: string }>;
        };
        focusedGroupId: string;
      };
    };
    expect(workspace.topology.groups).toEqual([
      { groupId: 'group-left', surfaceIds: [byProject.get(BETA), byProject.get(ALPHA)], activeSurfaceId: byProject.get(ALPHA) },
      { groupId: 'group-right', surfaceIds: [byProject.get(GAMMA)], activeSurfaceId: byProject.get(GAMMA) },
    ]);
    expect(workspace.topology.root).toEqual({
      kind: 'split',
      orientation: 'horizontal',
      weights: [0.7, 0.3],
      children: [
        { kind: 'group', groupId: 'group-left' },
        { kind: 'group', groupId: 'group-right' },
      ],
    });
    expect(workspace.topology.focusedGroupId).toBe('group-right');

    const hostPage = await launched.app.firstWindow();
    await waitFor(async () => {
      const tabs = await evalInHost<string[]>(launched.app, `[...document.querySelectorAll('.dv-tab')]
        .map((tab) => tab.textContent?.trim() ?? '').filter(Boolean)`);
      return ['Alpha', 'Beta', 'Gamma'].every((title) => tabs.includes(title));
    }, 10_000, 'hydrated host tabs');
    expect(await hostPage.locator('.dv-groupview').count()).toBe(2);
    expect(await hostPage.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected')).toBe('true');

    const persistedPath = path.join(launched.userDataDir, 'PapersData', 'workspace-topologies.json');
    await waitFor(async () => {
      try {
        const persisted = JSON.parse(await fs.readFile(persistedPath, 'utf8')) as {
          schemaVersion: number;
          lastWorkspaceId: string;
          workspaces: Array<{ workspaceId: string; topology: { surfaces: Array<{ surfaceId: string }> } }>;
        };
        return persisted.schemaVersion === 2
          && persisted.lastWorkspaceId === WORKSPACE_ID
          && persisted.workspaces.length === 1
          && persisted.workspaces[0]?.workspaceId === WORKSPACE_ID
          && persisted.workspaces[0].topology.surfaces.length === 3
          && persisted.workspaces[0].topology.surfaces.every(({ surfaceId }) => ![OLD_ALPHA, OLD_BETA, OLD_GAMMA].includes(surfaceId));
      } catch {
        return false;
      }
    }, 10_000, 'hydrated topology durable commit');

    const revisionBeforeMutation = workspace.revision;
    await call('workspace.activate', { windowId, surfaceId: byProject.get(ALPHA) });
    await waitFor(async () => (await call('inspect.workspace', { windowId }) as { revision: number }).revision > revisionBeforeMutation,
      10_000, 'post-hydration workspace mutation');
    const persistedAfterMutation = JSON.parse(await fs.readFile(persistedPath, 'utf8')) as {
      lastWorkspaceId: string;
      workspaces: Array<{ workspaceId: string }>;
    };
    expect(persistedAfterMutation.lastWorkspaceId).toBe(WORKSPACE_ID);
    expect(persistedAfterMutation.workspaces.map(({ workspaceId }) => workspaceId)).toEqual([WORKSPACE_ID]);

    const created = await call('window.create') as { windowId: number };
    const secondaryWindowId = created.windowId;
    await waitFor(async () => (await call('inspect.windows') as Array<{ windowId: number }>).some(
      ({ windowId: candidate }) => candidate === secondaryWindowId), 10_000, 'fresh secondary window');
    const allSurfaces = await call('inspect.surfaces') as Array<{ projectId: string; windowId: number }>;
    expect(allSurfaces.filter(({ windowId: candidate }) => candidate === secondaryWindowId)).toEqual([]);
    expect(allSurfaces.filter(({ windowId: candidate }) => candidate === windowId).map(({ projectId }) => projectId))
      .toEqual(expect.arrayContaining([ALPHA, BETA, GAMMA]));

    const finalText = await fs.readFile(persistedPath, 'utf8');
    expect(finalText).not.toMatch(/old-alpha|old-beta|old-gamma|dockview|webContents|senderId|windowId/i);
  }, 45_000);
});
