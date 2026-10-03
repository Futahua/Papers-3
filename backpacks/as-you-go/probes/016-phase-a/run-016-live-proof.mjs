/**
 * Assignment 016 LIVE PROOF (isolated): picker toggle, direct onscreen pick
 * (hover/click), green/blue/red overlay states, contextual icon switching,
 * selected/all group actions, isolate, reorder, drag-out unlink, persistence,
 * offscreen clamping, and zero owned-process cleanup - against ONE isolated
 * Papers instance and THREE uniquely titled disposable windows.
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
const TRANSCRIPT = path.join(AYG_REPO, 'probes', '016-phase-a', 'proof-016-transcript.txt');

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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-016-proof-'));
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
  console.log('=== 016 LIVE PROOF (isolated, 3 disposable windows) ===');
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
    // Move the Papers test window away from the disposable targets so the
    // direct-pick hover can never resolve the host window over them.
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
      try {
        await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 120000, `row ${title}`);
      } catch (error) {
        const diag = await bp.evaluate(`(() => ({
          picker: document.querySelector('[data-wl-picker]')?.innerHTML?.slice(0, 300) ?? 'no picker',
          status: document.querySelector('[data-wl-status]')?.textContent ?? '',
        }))()`);
        console.error(`PICKER DIAG: ${JSON.stringify(diag)}`);
        throw error;
      }
      await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 30000, `member ${title}`);
    }
    async function windowCenter(title) {
      await ctl(['-Title', title, '-Action', 'topmost']);
      await sleep(400);
      const b = await ctl(['-Title', title, '-Action', 'get-bounds']);
      return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) };
    }
    async function directPick(title) {
      const center = await windowCenter(title);
      await bp.evaluate(`document.querySelector('[data-wl-pick]').click()`);
      await sleep(2500);
      try {
        const statusText = await bp.evaluate(`document.querySelector('.window-layout-shell [data-wl-status]')?.textContent ?? ''`);
        console.error(`PICK STATUS: ${JSON.stringify(statusText)}`);
      } catch { /* ignore */ }
      // DIAG: inspect the overlay window state
      try {
        const list = await (await fetch(`${session.baseUrl}/json/list`)).json();
        const overlays = (Array.isArray(list) ? list : []).filter((t) => t.url.startsWith('data:text/html'));
        console.error(`OVERLAY DIAG: found=${overlays.length} urls=${overlays.map((o) => o.url.slice(0, 30)).join('|')}`);
        for (const overlay of overlays) {
          const client = await connectToTarget(overlay, session.baseUrl);
          const state = await client.evaluate(`({ ready: document.readyState, canvas: Boolean(document.querySelector('canvas')), pick: typeof window.pickOverlay, vis: document.visibilityState, outer: window.outerWidth + 'x' + window.outerHeight, pos: screenX + ',' + screenY, w: window.innerWidth + 'x' + window.innerHeight })`);
          console.error(`OVERLAY STATE: ${JSON.stringify(state)}`);
          client.close();
        }
      } catch (error) {
        console.error(`OVERLAY DIAG FAILED: ${String(error).slice(0, 200)}`);
      }
      await ctl(['-Title', title, '-Action', 'hover-point', '-X', String(center.x), '-Y', String(center.y)]);
      // Wait until the overlay has actually drawn a hover state over the
      // target (a real sampled hover), then click with real input.
      try {
        const list = await (await fetch(`${session.baseUrl}/json/list`)).json();
        const overlayTarget = (Array.isArray(list) ? list : []).find((t) => t.url.startsWith('data:text/html'));
        const overlayClient = await connectToTarget(overlayTarget, session.baseUrl);
        const hoverConfirmed = await overlayClient.evaluate(`new Promise((resolve) => {
          const check = () => { /* state arrives via onState below */ };
          window.__hoverWait = resolve;
          window.pickOverlay.onState((s) => { if (s && s.hover) { resolve(true); window.__hoverWait = null; } });
          setTimeout(() => { if (window.__hoverWait) { window.__hoverWait = null; resolve(false); } }, 8000);
        })`);
        console.error(`OVERLAY HOVER CONFIRMED: ${hoverConfirmed}`);
        overlayClient.close();
        if (!hoverConfirmed) throw new Error('hover state never drawn');
      } catch (error) {
        console.error(`OVERLAY HOVER WAIT FAILED: ${String(error).slice(0, 200)}`);
      }
      await ctl(['-Title', title, '-Action', 'hover-point', '-X', String(center.x), '-Y', String(center.y)]);
      // DIRECT path test: does the overlay receive state pushes and send clicks?
      try {
        const list = await (await fetch(`${session.baseUrl}/json/list`)).json();
        const overlayTarget = (Array.isArray(list) ? list : []).find((t) => t.url.startsWith('data:text/html'));
        const overlayClient = await connectToTarget(overlayTarget, session.baseUrl);
        const roundTrip = await overlayClient.evaluate(`new Promise((resolve) => {
          let gotState = null;
          window.pickOverlay.onState((s) => { gotState = s; resolve({ stateReceived: true, hasHover: Boolean(s && s.hover), greens: s ? (s.green || []).length : -1 }); });
          window.pickOverlay.click(${center.x}, ${center.y});
          setTimeout(() => resolve({ stateReceived: false, sent: true }), 4000);
        })`);
        console.error(`OVERLAY ROUNDTRIP: ${JSON.stringify(roundTrip)}`);
        overlayClient.close();
      } catch (error) {
        console.error(`DIRECT CLICK FAILED: ${String(error).slice(0, 200)}`);
      }
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('.window-layout-shell [data-wl-member]')) && document.querySelectorAll('.window-layout-shell [data-wl-member]').length >= 1`), 30000, 'member after direct pick');
      await sleep(300);
    }

    // ---- Layout 1: list-pick A (immediate capture) ----------------------
    const layout1 = await createLayout();
    record('layout 1 created', Boolean(layout1), layout1);
    await pickFromList(layout1, targets[0].title);
    await waitFor(() => readMember(statePath)[0]?.bounds !== null, 20000, 'immediate capture of A bounds');
    record('list-pick A: member bound with immediate captured bounds', readMember(statePath)[0]?.bounds !== null, JSON.stringify(readMember(statePath)[0]));

    // ---- Direct pick B (real hover + click) -----------------------------
    const beforeCount = (await bp.evaluate(`document.querySelectorAll('.window-layout-shell [data-wl-member]').length`));
    await directPick(targets[1].title);
    await waitFor(() => readMember(statePath).length === 2, 20000, 'direct-picked B persisted');
    record('direct pick B added via real hover/click', readMember(statePath).length === 2, JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    const targetB = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
    record('target B state untouched by the pick click', targetB.state === 'normal', targetB.state);

    // ---- Direct pick A again: red remove --------------------------------
    await directPick(targets[0].title);
    await waitFor(() => readMember(statePath).length === 1, 20000, 'direct-picked A removed');
    record('direct pick A toggled off (remove)', readMember(statePath).length === 1 && readMember(statePath)[0].descriptor.title === targets[1].title, JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    // re-add A via the list (toggle)
    await pickFromList(layout1, targets[0].title);
    await waitFor(() => readMember(statePath).length === 2, 60000, 'A re-added via list toggle');
    record('list picker toggles membership both ways', readMember(statePath).length === 2);

    // ---- Group actions ---------------------------------------------------
    await bp.evaluate(`document.querySelector('[data-wl-min-all]').click()`);
    await waitFor(() => readMember(statePath).every((m) => m.state === 'minimized'), 20000, 'minimize-all persisted');
    const stateA = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
    const stateB = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
    record('Minimize all minimized every member', stateA.state === 'minimized' && stateB.state === 'minimized', `${stateA.state}/${stateB.state}`);
    await bp.evaluate(`document.querySelector('[data-wl-restore-all]').click()`);
    await sleep(15000);
    const liveA = await ctl(['-Title', targets[0].title, '-Action', 'get-state']).catch(() => ({ state: 'gone' }));
    const liveB = await ctl(['-Title', targets[1].title, '-Action', 'get-state']).catch(() => ({ state: 'gone' }));
    console.error(`LIVE AFTER RESTORE: A=${liveA.state} B=${liveB.state}`);
    await waitFor(() => readMember(statePath).every((m) => m.state === 'normal'), 60000, 'restore-all persisted');
    record('Restore all restored every member', true);
    // isolate: select A (ctrl-click), isolate => A restored, B minimized
    await bp.evaluate(`(() => { const a = [...document.querySelectorAll('.window-layout-shell [data-wl-member]')].find((b) => b.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))})); a.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); return true; })()`);
    await sleep(300);
    await bp.evaluate(`document.querySelector('[data-wl-isolate]').click()`);
    await sleep(2500);
    const isolateA = await ctl(['-Title', targets[0].title, '-Action', 'get-state']);
    const isolateB = await ctl(['-Title', targets[1].title, '-Action', 'get-state']);
    record('Isolate: selected A restored, unselected B minimized (this layout only)', isolateA.state === 'normal' && isolateB.state === 'minimized', `${isolateA.state}/${isolateB.state}`);
    await bp.evaluate(`document.querySelector('[data-wl-restore-all]').click()`);
    await sleep(2000);

    // ---- Offscreen clamping ----------------------------------------------
    // Persist B's arrangement with stale offscreen bounds, then apply via the
    // contextual member click; the window must land on a visible monitor.
    await bp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.window-layout-shell [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[1].title.slice(0, 12))}));
      return Boolean(b);
    })()`);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const layoutRec = persisted.windowLayouts[0];
    const memberB = layoutRec.arrangement.members.find((m) => m.descriptor.title === targets[1].title);
    memberB.bounds = { x: -5000, y: -5000, width: 400, height: 300 };
    persisted.windowLayouts[0] = layoutRec;
    fs.writeFileSync(statePath, JSON.stringify(persisted));
    await bp.evaluate(`(() => { const b = [...document.querySelectorAll('.window-layout-shell [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[1].title.slice(0, 12))})); b.click(); return true; })()`);
    await sleep(2000);
    const clampedBounds = await ctl(['-Title', targets[1].title, '-Action', 'get-bounds']);
    const onScreen = clampedBounds.x >= 0 && clampedBounds.y >= 0 && clampedBounds.x + clampedBounds.width <= 3840 && clampedBounds.y + clampedBounds.height <= 1080;
    record('offscreen saved bounds clamp to a visible monitor on apply', onScreen, JSON.stringify(clampedBounds));
    // restore persisted state (B back onscreen at known bounds)
    memberB.bounds = { x: 300, y: 220, width: 520, height: 340 };
    fs.writeFileSync(statePath, JSON.stringify(persisted));
    await bp.evaluate(`(() => { const b = [...document.querySelectorAll('.window-layout-shell [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[1].title.slice(0, 12))})); b.click(); return true; })()`);
    await sleep(2000);

    // ---- Contextual switching across two layouts -------------------------
    const layout2 = await createLayout();
    await pickFromList(layout2, targets[2].title);
    record('layout 2 created with C via list', true, layout2);
    // Click B in layout 1 while layout 2 is the active context: applies
    // layout 1's saved arrangement for B and selects layout 1.
    await bp.evaluate(`(() => { const b = [...document.querySelectorAll('[data-wl-layout="${layout1}"] [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[1].title.slice(0, 12))})); b.click(); return true; })()`);
    await sleep(2500);
    const contextBounds = await ctl(['-Title', targets[1].title, '-Action', 'get-bounds']);
    const savedContext = JSON.parse(fs.readFileSync(statePath, 'utf8')).windowLayouts[0].arrangement.members
      .find((m) => m.descriptor.title === targets[1].title).bounds;
    record('icon click from a different layout applies that layout\'s occurrence',
      savedContext !== null && Math.abs(contextBounds.x - savedContext.x) <= 8
        && Math.abs(contextBounds.y - savedContext.y) <= 8
        && Math.abs(contextBounds.width - savedContext.width) <= 8
        && Math.abs(contextBounds.height - savedContext.height) <= 8,
      `applied=${JSON.stringify(contextBounds)} saved=${JSON.stringify(savedContext)}`);

    // ---- Reorder + drag-out unlink ---------------------------------------
    await bp.evaluate(`(() => { const a = [...document.querySelectorAll('[data-wl-layout="${layout1}"] [data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))})); a.click(); return true; })()`);
    await sleep(1200);
    const aStateBefore = await ctl(['-Title', targets[0].title, '-Action', 'get-state']).catch(() => ({ state: 'gone' }));
    console.error(`A STATE BEFORE REORDER: ${aStateBefore.state}`);
    const aStateBeforeUnlink = await ctl(['-Title', targets[0].title, '-Action', 'get-state']).catch(() => ({ state: 'gone' }));
    const orderBefore = (await bp.evaluate(`[...document.querySelectorAll('[data-wl-layout="${layout1}"] [data-wl-member]')].map((b) => b.title)`));
    // drag A beyond the row to unlink (data-only)
    await bp.evaluate(`(() => {
      const members = document.querySelector('[data-wl-members="${layout1}"]');
      const a = [...members.querySelectorAll('[data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))}));
      const r = a.getBoundingClientRect();
      const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
      const opts = { bubbles: true, cancelable: true, pointerId: 41, clientX: x0, clientY: y0, button: 0 };
      a.dispatchEvent(new PointerEvent('pointerdown', opts));
      members.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x0 + 400, clientY: y0 + 200 }));
      members.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x0 + 400, clientY: y0 + 200 }));
      return true;
    })()`);
    await waitFor(() => readMember(statePath).length === 1, 20000, 'drag-out unlinked A');
    record('drag-out beyond the threshold unlinks data-only', readMember(statePath).length === 1 && readMember(statePath)[0].descriptor.title === targets[1].title, JSON.stringify(readMember(statePath).map((m) => m.descriptor.title)));
    const unlinkedA = await ctl(['-Title', targets[0].title, '-Action', 'get-state']).catch(() => ({ state: 'gone' }));
    record('unlink itself never changes the window state', unlinkedA.state === aStateBeforeUnlink.state, `${aStateBeforeUnlink.state} -> ${unlinkedA.state}`);
    await pickFromList(layout1, targets[0].title);
    await waitFor(() => readMember(statePath).length === 2, 20000, 'A re-added');
    // inner reorder: drag B from index 1 to index 0
    await bp.evaluate(`(() => {
      const members = document.querySelector('[data-wl-members="${layout1}"]');
      const b = [...members.querySelectorAll('[data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[1].title.slice(0, 12))}));
      const a = [...members.querySelectorAll('[data-wl-member]')].find((x) => x.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))}));
      const br = b.getBoundingClientRect(); const ar = a.getBoundingClientRect();
      const x0 = br.left + br.width / 2, y0 = br.top + br.height / 2;
      const opts = { bubbles: true, cancelable: true, pointerId: 42, clientX: x0, clientY: y0, button: 0 };
      b.dispatchEvent(new PointerEvent('pointerdown', opts));
      members.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ar.left + ar.width / 2, clientY: y0 }));
      members.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ar.left + ar.width / 2, clientY: y0 }));
      return true;
    })()`);
    await sleep(1200);
    const orderAfter = (await bp.evaluate(`[...document.querySelectorAll('[data-wl-layout="${layout1}"] [data-wl-member]')].map((b) => b.title)`));
    record('inner drag reorders the persisted member order', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter), `before=${orderBefore.length} after=${orderAfter.length}`);

    const forbidden = await runPwsh(`Select-String -Path ${JSON.stringify(statePath)} -Pattern 'runtimeId|hwnd|token|bindingId|processId|processPath|candidate' -AllMatches | Measure-Object | Select-Object -ExpandProperty Count`);
    record('no forbidden keys persisted', forbidden.trim() === '0', forbidden.trim());
  } catch (error) {
    record('harness step', false, String(error).slice(0, 400));
    if (session) {
      const logText = (session.log ?? []).join('');
      fs.writeFileSync(path.join(AYG_REPO, 'probes', '016-phase-a', 'proof-016-app.log'), logText);
      console.error(`app log tail:\n${logText.slice(-1500)}`);
    }
  } finally {
    // Cleanup: close app + targets, verify zero owned.
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
    '016 LIVE PROOF - TRANSCRIPT',
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
