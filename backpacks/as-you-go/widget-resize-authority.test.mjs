import assert from 'node:assert/strict';
import test from 'node:test';
import { createWidgetResizeAuthority } from './public/app/widget-resize-authority.js';

test('incidental renderer resizes cannot persist without native edge-resize authority', () => {
  let t = 1000;
  const gate = createWidgetResizeAuthority({ now: () => t, leaseMs: 500 });
  assert.equal(gate.mayPersistResize(), false);
  t += 100;
  assert.equal(gate.mayPersistResize(), false);
});

test('native edge resize grants a short persistence lease and refreshes while dragging the edge', () => {
  let t = 1000;
  const gate = createWidgetResizeAuthority({ now: () => t, leaseMs: 500 });
  gate.noteNativeResize();
  assert.equal(gate.mayPersistResize(), true);
  t = 1400;
  gate.noteNativeResize();
  t = 1800;
  assert.equal(gate.mayPersistResize(), true);
  t = 1901;
  assert.equal(gate.mayPersistResize(), false);
});

test('clear immediately revokes resize persistence authority', () => {
  let t = 1000;
  const gate = createWidgetResizeAuthority({ now: () => t });
  gate.noteNativeResize();
  assert.equal(gate.mayPersistResize(), true);
  gate.clear();
  assert.equal(gate.mayPersistResize(), false);
});
