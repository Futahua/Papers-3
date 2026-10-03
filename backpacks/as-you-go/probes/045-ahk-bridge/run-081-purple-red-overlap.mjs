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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-081-overlap-'));
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
async function waitFor(fn, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw new Error('timeout'); }
async function json(url, options) { return await (await fetch(url, options)).json(); }
async function helloState() {
  try { const last = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`); return last; } catch { return null; }
}
async function waitForHello(timeout = 8000) {
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
  } catch { pickReady = await freshPickPoint(bp); }
  const ready = Boolean(pickReady?.pick && pickReady.pick.attached && pickReady.pick.hitClosest === pickReady.pick.wlPick && !pickReady.pick.disabled);
  record(`${label} focus/hit-test readiness`, focused && ready, JSON.stringify({ focused, pickReady }));
  return focused && ready;
}
async function modifierSnapshot() {
  const snapshot = JSON.parse(await pwsh(['-Action', 'snapshot']));
  const state = await helloState();
  return { snapshot, pickerActive: state?.active === true, token: state?.token ?? null };
}
async function osWindowAtPoint(x, y, papersHwnd) {
  const at = JSON.parse(await pwsh(['-Action', 'window-at-point', '-X', String(x), '-Y', String(y)]));
  const matches = String(at.hwnd) === String(papersHwnd);
  return { at, matches, papersHwnd, x, y };
}
async function releaseLeftButton(label) {
  const released = JSON.parse(await pwsh(['-Action', 'left-up']));
  const keys = JSON.parse(await pwsh(['-Action', 'key-state']));
  const ok = !keys.lButton;
  record(`${label} left button released (lButton false)`, ok, JSON.stringify({ released, keys }));
  return ok;
}
async function captureState(p2) {
  return {
    trace: await readSharedTrace(),
    keys: JSON.parse(await pwsh(['-Action', 'key-state'])),
    hello: await helloState(),
    cursor: JSON.parse(await pwsh(['-Action', 'snapshot'])),
    osAtPoint: JSON.parse(await pwsh(['-Action', 'window-at-point', '-X', String(p2.x), '-Y', String(p2.y)])),
  };
}
async function capturePostClickTrace(preClick, p2, pollMs = 3000) {
  const started = performance.now();
  let post = await captureState(p2);
  while (post.trace.length <= preClick.trace.length && performance.now() - started < pollMs) {
    await sleep(200);
    post = await captureState(p2);
  }
  return post;
}
function traceLines(trace) { return trace ? trace.split(/\r?\n/).filter(Boolean) : []; }
function responseOf(line) {
  const i = line.indexOf('response=');
  if (i < 0) return null;
  try { return JSON.parse(line.slice(i + 'response='.length)); } catch { return null; }
}
async function lastMatchingResponse(predicate, minLine = 0) {
  const lines = traceLines(await readSharedTrace());
  let found = null;
  for (let i = minLine; i < lines.length; i += 1) if (predicate(lines[i])) found = lines[i];
  if (!found) return null;
  return { line: found, response: responseOf(found) };
}
async function waitForTraceResponse(predicate, minLine = 0, timeout = 15000) {
  const started = performance.now();
  let result = null;
  await waitFor(async () => {
    result = await lastMatchingResponse(predicate, minLine);
    return Boolean(result && result.response);
  }, timeout);
  return result;
}
function hasVisual(response, kind, x, y) {
  return Boolean((response?.visuals ?? []).some((v) => v.kind === kind && Math.round(v.x) === x && Math.round(v.y) === y));
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
async function main() {
  console.log(JSON.stringify({ dataDir, projectCopy, ahkScript: AHK_SCRIPT }));
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
  const elevated = await launchElevatedAkh([AHK_SCRIPT, sharedTrace, runToken]);
  ahk = elevated.launcher;
  elevatedChildPid = elevated.pid;
  await waitFor(() => processAlive(elevatedChildPid), 10000);
  record('edited SlopTop elevated child process launched', true, `elevatedChildPid=${elevatedChildPid}`);
  await waitFor(() => fs.existsSync(sharedTrace), 10000);
  const startupReceipt = fs.readFileSync(sharedTrace, 'utf8');
  const startupLines = startupReceipt.split(/\r?\n/).filter(Boolean);
  const childPid = Number(startupLines[0]?.match(/pid=(\d+)/)?.[1] ?? 0);
  record('elevated AHK child shared startup receipt is fresh and token-matched', startupLines[0]?.includes(`token=${runToken}`) && childPid === elevatedChildPid && childPid > 0, startupReceipt);
  const focus = JSON.parse(await pwsh(['-Action', 'focus-process', '-ProcessId', String(papers.proc.pid)]));
  record('current-source Papers window foregrounded by exact PID', focus.ok === true && String(focus.foreground) === String(focus.hwnd), JSON.stringify(focus));

  // Candidate precondition: all three disposable targets must be alive with non-zero native bounds.
  let candidateOk = true;
  const candidateDetails = [];
  for (const target of targets) {
    try {
      const b = JSON.parse(await pwsh(['-Action', 'bounds-process', '-ProcessId', String(target.pid)]));
      const alive = await processAlive(target.pid);
      const ok = Boolean(alive && b.ok === true && b.right > b.left && b.bottom > b.top);
      candidateDetails.push({ pid: target.pid, alive, ok, bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } });
      if (!ok) candidateOk = false;
    } catch (error) { candidateOk = false; candidateDetails.push({ pid: target.pid, error: String(error) }); }
  }
  record('all three target candidates alive with non-zero bounds', candidateOk, JSON.stringify(candidateDetails));
  if (!candidateOk) return;

  // === SINGLE SESSION: purple/red/overlap visual-contract validation ===
  const p = await assertActivationPoint(bp, 'picker OS');
  if (!p) return;
  await input('ctrl-shift-up'); await sleep(100);
  await movePhysical(p.x, p.y);
  await input('ctrl-shift-down');
  if (!(await releaseLeftButton('pre-activation'))) return;
  await input('left-click');
  const hello = await waitForHello();
  const activated = Boolean(hello?.hello && hello.hello.active === true && typeof hello.hello.token === 'string' && hello.hello.token.length > 0);
  record('tokened hello activation', activated, JSON.stringify(hello));
  if (!activated) { await input('ctrl-shift-up'); return; }
  const token = hello.hello.token;
  let traceFloor = traceLines(await readSharedTrace()).length;

  // STATE 1: purple hover over unselected target 2 (60,700,400,300) at (200,800).
  await movePhysical(200, 800);
  const purple = await waitForTraceResponse((l) => l.includes('event=hover x=200 y=800') && l.includes('"purple"'), traceFloor, 15000);
  const purpleOk = Boolean(purple && hasVisual(purple.response, 'purple', 60, 700));
  record('purple hover over unselected window', purpleOk, JSON.stringify({ line: purple?.line, visuals: purple?.response?.visuals ?? null }));
  traceFloor = traceLines(await readSharedTrace()).length;

  // STATE 2: green selection of target 2.
  if (!(await releaseLeftButton('before select target2'))) return;
  await input('left-click');
  const green = await waitForTraceResponse((l) => l.includes('event=click x=200 y=800'), traceFloor, 15000);
  const greenOk = Boolean(green && green.response?.selected === true && hasVisual(green.response?.state, 'green', 60, 700));
  record('green selection of unselected window', greenOk, JSON.stringify({ line: green?.line, response: green?.response ?? null }));
  traceFloor = traceLines(await readSharedTrace()).length;

  // STATE 3: red hover over the now-selected target 2.
  await movePhysical(1000, 800);
  await sleep(200);
  await movePhysical(200, 800);
  const red = await waitForTraceResponse((l) => l.includes('event=hover x=200 y=800') && l.includes('"red"'), traceFloor, 15000);
  const redOk = Boolean(red && hasVisual(red.response, 'green', 60, 700) && hasVisual(red.response, 'red', 60, 700));
  record('red hover over already-selected window', redOk, JSON.stringify({ line: red?.line, visuals: red?.response?.visuals ?? null }));
  traceFloor = traceLines(await readSharedTrace()).length;

  // STATE 4: two overlapping selected windows retain distinct green borders.
  // Target 0 exclusive point (200,120); target 1 exclusive point (200,440).
  if (!(await releaseLeftButton('before select target0'))) return;
  await movePhysical(200, 120);
  await input('left-click');
  await waitForTraceContains('event=click x=200 y=120', 15000);
  if (!(await releaseLeftButton('before select target1'))) return;
  await movePhysical(200, 440);
  await input('left-click');
  await waitForTraceContains('event=click x=200 y=440', 15000);
  let overlap = null;
  try {
    overlap = await waitForVisuals((visuals) => {
      const g = distinctGeometries(visuals, 'green');
      return g.some((v) => v.x === 60 && v.y === 60) && g.some((v) => v.x === 60 && v.y === 220);
    }, 20000);
  } catch (error) { overlap = { state: await helloState(), error: String(error) }; }
  const overlapGreens = distinctGeometries(overlap.state?.state?.visuals ?? [], 'green');
  const overlapOk = Boolean(!overlap.error && overlapGreens.some((v) => v.x === 60 && v.y === 60) && overlapGreens.some((v) => v.x === 60 && v.y === 220));
  record('two overlapping selected windows retain distinct green borders', overlapOk, JSON.stringify({ overlapGreens, error: overlap.error ?? null }));

  // Native overlap receipt: target 0 and target 1 bounds must overlap.
  const b0 = JSON.parse(await pwsh(['-Action', 'bounds-process', '-ProcessId', String(targets[0].pid)]));
  const b1 = JSON.parse(await pwsh(['-Action', 'bounds-process', '-ProcessId', String(targets[1].pid)]));
  const nativeOverlap = Boolean(b0.ok && b1.ok && b0.right > b1.left && b0.left < b1.right && b0.bottom > b1.top && b0.top < b1.bottom);
  record('targets 0 and 1 overlap natively', nativeOverlap, JSON.stringify({ b0, b1 }));

  // Terminate with Escape (cancel): intended outcome + zero mutation.
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
  let inactiveResult = null;
  try {
    inactiveResult = await waitForHelloInactive();
  } catch (error) { inactiveResult = { error: String(error), last: await helloState() }; }
  record('bounded poll hello inactive after Escape', inactiveResult.last === null || inactiveResult.last?.active !== true, JSON.stringify({ snapshotAtEscape, inactiveResult, cancelLine }));

  fs.writeFileSync(path.join(artifacts, 'visuals-validation.json'), JSON.stringify({ runToken, layoutId, token, purple, purpleOk, green, greenOk, red, redOk, overlapGreens, overlapOk, b0, b1, nativeOverlap, cancelLine, snapshotAtEscape, inactiveResult, afterEscapeHello }, null, 2));
}
try { await main(); } catch (error) { record('discriminator runner', false, String(error)); } finally {
  await input('ctrl-shift-up').catch(() => undefined);
  if (elevatedChildPid) { await stopPid(elevatedChildPid); await sleep(1000); if (await processAlive(elevatedChildPid).catch(() => false)) await stopPidElevated(elevatedChildPid); }
  if (ahk && ahk.exitCode === null) ahk.kill();
  const ownedAhkAfter = await ahkProcesses().catch(() => []);
  for (const process of ownedAhkAfter.filter((candidate) => Number(candidate.ParentProcessId) === ahk?.pid)) {
    await stopPid(Number(process.ProcessId));
  }
  for (const target of targets) { try { target.child.kill(); } catch {} }
  if (papers) await closeApp(papers.proc, papers.baseUrl).catch(() => undefined);
  await sleep(1500);
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
  console.log(JSON.stringify({ dataDir, artifacts, steps }));
  process.exitCode = requiredFailure ? 1 : 0;
}
