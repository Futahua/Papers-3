import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import crypto from 'node:crypto';
import { connectToTarget, freePort, launchPapers, sleep, closeApp } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const PAPERS_REPO = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3';
const ELECTRON = path.join(PAPERS_REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const AHK = 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe';
const AHK_SCRIPT = 'D:\\333\\SlopTop\\sloptop_engine.ahk';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const INPUT = path.join(AYG_REPO, 'probes', '045-ahk-bridge', 'native-input.ps1');
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PORT = 38473;
const SHARED_RECEIPTS = 'C:\\Users\\Public\\Documents\\PapersNativeBridgeReceipts';
const ELEVATED_TASK = 'PapersNativeAhkBridge';
const BROKER_REQUEST = 'D:\\Programs\\CodexBrainB\\elevated-ahk-request.json';
const BROKER_RESULT = 'D:\\Programs\\CodexBrainB\\elevated-ahk-result.json';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-086-ownership-'));
const projectCopy = path.join(dataDir, 'ayg-project-copy');
const statePath = path.join(projectCopy, 'state.json');
const artifacts = path.join(dataDir, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(SHARED_RECEIPTS, { recursive: true });
fs.cpSync(AYG_REPO, projectCopy, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}probes`) && !source.endsWith(`${path.sep}state.json`) });
const papersData = path.join(dataDir, 'PapersData');
fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

const steps = [];
const targets = [];
let papers = null;
let ahk = null;
let elevatedChildPid = null;
let runToken = null;
let sharedTrace = null;
let requiredFailure = false;
function record(name, ok, detail = '', required = true) { steps.push({ name, ok: Boolean(ok), detail }); if (!ok && required) requiredFailure = true; console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`); }
function ahkProcesses() {
  const command = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'AutoHotkey' } | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`;
  return new Promise((resolve, reject) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(String(c)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error('AHK inventory failed')); return; }
      const raw = chunks.join('').trim();
      if (!raw) { resolve([]); return; }
      resolve(raw.startsWith('[') ? JSON.parse(raw) : [JSON.parse(raw)]);
    });
  });
}
async function processAlive(pid) {
  if (!pid) return false;
  const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let alive = '';
  child.stdout.on('data', (c) => alive += String(c));
  await new Promise((resolve) => child.on('close', resolve));
  return alive.trim().toLowerCase().startsWith('true');
}
async function stopPid(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true, stdio: 'ignore' });
    child.on('close', resolve);
  });
}
async function stopPidElevated(pid) {
  if (!pid) return;
  await elevatedBroker({ operation: 'stop', pid });
}
async function elevatedBroker(payload) {
  const requestId = crypto.randomUUID();
  fs.rmSync(BROKER_RESULT, { force: true });
  fs.writeFileSync(BROKER_REQUEST, JSON.stringify({ ...payload, requestId }, null, 2));
  await new Promise((resolve, reject) => {
    const task = spawn('C:\\Windows\\System32\\schtasks.exe', ['/Run', '/TN', ELEVATED_TASK], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = []; task.stdout.on('data', c => output.push(String(c))); task.stderr.on('data', c => output.push(String(c)));
    task.on('error', reject); task.on('close', code => code === 0 ? resolve() : reject(new Error(`elevated broker task failed: ${output.join('')}`)));
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (fs.existsSync(BROKER_RESULT)) {
      const result = JSON.parse(fs.readFileSync(BROKER_RESULT, 'utf8'));
      if (result.requestId === requestId) {
        if (!result.ok) throw new Error(`elevated broker rejected ${payload.operation}: ${result.error}`);
        return result;
      }
    }
    await sleep(100);
  }
  throw new Error(`elevated broker timed out for ${payload.operation}`);
}
function pwsh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', INPUT, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = []; child.stdout.on('data', (c) => output.push(String(c))); child.stderr.on('data', (c) => output.push(String(c)));
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.join('').trim()) : reject(new Error(output.join('').trim())));
  });
}
function launchElevatedAkh(args) {
  return elevatedBroker({ operation: 'launch', arguments: args }).then((result) => ({ launcher: null, pid: Number(result.pid) }));
}
async function input(action, ...args) { return JSON.parse(await pwsh(['-Action', action, ...args])); }
async function movePhysical(x, y) {
  const direct = await input('move', '-X', String(x), '-Y', String(y));
  if (direct.ok) return { method: 'SetCursorPos', ...direct };
  const fallback = await input('sendinput-move', '-X', String(x), '-Y', String(y));
  return { method: 'SendInput', direct, ...fallback };
}
async function dragPhysical(x, y, x2, y2, steps = 16) {
  return input('drag', '-X', String(x), '-Y', String(y), '-X2', String(x2), '-Y2', String(y2), '-Steps', String(steps));
}
async function releaseLeftButton(label) {
  const released = JSON.parse(await pwsh(['-Action', 'left-up']));
  const keys = JSON.parse(await pwsh(['-Action', 'key-state']));
  const ok = !keys.lButton;
  record(`${label} left button released (lButton false)`, ok, JSON.stringify({ released, keys }));
  return ok;
}
async function interlockedReleaseLeftButton(label) {
  // The AHK *LButton hotkey (gate: pickerActive && Ctrl && Shift && !Space && !Alt && !IsMouseOverCSP)
  // consumes injected DOWN and UP while active. Release Ctrl+Shift first so the #HotIf gate
  // deactivates, then send LEFTUP (not consumed), verify lButton false, then re-press Ctrl+Shift.
  await input('ctrl-shift-up');
  await sleep(120);
  const released = JSON.parse(await pwsh(['-Action', 'left-up']));
  await sleep(120);
  const keysUp = JSON.parse(await pwsh(['-Action', 'key-state']));
  await input('ctrl-shift-down');
  await sleep(120);
  const keysDown = JSON.parse(await pwsh(['-Action', 'key-state']));
  const ok = !keysUp.lButton && !keysDown.lButton && keysDown.ctrl && keysDown.shift;
  record(`${label} interlocked release (Ctrl+Shift up -> LEFTUP -> lButton false -> Ctrl+Shift down)`, ok, JSON.stringify({ released, keysUp, keysDown }));
  return ok;
}

async function osWindowAtPoint(x, y, papersHwnd) {
  const at = JSON.parse(await pwsh(['-Action', 'window-at-point', '-X', String(x), '-Y', String(y)]));
  const matches = String(at.hwnd) === String(papersHwnd);
  return { at, matches, papersHwnd, x, y };
}
async function assertActivationPoint(bp, label) {
  const focus = JSON.parse(await pwsh(['-Action', 'focus-process', '-ProcessId', String(papers.proc.pid)]));
  const focused = focus.ok === true && String(focus.foreground) === String(focus.hwnd);
  await sleep(200);
  let pickReady = null;
  try {
    await waitFor(async () => {
      const f = await freshPickPoint(bp);
      return Boolean(f.pick && f.pick.attached && f.pick.hitClosest === f.pick.wlPick && !f.pick.disabled);
    }, 15000);
    pickReady = await freshPickPoint(bp);
  } catch { pickReady = await freshPickPoint(bp); }
  const pt = pickReady.point;
  const papersPid = String(focus.processId ?? papers.proc.pid ?? '');
  const papersHwnd = String(focus.hwnd ?? focus.foreground ?? '');
  const os = pt ? await osWindowAtPoint(pt.x, pt.y, papersHwnd) : null;
  const osMatches = Boolean(os && (String(os.at.processId) === papersPid || String(os.at.hwnd) === papersHwnd));
  const ok = Boolean(focused && pt && pickReady.pick && pickReady.pick.attached && pickReady.pick.hitClosest === pickReady.pick.wlPick && !pickReady.pick.disabled && osMatches);
  record(`${label} OS activation point is Papers (PID or hwnd)`, ok, JSON.stringify({ focused, papersPid, papersHwnd, pickReady, os, osMatches }));
  return ok ? pt : null;
}
async function waitFor(fn, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw new Error('timeout'); }
async function json(url, options) { return await (await fetch(url, options)).json(); }
async function helloState() {
  try { const last = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`); return last; } catch { return null; }
}
async function waitForHello(timeout = 6000) {
  const started = performance.now();
  let last = null;
  await waitFor(async () => {
    try {
      last = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
      return last?.active === true && typeof last.token === 'string' && last.token.length > 0;
    } catch { return false; }
  }, timeout);
  return { hello: last, elapsedMs: performance.now() - started };
}
async function waitForHelloInactive(timeout = 10000) {
  const started = performance.now();
  let last = null;
  await waitFor(async () => {
    last = await helloState();
    return last === null || last.active !== true;
  }, timeout);
  return { last, elapsedMs: performance.now() - started };
}
async function modifierSnapshot() {
  const snapshot = JSON.parse(await pwsh(['-Action', 'snapshot']));
  const state = await helloState();
  return { snapshot, pickerActive: state?.active === true, token: state?.token ?? null };
}
function traceLines(trace) { return trace ? trace.split(/\r?\n/).filter(Boolean) : []; }
function responseOf(line) {
  const i = line.indexOf('response=');
  if (i < 0) return null;
  try { return JSON.parse(line.slice(i + 'response='.length)); } catch { return null; }
}
async function waitForTraceResponse(predicate, minLine = 0, timeout = 15000) {
  const started = performance.now();
  let result = null;
  await waitFor(async () => {
    const lines = traceLines(await readSharedTrace());
    let found = null;
    for (let i = minLine; i < lines.length; i += 1) if (predicate(lines[i])) found = lines[i];
    if (!found) return false;
    result = { line: found, response: responseOf(found) };
    return Boolean(result.response);
  }, timeout);
  return result;
}
function hasVisual(response, kind, x, y) {
  return Boolean((response?.visuals ?? []).some((v) => v.kind === kind && Math.round(v.x) === x && Math.round(v.y) === y));
}
async function captureClickState(x, y) {
  return {
    trace: await readSharedTrace(),
    keys: JSON.parse(await pwsh(['-Action', 'key-state'])),
    hello: await helloState(),
    cursor: JSON.parse(await pwsh(['-Action', 'snapshot'])),
    osAtPoint: JSON.parse(await pwsh(['-Action', 'window-at-point', '-X', String(x), '-Y', String(y)])),
  };
}
async function capturePostClickState(pre, x, y, pollMs = 3000) {
  const started = performance.now();
  let post = await captureClickState(x, y);
  while (post.trace.length <= pre.trace.length && performance.now() - started < pollMs) {
    await sleep(200);
    post = await captureClickState(x, y);
  }
  return post;
}
function traceDelta(preTrace, postTrace) {
  const preSet = new Set(traceLines(preTrace));
  return traceLines(postTrace).filter((l) => !preSet.has(l));
}
async function waitForVisuals(predicate, timeout = 15000) {
  const started = performance.now();
  let last = null;
  await waitFor(async () => {
    last = await helloState();
    return last?.state?.visuals ? predicate(last.state.visuals) : false;
  }, timeout);
  return { state: last, elapsedMs: performance.now() - started };
}
function distinctGeometries(visuals, kind) {
  const seen = new Set();
  for (const v of (visuals ?? []).filter((item) => item.kind === kind)) {
    seen.add(`${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.width)},${Math.round(v.height)}`);
  }
  return [...seen].map((sig) => { const p = sig.split(','); return { x: Number(p[0]), y: Number(p[1]), width: Number(p[2]), height: Number(p[3]) }; });
}
const isBounded = (v) => Math.round(v.width) > 10 && Math.round(v.height) > 10 && Math.round(v.width) < 1900 && Math.round(v.height) < 1000;
async function readSharedTrace() { return fs.existsSync(sharedTrace) ? fs.readFileSync(sharedTrace, 'utf8') : ''; }
async function waitForTraceContains(pattern, timeout = 15000) {
  const started = performance.now();
  await waitFor(async () => (await readSharedTrace()).includes(pattern), timeout);
  return (await readSharedTrace()).includes(pattern);
}
async function browserTarget(base, predicate, timeout = 90000) { let result; await waitFor(async () => { try { result = (await (await fetch(`${base}/json/list`)).json()).find(predicate); return Boolean(result); } catch { return false; } }, timeout); return result; }
async function launchTarget(index, x, y) {
  const script = path.join(AYG_REPO, 'probes', '015r3-live-proof', 'disposable-window.ps1');
  const marker = path.join(artifacts, `target-${index}.json`);
  const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', script, '-MarkerPath', marker, '-X', String(x), '-Y', String(y)], { windowsHide: false, stdio: 'ignore' });
  await waitFor(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes('title'), 30000);
  const info = JSON.parse(fs.readFileSync(marker, 'utf8')); targets.push({ ...info, child });
}
async function installHostTap(bp) {
  await bp.evaluate(`(() => {
    window.__aygSaveLog = window.__aygSaveLog || [];
    const origPost = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (msg, origin) => {
      if (msg && typeof msg === 'object' && msg.type === 'papers:project:as-you-go-save') {
        window.__aygSaveLog.push({ direction: 'out', type: msg.type, requestId: msg.requestId, at: Date.now() });
      }
      return origPost(msg, origin);
    };
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && typeof data === 'object' && data.type === 'papers:host:result' && typeof data.requestId === 'string') {
        window.__aygSaveLog.push({ direction: 'in', requestId: data.requestId, ok: data.ok === true, error: data.error ?? null, at: Date.now() });
      }
    });
    return true;
  })()`);
}
async function captureSaveLog(bp) {
  return JSON.parse(await bp.evaluate(`JSON.stringify(window.__aygSaveLog ?? [])`));
}
async function renderedMemberOrder(bp, layoutId) {
  return JSON.parse(await bp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-wl-members="${layoutId}"] [data-wl-member]')].map((b) => b.dataset.wlMember))`));
}
async function persistedMemberOrder() {
  const raw = fs.readFileSync(statePath, 'utf8');
  const parsed = JSON.parse(raw);
  const members = (parsed.windowLayouts ?? []).flatMap((l) => (l.arrangement?.members ?? []).map((m) => m.id));
  return { file: raw, order: members, layouts: (parsed.windowLayouts ?? []).length };
}
async function memberButtonPoint(bp, layoutId, memberId) {
  return await bp.evaluate(`(() => {
    const button = document.querySelector('[data-wl-members="${layoutId}"] [data-wl-member="${memberId}"]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  })()`);
}
async function freshPickPoint(bp) {
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-wl-pick]'))`), 15000);
  const pick = await bp.evaluate(`(() => {
    const button = document.querySelector('[data-wl-pick]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true' || button.closest('[aria-disabled="true"]') !== null;
    const element = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const closest = element?.closest?.('[data-wl-pick]');
    return { rect: rect.toJSON(), disabled, hitClosest: closest?.dataset?.wlPick ?? null, wlPick: button.dataset?.wlPick ?? null, attached: document.contains(button) };
  })()`);
  const screen = await bp.evaluate(`(() => ({ x: window.screenX, y: window.screenY, chromeY: Math.max(0, window.outerHeight - window.innerHeight) }))()`);
  const point = pick ? { x: Math.round(screen.x + pick.rect.x + pick.rect.width / 2), y: Math.round(screen.y + screen.chromeY + pick.rect.y + pick.rect.height / 2) } : null;
  return { pick, screen, point };
}
async function screenOf(bp, clientX, clientY) {
  const screen = await bp.evaluate(`(() => ({ x: window.screenX, y: window.screenY, chromeY: Math.max(0, window.outerHeight - window.innerHeight) }))()`);
  return { x: Math.round(screen.x + clientX), y: Math.round(screen.y + screen.chromeY + clientY) };
}
async function preRunVerifiedClean() {
  const noAhk = (await ahkProcesses().catch(() => [])).length === 0;
  const noElectron = await new Promise((resolve) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron' } | Measure-Object).Count`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', (c) => out += String(c)); child.on('close', () => resolve(out.trim() === '0'));
  });
  const portFree = await new Promise((resolve) => {
    const child = spawn('C:\\Windows\\System32\\netstat.exe', ['-ano'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', (c) => out += String(c)); child.on('close', () => resolve(!/:38473\s+.*LISTENING/i.test(out)));
  });
  const sharedOnly = (() => { try { const entries = fs.readdirSync(SHARED_RECEIPTS).filter((n) => n !== 'README.txt'); return entries.length === 0; } catch { return false; } })();
  return { noAhk, noElectron, portFree, sharedOnly, ok: noAhk && noElectron && portFree && sharedOnly };
}
function clickHandlerCount() {
  const log = path.join(artifacts, 'papers.log');
  if (!fs.existsSync(log)) return 0;
  return (fs.readFileSync(log, 'utf8').match(/\[045-direct-pick\] click-handler/g) || []).length;
}
async function main() {
  console.log(JSON.stringify({ dataDir, projectCopy, papersCommand: `${ELECTRON} . --papers-data-dir=${dataDir}`, ahkScript: AHK_SCRIPT }));
  const preClean = await preRunVerifiedClean();
  record('pre-run verified-clean (no AHK/electron, port 38473 free, shared dir README-only)', preClean.ok, JSON.stringify(preClean));
  if (!preClean.ok) return;
  record('interactive native context', true, await pwsh(['-Action', 'context']));
  await launchTarget(0, 60, 60);
  await launchTarget(1, 60, 220);
  await launchTarget(2, 60, 700);
  papers = await launchPapers(dataDir, await freePort(), path.join(artifacts, 'papers.log'));
  const hostTarget = await browserTarget(papers.baseUrl, (target) => target.url.includes('/out/renderer/index.html'));
  const host = await connectToTarget(hostTarget, papers.baseUrl);
  await waitFor(() => host.evaluate(`Boolean([...document.querySelectorAll('.backpack-card')].some((card) => card.querySelector('.name')?.textContent?.trim() === 'As you Go'))`));
  await host.evaluate(`(() => [...document.querySelectorAll('.backpack-card')].find((card) => card.querySelector('.name')?.textContent?.trim() === 'As you Go')?.querySelector('button')?.click())()`);
  const projectTarget = await browserTarget(papers.baseUrl, (target) => target.url.startsWith('papers-backpack://'));
  const bp = await connectToTarget(projectTarget, papers.baseUrl);
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`));
  await bp.evaluate(`(() => { const blank = document.querySelector('#icon-grid [data-blank-parent]'); blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); })()`);
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-action="new-window-layout"]'))`));
  await bp.evaluate(`document.querySelector('[data-action="new-window-layout"]').click()`);
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-wl-pick]'))`));
  const layoutId = await bp.evaluate(`document.querySelector('[data-wl-pick]').dataset.wlPick`);
  record('isolated current-source Papers/As You Go pair + layout entered', Boolean(layoutId), `layoutId=${layoutId}`);
  runToken = crypto.randomUUID();
  sharedTrace = path.join(SHARED_RECEIPTS, `run-${runToken}.receipt`);
  const ahkTrace = path.join(artifacts, 'ahk-picker-trace.receipt');
  const elevated = await launchElevatedAkh([AHK_SCRIPT, sharedTrace, runToken]);
  ahk = elevated.launcher;
  elevatedChildPid = elevated.pid;
  await waitFor(() => processAlive(elevatedChildPid), 10000);
  record('edited SlopTop elevated child process launched', true, `elevatedChildPid=${elevatedChildPid}`);
  const ahkInventory = await ahkProcesses();
  const ownedAhk = ahkInventory.filter((process) => Number(process.ProcessId) === elevatedChildPid);
  record('isolated AHK owner is the elevated child only', ownedAhk.length === 1 && Number(ownedAhk[0]?.ProcessId) === elevatedChildPid, JSON.stringify(ownedAhk));
  await waitFor(() => fs.existsSync(sharedTrace), 10000);
  const startupReceipt = fs.readFileSync(sharedTrace, 'utf8');
  const startupLines = startupReceipt.split(/\r?\n/).filter(Boolean);
  const childPid = Number(startupLines[0]?.match(/pid=(\d+)/)?.[1] ?? 0);
  record('elevated AHK child shared startup receipt is fresh and token-matched', startupLines[0]?.includes(`token=${runToken}`) && childPid === elevatedChildPid && childPid > 0, startupReceipt);
  const focus = JSON.parse(await pwsh(['-Action', 'focus-process', '-ProcessId', String(papers.proc.pid)]));
  record('current-source Papers window foregrounded by exact PID', focus.ok === true && String(focus.foreground) === String(focus.hwnd), JSON.stringify(focus));

  // === WAVE 086: fresh-session + point-ownership interlocked three-click proof ===
  const preHandlerCount = clickHandlerCount();
  const preHello = await helloState();
  record('pre-activation state (no handler yet, no picker token)', preHandlerCount === 0 && (preHello === null || preHello.active !== true), JSON.stringify({ preHandlerCount, preHello }));

  const p1 = await assertActivationPoint(bp, 'activation OS');
  if (!p1) return;
  await input('ctrl-shift-up'); await sleep(100);
  await movePhysical(p1.x, p1.y);
  await input('ctrl-shift-down');
  if (!(await interlockedReleaseLeftButton('pre-activation'))) return;
  await input('left-click');
  const h1 = await waitForHello();
  const activated = Boolean(h1.hello && h1.hello.active === true && typeof h1.hello.token === 'string' && h1.hello.token.length > 0);
  record('clean-button tokened activation', activated, JSON.stringify(h1));
  if (!activated) { await input('ctrl-shift-up'); return; }
  const token = h1.hello.token;
  await sleep(400);
  const postHandlerCount = clickHandlerCount();
  const handlerFresh = postHandlerCount > preHandlerCount;
  const tokenFresh = token !== preHello?.token;
  record('fresh activation (new page click-handler + new token not present before)', handlerFresh && tokenFresh, JSON.stringify({ preHandlerCount, postHandlerCount, preToken: preHello?.token ?? null, token }));
  if (!(handlerFresh && tokenFresh)) { await input('ctrl-shift-up'); return; }

  // Three sequential member clicks: target2 (60,700), target0 (60,60), target1 (60,220).
  // Each requires OS WindowFromPoint PID/HWND to match the intended disposable target before the click.
  const clickSequence = [
    { x: 200, y: 800, expect: { x: 60, y: 700 }, target: targets[2], label: 'target2' },
    { x: 200, y: 120, expect: { x: 60, y: 60 }, target: targets[0], label: 'target0' },
    { x: 200, y: 440, expect: { x: 60, y: 220 }, target: targets[1], label: 'target1' },
  ];
  const clickProofs = [];
  let expectedGreen = 0;
  for (const [index, c] of clickSequence.entries()) {
    let traceFloor = traceLines(await readSharedTrace()).length;
    // Pre-click point-ownership: OS WindowFromPoint must resolve to the intended target PID.
    const ownership = await osWindowAtPoint(c.x, c.y, c.target.pid);
    const owned = String(ownership.at.processId) === String(c.target.pid);
    record(`pre-click ${c.label} OS point owned by target ${c.target.pid}`, owned, JSON.stringify({ point: { x: c.x, y: c.y }, at: ownership.at, expectedPid: c.target.pid }));
    if (!owned) { await input('ctrl-shift-up'); return; }
    // Pre-click interlock: release Ctrl+Shift, LEFTUP, verify lButton false, re-press.
    if (!(await interlockedReleaseLeftButton(`pre-click ${c.label}`))) return;
    await movePhysical(c.x, c.y);
    const preState = await captureClickState(c.x, c.y);
    record(`pre-click state ${c.label} (lButton false)`, !preState.keys.lButton, JSON.stringify({ keys: preState.keys, cursor: preState.cursor, osAtPoint: preState.osAtPoint, hello: preState.hello }));
    await input('left-click');
    // Post-click: AHK hotkey click + post event=click receipts, then interlocked release.
    const hotkeyClick = await waitForTraceResponse((l) => l.includes(`hotkey click x=${c.x} y=${c.y}`), traceFloor, 15000);
    const eventClick = await waitForTraceResponse((l) => l.includes(`event=click x=${c.x} y=${c.y}`), traceFloor, 15000);
    const postState = await capturePostClickState(preState, c.x, c.y);
    if (!(await interlockedReleaseLeftButton(`post-click ${c.label}`))) return;
    const afterRelease = await captureClickState(c.x, c.y);
    const okClick = Boolean(hotkeyClick && eventClick && eventClick.response?.selected === true && hasVisual(eventClick.response?.state, 'green', c.expect.x, c.expect.y));
    const okLButton = !afterRelease.keys.lButton;
    expectedGreen += 1;
    let gs = null;
    try {
      gs = await waitForVisuals((visuals) => distinctGeometries(visuals, 'green').length >= expectedGreen, 20000);
    } catch (error) { gs = { state: await helloState(), error: String(error) }; }
    const greens = distinctGeometries(gs.state?.state?.visuals ?? [], 'green');
    const okGreen = greens.length >= expectedGreen && greens.some((g) => g.x === c.expect.x && g.y === c.expect.y);
    clickProofs.push({ index: index + 1, label: c.label, hotkeyClick: hotkeyClick?.line ?? null, eventClick: eventClick?.line ?? null, postState, afterRelease, okClick, okLButton, okGreen, greens });
    record(`click ${index + 1} (${c.label}) AHK hotkey click + post event=click + green selection`, okClick && okGreen, JSON.stringify({ hotkey: hotkeyClick?.line, event: eventClick?.line, greens, error: gs.error ?? null }));
    record(`click ${index + 1} (${c.label}) post-selection lButton false`, okLButton, JSON.stringify(afterRelease));
    if (!(okClick && okLButton && okGreen)) { await input('ctrl-shift-up'); return; }
  }

  // Terminate with Escape (cancel) for a clean end state.
  await input('ctrl-shift-down'); await sleep(100);
  const snapshotAtEscape = await modifierSnapshot();
  await sleep(150);
  await input('escape');
  await sleep(600);
  await input('ctrl-shift-up');
  const trace = await readSharedTrace();
  fs.writeFileSync(path.join(artifacts, 'ahk-trace.json'), JSON.stringify({ token: runToken, trace }, null, 2));
  const cancelLine = traceLines(trace).find((l) => l.includes('event=cancel'));
  record('AHK post event=cancel trace captured', Boolean(cancelLine), cancelLine ?? 'NO cancel line in trace');
  const afterEscapeHello = await helloState();
  record('hello inactive after Escape', afterEscapeHello === null || afterEscapeHello.active !== true, JSON.stringify(afterEscapeHello));

  fs.writeFileSync(path.join(artifacts, 'interlock-proof.json'), JSON.stringify({ runToken, layoutId, token, preHandlerCount, postHandlerCount, handlerFresh, tokenFresh, preHello, clickProofs, snapshotAtEscape, cancelLine, afterEscapeHello }, null, 2));
}
try { await main(); } catch (error) { record('bridge runner', false, String(error)); } finally {
  await input('ctrl-shift-up').catch(() => undefined);
  if (elevatedChildPid) { await stopPid(elevatedChildPid); await sleep(1000); if (await processAlive(elevatedChildPid).catch(() => false)) await stopPidElevated(elevatedChildPid); }
  if (ahk && ahk.exitCode === null) ahk.kill();
  const ownedAhkAfter = await ahkProcesses().catch(() => []);
  for (const process of ownedAhkAfter.filter((candidate) => Number(candidate.ParentProcessId) === ahk?.pid)) {
    await stopPid(Number(process.ProcessId));
  }
  for (const target of targets) { try { target.child.kill(); } catch {} }
  if (papers) await closeApp(papers.proc, papers.baseUrl).catch(() => undefined);
  await sleep(2000);
  const childStillAlive = elevatedChildPid ? await processAlive(elevatedChildPid).catch(() => 'unknown') : null;
  const papersStillAlive = papers ? await processAlive(papers.proc.pid).catch(() => 'unknown') : null;
  const targetAlive = [];
  for (const target of targets) targetAlive.push(await processAlive(target.pid).catch(() => 'unknown'));

  // Verified-clean check: no broker child, no Papers, no AutoHotkey/electron, port 38473 not listening, README-only shared dir.
  const verifyClean = async () => {
    const childDead = !elevatedChildPid || (await processAlive(elevatedChildPid).catch(() => true)) !== true;
    const papersDead = !papers || (await processAlive(papers.proc.pid).catch(() => true)) !== true;
    const inventory = await ahkProcesses().catch(() => []);
    const noAhk = inventory.length === 0;
    const noElectron = (await new Promise((resolve) => {
      const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron' } | Measure-Object).Count`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = ''; child.stdout.on('data', (c) => out += String(c)); child.on('close', () => resolve(out.trim()));
    })) === '0';
    const portFree = await new Promise((resolve) => {
      const child = spawn('C:\\Windows\\System32\\netstat.exe', ['-ano'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = ''; child.stdout.on('data', (c) => out += String(c)); child.on('close', () => resolve(!/:38473\s+.*LISTENING/i.test(out)));
    });
    const sharedOnly = (() => { try { const entries = fs.readdirSync(SHARED_RECEIPTS).filter((n) => n !== 'README.txt'); return entries.length === 0; } catch { return false; } })();
    return { childDead, papersDead, noAhk, noElectron, portFree, sharedOnly, ok: childDead && papersDead && noAhk && noElectron && portFree && sharedOnly };
  };
  let verified = null;
  const cleanDeadline = Date.now() + 15000;
  while (Date.now() < cleanDeadline) {
    verified = await verifyClean();
    if (verified.ok) break;
    await sleep(500);
  }
  record('verified cleanup (no broker child/Papers/AHK/electron, port 38473 free, shared dir README-only)', verified?.ok === true, JSON.stringify(verified));
  fs.writeFileSync(path.join(artifacts, 'steps.json'), JSON.stringify(steps, null, 2));
  try {
    fs.writeFileSync(path.join(artifacts, 'identity.json'), JSON.stringify({ dataDir, projectCopy, electron: ELECTRON, ahk: AHK, ahkScript: AHK_SCRIPT, runToken, sharedTrace, elevatedChildPid, papersPid: papers?.proc?.pid ?? null, targets: targets.map((target) => ({ pid: target.pid, title: target.title })) }, null, 2));
  } catch {}
  fs.writeFileSync(path.join(artifacts, 'cleanup.json'), JSON.stringify({ elevatedChildPid, papersPid: papers?.proc?.pid ?? null, targetPids: targets.map((target) => target.pid), childStillAlive, papersStillAlive, targetAlive, sharedDir: fs.readdirSync(SHARED_RECEIPTS), cleanedAt: new Date().toISOString() }, null, 2));
  if (typeof sharedTrace === 'string') fs.rmSync(sharedTrace, { force: true });
  console.log(JSON.stringify({ dataDir, artifacts, steps }));
  process.exitCode = requiredFailure ? 1 : 0;
}
