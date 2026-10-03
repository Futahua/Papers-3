import { windowLayoutMemberIcon } from './window-layout-member-icon.js';

const MAX_ATTEMPTS_PER_OUTCOME = 3;
const RETRY_DELAYS_MS = [250, 1000];
export const WINDOW_LAYOUT_ICON_REARM_COOLDOWN_MS = 5000;

function memberWindowInstanceId(member) {
  const value = member?.windowInstanceId ?? member?.descriptor?.windowInstanceId;
  return typeof value === 'string' && /^W[0-9a-f]{16}$/i.test(value) ? value : null;
}

export function windowLayoutIconCacheEntry(member, icon) {
  const windowInstanceId = memberWindowInstanceId(member);
  return windowInstanceId !== null && typeof icon === 'string' && icon.length > 0
    ? { windowInstanceId, icon }
    : null;
}

export function windowLayoutIconFromCache(member, entry) {
  const windowInstanceId = memberWindowInstanceId(member);
  return windowInstanceId !== null
    && entry?.windowInstanceId === windowInstanceId
    && typeof entry.icon === 'string'
    && entry.icon.length > 0
    ? entry.icon
    : null;
}

/** Reconcile one bounded widget snapshot while preserving only artwork for the
 * same native identity. A null icon on a state-only update keeps same-W art;
 * a changed/missing W always evicts prior art before rendering. */
export function reconcileWindowLayoutIconSnapshotCache(icons, layoutId, members, memberKey) {
  if (!(icons instanceof Map) || typeof memberKey !== 'function') return;
  const prefix = `${layoutId}\u0000`;
  const snapshot = Array.isArray(members) ? members : [];
  const keys = new Set(snapshot.map((member) => memberKey(layoutId, member?.id)));
  for (const key of [...icons.keys()]) {
    if (key.startsWith(prefix) && !keys.has(key)) icons.delete(key);
  }
  for (const member of snapshot) {
    const key = memberKey(layoutId, member?.id);
    const previous = icons.get(key);
    if (previous?.windowInstanceId !== memberWindowInstanceId(member)) icons.delete(key);
    if (typeof member?.icon === 'string' && member.icon.length > 0) {
      const entry = windowLayoutIconCacheEntry(member, member.icon);
      if (entry) icons.set(key, entry);
    }
  }
}

/**
 * Bounded exact-identity icon refresh. Request failures and successful lists
 * with a missing/ambiguous member match have separate retry budgets, so a
 * failed whole-list RPC never consumes the member's candidate-miss budget.
 */
export function createWindowLayoutIconHydration({
  getMember,
  getCachedEntry,
  requestCandidates,
  cacheIcon,
  onResolved = () => undefined,
  isReadOnly = () => false,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  now = () => Date.now(),
}) {
  if (typeof getMember !== 'function'
    || typeof getCachedEntry !== 'function'
    || typeof requestCandidates !== 'function'
    || typeof cacheIcon !== 'function'
    || typeof now !== 'function') {
    throw new TypeError('complete window-layout icon hydration wiring is required');
  }

  const pending = new Map();
  const attempts = new Map();
  let scheduled = false;
  let running = false;

  function attemptKey(layoutId, memberId, windowInstanceId) {
    return JSON.stringify([layoutId, memberId, windowInstanceId]);
  }

  function sameCurrentMember(item) {
    const current = getMember(item.layoutId, item.memberId);
    return memberWindowInstanceId(current) === item.windowInstanceId ? current : null;
  }

  function scheduleRun(delayMs) {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      return refresh();
    }, delayMs);
  }

  function queue(layoutId, memberId) {
    const member = getMember(layoutId, memberId);
    const windowInstanceId = memberWindowInstanceId(member);
    if (windowInstanceId === null || windowLayoutIconFromCache(member, getCachedEntry(layoutId, memberId))) {
      return false;
    }
    const key = attemptKey(layoutId, memberId, windowInstanceId);
    const counts = attempts.get(key) ?? { requestFailures: 0, candidateMisses: 0 };
    // A queue request must not reset an outcome budget once it is spent. The
    // other counter remains independent for reporting/retry classification, but
    // no new list request can distinguish another outcome after either budget
    // has reached its bound.
    if (counts.requestFailures >= MAX_ATTEMPTS_PER_OUTCOME
      || counts.candidateMisses >= MAX_ATTEMPTS_PER_OUTCOME) {
      if (!Number.isFinite(counts.cooldownUntil) || now() < counts.cooldownUntil) return false;
      // A render/queue storm cannot bypass the cooldown; after it expires one
      // explicit queue starts a fresh bounded cycle so a recovered helper can
      // supply the same native identity without requiring W to change.
      attempts.set(key, { requestFailures: 0, candidateMisses: 0 });
    }
    pending.set(key, { key, layoutId, memberId, windowInstanceId });
    scheduleRun(0);
    return true;
  }

  function retry(item, kind) {
    if (!sameCurrentMember(item)) {
      attempts.delete(item.key);
      const current = getMember(item.layoutId, item.memberId);
      if (current) queue(item.layoutId, item.memberId);
      return;
    }
    const counts = attempts.get(item.key) ?? { requestFailures: 0, candidateMisses: 0 };
    const count = counts[kind] + 1;
    counts[kind] = count;
    attempts.set(item.key, counts);
    if (count >= MAX_ATTEMPTS_PER_OUTCOME) {
      counts.cooldownUntil = now() + WINDOW_LAYOUT_ICON_REARM_COOLDOWN_MS;
      attempts.set(item.key, counts);
      // A render can enqueue this identity while the last bounded request is
      // still in flight. Once that request exhausts its outcome budget, discard
      // the duplicate so a zero-delay drain cannot bypass the cooldown.
      pending.delete(item.key);
      return;
    }
    pending.set(item.key, item);
    scheduleRun(RETRY_DELAYS_MS[count - 1] ?? RETRY_DELAYS_MS.at(-1));
  }

  async function refresh() {
    if (running || pending.size === 0 || isReadOnly()) return;
    running = true;
    const batch = new Map();
    for (const [key, item] of pending) {
      const counts = attempts.get(key);
      const exhausted = counts?.requestFailures >= MAX_ATTEMPTS_PER_OUTCOME
        || counts?.candidateMisses >= MAX_ATTEMPTS_PER_OUTCOME;
      if (exhausted) continue;
      batch.set(key, item);
    }
    pending.clear();
    if (batch.size === 0) {
      running = false;
      return;
    }
    let result = null;
    try {
      result = await requestCandidates();
    } catch {
      result = null;
    }
    if (isReadOnly()) {
      running = false;
      return;
    }
    const successfulList = result?.outcome === 'success' && Array.isArray(result.candidates);
    if (!successfulList) {
      for (const item of batch.values()) retry(item, 'requestFailures');
      running = false;
      if (pending.size > 0 && !scheduled) scheduleRun(0);
      return;
    }

    const resolved = [];
    for (const item of batch.values()) {
      const current = sameCurrentMember(item);
      if (!current) {
        attempts.delete(item.key);
        if (getMember(item.layoutId, item.memberId)) queue(item.layoutId, item.memberId);
        continue;
      }
      if (windowLayoutIconFromCache(current, getCachedEntry(item.layoutId, item.memberId))) continue;
      const icon = windowLayoutMemberIcon(current, result.candidates);
      if (!icon) {
        retry(item, 'candidateMisses');
        continue;
      }
      // Re-read after the awaited list request and immediately before storing:
      // member id alone is not enough when Auto replaces its native window.
      const stillCurrent = sameCurrentMember(item);
      if (!stillCurrent) {
        attempts.delete(item.key);
        if (getMember(item.layoutId, item.memberId)) queue(item.layoutId, item.memberId);
        continue;
      }
      cacheIcon(item.layoutId, item.memberId, item.windowInstanceId, icon, stillCurrent);
      attempts.delete(item.key);
      resolved.push({ layoutId: item.layoutId, memberId: item.memberId, windowInstanceId: item.windowInstanceId });
    }
    if (resolved.length > 0) onResolved(resolved);
    running = false;
    if (pending.size > 0 && !scheduled) scheduleRun(0);
  }

  return Object.freeze({ queue, refresh });
}
