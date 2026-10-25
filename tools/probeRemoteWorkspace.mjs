// Opens a paired device's own As you Go from an isolated Papers instance, the way the
// creator does (Devices button -> device -> provider label), and checks it is the same page
// on that device's document: edits are saved by the device, a stale save is refused, and
// only what the device confirmed is shown. Restores the device's original document after.
// Usage: node tools/probeRemoteWorkspace.mjs <device name>
import { _electron } from 'playwright-core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

const [deviceName] = process.argv.slice(2);
if (!deviceName) throw Error('usage: probeRemoteWorkspace.mjs <device name>');
const ayg = process.env.PAPERS_AYG_SOURCE ?? 'D:/Programs/CodexTemp/AYGCrossDeviceSource';
const projectId = JSON.parse(await fs.readFile(path.join(ayg, 'project.json'), 'utf8')).backpackId;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-remote-workspace-'));
const results = [];
async function check(name, run) {
  const started = Date.now();
  try { const detail = await run(); results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); return true; }
  catch (error) { results.push({ name, ok: false, ms: Date.now() - started, error: String(error.message).slice(0, 500) }); return false; }
}
const data = path.join(root, 'data'), projectDir = path.join(data, 'project'), documents = path.join(data, 'PapersData');
await fs.mkdir(documents, { recursive: true });
await fs.cp(ayg, projectDir, { recursive: true, filter: source => !/[\\/](\.git|node_modules)([\\/]|$)/.test(source) && !/[\\/]state\.json$/.test(source) });
await fs.writeFile(path.join(documents, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectDir } } }));
await fs.writeFile(path.join(documents, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'As you Go', type: 'environment', createdAt: new Date().toISOString(), lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: projectId }));
const descriptor = path.join(data, 'control.json');
const app = await _electron.launch({ args: [process.cwd()], env: { ...process.env, PAPERS_TEST_USER_DATA: data, PAPERS_TEST_JOIN_NAME: 'Remote workspace check', PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor } });
let original = null, ownerId = null, workspaceId = null, local = null, seededIcon = false;
const cap = (page, operation, params) => page.evaluate(async ([o, p]) => (await import('./app/host/host-bridge.js')).createHostBridge(window).fileCapability(o, p), [operation, params]);
const remote = async (operation, params = {}) => { const r = await cap(local, 'remote-files', { operation, ownerId, workspaceId, ...params }); if (!r.ok) throw Error(r.message); return r.result; };
try {
  await app.context().waitForEvent('page', { predicate: p => p.url().includes('/renderer/index.html'), timeout: 10000 }).catch(() => {});
  const control = await connectPapersControl(await readDescriptor(descriptor));
  if (!(await control.call('workspace.open', { windowId: 1, projectId })).ok) throw Error('As you Go did not open');
  control.close();
  for (let n = 0; n < 150 && !local; n++) { local = app.context().pages().find(p => p.url().includes('/public/workspace-') && !p.url().includes('papers-device')); if (!local) await new Promise(r => setTimeout(r, 100)); }
  const devices = local.getByRole('button', { name: 'Files on another device', exact: true });
  await devices.waitFor({ timeout: 20000 });

  await check('the device shares its As you Go', async () => {
    for (let i = 0; i < 30 && !ownerId; i++) {
      const status = await cap(local, 'remote-files', { operation: 'status' });
      ownerId = status.result?.devices?.find(d => d.name === deviceName)?.id ?? null;
      if (!ownerId) await new Promise(r => setTimeout(r, 1000));
    }
    if (!ownerId) throw Error(deviceName + ' never connected');
    const list = await remote('workspaces');
    workspaceId = list[0]?.id;
    if (!workspaceId) throw Error('no shared workspace');
    original = await remote('workspace-load');
    // Give one folder an icon stored as a file on the device (the file must exist in its public/icons).
    if (process.env.SEED_ICON && original.state.groups?.[0]) {
      const seeded = { ...original.state, groups: original.state.groups.map((g, i) => i === 0 ? { ...g, icon: './icons/' + process.env.SEED_ICON } : g) };
      const saved = await remote('workspace-save', { state: JSON.stringify(seeded), revision: original.revision });
      if (!saved.ok) throw Error('could not seed an icon: ' + JSON.stringify(saved));
      seededIcon = true;
    }
    return { workspaces: list.map(w => w.name), revision: original.revision.slice(0, 12), groups: original.state.groups?.length };
  });

  let page;
  await check('Devices -> device -> provider label opens its As you Go in a new tab', async () => {
    await devices.click();
    await local.locator('.navigator-breadcrumb-popup .workspace-navigator-row', { hasText: deviceName }).first().click();
    await local.waitForFunction(() => document.querySelectorAll('.workspace-navigator .machine-row').length > 0, null, { timeout: 30000 });
    const provider = local.locator('.workspace-navigator button', { hasText: deviceName }).first();
    await provider.click();
    for (let n = 0; n < 150 && !page; n++) { page = app.context().pages().find(p => p.url().includes('papers-device=' + ownerId)); if (!page) await new Promise(r => setTimeout(r, 100)); }
    if (!page) throw Error('no device tab opened');
    await page.waitForFunction(() => document.querySelectorAll('.workspace-navigator .workspace-navigator-row').length > 0, null, { timeout: 30000 });
    return { title: await page.title() };
  });
  await check('opening a device tab never changes its folders, items or window layouts, and an idle tab writes nothing', async () => {
    const revisions = new Set(); const before = await page.evaluate(() => (globalThis.__papersRemoteTrace || []).filter(t => t.operation === 'workspace-save').length);
    const saveCount = () => page.evaluate(() => (globalThis.__papersRemoteTrace || []).filter(t => t.operation === 'workspace-save').length);
    let settled = 0;
    for (let i = 0; i < 20; i++) { if (i === 5) settled = await saveCount(); revisions.add((await remote('workspace-load')).revision); await new Promise(r => setTimeout(r, 1000)); }
    const saves = await page.evaluate(() => (globalThis.__papersRemoteTrace || []).filter(t => t.operation === 'workspace-save').map(t => t.at.slice(17, 23) + (t.code ? ' ' + t.code : '')));
    const now = (await remote('workspace-load')).state;
    const diff = (a, b, at = '') => { if (JSON.stringify(a) === JSON.stringify(b)) return []; if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a)) return [at || '(root)']; return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], at + '.' + k)); };
    globalThis.openDiff = diff(original.state, now).slice(0, 20);
    const logDelta = JSON.stringify((now.windowLayoutMembershipLog || []).slice((original.state.windowLayoutMembershipLog || []).length)).slice(0, 600);
    const forbidden = globalThis.openDiff.filter(key => !(seededIcon && /^\.groups/.test(key)) && !/^\.view\.(surfaceLocations|preferences\.paneLayouts)\./.test(key) && !(key === '.windowLayoutMembershipLog' && logDelta === '[]'));
    const idleSaves = saves.length - settled;
    if (forbidden.length || idleSaves > 0) throw Error('changed ' + JSON.stringify(forbidden) + ' log+ ' + logDelta + ' idle saves ' + idleSaves + ' ' + `device revision changed ${revisions.size - 1} times in 20 s idle; this tab saved ${saves.length - before} times: ${JSON.stringify(saves.slice(-10))}`);
    return { savesAtOpen: saves.length, viewEntriesForThisTab: globalThis.openDiff.length };
  });
  const rootNames = () => page.evaluate(() => [...document.querySelectorAll('.workspace-navigator .workspace-navigator-row')].map(r => r.textContent.replace(/^>/, '').trim()).filter(Boolean));
  await check('it shows the device\'s own folders and items', async () => {
    const shown = await rootNames();
    const rootId = original.state.rootId ?? original.state.view?.rootId;
    const expected = (original.state.groups ?? []).filter(g => !g.bin && (g.parentId ?? g.parent ?? null) === (rootId ?? null)).map(g => g.name);
    const missing = expected.filter(name => !shown.some(s => s.startsWith(name)));
    if (!shown.length || (expected.length && missing.length === expected.length)) throw Error(`shown ${JSON.stringify(shown.slice(0, 8))}, device has ${JSON.stringify(expected.slice(0, 8))}`);
    const title = await page.title();
    if (!title.startsWith(deviceName + ' · ')) throw Error('tab title is ' + title);
    return { shown: shown.slice(0, 8), title };
  });
  const name = 'Made on SlopTop ' + Date.now();
  let afterEdit = null;
  await check('a folder created here is saved by the device', async () => {
    await page.waitForTimeout(Number(process.env.EDIT_DELAY_MS ?? 3000));
    const input = page.getByRole('textbox', { name: 'New folder name' });
    for (let attempt = 0; attempt < 5 && !(await input.isVisible().catch(() => false)); attempt++) {
      await page.locator('.workspace-navigator').getByRole('button', { name: 'New folder', exact: true }).click();
      await input.waitFor({ timeout: 3000 }).catch(() => {});
    }
    await input.fill(name); await page.keyboard.press('Enter');
    const pageErrors = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(m.text().slice(0, 300)); });
    await page.waitForTimeout(3000);
    const status = await page.evaluate(() => [...document.querySelectorAll('[role=status],.status,.workspace-status')].map(n => n.textContent.trim()).filter(Boolean).slice(0, 5));
    for (let i = 0; i < 40; i++) {
      afterEdit = await remote('workspace-load');
      if (afterEdit.state.groups?.some(g => g.name === name)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!afterEdit.state.groups?.some(g => g.name === name)) throw Error('the device never saved it; status ' + JSON.stringify(status) + ' errors ' + JSON.stringify(pageErrors) + ' trace ' + JSON.stringify(await page.evaluate(() => (globalThis.__papersRemoteTrace || []).filter(t => t.operation !== 'workspace-load').map(t => t.at.slice(17, 23) + ' ' + t.operation.slice(10) + ' ' + t.ok + ' ' + (t.code || '') + (t.error || '')).slice(-12))) + ' loads ' + await page.evaluate(() => (globalThis.__papersRemoteTrace || []).filter(t => t.operation === 'workspace-load').length));
    await page.waitForFunction(n => document.body.innerText.includes(n), name, { timeout: 10000 });
    return { revision: afterEdit.revision.slice(0, 12) };
  });
  await check('icons stored as files on the device show here and stay references there', async () => {
    const refs = JSON.stringify((await remote('workspace-load')).state).match(/\.\/icons\/[a-f0-9]{64}\.[a-z]{2,4}/g) ?? [];
    const images = await page.evaluate(() => [...document.querySelectorAll('.workspace-navigator img')].map(img => ({ src: img.getAttribute('src')?.slice(0, 20), ok: img.complete && img.naturalWidth > 0 })));
    const broken = images.filter(img => !img.ok);
    if (refs.length && (!images.some(img => img.src?.startsWith('data:image/')) || broken.length)) throw Error('icons ' + JSON.stringify(images.slice(0, 6)));
    const stored = JSON.stringify((await remote('workspace-load')).state);
    if (stored.includes('data:image/') && !JSON.stringify(original.state).includes('data:image/')) throw Error('inline icons leaked into the device document');
    return { iconRefs: refs.length, shown: images.length };
  });
  await check('a save built on an older revision is refused by the device', async () => {
    const stale = await remote('workspace-save', { state: JSON.stringify(original.state), revision: original.revision });
    if (stale.ok !== false || stale.code !== 'STALE_REVISION') throw Error('stale save answered ' + JSON.stringify(stale));
    const still = await remote('workspace-load');
    if (!still.state.groups?.some(g => g.name === name)) throw Error('the stale save overwrote the device');
    return { refused: stale.code };
  });
  await check('a change made on the device itself shows up here', async () => {
    const current = await remote('workspace-load');
    const renamed = name + ' (renamed there)';
    const next = { ...current.state, groups: current.state.groups.map(g => g.name === name ? { ...g, name: renamed } : g) };
    const saved = await remote('workspace-save', { state: JSON.stringify(next), revision: current.revision });
    if (!saved.ok) throw Error(JSON.stringify(saved));
    await page.waitForFunction(n => document.body.innerText.includes(n), renamed, { timeout: 15000 });
    return { appearedWithin: '15 s' };
  });
  await page?.screenshot({ path: path.join(root, 'remote-workspace.png') }).catch(() => {});
} finally {
  if (original && ownerId && workspaceId && local) {
    await check('restore the device\'s original document', async () => {
      const current = await remote('workspace-load');
      const restored = await remote('workspace-save', { state: JSON.stringify(original.state), revision: current.revision });
      if (!restored.ok) throw Error(JSON.stringify(restored));
      return { revision: restored.revision.slice(0, 12) };
    }).catch(() => {});
  }
  await app.close().catch(() => {});
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, evidence: root }, null, 1));
}
