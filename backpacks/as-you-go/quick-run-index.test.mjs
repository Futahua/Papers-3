import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_RUN_TIERS,
  highlightAfterResults,
  moveHighlight,
  normaliseQueryText,
  quickRunResults,
  tierForName,
} from './public/app/quick-run/quick-run-index.js';

const rows = [
  { type: 'folder', resultKey: 'folder:1', name: 'Docs', breadcrumb: 'Workspace' },
  { type: 'folder', resultKey: 'folder:2', name: 'Doc archive', breadcrumb: 'Workspace' },
  { type: 'shortcut', resultKey: 'shortcut:1', name: 'Read the docs', breadcrumb: 'Workspace › Alpha' },
  { type: 'shortcut', resultKey: 'shortcut:2', name: 'read-the-docs', breadcrumb: 'Workspace' },
  { type: 'shortcut', resultKey: 'shortcut:3', name: 'read_the_docs', breadcrumb: 'Workspace' },
  { type: 'link', resultKey: 'link:4', name: 'Release notes (docs)', breadcrumb: 'Workspace' },
  { type: 'link', resultKey: 'link:5', name: 'Downtown office', breadcrumb: 'Workspace' },
  { type: 'layout-item', resultKey: 'layout-member:1:1', name: 'Chrome', breadcrumb: 'Workspace › Focus' },
];

test('normalization is the pinned one: Unicode, case, tone-fold, trim, collapsed whitespace', () => {
  assert.equal(normaliseQueryText('  DOCs   '), 'docs');
  // This line used to pin `'CAFÉ' -> 'café'`. It moved because the creator ruled the other way: tones are
  // folded away on both sides of the comparison so that typing "lam bai" finds "làm bài" without composing
  // a tone mark to look for something you are about to open. Only marks come off - the base letters are
  // untouched, and the names shown are still exactly what the state stores.
  assert.equal(normaliseQueryText('CAFÉ'), 'cafe');
  assert.equal(normaliseQueryText('a\t b'), 'a b');
  assert.equal(normaliseQueryText(undefined), '');
});

test('the tiers are the fixed ones, and each is reachable', () => {
  assert.equal(tierForName('Docs', 'docs'), QUICK_RUN_TIERS.exact);
  assert.equal(tierForName('Docs archive', 'doc'), QUICK_RUN_TIERS.wholeNamePrefix);
  assert.equal(tierForName('Read the docs', 'the'), QUICK_RUN_TIERS.wordPrefix);
  assert.equal(tierForName('Downtown office', 'dno'), QUICK_RUN_TIERS.fuzzy);
  assert.equal(tierForName('Chrome', 'zzz'), null);
  assert.equal(tierForName('Chrome', '   '), null);
});

test('a word prefix is found across spaces, hyphens, underscores and punctuation', () => {
  for (const name of ['Read the docs', 'read-the-docs', 'read_the_docs', 'Release notes (docs)']) {
    assert.equal(tierForName(name, 'docs'), QUICK_RUN_TIERS.wordPrefix, name);
  }
});

test('matching reads the display name only, never the breadcrumb or a target', () => {
  const onlyBreadcrumbMatches = [
    { type: 'folder', resultKey: 'folder:9', name: 'Alpha', breadcrumb: 'Workspace › docs' },
  ];
  assert.deepEqual(quickRunResults(onlyBreadcrumbMatches, 'docs'), []);
  const targetMatches = [
    { type: 'link', resultKey: 'link:9', name: 'Portal', breadcrumb: 'Workspace', target: 'https://docs.example.com' },
  ];
  assert.deepEqual(quickRunResults(targetMatches, 'docs'), []);
});

test('results are ranked, and a prefix never loses to a fuzzy match', () => {
  const results = quickRunResults(rows, 'docs');
  assert.equal(tierForName('Doc archive', 'docs'), null);
  assert.deepEqual(results.map((row) => row.resultKey), [
    'folder:1',
    'shortcut:1',
    'shortcut:2',
    'shortcut:3',
    'link:4',
  ]);
  const tiers = results.map((row) => row.tier);
  assert.deepEqual(tiers, [...tiers].sort((left, right) => left - right));
  assert.equal(results[0].tier, QUICK_RUN_TIERS.exact);
  assert.equal(results.at(-1).tier, QUICK_RUN_TIERS.wordPrefix);
});

test('an empty query shows nothing, because there is no empty-query home screen', () => {
  assert.deepEqual(quickRunResults(rows, ''), []);
  assert.deepEqual(quickRunResults(rows, '   '), []);
});

test('the highlight is preserved by stable key, and falls to the first result when that row is gone', () => {
  const before = quickRunResults(rows, 'docs');
  assert.equal(before.length, 5, 'the first set is the five docs matches');
  assert.equal(highlightAfterResults(before[3].resultKey, before), before[3].resultKey);
  const after = quickRunResults(rows, 'chrome');
  assert.deepEqual(after.map((row) => row.resultKey), ['layout-member:1:1']);
  assert.ok(!after.some((row) => row.resultKey === before[3].resultKey));
  assert.equal(highlightAfterResults(before[3].resultKey, after), after[0].resultKey);
  assert.equal(highlightAfterResults(null, after), after[0].resultKey);
  assert.equal(highlightAfterResults('anything', []), null);
});

test('arrow movement steps one row and clamps at both ends instead of wrapping', () => {
  const results = quickRunResults(rows, 'docs');
  const first = results[0].resultKey;
  const second = results[1].resultKey;
  const last = results.at(-1).resultKey;
  assert.equal(moveHighlight(results, first, 1), second);
  assert.equal(moveHighlight(results, second, -1), first);
  assert.equal(moveHighlight(results, first, -1), first);
  assert.equal(moveHighlight(results, last, 1), last);
  assert.equal(moveHighlight(results, 'not-in-the-set', 1), first);
  assert.equal(moveHighlight([], first, 1), null);
});

test('a row keeps the shape the universe gave it, plus its tier', () => {
  const result = quickRunResults(rows, 'chrome')[0];
  assert.equal(result.resultKey, 'layout-member:1:1');
  assert.equal(result.name, 'Chrome');
  assert.equal(result.type, 'layout-item');
  assert.equal(result.breadcrumb, 'Workspace › Focus');
  assert.equal(result.tier, QUICK_RUN_TIERS.exact);
});