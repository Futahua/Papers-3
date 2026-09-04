import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { evalInHost, launchPapers, waitFor } from './helpers';

it('hover picker and main-screen clicks reuse tabs, middle-click adds, and split borders resize', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-navigation-'));
  const ids = ['bp-11111111-1111-4111-8111-111111111111', 'bp-22222222-2222-4222-8222-222222222222', 'bp-33333333-3333-4333-8333-333333333333'];
  const names = ['Alpha', 'Beta', 'Gamma'];
  const data = path.join(profile, 'PapersData');
  const projects: Record<string, { root: string }> = {};
  const backpacks = ids.map((id, index) => ({ id, name: names[index]!, type: 'environment', createdAt: '2026-09-04T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
  for (const backpack of backpacks) {
    const root = path.join(profile, backpack.id);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.mkdir(path.join(data, 'backpacks', backpack.id), { recursive: true });
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: backpack.id, entry: 'public/index.html' }));
    await fs.writeFile(path.join(root, 'public/index.html'), '<h1>Synthetic Backpack</h1>');
    await fs.writeFile(path.join(data, 'backpacks', backpack.id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
    projects[backpack.id] = { root };
  }
  await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects }));
  const launched = await launchPapers(profile, { fixtures: false });
  try {
    const page = await launched.app.firstWindow();
    const tabCount = (count: number) => waitFor(async () => await page.getByRole('tab').count() === count, 10000, `${count} tabs`);
    const mainEnter = (name: string) => page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) }).getByRole('button', { name: 'Enter', exact: true });
    await waitFor(async () => await mainEnter('Alpha').count() === 1, 10000, 'main picker');
    await mainEnter('Alpha').click();
    await tabCount(1);
    await page.locator('.titlebar-left > button').click();
    await mainEnter('Beta').click();
    await tabCount(1);
    await waitFor(async () => await page.getByRole('tab', { name: 'Beta' }).count() === 1, 10000, 'Beta replaces Alpha');
    await page.locator('.titlebar-left > button').click();
    await mainEnter('Gamma').click({ button: 'middle' });
    await tabCount(2);
    const sidebar = page.getByRole('navigation', { name: 'Choose Backpack' });
    await page.mouse.move(500, 20);
    const dockBeforeSidebar = await page.locator('.workspace-dock').boundingBox();
    await page.locator('.titlebar-left > button').hover();
    expect(await sidebar.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
    const dockAfterSidebar = await page.locator('.workspace-dock').boundingBox();
    expect(dockAfterSidebar?.x).toBe(dockBeforeSidebar?.x);
    expect(dockAfterSidebar?.width).toBe(dockBeforeSidebar?.width);
    await sidebar.getByRole('button', { name: 'Alpha', exact: true }).click();
    await waitFor(async () => await page.getByRole('tab', { name: 'Alpha' }).count() === 1, 10000, 'sidebar replacement');
    await tabCount(2);
    await page.mouse.move(500, 20);
    await page.locator('.titlebar-left > button').hover();
    await sidebar.getByRole('button', { name: 'Beta', exact: true }).click({ button: 'middle' });
    await tabCount(3);
    const draggedTab = page.getByRole('tab', { name: 'Beta' }).first();
    const draggedTabBox = await draggedTab.boundingBox();
    const dockBox = await page.locator('.workspace-dock').boundingBox();
    expect(draggedTabBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    await page.mouse.move(draggedTabBox!.x + draggedTabBox!.width / 2, draggedTabBox!.y + draggedTabBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dockBox!.x + dockBox!.width - 6, dockBox!.y + dockBox!.height / 2, { steps: 12 });
    await waitFor(async () => await page.locator('.workspace-split-preview.is-armed:not(.is-rejected)').isVisible(), 10000, 'armed split preview');
    expect(await page.locator('.workspace-split-preview').getAttribute('data-position')).toBe('right');
    await page.mouse.up();
    await waitFor(async () => await page.locator('.workspace-split-preview').count() === 0, 10000, 'split preview cleared after drop');
    expect(await page.evaluate(() => document.documentElement.dataset.workspaceDrag)).toBe('false');
    const sash = page.locator('.dv-sash.dv-enabled').first();
    await waitFor(async () => await sash.isVisible(), 10000, 'split divider');
    const readTopology = async () => {
      const saved = JSON.parse(await fs.readFile(path.join(data, 'workspace-topologies.json'), 'utf8'));
      return saved.workspaces[0].topology as { groups: Array<{ surfaceIds: string[]; activeSurfaceId: string }>; root: { kind: string; weights: number[] } };
    };
    await waitFor(async () => (await readTopology()).root.kind === 'split', 10000, 'persisted split');
    const before = await readTopology();
    const liveIds = () => launched.app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter((contents) => contents.getURL().startsWith('papers-backpack://')).map((contents) => contents.id).sort());
    const contentsBefore = await liveIds();
    const box = await sash.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 140, box!.y + box!.height / 2, { steps: 8 });
    await page.mouse.up();
    await waitFor(async () => Math.abs((await readTopology()).root.weights[0]! - before.root.weights[0]!) > 0.05, 10000, 'dragged split size persisted');
    expect(await liveIds()).toEqual(contentsBefore);
    const splitTopology = await readTopology();
    const loneGroup = splitTopology.groups.find((group) => group.surfaceIds.length === 1)!;
    await evalInHost(launched.app, `window.papersHost.backpackProject.close(${JSON.stringify(loneGroup.activeSurfaceId)})`);
    await tabCount(2);
    await page.getByRole('tab').first().press('Control+Alt+ArrowDown');
    await waitFor(async () => (await readTopology()).root.kind === 'split', 10000, 'vertical split');
    const verticalBefore = await readTopology();
    const horizontalSash = page.locator('.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled').first();
    const verticalBox = await horizontalSash.boundingBox();
    expect(verticalBox).not.toBeNull();
    await page.mouse.move(verticalBox!.x + verticalBox!.width / 2, verticalBox!.y + verticalBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(verticalBox!.x + verticalBox!.width / 2, verticalBox!.y + 100, { steps: 8 });
    await page.mouse.up();
    await waitFor(async () => Math.abs((await readTopology()).root.weights[0]! - verticalBefore.root.weights[0]!) > 0.05, 10000, 'vertical resize persisted');

    await evalInHost(launched.app, `(async () => {
      for (let i = 0; i < 35; i++) await window.papersHost.backpacks.create('Empty ' + i);
    })()`);
    await page.mouse.move(500, 20);
    await page.locator('.titlebar-left > button').hover();
    expect(await sidebar.locator('.backpack-sidebar-list').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await sidebar.getByRole('button', { name: 'Empty 34', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Papers', exact: true }).click();
    // Empty destinations must not consume the previously selected working tab.
    expect((await readTopology()).groups.flatMap((group) => group.surfaceIds)).toHaveLength(2);
    expect(await evalInHost(launched.app, `Boolean(document.querySelector('.layouts-control'))`)).toBe(false);
  } finally {
    await launched.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}, 60000);
