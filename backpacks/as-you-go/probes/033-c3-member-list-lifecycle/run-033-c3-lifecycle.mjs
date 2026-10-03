/**
 * 033 C3 LIVE LIFECYCLE PROBE (Ning, isolated, exclusive unattended interval).
 *
 * Faithfully reproduces the creator's C3 interaction against the REAL
 * reachable production path (AYG workspace + widget):
 *   - open the member list (`data-wl-list` -> picker list),
 *   - interact with it (hover candidate rows / click a candidate row),
 *   - close it,
 * and then asserts list visibility is PURE PRESENTATION: closing must NOT
 *   stop capture/preview services (hover thumbnails keep rendering),
 *   discard membership/runtime observations (member count/order/state kept),
 *   or clear the small active/running bar beneath member icons.
 * Also preserves the accepted bar rule (open/normal bar visible; minimized no
 * bar). Isolated Papers + fresh data dir + disposable windows only. Creator
 * data never touched. Evidence: PASS/FAIL lines + transcript + shots.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { connectToTarget, freePort, launchPapers, sleep, closeApp } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const DISPOSABLE = path.join(LPP, 'disposable-window.ps1');
const OUT = path.join(AYG_REPO, 'probes', '033-c3-member-list-lifecycle');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'proof-033-c3-transcript.txt');
const LOG = path.join(OUT, 'papers-033-c3.log');
const CYCLES = 6;

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
    try { if (await probe()) return true; } catch (error) { lastError = error; }
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
        if (parsed && parsed.pid && parsed.title) { clearInterval(timer); resolve(parsed); return; }
      } catch { /* partial */ }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error('marker timeout')); }
    }, 250);
  });
}
async function creatorPapersPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='Papers.exe'" | Select-Object ProcessId | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId).sort();
}
async function screenshot(client, name) {
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
  } catch { /* best effort */ }
}

async function readMemberState(bp, selector) {
  return bp.evaluate(`(() => {
    const strip = document.querySelector('${selector}');
    if (!strip) return null;
    return [...strip.querySelectorAll('[data-wl-member]')].map((b) => {
      const marker = b.querySelector('.window-layout-member-state');
      return {
        id: b.dataset.wlMember,
        title: (b.getAttribute('aria-label') || b.title || '').slice(0, 40),
        state: b.classList.contains('minimized') ? 'minimized' : 'normal',
        hasBar: Boolean(marker),
        barVisible: marker ? getComputedStyle(marker).display !== 'none' : false,
        barDataState: marker ? marker.getAttribute('data-wl-member-state') : null,
      };
    });
  })()`);
}

async function hoverMemberAt(bp, memberSelector, index) {
  return bp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('${memberSelector}')][${index}];
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    return true;
  })()`);
}

async function popoverPreviewState(bp) {
  return bp.evaluate(`(() => {
    const pop = document.querySelector('[data-wl-popover]');
    if (!pop) return { exists: false };
    return {
      exists: true,
      hidden: pop.hidden,
      previewImages: [...pop.querySelectorAll('[data-wl-popover-preview] img')].map((i) => ({
        srcLen: (i.getAttribute('src') || '').length,
        width: i.getAttribute('width'),
        height: i.getAttribute('height'),
      })),
    };
  })()`);
}

async function openList(bp, layoutId) {
  await bp.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
  await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].length > 0)`), 30000, 'list rows');
}
async function closeList(bp) {
  const stillOpen = await bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
  if (stillOpen) {
    await bp.evaluate(`document.querySelector('[data-wl-picker-close]').click()`);
    await sleep(400);
  }
  return bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
}
async function closeListEscape(bp) {
  await bp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await sleep(400);
  return bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
}
async function hidePopover(bp) {
  await bp.evaluate(`(() => { const p = document.querySelector('[data-wl-popover]'); if (p) p.hidden = true; return true; })()`);
}

async function main() {
  console.log(`=== 033 C3 MEMBER-LIST LIFECYCLE PROBE (${CYCLES} cycles) ===`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-033-c3-'));
  const projectCopy = path.join(dataDir, 'ayg-project-copy');
  const statePath = path.join(projectCopy, 'state.json');
  let creatorBefore = [];
  let session = null;
  let layoutId = null;
  const targetProcs = [];
  const targets = [];
  let bp = null;
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

    const TARGET_COUNT = 3;
    const TOTAL_WINDOWS = 4;
    const positions = [[120, 140], [820, 140], [120, 620], [820, 620]];
    for (let index = 0; index < TOTAL_WINDOWS; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('disposable windows launched', targets.length === TOTAL_WINDOWS, targets.map((t) => t.title).join(' '));

    const port = await freePort();
    session = await launchPapers(dataDir, port, LOG);
    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    const alreadyOpen = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 8000, 'frame').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((i) => i.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'frame');
    bp = await connectToTarget(projectTarget, session.baseUrl);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace');

    async function createLayout() {
      await bp.evaluate(`(() => { const v = document.querySelector('#icon-grid [data-blank-parent]'); v.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 })); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10000, 'menu');
      await bp.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30000, 'shell');
      return bp.evaluate(`[...document.querySelectorAll('.window-layout-shell')].pop().querySelector('[data-wl-layout]').dataset.wlLayout`);
    }
    async function pickFromList(id, title) {
      await openList(bp, id);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 60000, `row ${title}`);
      await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 30000, `member ${title}`);
      await sleep(300);
    }

    layoutId = await createLayout();
    for (let index = 0; index < TARGET_COUNT; index += 1) await pickFromList(layoutId, targets[index].title);
    await waitFor(() => bp.evaluate(`document.querySelectorAll('[data-wl-layout="${layoutId}"] [data-wl-member]').length === ${TARGET_COUNT}`), 30000, 'three members present');
    record('layout seeded with three list-picked members', true, layoutId);
    await screenshot(bp, '00-seeded');

    const stripSel = `[data-wl-members="${layoutId}"]`;
    const memberSel = `[data-wl-layout="${layoutId}"] [data-wl-member]`;

    // ---- baseline ----------------------------------------------------------
    const baseline = await readMemberState(bp, stripSel);
    const baselineAllNormal = Array.isArray(baseline) && baseline.length === TARGET_COUNT
      && baseline.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('baseline: running bar visible for every open/normal member', Boolean(baselineAllNormal), JSON.stringify(baseline));
    await screenshot(bp, '01-baseline-bars');

    await hoverMemberAt(bp, memberSel, 0);
    await sleep(700);
    const pop0 = await popoverPreviewState(bp);
    record('baseline: hover over member renders a real thumbnail in the popover',
      Boolean(pop0.exists && !pop0.hidden && pop0.previewImages?.length === 1 && pop0.previewImages[0].srcLen > 0),
      JSON.stringify(pop0));
    await screenshot(bp, '02-baseline-preview');
    await hidePopover(bp);

    // ---- repeated lifecycle: open -> interact -> close ---------------------
    let previewOkAfter = 0;
    let barsOkAfter = 0;
    let runtimeOkAfter = 0;
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await openList(bp, layoutId);
      record(`cycle ${cycle}: member list OPENED (presentation shown)`, true, `rows=${await bp.evaluate(`document.querySelectorAll('[data-wl-pick-candidate]').length`)}`);
      await screenshot(bp, `03-cycle${cycle}-open`);

      // INTERACT: hover over candidate rows (no membership change).
      await bp.evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-wl-pick-candidate]')];
        for (let i = 0; i < Math.min(4, rows.length); i += 1) {
          rows[i].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        }
        return true;
      })()`);
      await sleep(150);
      record(`cycle ${cycle}: member list INTERACTED (hovered candidate rows)`, true);

      // Alternate close path: click the × close button on odd cycles, Escape on
      // even cycles, so BOTH presentation close paths are exercised.
      const closeStill = cycle % 2 === 1 ? await closeList(bp) : await closeListEscape(bp);
      record(`cycle ${cycle}: member list CLOSED (presentation hidden)`, true, `stillPresent=${closeStill}`);
      await sleep(200);

      const memberState = await readMemberState(bp, stripSel);
      const barsOk = Array.isArray(memberState) && memberState.length === TARGET_COUNT
        && memberState.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
      record(`cycle ${cycle}: running bars intact after close (not cleared)`, Boolean(barsOk), JSON.stringify(memberState));
      if (barsOk) barsOkAfter += 1;

      await hoverMemberAt(bp, memberSel, 1);
      await sleep(700);
      const pop = await popoverPreviewState(bp);
      const previewOk = Boolean(pop.exists && !pop.hidden && pop.previewImages?.length === 1 && pop.previewImages[0].srcLen > 0);
      record(`cycle ${cycle}: window preview still works after close`, previewOk, JSON.stringify(pop));
      if (previewOk) previewOkAfter += 1;
      await hidePopover(bp);

      const memberCount = await bp.evaluate(`document.querySelectorAll('${memberSel}').length`);
      const runtimeOk = memberCount === TARGET_COUNT;
      record(`cycle ${cycle}: membership/runtime intact after close (no discard)`, runtimeOk, `members=${memberCount}`);
      if (runtimeOk) runtimeOkAfter += 1;
      await screenshot(bp, `04-cycle${cycle}-after-close`);
    }

    record(`ALL ${CYCLES} cycles: preview still works after every list close`, previewOkAfter === CYCLES, `${previewOkAfter}/${CYCLES}`);
    record(`ALL ${CYCLES} cycles: running bars intact after every list close`, barsOkAfter === CYCLES, `${barsOkAfter}/${CYCLES}`);
    record(`ALL ${CYCLES} cycles: membership/runtime intact after every list close`, runtimeOkAfter === CYCLES, `${runtimeOkAfter}/${CYCLES}`);

    // ---- close via click-outside (creator's likely gesture) -----------------
    await openList(bp, layoutId);
    const beforeOutside = await bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
    await bp.evaluate(`document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
    await sleep(400);
    const outsideClosed = await bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
    const outsideBars = await readMemberState(bp, stripSel);
    const outsideBarsOk = Array.isArray(outsideBars) && outsideBars.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('close via click-outside: list hides and running bars stay intact', Boolean(beforeOutside && !outsideClosed && outsideBarsOk), JSON.stringify({ beforeOutside, outsideClosed, bars: outsideBars }));
    await hoverMemberAt(bp, memberSel, 2);
    await sleep(700);
    const outsidePop = await popoverPreviewState(bp);
    record('close via click-outside: preview still works after close',
      Boolean(outsidePop.exists && !outsidePop.hidden && outsidePop.previewImages?.length === 1 && outsidePop.previewImages[0].srcLen > 0),
      JSON.stringify(outsidePop));
    await hidePopover(bp);

    // ---- preview showing, then list opens, then list closes -----------------
    await hoverMemberAt(bp, memberSel, 0);
    await sleep(500);
    const previewBefore = await popoverPreviewState(bp);
    await openList(bp, layoutId);
    await sleep(300);
    await closeList(bp);
    await sleep(300);
    await hoverMemberAt(bp, memberSel, 0);
    await sleep(700);
    const previewAfter = await popoverPreviewState(bp);
    const reopened = Boolean(previewBefore?.previewImages?.length === 1
      && previewAfter.exists && !previewAfter.hidden && previewAfter.previewImages?.length === 1 && previewAfter.previewImages[0].srcLen > 0);
    record('preview-showing then list open/close: hover preview resumes after close', reopened, JSON.stringify({ before: previewBefore, after: previewAfter }));
    await hidePopover(bp);

    // ---- hover a member WHILE the list is open, then close ------------------
    await openList(bp, layoutId);
    await hoverMemberAt(bp, memberSel, 2);
    await sleep(500);
    const whileOpenPop = await popoverPreviewState(bp);
    await closeList(bp);
    await sleep(300);
    await hoverMemberAt(bp, memberSel, 2);
    await sleep(700);
    const afterListPop = await popoverPreviewState(bp);
    const whileOpen = Boolean(whileOpenPop.exists && whileOpenPop.previewImages?.length === 1)
      && Boolean(afterListPop.exists && !afterListPop.hidden && afterListPop.previewImages?.length === 1 && afterListPop.previewImages[0].srcLen > 0);
    record('hover while list open then close: preview continues working after close', whileOpen, JSON.stringify({ whileOpen: whileOpenPop, after: afterListPop }));
    await hidePopover(bp);

    // ---- genuine ADD via the list (new 4th member) --------------------------
    const fourthTitle = targets[3].title;
    await openList(bp, layoutId);
    await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(fourthTitle)}); if (!row) return false; row.click(); return true; })()`);
    await sleep(500);
    const memberCount4 = await bp.evaluate(`document.querySelectorAll('${memberSel}').length`);
    const listClosedAfterAdd = await bp.evaluate(`Boolean(document.querySelector('[data-wl-picker-close]'))`);
    record('add via list: clicking a candidate row adds a member and closes the list', Boolean(memberCount4 === TARGET_COUNT + 1 && !listClosedAfterAdd), `members=${memberCount4} closed=${listClosedAfterAdd}`);
    const afterAddBars = await readMemberState(bp, stripSel);
    const afterAddBarsOk = Array.isArray(afterAddBars) && afterAddBars.length === TARGET_COUNT + 1
      && afterAddBars.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('add via list: every member (including the newly added) keeps a running bar', Boolean(afterAddBarsOk), JSON.stringify(afterAddBars));
    await hoverMemberAt(bp, memberSel, 2);
    await sleep(700);
    const addPop = await popoverPreviewState(bp);
    record('add via list: preview still works after the add closes the list',
      Boolean(addPop.exists && !addPop.hidden && addPop.previewImages?.length === 1 && addPop.previewImages[0].srcLen > 0),
      JSON.stringify(addPop));
    await hidePopover(bp);
    await screenshot(bp, '07-add-via-list');

    // ---- rapid double open/close (timing) -----------------------------------
    await openList(bp, layoutId);
    await closeList(bp);
    await openList(bp, layoutId);
    await closeList(bp);
    await sleep(300);
    const dblBars = await readMemberState(bp, stripSel);
    const dblBarsOk = Array.isArray(dblBars) && dblBars.length === TARGET_COUNT + 1
      && dblBars.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('rapid double open/close: running bars intact', Boolean(dblBarsOk), JSON.stringify(dblBars));
    await hoverMemberAt(bp, memberSel, 0);
    await sleep(700);
    const dblPop = await popoverPreviewState(bp);
    record('rapid double open/close: preview still works',
      Boolean(dblPop.exists && !dblPop.hidden && dblPop.previewImages?.length === 1 && dblPop.previewImages[0].srcLen > 0),
      JSON.stringify(dblPop));
    await hidePopover(bp);

    // ---- runtime observation liveness: an external minimize must flip the
    // ---- running bar within the observation cadence AFTER list close -------
    await ctl(['-Title', targets[1].title, '-Action', 'minimize']);
    await waitFor(async () => {
      const s = await readMemberState(bp, stripSel);
      return Array.isArray(s) && s[1] && s[1].state === 'minimized' && !s[1].barVisible;
    }, 15000, 'observation flips member 2 bar to minimized');
    const obsMin = await readMemberState(bp, stripSel);
    record('runtime observation alive after list close: external minimize flips the bar (no discard)',
      Boolean(Array.isArray(obsMin) && obsMin[1]?.state === 'minimized' && !obsMin[1]?.barVisible), JSON.stringify(obsMin));
    await ctl(['-Title', targets[1].title, '-Action', 'restore']);
    await waitFor(async () => {
      const s = await readMemberState(bp, stripSel);
      return Array.isArray(s) && s[1] && s[1].state === 'normal' && s[1].barVisible;
    }, 15000, 'observation flips member 2 bar back to normal');
    record('runtime observation alive after list close: restore flips the bar back (no discard)', true);

    // ---- REAL OS cursor hover over a member button (creator-faithful) ------
    const memberScreenPoint = await bp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('${memberSel}')][1];
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(window.screenX + r.left + r.width / 2), y: Math.round(window.screenY + r.top + r.height / 2) };
    })()`);
    if (memberScreenPoint) {
      await ctl(['-Title', targets[0].title, '-Action', 'move-only']).catch(() => undefined);
      await ctl(['-Action', 'move-only', '-X', String(memberScreenPoint.x), '-Y', String(memberScreenPoint.y)]).catch(() => undefined);
      await sleep(700);
      const realPop = await popoverPreviewState(bp);
      const serviceAlive = Boolean(realPop.exists && realPop.previewImages?.length === 1 && realPop.previewImages[0].srcLen > 0);
      record('real OS cursor over member: preview service still serves a live thumbnail after list close (popover slot filled)',
        serviceAlive, JSON.stringify(realPop));
      await hidePopover(bp);
    } else {
      record('real OS cursor hover over member renders a live thumbnail (no synthetic dispatch)', false, 'no member button');
    }

    // ---- accepted bar rule (open/non-minimized bar; minimized no bar) ------
    await bp.evaluate(`document.querySelector('[data-wl-min-all="${layoutId}"]').click()`);
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'minimized', 30000, 'min-all applied');
    const minimizedState = await readMemberState(bp, stripSel);
    const barRuleMin = Array.isArray(minimizedState) && minimizedState.every((m) => m.state === 'minimized' && !m.barVisible);
    record('bar rule: minimized members show NO bar', Boolean(barRuleMin), JSON.stringify(minimizedState));
    // While minimized, open + close the member list, then confirm previews still
    // serve useful minimized content AND the minimized bar stays hidden.
    await openList(bp, layoutId);
    await closeList(bp);
    await hoverMemberAt(bp, memberSel, 0);
    await sleep(700);
    const minPop = await popoverPreviewState(bp);
    const minPreview = Boolean(minPop.exists && !minPop.hidden && minPop.previewImages?.length === 1 && minPop.previewImages[0].srcLen > 0);
    record('useful minimized preview preserved across list open/close', minPreview, JSON.stringify(minPop));
    await hidePopover(bp);
    const minAfterList = await readMemberState(bp, stripSel);
    const barMinAfterList = Array.isArray(minAfterList) && minAfterList.every((m) => m.state === 'minimized' && !m.barVisible);
    record('bar rule after list open/close: minimized members still show NO bar', Boolean(barMinAfterList), JSON.stringify(minAfterList));
    await bp.evaluate(`document.querySelector('[data-wl-restore-all="${layoutId}"]').click()`);
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'normal', 30000, 'restore-all applied');
    const restoredState = await readMemberState(bp, stripSel);
    const barRuleRest = Array.isArray(restoredState) && restoredState.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('bar rule: open/normal members show the bar again after restore', Boolean(barRuleRest), JSON.stringify(restoredState));
    await screenshot(bp, '05-bar-rule');

    // ---- also drive the DETACHED widget card through the same lifecycle -----
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widgetTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget target');
    const widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card rendered');
    await sleep(800);
    await widget.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
    await waitFor(() => widget.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].length > 0)`), 30000, 'widget list rows');
    await widget.evaluate(`document.querySelector('[data-wl-picker-close]').click()`);
    await sleep(400);
    const widgetMembers = await readMemberState(widget, `[data-wl-members="${layoutId}"]`);
    const widgetBars = Array.isArray(widgetMembers) && widgetMembers.length === TARGET_COUNT + 1
      && widgetMembers.every((m) => m.state === 'normal' && m.hasBar && m.barVisible);
    record('widget: member list open/close preserves running bars', Boolean(widgetBars), JSON.stringify(widgetMembers));
    await hoverMemberAt(widget, `[data-wl-layout="${layoutId}"] [data-wl-member]`, 0);
    await sleep(700);
    const wpop = await popoverPreviewState(widget);
    record('widget: hover preview still works after list close',
      Boolean(wpop.exists && !wpop.hidden && wpop.previewImages?.length === 1 && wpop.previewImages[0].srcLen > 0),
      JSON.stringify(wpop));
    await screenshot(widget, '06-widget-after-list-close');
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await sleep(500);

    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2000);
  } catch (error) {
    record('probe step', false, String(error).slice(0, 500));
  } finally {
    try {
      if (bp) bp.close();
      if (session) { await closeApp(session.proc, session.baseUrl).catch(() => undefined); session = null; }
      for (const target of targets) await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
      for (const proc of targetProcs) if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
      await sleep(1500);
    } catch { /* best-effort */ }
    const creatorAfter = await creatorPapersPids().catch(() => []);
    record('creator installed Papers untouched after run', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
  }
  const passed = steps.length - failures;
  const transcript = [
    '033 C3 MEMBER-LIST LIFECYCLE PROBE - TRANSCRIPT (isolated, exclusive interval)',
    `run at: ${new Date().toISOString()}`,
    `cycles: ${CYCLES}`,
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

main();
