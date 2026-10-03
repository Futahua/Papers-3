// 019B (RoketPuncha lane): deterministic latency/call-order tests for the
// bounded concurrent group-action scheduler (public/app/window-layout-actions.js).
// No invented real-ms claims: every ordering fact is proven by gated call
// logging. The second suite drives the PRODUCTION group-action runner through
// runBoundedConcurrent exactly the way the entry's windowLayoutGroupAction does
// (prewarm + bounded concurrent + per-member retry + final abort barrier), to
// prove typed per-member results survive concurrency, stale bindings still
// retry in place, and a superseded result (read-only handoff mid-batch) aborts
// scheduling before any commit.
import assert from 'node:assert/strict';
import test from 'node:test';

import { runBoundedConcurrent } from './public/app/window-layout-actions.js';
import { createWindowLayoutGroupActionRunner, toggleWindowLayoutMemberVisibility } from './public/app/window-layout-detached.js';

const never = () => false;

test('a click that can toggle atomically never observes first', async () => {
  // The helper decides and acts inside one request. The old path observed in the
  // page, carried the answer back over IPC and returned to mutate - and that
  // observation also started a thumbnail capture on the click's own lane.
  const calls = [];
  const host = {
    observeWindowCapability: async () => {
      calls.push('observe');
      return { outcome: 'success', observation: { state: 'normal', bounds: null } };
    },
    toggleWindowCapability: async () => {
      calls.push('toggle');
      return { outcome: 'success', action: 'minimize', observation: { state: 'normal', bounds: null } };
    },
    applyWindowCapability: async () => {
      calls.push('apply');
      return { outcome: 'success' };
    },
    minimizeWindowCapability: async () => {
      calls.push('minimize');
      return { outcome: 'success' };
    },
  };
  const result = await toggleWindowLayoutMemberVisibility({
    host,
    capability: { version: 1, bindingId: 'member-capability' },
    member: { bounds: { x: 0, y: 0, width: 100, height: 100 } },
    isReadOnly: never,
  });
  assert.equal(result.action, 'minimize');
  assert.deepEqual(calls, ['toggle']);
});

test('an atomic toggle that restores still applies the remembered rectangle', async () => {
  const calls = [];
  const host = {
    toggleWindowCapability: async () => {
      calls.push('toggle');
      return { outcome: 'success', action: 'restore', observation: { state: 'minimized', bounds: null } };
    },
    applyWindowCapability: async (_capability, bounds) => {
      calls.push(['apply', bounds]);
      return { outcome: 'success' };
    },
    observeWindowCapability: async () => {
      calls.push('observe');
      return { outcome: 'success', observation: { state: 'normal', bounds: null } };
    },
  };
  const bounds = { x: 10, y: 20, width: 800, height: 600 };
  const result = await toggleWindowLayoutMemberVisibility({
    host,
    capability: { version: 1, bindingId: 'member-capability' },
    member: { bounds },
    isReadOnly: never,
  });
  assert.equal(result.action, 'restore');
  assert.deepEqual(calls, ['toggle', ['apply', bounds]]);
});

test('member icon restores at saved bounds through the same restore operation as Restore all', async () => {
  const calls = [];
  const host = {
    observeWindowCapability: async () => {
      calls.push('observe');
      return { outcome: 'success', observation: { state: 'minimized', bounds: null } };
    },
    applyWindowCapability: async (_capability, bounds) => {
      calls.push(['apply', bounds]);
      return { outcome: 'success' };
    },
    restoreWindowCapability: async () => {
      calls.push('restore');
      return { outcome: 'success' };
    },
    minimizeWindowCapability: async () => {
      calls.push('minimize');
      return { outcome: 'success' };
    },
  };
  const bounds = { x: 10, y: 20, width: 800, height: 600 };
  const result = await toggleWindowLayoutMemberVisibility({
    host,
    capability: { version: 1, bindingId: 'member-capability' },
    member: { bounds },
    isReadOnly: never,
  });
  assert.equal(result.action, 'restore');
  assert.deepEqual(calls, ['observe', ['apply', bounds], 'restore']);
});

test('member icon minimizes a live window instead of restoring it', async () => {
  const calls = [];
  const host = {
    observeWindowCapability: async () => ({ outcome: 'success', observation: { state: 'normal', bounds: null } }),
    applyWindowCapability: async () => { calls.push('apply'); return { outcome: 'success' }; },
    restoreWindowCapability: async () => { calls.push('restore'); return { outcome: 'success' }; },
    minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
  };
  const result = await toggleWindowLayoutMemberVisibility({
    host,
    capability: { version: 1, bindingId: 'member-capability' },
    member: { bounds: null },
    isReadOnly: never,
  });
  assert.equal(result.action, 'minimize');
  assert.deepEqual(calls, ['minimize']);
});

test('member toggle retries one failed cold resolve before observing and mutating', async () => {
  const calls = [];
  let resolves = 0;
  const result = await toggleWindowLayoutMemberVisibility({
    host: {
      observeWindowCapability: async (capability) => { calls.push(['observe', capability.bindingId]); return { outcome: 'success', observation: { state: 'normal' } }; },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
    capability: null,
    member: { bounds: null },
    isReadOnly: never,
    resolveCapability: async () => {
      resolves += 1;
      return resolves === 1 ? { outcome: 'helper-unavailable' } : { outcome: 'success', capability: { bindingId: 'fresh' } };
    },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(resolves, 2);
  assert.deepEqual(calls, [['observe', 'fresh'], 'minimize']);
});

test('member toggle re-resolves once after cold observe failure, then mutates once', async () => {
  const calls = [];
  const result = await toggleWindowLayoutMemberVisibility({
    host: {
      observeWindowCapability: async (capability) => {
        calls.push(['observe', capability.bindingId]);
        if (calls.length === 1) throw new Error('read-only RPC failed');
        return { outcome: 'success', observation: { state: 'normal' } };
      },
      minimizeWindowCapability: async () => { calls.push('minimize'); return { outcome: 'success' }; },
    },
    capability: { bindingId: 'cold' },
    member: { bounds: null },
    isReadOnly: never,
    resolveCapability: async () => ({ outcome: 'success', capability: { bindingId: 'fresh' } }),
  });
  assert.equal(result.outcome, 'success');
  assert.deepEqual(calls, [['observe', 'cold'], ['observe', 'fresh'], 'minimize']);
});

test('uncertain mutation response is never replayed', async () => {
  let mutations = 0;
  let resolves = 0;
  const result = await toggleWindowLayoutMemberVisibility({
    host: {
      observeWindowCapability: async () => ({ outcome: 'success', observation: { state: 'normal' } }),
      minimizeWindowCapability: async () => { mutations += 1; throw new Error('response lost after dispatch'); },
    },
    capability: { bindingId: 'warm' },
    member: { bounds: null },
    isReadOnly: never,
    resolveCapability: async () => { resolves += 1; return { outcome: 'success', capability: { bindingId: 'fresh' } }; },
  });
  assert.equal(result.outcome, 'uncertain');
  assert.equal(mutations, 1);
  assert.equal(resolves, 0);
});

test('runs every item and returns results in item order', async () => {
  const calls = [];
  const results = await runBoundedConcurrent([1, 2, 3], 4, async (n) => {
    calls.push(n);
    await Promise.resolve();
    return n * 10;
  }, never);
  assert.deepEqual(results, [10, 20, 30]);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('limit=1 is strictly sequential', async () => {
  const order = [];
  const results = await runBoundedConcurrent([10, 20, 30], 1, async (n) => {
    order.push(`start:${n}`);
    await Promise.resolve();
    order.push(`end:${n}`);
    return n;
  }, never);
  assert.deepEqual(order, ['start:10', 'end:10', 'start:20', 'end:20', 'start:30', 'end:30']);
  assert.deepEqual(results, [10, 20, 30]);
});

test('bounded concurrency: in-flight never exceeds the limit', async () => {
  const started = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const pool = runBoundedConcurrent([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    started.push(n);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await hold;
    inFlight -= 1;
    return n;
  }, never);
  while (started.length < 3) await new Promise((resolve) => setImmediate(resolve));
  release();
  await pool;
  assert.ok(maxInFlight <= 3, `expected <= 3 in flight, saw ${maxInFlight}`);
  assert.equal(started.length, 8);
});

test('concurrent scheduling: later items start before the first settles', async () => {
  const order = [];
  const startedOther = [];
  let release;
  const holdFirst = new Promise((resolve) => { release = resolve; });
  const pool = runBoundedConcurrent(['a', 'b', 'c'], 4, async (item) => {
    order.push(`start:${item}`);
    if (item === 'a') {
      await holdFirst;
    } else {
      startedOther.push(item);
      await Promise.resolve();
    }
    order.push(`end:${item}`);
    return item;
  }, never);
  while (startedOther.length === 0) await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pool;
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(startedOther, ['b', 'c']);
  assert.ok(order.indexOf('start:b') < order.indexOf('end:a'), 'b must start while a is still in flight');
  assert.ok(order.indexOf('start:c') < order.indexOf('end:a'), 'c must start while a is still in flight');
});

test('superseded abort stops further scheduling; already-started items settle', async () => {
  const order = [];
  let release;
  const holdFirst = new Promise((resolve) => { release = resolve; });
  const pool = runBoundedConcurrent(['a', 'b', 'c', 'd'], 2, async (item) => {
    order.push(`start:${item}`);
    if (item === 'a') await holdFirst;
    order.push(`end:${item}`);
    return item === 'b' ? 'superseded' : 'ok';
  }, (result) => result === 'superseded');
  while (order.filter((step) => step.startsWith('start:')).length < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  release();
  const results = await pool;
  assert.deepEqual(order.filter((step) => step.startsWith('start:')), ['start:a', 'start:b']);
  assert.equal(results[0], 'ok');
  assert.equal(results[1], 'superseded');
  assert.equal(results[2], undefined, 'c must never be scheduled after the abort');
  assert.equal(results[3], undefined, 'd must never be scheduled after the abort');
});

test('limit=1: a superseded first result aborts before any other item starts', async () => {
  const order = [];
  const results = await runBoundedConcurrent(['a', 'b', 'c'], 1, async (item) => {
    order.push(item);
    return item === 'a' ? 'superseded' : 'ok';
  }, (result) => result === 'superseded');
  assert.deepEqual(order, ['a']);
  assert.equal(results[0], 'superseded');
  assert.equal(results[1], undefined);
});

test('empty input resolves with an empty array', async () => {
  assert.deepEqual(await runBoundedConcurrent([], 4, async () => null, never), []);
});

test('rejects invalid input', async () => {
  assert.throws(() => runBoundedConcurrent([1], 0, async () => 1, never), TypeError);
  assert.throws(() => runBoundedConcurrent([1], 4, 'not-a-function', never), TypeError);
  assert.throws(() => runBoundedConcurrent('not-an-array', 4, async () => 1, never), TypeError);
});

// ---- group-action scheduling through the PRODUCTION runner -----------------

function makeMembers(titles) {
  return titles.map((title) => ({
    id: title,
    descriptor: { title },
    bounds: { x: 0, y: 0, width: 100, height: 80 },
    state: 'normal',
  }));
}

function runnerFakeHost({ gatedMemberIds = [], hold = null, flakyObserve = new Set(), readOnlyRef }) {
  const calls = [];
  const held = new Set(gatedMemberIds);
  const observeCounts = new Map();
  const resolveCounts = new Map();
  const host = {
    resolveWindowDescriptor: async (descriptor) => {
      const title = descriptor.title;
      const count = (resolveCounts.get(title) ?? 0) + 1;
      resolveCounts.set(title, count);
      calls.push(`resolve:${title}:${count}`);
      return { outcome: 'success', capability: { id: title, title } };
    },
    observeWindowCapability: async (capability) => {
      calls.push(`observe:${capability.id}`);
      if (held.has(capability.id)) {
        held.delete(capability.id);
        if (hold) await hold;
      }
      const count = (observeCounts.get(capability.id) ?? 0) + 1;
      observeCounts.set(capability.id, count);
      if (flakyObserve.has(capability.id) && count === 1) return { outcome: 'missing' };
      return { outcome: 'success', observation: { state: 'normal', bounds: { x: 0, y: 0, width: 100, height: 80 } } };
    },
    minimizeWindowCapability: async (capability) => {
      calls.push(`minimize:${capability.id}`);
      return { outcome: 'success' };
    },
    restoreWindowCapability: async (capability) => {
      calls.push(`restore:${capability.id}`);
      return { outcome: 'success' };
    },
    applyWindowCapability: async (capability) => {
      calls.push(`apply:${capability.id}`);
      return { outcome: 'success' };
    },
  };
  return { host, calls };
}

// Mirrors the entry's windowLayoutGroupAction performance seam: prewarm every
// capability concurrently, run the bounded batch with a per-member retry on
// missing, then gate the commit behind the final read-only/abort barrier.
function runEntryStyleGroup({ host, members, action, limit, readOnlyRef }) {
  const results = [];
  const patches = [];
  const cache = new Map();
  const runner = createWindowLayoutGroupActionRunner({
    isReadOnly: () => readOnlyRef.current,
    host,
  });
  const resolve = async (member) => {
    if (cache.has(member.id)) return cache.get(member.id);
    const resolved = await host.resolveWindowDescriptor(member.descriptor);
    if (resolved.outcome !== 'success') return null;
    cache.set(member.id, resolved.capability);
    return resolved.capability;
  };
  const retryMissing = async (member) => {
    cache.delete(member.id);
    const capability = await resolve(member);
    if (readOnlyRef.current) return { superseded: true };
    if (!capability) return { missing: true };
    return { capability };
  };
  return (async () => {
    await Promise.all(members.map((member) => resolve(member)));
    if (readOnlyRef.current) return { committed: false, results, patches };
    await runBoundedConcurrent(members, limit, async (member) => {
      let capability = await resolve(member);
      if (readOnlyRef.current) return 'superseded';
      if (!capability) {
        const retried = await retryMissing(member);
        if (retried.superseded) return 'superseded';
        if (retried.missing) {
          results.push({ memberId: member.id, outcome: 'missing' });
          return 'missing';
        }
        capability = retried.capability;
      }
      let outcome = await runner.runMember(capability, member, action);
      if (outcome === 'missing') {
        const retried = await retryMissing(member);
        if (retried.superseded) return 'superseded';
        if (retried.missing) {
          results.push({ memberId: member.id, outcome: 'missing' });
          return 'missing';
        }
        outcome = await runner.runMember(retried.capability, member, action);
      }
      if (outcome === 'superseded') return outcome;
      if (outcome !== 'success') return outcome;
      results.push({ memberId: member.id, outcome });
      patches.push({ memberId: member.id, state: action === 'minimize' ? 'minimized' : 'normal' });
      return outcome;
    }, (result) => result === 'superseded');
    if (readOnlyRef.current || runner.aborted()) return { committed: false, results, patches };
    return { committed: true, results, patches };
  })();
}

test('group minimize: bounded concurrency overlaps host calls; typed results preserved', async () => {
  const readOnlyRef = { current: false };
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const { host, calls } = runnerFakeHost({ gatedMemberIds: ['A', 'B'], hold, readOnlyRef });
  const members = makeMembers(['A', 'B', 'C', 'D']);
  const group = runEntryStyleGroup({ host, members, action: 'minimize', limit: 2, readOnlyRef });
  while (!(calls.includes('observe:A') && calls.includes('observe:B'))) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(!calls.includes('observe:C'), 'limit 2: C must not start while A and B are in flight');
  assert.ok(!calls.includes('minimize:A'), 'A must still be in observe when B observes');
  release();
  const outcome = await group;
  assert.ok(outcome.committed);
  assert.deepEqual(
    [...outcome.results].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    ['A', 'B', 'C', 'D'].map((memberId) => ({ memberId, outcome: 'success' })),
  );
  assert.equal(outcome.patches.length, 4);
  assert.ok(calls.indexOf('observe:B') < calls.indexOf('minimize:A'), 'B observes while A is still in flight');
});

test('read-only handoff mid-batch aborts scheduling before commit', async () => {
  const readOnlyRef = { current: false };
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const { host, calls } = runnerFakeHost({ gatedMemberIds: ['A', 'B'], hold, readOnlyRef });
  const members = makeMembers(['A', 'B', 'C', 'D']);
  const group = runEntryStyleGroup({ host, members, action: 'minimize', limit: 2, readOnlyRef });
  while (!(calls.includes('observe:A') && calls.includes('observe:B'))) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  readOnlyRef.current = true;
  release();
  const outcome = await group;
  assert.ok(!outcome.committed, 'the final abort barrier must block the commit');
  assert.deepEqual(outcome.results, [], 'superseded members must not add typed results');
  assert.ok(calls.includes('observe:A') && calls.includes('observe:B'));
  const mutateCalls = calls.filter((c) => c.startsWith('minimize:')
    || c.startsWith('restore:') || c.startsWith('apply:'));
  assert.deepEqual(mutateCalls, [], 'no member mutates after the handoff');
  assert.ok(!calls.includes('observe:C') && !calls.includes('observe:D'), 'no members scheduled after the abort');
});

test('stale binding retry: a missing first observe re-resolves and retries in place', async () => {
  const readOnlyRef = { current: false };
  const { host, calls } = runnerFakeHost({ flakyObserve: new Set(['S']), readOnlyRef });
  const members = makeMembers(['S', 'T']);
  const outcome = await runEntryStyleGroup({ host, members, action: 'minimize', limit: 4, readOnlyRef });
  assert.ok(outcome.committed);
  assert.deepEqual(
    [...outcome.results].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    [
      { memberId: 'S', outcome: 'success' },
      { memberId: 'T', outcome: 'success' },
    ],
  );
  assert.equal(calls.filter((c) => c === 'observe:S').length, 2, 'observe:S once (missing), then once more after retry');
  assert.equal(calls.filter((c) => c.startsWith('resolve:S')).length, 2, 'the stale binding is dropped and re-resolved once');
  assert.ok(calls.includes('minimize:S'), 'the retried run minimizes S');
});
