import assert from 'node:assert/strict';
import test from 'node:test';

import { windowLayoutMemberKey } from './public/app/window-layout-runtime.js';
import {
  createWindowLayoutIconHydration,
  reconcileWindowLayoutIconSnapshotCache,
  WINDOW_LAYOUT_ICON_REARM_COOLDOWN_MS,
  windowLayoutIconCacheEntry,
  windowLayoutIconFromCache,
} from './public/app/window-layout-icon-hydration.js';

const W1 = 'W0123456789abcdef';
const W2 = 'W1111111111111111';
const member = (id, windowInstanceId) => ({ id, descriptor: { windowInstanceId } });

test('icon snapshot cache evicts changed W with null icon and keeps same-W state updates', () => {
  const icons = new Map([[windowLayoutMemberKey('L1', 'm1'), windowLayoutIconCacheEntry(member('m1', W1), 'data:old')]]);
  reconcileWindowLayoutIconSnapshotCache(icons, 'L1', [{ id: 'm1', windowInstanceId: W1, icon: null, state: 'minimized' }], windowLayoutMemberKey);
  assert.equal(icons.get(windowLayoutMemberKey('L1', 'm1')).icon, 'data:old');
  reconcileWindowLayoutIconSnapshotCache(icons, 'L1', [{ id: 'm1', windowInstanceId: W2, icon: null }], windowLayoutMemberKey);
  assert.equal(icons.has(windowLayoutMemberKey('L1', 'm1')), false);
  icons.set(windowLayoutMemberKey('L1', 'm1'), windowLayoutIconCacheEntry(member('m1', W2), 'data:replaced'));
  reconcileWindowLayoutIconSnapshotCache(icons, 'L1', [], windowLayoutMemberKey);
  assert.equal(icons.has(windowLayoutMemberKey('L1', 'm1')), false, 'a missing member is evicted from the snapshot');
});

test('widget snapshot replaces cached icon only with artwork for its current identity', () => {
  const icons = new Map([[windowLayoutMemberKey('L1', 'm1'), windowLayoutIconCacheEntry(member('m1', W1), 'data:old')]]);
  reconcileWindowLayoutIconSnapshotCache(icons, 'L1', [{ id: 'm1', windowInstanceId: W2, icon: 'data:new' }], windowLayoutMemberKey);
  assert.deepEqual(icons.get(windowLayoutMemberKey('L1', 'm1')), { windowInstanceId: W2, icon: 'data:new' });
  assert.equal(windowLayoutIconFromCache(member('m1', W1), icons.get(windowLayoutMemberKey('L1', 'm1'))), null);
});

test('failed full-list request retries without spending candidate-miss attempts', async () => {
  const current = new Map([['m1', member('m1', W1)]]);
  const callbacks = [];
  let requests = 0;
  const icons = new Map();
  const hydration = createWindowLayoutIconHydration({
    getMember: (_layoutId, id) => current.get(id),
    getCachedEntry: (_layoutId, id) => icons.get(id),
    requestCandidates: async () => {
      requests += 1;
      return requests === 1 ? { outcome: 'failed' } : { outcome: 'success', candidates: [{ windowInstanceId: W1, icon: 'data:exact' }] };
    },
    cacheIcon: (_layoutId, id, _instanceId, icon, m) => icons.set(id, windowLayoutIconCacheEntry(m, icon)),
    schedule: (callback) => callbacks.push(callback),
  });
  hydration.queue('L1', 'm1');
  await callbacks.shift()();
  await callbacks.shift()();
  assert.equal(requests, 2);
  assert.equal(icons.get('m1').icon, 'data:exact');
});

test('queue cannot restart exhausted full-list budget before cooldown, then re-arms for helper recovery', async () => {
  const current = new Map([['m1', member('m1', W1)]]);
  const callbacks = [];
  let requests = 0;
  let now = 1000;
  const icons = new Map();
  const hydration = createWindowLayoutIconHydration({
    getMember: (_layoutId, id) => current.get(id),
    getCachedEntry: (_layoutId, id) => icons.get(id),
    requestCandidates: async () => {
      requests += 1;
      return requests <= 3
        ? { outcome: 'failed' }
        : { outcome: 'success', candidates: [{ windowInstanceId: W1, icon: 'data:recovered' }] };
    },
    cacheIcon: (_layoutId, id, _instanceId, icon, currentMember) => {
      icons.set(id, windowLayoutIconCacheEntry(currentMember, icon));
    },
    schedule: (callback) => callbacks.push(callback),
    now: () => now,
  });
  assert.equal(hydration.queue('L1', 'm1'), true);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await callbacks.shift()();
    if (attempt < 2) assert.equal(callbacks.length, 1, 'each of the first two failures schedules one bounded retry');
  }
  assert.equal(requests, 3);
  assert.equal(callbacks.length, 0);
  for (let retry = 0; retry < 10; retry += 1) {
    assert.equal(hydration.queue('L1', 'm1'), false, 'same identity remains exhausted');
  }
  assert.equal(requests, 3, 'external queue calls cannot restart the exhausted outcome budget');
  assert.equal(callbacks.length, 0);
  now += WINDOW_LAYOUT_ICON_REARM_COOLDOWN_MS - 1;
  assert.equal(hydration.queue('L1', 'm1'), false, 'the cooldown does not expire early');
  assert.equal(requests, 3);
  now += 1;
  assert.equal(hydration.queue('L1', 'm1'), true, 'an explicit queue after cooldown can re-arm the bounded budget');
  await callbacks.shift()();
  assert.equal(requests, 4);
  assert.equal(icons.get('m1').icon, 'data:recovered');
});

test('same-W queue during the third in-flight failure is dropped through cooldown', async () => {
  const current = new Map([['m1', member('m1', W1)]]);
  const callbacks = [];
  let requests = 0;
  let now = 1000;
  let releaseThird;
  const icons = new Map();
  const hydration = createWindowLayoutIconHydration({
    getMember: (_layoutId, id) => current.get(id),
    getCachedEntry: (_layoutId, id) => icons.get(id),
    requestCandidates: () => {
      requests += 1;
      if (requests === 3) return new Promise((resolve) => { releaseThird = resolve; });
      return requests < 3
        ? Promise.resolve({ outcome: 'failed' })
        : Promise.resolve({ outcome: 'success', candidates: [{ windowInstanceId: W1, icon: 'data:recovered' }] });
    },
    cacheIcon: (_layoutId, id, _instanceId, icon, currentMember) => {
      icons.set(id, windowLayoutIconCacheEntry(currentMember, icon));
    },
    schedule: (callback) => callbacks.push(callback),
    now: () => now,
  });

  hydration.queue('L1', 'm1');
  await callbacks.shift()();
  await callbacks.shift()();
  const thirdRun = callbacks.shift()();
  assert.equal(requests, 3, 'the third helper request is still pending');
  assert.equal(hydration.queue('L1', 'm1'), true, 'a render may enqueue while the third request is in flight');
  assert.equal(callbacks.length, 1, 'the render enqueue scheduled a drain');

  releaseThird({ outcome: 'failed' });
  await thirdRun;
  await callbacks.shift()();
  assert.equal(requests, 3, 'the already scheduled drain cannot call the helper after exhaustion');
  assert.equal(callbacks.length, 0, 'the exhausted same-W item was dropped');

  for (let retry = 0; retry < 5; retry += 1) {
    assert.equal(hydration.queue('L1', 'm1'), false, 'queue calls remain blocked during cooldown');
  }
  assert.equal(requests, 3, 'cooldown queue calls make no helper requests');
  now += WINDOW_LAYOUT_ICON_REARM_COOLDOWN_MS;
  assert.equal(hydration.queue('L1', 'm1'), true, 'an explicit queue after cooldown re-arms the identity');
  await callbacks.shift()();
  assert.equal(requests, 4);
  assert.equal(icons.get('m1').icon, 'data:recovered');
});

test('icon result is discarded if member W changes while candidate RPC is pending', async () => {
  const current = new Map([['m1', member('m1', W1)]]);
  const icons = new Map();
  let release;
  const pendingRequest = new Promise((resolve) => { release = resolve; });
  const callbacks = [];
  const hydration = createWindowLayoutIconHydration({
    getMember: (_layoutId, id) => current.get(id),
    getCachedEntry: (_layoutId, id) => icons.get(id),
    requestCandidates: () => pendingRequest,
    cacheIcon: (_layoutId, id, _instanceId, icon, m) => icons.set(id, windowLayoutIconCacheEntry(m, icon)),
    schedule: (callback) => callbacks.push(callback),
  });
  hydration.queue('L1', 'm1');
  const running = callbacks.shift()();
  current.set('m1', member('m1', W2));
  release({ outcome: 'success', candidates: [{ windowInstanceId: W1, icon: 'data:stale' }] });
  await running;
  assert.equal(icons.has('m1'), false);
});

test('a W1 request requeues and hydrates the current W2 identity after the old response settles', async () => {
  const current = new Map([['m1', member('m1', W1)]]);
  const callbacks = [];
  const icons = new Map();
  let releaseFirst;
  let requests = 0;
  const hydration = createWindowLayoutIconHydration({
    getMember: (_layoutId, id) => current.get(id),
    getCachedEntry: (_layoutId, id) => icons.get(id),
    requestCandidates: () => {
      requests += 1;
      if (requests === 1) return new Promise((resolve) => { releaseFirst = resolve; });
      return Promise.resolve({ outcome: 'success', candidates: [{ windowInstanceId: W2, icon: 'data:W2' }] });
    },
    cacheIcon: (_layoutId, id, _instanceId, icon, expectedMember) => {
      icons.set(id, windowLayoutIconCacheEntry(expectedMember, icon));
    },
    schedule: (callback) => callbacks.push(callback),
  });

  hydration.queue('L1', 'm1');
  const firstRun = callbacks.shift()();
  current.set('m1', member('m1', W2));
  releaseFirst({ outcome: 'success', candidates: [{ windowInstanceId: W1, icon: 'data:stale-W1' }] });
  await firstRun;

  assert.equal(icons.has('m1'), false, 'late W1 art is discarded');
  assert.equal(callbacks.length, 1, 'the current W2 identity is queued for hydration');
  await callbacks.shift()();
  assert.equal(requests, 2);
  assert.deepEqual(icons.get('m1'), { windowInstanceId: W2, icon: 'data:W2' });
});
