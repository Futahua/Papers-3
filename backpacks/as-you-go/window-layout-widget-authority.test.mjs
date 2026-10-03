// Creator eye test, detached widget, after the flicker fix: clicking a member
// icon "reacts visually but the window doesn't respond", while minimize-all and
// restore-all work correctly. The creator also reported that this began when
// the multiple-tab feature landed - and the live topology confirms the project
// is open in TWO workspace surfaces at once.
//
// Every workspace surface constructs its own channel responder with a PRIVATE
// revision map starting at 0, so responder A's bump cannot make responder B
// stale: both pass their own baseRevision check and both execute the command.
// `member-toggle` reads the window's LIVE state and inverts it, so a duplicate
// execution minimizes and then restores - net nothing. Absolute group actions
// are idempotent under duplication, which is exactly why they still worked.
//
// The fix elects one authority (the existing document WRITER). These tests pin
// that exactly one responder acts, and that authority survives a handover.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWindowLayoutWidgetChannelWorkspace,
  createWindowLayoutWidgetChannelClient,
} from './public/app/window-layout-widget-channel.js';

function fakeBus() {
  const listeners = new Map();
  let next = 1;
  return {
    makeChannel() {
      const id = next++;
      const set = new Set();
      listeners.set(id, set);
      return {
        postMessage(message) {
          for (const [otherId, other] of listeners) {
            if (otherId === id) continue;
            for (const fn of other) fn({ data: structuredClone(message) });
          }
        },
        addEventListener(type, fn) { if (type === 'message') set.add(fn); },
        removeEventListener(type, fn) { if (type === 'message') set.delete(fn); },
        close() { listeners.delete(id); set.clear(); },
      };
    },
  };
}

function fingerprint(seed) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < String(seed).length; i += 1) {
    hash ^= String(seed).charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(64, '0');
}

const LAYOUT = {
  id: 'layout-1',
  name: 'layout-1',
  arrangement: {
    members: [{
      id: 'm1',
      descriptor: { version: 1, title: 'Alpha', executableFingerprint: fingerprint('Alpha') },
      state: 'normal',
    }],
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Two ordinary workspace surfaces plus one detached widget, exactly as the
 * creator is running it. `authority` decides which surfaces answer. */
function twoSurfaces({ authority }) {
  const bus = fakeBus();
  const applied = [];
  const responders = ['A', 'B'].map((label) => createWindowLayoutWidgetChannelWorkspace({
    channel: bus.makeChannel(),
    getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
    applyCommand: async (layoutId, command) => {
      applied.push({ surface: label, kind: command.kind });
      return { ok: true };
    },
    isAuthoritative: () => authority(label),
  }));
  const client = createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: () => {},
  });
  return { responders, client, applied };
}

test('a member-toggle is executed exactly once when one surface is authoritative', async () => {
  const { client, applied } = twoSurfaces({ authority: (label) => label === 'A' });
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await settle();
  assert.deepEqual(applied, [{ surface: 'A', kind: 'member-toggle' }]);
});

test('without an authority gate BOTH surfaces execute the toggle - the defect itself', async () => {
  // This is the creator-visible bug reproduced: two executions of a live-state
  // toggle minimize and then restore, so the window never appears to move.
  const { client, applied } = twoSurfaces({ authority: () => true });
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await settle();
  assert.equal(applied.length, 2, 'both responders applied the same toggle');
});

test('a non-authoritative surface answers no snapshot request, so revisions cannot compete', async () => {
  const bus = fakeBus();
  const seen = [];
  for (const label of ['A', 'B']) {
    createWindowLayoutWidgetChannelWorkspace({
      channel: bus.makeChannel(),
      getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
      isAuthoritative: () => label === 'A',
    });
  }
  const client = createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: (message) => seen.push(message),
  });
  client.requestSnapshot();
  await settle();
  const snapshots = seen.filter((message) => message.type === 'snapshot');
  assert.equal(snapshots.length, 1, 'exactly one authoritative snapshot answered the request');
});

test('authority is re-read per message, so a handover takes effect without reconnecting', async () => {
  const bus = fakeBus();
  const applied = [];
  let writer = 'A';
  for (const label of ['A', 'B']) {
    createWindowLayoutWidgetChannelWorkspace({
      channel: bus.makeChannel(),
      getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
      applyCommand: async (layoutId, command) => {
        applied.push({ surface: label, kind: command.kind });
        return { ok: true };
      },
      isAuthoritative: () => writer === label,
    });
  }
  const client = createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: () => {},
  });

  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await settle();
  assert.deepEqual(applied.map((entry) => entry.surface), ['A']);

  // The writer surface dies; the Web Lock is reclaimed by B. B's listener was
  // already installed, so it simply begins answering - but its PRIVATE revision
  // map never saw A's bumps, so the widget's next command is behind B's counter
  // and is honestly refused as stale rather than applied against a base B never
  // issued. The stale reply carries a fresh snapshot, the widget resyncs, and
  // the command after that lands on B.
  //
  // One command is therefore dropped per handover. That is a real limitation of
  // per-responder revision counters, recorded here rather than hidden: closing
  // it properly needs either durable revision authority or correlated
  // ACK/retry with de-duplication that survives the handover (a plain retry
  // would UNDO a toggle the dead writer had already applied).
  writer = 'B';
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await settle();
  assert.deepEqual(applied.map((entry) => entry.surface), ['A'], 'first post-handover command is refused as stale');

  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await settle();
  assert.deepEqual(applied.map((entry) => entry.surface), ['A', 'B'], 'after resync the new writer applies');
});

test('widget open/close presence reaches EVERY surface, not just the authority', async () => {
  // The attached card is greyed to a placeholder while the widget is the sole
  // live card, and that flag is per-surface in-memory state. Gating it would
  // leave a non-writer tab showing a live card for a layout whose widget is
  // open, and would strand that flag if the surface were demoted in between.
  const bus = fakeBus();
  const presence = { A: [], B: [] };
  for (const label of ['A', 'B']) {
    createWindowLayoutWidgetChannelWorkspace({
      channel: bus.makeChannel(),
      getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
      onWidgetOpen: (id) => presence[label].push(`open:${id}`),
      onWidgetDispose: (id) => presence[label].push(`close:${id}`),
      isAuthoritative: () => label === 'A',
    });
  }
  const client = createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: () => {},
  });
  client.ready();
  await settle();
  client.dispose();
  await settle();
  assert.deepEqual(presence.A, [`open:${LAYOUT.id}`, `close:${LAYOUT.id}`]);
  assert.deepEqual(presence.B, [`open:${LAYOUT.id}`, `close:${LAYOUT.id}`], 'the non-writer tracked presence too');
});

test('only the authority hydrates icons and persists card size', async () => {
  const bus = fakeBus();
  const hydrated = [];
  const sized = [];
  for (const label of ['A', 'B']) {
    createWindowLayoutWidgetChannelWorkspace({
      channel: bus.makeChannel(),
      getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
      onAuthoritativeWidgetOpen: (id) => hydrated.push(`${label}:${id}`),
      onCardSize: (id, width, height) => sized.push(`${label}:${width}x${height}`),
      isAuthoritative: () => label === 'A',
    });
  }
  const client = createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: () => {},
  });
  client.ready();
  client.sendCardSize(200, 120);
  await settle();
  assert.deepEqual(hydrated, [`A:${LAYOUT.id}`], 'the writer hydrates its own icons; a view does not publish');
  assert.deepEqual(sized, ['A:200x120'], 'card size is a durable write, so writer only');
});

test('a widget is told when coordination leaves nobody authoritative', async () => {
  // Fail closed is right - inventing a fallback authority would recreate the
  // plural-execution bug - but failing SILENTLY leaves the widget blank forever,
  // because its retry only arms on an explicit unknown-layout, never on silence.
  const bus = fakeBus();
  const seen = [];
  const responder = createWindowLayoutWidgetChannelWorkspace({
    channel: bus.makeChannel(),
    getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
    isAuthoritative: () => false,
  });
  createWindowLayoutWidgetChannelClient({
    channel: bus.makeChannel(),
    layoutId: LAYOUT.id,
    onMessage: (message) => seen.push(message),
  });
  responder.announceUnavailable(LAYOUT.id, 'Workspace coordination unavailable');
  await settle();
  const errors = seen.filter((message) => message.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'coordination-unavailable');
  assert.notEqual(errors[0].code, 'unknown-layout', 'must not arm the cold-open retry loop');
});

test('a non-authoritative surface neither bumps a revision nor broadcasts', () => {
  const bus = fakeBus();
  const heard = [];
  const listener = bus.makeChannel();
  listener.addEventListener('message', (event) => heard.push(event.data));
  const responder = createWindowLayoutWidgetChannelWorkspace({
    channel: bus.makeChannel(),
    getLayout: (id) => (id === LAYOUT.id ? LAYOUT : null),
    isAuthoritative: () => false,
  });
  const before = responder.revisionOf(LAYOUT.id);
  responder.noteCommitted(LAYOUT.id);
  responder.broadcast(LAYOUT.id);
  assert.equal(responder.revisionOf(LAYOUT.id), before, 'revision unchanged');
  assert.deepEqual(heard, [], 'nothing was posted');
});
