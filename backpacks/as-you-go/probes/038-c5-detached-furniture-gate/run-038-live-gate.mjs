/**
 * 038 C5 DETACHED HOST FURNITURE REMOVAL + FOCUSED PARITY LIVE GATE (Winter,
 * exclusive interval). Launches the ISOLATED built Papers host + current As you
 * Go source with a fresh data dir and disposable windows, then validates:
 *   - the detached window contains ONLY the shared card and its legitimate card
 *     controls: every workspace host control (navigation/toolbar copy+Bin,
 *     status, selection footer, context menu, editors, confirm dialogs, backdrop
 *     panel) is ABSENT (not rendered) in widget mode;
 *   - the shared card touches the client width with zero surrounding canvas;
 *   - every member and legitimate card control is visible and unclipped;
 *   - attached/reattached card parity persists;
 *   - fresh detached screenshots at narrow, natural/maximum, and 12-member
 *     wrapped widths.
 * Isolated state and disposable windows only. Evidence: PASS/FAIL lines,
 * DOM/control inventories, per-clause screenshots in shots/, transcript + log.
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
const OUT = path.join(AYG_REPO, 'probes', '038-c5-detached-furniture-gate');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'gate-038-transcript.txt');
const LOG = path.join(OUT, 'gate-038-app.log');
const COMPACT_MAX = 340;
// Workspace HOST controls that must be ABSENT in the detached widget.
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
/** DOM/control inventory of the detached widget surface. */
async function inventory(client) {
  return client.evaluate(`(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
    const hostSelectors = ${JSON.stringify(HOST_SELECTORS)};
    const visibleHost = hostSelectors.filter((sel) => {
      const el = document.querySelector(sel);
      return visible(el);
    });
    const card = document.querySelector('.window-layout-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const memberRects = [...document.querySelectorAll('.window-layout-member')].map((m) => m.getBoundingClientRect());
    const controlRects = [...document.querySelectorAll('.window-layout-control')].map((c) => c.getBoundingClientRect());
    const isSize = (r) => r.width > 0 && r.height > 0;
    const inside = (r) => Boolean(cardRect) && r.left >= cardRect.left - 1 && r.right <= cardRect.right + 1 && r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1;
    return {
      windowContent: { w: window.innerWidth, h: window.innerHeight },
      cardRect: cardRect ? { w: Math.round(cardRect.width), h: Math.round(cardRect.height) } : null,
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
  console.log('=== 038 C5 DETACHED HOST FURNITURE REMOVAL LIVE GATE (isolated, exclusive interval) ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-038-'));
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
    const maxInv = await inventory(widget);
    record('038 natural/maximum: NO host furniture is rendered in the detached window (navigation/toolbar copy+Bin/status/footers/dialogs/backdrop absent)',
      Boolean(maxInv && maxInv.visibleHost.length === 0),
      JSON.stringify({ visibleHost: maxInv?.visibleHost }));
    record('038 natural/maximum: the shared card touches the client width with zero surrounding canvas',
      Boolean(maxInv && maxInv.cardRect && Math.abs(maxInv.cardRect.w - maxInv.windowContent.w) <= 2 && maxInv.cardRect.w <= COMPACT_MAX),
      JSON.stringify({ cardRect: maxInv?.cardRect, windowContent: maxInv?.windowContent }));
    record('038 natural/maximum: every member and the six legitimate card controls are visible and unclipped (inside the card)',
      Boolean(maxInv && maxInv.memberCount === BASE_COUNT && maxInv.membersVisible && maxInv.membersInside
        && maxInv.cardControls.length === 6 && maxInv.controlsVisible && maxInv.controlsInside),
      JSON.stringify({ cardControls: maxInv?.cardControls, memberCount: maxInv?.memberCount }));
    await screenshot(widget, '00-detached-max');

    // ---- Narrow --------------------------------------------------------------
    const NARROW_TARGET = 200;
    await resizeWidget(session.proc.pid, NARROW_TARGET, 260);
    await waitFor(async () => (await inventory(widget)).windowContent.w <= NARROW_TARGET + 24, 15000, 'narrow resize applied');
    await sleep(700);
    const narrowInv = await inventory(widget);
    record('038 narrow: NO host furniture rendered; card touches the client width (zero canvas)',
      Boolean(narrowInv && narrowInv.visibleHost.length === 0 && narrowInv.windowContent.w < COMPACT_MAX && Math.abs(narrowInv.cardRect.w - narrowInv.windowContent.w) <= 2),
      JSON.stringify({ visibleHost: narrowInv?.visibleHost, cardRect: narrowInv?.cardRect, windowContent: narrowInv?.windowContent }));
    record('038 narrow: every member and the six legitimate card controls remain visible and unclipped (wrapped)',
      Boolean(narrowInv && narrowInv.memberCount === BASE_COUNT && narrowInv.membersVisible && narrowInv.membersInside
        && narrowInv.cardControls.length === 6 && narrowInv.controlsVisible && narrowInv.controlsInside),
      JSON.stringify({ cardControls: narrowInv?.cardControls, memberCount: narrowInv?.memberCount }));
    await screenshot(widget, '01-detached-narrow');

    // ---- Reattach: attached card parity persists -----------------------------
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed');
    const attached = await waitFor(() => bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), controls: [...card.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph) };
    })()`), 15000, 'attached card restored');
    record('038 reattach: attached card restored live with the same legitimate controls; dimensions equal the detached card (parity persists)',
      Boolean(attached && attached.controls?.length === 6 && narrowInv && Math.abs(attached.w - narrowInv.cardRect.w) <= 2),
      JSON.stringify({ attached, detached: narrowInv?.cardRect }));
    await screenshot(bp, '02-attached-after-reattach');

    // ---- Above-eight members (12): wrapped at the compact maximum ------------
    for (const target of targets.slice(BASE_COUNT)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === TOTAL_TARGETS, 30000, 'twelve members persisted');
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widget12Target = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget (12)');
    const widget12 = await connectToTarget(widget12Target, session.baseUrl);
    await waitFor(() => widget12.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card (12)');
    await sleep(2000);
    const twelveInv = await inventory(widget12);
    record('038 12-member wrapped: NO host furniture rendered; card touches the client width (zero canvas)',
      Boolean(twelveInv && twelveInv.visibleHost.length === 0 && Math.abs(twelveInv.cardRect.w - twelveInv.windowContent.w) <= 2),
      JSON.stringify({ visibleHost: twelveInv?.visibleHost, cardRect: twelveInv?.cardRect, windowContent: twelveInv?.windowContent }));
    record('038 12-member wrapped: every member and the six legitimate card controls are visible and unclipped (inside the wrapped card)',
      Boolean(twelveInv && twelveInv.memberCount === TOTAL_TARGETS && twelveInv.membersVisible && twelveInv.membersInside
        && twelveInv.cardControls.length === 6 && twelveInv.controlsVisible && twelveInv.controlsInside),
      JSON.stringify({ cardControls: twelveInv?.cardControls, memberCount: twelveInv?.memberCount, cardRect: twelveInv?.cardRect }));
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
    '038 C5 DETACHED HOST FURNITURE REMOVAL LIVE GATE - TRANSCRIPT (isolated, exclusive interval)',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
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
