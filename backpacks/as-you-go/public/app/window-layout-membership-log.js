/**
 * Diagnostic ring buffer for layout membership changes.
 *
 * Why this exists: the creator can add one window and several other icons
 * disappear in the same moment - a closed-window sweep, a startup reconcile, or
 * a suppressed instance. The saved state only shows the result, so the last few
 * changes are recorded WITH the reason and the member count on each side of the
 * change, and kept inside the workspace document so the sequence can be read
 * afterwards by whoever is asked to explain it.
 *
 * Bounded to the last few entries, data-only: nothing reads it back and no
 * behaviour depends on it.
 */

export const WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT = 10;

const MEMBERSHIP_LOG_KINDS = new Set([
  'added',
  'removed',
  'closed-sweep',
  'startup-reconcile',
  'suppressed',
]);

function boundedText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.length <= limit ? value : value.slice(0, limit);
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function windowLayoutMembershipEntry({
  at = Date.now(),
  kind,
  layoutId = '',
  memberId = '',
  title = '',
  reason = '',
  source = '',
  windowInstanceId = '',
  operationId = '',
  membersBefore = null,
  membersAfter = null,
  logSequence = null,
} = {}) {
  return {
    at: Number.isFinite(at) ? at : Date.now(),
    kind: MEMBERSHIP_LOG_KINDS.has(kind) ? kind : 'unknown',
    layoutId: boundedText(layoutId, 64),
    memberId: boundedText(memberId, 64),
    title: boundedText(title, 120),
    reason: boundedText(reason, 160),
    /** WHO decided: the decision site, not the mutation. Two removals that look
     * identical here are completely different bugs depending on this. */
    source: boundedText(source, 48),
    /** The stable native identity, so a removal can be tied to a window. */
    windowInstanceId: boundedText(windowInstanceId, 32),
    /** Shared by every entry produced by one event, so one window dying in
     * three layouts reads as one cause with three effects. */
    operationId: boundedText(operationId, 48),
    membersBefore: boundedCount(membersBefore),
    membersAfter: boundedCount(membersAfter),
    /** Monotonic within the log, so same-millisecond changes stay ordered. */
    logSequence: Number.isInteger(logSequence) ? logSequence : null,
  };
}

/** Returns the new bounded log array; never mutates the given one. */
export function appendWindowLayoutMembershipEntry(log, entry) {
  const existing = Array.isArray(log) ? log : [];
  const last = existing[existing.length - 1];
  const nextSequence = Number.isInteger(last?.logSequence) ? last.logSequence + 1 : 1;
  const next = [...existing, windowLayoutMembershipEntry({ ...entry, logSequence: nextSequence })];
  return next.length <= WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT
    ? next
    : next.slice(next.length - WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT);
}

/** Unknown/legacy shapes normalize to an empty log rather than failing state. */
export function normalizeWindowLayoutMembershipLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => windowLayoutMembershipEntry(entry ?? {}))
    .slice(-WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT);
}
