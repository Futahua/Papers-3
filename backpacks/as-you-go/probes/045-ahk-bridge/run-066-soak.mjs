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
const WORKER_HUB = "D:\\Letters\\MatTroiSeConMoc\\Papers\\User Generated\\August 10th 26' logs\\worker-hub.ps1";
const SOAK_MINUTES = 120;
const SOAK_MS = SOAK_MINUTES * 60 * 1000;
const PING_INTERVAL_MS = 20 * 60 * 1000;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-070-soak-'));
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
async function pingBrain(message) {
  try {
    await new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER_HUB, '-Action', 'send', '-From', 'gazelle', '-To', 'brain', '-Kind', 'info', '-Message', message], { windowsHide: true, stdio: 'ignore' });
      child.on('close', resolve);
    });
  } catch { /* ping is best-effort */ }
}
async function telemetry() {
  const out = {};
  try {
    const procs = await new Promise((resolve, reject) => {
      const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `Get-Process | Where-Object { $_.ProcessName -match 'AutoHotkey64|electron' } | Select-Object Id,ProcessName,@{n='WSMB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='PMB';e={[math]::Round($_.PrivateMemorySize64/1MB,1)}} | ConvertTo-Json -Compress`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = []; child.stdout.on('data', c => chunks.push(String(c))); child.on('error', reject); child.on('close', () => resolve(chunks.join('').trim()));
    });
    out.processes = procs ? JSON.parse(procs) : [];
    const log = await captureSaveLog(bpCurrent);
    out.saveLog = { total: log.length, out: log.filter(e => e.direction === 'out').length, in: log.filter(e => e.direction === 'in').length };
    const hello = await helloState();
    out.pickerActive = hello?.active === true;
  } catch (error) { out.error = String(error); }
  return out;
}
let bpCurrent = null;

async function ensurePickerReady(bp, label) {
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
  } catch {
    pickReady = await freshPickPoint(bp);
  }
  const ready = Boolean(pickReady?.pick && pickReady.pick.attached && pickReady.pick.hitClosest === pickReady.pick.wlPick && !pickReady.pick.disabled);
  record(`${label} focus/hit-test readiness`, focused && ready, JSON.stringify({ focused, pickReady }));
  return focused && ready;
}

async function runPickerCycle(bp, layoutId, label) {
  if (!(await ensurePickerReady(bp, label))) return false;
  const pickReady = await freshPickPoint(bp);
  const p1 = pickReady.point;
  await movePhysical(p1.x, p1.y); await input('left-click'); await input('ctrl-shift-down');
  const h1 = await waitForHello();
  if (!h1.hello) { record(`${label} tokened hello`, false, JSON.stringify(h1)); await input('ctrl-shift-up'); return false; }
  record(`${label} tokened hello`, true, JSON.stringify(h1));
  const memberTargets = [{ x: 150, y: 120 }, { x: 500, y: 220 }, { x: 750, y: 320 }];
  let expectedGreen = 0;
  let ok = true;
  for (const t of memberTargets) {
    await movePhysical(t.x, t.y);
    const hoverState = await waitForVisuals((visuals) => visuals.some((v) => v.kind === 'purple' && isBounded(v)));
    const hoverOk = hoverState.state?.state?.visuals?.some((v) => v.kind === 'purple' && isBounded(v));
    record(`${label} click ${expectedGreen + 1} purple hover`, Boolean(hoverOk), JSON.stringify(hoverState.state)); if (!hoverOk) ok = false;
    await input('left-click');
    await waitForTraceContains('event=click', 15000);
    expectedGreen += 1;
    const greenState = await waitForVisuals((visuals) => distinctGeometries(visuals, 'green').length >= expectedGreen, 20000);
    const greensNow = distinctGeometries(greenState.state?.state?.visuals ?? [], 'green').length;
    const greenOk = greensNow >= expectedGreen;
    record(`${label} click ${expectedGreen} green selection`, greenOk, JSON.stringify(greenState.state)); if (!greenOk) ok = false;
    const redHover = await waitForVisuals((visuals) => visuals.some((v) => v.kind === 'red'));
    const redOk = redHover.state?.state?.visuals?.some((v) => v.kind === 'red');
    record(`${label} member ${expectedGreen} red hover`, Boolean(redOk), JSON.stringify(redHover.state)); if (!redOk) ok = false;
    if (expectedGreen >= 2) {
      const overlapGreens = distinctGeometries(greenState.state?.state?.visuals ?? [], 'green');
      const overlapOk = overlapGreens.length >= 2;
      record(`${label} overlap ${expectedGreen} greens`, overlapOk, JSON.stringify({ greens: overlapGreens })); if (!overlapOk) ok = false;
    }
  }
  await input('ctrl-shift-up');
  await input('ctrl-shift-down'); await input('enter'); await sleep(600);
  await input('ctrl-shift-up');
  const afterAddHello = await helloState();
  const commitOk = !afterAddHello || afterAddHello.active !== true;
  record(`${label} Enter commit closed session`, Boolean(commitOk), JSON.stringify(afterAddHello)); if (!commitOk) ok = false;
  return ok;
}

async function runEscapeCycle(bp, label) {
  if (!(await ensurePickerReady(bp, label))) return false;
  await input('ctrl-shift-up'); await sleep(100);
  const pickReady = await freshPickPoint(bp);
  const p1 = pickReady.point;
  await movePhysical(p1.x, p1.y);
  await input('ctrl-shift-down');
  await input('left-click');
  let h1 = null;
  try {
    h1 = await waitForHello();
  } catch (error) { h1 = { hello: null, error: String(error) }; }
  const activated = Boolean(h1?.hello && h1.hello.active === true && typeof h1.hello.token === 'string' && h1.hello.token.length > 0);
  record(`${label} Escape tokened hello activation`, activated, JSON.stringify(h1));
  if (!activated) { await input('ctrl-shift-up'); return false; }
  const beforeEscape = JSON.stringify(h1.hello?.state ?? null);
  await input('escape'); await sleep(500); await input('ctrl-shift-up');
  const afterEscape = await fetch(`http://127.0.0.1:${PORT}/sloptop-picker/hello`).then((response) => response.json()).catch(() => null);
  const ok = !afterEscape || afterEscape.active !== true;
  record(`${label} Escape zero-mutation`, Boolean(ok), JSON.stringify({ beforeEscape, afterEscape }));
  return ok;
}

async function runReorderCycle(bp, layoutId, label) {
  const rendered = await renderedMemberOrder(bp, layoutId);
  if (rendered.length < 3) { record(`${label} 3-member precondition`, false, `rendered=${JSON.stringify(rendered)}`); return false; }
  record(`${label} 3-member precondition`, true, `members=${JSON.stringify(rendered)}`);
  const drags = [
    { fromIndex: 0, toIndex: 2, label: 'initial' },
    { fromIndex: 2, toIndex: 1, label: 'immediate-second' },
    { fromIndex: 1, toIndex: 0, label: 'later' },
  ];
  let ok = true;
  for (const drag of drags) {
    const buttons = await bp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-wl-members="${layoutId}"] [data-wl-member]')].map((b) => b.dataset.wlMember))`);
    const buttonIds = JSON.parse(buttons);
    const fromId = buttonIds[drag.fromIndex];
    const toId = buttonIds[drag.toIndex];
    const fromPt = await memberButtonPoint(bp, layoutId, fromId);
    const toPt = await memberButtonPoint(bp, layoutId, toId);
    if (!fromPt || !toPt || !fromId || !toId) { record(`${label} ${drag.label} member points`, false, JSON.stringify({ fromId, toId, fromPt, toPt })); ok = false; break; }
    const fromScreen = await screenOf(bp, fromPt.clientX, fromPt.clientY);
    const toScreen = await screenOf(bp, toPt.clientX, toPt.clientY);
    const dragStartMs = Date.now();
    const dragResult = await dragPhysical(fromScreen.x, fromScreen.y, toScreen.x, toScreen.y);
    record(`${label} ${drag.label} drag dispatched`, dragResult.ok === true, JSON.stringify({ fromId, toId, fromScreen, toScreen, dragStartMs })); if (!dragResult.ok) { ok = false; break; }
    let matched = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const log = await captureSaveLog(bp);
      const outs = log.filter((e) => e.direction === 'out' && e.type === 'papers:project:as-you-go-save' && e.at >= dragStartMs);
      const ins = log.filter((e) => e.direction === 'in');
      const matchedIn = ins.filter((e) => e.requestId === (outs[0]?.requestId))[0];
      if (outs.length >= 1 && matchedIn) { matched = { out: outs[0], in: matchedIn }; break; }
      await sleep(200);
    }
    const corrOk = Boolean(matched && matched.in && matched.in.ok);
    record(`${label} ${drag.label} save requestId+ack`, corrOk, JSON.stringify(matched)); if (!corrOk) { ok = false; break; }
    const renderedAfter = await renderedMemberOrder(bp, layoutId);
    const persistedAfter = await persistedMemberOrder();
    const orderOk = JSON.stringify(persistedAfter.order) === JSON.stringify(renderedAfter);
    record(`${label} ${drag.label} persisted==rendered`, orderOk, JSON.stringify({ persisted: persistedAfter.order, rendered: renderedAfter })); if (!orderOk) ok = false;
  }
  return ok;
}

async function newLayout(bp, label) {
  const focus = JSON.parse(await pwsh(['-Action', 'focus-process', '-ProcessId', String(papers.proc.pid)]));
  const focused = focus.ok === true && String(focus.foreground) === String(focus.hwnd);
  await sleep(200);
  let menuTarget = null;
  try {
    await waitFor(async () => {
      const result = await bp.evaluate(`(() => {
        const blank = document.querySelector('#icon-grid [data-blank-parent]');
        if (!blank) return false;
        const rect = blank.getBoundingClientRect();
        const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const insideBlank = blank.contains(el) || el === blank;
        return insideBlank;
      })()`);
      return result;
    }, 15000);
    menuTarget = await bp.evaluate(`(() => { const blank = document.querySelector('#icon-grid [data-blank-parent]'); if (!blank) return null; const rect = blank.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, exists: true }; })()`);
  } catch {
    menuTarget = await bp.evaluate(`(() => { const blank = document.querySelector('#icon-grid [data-blank-parent]'); if (!blank) return null; const rect = blank.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, exists: Boolean(blank) }; })()`);
  }
  const targetOk = Boolean(menuTarget && menuTarget.exists);
  if (!targetOk) { record(`${label} newLayout context-menu target actionable`, false, JSON.stringify({ focused, menuTarget })); return null; }
  await bp.evaluate(`(() => { const blank = document.querySelector('#icon-grid [data-blank-parent]'); if (blank) blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${menuTarget.x}, clientY: ${menuTarget.y} })); })()`);
  let actionOk = false;
  try {
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-action="new-window-layout"]'))`), 15000);
    actionOk = true;
  } catch { actionOk = false; }
  if (!actionOk) { record(`${label} newLayout action present`, false, JSON.stringify({ focused, menuTarget })); return null; }
  await bp.evaluate(`document.querySelector('[data-action="new-window-layout"]').click()`);
  let pickOk = false;
  try {
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-wl-pick]'))`), 15000);
    pickOk = true;
  } catch { pickOk = false; }
  if (!pickOk) { record(`${label} newLayout fresh pick present`, false, JSON.stringify({ focused, menuTarget })); return null; }
  const layoutId = await bp.evaluate(`document.querySelector('[data-wl-pick]').dataset.wlPick`);
  let pick = null;
  let pollOk = false;
  try {
    await waitFor(async () => {
      const current = await bp.evaluate(`(() => { const button = document.querySelector('[data-wl-pick]'); if (!button) return null; const rect = button.getBoundingClientRect(); const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return { attached: document.contains(button), enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true', hit: el?.closest?.('[data-wl-pick]')?.dataset?.wlPick ?? null, wlPick: button.dataset?.wlPick ?? null }; })()`);
      return Boolean(current && current.attached && current.enabled && current.hit === current.wlPick && current.wlPick === layoutId);
    }, 15000);
    pick = await bp.evaluate(`(() => { const button = document.querySelector('[data-wl-pick]'); const rect = button.getBoundingClientRect(); const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return { attached: document.contains(button), enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true', hit: el?.closest?.('[data-wl-pick]')?.dataset?.wlPick ?? null, wlPick: button.dataset?.wlPick ?? null }; })()`);
    pollOk = Boolean(pick && pick.attached && pick.enabled && pick.hit === pick.wlPick && pick.wlPick === layoutId);
  } catch { pollOk = false; }
  if (!pollOk) { record(`${label} newLayout polled picker ready`, false, JSON.stringify({ focused, layoutId, pick })); return null; }
  record(`${label} newLayout polled picker ready`, pollOk && focused, JSON.stringify({ focused, layoutId, pick }));
  return pollOk && focused ? layoutId : null;
}

async function main() {
  console.log(JSON.stringify({ dataDir, projectCopy, papersCommand: `${ELECTRON} . --papers-data-dir=${dataDir}`, ahkScript: AHK_SCRIPT, soakMinutes: SOAK_MINUTES }));
  record('interactive native context', true, await pwsh(['-Action', 'context']));
  await launchTarget(0, 60, 60);
  await launchTarget(1, 320, 160);
  await launchTarget(2, 620, 260);
  papers = await launchPapers(dataDir, await freePort(), path.join(artifacts, 'papers.log'));
  const hostTarget = await browserTarget(papers.baseUrl, (target) => target.url.includes('/out/renderer/index.html'));
  const host = await connectToTarget(hostTarget, papers.baseUrl);
  await waitFor(() => host.evaluate(`Boolean([...document.querySelectorAll('.backpack-card')].some((card) => card.querySelector('.name')?.textContent?.trim() === 'As you Go'))`));
  await host.evaluate(`(() => [...document.querySelectorAll('.backpack-card')].find((card) => card.querySelector('.name')?.textContent?.trim() === 'As you Go')?.querySelector('button')?.click())()`);
  const projectTarget = await browserTarget(papers.baseUrl, (target) => target.url.startsWith('papers-backpack://'));
  const bp = await connectToTarget(projectTarget, papers.baseUrl);
  bpCurrent = bp;
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`));
  await bp.evaluate(`(() => { const blank = document.querySelector('#icon-grid [data-blank-parent]'); blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); })()`);
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-action="new-window-layout"]'))`));
  await bp.evaluate(`document.querySelector('[data-action="new-window-layout"]').click()`);
  await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-wl-pick]'))`));
  const initialLayout = await bp.evaluate(`document.querySelector('[data-wl-pick]').dataset.wlPick`);
  record('isolated current-source Papers/As You Go pair + layout entered', Boolean(initialLayout), `layoutId=${initialLayout}`);
  runToken = crypto.randomUUID();
  sharedTrace = path.join(SHARED_RECEIPTS, `run-${runToken}.receipt`);
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
  await installHostTap(bp);
  await sleep(300);

  const soakStart = performance.now();
  let cycleIndex = 0;
  let lastPingMs = 0;
  const telemetrySnapshots = [];
  const cycleResults = [];
  let invalidated = false;

  while (performance.now() - soakStart < SOAK_MS) {
    cycleIndex += 1;
    const label = `cycle${cycleIndex}`;
    let cycleOk = true;
    // Varied native cycle: picker lifecycle + Enter, Escape, reorder, coexistence.
    const layoutId = await newLayout(bp, label);
    if (!layoutId) { cycleOk = false; }
    const pickerOk = layoutId ? await runPickerCycle(bp, layoutId, label) : false;
    if (!pickerOk) cycleOk = false;
    await sleep(300);
    // hotkey/movement coexistence: plain cursor move must not activate picker, Ctrl+Space move must work
    try {
      const beforeMove = await helloState();
      await movePhysical(800, 400);
      await sleep(300);
      const afterMove = await helloState();
      const coexistOk = (beforeMove?.active !== true) && (afterMove?.active !== true);
      record(`${label} hotkey/movement coexistence (no picker on plain move)`, Boolean(coexistOk), JSON.stringify({ beforeMove, afterMove })); if (!coexistOk) cycleOk = false;
    } catch (error) { record(`${label} coexistence check`, false, String(error)); cycleOk = false; }
    const escapeOk = await runEscapeCycle(bp, label);
    if (!escapeOk) cycleOk = false;
    await sleep(300);
    const reorderOk = await runReorderCycle(bp, layoutId, label);
    if (!reorderOk) cycleOk = false;
    cycleResults.push({ cycle: cycleIndex, ok: cycleOk, elapsedMin: ((performance.now() - soakStart) / 60000).toFixed(1) });
    if (!cycleOk) { invalidated = true; break; }
    // telemetry + ping every 20 minutes
    const elapsed = performance.now() - soakStart;
    if (elapsed - lastPingMs >= PING_INTERVAL_MS) {
      lastPingMs = elapsed;
      const snap = await telemetry();
      telemetrySnapshots.push({ elapsedMin: (elapsed / 60000).toFixed(1), cycle: cycleIndex, ...snap });
      fs.writeFileSync(path.join(artifacts, 'telemetry.json'), JSON.stringify(telemetrySnapshots, null, 2));
      await pingBrain(`Gazelle Wave 066 soak progress: ${(elapsed/60000).toFixed(1)}/${SOAK_MINUTES} min, cycle ${cycleIndex} (all ok), processes=${JSON.stringify(snap.processes?.map(p=>({n:p.ProcessName,id:p.Id,ws:p.WSMB})))}, saveLog out=${snap.saveLog?.out} in=${snap.saveLog?.in}, pickerActive=${snap.pickerActive}, dataDir=${dataDir}`);
    }
  }

  const totalElapsedMs = performance.now() - soakStart;
  fs.writeFileSync(path.join(artifacts, 'cycle-results.json'), JSON.stringify(cycleResults, null, 2));
  if (invalidated) {
    record('uninterrupted soak completed (>=120 min)', false, `invalidated at cycle ${cycleIndex}`);
  } else {
    record('uninterrupted soak completed (>=120 min)', totalElapsedMs >= SOAK_MS, `elapsedMin=${(totalElapsedMs/60000).toFixed(1)}, cycles=${cycleIndex}`);
  }

  // Fresh final full cycle after the interval.
  const finalLayout = await newLayout(bp, 'final');
  const finalPicker = finalLayout ? await runPickerCycle(bp, finalLayout, 'final') : false;
  const finalEscape = await runEscapeCycle(bp, 'final');
  const finalReorder = finalLayout ? await runReorderCycle(bp, finalLayout, 'final') : false;
  record('fresh final full cycle', Boolean(finalPicker && finalEscape && finalReorder), JSON.stringify({ finalPicker, finalEscape, finalReorder }));

  const finalSaveLog = await captureSaveLog(bp);
  fs.writeFileSync(path.join(artifacts, 'save-log.json'), JSON.stringify(finalSaveLog, null, 2));
  const finalTelemetry = await telemetry();
  telemetrySnapshots.push({ elapsedMin: (totalElapsedMs / 60000).toFixed(1), cycle: cycleIndex, final: true, ...finalTelemetry });
  fs.writeFileSync(path.join(artifacts, 'telemetry.json'), JSON.stringify(telemetrySnapshots, null, 2));
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
  fs.writeFileSync(path.join(artifacts, 'steps.json'), JSON.stringify(steps, null, 2));
  try {
    fs.writeFileSync(path.join(artifacts, 'identity.json'), JSON.stringify({ dataDir, projectCopy, electron: ELECTRON, ahk: AHK, ahkScript: AHK_SCRIPT, runToken, sharedTrace, elevatedChildPid, papersPid: papers?.proc?.pid ?? null, targets: targets.map((target) => ({ pid: target.pid, title: target.title })) }, null, 2));
  } catch {}
  fs.writeFileSync(path.join(artifacts, 'cleanup.json'), JSON.stringify({ elevatedChildPid, papersPid: papers?.proc?.pid ?? null, targetPids: targets.map((target) => target.pid), childStillAlive, papersStillAlive, targetAlive, sharedDir: fs.readdirSync(SHARED_RECEIPTS), cleanedAt: new Date().toISOString() }, null, 2));
  if (typeof sharedTrace === 'string') fs.rmSync(sharedTrace, { force: true });
  console.log(JSON.stringify({ dataDir, artifacts, steps, soakComplete: steps.some((s) => s.name === 'uninterrupted soak completed (>=120 min)') && steps.find((s) => s.name === 'uninterrupted soak completed (>=120 min)')?.ok === true }));
  process.exitCode = requiredFailure ? 1 : 0;
}
