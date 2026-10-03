import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_RUN_MAX_PAINTED_ROWS,
  closeQuickRunSession,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionRefreshed,
  quickRunSessionWithFilter,
  quickRunSessionWithQuery,
} from './public/app/quick-run/quick-run-session.js';

const state = {
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    {
      id: 's-1',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [
        { id: 'p-1', parentId: 'g-root', order: 1 },
        { id: 'p-2', parentId: 'g-root', order: 2 },
      ],
    },
    {
      id: 's-2',
      name: 'Downtown office',
      target: '/tmp/office.md',
      placements: [{ id: 'p-3', parentId: 'g-root', order: 3 }],
    },
  ],
  windowLayouts: [],
};

test('opening shows one empty session: no rows, no chips, All, no highlight', () => {
  const session = openQuickRunSession(state);
  assert.equal(session.open, true);
  assert.equal(session.query, '');
  assert.equal(session.filter, 'All');
  assert.deepEqual(session.rows, []);
  assert.deepEqual(session.chips, []);
  assert.equal(session.highlightKey, null);
  // Nothing is hidden behind a cap either: an empty query matched nothing, so there is no total to report.
  assert.equal(session.totalRows, 0);
  assert.equal(session.capped, false);
  // The universe is there to search, it just is not shown: no empty-query home screen.
  assert.ok(session.allRows.length > 0);
});

test('results appear only after the first non-empty query', () => {
  const opened = openQuickRunSession(state);
  assert.deepEqual(quickRunSessionWithQuery(opened, 'do').rows.map((row) => row.resultKey), [
    'link:p-1',
    'link:p-2',
    'shortcut:p-3',
  ]);
  // Whitespace is still empty.
  assert.deepEqual(quickRunSessionWithQuery(opened, '   ').rows, []);
});

test('typing re-ranks and re-highlights, and the highlight follows a surviving row', () => {
  const opened = openQuickRunSession(state);
  const typed = quickRunSessionWithQuery(opened, 'dow');
  assert.deepEqual(typed.rows.map((row) => row.resultKey), ['shortcut:p-3']);
  assert.equal(typed.highlightKey, 'shortcut:p-3');

  const widened = quickRunSessionWithQuery(typed, 'do');
  assert.equal(widened.highlightKey, widened.rows[0].resultKey, 'a new set highlights its first row');

  const narrowed = quickRunSessionWithQuery(widened, 'docs');
  assert.deepEqual(narrowed.rows.map((row) => row.resultKey), ['link:p-1', 'link:p-2']);
});

test('the filter cycles inside the session and falls back to All when it loses its matches', () => {
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  assert.deepEqual(typed.chips, ['All', 'Links']);
  const folders = quickRunSessionWithFilter(typed, 'Folders');
  assert.equal(folders.fellBack, true);
  assert.equal(folders.filter, 'All');
  assert.equal(folders.highlightKey, folders.rows[0].resultKey);
});

test('arrows move the highlight inside the current set and clamp at both ends', () => {
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'do');
  const down = quickRunSessionAfterArrow(typed, 1);
  assert.equal(down.highlightKey, typed.rows[1].resultKey);
  assert.equal(quickRunSessionAfterArrow(down, -1).highlightKey, typed.rows[0].resultKey);
  assert.equal(quickRunSessionAfterArrow(typed, -1).highlightKey, typed.rows[0].resultKey);
  const last = quickRunSessionWithQuery(openQuickRunSession(state), 'do');
  const end = quickRunSessionAfterArrow(quickRunSessionAfterArrow(last, 1), 1);
  assert.equal(quickRunSessionAfterArrow(end, 1).highlightKey, end.highlightKey);
});

test('closing clears the query, the rows, the filter and the highlight, and produces nothing else', () => {
  const typed = quickRunSessionWithFilter(
    quickRunSessionWithQuery(openQuickRunSession(state), 'docs'),
    'Links',
  );
  const closed = closeQuickRunSession(typed);
  assert.deepEqual(closed, {
    open: false, query: '', filter: 'All', rows: [], totalRows: 0, capped: false,
    chips: [], highlightKey: null, fellBack: false,
  });
  // Escape does not create, move, launch, select, navigate or persist anything: the close returns a
  // session and no other value at all.
  assert.equal(Object.keys(closed).includes('action'), false);
  assert.equal(Object.keys(closed).includes('pending'), false);
  // A reopened session starts empty rather than resuming the previous search.
  const reopened = openQuickRunSession(state);
  assert.equal(reopened.query, '');
  assert.deepEqual(reopened.rows, []);
});

test('a keystroke into a closed session changes nothing', () => {
  const closed = closeQuickRunSession(openQuickRunSession(state));
  assert.deepEqual(quickRunSessionWithQuery(closed, 'docs'), closed);
  assert.deepEqual(quickRunSessionWithFilter(closed, 'Links'), closed);
  assert.deepEqual(quickRunSessionAfterArrow(closed, 1), closed);
});

/**
 * A workspace whose one-word query matches as many rows as the caller asks for.
 *
 * It exists because the cap is only observable above it: `extraGroups` are additional root folders, which
 * rank below the prefix-matching shortcuts (quick-run-index.js's tier 2 versus tier 1) and therefore land
 * past the cap even though they matched.
 */
function crowdedState(shortcutCount, extraGroups = []) {
  const shortcuts = [];
  for (let index = 0; index < shortcutCount; index += 1) {
    shortcuts.push({
      id: `s-${index}`,
      name: `Kestrel ${index}`,
      target: `C:/corpus/kestrel-${index}.md`,
      placements: [{ id: `p-${index}`, parentId: 'g-root', order: index + extraGroups.length }],
    });
  }
  return {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }, ...extraGroups],
    shortcuts,
    windowLayouts: [],
  };
}

const typedCrowd = (shortcutCount, extraGroups = []) => (
  quickRunSessionWithQuery(openQuickRunSession(crowdedState(shortcutCount, extraGroups)), 'kestrel')
);

test('the cap is 200, and a query past it paints the first 200 while reporting the honest total', () => {
  // The number is the measured one (QUICK_RUN_MAX_PAINTED_ROWS carries its basis): the bucket at or below
  // 200 rows measured p95 6.1 ms against the contract's 16 ms gate, and the next bucket already misses.
  assert.equal(QUICK_RUN_MAX_PAINTED_ROWS, 200);
  const session = typedCrowd(500);
  assert.equal(session.rows.length, QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(session.totalRows, 500, 'the full match count survives the cap');
  assert.equal(session.capped, true);
  assert.equal(session.highlightKey, session.rows[0].resultKey);
  // The painted rows are the head of the ranked set, not a sample of it.
  assert.deepEqual(
    session.rows.map((row) => row.resultKey),
    Array.from({ length: QUICK_RUN_MAX_PAINTED_ROWS }, (_, index) => `shortcut:p-${index}`),
  );
});

test('a query under the cap paints every match and reports no cap at all', () => {
  const session = typedCrowd(7);
  assert.equal(session.rows.length, 7);
  assert.equal(session.totalRows, 7);
  assert.equal(session.capped, false, 'nothing is hidden, so nothing is claimed to be hidden');
});

test('exactly the cap is not capped: the line is for a list that is short of the match set', () => {
  const session = typedCrowd(QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(session.rows.length, QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(session.totalRows, QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(session.capped, false);
});

test('the chips describe every match, including a type that only matches past the cap', () => {
  const session = typedCrowd(300, [{ id: 'g-docs', parentId: 'g-root', name: 'Docs Kestrel' }]);
  assert.equal(session.capped, true);
  assert.equal(session.totalRows, 301);
  assert.deepEqual(session.chips, ['All', 'Folders', 'Shortcuts'], 'the Folders chip is offered from the match set, not from the painted rows');
  assert.equal(session.rows.some((row) => row.type === 'folder'), false, 'and that folder really is not painted');
});

test('the filter still runs over every match before the cap, so it neither falls back nor caps early', () => {
  const session = typedCrowd(300, [{ id: 'g-docs', parentId: 'g-root', name: 'Docs Kestrel' }]);
  const folders = quickRunSessionWithFilter(session, 'Folders');
  assert.equal(folders.filter, 'Folders', 'a filter whose only match sits past the cap is not "unavailable"');
  assert.equal(folders.fellBack, false, 'the fallback rule still reads the whole match set');
  assert.equal(folders.totalRows, 1);
  assert.equal(folders.capped, false, 'the filter narrows first, so there is nothing left to cap');
  assert.deepEqual(folders.rows.map((row) => row.resultKey), ['folder:g-docs']);
});

test('the arrows stay inside the painted rows and the highlight is always one of them', () => {
  const session = typedCrowd(500);
  const up = quickRunSessionAfterArrow(session, -1);
  assert.equal(up.highlightKey, session.rows[0].resultKey, 'ArrowUp clamps at the first painted row');
  let cursor = session;
  for (let step = 0; step < QUICK_RUN_MAX_PAINTED_ROWS + 50; step += 1) {
    cursor = quickRunSessionAfterArrow(cursor, 1);
  }
  assert.equal(cursor.rows.length, QUICK_RUN_MAX_PAINTED_ROWS);
  assert.equal(
    cursor.highlightKey,
    session.rows[QUICK_RUN_MAX_PAINTED_ROWS - 1].resultKey,
    'ArrowDown clamps at the last painted row instead of stepping into the unpainted tail',
  );
  assert.equal(cursor.rows.some((row) => row.resultKey === cursor.highlightKey), true);
});

test('closing a capped session forgets the total and the cap along with the rows', () => {
  const closed = closeQuickRunSession(typedCrowd(500));
  assert.deepEqual(closed, {
    open: false, query: '', filter: 'All', rows: [], totalRows: 0, capped: false,
    chips: [], highlightKey: null, fellBack: false,
  });
});

/* A refresh is what happens when an action finds its target gone: the snapshot is rebuilt from the state
   that refused the row, so the dead row is replaced rather than left on screen to be hit again. */

test('a refresh rebuilds the snapshot, keeps the query and the filter, and highlights the nearest survivor', () => {
  let session = quickRunSessionWithFilter(quickRunSessionWithQuery(openQuickRunSession(state), 'do'), 'Links');
  assert.deepEqual(session.rows.map((row) => row.resultKey), ['link:p-1', 'link:p-2']);
  session = quickRunSessionAfterArrow(session, 1);
  assert.equal(session.highlightKey, 'link:p-2', 'the reader asked for the second row');

  // The second placement is gone from the workspace the state now describes.
  const trimmed = {
    ...state,
    shortcuts: [{ ...state.shortcuts[0], placements: [state.shortcuts[0].placements[0]] }, state.shortcuts[1]],
  };
  const refreshed = quickRunSessionRefreshed(session, trimmed);

  assert.equal(refreshed.open, true, 'a refresh does not close the session');
  assert.equal(refreshed.query, 'do', 'the query the reader typed is preserved');
  assert.equal(refreshed.filter, 'Links', 'and so is the filter they chose');
  assert.deepEqual(refreshed.rows.map((row) => row.resultKey), ['link:p-1'], 'the list is the current state');
  assert.equal(refreshed.highlightKey, 'link:p-1', 'the highlight lands on the survivor nearest the row that vanished');
});

test('a refresh whose filter lost every match falls back to All, by the same rule a keystroke uses', () => {
  const session = quickRunSessionWithFilter(quickRunSessionWithQuery(openQuickRunSession(state), 'do'), 'Shortcuts');
  assert.deepEqual(session.rows.map((row) => row.resultKey), ['shortcut:p-3']);

  // The only shortcut goes; the two links are what the query still matches.
  const refreshed = quickRunSessionRefreshed(session, { ...state, shortcuts: [state.shortcuts[0]] });
  assert.equal(refreshed.filter, 'All', 'a filter with nothing left in it cannot stay active');
  assert.equal(refreshed.fellBack, true, 'and the fallback is reported rather than done silently');
  assert.deepEqual(refreshed.rows.map((row) => row.resultKey), ['link:p-1', 'link:p-2']);
  assert.equal(refreshed.highlightKey, 'link:p-1');
});

test('a refresh that leaves nothing shows nothing, with the reader\'s query still there to explain why', () => {
  const session = quickRunSessionWithQuery(openQuickRunSession(state), 'do');
  const refreshed = quickRunSessionRefreshed(session, { groups: [], shortcuts: [], windowLayouts: [] });
  assert.deepEqual(refreshed.rows, []);
  assert.equal(refreshed.highlightKey, null, 'no rows, no highlight to run');
  assert.equal(refreshed.query, 'do', 'the query stays, which is what lets the surface say what matched nothing');
  assert.equal(refreshed.capped, false);
  assert.deepEqual(refreshed.chips, []);
});

test('a refresh cannot paint more than a session may hold, and a closed session is not refreshed at all', () => {
  const session = quickRunSessionWithQuery(openQuickRunSession(crowdedState(20)), 'kestrel');
  const refreshed = quickRunSessionRefreshed(session, crowdedState(500));
  assert.equal(refreshed.rows.length, QUICK_RUN_MAX_PAINTED_ROWS, 'the cap still bounds what a refresh may paint');
  assert.equal(refreshed.totalRows, 500);
  assert.equal(refreshed.capped, true, 'and the honest total still rides beside it');

  const closed = closeQuickRunSession(session);
  assert.equal(quickRunSessionRefreshed(closed, crowdedState(500)), closed, 'a closed session has nothing to rebuild');
});