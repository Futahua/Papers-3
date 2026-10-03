/**
 * Assignment 016R LIVE PROOF (isolated): the six BRAIN follow-up gaps.
 *
 *  (1) capture/focus owned by the picker from the first instant - an
 *      IMMEDIATE click on the overlay (before begin() resolves) must resolve
 *      the pick and must be consumed, never reaching the window beneath;
 *  (2) blank-area click is owned by the picker and yields a typed failure;
 *      right-click cancels; overlays are destroyed; the underlying windows
 *      are untouched;
 *  (4) the Backpack consumer subscribes to the result push BEFORE begin
 *      resolves, so an early result is never missed;
 *  (5) overlays show + focus at first paint (Escape/right-click reliability);
 *  (6) strict click/state payload validation (unit-covered; live sanity via
 *      a malformed pick:click injection that must be ignored).
 *
 * Gaps (3) display lifecycle and the all-Papers structural exclusion are
 * unit/PS-covered (display-added/removed cancel + destroy; Papers.exe never
 * task-worthy), not reproducible in a live harness.
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
const TRANSCRIPT = path.join(AYG_REPO, 'probes', '016r', 'proof-016r-transcript.txt');

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
async function helperPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows])
    .filter((r) => typeof r.CommandLine === 'string' && r.CommandLine.includes('window-helper.ps1'))
    .map((r) => r.ProcessId).sort();
}
async function testElectronPids(dataDir) {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows])
    .filter((r) => typeof r.CommandLine === 'string' && r.CommandLine.includes(dataDir))
    .map((r) => r.ProcessId).sort();
}
async function waitForTarget(baseUrl, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${baseUrl}/json/list`)).json();
      const match = (Array.isArray(list) ? list : []).find(predicate);
      if (match) return match;
    } catch { /* retry */ }
    await sleep(500);
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
      } catch {
        // partially written marker: retry
      }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error('marker timeout')); }
    }, 250);
  });
}
function readMember(statePath, layoutIndex = 0) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return parsed?.windowLayouts?.[layoutIndex]?.arrangement?.members ?? [];
}
async function overlayList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return (Array.isArray(list) ? list : []).filter((t) => t.url.startsWith('data:text/html'));
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-016r-proof-'));
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
let appLog = '';

async function main() {
  console.log('=== 016R LIVE PROOF (isolated, 3 disposable windows) ===');
  try {
    const positions = [[120, 140], [820, 140], [120, 620]];
    for (let index = 0; index < 3; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('three disposable windows launched', targets.length === 3, targets.map((t) => `${t.pid}:${t.title}`).join(' '));

    const port = await freePort();
    session = await launchPapers(dataDir, port);
    appLog = session.log.join('');
    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    try {
      const browserVersion = await (await fetch(`${session.baseUrl}/json/version`)).json();
      const browserClient = await connectToTarget({ webSocketDebuggerUrl: browserVersion.webSocketDebuggerUrl }, session.baseUrl);
      const { windowId } = await browserClient.send('Browser.getWindowForTarget', { targetId: hostTarget.id });
      await browserClient.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: 1400, top: 900, width: 640, height: 400, windowState: 'normal' },
      });
      browserClient.close();
    } catch (error) {
      console.error(`could not relocate the host window: ${String(error).slice(0, 200)}`);
    }
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
      return bp.evaluate(`document.querySelector('.window-layout-shell:last-of-type [data-wl-layout]')?.dataset.wlLayout ?? [...document.querySelectorAll('.window-layout-shell')].pop().querySelector('[data-wl-layout]').dataset.wlLayout`);
    }
    async function pickFromList(layoutId, title) {
      await bp.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 120000, `row ${title}`);
      await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 30000, `member ${title}`);
    }
    async function windowCenter(title) {
      await ctl(['-Title', title, '-Action', 'topmost']);
      await sleep(400);
      const b = await ctl(['-Title', title, '-Action', 'get-bounds']);
      return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) };
    }
    async function statusText() {
      return bp.evaluate(`document.querySelector('.window-layout-shell [data-wl-status]')?.textContent ?? ''`);
    }
    /** 016R: before/after input probe - cursor point, foreground HWND, both
     * disposable targets' bounds and show state, membership, overlay/session
     * state. Recorded around every REAL OS input assertion. */
    async function inputProbe() {
      const cursor = await ctl(['-Title', targets[1].title, '-Action', 'get-cursor']);
      const foreground = await ctl(['-Title', targets[1].title, '-Action', 'get-foreground']);
      const b = await ctl(['-Title', targets[1].title, '-Action', 'get-bounds']);
      const bShow = await ctl(['-Title', targets[1].title, '-Action', 'get-show']);
      const a = await ctl(['-Title', targets[0].title, '-Action', 'get-bounds']);
      const aShow = await ctl(['-Title', targets[0].title, '-Action', 'get-show']);
      return {
        cursor: { x: cursor.x, y: cursor.y },
        foreground: { pid: foreground.pid, title: String(foreground.title ?? '').slice(0, 40) },
        targetB: { bounds: { x: b.x, y: b.y, w: b.width, h: b.height }, show: bShow },
        targetA: { bounds: { x: a.x, y: a.y, w: a.width, h: a.height }, show: aShow },
        members: readMember(statePath).map((m) => m.descriptor.title),
        overlays: (await overlayList(session.baseUrl)).length,
      };
    }
    function probeUnchanged(before, after) {
      const sameBounds = (x, y) => x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
      const sameShow = (x, y) => x.visible === y.visible && x.iconic === y.iconic;
      return sameBounds(before.targetB.bounds, after.targetB.bounds)
        && sameShow(before.targetB.show, after.targetB.show)
        && sameBounds(before.targetA.bounds, after.targetA.bounds)
        && sameShow(before.targetA.show, after.targetA.show)
        && before.members.length === after.members.length
        && before.members.every((m, i) => m === after.members[i]);
    }
    /** Center of the TEST instance's main window, computed via Win32 - the
     * test instance is excluded from hover structurally, so points inside it
     * can never pick a real window in any live environment. */
    async function hostWindowRect() {
      const pattern = dataDir.replace(/'/g, "''");
      const rect = await runPwsh(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AygRect { [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); }' -ErrorAction SilentlyContinue; $procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${pattern}*' }; $out = ''; foreach ($p in $procs) { $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($proc -and $proc.MainWindowHandle -ne 0) { $r = New-Object AygRect+R; [AygRect]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null; $out = "$($r.L),$($r.T),$($r.Rt),$($r.B),$($p.ProcessId)"; break } }; $out`);
      const parts = rect.trim().split(',');
      const [left, top, right, bottom, pid] = parts.map((n) => Number(n));
      if (![left, top, right, bottom, pid].every(Number.isFinite)) {
        throw new Error(`host window rect unavailable: ${rect}`);
      }
      return { left, top, right, bottom, pid };
    }
    /** Parent process id of a pid, via WMI (the same source the production
     * helper's lazy ParentPid op uses). */
    async function parentOf(pid) {
      const raw = await runPwsh(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).ParentProcessId`);
      const value = Number(raw.trim());
      return Number.isFinite(value) ? value : null;
    }
    /** Bounded grid of candidate screen points across every display. */
    async function displayGrid() {
      const screens = await runPwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $b = $_.Bounds; "$($b.X),$($b.Y),$($b.X + $b.Width),$($b.Y + $b.Height)" }`);
      const grid = [];
      for (const line of screens.trim().split(/\r?\n/).filter(Boolean)) {
        const [l, t, rt, b] = line.split(',').map((n) => Number(n));
        if (![l, t, rt, b].every(Number.isFinite)) continue;
        const w = rt - l;
        const h = b - t;
        for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          grid.push({ x: l + Math.round(w * fx), y: t + Math.round(h * fy) });
        }
      }
      return grid;
    }
    /** 016R: proves a screen point is production-blank. For each bounded grid
     * candidate: move the REAL cursor there, assert GetCursorPos equals the
     * candidate, then require consecutive successful null hover observations
     * (the pick session's production samples pushing hover=null) at that
     * unchanged point. A timeout, unavailable helper or absent sample is NOT
     * treated as null; if any hover appears the candidate is rejected. */
    async function proveProductionNullPoint(candidates, recorders) {
      for (const candidate of candidates) {
        await ctl(['-Title', targets[1].title, '-Action', 'move-only', '-X', String(candidate.x), '-Y', String(candidate.y)]);
        await sleep(150);
        const pos = await ctl(['-Title', targets[1].title, '-Action', 'get-cursor']);
        if (pos.x !== candidate.x || pos.y !== candidate.y) {
          record('probe: cursor landed exactly on candidate', false, `${JSON.stringify(candidate)} vs ${pos.x},${pos.y}`);
          continue;
        }
        let nullRun = 0;
        let seen = 0;
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && nullRun < 3) {
          await sleep(120);
          if ((await overlayList(session.baseUrl)).length === 0) break; // session died: not a valid null signal
          // The session nulls hover PER DISPLAY (a hovered rect is only drawn
          // on the overlay of the display it is on); read only the overlay
          // whose display rect contains the candidate.
          let latest = null;
          for (const { client } of recorders) {
            try {
              const states = await client.evaluate(`window.__states ?? []`).catch(() => []);
              if (states.length === 0) continue;
              const last = states[states.length - 1];
              const d = last.display;
              if (d && candidate.x >= d.x && candidate.x < d.x + d.width
                && candidate.y >= d.y && candidate.y < d.y + d.height) {
                latest = last;
                break;
              }
            } catch { /* destroyed */ }
          }
          if (!latest) continue; // absent sample: not a null signal
          seen += 1;
          if (latest.hover === null) nullRun += 1;
          else break; // hover appeared: not blank
        }
        if (nullRun >= 3 && seen >= 3) return candidate;
      }
      return null;
    }
    /** Attaches the draw-state recorder to EVERY live overlay and resolves
     * when ANY overlay receives a hover-kind state (the session nulls hover
     * per-display, so only the overlay on the hovered display sees it). */
    async function armStateRecorders() {
      const recorders = [];
      for (const target of await overlayList(session.baseUrl)) {
        try {
          const client = await connectToTarget(target, session.baseUrl);
          const bridge = await client.evaluate('typeof window.pickOverlay');
          if (bridge === 'object') {
            await client.evaluate(`(() => {
              window.__states = [];
              window.pickOverlay.onState((s) => window.__states.push(JSON.parse(JSON.stringify(s))));
              return true;
            })()`);
            recorders.push({ target, client });
          } else {
            client.close();
          }
        } catch { /* dying overlay */ }
      }
      return recorders;
    }
    let stateRecorders = [];
    async function beginPickViaUi() {
      await bp.evaluate(`document.querySelector('[data-wl-pick]').click()`);
    }
    async function waitForOverlay(timeoutMs = 10000) {
      let live = null;
      await waitFor(async () => {
        for (const target of await overlayList(session.baseUrl)) {
          try {
            const client = await connectToTarget(target, session.baseUrl);
            const bridge = await client.evaluate('typeof window.pickOverlay');
            client.close();
            if (bridge === 'object') {
              live = target;
              return true;
            }
          } catch {
            // pre-retry window being destroyed: skip it
          }
        }
        return false;
      }, timeoutMs, 'live overlay with bridge');
      return live;
    }
    async function waitForNoOverlay(timeoutMs = 10000) {
      await waitFor(async () => (await overlayList(session.baseUrl)).length === 0, timeoutMs, 'overlays destroyed');
    }
    async function overlayRightClick(overlayTarget) {
      const client = await connectToTarget(overlayTarget, session.baseUrl);
      await client.evaluate(`window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))`);
      client.close();
    }

    // ---- Layout with one list-picked member (A) ---------------------------
    const layout1 = await createLayout();
    record('layout created', Boolean(layout1), layout1);
    await pickFromList(layout1, targets[0].title);
    await waitFor(() => readMember(statePath)[0]?.bounds !== null, 20000, 'immediate capture of A bounds');
    record('list-pick A baseline member added', readMember(statePath).length === 1, readMember(statePath)[0]?.descriptor.title);

    // ---- (1)+(4)+(5): immediate REAL OS left-click through the session -----
    const bCenter = await windowCenter(targets[1].title);
    // Park the cursor over B BEFORE beginning (real OS cursor move), so the
    // OS click is issued at the exact target center.
    await ctl(['-Title', targets[1].title, '-Action', 'move-only', '-X', String(bCenter.x), '-Y', String(bCenter.y)]);
    // Arm the result probe BEFORE the session starts.
    await bp.evaluate(`(() => {
      window.__pickResultProbe = 'armed';
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'papers:project:window-pick-result') window.__pickResultProbe = JSON.stringify(e.data.result);
      });
      return true;
    })()`);
    await beginPickViaUi();
    const overlayEarly = await waitForOverlay(3000);
    stateRecorders = await armStateRecorders();
    // IMMEDIATE: the REAL OS left-click is issued as soon as the overlay is
    // live - NO waiting for a hover sample. Capture was applied at begin, so
    // the click is owned by the picker (hover-point = SetCursorPos to the
    // candidate + real LEFTDOWN/LEFTUP through the OS).
    const beforeClick = await inputProbe();
    const hostFacts1 = await hostWindowRect();
    record('(1) overlay owns OS keyboard focus before the immediate click',
      beforeClick.foreground.pid === hostFacts1.pid,
      JSON.stringify({ foreground: beforeClick.foreground, papersPid: hostFacts1.pid, targetPids: targets.map((t) => t.pid) }));
    await ctl(['-Title', targets[1].title, '-Action', 'hover-point', '-X', String(bCenter.x), '-Y', String(bCenter.y)]);
    await waitFor(() => readMember(statePath).length === 2, 30000, 'immediate click member persisted')
      .catch(async (error) => {
        const collected = [];
        for (const { client } of stateRecorders) {
          try {
            collected.push(...(await client.evaluate(`window.__states ?? []`).catch(() => [])));
          } catch { /* destroyed */ }
        }
        record('diag: immediate-click failure state', false,
          JSON.stringify({
            result: await bp.evaluate(`window.__pickResultProbe ?? 'none'`),
            status: await statusText(),
            members: readMember(statePath).map((m) => m.descriptor.title),
            overlays: (await overlayList(session.baseUrl)).length,
            states: collected.slice(-6).map((s) => ({ hover: s.hover, greens: s.green.length })),
          }));
        throw error;
      });
    const afterClick = await inputProbe();
    const earlyState = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
    record('(1) immediate REAL OS left-click resolves the pick (no hover-sample wait)',
      readMember(statePath).length === 2 && readMember(statePath).some((m) => m.descriptor.title === targets[1].title)
        && earlyState.state === 'normal',
      JSON.stringify({
        before: { cursor: beforeClick.cursor, foreground: beforeClick.foreground, targetB: beforeClick.targetB },
        after: { cursor: afterClick.cursor, foreground: afterClick.foreground, targetB: afterClick.targetB },
        members: afterClick.members,
      }));
    record('(1) targets untouched by the immediate click (bounds/show/membership)',
      probeUnchanged(beforeClick, afterClick),
      JSON.stringify({ before: beforeClick.targetB, after: afterClick.targetB }));
    await waitForNoOverlay(10000);

    // ---- (2) blank-area click: typed failure, nothing leaks ----------------
    // 016R: a blank point is proven ONLY through the production pipeline -
    // the cursor is moved there with real input, GetCursorPos is asserted,
    // and the pick session's own samples must report consecutive successful
    // null hovers at that unchanged point. The harness no longer classifies
    // windows; eligibility is entirely the helper's product responsibility.
    const grid = await displayGrid();
    await beginPickViaUi();
    const overlayBlank = await waitForOverlay(3000);
    stateRecorders = await armStateRecorders();
    const blankPoint = await proveProductionNullPoint(grid, stateRecorders);
    record('(2) a production-null screen point exists on the occupied desktop',
      Boolean(blankPoint), blankPoint ? `${blankPoint.x},${blankPoint.y}` : 'none of the grid candidates was production-null');
    const blankPreMembers = readMember(statePath).map((m) => m.descriptor.title);
    if (blankPoint) {
      // REAL OS left-click at the exact cursor point just proven null. The
      // click must be owned by the picker and yield a typed failure; it must
      // never reach a window beneath.
      const beforeBlank = await inputProbe();
      await ctl(['-Title', targets[1].title, '-Action', 'hover-point', '-X', String(blankPoint.x), '-Y', String(blankPoint.y)]);
      await waitForNoOverlay(10000);
      const blankStatus = await statusText();
      const afterBlank = await inputProbe();
      record('(2) REAL OS blank click yields a typed failure in the UI',
        blankStatus.includes('nothing eligible'),
        JSON.stringify({ status: blankStatus, point: { x: blankPoint.x, y: blankPoint.y }, before: beforeBlank, after: afterBlank }));
      record('(2) blank click never reached a window beneath (bounds/show/membership)',
        probeUnchanged(beforeBlank, afterBlank),
        JSON.stringify({ before: beforeBlank.targetB, after: afterBlank.targetB, members: afterBlank.members }));
    } else {
      // Environmental precondition: the occupied three-monitor desktop has no
      // production-null point. The blank branch stays covered by the
      // production-adapter PS test with a deterministic successful-null
      // helper; end this session cleanly and continue.
      await overlayRightClick(overlayBlank);
      await waitForNoOverlay(10000);
      record('(2) blank branch covered by the PS adapter null-hover test', true,
        'no live blank point available; precondition recorded');
    }

    // ---- (2)+(5) REAL OS right-click cancels, overlays destroyed ----------
    await beginPickViaUi();
    const overlayCancel = await waitForOverlay(3000);
    // Park the cursor over the overlay's own surface (any point the overlay
    // covers is owned by the picker) and right-click with real OS input.
    const cancelProbeBefore = await inputProbe();
    await ctl(['-Title', targets[1].title, '-Action', 'right-click']);
    await waitForNoOverlay(10000);
    const cancelProbeAfter = await inputProbe();
    const cancelStatus = await statusText();
    record('(2) REAL OS right-click cancels the session cleanly',
      cancelStatus === '' && cancelProbeAfter.overlays === 0,
      JSON.stringify({ status: cancelStatus, before: { fg: cancelProbeBefore.foreground, overlays: cancelProbeBefore.overlays }, after: { fg: cancelProbeAfter.foreground, overlays: cancelProbeAfter.overlays } }));
    record('(2) right-click cancel leaves targets untouched',
      probeUnchanged(cancelProbeBefore, cancelProbeAfter),
      JSON.stringify({ before: cancelProbeBefore.targetB, after: cancelProbeAfter.targetB }));

    // ---- (5) REAL OS Escape cancels (keyboard owned by the overlay) --------
    await beginPickViaUi();
    const overlayEsc = await waitForOverlay(3000);
    const escProbeBefore = await inputProbe();
    // The overlay must own OS keyboard focus: the foreground HWND before the
    // key must be the Papers overlay, not a target.
    const escFgOk = escProbeBefore.foreground.pid === (await hostWindowRect()).pid;
    await ctl(['-Title', targets[1].title, '-Action', 'escape']);
    await waitForNoOverlay(10000);
    const escProbeAfter = await inputProbe();
    const escStatus = await statusText();
    record('(5) overlay owned OS keyboard focus before the Escape key',
      escFgOk, JSON.stringify(escProbeBefore.foreground));
    record('(5) REAL OS Escape cancels the session',
      escStatus === '' && escProbeAfter.overlays === 0,
      JSON.stringify({ status: escStatus, foregroundBefore: escProbeBefore.foreground, overlaysAfter: escProbeAfter.overlays }));
    record('(5) Escape leaves targets untouched',
      probeUnchanged(escProbeBefore, escProbeAfter),
      JSON.stringify({ before: escProbeBefore.targetB, after: escProbeAfter.targetB }));

    // ---- (6) malformed overlay payloads are strictly rejected -------------
    await beginPickViaUi();
    const overlayMalformed = await waitForOverlay(3000);
    // Park the cursor on B so the samples highlight exactly the window the
    // follow-up click targets (no fail-closed mismatch).
    await ctl(['-Title', targets[1].title, '-Action', 'move-only', '-X', String(bCenter.x), '-Y', String(bCenter.y)]);
    await sleep(1200);
    const malformedClient = await connectToTarget(overlayMalformed, session.baseUrl);
    // Inject malformed payloads THROUGH the real bridge: NaN, fractions,
    // strings and out-of-range points must all be ignored by the strict
    // parseOverlayClick gate in the main process.
    await malformedClient.evaluate(`window.pickOverlay.click(NaN, 10); window.pickOverlay.click(1.5, 2.5); window.pickOverlay.click('1', 2); window.pickOverlay.click(1e9, 0); true`);
    malformedClient.close();
    await sleep(800);
    const stillAlive = await overlayList(session.baseUrl);
    // One overlay per display; none may have been destroyed by the garbage.
    const displayCount = (await runPwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count`)).trim();
    record('(6) malformed click payloads cannot crash or end the session',
      stillAlive.length === Number(displayCount), `overlays=${stillAlive.length} displays=${displayCount}`);
    // REAL OS left-click at the parked cursor (B's center): the session must
    // still resolve normally after the malformed payloads.
    await ctl(['-Title', targets[1].title, '-Action', 'hover-point', '-X', String(bCenter.x), '-Y', String(bCenter.y)]);
    await waitFor(() => readMember(statePath).length === 1, 30000, 'remove after malformed');
    record('(6) session still resolves normally after malformed payloads',
      readMember(statePath).length === 1 && readMember(statePath)[0].descriptor.title === targets[0].title,
      JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    await waitForNoOverlay(10000);
    // Draw-state shape check: every pushed state must be exactly the three
    // sanitized keys with finite numbers (the session's sanitize gate).
    await pickFromList(layout1, targets[1].title);
    await waitFor(() => readMember(statePath).length === 2, 20000, 'B re-added');
    await beginPickViaUi();
    const overlayShape = await waitForOverlay(3000);
    const shapeClient = await connectToTarget(overlayShape, session.baseUrl);
    const shape = await shapeClient.evaluate(`new Promise((resolve) => {
      const seen = [];
      const t = setTimeout(() => resolve({ timedOut: true, seen }), 4000);
      window.pickOverlay.onState((s) => {
        seen.push(s);
        if (seen.length >= 2) { clearTimeout(t); resolve({ timedOut: false, seen }); }
      });
    })`);
    shapeClient.close();
    const shapeOk = Array.isArray(shape.seen) && shape.seen.length >= 2
      && shape.seen.every((s) => {
        const keys = Object.keys(s).sort();
        return keys.length === 3 && keys[0] === 'display' && keys[1] === 'green' && keys[2] === 'hover'
          && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(s.display[k]))
          && Array.isArray(s.green) && s.green.every((g) => ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(g[k])))
          && (s.hover === null || ['x', 'y', 'width', 'height', 'kind'].every((k) => (k === 'kind' ? ['add', 'remove'].includes(s.hover[k]) : Number.isFinite(s.hover[k]))));
      });
    record('(6) every pushed draw state is exactly the sanitized shape',
      shapeOk === true, JSON.stringify(shape).slice(0, 300));
    await overlayRightClick(overlayShape);
    await waitForNoOverlay(10000);

    // ---- Baseline regression: real hover + real click still picks ---------
    // Members are [A, B] after the shape check; pick A (a member -> red
    // remove) with real input.
    const aCenter = await windowCenter(targets[0].title);
    await beginPickViaUi();
    const overlayBaseline = await waitForOverlay(3000);
    // Real input path: cursor to A's center, wait for sampled hover, click.
    const baseProbeBefore = await inputProbe();
    await ctl(['-Title', targets[0].title, '-Action', 'hover-point', '-X', String(aCenter.x), '-Y', String(aCenter.y)]);
    await sleep(1500);
    const baselineClient = await connectToTarget(overlayBaseline, session.baseUrl);
    const hovered = await baselineClient.evaluate(`new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 8000);
      window.pickOverlay.onState((s) => { if (s && s.hover) { clearTimeout(t); resolve(true); } });
    })`);
    baselineClient.close();
    await ctl(['-Title', targets[0].title, '-Action', 'hover-point', '-X', String(aCenter.x), '-Y', String(aCenter.y)]);
    await waitFor(() => readMember(statePath).length === 1, 30000, 'regression pick applied');
    const baseProbeAfter = await inputProbe();
    record('baseline: real hover+click still picks after all 016R changes',
      hovered === true && readMember(statePath).length === 1
        && readMember(statePath)[0].descriptor.title === targets[1].title,
      `hovered=${hovered}`);
    record('baseline: targets untouched (bounds/show/membership)',
      probeUnchanged(baseProbeBefore, baseProbeAfter),
      JSON.stringify({ before: baseProbeBefore.targetA, after: baseProbeAfter.targetA, members: baseProbeAfter.members }));
    await waitForNoOverlay(10000);

    // ---- PID chain facts (lazy ParentPid regression, live) -----------------
    // The production helper's ParentPid op resolves the process that spawned
    // it: the owning Papers main. Assert helper parent == host (Papers) pid
    // and record overlay owner + target pids.
    const hostFacts = await hostWindowRect();
    const helpers = await helperPids();
    const helperParents = [];
    for (const helper of helpers) {
      const parent = await parentOf(helper);
      if (parent !== null) helperParents.push({ helper, parent });
    }
    const overlayPid = hostFacts.pid;
    const pidChainOk = helpers.length >= 1
      && helperParents.length >= 1
      && helperParents.every(({ parent }) => parent === overlayPid)
      && targets.every((t) => t.pid > 0);
    record('live PID chain: helper parent == owning Papers pid (lazy ParentPid)',
      pidChainOk,
      JSON.stringify({
        helpers,
        helperParents,
        papersMain: overlayPid,
        overlayOwner: overlayPid,
        targets: targets.map((t) => t.pid),
      }));
  } catch (error) {
    record('harness step', false, String(error).slice(0, 400));
    if (session) {
      const logText = (session.log ?? []).join('');
      fs.writeFileSync(path.join(AYG_REPO, 'probes', '016r', 'proof-016r-app.log'), logText);
      console.error(`app log tail:\n${logText.slice(-1500)}`);
    }
  } finally {
    if (session) {
      const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
      await closeApp(session.proc, session.baseUrl).catch(() => undefined);
      session = null;
    }
    for (const t of targets) {
      await ctl(['-Title', t.title, '-Action', 'close']).catch(() => undefined);
    }
    for (const proc of targetProcs) {
      if (proc.exitCode === null) {
        try { proc.kill(); } catch { /* already gone */ }
      }
    }
    await sleep(2000);
    const helpers = await helperPids().catch(() => []);
    const electrons = await testElectronPids(dataDir).catch(() => []);
    record('cleanup: zero owned helpers', helpers.length === 0, `[${helpers.join(',')}]`);
    record('cleanup: zero owned test electrons', electrons.length === 0, `[${electrons.join(',')}]`);
    const windows = await runPwsh(`. '${AYG_REPO.replace(/'/g, "''")}\\probes\\native-window\\window-capability.ps1'; @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-015R3-*' }).Count`);
    record('cleanup: zero AYG windows remain', windows.trim() === '0', windows.trim());
  }
  const passed = steps.length - failures;
  const transcript = [
    '016R LIVE PROOF - TRANSCRIPT',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `owned papers pid: ${session?.proc?.pid ?? 'closed'}`,
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

main();
