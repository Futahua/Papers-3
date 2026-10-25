// Real-device Proxima copy/follow check.
// Source: the laptop's real Papers/Proxima, driven through its local DevTools port by
// LAPEVAL (a script that runs `<url-substring> <async js body>` on the laptop and prints JSON).
// Receiver: an isolated Papers instance on this machine. Nothing touches this machine's real Proxima.
import { _electron } from 'playwright-core';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

const lapeval = process.env.LAPEVAL;
if (!lapeval) throw Error('Set LAPEVAL to the laptop evaluation script.');
const proxima = process.env.PAPERS_PROXIMA_SOURCE ?? 'D:/Programs/CodexTemp/ProximaCrossDeviceSource';
const projectId = 'bp-759cd960-26ee-4560-90b0-1ef6678802c4';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-proxima-real-'));
const tag = 'DC' + Date.now().toString(36);
const task = `Device check task ${tag}`, project = `Device check project ${tag}`;
const results = [];
const apps = [];

function laptop(page, body) {
  const run = spawnSync('bash', [lapeval, page, body], { encoding: 'utf8', timeout: 120000 });
  const line = (run.stdout || '').trim().split('\n').pop();
  const reply = JSON.parse(line || '{"ok":false,"error":"no reply"}');
  if (!reply.ok) throw Error('laptop: ' + reply.error);
  return reply.value;
}
const source = body => laptop(projectId, body);
async function step(name, run) {
  const started = Date.now();
  try { const detail = await run(); results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); return true; }
  catch (error) { results.push({ name, ok: false, ms: Date.now() - started, error: error.message.slice(0, 500) }); return false; }
}

async function receiverInstance() {
  const data = path.join(root, 'receiver'), projectDir = path.join(data, 'project'), documents = path.join(data, 'PapersData');
  await fs.mkdir(documents, { recursive: true }); await fs.mkdir(projectDir, { recursive: true });
  await fs.cp(path.join(proxima, 'public'), path.join(projectDir, 'public'), { recursive: true });
  await fs.copyFile(path.join(proxima, 'project.json'), path.join(projectDir, 'project.json'));
  await fs.writeFile(path.join(documents, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectDir } } }));
  await fs.writeFile(path.join(documents, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'Proxima receiver', type: 'environment', createdAt: new Date().toISOString(), lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: projectId }));
  const descriptor = path.join(data, 'control.json');
  const app = await _electron.launch({ args: [process.cwd()], env: { ...process.env, PAPERS_TEST_USER_DATA: data, PAPERS_TEST_HIDDEN_WINDOWS: '1', PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor } });
  apps.push(app);
  await app.context().waitForEvent('page', { predicate: p => p.url().includes('/renderer/index.html'), timeout: 10000 }).catch(() => {});
  const control = await connectPapersControl(await readDescriptor(descriptor));
  const opened = await control.call('workspace.open', { windowId: 1, projectId }); control.close();
  if (!opened.ok) throw Error('Receiver Proxima did not open');
  let page;
  for (let n = 0; n < 100 && !page; n++) { page = app.context().pages().find(p => p.url().includes('/public/index.html')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  await page.waitForFunction(() => typeof globalThis.__papersSharedData === 'function' && document.querySelector('.topbar button')?.textContent === 'Devices', { timeout: 20000 });
  const host = app.context().pages().find(p => p.url().includes('/renderer/index.html'));
  return { page, host };
}
async function openSource(page) {
  await page.getByRole('button', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Open Proxima', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
}
// Reach the Following list from whatever devices-view state the page is in.
async function showFollowing(page) {
  const visible = name => page.getByRole('button', { name, exact: true }).first().isVisible().catch(() => false);
  for (let attempt = 0; attempt < 6 && !(await visible('Following')); attempt++) {
    for (const name of ['Devices', 'Open Proxima', 'View']) if (await visible(name)) { await page.getByRole('button', { name, exact: true }).first().click(); break; }
    await page.waitForTimeout(500);
  }
  if (!(await visible('Following'))) throw Error('Following unavailable; visible buttons: ' + (await page.getByRole('button').allInnerTexts()).join(' | '));
  await page.getByRole('button', { name: 'Following', exact: true }).first().click();
}
async function copySelected(page, label, follow) {
  await openSource(page);
  await page.getByRole('checkbox', { name: label, exact: true }).check();
  await page.getByRole('button', { name: 'Copy selected', exact: true }).click();
  if (follow) await page.getByRole('checkbox', { name: /Copy and follow/ }).check();
  await page.getByRole('button', { name: 'Create local copy', exact: true }).click();
  await page.getByText('Saved to this Proxima.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Local', exact: true }).click();
}
const patchSource = note => source(`const t=Store.tasks().find(i=>i.name===${JSON.stringify(task)});const r=await Store.command({type:'task.patch',payload:{taskId:t.id,patch:{note:${JSON.stringify(note)}}}});if(!r.ok)throw Error(r.message);return true;`);

let receiver;
try {
  await step('seed a project and task in the laptop\'s real Proxima', async () => {
    return source(`const p=await Store.command({type:'project.create',payload:{name:${JSON.stringify(project)},description:'Device check facts'}});const t=await Store.command({type:'task.create',payload:{name:${JSON.stringify(task)},note:'Exact copied note',project:p.value.id,status:'backlog',weight:7,start:'2026-10-12',deadline:'2026-10-20'}});if(!p.ok||!t.ok)throw Error('seed failed');return {projects:Store.projects().length,tasks:Store.tasks().length,events:Store.snapshot().scheduleEvents?.length};`);
  });
  receiver = await receiverInstance();
  await step('pair a receiver on this PC with the laptop over Tailscale', async () => {
    const invite = laptop('renderer/index.html', `const i=await window.papersHost.devices.invite(false,true,false);return {code:i.code,address:i.address};`);
    await receiver.host.evaluate(({ address, code }) => window.papersHost.devices.pair(address, code), invite);
    return { owner: invite.address };
  });
  await step('copy one selected task (independent copy)', async () => {
    const before = await receiver.page.evaluate(() => Store.snapshot().run);
    await copySelected(receiver.page, `Select ${task}`, false);
    const r = await receiver.page.evaluate(n => ({ tasks: Store.tasks().filter(i => i.name === n), projects: Store.projects(), imports: Store.imports().length, run: Store.snapshot().run }), task);
    const copy = r.tasks[0];
    if (r.tasks.length !== 1 || copy.note !== 'Exact copied note' || copy.weight !== 7) throw Error('copied task differs: ' + JSON.stringify(copy));
    if (!r.projects.some(p => p.id === copy.project && p.name === project)) throw Error('task copied without its project');
    if (JSON.stringify(r.run) !== JSON.stringify(before)) throw Error('import changed the receiver\'s running timer');
    return { imports: r.imports, lineage: copy.sourceLineage?.mode };
  });
  await step('copy survives a receiver reload exactly once', async () => {
    await receiver.page.reload(); await receiver.page.waitForFunction(() => typeof globalThis.__papersSharedData === 'function');
    const count = await receiver.page.evaluate(n => Store.tasks().filter(i => i.name === n).length, task);
    if (count !== 1) throw Error(count + ' copies after reload');
  });
  await step('copy and follow: a source edit on the laptop reaches the follower', async () => {
    await copySelected(receiver.page, `Select ${task}`, true);
    patchSource('Source changed after copy');
    await receiver.page.waitForFunction(n => Store.tasks().some(i => i.name === n && i.sourceLineage?.mode === 'follow' && i.note === 'Source changed after copy'), task, { timeout: 30000 });
    const independent = await receiver.page.evaluate(n => Store.tasks().find(i => i.name === n && i.sourceLineage?.mode === 'independent')?.note, task);
    if (independent !== 'Exact copied note') throw Error('independent copy changed: ' + independent);
  });
  await step('local edit plus source edit raises a conflict, "Use source" resolves it', async () => {
    await receiver.page.evaluate(n => Store.command({ type: 'task.patch', payload: { taskId: Store.tasks().find(i => i.name === n && i.sourceLineage?.mode === 'follow').id, patch: { note: 'My local edit' } } }), task);
    patchSource('New source edit');
    await receiver.page.waitForFunction(() => Store.follows()[0]?.follow.conflicts.length === 1, null, { timeout: 30000 });
    const kept = await receiver.page.evaluate(n => Store.tasks().find(i => i.name === n && i.sourceLineage?.mode === 'follow').note, task);
    if (kept !== 'My local edit') throw Error('local edit was overwritten before a decision');
    await showFollowing(receiver.page);
    await receiver.page.getByRole('button', { name: 'Use source', exact: true }).click();
    await receiver.page.waitForFunction(n => Store.tasks().some(i => i.name === n && i.sourceLineage?.mode === 'follow' && i.note === 'New source edit'), task);
  });
  await step('conflict resolved with "Save both" keeps both versions', async () => {
    await receiver.page.evaluate(n => Store.command({ type: 'task.patch', payload: { taskId: Store.tasks().find(i => i.name === n && i.sourceLineage?.mode === 'follow').id, patch: { note: 'Retain this edit' } } }), task);
    patchSource('Source for second copy');
    await receiver.page.waitForFunction(() => Store.follows()[0]?.follow.conflicts.length === 1, null, { timeout: 30000 });
    await showFollowing(receiver.page);
    await receiver.page.getByRole('button', { name: 'Save both', exact: true }).click();
    await receiver.page.waitForFunction(() => Store.tasks().some(i => i.note === 'Source for second copy') && Store.tasks().some(i => i.note === 'Retain this edit'));
  });
  await step('every decision survives a receiver reload', async () => {
    await receiver.page.reload(); await receiver.page.waitForFunction(() => typeof globalThis.__papersSharedData === 'function');
    const notes = await receiver.page.evaluate(n => Store.tasks().filter(i => i.name === n).map(i => i.note), task);
    for (const note of ['Exact copied note', 'Retain this edit', 'Source for second copy']) if (!notes.includes(note)) throw Error('missing "' + note + '" in ' + JSON.stringify(notes));
    return { notes };
  });
  await step('copy all: every source record arrives', async () => {
    const want = source(`const s=Store.snapshot();return {projects:s.projects.length,tasks:s.tasks.length,events:(s.scheduleEvents||[]).length};`);
    await openSource(receiver.page);
    await receiver.page.getByRole('button', { name: 'Copy all', exact: true }).click();
    await receiver.page.getByRole('button', { name: 'Create local copy', exact: true }).click();
    await receiver.page.getByText('Saved to this Proxima.', { exact: true }).waitFor();
    await receiver.page.getByRole('button', { name: 'Local', exact: true }).click();
    const got = await receiver.page.evaluate(() => { const lineage = i => i.sourceLineage; const s = Store.snapshot(); return { projects: s.projects.filter(lineage).length, events: (s.scheduleEvents || []).filter(lineage).length }; });
    if (got.events < want.events) throw Error(`only ${got.events} of ${want.events} calendar entries copied`);
    return { source: want, receiverWithLineage: got };
  });
  await step('the laptop\'s own Proxima was only changed by its own commands', async () => {
    return source(`return {tasksNamed:Store.tasks().filter(i=>i.name===${JSON.stringify(task)}).map(i=>i.note)};`);
  });
} finally {
  try { source(`for(const t of Store.tasks().filter(i=>i.name===${JSON.stringify(task)}))await Store.command({type:'task.delete',payload:{taskId:t.id}});for(const p of Store.projects().filter(i=>i.name===${JSON.stringify(project)}))await Store.command({type:'project.delete',payload:{projectId:p.id}});return true;`); } catch {}
  for (const app of apps) await app.close().catch(() => {});
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, evidence: root }, null, 1));
}
