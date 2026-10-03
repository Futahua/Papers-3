/**
 * 019GR isolated native-thumbnail integration proof.
 *
 * Creates two uniquely titled colored WinForms windows and an isolated Papers
 * profile/project copy. It uses renderer-internal DOM events only. Native
 * mutations are exact-title minimize/restore/close against fixtures launched
 * by this process; no global physical input or creator process is touched.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectToTarget, freePort, launchPapers, closeApp, sleep } from '../015r3-live-proof/cdp.mjs';

const AYG = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const BASE = path.join(AYG, 'probes', '015r3-live-proof');
const CONTROL = path.join(BASE, 'control-window.ps1');
const FIXTURE = path.join(AYG, 'probes', '019gr-live-thumbnail', 'colored-window.ps1');
const OUT = path.join(AYG, 'probes', '019gr-live-thumbnail');
const TRANSCRIPT = path.join(OUT, 'proof-019gr-transcript.txt');
const APP_LOG = path.join(OUT, 'proof-019gr-app.log');

const rows = [];
let failures = 0;
function record(name, ok, detail = '') {
  rows.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
}
async function waitFor(fn, timeout, label, interval = 100) {
  const until = Date.now() + timeout;
  let error = null;
  while (Date.now() < until) {
    try { if (await fn()) return; } catch (e) { error = e; }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${label}${error ? `: ${String(error).slice(0, 220)}` : ''}`);
}
function pwsh(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PW, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    proc.stdout.on('data', (c) => chunks.push(String(c)));
    proc.stderr.on('data', (c) => chunks.push(String(c)));
    const timer = setTimeout(() => { proc.kill(); reject(new Error('pwsh timeout')); }, 120000);
    proc.once('error', reject);
    proc.once('close', (code) => {
      clearTimeout(timer);
      const text = chunks.join('').trim();
      if (code === 0) resolve(text); else reject(new Error(`pwsh ${code}: ${text.slice(0, 400)}`));
    });
  });
}
async function ctl(title, action) {
  return JSON.parse(await pwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, '-Title', title, '-Action', action]));
}
async function allProcesses() {
  const raw = await pwsh(['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name,CommandLine | ConvertTo-Json -Compress"]);
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
async function creatorPids() {
  const raw = await pwsh(['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='Papers.exe'\" | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"]);
  const parsed = raw ? JSON.parse(raw) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(Number.isFinite).sort((a, b) => a - b);
}
function descendants(root, processes) {
  const byParent = new Map();
  for (const p of processes) {
    const parent = Number(p.ParentProcessId);
    byParent.set(parent, [...(byParent.get(parent) ?? []), Number(p.ProcessId)]);
  }
  const set = new Set([Number(root)]);
  const queue = [Number(root)];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) ?? []) {
      if (!set.has(child)) { set.add(child); queue.push(child); }
    }
  }
  return set;
}
function identity(p) { return `${Number(p.ProcessId)}:${String(p.CreationDate ?? '')}`; }
async function target(baseUrl, predicate, timeout, label) {
  let found = null;
  await waitFor(async () => {
    const list = await (await fetch(`${baseUrl}/json/list`)).json();
    found = list.find(predicate) ?? null;
    return found;
  }, timeout, label, 350);
  return found;
}
function marker(file) {
  return new Promise((resolve, reject) => {
    const until = Date.now() + 30000;
    const tick = () => {
      try {
        if (fs.existsSync(file)) {
          const value = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (value.pid && value.title) return resolve(value);
        }
      } catch { }
      if (Date.now() >= until) return reject(new Error(`fixture marker timeout: ${file}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-019gr-'));
const projectCopy = path.join(temp, 'ayg-project-copy');
const statePath = path.join(projectCopy, 'state.json');
fs.cpSync(AYG, projectCopy, {
  recursive: true,
  filter: (src) => !src.includes(`${path.sep}.git`) && !src.includes(`${path.sep}probes`) && !src.endsWith(`${path.sep}state.json`),
});
const papersData = path.join(temp, 'PapersData');
fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

let session = null;
let rootPid = null;
const owned = new Map();
const fixtures = [];
const fixtureProcs = [];
let creatorBefore = [];
let foreignBefore = [];
async function refreshOwned() {
  if (!rootPid) return;
  const processes = await allProcesses();
  const ids = descendants(rootPid, processes);
  for (const p of processes) if (ids.has(Number(p.ProcessId))) owned.set(Number(p.ProcessId), identity(p));
}
function ownedLive(processes) { return processes.filter((p) => owned.get(Number(p.ProcessId)) === identity(p)); }
async function fixtureWindowCount() {
  if (!fixtures.length) return 0;
  const titles = JSON.stringify(fixtures.map((f) => f.title)).replace(/'/g, "''");
  const script = `. '${path.join(AYG, 'probes', 'native-window', 'window-capability.ps1').replace(/'/g, "''")}'; $t=ConvertFrom-Json '${titles}'; @(Get-AygVisibleWindows | Where-Object { $t -contains $_.Title }).Count`;
  return Number(await pwsh(['-NoProfile', '-NonInteractive', '-Command', script]));
}
function recolor(fixture, color) {
  fs.writeFileSync(fixture.control, JSON.stringify({ color, nonce: Date.now() }));
}

async function main() {
  console.log('=== 019GR ISOLATED LIVE NATIVE-THUMBNAIL PROOF ===');
  try {
    // One run, one app log. Previous diagnostic attempts must not make the
    // final acceptance artifact look like a multi-launch proof.
    fs.writeFileSync(APP_LOG, '');
    creatorBefore = await creatorPids();
    record('creator Papers PIDs captured before (observed only)', true, JSON.stringify(creatorBefore));
    foreignBefore = (await allProcesses()).filter((p) => String(p.CommandLine ?? '').includes('window-helper.ps1')).map((p) => `${p.ProcessId}:${p.ParentProcessId}`).sort();
    record('foreign helper identities captured before (observed only)', true, JSON.stringify(foreignBefore));

    const specs = [
      { color: '#D92D2D', x: 120, y: 120 },
      { color: '#2457E6', x: 720, y: 120 },
    ];
    for (let i = 0; i < specs.length; i += 1) {
      const markerPath = path.join(temp, `fixture-${i}.json`);
      const control = path.join(temp, `fixture-${i}-control.json`);
      const spec = specs[i];
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', FIXTURE, '-MarkerPath', markerPath, '-ControlPath', control, '-Color', spec.color, '-X', String(spec.x), '-Y', String(spec.y)], { windowsHide: false, stdio: 'ignore' });
      fixtureProcs.push(proc);
      fixtures.push({ ...(await marker(markerPath)), proc, control, color: spec.color });
    }
    record('two exact disposable colored native windows launched', fixtures.length === 2, fixtures.map((f) => `${f.pid}:${f.title}:${f.color}`).join(' '));

    const port = await freePort();
    session = await launchPapers(temp, port, APP_LOG);
    rootPid = session.proc.pid;
    await refreshOwned();
    record('isolated Papers root and owned identity allowlist captured', true, `root=${rootPid} owned=${[...owned.keys()].sort((a,b)=>a-b).join(',')}`);
    const host = await connectToTarget(await target(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host page'), session.baseUrl);
    let project = await target(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 5000, 'already-open project').catch(() => null);
    if (!project) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((x) => x.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'As you Go card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
      project = await target(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'project page');
    }
    const bp = await connectToTarget(project, session.baseUrl);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace ready');

    // Observe exact outgoing thumbnail messages and exact host outcomes without
    // modifying the bridge. Both are ordinary window message events in this
    // top-level Backpack page; image bytes are reduced to length only here.
    await bp.evaluate(`(() => {
      window.__grEvents = [];
      window.addEventListener('message', (event) => {
        const d = event.data;
        if (!d || (d.type !== 'papers:project:window-thumbnail' && d.type !== 'papers:host:result')) return;
        window.__grEvents.push({ type: d.type, requestId: d.requestId, outcome: d.outcome, imageChars: typeof d.imageUrl === 'string' ? d.imageUrl.length : 0 });
      });
      return true;
    })()`);

    await bp.evaluate(`(() => { const v=document.querySelector('#icon-grid [data-blank-parent]'); v.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:320,clientY:320})); })()`);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10000, 'new layout menu');
    await bp.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30000, 'layout shell');
    const layoutId = await bp.evaluate(`[...document.querySelectorAll('.window-layout-shell')].pop().querySelector('[data-wl-layout]').dataset.wlLayout`);
    for (const fixture of fixtures) {
      await bp.evaluate(`document.querySelector('[data-wl-list=${JSON.stringify(layoutId)}]').click()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r)=>r.querySelector('.window-layout-pick-label')?.textContent===${JSON.stringify(fixture.title)}))`), 60000, `candidate ${fixture.title}`);
      await bp.evaluate(`(() => { const r=[...document.querySelectorAll('[data-wl-pick-candidate]')].find((x)=>x.querySelector('.window-layout-pick-label')?.textContent===${JSON.stringify(fixture.title)}); r.click(); })()`);
      await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-member]')].some((b)=>b.getAttribute('aria-label')===${JSON.stringify(fixture.title)}))`), 30000, `member ${fixture.title}`);
    }
    record('real list/bind path persisted both fixture descriptors', JSON.parse(fs.readFileSync(statePath, 'utf8')).windowLayouts?.[0]?.arrangement?.members?.length === 2, layoutId);

    async function member(title) {
      return bp.evaluate(`(() => { const b=[...document.querySelectorAll('[data-wl-member]')].find((x)=>x.getAttribute('aria-label')===${JSON.stringify(title)}); return b ? { id:b.dataset.wlMember, layout:b.dataset.wlLayout } : null; })()`);
    }
    async function enter(title) {
      await bp.evaluate(`(() => { const b=[...document.querySelectorAll('[data-wl-member]')].find((x)=>x.getAttribute('aria-label')===${JSON.stringify(title)}); b.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null})); })()`);
    }
    async function leave(title) {
      await bp.evaluate(`(() => { const b=[...document.querySelectorAll('[data-wl-member]')].find((x)=>x.getAttribute('aria-label')===${JSON.stringify(title)}); if (!b) return false; b.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:null})); return true; })()`);
    }
    async function clearEvents() { await bp.evaluate(`window.__grEvents=[]`); }
    async function events() { return bp.evaluate(`window.__grEvents`); }
    async function waitThumbnailOutcome(expected, label) {
      let pair = null;
      await waitFor(async () => {
        const seen = await events();
        const requests = seen.filter((event) => event.type === 'papers:project:window-thumbnail');
        for (const request of requests) {
          const result = seen.find((event) => event.type === 'papers:host:result'
            && event.requestId === request.requestId && event.outcome === expected);
          if (result) { pair = { request, result }; return true; }
        }
        return false;
      }, 20000, label);
      return pair;
    }
    async function sample() {
      return bp.evaluate(`(() => new Promise((resolve) => {
        const img=document.querySelector('[data-wl-popover-preview] img');
        if (!img) return resolve(null);
        const take=()=>{ const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; const g=c.getContext('2d'); g.drawImage(img,0,0); const p=[...g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]; resolve({src:img.src,width:img.naturalWidth,height:img.naturalHeight,pixel:p}); };
        if (img.complete) take(); else img.addEventListener('load',take,{once:true});
      }))()`);
    }
    function near(pixel, expected, tolerance = 40) {
      return pixel && pixel.slice(0, 3).every((v, i) => Math.abs(v - expected[i]) <= tolerance);
    }
    async function waitSample(label) {
      let value = null;
      await waitFor(async () => { value = await sample(); return value; }, 20000, label);
      return value;
    }

    await clearEvents();
    await enter(fixtures[0].title);
    const red = await waitSample('red native thumbnail');
    const firstEvents = await events();
    record('real PrintWindow PNG renders with bounded dimensions and fixture-red center pixel',
      red?.src?.startsWith('data:image/png;base64,') && red.width <= 240 && red.height <= 135 && near(red.pixel, [217,45,45]),
      JSON.stringify({ width:red?.width, height:red?.height, pixel:red?.pixel, events:firstEvents }));
    await leave(fixtures[0].title);

    // Service cache: recolor the SAME HWND, request within TTL => old red;
    // after TTL => new green. UI leave/enter makes distinct page requests.
    recolor(fixtures[0], '#20C96B');
    await sleep(180);
    await clearEvents();
    await enter(fixtures[0].title);
    const cached = await waitSample('cached red thumbnail');
    await leave(fixtures[0].title);
    record('duplicate request inside cache TTL returns the prior validated capture', near(cached?.pixel, [217,45,45]), JSON.stringify({ pixel:cached?.pixel, events:await events() }));
    await sleep(900);
    await clearEvents();
    await enter(fixtures[0].title);
    const fresh = await waitSample('fresh green thumbnail after TTL');
    await leave(fixtures[0].title);
    record('expired cache recaptures the same HWND and exposes its new green pixels', near(fresh?.pixel, [32,201,107]), JSON.stringify({ pixel:fresh?.pixel, events:await events() }));

    // Cancel before the 120ms debounce: no request and no image.
    await clearEvents();
    await enter(fixtures[0].title);
    await sleep(35);
    await leave(fixtures[0].title);
    await sleep(220);
    record('pointer-leave cancel before debounce emits no thumbnail request and clears preview',
      (await events()).filter((e) => e.type === 'papers:project:window-thumbnail').length === 0 && (await sample()) === null,
      JSON.stringify(await events()));

    // Rapid A -> B before debounce: only latest B crosses the bridge and the
    // rendered image is blue. This is the observable latest-only scheduling
    // lane; the unobservable deliberately-late-response race stays unit-tested.
    await clearEvents();
    await enter(fixtures[0].title);
    await sleep(35);
    await leave(fixtures[0].title);
    await enter(fixtures[1].title);
    const blue = await waitSample('latest blue thumbnail');
    const latestEvents = await events();
    record('rapid A-to-B hover sends one latest request and renders only blue B',
      latestEvents.filter((e) => e.type === 'papers:project:window-thumbnail').length === 1 && near(blue?.pixel, [36,87,230]),
      JSON.stringify({ pixel:blue?.pixel, events:latestEvents }));
    await leave(fixtures[1].title);

    // Minimized is an exact typed fallback and produces no image.
    await ctl(fixtures[1].title, 'minimize');
    await waitFor(async () => (await ctl(fixtures[1].title, 'get-show')).iconic === true, 5000, 'fixture minimized');
    await sleep(850); // exclude prior success cache
    await clearEvents();
    await enter(fixtures[1].title);
    await waitThumbnailOutcome('minimized', 'correlated minimized fallback');
    record('minimized native window returns typed minimized and keeps icon/name-only fallback', (await sample()) === null,
      JSON.stringify(await events()));
    await leave(fixtures[1].title);
    await ctl(fixtures[1].title, 'restore');

    // Missing is proven with the exact fixture closed. Cached capability may
    // remain in AYG memory, but the helper identity check returns missing.
    await ctl(fixtures[1].title, 'close');
    await waitFor(async () => (await fixtureWindowCount()) === 1, 10000, 'blue fixture closed');
    await sleep(850);
    await clearEvents();
    await enter(fixtures[1].title);
    await waitThumbnailOutcome('missing', 'correlated missing fallback');
    record('closed native window returns typed missing and renders no fabricated thumbnail', (await sample()) === null,
      JSON.stringify(await events()));
    await leave(fixtures[1].title);

    const durableFiles = [statePath, path.join(papersData, 'registry.json'), path.join(papersData, 'backpack-projects.json'), path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json')];
    const forbidden = durableFiles.flatMap((file) => {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      return /data:image\/png;base64|thumbnail|imageUrl/i.test(text) ? [file] : [];
    });
    record('no durable thumbnail/data-PNG/imageUrl persistence', forbidden.length === 0, JSON.stringify(forbidden));

    await refreshOwned();
    await closeApp(session.proc, session.baseUrl);
    session = null;
    for (const fixture of fixtures) await ctl(fixture.title, 'close').catch(() => undefined);
    await waitFor(async () => (await fixtureWindowCount()) === 0, 10000, 'all exact fixtures closed');
    await sleep(1500);
    const after = await allProcesses();
    record('zero isolated Papers/helper descendants after graceful shutdown', ownedLive(after).length === 0, JSON.stringify(ownedLive(after).map((p)=>p.ProcessId)));
    record('creator Papers PIDs untouched', JSON.stringify(await creatorPids()) === JSON.stringify(creatorBefore), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(await creatorPids())}`);
    const foreignAfter = after.filter((p) => String(p.CommandLine ?? '').includes('window-helper.ps1')).map((p) => `${p.ProcessId}:${p.ParentProcessId}`).sort();
    record('foreign helper PID+parent set untouched', JSON.stringify(foreignAfter) === JSON.stringify(foreignBefore), `before=${JSON.stringify(foreignBefore)} after=${JSON.stringify(foreignAfter)}`);
    record('zero exact disposable fixture windows', (await fixtureWindowCount()) === 0, String(await fixtureWindowCount()));
  } catch (error) {
    record('harness completed main proof', false, String(error).slice(0, 800));
  } finally {
    try {
      if (session) {
        await refreshOwned().catch(() => undefined);
        await closeApp(session.proc, session.baseUrl).catch(() => undefined);
        session = null;
      }
      for (const f of fixtures) await ctl(f.title, 'close').catch(() => undefined);
      for (const proc of fixtureProcs) if (proc.exitCode === null) proc.kill();
      await sleep(1500);
      const processes = await allProcesses().catch(() => []);
      for (const p of ownedLive(processes)) await pwsh(['-NoProfile','-NonInteractive','-Command',`Stop-Process -Id ${Number(p.ProcessId)} -Force -ErrorAction SilentlyContinue`]).catch(()=>undefined);
      await sleep(500);
      record('finally: zero proven-owned survivors', ownedLive(await allProcesses().catch(()=>[])).length === 0, 'PID+CreationDate allowlist');
      record('finally: zero exact fixture windows', (await fixtureWindowCount().catch(()=>-1)) === 0, String(await fixtureWindowCount().catch(()=>-1)));
      record('finally: creator Papers PIDs unchanged', JSON.stringify(await creatorPids().catch(()=>[])) === JSON.stringify(creatorBefore), JSON.stringify(creatorBefore));
    } catch (error) {
      record('finally cleanup had no exception', false, String(error).slice(0, 500));
    }
  }

  const passed = rows.length - failures;
  const text = [
    '019GR ISOLATED NATIVE THUMBNAIL INTEGRATION PROOF',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${temp}`,
    '',
    ...rows.map((r) => `${r.ok ? 'PASS' : 'FAIL'} - ${r.name}${r.detail ? ` :: ${r.detail}` : ''}`),
    '',
    `FINAL SUMMARY: ${passed}/${rows.length} passed, ${failures} failed.`,
  ].join('\r\n');
  fs.writeFileSync(TRANSCRIPT, `${text}\r\n`);
  console.log(`=== SUMMARY: ${passed}/${rows.length} passed, ${failures} failed ===`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
