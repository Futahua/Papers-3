import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { quickRunCapNotice, quickRunChipViews, quickRunEmptyNotice, quickRunRowViews } from './public/app/quick-run/quick-run-presentation.js';

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
  ],
  windowLayouts: [],
};

const typed = () => quickRunSessionWithQuery(openQuickRunSession(state), 'docs');

test('every row view carries an icon kind, a primary name and a breadcrumb', () => {
  const views = quickRunRowViews(typed());
  assert.equal(views.length, 2);
  for (const view of views) {
    assert.equal(typeof view.iconKind, 'string');
    assert.ok(view.iconKind.length > 0);
    assert.equal(view.primary, 'Docs');
    assert.equal(typeof view.breadcrumb, 'string');
    assert.ok(view.key.startsWith('link:'));
  }
});

test('the list is flat: one array of rows, with nothing grouped or nested inside it', () => {
  const views = quickRunRowViews(typed());
  assert.ok(Array.isArray(views));
  for (const view of views) {
    assert.equal(typeof view, 'object');
    // A grouped presentation would have to smuggle a group (or a list of rows) in here, and the
    // contract allows neither: "One flat list only. No grouped sections."
    assert.equal(Object.values(view).some((value) => Array.isArray(value) || (typeof value === 'object' && value !== null)), false);
  }
});

test('duplicate names are kept when breadcrumbs differ, and the highlight rides one of them', () => {
  const views = quickRunRowViews(typed());
  assert.deepEqual(views.map((view) => view.primary), ['Docs', 'Docs']);
  assert.notEqual(views[0].key, views[1].key);
  assert.deepEqual(views.map((view) => view.breadcrumb), ['Workspace', 'Workspace']);
  assert.equal(views.filter((view) => view.highlighted).length, 1);
});

test('an empty session draws no rows and no chips', () => {
  const opened = openQuickRunSession(state);
  assert.deepEqual(quickRunRowViews(opened), []);
  assert.deepEqual(quickRunChipViews(opened), []);
});

test("a row view carries the item's own icon beside its kind, and null when it has none", () => {
  // The kind is not replaced by the picture: it is what the surface draws when there is no picture, and what
  // names the row for anything that cannot paint one. The icon is passed through exactly as the state holds
  // it - this layer does not decode, re-encode or resize it.
  const state = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [
      { id: 's-art', name: 'Art', target: 'C:/art.exe', icon: 'data:image/png;base64,AAAA', placements: [{ id: 'p-art', parentId: 'g-root', order: 1 }] },
      { id: 's-plain', name: 'Plain', target: 'C:/plain.exe', placements: [{ id: 'p-plain', parentId: 'g-root', order: 2 }] },
    ],
    windowLayouts: [],
  };
  const viewFor = (query) => quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), query))[0];

  const art = viewFor('art');
  assert.equal(art.icon, 'data:image/png;base64,AAAA', 'the item\'s own string, unchanged');
  assert.equal(art.iconKind, 'shortcut', 'and the kind is still there beside it');

  const plain = viewFor('plain');
  assert.equal(plain.icon, null, 'an item with no icon carries none, rather than inheriting one');
  assert.equal(plain.iconKind, 'shortcut');
});

test('the chips mark exactly one active filter and start with All', () => {
  const session = typed();
  const chips = quickRunChipViews(session);
  assert.equal(chips[0].label, 'All');
  assert.deepEqual(chips.map((chip) => chip.active), [true, false]);
});

/** The same workspace shape the session's own cap tests use: one word matches every shortcut. */
function crowdedState(count) {
  const shortcuts = [];
  for (let index = 0; index < count; index += 1) {
    shortcuts.push({
      id: `s-${index}`,
      name: `Kestrel ${index}`,
      target: `C:/corpus/kestrel-${index}.md`,
      placements: [{ id: `p-${index}`, parentId: 'g-root', order: index }],
    });
  }
  return { groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }], shortcuts, windowLayouts: [] };
}

const typedCrowd = (count) => quickRunSessionWithQuery(openQuickRunSession(crowdedState(count)), 'kestrel');

test('the cap line exists only while the painted list is short of the match set', () => {
  // null, not an empty string: there is no sentence to draw, and the surface draws nothing for it.
  assert.equal(quickRunCapNotice(openQuickRunSession(state)), null, 'an empty query is not capped');
  assert.equal(quickRunCapNotice(typed()), null, 'a query that fits under the cap is not capped');
  assert.equal(quickRunCapNotice(typedCrowd(7)), null, 'seven matches, seven painted, no cap line');
  assert.equal(quickRunCapNotice(typedCrowd(200)), null, 'exactly the cap is still everything');
  const capped = quickRunCapNotice(typedCrowd(500));
  assert.notEqual(capped, null);
  assert.equal(capped.text, 'Showing the first 200 of 500 matches — keep typing to narrow.');
});

test('the cap line counts what is on screen and groups the total it is not showing', () => {
  const notice = quickRunCapNotice(typedCrowd(12213));
  assert.equal(notice.text, 'Showing the first 200 of 12,213 matches — keep typing to narrow.');
  // The first number is the painted list itself rather than a copy of the cap constant, so the sentence
  // cannot survive a change to the cap while still claiming the old count.
  assert.equal(notice.text.includes('first 12213'), false);
});

test('a layout item starts at availability unknown, and nothing guesses otherwise (section 5)', () => {
  const state = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [
      { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-root', order: 1 }] },
    ],
    windowLayouts: [
      {
        id: 'l-1',
        parentId: 'g-root',
        name: 'Focus',
        arrangement: {
          members: [
            { id: 'm-1', descriptor: { title: 'Chrome' } },
            { id: 'm-2', descriptor: { title: 'Mystery', executable: 'mystery.exe' } },
            { id: 'm-3', descriptor: { title: 'Minimized', executable: 'chrome.exe' }, state: 'minimized' },
          ],
        },
      },
    ],
  };
  // A query per member, because an empty query shows nothing at all (section 1.1) - the rows being asked
  // about are the ones a query produced.
  const chrome = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'));
  const mystery = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'mystery'));
  const minimized = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'minimized'));
  const docs = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'docs'));
  assert.deepEqual(chrome.map((view) => view.iconKind), ['layout-item']);
  assert.deepEqual(mystery.map((view) => view.iconKind), ['layout-item'], 'a member whose executable no host reports is still searchable: the persisted member is what is searched');
  assert.deepEqual(minimized.map((view) => view.iconKind), ['layout-item']);
  for (const view of [...chrome, ...mystery, ...minimized]) {
    assert.equal(view.availability, 'unknown');
    assert.notEqual(view.availability, 'not-running');
  }
  assert.equal(minimized[0].availability, 'unknown', 'persisted arrangement state (minimized) is not availability (section 10.1)');
  assert.deepEqual(docs.map((view) => view.availability), [null], 'only a layout item has availability at all');
});
test('an empty universe says so instead of claiming the query matched nothing', () => {
  // Measured in the launcher overlay, which has no canvas behind it: when the surface has no workspace to
  // search, "No matches for “kestrel”" tells the creator their own item does not exist. The empty universe
  // gets its own sentence, and it stays true whether the workspace is empty or could not be read.
  const empty = { open: true, query: 'kestrel', rows: [], allRows: [], totalRows: 0, capped: false, chips: [] };
  assert.deepEqual(quickRunEmptyNotice(empty), { text: 'Nothing to search yet: this project has no items loaded here.' });

  // A universe with rows in it is unchanged: a query that matches none of them is still a failed search.
  const populated = { ...empty, allRows: [{ resultKey: 'folder:1', name: 'Letters', type: 'folder' }] };
  assert.deepEqual(quickRunEmptyNotice(populated), { text: 'No matches for “kestrel”.' });

  // And a session that never carried a universe (a hand-built one) keeps the old sentence rather than
  // guessing that the project is empty.
  assert.deepEqual(
    quickRunEmptyNotice({ open: true, query: 'kestrel', rows: [] }),
    { text: 'No matches for “kestrel”.' },
  );
});

test('a failed state load is said out loud, with the reason the host gave', () => {
  // The launcher overlay has no canvas behind it, and the creator's report was "nothing shows up when typed".
  // The sentence has to distinguish three states rather than flatten them into one: items could not be
  // loaded (and here is why), loaded but the project is genuinely empty, or a query that matched none of a
  // universe that is there. The first is the one that was hidden, and it is the one that matters.
  const empty = { open: true, query: 'lam', rows: [], allRows: [], totalRows: 0, capped: false, chips: [] };
  assert.deepEqual(
    quickRunEmptyNotice(empty, { loadFailure: 'Host request timed out.' }),
    { text: 'Nothing to search yet: this project’s items could not be loaded (Host request timed out.).' },
  );
  assert.deepEqual(
    quickRunEmptyNotice(empty, { loadFailure: null }),
    { text: 'Nothing to search yet: this project has no items loaded here.' },
  );
  const populated = { ...empty, allRows: [{ resultKey: 'folder:1', name: 'Letters', type: 'folder' }] };
  assert.deepEqual(
    quickRunEmptyNotice(populated, { loadFailure: 'Host request timed out.' }),
    { text: 'No matches for “lam”.' },
    'a universe that arrived is searched even if an earlier attempt failed',
  );
});
