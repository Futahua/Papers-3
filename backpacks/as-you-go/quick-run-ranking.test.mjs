// Ranking: the four tiers, their order, and what the tie-break actually is.
//
// Section 0.7 fixes the tiers - exact, whole-name prefix, word prefix, fuzzy subsequence - and says the
// order between them is fixed. The module implements them as numbers and sorts by tier, then by the
// position the row had in the universe. That second key is the whole story of "deterministic": there is
// no recency, no frequency and no clock anywhere in the ranking, so no amount of use can move a row across
// a tier, and equal-tier rows come out in the order the universe produced them, which the universe tests
// already pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUICK_RUN_TIERS, normaliseQueryText, quickRunResults, tierForName } from './public/app/quick-run/quick-run-index.js';

const row = (key, name) => ({ resultKey: key, name, type: 'folder' });
const names = (rows) => rows.map((entry) => entry.name);
const keys = (rows) => rows.map((entry) => entry.resultKey);

// Four names, one per tier, for the single query "note":
//   note      -> exact
//   notebook  -> whole-name prefix
//   My note   -> word prefix
//   Knoten    -> no prefix anywhere, but n-o-t-e appear in order
const fourTiers = [
  row('f-knoten', 'Knoten'),
  row('f-my-note', 'My note'),
  row('f-notebook', 'notebook'),
  row('f-note', 'note'),
];

test('the four tiers are the contract tiers, in the contract order (section 0.7)', () => {
  assert.deepEqual(QUICK_RUN_TIERS, { exact: 0, wholeNamePrefix: 1, wordPrefix: 2, fuzzy: 3 });
  assert.equal(tierForName('note', 'note'), QUICK_RUN_TIERS.exact);
  assert.equal(tierForName('notebook', 'note'), QUICK_RUN_TIERS.wholeNamePrefix);
  assert.equal(tierForName('My note', 'note'), QUICK_RUN_TIERS.wordPrefix);
  assert.equal(tierForName('Knoten', 'note'), QUICK_RUN_TIERS.fuzzy);
  assert.equal(tierForName('Editor', 'note'), null);
});

test('exact beats prefix, prefix beats word-prefix, word-prefix beats subsequence', () => {
  // The input is in reverse tier order on purpose: if the ranking were the input order, this would fail.
  assert.deepEqual(names(quickRunResults(fourTiers, 'note')), ['note', 'notebook', 'My note', 'Knoten']);
  assert.deepEqual(
    quickRunResults(fourTiers, 'note').map((entry) => entry.tier),
    [0, 1, 2, 3],
  );
});

test('each adjacent pair holds on its own, not only as a run of four', () => {
  const pairs = [
    [['note', 'notebook'], 'note', ['note', 'notebook']],
    [['notebook', 'My note'], 'note', ['notebook', 'My note']],
    [['My note', 'Knoten'], 'note', ['My note', 'Knoten']],
    [['Knoten', 'Editor'], 'note', ['Knoten']],
  ];
  for (const [input, query, expected] of pairs) {
    assert.deepEqual(
      names(quickRunResults(input.map((name, index) => row(`f-${index}`, name)), query)),
      expected,
      `${input.join(' vs ')} for "${query}"`,
    );
  }
});

test('subsequence beats no match: a fuzzy row is ranked, an unmatched row is absent', () => {
  const results = quickRunResults([row('f-knoten', 'Knoten'), row('f-editor', 'Editor')], 'note');
  assert.deepEqual(keys(results), ['f-knoten']);
  assert.equal(results[0].tier, QUICK_RUN_TIERS.fuzzy);
});

test('recency never moves a lower tier above a higher tier, because recency is not an input', () => {
  const withUsage = fourTiers.map((entry, index) => ({
    ...entry,
    usage: { uses: 100 - index * 40, lastUsedAt: '2026-09-12T08:00:00+07:00' },
  }));
  assert.deepEqual(
    names(quickRunResults(withUsage, 'note')),
    ['note', 'notebook', 'My note', 'Knoten'],
    'heavily used rows stay in their tiers',
  );
});

test('frequency never moves a lower tier above a higher tier, because frequency is not an input', async () => {
  const source = await readFile(new URL('./public/app/quick-run/quick-run-index.js', import.meta.url), 'utf8');
  for (const forbidden of ['recency', 'frequency', 'lastUsed', 'uses', 'Date.now', 'clock']) {
    assert.equal(
      source.includes(forbidden),
      false,
      `the ranking must not consult ${forbidden}: a tie-break it does not have cannot reorder anything`,
    );
  }
});

/* Vietnamese. The creator writes it, their items are named in it, and Quick Run's promise is hotkey, type,
   Enter, gone - so composing a tone mark to find something you are about to open is friction at the exact
   moment the feature exists to remove. Tones are therefore folded away on BOTH sides of the comparison, and
   so is case. What is never folded is which base letter the reader sees: only marks come off, plus the
   stroke in đ, which the creator asked for by name. */
test('the pinned normalisation folds tone, case and đ, and does it identically on both sides', () => {
  assert.equal(normaliseQueryText('làm bài'), 'lam bai');
  assert.equal(normaliseQueryText('LÀM BÀI'), 'lam bai');
  assert.equal(normaliseQueryText('Đường'), 'duong');
  assert.equal(normaliseQueryText('đ'), 'd');
  assert.equal(normaliseQueryText('Ơn gọi'), 'on goi', 'the horn is a mark: the base letter is still o');
  assert.equal(normaliseQueryText('Thăm'), 'tham', 'so is the breve, and the circumflex');
  assert.equal(
    normaliseQueryText('làm bài'.normalize('NFD')),
    normaliseQueryText('làm bài'.normalize('NFC')),
    'the same word typed by an IME in either form normalises the same way',
  );
});

test('a Vietnamese name is found by a tone-folded query, and a tone-folded name by a composed one', () => {
  // Neither path is privileged: the two queries are the same string after normalisation.
  const rows = [row('f-lam', 'làm bài'), row('f-other', 'Notes')];
  assert.deepEqual(keys(quickRunResults(rows, 'lam bai')), ['f-lam'], 'unaccented query finds the accented name');
  assert.deepEqual(keys(quickRunResults(rows, 'làm bài')), ['f-lam'], 'and the composed query finds it too');
  assert.deepEqual(keys(quickRunResults(rows, 'LAM BAI')), ['f-lam']);
  assert.equal(tierForName('làm bài', 'lam bai'), QUICK_RUN_TIERS.exact, 'a folded match is a full match, not a fuzzy one');
  assert.equal(tierForName('Đường', 'duong'), QUICK_RUN_TIERS.exact);
});

test('a folded match is never excluded, and the name shown is exactly what is stored', () => {
  // Both spellings in one universe: a query in either direction must return both rows, and neither row's
  // name may be rewritten by the comparison.
  const rows = [row('f-accented', 'làm bài'), row('f-plain', 'lam bai')];
  for (const query of ['lam bai', 'làm bài', 'LÀM BÀI']) {
    assert.deepEqual(keys(quickRunResults(rows, query)), ['f-accented', 'f-plain'], `both rows answer to "${query}"`);
    assert.deepEqual(names(quickRunResults(rows, query)), ['làm bài', 'lam bai'], 'and neither name is rewritten');
  }
});

test('folding removes marks and the đ stroke, and never swaps one base letter for another', () => {
  // A search convenience, not a transliteration: 'bài' must not answer to "pai", and folding must not
  // silently drop a letter that a reader would see.
  assert.deepEqual(keys(quickRunResults([row('f-bai', 'bài')], 'pai')), []);
  assert.deepEqual(keys(quickRunResults([row('f-ca', 'cá')], 'ka')), []);
  assert.equal(normaliseQueryText('b'), 'b');
  assert.notEqual(normaliseQueryText('b'), normaliseQueryText('p'));
  assert.equal(normaliseQueryText('bài').length, 3, 'three base letters in, three out');
});

test('deterministic fallback stable: same input, same order, and the tie-break is the universe order', () => {
  const first = quickRunResults(fourTiers, 'note');
  const second = quickRunResults(fourTiers, 'note');
  assert.deepEqual(keys(first), keys(second), 'the same query over the same rows is the same answer');

  // Two rows in one tier: the order is the order the universe gave them, so it is deterministic given a
  // deterministic universe, and it is not alphabetical, recency or anything else that could drift.
  const sameTier = [row('f-b', 'Blue note'), row('f-a', 'Amber note')];
  assert.deepEqual(keys(quickRunResults(sameTier, 'note')), ['f-b', 'f-a']);
  assert.deepEqual(keys(quickRunResults([...sameTier].reverse(), 'note')), ['f-a', 'f-b']);
});
