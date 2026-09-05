import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';

import { launchPapers, waitFor } from './helpers';

it('splits directly from one group into another group through content center', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-center-split-'));
  const ids = ['bp-11111111-1111-4111-8111-111111111111', 'bp-22222222-2222-4222-8222-222222222222', 'bp-33333333-3333-4333-8333-333333333333'];
  const names = ['Alpha', 'Beta', 'Gamma'];
  const data = path.join(profile, 'PapersData');
  const projects: Record<string, { root: string }> = {};
  const backpacks = ids.map((id, index) => ({ id, name: names[index]!, type: 'environment', createdAt: '2026-09-05T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
  for (const backpack of backpacks) {
    const root = path.join(profile, backpack.id);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.mkdir(path.join(data, 'backpacks', backpack.id), { recursive: true });
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: backpack.id, entry: 'public/index.html' }));
    await fs.writeFile(path.join(root, 'public/index.html'), `<h1>${backpack.name}</h1>`);
    await fs.writeFile(path.join(data, 'backpacks', backpack.id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
    projects[backpack.id] = { root };
  }
  await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects }));
  const launched = await launchPapers(profile, { fixtures: false });
  try {
    const page = await launched.app.firstWindow();
    const mainEnter = (name: string) => page.locator('.backpack-card').filter({ has: page.locator('.name', { hasText: name }) }).getByRole('button', { name: 'Enter', exact: true });
    await waitFor(async () => await mainEnter('Alpha').count() === 1, 10000, 'main picker');
    await mainEnter('Alpha').click();
    await page.locator('.titlebar-left > button').click();
    await mainEnter('Beta').click({ button: 'middle', force: true });
    await page.locator('.titlebar-left > button').click();
    await mainEnter('Gamma').click({ button: 'middle', force: true });
    await waitFor(async () => await page.getByRole('tab').count() === 3, 10000, 'three source tabs');

    // Establish two real groups without moving a tab into the eventual target
    // group. The source group retains two tabs, so direct cross-group splitting
    // has truthful current and future half-pane geometry.
    await page.getByRole('tab', { name: 'Beta' }).press('Control+Alt+ArrowRight');
    await waitFor(async () => await page.locator('.dv-groupview').count() === 2, 10000, 'two groups');
    const groups = page.locator('.dv-groupview');
    let sourceIndex = -1;
    let targetIndex = -1;
    for (let index = 0; index < await groups.count(); index += 1) {
      const tabs = groups.nth(index).locator('.dv-tab');
      if (await tabs.count() >= 2) sourceIndex = index;
      else if (await tabs.count() === 1) targetIndex = index;
    }
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const sourceTab = groups.nth(sourceIndex).locator('.dv-tab').first();
    const targetContent = groups.nth(targetIndex).locator('.dv-content-container');
    const sourceTabBox = await sourceTab.boundingBox();
    const targetBox = await targetContent.boundingBox();
    expect(sourceTabBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const before = JSON.parse(await fs.readFile(path.join(data, 'workspace-topologies.json'), 'utf8'));
    await page.mouse.move(sourceTabBox!.x + sourceTabBox!.width / 2, sourceTabBox!.y + sourceTabBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await waitFor(async () => await page.locator('.workspace-split-preview.is-armed').count() === 1, 10000, 'center split preview');
    expect(await page.locator('.workspace-split-preview').getAttribute('data-position')).not.toBe('center');
    expect(await page.locator('.workspace-split-preview').getAttribute('data-target-group')).not.toBeNull();
    const previewBox = await page.locator('.workspace-split-preview').boundingBox();
    expect(previewBox).not.toBeNull();
    expect(previewBox!.x).toBeGreaterThanOrEqual(targetBox!.x - 1);
    expect(previewBox!.y).toBeGreaterThanOrEqual(targetBox!.y - 1);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(targetBox!.x + targetBox!.width + 1);
    expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(targetBox!.y + targetBox!.height + 1);
    const during = JSON.parse(await fs.readFile(path.join(data, 'workspace-topologies.json'), 'utf8'));
    expect(during.workspaces[0].topology.groups).toEqual(before.workspaces[0].topology.groups);
    expect(during.workspaces[0].topology.root).toEqual(before.workspaces[0].topology.root);
    await page.mouse.up();
    await waitFor(async () => await page.locator('.dv-groupview').count() === 3, 10000, 'direct center split');
    expect(await page.locator('.workspace-split-preview').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.workspaceDrag)).not.toBe('true');

    // A singleton source is also a valid cross-group move. Its old group is
    // removed by the canonical mutation, so the prospective preview must be
    // armed before release and the final group count must remain stable after
    // the target is split in place.
    const singletonGroups = page.locator('.dv-groupview');
    let singletonSourceIndex = -1;
    let singletonTargetIndex = -1;
    for (let index = 0; index < await singletonGroups.count(); index += 1) {
      const tabs = singletonGroups.nth(index).locator('.dv-tab');
      if (await tabs.count() !== 1) continue;
      if (singletonSourceIndex < 0) singletonSourceIndex = index;
      else if (singletonTargetIndex < 0) singletonTargetIndex = index;
    }
    expect(singletonSourceIndex).toBeGreaterThanOrEqual(0);
    expect(singletonTargetIndex).toBeGreaterThanOrEqual(0);
    const singletonTab = singletonGroups.nth(singletonSourceIndex).locator('.dv-tab').first();
    const singletonTargetContent = singletonGroups.nth(singletonTargetIndex).locator('.dv-content-container');
    const singletonTabBox = await singletonTab.boundingBox();
    const singletonTargetBox = await singletonTargetContent.boundingBox();
    expect(singletonTabBox).not.toBeNull();
    expect(singletonTargetBox).not.toBeNull();
    await page.mouse.move(singletonTabBox!.x + singletonTabBox!.width / 2, singletonTabBox!.y + singletonTabBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(singletonTargetBox!.x + singletonTargetBox!.width / 2, singletonTargetBox!.y + singletonTargetBox!.height / 2, { steps: 12 });
    await waitFor(async () => await page.locator('.workspace-split-preview.is-armed').count() === 1, 10000, 'singleton center split preview');
    expect(await page.locator('.workspace-split-preview').getAttribute('data-position')).not.toBe('center');
    await page.mouse.up();
    await waitFor(async () => await page.locator('.dv-groupview').count() === 3, 10000, 'singleton direct center split');
    expect(await page.locator('.workspace-split-preview').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.workspaceDrag)).not.toBe('true');
  } finally {
    await launched.close();
  }
});
