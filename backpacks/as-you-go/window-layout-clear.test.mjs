import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createClickTwiceGuard } from './public/app/click-twice-guard.js';
import { handleWidgetClearActivation, handleWidgetDeleteActivation } from './public/app/widget-clear-activation.js';
import { windowLayoutControlButton, WINDOW_LAYOUT_CONTROL_GLYPHS } from './public/app/window-layout-control-icons.js';

test('widget clear requires two activations and disarms on pointer leave or window blur', () => {
  const guard = createClickTwiceGuard();
  assert.deepEqual(guard.activate(), { confirmed: false, armed: true });
  assert.equal(guard.isArmed(), true);
  guard.reset();
  assert.deepEqual(guard.activate(), { confirmed: false, armed: true });
  assert.deepEqual(guard.activate(), { confirmed: true, armed: false });
  assert.equal(guard.isArmed(), false);
});

test('clear affordance is a hovered backspace and first activation receives the red glow', async () => {
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.clear.path, /M9 5H20v14H9L3\.5 12 9 5z/);
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.clear.path, /m12 9 5 6m0-6-5 6/);
  const button = windowLayoutControlButton('clear', 'Click twice to clear all windows from this layout', 'data-wl-clear', 'L1');
  assert.match(button, /data-wl-clear="L1"/);
  assert.match(button, /aria-label="Click twice to clear all windows from this layout"/);
  const css = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');
  const rule = css.match(/\.window-layout-control\.wl-clear\.is-clear-armed\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /color:\s*#ff5555/);
  assert.match(rule, /filter:\s*drop-shadow\(0 0 5px #ff5555\)/);
  assert.match(css, /\.window-layout-control\.wl-clear:hover[\s\S]*?opacity:\s*1/);
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /handleWidgetClearActivation\(event, clearButton, widgetClearGuard,[\s\S]*?sendCommand\(\{ kind: 'clear-layout' \}\)/);
  assert.match(source, /pointerout[\s\S]*?resetWidgetClearArm\(\)/);
  assert.match(source, /window\.addEventListener\('blur', resetWidgetClearArm\)/);
});

test('typing after the first pointer click cannot synthesize the second destructive activation', async () => {
  const guard = createClickTwiceGuard();
  const commands = [];
  const classes = new Set();
  const button = {
    focused: false,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    focus() { this.focused = true; },
    blur() { this.focused = false; },
  };
  const click = (detail) => handleWidgetClearActivation(
    { detail, preventDefault() {} }, button, guard, () => commands.push('clear-layout'),
  );

  button.focus();
  assert.equal(click(1), 'armed');
  assert.equal(button.focused, false, 'arming returns focus to the widget surface');
  assert.equal(classes.has('is-clear-armed'), true);

  // Ordinary characters and editing keys route through the widget key path;
  // Enter/Space are the only native button activators, and their synthetic
  // click (detail 0) is rejected even if focus is restored externally.
  for (const key of ['a', 'b', 'Backspace', 'Delete', 'Enter', ' ', 'c', 'Enter', ' ']) {
    if (key === 'Enter' || key === ' ') assert.equal(click(0), 'ignored-keyboard');
    assert.equal(commands.length, 0, `key ${JSON.stringify(key)} must not clear the layout`);
    assert.equal(guard.isArmed(), true);
  }

  assert.equal(click(1), 'cleared');
  assert.deepEqual(commands, ['clear-layout']);
  assert.equal(guard.isArmed(), false);
});

test('layout delete turns red on the first pointer click, deletes only on the second, and disarms when left alone', async () => {
  const guard = createClickTwiceGuard();
  const commands = [];
  const classes = new Set();
  const button = {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    blur() {},
  };
  const click = (detail = 1) => handleWidgetDeleteActivation(
    { detail, preventDefault() {} }, button, guard, () => commands.push('delete-layout'),
  );

  assert.equal(click(), 'armed');
  assert.equal(classes.has('is-delete-armed'), true);
  assert.deepEqual(commands, []);

  guard.reset();
  classes.delete('is-delete-armed');
  assert.equal(click(), 'armed', 'leaving the button makes the next click a fresh first click');
  assert.deepEqual(commands, []);
  assert.equal(click(), 'deleted');
  assert.deepEqual(commands, ['delete-layout']);
  assert.equal(classes.has('is-delete-armed'), false);
  assert.equal(guard.isArmed(), false);

  const css = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');
  const deleteRule = css.match(/\.window-layout-delete\.is-delete-armed\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(deleteRule, /opacity:\s*1/);
  assert.match(deleteRule, /color:\s*#ff5555/);
  assert.match(deleteRule, /background:\s*rgba\(255, 85, 85, 0\.14\)/);

  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /Click twice to delete this layout/);
  assert.match(source, /handleWidgetDeleteActivation\(event, deleteButton, widgetDeleteGuard,[\s\S]*?sendCommand\(\{ kind: 'delete-layout' \}\)/);
  assert.match(source, /pointerout[\s\S]*?resetWidgetDeleteArm\(\)/);
  assert.match(source, /window\.addEventListener\('blur', resetWidgetDeleteArm\)/);
  assert.match(source, /resetWidgetClearArm\(\);\s*resetWidgetDeleteArm\(\);/,
    'a card rerender cannot preserve an invisible armed delete');
});

test('warning copy is hidden from window-layout cards', async () => {
  const css = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');
  assert.match(css, /\.window-layout-status\s*\{\s*display:\s*none;\s*\}/);
});
