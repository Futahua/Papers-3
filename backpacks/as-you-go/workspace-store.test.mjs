import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
function createHarness({ normalize = (s) => s } = {}) {
  let state = { items: ['root'] };
  const saved = [];
  const statuses = [];
  const prepares = [];
  const afterCommits = [];

  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => { saved.push(snapshot); },
    normalizeState: normalize,
    setStatus: (text) => statuses.push(text),
    prepare: (next) => {
      prepares.push(next);
      return { ...next, prepared: true };
    },
    afterCommit: () => { afterCommits.push(state); },
  });

  return {
    store, saved, statuses, prepares, afterCommits,
    getState: () => state,
  };
}

test('commit installs the prepared state and persists it', async () => {
  const h = createHarness();
  const ok = await h.store.commit({ items: ['a'] }, {});
  assert.equal(ok, true);
  assert.deepEqual(h.getState(), { items: ['a'], prepared: true });
  assert.equal(h.prepares.length, 1);
  assert.deepEqual(JSON.parse(h.saved[0]), { items: ['a'], prepared: true });
  assert.equal(h.statuses[h.statuses.length - 1], '');
});

test('commit pushes history and clears redo on a fresh edit', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  await h.store.commit({ items: ['b'] }, {});
  assert.equal(h.store.canUndo(), true);
  assert.equal(h.store.canRedo(), false);
});

test('undo restores the previous state and makes it redoable', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  await h.store.commit({ items: ['b'] }, {});
  await h.store.undo();
  assert.deepEqual(h.getState().items, ['a']);
  assert.equal(h.store.canRedo(), true);
  await h.store.redo();
  assert.deepEqual(h.getState().items, ['b']);
});

test('commit reports failure and status when persist rejects', async () => {
  let state = { items: ['root'] };
  const statuses = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: (text) => statuses.push(text),
  });
  const ok = await store.commit({ items: ['x'] }, {});
  assert.equal(ok, false);
  assert.match(statuses[statuses.length - 1], /disk full/);
});

test('commit reports failure when persistence resolves an explicit refusal', async () => {
  let state = { items: ['root'] };
  const statuses = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => ({ ok: false, code: 'STALE_REVISION' }),
    normalizeState: (s) => s,
    setStatus: (text) => statuses.push(text),
  });
  const ok = await store.commit({ items: ['x'] }, {});
  assert.equal(ok, false);
  assert.match(statuses.at(-1), /changed somewhere else/);
  assert.doesNotMatch(statuses.at(-1), /STALE_REVISION/);
});

test('durable automatic commits propagate rebase metadata and reject dropped saves', async () => {
  let state = { items: ['root'] };
  let receivedMetadata = null;
  const statuses = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (_snapshot, metadata) => {
      receivedMetadata = metadata;
      return { ok: true, dropped: true, revision: 'r2' };
    },
    normalizeState: (value) => value,
    setStatus: (text) => statuses.push(text),
  });
  const ok = await store.commit({ items: ['auto-member'] }, {
    saveMetadata: { rebaseAutomaticSave: true },
    requireDurable: true,
  });
  assert.equal(ok, false, 'a coordinator drop is not durable success for an Auto membership');
  assert.equal(receivedMetadata.rebaseAutomaticSave, true);
  assert.deepEqual(state, { items: ['auto-member'] }, "commit keeps its optimistic state for the tracker's targeted retry");
  assert.notEqual(statuses.at(-1), '', 'a dropped automatic save is not announced as persisted');
});

test('a durable commit rejects an unacknowledged forwarded save', async () => {
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => ({ ok: true, forwarded: true, revision: 'r0' }),
    normalizeState: (s) => s,
  });

  const ok = await store.commit({ items: ['layout'] }, { requireDurable: true });
  assert.equal(ok, false, 'an optimistic forwarded envelope is not durable success');
});

test('a durable commit accepts a forwarded save only after the writer acknowledgement', async () => {
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => ({
      ok: true,
      forwarded: true,
      revision: 'r0',
      acknowledgement: Promise.resolve({ ok: true, revision: 'r1' }),
    }),
    normalizeState: (s) => s,
  });

  const ok = await store.commit({ items: ['layout'] }, { requireDurable: true });
  assert.equal(ok, true);
});

test('a failed follower acknowledgement invalidates dependent queued edits', async () => {
  let state = { items: ['root'] };
  let rejectAck;
  const statuses = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => ({
      ok: true,
      forwarded: true,
      acknowledgement: new Promise((resolve) => { rejectAck = resolve; }),
    }),
    normalizeState: (s) => s,
    setStatus: (text) => statuses.push(text),
  });
  const first = store.commit({ items: ['A'] }, {});
  const second = store.commit({ items: ['A', 'B'] }, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  rejectAck({ ok: false, code: 'WRITER_ACK_TIMEOUT' });
  assert.equal(await first, false);
  assert.equal(await second, false, 'a dependent queued edit must not report success after its base fails');
  assert.match(statuses.at(-1), /superseded|did not answer in time/);
  assert.doesNotMatch(statuses.at(-1), /WRITER_ACK_TIMEOUT/);
});

test('an authoritative install becomes the immediate base for the next save', async () => {
  let state = { items: ['root'] };
  let observedMetadata;
  const authoritative = JSON.stringify({ items: ['peer'] });
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (_snapshot, metadata) => { observedMetadata = metadata; },
    normalizeState: (s) => s,
  });
  store.install({ items: ['peer'] }, { authoritativeSerialized: authoritative });
  await store.save({ items: ['local'] });
  assert.equal(observedMetadata.baseSerialized, authoritative);
});

test('replace installs without touching history or persisting', () => {
  const h = createHarness();
  const result = h.store.replace({ items: ['z'] });
  assert.deepEqual(result.items, ['z']);
  assert.equal(h.saved.length, 0);
  assert.equal(h.store.canUndo(), false);
});

test('install normalizes the initial state', () => {
  let state = null;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => ({ ...s, normalized: true }),
    setStatus: () => {},
  });
  store.install({ items: ['loaded'] });
  assert.deepEqual(state, { items: ['loaded'], normalized: true });
});

test('installExternal normalizes and invalidates stale snapshot undo/redo history', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['local'] }, {});
  assert.equal(h.store.canUndo(), true);
  h.store.installExternal({ items: ['peer'] });
  assert.deepEqual(h.getState(), { items: ['peer'] });
  assert.equal(h.store.canUndo(), false);
  assert.equal(h.store.canRedo(), false);
});

test('afterCommit runs after the new state is installed', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  assert.deepEqual(h.afterCommits, [{ items: ['a'], prepared: true }]);
});


test('commit clears session selection and passes the session to prepare', async () => {
  let state = { items: ['root'] };
  let preparedSession = null;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    prepare: (next, session) => {
      preparedSession = session;
      return next;
    },
  });
  store.setSelection(['a', 'b']);
  await store.commit({ items: ['next'] }, {});
  assert.equal(store.getSession().selected.size, 0);
  assert.equal(preparedSession, store.getSession());
});

test('explicit session operations drive selection and clipboard', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  store.setSelection(['a', 'b']);
  assert.deepEqual([...store.getSession().selected], ['a', 'b']);
  store.addToSelection('c');
  assert.ok(store.getSession().selected.has('c'));
  store.removeFromSelection('a');
  assert.ok(!store.getSession().selected.has('a'));
  store.clearSelection();
  assert.equal(store.getSession().selected.size, 0);
  store.setSelectionAnchor('z');
  assert.equal(store.getSession().selectionAnchor, 'z');
  store.setClipboard({ mode: 'copy', ids: ['a'] });
  assert.equal(store.getSession().clipboard.mode, 'copy');
});

test('setNavigation and graph expansion operations update the session', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  store.setNavigation({ currentId: 'folder-1', binMode: true });
  assert.equal(store.getSession().currentId, 'folder-1');
  assert.equal(store.getSession().binMode, true);

  store.setGraphExpanded(['g1']);
  assert.deepEqual([...store.getSession().graphExpanded], ['g1']);
  store.toggleGraphExpanded('g2');
  assert.ok(store.getSession().graphExpanded.has('g2'));
  store.toggleGraphExpanded('g1');
  assert.ok(!store.getSession().graphExpanded.has('g1'));
});

test('initialSession seeds navigation and bin session state', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { currentId: 'ROOT', binMode: true, binCurrentId: 'bin-deep' },
  });
  assert.equal(store.getSession().currentId, 'ROOT');
  assert.equal(store.getSession().binMode, true);
  assert.equal(store.getSession().binCurrentId, 'bin-deep');
});

test('a throwing normalizeState leaves the current selection untouched', async () => {
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: () => { throw new Error('bad state'); },
    setStatus: () => {},
  });
  const session = store.getSession();
  session.selected.add('keep-me');
  await assert.rejects(
    async () => store.commit({ items: ['broken'] }, {}),
    /bad state/,
  );
  // Selection survived the failed commit: it was cleared only after the
  // initial normalization succeeded.
  assert.ok(session.selected.has('keep-me'));
});

test('save queue waits for an in-flight save before starting the next one', async () => {
  const order = [];
  let state = {};
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted = false;
  let secondStarted = false;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => {
      if (!firstStarted) {
        firstStarted = true;
        order.push('a');
        await firstGate;
        return;
      }
      if (!secondStarted) {
        secondStarted = true;
        order.push('b');
      }
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const first = store.save({ tag: 'a' });
  const second = store.save({ tag: 'b' });
  await Promise.resolve();
  assert.equal(secondStarted, false, 'save B must not start before save A resolves');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a', 'b']);
});

test('save queue runs a queued save even after the previous save rejects', async () => {
  const order = [];
  let state = {};
  let shouldFail = true;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('disk full');
      }
      order.push(JSON.parse(snapshot).tag);
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  // Queue save B before save A rejects, so recovery is exercised through the
  // queue rather than a fresh call.
  const first = store.save({ tag: 'a' });
  const second = store.save({ tag: 'b' });
  await assert.rejects(first, /disk full/);
  await second;
  assert.deepEqual(order, ['b']);
});

test('flush waits for queued saves and reports the latest persistence failure', async () => {
  let release;
  let fail = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => {
      await gate;
      if (fail) throw new Error('close disk failure');
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const queued = store.save({ tag: 'queued' });
  const pending = store.flush();
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'flush must wait behind an in-flight save');
  fail = true;
  release();
  await assert.rejects(queued, /close disk failure/);
  await assert.rejects(pending, /close disk failure/);
});

test('flush preserves a failed generation behind a superseded later save', async () => {
  let rejectAck;
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => ({
      forwarded: true,
      acknowledgement: new Promise((resolve) => { rejectAck = resolve; }),
    }),
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const first = store.save({ tag: 'document' });
  const later = store.save({ tag: 'rest' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pendingFlush = store.flush();
  rejectAck({ ok: false, code: 'WRITER_DIED' });
  await assert.rejects(first, /went away before confirming/);
  await later;
  await assert.rejects(pendingFlush, /went away before confirming/);
});

test('set selection is independent of item selection', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });

  store.setSelection(['i1', 'i2']);
  store.setSelectedSets(['s1']);
  store.addToSelectedSets('s2');
  assert.deepEqual([...store.getSession().selectedSets], ['s1', 's2']);
  assert.deepEqual([...store.getSession().selected], ['i1', 'i2'], 'items untouched');

  // The separation is what lets Delete mean two things safely: clearing one
  // selection must never quietly empty the other.
  store.clearSelectedSets();
  assert.deepEqual([...store.getSession().selectedSets], []);
  assert.deepEqual([...store.getSession().selected], ['i1', 'i2'], 'still untouched');

  store.clearSelection();
  store.setSelectedSets(['s3']);
  assert.deepEqual([...store.getSession().selected], []);
  assert.deepEqual([...store.getSession().selectedSets], ['s3'], 'and the reverse holds');
});

test('the session trail-expanded set is distinct from ordinary graph expansion', () => {
  const h = createHarness();
  // The session exposes the active trail-expansion set for the current
  // view context (Assignment 007), separate from graphExpanded.
  h.store.setGraphExpanded(['g1']);
  h.store.setTrailExpanded(['g2', 'g3']);
  assert.deepEqual([...h.store.getSession().trailExpanded], ['g2', 'g3']);
  assert.deepEqual([...h.store.getSession().graphExpanded], ['g1'], 'ordinary expansion untouched');
  h.store.setTrailExpanded([]);
  assert.deepEqual([...h.store.getSession().trailExpanded], []);
});

/** 0B: a store whose document-write authority can be withdrawn, as a
 * non-writer surface's store is. */
function createGatedHarness() {
  let state = { items: ['root'] };
  let mayMutate = true;
  const saved = [];
  const blocked = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => { saved.push(snapshot); },
    normalizeState: (s) => s,
    canMutateDocument: () => mayMutate,
    onMutationBlocked: (reason) => blocked.push(reason),
  });
  return {
    store, saved, blocked,
    getState: () => state,
    revoke: () => { mayMutate = false; },
    grant: () => { mayMutate = true; },
  };
}

test('0B: a blocked commit changes neither the document nor history, and does not persist', async () => {
  const h = createGatedHarness();
  await h.store.commit({ items: ['a'] }, {});
  h.revoke();

  const result = await h.store.commit({ items: ['blocked'] }, {});

  assert.equal(result, false);
  assert.deepEqual(h.getState(), { items: ['a'] }, 'the document must not change');
  assert.equal(h.saved.length, 1, 'a refused edit must not reach persistence');
  assert.deepEqual(h.blocked, ['commit']);
});

test('0B: a blocked edit leaves no history behind to resurface after promotion', async () => {
  const h = createGatedHarness();
  await h.store.commit({ items: ['a'] }, {});
  h.revoke();

  // The view tries to edit while read-only. Refused.
  await h.store.commit({ items: ['speculative'] }, {});
  assert.equal(h.store.canUndo(), true, 'only the one legitimate edit is in history');

  // It is promoted to writer and the authoritative document is installed.
  h.grant();
  h.store.install({ items: ['from-disk'] });

  // Nothing speculative may reappear, and undo must not walk back into it.
  assert.deepEqual(h.getState(), { items: ['from-disk'] });
  await h.store.undo();
  assert.notDeepEqual(h.getState(), { items: ['speculative'] });
  // Undo after promotion legitimately commits and saves; what must never
  // appear in anything written is the edit that was refused.
  assert.equal(
    h.saved.some((snapshot) => snapshot.includes('speculative')),
    false,
    'the refused edit must never reach disk, before or after promotion',
  );
});

test('0B: replace is refused and reports the current document unchanged', async () => {
  const h = createGatedHarness();
  h.revoke();
  const returned = h.store.replace({ items: ['nope'] });
  assert.deepEqual(returned, { items: ['root'] });
  assert.deepEqual(h.getState(), { items: ['root'] });
  assert.deepEqual(h.blocked, ['replace']);
});

test('0B: undo and redo are refused while write authority is withdrawn', async () => {
  const h = createGatedHarness();
  await h.store.commit({ items: ['a'] }, {});
  await h.store.commit({ items: ['b'] }, {});
  h.revoke();

  await h.store.undo();
  assert.deepEqual(h.getState(), { items: ['b'] });
  await h.store.redo();
  assert.deepEqual(h.getState(), { items: ['b'] });
  assert.deepEqual(h.blocked, ['undo', 'redo']);
});

test('0B: install stays allowed so a view can follow the writer', async () => {
  const h = createGatedHarness();
  h.revoke();
  h.store.install({ items: ['from-the-writer'] });
  assert.deepEqual(h.getState(), { items: ['from-the-writer'] });
  assert.deepEqual(h.blocked, [], 'following the writer is not a blocked mutation');
});

test('0B: session-only changes stay allowed in a view', async () => {
  const h = createGatedHarness();
  h.revoke();
  h.store.setNavigation({ currentId: 'elsewhere' });
  h.store.setSelection(['x']);
  h.store.toggleGraphExpanded('g');
  assert.equal(h.store.getSession().currentId, 'elsewhere');
  assert.deepEqual([...h.store.getSession().selected], ['x']);
  assert.deepEqual(h.blocked, [], 'navigating and selecting are not document mutations');
});

test('0B: invalidating the save generation abandons queued saves without persisting them', async () => {
  const h = createGatedHarness();
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const persisted = [];
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => { persisted.push(snapshot); await gate; },
    normalizeState: (s) => s,
  });
  void h;

  const first = store.save({ items: ['A'] });
  const queuedB = store.save({ items: ['B'] });
  const queuedC = store.save({ items: ['C'] });

  // A must genuinely be in flight before the conflict arrives — that is the
  // sequence being defended against, and a generation check cannot save a job
  // that already called persist.
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(persisted.length, 1, 'A is in flight');

  // A loses its compare-and-set; B and C are still queued and were built on
  // the same superseded document.
  const latest = store.invalidatePendingSaves();
  assert.equal(JSON.parse(latest).items[0], 'C', 'the newest queued snapshot is what the creator would keep');

  releaseFirst();
  await Promise.all([first, queuedB, queuedC]);

  assert.deepEqual(persisted.map((s) => JSON.parse(s).items[0]), ['A'], 'B and C must never reach persistence');
});

test('0B: a save queued after invalidation belongs to the fresh generation and does persist', async () => {
  const persisted = [];
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => { persisted.push(snapshot); },
    normalizeState: (s) => s,
  });

  const stale = store.save({ items: ['old-generation'] });
  store.invalidatePendingSaves();
  await stale;

  await store.save({ items: ['after-recovery'] });

  assert.deepEqual(persisted.map((s) => JSON.parse(s).items[0]), ['after-recovery']);
});

test('0B: invalidating twice reports nothing the second time', () => {
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
  });
  store.save({ items: ['A'] });
  assert.equal(JSON.parse(store.invalidatePendingSaves()).items[0], 'A');
  assert.equal(store.invalidatePendingSaves(), null);
});
