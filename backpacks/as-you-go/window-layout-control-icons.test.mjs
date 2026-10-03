// 019F (RoketPuncha AYG lane): static tests for the compact control
// mapping and the taskbar-like member button markup. Pure string assertions on
// the shared builders - no DOM, no host, no globals.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOW_LAYOUT_CONTROL_GLYPHS,
  WINDOW_LAYOUT_CONTROL_ORDER,
  windowLayoutControlGlyphMarkup,
  windowLayoutControlButton,
  windowLayoutMemberState,
  windowLayoutMemberMarkup,
} from './public/app/window-layout-control-icons.js';
import { createWindowLayoutIsolateMode } from './public/app/window-layout-isolate-mode.js';

test('the three persistent control actions map to unique requested glyph shapes', () => {
  assert.deepEqual(WINDOW_LAYOUT_CONTROL_ORDER, ['list', 'min-all', 'restore-all']);
  assert.equal(WINDOW_LAYOUT_CONTROL_ORDER.length, new Set(WINDOW_LAYOUT_CONTROL_ORDER).size);
  const shapes = WINDOW_LAYOUT_CONTROL_ORDER.map((name) => WINDOW_LAYOUT_CONTROL_GLYPHS[name]);
  assert.ok(shapes.every((glyph) => glyph && typeof glyph.path === 'string' && glyph.path.length > 0), 'every control has a glyph');
  assert.equal(new Set(shapes.map((glyph) => glyph.path)).size, 3, 'all three shapes are unique');
});

test('each control maps to the exact requested shape', () => {
  // 1 cursor/pointer outline = Pick onscreen
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.pick.path, /^<path d="M6\.5 3\.5l/);
  // 2 outlined document/list with rows = List
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.list.path, /<rect x="6" y="3" width="12" height="18"/);
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.list.path, /stroke-linecap="round"/);
  // 3 horizontal minus = Minimize all
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS['min-all'].path, /^<path d="M4 12h16"/);
  // 4 outlined square = Restore all
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS['restore-all'].path, /<rect x="5" y="5" width="14" height="14"/);
  // 5 unlocked padlock = Detach
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.detach.path, /<rect x="6" y="10\.5" width="12" height="10"/);
});

test('clear affordance has a Backspace-shaped glyph and exact double-clear label', () => {
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.clear.path, /M9 5H20v14H9L3\.5 12 9 5z/);
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.clear.path, /m12 9 5 6m0-6-5 6/);
  const button = windowLayoutControlButton('clear', 'Click twice to clear all windows from this layout', 'data-wl-clear', 'layout-1');
  assert.match(button, /data-wl-clear="layout-1"/);
  assert.match(button, /aria-label="Click twice to clear all windows from this layout"/);
});

test('detach is an UNLOCKED padlock and reattach a LOCKED padlock', () => {
  const detach = WINDOW_LAYOUT_CONTROL_GLYPHS.detach.path;
  const reattach = WINDOW_LAYOUT_CONTROL_GLYPHS.reattach.path;
  assert.match(detach, /<rect x="6" y="10\.5" width="12" height="10"/, 'detach has the padlock body');
  assert.match(reattach, /<rect x="6" y="10\.5" width="12" height="10"/, 'reattach has the padlock body');
  // Unlocked: the shackle's right leg stops OPEN above the body.
  assert.doesNotMatch(detach, /v3/, 'detach shackle is open (unlocked)');
  // Locked: the shackle's right leg latches DOWN into the body.
  assert.match(reattach, /v3/, 'reattach shackle is latched (locked)');
  assert.notEqual(detach, reattach);
});

test('no old square or split-panel glyphs remain', () => {
  const oldMarkers = [
    'M4 4h16v16H4z', // old pick frame
    'M9 9v6h6v-6z', // old pick inner square
    'M5 5h14v14H5z', // old detach square
    'M7 7h10v10H7z', // old reattach square
    'M12 12l5-5', // old reattach split diagonal
    'M4 4l7 8-7 8z', // old isolate V
    'M12 4h8v16h-8z', // old isolate split panel
    'M5 5h14v3H5z', // old min-all bar
    'M9 12h6', // old detach split line
  ];
  const all = Object.values(WINDOW_LAYOUT_CONTROL_GLYPHS).map((glyph) => glyph.path).join('|');
  for (const marker of oldMarkers) {
    assert.ok(!all.includes(marker), `old square/split-panel marker must not remain: ${marker}`);
  }
});

test('control buttons keep exact title/aria-label semantics and data attributes', () => {
  const button = windowLayoutControlButton('min-all', 'Minimize all members', 'data-wl-min-all', 'L1');
  assert.ok(button.includes('title="Minimize all members"'), 'native title preserved');
  assert.ok(button.includes('aria-label="Minimize all members"'), 'aria-label preserved');
  assert.ok(button.includes('data-wl-min-all="L1"'), 'behavior data attribute preserved');
  assert.ok(button.includes('class="window-layout-control wl-min-all"'), 'behavior class preserved');
  assert.ok(button.includes('data-wl-glyph="min-all"'), 'stable semantic glyph identifier present');
  assert.ok(button.includes('type="button"'), 'button type preserved');
});

test('tracking toggle exposes an outlined off state and pressed active state', () => {
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.tracking.path, /fill="none"/);
  const off = windowLayoutControlButton('tracking', 'Start automatic window tracking', 'data-wl-track', 'L1', { toggle: true, active: false, activeClass: 'tracking-enabled' });
  assert.match(off, /class="window-layout-control wl-tracking"/);
  assert.match(off, /aria-pressed="false"/);
  const on = windowLayoutControlButton('tracking', 'Stop automatic window tracking', 'data-wl-track', 'L1', { toggle: true, active: true, activeClass: 'tracking-enabled' });
  assert.match(on, /class="window-layout-control wl-tracking tracking-enabled"/);
  assert.match(on, /aria-pressed="true"/);
});

test('the list opener uses the cursor glyph while retaining list behavior', () => {
  const button = windowLayoutControlButton('list', 'Choose windows', 'data-wl-list', 'L1', { glyph: 'pick' });
  assert.match(button, /class="window-layout-control wl-list"/);
  assert.match(button, /data-wl-list="L1"/);
  assert.match(button, /data-wl-glyph="pick"/);
});

test('the three persistent control buttons render in the exact left-to-right order with distinct identifiers', () => {
  const labels = {
    list: 'Choose from the list of onscreen windows',
    'min-all': 'Minimize all members',
    'restore-all': 'Restore/open all members',
  };
  const html = WINDOW_LAYOUT_CONTROL_ORDER.map((name) => windowLayoutControlButton(name, labels[name], `data-wl-${name}`, 'L1')).join('');
  const order = WINDOW_LAYOUT_CONTROL_ORDER;
  for (let index = 0; index < order.length; index += 1) {
    const name = order[index];
    assert.ok(html.includes(`data-wl-glyph="${name}"`), `${name} glyph identifier present`);
    assert.ok(html.includes(`aria-label="${labels[name]}"`), `${name} label correct`);
    if (index > 0) {
      const prev = order[index - 1];
      assert.ok(
        html.indexOf(`data-wl-glyph="${name}"`) > html.indexOf(`data-wl-glyph="${prev}"`),
        `${name} follows ${prev} left-to-right`,
      );
    }
  }
});

test('isolate mode semantics replace on plain member click and add on Ctrl+right-click intent', () => {
  const mode = createWindowLayoutIsolateMode();
  assert.equal(mode.isActive('L1'), false);
  assert.equal(mode.click('L1', 'm1'), null, 'ordinary clicks pass through while mode is off');
  assert.equal(mode.toggle('L1'), true);
  assert.deepEqual(mode.click('L1', 'm1'), ['m1']);
  assert.deepEqual(mode.click('L1', 'm2', true), ['m1', 'm2']);
  assert.deepEqual(mode.click('L1', 'm3'), ['m3'], 'next plain click replaces the isolated set');
  assert.equal(mode.toggle('L1'), false);
  assert.equal(mode.click('L1', 'm1'), null);
});

test('minimize button exposes blue-mode state without a separate isolate control', () => {
  const active = windowLayoutControlButton('min-all', 'Minimize; right-click for isolate mode', 'data-wl-min-all', 'L1', { toggle: true, active: true });
  assert.match(active, /isolate-mode-active/);
  assert.match(active, /aria-pressed="true"/);
  assert.equal(WINDOW_LAYOUT_CONTROL_GLYPHS.isolate, undefined);
});

test('member markup: bottom indicator, accessible name, centered icon, no duplicate tooltip', () => {
  const member = { id: 'm1', descriptor: { title: 'Notepad' }, state: 'normal' };
  const html = windowLayoutMemberMarkup('L1', member, 'data:icon');
  assert.ok(!html.includes(' title='), 'native tooltip is omitted because the preview already displays the name');
  assert.ok(html.includes('aria-label="Notepad"'), 'aria-label carries the full name');
  assert.ok(html.includes('aria-pressed="false"'), 'normal state is not pressed');
  assert.ok(html.includes('aria-selected="false"'), 'not selected by default');
  assert.ok(html.includes('data-wl-live-state="normal"'), 'stable indicator identifier reflects the known state');
  assert.ok(html.includes('<img class="window-layout-member-icon" src="data:icon"'), 'native artwork is an unfiltered img');
  assert.ok(html.includes('<span class="window-layout-member-state normal"'), 'the running indicator span is present');
  assert.ok(!/<span[^>]*class="[^"]*window-layout-member-label/.test(html), 'no text label inside the strip');
  assert.ok(html.includes('</button>'), 'one compact hit target');

  const minimized = windowLayoutMemberMarkup('L1', { ...member, state: 'minimized' }, null);
  assert.ok(minimized.includes('aria-pressed="true"'), 'minimized state is pressed');
  assert.ok(!minimized.includes('data-wl-member-state="minimized"'), 'minimized members omit the running indicator');
  assert.ok(minimized.includes('class="window-layout-member-icon placeholder"'), 'placeholder when no icon');
  assert.ok(minimized.includes('class="window-layout-member-state minimized"'), 'the bar exists but is hidden by its own state class');
});

test('member state is independent and fails closed for unknown values', () => {
  assert.equal(windowLayoutMemberState({ state: 'normal' }), 'normal');
  assert.equal(windowLayoutMemberState({ state: 'minimized' }), 'minimized');
  assert.equal(windowLayoutMemberState({ state: 'missing' }), 'minimized');
  assert.equal(windowLayoutMemberState({}), 'minimized');

  const normal = windowLayoutMemberMarkup('L1', { id: 'normal', descriptor: { title: 'Open' }, state: 'normal' });
  const minimized = windowLayoutMemberMarkup('L1', { id: 'min', descriptor: { title: 'Minimized' }, state: 'minimized' });
  assert.equal((normal.match(/window-layout-member-state/g) ?? []).length, 1, 'normal gets one marker');
  assert.equal((minimized.match(/window-layout-member-state/g) ?? []).length, 1, 'minimized keeps exactly one marker, painted unknown/minimized rather than removed');
});

test('member markup handles missing descriptors without throwing', () => {
  const html = windowLayoutMemberMarkup('L1', { id: 'm9', title: 'Fallback' });
  assert.ok(html.includes('aria-label="Fallback"'), 'falls back to the member title');
});

test('035: a placeholder member is the same compact button, marked inert (disabled)', () => {
  const member = { id: 'm1', descriptor: { title: 'Notepad' }, state: 'normal' };
  const html = windowLayoutMemberMarkup('L1', member, 'data:icon', true);
  assert.ok(html.includes(' disabled>'), 'the placeholder member is disabled/inert');
  assert.ok(html.includes('class="window-layout-member normal"'), 'same taskbar-like look');
  assert.ok(html.includes('data-wl-member="m1"'), 'same stable identity for parity');
  const live = windowLayoutMemberMarkup('L1', member, 'data:icon');
  assert.ok(!live.includes(' disabled'), 'a live member is never disabled');
});

test('member warning notes stay out of accessible and hover names while title and state remain', () => {
  const html = windowLayoutMemberMarkup('L1', {
    id: 'm1', descriptor: { title: 'Notepad' }, state: 'normal',
  }, null, false, 'This window could not be confirmed');
  assert.match(html, /aria-label="Notepad"/, 'the custom hover popover and screen reader keep the title');
  assert.match(html, /class="window-layout-member normal"/, 'the running state remains identified');
  assert.doesNotMatch(html, /could not be confirmed|data-wl-member-note|wl-member-unconfirmed/,
    'the warning is not rendered or exposed through hover metadata');
});
