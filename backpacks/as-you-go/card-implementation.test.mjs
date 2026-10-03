import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { reorderWindowLayoutMember } from './model.mjs';
import { WINDOW_LAYOUT_CARD_MAX_WIDTH } from './public/app/window-layout-widget-channel.js';

const workspaceSource = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
const itemsCss = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');

test('021: attached layout markup removes decorative art and blocks layout editor customization', () => {
  assert.doesNotMatch(workspaceSource, /candidate\.kind === 'window-layout'[\s\S]{0,180}window-layout-art/);
  assert.match(workspaceSource, /if \(windowLayout\(onlyId\)\) \{[\s\S]{0,100}Window layout names and icons are fixed/);
  assert.match(workspaceSource, /windowLayoutBodyMarkup\(candidate/);
});

test('021/034/035: attached card uses compact responsive styling without intrusive scrollbars or button boxes', () => {
  assert.match(itemsCss, /\.window-layout-body\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border:\s*0;/);
  assert.match(itemsCss, /\.window-layout-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
  assert.match(itemsCss, /\.window-layout-members\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(itemsCss, /\.window-layout-controls\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(itemsCss, /^\.window-layout-control\s*\{[^}]*border:\s*1px solid transparent;[^}]*background:\s*transparent;/m);
});

test('036: one measurement-driven compact width boundary shared by attached and detached, never a count breakpoint, exact 1:1', () => {
  // The shared card caps at the compact presentation bound (a WIDTH bound), so a
  // very wide host cannot stretch it into a long strip.
  const card = itemsCss.match(/\.window-layout-card\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(card, /max-width:\s*min\(100%, var\(--wl-card-max-width,\s*280px\)/);
  assert.match(card, /width:\s*100%/);
  assert.match(card, /margin-inline:\s*auto/);
  // It is NOT a member/icon/column-count breakpoint.
  assert.doesNotMatch(itemsCss, /\.window-layout-card[\s\S]{0,200}nth-child/);
  assert.doesNotMatch(itemsCss, /\.window-layout-member:nth-child/);
  // 036: the attached wrapper has no border of its own, so the attached card's
  // outer width equals the persisted host width (the same value the detached
  // card reports) — exact 1:1 with no border/content-box delta.
  assert.match(itemsCss, /\.window-layout-shell\s*\.icon-item\s*\{[^}]*padding:\s*0;/);
  assert.match(itemsCss, /\.window-layout-shell\s*\.icon-item\s*\{[^}]*border:\s*0;/);
  // The card keeps a selection cue that never changes its measured width.
  assert.match(itemsCss, /\.icon-item\.selected \.window-layout-card\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 1\.5px/);
});

test('037: one shared compact presentation maximum, content-fit native host, no empty footprint', () => {
  // The shared JS constant matches the CSS card bound (ONE source of truth).
  assert.equal(WINDOW_LAYOUT_CARD_MAX_WIDTH, 280);
  assert.match(itemsCss, /max-width:\s*min\(100%, var\(--wl-card-max-width,\s*280px\)/);
  // 037: the detached widget SNAPS its client width at the compact maximum and
  // reports the actual capped card/client width (not an empty host footprint).
  assert.match(workspaceSource, /const cardWidth = Math\.min\(width, WINDOW_LAYOUT_CARD_MAX_WIDTH\)/);
  assert.match(workspaceSource, /void host\.widgetReportSize\(cardWidth, height\)/);
  assert.match(workspaceSource, /client\.sendCardSize\(cardWidth, height\)/);
  // 037: the restore caps an over-max legacy persisted width on open.
  assert.match(workspaceSource, /Math\.round\(Math\.min\(cardSize\.width, WINDOW_LAYOUT_CARD_MAX_WIDTH\)\)/);
  // 037: the attached shell footprint is capped at the compact maximum too.
  assert.match(workspaceSource, /const width = Math\.min\(raw, WINDOW_LAYOUT_CARD_MAX_WIDTH\);/);
});

test('038: the compact-widget surface hides ALL workspace host furniture; the shared card + its controls remain', () => {
  // The widget surface (card directly inside the grid) hides every host control:
  // navigation/toolbar (copy/duplicate + Bin/trash), status, selection footer,
  // context menu, editors, confirm dialogs and the backdrop panel.
  assert.match(itemsCss, /body:has\(\.icon-grid > \.window-layout-card\) \.navigation,/);
  assert.match(itemsCss, /body:has\(\.icon-grid > \.window-layout-card\) \.toolbar-float/);
  assert.match(itemsCss, /body:has\(\.icon-grid > \.window-layout-card\) \.context-menu,/);
  assert.match(itemsCss, /body:has\(\.icon-grid > \.window-layout-card\) \.workspace-backdrop,/);
  assert.match(itemsCss, /display: none !important/);
  // The shared card and its LEGITIMATE controls are never hidden.
  assert.doesNotMatch(itemsCss, /\.window-layout-controls\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(itemsCss, /\.window-layout-member\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(itemsCss, /\.window-layout-card\s*\{[^}]*display:\s*none/);
  // The shared card renders one list/direct-pick control rather than a separate picker button.
  assert.doesNotMatch(workspaceSource, /windowLayoutControlButton\('pick'/);
  assert.match(workspaceSource, /data-wl-list/);
  assert.doesNotMatch(workspaceSource, /data-wl-isolate/);
  assert.match(workspaceSource, /right-click to toggle isolate mode/);
});

test('039/041: the detached native client auto-fits the card in BOTH axes (width = card border box, height = rendered card content)', () => {
  // The report measures the CARD content and reports its WIDTH and HEIGHT (not
  // the client size), so no empty surrounding or vertical canvas can persist.
  assert.match(workspaceSource, /const cardWidth = Math\.min\(width, WINDOW_LAYOUT_CARD_MAX_WIDTH\)/);
  assert.match(workspaceSource, /const height = content && content\.height > 0 \? content\.height : window\.innerHeight;/);
  // 041: the client width snaps to the content-fit card border box; 039: the
  // client height auto-corrects; 037: the over-max width snaps. One report.
  assert.match(workspaceSource, /if \(width > WINDOW_LAYOUT_CARD_MAX_WIDTH\s*\|\|\s*Math\.abs\(height - window\.innerHeight\) > 1\)/);
  assert.match(workspaceSource, /void host\.widgetReportSize\(cardWidth, height\)/);
  // Every re-render after the first restore auto-corrects (member-count change);
  // the first restore never measures the transient default width.
  assert.match(workspaceSource, /const wasRestored = windowRestoredOnce;/);
  assert.match(workspaceSource, /if \(wasRestored && !skipHostResize\) reportWidgetSize\(\);/);
  // The shared geometry (content-fit card width + card content height) persists.
  assert.match(workspaceSource, /client\.sendCardSize\(cardWidth, height\);/);
});

test('041: shared cards fill a resizable compact host and fresh shells remain intrinsic-sized', () => {
  const card = itemsCss.match(/\.window-layout-card\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(card, /width:\s*100%/);
  assert.match(card, /max-width:\s*min\(100%, var\(--wl-card-max-width,\s*280px\)/);
  assert.match(card, /margin-inline:\s*auto/);
  assert.match(itemsCss, /\.graph-node-shell\.window-layout-shell\s*\{[^}]*fit-content/);
  assert.match(itemsCss, /\.window-layout-shell \.window-layout-card\s*\{[^}]*resize:\s*horizontal/);
  // Not a member/icon/column-count breakpoint.
  assert.doesNotMatch(itemsCss, /\.window-layout-member:nth-child/);
});

test('041: icon + running bar is ONE indivisible member cell (the bar is absolute inside the button, never an orphan row)', () => {
  assert.match(itemsCss, /\.window-layout-member\s*\{[^}]*position:\s*relative;/);
  assert.match(itemsCss, /\.window-layout-member-state\s*\{[^}]*position:\s*absolute;/);
  assert.match(itemsCss, /\.window-layout-member-state\s*\{[^}]*bottom:\s*0;/);
  // The member button is the single cell that carries the icon and the bar.
  assert.match(itemsCss, /\.window-layout-member\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/);
  assert.match(workspaceSource, /windowLayoutMemberMarkup\(candidate\.id, member, windowLayoutMemberIcon/);
});

test('021: reorder preserves member payloads and changes only persisted order', () => {
  const members = [
    { id: 'a', descriptor: { version: 1, title: 'A' }, bounds: { x: 1 }, state: 'normal' },
    { id: 'b', descriptor: { version: 1, title: 'B' }, bounds: { x: 2 }, state: 'minimized' },
    { id: 'c', descriptor: { version: 1, title: 'C' }, bounds: { x: 3 }, state: 'normal' },
  ];
  const state = { windowLayouts: [{ id: 'L1', arrangement: { version: 2, members } }] };
  const next = reorderWindowLayoutMember(state, 'L1', 'c', 0);
  assert.deepEqual(next.windowLayouts[0].arrangement.members.map((member) => member.id), ['c', 'a', 'b']);
  assert.deepEqual(next.windowLayouts[0].arrangement.members[2], members[1]);
  assert.deepEqual(next.windowLayouts[0].arrangement.members[0], members[2]);
  assert.equal(reorderWindowLayoutMember(state, 'L1', 'a', 0), state);
});

test('035: the attached card becomes a greyed placeholder while its widget is open, lock-only reattach', () => {
  // One shared placeholder predicate drives both the card class and the body.
  assert.match(workspaceSource, /function windowLayoutCardPlaceholder\(options\) \{/);
  assert.match(workspaceSource, /function windowLayoutCardPlaceholder[\s\S]*?if \(options\.widgetSurface === true\) return false;/);
  assert.match(workspaceSource, /window-layout-card--placeholder/);
  // The placeholder body renders DISABLED members and one reattach lock. The call also carries the
  // "cannot confirm this window" note (null for a healthy member), so the guard asserts the disabled flag
  // rather than the exact end of the argument list.
  assert.match(workspaceSource, /windowLayoutMemberMarkup\(candidate\.id, member, windowLayoutMemberIcon\(candidate\.id, member\), true,/);
  assert.match(workspaceSource, /windowLayoutControlButton\('reattach', 'Reattach this window-layout widget', 'data-wl-reattach', candidate\.id\)/);
  assert.doesNotMatch(workspaceSource, /data-wl-detach/);
  // Ordinary workspace clicks stay inert while detached except the lock.
  assert.match(workspaceSource, /detachedLayout && !event\.target\.closest\('\[data-wl-reattach\]'\)\) return;/);
});

test('043: the initial graph fit uses the direct zoomBehavior.transform, never viewportSelection.transition', () => {
  // 043 regression: `viewportSelection.transition()` is unreachable because the
  // vendored d3-selection.js selection has no `transition()` method (it lives
  // only inside d3-zoom.js against its private selection copy). Normal first
  // render must use the existing direct transform so no
  // `viewportSelection.transition is not a function` error is thrown.
  // The animate/default first-fit path must call the direct transform.
  assert.match(
    workspaceSource,
    /function fitGraph\(padding = 90\)[\s\S]*?zoomBehavior\.transform\(viewportSelection, transform\);/,
    'fitGraph applies the fit through zoomBehavior.transform directly',
  );
  // No animated branch may call .transition() on the viewport selection.
  assert.doesNotMatch(workspaceSource, /viewportSelection\.transition\(\)/);
  // No vendored D3 transition patch is required or referenced for the fit.
  assert.doesNotMatch(workspaceSource, /d3-transition/);
});
