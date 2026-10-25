// Opens As you Go in an isolated Papers instance, enters a real paired device through the
// navigator's Devices button, and checks that its drives behave like local Opus folders:
// same rows, crumbs, icons, preview on click, and folder create/rename/delete on the device.
// Usage: node tools/probeRemoteDrives.mjs <device name> <fixture path on that device, e.g. C:\x\fixture>
import { _electron } from 'playwright-core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

const [deviceName, fixture] = process.argv.slice(2);
if (!deviceName || !fixture) throw Error('usage: probeRemoteDrives.mjs <device name> <fixture path>');
const ayg = process.env.PAPERS_AYG_SOURCE ?? 'D:/Programs/CodexTemp/AYGCrossDeviceSource';
const projectId = JSON.parse(await fs.readFile(path.join(ayg, 'project.json'), 'utf8')).backpackId;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-remote-drives-'));
const results = [];
async function check(name, run) {
  const started = Date.now();
  try { const detail = await run(); results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ name, ok: false, ms: Date.now() - started, error: String(error.message).slice(0, 500) }); }
}

const data = path.join(root, 'data'), projectDir = path.join(data, 'project'), documents = path.join(data, 'PapersData');
await fs.mkdir(documents, { recursive: true });
await fs.cp(ayg, projectDir, { recursive: true, filter: source => !/[\\/](\.git|node_modules)([\\/]|$)/.test(source) });
await fs.writeFile(path.join(documents, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectDir } } }));
await fs.writeFile(path.join(documents, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'As you Go', type: 'environment', createdAt: new Date().toISOString(), lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: projectId }));
const descriptor = path.join(data, 'control.json');
const app = await _electron.launch({ args: [process.cwd()], env: { ...process.env, PAPERS_TEST_USER_DATA: data, PAPERS_TEST_JOIN_NAME: 'Remote drives check', PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor } });
try {
  await app.context().waitForEvent('page', { predicate: p => p.url().includes('/renderer/index.html'), timeout: 10000 }).catch(() => {});
  const control = await connectPapersControl(await readDescriptor(descriptor));
  if (!(await control.call('workspace.open', { windowId: 1, projectId })).ok) throw Error('As you Go did not open');
  control.close();
  let page;
  for (let n = 0; n < 150 && !page; n++) { page = app.context().pages().find(p => p.url().includes('/public/workspace-')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  if (!page) throw Error('As you Go page not found');
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message).slice(0, 300)));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text().slice(0, 300)); });
  const devicesButton = page.getByRole('button', { name: 'Files on another device', exact: true });
  await devicesButton.waitFor({ timeout: 20000 });
  const navigator = page.locator('.workspace-navigator');
  const rowNames = () => navigator.locator('.machine-row').evaluateAll(rows => rows.map(r => r.textContent.trim()));
  const crumbs = () => navigator.locator('.navigator-location, [aria-label*="ocation"]').first().innerText().catch(() => '');
  const openRow = async name => {
    await navigator.locator('.machine-row', { hasText: name }).first().dblclick();
    await page.waitForFunction(n => [...document.querySelectorAll('.workspace-navigator .machine-row')].every(r => r.textContent.trim() !== n), name, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.workspace-navigator .machine-row').length > 0, null, { timeout: 30000 });
  };

  await check('Devices button lists the paired device (joins with no code)', async () => {
    for (let i = 0; i < 15; i++) {
      await devicesButton.click();
      await page.locator('.navigator-breadcrumb-popup .workspace-navigator-row').first().waitFor({ timeout: 5000 }).catch(() => {});
      const rows = await page.locator('.navigator-breadcrumb-popup .workspace-navigator-row').allInnerTexts().catch(() => []);
      if (rows.some(r => r.replace(/^>/, '').trim() === deviceName)) return { devices: rows.map(r => r.replace(/^>/, '').trim()) };
      await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    }
    const diag = await page.evaluate(async () => {
      const source = await fetch(new URL('./app/workspace-navigator.js', location.href)).then(r => r.text()).catch(e => 'fetch failed ' + e);
      const host = (await import('./app/host/host-bridge.js')).createHostBridge(window);
      const status = await host.fileCapability('remote-files', { operation: 'status' }).catch(e => ({ thrown: String(e) }));
      const buttons = [...document.querySelectorAll('button')].filter(b => b.title === 'Files on another device');
      buttons[0]?.click(); await new Promise(r => setTimeout(r, 300));
      const afterClick = { buttons: buttons.length, popupsAfter: document.querySelectorAll('.navigator-breadcrumb-popup').length, popupHtml: document.querySelector('.navigator-breadcrumb-popup')?.outerHTML.slice(0, 300) };
      return { afterClick, patched: source.includes('remoteDevices()'), popups: document.querySelectorAll('.navigator-breadcrumb-popup').length, status: JSON.stringify(status).slice(0, 400) };
    });
    throw Error(deviceName + ' never appeared ' + JSON.stringify(diag));
  });
  await check('picking it shows its drives in the same Opus view', async () => {
    await page.locator('.navigator-breadcrumb-popup .workspace-navigator-row', { hasText: deviceName }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.workspace-navigator .machine-row').length > 0, null, { timeout: 30000 });
    const names = await rowNames();
    if (!names.some(n => /^>?C:/.test(n))) throw Error('no C: drive row: ' + JSON.stringify(names));
    const provider = await navigator.evaluate(n => n.dataset.mode);
    return { drives: names, mode: provider, crumbs: await crumbs() };
  });
  const parts = fixture.replace(/\\+$/, '').split('\\');
  await check('navigate into the fixture folder by double-clicking folders', async () => {
    for (const part of parts) await openRow(part);
    const names = await rowNames();
    for (const expected of ['big.bin', 'note.txt']) if (!names.some(n => n.includes(expected))) throw Error('missing ' + expected + ' in ' + JSON.stringify(names));
    return { rows: names, crumbs: await crumbs() };
  });
  await check('remote rows get shell icons like local rows', async () => {
    await page.waitForTimeout(1500);
    const withArt = await navigator.locator('.machine-row img, .machine-row [style*="background-image"]').count();
    if (!withArt) throw Error('no row icons loaded');
    return { iconRows: withArt };
  });
  await check('clicking a text file previews its content', async () => {
    const remote = await page.evaluate(() => [...document.querySelectorAll('.workspace-navigator .machine-row')].find(r => r.textContent.includes('note.txt'))?.dataset.id);
    if (!remote?.startsWith('\\\\papers~')) throw Error('row path is not a remote path: ' + remote);
    await navigator.locator('.machine-row', { hasText: 'note.txt' }).first().click();
    const direct = await page.evaluate(async p => (await import("./app/host/host-bridge.js")).createHostBridge(window).fileCapability("preview", { path: p }), remote).catch(error => ({ error: error.message }));
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText);
    const expected = String(direct?.preview?.text ?? direct?.text ?? '').trim().slice(0, 40);
    if (!expected || !text.includes(expected)) throw Error('preview text not shown: ' + JSON.stringify(expected));
    if (text.includes('papers~')) throw Error('raw device id shown in the page');
    if (!text.includes('\\\\' + deviceName + '\\C:')) throw Error('device path label missing');
    return { path: remote, previewKind: direct?.preview?.kind ?? direct?.kind ?? null, shown: expected };
  });
  await check('create, rename and delete a folder on the device', async () => {
    const result = await page.evaluate(async folder => {
      const host = (await import("./app/host/host-bridge.js")).createHostBridge(window);
      const name = 'remote-ui-' + Date.now();
      const created = await host.fileCapability('create-folder', { path: folder, newName: name });
      const renamed = await host.fileCapability('rename', { path: folder + '\\' + name, newName: name + '-renamed' });
      const removed = await host.fileCapability('delete', { paths: [folder + '\\' + name + '-renamed'] });
      const listing = await host.fileCapability('list', { path: folder });
      return { created: created.ok || created.message, renamed: renamed.ok || renamed.message, removed: removed.ok || removed.message, leftover: listing.items?.some(i => i.name.startsWith(name)) };
    }, await page.evaluate(() => [...document.querySelectorAll('.workspace-navigator .machine-row')].find(r => r.textContent.includes('note.txt'))?.dataset.id.replace(/\\[^\\]+$/, '')));
    if (result.skipped) throw Error(result.skipped);
    if (result.created !== true || result.renamed !== true || result.removed !== true || result.leftover) throw Error(JSON.stringify(result));
    return result;
  });
  await page.screenshot({ path: path.join(root, 'remote-drives.png') });
  const fixtureRemote = await page.evaluate(() => [...document.querySelectorAll('.workspace-navigator .machine-row')].find(r => r.textContent.includes('note.txt'))?.dataset.id.replace(/\\[^\\]+$/, ''));
  const cap = (operation, params) => page.evaluate(async ([o, p]) => (await import('./app/host/host-bridge.js')).createHostBridge(window).fileCapability(o, p), [operation, params]);
  const ownerId = fixtureRemote?.slice(9, 45);
  const local = path.join(root, 'local'); await fs.mkdir(path.join(local, 'folder'), { recursive: true });
  await fs.writeFile(path.join(local, 'sent.txt'), 'sent from this PC ' + Date.now());
  await fs.writeFile(path.join(local, 'folder', 'a.txt'), 'a'); await fs.writeFile(path.join(local, 'folder', 'b.bin'), Buffer.alloc(300000, 7));
  const created = [];
  await check('copy a file and a folder from this PC onto the device (a drag between devices copies)', async () => {
    const result = await cap('move', { paths: [path.join(local, 'sent.txt'), path.join(local, 'folder')], destination: fixtureRemote });
    if (!result.ok || result.operation !== 'copy') throw Error(JSON.stringify(result));
    created.push(...result.paths);
    const listing = await cap('list', { path: result.paths[1] });
    const names = listing.items.map(i => i.name).sort();
    if (names.join() !== 'a.txt,b.bin') throw Error('folder copy has ' + names);
    if (!(await fs.stat(path.join(local, 'sent.txt')).catch(() => null))) throw Error('the local source was moved instead of copied');
    return { created: result.paths.map(p => p.slice(46)) };
  });
  await check('copy them back from the device to this PC, byte for byte', async () => {
    const back = path.join(local, 'back'); await fs.mkdir(back);
    const result = await cap('copy', { paths: created, destination: back });
    if (!result.ok) throw Error(JSON.stringify(result));
    const same = async (a, b) => Buffer.compare(await fs.readFile(a), await fs.readFile(b)) === 0;
    if (!(await same(path.join(local, 'sent.txt'), path.join(back, path.basename(result.paths[0]))))) throw Error('file differs');
    if (!(await same(path.join(local, 'folder', 'b.bin'), path.join(result.paths[1], 'b.bin')))) throw Error('folder file differs');
    return { back: result.paths.map(p => path.relative(local, p)) };
  });
  await check('a second copy takes a free name instead of overwriting', async () => {
    const result = await cap('copy', { paths: [path.join(local, 'sent.txt')], destination: fixtureRemote });
    if (!result.ok || !/sent \(\d+\)\.txt$/.test(result.paths[0])) throw Error(JSON.stringify(result));
    created.push(result.paths[0]);
    return { name: result.paths[0].split('\\').pop() };
  });
  await check('device settings gear shows each device inbox', async () => {
    await devicesButton.click();
    await page.getByRole('button', { name: 'Device settings', exact: true }).click();
    const input = page.getByRole('textbox', { name: deviceName + ' inbox folder' });
    await page.waitForFunction(() => [...document.querySelectorAll('.navigator-device-inbox input')].some(i => i.value), null, { timeout: 20000 });
    const value = await input.inputValue();
    await page.screenshot({ path: path.join(root, 'device-settings.png') });
    await page.keyboard.press('Escape');
    if (!/Papers Inbox$/.test(value)) throw Error('default inbox is ' + value);
    return { defaultInbox: value };
  });
  await check('choose an inbox, send files to it, then restore the default', async () => {
    const chosen = fixtureRemote.replace(/^\\\\papers~[^\\]+\\/, '') + '\\inbox-check';
    const set = await cap('remote-files', { operation: 'inbox-set', ownerId, path: chosen });
    if (!set.ok || !set.result.chosen) throw Error(JSON.stringify(set));
    const sent = await cap('remote-files', { operation: 'send-to-inbox', ownerId, paths: [path.join(local, 'sent.txt')] });
    if (!sent.ok || !sent.result[0].includes('\\inbox-check\\sent')) throw Error(JSON.stringify(sent));
    const reset = await cap('remote-files', { operation: 'inbox-set', ownerId, path: null });
    if (!reset.ok || reset.result.chosen) throw Error(JSON.stringify(reset));
    created.push(fixtureRemote + '\\inbox-check');
    return { chosen, landed: sent.result[0].split('\\').slice(-2).join('\\') };
  });
  await check('search inside the device runs on the device', async () => {
    const result = await cap('search', { query: 'resume.bin', limit: 50, path: fixtureRemote.split('\\').slice(0, 3).join('\\') });
    if (!result.ok) throw Error(JSON.stringify(result).slice(0, 300));
    const hit = result.results.find(r => r.path === fixtureRemote + '\\resume.bin');
    if (!hit) throw Error('fixture not found among ' + result.results.length + ' results: ' + JSON.stringify(result.results.slice(0, 3).map(r => r.path)));
    return { results: result.results.length, size: hit.size };
  });
  await check('clean up everything this check created on the device', async () => {
    const result = await cap('delete', { paths: created });
    if (!result.ok) throw Error(JSON.stringify(result));
    const left = (await cap('list', { path: fixtureRemote })).items.map(i => i.name).sort();
    if (left.join() !== 'big.bin,note.txt,resume.bin') throw Error('left behind: ' + left);
    return { left };
  });
  globalThis.pageErrorsOut = pageErrors.slice(0, 20);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify({ pageErrors: globalThis.pageErrorsOut, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, evidence: root }, null, 1));
}
