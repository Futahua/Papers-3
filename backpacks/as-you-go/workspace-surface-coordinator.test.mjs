import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SURFACE_ROLE,
  createSurfaceCoordinator,
  hostWriterLeaseAdapter,
} from './public/app/workspace-surface-coordinator.js';
import { mergeSurfaceSnapshots } from './public/app/workspace-surface-merge.js';

test('host writer lease adapter acquires and releases through Papers', async () => {
  const calls = [];
  const adapter = hostWriterLeaseAdapter({
    acquireWorkspaceWriterLease: async () => {
      calls.push('acquire');
      return { token: 'lease-1' };
    },
    releaseWorkspaceWriterLease: async (token) => calls.push(`release:${token}`),
  });
  assert.equal(adapter.available, true);
  const held = await adapter.request('ignored-by-host');
  held.release();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.deepEqual(calls, ['acquire', 'release:lease-1']);
});

test('per-tab folder locations merge independently instead of replacing a peer tab', () => {
  const base = { view: { surfaceLocations: { a: { currentGroupId: 'root' }, b: { currentGroupId: 'root' } } } };
  const local = { view: { surfaceLocations: { a: { currentGroupId: 'folder-a' }, b: { currentGroupId: 'root' } } } };
  const current = { view: { surfaceLocations: { a: { currentGroupId: 'root' }, b: { currentGroupId: 'folder-b' } } } };
  assert.deepEqual(mergeSurfaceSnapshots(base, local, current).view.surfaceLocations, {
    a: { currentGroupId: 'folder-a' }, b: { currentGroupId: 'folder-b' },
  });
});

/** A lock that hands ownership to one holder at a time, in request order —
 * the property the real Web Lock gives us and the only one under test. */
function fakeLock() {
  let held = false;
  const waiting = [];
  return {
    async request() {
      if (held) {
        await new Promise((resolve) => waiting.push(resolve));
      }
      held = true;
      return {
        release() {
          held = false;
          const next = waiting.shift();
          if (next) next();
        },
      };
    },
    get waitingCount() { return waiting.length; },
  };
}

/** A disk that behaves exactly like Papers after 0A: compare-and-set on an
 * opaque revision, refusing rather than overwriting. */
function fakeDisk(initial = { schemaVersion: 1, groups: [], shortcuts: [] }) {
  let state = initial;
  let revision = 'r0';
  let counter = 0;
  return {
    async loadVersioned() { return { state, revision }; },
    async saveChecked(serialized, expected) {
      if (expected !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      state = JSON.parse(serialized);
      counter += 1;
      revision = `r${counter}`;
      return { ok: true, revision };
    },
    get state() { return state; },
    get revision() { return revision; },
    externalWrite(next) {
      state = next;
      counter += 1;
      revision = `r${counter}`;
    },
  };
}

function fakeChannel() {
  const sent = [];
  return {
    postMessage(value) { sent.push(value); },
    addEventListener() {},
    removeEventListener() {},
    sent,
  };
}

function surface(lock, disk, name, { latestQueued = null, ackTimeoutMs } = {}) {
  const installed = [];
  const channel = fakeChannel();
  const invalidations = [];
  const coordinator = createSurfaceCoordinator({
    lock,
    channel,
    host: disk,
    installDocument: (snapshot) => { installed.push(snapshot); },
    invalidatePendingSaves: () => { invalidations.push(true); return latestQueued; },
    ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs }),
    newClientId: () => name,
  });
  return { coordinator, installed, channel, invalidations };
}

const ser = (value) => JSON.stringify(value);

test('a hand-edited document refreshes the writer and its same-scope peers', async () => {
  const disk = fakeDisk();
  const writer = surface(fakeLock(), disk, 'writer');
  await writer.coordinator.start();
  const edit = { schemaVersion: 1, groups: [{ id: 'external' }], shortcuts: [] };
  disk.externalWrite(edit);
  assert.deepEqual(await writer.coordinator.refreshFromHost(), { changed: true, revision: 'r1' });
  assert.deepEqual(writer.installed.at(-1), edit);
  assert.equal(writer.channel.sent.at(-1).revision, 'r1');
  assert.deepEqual(await writer.coordinator.refreshFromHost(), { changed: false });
});

test('a scoped view reloads its own host projection after another scope writes', async () => {
  const disk = fakeDisk();
  const view = surface(fakeLock(), disk, 'scoped-view');
  await view.coordinator.saveSerialized(ser(disk.state)); // establishes its baseline
  const sentBefore = view.channel.sent.length;
  const projection = { schemaVersion: 1, groups: [{ id: 'scoped' }], shortcuts: [] };
  disk.externalWrite(projection);
  assert.deepEqual(await view.coordinator.refreshFromHost(), { changed: true, revision: 'r1' });
  assert.deepEqual(view.installed.at(-1), projection);
  assert.equal(view.channel.sent.length, sentBefore, 'a view does not publish a new authority frame');
});

test('a local writer edit rebases after an external document refresh', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [] };
  const disk = fakeDisk(initial);
  const writer = surface(fakeLock(), disk, 'writer');
  await writer.coordinator.start();
  disk.externalWrite({ ...initial, groups: [{ id: 'external' }] });
  await writer.coordinator.refreshFromHost();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, groups: [{ id: 'local' }] }),
    { baseSerialized: ser(initial) },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(disk.state.groups.map((group) => group.id).sort(), ['external', 'local']);
});

test('a background position save rebases once when a hand edit wins the CAS race', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [], view: { graphRestPositions: {} } };
  const disk = fakeDisk(initial);
  let injected = false;
  const host = {
    loadVersioned: () => disk.loadVersioned(),
    async saveChecked(serialized, expected) {
      if (!injected) {
        injected = true;
        disk.externalWrite({ ...initial, groups: [{ id: 'hand-edit' }] });
      }
      return disk.saveChecked(serialized, expected);
    },
  };
  const writer = surface(fakeLock(), host, 'writer');
  await writer.coordinator.start();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, view: { graphRestPositions: { root: { a: { x: 1, y: 2 } } } } }),
    { baseSerialized: ser(initial), rebaseAutomaticSave: true },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(disk.state.groups, [{ id: 'hand-edit' }]);
  assert.deepEqual(disk.state.view.graphRestPositions.root.a, { x: 1, y: 2 });
});

test('an automatic save survives two consecutive CAS races without freezing', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [], view: { graphRestPositions: {} } };
  const disk = fakeDisk(initial);
  let races = 0;
  const host = {
    loadVersioned: () => disk.loadVersioned(),
    async saveChecked(serialized, expected) {
      if (races < 2) {
        races += 1;
        disk.externalWrite({ ...disk.state, groups: [...disk.state.groups, { id: `racer-${races}` }] });
      }
      return disk.saveChecked(serialized, expected);
    },
  };
  const writer = surface(fakeLock(), host, 'writer');
  await writer.coordinator.start();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, view: { graphRestPositions: { root: { a: { x: 1, y: 2 } } } } }),
    { baseSerialized: ser(initial), rebaseAutomaticSave: true },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(disk.state.groups.map((group) => group.id), ['racer-1', 'racer-2']);
  assert.deepEqual(disk.state.view.graphRestPositions.root.a, { x: 1, y: 2 });
});

test('an automatic save drops quietly under perpetual contention instead of freezing', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [], view: { graphRestPositions: {} } };
  const disk = fakeDisk(initial);
  let racing = true;
  const host = {
    loadVersioned: () => disk.loadVersioned(),
    async saveChecked(serialized, expected) {
      if (racing) {
        disk.externalWrite({ ...disk.state, groups: [...disk.state.groups, { id: `racer-${expected}` }] });
      }
      return disk.saveChecked(serialized, expected);
    },
  };
  const writer = surface(fakeLock(), host, 'writer');
  await writer.coordinator.start();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, view: { graphRestPositions: { root: { a: { x: 1, y: 2 } } } } }),
    { baseSerialized: ser(initial), rebaseAutomaticSave: true },
  );
  assert.equal(result.ok, true, 'a dropped cosmetic write still reports ok');
  assert.ok(!disk.state.view.graphRestPositions.root, 'positions were dropped, not forced in');
  // The surface must still be usable, not frozen: another automatic save
  // rebases against whatever won and commits.
  racing = false;
  const followup = await writer.coordinator.saveSerialized(
    ser({ ...initial, view: { graphRestPositions: { root: { b: { x: 9, y: 9 } } } } }),
    { baseSerialized: ser(initial), rebaseAutomaticSave: true },
  );
  assert.equal(followup.ok, true);
  assert.deepEqual(disk.state.view.graphRestPositions.root.b, { x: 9, y: 9 });
});

test('an automatic save drops quietly on scope violation instead of freezing', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [], view: { graphRestPositions: {} } };
  const disk = fakeDisk(initial);
  const host = {
    loadVersioned: () => disk.loadVersioned(),
    async saveChecked(serialized) {
      const loaded = await disk.loadVersioned();
      return { ok: false, code: 'SCOPE_VIOLATION', revision: loaded.revision };
    },
  };
  const writer = surface(fakeLock(), host, 'writer');
  await writer.coordinator.start();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, view: { graphRestPositions: { root: { a: { x: 1, y: 2 } } } } }),
    { baseSerialized: ser(initial), rebaseAutomaticSave: true },
  );
  assert.equal(result.ok, true, 'a refused cosmetic write still reports ok');
  assert.deepEqual(disk.state.groups, [], 'nothing was written through the refused save');
});

test('an explicit save still freezes on scope violation', async () => {
  const initial = { schemaVersion: 1, groups: [], shortcuts: [] };
  const disk = fakeDisk(initial);
  const host = {
    loadVersioned: () => disk.loadVersioned(),
    async saveChecked(serialized) {
      const loaded = await disk.loadVersioned();
      return { ok: false, code: 'SCOPE_VIOLATION', revision: loaded.revision };
    },
  };
  const writer = surface(fakeLock(), host, 'writer');
  await writer.coordinator.start();
  const result = await writer.coordinator.saveSerialized(
    ser({ ...initial, groups: [{ id: 'mine' }] }),
    { baseSerialized: ser(initial) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SCOPE_VIOLATION');
});

test('the first surface becomes the writer and a second stays a view', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');

  await a.coordinator.start();
  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);

  const bWriting = b.coordinator.start();
  await Promise.resolve();
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW, 'B must not write while A holds the lock');

  a.coordinator.release();
  await bWriting;
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

test('a view forwards saves instead of silently blocking document actions', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const result = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [], shortcuts: [] }));
  assert.equal(result.forwarded, true);
});

test('a view forwards an optimistic document action to the writer channel', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'g1' }], shortcuts: [] };
  const result = await b.coordinator.saveSerialized(ser(board));
  assert.deepEqual(result, { ok: true, forwarded: true, revision: 'r0' });
  assert.deepEqual(b.channel.sent.at(-1), {
    type: 'mutation-request',
    clientId: 'B',
    revision: 'r0',
    serialized: ser(board),
    baseSerialized: ser({ schemaVersion: 1, groups: [], shortcuts: [] }),
    requestId: 'B:1',
  });
});

test('a forwarded view mutation keeps navigation and selection local', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({
    schemaVersion: 1, groups: [], shortcuts: [],
    view: { currentGroupId: 'writer-folder', selectedItemIds: ['writer-item'], binMode: false },
  });
  const b = surface(lock, disk, 'B');
  const local = {
    schemaVersion: 1,
    groups: [{ id: 'new' }],
    shortcuts: [],
    view: { currentGroupId: 'b-folder', selectedItemIds: ['b-item'], binMode: true },
  };
  await b.coordinator.saveSerialized(ser(local));
  const sent = b.channel.sent.at(-1);
  const forwarded = JSON.parse(sent.serialized);
  assert.equal(forwarded.groups[0].id, 'new');
  assert.equal(forwarded.view.currentGroupId, 'writer-folder');
  assert.deepEqual(forwarded.view.selectedItemIds, ['writer-item']);
  assert.equal(forwarded.view.binMode, false);
});

test('a failed forwarded mutation reloads the authoritative document before settling', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'speculative' }], shortcuts: [] };

  const forwarded = await b.coordinator.saveSerialized(ser(board));
  const request = b.channel.sent.at(-1);
  assert.equal(forwarded.forwarded, true);
  assert.equal(typeof request.requestId, 'string');

  assert.equal(b.coordinator.receive({
    type: 'mutation-ack',
    clientId: 'A',
    ackClientId: 'B',
    requestId: request.requestId,
    ok: false,
    code: 'REMOTE_MUTATION_FAILED',
    revision: disk.revision,
  }), true);
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: false, revision: disk.revision, code: 'REMOTE_MUTATION_FAILED' });
  assert.deepEqual(b.installed.at(-1), disk.state);
  assert.equal(b.coordinator.revision, disk.revision);
});

test('a forwarded ACK timeout reloads the authoritative document', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 5 });
  const board = { schemaVersion: 1, groups: [{ id: 'lost' }], shortcuts: [] };

  const forwarded = await b.coordinator.saveSerialized(ser(board));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const cancel = b.channel.sent.at(-1);
  assert.equal(cancel.type, 'mutation-cancel');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: cancel.requestId,
    ok: false, code: 'MUTATION_CANCELLED', revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: false, revision: disk.revision, code: 'MUTATION_CANCELLED' });
  assert.deepEqual(b.installed.at(-1), disk.state);
  assert.equal(b.coordinator.revision, disk.revision);
});

test('a successful timeout recovery clears conflict before dependent work continues', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  const forwarded = await b.coordinator.saveSerialized(ser({
    schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [],
  }), { generation: 1 });
  const request = b.channel.sent.at(-1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] }), 'r0');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: true, revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, true);
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);
});

test('conflict recovery choices wait for an unresolved cancellation', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  await b.coordinator.saveSerialized(ser({
    schemaVersion: 1, groups: [{ id: 'speculative' }], shortcuts: [],
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((await b.coordinator.useLatest()).code, 'MUTATION_CANCELLATION_PENDING');
  assert.equal((await b.coordinator.keepMine()).code, 'MUTATION_CANCELLATION_PENDING');
});

test('timeout freezes a view before a slow authority recovery returns', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  let loads = 0;
  let releaseRecovery;
  const loadVersioned = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 2) await new Promise((resolve) => { releaseRecovery = resolve; });
    return loadVersioned();
  };
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  const forwarded = await b.coordinator.saveSerialized(ser({
    schemaVersion: 1, groups: [{ id: 'speculative' }], shortcuts: [],
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  releaseRecovery();
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, false);
});

test('terminal success waits for a fresh read after a pre-ACK recovery read', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  let loads = 0;
  let releaseRecovery;
  const loadVersioned = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 2) await new Promise((resolve) => { releaseRecovery = resolve; });
    return loadVersioned();
  };
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const request = b.channel.sent.find((message) => message.type === 'mutation-request');
  await disk.saveChecked(ser(committed), 'r0');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: true, revision: disk.revision,
  });
  releaseRecovery();
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revision, 'r1');
  assert.deepEqual(b.installed.at(-1), committed);
});

test('a generic validation conflict clears when a pending success proves authority', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  let loads = 0;
  const loadVersioned = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 2) throw new Error('validation unavailable');
    return loadVersioned();
  };
  const b = surface(fakeLock(), disk, 'B');
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed), { generation: 4 });
  b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0',
    serialized: ser({ schemaVersion: 1, groups: [{ id: 'other' }], shortcuts: [] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  await disk.saveChecked(ser(committed), 'r0');
  const request = b.channel.sent.find((message) => message.type === 'mutation-request');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: true, revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, true);
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);
});

test('timeout recovery recognizes a commit already durable on disk', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 5 });
  const committed = { schemaVersion: 1, groups: [{ id: 'committed-before-ack' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  await disk.saveChecked(ser(committed), 'r0');
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: 'r1', via: 'recovery-authoritative' });
  assert.deepEqual(b.installed.at(-1), committed);
});

test('timeout recovery recognizes a durable writer rebase with unrelated edits', async () => {
  const lock = fakeLock();
  const initial = { schemaVersion: 1, groups: [{ id: 'a', title: 'A0' }, { id: 'b', title: 'B0' }], shortcuts: [] };
  const disk = fakeDisk(initial);
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 5 });
  const request = { schemaVersion: 1, groups: [{ id: 'a', title: 'A1' }, { id: 'b', title: 'B0' }], shortcuts: [] };
  const merged = { schemaVersion: 1, groups: [{ id: 'a', title: 'A1' }, { id: 'b', title: 'B1' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(request));
  await disk.saveChecked(ser(merged), 'r0');
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: 'r1', via: 'recovery-authoritative' });
  assert.deepEqual(b.installed.at(-1), merged);
});

test('writer cancellation prevents a queued remote mutation from reaching disk', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const incoming = { schemaVersion: 1, groups: [{ id: 'cancelled' }], shortcuts: [] };
  const request = {
    type: 'mutation-request', clientId: 'B', requestId: 'B:1', revision: 'r0',
    serialized: ser(incoming), baseSerialized: ser(disk.state),
  };
  assert.equal(a.coordinator.receive(request), true);
  assert.equal(a.coordinator.receive({ type: 'mutation-cancel', clientId: 'B', requestId: 'B:1' }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disk.state.groups.map((group) => group.id), ['base']);
  assert.deepEqual(a.channel.sent.at(-1), {
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: 'B:1',
    ok: false, code: 'MUTATION_CANCELLED', revision: 'r0',
  });
});

test('a view cannot forge a cancellation acknowledgement', async () => {
  const b = surface(fakeLock(), fakeDisk(), 'B');
  assert.equal(b.coordinator.receive({
    type: 'mutation-cancel', clientId: 'B', requestId: 'B:1',
  }), false);
  assert.deepEqual(b.channel.sent, []);
});

test('cancellation ACK reconciles a newer authoritative revision before settling', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B');
  const forwarded = await b.coordinator.saveSerialized(ser({
    schemaVersion: 1, groups: [{ id: 'speculative' }], shortcuts: [],
  }));
  const request = b.channel.sent.at(-1);
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'newer' }], shortcuts: [] }), 'r0');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'MUTATION_CANCELLED', revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: false, revision: disk.revision, code: 'MUTATION_CANCELLED' });
  assert.deepEqual(b.installed.at(-1), disk.state);
  assert.equal(b.coordinator.revision, disk.revision);
});

test('cancellation ACK upgrades an already-durable request to success', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B');
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  const request = b.channel.sent.at(-1);
  await disk.saveChecked(ser(committed), 'r0');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'C', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'MUTATION_CANCELLED', revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: disk.revision, via: 'recovery-authoritative' });
});

test('promotion recognizes a durable pending request instead of replay failure', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 500 });
  await a.coordinator.start();
  const bStart = b.coordinator.start();
  await Promise.resolve();
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  await disk.saveChecked(ser(committed), 'r0');
  a.coordinator.release();
  await bStart;
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: disk.revision, via: 'promotion-authority' });
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

test('a successful late ACK reloads the committed authority before settling', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B');
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  const request = b.channel.sent.at(-1);
  await disk.saveChecked(ser(committed), 'r0');
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: true, revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: disk.revision });
  assert.deepEqual(b.installed.at(-1), committed);
});

test('lost cancellation fails closed instead of leaving a writable speculative view', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  let loads = 0;
  const loadVersioned = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads > 1) throw new Error('recovery unavailable');
    return loadVersioned();
  };
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  const forwarded = await b.coordinator.saveSerialized(ser({
    schemaVersion: 1, groups: [{ id: 'speculative' }], shortcuts: [],
  }));
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: false, code: 'MUTATION_UNCERTAIN', revision: 'r0' });
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
});

test('recovery ignores an older load that loses to a newer committed broadcast', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'r10' }], shortcuts: [] });
  const firstLoad = disk.loadVersioned.bind(disk);
  let releaseRecovery;
  let loadCount = 0;
  disk.loadVersioned = async () => {
    loadCount += 1;
    if (loadCount === 2) await new Promise((resolve) => { releaseRecovery = resolve; });
    return firstLoad();
  };
  const b = surface(lock, disk, 'B');
  const forwarded = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'lost' }], shortcuts: [] }));
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: 'r10',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const newer = { schemaVersion: 1, groups: [{ id: 'r11' }], shortcuts: [] };
  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r11', serialized: ser(newer) }), true);
  releaseRecovery();
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, false);
  assert.deepEqual(b.installed.at(-1), newer);
  assert.equal(b.coordinator.revision, 'r11');
});

test('stale recovery checks the newer installed authority for durable request intent', async () => {
  const lock = fakeLock();
  const initial = { schemaVersion: 1, groups: [{ id: 'a', title: 'A0' }, { id: 'b', title: 'B0' }], shortcuts: [] };
  const disk = fakeDisk(initial);
  const firstLoad = disk.loadVersioned.bind(disk);
  let releaseRecovery;
  let loadCount = 0;
  disk.loadVersioned = async () => {
    loadCount += 1;
    if (loadCount === 2) await new Promise((resolve) => { releaseRecovery = resolve; });
    return firstLoad();
  };
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 5 });
  const r1 = { schemaVersion: 1, groups: [{ id: 'a', title: 'A1' }, { id: 'b', title: 'B0' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(r1), { generation: 9, sequence: 1 });
  const request = b.channel.sent.at(-1);
  await disk.saveChecked(ser(r1), 'r0');
  await new Promise((resolve) => setTimeout(resolve, 15));
  const r2 = { schemaVersion: 1, groups: [{ id: 'a', title: 'A1' }, { id: 'b', title: 'B1' }], shortcuts: [] };
  await disk.saveChecked(ser(r2), 'r1');
  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r2', serialized: ser(r2) }), true);
  releaseRecovery();
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: 'r2', via: 'recovery-authoritative' });
  assert.deepEqual(b.installed.at(-1), r2);
});

test('a late correlated commit wins over ACK-timeout recovery', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const firstLoad = disk.loadVersioned.bind(disk);
  let releaseRecovery;
  let loadCount = 0;
  disk.loadVersioned = async () => {
    loadCount += 1;
    if (loadCount === 2) await new Promise((resolve) => { releaseRecovery = resolve; });
    return firstLoad();
  };
  const b = surface(lock, disk, 'B', { ackTimeoutMs: 5 });
  const forwarded = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'late' }], shortcuts: [] }));
  const request = b.channel.sent.at(-1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const committed = { schemaVersion: 1, groups: [{ id: 'late' }], shortcuts: [] };
  assert.equal(b.coordinator.receive({
    type: 'committed', clientId: 'A', requestId: request.requestId, revision: 'r1', serialized: ser(committed),
  }), true);
  releaseRecovery();
  const outcome = await forwarded.acknowledgement;
  assert.deepEqual(outcome, { ok: true, revision: 'r1', via: 'committed-broadcast' });
  assert.deepEqual(b.installed.at(-1), committed);
  assert.equal(b.coordinator.revision, 'r1');
});

test('retiring a failed generation removes dependent optimistic overlays', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  const b = surface(lock, disk, 'B');
  const r1 = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'r1' }], shortcuts: [] }), { generation: 7, sequence: 1 });
  const r2Local = ser({ schemaVersion: 1, groups: [{ id: 'r1' }, { id: 'r2' }], shortcuts: [] });
  const r2 = await b.coordinator.saveSerialized(r2Local, { generation: 7, sequence: 2 });
  const request1 = b.channel.sent.at(-2);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request1.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: disk.revision,
  });
  await r1.acknowledgement;
  // This is the store's synchronous onSaveGenerationInvalidated callback.
  b.coordinator.retirePendingGeneration(7, r2Local);
  assert.deepEqual(b.installed.at(-1), disk.state);
});

test('follower recovery conflict cannot promote itself through Use latest', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  const originalLoad = disk.loadVersioned.bind(disk);
  let loads = 0;
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 4) throw new Error('recovery unavailable');
    return originalLoad();
  };
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const b = surface(lock, disk, 'B');
  const forwarded = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'lost' }], shortcuts: [] }), { generation: 3 });
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: disk.revision,
  });
  await forwarded.acknowledgement;
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  await b.coordinator.useLatest();
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);
  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);
});

test('stale action snapshots merge entities while the incoming position wins', () => {
  const base = {
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
    view: { graphPositions: { root: { g1: { x: 1, y: 1 } } }, iconSize: 32 },
  };
  const local = {
    ...base,
    groups: [{ id: 'g2', title: 'two' }, { id: 'g1', title: 'renamed' }],
    view: { graphPositions: { root: { g1: { x: 90, y: 90 } } }, iconSize: 40 },
  };
  const current = {
    ...base,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'changed elsewhere' }],
    view: { graphPositions: { root: { g1: { x: 4, y: 4 } } }, iconSize: 32 },
  };
  const merged = mergeSurfaceSnapshots(base, local, current);
  assert.deepEqual(merged.groups, [
    { id: 'g1', title: 'renamed' },
    { id: 'g2', title: 'changed elsewhere' },
  ]);
  assert.deepEqual(merged.view.graphPositions, { root: { g1: { x: 90, y: 90 } } });
  assert.equal(merged.view.iconSize, 40);
});

test('stale position updates merge per item and preserve an unrelated later drag', () => {
  const base = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { graphPositions: { root: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } } },
  };
  const local = {
    ...base,
    view: { graphPositions: { root: { a: { x: 90, y: 90 }, b: { x: 2, y: 2 } } } },
  };
  const current = {
    ...base,
    view: { graphPositions: { root: { a: { x: 4, y: 4 }, b: { x: 80, y: 80 } } } },
  };
  assert.deepEqual(
    mergeSurfaceSnapshots(base, local, current).view.graphPositions,
    { root: { a: { x: 90, y: 90 }, b: { x: 80, y: 80 } } },
  );
});

test('stale set updates merge independent item-set IDs', () => {
  const base = {
    schemaVersion: 1, groups: [], shortcuts: [],
    view: { itemSets: [{ id: 's1', title: 'one' }, { id: 's2', title: 'two' }] },
  };
  const local = {
    ...base,
    view: { itemSets: [{ id: 's1', title: 'ONE' }, { id: 's2', title: 'two' }] },
  };
  const current = {
    ...base,
    view: { itemSets: [{ id: 's1', title: 'one' }, { id: 's2', title: 'TWO' }] },
  };
  assert.deepEqual(mergeSurfaceSnapshots(base, local, current).view.itemSets, [
    { id: 's1', title: 'ONE' },
    { id: 's2', title: 'TWO' },
  ]);
});

test('same entity fields and shortcut placements merge independently', () => {
  const base = {
    schemaVersion: 1,
    groups: [{ id: 'g1', name: 'old', icon: 'a' }],
    shortcuts: [{ id: 's1', name: 'shortcut', placements: [
      { id: 'p1', parentId: 'root', order: 0 },
      { id: 'p2', parentId: 'root', order: 1 },
    ] }],
  };
  const local = structuredClone(base);
  local.groups[0].name = 'local';
  local.shortcuts[0].placements[0].order = 4;
  const current = structuredClone(base);
  current.groups[0].icon = 'b';
  current.shortcuts[0].placements[1].order = 5;
  const merged = mergeSurfaceSnapshots(base, local, current);
  assert.equal(merged.groups[0].name, 'local');
  assert.equal(merged.groups[0].icon, 'b');
  assert.equal(merged.shortcuts[0].placements[0].order, 4);
  assert.equal(merged.shortcuts[0].placements[1].order, 5);
});

test('prompt reorder and cross-folder move preserve concurrent prompt edits', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p1', type: 'prompt', text: 'one' }, { id: 'p2', type: 'prompt', text: 'two' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p2', type: 'prompt', text: 'two' }] },
    { id: 'b', type: 'folder', children: [{ id: 'p1', type: 'prompt', text: 'one' }] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p1', type: 'prompt', text: 'edited' }, { id: 'p2', type: 'prompt', text: 'two' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const moved = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  assert.deepEqual(moved[0].children.map((node) => node.id), ['p2']);
  assert.equal(moved[1].children[0].id, 'p1');
  assert.equal(moved[1].children[0].text, 'edited');

  const reordered = mergeSurfaceSnapshots(
    base,
    { view: { promptLibrary: [{ ...base.view.promptLibrary[0], children: [base.view.promptLibrary[0].children[1], base.view.promptLibrary[0].children[0]] }, base.view.promptLibrary[1]] } },
    current,
  ).view.promptLibrary[0].children;
  assert.deepEqual(reordered.map((node) => node.id), ['p2', 'p1']);
  assert.equal(reordered[1].text, 'edited');
});

test('prompt reorder and insertion retain both sides without index-based loss', () => {
  const base = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'a', type: 'prompt', text: 'a' },
      { id: 'b', type: 'prompt', text: 'b' },
    ] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'b', type: 'prompt', text: 'b' },
      { id: 'x', type: 'prompt', text: 'local insert' },
      { id: 'a', type: 'prompt', text: 'a' },
    ] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'a', type: 'prompt', text: 'edited elsewhere' },
      { id: 'b', type: 'prompt', text: 'b' },
      { id: 'y', type: 'prompt', text: 'remote insert' },
    ] },
  ] } };
  const children = mergeSurfaceSnapshots(base, local, current).view.promptLibrary[0].children;
  assert.deepEqual(children.map((node) => node.id), ['b', 'x', 'a', 'y']);
  assert.equal(children.find((node) => node.id === 'a').text, 'edited elsewhere');
});

test('a moved prompt does not resurrect after the other surface deletes it', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'keep?' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'keep?' }] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const folders = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  assert.deepEqual(folders.flatMap((folder) => folder.children), []);
});

test('compatible moves of different prompts retain both ordering constraints', () => {
  const base = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'a', type: 'prompt' }, { id: 'b', type: 'prompt' },
      { id: 'c', type: 'prompt' }, { id: 'd', type: 'prompt' },
    ] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'a', type: 'prompt' }, { id: 'c', type: 'prompt' },
      { id: 'b', type: 'prompt' }, { id: 'd', type: 'prompt' },
    ] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'root', type: 'folder', children: [
      { id: 'd', type: 'prompt' }, { id: 'a', type: 'prompt' },
      { id: 'b', type: 'prompt' }, { id: 'c', type: 'prompt' },
    ] },
  ] } };
  const ids = mergeSurfaceSnapshots(base, local, current).view.promptLibrary[0].children.map((node) => node.id);
  assert.deepEqual(ids, ['d', 'a', 'c', 'b']);
});

test('same-prompt move conflict uses the local lane as the deterministic winner', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'base' }] },
    { id: 'b', type: 'folder', children: [] },
    { id: 'c', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'local move' }] },
    { id: 'c', type: 'folder', children: [] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [] },
    { id: 'c', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'remote move' }] },
  ] } };
  const folders = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  assert.deepEqual(folders.map((folder) => folder.children.map((node) => node.id)), [[], ['p'], []]);
});

test('a current-lane move preserves a stale local field edit at the new destination', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'base' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'local edit' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'base' }] },
  ] } };
  const folders = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  assert.deepEqual(folders[0].children, []);
  assert.deepEqual(folders[1].children.map((node) => node.id), ['p']);
  assert.equal(folders[1].children[0].text, 'local edit');
});

test('a current-lane subtree move preserves a stale descendant edit', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'f', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'base' }] }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'f', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'descendant edit' }] }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [{ id: 'f', type: 'folder', children: [{ id: 'p', type: 'prompt', text: 'base' }] }] },
  ] } };
  const folders = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  const moved = folders[1].children[0];
  assert.equal(moved.id, 'f');
  assert.equal(moved.children[0].id, 'p');
  assert.equal(moved.children[0].text, 'descendant edit');
});

test('a local deletion beats a stale current relocation of the same identity', () => {
  const base = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [{ id: 'p', type: 'prompt' }] },
    { id: 'b', type: 'folder', children: [] },
  ] } };
  const local = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] }, { id: 'b', type: 'folder', children: [] },
  ] } };
  const current = { view: { promptLibrary: [
    { id: 'a', type: 'folder', children: [] },
    { id: 'b', type: 'folder', children: [{ id: 'p', type: 'prompt' }] },
  ] } };
  const folders = mergeSurfaceSnapshots(base, local, current).view.promptLibrary;
  assert.deepEqual(folders.flatMap((folder) => folder.children), []);
});

test('Use latest retires invalidated pending overlays before the next save', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [], shortcuts: [] });
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const first = ser({ schemaVersion: 1, groups: [{ id: 'first' }], shortcuts: [] });
  const pending = ser({ schemaVersion: 1, groups: [{ id: 'pending' }], shortcuts: [] });
  // Advance the host behind the coordinator so its first write is refused.
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'remote' }], shortcuts: [] }), 'r0');
  const refused = await a.coordinator.saveSerialized(first, {
    generation: 7,
    pendingSnapshots: [{ serialized: pending, baseSerialized: first, generation: 7 }],
  });
  assert.equal(refused.ok, false);
  await a.coordinator.useLatest();
  const next = ser({ schemaVersion: 1, groups: [{ id: 'remote' }, { id: 'next' }], shortcuts: [] });
  await a.coordinator.saveSerialized(next, { generation: 8 });
  assert.deepEqual(disk.state.groups.map((group) => group.id), ['remote', 'next']);
});

test('a queued hint that becomes a no-op is retired before later peer installs', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [], shortcuts: [] });
  const b = surface(lock, disk, 'B');
  const hinted = ser({ schemaVersion: 1, groups: [{ id: 'same' }], shortcuts: [] });
  const unchanged = await b.coordinator.saveSerialized(hinted, {
    generation: 3,
    baseSerialized: hinted,
    pendingSnapshots: [{ serialized: hinted, baseSerialized: hinted, generation: 3, sequence: 1 }],
  });
  assert.equal(unchanged.unchanged, true);
  const latest = ser({ schemaVersion: 1, groups: [{ id: 'latest' }], shortcuts: [] });
  b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r9', serialized: latest });
  assert.deepEqual(b.installed.at(-1).groups.map((group) => group.id), ['latest']);
});

test('a multi-item delete removes every requested entity without index drift', () => {
  const base = { schemaVersion: 1, groups: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], shortcuts: [] };
  const local = { ...base, groups: [{ id: 'c' }] };
  const merged = mergeSurfaceSnapshots(base, local, base);
  assert.deepEqual(merged.groups, [{ id: 'c' }]);
});

test('queued peer mutations rebase in arrival order instead of dropping the second edit', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const base = ser(disk.state);
  const first = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'ONE' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  const second = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'TWO' }],
    shortcuts: [],
  });
  assert.equal(a.coordinator.receive({ type: 'mutation-request', clientId: 'B', revision: 'r0', serialized: first, baseSerialized: base }), true);
  assert.equal(a.coordinator.receive({ type: 'mutation-request', clientId: 'C', revision: 'r0', serialized: second, baseSerialized: base }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(disk.state.groups, [
    { id: 'g1', title: 'ONE' },
    { id: 'g2', title: 'TWO' },
  ]);
});

test('a writer-local snapshot queued behind a peer mutation rebases instead of erasing it', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const base = ser(disk.state);
  const peer = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'TWO' }],
    shortcuts: [],
  });
  const local = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'ONE' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  a.coordinator.receive({ type: 'mutation-request', clientId: 'B', revision: 'r0', serialized: peer, baseSerialized: base });
  const localSave = a.coordinator.saveSerialized(local);
  await localSave;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(disk.state.groups, [
    { id: 'g1', title: 'ONE' },
    { id: 'g2', title: 'TWO' },
  ]);
});

test('a successful save advances the revision and broadcasts the committed snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  const board = { schemaVersion: 1, groups: [{ id: 'g' }], shortcuts: [] };
  const result = await a.coordinator.saveSerialized(ser(board));

  assert.equal(result.ok, true);
  assert.equal(a.coordinator.revision, disk.revision);
  assert.deepEqual(a.channel.sent.at(-1), {
    type: 'committed',
    clientId: 'A',
    revision: disk.revision,
    serialized: ser(board),
    parentRevision: 'r0',
  }, 'the broadcast carries the exact bytes that were committed');
});

test('a view installs a committed snapshot but never its own echo', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'from-a' }], shortcuts: [] };

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r1', serialized: ser(board) }), true);
  assert.deepEqual(b.installed.at(-1), board);
  assert.equal(b.coordinator.revision, 'r1');

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r2', serialized: ser(board) }), false);
});

test('a delayed former-writer frame cannot regress a view after a cross-writer commit', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'base' }], shortcuts: [] });
  const b = surface(fakeLock(), disk, 'B');
  const r1 = { schemaVersion: 1, groups: [{ id: 'r1' }], shortcuts: [] };
  const r2 = { schemaVersion: 1, groups: [{ id: 'r2' }], shortcuts: [] };
  await disk.saveChecked(ser(r1), 'r0');
  await disk.saveChecked(ser(r2), 'r1');
  assert.equal(b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0', serialized: ser(r1),
  }), true);
  assert.equal(b.coordinator.receive({
    type: 'committed', clientId: 'C', revision: 'r2', parentRevision: 'r1', serialized: ser(r2),
  }), true);
  assert.equal(b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0', serialized: ser(r1),
  }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(b.installed.at(-1), r2);
  assert.equal(b.coordinator.revision, 'r2');
});

test('overlapping parent validations keep the newest authority when the older read wins first', async () => {
  const disk = fakeDisk();
  const pendingLoads = [];
  disk.loadVersioned = () => new Promise((resolve) => pendingLoads.push(resolve));
  const b = surface(fakeLock(), disk, 'B');
  const r1 = { schemaVersion: 1, groups: [{ id: 'r1' }], shortcuts: [] };
  const r2 = { schemaVersion: 1, groups: [{ id: 'r2' }], shortcuts: [] };

  b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0', serialized: ser(r1),
  });
  b.coordinator.receive({
    type: 'committed', clientId: 'C', revision: 'r2', parentRevision: 'r1', serialized: ser(r2),
  });
  assert.equal(pendingLoads.length, 2);

  pendingLoads[0]({ state: r1, revision: 'r1' });
  await new Promise((resolve) => setImmediate(resolve));
  pendingLoads[1]({ state: r2, revision: 'r2' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(b.installed.at(-1), r2);
  assert.equal(b.coordinator.revision, 'r2');
});

test('Use latest keeps the host result when a parent validation is still pending', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  let loads = 0;
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 4) throw new Error('recovery unavailable');
    return originalLoad();
  };
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const b = surface(lock, disk, 'B');
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(mine));
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: disk.revision,
  });
  await forwarded.acknowledgement;
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);

  const pendingLoads = [];
  disk.loadVersioned = () => new Promise((resolve) => pendingLoads.push(resolve));
  const newest = { schemaVersion: 1, groups: [{ id: 'newest' }], shortcuts: [] };
  const useLatest = b.coordinator.useLatest();
  await new Promise((resolve) => setImmediate(resolve));
  b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r2', parentRevision: 'r1',
    serialized: ser(newest),
  });
  assert.equal(pendingLoads.length, 2);
  pendingLoads[0]({ state: newest, revision: 'r2' });
  await useLatest;
  pendingLoads[1]({ state: newest, revision: 'r2' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);
  assert.equal(b.coordinator.revision, 'r2');
  assert.deepEqual(b.installed.at(-1), newest);
});

test('timeout recovery proves durable intent while parent validation is pending', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [], shortcuts: [] });
  let loads = 0;
  const pendingLoads = [];
  const initialLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = () => {
    loads += 1;
    if (loads === 1) return initialLoad();
    return new Promise((resolve) => pendingLoads.push(resolve));
  };
  const b = surface(fakeLock(), disk, 'B', { ackTimeoutMs: 5 });
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed), { generation: 10 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(pendingLoads.length, 1, 'timeout recovery load is held');
  b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0',
    serialized: ser(committed), requestId: b.channel.sent.find((m) => m.type === 'mutation-request').requestId,
  });
  assert.equal(pendingLoads.length, 2, 'parent validation load is held');
  pendingLoads[0]({ state: committed, revision: 'r1' });
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, true);
  pendingLoads[1]({ state: committed, revision: 'r1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.coordinator.revision, 'r1');
});

test('success proof remains authoritative while a parent validation is pending', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [], shortcuts: [] });
  let loads = 0;
  const pendingLoads = [];
  const initialLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = () => {
    loads += 1;
    if (loads === 1) return initialLoad();
    return new Promise((resolve) => pendingLoads.push(resolve));
  };
  const b = surface(fakeLock(), disk, 'B');
  const committed = { schemaVersion: 1, groups: [{ id: 'committed' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(committed));
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: true, revision: 'r1',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingLoads.length, 1, 'success proof load is held');
  b.coordinator.receive({
    type: 'committed', clientId: 'C', revision: 'r2', parentRevision: 'r1', serialized: ser(committed),
  });
  assert.equal(pendingLoads.length, 2, 'parent validation load is held');
  pendingLoads[0]({ state: committed, revision: 'r1' });
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.revision, 'r1');
  pendingLoads[1]({ state: committed, revision: 'r1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.coordinator.revision, 'r1');
});

test('unrelated validation failure preserves a settled follower conflict snapshot', async () => {
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  let loads = 0;
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 2 || loads === 3) throw new Error('validation unavailable');
    return originalLoad();
  };
  const b = surface(fakeLock(), disk, 'B');
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(mine), { generation: 8 });
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: disk.revision,
  });
  const outcome = await forwarded.acknowledgement;
  assert.equal(outcome.ok, false);
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(b.coordinator.frozen, ser(mine));

  b.coordinator.receive({
    type: 'committed', clientId: 'A', revision: 'r1', parentRevision: 'r0',
    serialized: ser({ schemaVersion: 1, groups: [{ id: 'other' }], shortcuts: [] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(b.coordinator.frozen, ser(mine));
  const keep = await b.coordinator.keepMine();
  assert.equal(keep.ok, true);
  assert.deepEqual(disk.state, mine);
});

test('follower Keep my version restores Mine after a post-lock CAS race', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({ schemaVersion: 1, groups: [{ id: 'durable' }], shortcuts: [] });
  let loads = 0;
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    loads += 1;
    if (loads === 4) throw new Error('recovery unavailable');
    return originalLoad();
  };
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const b = surface(lock, disk, 'B');
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const forwarded = await b.coordinator.saveSerialized(ser(mine), { generation: 9 });
  const request = b.channel.sent.at(-1);
  b.coordinator.receive({
    type: 'mutation-ack', clientId: 'A', ackClientId: 'B', requestId: request.requestId,
    ok: false, code: 'REMOTE_MUTATION_FAILED', revision: disk.revision,
  });
  await forwarded.acknowledgement;
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(b.coordinator.frozen, ser(mine));

  const originalSave = disk.saveChecked.bind(disk);
  let injected = false;
  disk.saveChecked = async (serialized, expected) => {
    if (!injected && JSON.parse(serialized).groups?.[0]?.id === 'mine') {
      injected = true;
      await originalSave(ser({ schemaVersion: 1, groups: [{ id: 'external' }], shortcuts: [] }), disk.revision);
    }
    return originalSave(serialized, expected);
  };
  const keepPromise = b.coordinator.keepMine();
  await new Promise((resolve) => setImmediate(resolve));
  a.coordinator.release();
  const first = await keepPromise;
  assert.deepEqual(first, { ok: false, code: 'STALE_REVISION' });
  assert.equal(b.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(b.coordinator.frozen, ser(mine));

  const retry = await b.coordinator.keepMine();
  assert.equal(retry.ok, true);
  assert.deepEqual(disk.state, mine);
});

test('a save refused as stale freezes the surface and keeps the unsaved snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  // Something else commits first — the case 0A refuses.
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);

  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const result = await a.coordinator.saveSerialized(ser(mine));

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(a.coordinator.frozen, ser(mine), 'the unsaved work is the only copy and must survive');
  assert.deepEqual(disk.state.groups, [{ id: 'elsewhere' }], 'the other version must not be overwritten');
});

test('a frozen surface ignores incoming snapshots so unsaved work is not overwritten', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  const before = a.installed.length;
  assert.equal(
    a.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r9', serialized: ser({ schemaVersion: 1, groups: [], shortcuts: [] }) }),
    false,
  );
  assert.equal(a.installed.length, before);
});

test('Use latest version discards the frozen snapshot and resumes writing', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  await a.coordinator.useLatest();

  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);
  assert.equal(a.coordinator.frozen, null);
  assert.deepEqual(a.installed.at(-1).groups, [{ id: 'elsewhere' }]);
  assert.equal(a.coordinator.revision, disk.revision);
});

test('Keep my version replaces the other version, and only then', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  await a.coordinator.saveSerialized(ser(mine));

  const result = await a.coordinator.keepMine();

  assert.equal(result.ok, true);
  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(disk.state, mine);
  assert.equal(a.coordinator.frozen, null);
  assert.equal(a.channel.sent.at(-1).parentRevision, 'r1');
});

test('Keep my version losing a second race stays frozen instead of looping', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'first' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  // Another writer commits again in the window between the reload and the save.
  const racing = { ...disk };
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    const loaded = await originalLoad();
    await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'second' }], shortcuts: [] }), disk.revision);
    return loaded;
  };
  void racing;

  const result = await a.coordinator.keepMine();

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT, 'still frozen — never a retry loop');
  assert.deepEqual(JSON.parse(a.coordinator.frozen).groups, [{ id: 'mine' }]);
});

test('a surface that wins the lock later reloads from disk before it may write', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');

  await a.coordinator.start();
  const bWriting = b.coordinator.start();
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'written-by-a' }], shortcuts: [] }));
  a.coordinator.release();
  await bWriting;

  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
  assert.equal(b.coordinator.revision, disk.revision, 'B must not inherit a revision observed before it waited');
  assert.deepEqual(b.installed.at(-1).groups, [{ id: 'written-by-a' }]);
});

test('while an ownership transfer is suspended an ordinary view does not queue for the lock', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');
  await a.coordinator.start();

  b.coordinator.reserveTransfer();
  const attempted = await b.coordinator.start();

  assert.equal(attempted, null);
  assert.equal(lock.waitingCount, 0, 'a view must not sit in the queue during STOP -> ACTIVATE');
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);

  b.coordinator.completeTransfer();
  const resumed = b.coordinator.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lock.waitingCount, 1);
  a.coordinator.release();
  await resumed;
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

test('0B: a refused save freezes the newest queued local work, not the snapshot that lost', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  // The store had a newer edit queued behind the save that raced and lost.
  const newest = ser({ schemaVersion: 1, groups: [{ id: 'newest-local' }], shortcuts: [] });
  const a = surface(lock, disk, 'A', { latestQueued: newest });
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);

  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'the-one-that-lost' }], shortcuts: [] }));

  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(a.invalidations.length, 1, 'the queued generation is abandoned exactly once');
  assert.equal(a.coordinator.frozen, newest, 'Keep my version must offer the creator their latest work');
});

test('0B: Keep my version writes the newest queued work, not the losing snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const newest = ser({ schemaVersion: 1, groups: [{ id: 'newest-local' }], shortcuts: [] });
  const a = surface(lock, disk, 'A', { latestQueued: newest });
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'lost' }], shortcuts: [] }));

  await a.coordinator.keepMine();

  assert.deepEqual(disk.state.groups, [{ id: 'newest-local' }]);
});

test('0B: a malformed broadcast is ignored rather than installed', () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r1', serialized: '{not json' }), false);
  assert.equal(b.installed.length, 0);
  assert.equal(b.coordinator.revision, null, 'a rejected broadcast must not move the revision');
});

test('C1: a versioned document reports hydration only after installation', async () => {
  const order = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk({ schemaVersion: 1, groups: [{ id: 'g1' }], shortcuts: [] }),
    installDocument: () => order.push('installed'),
    onHydrated: (_snapshot, revision) => order.push(`hydrated:${revision}`),
  });

  await coordinator.start();
  assert.deepEqual(order, ['installed', 'installed', 'hydrated:r0']);
});

test('C1: failed model installation reports bounded metadata and no hydration success', async () => {
  const reports = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk(),
    installDocument: () => { throw new Error('private state bytes'); },
    onHydrated: () => reports.push(['hydrated']),
    onHydrationFailed: (...args) => reports.push(args),
  });

  await assert.rejects(coordinator.start(), /private state bytes/);
  assert.deepEqual(reports, [['install', 'model-install-failed', 'r0']]);
});

test('C1: coordinator startup can be retried after one transient versioned-load failure', async () => {
  const disk = fakeDisk();
  const loadVersioned = disk.loadVersioned.bind(disk);
  let attempts = 0;
  disk.loadVersioned = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient versioned load');
    return loadVersioned();
  };
  const candidate = surface(fakeLock(), disk, 'retry');

  await assert.rejects(candidate.coordinator.start(), /transient versioned load/);
  assert.equal(candidate.coordinator.baselineReady, false);
  await candidate.coordinator.start();
  assert.equal(candidate.coordinator.baselineReady, true);
  assert.equal(candidate.coordinator.role, SURFACE_ROLE.WRITER);
});

test('C1: malformed broadcast reports decode failure without replacing the model', () => {
  const installed = [];
  const reports = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk(),
    installDocument: (snapshot) => installed.push(snapshot),
    onHydrationFailed: (...args) => reports.push(args),
  });

  assert.equal(coordinator.receive({ type: 'committed', clientId: 'peer', revision: 'r7', serialized: '{bad' }), false);
  assert.deepEqual(installed, []);
  assert.deepEqual(reports, [['decode', 'broadcast-json-invalid', 'r7']]);
});

test('018: the reservation holds ordinary surfaces out until the designated surface owns the lock', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  const designated = surface(lock, disk, 'TARGET');
  const ordinary = surface(lock, disk, 'ORDINARY');

  await oldWriter.coordinator.start();

  // Reserved BEFORE the flush. The old writer still owns the lock, so its one
  // authorized final save is still valid at this point.
  oldWriter.coordinator.reserveTransfer();
  ordinary.coordinator.reserveTransfer();
  assert.equal(await ordinary.coordinator.start(), null, 'an ordinary surface must not queue during the handoff');
  assert.equal(lock.waitingCount, 0);

  const flush = await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'final-flush' }], shortcuts: [] }));
  assert.equal(flush.ok, true, 'the final flush must still succeed while the old writer owns the lock');

  // Only now is the lock given up, and only the designated surface may take it.
  oldWriter.coordinator.release();
  designated.coordinator.reserveTransfer();
  await designated.coordinator.start({ designated: true });

  assert.equal(designated.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(designated.installed.at(-1).groups, [{ id: 'final-flush' }], 'the new writer reloads from disk, never from cached state');

  ordinary.coordinator.completeTransfer();
  const resumed = ordinary.coordinator.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lock.waitingCount, 1, 'ordinary surfaces may queue again only after the handoff');
  designated.coordinator.release();
  await resumed;
  assert.equal(ordinary.coordinator.role, SURFACE_ROLE.WRITER);
});

test('018: a transfer aborted before release leaves the old writer still writing', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  await oldWriter.coordinator.start();

  oldWriter.coordinator.reserveTransfer();
  oldWriter.coordinator.abortTransfer();

  assert.equal(oldWriter.coordinator.role, SURFACE_ROLE.WRITER, 'ownership was never given up');
  const result = await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'still-mine' }], shortcuts: [] }));
  assert.equal(result.ok, true);
});

test('018: a transfer aborted after release still forces a disk reload before anyone writes', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  const ordinary = surface(lock, disk, 'ORDINARY');
  await oldWriter.coordinator.start();
  await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'before-abort' }], shortcuts: [] }));

  ordinary.coordinator.reserveTransfer();
  oldWriter.coordinator.release();
  // The designated surface never arrives; the handoff aborts.
  ordinary.coordinator.abortTransfer();
  await ordinary.coordinator.start();

  assert.equal(ordinary.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(ordinary.installed.at(-1).groups, [{ id: 'before-abort' }], 'election always reloads, even after an aborted transfer');
  assert.equal(ordinary.coordinator.revision, disk.revision);
});
