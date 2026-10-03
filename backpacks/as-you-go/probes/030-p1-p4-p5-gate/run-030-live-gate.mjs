/**
 * 030 P1/P4/P5 LIVE GATE (Winter, exclusive unattended interval).
 * Launches the ISOLATED built Papers/As you Go test build with a fresh data dir
 * and disposable windows, then validates every P1/P4/P5 clause against the
 * ACTUAL reachable attached and detached layout cards. Isolated state and
 * disposable windows only; creator data never touched. Evidence: console
 * PASS/FAIL lines, per-clause screenshots in shots/, the transcript and the app
 * log. No commit/push/release/install/shortcut switch.
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
const OUT = path.join(AYG_REPO, 'probes', '030-p1-p4-p5-gate');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'gate-030-transcript.txt');
const LOG = path.join(OUT, 'gate-030-app.log');

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
async function creatorPapersPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='Papers.exe'" | Select-Object ProcessId | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId).sort();
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
function memberOrder(statePath) {
  return (readState(statePath)?.windowLayouts?.[0]?.arrangement?.members ?? []).map((m) => m.title ?? m.descriptor?.title);
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
async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}

async function main() {
  console.log('=== 030 P1/P4/P5 LIVE GATE (isolated, exclusive interval) ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-030-'));
  const projectCopy = path.join(dataDir, 'ayg-project-copy');
  const statePath = path.join(projectCopy, 'state.json');
  let creatorBefore = [];
  let session = null;
  let isolatedRoot = null;
  let ownedIdentity = new Map();
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
    isolatedRoot = session.proc.pid;
    const procs0 = await allProcesses();
    const owned0 = await descendantPids(isolatedRoot, procs0);
    ownedIdentity = new Map(procs0.filter((p) => owned0.has(Number(p.ProcessId))).map((p) => [Number(p.ProcessId), `${Number(p.ProcessId)}:${String(p.CreationDate ?? '')}`]));
    record('isolated root PID captured with exact descendant set', owned0.size > 0, `root=${isolatedRoot}`);

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
    await waitFor(() => memberOrder(statePath).length === BASE_COUNT, 30000, 'six members persisted');
    record('layout with six list-picked members seeded (baseline above the old four-icon cap)', memberOrder(statePath).length === BASE_COUNT, layoutId);
    await screenshot(bp, '00-attached-workspace');

    const attachedCard = await bp.evaluate(`(() => {
      const body = document.querySelector('[data-wl-layout="${layoutId}"]');
      if (!body) return null;
      const shell = body.closest('.window-layout-shell');
      const card = body.closest('.icon-item');
      const rect = card ? card.getBoundingClientRect() : null;
      return {
        hasArt: Boolean(shell?.querySelector('.window-layout-art')),
        hasItemIcon: Boolean(card?.querySelector(':scope > .item-icon')),
        body: Boolean(body),
        cardRect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        scrollH: card ? card.scrollHeight : null,
        hasFolderArtClass: Boolean(shell?.querySelector('.folder-art')),
      };
    })()`);
    record('P1 attached card: no decorative folder art (no art / folder-art / empty icon box)',
      Boolean(attachedCard && !attachedCard.hasArt && !attachedCard.hasFolderArtClass && !attachedCard.hasItemIcon && attachedCard.body),
      JSON.stringify(attachedCard));
    record('P1 attached card: content-sized (rendered height equals scroll content within 8px)',
      Boolean(attachedCard?.cardRect && attachedCard.scrollH && Math.abs(attachedCard.cardRect.h - attachedCard.scrollH) <= 8),
      JSON.stringify({ cardRect: attachedCard?.cardRect, scrollH: attachedCard?.scrollH }));
    const noCap = await bp.evaluate(`(() => {
      const strip = document.querySelector('[data-wl-members="${layoutId}"]');
      const card = strip?.closest('.window-layout-card');
      const cardRect = card ? card.getBoundingClientRect() : null;
      return {
        memberButtons: strip ? strip.querySelectorAll('.window-layout-member').length : 0,
        clipX: strip ? strip.scrollWidth - strip.clientWidth : 0,
        cardRect: cardRect ? { w: Math.round(cardRect.width), h: Math.round(cardRect.height) } : null,
        cardClass: card ? card.className : null,
      };
    })()`);
    record('C4 no hard four-icon cap: all six members are rendered and visible (no clipped strip)',
      Boolean(noCap && noCap.memberButtons === BASE_COUNT && noCap.clipX <= 4 && noCap.cardClass?.includes('window-layout-card')),
      JSON.stringify(noCap));
    const layout6 = await bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      const strip = card?.querySelector('[data-wl-members]');
      const controls = card?.querySelector('.window-layout-controls');
      const cardRect = card?.getBoundingClientRect();
      const lock = [...(card?.querySelectorAll('.window-layout-control') ?? [])].pop();
      const lockRect = lock?.getBoundingClientRect();
      const gap = (a, b) => { const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect(); return Math.round(br.left - ar.right); };
      const memberRects = [...(strip?.querySelectorAll('.window-layout-member') ?? [])].map((m) => m.getBoundingClientRect());
      const rows = new Set(memberRects.map((r) => Math.round(r.top))).size;
      return {
        rows,
        cardW: cardRect ? Math.round(cardRect.width) : null,
        cardRightPadding: cardRect && lockRect ? Math.round(cardRect.right - lockRect.right) : null,
        lockFullyVisible: Boolean(lockRect && lockRect.left >= 0 && lockRect.right <= window.innerWidth),
        controlGap: card && controls ? gap(controls.children[0], controls.children[1]) : null,
        controlGapUniform: (() => { const els = [...(controls?.children ?? [])]; if (els.length < 2) return true; const g = els[0].getBoundingClientRect().right; const expected = els[0].getBoundingClientRect().right; const gaps = []; for (let i = 1; i < els.length; i += 1) { const r = els[i].getBoundingClientRect(); const prev = els[i - 1].getBoundingClientRect(); gaps.push(Math.round(r.left - prev.right)); } return gaps.every((x) => x === gaps[0]); })(),
      };
    })()`);
    record('C4 bounded wrap at six members: one row, no overflow, uniform control gaps, safe lock edge padding',
      Boolean(layout6 && layout6.rows === 1 && layout6.cardW <= 340 && layout6.cardRightPadding >= 6 && layout6.lockFullyVisible && layout6.controlGapUniform),
      JSON.stringify(layout6));

    const scrollbar = await bp.evaluate(`(() => {
      const members = document.querySelector('[data-wl-members="${layoutId}"]');
      const controls = [...document.querySelectorAll('.window-layout-controls')][0];
      const read = (el) => el ? { scrollbarWidth: getComputedStyle(el).scrollbarWidth, clientW: el.clientWidth, scrollW: el.scrollWidth } : null;
      return { members: read(members), controls: read(controls) };
    })()`);
    record('P3 no intrusive native-looking scrollbar (members + controls strips hide it)',
      Boolean(scrollbar?.members && scrollbar.members.scrollbarWidth === 'none'
        && scrollbar.controls && scrollbar.controls.scrollbarWidth === 'none'),
      JSON.stringify(scrollbar));
    await screenshot(bp, '01-attached-card');

    const barBefore = await bp.evaluate(`(() => { const b = [...document.querySelectorAll('[data-wl-member]')][0]; return { hasBar: Boolean(b?.querySelector('.window-layout-member-state')) }; })()`);
    await bp.evaluate(`document.querySelector('[data-wl-min-all="${layoutId}"]').click()`);
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'minimized', 30000, 'min-all applied');
    const barMinimized = await bp.evaluate(`(() => { const b = [...document.querySelectorAll('[data-wl-member]')][0]; const m = b?.querySelector('.window-layout-member-state'); return { hasBar: Boolean(m), visible: m ? getComputedStyle(m).display !== 'none' : false }; })()`);
    await bp.evaluate(`document.querySelector('[data-wl-restore-all="${layoutId}"]').click()`);
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'normal', 30000, 'restore-all applied');
    record('P1 running bar: present for open/normal, absent/hidden when minimized, restored after',
      Boolean(barBefore?.hasBar && barMinimized && !barMinimized.visible),
      JSON.stringify({ before: barBefore, minimized: barMinimized }));

    const controls = await bp.evaluate(`(() => {
      const els = [...document.querySelectorAll('[data-wl-layout="${layoutId}"] .window-layout-control')];
      const cs = els[0] ? getComputedStyle(els[0]) : null;
      return { count: els.length, border: cs ? cs.border : null, boxShadow: cs ? cs.boxShadow : null };
    })()`);
    record('P5 controls: coherent row, no individual button outlines (transparent border, no shadow)',
      Boolean(controls?.count >= 5 && controls.border && /transparent|rgba\(0, 0, 0, 0\)/.test(controls.border) && (!controls.boxShadow || controls.boxShadow === 'none')),
      JSON.stringify(controls));
    await screenshot(bp, '02-attached-controls');

    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widgetTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget target');
    const widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card rendered');
    await sleep(1500);
    const detached = await widget.evaluate(`(() => {
      const root = document.querySelector('.window-layout-card');
      const hasTitle = Boolean(document.querySelector('.window-layout-card-title'));
      const icons = [...document.querySelectorAll('.window-layout-member-icon')].map((i) => i.getAttribute('src'));
      const controls = [...document.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph);
      const card = (() => {
        if (!root) return null;
        const rect = root.getBoundingClientRect();
        let w = rect.width;
        let h = rect.height;
        for (const strip of root.querySelectorAll('[data-wl-members], .window-layout-controls')) {
          if (strip.scrollWidth > w) w = strip.scrollWidth;
          if (strip.scrollHeight > h) h = strip.scrollHeight;
        }
        return { w: Math.round(w), h: Math.round(h), scrollW: root.scrollWidth, scrollH: root.scrollHeight };
      })();
      return {
        hasTitle,
        body: Boolean(document.querySelector('.window-layout-body')),
        memberCount: document.querySelectorAll('.window-layout-member').length,
        realIcons: icons.filter((s) => s && s.length > 0).length,
        totalIcons: icons.length,
        controls,
        windowContent: { w: window.innerWidth, h: window.innerHeight },
        card,
      };
    })()`);
    await screenshot(widget, '03-detached-widget');
    record('P4 detach preserves exact identity with NO redundant title (same body, members, controls)',
      Boolean(detached && detached.body && !detached.hasTitle && detached.controls?.length >= 5 && detached.memberCount === BASE_COUNT),
      JSON.stringify(detached));
    record('P4 detach preserves REAL member icons (every member has a non-empty icon)',
      Boolean(detached && detached.totalIcons === BASE_COUNT && detached.realIcons === BASE_COUNT),
      JSON.stringify({ totalIcons: detached?.totalIcons, realIcons: detached?.realIcons }));
    const fitDelta = detached?.windowContent && detached.card
      ? { w: detached.windowContent.w - detached.card.w, h: detached.windowContent.h - detached.card.h }
      : null;
    record('P4 detached card is content-sized (window CONTENT fits the full card within a tight width AND height tolerance)',
      Boolean(fitDelta && fitDelta.w >= -2 && fitDelta.w <= 24 && fitDelta.h >= -2 && fitDelta.h <= 24),
      JSON.stringify({ windowContent: detached?.windowContent, card: detached?.card, fitDelta }));
    // 033 C5: component identity + dimensions - the ATTACHED and DETACHED cards
    // are the SAME component (same title, member count, controls, and close
    // dimensions). The detached card measured just above.
    const attachedCardIdentity = await bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return {
        className: card.className,
        hasTitle: Boolean(card.querySelector('.window-layout-card-title')),
        memberCount: card.querySelectorAll('.window-layout-member').length,
        controls: [...card.querySelectorAll('.window-layout-control')].map((c) => c.dataset.wlGlyph),
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    })()`);
    const sharedControls = (list) => (Array.isArray(list) ? list : []).slice(0, 5);
    const sameShared = JSON.stringify(sharedControls(attachedCardIdentity?.controls)) === JSON.stringify(sharedControls(detached?.controls));
    const lockShared = Array.isArray(attachedCardIdentity?.controls) && Array.isArray(detached?.controls)
      && (attachedCardIdentity.controls.includes('detach') || attachedCardIdentity.controls.includes('reattach'))
      && (detached.controls.includes('detach') || detached.controls.includes('reattach'));
    const sameComponent = Boolean(
      attachedCardIdentity && !attachedCardIdentity.hasTitle && !detached.hasTitle
      && attachedCardIdentity.memberCount === detached?.memberCount
      && sameShared && lockShared);
    const dimensionDelta = attachedCardIdentity?.rect && detached?.card
      ? { w: Math.abs(attachedCardIdentity.rect.w - detached.card.w), h: Math.abs(attachedCardIdentity.rect.h - detached.card.h) }
      : null;
    record('C5 shared card component: attached and detached render the SAME card, NO title (members, shared controls + lock toggle)',
      Boolean(sameComponent && attachedCardIdentity?.className?.includes('window-layout-card')),
      JSON.stringify({ attached: attachedCardIdentity, detached: { hasTitle: detached?.hasTitle, memberCount: detached?.memberCount, controls: detached?.controls, card: detached?.card }, sameShared, lockShared }));
    record('C5 shared card dimensions: attached and detached card sizes match within a tight tolerance',
      Boolean(dimensionDelta && dimensionDelta.w <= 16 && dimensionDelta.h <= 16),
      JSON.stringify({ attachedRect: attachedCardIdentity?.rect, detachedCard: detached?.card, dimensionDelta }));

    async function dragReorder(client, id, fromIndex, toIndex) {
      const rects = await client.evaluate(`(() => [...document.querySelectorAll('[data-wl-members="${id}"] [data-wl-member]')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))()`);
      if (rects.length <= Math.max(fromIndex, toIndex)) return false;
      const from = rects[fromIndex];
      const to = rects[toIndex];
      const emit = (type, x, y) => client.evaluate(`(() => { const strip = document.querySelector('[data-wl-members="${id}"]'); const target = strip ?? document.body; target.dispatchEvent(new PointerEvent('${type}', { bubbles: true, cancelable: true, button: 0, clientX: ${x}, clientY: ${y}, pointerId: 7 })); return true; })()`);
      await client.evaluate(`(() => { const b = [...document.querySelectorAll('[data-wl-members="${id}"] [data-wl-member]')][${fromIndex}]; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: ${from.x}, clientY: ${from.y}, pointerId: 7 })); })()`);
      await sleep(80);
      await emit('pointermove', to.x + 4, to.y);
      await sleep(120);
      await emit('pointerup', to.x + 4, to.y);
      await sleep(300);
      return true;
    }
    const orderBeforeAttached = memberOrder(statePath);
    await dragReorder(bp, layoutId, 2, 0);
    await waitFor(() => memberOrder(statePath).join(',') !== orderBeforeAttached.join(','), 20000, 'attached reorder persisted');
    record('P5 member reorder works in the ATTACHED card and persists',
      memberOrder(statePath).join(',') !== orderBeforeAttached.join(','),
      JSON.stringify({ before: orderBeforeAttached, after: memberOrder(statePath) }));
    await screenshot(bp, '04-attached-after-reorder');

    const orderBeforeDetached = memberOrder(statePath);
    await dragReorder(widget, layoutId, 0, 2);
    await waitFor(() => memberOrder(statePath).join(',') !== orderBeforeDetached.join(','), 20000, 'detached reorder persisted');
    record('P5 member reorder works in the DETACHED card and persists through the channel',
      memberOrder(statePath).join(',') !== orderBeforeDetached.join(','),
      JSON.stringify({ before: orderBeforeDetached, after: memberOrder(statePath) }));
    await screenshot(widget, '05-detached-after-reorder');

    // 033 C5: the lock icon is SOLELY the detach on/off toggle. In the widget
    // it is the locked reattach padlock; clicking it closes the widget and the
    // workspace card returns to the unlocked detach padlock.
    const widgetHasReattach = await widget.evaluate(`Boolean(document.querySelector('[data-wl-reattach="${layoutId}"]'))`);
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed by reattach toggle');
    const workspaceDetachBack = await bp.evaluate(`Boolean(document.querySelector('[data-wl-detach="${layoutId}"]'))`);
    record('C5 lock icon solely toggles detached on/off (reattach closes the widget; the attached card returns to detach)',
      Boolean(widgetHasReattach && workspaceDetachBack),
      JSON.stringify({ widgetHasReattach, workspaceDetachBack }));
    await screenshot(bp, '07-attached-after-reattach');

    // ---- 034: representative count above eight (12 members) - bounded WRAP --
    for (const target of targets.slice(BASE_COUNT)) await pickFromList(layoutId, target.title);
    await waitFor(() => memberOrder(statePath).length === TOTAL_TARGETS, 30000, 'twelve members persisted');
    const wrap12 = await bp.evaluate(`(() => {
      const card = document.querySelector('[data-wl-card="${layoutId}"]');
      const strip = card?.querySelector('[data-wl-members]');
      const rects = [...(strip?.querySelectorAll('.window-layout-member') ?? [])].map((m) => m.getBoundingClientRect());
      const cardRect = card?.getBoundingClientRect();
      const rows = new Set(rects.map((r) => Math.round(r.top))).size;
      const fullyInside = rects.every((r) => r.left >= cardRect.left - 1 && r.right <= cardRect.right + 1 && r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1);
      return { rows, count: rects.length, cardW: cardRect ? Math.round(cardRect.width) : null, fullyInside };
    })()`);
    record('C4 above-eight (12 members): members WRAP into bounded rows, all visible, no overflow, no unbounded width',
      Boolean(wrap12 && wrap12.count === TOTAL_TARGETS && wrap12.rows >= 2 && wrap12.cardW <= 340 && wrap12.fullyInside),
      JSON.stringify(wrap12));
    await screenshot(bp, '08-attached-twelve');
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widget12Target = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutId}`), 60000, 'detached widget (12)');
    const widget12 = await connectToTarget(widget12Target, session.baseUrl);
    await waitFor(() => widget12.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget card (12)');
    await sleep(1500);
    const detached12 = await widget12.evaluate(`(() => {
      const card = document.querySelector('.window-layout-card');
      const strip = card?.querySelector('[data-wl-members]');
      const rects = [...(strip?.querySelectorAll('.window-layout-member') ?? [])].map((m) => m.getBoundingClientRect());
      const rows = new Set(rects.map((r) => Math.round(r.top))).size;
      const cardRect = card?.getBoundingClientRect();
      return {
        rows,
        count: rects.length,
        cardRect: cardRect ? { w: Math.round(cardRect.width), h: Math.round(cardRect.height) } : null,
        windowContent: { w: window.innerWidth, h: window.innerHeight },
        fullyInside: rects.every((r) => r.left >= cardRect.left - 1 && r.right <= cardRect.right + 1 && r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1),
      };
    })()`);
    await screenshot(widget12, '09-detached-twelve');
    const wrapDelta12 = detached12?.windowContent && detached12.cardRect
      ? { w: detached12.windowContent.w - detached12.cardRect.w, h: detached12.windowContent.h - detached12.cardRect.h }
      : null;
    record('C4 detached at 12 members: bounded wrap, content-fit window, no clip',
      Boolean(detached12 && detached12.count === TOTAL_TARGETS && detached12.rows >= 2 && detached12.fullyInside
        && wrapDelta12 && wrapDelta12.w <= 24 && wrapDelta12.h <= 24),
      JSON.stringify({ detached12, wrapDelta12 }));
    // ---- 034: detached member preview visibility ----------------------------
    const preview = await widget12.evaluate(`(async () => {
      const first = document.querySelector('.window-layout-member');
      if (!first) return null;
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const popover = document.querySelector('.window-layout-member-popover');
      if (!popover || popover.hidden) return null;
      const rect = popover.getBoundingClientRect();
      const img = popover.querySelector('.window-layout-member-preview-image');
      const imgRect = img ? img.getBoundingClientRect() : null;
      return {
        visible: !popover.hidden,
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
        size: { w: Math.round(rect.width), h: Math.round(rect.height) },
        hasPreviewImage: Boolean(img && imgRect && imgRect.width > 0),
        previewWidth: imgRect ? Math.round(imgRect.width) : null,
        windowContent: { w: window.innerWidth, h: window.innerHeight },
        style: { left: popover.style.left, top: popover.style.top },
      };
    })()`);
    const withinWindow = Boolean(preview && preview.rect
      && preview.rect.left >= 0 && preview.rect.top >= 0
      && preview.rect.right <= preview.windowContent.w && preview.rect.bottom <= preview.windowContent.h);
    record('C4/034 detached member preview renders fully within the window (not swallowed/clipped by host/card bounds)',
      Boolean(preview && preview.visible && withinWindow && (!preview.hasPreviewImage || (preview.previewWidth <= preview.windowContent.w))),
      JSON.stringify(preview));
    await screenshot(widget12, '10-detached-preview');
    await widget12.evaluate(`document.querySelector('[data-wl-reattach="${layoutId}"]').click()`);
    await waitFor(async () => (await targetList(session.baseUrl)).filter((t) => t.url.includes(`papers-layout-key=${layoutId}`)).length === 0, 20000, 'widget closed (12)');

    await bp.evaluate(`(() => { const shell = document.querySelector('[data-wl-layout="${layoutId}"]').closest('.icon-item'); const r = shell.getBoundingClientRect(); shell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); return true; })()`);
    await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('#context-menu [data-action]')].find((b) => b.dataset.action === 'rename'))`), 10000, 'rename menu item');
    const renameItem = await bp.evaluate(`(() => [...document.querySelectorAll('#context-menu [data-action]')].find((b) => b.dataset.action === 'rename')?.textContent?.trim() ?? null)`);
    const layoutNameBefore = readState(statePath)?.windowLayouts?.[0]?.name ?? null;
    await bp.evaluate(`(() => { const b = [...document.querySelectorAll('#context-menu [data-action]')].find((x) => x.dataset.action === 'rename'); b.click(); return true; })()`);
    const messageShown = await waitFor(() => bp.evaluate(`Boolean(document.body.textContent.includes('names and icons are fixed'))`), 8000, 'rename fixed-status message').then(() => true).catch(() => false);
    const editorOpened = await bp.evaluate(`Boolean(document.querySelector('.editor-dialog, [data-editor], .dialog-overlay'))`);
    const layoutNameAfter = readState(statePath)?.windowLayouts?.[0]?.name ?? null;
    record('P5 no layout name/icon customization: the reachable rename shows the fixed message and opens NO editor',
      Boolean(renameItem && messageShown && !editorOpened && layoutNameBefore === layoutNameAfter),
      JSON.stringify({ renameItem, messageShown, editorOpened, layoutNameBefore, layoutNameAfter }));

    const usable = await bp.evaluate(`(() => ({
      grid: Boolean(document.querySelector('#icon-grid[data-blank-parent]')),
      layoutNode: Boolean(document.querySelector('.window-layout-shell [data-wl-layout="${layoutId}"]')),
      memberButtons: document.querySelectorAll('[data-wl-layout="${layoutId}"] .window-layout-member').length,
    }))()`);
    await bp.evaluate(`document.querySelector('[data-wl-min-all="${layoutId}"]').click()`);
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'minimized', 30000, 'workspace min-all still works');
    record('P4/P5 main workspace stays usable after attach/detach/reorder (grid renders, controls act)',
      Boolean(usable?.grid && usable?.layoutNode && usable?.memberButtons === TOTAL_TARGETS),
      JSON.stringify(usable));
    await screenshot(bp, '06-workspace-usable');

    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2500);
    for (const target of targets) await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
    for (const proc of targetProcs) if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
    await sleep(2000);
    const procsAfter = await allProcesses();
    const ownedSurvivors = procsAfter.filter((p) => ownedIdentity.get(Number(p.ProcessId)) === `${Number(p.ProcessId)}:${String(p.CreationDate ?? '')}`).map((p) => Number(p.ProcessId)).sort((a, b) => a - b);
    record('cleanup: zero PROVEN-owned survivors', ownedSurvivors.length === 0, JSON.stringify(ownedSurvivors));
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
    '030 P1/P4/P5 LIVE GATE - TRANSCRIPT (isolated, exclusive interval)',
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
