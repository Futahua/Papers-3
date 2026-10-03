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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-062-second-'));
const projectCopy = path.join(dataDir, 'ayg-project-copy');
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
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const command = `$p=Start-Process -FilePath ${quote('C:\\Windows\\System32\\taskkill.exe')} -ArgumentList @('/F','/T','/PID',${pid}) -Verb RunAs -Wait -PassThru; $p.ExitCode`;
  await new Promise((resolve) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    child.on('close', resolve);
  });
}
function pwsh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', INPUT, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = []; child.stdout.on('data', (c) => output.push(String(c))); child.stderr.on('data', (c) => output.push(String(c)));
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.join('').trim()) : reject(new Error(output.join('').trim())));
  });
}
function launchElevatedAkh(args) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const command = `$env:SLOPTOP_PICKER_ISOLATED='1'; $p=Start-Process -FilePath ${quote(AHK)} -ArgumentList @('/force',${args.map(quote).join(',')}) -Verb RunAs -PassThru; $p.Id`;
  return new Promise((resolve, reject) => {
    const launcher = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    launcher.stdout.on('data', (chunk) => chunks.push(String(chunk)));
    launcher.stderr.on('data', (chunk) => chunks.push(String(chunk)));
    launcher.on('error', reject);
    launcher.on('close', (code) => {
      const pid = Number(chunks.join('').trim());
      if (code !== 0 || !pid) reject(new Error(`elevated AHK launch failed: ${chunks.join('')}`));
      else resolve({ launcher, pid });
    });
  });
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
async function main() {
  console.log(JSON.stringify({ dataDir, projectCopy, papersCommand: `${ELECTRON} . --papers-data-dir=${dataDir}`, ahkScript: AHK_SCRIPT }));
  record('interactive native context', true, await pwsh(['-Action', 'context']));
  await launchTarget(0, 60, 60);
  await launchTarget(1, 320, 160);
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
  let pick = await bp.evaluate(`document.querySelector('[data-wl-pick]')?.getBoundingClientRect().toJSON()`);
  record('isolated current-source Papers/As You Go pair entered', Boolean(pick), JSON.stringify(pick));
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
  const nativeBounds = JSON.parse(await pwsh(['-Action', 'bounds-process', '-ProcessId', String(papers.proc.pid)]));
  record('native Papers window bounds available', nativeBounds.ok === true, JSON.stringify(nativeBounds));
  const pickFresh = await freshPickPoint(bp);
  record('picker control reacquired (not stale)', Boolean(pickFresh.pick && pickFresh.pick.attached && pickFresh.pick.hitClosest === pickFresh.pick.wlPick && !pickFresh.pick.disabled), JSON.stringify(pickFresh));
  const pickScreen = pickFresh.point;
  record('picker control screen coordinate converted (fresh)', Number.isFinite(pickScreen?.x) && Number.isFinite(pickScreen?.y), JSON.stringify(pickFresh));
  const hit = await bp.evaluate(`(() => {
    const button = document.querySelector('[data-wl-pick]');
    const rect = button?.getBoundingClientRect();
    const x = ${JSON.stringify((pickFresh.pick?.rect.x ?? 0) + (pickFresh.pick?.rect.width ?? 0) / 2)};
    const y = ${JSON.stringify((pickFresh.pick?.rect.y ?? 0) + (pickFresh.pick?.rect.height ?? 0) / 2)};
    const element = document.elementFromPoint(x, y);
    const describe = (node) => node ? { tag: node.tagName, id: node.id, classes: node.className, wlPick: node.getAttribute?.('data-wl-pick'), pointerEvents: getComputedStyle(node).pointerEvents, zIndex: getComputedStyle(node).zIndex, attached: document.contains(node), rect: node.getBoundingClientRect?.().toJSON?.() } : null;
    const closest = element?.closest?.('[data-wl-pick]');
    return { point: { x, y }, intended: describe(button), actual: describe(element), closest: describe(closest), bodyPlaceholder: Boolean(document.querySelector('.window-layout-body[data-wl-layout]')?.closest('[aria-disabled="true"]')) };
  })()`);
  record('DOM hit target bubbles to intended direct-picker control', hit.closest?.wlPick === hit.intended?.wlPick && hit.intended?.wlPick, JSON.stringify(hit));
  const moveResult = await movePhysical(pickScreen.x, pickScreen.y);
  record('physical cursor movement available', moveResult.ok === true, JSON.stringify(moveResult));
  if (!moveResult.ok) throw new Error(`physical cursor movement unavailable: ${JSON.stringify(moveResult)}`);
  await input('left-click');
  await input('ctrl-shift-down');
  const helloReceipt = await waitForHello();
  record('production picker opened the current-source SlopTop endpoint', Boolean(helloReceipt.hello), JSON.stringify({ ...helloReceipt.hello, elapsedMs: helloReceipt.elapsedMs }));
  const hello = helloReceipt.hello;
  record('tokened SlopTop handshake active', hello.active === true && typeof hello.token === 'string' && hello.token.length > 0, JSON.stringify(hello));

  const targetA = { move: { x: 150, y: 120 } };
  const targetB = { move: { x: 500, y: 220 } };

  // purple hover on unselected target A
  const firstMove = await movePhysical(targetA.move.x, targetA.move.y);
  const firstHover = await waitForVisuals((visuals) => visuals.some((v) => v.kind === 'purple' && isBounded(v)));
  record('physical first target purple hover', firstMove.ok === true && firstHover.state?.state?.visuals?.some((v) => v.kind === 'purple' && isBounded(v)), JSON.stringify(firstHover.state));
  await input('left-click');
  const clickDispatch = await waitForTraceContains('event=click', 15000);
  const firstGreen = await waitForVisuals((visuals) => distinctGeometries(visuals, 'green').length >= 1);
  const clickTrace = await readSharedTrace();
  fs.writeFileSync(ahkTrace, clickTrace);
  record('AHK physical click dispatched and tokened click receipt', clickDispatch && clickTrace.includes('hotkey click') && clickTrace.includes('event=click'), clickTrace);
  const firstGreenGeoms = distinctGeometries(firstGreen.state?.state?.visuals ?? [], 'green');
  record('physical first target green persistent selection (green + red hover allowed)', firstGreenGeoms.length === 1, JSON.stringify(firstGreen.state));

  // select overlapping target B so A+B both green
  const secondMove = await movePhysical(targetB.move.x, targetB.move.y);
  const secondHover = await waitForVisuals((visuals) => visuals.some((v) => v.kind === 'purple' && isBounded(v)));
  record('physical second target (B) purple hover', secondMove.ok === true && secondHover.state?.state?.visuals?.some((v) => v.kind === 'purple' && isBounded(v)), JSON.stringify(secondHover.state));
  await input('left-click');
  await waitForTraceContains('event=click', 15000);
  const overlapState = await waitForVisuals((visuals) => distinctGeometries(visuals, 'green').length >= 2);
  const overlapGreens = distinctGeometries(overlapState.state?.state?.visuals ?? [], 'green');
  record('two distinct overlapping green borders retained (A+B)', overlapGreens.length >= 2, JSON.stringify(overlapState.state));

  // red hover + deselect A
  const redMove = await movePhysical(targetA.move.x, targetA.move.y);
  const redHover = await waitForVisuals((visuals) => visuals.some((v) => v.kind === 'red'));
  record('faint red hover on selected target A', redMove.ok === true && redHover.state?.state?.visuals?.some((v) => v.kind === 'red'), JSON.stringify(redHover.state));
  await input('left-click');
  await waitForTraceContains('event=click', 15000);
  const deselect = await waitForVisuals((visuals) => distinctGeometries(visuals, 'green').length === 1);
  const postDeselectGreens = distinctGeometries(deselect.state?.state?.visuals ?? [], 'green');
  record('click on selected target A deselects it (exactly one distinct green remains)', postDeselectGreens.length === 1, JSON.stringify(deselect.state));
  await input('ctrl-shift-up');

  // one Enter commit terminal
  await input('ctrl-shift-down'); await input('enter'); await sleep(500);
  const afterEnter = await fetch(`http://127.0.0.1:${PORT}/sloptop-picker/hello`).then((response) => response.json()).catch(() => null);
  record('single physical Enter terminal closed committed session', !afterEnter || afterEnter.active !== true, JSON.stringify(afterEnter));
  await input('ctrl-shift-up');
  await sleep(800);

  // SECOND ACTIVATION: wait for DOM/control readiness, reacquire fresh picker button + coordinate
  let secondReady = null;
  try {
    await waitFor(() => (async () => {
      const f = await freshPickPoint(bp);
      return Boolean(f.pick && f.pick.attached && f.pick.hitClosest === f.pick.wlPick && !f.pick.disabled);
    })(), 15000);
    secondReady = await freshPickPoint(bp);
  } catch { secondReady = await freshPickPoint(bp); }
  record('second activation control ready (fresh, attached, hit, enabled)', Boolean(secondReady?.pick && secondReady.pick.attached && secondReady.pick.hitClosest === secondReady.pick.wlPick && !secondReady.pick.disabled), JSON.stringify(secondReady));
  const secondPoint = secondReady?.point;
  const secondMoveClick = secondPoint ? await movePhysical(secondPoint.x, secondPoint.y) : { ok: false };
  await input('left-click');
  await input('ctrl-shift-down'); await sleep(300);
  const secondHello = await waitForHello().then((r) => ({ ...r, ok: true })).catch((e) => ({ hello: null, ok: false, error: String(e) }));
  record('second picker activation produced tokened hello', secondHello.ok === true && secondHello.hello?.active === true, JSON.stringify(secondHello));

  if (secondHello.ok === true && secondHello.hello?.active === true) {
    const beforeEscape = JSON.stringify(secondHello.hello?.state ?? null);
    await input('ctrl-shift-down'); await sleep(200);
    await input('escape'); await sleep(500);
    await input('ctrl-shift-up');
    const afterEscape = await fetch(`http://127.0.0.1:${PORT}/sloptop-picker/hello`).then((response) => response.json()).catch(() => null);
    record('single physical Escape terminal zero-mutation cleanup', !afterEscape || afterEscape.active !== true, JSON.stringify({ beforeEscape, afterEscape }));
  }
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
  console.log(JSON.stringify({ dataDir, artifacts, steps }));
  process.exitCode = requiredFailure ? 1 : 0;
}
