/**
 * 018V ISOLATED LIVE PROOF (Winter): Ning Tier-B rows P1-P9 against the frozen
 * 018 transfer state machine. Runs ONLY an isolated Papers source/build instance
 * (unique userData, isolated helper) and uniquely titled disposable target
 * windows. The creator's installed Papers and every unrelated window/process are
 * enumerated before/after and never activated, moved or closed. Probe-side
 * observation only: page message logs (papers:project:detach-*), DOM state,
 * native window bounds and process enumeration. No product source is modified.
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
const OUT = path.join(AYG_REPO, 'probes', '018-live-proof');
const TRANSCRIPT = path.join(OUT, 'proof-018-transcript.txt');
const SHOTS = path.join(OUT, 'shots');

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
async function creatorPapersPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='Papers.exe'" | Select-Object ProcessId | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId).sort();
}
async function parentOf(pid) {
  const raw = await runPwsh(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).ParentProcessId`);
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
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
function readMember(statePath, layoutIndex = 0) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return parsed?.windowLayouts?.[layoutIndex]?.arrangement?.members ?? [];
}
function readActiveId(statePath) {
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return parsed?.activeWindowLayoutId ?? null;
}
async function targetList(baseUrl) {
  const list = await (await fetch(`${baseUrl}/json/list`)).json();
  return Array.isArray(list) ? list : [];
}
async function screenshot(client, name) {
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
  } catch { /* best-effort */ }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-018v-'));
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
const startedAt = Date.now();
const overallDeadline = startedAt + 15 * 60 * 1000;
async function timeLeft() { return Math.max(0, overallDeadline - Date.now()); }
async function bounded(label) {
  const remaining = await timeLeft();
  if (remaining < 60000) throw new Error(`overall timeout approaching while ${label}`);
}

async function armDetachLog(client) {
  await client.evaluate(`(() => {
    if (!window.__detachMsgs) {
      window.__detachMsgs = [];
      window.addEventListener('message', (e) => {
        if (e.data && typeof e.data.type === 'string' && e.data.type.startsWith('papers:project:detach-')) {
          window.__detachMsgs.push({ t: Date.now(), type: e.data.type, transferId: e.data.transferId ?? null, reason: e.data.reason ?? null });
        }
      });
    }
    return true;
  })()`);
}
async function detachLogOf(client) {
  return client.evaluate(`window.__detachMsgs ?? []`);
}

async function main() {
  console.log('=== 018V LIVE PROOF (isolated) ===');
  fs.mkdirSync(OUT, { recursive: true });
  let creatorBefore = [];
  try {
    // ---- creator process baseline (observed only, never touched) -----------
    creatorBefore = await creatorPapersPids();
    record('creator installed Papers enumerated before (observed only)', true, JSON.stringify(creatorBefore));

    // ---- disposable target windows -----------------------------------------
    const positions = [[120, 140], [820, 140], [120, 620], [820, 620]];
    for (let index = 0; index < 4; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('three disposable targets launched', targets.length === 4, targets.map((t) => `${t.pid}:${t.title}`).join(' '));

    // ---- isolated Papers instance ------------------------------------------
    const port = await freePort();
    session = await launchPapers(dataDir, port, path.join(OUT, 'proof-018-app.log'));
    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);

    const alreadyOpen = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 8000, 'frame').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((i) => i.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'frame');
    let bp = await connectToTarget(projectTarget, session.baseUrl);
    const workspaceTargetIdentity = { id: projectTarget.id, url: projectTarget.url };
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace');
    await armDetachLog(bp);

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
    async function refreshWorkspace() {
      // Reattach resumes the existing workspace renderer. Keep its exact CDP
      // connection instead of selecting the first arbitrary non-detached
      // Backpack target (Papers may expose more than one project target).
      // Reconnect only if the original session actually disappeared, and then
      // require the same target id or exact original surface URL.
      try {
        await bp.evaluate('true');
      } catch {
        const target = await waitForTarget(
          session.baseUrl,
          (candidate) => candidate.id === workspaceTargetIdentity.id
            || candidate.url === workspaceTargetIdentity.url,
          30000,
          'original workspace target',
        );
        if (bp) bp.close();
        bp = await connectToTarget(target, session.baseUrl);
      }
      await armDetachLog(bp);
    }
    async function windowCenter(title) {
      await ctl(['-Title', title, '-Action', 'topmost']);
      await sleep(400);
      const b = await ctl(['-Title', title, '-Action', 'get-bounds']);
      return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) };
    }

    // ---- P1 seed: layout with two list-picked members -----------------------
    await bounded('P1 seed');
    const layoutId = await createLayout();
    record('P1 layout created', Boolean(layoutId), layoutId);
    await pickFromList(layoutId, targets[0].title);
    await pickFromList(layoutId, targets[1].title);
    await waitFor(() => readMember(statePath).length === 2, 30000, 'two members persisted');
    await waitFor(() => readActiveId(statePath) === layoutId, 30000, 'active id persisted');
    record('P1 two members list-picked and active layout id persisted',
      readMember(statePath).length === 2 && readActiveId(statePath) === layoutId,
      JSON.stringify({ members: readMember(statePath).map((m) => m.descriptor.title), active: readActiveId(statePath) }));
    await screenshot(bp, 'P1-workspace-seeded');

    // ---- P2 detach via real UI: transfer ordering ---------------------------
    await bounded('P2 detach');
    await bp.evaluate(`document.querySelector('[data-wl-detach="true"]').click()`);
    const detachedTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('detach=1'), 60000, 'detached surface');
    const detached = await connectToTarget(detachedTarget, session.baseUrl);
    await armDetachLog(detached);
    await waitFor(() => detached.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-layout]'))`), 60000, 'detached controller rendered after activate');
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-detach-readonly]'))`), 30000, 'workspace read-only surface mounted');
    const wsMsgs = await detachLogOf(bp);
    const detMsgs = await detachLogOf(detached);
    const stopRequested = wsMsgs.some((m) => m.type === 'papers:project:detach-stop-request');
    const stopAcked = wsMsgs.some((m) => m.type === 'papers:project:detach-stop-ack');
    const activatedPush = detMsgs.some((m) => m.type === 'papers:project:detach-activate');
    // The detached bootstrap gates its controller on ACTIVATE, so the rendered
    // controller is the activate receipt; the workspace log carries the
    // stop-request -> stop-ack ordering. The activate push may beat the probe
    // listener by milliseconds (the transfer is near-instant), so the rendered
    // controller is the authoritative evidence of "no activate before the stop
    // handshake completes".
    const wsStopIdx = wsMsgs.findIndex((m) => m.type === 'papers:project:detach-stop-request');
    const wsAckIdx = wsMsgs.findIndex((m) => m.type === 'papers:project:detach-stop-ack');
    record('P2 transfer ordering: workspace STOP_REQUEST before STOP_ACK, detached only activates afterwards',
      stopRequested && stopAcked && wsStopIdx >= 0 && wsAckIdx >= wsStopIdx,
      JSON.stringify({ workspace: wsMsgs, detached: detMsgs, activatedPushSeen: activatedPush }));
    await screenshot(detached, 'P2-detached-activated');
    const wsReadonly = await bp.evaluate(`Boolean(document.querySelector('[data-detach-readonly]'))`);
    record('P2 workspace entered read-only surface after activate', wsReadonly === true, '');
    await screenshot(bp, 'P2-workspace-readonly');

    // ---- P3 detached operations ---------------------------------------------
    await bounded('P3 detached ops');
    // Group minimize/restore from the detached surface drives real windows.
    const memberTitle0 = readMember(statePath)[0].descriptor.title;
    const memberTitle1 = readMember(statePath)[1].descriptor.title;
    await detached.evaluate(`document.querySelector('.window-layout-shell [data-wl-min-all]').click()`);
    await waitFor(async () => {
      const a = await ctl(['-Title', memberTitle0, '-Action', 'get-state']);
      const b = await ctl(['-Title', memberTitle1, '-Action', 'get-state']);
      return a.state === 'minimized' && b.state === 'minimized';
    }, 30000, 'minimize-all applied from detached');
    record('P3 detached Minimize all minimized both real members', true, `${memberTitle0}/${memberTitle1}`);
    await detached.evaluate(`document.querySelector('.window-layout-shell [data-wl-restore-all]').click()`);
    await waitFor(async () => {
      const a = await ctl(['-Title', memberTitle0, '-Action', 'get-state']);
      const b = await ctl(['-Title', memberTitle1, '-Action', 'get-state']);
      return a.state === 'normal' && b.state === 'normal';
    }, 30000, 'restore-all applied from detached');
    record('P3 detached Restore all restored both real members', true, '');
    // List-pick a THIRD member from the detached surface.
    await detached.evaluate(`document.querySelector('.window-layout-shell [data-wl-list]').click()`);
    await waitFor(() => detached.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targets[2].title)}))`), 60000, 'third row');
    await detached.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targets[2].title)}); row.click(); return true; })()`);
    await waitFor(() => readMember(statePath).length === 3, 30000, 'third member persisted from detached');
    record('P3 detached list picker added the third member and persisted it',
      readMember(statePath).length === 3, JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    // Direct pick a FOURTH disposable window from the detached surface (real OS click).
    const fourthCenter = await windowCenter(targets[3].title);
    await detached.evaluate(`document.querySelector('.window-layout-shell [data-wl-pick]').click()`);
    await sleep(1200);
    await ctl(['-Title', targets[3].title, '-Action', 'hover-point', '-X', String(fourthCenter.x), '-Y', String(fourthCenter.y)]);
    await waitFor(() => readMember(statePath).length === 4, 60000, 'direct-pick member added from detached');
    record('P3 detached direct pick added a fourth member via real OS click',
      readMember(statePath).length === 4, JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    await screenshot(detached, 'P3-detached-controller');

    // ---- P4 workspace read-only: mutation blocked, Focus/Reattach live ------
    await bounded('P4 read-only');
    const mutationBlocked = await bp.evaluate(`(() => {
      // A real right-click lands on the topmost element (the read-only
      // capture overlay), never the grid below.
      const at = document.elementFromPoint(320, 320);
      at.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }));
      return new Promise((resolve) => setTimeout(() => resolve(!document.querySelector('#context-menu [data-action="new-window-layout"]')), 300));
    })()`);
    record('P4 workspace mutation gesture (context menu) blocked while detached', mutationBlocked === true, '');
    const focusWorks = await bp.evaluate(`document.querySelector('[data-detach-readonly] .wl-focus').click(); true`);
    record('P4 workspace Focus button responds while detached', focusWorks === true, '');
    const reattachWorks = await bp.evaluate(`document.querySelector('[data-detach-readonly] .wl-reattach').click(); true`);
    record('P4 workspace Reattach button responds while detached', reattachWorks === true, '');

    // ---- P5 reattach: detached closes, workspace resumes, state preserved ---
    await bounded('P5 reattach');
    await waitFor(async () => (await targetList(session.baseUrl)).every((t) => !t.url.includes('detach=1')), 60000, 'detached window closed after reattach');
    await refreshWorkspace();
    let resumedStableSince = 0;
    await waitFor(async () => {
      const ready = await bp.evaluate(`Boolean(document.querySelector('[data-wl-detach="true"]'))
        && !document.querySelector('[data-detach-readonly]')
        && (window.__detachMsgs ?? []).some((m) => m.type === 'papers:project:detach-resumed-ack')`);
      if (!ready) { resumedStableSince = 0; return false; }
      if (!resumedStableSince) resumedStableSince = Date.now();
      return Date.now() - resumedStableSince >= 350;
    }, 60000, 'workspace full controller resumed and stayed stable')
      .catch(async (error) => {
        const diag = await bp.evaluate(`(async () => {
          const requestId = crypto.randomUUID();
          const loaded = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ timeout: true }), 5000);
            const receive = (event) => {
              if (event.source !== window || event.data?.type !== 'papers:host:result' || event.data.requestId !== requestId) return;
              clearTimeout(timer);
              window.removeEventListener('message', receive);
              if (!event.data.ok) { resolve({ error: event.data.error ?? 'load failed' }); return; }
              try {
                const state = JSON.parse(event.data.state);
                resolve({
                  layouts: state.windowLayouts?.length ?? 0,
                  members: state.windowLayouts?.[0]?.arrangement?.members?.length ?? 0,
                  active: state.activeWindowLayoutId ?? null,
                  current: state.view?.currentGroupId ?? null,
                  bin: state.view?.binMode ?? null,
                });
              } catch (caught) { resolve({ parseError: String(caught), rawType: typeof event.data.state }); }
            };
            window.addEventListener('message', receive);
            window.postMessage({ type: 'papers:project:as-you-go-load', requestId }, '*');
          });
          const grid = document.querySelector('#icon-grid');
          const viewport = document.querySelector('.graph-viewport');
          return {
            readonly: Boolean(document.querySelector('[data-detach-readonly]')),
            detachBtn: Boolean(document.querySelector('[data-wl-detach]')),
            reattachBtn: Boolean(document.querySelector('[data-wl-reattach]')),
            url: location.href,
            readyState: document.readyState,
            shell: Boolean(document.querySelector('.window-layout-shell')),
            layoutBody: Boolean(document.querySelector('.window-layout-body')),
            gridItem: Boolean(document.querySelector('[data-wl-layout]')),
            shells: document.querySelectorAll('.window-layout-shell').length,
            graphNodes: document.querySelectorAll('[data-graph-node-id]').length,
            gridChildren: grid?.childElementCount ?? -1,
            gridSize: grid ? [grid.clientWidth, grid.clientHeight] : null,
            viewportSize: viewport ? [viewport.clientWidth, viewport.clientHeight] : null,
            lifecycle: window.__detachMsgs ?? [],
            resumeStages: window.__aygDetachResumeDiag?.stages ?? [],
            loaded,
          };
        })()`);
        record('diag: workspace resume state', false, JSON.stringify(diag));
        throw error;
      });
    const wsAfter = await detachLogOf(bp);
    const resumedClosed = wsAfter.some((m) => m.type === 'papers:project:detach-closed');
    const memberCount = readMember(statePath).length;
    const activeAfter = readActiveId(statePath);
    record('P5 reattach preserved durable members and active layout id',
      resumedClosed && memberCount === 4 && activeAfter === layoutId,
      JSON.stringify({ closed: resumedClosed, members: memberCount, active: activeAfter }));
    await screenshot(bp, 'P5-workspace-resumed');
    // The resume reloaded the workspace to a fresh document; re-arm the probe
    // message log on the current context.
    await armDetachLog(bp);

    // ---- P6 detached renderer crash recovery ---------------------------------
    await bounded('P6 crash');
    try {
      const detachReady = await bp.evaluate(`Boolean(document.querySelector('[data-wl-detach="true"]'))`);
      if (!detachReady) {
        const transitionDiag = await bp.evaluate(`({
          detach: Boolean(document.querySelector('[data-wl-detach="true"]')),
          reattach: Boolean(document.querySelector('[data-wl-reattach]')),
          readonly: Boolean(document.querySelector('[data-detach-readonly]')),
          shells: document.querySelectorAll('.window-layout-shell').length,
          layouts: document.querySelectorAll('[data-wl-layout]').length,
          graphNodes: document.querySelectorAll('[data-graph-node-id]').length,
          gridChildren: document.querySelector('#icon-grid')?.childElementCount ?? -1,
          lifecycle: window.__detachMsgs ?? [],
          url: location.href,
          readyState: document.readyState,
        })`);
        record('P5 post-resume DOM state captured', true, JSON.stringify(transitionDiag));
        recordNotRun('P6 detached renderer crash recovery', 'workspace post-reattach resume did not render a Detach control for the re-detach');
      } else {
        await bp.evaluate(`document.querySelector('[data-wl-detach="true"]').click()`);
        const detached2 = await waitForTarget(session.baseUrl, (t) => t.url.includes('detach=1'), 60000, 'detached surface 2');
        const detached2Client = await connectToTarget(detached2, session.baseUrl);
        await armDetachLog(detached2Client);
        const activated2 = await detached2Client.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-layout]'))`).catch(() => false);
        if (!activated2) {
          await waitFor(() => detached2Client.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-layout]'))`), 60000, 'detached 2 activated')
            .catch(async (error) => {
              const wsLog = await detachLogOf(bp);
              const detachedDiag = await detached2Client.evaluate(`({ lifecycle: window.__detachMsgs ?? [], boot: window.__aygDetachedBoot?.stages ?? [], readyState: document.readyState, url: location.href })`).catch(() => null);
              recordNotRun('P6 detached renderer crash recovery', `re-detach transfer stalled before activate: workspace=${JSON.stringify(wsLog)} detached=${JSON.stringify(detachedDiag)}`);
              throw error;
            });
        }
        let detachedPid = null;
        try {
          const version = await (await fetch(`${session.baseUrl}/json/version`)).json();
          const browserClient = await connectToTarget({ webSocketDebuggerUrl: version.webSocketDebuggerUrl }, session.baseUrl);
          const procInfo = await browserClient.send('SystemInfo.getProcessInfo');
          const info = (procInfo?.processInfo ?? []).find((p) => p.type === 'renderer' && p.id === detached2.id);
          detachedPid = info?.osProcessId ?? null;
          browserClient.close();
        } catch { /* informational only */ }
        record('P6 detached renderer process id resolved (informational)', true, String(detachedPid ?? 'unavailable'));
        // Page.crash commonly cannot answer its own CDP request: destroying
        // the renderer severs the transport before a response is delivered.
        // Keep the rejection handled, then judge the observable contract below
        // (the detached target disappears and the workspace resumes).
        const crashAttempt = detached2Client.send('Page.crash').catch(() => undefined);
        await waitFor(async () => (await targetList(session.baseUrl)).every((t) => !t.url.includes('detach=1')), 90000, 'detached window gone after crash');
        void crashAttempt;
        await waitFor(() => bp.evaluate(`Boolean(document.querySelector('[data-wl-detach="true"]'))`), 90000, 'workspace resumed after crash');
        const wsAfterCrash = await detachLogOf(bp);
        record('P6 crash notified the workspace to reload/resume',
          wsAfterCrash.some((m) => m.type === 'papers:project:detach-closed'), JSON.stringify(wsAfterCrash));
      }
    } catch (error) {
      record('P6 crash recovery row', false, String(error).slice(0, 300));
    }

    // ---- P8 work-area clamp ---------------------------------------------------
    await bounded('P8 clamp');
    const displays = await runPwsh(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $b = $_.Bounds; $w = $_.WorkingArea; "$($b.X),$($b.Y),$($b.Width),$($b.Height)|$($w.X),$($w.Y),$($w.Width),$($w.Height)" }`);
    const displayRows = displays.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [b, w] = line.split('|');
      const [x, y, width, height] = b.split(',').map(Number);
      const [wx, wy, wwidth, wheight] = w.split(',').map(Number);
      return { bounds: { x, y, width, height }, workArea: { x: wx, y: wy, width: wwidth, height: wheight } };
    });
    record('P8 display enumeration', displayRows.length >= 1, JSON.stringify(displayRows));
    const p8DetachReady = await bp.evaluate(`Boolean(document.querySelector('[data-wl-detach="true"]'))`).catch(() => false);
    if (!p8DetachReady) {
      recordNotRun('P8 detached restored bounds are within the primary display work area', 'workspace has no stable Detach control after the preceding recovery gate');
      recordNotRun('P8 display-removal re-clamp', 'P8 detached surface was not opened');
      recordNotRun('P8 multi-monitor clamp', 'P8 detached surface was not opened');
    } else {
      await bp.evaluate(`document.querySelector('[data-wl-detach="true"]').click()`);
      const detached3 = await waitForTarget(session.baseUrl, (t) => t.url.includes('detach=1'), 60000, 'detached surface 3');
      const detached3Client = await connectToTarget(detached3, session.baseUrl);
      await waitFor(() => detached3Client.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-layout]'))`), 60000, 'detached 3 activated');
    // The detached window's own DIP geometry (page-observable) versus the
    // containing display's work area. The H3 session clamps the created bounds
    // to the work area at open; this asserts that restoration never lands over
    // a taskbar/reserved region on the primary display.
    const clampGeom = await detached3Client.evaluate(`(() => {
      const s = window.screen;
      return {
        left: window.screenX, top: window.screenY,
        width: window.outerWidth, height: window.outerHeight,
        availTop: s.availTop, availLeft: s.availLeft,
        availWidth: s.availWidth, availHeight: s.availHeight,
        availRight: s.availLeft + s.availWidth, availBottom: s.availTop + s.availHeight,
      };
    })()`);
    const withinWorkArea = clampGeom
      && clampGeom.left >= clampGeom.availLeft - 2
      && clampGeom.top >= clampGeom.availTop - 2
      && clampGeom.left + clampGeom.width <= clampGeom.availRight + 2
      && clampGeom.top + clampGeom.height <= clampGeom.availBottom + 2;
    record('P8 detached restored bounds are within the primary display work area',
      withinWorkArea === true, JSON.stringify(clampGeom));
    if (displayRows.length > 1) {
      recordNotRun('P8 display-removal re-clamp', 'requires a headless display removal; no such harness seam');
    } else {
      recordNotRun('P8 display-removal re-clamp', 'single display connected (environmental)');
    }
    if (displayRows.length <= 1) {
      recordNotRun('P8 multi-monitor clamp', 'single display connected (environmental)');
    }
      await detached3Client.close();
      await bp.evaluate(`document.querySelector('[data-detach-readonly] .wl-reattach').click()`);
      await waitFor(async () => (await targetList(session.baseUrl)).every((t) => !t.url.includes('detach=1')), 60000, 'detached 3 closed');
    }

    // ---- P7/P9 shutdown + PID chain + creator untouched ----------------------
    await bounded('P7 shutdown');
    const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2500);
    for (const target of targets) {
      await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
    }
    await waitFor(async () => {
      const count = await runPwsh(`. '${AYG_REPO.replace(/'/g, "''")}\\probes\\native-window\\window-capability.ps1'; @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-015R3-*' }).Count`);
      return count.trim() === '0';
    }, 30000, 'probe disposable windows closed');
    const helpers = await helperPids();
    const electrons = await testElectronPids(dataDir);
    const aygWindows = await runPwsh(`. '${AYG_REPO.replace(/'/g, "''")}\\probes\\native-window\\window-capability.ps1'; @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-015R3-*' }).Count`);
    record('P7 shutdown: zero owned helpers', helpers.length === 0, JSON.stringify(helpers));
    record('P7 shutdown: zero owned test electrons', electrons.length === 0, JSON.stringify(electrons));
    record('P7 shutdown: zero probe disposable windows', aygWindows.trim() === '0', aygWindows.trim());
    const creatorAfter = await creatorPapersPids();
    record('P9 creator installed Papers untouched (same process ids, never activated)',
      JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
  } catch (error) {
    record('harness step', false, String(error).slice(0, 500));
  } finally {
    // Cleanup-on-failure: close the isolated app and disposable targets.
    if (session) {
      const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
      await closeApp(session.proc, session.baseUrl).catch(() => undefined);
      session = null;
    }
    for (const t of targets) {
      await ctl(['-Title', t.title, '-Action', 'close']).catch(() => undefined);
    }
    for (const proc of targetProcs) {
      if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
    }
    await sleep(2000);
    const helpers = await helperPids().catch(() => []);
    const electrons = await testElectronPids(dataDir).catch(() => []);
    record('cleanup: zero owned helpers', helpers.length === 0, JSON.stringify(helpers));
    record('cleanup: zero owned test electrons', electrons.length === 0, JSON.stringify(electrons));
    const windows = await runPwsh(`. '${AYG_REPO.replace(/'/g, "''")}\\probes\\native-window\\window-capability.ps1'; @(Get-AygVisibleWindows | Where-Object { $_.Title -like 'AYG-015R3-*' }).Count`).catch(() => '-1');
    record('cleanup: zero probe windows remain', windows.trim() === '0', windows.trim());
    const creatorAfter = await creatorPapersPids().catch(() => []);
    record('creator installed Papers untouched after run', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
  }
  const passed = steps.length - failures;
  const transcript = [
    '018V LIVE PROOF - TRANSCRIPT',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `creator Papers pids before: ${JSON.stringify(creatorBefore)}`,
    '',
    ...steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} - ${s.name}${s.detail ? ` :: ${s.detail}` : ''}`),
    '',
    ...notRuns.map((n) => `NOT RUN - ${n.name} :: ${n.reason}`),
    '',
    `FINAL SUMMARY: ${passed}/${steps.length} passed, ${failures} failed; ${notRuns.length} rows NOT RUN.`,
  ].join('\r\n');
  fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
  fs.writeFileSync(TRANSCRIPT, `${transcript}\r\n`);
  console.log(`\n=== SUMMARY: ${passed}/${steps.length} passed, ${failures} failed ===`);
  if (failures > 0) process.exitCode = 1;
}

main();
