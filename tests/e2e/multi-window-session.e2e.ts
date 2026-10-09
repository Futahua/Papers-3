import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { launchPapers, evalInHost, waitFor, type LaunchedApp } from './helpers';

it('reopens unclosed Papers windows separately after process restart and parks explicitly closed windows', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-session-windows-'));
  const data = path.join(profile, 'PapersData');
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const projects = [
    { id: 'bp-11111111-1111-4111-8111-111111111111', name: 'First', key: 'page-first', workspaceId: first },
    { id: 'bp-22222222-2222-4222-8222-222222222222', name: 'Second', key: 'page-second', workspaceId: second },
  ];
  const backpacks = projects.map(p => ({
    id: p.id, name: p.name, type: 'environment', createdAt: '2026-10-09T00:00:00.000Z',
    lastEnteredAt: null, archived: false, workspacePath: null,
  }));
  await fs.mkdir(data, { recursive: true });
  for (const p of projects) {
    const root = path.join(profile, p.name);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'index.html'), `<html><body>${p.name}</body></html>`);
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: p.id, entry: 'public/index.html' }));
    await fs.mkdir(path.join(data, 'backpacks', p.id), { recursive: true });
    await fs.writeFile(path.join(data, 'backpacks', p.id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpacks.find(b => b.id === p.id) }));
  }
  await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks, lastActiveBackpackId: null }));
  await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1,
    projects: Object.fromEntries(projects.map(p => [p.id, { root: path.join(profile, p.name) }])) }));
  const topology = (p: typeof projects[number]) => ({
    schemaVersion: 1, surfaces: [{ surfaceId: `runtime-${p.key}`, surfaceKey: p.key, projectId: p.id, title: p.name }],
    groups: [{ groupId: 'group-main', surfaceIds: [`runtime-${p.key}`], activeSurfaceId: `runtime-${p.key}` }],
    root: { kind: 'group', groupId: 'group-main' }, focusedGroupId: 'group-main',
  });
  await fs.writeFile(path.join(data, 'workspace-topologies.json'), JSON.stringify({
    schemaVersion: 2, lastWorkspaceId: first,
    workspaces: projects.map((p, i) => ({ workspaceId: p.workspaceId, topology: topology(p),
      session: true, window: { parked: false, bounds: { x: 30 + i * 70, y: 50 + i * 70, width: 1100, height: 730 } },
      updatedAt: '2026-10-09T00:00:00.000Z' })),
  }));

  let launched: LaunchedApp | null = null;
  const findWindows = async () => {
    if (!launched) throw new Error('Papers fixture is not running');
    return evalInHost<Array<{ windowId: number }>>(launched.app, 'papersHost.app.windows()');
  };
  const findPages = async () => {
    if (!launched) throw new Error('Papers fixture is not running');
    return evalInHost<Array<{ key: string; windowId: number | null }>>(launched.app, 'papersHost.app.pages()');
  };
  try {
    for (let restart = 0; restart < 2; restart++) {
      launched = await launchPapers(profile, { fixtures: false });
      await waitFor(async () => (await findWindows()).length === 2, 25000, 'two separate Papers windows');
      await waitFor(async () => {
        const pages = await findPages();
        return pages.length === 2 && pages.every(p => p.windowId !== null)
          && new Set(pages.map(p => p.windowId)).size === 2;
      }, 25000, 'distinct restored window owners');
      expect((await findPages()).map(p => p.key).sort()).toEqual(['page-first', 'page-second']);
      const saved = JSON.parse(await fs.readFile(path.join(data, 'workspace-topologies.json'), 'utf8')) as {
        workspaces: Array<{ workspaceId: string; window: { parked: boolean } }>;
      };
      expect(saved.workspaces.filter(w => !w.window?.parked).map(w => w.workspaceId).sort()).toEqual([first, second]);
      if (restart === 0) {
        await launched.app.evaluate(({ app }) => { app.quit(); });
        await launched.close();
        launched = null;
      }
    }

    const toPark = (await findPages()).find(p => p.key === 'page-second')!.windowId!;
    await launched!.app.evaluate(({ BaseWindow }, id) => { BaseWindow.getAllWindows().find(w => w.id === id)?.close(); }, toPark);
    await waitFor(async () => (await findWindows()).length === 1, 18000, 'explicitly closed secondary window');
    const parked = await findPages();
    expect(parked.find(p => p.key === 'page-second')?.windowId).toBeNull();
    await launched!.app.evaluate(({ app }) => { app.quit(); });
    await launched!.close();launched = null;

    launched = await launchPapers(profile, { fixtures: false });
    await waitFor(async () => (await findWindows()).length === 1, 25000, 'closed window stays parked after restart');
    expect((await findPages()).find(p => p.key === 'page-second')?.windowId).toBeNull();
    await evalInHost(launched.app, `document.querySelector('[aria-label="Pages"]').click()`);
    await waitFor(()=>evalInHost<boolean>(launched!.app, `Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).some(button=>button.textContent==='Second · saved')`),5000,'saved page menu entry');
    expect(await evalInHost<boolean>(launched.app, `(()=>{const button=Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).find(button=>button.textContent==='Second · saved');return !!button&&!button.disabled&&button.title==='Reopen saved page';})()`)).toBe(true);
    await evalInHost(launched.app, `Array.from(document.querySelectorAll('.saved-page-row [role="menuitem"]')).find(button=>button.textContent==='Second · saved').click()`);
    await waitFor(async () => (await findWindows()).length === 2, 25000, 'saved parked window manually reopened');
    expect((await findPages()).find(page=>page.key==='page-second')?.windowId).not.toBeNull();
    expect(await evalInHost<boolean>(launched.app, `!document.querySelector('.pages-menu')`)).toBe(true);
  } finally {
    await launched?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
