/**
 * What a member card says when this surface cannot confirm the member's window.
 *
 * The state this describes is the one the layout runtime reports as `unverified`: a member whose window the
 * surface cannot currently find, where "cannot find" is a failed MATCH (the host's `resolvePersisted` compares
 * an executable fingerprint and an exact title) and not evidence that the window is gone. A browser tab
 * switch changes exactly the string that match reads.
 *
 * ONE NOTE, AND ONLY ONE. The brief asked for "cannot check right now" to be distinguished from "definitely
 * gone". Nothing in the host can produce the second yet - GONE requires positive terminal evidence, the host
 * carries no such outcome, and the identity records are explicit that absence, an enumeration miss, a refusal
 * and a timeout are all UNVERIFIED. A card appearance the code cannot reach cannot be tested and would be a
 * promise this project cannot keep, so it is not written. When a terminal outcome exists, this file grows a
 * second note and the state becomes reachable; until then the card has one honest thing to say.
 *
 * THE WORDS are the creator's, not this project's: no HWND, no identity, no capability, no token, nothing
 * that reads as a loss or as a task. The member is being HELD, not dropped, and it recovers by itself when
 * its window is found again - so the sentence says that and nothing more. The test file next to this one
 * fails if our vocabulary leaks onto a card or if the sentence starts sounding like bad news.
 */

/**
 * The one sentence. Chosen to fit the smallest surface this widget renders in (the compact card is a
 * one-row strip) and to be true on every one of them: the window is not visible to Papers right now, and
 * the member has not gone anywhere.
 */
export const WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED = 'Can’t see this window right now — it’s still here.';

/** A note is a short line, and the channel that carries it is bounded like every other one. */
export const WINDOW_LAYOUT_MEMBER_NOTE_MAX = 160;

/**
 * The note for a runtime outcome, or `null` for everything that is not this state.
 *
 * Only `unverified` answers, deliberately: `recorded` is healthy, and `timeout`/`helper-unavailable`/
 * `denied`/`ambiguous` are transient conditions the card has never annotated. Growing a second appearance
 * for any of those would be the flattening this replaced, in the other direction.
 */
export function memberNoteForOutcome(outcome) {
  return outcome === 'unverified' ? WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED : null;
}

/**
 * A note that arrived from another surface, bounded and type-checked, or `null`.
 *
 * The compact widget and the detached surface render from a snapshot rather than from this surface's live
 * state, so the note rides the snapshot beside the icon - and anything on a wire is treated as input.
 */
export function snapshotMemberNote(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= WINDOW_LAYOUT_MEMBER_NOTE_MAX ? trimmed : trimmed.slice(0, WINDOW_LAYOUT_MEMBER_NOTE_MAX);
}
