import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createWidgetHoverPolicy } from './public/app/widget-hover-policy.js';
import { planWindowLayoutShiftPeekTransition } from './public/app/window-layout-shift-peek.js';

test('ordinary hovered Quick Run typing with Shift false has no Peek lifecycle; Shift begins and releases it once', () => {
  const member = { id: 'member-1' };
  const policy = createWidgetHoverPolicy({ publish: () => ({ outcome: 'success' }) });
  policy.updateWorkspacePolicy(true, []);
  policy.setHovered(true);
  const quickRunPlan = policy.planInput({
    key: 'q', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    repeat: false, isComposing: false,
  }, { blockedBindings: [] });
  assert.deepEqual(quickRunPlan, { kind: 'open', seed: 'q' });

  let held = false;
  const begins = [];
  let ends = 0;
  const apply = (transition) => {
    if (!transition.handled) return;
    held = transition.held;
    if (transition.begin) begins.push(transition.begin);
    if (transition.end) ends += 1;
  };
  for (const [source, event, context] of [
    ['keydown', { key: 'q', shiftKey: false, repeat: false }, { member }],
    ['hover', { shiftKey: false }, { member }],
    ['pointermove', { shiftKey: false }, { member }],
    ['keyup', { key: 'q', shiftKey: false }, { member }],
  ]) {
    apply(planWindowLayoutShiftPeekTransition(source, event, { held, ...context }));
  }
  assert.deepEqual(begins, []);
  assert.equal(ends, 0);

  apply(planWindowLayoutShiftPeekTransition('keydown', { key: 'Shift', shiftKey: true, repeat: false }, { held, member }));
  apply(planWindowLayoutShiftPeekTransition('keydown', { key: 'Shift', shiftKey: true, repeat: true }, { held, member }));
  apply(planWindowLayoutShiftPeekTransition('keyup', { key: 'Shift' }, { held, member }));
  assert.deepEqual(begins, [member], 'one non-repeat Shift press starts the intended member Peek');
  assert.equal(ends, 1, 'Shift release ends that Peek once');
});

test('blank space between icons keeps the last Peek while Shift is held', () => {
  const kept = planWindowLayoutShiftPeekTransition('memberleave', { leftWidget: false }, { held: true });
  assert.deepEqual(kept, { handled: true, held: true, begin: null, end: false },
    'drifting between icons must not drop the Peek and flash the desktop');
  const left = planWindowLayoutShiftPeekTransition('memberleave', { leftWidget: true }, { held: true });
  assert.equal(left.end, true, 'leaving the widget still ends it');
  const released = planWindowLayoutShiftPeekTransition('memberleave', { leftWidget: false }, { held: false });
  assert.equal(released.end, true, 'without Shift held a member leave ends it as before');
});

test('the workspace routes every Shift Peek event source through the tested planner', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /planWindowLayoutShiftPeekTransition\('keydown'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('keyup'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('blur'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('hover'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('pointermove'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('memberleave'/);
  assert.match(source, /windowLayoutShiftPeekHostQueue/,
    'host begin/end transitions are serialized so an old target cannot finish after a newer one');
  assert.match(source, /catch \{\s*\/\/ Capability lookup may briefly fail/s,
    'transient capability helper failures stay inside the held retry loop');
  assert.match(source, /windowLayoutShiftPeekHeld && elements\.grid\.matches\(':hover'\)\) keepWindowLayoutShiftPeekAlive\(\)/,
    'pointer movement over widget gaps cancels a pending leave end');
  assert.match(source, /if \(windowLayoutShiftPeekKey === null[\s\S]*?return;/,
    'converging release and leave notifications issue at most one host end');
  assert.match(source, /Math\.min\(1000, 180 \+ attempt \* 120\)/,
    'retry cadence remains bounded while Shift is held');
  assert.equal([...source.matchAll(/host\.windowPeekBeginCapability\(/g)].length, 1,
    'only the guarded Peek execution path calls the host begin API');
});
