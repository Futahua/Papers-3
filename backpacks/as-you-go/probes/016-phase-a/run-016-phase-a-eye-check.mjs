/**
 * ASSIGNMENT 016 PHASE A - CREATOR EYE CHECK PREPARATION (015 presentation).
 *
 * Prepares the already-accepted 015 one-member controller in an isolated
 * Papers/userData/project session and LEAVES IT OPEN for the creator's human
 * eye/use check. No 016 behavior is implemented: no picker multi-toggle,
 * multiselection, group actions, isolate, reorder or drag-out.
 *
 * This driver is intended to be launched DETACHED (via WMI) so its children
 * survive the launching shell command. Electron output is redirected to a log
 * file; the driver verifies the children are alive, writes eye-check-state.json
 * with owned PIDs and cleanup instructions, then exits WITHOUT closing them.
 *
 * VISUAL SAFETY STATEMENT (standing rule 2):
 *   Affected area: only the compact window-layout item and its picker panel,
 *   plus the static member state marker. Update rate: user action or the
 *   bounded 500ms status refresh of the single active layout; there is no
 *   repeating opacity/fill/luminance/hue animation and no large-area
 *   flashing. The item is an ordinary workspace body that settles once on
 *   creation like any fresh item.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { connectToTarget, freePort, launchPapers, sleep } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const DISPOSABLE = path.join(LPP, 'disposable-window.ps1');
const STATE_FILE = path.join(AYG_REPO, 'probes', '016-phase-a', 'eye-check-state.json');
const APP_LOG = path.join(AYG_REPO, 'probes', '016-phase-a', 'eye-check-app.log');

console.log('VISUAL SAFETY STATEMENT (standing rule 2):');
console.log('  Affected area: the compact window-layout item and its picker panel, plus the');
console.log('  static member state marker. Update rate: user action or the bounded 500ms');
console.log('  status refresh of the single active layout. No repeating opacity/fill/');
console.log('  luminance/hue animation; no large-area flashing; the item settles once on');
console.log('  creation like any ordinary fresh item.\n');

function runPwsh(args) {
  const argv = typeof args === 'string'
    ? ['-NoProfile', '-NonInteractive', '-Command', args]
    : args;
  return new Promise((resolve, reject) => {
    const result = spawn(PW, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    result.stdout.on('data', (chunk) => out.push(String(chunk)));
    result.stderr.on('data', (chunk) => out.push(String(chunk)));
    const timer = setTimeout(() => { result.kill(); reject(new Error('pwsh timeout')); }, 120000);
    result.on('error', (error) => { clearTimeout(timer); reject(error); });
    result.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`pwsh ${code}: ${out.join('').trim().slice(0, 500)}`));
      else resolve(out.join('').trim());
    });
  });
}

async function processAlive(pid) {
  try {
    const result = await runPwsh(`Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`);
    return result.trim().length > 0;
  } catch {
    return false;
  }
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
  throw new Error(`timeout waiting for ${label}${lastError ? ` (${String(lastError).slice(0, 300)})` : ''}`);
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-016a-eyechk-'));
const projectCopy = path.join(dataDir, 'ayg-project-copy');
const statePath = path.join(projectCopy, 'state.json');
const markerPath = path.join(dataDir, 'disposable-marker.json');

let session = null;
let targetProc = null;
let targetTitle = '';
let targetPid = 0;

async function cleanupOnFailure() {
  if (session) {
    await runPwsh(`Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${session.proc.pid} -or $_.ParentProcessId -eq ${session.proc.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`).catch(() => undefined);
    session = null;
  }
  if (targetTitle) {
    await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', targetTitle, '-Action', 'close']).catch(() => undefined);
  }
  if (targetProc && targetProc.exitCode === null) {
    try { targetProc.kill(); } catch { /* ignore */ }
  }
  await sleep(1500);
  const helpers = await helperPids().catch(() => []);
  console.log(`[cleanup] helpers remaining: [${helpers.join(',')}]`);
}

async function main() {
  console.log('=== 016 PHASE A: PREPARING THE RUNNING ONE-MEMBER SLICE FOR THE CREATOR EYE CHECK ===');
  const steps = [];
  const record = (name, ok, detail = '') => {
    steps.push({ name, ok, detail });
    console.log(`${ok ? 'OK ' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  };

  try {
    // Seed isolated PapersData + isolated project copy (never creator data).
    fs.cpSync(AYG_REPO, projectCopy, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git`)
        && !source.includes('probes')
        && !source.endsWith(`${path.sep}state.json`),
    });
    const papersData = path.join(dataDir, 'PapersData');
    fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({
      schemaVersion: 1,
      backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }],
      lastActiveBackpackId: null,
    }));
    fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({
      schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment',
      createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null,
    }));
    fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({
      schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } },
    }));
    record('isolated session seeded', true, dataDir);

    // ONE uniquely titled disposable target (stays open for the eye check).
    targetProc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', markerPath], {
      cwd: LPP, windowsHide: false, stdio: 'ignore',
    });
    const target = await waitForMarker(markerPath);
    targetTitle = target.title;
    targetPid = target.pid;
    record('disposable target running', Boolean(targetTitle), `pid=${targetPid} title=${targetTitle}`);

    // Owned Papers instance (log redirected to a file so it survives the driver).
    const port = await freePort();
    session = await launchPapers(dataDir, port, APP_LOG);
    record('owned Papers running', true, `main pid=${session.proc.pid} cdp port=${port}`);

    // Enter As you Go (auto-enter after first boot, or via card click).
    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host target');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    const alreadyOpen = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 8000, 'project frame').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((item) => item.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'As you Go Backpack card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'project frame');
    const project = await connectToTarget(projectTarget, session.baseUrl);
    await waitFor(() => project.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace booted');

    // Real UI: create one window-layout item at root.
    await project.evaluate(`(() => {
      const viewport = document.querySelector('#icon-grid [data-blank-parent]') ?? document.querySelector('#icon-grid');
      viewport.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
      return true;
    })()`);
    await waitFor(() => project.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10000, 'blank context menu');
    await project.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
    await waitFor(() => project.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30000, 'window-layout shell rendered');
    record('window-layout item created through the real UI', true);

    // Bind the disposable target through the real picker.
    await project.evaluate(`document.querySelector('.window-layout-shell [data-wl-pick]').click()`);
    await waitFor(
      () => project.evaluate(`Boolean([...document.querySelectorAll('.window-layout-pick-candidate[data-wl-pick-candidate]')].some((row) => row.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targetTitle)}))`),
      120000,
      `picker candidate row for ${targetTitle}`,
    );
    await project.evaluate(`(() => {
      const row = [...document.querySelectorAll('.window-layout-pick-candidate[data-wl-pick-candidate]')].find((c) => c.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targetTitle)});
      row.click(); return true;
    })()`);
    await waitFor(() => project.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-member]'))`), 30000, 'member button');
    record('disposable target bound through the real picker', true, targetTitle);

    // Activate -> Recording (the most informative stable live state).
    await project.evaluate(`document.querySelector('.window-layout-shell [data-wl-activate]').click()`);
    await waitFor(
      () => project.evaluate(`document.querySelector('.window-layout-shell [data-wl-status]')?.textContent?.trim() === 'Recording'`),
      60000,
      'Recording status',
    );
    record('item recording (status "Recording")', true);

    // Leave the picker OPEN: member unlink row + candidate list legible.
    await project.evaluate(`document.querySelector('.window-layout-shell [data-wl-pick]').click()`);
    await waitFor(() => project.evaluate(`Boolean(document.querySelector('.window-layout-picker .window-layout-pick-candidate'))`), 60000, 'picker panel open with rows');
    record('picker left open (member row + candidate list)', true);

    // Verify the visible state the creator will see.
    const visible = await project.evaluate(`(() => {
      const member = document.querySelector('.window-layout-shell [data-wl-member]');
      const icon = document.querySelector('.window-layout-shell [data-wl-member-icon]');
      const controls = [...document.querySelectorAll('.window-layout-shell .window-layout-control')].map((b) => b.textContent?.trim() ?? '');
      const status = document.querySelector('.window-layout-shell [data-wl-status]')?.textContent?.trim() ?? '';
      const pickerRows = [...document.querySelectorAll('.window-layout-picker .window-layout-pick-candidate')].map((r) => ({
        label: r.querySelector('.window-layout-pick-label')?.textContent?.trim() ?? '',
        state: r.querySelector('.window-layout-pick-state')?.textContent?.trim() ?? '',
        icon: Boolean(r.querySelector('img.window-layout-pick-icon')) || r.querySelector('.window-layout-pick-icon')?.classList.contains('placeholder') === false,
        isMember: Boolean(r.dataset.wlUnlink),
      }));
      const theme = document.documentElement.dataset.theme;
      return {
        memberPresent: Boolean(member),
        memberTitle: member?.getAttribute('title') ?? null,
        memberClass: member?.className ?? null,
        iconLoaded: icon ? (icon.getAttribute('src') ? 'loaded' : 'placeholder') : 'none',
        controls,
        status,
        pickerRows,
        theme,
      };
    })()`);
    record('member button present with program icon/state marker', Boolean(visible.memberPresent && visible.iconLoaded !== 'none'), JSON.stringify({ title: visible.memberTitle, icon: visible.iconLoaded, cls: visible.memberClass }));
    record('controls legible', visible.controls.length >= 2, JSON.stringify(visible.controls));
    record('status line legible', visible.status === 'Recording', visible.status);
    record('picker shows member row + candidates', visible.pickerRows.length >= 1, `rows=${visible.pickerRows.length} memberRow=${visible.pickerRows.some((r) => r.isMember)}`);
    record('theme', visible.theme === 'light', `current theme: ${visible.theme} (creator default)`);

    const helpers = await helperPids();
    record('owned helper running', helpers.length > 0, `helper pids=${helpers.join(',')}`);

    // Grace period: verify the children stay alive before declaring ready.
    let stable = true;
    for (let i = 0; i < 6; i += 1) {
      await sleep(5000);
      const papersAlive = await processAlive(session.proc.pid);
      const targetAlive = await processAlive(targetPid);
      const h = await helperPids().catch(() => []);
      console.log(`[watch ${(i + 1) * 5}s] papers=${papersAlive} target=${targetAlive} helpers=[${h.join(',')}]`);
      if (!papersAlive || !targetAlive) {
        stable = false;
        console.log(`app log tail:\n${fs.readFileSync(APP_LOG, 'utf8').slice(-2000)}`);
        break;
      }
    }
    record('children stable for 30s (leaving open)', stable);

    // Persist the eye-check state so BRAIN/the creator have exact cleanup info.
    const state = {
      preparedAt: new Date().toISOString(),
      dataDir,
      projectCopy,
      statePath,
      papersMainPid: session.proc.pid,
      helperPids: helpers,
      cdpPort: port,
      target: { pid: targetPid, title: targetTitle },
      theme: visible.theme,
      visible,
      steps,
      cleanup: [
        `Close the disposable target (optional): pwsh -NoProfile -NonInteractive -File "${CONTROL}" -Title "${targetTitle}" -Action close`,
        `Close the eye-check Papers instance: close its window normally (owned test instance, main pid ${session.proc.pid}, isolated data dir ${dataDir}).`,
        `The creator's real Papers (5 Papers.exe processes) is untouched and must not be closed.`,
      ],
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\r\n`);
    console.log(`\neye-check state written: ${STATE_FILE}`);
    console.log(`\nTHE EYE-CHECK INSTANCE IS LEFT RUNNING (Papers main ${session.proc.pid}, helper [${helpers.join(',')}], target ${targetPid}).`);
    console.log('Do NOT close it: the creator will look at it now.');
  } catch (error) {
    console.error(`\nPREPARATION FAILED: ${String(error).slice(0, 600)}`);
    await cleanupOnFailure();
    process.exitCode = 1;
  }
}

main();
