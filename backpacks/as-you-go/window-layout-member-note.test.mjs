import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED,
  memberNoteForOutcome,
  snapshotMemberNote,
} from './public/app/window-layout-member-note.js';

/**
 * What a member card says when the surface cannot confirm its window.
 *
 * Until now a member the widget could not confirm looked exactly like a healthy one. The removal path that
 * used to fire on that state is gone (see window-layout-runtime.js), so the member is held; the card has to
 * say so, and say it in words the creator reads rather than in ours.
 *
 * There is deliberately ONE note, not two. The brief asked for "cannot check right now" to be distinguished
 * from "definitely gone", and the honest reading of the host is that nothing can produce the second: GONE
 * requires positive terminal evidence, no host outcome carries it, and the match that fails can fail on a
 * changed title alone. A card state the code cannot reach is a state that cannot be tested, so it is not
 * invented here - if the host ever gains a terminal outcome, this is the file that grows a second note.
 */

test('only a member that cannot be confirmed gets a note, and it is one sentence', () => {
  assert.equal(memberNoteForOutcome('unverified'), WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED);
  // Every other outcome is either healthy or a transient the card already leaves alone, and none of them is
  // allowed to grow a second, scarier appearance.
  for (const outcome of ['recorded', 'recovered', 'missing', 'missing-capability', 'ambiguous', 'denied',
    'timeout', 'helper-unavailable', 'fail-closed', 'superseded', 'retired', 'unknown', '', null, undefined]) {
    assert.equal(memberNoteForOutcome(outcome), null, `${String(outcome)} says nothing on the card`);
  }
});

test('there is no "gone" note, because no outcome can mean it', () => {
  // The whole point of the identity round: a failed check reads UNVERIFIED, never GONE. If someone later adds
  // a terminal outcome, they must add its note here deliberately, and this test is where they will find out
  // that they have to.
  const notes = new Set([
    'recorded', 'recovered', 'unverified', 'missing', 'missing-capability', 'ambiguous', 'denied', 'timeout',
    'helper-unavailable', 'failed', 'retired',
  ].map((outcome) => memberNoteForOutcome(outcome)).filter(Boolean));
  assert.equal(notes.size, 1, 'exactly one note is reachable today');
  assert.deepEqual([...notes], [WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED]);
});

test('the sentence is the creator’s, not ours', () => {
  const note = WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED;
  // Our vocabulary must not leak onto a card. These are the words this project uses between modules.
  for (const jargon of ['HWND', 'PID', 'identity', 'unverified', 'capability', 'descriptor', 'token',
    'helper', 'retire', 'resolve', 'invalid']) {
    assert.equal(note.toLowerCase().includes(jargon.toLowerCase()), false, `the card must not say "${jargon}"`);
  }
  // And it must not read as a loss, a failure or a task. The creator's layouts are not fragile here: the
  // member is being held rather than dropped.
  for (const alarming of ['gone', 'lost', 'missing', 'failed', 'error', 'remove', 'deleted', 'unavailable']) {
    assert.equal(note.toLowerCase().includes(alarming), false, `the card must not say "${alarming}"`);
  }
  assert.match(note, /still/i, 'and it says the true, calm thing: the member is still here');
});

test('a note that arrives from another surface is bounded, and anything unusable is nothing', () => {
  // The note travels to the compact widget and the detached surface inside the snapshot, so it is bounded
  // there exactly like the icon is - a channel that carries whatever it is handed is a channel that can be
  // made to carry anything.
  assert.equal(snapshotMemberNote(WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED), WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED);
  assert.equal(snapshotMemberNote(''), null);
  assert.equal(snapshotMemberNote('   '), null);
  assert.equal(snapshotMemberNote(null), null);
  assert.equal(snapshotMemberNote(undefined), null);
  assert.equal(snapshotMemberNote(42), null);
  assert.equal(snapshotMemberNote({ text: 'no' }), null);
  const long = 'x'.repeat(4000);
  const bounded = snapshotMemberNote(long);
  assert.ok(bounded.length <= 160, `a snapshot note stays short (got ${bounded.length})`);
});
