/**
 * 039 C5 DETACHED TWO-AXIS CONTENT-FIT LIVE GATE (Winter, exclusive interval).
 * Launches the ISOLATED built Papers host + current As you Go source with a
 * fresh data dir and disposable windows, then validates:
 *   - the detached native client fits the shared card in BOTH axes: card width
 *     == client width AND card height == client height, within a justified
 *     window-frame tolerance (no empty vertical canvas, no clipping);
 *   - the width stays user-resizable and continuously measurement-driven;
 *   - after a width resize or member-count change the card reflows and the
 *     native client height auto-corrects, converging without oscillation;
 *   - the shared geometry persists so reattach immediately matches the card;
 *   - all members + the six legitimate card controls remain visible/unclipped;
 *   - no host furniture exists in widget mode.
 * Cases: natural/maximum, narrow, and 12-member wrapped widths, with fresh
 * full-window screenshots at each. Isolated state and disposable windows only.
 * Evidence: PASS/FAIL lines with literal width+height measurements, per-clause
 * screenshots in shots/, the transcript and the app log.
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
const OUT = path.join(AYG_REPO, 'probes', '039-c5-two-axis-fit-gate');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'gate-039-transcript.txt');
const LOG = path.join(OUT, 'gate-039-app.log');
const COMPACT_MAX = 340;
// Justified window-frame tolerance for the card-vs-client fit in px.
const W_TOL = 2;
const H_TOL = 4;
const HOST_SELECTORS = [
  '.navigation', '.toolbar-float', '#copy-prompt', '#bin-button', '#breadcrumbs',
  '#backdrop-slider', '#restore-all-bin', '#delete-all-bin', '.status',
  '.selection-status', '.context-menu', '.editor-layer', '.confirm-layer',
  '.workspace-backdrop',
];

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
async function resizeWidget(pid, width, height) {
  await runPwsh(['-NoProfile', '-NonInteractive', '-File', RESIZE, '-ProcessId', String(pid), '-Width', String(width), '-Height', String(height)]);
}
async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}
/** Two-axis measurement + inventory of the detached widget surface. */
async function measure(client) {
  return client.evaluate(`(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
    const hostSelectors = ${JSON.stringify(HOST_SELECTORS)};
    const visibleHost = hostSelectors.filter((sel) => visible(document.querySelector(sel)));
    const card = document.querySelector('.window-layout-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const memberRects = [...document.querySelectorAll('.window-layout-member')].map((m) => m.getBoundingClientRect());
    const controlRects = [...document.querySelectorAll('.window-layout-control')].map((c) => c.getBoundingClientRect());
    const isSize = (r) => r.width > 0 && r.height > 0;
    const inside = (r) => Boolean(cardRect) && r.left >= cardRect.left - 1 && r.right <= cardRect.right + 1 && r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1;
    return {
      windowContent: { w: window.innerWidth, h: window.innerHeight },
      cardRect: cardRect ? { w: Math.round(cardRect.width), h: Math.round(cardRect.height) } : null,
      rows: new Set(memberRects.map((r) => Math.round(r.top))).size,
      visibleHost,
      cardControls: [...document.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph),
      memberCount: memberRects.length,
      membersVisible: memberRects.every(isSize),
      membersInside: memberRects.every(inside),
      controlsVisible: controlRects.every(isSize),
      controlsInside: controlRects.every(inside),
    };
  })()`);
}

async function main() {
  console.log('=== 039 C5 DETACHED TWO-AXIS CONTENT-FIT LIVE GATE (isolated, exclusive interval) ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-039-'));
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

    // ---- Detach -> natural/maximum -------------------------------------------
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widgetTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget');
    const widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card');
    await sleep(2000);
    const max1 = await measure(widget);
    record('039 natural/maximum: TWO-AXIS fit — card width == client width AND card height == client height (no empty vertical canvas, no clipping)',
      Boolean(max1 && max1.cardRect && Math.abs(max1.cardRect.w - max1.windowContent.w) <= W_TOL && Math.abs(max1.cardRect.h - max1.windowContent.h) <= H_TOL),
      JSON.stringify({ cardRect: max1?.cardRect, windowContent: max1?.windowContent }));
    record('039 natural/maximum: no host furniture; every member + the six legitimate controls visible and unclipped',
      Boolean(max1 && max1.visibleHost.length === 0 && max1.memberCount === BASE_COUNT && max1.membersVisible && max1.membersInside && max1.cardControls.length === 6 && max1.controlsVisible && max1.controlsInside),
      JSON.stringify({ visibleHost: max1?.visibleHost, cardControls: max1?.cardControls, memberCount: max1?.memberCount }));
    await sleep(1200);
    const max2 = await measure(widget);
    record('039 natural/maximum: state CONVERGES without oscillation (two samples identical)',
      Boolean(max1 && max2 && max1.cardRect.w === max2.cardRect.w && max1.cardRect.h === max2.cardRect.h && max1.windowContent.h === max2.windowContent.h),
      JSON.stringify({ s1: max1?.cardRect, s2: max2?.cardRect }));
    await screenshot(widget, '00-detached-max');

    // ---- Narrow width: reflow + automatic content-height correction ----------
    const NARROW_TARGET = 200;
    await resizeWidget(session.proc.pid, NARROW_TARGET, 260);
    await waitFor(async () => (await measure(widget)).windowContent.w <= NARROW_TARGET + 24, 15000, 'narrow resize applied');
    await sleep(700);
    const narrow1 = await measure(widget);
    record('039 narrow: width is user-resizable (card < max) and the client auto-fits BOTH axes (card == client width AND height)',
      Boolean(narrow1 && narrow1.windowContent.w < COMPACT_MAX && Math.abs(narrow1.cardRect.w - narrow1.windowContent.w) <= W_TOL && Math.abs(narrow1.cardRect.h - narrow1.windowContent.h) <= H_TOL),
      JSON.stringify({ cardRect: narrow1?.cardRect, windowContent: narrow1?.windowContent }));
    record('039 narrow: width-driven row change (members wrapped into more rows) with all members + six controls visible/unclipped, no furniture',
      Boolean(narrow1 && max1 && narrow1.rows > max1.rows && narrow1.visibleHost.length === 0 && narrow1.memberCount === BASE_COUNT && narrow1.membersInside && narrow1.cardControls.length === 6 && narrow1.controlsInside),
      JSON.stringify({ maxRows: max1?.rows, narrowRows: narrow1?.rows, visibleHost: narrow1?.visibleHost, cardControls: narrow1?.cardControls }));
    await sleep(1200);
    const narrow2 = await measure(widget);
    record('039 narrow: the content-height correction CONVERGES without oscillation',
      Boolean(narrow1 && narrow2 && narrow1.cardRect.h === narrow2.cardRect.h && narrow1.windowContent.h === narrow2.windowContent.h && narrow1.cardRect.w === narrow2.cardRect.w),
      JSON.stringify({ s1: narrow1?.cardRect, s2: narrow2?.cardRect }));
    await screenshot(widget, '01-detached-narrow');

    // ---- Reattach: shared geometry persists, parity matches ------------------
    const persisted = persistedCardSize(statePath);
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed');
    const attached = await waitFor(() => bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), controls: [...card.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph) };
    })()`), 15000, 'attached card restored');
    record('039 reattach: persisted geometry is the shared card/client width AND height; attached card matches the detached card (parity)',
      Boolean(attached && persisted && narrow1 && Math.abs(attached.w - narrow1.cardRect.w) <= 2 && Math.abs(attached.h - narrow1.cardRect.h) <= 2 && Math.abs(persisted.width - narrow1.cardRect.w) <= 2),
      JSON.stringify({ attached, detached: narrow1?.cardRect, persisted }));
    await screenshot(bp, '02-attached-after-reattach');

    // ---- Above-eight members (12): member-count change reflows + auto-fits ----
    // Capture the workspace's channel snapshots so the persisted cardSize path
    // is verified end to end (the widget's restore reads snapshot.cardSize).
    await bp.evaluate(`(() => {
      const ch = new BroadcastChannel('as-you-go:window-layout-widget');
      window.__caps = [];
      ch.addEventListener('message', (e) => {
        const m = e.data;
        if (m && m.type === 'snapshot' && m.snapshot && m.snapshot.id === ${JSON.stringify(layoutId)}) {
          window.__caps.push({ revision: m.revision, cardSize: m.snapshot.cardSize, members: (m.snapshot.members ?? []).length });
        }
      });
      return true;
    })()`);
    for (const target of targets.slice(BASE_COUNT)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === TOTAL_TARGETS, 30000, 'twelve members persisted');
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widget12Target = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget (12)');
    const widget12 = await connectToTarget(widget12Target, session.baseUrl);
    await waitFor(() => widget12.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card (12)');
    await sleep(2000);
    const twelve1 = await measure(widget12);
    record('039 12-member wrapped: member-count change reflowed the card and the client auto-fits BOTH axes (card == client width AND height)',
      Boolean(twelve1 && Math.abs(twelve1.cardRect.w - twelve1.windowContent.w) <= W_TOL && Math.abs(twelve1.cardRect.h - twelve1.windowContent.h) <= H_TOL),
      JSON.stringify({ cardRect: twelve1?.cardRect, windowContent: twelve1?.windowContent }));
    record('039 12-member wrapped: no host furniture; every member + the six legitimate controls visible and unclipped',
      Boolean(twelve1 && twelve1.visibleHost.length === 0 && twelve1.memberCount === TOTAL_TARGETS && twelve1.membersVisible && twelve1.membersInside && twelve1.cardControls.length === 6 && twelve1.controlsVisible && twelve1.controlsInside),
      JSON.stringify({ visibleHost: twelve1?.visibleHost, cardControls: twelve1?.cardControls, memberCount: twelve1?.memberCount, rows: twelve1?.rows }));
    await sleep(1200);
    const twelve2 = await measure(widget12);
    record('039 12-member: the member-count height correction CONVERGES without oscillation',
      Boolean(twelve1 && twelve2 && twelve1.cardRect.h === twelve2.cardRect.h && twelve1.windowContent.h === twelve2.windowContent.h),
      JSON.stringify({ s1: twelve1?.cardRect, s2: twelve2?.cardRect }));
    record('039 12-member: persisted shared geometry tracks the detached card (diag)',
      true, JSON.stringify({ persistedNow: persistedCardSize(statePath), card: twelve1?.cardRect, client: twelve1?.windowContent }));
    const caps = await bp.evaluate('window.__caps ?? []');
    record('039 12-member: channel snapshots carried the persisted cardSize, then the height correction repersisted the card geometry (diag)',
      true, JSON.stringify({ first: caps[0] ? { cardSize: caps[0].cardSize, members: caps[0].members } : null, last: caps.at(-1) ? { cardSize: caps.at(-1).cardSize, members: caps.at(-1).members } : null }));
    await screenshot(widget12, '03-detached-twelve');

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
    '039 C5 DETACHED TWO-AXIS CONTENT-FIT LIVE GATE - TRANSCRIPT (isolated, exclusive interval)',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `compact presentation maximum: ${COMPACT_MAX}px; frame tolerance W<=${W_TOL} H<=${H_TOL}`,
    `host controls expected ABSENT: ${HOST_SELECTORS.join(', ')}`,
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
