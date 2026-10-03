// The paint cap, and the four things it is not allowed to change.
//
// `quick-run-session.js` holds at most QUICK_RUN_MAX_PAINTED_ROWS rows, because the surface paints every row
// it is handed and one keystroke can rank thousands of them (the measured basis is in the constant's own
// comment, and `quick-run-integrated-perf.mjs` is the instrument that produced it). The session's own test
// file holds the arithmetic of the cap; this file holds the contract *around* it, one test per rule, so a
// later change that quietly widens the cap's blast radius fails here by name:
//
//   1. the painted rows are the head of the ranked match set, and never more than the cap;
//   2. the chips still describe every match, not the painted ones;
//   3. ArrowUp/ArrowDown stay inside the painted rows and the highlight is always one of them;
//   4. Enter is unchanged: it revalidates by stable result key against the current workspace, so a row the
//      cap did not paint is still exactly as actionable - and exactly as refuse-able - as it ever was;
//   5. an empty query still shows nothing, and the filter-fallback rule is untouched;
//   6. a query under the cap paints every match and says nothing about a cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_RUN_MAX_PAINTED_ROWS,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionWithFilter,
  quickRunSessionWithQuery,
} from './public/app/quick-run/quick-run-session.js';
import { quickRunRows } from './public/app/quick-run/quick-run-search.js';
import { quickRunResults } from './public/app/quick-run/quick-run-index.js';
import { quickRunCapNotice, quickRunChipViews } from './public/app/quick-run/quick-run-presentation.js';
import { planQuickRunActivation, revalidateQuickRunRow } from './public/app/quick-run/quick-run-activation.js';
import { mountQuickRun, paintQuickRunSurface } from './public/app/quick-run/quick-run-surface.js';

/** 300 prefix-matching shortcuts, three layout members and one folder that matches a word, not a prefix. */
function crowdedState() {
  const shortcuts = [];
  for (let index = 0; index < 300; index += 1) {
    shortcuts.push({
      id: `s-${index}`,
      name: `Kestrel ${index}`,
      target: `C:/corpus/kestrel-${index}.md`,
      placements: [{ id: `p-${index}`, parentId: 'g-root', order: index + 1 }],
    });
  }
  return {
    groups: [
      { id: 'g-root', parentId: 'root', name: 'Workspace' },
      { id: 'g-docs', parentId: 'g-root', name: 'Docs Kestrel' },
    ],
    shortcuts,
    windowLayouts: [
      {
        id: 'l-1',
        parentId: 'g-root',
        name: 'Focus',
        arrangement: {
          members: [1, 2, 3].map((n) => ({ id: `m-${n}`, descriptor: { title: `Kestrel Console ${n}` } })),
        },
      },
    ],
  };
}

const STATE = crowdedState();
const typed = () => quickRunSessionWithQuery(openQuickRunSession(STATE), 'kestrel');

test('the painted rows are the head of the independently ranked match set, and never more than the cap', () => {
  const session = typed();
  // Re-derived here from the workspace rather than read out of the session: this is what makes "the first
  // 200" an assertion about the ranking instead of an assertion about the session agreeing with itself.
  const ranked = quickRunResults(quickRunRows(STATE), 'kestrel');
  assert.ok(ranked.length > QUICK_RUN_MAX_PAINTED_ROWS, 'the fixture really does overflow the cap');
  assert.equal(session.totalRows, ranked.length);
  assert.deepEqual(
    session.rows.map((row) => row.resultKey),
    ranked.slice(0, QUICK_RUN_MAX_PAINTED_ROWS).map((row) => row.resultKey),
  );
  assert.equal(session.capped, true);
});

test('the chips still describe every match, including the types the cap did not paint', () => {
  const session = typed();
  assert.deepEqual(session.chips, ['All', 'Folders', 'Shortcuts', 'Layout Items']);
  // The folder and the layout members rank below the prefix-matching shortcuts and are therefore past the
  // cap - the chips offer their types anyway, because the chips answer "what did my query match".
  const paintedTypes = new Set(session.rows.map((row) => row.type));
  assert.deepEqual([...paintedTypes], ['shortcut']);
  assert.deepEqual(quickRunChipViews(session).map((chip) => chip.label), session.chips);
});

test('ArrowUp and ArrowDown stay inside the painted rows, and the highlight is always painted', () => {
  const cursor = typed();
  const painted = new Set(cursor.rows.map((row) => row.resultKey));
  assert.equal(
    quickRunSessionAfterArrow(cursor, -1).highlightKey,
    cursor.rows[0].resultKey,
    'ArrowUp clamps at the first painted row',
  );
  let walking = cursor;
  for (let step = 0; step <= QUICK_RUN_MAX_PAINTED_ROWS + 40; step += 1) {
    walking = quickRunSessionAfterArrow(walking, 1);
    assert.equal(painted.has(walking.highlightKey), true, `step ${step} left the highlight on an unpainted row`);
  }
  assert.equal(
    walking.highlightKey,
    walking.rows[walking.rows.length - 1].resultKey,
    'and it ends clamped at the last painted row',
  );
});

test('Enter still revalidates by stable result key, so a row past the cap is as actionable as ever', () => {
  const session = typed();
  const ranked = quickRunResults(quickRunRows(STATE), 'kestrel');
  const unpainted = ranked[QUICK_RUN_MAX_PAINTED_ROWS + 50];
  assert.ok(unpainted, 'the fixture has a row past the cap to ask about');
  assert.equal(session.rows.some((row) => row.resultKey === unpainted.resultKey), false, 'that row is genuinely not painted');
  // Activation does not consult the session at all: it rebuilds the universe from the state it is handed and
  // finds the row by the stable key the contract pins, so the cap cannot make a row unactionable.
  const current = revalidateQuickRunRow(STATE, unpainted.resultKey);
  assert.equal(current.ok, true);
  assert.equal(current.row.resultKey, unpainted.resultKey);
  const plan = planQuickRunActivation(current.row);
  assert.equal(plan.action, 'launch-shortcut');
  assert.equal(plan.target.placementId, unpainted.placementId);
});

test('a row the workspace no longer holds is still refused, painted or not', () => {
  const session = typed();
  const painted = session.rows[3].resultKey;
  const ranked = quickRunResults(quickRunRows(STATE), 'kestrel');
  const unpainted = ranked[QUICK_RUN_MAX_PAINTED_ROWS + 50].resultKey;
  // Delete every shortcut: what the session drew is now stale, and revalidation is what notices.
  const emptied = { ...STATE, shortcuts: [] };
  for (const key of [painted, unpainted]) {
    const current = revalidateQuickRunRow(emptied, key);
    assert.equal(current.ok, false, `${key} must not act on a workspace that no longer holds it`);
    assert.equal(planQuickRunActivation(current.row), null);
  }
});

/** A live-enough mounting harness: the real mount, the real keys, the production elements and a recorder. */
function liveElement() {
  const element = {
    hidden: false, value: '', textContent: '', className: '', dataset: {}, children: [],
    listeners: {},
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    addEventListener(type, handler) { (element.listeners[type] ??= []).push(handler); },
    focus() {},
    fire(type, event = {}) { for (const handler of element.listeners[type] ?? []) handler(event); },
  };
  return element;
}

function mounted(state) {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = {
    layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(),
    cap: liveElement(), notice: liveElement(),
  };
  const activated = [];
  const quickRun = mountQuickRun({
    document, elements, getState: () => state, onActivate: (key) => activated.push(key),
  });
  return { elements, quickRun, activated };
}

test('what the surface paints is exactly what the session holds, and Enter never leaves the painted list', () => {
  const { elements, quickRun, activated } = mounted(STATE);
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  const session = quickRun.session();
  assert.deepEqual(
    elements.results.children.map((row) => row.dataset.quickRunKey),
    session.rows.map((row) => row.resultKey),
    'the paint and the session are one list',
  );
  const painted = new Set(session.rows.map((row) => row.resultKey));
  for (let step = 0; step < QUICK_RUN_MAX_PAINTED_ROWS + 20; step += 1) {
    elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
    elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  }
  assert.equal(activated.length, QUICK_RUN_MAX_PAINTED_ROWS + 20);
  for (const key of activated) {
    assert.equal(painted.has(key), true, 'Enter ran a painted row every time, even after the clamp');
  }
  assert.equal(elements.cap.hidden, false);
  assert.equal(elements.cap.textContent, 'Showing the first 200 of 304 matches — keep typing to narrow.');
});

test('an empty query still shows nothing, and the filter fallback rule is untouched', () => {
  const opened = openQuickRunSession(STATE);
  assert.deepEqual(opened.rows, [], 'no empty-query home screen, capped or not');
  assert.equal(opened.totalRows, 0);
  assert.equal(opened.capped, false);
  assert.equal(quickRunCapNotice(opened), null);

  // A filter whose only matches sit past the cap is not "unavailable", because the fallback rule reads the
  // whole match set rather than the painted rows.
  const session = typed();
  const folders = quickRunSessionWithFilter(session, 'Folders');
  assert.equal(folders.filter, 'Folders');
  assert.equal(folders.fellBack, false);
  assert.deepEqual(folders.rows.map((row) => row.resultKey), ['folder:g-docs']);
  assert.equal(folders.capped, false, 'one filtered row is the whole filtered match set');
  assert.equal(quickRunCapNotice(folders), null, 'so the surface says nothing about a cap');

  // And the original fallback is still exactly the original fallback: a filter with nothing at all falls
  // back to All, showing the capped All list rather than an empty one.
  const links = quickRunSessionWithFilter(session, 'Links');
  assert.equal(links.filter, 'All');
  assert.equal(links.fellBack, true);
  assert.equal(links.rows.length, QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(links.capped, true);
});

test('a query under the cap paints every match with no cap line', () => {
  const small = { ...STATE, shortcuts: STATE.shortcuts.slice(0, 12) };
  const session = quickRunSessionWithQuery(openQuickRunSession(small), 'kestrel');
  assert.equal(session.totalRows, 16, 'twelve shortcuts, three layout members, one word-prefix folder');
  assert.equal(session.rows.length, session.totalRows);
  assert.equal(session.capped, false);
  assert.equal(quickRunCapNotice(session), null);
  const h = { document: { createElement: (tag) => ({ tag, ...liveElement() }) }, elements: undefined };
  h.elements = {
    layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(),
    cap: liveElement(), notice: liveElement(),
  };
  const painted = paintQuickRunSurface({ ...h, session });
  assert.equal(painted, 16);
  assert.equal(h.elements.cap.hidden, true);
  assert.equal(h.elements.cap.textContent, '');
});
