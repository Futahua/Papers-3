/**
 * 019E pure target/oracle helpers (Winter). These are side-effect-free so they
 * can be unit-tested without a temp project, process, window, Electron or any
 * global input. The executable runner imports them; it must never be imported
 * as a self-test (it launches the probe).
 */

/** Synchronous boolean widget predicate (ORACLE CORRECTION 2): accepts ONLY a
 * target whose URL carries BOTH the compact-widget surface marker AND the
 * exact seeded `papers-layout-key`. An async predicate would be truthy in
 * Array.find/filter - this MUST return a boolean. */
export function isWidgetTarget(target, layoutId) {
  return Boolean(target
    && typeof target.url === 'string'
    && target.url.includes('papers-surface=compact-widget')
    && target.url.includes(`papers-layout-key=${layoutId}`));
}

/** Synchronous filter over a target list. */
export function widgetMatches(list, layoutId) {
  return (Array.isArray(list) ? list : []).filter((t) => isWidgetTarget(t, layoutId));
}

/**
 * Overlay selection (ORACLE CORRECTION 2): the pick overlay is a data: URL
 * target, but the first sandboxed-preload attempt may be destroyed/rebuilt by
 * Papers. This resolver connects to EACH candidate, keeps the first whose
 * bridge is present (`typeof window.pickOverlay === 'object'`), and closes
 * every rejected client. `connectTarget` is injected so the algorithm is
 * testable without Electron; the production runner wires it to the CDP client.
 * The caller must re-enumerate candidates for every picker session.
 */
export async function selectLiveOverlay(candidates, connectTarget) {
  for (const candidate of candidates) {
    let client = null;
    let bridge = null;
    try {
      client = await connectTarget(candidate);
      if (!client) continue;
      bridge = await client.evaluate('typeof window.pickOverlay');
    } catch {
      bridge = null;
    }
    if (bridge === 'object') return client;
    if (client) {
      try { client.close(); } catch { /* ignore */ }
    }
  }
  return null;
}

/** True when every title in `titles` is present in the persisted member list
 * (a subset-only utility; NOT sufficient for outage/recovery equality). */
export function everyPresent(titles, persisted) {
  const actual = Array.isArray(persisted) ? persisted : [];
  return (Array.isArray(titles) ? titles : []).every((title) => actual.includes(title));
}

/** EXACT member-set equality against a pre-event snapshot (019HR3): the
 * current member titles must be EXACTLY the snapshot titles - order-insensitive
 * and duplicate-safe (a missing title, an unexpected extra title, or a
 * duplicate-count mismatch all fail). This replaces the subset-only
 * `everyPresent` for the N7 outage/recovery receipts. */
export function memberSetEqual(listA, listB) {
  const a = (Array.isArray(listA) ? listA : []).slice().sort();
  const b = (Array.isArray(listB) ? listB : []).slice().sort();
  return a.length === b.length && a.every((title, index) => title === b[index]);
}

/** True when `after` is EXACTLY `list` minus `closedTitle` (one removal, every
 * other member intact). `closedTitle` need not be in `list`; the comparison is
 * exact set equality against the pre-event snapshot. */
export function membersEqualWithout(list, closedTitle, after) {
  const expected = (Array.isArray(list) ? list : []).filter((title) => title !== closedTitle);
  const actual = Array.isArray(after) ? after : [];
  return expected.length === actual.length && expected.every((title) => actual.includes(title));
}

/** 019HR2: a staged picker row PASS requires (a) the outcome flag for the row
 * kind (committed for a commit row, byteZero for a cancel row), (b) NO swallowed
 * error in the evidence, and (c) the EXACT expected hover and staged evidence.
 * Byte-zero alone must never pass a cancel row that did not prove its staged
 * removal. */
export function stagedPickPassed({ evidence, expectedKind, committed, byteZero }) {
  if (committed !== undefined && !committed) return false;
  if (byteZero !== undefined && !byteZero) return false;
  if (!evidence || evidence.error) return false;
  if (!evidence.hover || evidence.hover.kind !== expectedKind) return false;
  return Array.isArray(evidence.staged) && evidence.staged.length === 1
    && evidence.staged[0].kind === expectedKind;
}

/** Self-check of the pure oracles; returns true only when all assertions hold.
 * Callable from the unit test and from the runner's first row. */
export function oracleSelfTest() {
  const okWidget = isWidgetTarget(
    { url: 'papers-backpack://bp/_papers-open/a/public/index.html?papers-surface=compact-widget&papers-layout-key=window-layout-abc' },
    'window-layout-abc',
  ) === true;
  const okHost = isWidgetTarget({ url: '/out/renderer/index.html' }, 'window-layout-abc') === false;
  const okWorkspace = isWidgetTarget({ url: 'papers-backpack://bp/_papers-open/a/public/index.html' }, 'window-layout-abc') === false;
  const okWrongKey = isWidgetTarget(
    { url: 'papers-backpack://bp/_papers-open/a/public/index.html?papers-surface=compact-widget&papers-layout-key=window-layout-other' },
    'window-layout-abc',
  ) === false;
  const matches = widgetMatches([
    { url: 'papers-backpack://bp/_papers-open/a/public/index.html?papers-surface=compact-widget&papers-layout-key=window-layout-abc' },
    { url: '/out/renderer/index.html' },
    { url: 'papers-backpack://bp/_papers-open/a/public/index.html' },
  ], 'window-layout-abc');
  const okOneMatch = matches.length === 1;
  // 019HR2 retirement predicates: row-independent, exact set equality.
  const okEveryPresent = everyPresent(['A', 'B', 'C'], ['A', 'B', 'C']) === true
    && everyPresent(['A', 'B', 'C'], ['A', 'B']) === false;
  // 019HR3 exact-set equality: rejects missing AND extra titles, order
  // insensitive, duplicate-safe.
  const okSetEqual = memberSetEqual(['A', 'B', 'C'], ['C', 'A', 'B']) === true
    && memberSetEqual(['A', 'B', 'C'], ['A', 'B']) === false
    && memberSetEqual(['A', 'B', 'C'], ['A', 'B', 'C', 'D']) === false
    && memberSetEqual(['A', 'B', 'B'], ['A', 'B']) === false;
  const okMinusB = membersEqualWithout(['A', 'B', 'C', 'D'], 'B', ['A', 'C', 'D']) === true
    && membersEqualWithout(['A', 'B', 'C'], 'B', ['A', 'C']) === true
    && membersEqualWithout(['A', 'B', 'C'], 'B', ['A', 'C', 'D']) === false;
  // 019HR2 staged-pass predicate: exact evidence, no swallowed error.
  const okStagedPass = stagedPickPassed({ evidence: { hover: { kind: 'add' }, staged: [{ kind: 'add' }] }, expectedKind: 'add', committed: true }) === true
    && stagedPickPassed({ evidence: { hover: { kind: 'remove' }, staged: [{ kind: 'remove' }] }, expectedKind: 'remove', byteZero: true }) === true
    && stagedPickPassed({ evidence: { hover: { kind: 'remove' }, staged: [], error: 'boom' }, expectedKind: 'remove', byteZero: true }) === false
    && stagedPickPassed({ evidence: { hover: { kind: 'add' }, staged: [{ kind: 'add' }] }, expectedKind: 'add', byteZero: false }) === false;
  return okWidget && okHost && okWorkspace && okWrongKey && okOneMatch
    && okEveryPresent && okSetEqual && okMinusB && okStagedPass;
}

/**
 * 019HR overlay selection: keep the FIRST live overlay whose SCREEN bounds
 * (read via `readBounds(client)`) contain the given screen point, and close
 * every rejected client. The overlay page converts client -> screen by adding
 * its own display origin (`state.display.x/y`), so a picker row must dispatch
 * LOCAL coordinates relative to the EXACT overlay that contains the target.
 * Returns `{ client, bounds }` or null. `readBounds` is injected so the
 * algorithm is unit-testable without a window; the runner wires it to read
 * the overlay's screen geometry.
 */
export async function selectOverlayContaining(candidates, connectTarget, point, readBounds) {
  for (const candidate of candidates) {
    let client = null;
    let bounds = null;
    try {
      client = await connectTarget(candidate);
      if (!client) continue;
      const bridge = await client.evaluate('typeof window.pickOverlay');
      if (bridge !== 'object') {
        try { client.close(); } catch { /* ignore */ }
        continue;
      }
      bounds = await readBounds(client);
    } catch {
      bounds = null;
    }
    if (bounds
      && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
      && point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height) {
      return { client, bounds };
    }
    if (client) {
      try { client.close(); } catch { /* ignore */ }
    }
  }
  return null;
}
