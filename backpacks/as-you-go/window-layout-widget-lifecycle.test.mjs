import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWindowLayoutWidgetLifecycle,
  windowLayoutWidgetOpenSucceeded,
} from './public/app/window-layout-widget-lifecycle.js';

test('widget open success accepts reused host widgets and rejects typed failures', () => {
  assert.equal(windowLayoutWidgetOpenSucceeded({ ok: true, widget: { ok: true, reused: true } }), true);
  assert.equal(windowLayoutWidgetOpenSucceeded({ outcome: 'failed' }), false);
  assert.equal(windowLayoutWidgetOpenSucceeded({ ok: false }), false);
  assert.equal(windowLayoutWidgetOpenSucceeded(null), false);
});

test('open retries presentation failures without any document-authority dependency', async () => {
  const calls = [];
  const lifecycle = createWindowLayoutWidgetLifecycle({
    widgetOpen: async (layoutId, options) => {
      calls.push([layoutId, options]);
      return calls.length < 3 ? { outcome: 'failed' } : { ok: true, widget: { ok: true } };
    },
    getLayouts: () => [],
    getDockedLayoutIds: () => [],
    isLayoutVisible: () => true,
    sleep: async () => {},
  });

  const result = await lifecycle.open('L1');
  assert.equal(windowLayoutWidgetOpenSucceeded(result), true);
  assert.equal(calls.length, 3);
});

test('startup presentation opens visible non-docked layouts without activating them', async () => {
  const opens = [];
  const lifecycle = createWindowLayoutWidgetLifecycle({
    widgetOpen: async (layoutId, options) => {
      opens.push([layoutId, options]);
      return { ok: true, widget: { ok: true } };
    },
    getLayouts: () => [
      { id: 'visible' },
      { id: 'docked' },
      { id: 'binned', binned: true },
      { id: 'hidden' },
    ],
    getDockedLayoutIds: () => ['docked'],
    isLayoutVisible: (layout) => layout.id !== 'hidden',
    sleep: async () => {},
  });

  await lifecycle.ensureStartup();
  assert.deepEqual(opens, [['visible', { activate: false }]]);
});

test('presentation suppression prevents host opens without consulting durable writer state', async () => {
  let opened = false;
  const lifecycle = createWindowLayoutWidgetLifecycle({
    widgetOpen: async () => {
      opened = true;
      return { ok: true };
    },
    getLayouts: () => [{ id: 'L1' }],
    getDockedLayoutIds: () => [],
    isLayoutVisible: () => true,
    presentationSuppressed: () => true,
  });

  assert.deepEqual(await lifecycle.ensureStartup(), []);
  assert.equal(opened, false);
});
