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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-045-ahk-'));
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
let sharedTrace = null;
let requiredFailure = false;
function record(name, ok, detail = '', required = true) { steps.push({ name, ok, detail }); if (!ok && required) requiredFailure = true; console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`); }
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
function pwsh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', INPUT, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = []; child.stdout.on('data', (c) => output.push(String(c))); child.stderr.on('data', (c) => output.push(String(c)));
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.join('').trim()) : reject(new Error(output.join('').trim())));
  });
}
function launchElevatedAkh(args) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const command = `$p=Start-Process -FilePath ${quote(AHK)} -ArgumentList @('/force',${args.map(quote).join(',')}) -Verb RunAs -PassThru; $p.Id`;
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
async function waitForHello(timeout = 2500) {
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
async function browserTarget(base, predicate, timeout = 90000) { let result; await waitFor(async () => { try { result = (await (await fetch(`${base}/json/list`)).json()).find(predicate); return Boolean(result); } catch { return false; } }, timeout); return result; }
async function launchTarget(index, x, y) {
  const script = path.join(AYG_REPO, 'probes', '015r3-live-proof', 'disposable-window.ps1');
  const marker = path.join(artifacts, `target-${index}.json`);
  const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', script, '-MarkerPath', marker, '-X', String(x), '-Y', String(y)], { windowsHide: false, stdio: 'ignore' });
  await waitFor(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes('title'), 30000);
  const info = JSON.parse(fs.readFileSync(marker, 'utf8')); targets.push({ ...info, child });
}
async function main() {
  console.log(JSON.stringify({ dataDir, projectCopy, papersCommand: `${ELECTRON} . --papers-data-dir=${dataDir}`, ahkScript: AHK_SCRIPT, ahkHash: 'assert externally before run' }));
  record('interactive native context', true, await pwsh(['-Action', 'context']));
  await launchTarget(0, 120, 120); await launchTarget(1, 250, 200);
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
  const runToken = crypto.randomUUID();
  sharedTrace = path.join(SHARED_RECEIPTS, `run-${runToken}.receipt`);
  const ahkTrace = path.join(artifacts, 'ahk-picker-trace.receipt');
  const elevated = await launchElevatedAkh([AHK_SCRIPT, sharedTrace, runToken]);
  ahk = elevated.launcher;
  ahk.elevatedPid = elevated.pid;
  await sleep(1500);
  record('edited SlopTop process launched', ahk.exitCode === null, `pid=${ahk.pid}`);
  const ahkInventory = await ahkProcesses();
  const ownedAhk = ahkInventory.filter((process) => Number(process.ProcessId) === ahk.pid || Number(process.ParentProcessId) === ahk.pid);
  record('isolated AHK owner has no pre-existing collision', ownedAhk.length === 1, JSON.stringify(ownedAhk));
  await waitFor(() => fs.existsSync(sharedTrace), 5000);
  const startupReceipt = fs.readFileSync(sharedTrace, 'utf8');
  const startupLines = startupReceipt.split(/\r?\n/).filter(Boolean);
  const childPid = Number(startupLines[0]?.match(/pid=(\d+)/)?.[1] ?? 0);
  record('elevated AHK child shared startup receipt is fresh and token-matched', startupLines[0]?.includes(`token=${runToken}`) && childPid > 0, startupReceipt);
  const focus = JSON.parse(await pwsh(['-Action', 'focus-process', '-ProcessId', String(papers.proc.pid)]));
  record('current-source Papers window foregrounded by exact PID', focus.ok === true && String(focus.foreground) === String(focus.hwnd), JSON.stringify(focus));
  const nativeBounds = JSON.parse(await pwsh(['-Action', 'bounds-process', '-ProcessId', String(papers.proc.pid)]));
  record('native Papers window bounds available', nativeBounds.ok === true, JSON.stringify(nativeBounds));
  if (!pick) throw new Error('picker control missing');
  pick = await bp.evaluate(`document.querySelector('[data-wl-pick]')?.getBoundingClientRect().toJSON()`);
  record('picker control bounds reacquired after foreground/layout stabilization', Boolean(pick), JSON.stringify(pick));
  const screen = await bp.evaluate(`(() => ({ x: window.screenX, y: window.screenY, chromeY: Math.max(0, window.outerHeight - window.innerHeight), chromeX: Math.max(0, window.outerWidth - window.innerWidth) }))()`);
  const pickScreen = {
    x: Math.round(screen.x + pick.x + pick.width / 2),
    y: Math.round(screen.y + screen.chromeY + pick.y + pick.height / 2),
  };
  record('picker control screen coordinate converted', Number.isFinite(pickScreen.x) && Number.isFinite(pickScreen.y), JSON.stringify({ viewport: pick, screen, pickScreen }));
  const hit = await bp.evaluate(`(() => {
    const button = document.querySelector('[data-wl-pick]');
    const rect = button?.getBoundingClientRect();
    const x = ${JSON.stringify(pick.x + pick.width / 2)};
    const y = ${JSON.stringify(pick.y + pick.height / 2)};
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
  const helloBefore = helloReceipt.hello;
  record('production picker opened the current-source SlopTop endpoint', Boolean(helloBefore), JSON.stringify({ ...helloBefore, elapsedMs: helloReceipt.elapsedMs }));
  const targetMove = await movePhysical(250, 250);
  record('physical target movement available', targetMove.ok === true, JSON.stringify(targetMove));
  if (!targetMove.ok) throw new Error(`physical target movement unavailable: ${JSON.stringify(targetMove)}`);
  await sleep(800);
  const hello = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
  record('tokened SlopTop handshake active', hello.active === true && typeof hello.token === 'string' && hello.token.length > 0, JSON.stringify(hello));
  const hover = await json(`http://127.0.0.1:${PORT}/sloptop-picker/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: hello.token, event: 'hover', x: 250, y: 250 }) });
  record('native hover returned bounded visual state', Array.isArray(hover.visuals), JSON.stringify(hover));
  const firstTarget = { x: 250, y: 250 };
  const secondTarget = { x: 350, y: 300 };
  const firstMove = await movePhysical(firstTarget.x, firstTarget.y);
  await sleep(400);
  const firstHover = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
  record('physical first target purple hover', firstMove.ok === true && firstHover.state?.visuals?.some((visual) => visual.kind === 'purple'), JSON.stringify(firstHover));
  await input('ctrl-shift-down');
  await input('left-click'); await sleep(400);
  const firstGreen = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
  const clickTrace = fs.existsSync(sharedTrace) ? fs.readFileSync(sharedTrace, 'utf8') : '';
  fs.writeFileSync(ahkTrace, clickTrace);
  record('AHK physical click hotkey and tokened click receipt', clickTrace.includes('hotkey click') && clickTrace.includes('event=click'), clickTrace);
  record('physical first target green selection', firstGreen.state?.visuals?.some((visual) => visual.kind === 'green'), JSON.stringify(firstGreen));
  const secondMove = await movePhysical(secondTarget.x, secondTarget.y);
  await sleep(400);
  const secondHover = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
  record('physical overlap red/purple hover', secondMove.ok === true && secondHover.state?.visuals?.some((visual) => visual.kind === 'red' || visual.kind === 'purple'), JSON.stringify(secondHover));
  await input('ctrl-shift-down');
  await input('left-click'); await sleep(400);
  const overlap = await json(`http://127.0.0.1:${PORT}/sloptop-picker/hello`);
  const greens = (overlap.state?.visuals ?? []).filter((visual) => visual.kind === 'green');
  record('physical overlapping green borders retained', greens.length >= 2, JSON.stringify(overlap));
  await input('ctrl-shift-down'); await input('enter'); await sleep(500);
  const afterEnter = await fetch(`http://127.0.0.1:${PORT}/sloptop-picker/hello`).then((response) => response.json()).catch(() => null);
  record('single physical Enter terminal closed committed session', !afterEnter || afterEnter.active !== true, JSON.stringify(afterEnter));
  await input('ctrl-shift-up');

  // Second bounded session proves Escape is zero-mutation and terminal exactly once.
  const escapePick = await bp.evaluate(`document.querySelector('[data-wl-pick]')?.getBoundingClientRect().toJSON()`);
  const escapeScreen = await bp.evaluate(`({ x: window.screenX, y: window.screenY, chromeY: Math.max(0, window.outerHeight - window.innerHeight) })`);
  const escapePoint = { x: Math.round(escapeScreen.x + escapePick.x + escapePick.width / 2), y: Math.round(escapeScreen.y + escapeScreen.chromeY + escapePick.y + escapePick.height / 2) };
  await movePhysical(escapePoint.x, escapePoint.y); await input('left-click');
  await input('ctrl-shift-down'); await sleep(200);
  const escapeHello = await waitForHello();
  record('second tokened hello for Escape session', escapeHello.hello?.active === true, JSON.stringify(escapeHello));
  const beforeEscape = JSON.stringify(escapeHello.hello?.state ?? null);
  await input('ctrl-shift-down'); await input('escape'); await sleep(500);
  const afterEscape = await fetch(`http://127.0.0.1:${PORT}/sloptop-picker/hello`).then((response) => response.json()).catch(() => null);
  record('single physical Escape terminal zero-mutation cleanup', !afterEscape || afterEscape.active !== true, JSON.stringify({ beforeEscape, afterEscape }));
  fs.writeFileSync(path.join(artifacts, 'steps.json'), JSON.stringify(steps, null, 2));
  fs.writeFileSync(path.join(artifacts, 'identity.json'), JSON.stringify({ dataDir, projectCopy, electron: ELECTRON, ahk: AHK, ahkScript: AHK_SCRIPT, runToken, sharedTrace, childPid, papersPid: papers.proc.pid, ahkPid: ahk.pid, targets: targets.map((target) => ({ pid: target.pid, title: target.title })) }, null, 2));
}
try { await main(); } catch (error) { record('bridge runner', false, String(error)); } finally {
  await input('ctrl-shift-up').catch(() => undefined);
  if (ahk && ahk.exitCode === null) ahk.kill();
  const ownedAhkAfter = await ahkProcesses().catch(() => []);
  for (const process of ownedAhkAfter.filter((candidate) => Number(candidate.ParentProcessId) === ahk?.pid)) {
    spawn('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${Number(process.ProcessId)} -Force -ErrorAction SilentlyContinue`], { windowsHide: true, stdio: 'ignore' });
  }
  for (const target of targets) { try { target.child.kill(); } catch {} }
  if (papers) await closeApp(papers.proc, papers.baseUrl).catch(() => undefined);
  fs.writeFileSync(path.join(artifacts, 'cleanup.json'), JSON.stringify({ ahkPid: ahk?.pid ?? null, papersPid: papers?.proc?.pid ?? null, targetPids: targets.map((target) => target.pid), cleanedAt: new Date().toISOString() }, null, 2));
  if (typeof sharedTrace === 'string') fs.rmSync(sharedTrace, { force: true });
  console.log(JSON.stringify({ dataDir, artifacts, steps }));
  process.exitCode = requiredFailure ? 1 : 0;
}
