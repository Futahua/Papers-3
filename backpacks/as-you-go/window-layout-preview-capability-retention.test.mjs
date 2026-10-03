// Creator: ping-ponging between two member icons was slow on every switch,
// while ten clicks on one icon stayed fast.
//
// A member's minimize/restore is part of the widget's RENDER identity, so every
// successful toggle re-rendered the card - and the card unconditionally cleared
// every cached preview capability. Each click therefore re-cooled BOTH members,
// so the next hover had to pay a fresh desktop list plus a bind/observe on the
// same strictly-serial helper the click itself needs. Staying on one icon
// started no new hover pipeline and so stayed fast.
//
// A capability names a WINDOW. Minimizing a window does not make it a different
// window, so retention is keyed on descriptor identity instead. These tests pin
// that, and pin the invalidation that retention now makes necessary.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutMemberPreview } from './public/app/window-layout-preview.js';

const immediate = (fn) => { fn(); return 1; };
const noop = () => {};

function harness({ thumbnailOutcome = 'success' } = {}) {
  const resolved = [];
  const missing = [];
  // Stands in for the widget's capability cache with identity-keyed retention.
  const cache = new Map();
  const identities = new Map();

  const identityOf = (member) => JSON.stringify([
    member.descriptor.version, member.descriptor.title, member.descriptor.executableFingerprint,
  ]);

  function evictStale(snapshot) {
    const next = new Map(snapshot.members.map((m) => [m.id, identityOf(m)]));
    for (const key of [...cache.keys()]) {
      const identity = next.get(key);
      if (identity === undefined || identity !== identities.get(key)) {
        cache.delete(key);
        identities.delete(key);
      }
    }
  }

  let snapshot = null;
  const controller = createWindowLayoutMemberPreview({
    resolveCapability: async (_layoutId, memberId) => {
      if (cache.has(memberId)) return cache.get(memberId);
      const member = snapshot.members.find((m) => m.id === memberId);
      if (!member) return null;
      resolved.push(memberId);
      const capability = { version: 1, bindingId: `binding-${memberId}` };
      cache.set(memberId, capability);
      identities.set(memberId, identityOf(member));
      return capability;
    },
    requestThumbnail: async () => (thumbnailOutcome === 'success'
      ? { outcome: 'success', imageUrl: 'data:image/png;base64,AAAA', width: 240, height: 135 }
      : { outcome: thumbnailOutcome }),
    debounceMs: 0,
    setTimeoutFn: immediate,
    clearTimeoutFn: noop,
    setPreviewImage: noop,
    clearPreview: noop,
    onCapabilityMissing: (_layoutId, memberId) => {
      missing.push(memberId);
      cache.delete(memberId);
      identities.delete(memberId);
    },
  });

  return {
    resolved,
    missing,
    cacheSize: () => cache.size,
    install(next) { snapshot = next; evictStale(next); },
    async hover(memberId) {
      controller.schedule('layout-1', memberId);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const member = (id, title, state) => ({
  id,
  state,
  descriptor: { version: 1, title, executableFingerprint: `fp-${title}` },
});

const snapshotOf = (a, b) => ({ id: 'layout-1', members: [a, b] });

test('a member toggling state does not re-cool any capability', async () => {
  const h = harness();
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'normal')));
  await h.hover('m1');
  await h.hover('m2');
  assert.deepEqual(h.resolved, ['m1', 'm2']);

  // The creator's ping-pong: toggle m1, then hover m2, then toggle m2, then m1.
  h.install(snapshotOf(member('m1', 'Alpha', 'minimized'), member('m2', 'Beta', 'normal')));
  await h.hover('m2');
  h.install(snapshotOf(member('m1', 'Alpha', 'minimized'), member('m2', 'Beta', 'minimized')));
  await h.hover('m1');
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'minimized')));
  await h.hover('m2');

  assert.deepEqual(h.resolved, ['m1', 'm2'], 'each member resolved exactly once across the whole ping-pong');
});

test('a re-identified window IS re-resolved, and only that one', async () => {
  const h = harness();
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'normal')));
  await h.hover('m1');
  await h.hover('m2');
  assert.deepEqual(h.resolved, ['m1', 'm2']);

  // m2's window is now a different window under the same member id.
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Gamma', 'normal')));
  await h.hover('m1');
  await h.hover('m2');
  assert.deepEqual(h.resolved, ['m1', 'm2', 'm2'], 'only the re-identified member resolved again');
});

test('a member leaving the layout drops its cached capability', async () => {
  const h = harness();
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'normal')));
  await h.hover('m1');
  await h.hover('m2');
  assert.equal(h.cacheSize(), 2);

  h.install({ id: 'layout-1', members: [member('m1', 'Alpha', 'normal')] });
  assert.equal(h.cacheSize(), 1, 'the removed member is not retained');
});

test('a capability Papers reports missing is evicted, not retried forever', async () => {
  // The blanket clear used to guarantee eventual recovery after a helper
  // restart replaced the tokens. Retaining capabilities means that recovery has
  // to be explicit, or every later preview retries the same dead token.
  const h = harness({ thumbnailOutcome: 'missing' });
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'normal')));
  await h.hover('m1');
  assert.deepEqual(h.missing, ['m1']);
  assert.equal(h.cacheSize(), 0, 'the dead capability was dropped');

  await h.hover('m1');
  assert.deepEqual(h.resolved, ['m1', 'm1'], 'the next hover resolves a fresh capability');
});

test('an ordinary failed capture does NOT evict a good capability', async () => {
  const h = harness({ thumbnailOutcome: 'failed' });
  h.install(snapshotOf(member('m1', 'Alpha', 'normal'), member('m2', 'Beta', 'normal')));
  await h.hover('m1');
  await h.hover('m1');
  assert.deepEqual(h.missing, [], 'a transient capture failure is not a missing window');
  assert.deepEqual(h.resolved, ['m1'], 'the capability stayed warm');
});
