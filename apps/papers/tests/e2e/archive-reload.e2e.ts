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
let userDataDir: string;

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

async function waitForDescriptor(): Promise<void> {
  await waitFor(async () => {
    try {
      await readDescriptor(descriptorPath);
      return true;
    } catch {
      return false;
    }
  }, 10_000, 'archive/reload control descriptor');
}

async function waitForProjects(projectIds: string[], label: string): Promise<Array<{ surfaceId: string; projectId: string; windowId: number }>> {
  let current: Array<{ surfaceId: string; projectId: string; windowId: number }> = [];
  await waitFor(async () => {
    current = await call('inspect.surfaces') as Array<{ surfaceId: string; projectId: string; windowId: number }>;
    return current.length === projectIds.length && projectIds.every((projectId) => current.some((surface) => surface.projectId === projectId));
  }, 15_000, label);
  return current;
}

beforeAll(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-archive-reload-'));
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
          { surfaceId: OLD_ALPHA, projectId: ALPHA, title: 'Alpha' },
          { surfaceId: OLD_BETA, projectId: BETA, title: 'Beta' },
          { surfaceId: OLD_GAMMA, projectId: GAMMA, title: 'Gamma' },
        ],
        groups: [{ groupId: 'group-main', surfaceIds: [OLD_ALPHA, OLD_BETA, OLD_GAMMA], activeSurfaceId: OLD_BETA }],
        root: { kind: 'group', groupId: 'group-main' },
        focusedGroupId: 'group-main',
      },
    }],
  }));

  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitForDescriptor();
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

describe('A1.2j archive/remove and crash/reload durability', () => {
  it('does not resurrect archived or removed projects across reloads', async () => {
    const initial = await waitForProjects([ALPHA, BETA, GAMMA], 'initial three-surface hydration');
    const primaryWindowId = initial[0]!.windowId;
    const initialByProject = new Map(initial.map((surface) => [surface.projectId, surface.surfaceId]));
    expect(initial.every(({ surfaceId }) => ![OLD_ALPHA, OLD_BETA, OLD_GAMMA].includes(surfaceId))).toBe(true);

    await evalInHost(launched.app, `window.papersHost.backpacks.setArchived(${JSON.stringify(BETA)}, true)`);
    const afterArchive = await waitForProjects([ALPHA, GAMMA], 'archive retires only Beta');
    expect(afterArchive.every(({ projectId }) => projectId !== BETA)).toBe(true);
    expect(afterArchive.every(({ windowId }) => windowId === primaryWindowId)).toBe(true);
    const afterArchiveWorkspace = await call('inspect.workspace', { windowId: primaryWindowId }) as {
      topology: { surfaces: Array<{ projectId: string }>; groups: Array<{ surfaceIds: string[]; activeSurfaceId: string | null }> };
    };
    expect(afterArchiveWorkspace.topology.surfaces.map(({ projectId }) => projectId)).toEqual(expect.arrayContaining([ALPHA, GAMMA]));
    expect(afterArchiveWorkspace.topology.surfaces).toHaveLength(2);
    expect(afterArchiveWorkspace.topology.groups[0]?.activeSurfaceId).toBe(initialByProject.get(ALPHA));

    const persistedPath = path.join(launched.userDataDir, 'PapersData', 'workspace-topologies.json');
    await waitFor(async () => {
      try {
        const persisted = JSON.parse(await fs.readFile(persistedPath, 'utf8')) as {
          lastWorkspaceId: string;
          workspaces: Array<{ workspaceId: string; topology: { surfaces: Array<{ projectId: string }> } }>;
        };
        const projects = persisted.workspaces[0]?.topology.surfaces.map(({ projectId }) => projectId) ?? [];
        return persisted.lastWorkspaceId === WORKSPACE_ID
          && persisted.workspaces.length === 1
          && persisted.workspaces[0]?.workspaceId === WORKSPACE_ID
          && projects.length === 2
          && projects.includes(ALPHA)
          && projects.includes(GAMMA)
          && !projects.includes(BETA);
      } catch {
        return false;
      }
    }, 10_000, 'archive topology durable commit');

    await launched.close();
    launched = await launchPapers(userDataDir, {
      fixtures: false,
      devControlDescriptor: descriptorPath,
    });
    await waitForDescriptor();
    const afterReload = await waitForProjects([ALPHA, GAMMA], 'reload hydrates only surviving projects');
    expect(afterReload.every(({ surfaceId }) => ![OLD_ALPHA, OLD_BETA, OLD_GAMMA].includes(surfaceId))).toBe(true);
    const reloadedWorkspace = await call('inspect.workspace', { windowId: afterReload[0]!.windowId }) as {
      topology: { surfaces: Array<{ projectId: string }>; groups: Array<{ activeSurfaceId: string | null }> };
    };
    expect(reloadedWorkspace.topology.surfaces.map(({ projectId }) => projectId)).toEqual(expect.arrayContaining([ALPHA, GAMMA]));
    expect(reloadedWorkspace.topology.surfaces).toHaveLength(2);
    expect(reloadedWorkspace.topology.groups[0]?.activeSurfaceId).toBeTruthy();

    await evalInHost(launched.app, `window.papersHost.backpacks.remove(${JSON.stringify(BETA)})`);
    const registryPath = path.join(launched.userDataDir, 'PapersData', 'registry.json');
    await waitFor(async () => {
      try {
        const registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as { backpacks: Array<{ id: string }> };
        return !registry.backpacks.some(({ id }) => id === BETA);
      } catch {
        return false;
      }
    }, 10_000, 'already archived Backpack removal');
    expect((await call('inspect.surfaces') as Array<{ projectId: string }>).map(({ projectId }) => projectId))
      .toEqual(expect.arrayContaining([ALPHA, GAMMA]));

    const secondWindow = await call('window.create') as { windowId: number };
    await waitFor(async () => (await call('inspect.windows') as Array<{ windowId: number }>).some(
      ({ windowId }) => windowId === secondWindow.windowId), 10_000, 'fresh secondary window after reload');
    expect((await call('inspect.surfaces') as Array<{ windowId: number }>).filter(
      ({ windowId }) => windowId === secondWindow.windowId)).toEqual([]);

    launched.app.process().kill('SIGKILL');
    await launched.close();
    launched = await launchPapers(userDataDir, {
      fixtures: false,
      devControlDescriptor: descriptorPath,
    });
    await waitForDescriptor();
    const afterCrashReload = await waitForProjects([ALPHA, GAMMA], 'crash/reload surviving projects');
    expect(afterCrashReload).toHaveLength(2);
    expect(afterCrashReload.every(({ projectId }) => projectId === ALPHA || projectId === GAMMA)).toBe(true);
    const finalText = await fs.readFile(persistedPath, 'utf8');
    expect(finalText).not.toMatch(/old-alpha|old-beta|old-gamma|dockview|webContents|senderId|windowId/i);
  }, 90_000);
});
