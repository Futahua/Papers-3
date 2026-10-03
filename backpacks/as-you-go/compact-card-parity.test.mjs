import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceSource = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
const itemsCss = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');

test('024: the decorative folder-art rule is removed (no folder illustration)', () => {
  assert.doesNotMatch(itemsCss, /\.window-layout-art\s*\{/);
  assert.doesNotMatch(itemsCss, /\.window-layout-art::before/);
});

test('024: the running bar is shown ONLY for open/normal members - minimized and missing hide it entirely', () => {
  const hidden = itemsCss.match(/\.window-layout-member-state\.minimized,\s*\.window-layout-member-state\.missing\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(hidden, /display:\s*none/);
  assert.doesNotMatch(itemsCss, /\.window-layout-member-state\.minimized\s*\{\s*opacity:/);
});

test('033/034/035/036 C5: the ONE shared card component (`.window-layout-card`) is rendered 1:1 attached and detached, with NO redundant title', () => {
  const card = itemsCss.match(/\.window-layout-card\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(card, /display:\s*block/);
  assert.match(card, /width:\s*100%/);
  assert.match(card, /min-width:\s*0/);
  assert.match(card, /border-radius:\s*8px/);
  // 035/036: the attached shell takes the layout's persisted shared host width.
  assert.match(itemsCss, /\.window-layout-shell\s*\{[\s\S]*?width:\s*var\(--wl-card-width,\s*fit-content\)/);
  // 036: ONE shared measurement-driven compact presentation-width bound (a WIDTH
  // bound, not a member/icon/column-count breakpoint), applied to the shared card.
  assert.match(itemsCss, /\.window-layout-card\s*\{[^}]*max-width:\s*min\(100%, var\(--wl-card-max-width,\s*280px\)/);
  // 036: the attached wrapper has NO border so the attached card's outer width
  // equals the persisted host width exactly (no border/content-box 1:1 delta).
  assert.match(itemsCss, /\.window-layout-shell\s*\.icon-item\s*\{[^}]*border:\s*0;/);
  // No redundant "Window layout" title anywhere in the shared card markup/CSS.
  assert.doesNotMatch(itemsCss, /\.window-layout-card-title/);
  assert.doesNotMatch(workspaceSource, /window-layout-card-title/);
  // Both the attached grid node and the detached widget render the SAME card.
  assert.match(workspaceSource, /windowLayoutCardMarkup\(candidate, \{ detached: detachedWidgets\.has\(candidate\.id\) \}\)/);
  assert.match(workspaceSource, /windowLayoutCardMarkup\([\s\S]*?widgetSurface:\s*true/);
  assert.match(workspaceSource, /function windowLayoutCardMarkup/);
});

test('034/035/036 C4: compact row WRAPPING from the measured available width, capped at one compact width bound - no count breakpoints, no clip, no unbounded strip', () => {
  const members = itemsCss.match(/\.window-layout-members\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(members, /flex-wrap:\s*wrap/);
  assert.match(members, /overflow-x:\s*visible/);
  const controls = itemsCss.match(/\.window-layout-controls\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(controls, /flex-wrap:\s*wrap/);
  // No shrink-based four/eight icon cap rules and no count-driven breakpoints.
  assert.doesNotMatch(itemsCss, /:has\(\.window-layout-member:nth-child\(5\)\)/);
  assert.doesNotMatch(itemsCss, /:has\(\.window-layout-member:nth-child\(9\)\)/);
  assert.doesNotMatch(itemsCss, /nth-child/);
  // The shared card fills the chosen host width. Fresh attached cards start
  // intrinsic-sized; the detached host restores a compact natural width.
  assert.match(itemsCss, /\.window-layout-card\s*\{[^}]*width:\s*100%/);
  assert.match(itemsCss, /\.window-layout-card\s*\{[^}]*max-width:\s*min\(100%, var\(--wl-card-max-width/);
  assert.match(itemsCss, /\.window-layout-members\s*\{[^}]*width:\s*var\(--wl-balanced-member-width/);
});

test('024/035: the detached/widget card supports member-icon reorder via the channel, restores its window once, and reports resizes to the workspace', () => {
  // The widget drag sends a bounded `reorder` intent; the workspace writer
  // applies it through the model reorder; the widget restores its window ONCE
  // (persisted shared geometry or content-fit) and reports user resizes.
  assert.match(workspaceSource, /const widgetMemberDrag = createWindowLayoutMemberDrag\(\);/);
  assert.match(workspaceSource, /client\.sendCommand\(\{ kind: 'reorder', memberId: drag\.memberId, toIndex \}\)/);
  assert.match(workspaceSource, /if \(command\.kind === 'reorder'\) \{/);
  assert.match(workspaceSource, /reorderWindowLayoutMember\(state, layoutId, command\.memberId, command\.toIndex\)/);
  assert.match(workspaceSource, /restoreWidgetWindowSize\(\);/);
  assert.match(workspaceSource, /void host\.widgetReportSize\(\s*Math\.round\(Math\.min\(cardSize\.width, WINDOW_LAYOUT_CARD_MAX_WIDTH\)\),\s*Math\.round\(cardSize\.height\),?\s*\)/);
  assert.match(workspaceSource, /client\.sendCardSize\(cardWidth, height\)/);
  assert.match(workspaceSource, /client\.dispose\(\);/);
  // The workspace-only member handlers never run on the widget surface (null
  // durable state would otherwise crash the detached card).
  assert.match(workspaceSource, /elements\.grid\.addEventListener\('pointerdown', \(event\) => \{\s*if \(WIDGET_SURFACE\) return;/);
  assert.match(workspaceSource, /elements\.grid\.addEventListener\('click', \(event\) => \{\s*if \(WIDGET_SURFACE\) return;/);
  assert.match(workspaceSource, /if \(!WIDGET_SURFACE && listButton && listButton !== relatedListButton\)/);
  assert.match(workspaceSource, /scheduleWindowLayoutListDwell\(listButton, openWidgetPicker\)/);
  assert.match(workspaceSource,
    /!event\.target\.closest\('button, input, \[data-wl-member\]'\)\) clearWidgetSelection\(\)/);
});

test('024: the compact card keeps the accepted absence of per-button outlines and native scrollbars', () => {
  const control = itemsCss.match(/^\.window-layout-control\s*\{[^}]*\}/m)?.[0] ?? '';
  assert.match(control, /border:\s*1px solid transparent/);
  assert.match(control, /background:\s*transparent/);
  const members = itemsCss.match(/\.window-layout-members\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(members, /scrollbar-width:\s*none/);
  const controls = itemsCss.match(/\.window-layout-controls\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(controls, /scrollbar-width:\s*none/);
});
