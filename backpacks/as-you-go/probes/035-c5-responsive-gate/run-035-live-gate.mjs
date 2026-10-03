/**
 * 035 C5 RESPONSIVE SHARED GEOMETRY LIVE GATE (Winter, exclusive interval).
 * Launches the ISOLATED built Papers host + current As you Go source with a
 * fresh data dir and disposable windows, then validates every 035 clause
 * against the ACTUAL reachable attached and detached cards:
 *   - the detached widget is USER-resizable and the shared card fills its
 *     window content width, members/controls wrapping continuously with it;
 *   - narrower widths create more balanced rows (row count responds to width);
 *   - while the widget is detached the attached card is a GREYED DISABLED
 *     placeholder whose ONLY live control is the lock (reattach);
 *   - the widget's window size persists to the shared card geometry and, on
 *     reattach, the attached card follows it immediately;
 *   - the next detach reuses the persisted geometry (one shared value).
 * Isolated state and disposable windows only. Evidence: PASS/FAIL lines,
 * per-clause screenshots in shots/, the transcript and the app log.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { connectToTarget, freePort, launchPapers, sleep, closeApp } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const DISPOSABLE = path.join(LPP, 'disposable-window.ps1');
const RESIZE = path.join(LPP, 'resize-widget.ps1');
const OUT = path.join(AYG_REPO, 'probes', '035-c5-responsive-gate');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'gate-035-transcript.txt');
const LOG = path.join(OUT, 'gate-035-app.log');

const steps = [];
let failures = 0;
function record(name, ok, detail = '') {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
}
async function waitFor(probe, timeoutMs, label, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (${String(lastError).slice(0, 300)})` : ''}`);
}
function runPwsh(args) {
  const argv = typeof args === 'string' ? ['-NoProfile', '-NonInteractive', '-Command', args] : args;
  return new Promise((resolve, reject) => {
    const result = spawn(PW, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    result.stdout.on('data', (c) => out.push(String(c)));
    result.stderr.on('data', (c) => out.push(String(c)));
    const timer = setTimeout(() => { result.kill(); reject(new Error('pwsh timeout')); }, 120000);
    result.on('error', reject);
    result.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`pwsh ${code}: ${out.join('').trim().slice(0, 400)}`));
      else resolve(out.join('').trim());
    });
  });
}
async function ctl(args) { return JSON.parse(await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, ...args])); }
async function creatorPapersPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='Papers.exe'" | Select-Object ProcessId | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId).sort();
}
async function allProcesses() {
  const raw = await runPwsh('Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine | ConvertTo-Json -Compress');
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]);
}
async function descendantPids(rootPid, procs) {
  const children = new Map();
  for (const p of procs) {
    const parent = Number(p.ParentProcessId);
    if (!Number.isFinite(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), Number(p.ProcessId)]);
  }
  const owned = new Set([Number(rootPid)]);
  const queue = [Number(rootPid)];
  while (queue.length) {
    const pid = queue.shift();
    for (const child of children.get(pid) ?? []) {
      if (!owned.has(child)) { owned.add(child); queue.push(child); }
    }
  }
  return owned;
}
async function waitForTarget(baseUrl, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${baseUrl}/json/list`)).json();
      const match = (Array.isArray(list) ? list : []).find(predicate);
      if (match) return match;
    } catch { /* retry */ }
    await sleep(400);
  }
  throw new Error(`timeout waiting for target: ${label}`);
}
function waitForMarker(markerPath) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const timer = setInterval(() => {
      if (!fs.existsSync(markerPath)) {
        if (Date.now() > deadline) { clearInterval(timer); reject(new Error('marker timeout')); }
        return;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        if (parsed && parsed.pid && parsed.title) {
          clearInterval(timer);
          resolve(parsed);
          return;
        }
      } catch { /* partial */ }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error('marker timeout')); }
    }, 250);
  });
}
function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
function memberCount(statePath) {
  return readState(statePath)?.windowLayouts?.[0]?.arrangement?.members?.length ?? 0;
}
function persistedCardSize(statePath) {
  const size = readState(statePath)?.windowLayouts?.[0]?.cardSize;
  return size && typeof size.width === 'number' ? { width: Math.round(size.width), height: Math.round(size.height) } : null;
}
async function screenshot(client, name) {
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
  } catch { /* best-effort */ }
}
/** Resize the NATIVE widget BrowserWindow (the smallest visible window of the
 * isolated Papers main process) via Win32 SetWindowPos. The page's resize
 * listener then reports the new size to the workspace. */
async function resizeWidget(pid, width, height) {
  await runPwsh(['-NoProfile', '-NonInteractive', '-File', RESIZE, '-ProcessId', String(pid), '-Width', String(width), '-Height', String(height)]);
}
async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}
/** Measure the widget's shared card + window content + member row count. */
async function measureWidget(client) {
  return client.evaluate(`(() => {
    const card = document.querySelector('.window-layout-card');
    if (!card) return null;
    const strip = card.querySelector('[data-wl-members]');
    const controls = card.querySelector('.window-layout-controls');
    const rect = card.getBoundingClientRect();
    const memberRects = [...(strip?.querySelectorAll('.window-layout-member') ?? [])].map((m) => m.getBoundingClientRect());
    const rows = new Set(memberRects.map((r) => Math.round(r.top))).size;
    const fullyInside = memberRects.every((r) => r.left >= rect.left - 1 && r.right <= rect.right + 1 && r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1);
    return {
      windowContent: { w: window.innerWidth, h: window.innerHeight },
      docClientW: document.documentElement.clientWidth,
      bodyW: document.body ? document.body.getBoundingClientRect().width : null,
      explorerW: document.querySelector('.explorer') ? document.querySelector('.explorer').getBoundingClientRect().width : null,
      gridW: document.getElementById('icon-grid') ? document.getElementById('icon-grid').getBoundingClientRect().width : null,
      gridPad: document.getElementById('icon-grid') ? getComputedStyle(document.getElementById('icon-grid')).padding : null,
      cardRect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      rows,
      count: memberRects.length,
      fullyInside,
      controlCount: controls ? controls.querySelectorAll('.window-layout-control').length : 0,
      scrollW: card.scrollWidth,
      scrollH: card.scrollHeight,
    };
  })()`);
}

async function main() {
  console.log('=== 035 C5 RESPONSIVE SHARED GEOMETRY LIVE GATE (isolated, exclusive interval) ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-035-'));
  const projectCopy = path.join(dataDir, 'ayg-project-copy');
  const statePath = path.join(projectCopy, 'state.json');
  let creatorBefore = [];
  let session = null;
  const targetProcs = [];
  const targets = [];
  let layoutId = null;
  try {
    creatorBefore = await creatorPapersPids();
    record('creator installed Papers enumerated before (observed only)', true, JSON.stringify(creatorBefore));
    fs.cpSync(AYG_REPO, projectCopy, {
      recursive: true,
      filter: (s) => !s.includes(`${path.sep}.git`) && !s.includes('probes') && !s.endsWith(`${path.sep}state.json`),
    });
    const papersData = path.join(dataDir, 'PapersData');
    fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
    fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
    fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

    const positions = [[120, 140], [820, 140], [120, 620], [820, 620], [120, 1000], [820, 1000], [120, 1380], [820, 1380], [120, 1760], [820, 1760], [120, 2140], [820, 2140]];
    const TOTAL_TARGETS = 12;
    const BASE_COUNT = 6;
    for (let index = 0; index < TOTAL_TARGETS; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('twelve disposable target windows launched', targets.length === TOTAL_TARGETS, targets.map((t) => t.title).join(' '));

    const port = await freePort();
    session = await launchPapers(dataDir, port, LOG);
    const procs0 = await allProcesses();
    const owned0 = await descendantPids(session.proc.pid, procs0);
    record('isolated root PID captured with exact descendant set', owned0.size > 0, `root=${session.proc.pid}`);

    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    const alreadyOpen = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 8000, 'frame').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((i) => i.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'frame');
    const bp = await connectToTarget(projectTarget, session.baseUrl);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace');

    async function createLayout() {
      await bp.evaluate(`(() => { const v = document.querySelector('#icon-grid [data-blank-parent]'); v.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 })); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10000, 'menu');
      await bp.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30000, 'shell');
      return bp.evaluate(`[...document.querySelectorAll('.window-layout-shell')].pop().querySelector('[data-wl-layout]').dataset.wlLayout`);
    }
    async function pickFromList(id, title) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await bp.evaluate(`document.querySelector('[data-wl-list="${id}"]').click()`);
        const found = await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 25000, `row ${title}`).catch(() => false);
        if (found) {
          await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
          await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 20000, `member ${title}`);
          return;
        }
        await bp.evaluate(`(() => { const close = document.querySelector('[data-wl-picker-close]'); if (close) close.click(); return true; })()`).catch(() => undefined);
        await sleep(300);
      }
      throw new Error(`could not pick ${title} after retries`);
    }

    layoutId = await createLayout();
    for (const target of targets.slice(0, BASE_COUNT)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === BASE_COUNT, 30000, 'six members persisted');
    record('layout with six list-picked members seeded', memberCount(statePath) === BASE_COUNT, layoutId);

    // ---- Detach (first open: content-fit, no persisted geometry yet) --------
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widgetTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget');
    const widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card');
    await sleep(2000);
    const first = await measureWidget(widget);
    record('035 first detach content-fits: card fills the window content width (no empty surround)',
      Boolean(first && first.cardRect && first.windowContent && Math.abs(first.cardRect.w - first.windowContent.w) <= 2),
      JSON.stringify(first));

    // ---- Placeholder while detached ------------------------------------------
    const placeholder = await bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      const members = [...(card?.querySelectorAll('[data-wl-member]') ?? [])];
      const controls = [...(card?.querySelectorAll('.window-layout-control') ?? [])];
      return {
        isPlaceholder: card ? card.classList.contains('window-layout-card--placeholder') : false,
        dataPlaceholder: card ? card.getAttribute('data-wl-placeholder') : null,
        membersDisabled: members.length > 0 && members.every((m) => m.disabled),
        controls,
        hasDetach: controls.some((c) => c.dataset.wlGlyph === 'detach'),
        hasReattach: controls.some((c) => c.dataset.wlGlyph === 'reattach'),
        controlCount: controls.length,
      };
    })()`);
    record('035 attached card is a greyed placeholder while its widget is open: only the reattach lock, members disabled',
      Boolean(placeholder && placeholder.isPlaceholder && placeholder.dataPlaceholder === 'true'
        && placeholder.membersDisabled && placeholder.controlCount === 1 && placeholder.hasReattach && !placeholder.hasDetach),
      JSON.stringify(placeholder));
    await screenshot(bp, '00-attached-placeholder');

    // Clicking a placeholder member must not mutate the layout (it is disabled).
    const membersBefore = memberCount(statePath);
    await bp.evaluate(`(() => { const m = document.querySelector('[data-wl-card="${layoutId}"] [data-wl-member]'); if (m) m.click(); return true; })()`).catch(() => undefined);
    await sleep(400);
    record('035 the placeholder member is inert: a click performs no state change',
      memberCount(statePath) === membersBefore,
      `before=${membersBefore} after=${memberCount(statePath)}`);

    // ---- User-resizable host: narrow then wider, reflow follows width --------
    const NARROW_W = 200;
    const NARROW_H = 260;
    await resizeWidget(session.proc.pid, NARROW_W, NARROW_H);
    await waitFor(async () => (await measureWidget(widget)).windowContent.w <= NARROW_W + 24, 15000, 'narrow resize applied');
    await sleep(700);
    const narrow = await measureWidget(widget);
    const sizeAtNarrow = persistedCardSize(statePath);
    record('035 the detached window is USER-resizable: the native window content width follows the resize (frameless chrome excluded)',
      Boolean(narrow && narrow.windowContent && Math.abs(narrow.windowContent.w - NARROW_W) <= 24),
      JSON.stringify(narrow?.windowContent));
    record('035 the card FILLS the resized host width (card width == window content width)',
      Boolean(narrow && Math.abs(narrow.cardRect.w - narrow.windowContent.w) <= 2),
      JSON.stringify({ cardRect: narrow?.cardRect, windowContent: narrow?.windowContent }));
    record('035 narrow width reflows members into MORE rows (wrap responds continuously)',
      Boolean(narrow && first && narrow.rows > first.rows),
      JSON.stringify({ firstRows: first?.rows, narrowRows: narrow?.rows }));
    record('035 every member stays fully inside the card at the narrow width (no clip/overflow, safe padding)',
      Boolean(narrow && narrow.count === BASE_COUNT && narrow.fullyInside),
      JSON.stringify(narrow));
    record('035 the resized geometry persists to the shared card geometry',
      Boolean(sizeAtNarrow && Math.abs(sizeAtNarrow.width - narrow.windowContent.w) <= 2),
      JSON.stringify({ persisted: sizeAtNarrow, measured: narrow?.windowContent }));
    await screenshot(widget, '01-detached-narrow');

    const WIDE_W = 520;
    await resizeWidget(session.proc.pid, WIDE_W, 220);
    await waitFor(async () => (await measureWidget(widget)).windowContent.w >= WIDE_W - 24, 15000, 'wide resize applied');
    await sleep(700);
    const wide = await measureWidget(widget);
    record('035 wider width reflows members into FEWER rows (continuous, no breakpoints)',
      Boolean(wide && narrow && wide.rows < narrow.rows),
      JSON.stringify({ narrowRows: narrow?.rows, wideRows: wide?.rows }));
    record('035 the wider card still shows every member fully inside, even gaps (no unbounded strip)',
      Boolean(wide && wide.count === BASE_COUNT && wide.fullyInside),
      JSON.stringify(wide));
    await screenshot(widget, '02-detached-wide');

    // ---- Reattach: the attached card follows the latest widget size ----------
    const sizeBeforeReattach = persistedCardSize(statePath);
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed');
    const reattached = await waitFor(() => bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      const controls = [...card.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph);
      return { w: Math.round(rect.width), isPlaceholder: card.classList.contains('window-layout-card--placeholder'), controls };
    })()`), 15000, 'attached card restored');
    record('035 reattach restores the live attached card (no placeholder) with the detach lock',
      Boolean(reattached && !reattached.isPlaceholder && reattached.controls?.includes('detach')),
      JSON.stringify(reattached));
    record('035 the attached card follows the widget latest width immediately (attached w == persisted w)',
      Boolean(reattached && sizeBeforeReattach && Math.abs(reattached.w - sizeBeforeReattach.width) <= 4),
      JSON.stringify({ attached: reattached?.w, persisted: sizeBeforeReattach }));
    await screenshot(bp, '03-attached-after-reattach');

    // ---- Next detach reuses the persisted geometry (one shared value) --------
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widget2Target = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 're-detached widget');
    const widget2 = await connectToTarget(widget2Target, session.baseUrl);
    await waitFor(() => widget2.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card (2)');
    await sleep(2000);
    const reopened = await measureWidget(widget2);
    record('035 the next detach reuses the persisted shared geometry (window reopens at the saved size)',
      Boolean(reopened && sizeBeforeReattach && Math.abs(reopened.windowContent.w - sizeBeforeReattach.width) <= 8),
      JSON.stringify({ persisted: sizeBeforeReattach, reopened: reopened?.windowContent }));
    await screenshot(widget2, '04-redetached-at-persisted');

    // ---- 12 members: responsive reflow at narrow + wide ----------------------
    await widget2.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed (2)');
    for (const target of targets.slice(BASE_COUNT)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === TOTAL_TARGETS, 30000, 'twelve members persisted');
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widget12Target = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget (12)');
    const widget12 = await connectToTarget(widget12Target, session.baseUrl);
    await waitFor(() => widget12.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card (12)');
    await sleep(2000);
    const opened12 = await measureWidget(widget12);
    record('035 12-member card opens content-fitted with every member visible',
      Boolean(opened12 && opened12.count === TOTAL_TARGETS && opened12.fullyInside),
      JSON.stringify(opened12));
    await resizeWidget(session.proc.pid, NARROW_W, 420);
    await waitFor(async () => (await measureWidget(widget12)).windowContent.w <= NARROW_W + 24, 15000, 'narrow resize (12)');
    await sleep(700);
    const narrow12 = await measureWidget(widget12);
    record('035 at 12 members a narrow width still wraps into MORE rows with every member fully inside',
      Boolean(narrow12 && opened12 && narrow12.count === TOTAL_TARGETS && narrow12.fullyInside && narrow12.rows > opened12.rows),
      JSON.stringify({ opened12Rows: opened12?.rows, narrow12Rows: narrow12?.rows, narrow12 }));
    await screenshot(widget12, '05-detached-twelve-narrow');
    await resizeWidget(session.proc.pid, WIDE_W, 240);
    await waitFor(async () => (await measureWidget(widget12)).windowContent.w >= WIDE_W - 24, 15000, 'wide resize (12)');
    await sleep(700);
    const wide12 = await measureWidget(widget12);
    record('035 at 12 members a wider width shows FEWER rows (continuous reflow, no hardcoded columns)',
      Boolean(wide12 && narrow12 && wide12.rows < narrow12.rows && wide12.fullyInside),
      JSON.stringify({ narrowRows: narrow12?.rows, wideRows: wide12?.rows }));
    await screenshot(widget12, '06-detached-twelve-wide');

    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2500);
    for (const target of targets) await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
    for (const proc of targetProcs) if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
    await sleep(2000);
    const creatorAfter = await creatorPapersPids();
    record('creator installed Papers untouched after run', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
  } catch (error) {
    record('gate step', false, String(error).slice(0, 500));
  } finally {
    try {
      if (session) { await closeApp(session.proc, session.baseUrl).catch(() => undefined); session = null; }
      for (const target of targets) await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
      for (const proc of targetProcs) if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
      await sleep(1500);
    } catch { /* best-effort */ }
  }
  const passed = steps.length - failures;
  const transcript = [
    '035 C5 RESPONSIVE SHARED GEOMETRY LIVE GATE - TRANSCRIPT (isolated, exclusive interval)',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `creator Papers pids before: ${JSON.stringify(creatorBefore)}`,
    '',
    ...steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} - ${s.name}${s.detail ? ` :: ${s.detail}` : ''}`),
    '',
    `FINAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed.`,
  ].join('\r\n');
  fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
  fs.writeFileSync(TRANSCRIPT, `${transcript}\r\n`);
  console.log(`\n=== SUMMARY: ${passed}/${steps.length} passed, ${failures} failed ===`);
  if (failures > 0) process.exitCode = 1;
}

const isDirectEntry = typeof process !== 'undefined'
  && process.argv?.[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) {
  main();
}
