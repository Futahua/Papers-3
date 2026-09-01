import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInBackpackProject, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- shared production control client is plain ESM.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const A = 'bp-11111111-1111-4111-8111-111111111111';
const B = 'bp-22222222-2222-4222-8222-222222222222';
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

async function projectSenderId(projectId: string): Promise<number | null> {
  return launched.app.evaluate(({ webContents }, id) =>
    webContents.getAllWebContents()
      .find((contents) => contents.getURL().startsWith(`papers-backpack://${id}/`))?.id ?? null,
  projectId);
}

async function seedProject(userDataDir: string, id: string, name: string): Promise<{ id: string; name: string; root: string }> {
  const root = path.join(userDataDir, `project-${name.toLowerCase()}`);
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: id, entry: 'public/index.html' }));
  await fs.writeFile(path.join(root, 'public', 'index.html'), `<!doctype html><h1>${name}</h1>`);
  return { id, name, root };
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-workspace-tabs-'));
  descriptorPath = path.join(userDataDir, 'dev-control.json');
  const projects = [
    await seedProject(userDataDir, A, 'Alpha'),
    await seedProject(userDataDir, B, 'Beta'),
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
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readDescriptor(descriptorPath); return true; } catch { return false; }
  }, 10_000, 'workspace control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) await fs.rm(launched.userDataDir, { recursive: true, force: true });
});

function enterBackpack(name: string): string {
  return `(() => {
    const card = [...document.querySelectorAll('.backpack-card')].find((item) =>
      item.querySelector('.name')?.textContent?.trim() === ${JSON.stringify(name)});
    const enter = [...(card?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Enter');
    enter?.click();
    return Boolean(enter);
  })()`;
}

describe('A1 workspace tabs', () => {
  it('keeps two logical projects in one native window and swaps native presentation by tab', async () => {
    expect(await evalInHost<boolean>(launched.app, enterBackpack('Alpha'))).toBe(true);
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>)
      .some((surface) => surface.projectId === A && surface.presentation === 'visible'), 10_000, 'visible Alpha surface');

    expect(await evalInHost<boolean>(launched.app, `(() => {
      const button = document.querySelector('.titlebar .pill-button');
      button?.click();
      return Boolean(button);
    })()`)).toBe(true);
    await waitFor(() => evalInHost<boolean>(launched.app, `Boolean([...document.querySelectorAll('.backpack-card .name')]
      .find((node) => node.textContent?.trim() === 'Beta'))`), 10_000, 'Backpack picker');
    expect(await evalInHost<boolean>(launched.app, enterBackpack('Beta'))).toBe(true);

    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>;
      return surfaces.length === 2
        && surfaces.some((surface) => surface.projectId === A && surface.presentation === 'hidden')
        && surfaces.some((surface) => surface.projectId === B && surface.presentation === 'visible');
    }, 10_000, 'two tab surfaces with Beta active');
    const alphaSenderId = await projectSenderId(A);
    expect(alphaSenderId).not.toBeNull();
    expect(await evalInHost<string[]>(launched.app, `[...document.querySelectorAll('.dv-tab')]
      .map((tab) => tab.textContent?.trim() ?? '').filter(Boolean)`)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    const hostPage = await launched.app.firstWindow();
    const windowId = (await call('inspect.surfaces') as Array<{ windowId: number }>)[0]!.windowId;
    const alphaTab = hostPage.getByRole('tab', { name: 'Alpha' });
    const alphaBox = await alphaTab.boundingBox();
    await hostPage.getByRole('tab', { name: 'Beta' }).dragTo(alphaTab, {
      targetPosition: { x: 2, y: Math.max(2, Math.round((alphaBox?.height ?? 20) / 2)) },
    });
    await waitFor(() => evalInHost<boolean>(launched.app, `[...document.querySelectorAll('.dv-tab')]
      .map((tab) => tab.textContent?.trim()).filter(Boolean).join(',') === 'Beta,Alpha'`),
    10_000, 'Dockview tab reorder');
    await waitFor(async () => {
      const workspace = await call('inspect.workspace', { windowId }) as {
        topology: { groups: Array<{ surfaceIds: string[] }>; surfaces: Array<{ surfaceId: string; projectId: string }> };
      };
      const byProject = new Map(workspace.topology.surfaces.map((surface) => [surface.projectId, surface.surfaceId]));
      return workspace.topology.groups[0]?.surfaceIds.join(',') === `${byProject.get(B)},${byProject.get(A)}`;
    }, 10_000, 'Papers topology follows real tab reorder');
    await hostPage.getByRole('tab', { name: 'Alpha' }).click();
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>;
      return surfaces.some((surface) => surface.projectId === A && surface.presentation === 'visible')
        && surfaces.some((surface) => surface.projectId === B && surface.presentation === 'hidden');
    }, 10_000, 'Alpha tab activation');
    expect(await projectSenderId(A)).toBe(alphaSenderId);

    await hostPage.getByRole('button', { name: 'Split Right' }).click();
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>;
      return surfaces.filter((surface) => surface.presentation === 'visible').length === 2;
    }, 10_000, 'two visible native split panes');
    expect(await hostPage.locator('.dv-groupview').count()).toBe(2);
    expect(await hostPage.getByRole('button', { name: 'Split Right' }).isDisabled()).toBe(true);
    expect(await hostPage.getByRole('button', { name: 'Split Down' }).isDisabled()).toBe(true);

    const sash = hostPage.locator('.dv-sash.dv-enabled').first();
    const sashBox = await sash.boundingBox();
    expect(sashBox).not.toBeNull();
    await hostPage.mouse.move((sashBox?.x ?? 0) + 2, (sashBox?.y ?? 0) + 20);
    await hostPage.mouse.down();
    await hostPage.mouse.move((sashBox?.x ?? 0) + 100, (sashBox?.y ?? 0) + 20, { steps: 5 });
    await hostPage.mouse.up();
    await waitFor(async () => {
      const workspace = await call('inspect.workspace', { windowId }) as { topology: { root: { weights?: number[] } } };
      const weights = workspace.topology.root.weights;
      return Boolean(weights && Math.abs((weights[0] ?? 0) - 0.5) > 0.05);
    }, 10_000, 'Papers topology follows real sash resize');

    const movedAlphaBox = await hostPage.getByRole('tab', { name: 'Alpha' }).boundingBox();
    const targetBetaBox = await hostPage.getByRole('tab', { name: 'Beta' }).boundingBox();
    expect(movedAlphaBox).not.toBeNull();
    expect(targetBetaBox).not.toBeNull();
    await hostPage.mouse.move((movedAlphaBox?.x ?? 0) + 10, (movedAlphaBox?.y ?? 0) + 10);
    await hostPage.mouse.down();
    await hostPage.waitForTimeout(150);
    await hostPage.mouse.move((movedAlphaBox?.x ?? 0) + 25, (movedAlphaBox?.y ?? 0) + 10, { steps: 3 });
    await hostPage.mouse.move((targetBetaBox?.x ?? 0) + 10, (targetBetaBox?.y ?? 0) + 10, { steps: 12 });
    await hostPage.waitForTimeout(150);
    await hostPage.mouse.up();
    await waitFor(async () => {
      const workspace = await call('inspect.workspace', { windowId }) as { topology: { groups: unknown[]; root: { kind: string } } };
      return workspace.topology.groups.length === 1
        && workspace.topology.root.kind === 'group'
        && await hostPage.locator('.dv-groupview').count() === 1;
    }, 10_000, 'moving final tab collapses Papers and Dockview source group');

    await evalInBackpackProject(launched.app, `window.postMessage({ type: 'papers:project:close' }, '*')`);
    await waitFor(async () => {
      const surfaces = await call('inspect.surfaces') as Array<{ projectId: string; presentation: string }>;
      return surfaces.length === 1
        && surfaces[0]?.projectId === B
        && surfaces[0]?.presentation === 'visible';
    }, 10_000, 'authoritative project close with surviving Beta active');
    expect(await hostPage.getByRole('tab', { name: 'Alpha' }).count()).toBe(0);
    expect(await hostPage.getByRole('tab', { name: 'Beta' }).count()).toBe(1);
  });
});
