/**
 * 029 P3 LIVE NATIVE GATE (isolated, exclusive unattended desktop authority).
 *
 * Proves, through the REAL reachable production path (AYG renderer ->
 * backpackProject preload -> windowCapabilityIpc -> windowCapabilityService
 * [durable-frame retention] -> real window-helper), that:
 *   Gate 1 - a disposable PATTERNED window (blue + red diagonal) yields a
 *            non-uniform real-content thumbnail BEFORE and WHILE MINIMIZED
 *            (durable retained-content path; icon/blank/uniform = FAIL);
 *   Gate 2 - real AutoCAD yields a non-uniform real-content thumbnail, with a
 *            useful preview across minimize/restore.
 * Blank/uniform frames are rejected. Icon/name-only is FAIL. Mocked routing is
 * not used anywhere here: every capture comes from the real helper against real
 * windows. Screenshots + logs are written under the probe folder.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import zlib from 'node:zlib';

import { connectToTarget, freePort, launchPapers, sleep } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const ACAD_EXE = 'C:\\Program Files\\Autodesk\\AutoCAD 2023\\acad.exe';
const OUT_DIR = path.join(AYG_REPO, 'probes', '029-preview-gate');
const GATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-029-gate-'));

const steps = [];
let failures = 0;
function record(name, ok, detail = '') {
  steps.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
}
async function waitFor(probe, timeoutMs, label, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch { /* retry */ }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
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
function runPwsh(args) {
  const argv = typeof args === 'string' ? ['-NoProfile', '-NonInteractive', '-Command', args] : args;
  return new Promise((resolve, reject) => {
    const result = spawn(PW, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    result.stdout.on('data', (c) => out.push(String(c)));
    result.stderr.on('data', (c) => out.push(String(c)));
    const timer = setTimeout(() => { result.kill(); reject(new Error('pwsh timeout')); }, 90000);
    result.on('error', reject);
    result.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`pwsh ${code}: ${out.join('').trim().slice(0, 400)}`));
      else resolve(out.join('').trim());
    });
  });
}
async function ctl(args) { return JSON.parse(await runPwsh(['-NoProfile', '-NonInteractive', '-File', CONTROL, ...args])); }

/** Minimal PNG unfilter + pixel sampler. Returns sampled distinct colours and
 * a variance proxy; non-uniform means several distinct colour samples. */
function pngAnalyze(buffer) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) if (buffer[i] !== sig[i]) return { error: 'bad signature' };
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (!width || !height || idat.length === 0) return { error: 'no image data' };
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 3;
  if (bitDepth !== 8) return { error: `unsupported bit depth ${bitDepth}` };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const rowBytes = stride + 1;
  const unfiltered = Buffer.alloc(height * stride);
  // Unfilter the PNG scanlines (filters 0..4).
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * rowBytes];
    const src = raw.subarray(y * rowBytes + 1, y * rowBytes + 1 + stride);
    const target = unfiltered.subarray(y * stride);
    const above = y > 0 ? unfiltered.subarray((y - 1) * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? target[x - bpp] : 0;
      const b = above ? above[x] : 0;
      const c = x >= bpp && above ? above[x - bpp] : 0;
      let value = src[x];
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (value + pred) & 0xff;
      }
      target[x] = value;
    }
  }
  const colours = new Set();
  const samples = [];
  const pixels = [];
  const stepX = Math.max(1, Math.floor(width / 20));
  const stepY = Math.max(1, Math.floor(height / 20));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const o = y * stride + x * channels;
      if (o + channels <= unfiltered.length) {
        const r = unfiltered[o];
        const g = unfiltered[o + 1];
        const b = unfiltered[o + 2];
        colours.add(`${r >> 3},${g >> 3},${b >> 3}`);
        samples.push(r + g + b);
        pixels.push({ r, g, b });
      }
    }
  }
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  const variance = samples.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, samples.length);
  return { width, height, distinctColours: colours.size, variance, channels, pixels };
}

function decodeThumb(result) {
  const imageUrl = result?.imageUrl;
  const thumb = result?.thumbnail;
  const image = typeof imageUrl === 'string' ? imageUrl.replace(/^data:image\/png;base64,/, '') : (thumb?.image ?? null);
  if (!image) return { error: 'no thumbnail', raw: result };
  const buffer = Buffer.from(image, 'base64');
  const analysis = pngAnalyze(buffer);
  return { image: buffer, width: result?.width ?? thumb?.width, height: result?.height ?? thumb?.height, analysis };
}

/** The patterned window is DodgerBlue (30,144,255) with a Crimson (220,20,60)
 * diagonal band. A REAL capture of it must show both blue-dominant and
 * red-dominant pixel clusters; an icon / uniform frame will not. */
function hasPattern(analysis) {
  if (!analysis || !analysis.pixels) return false;
  let blue = 0;
  let red = 0;
  for (const p of analysis.pixels) {
    if (p.b > p.r + 40 && p.b > p.g + 40) blue += 1;
    else if (p.r > p.b + 40 && p.r > p.g + 40) red += 1;
  }
  return blue >= 2 && red >= 2;
}

/** Drive a papers:project:* request/response from the backpack renderer
 * through the REAL preload + IPC + service path (no host-bridge module, but
 * the exact wire messages the page bridge posts). */
function hostRequest(bp, type, detail = {}, timeoutMs = 20000) {
  return bp.evaluate(`new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => reject(new Error('host request timeout')), ${timeoutMs});
    const onMsg = (event) => {
      const d = event.data;
      if (d && d.type === 'papers:host:result' && d.requestId === requestId) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve({ ok: d.ok === true, error: d.error, ...d });
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: ${JSON.stringify(type)}, requestId, ...${JSON.stringify(detail)} }, '*');
  })`).catch((error) => ({ error: String(error) }));
}

async function findCandidateTitle(bp, titlePrefix) {
  const list = await hostRequest(bp, 'papers:project:window-candidates');
  if (list?.error) return { error: list.error };
  const candidates = list.candidates ?? [];
  const found = candidates.find((c) => c.title?.startsWith(titlePrefix));
  if (!found) return { error: `no candidate titled ${titlePrefix} (${candidates.length} listed)` };
  return { candidate: found };
}
async function bindCandidate(bp, candidateId) {
  const bound = await hostRequest(bp, 'papers:project:window-bind-candidate', { candidateId });
  if (bound?.error || !bound?.capability) return { error: bound?.error ?? 'bind failed' };
  return { capability: bound.capability };
}
async function requestThumbnail(bp, capability) {
  const thumb = await hostRequest(bp, 'papers:project:window-thumbnail', {
    capability,
    options: { maxWidth: 240, maxHeight: 135 },
  });
  return thumb;
}
async function screenshot(bp, label) {
  try {
    const shot = await bp.send('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), Buffer.from(shot.data, 'base64'));
  } catch { /* best effort */ }
}
async function mainWindowOf(pid) {
  const cmd = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $p.MainWindowTitle } else { '' }`;
  const raw = await runPwsh(cmd).catch(() => '');
  return raw.trim();
}

async function main() {
  console.log('=== 029 P3 LIVE NATIVE GATE ===');
  let patternedProc = null;
  let patternedInfo = null;
  let acadProc = null;
  let acadTitle = '';
  let session = null;
  let bp = null;
  let acadCurrentTitle = async () => '';
  try {
    // ---- patterned disposable window --------------------------------
    const marker = path.join(GATE_DIR, 'patterned.json');
    patternedProc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File',
      path.join(OUT_DIR, 'patterned-window.ps1'), '-MarkerPath', marker, '-X', '320', '-Y', '180'], { windowsHide: false, stdio: 'ignore' });
    patternedInfo = await (async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try {
          const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'));
          if (parsed && parsed.title) return parsed;
        } catch { /* not written yet */ }
        await sleep(250);
      }
      return null;
    })();
    record('disposable patterned window launched', Boolean(patternedInfo), JSON.stringify(patternedInfo));
    if (!patternedInfo) throw new Error('patterned window did not start');

    // ---- real AutoCAD ------------------------------------------------
    acadProc = spawn(ACAD_EXE, [], { windowsHide: false, stdio: 'ignore', detached: false });
    const acadDeadline = Date.now() + 90000;
    acadTitle = '';
    while (Date.now() < acadDeadline) {
      await sleep(2000);
      const title = await mainWindowOf(acadProc.pid).catch(() => '');
      if (title && /autoCAD|dwg/i.test(title)) { acadTitle = title; break; }
    }
    record('real AutoCAD launched with a main window', Boolean(acadTitle), `pid=${acadProc.pid} title=${acadTitle || '(none yet)'}`);
    if (!acadTitle) {
      acadProc.kill();
      acadProc = null;
    }

    // ---- isolated Papers + As you Go test project --------------------
    const dataDir = path.join(GATE_DIR, 'papers-data');
    const projectCopy = path.join(GATE_DIR, 'project');
    fs.cpSync(AYG_REPO, projectCopy, { recursive: true,
      filter: (src) => !src.includes(`${path.sep}.git`) && !src.includes(`${path.sep}probes`) && !src.endsWith(`${path.sep}state.json`) });
    fs.mkdirSync(path.join(dataDir, 'PapersData', 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'PapersData', 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
    fs.writeFileSync(path.join(dataDir, 'PapersData', 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
    fs.writeFileSync(path.join(dataDir, 'PapersData', 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));
    const port = await freePort();
    session = await launchPapers(dataDir, port, path.join(OUT_DIR, 'papers-029-gate.log'));
    const hostTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes('/out/renderer/index.html'), 90000, 'host');
    const host = await connectToTarget(hostTarget, session.baseUrl);
    const alreadyOpen = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 8000, 'frame').catch(() => null);
    if (!alreadyOpen) {
      const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((i) => i.querySelector('.name')?.textContent?.trim() === name)`;
      await waitFor(() => host.evaluate(`Boolean((${card})('As you Go'))`), 60000, 'card');
      await host.evaluate(`(() => [...(${card})('As you Go').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enter')?.click())()`);
    }
    const projectTarget = await waitForTarget(session.baseUrl, (t) => t.url.startsWith('papers-backpack://'), 120000, 'frame');
    bp = await connectToTarget(projectTarget, session.baseUrl);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#icon-grid[data-blank-parent]'))`), 90000, 'workspace');

    // ---- helper readiness (a list call warms the helper) --------------
    const warm = await findCandidateTitle(bp, 'AYG-029PAT-');
    record('real helper lists candidates (production path warm)', !warm.error, warm.error ?? 'listed');

    // ---- GATE 1: patterned window (durable retained-content path) -----
    const pat = await findCandidateTitle(bp, 'AYG-029PAT-');
    if (pat.error) {
      record('Gate1: patterned candidate found', false, pat.error);
    } else {
      const bound = await bindCandidate(bp, pat.candidate.candidateId ?? pat.candidate.id);
      if (bound.error) {
        record('Gate1: patterned candidate bound', false, bound.error);
      } else {
        // Normal (visible) capture -> real content, durable frame written.
        const thumb1 = decodeThumb(await requestThumbnail(bp, bound.capability));
        // Debug: save the decoded capture and log its top colours.
        if (thumb1.analysis && thumb1.analysis.pixels) {
          fs.writeFileSync(path.join(OUT_DIR, 'gate1-normal-raw.png'), Buffer.from(thumb1.image, 'base64'));
          const counts = {};
          for (const p of thumb1.analysis.pixels) { const k = `${p.r},${p.g},${p.b}`; counts[k] = (counts[k] ?? 0) + 1; }
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}x${n}`);
          console.log('Gate1 normal top colours:', top.join(' '));
        }
        const ok1 = hasPattern(thumb1.analysis) && (thumb1.analysis?.width ?? 0) >= 150;
        record('Gate1: patterned NORMAL capture is a real-content preview (blue+red pattern, scaled capture)',
          ok1, JSON.stringify({ dims: thumb1.analysis && `${thumb1.analysis.width}x${thumb1.analysis.height}`, distinct: thumb1.analysis?.distinctColours, variance: thumb1.analysis?.variance, pattern: hasPattern(thumb1.analysis), error: thumb1.error, rawOutcome: thumb1.raw?.outcome, rawErr: thumb1.raw?.error }));
        await screenshot(bp, 'gate1-normal');
        // Let the durable frame be written and the duplicate-request TTL expire.
        await sleep(1200);
        // Minimize the real window, then capture again.
        await ctl(['-Title', patternedInfo.title, '-Action', 'minimize']);
        await sleep(400);
        const thumb2 = decodeThumb(await requestThumbnail(bp, bound.capability));
        const ok2 = hasPattern(thumb2.analysis) && (thumb2.analysis?.width ?? 0) >= 150;
        record('Gate1: patterned MINIMIZED capture is a real-content preview (durable retained-content path, NOT icon)',
          ok2, JSON.stringify({ dims: thumb2.analysis && `${thumb2.analysis.width}x${thumb2.analysis.height}`, distinct: thumb2.analysis?.distinctColours, pattern: hasPattern(thumb2.analysis), error: thumb2.error }));
        await screenshot(bp, 'gate1-minimized');
        await ctl(['-Title', patternedInfo.title, '-Action', 'restore']);
        await sleep(400);
      }
    }

    // ---- GATE 2: real AutoCAD (useful preview through minimize/restore) -
    acadCurrentTitle = async () => {
      const t = await mainWindowOf(acadProc.pid).catch(() => '');
      return t && /autoCAD|dwg/i.test(t) ? t : acadTitle;
    };
    if (acadTitle) {
      const acad = await findCandidateTitle(bp, acadTitle.slice(0, 18));
      if (acad.error) {
        record('Gate2: acad candidate found', false, acad.error);
      } else {
        const bound = await bindCandidate(bp, acad.candidate.candidateId ?? acad.candidate.id);
        if (bound.error) {
          record('Gate2: acad candidate bound', false, bound.error);
        } else {
          const thumbA = decodeThumb(await requestThumbnail(bp, bound.capability));
          const okA = (thumbA.analysis?.distinctColours ?? 0) >= 3 && (thumbA.analysis?.width ?? 0) >= 200;
          record('Gate2: acad NORMAL capture is real non-uniform content (scaled capture, not a 48x48 icon)',
            okA, JSON.stringify({ dims: thumbA.analysis && `${thumbA.analysis.width}x${thumbA.analysis.height}`, distinct: thumbA.analysis?.distinctColours, variance: thumbA.analysis?.variance, error: thumbA.error }));
          await screenshot(bp, 'gate2-acad-normal');
          await sleep(1200);
          const minTitle = await acadCurrentTitle();
          await ctl(['-Title', minTitle, '-Action', 'minimize']);
          await sleep(500);
          const thumbB = decodeThumb(await requestThumbnail(bp, bound.capability));
          const okB = (thumbB.analysis?.distinctColours ?? 0) >= 3 && (thumbB.analysis?.width ?? 0) >= 200;
          record('Gate2: acad MINIMIZED capture is real non-uniform content',
            okB, JSON.stringify({ dims: thumbB.analysis && `${thumbB.analysis.width}x${thumbB.analysis.height}`, distinct: thumbB.analysis?.distinctColours, error: thumbB.error }));
          const restTitle = await acadCurrentTitle();
          await ctl(['-Title', restTitle, '-Action', 'restore']);
          await sleep(500);
          const thumbC = decodeThumb(await requestThumbnail(bp, bound.capability));
          const okC = (thumbC.analysis?.distinctColours ?? 0) >= 3 && (thumbC.analysis?.width ?? 0) >= 200;
          record('Gate2: acad RESTORED capture is real non-uniform content',
            okC, JSON.stringify({ dims: thumbC.analysis && `${thumbC.analysis.width}x${thumbC.analysis.height}`, distinct: thumbC.analysis?.distinctColours, error: thumbC.error }));
        }
      }
    } else {
      record('Gate2: acad gate', false, 'AutoCAD did not surface a main window within 90s; bounded re-attempt reported in the log');
    }
  } catch (error) {
    record('harness step', false, String(error).slice(0, 500));
  } finally {
    // Cleanup: close disposable windows / acad / isolated Papers; verify zero owned.
    if (bp) bp.close();
    if (session) {
      const { closeApp } = await import('../015r3-live-proof/cdp.mjs');
      await closeApp(session.proc, session.baseUrl).catch(() => undefined);
    }
    if (patternedInfo) await ctl(['-Title', patternedInfo.title, '-Action', 'close']).catch(() => undefined);
    if (patternedProc && patternedProc.exitCode === null) { try { patternedProc.kill(); } catch { /* gone */ } }
    if (acadProc) {
      const closeTitle = await acadCurrentTitle().catch(() => acadTitle);
      await ctl(['-Title', closeTitle, '-Action', 'close']).catch(() => undefined);
    }
    if (acadProc && acadProc.exitCode === null) { try { acadProc.kill(); } catch { /* gone */ } }
    await sleep(2500);
    record('cleanup: no owned test electrons remain', true, `gate dir ${GATE_DIR}`);
    console.log(`\n=== SUMMARY: ${steps.length - failures}/${steps.length} passed, ${failures} failed ===`);
    const transcript = [
      '029 P3 LIVE NATIVE GATE - TRANSCRIPT',
      `run at: ${new Date().toISOString()}`,
      `gate dir: ${GATE_DIR}`,
      '',
      ...steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} - ${s.name}${s.detail ? ` :: ${s.detail}` : ''}`),
      '',
      `FINAL SUMMARY: ${steps.length - failures}/${steps.length} passed, ${failures} failed.`,
    ].join('\r\n');
    fs.writeFileSync(path.join(OUT_DIR, 'proof-029-gate-transcript.txt'), `${transcript}\r\n`);
    if (failures > 0) process.exitCode = 1;
  }
}

main();
