import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const papersRoot = process.env.PAPERS_SOURCE_ROOT || 'D:/Letters/MatTroiSeConMoc/Products/Papers/Source';
const executablePath = process.env.PAPERS_PACKAGED_EXE;
const acceptance = executablePath ? test : test.skip;

acceptance('two native surfaces naturally stop moving after coordinated position saves', { timeout: 45000 }, async () => {
  const { _electron: electron } = createRequire(join(papersRoot, 'package.json'))('playwright-core');
  const profile = await mkdtemp(join(tmpdir(), 'ayg-settling-'));
  const projectRoot = join(profile, 'project');
  const id = 'bp-33333333-3333-4333-8333-333333333333';
  const data = join(profile, 'PapersData');
  const backpack = { id, name: 'Synthetic settling', type: 'environment', createdAt: '2026-09-04T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null };
  await mkdir(join(data, 'backpacks', id), { recursive: true });
  await mkdir(projectRoot);
  await cp(process.env.AS_YOU_GO_PUBLIC_ROOT || new URL('./public/', import.meta.url), join(projectRoot, 'public'), { recursive: true });
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: id, entry: 'public/workspace-20260730b.html' }));
  await writeFile(join(projectRoot, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    groups: ['a', 'b', 'c', 'd', 'e', 'f'].map((key, order) => ({ id: key, name: `Folder ${key}`, parentId: 'root', order })),
    shortcuts: [], view: { layout: 'graph', iconSize: 72, itemSets: [
      { id: 'left', type: 'set', title: 'Left', memberIds: ['a', 'b', 'c'], excludedIds: [] },
      { id: 'right', type: 'set', title: 'Right', memberIds: ['c', 'd', 'e'], excludedIds: [] },
    ] },
  }));
  await writeFile(join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
  await writeFile(join(data, 'backpacks', id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  await writeFile(join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [id]: { root: projectRoot } } }));
  const app = await electron.launch({ executablePath, cwd: papersRoot, env: {
    ...process.env, PAPERS_TEST_USER_DATA: profile, PAPERS_ENABLE_FIXTURES: '0',
  } });
  const host = (windowId, script) => app.evaluate(async ({ BaseWindow }, { windowId, script }) => {
    const window = BaseWindow.getAllWindows().find((candidate) => candidate.id === windowId);
    return window.contentView.children[0].webContents.executeJavaScript(script, true);
  }, { windowId, script });
  const positions = () => app.evaluate(async ({ BaseWindow }) => Promise.all(BaseWindow.getAllWindows().map(async (window) => {
    const project = window.contentView.children.find((view) => view.webContents.getURL().startsWith('papers-backpack://'));
    return project ? project.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-graph-node-id]'), node => ({id: node.dataset.graphNodeId, transform: node.style.transform})).sort((a,b) => a.id.localeCompare(b.id))`) : [];
  })));
  try {
    await app.firstWindow();
    const first = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].id);
    await host(first, 'window.papersHost.app.newWindow()');
    const windows = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((window) => {
      window.setBounds({ x: 0, y: 0, width: 1000, height: 760 });
      return window.id;
    }));
    assert.equal(windows.length, 2);
    for (const windowId of windows) {
      // Wait for the newly created host document, without touching the live app.
      const deadline = Date.now() + 10000;
      while (!(await host(windowId, 'Boolean(window.papersHost)'))) {
        if (Date.now() > deadline) throw new Error('synthetic host did not load');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const opened = await host(windowId, `window.papersHost.backpackProject.open('${id}')`);
      await host(windowId, `window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(opened.url)})`);
      const topology = { schemaVersion: 1, surfaces: [{ surfaceId: opened.surfaceId, projectId: id, title: 'Synthetic settling' }], groups: [{ groupId: 'g', surfaceIds: [opened.surfaceId], activeSurfaceId: opened.surfaceId }], root: { kind: 'group', groupId: 'g' }, focusedGroupId: 'g' };
      await host(windowId, `window.papersHost.layout.commitWorkspaceTopology(${JSON.stringify(topology)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 12000));
    const firstSample = await positions();
    assert.deepEqual(firstSample.map((nodes) => nodes.length), [6, 6]);
    const durable = JSON.parse(await readFile(join(projectRoot, 'state.json'), 'utf8'));
    assert.equal(Object.keys(durable.view.graphRestPositions.root).length, 6);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.deepEqual(await positions(), firstSample, 'items continued moving after the cooling interval');
  } finally {
    await app.close();
  }
});
