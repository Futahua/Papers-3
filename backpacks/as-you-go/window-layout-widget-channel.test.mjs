// 019C (RoketPuncha sole-editor lane): deterministic tests for the AYG-owned
// same-origin compact-widget channel. The workspace is the SOLE durable writer
// and revision source; the widget only sends READY and bounded command intents
// and never exposes any store/save/commit/replace surface. A fake
// BroadcastChannel-like bus (no self-delivery) drives both sides.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  WINDOW_LAYOUT_WIDGET_CHANNEL,
  createWindowLayoutWidgetChannelWorkspace,
  createWindowLayoutWidgetChannelClient,
  windowLayoutWidgetSnapshot,
  windowLayoutWidgetParseCommand,
  createBoundedRetry,
} from './public/app/window-layout-widget-channel.js';

test('entry wiring opens widgets only after durable layout persistence and self-closes exhausted orphans', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /commit\(next, \{ requireDurable: true \}\)/);
  assert.match(source, /store\.replace\(deleteWindowLayout\(state, createdLayout\.id\)\)/);
  assert.match(source, /host\.widgetCloseSelf\(\)/);
  assert.match(source, /message\.type === 'committed' && message\.deleted === true/);
  assert.match(source, /message\.code === 'unknown-layout'[\s\S]*widgetState\.snapshotReceived[\s\S]*host\.widgetCloseSelf\(\)/);
});

function fakeBus() {
  const listeners = new Map();
  let next = 1;
  function makeChannel() {
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
  }
  return { makeChannel };
}

// Deterministic 64-hex fingerprint so makeLayout builds a valid persisted
// descriptor shape (Papers direct-pick begin identity).
function fingerprint(seed) {
  let hash = 2166136261 >>> 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(64, '0');
}

function makeLayout(id, members) {
  return {
    id,
    name: id,
    arrangement: { members: members.map((member) => ({
      id: member.id,
      descriptor: { version: 1, title: member.title, executableFingerprint: fingerprint(member.title) },
      state: member.state ?? 'normal',
    })) },
  };
}

function makeBus(layouts, applyCommand) {
  const bus = fakeBus();
  const workspaceChannel = bus.makeChannel();
  const clientChannel = bus.makeChannel();
  const applied = [];
  const workspace = createWindowLayoutWidgetChannelWorkspace({
    channel: workspaceChannel,
    getLayout: (layoutId) => layouts.find((layout) => layout.id === layoutId) ?? null,
    snapshot: windowLayoutWidgetSnapshot,
    applyCommand: async (layoutId, command) => {
      applied.push({ layoutId, command });
      if (applyCommand) return applyCommand(layoutId, command);
      return { ok: true };
    },
  });
  return { bus, workspace, clientChannel, applied };
}

test('widget-ready is answered with the current snapshot and revision', () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'snapshot');
  assert.equal(received[0].revision, 0);
  assert.deepEqual(received[0].snapshot, {
    id: 'L1',
    name: 'L1',
    tracking: { enabled: false },
    members: [{ id: 'm1', descriptor: { version: 1, title: 'Notepad', executableFingerprint: fingerprint('Notepad') }, state: 'normal', icon: null }],
    cardSize: null,
  });
  workspace.close();
  client.close();
});

test('snapshot-request is answered; unknown layouts get a typed error', () => {
  const layouts = [makeLayout('L1', [])];
  const { workspace, clientChannel } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.requestSnapshot();
  assert.equal(received[0].type, 'snapshot');
  const missing = [];
  const missingClient = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'GHOST', onMessage: (message) => missing.push(message) });
  missingClient.ready();
  assert.equal(missing[0].type, 'error');
  assert.equal(missing[0].code, 'unknown-layout');
  workspace.close();
  client.close();
  missingClient.close();
});

test('snapshot keeps mixed member states independent and does not underline unknown state', () => {
  const layout = makeLayout('L1', [
    { id: 'open', title: 'Open', state: 'normal' },
    { id: 'min', title: 'Minimized', state: 'minimized' },
    { id: 'unknown', title: 'Unknown', state: 'missing' },
  ]);
  const snapshot = windowLayoutWidgetSnapshot(layout);
  assert.deepEqual(snapshot.members.map((member) => member.state), ['normal', 'minimized', 'minimized']);
});

/* A pick that refused is still a COMMITTED command - the layout is unchanged or partly changed and nothing
 * failed - so the widget must not be told it was an error. What it lacked was the sentence: the workspace
 * computes it (windowLayoutPickApplyOutcome) and the detached widget never saw it, so a refusal was silent
 * there. The sentence now rides the committed response as an optional bounded status. */
test('a pick whose removals were all refused stays committed and carries the sentence', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const sentence = 'That window has changed since the pick — nothing was removed';
  const { workspace, clientChannel } = makeBus(layouts, () => ({ ok: true, status: sentence }));
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message),
  });
  client.ready();
  client.requestSnapshot();
  client.sendCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [] } });
  await new Promise((resolve) => setImmediate(resolve));
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed, 'a refusal is a committed command, not an error');
  assert.equal(committed.status, sentence, 'and it says what happened');
  assert.equal(received.some((message) => message.type === 'error'), false, 'nothing is reported as a failure');
  // The card renders exactly as before: same message type, snapshot and revision. The snapshot is in fact
  // BYTE-IDENTICAL to the one this client already rendered, because a refusal changed nothing - which is the
  // whole point: no repaint can carry this news, so the status field is the only thing that can speak.
  const initial = received.find((message) => message.type === 'snapshot');
  assert.equal(JSON.stringify(committed.snapshot), JSON.stringify(initial.snapshot));
  assert.equal(committed.snapshot.members.length, 1);
  assert.equal(committed.revision, 1);
  workspace.close();
  client.close();
});

test('a mixed result carries the sentence too, and is still committed', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts, () => ({ ok: true, status: 'Removed 1 — 1 could not be matched' }));
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message),
  });
  client.ready();
  client.sendCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [] } });
  await new Promise((resolve) => setImmediate(resolve));
  const committed = received.find((message) => message.type === 'committed');
  assert.equal(committed.status, 'Removed 1 — 1 could not be matched');
  assert.equal(received.some((message) => message.type === 'error'), false);
  workspace.close();
  client.close();
});

test('an ordinary command, and an unusable or oversized status, put nothing on the wire', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  for (const [label, result, expected] of [
    ['no status at all', { ok: true }, undefined],
    ['an empty status', { ok: true, status: '   ' }, undefined],
    ['a status that is not a string', { ok: true, status: 42 }, undefined],
  ]) {
    const { workspace, clientChannel } = makeBus(layouts, () => result);
    const received = [];
    const client = createWindowLayoutWidgetChannelClient({
      channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message),
    });
    client.ready();
    client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
    await new Promise((resolve) => setImmediate(resolve));
    const committed = received.find((message) => message.type === 'committed');
    assert.equal(committed.status, expected, label);
    workspace.close();
    client.close();
  }
  // Bounded like every other value on this channel: a status is a sentence, not a payload.
  const long = 'x'.repeat(4000);
  const { workspace, clientChannel } = makeBus(layouts, () => ({ ok: true, status: long }));
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message),
  });
  client.ready();
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed.status.length <= 160, `bounded (got ${committed.status.length})`);
  workspace.close();
  client.close();
});
test('command with a matching baseRevision applies once and posts committed', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const order = [];
  const { workspace, clientChannel, applied } = makeBus(layouts, (layoutId, command) => {
    order.push(`apply:${command.kind}`);
    return { ok: true };
  });
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => { received.push(message); order.push(`msg:${message.type}`); } });
  client.ready(); // revision -> 0
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0].command, { kind: 'member-toggle', memberId: 'm1' });
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed, 'expected a committed response');
  assert.equal(committed.revision, 1, 'revision must bump once after the apply');
  assert.equal(committed.snapshot.members.length, 1);
  const applyIndex = order.indexOf('apply:member-toggle');
  const commitIndex = order.indexOf('msg:committed');
  assert.ok(applyIndex >= 0 && commitIndex > applyIndex, 'committed must be posted AFTER the apply');
  workspace.close();
  client.close();
});

test('a stale baseRevision rejects the command and re-syncs instead of applying', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel, applied } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  // The workspace committed while the widget was away: bump to revision 3.
  workspace.noteCommitted('L1');
  workspace.noteCommitted('L1');
  workspace.noteCommitted('L1');
  client.ready(); // widget learns the latest revision via the broadcast snapshot
  assert.equal(received.at(-1).revision, 3);
  assert.equal(client.revision, 3);
  // A command acting on an OLDER snapshot (baseRevision 0) is stale: never
  // applied, answered with a re-sync snapshot.
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' }, { baseRevision: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 0, 'a stale command must never be applied');
  const stale = received.find((message) => message.type === 'stale');
  assert.ok(stale, 'expected a stale re-sync response');
  assert.equal(stale.revision, 3);
  assert.equal(client.revision, 3);
  workspace.close();
  client.close();
});

test('applyCommand failure posts a typed apply-failed error without bumping', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts, async () => ({ ok: false, error: 'read-only' }));
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  const error = received.find((message) => message.type === 'error');
  assert.ok(error, 'expected an error response');
  assert.equal(error.code, 'apply-failed');
  assert.equal(error.message, 'read-only');
  assert.equal(workspace.revisionOf('L1'), 0, 'a failed apply must not bump the revision');
  workspace.close();
  client.close();
});

test('noteCommitted broadcasts a fresh snapshot and bumps the revision', () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  assert.equal(received[0].revision, 0);
  workspace.noteCommitted('L1');
  assert.equal(received.length, 2, 'the broadcast snapshot must reach the widget');
  assert.equal(received[1].type, 'snapshot');
  assert.equal(received[1].revision, 1);
  assert.equal(workspace.revisionOf('L1'), 1);
  workspace.close();
  client.close();
});

test('malformed and foreign messages are ignored without a response', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel, applied } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  const invalid = [
    { type: 'command', layoutId: 'L1', clientId: 'c', commandId: 'x', baseRevision: 0, command: { kind: 'bogus' } },
    { type: 'command', layoutId: 'L1', clientId: 'c', commandId: 'x', baseRevision: 0, command: { kind: 'group-action', action: 'destroy-all', memberIds: [] } },
    { type: 'command', layoutId: 'L1', clientId: 'c', commandId: 'x', baseRevision: 0, command: { kind: 'range-toggle', memberId: 'm1', memberIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20', 'm21', 'm22', 'm23', 'm24', 'm25', 'm26', 'm27', 'm28', 'm29', 'm30', 'm31', 'm32', 'm33', 'm34', 'm35', 'm36', 'm37', 'm38', 'm39', 'm40', 'm41', 'm42', 'm43', 'm44', 'm45', 'm46', 'm47', 'm48', 'm49', 'm50', 'm51', 'm52', 'm53', 'm54', 'm55', 'm56', 'm57', 'm58', 'm59', 'm60', 'm61', 'm62', 'm63', 'm64', 'm65'] } },
    { type: 'widget-ready', layoutId: 'L1', clientId: '' },
    { type: 'command', layoutId: 'L1', clientId: 'c', commandId: 'x', baseRevision: '0', command: { kind: 'member-toggle', memberId: 'm1' } },
    { not: 'a message' },
  ];
  for (const message of invalid) clientChannel.postMessage(message);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 0, 'malformed commands must never reach the writer');
  assert.equal(received.length, 0, 'malformed messages must not be answered');
  workspace.close();
  client.close();
});

test('the widget client exposes NO store/save/commit/recording surface', () => {
  const layouts = [makeLayout('L1', [])];
  const { workspace, clientChannel } = makeBus(layouts);
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  for (const forbidden of ['saveWorkspace', 'commit', 'replace', 'install', 'undo', 'redo', 'persist']) {
    assert.equal(client[forbidden], undefined, `the widget client must not expose ${forbidden}`);
  }
  assert.deepEqual(
    Object.keys(client).sort(),
    // 035: the client also reports its live window content size and its close,
    // still without any store/save/commit surface. Its bounded hover-policy request is intent-only.
    ['close', 'dispose', 'ready', 'requestHoverPolicy', 'requestSnapshot', 'revision', 'sendCardSize', 'sendCommand', 'sendCommandAndWait'].sort(),
  );
  workspace.close();
  client.close();
});

test('sendCommandAndWait serializes picker-style commands behind their acknowledgement', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel, applied } = makeBus(layouts);
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  const acknowledgement = await client.sendCommandAndWait({ kind: 'member-toggle', memberId: 'm1' });
  assert.equal(acknowledgement.type, 'committed');
  assert.equal(applied.length, 1);
  client.close();
  workspace.close();
});

test('sendCommandAndWait permits the explicit 30s picker acknowledgement budget without changing the default', async () => {
  const bus = fakeBus();
  const clientChannel = bus.makeChannel();
  const peer = bus.makeChannel();
  const armed = [];
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel,
    layoutId: 'L1',
    setTimer: (_fn, ms) => { armed.push(ms); return armed.length; },
    clearTimer: () => undefined,
  });
  const pending = client.sendCommandAndWait(
    { kind: 'member-toggle', memberId: 'm1' },
    { timeoutMs: 30000 },
  );
  assert.equal(armed[0], 30000, 'explicit picker waits are not truncated to the old 10s ceiling');
  client.close();
  assert.equal((await pending).code, 'closed');

  const defaultClientChannel = bus.makeChannel();
  const defaultArmed = [];
  const defaultClient = createWindowLayoutWidgetChannelClient({
    channel: defaultClientChannel,
    layoutId: 'L1',
    setTimer: (_fn, ms) => { defaultArmed.push(ms); return defaultArmed.length; },
    clearTimer: () => undefined,
  });
  const defaultPending = defaultClient.sendCommandAndWait({ kind: 'member-toggle', memberId: 'm1' });
  assert.equal(defaultArmed[0], 3000, 'ordinary command acknowledgement budget remains unchanged');
  defaultClient.close();
  assert.equal((await defaultPending).code, 'closed');
  peer.close();
});

test('the channel workspace never flips the workspace read-only (stays writable)', async () => {
  const layouts = [makeLayout('L1', [])];
  const { workspace, clientChannel } = makeBus(layouts);
  for (const forbidden of ['setReadOnly', 'setReadOnlyFor', 'readOnly']) {
    assert.equal(workspace[forbidden], undefined, `the widget channel must not expose ${forbidden}`);
  }
  // A widget command applies through the injected writer with no read-only
  // side effect: the workspace remains writable while the widget is open.
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(received.some((message) => message.type === 'committed'), 'the command applied; the workspace never went read-only');
  workspace.close();
  client.close();
});

test('the client rejects invalid commands before sending', () => {
  const layouts = [makeLayout('L1', [])];
  const { workspace, clientChannel, applied } = makeBus(layouts);
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  assert.equal(client.sendCommand({ kind: 'bogus' }), null);
  assert.equal(client.sendCommand({ kind: 'group-action', action: 'explode', memberIds: [] }), null);
  assert.equal(applied.length, 0);
  assert.equal(client.sendCommand({ kind: 'member-toggle', memberId: 'm1' }).length > 0, true);
  workspace.close();
  client.close();
});

test('windowLayoutWidgetParseCommand bounds the exact vocabulary', () => {
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'member-toggle', memberId: 'm1' }), { kind: 'member-toggle', memberId: 'm1' });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'toggle-tracking' }), { kind: 'toggle-tracking' });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'dock-widget-to-pill' }), { kind: 'dock-widget-to-pill' });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'delete-layout' }), { kind: 'delete-layout' });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'clear-layout' }), { kind: 'clear-layout' });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'clear-layout', extra: true }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'delete-layout', extra: true }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'toggle-tracking', extra: true }), null);
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'isolate', memberIds: ['m1'] }), { kind: 'group-action', action: 'isolate', memberIds: ['m1'] });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'minimize', memberIds: [] }), { kind: 'group-action', action: 'minimize', memberIds: [] });
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'cancelled' } }), { kind: 'picker-commit', pick: { outcome: 'cancelled' } });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'member-toggle' }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'member-toggle', memberId: 'x'.repeat(513) }), null);
  // 040: the widget's `Remove from this layout` context action.
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'remove-member', memberId: 'm1' }), { kind: 'remove-member', memberId: 'm1' });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'remove-member' }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'remove-member', memberId: 'x'.repeat(513) }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'remove-member', memberId: 'm1', extra: true }), null);
  const closedDescriptor = { version: 1, title: 'Shared', executableFingerprint: 'a'.repeat(64) };
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'retire-closed-window', descriptor: closedDescriptor }), {
    kind: 'retire-closed-window', descriptor: closedDescriptor,
  });
  const exactClosed = { version: 1, windowInstanceId: 'W0123456789abcdef' };
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'retire-closed-window', descriptor: exactClosed }), {
    kind: 'retire-closed-window', descriptor: exactClosed,
  });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'retire-closed-window', descriptor: { version: 1, windowInstanceId: 'not-an-id' } }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'retire-closed-window', descriptor: { ...closedDescriptor, executableFingerprint: 'bad' } }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'retire-closed-window', descriptor: closedDescriptor, extra: true }), null);
  // 019DR2 exact schemas: missing memberIds, extra keys and wrong shapes reject.
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'minimize' }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'minimize', memberIds: 'm1' }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'minimize', memberIds: [], extra: true }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'group-action', action: 'explode', memberIds: [] }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'range-toggle', memberId: 'm1' }), null);
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'range-toggle', memberId: 'm1', memberIds: ['m2'] }), { kind: 'range-toggle', memberId: 'm1', memberIds: ['m2'] });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'range-toggle', memberId: 'm1', memberIds: [], extra: true }), null);
  // 024: the bounded widget drag-reorder intent.
  assert.deepEqual(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'm1', toIndex: 2 }), { kind: 'reorder', memberId: 'm1', toIndex: 2 });
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'm1' }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'm1', toIndex: -1 }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'm1', toIndex: 1.5 }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'm1', toIndex: 2, extra: true }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'reorder', memberId: 'x'.repeat(513), toIndex: 0 }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'member-toggle', memberId: 'm1', extra: true }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: 'x', removes: [] } }), null);
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [], extra: true } }), null);
  assert.equal(windowLayoutWidgetParseCommand(null), null);
  assert.equal(windowLayoutWidgetParseCommand('command'), null);
});

test('clear-layout uses the normal revisioned command path and returns its committed empty snapshot', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }, { id: 'm2', title: 'Calculator' }])];
  const { workspace, clientChannel, applied } = makeBus(layouts, (layoutId, command) => {
    assert.equal(layoutId, 'L1');
    assert.deepEqual(command, { kind: 'clear-layout' });
    layouts[0].arrangement.members = [];
    return { ok: true };
  });
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  client.sendCommand({ kind: 'clear-layout' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 1);
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed);
  assert.equal(committed.commandKind, 'clear-layout');
  assert.deepEqual(committed.snapshot.members, []);
  workspace.close();
  client.close();
});

test('committed responses carry the origin client id and a fresh snapshot', async () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts);
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed, 'the origin widget must receive the committed response');
  assert.equal(typeof committed.clientId, 'string');
  assert.ok(committed.clientId.length > 0, 'the committed response is addressed to the origin client');
  assert.equal(committed.revision, 1);
  assert.equal(committed.snapshot.id, 'L1');
  workspace.close();
  client.close();
});

test('rapid consecutive reorders serialize correlation and keep rendered order current', async () => {
  const layouts = [makeLayout('L1', [
    { id: 'm1', title: 'One' },
    { id: 'm2', title: 'Two' },
    { id: 'm3', title: 'Three' },
    { id: 'm4', title: 'Four' },
  ])];
  const received = [];
  const { workspace, clientChannel, applied } = makeBus(layouts, async (layoutId, command) => {
    const layout = layouts.find((candidate) => candidate.id === layoutId);
    const members = layout.arrangement.members;
    const from = members.findIndex((member) => member.id === command.memberId);
    const [moved] = members.splice(from, 1);
    members.splice(Math.min(command.toIndex, members.length), 0, moved);
    return { ok: true };
  });
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel,
    layoutId: 'L1',
    clientId: 'rapid-client',
    onMessage: (message) => received.push(message),
  });
  client.ready();
  const ids = [
    client.sendCommand({ kind: 'reorder', memberId: 'm1', toIndex: 3 }),
    client.sendCommand({ kind: 'reorder', memberId: 'm4', toIndex: 0 }),
    client.sendCommand({ kind: 'reorder', memberId: 'm2', toIndex: 2 }),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(applied.map(({ command }) => command.memberId), ['m1', 'm4', 'm2']);
  const committed = received.filter((message) => message.type === 'committed');
  assert.deepEqual(committed.map((message) => message.commandId), ids);
  assert.deepEqual(committed.map((message) => message.snapshot.members.map((member) => member.id)), [
    ['m2', 'm3', 'm4', 'm1'],
    ['m4', 'm2', 'm3', 'm1'],
    ['m4', 'm3', 'm2', 'm1'],
  ]);
  assert.deepEqual(layouts[0].arrangement.members.map((member) => member.id), ['m4', 'm3', 'm2', 'm1']);
  assert.equal(client.revision, 3);
  workspace.close();
  client.close();
});

test('reorder queue clears after a terminal error and sends the next drag', async () => {
  const layouts = [makeLayout('L1', [
    { id: 'm1', title: 'One' },
    { id: 'm2', title: 'Two' },
  ])];
  const received = [];
  let attempts = 0;
  const { workspace, clientChannel, applied } = makeBus(layouts, async () => {
    attempts += 1;
    return attempts === 1 ? { ok: false, error: 'simulated host timeout' } : { ok: true };
  });
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel,
    layoutId: 'L1',
    clientId: 'cleanup-client',
    onMessage: (message) => received.push(message),
  });
  client.ready();
  const first = client.sendCommand({ kind: 'reorder', memberId: 'm1', toIndex: 1 });
  const second = client.sendCommand({ kind: 'reorder', memberId: 'm2', toIndex: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  const errors = received.filter((message) => message.type === 'error');
  const committed = received.filter((message) => message.type === 'committed');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].commandId, first);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].commandId, second);
  assert.equal(applied.length, 2);
  workspace.close();
  client.close();
});

test('a lost reorder acknowledgement retries boundedly, re-syncs, and never wedges later drags', () => {
  const bus = fakeBus();
  const clientChannel = bus.makeChannel();
  const peer = bus.makeChannel();
  const sent = [];
  peer.addEventListener('message', (event) => sent.push(event.data));
  const timers = [];
  const client = createWindowLayoutWidgetChannelClient({
    channel: clientChannel,
    layoutId: 'L1',
    clientId: 'timeout-client',
    onMessage: () => undefined,
    reorderAckTimeoutMs: 1,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => undefined,
  });
  client.sendCommand({ kind: 'reorder', memberId: 'm1', toIndex: 1 });
  client.sendCommand({ kind: 'reorder', memberId: 'm2', toIndex: 0 });
  timers.shift()();
  timers.shift()();
  timers.shift()();
  const commands = sent.filter((message) => message.type === 'command');
  assert.equal(commands.filter((message) => message.command.memberId === 'm1').length, 3);
  assert.equal(sent.filter((message) => message.type === 'snapshot-request').length, 1);
  assert.equal(commands.filter((message) => message.command.memberId === 'm2').length, 1,
    'the next drag starts after the exhausted lost acknowledgement');
  client.close();
  peer.close();
});

// Mirrors the Papers direct-pick begin descriptor contract (exact keys, version
// 1, bounded title, 64-hex executable fingerprint, no capability/token).
function pickBeginAccepted(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return false;
  const keys = Object.keys(descriptor).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['executableFingerprint', 'title', 'version'])) return false;
  if (descriptor.version !== 1) return false;
  if (typeof descriptor.title !== 'string' || descriptor.title.length === 0 || descriptor.title.length > 512) return false;
  return typeof descriptor.executableFingerprint === 'string'
    && /^[a-f0-9]{64}$/i.test(descriptor.executableFingerprint);
}

test('019DR: a command whose apply already noteCommitted posts ONE fresh committed revision', async () => {
  const bus = fakeBus();
  const workspaceChannel = bus.makeChannel();
  const clientChannel = bus.makeChannel();
  const oldLayout = makeLayout('L1', [{ id: 'm1', title: 'Notepad' }]);
  const newLayout = makeLayout('L1', [
    { id: 'm1', title: 'Notepad', state: 'minimized' },
    { id: 'm2', title: 'Paint' },
  ]);
  let current = oldLayout;
  let workspace;
  const received = [];
  workspace = createWindowLayoutWidgetChannelWorkspace({
    channel: workspaceChannel,
    getLayout: () => current, // immutable old/new objects
    snapshot: windowLayoutWidgetSnapshot,
    applyCommand: async (layoutId, command) => {
      // Production path: the writer commits a NEW immutable layout and calls
      // noteCommitted, which already bumps + broadcasts a FRESH snapshot.
      current = newLayout;
      workspace.noteCommitted(layoutId);
      return { ok: true };
    },
  });
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  assert.equal(received.at(-1).snapshot.members.length, 1, 'ready sees the old layout');
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspace.revisionOf('L1'), 1, 'exactly ONE revision bump (the apply path already advanced it)');
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed, 'expected a committed response');
  assert.equal(committed.revision, 1, 'the committed response carries the authoritative current revision');
  assert.equal(committed.snapshot.members.length, 2, 'the committed snapshot is the FRESH post-apply layout, not the pre-apply capture');
  assert.equal(committed.snapshot.members.find((member) => member.id === 'm1').state, 'minimized');
  assert.equal(received.at(-1).revision, 1, 'no higher stale committed revision may follow the fresh broadcast');
  const broadcast = received.filter((message) => message.type === 'snapshot').at(-1);
  assert.deepEqual(committed.snapshot, broadcast.snapshot, 'the committed snapshot matches the fresh broadcast');
  workspace.close();
  client.close();
});

test('019DR: a command with NO noteCommitted in the writer still bumps exactly once with a fresh layout', async () => {
  const bus = fakeBus();
  const workspaceChannel = bus.makeChannel();
  const clientChannel = bus.makeChannel();
  let current = makeLayout('L1', [{ id: 'm1', title: 'Notepad' }]);
  const workspace = createWindowLayoutWidgetChannelWorkspace({
    channel: workspaceChannel,
    getLayout: () => current,
    snapshot: windowLayoutWidgetSnapshot,
    applyCommand: async () => {
      current = makeLayout('L1', [{ id: 'm1', title: 'Notepad', state: 'minimized' }]);
      return { ok: true };
    },
  });
  const received = [];
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  client.ready();
  client.sendCommand({ kind: 'member-toggle', memberId: 'm1' });
  await new Promise((resolve) => setImmediate(resolve));
  const committed = received.find((message) => message.type === 'committed');
  assert.ok(committed);
  assert.equal(workspace.revisionOf('L1'), 1, 'exactly one bump when the writer does not advance it');
  assert.equal(committed.revision, 1);
  assert.equal(committed.snapshot.members.find((member) => member.id === 'm1').state, 'minimized', 'committed snapshot reflects the writer change');
  workspace.close();
  client.close();
});

test('019DR: snapshot descriptors retain the Papers pick-begin identity', () => {
  const persisted = {
    id: 'L1',
    name: 'L1',
    arrangement: { members: [
      { id: 'm1', descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) }, state: 'normal', bounds: null },
      { id: 'm2', descriptor: { version: 1, title: 'Calculator', executableFingerprint: 'b'.repeat(64) }, state: 'minimized', bounds: null },
    ] },
  };
  const snapshot = windowLayoutWidgetSnapshot(persisted);
  assert.equal(snapshot.members.length, 2);
  for (const member of snapshot.members) {
    assert.equal(pickBeginAccepted(member.descriptor), true, 'a picker begun from the widget receives an accepted member descriptor');
    assert.equal('capability' in member.descriptor, false, 'no runtime capability in the snapshot descriptor');
    assert.equal('token' in member.descriptor, false, 'no token in the snapshot descriptor');
  }
  assert.equal(snapshot.members[1].state, 'minimized');
});

test('persisted runtime identity does not hide a real widget member', () => {
  const layout = makeLayout('L1', [{ id: 'm1', title: 'Papers' }]);
  layout.arrangement.members[0].descriptor.windowInstanceId = 'W0123456789abcdef';
  const snapshot = windowLayoutWidgetSnapshot(layout);
  assert.equal(snapshot.members.length, 1);
  assert.deepEqual(snapshot.members[0].descriptor, {
    version: 1,
    title: 'Papers',
    executableFingerprint: fingerprint('Papers'),
    windowInstanceId: 'W0123456789abcdef',
  });
  assert.equal(snapshot.members[0].windowInstanceId, 'W0123456789abcdef');
});

test('019DR: an ENTIRE picker-commit with one malformed entry is rejected, not filtered', () => {
  const goodCandidate = { id: 'c1', title: 'Paint', icon: 'data:image/png;base64,AA==', state: 'normal' };
  const goodAdd = {
    descriptor: { version: 1, title: 'Paint', executableFingerprint: 'c'.repeat(64) },
    capability: { version: 1, bindingId: 'b:paint' },
    candidate: goodCandidate,
  };
  const goodRemove = { descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) } };
  const parsed = windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [goodAdd], removes: [goodRemove] } });
  assert.ok(parsed);
  assert.deepEqual(parsed.pick.adds[0].candidate, { icon: 'data:image/png;base64,AA==' }, 'candidate forwards ONLY the bounded icon');
  assert.equal('id' in parsed.pick.adds[0].candidate, false, 'the candidate object/reference is never forwarded');
  // One add missing its capability poisons the WHOLE command.
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [goodAdd, { descriptor: goodAdd.descriptor, capability: goodAdd.capability }], removes: [] } }), null);
  // One remove missing its descriptor poisons the WHOLE command.
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [goodRemove, { notADescriptor: true }] } }), null);
  // A non-object add also poisons.
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: ['not-an-object'], removes: [] } }), null);
});

test('019DR2: exact picker-commit schemas reject hostile fields', () => {
  const base = {
    descriptor: { version: 1, title: 'Paint', executableFingerprint: 'c'.repeat(64) },
    capability: { version: 1, bindingId: 'b:paint' },
    candidate: { icon: 'data:icon' },
  };
  const remove = { descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) } };
  const commit = (adds, removes = []) => windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds, removes } });
  // Wrong version.
  assert.equal(commit([{ ...base, descriptor: { version: 2, title: 'Paint', executableFingerprint: 'c'.repeat(64) } }]), null);
  assert.equal(commit([{ ...base, capability: { version: 2, bindingId: 'b:paint' } }]), null);
  // Bad fingerprint / binding.
  assert.equal(commit([{ ...base, descriptor: { version: 1, title: 'Paint', executableFingerprint: 'zz' } }]), null);
  assert.equal(commit([{ ...base, capability: { version: 1, bindingId: '' } }]), null);
  // Over-512 UTF-8 bytes (NOT JS character count): 300 x 2-byte chars = 600 bytes.
  assert.equal(commit([{ ...base, descriptor: { version: 1, title: 'é'.repeat(300), executableFingerprint: 'c'.repeat(64) } }]), null);
  // Extra keys inside the candidate are display data: dropped, never forwarded.
  // The icon is the ONLY field copied.
  const withExtraCandidate = commit([{ ...base, candidate: { icon: 'data:icon', extra: true } }]);
  assert.ok(withExtraCandidate);
  assert.deepEqual(withExtraCandidate.pick.adds[0].candidate, { icon: 'data:icon' });
  assert.equal('extra' in withExtraCandidate.pick.adds[0].candidate, false);
  // Extra keys on the command/remove shape poison the whole command.
  assert.equal(windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [{ ...remove, extra: true }] } }), null);
  // Oversized arrays beyond the Papers pick-member ceiling (32).
  const many = Array.from({ length: 33 }, (_, index) => ({
    ...base,
    descriptor: { version: 1, title: `Paint ${index}`, executableFingerprint: index.toString(16).padStart(64, '0') },
  }));
  assert.equal(commit(many), null);
  // 32 is accepted.
  const atCeiling = many.slice(0, 32);
  assert.ok(commit(atCeiling));
});

test('045 widget picker commits preserve only a valid optional window instance id', () => {
  const commit = (descriptor) => windowLayoutWidgetParseCommand({
    kind: 'picker-commit',
    pick: {
      outcome: 'committed',
      adds: [{
        descriptor,
        capability: { version: 1, bindingId: 'b:chrome' },
        candidate: {},
      }],
      removes: [],
    },
  });
  const exact = {
    version: 1,
    title: 'GitHub',
    executableFingerprint: 'a'.repeat(64),
    windowInstanceId: 'W0123456789abcdef',
  };
  const accepted = commit(exact);
  assert.ok(accepted);
  assert.deepEqual(accepted.pick.adds[0].descriptor, exact,
    'the exact native sibling identity reaches the authoritative workspace writer');
  assert.equal(commit({ ...exact, windowInstanceId: 'not-an-instance' }), null,
    'a malformed instance id fails closed');
  assert.equal(commit({ ...exact, extra: true }), null,
    'windowInstanceId does not open the descriptor to arbitrary extra fields');
});

test('019DR2: unicode title at exactly the 512-byte boundary is accepted, one byte over is not', () => {
  const at512 = 'é'.repeat(256); // 2 bytes each = 512 bytes
  const over512 = 'é'.repeat(257); // 514 bytes
  const accepted = windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [{
    descriptor: { version: 1, title: at512, executableFingerprint: 'd'.repeat(64) },
    capability: { version: 1, bindingId: 'b' },
    candidate: {},
  }], removes: [] } });
  assert.ok(accepted, 'a 512-byte UTF-8 title must be accepted');
  const rejected = windowLayoutWidgetParseCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [{
    descriptor: { version: 1, title: over512, executableFingerprint: 'd'.repeat(64) },
    capability: { version: 1, bindingId: 'b' },
    candidate: {},
  }], removes: [] } });
  assert.equal(rejected, null, 'a title over 512 UTF-8 bytes must be rejected');
});

test('019DR2: snapshot fails closed per invalid descriptor and never emits a partial one', () => {
  const persisted = {
    id: 'L1',
    name: 'L1',
    arrangement: { members: [
      { id: 'good', descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) }, state: 'normal', bounds: null },
      { id: 'no-fingerprint', descriptor: { version: 1, title: 'Partial' }, state: 'normal', bounds: null },
      { id: 'no-title', descriptor: { version: 1, executableFingerprint: 'b'.repeat(64) }, state: 'normal', bounds: null },
      { id: 'no-descriptor', state: 'normal', bounds: null },
      { id: 'over-bound', descriptor: { version: 1, title: 'é'.repeat(300), executableFingerprint: 'c'.repeat(64) }, state: 'normal', bounds: null },
    ] },
  };
  const snapshot = windowLayoutWidgetSnapshot(persisted);
  assert.equal(snapshot.members.length, 1, 'only the valid persisted descriptor survives');
  assert.equal(snapshot.members[0].id, 'good');
  assert.equal(pickBeginAccepted(snapshot.members[0].descriptor), true);
  assert.equal(snapshot.members.some((member) => Object.keys(member.descriptor).length < 3), false, 'no partial {} descriptor ever reaches a picker');
});

// ---- 019G/021: bounded icon + name snapshot, readiness broadcast, bounded retry ----

test('021 snapshot carries the persisted layout name and a bounded member icon', () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  layouts[0].name = 'My Saved Layout';
  const oversized = 'data:image/png;base64,' + 'A'.repeat(300000);
  const big = windowLayoutWidgetSnapshot(layouts[0], (layoutId, memberId) => (memberId === 'm1' ? oversized : null));
  assert.equal(big.name, 'My Saved Layout', 'persisted name survives');
  assert.equal(big.members[0].icon, null, 'oversized icon is dropped (byte-bounded)');
  const small = 'data:image/png;base64,AA';
  const ok = windowLayoutWidgetSnapshot(layouts[0], () => small);
  assert.equal(ok.members[0].icon, small, 'bounded icon is carried');
});

test('tracking is carried as a bounded boolean in widget snapshots', () => {
  const layout = makeLayout('L1', []);
  assert.deepEqual(windowLayoutWidgetSnapshot({ ...layout, tracking: { enabled: true } }).tracking, { enabled: true });
  assert.deepEqual(windowLayoutWidgetSnapshot({ ...layout, tracking: { enabled: 'yes' } }).tracking, { enabled: false });
});

test('021 broadcast posts a current snapshot without bumping the revision', () => {
  const layouts = [makeLayout('L1', [{ id: 'm1', title: 'Notepad' }])];
  const { workspace, clientChannel } = makeBus(layouts);
  const received = [];
  createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1', onMessage: (message) => received.push(message) });
  assert.equal(workspace.broadcast('L1'), 0, 'readiness broadcast keeps revision 0');
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'snapshot');
  assert.equal(received[0].revision, 0);
  assert.equal(received[0].snapshot.id, 'L1');
  assert.ok(Array.isArray(received[0].snapshot.members), 'snapshot has members');
  // an unknown layout broadcast is a no-op
  assert.equal(workspace.broadcast('NOPE'), 0);
  assert.equal(received.length, 1);
});

test('021 createBoundedRetry retries up to attempts then stops, honoring cancel', async () => {
  const fired = [];
  const timers = [];
  const retry = createBoundedRetry({
    attempts: 3,
    delayMs: 10,
    request: () => { fired.push('request'); return { code: 'unknown-layout' }; },
    shouldRetry: (result) => result.code === 'unknown-layout',
    onResult: (result) => fired.push('final:' + result.code),
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  retry.start();
  await Promise.resolve();
  assert.deepEqual(fired, ['request'], 'first attempt fires');
  assert.equal(timers.length, 1, 'a retry is scheduled');
  timers[0]();
  await Promise.resolve();
  assert.equal(fired.filter((entry) => entry === 'request').length, 2);
  timers[1]();
  await Promise.resolve();
  assert.equal(fired.filter((entry) => entry === 'request').length, 3, 'third attempt fires');
  assert.ok(fired.includes('final:unknown-layout'), 'final result delivered after the last attempt');
  assert.equal(timers.length, 2, 'no further timer after the attempt cap');

  const cancelledFired = [];
  const cancelledTimers = [];
  const cancelled = createBoundedRetry({
    attempts: 5,
    delayMs: 10,
    request: () => { cancelledFired.push('request'); return { code: 'unknown-layout' }; },
    shouldRetry: () => true,
    setTimer: (fn) => { cancelledTimers.push(fn); return cancelledTimers.length; },
    clearTimer: (id) => { cancelledTimers[id - 1] = null; },
  });
  cancelled.start();
  await Promise.resolve();
  assert.equal(cancelledFired.length, 1);
  cancelled.cancel();
  assert.equal(cancelledTimers[0], null, 'pending retry timer cleared');
  cancelledTimers[0]?.();
  await Promise.resolve();
  assert.equal(cancelledFired.length, 1, 'no further request after cancel');
});

test('compact-widget retry recovers when the first snapshot requests receive no response', async () => {
  let requests = 0;
  let snapshotReceived = false;
  const timers = [];
  let finalCalls = 0;
  const retry = createBoundedRetry({
    attempts: 3,
    delayMs: 10,
    request: () => {
      requests += 1;
      // Model a writer that becomes ready after the first silent request.
      if (requests === 2) snapshotReceived = true;
      return undefined;
    },
    shouldRetry: () => !snapshotReceived,
    onResult: () => { finalCalls += 1; },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });

  retry.start();
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(timers.length, 1, 'silence still schedules another snapshot request');
  timers[0]();
  await Promise.resolve();
  assert.equal(requests, 2, 'retry reaches the writer once it becomes ready');
  assert.equal(timers.length, 1, 'successful arrival stops further retries');
  assert.equal(finalCalls, 1);
});

// ---- 035: detached-widget lifecycle + shared card geometry ------------------
function makeBusWithHooks(layouts, hooks) {
  const bus = fakeBus();
  const workspaceChannel = bus.makeChannel();
  const clientChannel = bus.makeChannel();
  const workspace = createWindowLayoutWidgetChannelWorkspace({
    channel: workspaceChannel,
    getLayout: (layoutId) => layouts.find((layout) => layout.id === layoutId) ?? null,
    snapshot: windowLayoutWidgetSnapshot,
    ...hooks,
  });
  return { bus, workspace, clientChannel };
}

test('035 widget-ready marks the layout detached (onWidgetOpen) and a malformed message does not', () => {
  const layouts = [makeLayout('L1', [])];
  const opened = [];
  const { workspace, clientChannel } = makeBusWithHooks(layouts, {
    onWidgetOpen: (layoutId) => opened.push(layoutId),
  });
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  client.ready();
  assert.deepEqual(opened, ['L1'], 'a live widget marks its attached card as the greyed placeholder');
  workspace.close();
  client.close();
});

test('035 a widget report of its window content size is validated and persisted via onCardSize', () => {
  const layouts = [makeLayout('L1', [])];
  const sizes = [];
  const { workspace, clientChannel } = makeBusWithHooks(layouts, {
    onCardSize: (layoutId, width, height) => sizes.push({ layoutId, width, height }),
  });
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  // The client bounds the report the same way the workspace does.
  assert.equal(client.sendCardSize(undefined, 0), false, 'an invalid report is rejected client-side');
  assert.equal(client.sendCardSize(320.6, 140.2), true);
  assert.equal(client.sendCardSize(-1, 140), false);
  assert.deepEqual(sizes, [{ layoutId: 'L1', width: 321, height: 140 }], 'valid reports round to bounded integers');
  // A malformed card-size message (missing/extra keys, out-of-range values) is
  // ignored by the workspace: the last pushed size stays.
  clientChannel.postMessage({ type: 'card-size', layoutId: 'L1', clientId: 'c1', width: 200, height: 100, extra: true });
  clientChannel.postMessage({ type: 'card-size', layoutId: 'L1', clientId: 'c1', width: 3000, height: 100 });
  clientChannel.postMessage({ type: 'card-size', layoutId: 'L1', clientId: 'c1', width: NaN, height: 100 });
  assert.equal(sizes.length, 1, 'malformed card-size messages never reach onCardSize');
  workspace.close();
  client.close();
});

test('035 dispose reports the widget closing (onWidgetDispose); the entry dedupes via its own set', () => {
  const layouts = [makeLayout('L1', [])];
  const disposed = [];
  const { workspace, clientChannel } = makeBusWithHooks(layouts, {
    onWidgetDispose: (layoutId) => disposed.push(layoutId),
  });
  const client = createWindowLayoutWidgetChannelClient({ channel: clientChannel, layoutId: 'L1' });
  client.dispose();
  client.dispose();
  assert.deepEqual(disposed, ['L1', 'L1'], 'every dispose report is forwarded; the workspace entry Set keeps it idempotent');
  workspace.close();
  client.close();
});

test('035 the snapshot carries the persisted shared card geometry (bounded)', () => {
  const layout = {
    ...makeLayout('L1', [{ id: 'm1', title: 'Notepad' }]),
    cardSize: { width: 260, height: 140 },
  };
  const snapshot = windowLayoutWidgetSnapshot(layout);
  assert.deepEqual(snapshot.cardSize, { width: 260, height: 140 });
  assert.deepEqual(
    windowLayoutWidgetSnapshot({ ...layout, cardSize: { width: 5000, height: -1 } }).cardSize,
    null,
    'an out-of-range persisted geometry is not forwarded',
  );
  assert.equal(windowLayoutWidgetSnapshot(makeLayout('L2', [])).cardSize, null, 'no geometry -> null');
});
