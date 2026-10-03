// Ephemeral availability: what is known about a layout item after something asked (section 10.1).
//
// The rule this file holds is narrow on purpose. Availability is never persisted, an untouched item is
// `unknown`, and a noted answer survives only while the descriptor it was noted against still describes
// the row - because a member whose descriptor changed is a different window as far as the surface can
// tell, which is section 10.5's reset. Whether the live resolution and activation ever happen is a
// separate question and is not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  quickRunDescriptorFingerprint,
  quickRunRowViews,
} from './public/app/quick-run/quick-run-presentation.js';
import { availabilityAfterResolution } from './public/app/quick-run/quick-run-resolution.js';

const layoutState = (title = 'Chrome', executableFingerprint = 'a'.repeat(64)) => ({
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-root',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: { title, executableFingerprint } }] },
    },
  ],
});

const viewsOf = (state, noted) => quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'), noted);
const viewFor = (state, noted) => viewsOf(state, noted)[0];

// The identity a caller notes an answer against is the one the view hands it: the row's own descriptor
// key, which is what the presentation layer compares when it decides whether the answer still describes
// this row. Nothing here re-derives it from the display name.
const note = (state, availability) => {
  const row = viewsOf(state, undefined)[0];
  return { [row.key]: { availability, descriptor: quickRunDescriptorFingerprint(row) } };
};

test('the identity a note is kept against is the persisted descriptor, not the name or the occurrence', () => {
  const both = viewsOf(layoutState(), undefined)[0];
  assert.equal(both.descriptorKey, `Chrome\u0000${'a'.repeat(64)}`, 'title and fingerprint, in the model order');
  assert.equal(quickRunDescriptorFingerprint(both), both.descriptorKey, 'and that is what a note records');

  // A member that declares only a title is identified by that title alone, because that is all it declares.
  // (An empty fingerprint is not a declared one: the model persists a 64-hex value or nothing at all.)
  const titled = viewsOf(layoutState('Chrome', ''), undefined)[0];
  assert.equal(titled.descriptorKey, 'Chrome');
  // A member that declares nothing is not identified by its display name.
  const bareState = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [],
    windowLayouts: [{
      id: 'l-1',
      parentId: 'g-root',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: {} }] },
    }],
  };
  const bare = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(bareState), 'untitled'), undefined)[0];
  assert.equal(bare.descriptorKey, '', 'no declared identity is an empty key, not the name it happens to show');
  assert.equal(bare.primary, 'Untitled window', 'even though the row still has a name to draw');
});

test('an untouched layout item is unknown, and nothing else has availability at all', () => {
  const folderState = layoutState();
  assert.equal(viewFor(layoutState(), undefined).availability, 'unknown');
  const folders = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(folderState), 'workspace'), undefined);
  assert.equal(folders.length, 1, 'the folder row is there to be asked about');
  assert.equal(folders[0].availability, null, 'and a folder has no availability at all');
});

test('a missing outcome leaves the row searchable and says unavailable (sections 10.3 and 10.4)', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('missing'));
  assert.equal(viewFor(state, noted).availability, 'unavailable');
  assert.equal(viewsOf(state, noted).length, 1, 'the occurrence is still in the list: a failed resolution is not a removal');
  assert.equal(viewsOf(state, noted)[0].primary, 'Chrome', 'and it still shows what it is');
});

test('an ambiguous outcome says unavailable, and says nothing about which window it meant', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('ambiguous'));
  assert.equal(viewFor(state, noted).availability, 'unavailable');
  assert.equal(viewsOf(state, noted).length, 1);
});

test('a unique resolution that was activated says available', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('unique'));
  assert.equal(viewFor(state, noted).availability, 'available');
});

test('a descriptor change resets the noted answer to unknown (section 10.5)', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('unique'));
  assert.equal(viewFor(state, noted).availability, 'available', 'while the descriptor is the one that was seen');
  const retitled = layoutState('Chrome Canary');
  assert.equal(
    viewFor(retitled, noted).availability,
    'unknown',
    'a member whose title changed is treated as a different window, so the prior answer does not survive it',
  );
});

test('a fingerprint change under the same title resets it too (section 10.5)', () => {
  // The defect this holds: the fingerprint used to be `layoutId + memberId + name`, so a member whose
  // executable fingerprint changed while its title stayed the same kept the availability that belonged to
  // a different window - the one field the persisted descriptor exists to distinguish.
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('unique'));
  assert.equal(viewFor(state, noted).availability, 'available');

  const refingerprinted = layoutState('Chrome', 'b'.repeat(64));
  assert.equal(
    viewFor(refingerprinted, noted).availability,
    'unknown',
    'same title, different executable fingerprint: a different window, and no stale answer',
  );
});

test('a noted answer belongs to one occurrence, and reopening forgets all of them', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('missing'));
  const other = { ...layoutState(), windowLayouts: [
    layoutState().windowLayouts[0],
    {
      id: 'l-2',
      parentId: 'g-root',
      name: 'Second',
      arrangement: { members: [{ id: 'm-2', descriptor: { title: 'Chrome' } }] },
    },
  ] };
  const views = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(other), 'chrome'), noted);
  assert.equal(views.length, 2, 'two occurrences of the same descriptor');
  assert.deepEqual(
    views.map((view) => view.availability),
    ['unavailable', 'unknown'],
    'the noted answer stays with the occurrence it was noted for',
  );
  assert.equal(
    quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'), {})[0].availability,
    'unknown',
    'and a session opened with nothing noted knows nothing, which is what reopening is',
  );
});
