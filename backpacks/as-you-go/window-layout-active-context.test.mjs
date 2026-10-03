// Creator eye test, detached widget: "It reacts visually but the window doesn't
// respond", while minimize-all and restore-all work - and it survived exiting
// the backpack, re-entering, and building a brand new layout.
//
// The individual member click gated on the DURABLE state.activeWindowLayoutId,
// while ensureRecording() decided from the recording controller's own live
// activeLayoutId. Those answer different questions and can disagree:
// activeWindowLayoutId is shared top-level document state, so installing a peer
// surface's document overwrites it - including on the elected writer accepting
// a forwarded mutation - while the runtime's activeLayoutId is a closure
// variable no document install can reach. Hence the multi-tab correlation.
//
// Once diverged the click deadlocked: durable said "not current" so it called
// ensureRecording and returned; ensureRecording asked the runtime, which said
// "already current", so it only reconciled - and reconcile deliberately never
// writes state. Nothing changed, so every later click repeated it, for ever,
// silently, never reaching a capability call. Group actions never consult this
// gate, which is why they kept working while every icon looked dead.
//
// These tests pin the rule that broke it: the SAME source of truth must answer
// the click gate and ensureRecording, so the two-step interaction always
// advances instead of looping.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutRecordingWiring } from './public/app/window-layout-runtime.js';

function fingerprint(seed) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < String(seed).length; i += 1) {
    hash ^= String(seed).charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(64, '0');
}

function makeLayout(id) {
  return {
    id,
    name: id,
    arrangement: {
      version: 2,
      members: [{
        id: `${id}-m1`,
        descriptor: { version: 1, title: `${id} window`, executableFingerprint: fingerprint(id) },
        state: 'normal',
        bounds: { x: 0, y: 0, width: 400, height: 300 },
      }],
    },
  };
}

/** A recording wiring over two layouts, with a durable state object the test
 * can corrupt exactly the way a peer document install does. */
function harness() {
  const layouts = { A: makeLayout('A'), B: makeLayout('B') };
  let state = { windowLayouts: [layouts.A, layouts.B], activeWindowLayoutId: null };
  const capability = { version: 1, bindingId: 'binding-1' };
  const wiring = createWindowLayoutRecordingWiring({
    getLayout: (id) => state.windowLayouts.find((layout) => layout.id === id) ?? null,
    host: {
      resolveWindowDescriptor: async () => ({ outcome: 'success', capability }),
      observeWindowCapability: async () => ({
        outcome: 'success',
        observation: { state: 'normal', bounds: { x: 0, y: 0, width: 400, height: 300 } },
      }),
      applyWindowCapability: async () => ({ outcome: 'success' }),
      minimizeWindowCapability: async () => ({ outcome: 'success' }),
      restoreWindowCapability: async () => ({ outcome: 'success' }),
    },
    model: {
      setActiveWindowLayoutId: (current, id) => ({ ...current, activeWindowLayoutId: id }),
      updateWindowLayoutMember: (current) => current,
    },
    getState: () => state,
    replaceState: (next) => { state = next; },
    scheduleSave: () => {},
    setStatus: () => {},
    patchMember: () => {},
    statusText: () => 'Failed',
    onRetireMember: () => {},
    setIntervalFn: () => null,
    clearIntervalFn: () => {},
    cadenceMs: 100000,
  });
  return {
    wiring,
    get durableActive() { return state.activeWindowLayoutId; },
    /** Exactly what installPeerDocument() does: replace the shared document,
     * including activeWindowLayoutId, without touching the runtime. */
    installPeerDocument(activeWindowLayoutId) {
      state = { ...state, activeWindowLayoutId };
    },
    runtimeActive: () => wiring.runtime.getSnapshot().activeLayoutId,
  };
}

/** The gate as it now stands: the runtime is asked, not the document. */
const isActiveRecordingContext = (h, layoutId) => h.runtimeActive() === layoutId;

test('a switch leaves durable and runtime agreeing', async () => {
  const h = harness();
  await h.wiring.ensureRecording('A');
  assert.equal(h.runtimeActive(), 'A');
  assert.equal(h.durableActive, 'A');
});

test('installing a peer document diverges the two sources - the trigger', async () => {
  const h = harness();
  await h.wiring.ensureRecording('A');
  h.installPeerDocument('B');
  assert.equal(h.durableActive, 'B', 'the shared document now names another layout');
  assert.equal(h.runtimeActive(), 'A', 'the controller is still driving the old one');
});

test('reconcileActive never repairs the durable id, so a durable gate cannot self-heal', async () => {
  // This is why the old gate deadlocked rather than costing one wasted click.
  const h = harness();
  await h.wiring.ensureRecording('A');
  h.installPeerDocument('B');
  for (let click = 0; click < 5; click += 1) {
    if (h.durableActive !== 'A') await h.wiring.ensureRecording('A');
  }
  assert.equal(h.durableActive, 'B', 'still wrong after five clicks - it never converges');
});

test('the runtime gate lets a click through immediately once diverged', async () => {
  const h = harness();
  await h.wiring.ensureRecording('A');
  h.installPeerDocument('B');
  // Durable says B, runtime says A, the creator clicks a member of A.
  assert.equal(isActiveRecordingContext(h, 'A'), true, 'the click proceeds to toggle instead of returning');
});

test('the two-step contract is preserved: a genuinely different layout still selects first', async () => {
  const h = harness();
  await h.wiring.ensureRecording('A');
  // A click on B: the runtime really is driving A, so this must NOT toggle.
  assert.equal(isActiveRecordingContext(h, 'B'), false);
  await h.wiring.ensureRecording('B');
  assert.equal(isActiveRecordingContext(h, 'B'), true, 'the second click toggles');
  assert.equal(h.durableActive, 'B');
});

test('the click never sticks: after at most one selecting click the next one acts', async () => {
  // The invariant that fails on the old gate and holds on the new one, stated
  // without reference to either implementation.
  for (const durable of [null, 'A', 'B']) {
    const h = harness();
    await h.wiring.ensureRecording('A');
    h.installPeerDocument(durable);
    let clicks = 0;
    while (!isActiveRecordingContext(h, 'A') && clicks < 3) {
      await h.wiring.ensureRecording('A');
      clicks += 1;
    }
    assert.ok(isActiveRecordingContext(h, 'A'), `stuck with durable=${durable}`);
    assert.ok(clicks <= 1, `took ${clicks} selecting clicks with durable=${durable}`);
  }
});
