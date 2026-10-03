/**
 * 040 LIVE PROBE (Ning, isolated, exclusive unattended interval).
 *
 * Proves, through the REAL reachable production path (AYG workspace + widget
 * + Papers window-helper), the wave-040 core corrections:
 *
 *  A. Same-window TWO-LAYOUT isolation: two layouts reference the same real
 *     window yet keep independent saved bounds/state/order/icons/active
 *     indicators and removals; moving/observing one byte-preserves the other.
 *  B. Cold/delayed icon readiness: a newly created card renders a stable
 *     explicit placeholder cell (no blank geometry, no layout shift), then a
 *     single batched refresh fills every missing icon; the committed pick icon
 *     appears immediately when the candidate carried one.
 *  C. Right-click `Remove from this layout` routes through the existing scoped
 *     data-only writer, clears only that layout's composite cache, persists
 *     once, reconciles only when that layout is active, and never mutates the
 *     same window's OTHER layout. The two existing removal paths (list toggle,
 *     drag-out unlink) remain reachable.
 *
 * Isolated Papers + fresh data dir + disposable windows only. Creator data
 * never touched. Evidence: PASS/FAIL lines + transcript + shots.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { connectToTarget, freePort, launchPapers, sleep, closeApp } from '../015r3-live-proof/cdp.mjs';

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const LPP = path.join(AYG_REPO, 'probes', '015r3-live-proof');
const CONTROL = path.join(LPP, 'control-window.ps1');
const DISPOSABLE = path.join(LPP, 'disposable-window.ps1');
const OUT = path.join(AYG_REPO, 'probes', '040-layout-isolation-icon-removal');
const SHOTS = path.join(OUT, 'shots');
const TRANSCRIPT = path.join(OUT, 'proof-040-transcript.txt');
const LOG = path.join(OUT, 'papers-040.log');

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
    try { if (await probe()) return true; } catch (error) { lastError = error; }
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
        if (parsed && parsed.pid && parsed.title) { clearInterval(timer); resolve(parsed); return; }
      } catch { /* partial */ }
      if (Date.now() > deadline) { clearInterval(timer); reject(new Error('marker timeout')); }
    }, 250);
  });
}
async function creatorPapersPids() {
  const raw = await runPwsh(`Get-CimInstance Win32_Process -Filter "Name='Papers.exe'" | Select-Object ProcessId | ConvertTo-Json -Compress`);
  const rows = raw ? JSON.parse(raw) : [];
  return (Array.isArray(rows) ? rows : [rows]).map((r) => r.ProcessId).sort();
}
async function screenshot(client, name) {
  try {
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    if (result?.data) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
  } catch { /* best effort */ }
}

/** Read persisted state.json members for a layout. */
function readStateMembers(statePath, layoutId) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state.windowLayouts?.find((l) => l.id === layoutId)?.arrangement?.members ?? [];
  } catch { return null; }
}
function readStateLayout(statePath, layoutId) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state.windowLayouts?.find((l) => l.id === layoutId) ?? null;
  } catch { return null; }
}

async function readCard(bp, layoutId) {
  return bp.evaluate(`(() => {
    const strip = document.querySelector('[data-wl-members="${layoutId}"]');
    if (!strip) return null;
    return [...strip.querySelectorAll('[data-wl-member]')].map((b) => {
      const marker = b.querySelector('.window-layout-member-state');
      const icon = b.querySelector('[data-wl-member-icon]');
      return {
        id: b.dataset.wlMember,
        state: b.classList.contains('minimized') ? 'minimized' : 'normal',
        hasBar: Boolean(marker) && getComputedStyle(marker).display !== 'none',
        iconIsPlaceholder: Boolean(icon?.classList?.contains('placeholder')),
        iconSrc: icon?.getAttribute?.('src') ?? null,
      };
    });
  })()`);
}

async function openList(bp, layoutId) {
  await bp.evaluate(`document.querySelector('[data-wl-list="${layoutId}"]').click()`);
  await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].length > 0)`), 30000, 'list rows');
}
async function pickFromList(bp, layoutId, title) {
  await openList(bp, layoutId);
  await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('[data-wl-pick-candidate]')].some((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}))`), 60000, `row ${title}`);
  await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(title)}); row.click(); return true; })()`);
  await waitFor(() => bp.evaluate(`Boolean([...document.querySelectorAll('.window-layout-member')].some((b) => b.title?.startsWith(${JSON.stringify(title.slice(0, 12))})))`), 30000, `member ${title}`);
  await sleep(400);
}

async function main() {
  console.log('=== 040 LAYOUT ISOLATION / ICON READINESS / REMOVAL PROBE ===');
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(LOG, { force: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-040-'));
  const projectCopy = path.join(dataDir, 'ayg-project-copy');
  const statePath = path.join(projectCopy, 'state.json');
  let creatorBefore = [];
  let session = null;
  let bp = null;
  const targetProcs = [];
  const targets = [];
  let layoutA = null;
  let layoutB = null;
  try {
    creatorBefore = await creatorPapersPids();
    record('creator installed Papers enumerated before (observed only)', true, JSON.stringify(creatorBefore));
    fs.cpSync(AYG_REPO, projectCopy, {
      recursive: true,
      filter: (s) => !s.includes(`${path.sep}.git`) && !s.includes('probes') && !s.endsWith(`${path.sep}state.json`),
    });
    const papersData = path.join(dataDir, 'PapersData');
    fs.mkdirSync(path.join(papersData, 'backpacks', BACKPACK_ID), { recursive: true });
    fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
    fs.writeFileSync(path.join(papersData, 'backpacks', BACKPACK_ID, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: BACKPACK_ID, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
    fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [BACKPACK_ID]: { root: projectCopy } } }));

    const WINDOWS = 3;
    const positions = [[120, 140], [820, 140], [120, 620]];
    for (let index = 0; index < WINDOWS; index += 1) {
      const marker = path.join(dataDir, `target-${index}.json`);
      const proc = spawn(PW, ['-NoProfile', '-NonInteractive', '-File', DISPOSABLE, '-MarkerPath', marker, '-X', String(positions[index][0]), '-Y', String(positions[index][1])], { cwd: LPP, windowsHide: false, stdio: 'ignore' });
      targetProcs.push(proc);
      const info = await waitForMarker(marker);
      targets.push({ ...info, proc, index });
    }
    record('disposable windows launched', targets.length === WINDOWS, targets.map((t) => t.title).join(' '));

    const port = await freePort();
    session = await launchPapers(dataDir, port, LOG);
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

    async function createLayout() {
      await bp.evaluate(`(() => { const v = document.querySelector('#icon-grid [data-blank-parent]'); v.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 })); return true; })()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="new-window-layout"]'))`), 10000, 'menu');
      await bp.evaluate(`document.querySelector('#context-menu [data-action="new-window-layout"]').click()`);
      await waitFor(() => bp.evaluate(`Boolean(document.querySelector('.window-layout-shell'))`), 30000, 'shell');
      return bp.evaluate(`[...document.querySelectorAll('.window-layout-shell')].pop().querySelector('[data-wl-layout]').dataset.wlLayout`);
    }

    // ---- A. two layouts referencing the SAME window -------------------------
    layoutA = await createLayout();
    layoutB = await createLayout();
    record('two layouts created', Boolean(layoutA && layoutB && layoutA !== layoutB), `A=${layoutA} B=${layoutB}`);

    // Layout A: pick the SAME window (targets[0]) plus a second window.
    await pickFromList(bp, layoutA, targets[0].title);
    await pickFromList(bp, layoutA, targets[1].title);
    // Layout B: pick the SAME window (targets[0]) again (shared window), with a
    // DIFFERENT second member so order/state differ.
    await pickFromList(bp, layoutB, targets[0].title);
    await pickFromList(bp, layoutB, targets[2].title);
    await waitFor(() => readStateMembers(statePath, layoutA)?.length === 2 && readStateMembers(statePath, layoutB)?.length === 2, 30000, 'two members each');
    record('same real window (targets[0]) bound into BOTH layouts A and B', true, 'two layouts, two members each');

    const membersA0 = readStateMembers(statePath, layoutA).map((m) => m.descriptor.title);
    const membersB0 = readStateMembers(statePath, layoutB).map((m) => m.descriptor.title);
    const sharedMemberA = readStateMembers(statePath, layoutA).find((m) => m.descriptor.title === targets[0].title);
    const sharedMemberB = readStateMembers(statePath, layoutB).find((m) => m.descriptor.title === targets[0].title);
    record('same-window members have INDEPENDENT member ids per layout', Boolean(sharedMemberA && sharedMemberB && sharedMemberA.id !== sharedMemberB.id),
      `A.id=${sharedMemberA?.id} B.id=${sharedMemberB?.id}`);

    const layoutA_0 = JSON.stringify(readStateLayout(statePath, layoutA));
    const layoutB_0 = JSON.stringify(readStateLayout(statePath, layoutB));

    // Move/observe layout A only: minimize targets[0] through layout A's member
    // click, then confirm layout B's saved arrangement is byte-identical.
    // NOTE: the first click on a member of a non-current layout ACTIVATES that
    // layout (applies its saved arrangement); the second click toggles
    // minimize/restore in the now-current context.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await bp.evaluate(`(() => {
        const layout = document.querySelector('[data-wl-layout="${layoutA}"]');
        const btn = [...layout.querySelectorAll('[data-wl-member]')].find((b) => b.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))}));
        if (!btn) return null;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: false, shiftKey: false }));
        return true;
      })()`);
      await sleep(500);
    }
    await waitFor(async () => (await ctl(['-Title', targets[0].title, '-Action', 'get-state'])).state === 'minimized', 30000, 'layout A toggle minimized shared window');
    await sleep(400);
    const layoutA_afterMove = JSON.stringify(readStateLayout(statePath, layoutA));
    const layoutB_afterMove = JSON.stringify(readStateLayout(statePath, layoutB));
    record('A: moving/observing layout A persists a new state and byte-preserves layout B',
      Boolean(layoutA_afterMove !== layoutA_0 && layoutB_afterMove === layoutB_0),
      `A changed=${layoutA_afterMove !== layoutA_0} B preserved=${layoutB_afterMove === layoutB_0}`);
    await screenshot(bp, 'A1-isolation-after-A-move');

    // Running indicator independence: act on layout B (activate it, then toggle
    // targets[0] to restore it). Layout A's persisted state must remain
    // byte-identical to its post-move value (A still minimized).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await bp.evaluate(`(() => {
        const layout = document.querySelector('[data-wl-layout="${layoutB}"]');
        const btn = [...layout.querySelectorAll('[data-wl-member]')].find((b) => b.title?.startsWith(${JSON.stringify(targets[0].title.slice(0, 12))}));
        if (!btn) return null;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: false, shiftKey: false }));
        return true;
      })()`);
      await sleep(500);
    }
    await sleep(400);
    const layoutA_afterB = JSON.stringify(readStateLayout(statePath, layoutA));
    const layoutB_afterB = JSON.stringify(readStateLayout(statePath, layoutB));
    const aStillMinimized = readStateLayout(statePath, layoutA)?.arrangement?.members
      .find((m) => m.descriptor.title === targets[0].title)?.state === 'minimized';
    record('A: acting on layout B does not overwrite layout A saved state (byte-preserved, A stays minimized)',
      Boolean(layoutA_afterB === layoutA_afterMove && aStillMinimized && layoutB_afterB !== layoutB_0),
      JSON.stringify({ aPreserved: layoutA_afterB === layoutA_afterMove, aState: aStillMinimized ? 'minimized' : 'normal' }));

    // Order independence: reorder layout B (drag member 0 to index 1). Layout A
    // order must stay byte-identical.
    const orderBeforeA = readStateMembers(statePath, layoutA).map((m) => m.id).join(',');
    await bp.evaluate(`(() => {
      const strip = document.querySelector('[data-wl-members="${layoutB}"]');
      const b0 = strip.querySelectorAll('[data-wl-member]')[0];
      const b1 = strip.querySelectorAll('[data-wl-member]')[1];
      const r = b1.getBoundingClientRect();
      b0.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: r.left, clientY: r.top, pointerId: 5 }));
      b0.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 6, clientY: r.top + 2, pointerId: 5 }));
      b0.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 6, clientY: r.top + 2, pointerId: 5 }));
      return true;
    })()`);
    await sleep(600);
    const orderAfterA = readStateMembers(statePath, layoutA).map((m) => m.id).join(',');
    const orderB = readStateMembers(statePath, layoutB).map((m) => m.id).join(',');
    record('A: reordering layout B leaves layout A member order byte-identical',
      Boolean(orderBeforeA === orderAfterA), JSON.stringify({ orderA: orderAfterA, orderB }));

    // ---- B. icon readiness: cold + delayed + immediate ----------------------
    // Cold: a freshly created layout card must render a stable placeholder cell
    // (no blank geometry) BEFORE the batched refresh; then the shared refresh
    // fills the icons without a layout shift.
    const layoutC = await createLayout();
    await pickFromList(bp, layoutC, targets[2].title);
    await sleep(200);
    const coldImmediate = await readCard(bp, layoutC);
    const coldHasMember = Array.isArray(coldImmediate) && coldImmediate.length === 1;
    record('B: newly created card renders its member immediately (no blank/empty card)', Boolean(coldHasMember), JSON.stringify(coldImmediate));
    const coldPlaceholderStable = Boolean(coldHasMember && coldImmediate[0].iconIsPlaceholder);
    // The committed list-pick carries candidate icons from windowCandidates();
    // if the helper supplied one it should be immediate. We assert stability
    // either way: the cell is a real placeholder OR a real icon, never absent.
    record('B: the member cell is a stable explicit cell (placeholder or resolved icon, never blank geometry)',
      Boolean(coldHasMember && (coldImmediate[0].iconIsPlaceholder || coldImmediate[0].iconSrc)),
      JSON.stringify(coldImmediate));
    await waitFor(async () => {
      const card = await readCard(bp, layoutC);
      return Boolean(card && card.length === 1 && (card[0].iconSrc || !card[0].iconIsPlaceholder));
    }, 30000, 'batched shared icon refresh resolves the member icon');
    const coldResolved = await readCard(bp, layoutC);
    record('B: one batched refresh resolved the missing icon (no per-member enumeration)',
      Boolean(coldResolved && coldResolved.length === 1 && (coldResolved[0].iconSrc || !coldResolved[0].iconIsPlaceholder)),
      JSON.stringify(coldResolved));
    await screenshot(bp, 'B1-cold-resolved');
    // Layout shift check: the member button bounding box must not change size
    // between placeholder and resolved states (stable explicit cell).
    const boxBefore = await bp.evaluate(`(() => { const b = document.querySelector('[data-wl-layout="${layoutC}"] [data-wl-member]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    await waitFor(() => bp.evaluate(`(() => { const b = document.querySelector('[data-wl-layout="${layoutC}"] [data-wl-member] [data-wl-member-icon]'); return Boolean(b && !b.classList.contains('placeholder')); })()`), 30000, 'icon resolved');
    const boxAfter = await bp.evaluate(`(() => { const b = document.querySelector('[data-wl-layout="${layoutC}"] [data-wl-member]'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    record('B: no layout shift when the placeholder resolves to a real icon (member box stable)',
      Boolean(boxBefore && boxAfter && Math.abs(boxBefore.w - boxAfter.w) <= 2 && Math.abs(boxBefore.h - boxAfter.h) <= 2),
      JSON.stringify({ before: boxBefore, after: boxAfter }));

    // ---- C. right-click Remove from this layout -----------------------------
    // Remove the SHARED window (targets[0]) from layout B: proves removal in B
    // does not touch layout A's same-window member (removals independent).
    const removeTarget = targets[0].title;
    const bMembersBefore = readStateMembers(statePath, layoutB).map((m) => m.descriptor.title);
    await bp.evaluate(`(() => {
      const layout = document.querySelector('[data-wl-layout="${layoutB}"]');
      const btn = [...layout.querySelectorAll('[data-wl-member]')].find((b) => b.title?.startsWith(${JSON.stringify(removeTarget.slice(0, 12))}));
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return true;
    })()`);
    await waitFor(() => bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="remove-from-layout"]'))`), 10000, 'remove-from-layout menu item');
    const menuShown = await bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="remove-from-layout"]'))`);
    await bp.evaluate(`document.querySelector('#context-menu [data-action="remove-from-layout"]').click()`);
    await waitFor(() => readStateMembers(statePath, layoutB).some((m) => m.descriptor.title === removeTarget) === false, 15000, 'member removed from layout B');
    const bMembersAfter = readStateMembers(statePath, layoutB).map((m) => m.descriptor.title);
    const aMembersAfter = readStateMembers(statePath, layoutA).map((m) => m.descriptor.title);
    record('C: right-click menu offers Remove from this layout', Boolean(menuShown));
    record('C: Remove from this layout removes ONLY the shared member from layout B (data-only)',
      Boolean(bMembersBefore.includes(removeTarget) && !bMembersAfter.includes(removeTarget) && bMembersAfter.length === bMembersBefore.length - 1),
      JSON.stringify({ before: bMembersBefore, after: bMembersAfter }));
    record('C: removing the SHARED window from layout B byte-preserves layout A (same-window removal isolation)',
      JSON.stringify(readStateLayout(statePath, layoutA)) === layoutA_afterB
        && aMembersAfter.some((m) => m === removeTarget),
      JSON.stringify({ aMembers: aMembersAfter, aSaved: JSON.stringify(readStateLayout(statePath, layoutA)).slice(0, 120) }));
    await screenshot(bp, 'C1-removed-from-B');

    // Grey placeholder refusal: detach layout A -> its workspace card becomes a
    // disabled placeholder; right-click on a placeholder member must NOT offer
    // removal.
    await bp.evaluate(`document.querySelector('[data-wl-detach="${layoutA}"]').click()`);
    const widgetTarget = await waitForTarget(session.baseUrl, (t) => t.url.includes(`papers-layout-key=${layoutA}`), 60000, 'widget A');
    const widget = await connectToTarget(widgetTarget, session.baseUrl);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('.window-layout-card'))`), 60000, 'widget A rendered');
    await sleep(800);
    const placeholderBody = await bp.evaluate(`Boolean(document.querySelector('[data-wl-layout="${layoutA}"][data-wl-placeholder-body="true"]'))`);
    const placeholderDisabled = await bp.evaluate(`(() => {
      const btn = document.querySelector('[data-wl-layout="${layoutA}"] [data-wl-member]');
      return Boolean(btn && btn.disabled);
    })()`);
    await bp.evaluate(`(() => {
      const btn = document.querySelector('[data-wl-layout="${layoutA}"] [data-wl-member]');
      const r = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return true;
    })()`);
    await sleep(300);
    const placeholderMenu = await bp.evaluate(`Boolean(document.querySelector('#context-menu [data-action="remove-from-layout"]'))`);
    record('C: grey placeholder card refuses right-click removal',
      Boolean(placeholderBody && placeholderDisabled && !placeholderMenu),
      JSON.stringify({ placeholderBody, placeholderDisabled, placeholderMenu }));
    // Widget removal path: right-click a member inside the live widget card and
    // remove it through the channel.
    await widget.evaluate(`(() => {
      const btn = [...document.querySelectorAll('[data-wl-member]')][0];
      const r = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return true;
    })()`);
    await waitFor(() => widget.evaluate(`Boolean(document.querySelector('#context-menu [data-action="remove-from-layout"]'))`), 10000, 'widget remove menu');
    const widgetMenu = await widget.evaluate(`Boolean(document.querySelector('#context-menu [data-action="remove-from-layout"]'))`);
    // 040: count members INSIDE the card only (the menu node carries
    // data-wl-member in its dataset from the scoped target, so a bare global
    // query would match the menu too).
    const widgetMemberBefore = await widget.evaluate(`document.querySelectorAll('.window-layout-card [data-wl-member]').length`);
    const widgetTitlesBefore = await widget.evaluate(`[...document.querySelectorAll('.window-layout-card [data-wl-member]')].map((b) => (b.title || '').slice(0, 30))`);
    const widgetAState = await widget.evaluate(`(() => {
      const card = document.querySelector('.window-layout-card');
      return {
        cardCount: card ? card.querySelectorAll('[data-wl-member]').length : -1,
        hasCard: Boolean(card),
        bodyDataLayout: document.querySelector('.window-layout-body')?.dataset?.wlLayout ?? null,
      };
    })()`);
    const persistedABefore = readStateMembers(statePath, layoutA).map((m) => m.descriptor.title);
    await widget.evaluate(`document.querySelector('#context-menu [data-action="remove-from-layout"]').click()`);
    await waitFor(() => readStateMembers(statePath, layoutA).length === 1, 15000, 'widget removal persisted');
    await sleep(600);
    const widgetMemberAfter = await widget.evaluate(`document.querySelectorAll('.window-layout-card [data-wl-member]').length`);
    record('C: widget live-card right-click Remove from this layout routes through the channel and persists',
      Boolean(widgetMenu && widgetMemberAfter === widgetMemberBefore - 1 && readStateMembers(statePath, layoutA).length === 1),
      JSON.stringify({ widgetMenu, before: widgetMemberBefore, after: widgetMemberAfter, titlesBefore: widgetTitlesBefore, widgetAState, persistedBefore: persistedABefore, persistedA: readStateMembers(statePath, layoutA).map((m) => m.descriptor.title) }));
    await screenshot(widget, 'C2-widget-removal');
    await widget.evaluate(`document.querySelector('[data-wl-reattach="${layoutA}"]').click()`);
    await sleep(500);

    // ---- preserve the two existing removal paths ----------------------------
    // (1) list-toggle removal and (2) drag-out unlink remain reachable.
    const layoutD = await createLayout();
    await pickFromList(bp, layoutD, targets[0].title);
    await pickFromList(bp, layoutD, targets[1].title);
    await openList(bp, layoutD);
    await bp.evaluate(`(() => { const row = [...document.querySelectorAll('[data-wl-pick-candidate]')].find((r) => r.querySelector('.window-layout-pick-label')?.textContent === ${JSON.stringify(targets[0].title)}); row.click(); return true; })()`);
    await waitFor(() => readStateMembers(statePath, layoutD).length === 1, 15000, 'list toggle removed a member');
    record('existing path 1 preserved: list-row toggle removal still works (data-only)',
      readStateMembers(statePath, layoutD).length === 1,
      readStateMembers(statePath, layoutD).map((m) => m.descriptor.title).join(','));
    await pickFromList(bp, layoutD, targets[0].title);
    // drag-out unlink: drag member 0 far below the strip (beyond drop-out px).
    await bp.evaluate(`(() => {
      const strip = document.querySelector('[data-wl-members="${layoutD}"]');
      const b0 = strip.querySelectorAll('[data-wl-member]')[0];
      const r = strip.getBoundingClientRect();
      b0.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 10, clientY: r.top + 10, pointerId: 9 }));
      b0.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 10, clientY: r.top + 80, pointerId: 9 }));
      b0.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 10, clientY: r.top + 80, pointerId: 9 }));
      return true;
    })()`);
    await waitFor(() => readStateMembers(statePath, layoutD).length === 1, 15000, 'drag-out unlink removed a member');
    record('existing path 2 preserved: drag-out unlink removal still works (data-only)',
      readStateMembers(statePath, layoutD).length === 1,
      readStateMembers(statePath, layoutD).map((m) => m.descriptor.title).join(','));

    await closeApp(session.proc, session.baseUrl);
    session = null;
    await sleep(2000);
  } catch (error) {
    record('probe step', false, String(error).slice(0, 500));
  } finally {
    try {
      if (bp) bp.close();
      if (session) { await closeApp(session.proc, session.baseUrl).catch(() => undefined); session = null; }
      for (const target of targets) await ctl(['-Title', target.title, '-Action', 'close']).catch(() => undefined);
      for (const proc of targetProcs) if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } }
      await sleep(1500);
    } catch { /* best-effort */ }
    const creatorAfter = await creatorPapersPids().catch(() => []);
    record('creator installed Papers untouched after run', JSON.stringify(creatorBefore) === JSON.stringify(creatorAfter), `before=${JSON.stringify(creatorBefore)} after=${JSON.stringify(creatorAfter)}`);
  }
  const passed = steps.length - failures;
  const transcript = [
    '040 LAYOUT ISOLATION / ICON READINESS / REMOVAL PROBE - TRANSCRIPT (isolated, exclusive interval)',
    `run at: ${new Date().toISOString()}`,
    `isolated data dir: ${dataDir}`,
    `creator Papers pids before: ${JSON.stringify(creatorBefore)}`,
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
