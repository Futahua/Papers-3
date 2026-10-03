/**
 * 015R3 LIVE RESTART DURABILITY PROOF HARNESS (rebuilt from scratch per
 * BRAIN's directive: the old run-015-live.ps1 no longer exists).
 *
 * Authority: the existing 015 creator authorization - build canonical Papers,
 * control exactly ONE uniquely titled disposable window, isolated
 * Papers/userData/project session. Nothing else is authorized.
 *
 * Sequence: build -> launch owned Papers + helper + ONE disposable target ->
 * bind -> verify persisted descriptor {version, executableFingerprint, title}
 * -> observe/auto-record -> minimize/restore with persisted state -> Activate
 * (scoped suppression) -> FULL STOP of owned Papers/helper while the target
 * stays alive -> FRESH START of owned Papers/helper -> resolve saved
 * descriptor -> verify same target + fresh bindingId + geometry applied ->
 * forbidden-key scan of isolated state.json -> cleanup to ZERO owned
 * processes/windows. Records old/new owned Papers+helper PIDs and a
 * transcript.
 *
 * Driving: raw CDP (Node 24 built-in WebSocket) against the built app's
 * --remote-debugging-port. The disposable target and control commands reuse
 * the reviewed 009/013 Win32 adapter.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Cdp, closeApp, connectToTarget, freePort, launchPapers, sleep } from './cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const PROBE_DIR = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(PROBE_DIR, 'control-window.ps1');
const DISPOSABLE = path.join(PROBE_DIR, 'disposable-window.ps1');
const TRANSCRIPT = path.join(PROBE_DIR, 'proof-015r3-transcript.txt');
const ADAPTER = path.join(AYG_REPO, 'probes', 'native-window', 'window-capability.ps1');

const FORBIDDEN_KEYS = [
  'runtimeId', 'hwnd', 'token', 'runtimeToken', 'helperToken',
  'bindingId', 'processId', 'processPath', 'candidateId', 'executable',
];

const steps = [];
let failures = 0;

function record(name, ok, detail = '') {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function assert(condition, name, detail = '') {
  record(name, !!condition, detail);
  if (!condition) throw new Error(`assertion failed: ${name}`);
}

async function waitFor(probe, timeoutMs, label, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (last error: ${String(lastError).slice(0, 400)})` : ''}`);
}

function runPwsh(args) {
  const argv = typeof args === 'string'
    ? ['-NoProfile', '-NonInteractive', '-Command', args]
    : args;
  const result = spawn(PW, argv, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  result.stdout.on('data', (chunk) => out.push(String(chunk)));
  result.stderr.on('data', (chunk) => out.push(String(chunk)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { result.kill(); reject(new Error(`pwsh timeout`)); }, 120000);
    result.on('error', (error) => { clearTimeout(timer); reject(error); });
    result.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`pwsh ${code}: ${out.join('').trim().slice(0, 500)}`));
      else resolve(out.join('').trim());
    });
  });
}

async function runPwshJson(args) {
  const raw = await runPwsh(args);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function helperPids() {
  const raw = await runPwsh(
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`,
  );
  let rows = [];
  if (raw) {
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  }
  return rows
    .filter((row) => typeof row.CommandLine === 'string' && row.CommandLine.includes('window-helper.ps1'))
    .map((row) => row.ProcessId)
    .sort();
}

async function testElectronPids(dataDir) {
  const raw = await runPwsh(
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`,
  );
  let rows = [];
  if (raw) {
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  }
  return rows
    .filter((row) => typeof row.CommandLine === 'string' && row.CommandLine.includes(dataDir))
    .map((row) => row.ProcessId)
    .sort();
}

async function waitForTarget(baseUrl, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/json/list`);
      const list = await response.json();
      const match = (Array.isArray(list) ? list : []).find(predicate);
      if (match) return match;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for target: ${label}${lastError ? ` (${String(lastError).slice(0, 200)})` : ''}`);
}

function collectKeys(value, prefix = '', out = []) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      out.push(prefix ? `${prefix}.${key}` : key);
      collectKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function scanForbiddenKeys(statePath) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const keys = collectKeys(parsed);
  const hits = keys.filter((key) => FORBIDDEN_KEYS.includes(key));
  return { keys, hits };
}

function readMember(statePath) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const layout = parsed?.windowLayouts?.[0];
  const member = layout?.arrangement?.members?.[0] ?? null;
  return { layout, member };
}

function boundsMatch(memberBounds, expected) {
  return memberBounds && expected
    && memberBounds.x === expected.x && memberBounds.y === expected.y
    && memberBounds.width === expected.width && memberBounds.height === expected.height;
}

async function captureShot(baseUrl, file) {
  try {
    const target = await waitForTarget(
      baseUrl,
      (t) => t.url.includes('/out/renderer/index.html'),
      10000,
      'host target for screenshot',
    );
    const client = await connectToTarget(target, baseUrl);
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    client.close();
    if (shot?.data) {
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return true;
    }
  } catch {
    // best-effort
  }
  return false;
}

function waitForMarker(markerPath) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const timer = setInterval(() => {
      if (fs.existsSync(markerPath)) {
        clearInterval(timer);
        try {
          resolve(JSON.parse(fs.readFileSync(markerPath, 'utf8')));
        } catch (error) {
          reject(error);
        }
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('timeout waiting for disposable window marker'));
      }
    }, 250);
  });
}

let session = null; // { proc, baseUrl, port }
let targetProc = null;
let targetTitle = '';
let targetPid = 0;
let oldHelperPids = [];
let oldPapersPid = 0;
let newHelperPids = [];
let newPapersPid = 0;
let cleanupRecorded = false;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-015r3-proof-'));
const projectCopy = path.join(dataDir, 'ayg-project-copy');
const statePath = path.join(projectCopy, 'state.json');
const markerPath = path.join(dataDir, 'disposable-marker.json');
const expected = { x: 300, y: 220, width: 520, height: 340 };

async function closeSession(sessionToClose) {
  if (!sessionToClose) return true;
  const exited = await closeApp(sessionToClose.proc, sessionToClose.baseUrl).catch(() => false);
  return exited;
}

async function performCleanup() {
  if (cleanupRecorded) return;
  cleanupRecorded = true;
  record('cleanup: running finally cleanup', true);
  if (session) {
    await closeSession(session);
    session = null;
  }
  if (targetTitle) {
    try {
      await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'close']);
      record('cleanup: target gracefully closed', true);
    } catch (error) {
      record('cleanup: target close via adapter', false, String(error).slice(0, 200));
    }
  }
  if (targetProc && targetProc.exitCode === null) {
    try { targetProc.kill(); } catch { /* ignore */ }
  }
  await sleep(1500);
  const helpersNow = await helperPids().catch(() => []);
  const electronsNow = await testElectronPids(dataDir).catch(() => []);
  record('cleanup: zero owned helper processes', helpersNow.length === 0, `remaining=[${helpersNow.join(',')}]`);
  record('cleanup: zero owned test electron processes', electronsNow.length === 0, `remaining=[${electronsNow.join(',')}]`);
  if (targetTitle) {
    let remainingWindows = -1;
    try {
      const escaped = ADAPTER.replace(/'/g, "''");
      remainingWindows = Number((await runPwsh(
        `. '${escaped}'; @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-015R3-*' }).Count`,
      )).trim());
    } catch {
      remainingWindows = -1;
    }
    record('cleanup: zero AYG-015R3 windows remain', remainingWindows === 0, `remaining=${remainingWindows}`);
  }
}

async function enterAsYouGo(baseUrl) {
  const hostTarget = await waitForTarget(
    baseUrl,
    (t) => t.url.includes('/out/renderer/index.html'),
    90000,
    'host target',
  );
  const host = await connectToTarget(hostTarget, baseUrl);
  // Papers restores the last active Backpack on boot (session 1 recorded it),
  // so the project surface may already be open - no card click needed.
  const alreadyProject = await waitForTarget(
    baseUrl,
    (t) => t.url.startsWith('papers-backpack://'),
    8000,
    'already-open project frame',
  ).catch(() => null);
  if (!alreadyProject) {
    const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((item) =>
      item.querySelector('.name')?.textContent?.trim() === name)`;
    await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'As you Go Backpack card');
    await host.evaluate(
      `(() => [...(${card})('As you Go').querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === 'Enter')?.click())()`,
    );
  } else {
    record('As you Go surface already open (last active restored)', true, 'no card click needed');
  }
  const projectTarget = await waitForTarget(
    baseUrl,
    (t) => t.url.startsWith('papers-backpack://'),
    120000,
    'Backpack project frame target',
  );
  const project = await connectToTarget(projectTarget, baseUrl);
  await waitFor(
    () => project.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`),
    90000,
    'As you Go workspace booted',
  );
  return { host, project };
}

async function main() {
  console.log('=== 015R3 LIVE RESTART DURABILITY PROOF ===');
  record('setup: isolated data dir', fs.existsSync(dataDir), dataDir);
  try {
    fs.cpSync(AYG_REPO, projectCopy, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git`)
        && !source.includes('probes')
        && !source.endsWith(`${path.sep}state.json`),
    });
    const papersData = path.join(dataDir, 'PapersData');
    fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(
      path.join(papersData, 'registry.json'),
      JSON.stringify({
        schemaVersion: 1,
        backpacks: [{
          id: BACKPACK_ID,
          name: 'As you Go',
          type: 'environment',
          createdAt: '2026-07-29T15:00:00.000Z',
          lastEnteredAt: null,
          archived: false,
          workspacePath: null,
        }],
        lastActiveBackpackId: null,
      }),
    );
    fs.writeFileSync(
      path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: BACKPACK_ID,
        name: 'As you Go',
        type: 'environment',
        createdAt: '2026-07-29T15:00:00.000Z',
        lastEnteredAt: null,
        archived: false,
        workspacePath: null,
      }),
    );
    fs.writeFileSync(
      path.join(papersData, 'backpack-projects.json'),
      JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }),
    );
    assert(fs.existsSync(path.join(projectCopy, 'project.json')), 'isolated project copy seeded');
    assert(fs.existsSync(path.join(papersData, 'registry.json')), 'isolated registry seeded');
    assert(!fs.existsSync(statePath), 'isolated state.json starts absent');

    // Launch the ONE disposable target (stays alive across the restart).
    targetProc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', markerPath], {
      cwd: PROBE_DIR,
      windowsHide: false,
      stdio: 'ignore',
    });
    const target = await waitForMarker(markerPath);
    targetTitle = target.title;
    targetPid = target.pid;
    record('disposable target launched', Boolean(targetTitle), `pid=${targetPid} title=${targetTitle}`);

    // ---------------- Session 1 ----------------
    const port1 = await freePort();
    session = await launchPapers(dataDir, port1);
    oldPapersPid = session.proc.pid;
    record('session 1: owned Papers launched', oldPapersPid > 0, `main pid=${oldPapersPid} cdp port=${port1}`);
    const s1 = await enterAsYouGo(session.baseUrl);

    await s1.project.evaluate(`(() => {
      const viewport = document.querySelector('#icon-grid [data-blank-parent]') ?? document.querySelector('#icon-grid');
      viewport.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
      return true;
    })()`);
    await waitFor(
      () => s1.project.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`),
      10000,
      'blank context menu',
    );
    await s1.project.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
    await waitFor(
      () => s1.project.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`),
      30000,
      'window-layout shell rendered',
    );

    await s1.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-pick]').click()`);
    await waitFor(
      () => s1.project.evaluate(
        `Boolean([...document.querySelectorAll('.window-layout-pick-candidate[data-wl-pick-candidate]')]
          .some((row) => row.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targetTitle)}))`),
      120000,
      `picker candidate row for ${targetTitle}`,
    );
    await s1.project.evaluate(`(() => {
      const row = [...document.querySelectorAll('.window-layout-pick-candidate[data-wl-pick-candidate]')]
        .find((candidate) => candidate.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targetTitle)});
      row.click();
      return true;
    })()`);
    await waitFor(
      () => s1.project.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-member]'))`),
      30000,
      'bound member button',
    );

    await waitFor(() => fs.existsSync(statePath), 20000, 'isolated state.json written');
    const member1 = readMember(statePath).member;
    assert(member1 !== null, 'member persisted', JSON.stringify(member1));
    assert(
      member1?.descriptor?.version === 1
      && /^[a-f0-9]{64}$/i.test(member1?.descriptor?.executableFingerprint ?? '')
      && member1?.descriptor?.title === targetTitle,
      'descriptor is exactly {version, executableFingerprint, title}',
      JSON.stringify(member1?.descriptor),
    );
    const descKeys = member1?.descriptor ? Object.keys(member1.descriptor).sort().join(',') : 'none';
    assert(descKeys === 'executableFingerprint,title,version', 'descriptor has exactly three keys', descKeys);
    assert(
      member1?.bounds === null && member1?.state === 'normal',
      'member starts bounds=null state=normal',
      `bounds=${JSON.stringify(member1?.bounds)} state=${member1?.state}`,
    );
    const scan1 = scanForbiddenKeys(statePath);
    assert(scan1.hits.length === 0, 'no forbidden keys persisted after bind', scan1.hits.join(',') || 'clean');

    oldHelperPids = await helperPids();
    record('session 1: owned helper running', oldHelperPids.length > 0, `helper pids=${oldHelperPids.join(',')}`);

    await s1.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-activate]').click()`);
    await waitFor(
      () => s1.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-status]')?.textContent?.trim() === 'Recording'`),
      60000,
      'Recording status',
    );

    // Auto-record after moving the disposable target.
    await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'move', '-X', String(expected.x), '-Y', String(expected.y), '-Width', String(expected.width), '-Height', String(expected.height)]);
    await waitFor(
      () => boundsMatch(readMember(statePath).member?.bounds ?? null, expected),
      30000,
      'auto-recorded bounds persisted',
    );
    record('auto-record: move persisted', true, `${expected.x},${expected.y} ${expected.width}x${expected.height}`);

    // Member click minimize / restore with persisted state.
    await s1.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-member]').click()`);
    await waitFor(() => readMember(statePath).member?.state === 'minimized', 30000, 'persisted minimized state');
    const stateMin = await runPwshJson(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'get-state']);
    assert(stateMin?.state === 'minimized', 'target minimized by member click', stateMin?.state);

    await s1.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-member]').click()`);
    await waitFor(() => readMember(statePath).member?.state === 'normal', 30000, 'persisted normal state');
    const stateNorm = await runPwshJson(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'get-state']);
    assert(stateNorm?.state === 'normal', 'target restored by member click', stateNorm?.state);
    const boundsNorm = await runPwshJson(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'get-bounds']);
    assert(
      boundsMatch(boundsNorm, expected),
      'target geometry unchanged after minimize/restore cycle',
      JSON.stringify(boundsNorm),
    );
    assert(
      boundsMatch(readMember(statePath).member?.bounds ?? null, expected),
      'persisted bounds unchanged after minimize/restore',
      JSON.stringify(readMember(statePath).member?.bounds),
    );

    await captureShot(session.baseUrl, path.join(PROBE_DIR, 'proof-session1.png'));

    // FULL STOP of owned Papers/helper while the target stays alive.
    oldHelperPids = await helperPids();
    oldPapersPid = session.proc.pid;
    record('session 1: old owned PIDs recorded', true, `papers=${oldPapersPid} helpers=${oldHelperPids.join(',')}`);
    const exited1 = await closeSession(session);
    session = null;
    record('session 1: app exited via quit barrier', exited1, exited1 ? 'Browser.close -> before-quit -> clean exit' : 'forced kill');
    await waitFor(async () => (await helperPids()).length === 0, 45000, 'owned helper exited after app close');
    record('FULL STOP: owned helper exited', true, 'helper pids after close = 0');
    await waitFor(async () => (await testElectronPids(dataDir)).length === 0, 45000, 'owned test electron processes exited after app close');
    await sleep(3000);
    const targetAfterStop = await runPwshJson(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'get-state']);
    record('target stays alive across restart', targetAfterStop?.state === 'normal', `state=${targetAfterStop?.state}`);

    // ---------------- Session 2 - fresh owned Papers/helper ----------------
    const port2 = await freePort();
    session = await launchPapers(dataDir, port2);
    newPapersPid = session.proc.pid;
    record('session 2: fresh owned Papers launched', newPapersPid > 0, `main pid=${newPapersPid} cdp port=${port2}`);
    const s2 = await enterAsYouGo(session.baseUrl);
    await waitFor(
      () => s2.project.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-member]'))`),
      60000,
      'persisted member re-rendered in fresh session',
    );
    const persistedBefore = readMember(statePath).member;
    record(
      'session 2: persisted descriptor intact',
      persistedBefore?.descriptor?.title === targetTitle
      && /^[a-f0-9]{64}$/i.test(persistedBefore?.descriptor?.executableFingerprint ?? ''),
      JSON.stringify(persistedBefore?.descriptor),
    );

    // Fresh resolve + fresh binding + geometry applied.
    await s2.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-activate]').click()`);
    await waitFor(
      () => s2.project.evaluate(`document.querySelector('.window-layout-shell [data-wl-status]')?.textContent?.trim() === 'Recording'`),
      90000,
      'fresh-session Recording status',
    );
    const boundsFresh = await runPwshJson(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'get-bounds']);
    assert(
      boundsMatch(boundsFresh, expected),
      'fresh session applied saved geometry to the same target',
      JSON.stringify(boundsFresh),
    );
    const freshMember = readMember(statePath).member;
    assert(freshMember?.state === 'normal', 'fresh session member state normal', freshMember?.state);
    assert(
      boundsMatch(freshMember?.bounds ?? null, expected),
      'fresh session member bounds intact',
      JSON.stringify(freshMember?.bounds),
    );

    newHelperPids = await helperPids();
    newPapersPid = session.proc.pid;
    record('session 2: new owned PIDs recorded', true, `papers=${newPapersPid} helpers=${newHelperPids.join(',')}`);
    assert(
      newHelperPids.length > 0 && !newHelperPids.some((pid) => oldHelperPids.includes(pid)),
      'fresh helper issued (new helper PID(s), old not reused)',
      `old=[${oldHelperPids.join(',')}] new=[${newHelperPids.join(',')}]`,
    );

    const scan2 = scanForbiddenKeys(statePath);
    assert(scan2.hits.length === 0, 'no forbidden keys persisted after fresh session', scan2.hits.join(',') || 'clean');

    await captureShot(session.baseUrl, path.join(PROBE_DIR, 'proof-session2.png'));
  } catch (error) {
    record('harness step', false, String(error).slice(0, 500));
    if (session) {
      const logTail = session.log.join('').slice(-3000);
      if (logTail.trim()) console.error(`app log tail:\n${logTail}`);
    }
    throw error;
  } finally {
    await performCleanup();
  }

  const passed = steps.length - failures;
  console.log(`\n=== SUMMARY: ${passed}/${steps.length} passed, ${failures} failed ===`);
  const transcript = [
    '015R3 LIVE RESTART DURABILITY PROOF - TRANSCRIPT',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `isolated project copy: ${projectCopy}`,
    `disposable target: title=${targetTitle} pid=${targetPid}`,
    `old owned papers pid: ${oldPapersPid} helpers: [${oldHelperPids.join(',')}]`,
    `new owned papers pid: ${newPapersPid} helpers: [${newHelperPids.join(',')}]`,
    '',
    ...steps.map((step) => `${step.ok ? 'PASS' : 'FAIL'} - ${step.name}${step.detail ? ` :: ${step.detail}` : ''}`),
    '',
    `FINAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed.`,
  ].join('\r\n');
  fs.writeFileSync(TRANSCRIPT, `${transcript}\r\n`);
  console.log(`transcript: ${TRANSCRIPT}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`HARNESS FAILED: ${String(error).slice(0, 800)}`);
  process.exitCode = 1;
});
