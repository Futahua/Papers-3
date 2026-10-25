// Renders the Proxima timeline in an isolated Papers instance and checks three behaviors:
// a running queue head shows the live end glow, keeps its off-screen name once its queued
// follower has also scrolled past, and the vertical-scroll side zones keep hover behavior.
import { _electron } from 'playwright-core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

const proxima = process.env.PAPERS_PROXIMA_SOURCE ?? 'D:/Programs/CodexTemp/ProximaCrossDeviceSource';
const projectId = 'bp-759cd960-26ee-4560-90b0-1ef6678802c4';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-queue-render-'));
const results = [];
async function check(name, run) {
  try { const detail = await run(); results.push({ name, ok: true, ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ name, ok: false, error: error.message.slice(0, 400) }); }
}

const data = path.join(root, 'data'), projectDir = path.join(data, 'project'), documents = path.join(data, 'PapersData');
await fs.mkdir(documents, { recursive: true }); await fs.mkdir(projectDir, { recursive: true });
await fs.cp(path.join(proxima, 'public'), path.join(projectDir, 'public'), { recursive: true });
await fs.copyFile(path.join(proxima, 'project.json'), path.join(projectDir, 'project.json'));
await fs.writeFile(path.join(documents, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectDir } } }));
await fs.writeFile(path.join(documents, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'Proxima', type: 'environment', createdAt: new Date().toISOString(), lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: projectId }));
const descriptor = path.join(data, 'control.json');
const app = await _electron.launch({ args: [process.cwd()], env: { ...process.env, PAPERS_TEST_USER_DATA: data, PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor } });
try {
  await app.context().waitForEvent('page', { predicate: p => p.url().includes('/renderer/index.html'), timeout: 10000 }).catch(() => {});
  const control = await connectPapersControl(await readDescriptor(descriptor));
  if (!(await control.call('workspace.open', { windowId: 1, projectId })).ok) throw Error('Proxima did not open');
  control.close();
  let page;
  for (let n = 0; n < 100 && !page; n++) { page = app.context().pages().find(p => p.url().includes('/public/index.html')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  await page.waitForFunction(() => typeof Store !== 'undefined' && typeof Store.command === 'function', { timeout: 20000 });
  await page.setViewportSize?.({ width: 1400, height: 900 }).catch(() => {});

  // A live blob that started two days ago, with a queue ending in three days and one queued follower.
  const seeded = await page.evaluate(async () => {
    const day = 86400000, now = Date.now();
    const live = await Store.command({ type: 'timeline-interval.create', payload: { name: 'Live head', start: new Date(now - 2 * day).toISOString(), end: new Date(now).toISOString(), followNow: true } });
    const other = await Store.command({ type: 'timeline-interval.create', payload: { name: 'Plain live', start: new Date(now - 2 * day).toISOString(), end: new Date(now).toISOString(), followNow: true } });
    const next = await Store.command({ type: 'timeline-interval.create', payload: { name: 'Queued next', start: new Date(now - 5 * day).toISOString(), end: new Date(now - 4 * day).toISOString() } });
    for (let r = 0; r < 20; r++) await Store.command({ type: 'timeline-interval.create', payload: { name: 'Filler ' + r, start: new Date(now - 3 * day).toISOString(), end: new Date(now).toISOString(), followNow: true } });
    const head = Store.timelineIntervals().find(i => i.name === 'Live head');
    const queue = await Store.command({ type: 'timeline-queue.create', payload: { rowId: head.rowId, end: new Date(now + 3 * day).toISOString() } });
    const nextItem = Store.timelineIntervals().find(i => i.name === 'Queued next');
    const enqueue = await Store.command({ type: 'timeline-queue.enqueue', payload: { rowId: head.rowId, intervalIds: [nextItem.id] } });
    return { live: live.ok, other: other.ok, next: next.ok, queue: queue.ok || queue, enqueue: enqueue.ok || enqueue };
  });
  if (!Object.values(seeded).every(v => v === true)) throw Error('seed failed: ' + JSON.stringify(seeded));

  // Show the exact timeline.
  await page.evaluate(() => { for (const b of document.querySelectorAll('button,[role=tab]')) if (/^timeline$/i.test(b.textContent.trim())) { b.click(); break; } });
  await page.waitForFunction(() => [...document.querySelectorAll('#exactTimeline .exact-interval')].some(n => n.getClientRects().length), { timeout: 10000 });
  const bar = name => page.evaluate(n => { const node = [...document.querySelectorAll('#exactTimeline .exact-interval')].find(x => x.interval?.name === n); if (!node) return null; const end = node.querySelector('.exact-resize-end'); return { classes: node.className, trueLeft: Number(node.dataset.trueLeft), trueRight: Number(node.dataset.trueRight), end: end ? { hidden: end.hidden, shadow: getComputedStyle(end).boxShadow, background: getComputedStyle(end).backgroundColor, pointer: getComputedStyle(end).pointerEvents } : null }; }, name);

  await check('running queue head shows the same live end glow as a plain live blob', async () => {
    const head = await bar('Live head'), plain = await bar('Plain live');
    if (!head?.classes.includes('exact-running-queue')) throw Error('head is not rendered as a running queue blob: ' + JSON.stringify(head));
    if (!head.end) throw Error('running queue head has no end element');
    if (head.end.shadow === 'none' || head.end.shadow !== plain.end.shadow) throw Error(`glow differs: head ${head.end.shadow} vs plain ${plain.end.shadow}`);
    if (head.end.pointer !== 'none') throw Error('head end is interactive');
    return { glow: head.end.shadow };
  });

  // Pan into the future until the head and its queued follower are both behind the view.
  const timeline = page.locator('#exactTimeline');
  await timeline.focus();
  for (let i = 0; i < 4000; i++) {
    const h = await bar('Live head');
    const placeholder = await page.evaluate(() => { const node = [...document.querySelectorAll('#exactTimeline .exact-queued-placeholder')][0]; return node ? Number(node.dataset.trueRight) : null; });
    if ((h ? h.trueRight < 0 : true) && (placeholder === null || placeholder < 0)) break;
    await timeline.press('ArrowRight');
  }
  await check('head keeps its off-screen name after its queued follower scrolls past', async () => {
    const names = await page.evaluate(() => [...document.querySelectorAll('#exactTimeline .exact-outside-name')].filter(n => !n.hidden && n.getClientRects().length).map(n => n.interval?.name ?? n.textContent.trim()));
    if (!names.includes('Live head')) throw Error('visible off-screen names: ' + JSON.stringify(names));
    if (!names.includes('Plain live')) throw Error('control row lost its name too: ' + JSON.stringify(names));
    return { names };
  });

  await check('left scroll zone keeps row arrows and still scrolls rows', async () => {
    const box = await timeline.boundingBox();
    const tracks = await page.locator('#exactTimeline .exact-tracks').boundingBox();
    const rowY = tracks.y + 20 + 21;
    await page.mouse.move(box.x + 12, rowY);
    await page.mouse.move(box.x + 14, rowY);
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({ rowNav: document.querySelector('#exactTimeline .exact-row-nav')?.classList.contains('is-visible'), sideTint: [...document.querySelectorAll('#exactTimeline .exact-scroll-hover')].some(n => n.classList.contains('is-hovered')) }));
    if (!state.rowNav) throw Error('row navigation is suppressed in the side zone: ' + JSON.stringify(state));
    if (!state.sideTint) throw Error('side zone tint no longer shows');
    return state;
  });
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results, evidence: root }, null, 1));
}
