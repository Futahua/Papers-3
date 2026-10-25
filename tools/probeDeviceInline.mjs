// Device switching stays in the same tab: Devices -> device -> provider label turns this As you Go tab
// into that device's As you Go (no new Papers tab), and Devices -> This device turns it back. Read-only.
// Usage: node tools/probeDeviceInline.mjs <device name>
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

  const pagesBefore = app.context().pages().length;
  await check('Devices -> device -> provider label switches this tab to the device\'s As you Go', async () => {
    const status = await cap(local, 'remote-files', { operation: 'status' });
    ownerId = status.result?.devices?.find(d => d.name === deviceName)?.id;
    if (!ownerId) throw Error(deviceName + ' is not connected');
    await devices.click();
    await local.locator('.navigator-breadcrumb-popup .workspace-navigator-row', { hasText: deviceName }).first().click();
    await local.waitForFunction(() => document.querySelectorAll('.workspace-navigator .machine-row').length > 0, null, { timeout: 30000 });
    await local.locator('.workspace-navigator button', { hasText: deviceName }).first().click();
    await local.waitForURL(url => url.toString().includes('papers-device=' + ownerId), { timeout: 15000 });
    await local.waitForFunction(() => document.querySelectorAll('.workspace-navigator .workspace-navigator-row').length > 0, null, { timeout: 30000 });
    const pagesAfter = app.context().pages().length;
    if (pagesAfter !== pagesBefore) throw Error(`pages ${pagesBefore} -> ${pagesAfter}: a new tab opened`);
    const label = await local.locator('.workspace-navigator button', { hasText: deviceName }).first().textContent();
    return { title: await local.title(), providerLabel: label, rows: await local.locator('.workspace-navigator .workspace-navigator-row').count() };
  });
  await check('Devices -> This device turns the tab back into this computer\'s As you Go', async () => {
    await local.getByRole('button', { name: 'Files on another device', exact: true }).click();
    await local.locator('.navigator-breadcrumb-popup .navigator-this-device').click();
    await local.waitForURL(url => !url.toString().includes('papers-device='), { timeout: 15000 });
    await local.waitForFunction(() => document.querySelectorAll('.workspace-navigator .workspace-navigator-row').length > 0, null, { timeout: 30000 });
    if (app.context().pages().length !== pagesBefore) throw Error('page count changed');
    return { title: await local.title() };
  });
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, evidence: root }, null, 1));
}
