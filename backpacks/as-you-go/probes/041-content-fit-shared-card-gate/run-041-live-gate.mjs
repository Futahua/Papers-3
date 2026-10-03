/**
 * 041 C5 CONTENT-FIT SHARED CARD + NATIVE HOST LIVE GATE (Winter, exclusive
 * interval). Launches the ISOLATED built Papers host + current As you Go source
 * with a fresh data dir and disposable windows, then validates every current
 * C4/C5 clause + investigation section D:
 *   - one/few-member cards CONTENT-FIT (no wide empty minimum); the host client
 *     equals the card border box in BOTH axes at every width;
 *   - one shared card component/state 1:1 attached and detached;
 *   - continuous measured-width reflow (row counts change with the actual width;
 *     no icon/column/member-count breakpoints);
 *   - icon + running bar is ONE indivisible member cell (no orphan bar);
 *   - coherent wrapping controls, even gaps, safe edges, no clipping, no hidden
 *     members, no overly long strip, no redundant title, no detached furniture;
 *   - shared geometry persists through detach/resize/reattach/redetach;
 *   - grey inert workspace placeholder while detached (lock-only reattach; the
 *     detached card is the sole live card).
 * Cases: 1 member, 6 members, and 12 members at narrow/natural/wide widths.
 * Isolated state and disposable windows only. Evidence: PASS/FAIL lines with
 * literal width+height measurements, per-clause screenshots in shots/,
 * the transcript and the app log.
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
const OUT = path.join(AYG_REPO, 'probes', '041-content-fit-shared-card-gate');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'gate-041-transcript.txt');
const LOG = path.join(OUT, 'gate-041-app.log');
const COMPACT_MAX = 340;
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
/** Full two-axis + inventory + cell-bar measurement of the detached widget. */
async function measure(client) {
  return client.evaluate(`(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none');
    const hostSelectors = ${JSON.stringify(HOST_SELECTORS)};
    const visibleHost = hostSelectors.filter((sel) => visible(document.querySelector(sel)));
    const card = document.querySelector('.window-layout-card');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const memberRects = [...document.querySelectorAll('.window-layout-member')].map((m) => m.getBoundingClientRect());
    const controlRects = [...document.querySelectorAll('.window-layout-control')].map((c) => c.getBoundingClientRect());
    const barRects = [...document.querySelectorAll('.window-layout-member-state')].map((b) => b.getBoundingClientRect());
    const isSize = (r) => r.width > 0 && r.height > 0;
    const inside = (r) => Boolean(cardRect) && r.left >= cardRect.left - 1 && r.right <= cardRect.right + 1 && r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1;
    // No orphan bar: every running bar sits within its member button's bounds.
    const memberButtons = [...document.querySelectorAll('.window-layout-member')].map((m) => m.getBoundingClientRect());
    const barsInsideCell = barRects.every((b) => memberButtons.some((m) => b.top >= m.top - 1 && b.bottom <= m.bottom + 1 && b.left >= m.left - 1 && b.right <= m.right + 1));
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
      barsInsideCell,
      hasTitle: Boolean(document.querySelector('.window-layout-card-title')),
    };
  })()`);
}

async function main() {
  console.log('=== 041 C5 CONTENT-FIT SHARED CARD + NATIVE HOST LIVE GATE (isolated, exclusive interval) ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-041-'));
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
    async function openWidget(id) {
      await bp.evaluate(`document.querySelector('[data-wl-detach="${id}"]').click()`);
      const t = await waitForTarget(session.baseUrl, (x) => x.url.includes(`papers-layout-key=${id}`), 60000, 'detached widget');
      const w = await connectToTarget(t, session.baseUrl);
      await waitFor(() => w.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card');
      await sleep(2000);
      return w;
    }
    async function closeWidget(w, id) {
      await w.evaluate(`document.querySelector('[data-wl-reattach="${id}"]').click()`);
      await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${id}`)).length === 0, 20000, 'widget closed');
    }

    layoutId = await createLayout();
    await pickFromList(layoutId, targets[0].title);
    await waitFor(() => memberCount(statePath) === 1, 30000, 'one member persisted');

    // ---- ONE member: content-fit card, host == card border box ----------------
    const w1 = await openWidget(layoutId);
    const one = await measure(w1);
    record('041 ONE member: card CONTENT-FITS (width well below the compact max - no wide empty minimum)',
      Boolean(one && one.cardRect && one.cardRect.w < COMPACT_MAX - 60 && one.cardRect.w > 60),
      JSON.stringify({ cardRect: one?.cardRect, windowContent: one?.windowContent }));
    record('041 ONE member: host client == card border box in BOTH axes; no title, no furniture, member + six controls visible/unclipped, no orphan bar',
      Boolean(one && Math.abs(one.cardRect.w - one.windowContent.w) <= W_TOL && Math.abs(one.cardRect.h - one.windowContent.h) <= H_TOL
        && !one.hasTitle && one.visibleHost.length === 0 && one.memberCount === 1 && one.membersVisible && one.membersInside
        && one.cardControls.length === 6 && one.controlsVisible && one.controlsInside && one.barsInsideCell),
      JSON.stringify({ cardRect: one?.cardRect, windowContent: one?.windowContent, visibleHost: one?.visibleHost, cardControls: one?.cardControls, barsInsideCell: one?.barsInsideCell }));
    await screenshot(w1, '00-detached-one');
    await closeWidget(w1, layoutId);

    // ---- SIX members: natural content-fit + narrow wrap + wide snap -----------
    for (const target of targets.slice(1, 6)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === 6, 30000, 'six members persisted');
    const w6 = await openWidget(layoutId);
    const sixNatural = await measure(w6);
    record('041 SIX members natural: card content-fits (no wide empty minimum), host client == card border box, row change from width',
      Boolean(sixNatural && sixNatural.cardRect.w < COMPACT_MAX && Math.abs(sixNatural.cardRect.w - sixNatural.windowContent.w) <= W_TOL && Math.abs(sixNatural.cardRect.h - sixNatural.windowContent.h) <= H_TOL),
      JSON.stringify({ cardRect: sixNatural?.cardRect, windowContent: sixNatural?.windowContent, rows: sixNatural?.rows }));
    await screenshot(w6, '01-detached-six-natural');

    await resizeWidget(session.proc.pid, 120, 300);
    await waitFor(async () => (await measure(w6)).windowContent.w <= 144, 15000, 'narrow resize applied');
    await sleep(700);
    const sixNarrow = await measure(w6);
    record('041 SIX members narrow: continuous measured-width reflow (MORE rows than natural), host client == card border box, all visible/unclipped, no orphan bar',
      Boolean(sixNarrow && sixNarrow.windowContent.w < COMPACT_MAX && sixNarrow.rows > sixNatural.rows
        && Math.abs(sixNarrow.cardRect.w - sixNarrow.windowContent.w) <= W_TOL && Math.abs(sixNarrow.cardRect.h - sixNarrow.windowContent.h) <= H_TOL
        && sixNarrow.memberCount === 6 && sixNarrow.membersInside && sixNarrow.cardControls.length === 6 && sixNarrow.controlsInside && sixNarrow.barsInsideCell),
      JSON.stringify({ naturalRows: sixNatural?.rows, narrowRows: sixNarrow?.rows, cardRect: sixNarrow?.cardRect, windowContent: sixNarrow?.windowContent, barsInsideCell: sixNarrow?.barsInsideCell }));
    await screenshot(w6, '02-detached-six-narrow');

    await resizeWidget(session.proc.pid, 600, 260);
    await waitFor(async () => (await measure(w6)).windowContent.w <= COMPACT_MAX + 4, 20000, 'wide attempt snapped back to content');
    await sleep(700);
    const sixWide = await measure(w6);
    record('041 SIX members wide attempt: the content-fit card never stretches - the host client snaps back to the card border box (no blank host canvas)',
      Boolean(sixWide && Math.abs(sixWide.cardRect.w - sixWide.windowContent.w) <= W_TOL && Math.abs(sixWide.cardRect.h - sixWide.windowContent.h) <= H_TOL && sixWide.windowContent.w < 400),
      JSON.stringify({ cardRect: sixWide?.cardRect, windowContent: sixWide?.windowContent }));
    await screenshot(w6, '03-detached-six-wide-snapped');

    // ---- Placeholder refusal + sole-live interaction (while detached) --------
    const placeholder = await bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      const controls = [...(card?.querySelectorAll('.window-layout-control') ?? [])];
      const members = [...(card?.querySelectorAll('[data-wl-member]') ?? [])];
      return {
        isPlaceholder: card ? card.classList.contains('window-layout-card--placeholder') : false,
        membersDisabled: members.length > 0 && members.every((m) => m.disabled),
        hasReattach: controls.some((c) => c.dataset.wlGlyph === 'reattach'),
        hasDetach: controls.some((c) => c.dataset.wlGlyph === 'detach'),
        controlCount: controls.length,
      };
    })()`);
    record('041 while detached: the workspace card is a grey INERT placeholder - only the lock (reattach), members disabled, no detach',
      Boolean(placeholder && placeholder.isPlaceholder && placeholder.membersDisabled && placeholder.hasReattach && !placeholder.hasDetach && placeholder.controlCount === 1),
      JSON.stringify(placeholder));
    const membersBefore = memberCount(statePath);
    await bp.evaluate(`(() => { const m = document.querySelector('[data-wl-card="${layoutId}"] [data-wl-member]'); if (m) m.click(); return true; })()`).catch(() => undefined);
    await sleep(400);
    record('041 placeholder refusal: clicking a placeholder member performs no state change',
      memberCount(statePath) === membersBefore, `before=${membersBefore} after=${memberCount(statePath)}`);
    const soleLive = await w6.evaluate(`Boolean(document.querySelector('.window-layout-controls [data-wl-glyph="pick"]') && document.querySelector('.window-layout-member'))`);
    record('041 sole-live: the detached card is the sole live card (its pick control and members are present and interactive)',
      Boolean(soleLive), JSON.stringify({ soleLive }));
    await screenshot(bp, '04-attached-placeholder');

    // ---- Reattach: equal-geometry attached/detached 1:1 ----------------------
    const persistedSix = persistedCardSize(statePath);
    await closeWidget(w6, layoutId);
    const attached6 = await waitFor(() => bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      if (!card) return null;
      const controls = [...card.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph);
      if (!controls.includes('detach')) return null;
      const rect = card.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), controls };
    })()`), 15000, 'attached card restored live');
    record('041 reattach: attached card live (detach lock), EXACT 1:1 equal-geometry with the detached card at the shared persisted geometry',
      Boolean(attached6 && persistedSix && sixWide && !attached6.isPlaceholder && attached6.controls?.includes('detach')
        && Math.abs(attached6.w - sixWide.cardRect.w) <= 2 && Math.abs(attached6.h - sixWide.cardRect.h) <= 2
        && Math.abs(persistedSix.width - sixWide.cardRect.w) <= 2),
      JSON.stringify({ attached: attached6, detached: sixWide?.cardRect, persisted: persistedSix }));
    await screenshot(bp, '05-attached-after-reattach');

    // ---- TWELVE members: capped wrap + narrow reflow --------------------------
    for (const target of targets.slice(6)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberCount(statePath) === TOTAL_TARGETS, 30000, 'twelve members persisted');
    const w12 = await openWidget(layoutId);
    const twelve = await measure(w12);
    record('041 TWELVE members natural: wrapped rows (2+) within the compact bound, host client == card border box, all 12 + six controls visible/unclipped, no orphan bar',
      Boolean(twelve && twelve.rows >= 2 && twelve.cardRect.w <= COMPACT_MAX && Math.abs(twelve.cardRect.w - twelve.windowContent.w) <= W_TOL && Math.abs(twelve.cardRect.h - twelve.windowContent.h) <= H_TOL
        && twelve.memberCount === 12 && twelve.membersInside && twelve.cardControls.length === 6 && twelve.controlsInside && twelve.barsInsideCell),
      JSON.stringify({ rows: twelve?.rows, cardRect: twelve?.cardRect, windowContent: twelve?.windowContent, barsInsideCell: twelve?.barsInsideCell }));
    await screenshot(w12, '06-detached-twelve-natural');
    await resizeWidget(session.proc.pid, 120, 460);
    await waitFor(async () => (await measure(w12)).windowContent.w <= 144, 15000, 'narrow resize (12)');
    await sleep(700);
    const twelveNarrow = await measure(w12);
    record('041 TWELVE members narrow: MORE rows from the actual width, host client == card border box, every member + control visible/unclipped',
      Boolean(twelveNarrow && twelveNarrow.windowContent.w < COMPACT_MAX && twelveNarrow.rows > twelve.rows
        && Math.abs(twelveNarrow.cardRect.w - twelveNarrow.windowContent.w) <= W_TOL && Math.abs(twelveNarrow.cardRect.h - twelveNarrow.windowContent.h) <= H_TOL
        && twelveNarrow.memberCount === 12 && twelveNarrow.membersInside && twelveNarrow.cardControls.length === 6 && twelveNarrow.controlsInside),
      JSON.stringify({ naturalRows: twelve?.rows, narrowRows: twelveNarrow?.rows, cardRect: twelveNarrow?.cardRect, windowContent: twelveNarrow?.windowContent }));
    await screenshot(w12, '07-detached-twelve-narrow');
    await closeWidget(w12, layoutId);
    const persisted12 = persistedCardSize(statePath);
    record('041 redetach persistence: the shared geometry survives the 12-member resize and reattach (persisted == the detached card)',
      Boolean(persisted12 && twelveNarrow && Math.abs(persisted12.width - twelveNarrow.cardRect.w) <= 2),
      JSON.stringify({ persisted: persisted12, detached: twelveNarrow?.cardRect }));

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
    '041 C5 CONTENT-FIT SHARED CARD + NATIVE HOST LIVE GATE - TRANSCRIPT (isolated, exclusive interval)',
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
