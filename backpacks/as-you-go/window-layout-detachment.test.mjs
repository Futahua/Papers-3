// 018A1 integration test (RoketPuncha lane): drives the PRODUCTION
// createWindowLayoutDetachment lifecycle factory against a fake host that
// mirrors the frozen `papers:project:detach-*` message protocol. Proves the
// frozen transfer ordering end to end: no detached load before ACTIVATE,
// stop+save before ACK, workspace read-only, one stop/flush owner, detached
// real-host calls, reattach flush before ACK, crash/closed reload-resume,
// open-failure recovery and teardown idempotence.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWindowLayoutDetachment,
  createDetachSaveGate,
  createDetachReadOnlyInputGuards,
  createWindowLayoutMemberDrag,
  createWindowLayoutGroupActionRunner,
  createReadOnlyStatusSink,
  decodeResumeState,
  orderWindowLayoutMemberButtons,
  windowLayoutPresentationMode,
  windowLayoutContentSignature,
  DETACH_ACTIVATE_CANCELLED,
  DETACH_MESSAGE,
  isDetachedWindow,
} from './public/app/window-layout-detached.js';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { normalizeState, ROOT_ID } from './public/workspace-model-20260730b.js';
import { visibleGraphItems } from './public/graph-model-20260730b.js';

function fakeHost() {
  const calls = [];
  const listeners = new Set();
  const host = {
    onDetachMessage: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    detachOpen: async () => { calls.push('detach-open'); return { outcome: 'opened' }; },
    detachReady: async () => calls.push('ready'),
    detachActivatedAck: async (id) => calls.push(`activated-ack:${id}`),
    detachStopAck: async (id) => calls.push(`stop-ack:${id}`),
    detachFlushAck: async (id) => calls.push(`flush-ack:${id}`),
    detachReattach: async () => calls.push('reattach'),
    detachFocus: async () => calls.push('detach-focus'),
    detachResumedAck: async (id) => calls.push(`resumed-ack:${id}`),
    emit: (type, detail = {}) => {
      const results = [];
      for (const callback of [...listeners]) {
        const result = callback(type, detail);
        if (result) results.push(result);
      }
      return results;
    },
  };
  return { host, calls };
}

function makeDetachment({ isDetached = false, host, overrides = {} } = {}) {
  const wrapped = host ?? fakeHost();
  const h = wrapped.host ?? wrapped;
  const calls = wrapped.calls ?? [];
  const events = [];
  // Deps and host acks share ONE ordered log so the frozen sequence
  // (read-only -> stop -> flush -> ACK; load -> ... -> start -> ACK) is
  // verifiable across both the injected wiring and the host bridge.
  const dep = (name, fn) => async (...args) => {
    calls.push(name);
    events.push(name);
    return fn(...args);
  };
  const detachment = createWindowLayoutDetachment({
    isDetached,
    host: h,
    loadWorkspace: dep('load', async () => ({ loaded: true })),
    installState: dep('install', () => undefined),
    render: dep('render', () => undefined),
    startController: dep('start', () => undefined),
    stopController: dep('stop', async () => undefined),
    cancelPick: dep('cancel-pick', () => undefined),
    flushSave: dep('flush', async () => undefined),
    setReadOnly: (flag) => { calls.push(`readonly:${flag}`); events.push(`readonly:${flag}`); },
    setStatus: (text) => events.push(`status:${text}`),
    ...overrides,
  });
  return { detachment, calls, events, host: h };
}

test('018A1 isDetachedWindow detects ?detach=1 only', () => {
  assert.equal(isDetachedWindow('?detach=1'), true);
  assert.equal(isDetachedWindow('?x=1&detach=1'), true);
  assert.equal(isDetachedWindow('?detach=0'), false);
  assert.equal(isDetachedWindow(''), false);
  assert.equal(isDetachedWindow({ search: '?detach=1' }), true);
});

test('018X1 detached surface never loads before ACTIVATE (preload token arrival is the READY signal)', async () => {
  const { detachment, events, host } = makeDetachment({ isDetached: true });
  assert.equal(detachment.isDetachedActive(), false);
  // No page reportReady request exists: the preload token arrival after
  // loadURL is READY; the page only registers listeners and waits.
  assert.equal(events.includes('load'), false, 'no durable-state load before activate');
  assert.equal(events.includes('start'), false, 'no controller before activate');
  // waitForActivate stays pending until the ACTIVATE push.
  let activated = false;
  const gate = detachment.waitForActivate().then(() => { activated = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activated, false, 'bootstrap load gate is unresolved before ACTIVATE');
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  await gate;
  assert.equal(activated, true);
  assert.equal(detachment.isDetachedActive(), true);
});

test('018A1 workspace STOP_REQUEST orders read-only, stop, flush, then ACK', async () => {
  const { detachment, calls, events, host } = makeDetachment({ isDetached: false });
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  assert.ok(events.indexOf('readonly:true') < events.indexOf('stop'), 'read-only entered before stop');
  assert.ok(events.indexOf('stop') < events.indexOf('flush'), 'controller stopped before the store flush');
  assert.ok(events.indexOf('flush') < calls.indexOf('stop-ack:t1'), 'store flush completes before the ACK');
  assert.equal(detachment.isReadOnly(), true, 'workspace is read-only after handoff');
  // A duplicate push for the same transfer is idempotent.
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  assert.equal(calls.filter((call) => call === 'stop-ack:t1').length, 1);
});

test('018A1 a pending different transfer is not interleaved', async () => {
  const { detachment, calls, host } = makeDetachment({ isDetached: false });
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  const before = calls.length;
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't2' }));
  assert.equal(calls.length, before, 'a different transferId is ignored while t1 owns the transfer');
});

test('018A1 CLOSED queued while STOP_REQUEST is in flight is processed after the stop ACK, never dropped', async () => {
  let releaseStop;
  const stopGate = new Promise((resolve) => { releaseStop = resolve; });
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { stopController: async () => { await stopGate; } },
  });
  const stopPromise = Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  // CLOSED arrives while the stop handoff is still in flight: it is QUEUED.
  const closedPromise = Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('stop-ack:t1'), false, 'stop is not acked while the controller stop is in flight');
  releaseStop();
  await Promise.all([stopPromise, closedPromise]);
  assert.ok(calls.indexOf('stop-ack:t1') < calls.indexOf('resumed-ack:t1'), 'stop acked before the queued resume');
  assert.equal(detachment.isReadOnly(), false, 'workspace resumed after the queued CLOSED');
});

test('018X1 workspace CLOSED (with flat reason) reloads durable state before resuming; dead CRASH push is inert', async () => {
  const closed = makeDetachment({ isDetached: false });
  await Promise.all(closed.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.ok(closed.events.indexOf('load') < closed.events.indexOf('start'), 'durable state reloads before resume');
  assert.ok(closed.events.indexOf('start') < closed.events.indexOf('readonly:false'), 'ownership is restored only after the controller starts (018X2)');
  assert.ok(closed.calls.includes('resumed-ack:t1'));
  assert.equal(closed.detachment.isReadOnly(), false);

  // Crash recovery uses the flat CLOSED `reason`, not a separate CRASH push.
  const crash = makeDetachment({ isDetached: false });
  await Promise.all(crash.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't2', reason: 'crash' }));
  assert.ok(crash.calls.includes('resumed-ack:t2'));
  assert.ok(crash.events.some((entry) => entry.startsWith('status:')), 'crash reason surfaces a recovery status');
  assert.equal(crash.detachment.isReadOnly(), false);

  // The dead separate CRASH push is inert (never handled).
  const dead = makeDetachment({ isDetached: false });
  await Promise.all(dead.host.emit('papers:project:detach-crash', { transferId: 't3' }));
  assert.equal(dead.calls.includes('resumed-ack:t3'), false, 'the dead CRASH push performs nothing');
});

test('018A1 detached FLUSH_REQUEST stops and flushes before the ACK; reattach is callable', async () => {
  const { detachment, calls, events, host } = makeDetachment({ isDetached: true });
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  assert.equal(detachment.isDetachedActive(), true);
  // Reattach/close shares the SAME transferId: one transfer per detached session.
  await Promise.all(host.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: 't1' }));
  assert.ok(events.indexOf('stop') < events.indexOf('flush'), 'controller stops before the store flush');
  assert.ok(events.indexOf('flush') < calls.indexOf('flush-ack:t1'), 'flush completes before the ACK');
  assert.equal(detachment.isDetachedActive(), false);
  await detachment.reattach();
  assert.ok(calls.includes('reattach'), 'reattach is callable from the detached surface');
});

test('018A1 open failure restores the workspace safely', async () => {
  const wrapped = fakeHost();
  wrapped.host.detachOpen = async () => { throw new Error('boom'); };
  const { detachment, events } = makeDetachment({ isDetached: false, host: wrapped });
  await assert.rejects(() => detachment.detachOpen(), /boom/);
  assert.ok(events.includes('readonly:true'), 'handoff attempted before failure');
  assert.ok(events.includes('readonly:false'), 'writable restored on failure');
  assert.ok(events.indexOf('readonly:false') < events.indexOf('start'), 'controller resumes after restore');
  assert.ok(events.some((entry) => entry.startsWith('status:')), 'failure is surfaced');
  assert.equal(detachment.isReadOnly(), false);
});

test('018A1 teardown stop() makes further lifecycle pushes inert and resolves activate waiters', async () => {
  const { detachment, calls, host } = makeDetachment({ isDetached: true });
  let resolved = false;
  const gate = detachment.waitForActivate().then(() => { resolved = true; });
  detachment.stop();
  await gate;
  assert.equal(resolved, true, 'stop resolves pending activate waiters (no stale load)');
  const before = calls.length;
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  await Promise.all(host.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: 't2' }));
  assert.equal(calls.length, before, 'no lifecycle push is processed after stop');
});

test('018A1 focusDetached calls the host without reattaching', async () => {
  const { detachment, calls } = makeDetachment({ isDetached: false });
  await detachment.focusDetached();
  assert.ok(calls.includes('detach-focus'), 'focus is available from the read-only workspace');
});

test('018A1 a per-item queue failure does not stop later pushes', async () => {
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { flushSave: async () => { throw new Error('flush boom'); } },
  });
  // STOP fails at flush; the queued CLOSED must still be processed.
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.ok(calls.includes('resumed-ack:t1'), 'the resume after a failed flush still runs');
  assert.equal(detachment.isReadOnly(), false, 'the workspace resumes despite the flush failure');
});

test('018A1 startController is awaited before the resumed ACK', async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { startController: async () => { await startGate; } },
  });
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  const resume = Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('resumed-ack:t1'), false, 'resume ACK waits for the controller to start');
  releaseStart();
  await resume;
  assert.ok(calls.includes('resumed-ack:t1'), 'the resumed ACK is sent after the controller starts');
});
test('018X1 detach save gate blocks mutations while read-only and flushes the final capture under the override', async () => {
  let state = { n: 0, view: 'v0' };
  const saved = [];
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => { state = next; return state; },
    commitState: async (next) => { state = next; return true; },
    saveState: async (current) => { saved.push(JSON.stringify(current)); },
  });
  gate.setReadOnly(true);
  // Blocked mutations while read-only (no gesture can persist).
  assert.equal(gate.replace({ n: 1 }), state, 'replace is a no-op while read-only');
  assert.equal(state.n, 0);
  await gate.commit({ n: 2 });
  assert.equal(state.n, 0, 'commit is blocked while read-only');
  assert.equal(gate.isReadOnly(), true);
  // The handoff flush raises the override BEFORE the capture, so the gated
  // replace never discards the final state; the capture is applied and saved.
  const flushed = await gate.flush(() => ({ ...state, view: 'v-final' }));
  assert.equal(flushed.view, 'v-final', 'flush captures the final view while read-only');
  assert.equal(state.view, 'v-final', 'flush applies the captured state');
  assert.equal(saved.length, 1, 'flush saved exactly once');
  assert.equal(JSON.parse(saved[0]).view, 'v-final');
  assert.equal(gate.isFlushing(), false, 'override is released after the flush');
  // After the handoff the workspace is writable again.
  gate.setReadOnly(false);
  const ok = gate.replace({ n: 5, view: 'v1' });
  assert.equal(ok.n, 5);
});
test('018X1R STOP_REQUEST awaits the direct-pick cancel before stop/flush/ACK', async () => {
  let releaseCancel;
  const cancelGate = new Promise((resolve) => { releaseCancel = resolve; });
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { cancelPick: async () => { await cancelGate; } },
  });
  const stop = Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('stop-ack:t1'), false, 'ACK waits for the awaited pick cancel');
  assert.equal(calls.includes('flush'), false, 'flush waits for the awaited pick cancel');
  releaseCancel();
  await stop;
  assert.ok(calls.includes('stop-ack:t1'), 'ACK follows the awaited pick cancel');
  assert.equal(detachment.isReadOnly(), true);
});

test('018X1R concurrent CLOSED + detachOpen rejection converge to ONE reload/start/resumed ACK', async () => {
  const { detachment, calls, events, host } = makeDetachment({ isDetached: false });
  let rejectOpen;
  host.detachOpen = () => new Promise((resolve, reject) => { rejectOpen = reject; });
  const open = detachment.detachOpen().catch((error) => error);
  // A transfer begins while the open is in flight (activation timeout path).
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  const closed = Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  rejectOpen(new Error('activation timeout'));
  const error = await open;
  assert.equal(error.message, 'activation timeout');
  await closed;
  assert.equal(events.filter((entry) => entry === 'load').length, 1, 'exactly one reload');
  assert.equal(events.filter((entry) => entry === 'start').length, 1, 'exactly one controller start');
  assert.equal(calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'exactly one resumed ACK');
  assert.equal(detachment.isReadOnly(), false, 'the workspace resumed through the canonical CLOSED');
});

test('018X1R detach save gate covers replace+save across the REAL store wiring', async () => {
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const persisted = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: (snapshot) => { persisted.push(snapshot); return Promise.resolve(); },
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const storeCommit = store.commit.bind(store);
  const storeReplace = store.replace.bind(store);
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => storeReplace(next),
    commitState: (next, options) => storeCommit(next, options),
    saveState: (current) => store.save(current),
  });
  store.commit = (next, options) => gate.commit(next, options);
  store.replace = (next) => gate.replace(next);
  gate.setReadOnly(true);
  // Blocked while read-only through the REAL store.
  assert.equal(store.replace({ ...state, schemaVersion: 1 }), state, 'replace is a no-op while read-only');
  await store.commit({ ...state });
  assert.equal(persisted.length, 0, 'no persistence while read-only');
  // The flush override covers BOTH the capture replace and the awaited store
  // save: the final view is applied and persisted exactly once.
  const flushed = await gate.flush(() => ({ ...state, view: { currentGroupId: 'new' } }));
  assert.equal(flushed.view.currentGroupId, 'new', 'flush applies the final capture while read-only');
  assert.equal(state.view.currentGroupId, 'new');
  assert.equal(persisted.length, 1, 'flush saved exactly once through the real store');
  assert.equal(JSON.parse(persisted[0]).view.currentGroupId, 'new');
  assert.equal(gate.isFlushing(), false, 'override released after the flush');
});
test('018X2 simultaneous duplicate lifecycle pushes execute once (one effect/ACK each)', async () => {
  // STOP: two identical pushes while the first is queued/in-flight -> one ACK.
  const stop = makeDetachment({ isDetached: false });
  await Promise.all([
    ...stop.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }),
    ...stop.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }),
  ]);
  assert.equal(stop.calls.filter((call) => call === 'stop-ack:t1').length, 1, 'one STOP ACK');
  assert.equal(stop.events.filter((entry) => entry === 'flush').length, 1, 'one flush');

  // FLUSH: duplicates while detached -> one ACK.
  const flush = makeDetachment({ isDetached: true });
  await Promise.all(flush.host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  await Promise.all([
    ...flush.host.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: 't1' }),
    ...flush.host.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: 't1' }),
  ]);
  assert.equal(flush.calls.filter((call) => call === 'flush-ack:t1').length, 1, 'one FLUSH ACK');
  assert.equal(flush.detachment.isDetachedActive(), false);

  // CLOSED: duplicates -> one resume ACK.
  const closed = makeDetachment({ isDetached: false });
  await Promise.all(closed.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await Promise.all([
    ...closed.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }),
    ...closed.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }),
  ]);
  assert.equal(closed.calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'one RESUMED ACK');
  assert.equal(closed.detachment.isReadOnly(), false);

  // ACTIVATE: duplicates resolve the activate gate exactly once (no hang).
  const act = makeDetachment({ isDetached: true });
  const gate = act.detachment.waitForActivate();
  await Promise.all([
    ...act.host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }),
    ...act.host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }),
  ]);
  assert.equal(await gate, 't1', 'activate gate resolved once');
  assert.equal(act.detachment.isDetachedActive(), true);
});

test('018X2 stop() resolves pre-ACTIVATE waiters with the cancellation sentinel and blocks ACTIVATE', async () => {
  const { detachment, host } = makeDetachment({ isDetached: true });
  const gate = detachment.waitForActivate();
  detachment.stop();
  assert.equal(await gate, DETACH_ACTIVATE_CANCELLED, 'explicit cancellation sentinel, not null');
  assert.equal(detachment.isStopped(), true);
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  assert.equal(detachment.isDetachedActive(), false, 'no activation after stop');
});

test('018X2 CLOSED keeps read-only through load/install/start; unlocks only after controller start, then RESUMED ACK', async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const { detachment, calls, events, host } = makeDetachment({
    isDetached: false,
    overrides: { startController: async () => { await startGate; } },
  });
  await Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  assert.equal(detachment.isReadOnly(), true);
  const resume = Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detachment.isReadOnly(), true, 'read-only stays engaged while the controller starts');
  assert.equal(calls.includes('resumed-ack:t1'), false, 'RESUMED ACK waits for the controller start');
  releaseStart();
  await resume;
  assert.ok(events.indexOf('start') < events.indexOf('readonly:false'), 'start precedes the unlock');
  assert.equal(detachment.isReadOnly(), false, 'ownership restored only after controller start');
  assert.ok(calls.includes('resumed-ack:t1'));
});

test('018X2 an in-flight handoff flush serializes a later CLOSED: one stop ACK, one resume, no double owner work', async () => {
  let releaseFlush;
  const flushGate = new Promise((resolve) => { releaseFlush = resolve; });
  const { detachment, calls, events, host } = makeDetachment({
    isDetached: false,
    overrides: { flushSave: async () => { await flushGate; } },
  });
  const stop = Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  const closed = Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('stop-ack:t1'), false, 'stop ACK waits for the in-flight flush');
  releaseFlush();
  await Promise.all([stop, closed]);
  assert.equal(calls.filter((call) => call === 'stop-ack:t1').length, 1, 'one stop ACK');
  assert.equal(calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'one resumed ACK');
  assert.equal(events.filter((entry) => entry === 'start').length, 1, 'one controller start');
  assert.equal(detachment.isReadOnly(), false);
});
test('018X2 store undo/redo are gated while read-only (state/history/persistence unchanged)', async () => {
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const persisted = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: (snapshot) => { persisted.push(snapshot); return Promise.resolve(); },
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const storeCommit = store.commit.bind(store);
  const storeReplace = store.replace.bind(store);
  const storeUndo = store.undo.bind(store);
  const storeRedo = store.redo.bind(store);
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => storeReplace(next),
    commitState: (next, options) => storeCommit(next, options),
    saveState: (current) => store.save(current),
  });
  store.commit = (next, options) => gate.commit(next, options);
  store.replace = (next) => gate.replace(next);
  // Mirror the entry's explicit undo/redo gating (lexical commit bypass).
  store.undo = () => (gate.isReadOnly() && !gate.isFlushing()) ? Promise.resolve(false) : storeUndo();
  store.redo = () => (gate.isReadOnly() && !gate.isFlushing()) ? Promise.resolve(false) : storeRedo();
  // Build real history while writable.
  await store.commit({ ...state, groups: [...state.groups, { id: 'g1', name: 'G', parentId: ROOT_ID, order: 0 }] });
  assert.ok(persisted.length >= 1, 'writable commit persisted');
  gate.setReadOnly(true);
  const stateBefore = JSON.stringify(state);
  const persistedBefore = persisted.length;
  await store.undo();
  await store.redo();
  assert.equal(persisted.length, persistedBefore, 'undo/redo persist nothing while read-only');
  assert.equal(JSON.stringify(state), stateBefore, 'undo/redo leave state unchanged while read-only');
  assert.equal(gate.isReadOnly(), true);
});

test('018X2 controller stop (runtime stop promise) is awaited before flush/ACK', async () => {
  let releaseStop;
  const stopGate = new Promise((resolve) => { releaseStop = resolve; });
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { stopController: async () => { await stopGate; } },
  });
  const stop = Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('flush'), false, 'flush waits for the controller stop');
  assert.equal(calls.includes('stop-ack:t1'), false, 'stop ACK waits for the controller stop');
  releaseStop();
  await stop;
  assert.ok(calls.includes('stop-ack:t1'));
  assert.equal(detachment.isReadOnly(), true);
});

test('018X2 read-only entry (gesture cancellation) is awaited before flush/ACK', async () => {
  let releaseReadOnly;
  const roGate = new Promise((resolve) => { releaseReadOnly = resolve; });
  const { detachment, calls, host } = makeDetachment({
    isDetached: false,
    overrides: { setReadOnly: async (flag) => { if (flag) await roGate; } },
  });
  const stop = Promise.all(host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes('stop-ack:t1'), false, 'stop ACK waits for the read-only entry (gesture cancellation)');
  releaseReadOnly();
  await stop;
  assert.ok(calls.includes('stop-ack:t1'));
  assert.equal(detachment.isReadOnly(), true);
});
test('018X3 read-only input guards allow ONLY the toolbar surface and activate it once', async () => {
  const listeners = new Map();
  const windowRef = {
    addEventListener: (type, handler, capture) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ handler, capture });
    },
    removeEventListener: (type, handler, capture) => {
      const arr = listeners.get(type) ?? [];
      listeners.set(type, arr.filter((entry) => entry.handler !== handler || entry.capture !== capture));
    },
    fire: (type, event) => {
      for (const entry of [...(listeners.get(type) ?? [])]) entry.handler(event);
    },
  };
  const button = { clicks: 0, click() { button.clicks += 1; } };
  let toolbarRef = { contains: (target) => target === button };
  const guards = createDetachReadOnlyInputGuards({ windowRef, getToolbar: () => toolbarRef });
  const ev = (props = {}) => {
    const e = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { e.defaultPrevented = true; },
      stopPropagation() { e.propagationStopped = true; },
      ...props,
    };
    return e;
  };
  const canvas = { id: 'canvas' };

  guards.arm();
  assert.equal(guards.isArmed(), true);

  // Pointer click targeted at the toolbar button passes through and the
  // button can activate; underlying canvas events stay blocked.
  const clickToolbar = ev({ target: button, type: 'click' });
  windowRef.fire('click', clickToolbar);
  assert.equal(clickToolbar.defaultPrevented, false, 'toolbar click is not swallowed');
  assert.equal(clickToolbar.propagationStopped, false, 'toolbar click is not stopped');
  const pointerToolbar = ev({ target: button, type: 'pointerup' });
  windowRef.fire('pointerup', pointerToolbar);
  assert.equal(pointerToolbar.defaultPrevented, false, 'toolbar pointerup is not swallowed');
  const pointerCanvas = ev({ target: canvas, type: 'pointerup' });
  windowRef.fire('pointerup', pointerCanvas);
  assert.equal(pointerCanvas.defaultPrevented, true, 'underlying captured pointerup is blocked');
  assert.equal(pointerCanvas.propagationStopped, true);
  const clickCanvas = ev({ target: canvas, type: 'click' });
  windowRef.fire('click', clickCanvas);
  assert.equal(clickCanvas.defaultPrevented, true, 'underlying captured click is blocked');

  // Enter and Space on a focused toolbar button activate it exactly once while
  // preventing default and blocking propagation to workspace hotkeys.
  const enter = ev({ target: button, key: 'Enter', type: 'keydown' });
  windowRef.fire('keydown', enter);
  assert.equal(enter.defaultPrevented, true, 'Enter default is prevented');
  assert.equal(enter.propagationStopped, true, 'Enter does not reach workspace hotkeys');
  assert.equal(button.clicks, 1, 'Enter activates exactly once');
  const space = ev({ target: button, key: ' ', type: 'keydown' });
  windowRef.fire('keydown', space);
  assert.equal(space.defaultPrevented, true);
  assert.equal(space.propagationStopped, true);
  assert.equal(button.clicks, 2, 'Space activates exactly once');

  // Ctrl+Z / other keys on a focused toolbar button remain blocked.
  const ctrlZ = ev({ target: button, key: 'z', ctrlKey: true, type: 'keydown' });
  windowRef.fire('keydown', ctrlZ);
  assert.equal(ctrlZ.defaultPrevented, true, 'Ctrl+Z is blocked');
  assert.equal(ctrlZ.propagationStopped, true, 'Ctrl+Z does not reach workspace hotkeys');
  assert.equal(button.clicks, 2, 'Ctrl+Z does not activate the button');
  const arrow = ev({ target: button, key: 'ArrowDown', type: 'keydown' });
  windowRef.fire('keydown', arrow);
  assert.equal(arrow.defaultPrevented, true, 'arrow key is blocked');
  assert.equal(button.clicks, 2);

  // Disarm removes the guards.
  guards.disarm();
  assert.equal(guards.isArmed(), false);
  const after = ev({ target: canvas, key: 'x', type: 'keydown' });
  windowRef.fire('keydown', after);
  assert.equal(after.defaultPrevented, false, 'events flow again after disarm');
  assert.equal(button.clicks, 2);
});
test('018X3 concurrent different transfers execute only the first (ownership reserved at enqueue)', async () => {
  const { detachment, calls, host } = makeDetachment({ isDetached: false });
  await Promise.all([
    ...host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }),
    ...host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't2' }),
  ]);
  assert.equal(calls.filter((call) => call === 'stop-ack:t1').length, 1, 't1 executes');
  assert.equal(calls.filter((call) => call === 'stop-ack:t2').length, 0, 't2 never executes');
  // Same-transfer later phases still run.
  await Promise.all(host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.equal(calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'same-transfer CLOSED still runs');
  assert.equal(detachment.isReadOnly(), false);
});

test('018X3 flush override never opens public commit/replace/undo/redo while awaited', async () => {
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const persisted = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: (snapshot) => { persisted.push(snapshot); return Promise.resolve(); },
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const storeCommit = store.commit.bind(store);
  const storeReplace = store.replace.bind(store);
  const storeUndo = store.undo.bind(store);
  const storeRedo = store.redo.bind(store);
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => storeReplace(next),
    commitState: (next, options) => storeCommit(next, options),
    saveState: async (current) => { await saveGate; await store.save(current); },
  });
  store.commit = (next, options) => gate.commit(next, options);
  store.replace = (next) => gate.replace(next);
  store.undo = () => (gate.isReadOnly()) ? Promise.resolve(false) : storeUndo();
  store.redo = () => (gate.isReadOnly()) ? Promise.resolve(false) : storeRedo();
  gate.setReadOnly(true);
  const flushing = gate.flush(() => ({ ...state, view: { currentGroupId: 'flush' } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.isFlushing(), true, 'flush is in flight');
  // An unrelated delayed continuation tries every public mutator during the flush.
  const stateBefore = JSON.stringify(state);
  const persistedBefore = persisted.length;
  await gate.commit({ ...state, groups: [...state.groups, { id: 'g1', name: 'G', parentId: ROOT_ID, order: 0 }] });
  const replaced = gate.replace({ ...state, view: { currentGroupId: 'sneak' } });
  assert.equal(replaced, state, 'public replace is blocked during the flush');
  await store.undo();
  await store.redo();
  assert.equal(JSON.stringify(state), stateBefore, 'public mutators change neither state/history nor persistence during the flush');
  assert.equal(persisted.length, persistedBefore, 'nothing extra persisted during the in-flight flush');
  releaseSave();
  await flushing;
  assert.equal(persisted.length, persistedBefore + 1, 'the flush saved exactly once');
  assert.equal(JSON.parse(persisted[persisted.length - 1]).view.currentGroupId, 'flush');
});
test('018X4 member drag guard finalizes only a live pointer-matching drag exactly once', () => {
  const drag = createWindowLayoutMemberDrag();
  drag.start({ layoutId: 'L1', memberId: 'm1', clientX: 10, clientY: 10, pointerId: 5 });
  assert.equal(drag.isActive(), true);
  assert.equal(drag.move(5, 20, 20)?.moved, true, 'move above the threshold marks moved');
  let finalized = 0;
  assert.equal(drag.finalize(5, () => { finalized += 1; }), true, 'matching pointer finalizes');
  assert.equal(finalized, 1);
  assert.equal(drag.isActive(), false, 'finalize clears the drag');
  assert.equal(drag.finalize(5, () => { finalized += 1; }), false, 'second finalize is a no-op');
  assert.equal(finalized, 1);
});

test('018X4 member drag guard: wrong pointer and post-cancel finalize are no-ops (pointer reuse cannot revive)', () => {
  const drag = createWindowLayoutMemberDrag();
  drag.start({ layoutId: 'L1', memberId: 'm1', clientX: 0, clientY: 0, pointerId: 7 });
  drag.move(7, 50, 50);
  let finalized = 0;
  assert.equal(drag.finalize(8, () => { finalized += 1; }), false, 'a different pointer cannot finalize');
  assert.equal(finalized, 0);
  assert.equal(drag.isActive(), true, 'a wrong-pointer finalize leaves the drag live');
  // Read-only entry cancels the mid-drag gesture.
  drag.cancel();
  assert.equal(drag.isActive(), false);
  // A later pointerup with the SAME pointer ID (reuse after reattach) is a no-op.
  assert.equal(drag.finalize(7, () => { finalized += 1; }), false, 'a cancelled drag cannot finalize on pointer-ID reuse');
  assert.equal(finalized, 0);
  // A fresh start after cancel still works.
  drag.start({ layoutId: 'L2', memberId: 'm2', clientX: 0, clientY: 0, pointerId: 7 });
  assert.equal(drag.move(7, 10, 10)?.moved, true);
  assert.equal(drag.finalize(7, () => { finalized += 1; }), true, 'a fresh drag finalizes normally');
  assert.equal(finalized, 1);
});

test('018X4 a failed awaited OS result during a handoff produces zero post-handoff effects', async () => {
  // Failing store flush during STOP: no ACK, read-only stays engaged, the queue
  // continues so a later CLOSED resumes exactly once.
  const h = makeDetachment({
    isDetached: false,
    overrides: { flushSave: async () => { throw new Error('flush failed'); } },
  });
  await Promise.all(h.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  assert.equal(h.calls.filter((call) => call === 'stop-ack:t1').length, 0, 'no ACK after a failed flush');
  assert.equal(h.detachment.isReadOnly(), true, 'read-only stays engaged after the failed flush');
  await Promise.all(h.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.equal(h.events.filter((entry) => entry === 'start').length, 1, 'the later resume starts the controller once');
  assert.equal(h.calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'the later resume ACKs once');
  assert.equal(h.detachment.isReadOnly(), false);

  // Failing durable reload during CLOSED: no controller start, no resumed ACK,
  // read-only stays engaged (a failed await cannot unlock the handoff).
  const fail = makeDetachment({
    isDetached: false,
    overrides: { loadWorkspace: async () => { throw new Error('load failed'); } },
  });
  await Promise.all(fail.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await Promise.all(fail.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.equal(fail.events.filter((entry) => entry === 'start').length, 0, 'no controller start after a failed reload');
  assert.equal(fail.calls.filter((call) => call === 'resumed-ack:t1').length, 0, 'no resumed ACK after a failed reload');
  assert.equal(fail.detachment.isReadOnly(), true, 'read-only stays engaged after a failed reload');
});
test('018X5 a delayed successful apply crossing into read-only never calls restore', async () => {
  let readOnly = false;
  let releaseApply;
  const applyGate = new Promise((resolve) => { releaseApply = resolve; });
  const calls = [];
  const runner = createWindowLayoutGroupActionRunner({
    isReadOnly: () => readOnly,
    host: {
      observeWindowCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 1, y: 2, width: 300, height: 200 }, state: 'normal' } }),
      applyWindowCapability: async () => { calls.push('apply'); await applyGate; return { outcome: 'success' }; },
      restoreWindowCapability: async () => { calls.push('restore'); return { outcome: 'success' }; },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
  });
  const member = { id: 'm1', bounds: { x: 1, y: 2, width: 300, height: 200 } };
  const pending = runner.runMember({ bindingId: 'b' }, member, 'restore');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['apply'], 'apply is issued');
  readOnly = true; // handoff begins during the awaited apply
  releaseApply();
  const outcome = await pending;
  assert.equal(outcome, 'superseded');
  assert.deepEqual(calls, ['apply'], 'restore is NEVER called after the apply crossed into read-only');
});

test('018X5 the group-action runner never issues a host call after supersession', async () => {
  let readOnly = false;
  const calls = [];
  const runner = createWindowLayoutGroupActionRunner({
    isReadOnly: () => readOnly,
    host: {
      observeWindowCapability: async () => { calls.push('observe'); return { outcome: 'success', observation: { bounds: null, state: 'normal' } }; },
      applyWindowCapability: async () => { calls.push('apply'); return { outcome: 'success' }; },
      restoreWindowCapability: async () => { calls.push('restore'); return { outcome: 'success' }; },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
  });
  const member = { id: 'm2', bounds: { x: 1, y: 2, width: 300, height: 200 } };
  readOnly = true; // handoff before the call: no second host call can be issued
  const outcome = await runner.runMember({ bindingId: 'b' }, member, 'restore');
  assert.equal(outcome, 'superseded');
  assert.deepEqual(calls, [], 'no observe/apply/restore is issued after supersession');
  assert.equal(runner.aborted(), 'superseded', 'aborted() reflects read-only');
});

test('018X5 group-action runner minimizes with the barrier and succeeds while writable', async () => {
  const calls = [];
  const runner = createWindowLayoutGroupActionRunner({
    isReadOnly: () => false,
    host: {
      observeWindowCapability: async () => { calls.push('observe'); return { outcome: 'success', observation: { bounds: null, state: 'normal' } }; },
      applyWindowCapability: async () => { calls.push('apply'); return { outcome: 'success' }; },
      restoreWindowCapability: async () => { calls.push('restore'); return { outcome: 'success' }; },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
  });
  const outcome = await runner.runMember({ bindingId: 'b' }, { id: 'm3', bounds: null }, 'minimize');
  assert.equal(outcome, 'success');
  assert.deepEqual(calls, ['observe', 'minimize']);
  assert.equal(runner.aborted(), null);
});
test('018X6 orderWindowLayoutMemberButtons restores the canonical DOM order and never drops nodes', () => {
  const b1 = { dataset: { wlMember: 'm1' } };
  const b2 = { dataset: { wlMember: 'm2' } };
  const b3 = { dataset: { wlMember: 'm3' } };
  const unknown = { dataset: { wlMember: 'mx' } };
  // A pointermove already reordered the live DOM as [b2, b3, b1, unknown].
  const ordered = orderWindowLayoutMemberButtons([b2, b3, b1, unknown], ['m1', 'm2', 'm3']);
  assert.deepEqual(ordered, [b1, b2, b3, unknown], 'buttons roll back to canonical order; unknown preserved at the end');
});

test('018X6 member drag cancelMatching clears only a pointer-matching drag', () => {
  const drag = createWindowLayoutMemberDrag();
  drag.start({ layoutId: 'L1', memberId: 'm1', clientX: 0, clientY: 0, pointerId: 9 });
  assert.equal(drag.cancelMatching(10), false, 'a different pointer does not cancel');
  assert.equal(drag.isActive(), true, 'the drag survives a mismatched pointercancel');
  assert.equal(drag.cancelMatching(9), true, 'the matching pointer cancels');
  assert.equal(drag.isActive(), false);
});
test('018X7 a read-only flip during the capability microtask yields zero observe calls', async () => {
  const calls = [];
  let readOnly = false;
  const runner = createWindowLayoutGroupActionRunner({
    isReadOnly: () => readOnly,
    host: {
      observeWindowCapability: async () => { calls.push('observe'); return { outcome: 'success', observation: { bounds: null, state: 'normal' } }; },
      applyWindowCapability: async () => { calls.push('apply'); return { outcome: 'success' }; },
      restoreWindowCapability: async () => { calls.push('restore'); return { outcome: 'success' }; },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
  });
  // A capability is "acquired" (cached fast path) and read-only flips during
  // the microtask boundary before the next host call is attempted.
  const capability = { bindingId: 'b' };
  const pending = Promise.resolve()
    .then(() => { readOnly = true; return capability; })
    .then((cap) => runner.runMember(cap, { id: 'm', bounds: null }, 'restore'));
  const outcome = await pending;
  assert.equal(outcome, 'superseded');
  assert.deepEqual(calls, [], 'zero observe calls after the read-only flip');
});

test('018X7 read-only status sink suppresses store persistence errors during the handoff but not while writable', async () => {
  let readOnly = false;
  const shown = [];
  const sink = createReadOnlyStatusSink({
    isReadOnly: () => readOnly,
    show: (text) => shown.push(text),
  });
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: async () => { throw new Error('save failed'); },
    setStatus: sink,
    initialSession: { currentId: ROOT_ID },
  });
  // Writable: a rejected save paints exactly one status.
  await store.commit({ ...state });
  assert.equal(shown.length, 1, 'writable rejection paints one status');
  shown.length = 0;
  // Read-only before a queued save rejection settles: zero status.
  readOnly = true;
  const queued = store.commit({ ...state });
  await queued;
  assert.equal(shown.length, 0, 'read-only rejection paints zero status');
});
test('018X8 queued writable commit cannot persist during the flush; exactly one final snapshot', async () => {
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const persisted = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: (snapshot, metadata) => {
      if (!gate.permitsPersist(metadata)) return Promise.resolve();
      persisted.push(JSON.parse(snapshot));
      return Promise.resolve();
    },
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const storeCommit = store.commit.bind(store);
  const storeReplace = store.replace.bind(store);
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => storeReplace(next),
    commitState: (next, options) => storeCommit(next, options),
    saveState: (current, metadata) => store.save(current, metadata),
  });
  store.commit = (next, options) => gate.commit(next, options);
  store.replace = (next) => gate.replace(next);
  // Queue a writable commit (snapshot 1) whose save sits in the store queue.
  const queued = store.commit({ ...state, groups: [...state.groups, { id: 'g1', name: 'G', parentId: ROOT_ID, order: 0 }] });
  // Enter read-only and start the final flush (snapshot 2) BEFORE the queue drains.
  gate.setReadOnly(true);
  const flushing = gate.flush(() => ({ ...state, view: { currentGroupId: 'f2' } }));
  await Promise.all([queued, flushing]);
  assert.equal(persisted.length, 1, 'exactly ONE persist across the queued commit + flush');
  assert.equal(persisted[0].view.currentGroupId, 'f2', 'the persisted snapshot is the flush capture (snapshot 2)');
  assert.equal(persisted[0].groups.length, 1, 'the final snapshot includes the committed group');
});

test('018X8 a forged/stale token cannot persist while read-only; writable saves unchanged', async () => {
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const persisted = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: (snapshot, metadata) => {
      if (!gate.permitsPersist(metadata)) return Promise.resolve();
      persisted.push(JSON.parse(snapshot));
      return Promise.resolve();
    },
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const storeCommit = store.commit.bind(store);
  const storeReplace = store.replace.bind(store);
  const gate = createDetachSaveGate({
    getState: () => state,
    replaceState: (next) => storeReplace(next),
    commitState: (next, options) => storeCommit(next, options),
    saveState: (current, metadata) => store.save(current, metadata),
  });
  store.commit = (next, options) => gate.commit(next, options);
  store.replace = (next) => gate.replace(next);
  // Writable saves persist normally (metadata ignored).
  await store.save({ ...state, view: { currentGroupId: 'w' } });
  assert.equal(persisted.length, 1, 'a writable save persists');
  assert.equal(persisted[0].view.currentGroupId, 'w');
  // A forged token cannot persist while read-only.
  gate.setReadOnly(true);
  await store.save({ ...state, view: { currentGroupId: 'x' } }, Symbol('forged'));
  assert.equal(persisted.length, 1, 'a forged token cannot persist while read-only');
  // A stale token after a completed flush cannot persist either.
  await gate.flush(() => ({ ...state, view: { currentGroupId: 'f' } }));
  assert.equal(persisted.length, 2, 'the flush persisted its final snapshot');
  await store.save({ ...state, view: { currentGroupId: 'y' } });
  assert.equal(persisted.length, 2, 'a token-less save cannot persist while read-only');
});
test('018V1 two complete detach/reattach cycles with distinct ids (AYG side repeat-cycle)', async () => {
  const wListeners = new Set();
  const wCalls = [];
  const workspaceHost = {
    onDetachMessage: (cb) => { wListeners.add(cb); return () => wListeners.delete(cb); },
    detachStopAck: async (id) => wCalls.push(`stop-ack:${id}`),
    detachResumedAck: async (id) => wCalls.push(`resumed-ack:${id}`),
    detachOpen: async () => ({}),
    detachReattach: async () => {},
    detachFocus: async () => {},
    detachFlushAck: async () => {},
    emit: (t, d) => [...wListeners].map((cb) => cb(t, d)),
  };
  const wEvents = [];
  const workspace = createWindowLayoutDetachment({
    isDetached: false, host: workspaceHost,
    loadWorkspace: async () => { wEvents.push('load'); return {}; },
    installState: () => wEvents.push('install'),
    render: () => wEvents.push('render'),
    startController: () => wEvents.push('start'),
    stopController: async () => wEvents.push('stop'),
    cancelPick: () => {},
    flushSave: async () => wEvents.push('flush'),
    setReadOnly: (flag) => wEvents.push(`ro:${flag}`),
    setStatus: () => {},
  });

  async function runDetachedCycle(id) {
    const dListeners = new Set();
    const dCalls = [];
    const detachedHost = {
      onDetachMessage: (cb) => { dListeners.add(cb); return () => dListeners.delete(cb); },
      detachFlushAck: async (tid) => dCalls.push(`flush-ack:${tid}`),
      detachOpen: async () => ({}),
      detachReattach: async () => {},
      detachFocus: async () => {},
      detachStopAck: async () => {},
      detachResumedAck: async () => {},
      emit: (t, d) => [...dListeners].map((cb) => cb(t, d)),
    };
    const dEvents = [];
    const detached = createWindowLayoutDetachment({
      isDetached: true, host: detachedHost,
      loadWorkspace: async () => { dEvents.push('load'); return {}; },
      installState: () => dEvents.push('install'),
      render: () => dEvents.push('render'),
      startController: () => dEvents.push('start'),
      stopController: async () => dEvents.push('stop'),
      cancelPick: () => {},
      flushSave: async () => dEvents.push('flush'),
      setReadOnly: (flag) => dEvents.push(`ro:${flag}`),
      setStatus: () => {},
    });
    const gate = detached.waitForActivate();
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.ACTIVATE, { transferId: id }));
    assert.equal(await gate, id, `cycle ${id} activates`);
    assert.equal(detached.isDetachedActive(), true);
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: id }));
    assert.equal(detached.isDetachedActive(), false);
    assert.ok(dCalls.includes(`flush-ack:${id}`));
  }

  // Cycle 1.
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  assert.ok(wCalls.includes('stop-ack:t1'));
  await runDetachedCycle('t1');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.ok(wCalls.includes('resumed-ack:t1'));
  assert.equal(workspace.isReadOnly(), false);

  // Cycle 2 with a DISTINCT id: the workspace re-reserves, a NEW detached
  // page (fresh factory) activates.
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't2' }));
  assert.ok(wCalls.includes('stop-ack:t2'), 'cycle 2 STOP_ACK delivered');
  await runDetachedCycle('t2');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't2' }));
  assert.ok(wCalls.includes('resumed-ack:t2'));
  assert.equal(workspace.isReadOnly(), false);
  assert.equal(wEvents.filter((entry) => entry === 'start').length, 2, 'controller started once per resume');
});
test('018V2 a fresh detached page reports READY after listener install and before ACTIVATE, exactly once', async () => {
  const { detachment, calls, events, host } = makeDetachment({ isDetached: true });
  // Listener/factory installed at creation; READY is reported before the wait.
  await detachment.reportReady();
  assert.ok(calls.includes('ready'), 'page READY is reported');
  assert.equal(events.includes('load'), false, 'no load before ACTIVATE');
  assert.equal(events.includes('start'), false, 'no controller before ACTIVATE');
  // Exactly once: a second report is a no-op.
  const readyCount = calls.filter((call) => call === 'ready').length;
  await detachment.reportReady();
  assert.equal(calls.filter((call) => call === 'ready').length, readyCount, 'READY is reported exactly once');
  // wait ACTIVATE -> load/start.
  let activated = null;
  const gate = detachment.waitForActivate().then((id) => { activated = id; });
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  await gate;
  assert.equal(activated, 't1');
  assert.equal(detachment.isDetachedActive(), true);
});

test('018V2 two detach cycles each report READY then activate on a fresh page', async () => {
  const wListeners = new Set();
  const wCalls = [];
  const workspaceHost = {
    onDetachMessage: (cb) => { wListeners.add(cb); return () => wListeners.delete(cb); },
    detachStopAck: async (id) => wCalls.push(`stop-ack:${id}`),
    detachResumedAck: async (id) => wCalls.push(`resumed-ack:${id}`),
    detachOpen: async () => ({}),
    detachReattach: async () => {},
    detachFocus: async () => {},
    detachFlushAck: async () => {},
    emit: (t, d) => [...wListeners].map((cb) => cb(t, d)),
  };
  const wEvents = [];
  const workspace = createWindowLayoutDetachment({
    isDetached: false, host: workspaceHost,
    loadWorkspace: async () => { wEvents.push('load'); return {}; },
    installState: () => wEvents.push('install'),
    render: () => wEvents.push('render'),
    startController: () => wEvents.push('start'),
    stopController: async () => wEvents.push('stop'),
    cancelPick: () => {},
    flushSave: async () => wEvents.push('flush'),
    setReadOnly: (flag) => wEvents.push(`ro:${flag}`),
    setStatus: () => {},
  });

  async function runDetachedCycle(id) {
    const dListeners = new Set();
    const dCalls = [];
    const detachedHost = {
      onDetachMessage: (cb) => { dListeners.add(cb); return () => dListeners.delete(cb); },
      detachReady: async () => dCalls.push(`ready:${id}`),
      detachFlushAck: async (tid) => dCalls.push(`flush-ack:${tid}`),
      detachOpen: async () => ({}),
      detachReattach: async () => {},
      detachFocus: async () => {},
      detachStopAck: async () => {},
      detachResumedAck: async () => {},
      emit: (t, d) => [...dListeners].map((cb) => cb(t, d)),
    };
    const dEvents = [];
    const detached = createWindowLayoutDetachment({
      isDetached: true, host: detachedHost,
      loadWorkspace: async () => { dEvents.push('load'); return {}; },
      installState: () => dEvents.push('install'),
      render: () => dEvents.push('render'),
      startController: () => dEvents.push('start'),
      stopController: async () => dEvents.push('stop'),
      cancelPick: () => {},
      flushSave: async () => dEvents.push('flush'),
      setReadOnly: (flag) => dEvents.push(`ro:${flag}`),
      setStatus: () => {},
    });
    // Order: listener installed (factory created) -> page READY -> wait
    // ACTIVATE -> load/start.
    await detached.reportReady();
    assert.ok(dCalls.includes(`ready:${id}`), `cycle ${id} reports READY`);
    assert.equal(dEvents.includes('load'), false, `cycle ${id} loads only after ACTIVATE`);
    const gate = detached.waitForActivate();
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.ACTIVATE, { transferId: id }));
    assert.equal(await gate, id, `cycle ${id} activates`);
    assert.equal(detached.isDetachedActive(), true);
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: id }));
    assert.equal(detached.isDetachedActive(), false);
    assert.ok(dCalls.includes(`flush-ack:${id}`));
  }

  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await runDetachedCycle('t1');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.ok(wCalls.includes('resumed-ack:t1'));

  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't2' }));
  assert.ok(wCalls.includes('stop-ack:t2'));
  await runDetachedCycle('t2');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't2' }));
  assert.ok(wCalls.includes('resumed-ack:t2'));
  assert.equal(workspace.isReadOnly(), false);
  assert.equal(wEvents.filter((entry) => entry === 'start').length, 2, 'one controller start per resume');
});
test('018V4 first and duplicate ACTIVATE produce two receipts but one load/start', async () => {
  const { detachment, calls, host } = makeDetachment({ isDetached: true });
  await detachment.reportReady();
  let loadCount = 0;
  const gate = detachment.waitForActivate().then(() => { loadCount += 1; });
  // First ACTIVATE: process + receipt.
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  await gate;
  assert.equal(loadCount, 1, 'load/start runs exactly once');
  assert.equal(detachment.isDetachedActive(), true);
  // Duplicate ACTIVATE (Papers resend): ACK again, but no second load/start.
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  assert.equal(loadCount, 1, 'duplicate ACTIVATE does not re-run load/start');
  assert.equal(calls.filter((call) => call === 'activated-ack:t1').length, 2, 'two receipts');
});

test('018V4 a foreign ACTIVATE never ACKs', async () => {
  const { detachment, calls, host } = makeDetachment({ isDetached: true });
  await detachment.reportReady();
  // Establish the active transfer.
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 't1' }));
  assert.equal(calls.filter((call) => call === 'activated-ack:t1').length, 1);
  // A foreign transfer must never ACK.
  await Promise.all(host.emit(DETACH_MESSAGE.ACTIVATE, { transferId: 'foreign' }));
  assert.equal(calls.filter((call) => call === 'activated-ack:foreign').length, 0, 'foreign transfer never ACKs');
  assert.equal(detachment.isDetachedActive(), true);
  assert.equal(calls.filter((call) => call === 'activated-ack:t1').length, 1, 'active transfer unchanged');
});
test('018V4 two fresh cycles each report READY and ACK ACTIVATE exactly (dedupe + receipts)', async () => {
  const wListeners = new Set();
  const wCalls = [];
  const workspaceHost = {
    onDetachMessage: (cb) => { wListeners.add(cb); return () => wListeners.delete(cb); },
    detachStopAck: async (id) => wCalls.push(`stop-ack:${id}`),
    detachResumedAck: async (id) => wCalls.push(`resumed-ack:${id}`),
    detachOpen: async () => ({}),
    detachReattach: async () => {},
    detachFocus: async () => {},
    detachFlushAck: async () => {},
    emit: (t, d) => [...wListeners].map((cb) => cb(t, d)),
  };
  const wEvents = [];
  const workspace = createWindowLayoutDetachment({
    isDetached: false, host: workspaceHost,
    loadWorkspace: async () => { wEvents.push('load'); return {}; },
    installState: () => wEvents.push('install'),
    render: () => wEvents.push('render'),
    startController: () => wEvents.push('start'),
    stopController: async () => wEvents.push('stop'),
    cancelPick: () => {},
    flushSave: async () => wEvents.push('flush'),
    setReadOnly: (flag) => wEvents.push(`ro:${flag}`),
    setStatus: () => {},
  });

  async function runDetachedCycle(id) {
    const dListeners = new Set();
    const dCalls = [];
    const detachedHost = {
      onDetachMessage: (cb) => { dListeners.add(cb); return () => dListeners.delete(cb); },
      detachReady: async () => dCalls.push(`ready:${id}`),
      detachActivatedAck: async (tid) => dCalls.push(`activated-ack:${tid}`),
      detachFlushAck: async (tid) => dCalls.push(`flush-ack:${tid}`),
      detachOpen: async () => ({}),
      detachReattach: async () => {},
      detachFocus: async () => {},
      detachStopAck: async () => {},
      detachResumedAck: async () => {},
      emit: (t, d) => [...dListeners].map((cb) => cb(t, d)),
    };
    const dEvents = [];
    const detached = createWindowLayoutDetachment({
      isDetached: true, host: detachedHost,
      loadWorkspace: async () => { dEvents.push('load'); return {}; },
      installState: () => dEvents.push('install'),
      render: () => dEvents.push('render'),
      startController: () => dEvents.push('start'),
      stopController: async () => dEvents.push('stop'),
      cancelPick: () => {},
      flushSave: async () => dEvents.push('flush'),
      setReadOnly: (flag) => dEvents.push(`ro:${flag}`),
      setStatus: () => {},
    });
    await detached.reportReady();
    assert.ok(dCalls.includes(`ready:${id}`), `cycle ${id} READY`);
    let loadCount = 0;
    const gate = detached.waitForActivate().then(() => { loadCount += 1; });
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.ACTIVATE, { transferId: id }));
    // Duplicate resend -> second receipt, still one load/start.
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.ACTIVATE, { transferId: id }));
    await gate;
    assert.equal(loadCount, 1, `cycle ${id} load/start once`);
    assert.equal(dCalls.filter((call) => call === `activated-ack:${id}`).length, 2, `cycle ${id} two receipts`);
    assert.equal(detached.isDetachedActive(), true);
    await Promise.all(detachedHost.emit(DETACH_MESSAGE.FLUSH_REQUEST, { transferId: id }));
    assert.equal(detached.isDetachedActive(), false);
    assert.ok(dCalls.includes(`flush-ack:${id}`));
  }

  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await runDetachedCycle('t1');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.ok(wCalls.includes('resumed-ack:t1'));

  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't2' }));
  assert.ok(wCalls.includes('stop-ack:t2'));
  await runDetachedCycle('t2');
  await Promise.all(workspaceHost.emit(DETACH_MESSAGE.CLOSED, { transferId: 't2' }));
  assert.ok(wCalls.includes('resumed-ack:t2'));
  assert.equal(workspace.isReadOnly(), false);
  assert.equal(wEvents.filter((entry) => entry === 'start').length, 2, 'one controller start per resume');
});
test('018V5 the real persisted reattach state keeps the layout durable but out of the spatial graph', () => {
  const persisted = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    activeWindowLayoutId: 'window-layout-184d1175-fe46-45b6-9119-bad47fe4a517',
    windowLayouts: [{
      id: 'window-layout-184d1175-fe46-45b6-9119-bad47fe4a517',
      parentId: 'root', order: 0, name: 'Window layout', icon: null,
      arrangement: { version: 2, members: [
        { id: 'm1', descriptor: { version: 1, title: 'AYG-015R3-23028-8e5adb66', executableFingerprint: 'a'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm2', descriptor: { version: 1, title: 'AYG-015R3-63716-721eba85', executableFingerprint: 'b'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm3', descriptor: { version: 1, title: 'AYG-015R3-55128-967fa3fd', executableFingerprint: 'c'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm4', descriptor: { version: 1, title: 'AYG-015R3-62260-b0d19543', executableFingerprint: 'd'.repeat(64) }, bounds: null, state: 'normal' },
      ] },
    }],
    view: { currentGroupId: 'root', binMode: false },
  };
  const state = normalizeState(persisted);
  assert.equal(state.windowLayouts.length, 1, 'the layout survives normalize');
  assert.equal(state.activeWindowLayoutId, persisted.activeWindowLayoutId, 'active id survives normalize');
  const visible = visibleGraphItems(state, ROOT_ID, new Set(), false, 'bin', [], new Set());
  assert.ok(!visible.some((candidate) => candidate.id === persisted.windowLayouts[0].id),
    'the persisted widget does not resume as a physics-affected graph node');
});
test('018V7R decodeResumeState parses host-shaped strings, passes objects through, and lets malformed JSON throw', () => {
  assert.deepEqual(decodeResumeState(JSON.stringify({ a: 1 })), { a: 1 }, 'a host string is parsed');
  const objectShape = { windowLayouts: [] };
  assert.equal(decodeResumeState(objectShape), objectShape, 'object-shaped values pass through unchanged');
  assert.throws(() => decodeResumeState('not json'), 'malformed JSON throws for queue recovery');
});

test('018V7R a string-hosted CLOSED resume installs the full state (not empty)', async () => {
  const persisted = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    activeWindowLayoutId: 'window-layout-9d28c1b1-8316-4c01-a2ac-90fe987f1d29',
    windowLayouts: [{
      id: 'window-layout-9d28c1b1-8316-4c01-a2ac-90fe987f1d29',
      parentId: 'root', order: 0, name: 'Window layout', icon: null,
      arrangement: { version: 2, members: [
        { id: 'm1', descriptor: { version: 1, title: 'AYG-015R3-50668-af27d60e', executableFingerprint: 'a'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm2', descriptor: { version: 1, title: 'AYG-015R3-62880-65cc1f40', executableFingerprint: 'b'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm3', descriptor: { version: 1, title: 'AYG-015R3-408-164b8b84', executableFingerprint: 'c'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm4', descriptor: { version: 1, title: 'AYG-015R3-4008-5c8c5ee8', executableFingerprint: 'd'.repeat(64) }, bounds: null, state: 'normal' },
      ] },
    }],
    view: { currentGroupId: 'root', binMode: false },
  };
  const hostJson = JSON.stringify(persisted);
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: () => Promise.resolve(),
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const h = makeDetachment({
    isDetached: false,
    overrides: {
      // The real bridge returns SERIALIZED JSON state.
      loadWorkspace: async () => hostJson,
      // The production resume adapter decodes before install/restore/render.
      installState: (next) => {
        state = store.install(decodeResumeState(next));
      },
    },
  });
  await Promise.all(h.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await Promise.all(h.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.equal(state.windowLayouts.length, 1, 'the string-hosted resume installs the one layout (not empty)');
  assert.equal(state.windowLayouts[0].arrangement.members.length, 4, 'four members are installed');
  assert.equal(state.activeWindowLayoutId, persisted.activeWindowLayoutId, 'the exact active layout id is installed');
  assert.equal(state.view.currentGroupId, 'root');
  assert.equal(h.events.filter((entry) => entry === 'start').length, 1, 'controller starts once');
  assert.equal(h.calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'the resumed ACK is sent');
  assert.equal(h.detachment.isReadOnly(), false);
});
test('018V7R2 resume order is load->install->read-only render->start->unlock->writable render->ACK with a control-bearing final view', async () => {
  const persisted = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    activeWindowLayoutId: 'window-layout-9d28c1b1-8316-4c01-a2ac-90fe987f1d29',
    windowLayouts: [{
      id: 'window-layout-9d28c1b1-8316-4c01-a2ac-90fe987f1d29',
      parentId: 'root', order: 0, name: 'Window layout', icon: null,
      arrangement: { version: 2, members: [
        { id: 'm1', descriptor: { version: 1, title: 'AYG-015R3-50668-af27d60e', executableFingerprint: 'a'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm2', descriptor: { version: 1, title: 'AYG-015R3-62880-65cc1f40', executableFingerprint: 'b'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm3', descriptor: { version: 1, title: 'AYG-015R3-408-164b8b84', executableFingerprint: 'c'.repeat(64) }, bounds: null, state: 'normal' },
        { id: 'm4', descriptor: { version: 1, title: 'AYG-015R3-4008-5c8c5ee8', executableFingerprint: 'd'.repeat(64) }, bounds: null, state: 'normal' },
      ] },
    }],
    view: { currentGroupId: 'root', binMode: false },
  };
  const hostJson = JSON.stringify(persisted);
  let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: () => Promise.resolve(),
    setStatus: () => {},
    initialSession: { currentId: ROOT_ID },
  });
  const order = [];
  const h = makeDetachment({
    isDetached: false,
    overrides: {
      loadWorkspace: async () => hostJson,
      installState: (next) => { state = store.install(decodeResumeState(next)); },
      render: () => order.push(`render:ro:${h.detachment.isReadOnly()}`),
      setReadOnly: (flag) => order.push(`ro:${flag}`),
      startController: async () => order.push('start'),
    },
  });
  await Promise.all(h.host.emit(DETACH_MESSAGE.STOP_REQUEST, { transferId: 't1' }));
  await Promise.all(h.host.emit(DETACH_MESSAGE.CLOSED, { transferId: 't1' }));
  assert.equal(state.windowLayouts.length, 1, 'string-hosted state installed (not empty)');
  assert.equal(state.windowLayouts[0].arrangement.members.length, 4);
  const roTrue = order.indexOf('ro:true');
  const firstRender = order.findIndex((entry) => entry.startsWith('render'));
  const start = order.indexOf('start');
  const unlock = order.indexOf('ro:false');
  const lastRender = order.findLastIndex((entry) => entry.startsWith('render'));
  assert.ok(roTrue < firstRender, 'read-only entered before the pre-start render');
  assert.equal(order[firstRender], 'render:ro:true', 'the pre-start render is the inert read-only view');
  assert.ok(firstRender < start, 'the pre-start render precedes the controller start');
  assert.ok(start < unlock, 'the controller starts before the unlock (X2)');
  assert.ok(unlock < lastRender, 'a writable render follows the unlock');
  assert.equal(order[lastRender], 'render:ro:false', 'the final render is the control-bearing writable view');
  assert.equal(h.calls.filter((call) => call === 'resumed-ack:t1').length, 1, 'the RESUMED ACK follows the writable render');
  assert.equal(h.detachment.isReadOnly(), false);
});
test('018V7R3 window-layout content signature is mode-aware (readonly->workspace rebuilds, workspace->workspace does not)', () => {
  const candidate = { kind: 'window-layout', arrangement: { version: 2, members: [
    { id: 'm1', state: 'normal' },
    { id: 'm2', state: 'minimized' },
  ] } };
  const readonly = windowLayoutContentSignature(candidate, 'readonly');
  const workspace = windowLayoutContentSignature(candidate, 'workspace');
  const workspaceAgain = windowLayoutContentSignature(candidate, 'workspace');
  assert.notEqual(readonly, workspace, 'readonly->workspace invalidates the cached inert HTML');
  assert.equal(workspace, workspaceAgain, 'workspace->workspace does not rebuild');
  assert.ok(workspace.includes('workspace|2|m1:normal,m2:minimized'), 'the signature carries mode + arrangement');
  assert.ok(readonly.includes('readonly|'), 'the read-only signature is distinct');
});

test('018V7R3 windowLayoutPresentationMode is the single bounded source (readonly/detached/workspace)', () => {
  assert.equal(windowLayoutPresentationMode({ isReadOnly: true, mode: 'workspace' }), 'readonly', 'read-only wins over detached/workspace');
  assert.equal(windowLayoutPresentationMode({ isReadOnly: false, mode: 'detached' }), 'detached');
  assert.equal(windowLayoutPresentationMode({ isReadOnly: false, mode: 'workspace' }), 'workspace');
});
