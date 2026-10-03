import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createWindowLayoutAutoTracking } from './public/app/window-layout-auto-tracking.js';
import {
  createWindowLayout,
  setWindowLayoutInstanceSuppressed,
  setWindowLayoutTracking,
} from './public/workspace-model-20260730b.js';

const INSTANCE = 'W0123456789abcdef';

test('workspace imports only the current automatic tracking API', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ createWindowLayoutAutoTracking \} from '\.\/app\/window-layout-auto-tracking\.js';/);
  assert.doesNotMatch(source, /createWindowLayoutAutoTracker|windowLayoutTrackingTransitions|syncTrackingAfterDocumentInstall/);
});
const descriptor = {
  version: 1,
  title: 'Notepad',
  executableFingerprint: 'a'.repeat(64),
  windowInstanceId: INSTANCE,
};

function stateWithAuto() {
  const layoutState = createWindowLayout({ groups: [], shortcuts: [], windowLayouts: [] }, { name: 'Auto' });
  const layout = layoutState.windowLayouts[0];
  return { ...setWindowLayoutTracking(layoutState, layout.id, true), layoutId: layout.id };
}

test('Auto lifecycle add resolves and observes a new exact window, then commits before publishing it', async () => {
  let state = stateWithAuto();
  const order = [];
  const diagnostics = [];
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async (id) => {
      order.push(`resolve:${id}`);
      return { outcome: 'success', capability: { runtimeToken: 'ephemeral' }, descriptor };
    },
    observeWindowCapability: async (capability) => {
      order.push(`observe:${capability.runtimeToken}`);
      return { outcome: 'success', observation: { bounds: { x: 4, y: 8, width: 640, height: 480 }, state: 'normal' } };
    },
    commit: async (next) => {
      order.push('commit');
      state = next;
      return true;
    },
    createMemberId: () => 'member-1',
    onCommitted: async ({ layoutId, capability }) => order.push(`publish:${layoutId}:${capability.runtimeToken}`),
    onDiagnostic: (value) => diagnostics.push(value),
  });

  const result = await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE });
  assert.equal(result.outcome, 'added');
  const member = state.windowLayouts[0].arrangement.members[0];
  assert.equal(member.id, 'member-1');
  assert.deepEqual(member.descriptor, descriptor);
  assert.deepEqual(member.bounds, { x: 4, y: 8, width: 640, height: 480 });
  assert.equal(member.state, 'normal');
  assert.deepEqual(order, [`resolve:${INSTANCE}`, 'observe:ephemeral', 'commit', `publish:${state.layoutId}:ephemeral`]);
  assert.deepEqual(diagnostics, [
    { stage: 'auto-add-resolve', outcome: 'success' },
    { stage: 'auto-add-observe', outcome: 'success' },
    { stage: 'auto-add-commit', outcome: 'success' },
  ]);
  assert.equal(JSON.stringify(state).includes('runtimeToken'), false, 'ephemeral host capability is never persisted');
});

test('Auto binds a capability after the capability-free lifecycle probe, then adds the exact new window', async () => {
  let state = stateWithAuto();
  const order = [];
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async (id) => {
      order.push(`probe:${id}`);
      return { outcome: 'success', descriptor };
    },
    resolveWindowDescriptor: async (value) => {
      order.push(`bind:${value.windowInstanceId}`);
      return { outcome: 'success', capability: { runtimeToken: 'fresh-binding' }, descriptor: value };
    },
    observeWindowCapability: async (capability) => {
      order.push(`observe:${capability.runtimeToken}`);
      return { outcome: 'success', observation: { windowInstanceId: INSTANCE, bounds: { x: 1, y: 2, width: 300, height: 200 } } };
    },
    commit: async (next) => { order.push('commit'); state = next; return true; },
    createMemberId: () => 'new-member',
  });

  const result = await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE });
  assert.equal(result.outcome, 'added');
  assert.deepEqual(order, [
    `probe:${INSTANCE}`, `bind:${INSTANCE}`, 'observe:fresh-binding', 'commit',
  ]);
  assert.equal(state.windowLayouts[0].arrangement.members[0].descriptor.windowInstanceId, INSTANCE);
});

test('Auto binds directly from the descriptor carried by a lifecycle open without a second existence probe', async () => {
  let state = stateWithAuto();
  let probeCalls = 0;
  const order = [];
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => {
      probeCalls += 1;
      return { outcome: 'missing' };
    },
    resolveWindowDescriptor: async (value) => {
      order.push(`bind:${value.windowInstanceId}`);
      return { outcome: 'success', capability: { runtimeToken: 'event-binding' }, descriptor: value };
    },
    observeWindowCapability: async (capability) => {
      order.push(`observe:${capability.runtimeToken}`);
      return { outcome: 'success', observation: { windowInstanceId: INSTANCE, bounds: { x: 2, y: 3, width: 400, height: 300 } } };
    },
    commit: async (next) => { order.push('commit'); state = next; return true; },
    createMemberId: () => 'event-member',
  });

  const result = await auto.addFromEvent({
    kind: 'open',
    windowInstanceId: INSTANCE,
    descriptor,
  });
  assert.equal(result.outcome, 'added');
  assert.equal(probeCalls, 0, 'the same-enumeration lifecycle descriptor bypasses the racy existence probe');
  assert.deepEqual(order, [`bind:${INSTANCE}`, 'observe:event-binding', 'commit']);
  assert.equal(state.windowLayouts[0].arrangement.members[0].descriptor.windowInstanceId, INSTANCE);
});

test('Auto rejects a probe or fresh binding for a different instance', async () => {
  let state = stateWithAuto();
  let binds = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => ({ outcome: 'success', descriptor: { ...descriptor, windowInstanceId: 'Wffffffffffffffff' } }),
    resolveWindowDescriptor: async () => { binds += 1; return { outcome: 'success', capability: {}, descriptor }; },
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async (next) => { state = next; return true; },
  });
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'unresolved' });
  assert.equal(binds, 0, 'a mismatched event identity never gets rebound');
  assert.equal(state.windowLayouts[0].arrangement.members.length, 0);
});

test('Auto rechecks its owner after host waits and will not add after the creator disables it', async () => {
  let state = stateWithAuto();
  let releaseResolve;
  const resolved = new Promise((resolve) => { releaseResolve = resolve; });
  let commits = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: () => resolved,
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async (next) => { commits += 1; state = next; return true; },
    createMemberId: () => 'member-1',
  });
  const pending = auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE });
  state = setWindowLayoutTracking(state, state.layoutId, false);
  releaseResolve({ outcome: 'success', capability: {}, descriptor });
  assert.deepEqual(await pending, { outcome: 'disabled' });
  assert.equal(commits, 0);
  assert.equal(state.windowLayouts[0].arrangement.members.length, 0);
});

test('Auto skips suppressed and already present window instances', async () => {
  let state = stateWithAuto();
  state = setWindowLayoutInstanceSuppressed(state, state.layoutId, INSTANCE, true);
  let resolveCalls = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => { resolveCalls += 1; return { outcome: 'success', capability: {}, descriptor }; },
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async () => true,
  });
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'suppressed' });
  state = { ...state, windowLayouts: state.windowLayouts.map((layout) => ({ ...layout, tracking: { ...layout.tracking, suppressedInstanceIds: [] }, arrangement: { ...layout.arrangement, members: [{ id: 'existing', descriptor }] } })) };
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'duplicate' });
  assert.equal(resolveCalls, 0);
});

test('Auto leaves durable membership untouched when persistence refuses the new member', async () => {
  const state = stateWithAuto();
  let published = false;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => ({ outcome: 'success', capability: {}, descriptor }),
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async () => false,
    createMemberId: () => 'member-1',
    onCommitted: () => { published = true; },
  });
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'persistence-failed' });
  assert.equal(state.windowLayouts[0].arrangement.members.length, 0);
  assert.equal(published, false);
});

test('the first complete baseline seeds pre-existing windows without adding them', async () => {
  const state = stateWithAuto();
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => ({ outcome: 'success', capability: {}, descriptor }),
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async () => true,
  });
  assert.deepEqual(await auto.acceptBaseline({
    complete: true, trackerSessionId: 'session-1', sequence: 0,
    windows: [{ windowInstanceId: INSTANCE }],
  }), { outcome: 'seeded', events: [] });
});

test('a later complete baseline recovers only newly live windows and shares the lifecycle queue', async () => {
  const newInstance = 'Wfedcba9876543210';
  let state = stateWithAuto();
  let commits = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async (id) => ({
      outcome: 'success', capability: { id }, descriptor: { ...descriptor, windowInstanceId: id },
    }),
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async (next) => { commits += 1; state = next; return true; },
    createMemberId: (() => { let id = 0; return () => `member-${++id}`; })(),
  });
  const seeded = await auto.acceptBaseline({
    complete: true, trackerSessionId: 'session-1', sequence: 4,
    windows: [{ windowInstanceId: INSTANCE }],
  });
  assert.deepEqual(seeded.events, []);
  const recovered = await auto.acceptBaseline({
    complete: true, trackerSessionId: 'session-2', sequence: 0,
    windows: [{ windowInstanceId: INSTANCE }, { windowInstanceId: newInstance }],
  });
  assert.deepEqual(recovered.events, [{ kind: 'open', windowInstanceId: newInstance }]);

  // The native push may report the same open while catch-up is being queued.
  // The composition root serializes both sources through its one queue drain.
  const queue = [...recovered.events, { kind: 'open', windowInstanceId: newInstance }];
  while (queue.length) await auto.addFromEvent(queue.shift());
  assert.equal(commits, 1);
  assert.deepEqual(state.windowLayouts[0].arrangement.members.map((member) => member.descriptor.windowInstanceId), [newInstance]);
  assert.deepEqual(await auto.acceptBaseline({
    complete: true, trackerSessionId: 'session-2', sequence: 0,
    windows: [{ windowInstanceId: INSTANCE }, { windowInstanceId: newInstance }],
  }), { outcome: 'accepted', events: [] });
});

test('a failed durable baseline reconciliation leaves its open delta available for retry', async () => {
  const recoveredInstance = 'Wfedcba9876543210';
  const auto = createWindowLayoutAutoTracking({
    getState: () => stateWithAuto(),
    resolveWindowInstance: async () => ({ outcome: 'missing' }),
    observeWindowCapability: async () => ({ outcome: 'missing' }),
    commit: async () => false,
  });
  const initial = {
    complete: true, trackerSessionId: 'session-1', sequence: 2,
    windows: [{ windowInstanceId: INSTANCE }],
  };
  assert.deepEqual(await auto.acceptBaseline(initial, async () => false), {
    outcome: 'reconciliation-failed', events: [],
  });
  assert.deepEqual(await auto.acceptBaseline(initial, async () => true), {
    outcome: 'seeded', events: [],
  });

  const later = {
    complete: true, trackerSessionId: 'session-2', sequence: 0,
    windows: [{ windowInstanceId: INSTANCE }, { windowInstanceId: recoveredInstance }],
  };
  assert.deepEqual(await auto.acceptBaseline(later, async () => false), {
    outcome: 'reconciliation-failed', events: [],
  });
  assert.deepEqual(await auto.acceptBaseline(later, async () => true), {
    outcome: 'accepted', events: [{ kind: 'open', windowInstanceId: recoveredInstance }],
  });
});

test('workspace rebinds lifecycle probes and keeps one lifecycle queue drain active', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /resolveWindowDescriptor:\s*\(descriptor\)\s*=>\s*host\.resolveWindowDescriptor\(descriptor\)/);
  assert.match(source, /while \(trackingEventQueue\.length > 0\)\s*\{\s*try\s*\{\s*await processTrackingLifecycleEvent/);
  const processor = source.match(/async function processTrackingLifecycleEvent\(event\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(processor, /trackingEventInFlight\s*=/,
    'the queue drain alone owns the in-flight lock while awaiting one event');
  const baseline = source.match(/async function reconcileTrackingBaseline\(providedSnapshot = null\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(baseline, /acceptBaseline\(snapshot, async \(\) =>/);
  assert.match(baseline, /if \(next !== before && !\(await store\.commit\(next\)\)\) return false;/);
  assert.match(baseline, /for \(const event of accepted\.events\) trackingEventQueue\.push\(event\)/);
  assert.match(baseline, /if \(accepted\.events\.length\) void drainTrackingLifecycleEvents\(\)/);
  assert.ok(baseline.indexOf('await store.commit(next)') < baseline.indexOf('accepted.events'),
    'lifecycle opens are queued only after the durable baseline reconciliation succeeds');
  assert.doesNotMatch(baseline, /populateTrackingLayout\(/,
    'startup and reconnect baselines must not bulk-add every already-live window');
});
