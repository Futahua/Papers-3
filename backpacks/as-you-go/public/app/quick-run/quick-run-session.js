/**
 * Quick Run — the session: what is open, what is typed, what is shown, what is highlighted.
 *
 * This is section 1.1's behaviour as a pure state machine, with no markup at all. The surface that draws
 * it is a later stage, and the rules here are the ones the contract fixes in as many words:
 *
 * - opening shows one **empty** line, no result rows, filter All, no highlight — there is no
 *   empty-query home screen, so an empty query shows nothing rather than everything;
 * - results first appear after the first non-empty query;
 * - Escape closes the session and leaves **no** result action behind: closing produces a closed session
 *   and nothing else, so no create/move/launch/select/navigate/persist can ride along with it;
 * - closing clears the query, the highlight, the rows and the filter — a reopened session starts empty
 *   rather than resuming a previous search.
 * - when an action finds its target gone, `quickRunSessionRefreshed` rebuilds the snapshot from the current
 *   state, keeping the query and the filter and moving the highlight to the nearest survivor, so a dead row
 *   is replaced rather than left to be hit again.
 * - the rows it holds are **at most QUICK_RUN_MAX_PAINTED_ROWS of the matches**, because one keystroke can
 *   rank thousands of them and the surface paints every row it is handed. `totalRows` keeps the honest match
 *   count and `capped` says the list on screen is a prefix of it.
 *
 * The rows it narrows are the ones quick-run-search.js builds, ranked by quick-run-index.js, filtered by
 * quick-run-types.js: this module owns only the session around them.
 */
import { quickRunRows } from './quick-run-search.js';
import { quickRunResults } from './quick-run-index.js';
import { chipsFor, nextAvailableFilter, normaliseFilter, resolveFilter } from './quick-run-types.js';

/**
 * How many matches one session may hold — and therefore how many rows the surface may paint at once.
 *
 * This is a measured number, not a taste. `quick-run-integrated-perf.mjs` (STAGE 14.1/14.2's acceptance
 * instrument) measures keystroke-to-results-DOM-commit latency in the real renderer on a synthetic
 * 20,000-occurrence workspace, and groups the samples by how many rows that commit painted:
 *
 * ```
 *   1-200         p95  2.6-6.1 ms    0 samples over one frame
 *   201-1,000     p95 10.8 ms        0 over
 *   1,001-3,000   p95 23.7 ms        8 over
 *   3,001-12,000  p95 58.2 ms       30 of 30 over
 *   12,001+       p95 47.8 ms        6 over
 * ```
 *
 * The contract's gate is p95 <= 16 ms, and the surface paints every row `quickRunRowViews` maps, so the
 * cost of a keystroke is set by the size of the ranked result set rather than by the query. One keystroke
 * really does reach four figures: the fuzzy subsequence tier (quick-run-index.js) matches a single letter
 * against a large slice of a 20k corpus — "a" for the query "archive d" is 12,213 rows. 200 is the largest
 * bucket that is honestly inside the budget: it measured p95 6.1 ms, leaving roughly 2.6x margin for a busy
 * machine, where 201-1,000 is already at 10.8 ms and 1,001-3,000 misses outright.
 *
 * The cap is applied at the session rather than in the DOM layer because `rows` is the single thing three
 * consumers share: what the surface paints, what `quickRunSessionAfterArrow` walks, and what the highlight
 * is chosen from. Bounding it here bounds all three together, so navigation cannot step past the painted
 * list and a highlight can never land on a row that is not on screen. Nothing else is capped: `chipsFor`
 * still sees every match, the filter-fallback rule still sees every match, and activation still revalidates
 * by stable result key against the current workspace state (quick-run-activation.js).
 */
export const QUICK_RUN_MAX_PAINTED_ROWS = 200;

/** A closed session: the state a surface draws nothing for. */
export function closedQuickRunSession() {
  return {
    open: false,
    query: '',
    filter: 'All',
    rows: [],
    totalRows: 0,
    capped: false,
    chips: [],
    highlightKey: null,
    fellBack: false,
  };
}

function withResults(base, query, filter) {
  const needle = query.trim();
  if (needle === '') {
    // No empty-query home screen: an empty query shows nothing, and no chips either.
    return {
      ...base,
      query,
      filter: normaliseFilter(filter),
      rows: [],
      totalRows: 0,
      capped: false,
      chips: [],
      highlightKey: null,
      fellBack: false,
    };
  }
  const matched = quickRunResults(base.allRows, needle);
  const resolved = resolveFilter(matched, filter);
  // The cap, and the only cap: everything above this line still sees every match, so the chips the reader is
  // offered and the filter's fallback decision describe the whole result set, while what is held here - and
  // therefore painted, walked by the arrows and highlighted - is at most QUICK_RUN_MAX_PAINTED_ROWS of it.
  const painted = resolved.rows.slice(0, QUICK_RUN_MAX_PAINTED_ROWS);
  return {
    ...base,
    query,
    filter: resolved.filter,
    fellBack: resolved.fellBack,
    rows: painted,
    totalRows: resolved.rows.length,
    capped: resolved.rows.length > painted.length,
    chips: chipsFor(matched),
    highlightKey: painted.length === 0 ? null : painted[0].resultKey,
  };
}

/** Opening Quick Run: one empty line, nothing else. */
export function openQuickRunSession(state) {
  const base = { ...closedQuickRunSession(), open: true, allRows: quickRunRows(state) };
  return withResults(base, '', 'All');
}

/** A keystroke into the search line. */
export function quickRunSessionWithQuery(session, query) {
  if (!session.open) return session;
  return withResults(session, query, session.filter);
}

/** Tab (forward) and Shift+Tab (backward) over the type filters, re-resolving the rows. */
export function quickRunSessionWithFilter(session, filter) {
  if (!session.open) return session;
  return withResults(session, session.query, filter);
}

/**
 * Tab and Shift+Tab as the AUTHOR ruled: over the chips that are actually offered, skipping the types the
 * current query has emptied. The session already knows them - `chips` is All plus one per type with a
 * match - so the traversal needs no second opinion about what is available.
 */
export function quickRunSessionAfterTab(session, direction = 1) {
  if (!session.open) return session;
  const offered = Array.isArray(session.chips) ? session.chips : [];
  if (offered.length < 2) return session;
  return quickRunSessionWithFilter(session, nextAvailableFilter(session.filter, direction, offered));
}

/** ArrowUp and ArrowDown: one row at a time, clamped at both ends. */
export function quickRunSessionAfterArrow(session, delta) {
  return quickRunSessionAfterScroll(session, delta < 0 ? -1 : 1);
}

/**
 * The same movement, by a count of rows, for a caller whose step is more than one row.
 *
 * The wheel is that caller, and the arithmetic is deliberately here rather than in the surface: how far the
 * highlight travels is session knowledge (the highlighted row is a member of the painted list), while how
 * many rows a wheel notch is worth is layout knowledge the surface owns. Clamped, never wrapped, so a flick
 * cannot leave the reader somewhere the arrow keys would not go.
 */
export function quickRunSessionAfterScroll(session, rows) {
  if (!session.open || session.rows.length === 0) return session;
  const step = Number.isFinite(rows) ? Math.trunc(rows) : 0;
  if (step === 0) return session;
  const index = session.rows.findIndex((row) => row.resultKey === session.highlightKey);
  const from = index === -1 ? 0 : index;
  const next = Math.min(Math.max(from + step, 0), session.rows.length - 1);
  return { ...session, highlightKey: session.rows[next].resultKey };
}

/** Closing: everything the session held is gone, and nothing else is produced. */
export function closeQuickRunSession() {
  return closedQuickRunSession();
}

/**
 * The same session rebuilt from the current workspace state, after an action found its target gone.
 *
 * This is the recovery half of section 5. Re-reading the target protects the *action* - a stale payload is
 * never executed - but on its own it left the dead row on screen for the reader to hit again, which is a
 * loop rather than an answer. So the snapshot is rebuilt from the state that just refused the row, the
 * query and the filter the reader chose are kept, and the highlight moves to the **nearest survivor**: the
 * row that now occupies the position the vanished one held, or the last row when the list got shorter.
 *
 * The filter is re-resolved rather than forced, so a filter the new state has emptied falls back to All by
 * the same rule a keystroke uses. Rows are still capped, so this cannot paint more than a session may hold.
 */
export function quickRunSessionRefreshed(session, state) {
  if (!session?.open) return session;
  const previousIndex = session.rows.findIndex((row) => row.resultKey === session.highlightKey);
  const wanted = previousIndex === -1 ? 0 : previousIndex;
  const refreshed = withResults({ ...session, allRows: quickRunRows(state) }, session.query, session.filter);
  if (refreshed.rows.length === 0) return refreshed;
  return { ...refreshed, highlightKey: refreshed.rows[Math.min(wanted, refreshed.rows.length - 1)].resultKey };
}