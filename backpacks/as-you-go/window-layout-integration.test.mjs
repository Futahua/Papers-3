// 017I2 integration test (RoketPuncha lane): exercises the REAL wiring
// boundary - createWindowLayoutRecordingWiring (the exact wiring the
// workspace entry runs) against the REAL model functions and a fake
// host/store. Proves persisted bootstrap, L1->L2->L1 independent geometry for
// a shared member, byte-stable inactive arrangements, all active members
// observed, partial/zero success, echo-then-real-move, bin/delete stop and
// teardown without a late save.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutRecordingWiring } from './public/app/window-layout-runtime.js';
import { setActiveWindowLayoutId, updateWindowLayoutMember } from './public/workspace-model-20260730b.js';

const fingerprint = (title) => title.repeat(64).slice(0, 64);
const member = (id, title, bounds, state = 'normal') => ({
  id,
  descriptor: { version: 1, title, executableFingerprint: fingerprint(title) },
  bounds,
  state,
});
const layout = (id, members) => ({
  id,
  parentId: 'root',
  order: 0,
  name: id,
  arrangement: { version: 2, members },
});

const BOUNDS_L1_X = { x: 1, y: 2, width: 300, height: 200 };
const BOUNDS_L2_X = { x: 9, y: 8, width: 400, height: 250 };
const BOUNDS_L2_Y = { x: 20, y: 30, width: 500, height: 300 };

function makeState(active = null) {
  return {
    schemaVersion: 1,
    activeWindowLayoutId: active,
    groups: [],
    shortcuts: [],
    windowLayouts: [
      layout('L1', [member('x1', 'X', BOUNDS_L1_X)]),
      layout('L2', [
        member('x2', 'X', BOUNDS_L2_X, 'minimized'),
        member('y2', 'Y', BOUNDS_L2_Y),
      ]),
    ],
  };
}

function wiring(overrides = {}) {
  let current = overrides.state ?? makeState();
  const saves = [];
  const statuses = [];
  const patches = [];
  const stateChanges = [];
  const intervals = new Map();
  let nextTimer = 1;
  const host = {
    resolveWindowDescriptor: async (descriptor) => ({
      outcome: 'success',
      capability: { version: 1, bindingId: `binding-${descriptor.title}` },
    }),
    observeWindowCapability: async (capability) => ({
      outcome: 'success',
      observation: { bounds: BOUNDS_L1_X, state: 'normal' },
    }),
    applyWindowCapability: async (capability, bounds) => ({ outcome: 'success' }),
    minimizeWindowCapability: async () => ({ outcome: 'success' }),
    restoreWindowCapability: async () => ({ outcome: 'success' }),
  };
  Object.assign(host, overrides.host ?? {});
  const recording = createWindowLayoutRecordingWiring({
    getLayout: (id) => current.windowLayouts.find((candidate) => candidate.id === id) ?? null,
    host,
    model: { setActiveWindowLayoutId, updateWindowLayoutMember },
    getState: () => current,
    replaceState: (next) => { current = next; },
    scheduleSave: () => saves.push('save'),
    setStatus: (layoutId, text) => statuses.push([layoutId, text]),
    patchMember: (layoutId, memberId, stateValue) => patches.push([layoutId, memberId, stateValue]),
    onObservationStateChange: (layoutId, memberId, stateValue) => stateChanges.push([layoutId, memberId, stateValue]),
    setIntervalFn: (callback) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearIntervalFn: (id) => intervals.delete(id),
    cadenceMs: 10,
  });
  const applyCalls = [];
  const stateCalls = [];
  const originalApply = host.applyWindowCapability.bind(host);
  host.applyWindowCapability = async (capability, bounds) => {
    applyCalls.push([capability.bindingId, bounds]);
    return originalApply(capability, bounds);
  };
  const originalRestore = host.restoreWindowCapability.bind(host);
  host.restoreWindowCapability = async (capability) => {
    stateCalls.push(['restore', capability.bindingId]);
    return originalRestore(capability);
  };
  const originalMinimize = host.minimizeWindowCapability.bind(host);
  host.minimizeWindowCapability = async (capability) => {
    stateCalls.push(['minimize', capability.bindingId]);
    return originalMinimize(capability);
  };
  return {
    recording,
    getState: () => current,
    setState: (next) => { current = next; },
    saves,
    statuses,
    patches,
    stateChanges,
    intervals,
    applyCalls,
    stateCalls,
    host,
  };
}

test('resuming after a restart attaches observation and touches no window', async () => {
  // The measured bug: launching Papers replayed the persisted layout - applying
  // every saved rectangle and restoring each window in turn for about eight
  // seconds - which raised the creator's windows over whatever they were doing.
  const h = wiring({ state: makeState('L1') });
  const result = await h.recording.resumeRecording('L1');
  assert.equal(h.recording.runtime.getSnapshot().activeLayoutId, 'L1');
  assert.equal(h.recording.runtime.getSnapshot().timerActive, true);
  assert.equal(result.layoutId, 'L1');
  assert.deepEqual(h.applyCalls, [], 'resuming must not place any window');
  assert.deepEqual(h.stateCalls, [], 'resuming must not minimize or restore any window');
  assert.deepEqual(h.saves, [], 'resuming must not rewrite the document');
});

test('017I2 bootstrap reconciles the persisted active id without inventing one', async () => {
  // Persisted active id -> the whole layout is switched and observed.
  const active = wiring({ state: makeState('L1') });
  const result = await active.recording.ensureRecording('L1');
  assert.equal(result.outcome, 'success');
  assert.equal(active.getState().activeWindowLayoutId, 'L1');
  assert.equal(active.recording.runtime.getSnapshot().activeLayoutId, 'L1');
  assert.equal(active.recording.runtime.getSnapshot().timerActive, true);
  assert.deepEqual(active.applyCalls, [[`binding-X`, BOUNDS_L1_X]]);
  // No persisted id -> nothing invented, no timer, no save from the switch.
  const none = wiring();
  const empty = await none.recording.ensureRecording(null);
  assert.equal(empty.outcome, 'inactive');
  assert.equal(none.recording.runtime.getSnapshot().timerActive, false);
  assert.equal(none.getState().activeWindowLayoutId, null);
});

test('017I2 L1->L2->L1 applies each layout in member order and keeps inactive bytes exact', async () => {
  const h = wiring();
  const inactiveBefore = JSON.stringify(h.getState().windowLayouts[0]);
  await h.recording.ensureRecording('L1');
  await h.recording.ensureRecording('L2');
  assert.equal(h.getState().activeWindowLayoutId, 'L2');
  await h.recording.ensureRecording('L1');
  assert.equal(h.getState().activeWindowLayoutId, 'L1');
  // Shared member X/Y: each layout applies its OWN saved geometry.
  assert.deepEqual(h.applyCalls, [
    [`binding-X`, BOUNDS_L1_X],
    [`binding-X`, BOUNDS_L2_X],
    [`binding-Y`, BOUNDS_L2_Y],
    [`binding-X`, BOUNDS_L1_X],
  ]);
  // Switching never mutates the inactive layout's arrangement bytes.
  assert.equal(JSON.stringify(h.getState().windowLayouts[1]), JSON.stringify(layout('L2', [
    member('x2', 'X', BOUNDS_L2_X, 'minimized'),
    member('y2', 'Y', BOUNDS_L2_Y),
  ])));
  assert.equal(JSON.stringify(h.getState().windowLayouts[0]), inactiveBefore);
  assert.equal(h.intervals.size, 1);
});

test('017I2 the same active layout only re-syncs members, never re-applies', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L1');
  const appliesAfterFirst = h.applyCalls.length;
  const reconciled = await h.recording.ensureRecording('L1');
  assert.equal(reconciled.outcome, 'success');
  assert.equal(h.applyCalls.length, appliesAfterFirst, 'no re-apply on the already-active layout');
  assert.equal(h.intervals.size, 1);
});

test('017I2 every active member is observed and a minimized observation keeps restore bounds', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L2');
  const observed = [];
  h.host.observeWindowCapability = async (capability) => {
    observed.push(capability.bindingId);
    return { outcome: 'success', observation: { bounds: null, state: 'minimized' } };
  };
  await h.recording.runtime.observeActiveMembers();
  assert.deepEqual([...new Set(observed)].sort(), ['binding-X', 'binding-Y']);
  const x2 = h.getState().windowLayouts[1].arrangement.members.find((m) => m.id === 'x2');
  assert.equal(x2.state, 'minimized');
  assert.deepEqual(x2.bounds, BOUNDS_L2_X, 'minimized observation preserves the saved restore bounds');
});

test('017I2 state transitions notify the detached widget, but bounds-only observations do not', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L1');
  h.host.observeWindowCapability = async () => ({
    outcome: 'success',
    observation: { bounds: { x: 8, y: 9, width: 320, height: 220 }, state: 'minimized' },
  });
  await h.recording.runtime.observeActiveMembers();
  assert.deepEqual(h.stateChanges, [['L1', 'x1', 'minimized']]);
  assert.deepEqual(h.patches.at(-1), ['L1', 'x1', 'minimized']);

  h.host.observeWindowCapability = async () => ({
    outcome: 'success',
    observation: { bounds: { x: 10, y: 11, width: 330, height: 230 }, state: 'minimized' },
  });
  await h.recording.runtime.observeActiveMembers();
  assert.deepEqual(h.stateChanges, [['L1', 'x1', 'minimized']], 'moving a minimized window does not rebroadcast its unchanged state');
});

test('017I2 partial and zero success retain the id; zero runs no timer', async () => {
  const partial = wiring({
    host: { resolveWindowDescriptor: async (descriptor) =>
      descriptor.title === 'Y'
        ? { outcome: 'missing', error: 'not visible' }
        : { outcome: 'success', capability: { version: 1, bindingId: `binding-${descriptor.title}` } } },
  });
  const result = await partial.recording.ensureRecording('L2');
  assert.equal(result.outcome, 'partial');
  assert.deepEqual(partial.recording.runtime.getSnapshot().recordingMemberIds, ['x2']);
  assert.equal(partial.recording.runtime.getSnapshot().timerActive, true);
  assert.ok(partial.statuses.some(([layoutId]) => layoutId === 'L2'), 'typed partial outcome updates status');

  const zero = wiring({ host: { resolveWindowDescriptor: async () => ({ outcome: 'missing', error: 'gone' }) } });
  const zeroResult = await zero.recording.ensureRecording('L2');
  assert.equal(zeroResult.outcome, 'partial');
  assert.equal(zero.recording.runtime.getSnapshot().activeLayoutId, 'L2');
  assert.equal(zero.recording.runtime.getSnapshot().timerActive, false);
});

test('017I2 application echo is swallowed once, then the next genuine move records into the model', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L1');
  // First observation matches the applied echo -> suppressed, model untouched.
  h.host.observeWindowCapability = async () => ({
    outcome: 'success',
    observation: { bounds: BOUNDS_L1_X, state: 'normal' },
  });
  await h.recording.runtime.observeActiveMembers();
  assert.deepEqual(h.getState().windowLayouts[0].arrangement.members[0].bounds, BOUNDS_L1_X);
  // The next genuine move (new bounds) is recorded through the real model.
  const moved = { x: 100, y: 120, width: 320, height: 220 };
  h.host.observeWindowCapability = async () => ({
    outcome: 'success',
    observation: { bounds: moved, state: 'normal' },
  });
  await h.recording.runtime.observeActiveMembers();
  const recorded = h.getState().windowLayouts[0].arrangement.members.find((m) => m.id === 'x1');
  assert.deepEqual(recorded.bounds, moved);
  assert.equal(recorded.state, 'normal');
  assert.ok(h.saves.length > 0, 'a recorded observation queues a prompt save');
});

test('017I2 binning the active layout stops the timer on the next observe tick', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L2');
  assert.equal(h.recording.runtime.getSnapshot().timerActive, true);
  // The model cleared the persisted id and binned the layout (binSelection).
  const next = { ...h.getState(), activeWindowLayoutId: null };
  next.windowLayouts = next.windowLayouts.map((candidate) => candidate.id === 'L2'
    ? { ...candidate, bin: { parentId: candidate.parentId, order: candidate.order, binnedAt: 1 } }
    : candidate);
  h.setState(next);
  await h.recording.runtime.observeActiveMembers();
  assert.equal(h.recording.runtime.getSnapshot().timerActive, false);
  assert.equal(h.recording.runtime.getSnapshot().activeLayoutId, null);
  assert.equal(h.intervals.size, 0, 'no timer survives the bin');
});

test('017I2 teardown stops without a late save or duplicated helper work', async () => {
  const h = wiring();
  await h.recording.ensureRecording('L2');
  const savesBefore = h.saves.length;
  const resolvesBefore = h.applyCalls.length;
  await h.recording.runtime.stop({ clearActive: false });
  assert.equal(h.saves.length, savesBefore, 'teardown schedules no save');
  assert.equal(h.applyCalls.length, resolvesBefore, 'teardown performs no window work');
  assert.equal(h.recording.runtime.getSnapshot().timerActive, false);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.getState().activeWindowLayoutId, 'L2', 'persisted active id is retained for the next open');
  // A subsequent observe tick is inert (generation advanced).
  await h.recording.runtime.observeActiveMembers();
  assert.equal(h.saves.length, savesBefore);
});
