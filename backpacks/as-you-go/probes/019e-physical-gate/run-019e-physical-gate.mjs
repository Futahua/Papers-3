/**
 * 019E EXCLUSIVE PHYSICAL-INPUT FINAL GATE.
 *
 * NEW isolated runner for the three rows deferred by 019E. This file really
 * moves the OS cursor and sends OS click/Enter/Escape. Never run it while the
 * desktop is shared. Importing it is inert; only direct execution calls main().
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { connectToTarget, freePort, launchPapers, sleep } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LEGACY = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LEGACY, 'control-window.ps1');
const DISPOSABLE = path.join(LEGACY, 'disposable-window.ps1');
const INPUT = path.join(AYG_REPO, 'probes', '019e-physical-gate', 'physical-input.ps1');
const OUT = path.join(AYG_REPO, 'probes', '019e-physical-gate');
const TRANSCRIPT = path.join(OUT, 'proof-019e-physical-transcript.txt');
const APP_LOG = path.join(OUT, 'proof-019e-physical-app.log');
const PHYSICAL_BUDGET_MS = 150_000;

const steps = [];
let failures = 0;
function record(name, ok, detail = '') {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function runPwsh(args, timeoutMs = 120_000) {
  const argv = typeof args === 'string' ? ['-NoProfile', '-NonInteractive', '-Command', args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(PW, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(String(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(String(chunk)));
    const timer = setTimeout(() => { child.kill(); reject(new Error('PowerShell timeout')); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = chunks.join('').trim();
      if (code !== 0) reject(new Error(`PowerShell ${code}: ${output.slice(0, 500)}`));
      else resolve(output);
    });
  });
}

async function ctl(args) {
  return JSON.parse(await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, ...args]));
}
async function physical(action, args = []) {
  return JSON.parse(await runPwsh(['-NoProfile', '-NonInteractive', '-File', INPUT, '-Action', action, ...args], 30_000));
}

async function allProcesses() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, @{n='CreationDate';e={if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { '' }}}, Name, CommandLine | ConvertTo-Json -Compress`);
  const value = raw ? JSON.parse(raw) : [];
  return Array.isArray(value) ? value : [value];
}
function identity(process) {
  return `${Number(process.ProcessId)}:${String(process.CreationDate ?? '')}`;
}
function descendantPids(rootPid, processes) {
  const children = new Map();
  for (const process of processes) {
    const parent = Number(process.ParentProcessId);
    const pid = Number(process.ProcessId);
    if (!Number.isFinite(parent) || !Number.isFinite(pid)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const descendants = new Set([Number(rootPid)]);
  const queue = [Number(rootPid)];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const child of children.get(parent) ?? []) {
      if (!descendants.has(child)) { descendants.add(child); queue.push(child); }
    }
  }
  return descendants;
}
function exactProcessSet(processes) {
  return processes.map(identity).sort();
}
function creatorPapers(processes) {
  return processes.filter((process) => String(process.Name).toLowerCase() === 'papers.exe');
}
function helperProcesses(processes) {
  return processes.filter((process) => typeof process.CommandLine === 'string'
    && process.CommandLine.includes('window-helper.ps1'));
}
async function stopExactProcess(process) {
  const pid = Number(process.ProcessId);
  const creationDate = String(process.CreationDate ?? '').replace(/'/g, "''");
  if (!Number.isFinite(pid) || pid <= 0 || !creationDate) return false;
  const result = await runPwsh(`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($p -and $p.CreationDate -and $p.CreationDate.ToString('o') -eq '${creationDate}') { Stop-Process -Id ${pid} -Force -ErrorAction Stop; 'stopped' } else { 'identity-mismatch' }`).catch(() => 'failed');
  return result.trim() === 'stopped';
}

async function displayPlan() {
  const raw = await runPwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $b=$_.Bounds; $w=$_.WorkingArea; [pscustomobject]@{ primary=$_.Primary; x=$b.X; y=$b.Y; width=$b.Width; height=$b.Height; workX=$w.X; workY=$w.Y; workWidth=$w.Width; workHeight=$w.Height } } | ConvertTo-Json -Compress`);
  const parsed = JSON.parse(raw);
  const displays = Array.isArray(parsed) ? parsed : [parsed];
  const primary = displays.find((display) => display.primary) ?? displays[0];
  if (!primary || primary.workWidth < 1200 || primary.workHeight < 760) {
    throw new Error(`primary work area is too small for four isolated targets: ${JSON.stringify(primary)}`);
  }
  const marginX = Math.max(40, Math.floor(primary.workWidth * 0.055));
  const marginY = Math.max(40, Math.floor(primary.workHeight * 0.065));
  const gapX = Math.max(100, Math.floor(primary.workWidth * 0.13));
  const gapY = Math.max(90, Math.floor(primary.workHeight * 0.12));
  const width = Math.min(420, Math.floor((primary.workWidth - (2 * marginX) - gapX) / 2));
  const height = Math.min(300, Math.floor((primary.workHeight - (2 * marginY) - gapY) / 2));
  if (width < 320 || height < 230) throw new Error('computed disposable target rectangles are too small');
  const left = primary.workX + marginX;
  const right = primary.workX + primary.workWidth - marginX - width;
  const top = primary.workY + marginY;
  const bottom = primary.workY + primary.workHeight - marginY - height;
  return {
    displays,
    primary,
    width,
    height,
    positions: [{ x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }, { x: right, y: bottom }],
  };
}

function waitForMarker(markerPath) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const timer = setInterval(() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        if (parsed?.pid && parsed?.title) { clearInterval(timer); resolve(parsed); return; }
      } catch { /* marker absent or partially written */ }
      if (Date.now() >= deadline) { clearInterval(timer); reject(new Error(`marker timeout: ${markerPath}`)); }
    }, 200);
  });
}

let aborted = false;
let abortReason = '';
let externalInterference = false;
let emergencyPromise = null;
async function waitFor(probe, timeoutMs, label, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (aborted) throw new Error(`exclusive gate aborted: ${abortReason}`);
    try { if (await probe()) return; } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (${String(lastError).slice(0, 300)})` : ''}`);
}

async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}
async function overlayTargets(baseUrl) {
  return (await targetList(baseUrl)).filter((target) => target.url.startsWith('data:text/html'));
}
async function overlayBounds(client) {
  return client.evaluate(`({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })`);
}
function contains(bounds, point) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width
    && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}
async function overlayForPoint(baseUrl, point) {
  for (const target of await overlayTargets(baseUrl)) {
    const client = await connectToTarget(target, baseUrl).catch(() => null);
    if (!client) continue;
    try {
      if (await client.evaluate(`typeof window.pickOverlay === 'object'`)) {
        const bounds = await overlayBounds(client);
        if (contains(bounds, point)) return { target, client, bounds };
      }
    } catch { /* stale overlay */ }
    client.close();
  }
  return null;
}
async function waitOverlayForPoint(baseUrl, point) {
  let found = null;
  await waitFor(async () => { found = await overlayForPoint(baseUrl, point); return Boolean(found); }, 10_000, `overlay containing ${point.x},${point.y}`);
  return found;
}
async function waitNoOverlays(baseUrl) {
  await waitFor(async () => (await overlayTargets(baseUrl)).length === 0, 10_000, 'picker overlays destroyed');
}
async function armOverlay(baseUrl, point) {
  const found = await waitOverlayForPoint(baseUrl, point);
  await found.client.evaluate(`(() => {
    window.__physicalStates = [];
    window.pickOverlay.onState((state) => window.__physicalStates.push(JSON.parse(JSON.stringify(state))));
    return true;
  })()`);
  return found;
}
async function latestState(client) {
  return client.evaluate(`window.__physicalStates?.at(-1) ?? null`);
}
function sameRect(actual, expected, tolerance = 2) {
  return actual && ['x', 'y', 'width', 'height'].every((key) => Math.abs(Number(actual[key]) - Number(expected[key])) <= tolerance);
}
async function waitHover(client, bounds, kind) {
  let value = null;
  await waitFor(async () => {
    value = await latestState(client);
    return value?.hover?.kind === kind && sameRect(value.hover, bounds);
  }, 8_000, `${kind} hover for ${JSON.stringify(bounds)}`);
  return value;
}
async function waitStaged(client, expected) {
  let value = null;
  await waitFor(async () => {
    value = await latestState(client);
    return expected.every(({ bounds, kind }) => (value?.staged ?? [])
      .some((stage) => stage.kind === kind && sameRect(stage, bounds)));
  }, 8_000, `staged ${expected.map((item) => item.kind).join('+')}`);
  return value;
}
function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
function members(statePath) {
  return readState(statePath)?.windowLayouts?.[0]?.arrangement?.members ?? [];
}
function memberTitles(statePath) {
  return members(statePath).map((member) => member.descriptor.title);
}
function sameTitles(actual, expected) {
  return actual.length === expected.length && actual.every((title, index) => title === expected[index]);
}
async function screenshot(client, name) {
  const result = await client.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (!result?.data) return;
  const directory = path.join(OUT, 'shots');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

let dataDir = null;
let projectCopy = null;
let statePath = null;
let session = null;
let bp = null;
let widget = null;
let isolatedRoot = null;
const ownedIdentityAllowlist = new Map();
const targets = [];
const targetProcesses = [];
let creatorBefore = [];
let helpersBefore = [];
let originalDesktop = null;
let watchdogTimer = null;
let watchdogBusy = false;
let expectedCursor = null;
let movementGraceUntil = 0;
let cursorCommandInFlight = false;
let physicalStartedAt = 0;
const allowedForeground = new Map();

async function refreshOwned() {
  if (!isolatedRoot) return;
  const processes = await allProcesses();
  const descendants = descendantPids(isolatedRoot, processes);
  for (const process of processes) {
    const pid = Number(process.ProcessId);
    if (descendants.has(pid)) {
      ownedIdentityAllowlist.set(pid, identity(process));
      allowedForeground.set(pid, identity(process));
    }
  }
}
async function emergencyStop() {
  if (emergencyPromise) return emergencyPromise;
  emergencyPromise = (async () => {
    if (session) {
      await refreshOwned().catch(() => undefined);
      const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
      await closeApp(session.proc, session.baseUrl).catch(() => undefined);
      session = null;
    }
    for (const target of targets) {
      await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
    }
  })();
  return emergencyPromise;
}
function tripAbort(reason, external = false) {
  if (aborted) return;
  aborted = true;
  abortReason = reason;
  externalInterference ||= external;
  console.error(`ABORT - ${reason}`);
  void emergencyStop();
}
async function watchdogTick() {
  if (watchdogBusy || aborted || physicalStartedAt === 0) return;
  watchdogBusy = true;
  try {
    if (Date.now() - physicalStartedAt > PHYSICAL_BUDGET_MS) {
      tripAbort('physical-input phase exceeded 150 seconds');
      return;
    }
    const snapshot = await physical('snapshot');
    if (expectedCursor && !cursorCommandInFlight && Date.now() > movementGraceUntil
      && (Math.abs(snapshot.cursor.x - expectedCursor.x) > 3 || Math.abs(snapshot.cursor.y - expectedCursor.y) > 3)) {
      tripAbort(`external cursor movement (expected ${expectedCursor.x},${expectedCursor.y}; saw ${snapshot.cursor.x},${snapshot.cursor.y})`, true);
      return;
    }
    const foreground = snapshot.foreground;
    if (foreground.pid !== 0) {
      const expectedIdentity = allowedForeground.get(Number(foreground.pid));
      const currentIdentity = `${Number(foreground.pid)}:${String(foreground.creationDate ?? '')}`;
      if (expectedIdentity !== currentIdentity) {
        tripAbort(`unexpected foreground identity ${currentIdentity} (${foreground.title})`, true);
        return;
      }
    }
    for (const target of targets) {
      const bounds = await ctl(['-Title', target.title, '-Action', 'get-bounds']).catch(() => null);
      if (!bounds || !Number.isFinite(bounds.x)) {
        tripAbort(`disposable target vanished: ${target.title}`);
        return;
      }
    }
  } catch (error) {
    tripAbort(`watchdog observation failed: ${String(error).slice(0, 250)}`);
  } finally {
    watchdogBusy = false;
  }
}
async function moveCursor(point) {
  expectedCursor = { ...point };
  cursorCommandInFlight = true;
  try {
    const result = await physical('move', ['-X', String(point.x), '-Y', String(point.y)]);
    if (result.cursor.x !== point.x || result.cursor.y !== point.y) {
      tripAbort(`cursor did not land at commanded point ${point.x},${point.y}`);
      throw new Error(abortReason);
    }
  } finally {
    cursorCommandInFlight = false;
    movementGraceUntil = Date.now() + 650;
  }
  await sleep(250);
}
async function requireOwnedForeground(action) {
  const snapshot = await physical('snapshot');
  const foreground = snapshot.foreground;
  const currentIdentity = `${Number(foreground.pid)}:${String(foreground.creationDate ?? '')}`;
  if (ownedIdentityAllowlist.get(Number(foreground.pid)) !== currentIdentity) {
    tripAbort(`refusing ${action}: isolated workspace/test-app is not foreground (saw ${currentIdentity} ${foreground.title})`);
    throw new Error(abortReason);
  }
  return snapshot;
}
async function realKey(key) {
  await requireOwnedForeground(`real OS ${key}`);
  await physical(key);
  await sleep(180);
}

async function workspaceKey(key) {
  if (!bp) throw new Error('workspace target is unavailable for keyboard input');
  await bp.send('Page.bringToFront');
  await sleep(120);
  const root = (await allProcesses()).find((process) => Number(process.ProcessId) === Number(isolatedRoot));
  if (!root) throw new Error('isolated workspace root disappeared before keyboard input');
  await physical('focus', ['-ProcessId', String(isolatedRoot), '-CreationDate', String(root.CreationDate)]);
  await bp.send('Page.bringToFront');
  await sleep(120);
  await realKey(key);
}

async function widgetKey(key) {
  if (!widget) throw new Error('widget target is unavailable for keyboard input');
  await widget.send('Page.bringToFront');
  await focusWidgetNative();
  await sleep(120);
  await realKey(key);
}

async function focusTarget(client) {
  await client.send('Page.bringToFront');
  await sleep(120);
}

async function focusWorkspace() {
  await focusTarget(bp);
  const root = (await allProcesses()).find((process) => Number(process.ProcessId) === Number(isolatedRoot));
  if (!root) throw new Error('isolated workspace root disappeared before picker launch');
  await physical('focus', ['-ProcessId', String(isolatedRoot), '-CreationDate', String(root.CreationDate)]);
  await bp.send('Page.bringToFront');
  await sleep(120);
}

async function focusWidgetNative() {
  const bounds = await widget.evaluate(`({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight })`);
  const raw = await runPwsh(`. '${path.join(AYG_REPO, 'probes', 'native-window', 'window-capability.ps1').replace(/'/g, "''")}'; @(Get-AygVisibleWindows | Where-Object { $_.Bounds -and [math]::Abs($_.Bounds.Left - ${Math.round(bounds.x)}) -le 5 -and [math]::Abs($_.Bounds.Top - ${Math.round(bounds.y)}) -le 5 -and [math]::Abs($_.Bounds.Width - ${Math.round(bounds.width)}) -le 5 -and [math]::Abs($_.Bounds.Height - ${Math.round(bounds.height)}) -le 5 }) | Select-Object RuntimeId,ProcessId | ConvertTo-Json -Compress`);
  const windows = raw ? JSON.parse(raw) : [];
  const candidates = Array.isArray(windows) ? windows : [windows];
  const candidate = candidates.find((window) => {
    const pid = Number(window.ProcessId);
    return ownedIdentityAllowlist.has(pid);
  });
  if (!candidate) throw new Error(`isolated widget native window not found at ${JSON.stringify(bounds)}`);
  const hwnd = Number(candidate.RuntimeId?.value ?? candidate.RuntimeId);
  if (!Number.isFinite(hwnd) || hwnd <= 0) throw new Error(`invalid isolated widget native HWND ${JSON.stringify(candidate)}`);
  const process = (await allProcesses()).find((item) => Number(item.ProcessId) === Number(candidate.ProcessId));
  if (!process) throw new Error(`isolated widget process disappeared: ${candidate.ProcessId}`);
  await physical('focus-hwnd', ['-Hwnd', String(hwnd), '-ProcessId', String(candidate.ProcessId), '-CreationDate', String(process.CreationDate)]);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('=== 019E EXCLUSIVE PHYSICAL-INPUT GATE (DO NOT TOUCH INPUT) ===');
  try {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-019e-physical-'));
    projectCopy = path.join(dataDir, 'ayg-project-copy');
    statePath = path.join(projectCopy, 'state.json');
    // Capture before launching any probe window or isolated Papers instance;
    // setup may legitimately take foreground, but cleanup returns to this exact
    // pre-probe HWND/PID/CreationDate when it still exists.
    originalDesktop = await physical('snapshot');
    const initialProcesses = await allProcesses();
    creatorBefore = exactProcessSet(creatorPapers(initialProcesses));
    helpersBefore = exactProcessSet(helperProcesses(initialProcesses));
    record('creator Papers exact PID+CreationDate set captured (observed only)', true, JSON.stringify(creatorBefore));
    record('foreign helper exact PID+CreationDate set captured (observed only)', true, JSON.stringify(helpersBefore));

    const plan = await displayPlan();
    record('dynamic display plan discovered', true, JSON.stringify(plan));
    fs.cpSync(AYG_REPO, projectCopy, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git`)
        && !source.includes(`${path.sep}probes`)
        && !source.endsWith(`${path.sep}state.json`),
    });
    const papersData = path.join(dataDir, 'PapersData');
    fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
    fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
    fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

    for (let index = 0; index < plan.positions.length; index += 1) {
      const position = plan.positions[index];
      const marker = path.join(dataDir, `target-${index}.json`);
      const child = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE,
        '-MarkerPath', marker, '-X', String(position.x), '-Y', String(position.y)],
      { cwd: LEGACY, windowsHide: false, stdio: 'ignore' });
      targetProcesses.push(child);
      const info = await waitForMarker(marker);
      await ctl(['-Title', info.title, '-Action', 'move', '-X', String(position.x), '-Y', String(position.y),
        '-Width', String(plan.width), '-Height', String(plan.height)]);
      const bounds = await ctl(['-Title', info.title, '-Action', 'get-bounds']);
      const center = { x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) };
      if (!contains({ x: plan.primary.x, y: plan.primary.y, width: plan.primary.width, height: plan.primary.height }, center)) {
        throw new Error(`target center is outside discovered primary display: ${JSON.stringify({ info, bounds, center })}`);
      }
      targets.push({ ...info, child, bounds, center });
    }
    record('four uniquely titled disposable targets placed from dynamic display geometry', targets.length === 4,
      JSON.stringify(targets.map((target) => ({ pid: target.pid, title: target.title, bounds: target.bounds }))));

    const port = await freePort();
    session = await launchPapers(dataDir, port, APP_LOG);
    isolatedRoot = session.proc.pid;
    await refreshOwned();
    const rootProcesses = await allProcesses();
    const rootProcess = rootProcesses.find((process) => Number(process.ProcessId) === isolatedRoot);
    if (!rootProcess) throw new Error('isolated Papers root identity was not captured');
    record('isolated Papers root and exact descendant identities captured', true,
      JSON.stringify([...ownedIdentityAllowlist.values()].sort()));

    const hostTarget = await waitTarget(session.baseUrl, (target) => target.url.includes('/out/renderer/index.html'), 90_000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    const alreadyOpen = await waitTarget(session.baseUrl, (target) => target.url.startsWith('papers-backpack://'), 8_000, 'workspace').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((item) => item.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60_000, 'As you Go card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitTarget(session.baseUrl, (target) => target.url.startsWith('papers-backpack://'), 120_000, 'workspace');
    bp = await connectToTarget(projectTarget, session.baseUrl);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90_000, 'workspace ready');

    const layoutId = await createLayout(bp);
    await pickFromList(bp, layoutId, targets[0].title);
    await waitFor(() => sameTitles(memberTitles(statePath), [targets[0].title]), 30_000, 'seed member A');
    record('isolated layout seeded with A', true, layoutId);

    const prePhysicalDesktop = await physical('snapshot');
    if (Math.abs(prePhysicalDesktop.cursor.x - originalDesktop.cursor.x) > 3
      || Math.abs(prePhysicalDesktop.cursor.y - originalDesktop.cursor.y) > 3) {
      tripAbort(`cursor moved during setup (start ${originalDesktop.cursor.x},${originalDesktop.cursor.y}; now ${prePhysicalDesktop.cursor.x},${prePhysicalDesktop.cursor.y})`, true);
      throw new Error(abortReason);
    }
    expectedCursor = { ...prePhysicalDesktop.cursor };
    if (originalDesktop.foreground.pid > 0) {
      allowedForeground.set(Number(originalDesktop.foreground.pid),
        `${Number(originalDesktop.foreground.pid)}:${String(originalDesktop.foreground.creationDate ?? '')}`);
    }
    for (const target of targets) {
      const process = initialProcesses.find((candidate) => Number(candidate.ProcessId) === Number(target.pid))
        ?? (await allProcesses()).find((candidate) => Number(candidate.ProcessId) === Number(target.pid));
      if (process) allowedForeground.set(Number(target.pid), identity(process));
    }
    // Disposable PowerShell targets can expose their visible window through a
    // child process PID rather than the marker process. Admit only the exact
    // uniquely seeded target title observed during setup, never a path/name
    // pattern or an unknown foreground process.
    const setupForeground = await physical('snapshot');
    const setupTarget = targets.find((target) => target.title === setupForeground.foreground.title);
    if (setupTarget && Number(setupForeground.foreground.pid) > 0) {
      allowedForeground.set(Number(setupForeground.foreground.pid),
        `${Number(setupForeground.foreground.pid)}:${String(setupForeground.foreground.creationDate ?? '')}`);
    }
    await refreshOwned();
    physicalStartedAt = Date.now();
    watchdogTimer = setInterval(() => { void watchdogTick(); }, 500);

    // P1: the production sampler follows the real cursor across B, C, then A.
    const beforeHover = fs.readFileSync(statePath, 'utf8');
    await focusWorkspace();
    await beginWorkspacePick(bp, layoutId);
    await moveCursor(targets[1].center);
    const hoverOverlay = await armOverlay(session.baseUrl, targets[1].center);
    const hoverB = await waitHover(hoverOverlay.client, targets[1].bounds, 'add');
    await moveCursor(targets[2].center);
    const hoverC = await waitHover(hoverOverlay.client, targets[2].bounds, 'add');
    await moveCursor(targets[0].center);
    const hoverA = await waitHover(hoverOverlay.client, targets[0].bounds, 'remove');
    await screenshot(hoverOverlay.client, 'P1-real-hover-remove-A');
    const greenA = (hoverA.green ?? []).some((rect) => sameRect(rect, targets[0].bounds));
    record('P1 real cursor live hover follows B(add) -> C(add) -> A(remove), with persisted A green',
      hoverB.hover.kind === 'add' && hoverC.hover.kind === 'add' && hoverA.hover.kind === 'remove' && greenA,
      JSON.stringify({ B: hoverB.hover, C: hoverC.hover, A: hoverA.hover, green: hoverA.green }));
    hoverOverlay.client.close();
    await workspaceKey('escape');
    await waitNoOverlays(session.baseUrl);
    record('P1 Escape after hover-only traversal is byte-zero', fs.readFileSync(statePath, 'utf8') === beforeHover);
    await sleep(700);

    // P2 commit: stage B+C additions and A removal with real OS Space keys.
    await focusWorkspace();
    await beginWorkspacePick(bp, layoutId);
    await moveCursor(targets[1].center);
    const commitOverlay = await armOverlay(session.baseUrl, targets[1].center);
    const stagedCommit = [];
    for (const item of [
      { target: targets[1], kind: 'add' },
      { target: targets[2], kind: 'add' },
      { target: targets[0], kind: 'remove' },
    ]) {
      await moveCursor(item.target.center);
      await waitHover(commitOverlay.client, item.target.bounds, item.kind);
      await workspaceKey('space');
      stagedCommit.push({ bounds: item.target.bounds, kind: item.kind });
      await waitStaged(commitOverlay.client, stagedCommit);
    }
    await screenshot(commitOverlay.client, 'P2-real-click-staged-add-add-remove');
    const foregroundBeforeEnter = await physical('snapshot');
    const foregroundIdentity = `${foregroundBeforeEnter.foreground.pid}:${foregroundBeforeEnter.foreground.creationDate}`;
    record('P2 isolated workspace owns foreground before real Enter',
      ownedIdentityAllowlist.get(Number(foregroundBeforeEnter.foreground.pid)) === foregroundIdentity,
      JSON.stringify(foregroundBeforeEnter.foreground));
    commitOverlay.client.close();
     await workspaceKey('enter');
    await waitNoOverlays(session.baseUrl);
    await waitFor(() => sameTitles(memberTitles(statePath), [targets[1].title, targets[2].title]), 30_000, 'B+C commit after real Enter');
    record('P2 real Space keys stage multiple add/remove and real Enter commits exactly B+C', true,
      JSON.stringify(memberTitles(statePath)));

    // P2 cancel: stage B removal + D addition, then real Escape; raw bytes stay.
    const beforeEscape = fs.readFileSync(statePath, 'utf8');
    await focusWorkspace();
    await beginWorkspacePick(bp, layoutId);
    await moveCursor(targets[1].center);
    const escapeOverlay = await armOverlay(session.baseUrl, targets[1].center);
    const stagedEscape = [];
    for (const item of [
      { target: targets[1], kind: 'remove' },
      { target: targets[3], kind: 'add' },
    ]) {
      await moveCursor(item.target.center);
      await waitHover(escapeOverlay.client, item.target.bounds, item.kind);
       await workspaceKey('space');
      stagedEscape.push({ bounds: item.target.bounds, kind: item.kind });
      await waitStaged(escapeOverlay.client, stagedEscape);
    }
    await screenshot(escapeOverlay.client, 'P2-real-click-staged-before-escape');
    escapeOverlay.client.close();
    await workspaceKey('escape');
    await waitNoOverlays(session.baseUrl);
    const afterEscape = fs.readFileSync(statePath, 'utf8');
    record('P2 real Escape cancels a staged remove+add byte-zero', afterEscape === beforeEscape,
      JSON.stringify(memberTitles(statePath)));

    // P3: originate the same physical picker path from the compact widget.
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutId}"]').click()`);
    const widgetTarget = await waitTarget(session.baseUrl, (target) => isWidgetTarget(target, layoutId), 60_000, 'compact widget');
    widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`document.querySelectorAll('.window-layout-widget-root [data-wl-member]').length === 2`), 30_000, 'widget B+C snapshot');
    const beforeWidgetEscape = fs.readFileSync(statePath, 'utf8');
    await focusTarget(widget);
    await widget.evaluate(`document.querySelector('[data-wl-pick]').click()`);
    await moveCursor(targets[3].center);
    const widgetEscapeOverlay = await armOverlay(session.baseUrl, targets[3].center);
    const widgetEscapeStages = [];
    for (const item of [
      { target: targets[3], kind: 'add' },
      { target: targets[1], kind: 'remove' },
    ]) {
      await moveCursor(item.target.center);
      await waitHover(widgetEscapeOverlay.client, item.target.bounds, item.kind);
        await widgetKey('space');
      widgetEscapeStages.push({ bounds: item.target.bounds, kind: item.kind });
      await waitStaged(widgetEscapeOverlay.client, widgetEscapeStages);
    }
    widgetEscapeOverlay.client.close();
    await widgetKey('escape');
    await waitNoOverlays(session.baseUrl);
    record('P3 compact-widget real Escape cancels staged add+remove byte-zero',
      fs.readFileSync(statePath, 'utf8') === beforeWidgetEscape, JSON.stringify(memberTitles(statePath)));

    await focusTarget(widget);
    await widget.evaluate(`document.querySelector('[data-wl-pick]').click()`);
    await moveCursor(targets[3].center);
    const widgetCommitOverlay = await armOverlay(session.baseUrl, targets[3].center);
    const widgetCommitStages = [];
    for (const item of [
      { target: targets[3], kind: 'add' },
      { target: targets[1], kind: 'remove' },
    ]) {
      await moveCursor(item.target.center);
      await waitHover(widgetCommitOverlay.client, item.target.bounds, item.kind);
      await widgetKey('space');
      widgetCommitStages.push({ bounds: item.target.bounds, kind: item.kind });
      await waitStaged(widgetCommitOverlay.client, widgetCommitStages);
    }
    await screenshot(widgetCommitOverlay.client, 'P3-widget-real-click-staged');
    widgetCommitOverlay.client.close();
      await widgetKey('enter');
    await waitNoOverlays(session.baseUrl);
    await waitFor(() => sameTitles(memberTitles(statePath), [targets[2].title, targets[3].title]), 30_000, 'widget-origin C+D commit');
    await waitFor(() => widget.evaluate(`(() => {
      const titles = [...document.querySelectorAll('.window-layout-widget-root [data-wl-member]')]
        .map((node) => node.getAttribute('aria-label'));
      return titles.length === 2 && titles.includes(${JSON.stringify(targets[2].title)}) && titles.includes(${JSON.stringify(targets[3].title)});
    })()`), 30_000, 'widget snapshot refreshed to C+D');
    record('P3 compact-widget direct pick uses real hover/Space/Enter and workspace persists exactly C+D', true,
      JSON.stringify(memberTitles(statePath)));

    if (aborted) throw new Error(`exclusive gate aborted: ${abortReason}`);
  } catch (error) {
    record(aborted ? `ABORTED: ${abortReason}` : 'physical gate completed without exception', false, String(error).slice(0, 600));
  } finally {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    await emergencyStop().catch(() => undefined);
    for (const child of targetProcesses) {
      if (child.exitCode === null) { try { child.kill(); } catch { /* exact child already gone */ } }
    }
    await sleep(1200);
    const processes = await allProcesses().catch(() => []);
    const ownedSurvivors = processes.filter((process) => ownedIdentityAllowlist.get(Number(process.ProcessId)) === identity(process));
    for (const process of ownedSurvivors) {
      await stopExactProcess(process);
    }
    await sleep(800);
    const afterProcesses = await allProcesses().catch(() => []);
    const ownedLeft = afterProcesses.filter((process) => ownedIdentityAllowlist.get(Number(process.ProcessId)) === identity(process));
    record('cleanup has zero exact PID+CreationDate isolated survivors', ownedLeft.length === 0,
      JSON.stringify(ownedLeft.map(identity)));
    const creatorAfter = exactProcessSet(creatorPapers(afterProcesses));
    const helpersAfter = exactProcessSet(helperProcesses(afterProcesses)
      .filter((process) => ownedIdentityAllowlist.get(Number(process.ProcessId)) !== identity(process)));
    record('creator Papers exact PID+CreationDate set untouched', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter),
      `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
    record('foreign helper exact PID+CreationDate set untouched', JSON.stringify(helpersBefore) === JSON.stringify(helpersAfter),
      `before=${JSON.stringify(helpersBefore)} after=${JSON.stringify(helpersAfter)}`);
    const remainingWindows = await countProbeWindows(targets.map((target) => target.title)).catch(() => -1);
    record('cleanup has zero exact disposable windows', remainingWindows === 0, String(remainingWindows));

    if (originalDesktop && !externalInterference) {
      const restored = await physical('restore', [
        '-X', String(originalDesktop.cursor.x), '-Y', String(originalDesktop.cursor.y),
        '-Hwnd', String(originalDesktop.foreground.hwnd), '-ProcessId', String(originalDesktop.foreground.pid),
        '-CreationDate', String(originalDesktop.foreground.creationDate),
      ]).catch((error) => ({ ok: false, reason: String(error) }));
      record('original cursor restored; foreground restored only on exact surviving identity',
        restored.ok === true && restored.cursorRestored === true, JSON.stringify(restored));
    } else if (originalDesktop) {
      record('restore skipped after external input claimed the desktop', true, abortReason);
    }
  }

  const passed = steps.length - failures;
  const transcript = [
    '019E EXCLUSIVE PHYSICAL-INPUT FINAL GATE',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `external interference: ${externalInterference}`,
    '',
    ...steps.map((step) => `${step.ok ? 'PASS' : 'FAIL'} - ${step.name}${step.detail ? ` :: ${step.detail}` : ''}`),
    '',
    `FINAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed.`,
  ].join('\r\n');
  fs.writeFileSync(TRANSCRIPT, `${transcript}\r\n`);
  console.log(`=== PHYSICAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed ===`);
  if (failures > 0) process.exitCode = 1;
}

async function waitTarget(baseUrl, predicate, timeoutMs, label) {
  let found = null;
  await waitFor(async () => {
    found = (await targetList(baseUrl)).find(predicate) ?? null;
    return Boolean(found);
  }, timeoutMs, label, 350);
  return found;
}
async function createLayout(client) {
  await client.evaluate(`(() => {
    const blank = document.querySelector('#icon-grid [data-blank-parent]');
    blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
  })()`);
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10_000, 'new-layout menu');
  await client.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30_000, 'layout shell');
  return client.evaluate(`[...document.querySelectorAll('.window-layout-shell')].at(-1).querySelector('[data-wl-layout]').dataset.wlLayout`);
}
async function pickFromList(client, layoutId, title) {
  await client.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
  await waitFor(() => client.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((row) => row.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 60_000, `list row ${title}`);
  await client.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-wl-pick-candidate]')]
      .find((candidate) => candidate.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)});
    row.click();
  })()`);
}
async function beginWorkspacePick(client, layoutId) {
  await refreshOwned();
  await client.evaluate(`document.querySelector('[data-wl-pick="${layoutId}"]').click()`);
}
function isWidgetTarget(target, layoutId) {
  try {
    const url = new URL(target.url);
    return url.searchParams.get('papers-surface') === 'compact-widget'
      && (url.searchParams.get('papers-layout-key') ?? url.searchParams.get('layout-key')) === layoutId;
  } catch {
    return false;
  }
}
async function countProbeWindows(titles) {
  if (titles.length === 0) return 0;
  const encoded = JSON.stringify(titles).replace(/'/g, "''");
  const adapter = path.join(AYG_REPO, 'probes', 'native-window', 'window-capability.ps1').replace(/'/g, "''");
  const raw = await runPwsh(`. '${adapter}'; $titles=ConvertFrom-Json '${encoded}'; @(Get-AygVisibleWindows | Where-Object { $titles -contains $_.Title }).Count`);
  return Number(raw);
}

const isDirectEntry = process.argv?.[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectEntry) main();
