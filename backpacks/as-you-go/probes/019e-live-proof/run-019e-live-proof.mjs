/**
 * 019E AUTOMATED ISOLATED LIVE PROOF (Winter, sole probe editor, PREP wave).
 *
 * Non-interactive rows only in this wave (the creator is on the shared
 * desktop): NO SetCursorPos/mouse_event/keybd_event, NO foreground stealing,
 * NO synthetic OS input. All interactions are renderer-internal CDP event
 * dispatch or native read-only/process operations on the ISOLATED instance and
 * the uniquely titled disposable targets. Rows that require the real cursor,
 * OS clicks/keys or foreground are marked EXCLUSIVE_PHYSICAL READY/NOT RUN.
 *
 * Coverage: compact widget open/reuse/close; card-only top-level bootstrap over
 * a real BroadcastChannel; workspace stays writable while the widget is open;
 * fresh snapshot/revision after a command; staged picker add/remove/Enter/
 * Escape (renderer-driven, helper-resolved); two-genuine-missing retirement
 * with a transient-helper negative control; bounded group minimize/restore
 * timing; repeat/crash recovery; forbidden persisted keys; zero owned
 * leftovers; installed creator Papers PID/data untouched.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { connectToTarget, freePort, launchPapers, sleep } from '../015r3-live-proof/cdp.mjs';
import {
  isWidgetTarget,
  widgetMatches,
  selectLiveOverlay,
  selectOverlayContaining,
  memberSetEqual,
  membersEqualWithout,
  stagedPickPassed,
  oracleSelfTest,
} from './probe-oracles.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const DISPOSABLE = path.join(LPP, 'disposable-window.ps1');
const OUT = path.join(AYG_REPO, 'probes', '019e-live-proof');
const TRANSCRIPT = path.join(OUT, 'proof-019e-transcript.txt');

const steps = [];
const notRuns = [];
let failures = 0;
function record(name, ok, detail = '') {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
}
function recordNotRun(name, reason) {
  notRuns.push({ name, reason });
  console.log(`NOT RUN - ${name} :: ${reason}`);
}
const PHYSICAL_ROWS = [
  ['P-A real pointer-following live hover', 'requires real cursor movement (exclusive interval)'],
  ['P-A real OS click/Enter/Escape delivery to the picker', 'requires real OS input (exclusive interval)'],
  ['P-A real-cursor direct pick from the widget', 'requires real OS hover+click (exclusive interval)'],
];
async function waitFor(probe, timeoutMs, label, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch (error) { lastError = error; }
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
// 019E SAFETY CORRECTION: ownership is NEVER defined by executable/script path,
// name, title or helper kind. It is the exact descendant set of the isolated
// root PID, captured while the tree is live. Cleanup may stop ONLY proven
// descendants (plus the disposable PIDs the harness launched exactly). Any
// process matching a helper pattern but NOT a descendant is FOREIGN_PRESERVED:
// observed only, never a cleanup target.
async function allProcesses() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine | ConvertTo-Json -Compress`);
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
function readMember(statePath, layoutIndex = 0) {
  return readState(statePath)?.windowLayouts?.[layoutIndex]?.arrangement?.members ?? [];
}
async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}
// ORACLE CORRECTION 3: pure target/oracle helpers live in probe-oracles.mjs
// (unit-tested without launching anything); this runner only wires them. The
// overlay resolver re-enumerates candidates per picker session and is given
// the real CDP connectTarget.
async function findLiveOverlay(baseUrl) {
  const candidates = (await targetList(baseUrl)).filter((t) => t.url.startsWith('data:text/html'));
  return selectLiveOverlay(candidates, async (candidate) => connectToTarget(candidate, baseUrl));
}

// 019HR: the overlay page converts client -> screen by adding its display
// origin (`state.display.x/y`), which equals the overlay window's screen
// geometry. Read that geometry so a picker row can (a) select the EXACT overlay
// whose screen bounds contain the target and (b) dispatch LOCAL coordinates.
async function overlayScreenBounds(client) {
  return client.evaluate(`(() => ({ x: window.screenX || 0, y: window.screenY || 0, width: window.outerWidth || 0, height: window.outerHeight || 0 }))()`);
}

/** The live overlay whose SCREEN bounds contain `point`, or null. Rejected
 * overlays are closed; the accepted client stays open. */
async function findOverlayContaining(baseUrl, point) {
  const candidates = (await targetList(baseUrl)).filter((t) => t.url.startsWith('data:text/html'));
  return selectOverlayContaining(candidates, async (candidate) => connectToTarget(candidate, baseUrl), point, overlayScreenBounds);
}

/** Latest picker state evidence retained on the overlay page (019HR): hover,
 * staged and the overlay display bounds, or nulls when no state was pushed. */
async function readOverlayEvidence(client) {
  try {
    const raw = await client.evaluate(`window.__last ? { hover: window.__last.hover, staged: window.__last.staged, display: window.__last.display } : null`);
    return raw ?? { hover: null, staged: null, display: null };
  } catch {
    return { hover: null, staged: null, display: null };
  }
}

/** True when a window-helper `powershell.exe` process exists that is a proven
 * descendant of the isolated root and NOT one of `excludedPids`. */
async function hasFreshOwnedHelper(excludedPids) {
  const procs = await allProcesses();
  const owned = await descendantPids(isolatedRoot, procs);
  return procs.some((p) => owned.has(Number(p.ProcessId)) && p.Name === 'powershell.exe'
    && !excludedPids.includes(Number(p.ProcessId)));
}

/** Native count of the exact disposable probe window titles. */
async function countProbeWindows(titles) {
  const exactTitles = JSON.stringify(titles);
  const out = await runPwsh(`. '${AYG_REPO.replace(/'/g, "''")}\\probes\\native-window\\window-capability.ps1'; $titles = ConvertFrom-Json '${exactTitles.replace(/'/g, "''")}'; @(Get-AygVisibleWindows | Where-Object { $titles -contains $_.Title }).Count`).catch(() => '-1');
  return Number(out.trim());
}

/** Like waitFor but returns the first truthy probe result. */
async function waitForValue(probe, timeoutMs, label, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (${String(lastError).slice(0, 300)})` : ''}`);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-019e-'));
const projectCopy = path.join(dataDir, 'ayg-project-copy');
const statePath = path.join(projectCopy, 'state.json');
fs.cpSync(AYG_REPO, projectCopy, {
  recursive: true,
  filter: (s) => !s.includes(`${path.sep}.git`) && !s.includes('probes') && !s.endsWith(`${path.sep}state.json`),
});
const papersData = path.join(dataDir, 'PapersData');
fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

let session = null;
const targets = [];
const targetProcs = [];
let creatorBefore = [];
let foreignHelperBefore = [];
let isolatedRoot = null;
let ownedPidsSnapshot = null;
const ownedIdentityAllowlist = new Map();

function processIdentity(process) {
  return `${Number(process.ProcessId)}:${String(process.CreationDate ?? '')}`;
}

/** Capture ownership only while the isolated root's live process tree proves
 * it. Cleanup later matches BOTH PID and CreationDate, so PID reuse can never
 * turn an old allowlist entry into authority over a foreign process. */
async function refreshOwnedIdentityAllowlist() {
  if (!isolatedRoot) return new Set();
  const processes = await allProcesses();
  const descendants = await descendantPids(isolatedRoot, processes);
  for (const process of processes) {
    const pid = Number(process.ProcessId);
    if (descendants.has(pid)) ownedIdentityAllowlist.set(pid, processIdentity(process));
  }
  return descendants;
}

function liveAllowlistedProcesses(processes) {
  return processes.filter((process) => {
    const pid = Number(process.ProcessId);
    return ownedIdentityAllowlist.get(pid) === processIdentity(process);
  });
}

async function main() {
  console.log('=== 019E LIVE PROOF (isolated, non-interactive prep wave) ===');
  // These receipts are registered before any fallible setup, so a bootstrap or
  // row failure can never accidentally imply that physical input was run.
  for (const [name, reason] of PHYSICAL_ROWS) recordNotRun(name, reason);
  fs.mkdirSync(OUT, { recursive: true });
  try {
    record('self-test: pure oracle unit assertions', oracleSelfTest(), '');
    creatorBefore = await creatorPapersPids();
    record('creator installed Papers enumerated before (observed only)', true, JSON.stringify(creatorBefore));
    const beforeProcs = await allProcesses();
    foreignHelperBefore = beforeProcs
      .filter((p) => typeof p.CommandLine === 'string' && p.CommandLine.includes('window-helper.ps1'))
      .map((p) => `${p.ProcessId}:${p.ParentProcessId}`)
      .sort();
    record('foreign helper PID+parent set captured before (observed only)', true, JSON.stringify(foreignHelperBefore));

    const positions = [[120, 140], [820, 140], [120, 620], [820, 620]];
    for (let index = 0; index < 4; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('four disposable targets launched', targets.length === 4, targets.map((t) => `${t.pid}:${t.title}`).join(' '));

    const port = await freePort();
    session = await launchPapers(dataDir, port, path.join(OUT, 'proof-019e-app.log'));
    isolatedRoot = session.proc.pid;
    ownedPidsSnapshot = await refreshOwnedIdentityAllowlist();
    record('isolated root PID captured with exact descendant set (ownership allowlist)',
      true, `root=${isolatedRoot} owned=${[...ownedPidsSnapshot].sort((a, b) => a - b).join(',')}`);
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
    async function pickFromList(layoutId, title) {
      await bp.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 60000, `row ${title}`);
      await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 30000, `member ${title}`);
    }
    async function windowCenter(title) {
      const b = await ctl(['-Title', title, '-Action', 'get-bounds']);
      return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) };
    }
    async function runRow(id, body, cleanup = null) {
      await refreshOwnedIdentityAllowlist().catch(() => undefined);
      try {
        await body();
      } catch (error) {
        record(`${id} row completed`, false, String(error).slice(0, 500));
      } finally {
        if (cleanup) {
          try { await cleanup(); }
          catch (error) { record(`${id} picker cleanup`, false, String(error).slice(0, 500)); }
        }
        await refreshOwnedIdentityAllowlist().catch(() => undefined);
      }
    }
    async function forceCancelPicker() {
      const overlay = await findLiveOverlay(session.baseUrl).catch(() => null);
      if (overlay) {
        await overlay.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))`).catch(() => undefined);
      }
      // Cancel through the same bounded production protocol used by the page.
      // This still reaches main when overlay discovery or its renderer failed.
      await bp.evaluate(`(() => new Promise((resolve, reject) => {
        const requestId = 'probe-cancel-' + Date.now() + '-' + Math.random().toString(16).slice(2);
        const timer = setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('pick cancel timeout')); }, 3000);
        function onMessage(event) {
          if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'papers:host:result' || event.data.requestId !== requestId) return;
          clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(event.data);
        }
        window.addEventListener('message', onMessage);
        window.postMessage({ type: 'papers:project:window-pick-cancel', requestId }, window.location.origin);
      }))()`);
      await bp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))`);
      await waitFor(async () => (await findLiveOverlay(session.baseUrl).catch(() => null)) === null, 5000, 'picker cleanup');
    }

    // ---- N1 seed ------------------------------------------------------------
    const layoutId = await createLayout();
    await pickFromList(layoutId, targets[0].title);
    await pickFromList(layoutId, targets[1].title);
    await pickFromList(layoutId, targets[2].title);
    await waitFor(() => readMember(statePath).length === 3, 30000, 'three stable members persisted');
    record('N1 layout with three list-picked members seeded', readMember(statePath).length === 3, layoutId);

    // ---- N2 compact widget open / reuse / close -----------------------------
    // SAFETY + CORRECTNESS: select the EXACT seeded layout's control and assert
    // exactly one match before any click; missing or duplicate is FAIL.
    const detachCount = await bp.evaluate(`document.querySelectorAll('[data-wl-detach="${layoutId}"]').length`);
    if (detachCount !== 1) {
      record('N2 exactly one card Detach control for the seeded layout', false, `matches=${detachCount}`);
    } else {
      await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    }
    await waitFor(async () => widgetMatches(await targetList(session.baseUrl), layoutId).length === 1, 60000, 'exactly one compact widget target');
    const widgets = widgetMatches(await targetList(session.baseUrl), layoutId);
    const widget = widgets[0] ?? null;
    record('N2 compact widget opened via card control (exactly one matching target)',
      widgets.length === 1, widget ? widget.url.slice(0, 120) : 'none');
    // Reuse: clicking the card control again must reuse/focus, not duplicate.
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    await sleep(1500);
    const widgetsAfterReuse = widgetMatches(await targetList(session.baseUrl), layoutId);
    record('N2 widget reuse does not create a duplicate target', widgetsAfterReuse.length === 1,
      `count=${widgetsAfterReuse.length} urls=${widgetsAfterReuse.map((t) => t.url.slice(-70)).join('|')}`);

    // ---- N3 card-only bootstrap over real BroadcastChannel -------------------
    const widgetClient = await connectToTarget(widget, session.baseUrl);
    await waitFor(() => widgetClient.evaluate(`Boolean(document.querySelector('.window-layout-widget-root'))`), 60000, 'widget card rendered');
    record('N3 widget page carries the compact-widget root before any widget action',
      await widgetClient.evaluate(`Boolean(document.querySelector('.window-layout-widget-root'))`), '');
    const cardState = await widgetClient.evaluate(`(() => ({
      root: Boolean(document.querySelector('.window-layout-widget-root')),
      memberButtons: document.querySelectorAll('.window-layout-widget-root [data-wl-member]').length,
    }))()`);
    record('N3 widget card-only bootstrap over the real BroadcastChannel',
      cardState.root === true && cardState.memberButtons === 3, JSON.stringify(cardState));
    await screenshot(widgetClient, 'N3-widget-card');

    // ---- N4 workspace remains writable while the widget is open --------------
    let minAllOk = true;
    let restoreAllOk = true;
    try {
      await bp.evaluate(`document.querySelector('[data-wl-min-all]').click()`);
      await waitFor(async () => {
        const a = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
        const b = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
        return a.state === 'minimized' && b.state === 'minimized';
      }, 30000, 'workspace minimize-all applied while widget open');
    } catch { minAllOk = false; }
    try {
      await bp.evaluate(`document.querySelector('[data-wl-restore-all]').click()`);
      await waitFor(async () => {
        const a = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
        const b = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
        return a.state === 'normal' && b.state === 'normal';
      }, 30000, 'workspace restore-all applied while widget open');
    } catch { restoreAllOk = false; }
    record('N4 workspace stays writable while the widget is open', minAllOk && restoreAllOk, `minimize=${minAllOk} restore=${restoreAllOk}`);

    // ---- N5 fresh snapshot/revision after a workspace command ----------------
    await sleep(1500);
    const widgetRevisionAfter = await widgetClient.evaluate(`(() => { const n = [...document.querySelectorAll('.window-layout-widget-root [data-wl-member]')].length; return { n }; })()`);
    record('N5 widget card reflects the persisted snapshot (3 members) after commands',
      widgetRevisionAfter.n === 3, JSON.stringify(widgetRevisionAfter));

    // ---- N6 staged picker add / remove / Enter / Escape (renderer-driven) ----
    // Begin a pick from the workspace; drive the OVERLAY page with
    // renderer-internal events (mousemove/click/Enter/Escape). The candidate
    // resolution uses the helper hover at a disposable target's centre (a
    // native, non-input call). No OS cursor/key is touched.
    // 019HR: the overlay page converts client -> screen by adding its display
    // origin, so a row must select the EXACT overlay whose screen bounds
    // contain the target and dispatch LOCAL coordinates
    // (targetScreen - overlayOrigin). The row also WAITS for the exact blue/red
    // hover and the exact staged state before Enter/Escape, and on failure
    // retains display/local/screen/hover/staged evidence.
    async function driveStagedPick(point, expectedKind, afterStaged) {
      const found = await waitForValue(
        async () => findOverlayContaining(session.baseUrl, point),
        15000,
        `live overlay containing ${JSON.stringify(point)}`,
      );
      if (!found) throw new Error(`no live pick overlay contains ${JSON.stringify(point)}`);
      const { client: overlayClient, bounds } = found;
      const local = { x: point.x - bounds.x, y: point.y - bounds.y };
      const evidence = { display: bounds, screenPoint: point, local, hover: null, staged: null };
      try {
        await overlayClient.evaluate(`(() => { window.__last = null; window.pickOverlay.onState((s) => { window.__last = s; }); return true; })()`);
        await overlayClient.evaluate(`window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ${local.x}, clientY: ${local.y} }))`);
        // WAIT/ASSERT the exact hover: kind matches and the hovered window's
        // bounds contain the target screen point.
        evidence.hover = await waitForValue(async () => {
          const hover = await overlayClient.evaluate(`window.__last ? window.__last.hover : null`).catch(() => null);
          return hover && hover.kind === expectedKind
            && hover.x <= point.x && point.x < hover.x + hover.width
            && hover.y <= point.y && point.y < hover.y + hover.height
            ? hover : null;
        }, 10000, `exact ${expectedKind} hover on the target`);
        await overlayClient.evaluate(`window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ${local.x}, clientY: ${local.y} }))`);
        // WAIT/ASSERT the exact staged marker (blue add / red remove).
        evidence.staged = await waitForValue(async () => {
          const staged = await overlayClient.evaluate(`window.__last ? window.__last.staged : null`).catch(() => null);
          return Array.isArray(staged) && staged.length === 1 && staged[0].kind === expectedKind ? staged : null;
        }, 10000, `exact staged ${expectedKind} marker`);
        await afterStaged(overlayClient, local);
      } catch (error) {
        const latest = await readOverlayEvidence(overlayClient).catch(() => null);
        evidence.hover = evidence.hover ?? latest?.hover ?? null;
        evidence.staged = evidence.staged ?? latest?.staged ?? null;
        evidence.error = String(error);
      }
      return evidence;
    }

    await runRow('N6a', async () => {
      const fourthCenter = await windowCenter(targets[3].title);
      await bp.evaluate(`document.querySelector('[data-wl-pick]').click()`);
      const evidence = await driveStagedPick(fourthCenter, 'add', async (overlayClient) => {
        await overlayClient.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))`);
        await waitFor(() => readMember(statePath).length === 4, 30000, 'staged add committed');
      });
      const committed = readMember(statePath).length === 4;
      // 019HR2: PASS requires the exact add hover/staged evidence AND no
      // swallowed error AND the commit - never a bare members-count check.
      record('N6a staged picker: exact-overlay local mousemove+click+Enter added the fourth member (renderer-driven)',
        stagedPickPassed({ evidence, expectedKind: 'add', committed }),
        JSON.stringify({ ...evidence, committedMembers: readMember(statePath).map((m) => m.descriptor.title) }));
    }, forceCancelPicker);

    await runRow('N6b', async () => {
      // Always stage removal of seeded target0, so this row remains meaningful
      // and byte-zero even when N6a never added target3.
      const seededCenter = await windowCenter(targets[0].title);
      const beforeEscape = fs.readFileSync(statePath, 'utf8');
      await bp.evaluate(`document.querySelector('[data-wl-pick]').click()`);
      const evidence = await driveStagedPick(seededCenter, 'remove', async (overlayClient, local) => {
        await overlayClient.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))`);
        await sleep(500);
      });
      const afterEscape = fs.readFileSync(statePath, 'utf8');
      const byteZero = afterEscape === beforeEscape;
      // 019HR2: byte-zero alone must NOT pass a cancel row that never proved a
      // red removal stage; PASS requires the exact remove hover/staged evidence
      // AND no swallowed error AND byte-zero.
      record('N6b staged seeded-member removal Escape cancels byte-zero (exact red removal stage proven)',
        stagedPickPassed({ evidence, expectedKind: 'remove', byteZero }),
        JSON.stringify({ ...evidence, members: readMember(statePath).length, byteZero }));
    }, forceCancelPicker);

    // ---- N8 bounded group minimize/restore timing (measured) --------------
    // 019HR: N8 runs BEFORE the destructive N7 row, with a persisted-member
    // preflight and typed/native evidence, so retirement can never contaminate
    // its verdict.
    await runRow('N8', async () => {
      const preflight = readMember(statePath);
      const aPresent = preflight.some((m) => m.descriptor.title === targets[0].title);
      const cPresent = preflight.some((m) => m.descriptor.title === targets[2].title);
      record('N8 persisted-member preflight before the group timing (A and C present)',
        aPresent && cPresent, JSON.stringify(preflight.map((m) => m.descriptor.title)));
      // 019HR2: a failed preflight must THROW (after the record) so the timing
      // result can never appear independently PASS from contaminated inputs.
      if (!(aPresent && cPresent)) {
        throw new Error('N8 preflight failed: A or C are not persisted members before the group timing');
      }
      const t0 = Date.now();
      await bp.evaluate(`document.querySelector('[data-wl-min-all]').click()`);
      await waitFor(async () => {
        const a = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
        const c = await ctl(['-Title', targets[2].title, '-Action', 'get-state']);
        return a.state === 'minimized' && c.state === 'minimized';
      }, 30000, 'minimize-all completed');
      const minMs = Date.now() - t0;
      const t1 = Date.now();
      await bp.evaluate(`document.querySelector('[data-wl-restore-all]').click()`);
      await waitFor(async () => {
        const a = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
        const c = await ctl(['-Title', targets[2].title, '-Action', 'get-state']);
        return a.state === 'normal' && c.state === 'normal';
      }, 30000, 'restore-all completed');
      const restoreMs = Date.now() - t1;
      // Typed evidence: the persisted member set is unchanged by the group op.
      const postflight = readMember(statePath).map((m) => m.descriptor.title);
      const setUnchanged = JSON.stringify(preflight.map((m) => m.descriptor.title)) === JSON.stringify(postflight);
      record('N8 group minimize/restore timing measured (native + typed evidence)',
        setUnchanged && aPresent && cPresent,
        `minimize=${minMs}ms restore=${restoreMs}ms preflight=${JSON.stringify(preflight.map((m) => m.descriptor.title))} postflight=${JSON.stringify(postflight)}`);
    });

    // ---- N7 two-genuine-missing retirement + transient-helper negative -------
    // 019HR strengthened: kill ONLY the PROVEN descendant helper; wait through
    // >2 observe cadence cycles AND recovery (a fresh owned helper process
    // restarted, stale tokens re-resolved); assert EVERY still-live member
    // remains; then close EXACTLY B and require exactly the PRE-KILL member set
    // minus B (row-independent: never assumes D absent or present).
    await runRow('N7', async () => {
      const memberBTitle = targets[1].title;
      const preKillMembers = readMember(statePath).map((m) => m.descriptor.title);
      if (preKillMembers.length === 0) throw new Error('no persisted members before the helper kill');
      // Ensure the member card for B exists (an implicit live-render check).
      const clicked = await bp.evaluate(`(() => { const b = [...document.querySelectorAll('.window-layout-shell [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(memberBTitle.slice(0, 12))})); if (!b) return false; b.click(); return true; })()`);
      if (!clicked) throw new Error('member card for B was not rendered');
      await sleep(500);
      const procsNow = await allProcesses();
      const ownedNow = await descendantPids(isolatedRoot, procsNow);
      const ownedHelpers = procsNow.filter((p) => ownedNow.has(Number(p.ProcessId)) && p.Name === 'powershell.exe');
      const ownedHelperPidsBefore = ownedHelpers.map((p) => Number(p.ProcessId)).sort();
      record('N7 isolated-owned helper enumerated by descendant ownership', ownedHelperPidsBefore.length >= 1, JSON.stringify(ownedHelperPidsBefore));
      for (const helper of ownedHelpers) {
        if (ownedIdentityAllowlist.get(Number(helper.ProcessId)) === processIdentity(helper)) {
          await runPwsh(`Stop-Process -Id ${Number(helper.ProcessId)} -Force -ErrorAction SilentlyContinue`);
        }
      }
      // Wait >2 observe cadence cycles (cadence = 500 ms) with the helper down,
      // so the outage would have triggered stale-token misses.
      await sleep(2500);
      const duringOutage = readMember(statePath);
      record('N7 transient helper outage keeps EXACTLY the pre-kill member set (negative control, descendant-only kill)',
        memberSetEqual(preKillMembers, duringOutage.map((m) => m.descriptor.title)),
        JSON.stringify(duringOutage.map((m) => m.descriptor.title)));
      // Recovery: the factory restarts a FRESH owned helper; wait through the
      // restart AND more cadence cycles so stale capabilities re-resolve.
      const restarted = await waitForValue(
        () => hasFreshOwnedHelper(ownedHelperPidsBefore).catch(() => false),
        20000,
        'owned helper restarted after the outage',
      );
      record('N7 owned helper restarted after the outage (recovery path)', Boolean(restarted), `excluded=${JSON.stringify(ownedHelperPidsBefore)}`);
      await sleep(2500); // >2 more cadence cycles for re-resolution + recovery
      const afterRecovery = readMember(statePath);
      record('N7 after recovery the persisted set is EXACTLY the pre-kill set (no member missing, none added)',
        memberSetEqual(preKillMembers, afterRecovery.map((m) => m.descriptor.title)),
        JSON.stringify(afterRecovery.map((m) => m.descriptor.title)));
      // Close EXACTLY B; the persisted set must become exactly PRE-KILL minus B.
      await ctl(['-Title', memberBTitle, '-Action', 'close']);
      await waitFor(async () => !readMember(statePath).some((m) => m.descriptor.title === memberBTitle), 90000, 'member B removed after two genuine missing observations');
      const afterClose = readMember(statePath).map((m) => m.descriptor.title);
      const exactlyMinusB = membersEqualWithout(preKillMembers, memberBTitle, afterClose);
      record('N7 exactly B retired once; every other pre-kill member remains',
        exactlyMinusB,
        JSON.stringify({ preKill: preKillMembers, closed: memberBTitle, after: afterClose }));
    });

    // ---- N9 repeat / crash recovery ------------------------------------------
    await runRow('N9', async () => {
      await sleep(1500);
      const widgetStillOpen = widgetMatches(await targetList(session.baseUrl), layoutId)[0] ?? null;
      record('N9 widget still open after the picker/retirement/group rows', Boolean(widgetStillOpen), '');
      if (!widgetStillOpen) throw new Error('widget target missing before crash recovery');
      const widgetClient2 = await connectToTarget(widgetStillOpen, session.baseUrl);
      await widgetClient2.send('Page.crash').catch(() => undefined);
      await waitFor(async () => {
        const list = await targetList(session.baseUrl);
        return !list.some((t) => isWidgetTarget(t, layoutId));
      }, 30000, 'crashed widget target gone');
      await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
      await waitFor(async () => widgetMatches(await targetList(session.baseUrl), layoutId).length === 1, 60000, 'widget reopened after crash');
      record('N9 widget crash leaves the workspace unaffected and reopens',
        widgetMatches(await targetList(session.baseUrl), layoutId).length === 1, '');
    });

    // ---- N10 forbidden persisted keys ----------------------------------------
    await runRow('N10', async () => {
      const rawState = fs.readFileSync(statePath, 'utf8');
      const forbidden = ['runtimeId', 'hwnd', 'token', 'bindingId', 'processId', 'processPath', 'candidate'];
      const hits = forbidden.filter((key) => rawState.includes(`"${key}"`));
      record('N10 no forbidden persisted keys in state.json', hits.length === 0, JSON.stringify(hits));
    });

    // ---- N11 cleanup + creator untouched + FOREIGN_PRESERVED receipt ---------
    await refreshOwnedIdentityAllowlist();
    const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2500);
    // 019HR: close and WAIT for the EXACT disposable targets BEFORE the
    // zero-window receipt, so the receipt observes a clean desktop (the
    // finally block below stays as a redundant safety oracle).
    const disposableTitles = targets.map((target) => target.title);
    for (const target of targets) {
      await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
    }
    await waitFor(async () => (await countProbeWindows(disposableTitles)) === 0, 15000, 'exact disposable targets closed');
    for (const proc of targetProcs) {
      if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
    }
    await sleep(1500);
    const procsAfter = await allProcesses();
    const ownedSurvivorProcesses = liveAllowlistedProcesses(procsAfter);
    const ownedSurvivors = ownedSurvivorProcesses.map((process) => Number(process.ProcessId)).sort((a, b) => a - b);
    const ownedSurvivorPids = new Set(ownedSurvivors);
    record('N11 shutdown: zero PROVEN-owned survivors (PID+CreationDate allowlist only)',
      ownedSurvivors.length === 0, JSON.stringify(ownedSurvivors));
    // FOREIGN_PRESERVED: any process whose command line matches a helper pattern
    // but whose parent is NOT the isolated root is observed-only and preserved.
    const foreignHelpersAfter = procsAfter
      .filter((p) => typeof p.CommandLine === 'string' && p.CommandLine.includes('window-helper.ps1'))
      .filter((p) => !ownedSurvivorPids.has(Number(p.ProcessId)))
      .map((p) => `${p.ProcessId}:${p.ParentProcessId}`)
      .sort();
    record('FOREIGN_PRESERVED helper PID+parent set unchanged (observed only, never stopped)',
      JSON.stringify(foreignHelperBefore) === JSON.stringify(foreignHelpersAfter),
      `before=${JSON.stringify(foreignHelperBefore)} after=${JSON.stringify(foreignHelpersAfter)}`);
    const aygWindowsCount = await countProbeWindows(disposableTitles);
    record('N11 shutdown: zero exact probe disposable windows', aygWindowsCount === 0, String(aygWindowsCount));
    const creatorAfter = await creatorPapersPids();
    record('N11 creator installed Papers PIDs untouched (exact set equality)',
      JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);

  } catch (error) {
    record('harness step', false, String(error).slice(0, 500));
  } finally {
    try {
      // Last live-tree capture occurs BEFORE the root is asked to exit. Later
      // cleanup is authorized only by this PID+CreationDate allowlist.
      if (session) await refreshOwnedIdentityAllowlist().catch(() => undefined);
      if (session) {
        const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
        await closeApp(session.proc, session.baseUrl).catch(() => undefined);
        session = null;
      }
      for (const t of targets) await ctl(['-Title', t.title, '-Action', 'close']).catch(() => undefined);
      for (const proc of targetProcs) {
        if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
      }
      await sleep(2000);
      const processes = await allProcesses().catch(() => []);
      const ownedSurvivors = liveAllowlistedProcesses(processes).sort((a, b) => Number(a.ProcessId) - Number(b.ProcessId));
      for (const process of ownedSurvivors) {
        await runPwsh(`Stop-Process -Id ${Number(process.ProcessId)} -Force -ErrorAction SilentlyContinue`).catch(() => undefined);
      }
      await sleep(1000);
      const ownedLeft = liveAllowlistedProcesses(await allProcesses().catch(() => []))
        .map((process) => Number(process.ProcessId)).sort((a, b) => a - b);
      record('cleanup: zero PROVEN-owned survivors', ownedLeft.length === 0, JSON.stringify(ownedLeft));
      const windows = await countProbeWindows(targets.map((target) => target.title));
      record('cleanup: zero exact probe windows remain', windows === 0, String(windows));
      const creatorAfter = await creatorPapersPids().catch(() => []);
      record('creator installed Papers untouched after run', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
      const fpAfter = await allProcesses().catch(() => []);
      const foreignAfter = fpAfter
        .filter((p) => typeof p.CommandLine === 'string' && p.CommandLine.includes('window-helper.ps1'))
        .map((p) => `${p.ProcessId}:${p.ParentProcessId}`)
        .sort();
      record('foreign helper PID+parent set preserved after run (exact equality, never stopped)',
        JSON.stringify(foreignHelperBefore) === JSON.stringify(foreignAfter),
        `before=${JSON.stringify(foreignHelperBefore)} after=${JSON.stringify(foreignAfter)}`);
    } catch (error) {
      record('cleanup completed without harness exception', false, String(error).slice(0, 500));
    }
  }
  const passed = steps.length - failures;
  const transcript = [
    '019E LIVE PROOF - TRANSCRIPT (non-interactive prep wave)',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `creator Papers pids before: ${JSON.stringify(creatorBefore)}`,
    '',
    ...steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} - ${s.name}${s.detail ? ` :: ${s.detail}` : ''}`),
    '',
    ...notRuns.map((n) => `NOT RUN - ${n.name} :: ${n.reason}`),
    '',
    `FINAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed; ${notRuns.length} rows NOT RUN (exclusive-physical).`,
  ].join('\r\n');
  fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
  fs.writeFileSync(TRANSCRIPT, `${transcript}\r\n`);
  console.log(`\n=== SUMMARY: ${passed}/${steps.length} passed, ${failures} failed; ${notRuns.length} NOT RUN ===`);
  if (failures > 0) process.exitCode = 1;
}

async function screenshot(client, name) {
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      const dir = path.join(OUT, 'shots');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
  } catch { /* best-effort */ }
}

// ORACLE CORRECTION 3: importing this module must NOT launch the probe. main()
// runs only when this file is the direct entry.
const isDirectEntry = typeof process !== 'undefined'
  && process.argv?.[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) {
  main();
}
