// 019C (RoketPuncha sole-editor lane): the workspace-side durable writers.
// Winter's ONE typed committed pick set (single commit, cancel byte-zero,
// mixed add/remove, partial add failures) and Ning's retirement intent (one
// data-only removal, stale intents ignored, counters never persisted).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createWindowLayoutPickApplier,
  createWindowLayoutRetirementWriter,
  windowLayoutPickApplyOutcome,
  windowLayoutCandidateIsMember,
  windowLayoutPickForBoundCandidate,
  windowLayoutPickMemberDescriptors,
} from './public/app/window-layout-workspace.js';
import { windowLayoutMemberKey } from './public/app/window-layout-runtime.js';
import { endExactWindowCandidateProcess } from './public/app/window-layout-process-end.js';
import { windowLayoutWidgetCommittedStatus } from './public/app/window-layout-widget-channel.js';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import {
  addWindowLayoutMember,
  removeWindowLayoutMember,
  normalizeState,
} from './public/workspace-model-20260730b.js';

test('Auto membership keeps one card per exact window instance across reloads', () => {
  const descriptor = { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W1234567890abcdef' };
  const member = (id) => ({ id, descriptor, bounds: null, state: 'normal' });
  const state = normalizeState({ schemaVersion: 1, windowLayouts: [{ id: 'L1', name: 'L1', arrangement: { version: 2, members: [member('first'), member('duplicate')] } }] });
  assert.deepEqual(state.windowLayouts[0].arrangement.members.map((entry) => entry.id), ['first']);
  assert.equal(addWindowLayoutMember(state, 'L1', member('new-id')), state);
});

function makeState(layouts) {
  return { windowLayouts: layouts };
}

function makeLayout(id, members) {
  return {
    id,
    name: id,
    arrangement: { members: members.map((member) => ({
      id: member.id,
      // The persisted descriptor is the PAIR the host's own matcher uses. The harness used to store the title
      // alone, which is what let a title-only member match look correct: a member with no fingerprint could
      // only ever be found by its title.
      descriptor: { version: 1, title: member.title, executableFingerprint: member.fingerprint ?? FINGERPRINT_A },
      state: member.state ?? 'normal',
      bounds: null,
    })) },
  };
}

function makeHarness({ observe = async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }), isReadOnly = () => false } = {}) {
  let state = makeState([makeLayout('L1', [
    { id: 'm1', title: 'Notepad' },
    { id: 'm2', title: 'Calculator' },
  ])]);
  let commits = 0;
  const capabilities = new Map();
  const icons = new Map();
  const model = {
    addWindowLayoutMember: (current, layoutId, member) => ({
      ...current,
      windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
        : layout),
    }),
    removeWindowLayoutMember: (current, layoutId, memberId) => ({
      ...current,
      windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: layout.arrangement.members.filter((member) => member.id !== memberId) } }
        : layout),
    }),
  };
  const pickApplier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState: (next) => { state = next; commits += 1; },
    observeCapability: observe,
    model,
    capabilities,
    icons,
    isReadOnly,
  });
  const retirementWriter = createWindowLayoutRetirementWriter({
    getState: () => state,
    commitState: (next) => { state = next; commits += 1; },
    model,
    capabilities,
    icons,
  });
  return {
    getState: () => state,
    installState: (next) => { state = next; },
    countCommits: () => commits,
    pickApplier,
    retirementWriter,
    capabilities,
    icons,
  };
}

function capabilityFor(title) {
  return { version: 1, bindingId: `b:${title}` };
}
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

function descriptor(title) {
  return { version: 1, title, executableFingerprint: FINGERPRINT_A };
}

/** A descriptor for the SAME title on a DIFFERENT executable: the case a title-only match cannot tell apart. */
function descriptorOn(title, executableFingerprint) {
  return { version: 1, title, executableFingerprint };
}

function descriptorInstance(title, windowInstanceId, executableFingerprint = FINGERPRINT_A) {
  return { version: 1, title, executableFingerprint, windowInstanceId };
}

/* Identity in the pick applier.
 *
 * A picker-commit removal carries ONE thing - a persisted descriptor ({version, title, executableFingerprint}).
 * The wire format has no member id: the parser rejects any key but `descriptor`, and even the path that holds
 * an id in hand (the widget's context menu, which builds removals from snapshot members it just selected by
 * id) sends the descriptor alone. So the narrowest identity a removal actually carries is the PAIR, and it is
 * only usable when exactly one member carries it.
 *
 * These three tests are the cases title-only matching got wrong, and the applier is the last place in this
 * project that matched a member by a mutable, non-unique string. */
test('a removal matches the executable as well as the title, so a same-titled window is not the one removed', async () => {
  const harness = makeHarness();
  // Two windows titled the same, on different executables, with the WRONG one first: what a title-only match
  // removes is whatever happens to come first in the layout.
  const layout = harness.getState().windowLayouts[0];
  layout.arrangement.members = [
    { id: 'm-obsidian', descriptor: descriptorOn('GitHub', FINGERPRINT_B), state: 'normal', bounds: null },
    { id: 'm-chrome', descriptor: descriptorOn('GitHub', FINGERPRINT_A), state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptorOn('GitHub', FINGERPRINT_A) }],
  });
  assert.equal(result.removed, 1);
  assert.deepEqual(
    harness.getState().windowLayouts[0].arrangement.members.map((member) => member.id),
    ['m-obsidian'],
    'the Chrome member goes, the Obsidian member with the same title stays',
  );
});

test('an exact window instance distinguishes same-title siblings for add/remove decisions', async () => {
  const first = descriptorInstance('GitHub', 'W0000000000000001');
  const second = descriptorInstance('GitHub', 'W0000000000000002');
  const members = [{ id: 'm-first', descriptor: first, state: 'normal', bounds: null }];

  const addingSecond = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: second, capability: capabilityFor('GitHub') },
    { icon: 'data:second' },
  );
  assert.equal(addingSecond.adds.length, 1, 'the sibling is an add, not a removal of the first same-title window');
  assert.deepEqual(addingSecond.adds[0].descriptor, second);
  assert.equal(addingSecond.removes.length, 0);

  const removingFirst = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: first, capability: capabilityFor('GitHub') },
  );
  assert.equal(removingFirst.adds.length, 0);
  assert.deepEqual(removingFirst.removes, [{ descriptor: first }]);
});

test('picker presentation uses exact window identity and fails closed without identity', () => {
  const exact = descriptorInstance('Old VS Code title', 'W0000000000000001');
  const members = [{ id: 'm-vscode', descriptor: exact, state: 'normal', bounds: null }];

  assert.equal(windowLayoutCandidateIsMember(members, {
    title: 'backpackProject - Visual Studio Code',
    windowInstanceId: exact.windowInstanceId,
  }), true, 'a retitled candidate for the same window is still shown as a member');
  assert.equal(windowLayoutCandidateIsMember(members, {
    title: exact.title,
    windowInstanceId: 'W0000000000000002',
  }), false, 'a distinct same-title sibling remains an add');
  assert.equal(windowLayoutCandidateIsMember(members, { title: exact.title }), false,
    'a title match without a valid instance id cannot claim removal');
  assert.equal(windowLayoutCandidateIsMember(members, {
    title: exact.title,
    windowInstanceId: 'not-a-window-id',
  }), false, 'malformed identity cannot claim removal');
});

test('mixed WID and legacy identities use matching fingerprints as ambiguity and distinct fingerprints as separation', () => {
  const saved = descriptorInstance('Notepad', 'W0000000000000001');
  const members = [{ id: 'm-notepad', descriptor: saved, state: 'normal', bounds: null }];
  const legacyBound = {
    descriptor: descriptorOn(saved.title, saved.executableFingerprint),
    capability: capabilityFor(saved.title),
  };

  assert.equal(windowLayoutPickForBoundCandidate(members, legacyBound), null,
    'the legacy pair cannot identify or remove a member that has exact identity');
  const ambiguousPair = windowLayoutPickForBoundCandidate([
    { id: 'm-legacy', descriptor: descriptorOn(saved.title, saved.executableFingerprint) },
    ...members,
  ], legacyBound);
  assert.equal(ambiguousPair, null,
    'a layout mixing legacy and exact identities refuses the uncertain pair');
  assert.equal(windowLayoutPickForBoundCandidate(members, {
    descriptor: descriptorOn('Untitled - Notepad', saved.executableFingerprint),
    capability: capabilityFor('Notepad'),
  }), null, 'a title change cannot make the same executable look like a safe legacy add');
  const unrelatedLegacy = windowLayoutPickForBoundCandidate(members, {
    descriptor: descriptorOn('Calculator', FINGERPRINT_B),
    capability: capabilityFor('Calculator'),
  });
  assert.equal(unrelatedLegacy.adds.length, 1,
    'a distinct valid process-image-path fingerprint allows an unrelated legacy add');
  assert.equal(unrelatedLegacy.removes.length, 0);

  const reverseDirection = windowLayoutPickForBoundCandidate([
    { id: 'm-legacy-calculator', descriptor: descriptorOn('Calculator', FINGERPRINT_B) },
  ], {
    descriptor: descriptorInstance('Untitled - Notepad', 'W0000000000000002', FINGERPRINT_A),
    capability: capabilityFor('Notepad'),
  });
  assert.equal(reverseDirection.adds.length, 1,
    'a WID candidate with a distinct valid process-image-path fingerprint can be added');
});

test('mixed WID and legacy identities refuse when either executable fingerprint is unavailable', () => {
  const widMember = descriptorInstance('Notepad', 'W0000000000000001', FINGERPRINT_A);
  const legacyMissingFingerprint = { version: 1, title: 'Unrelated app' };
  assert.equal(windowLayoutPickForBoundCandidate([
    { id: 'm-legacy', descriptor: legacyMissingFingerprint },
  ], {
    descriptor: widMember,
    capability: capabilityFor('Notepad'),
  }), null, 'missing legacy fingerprint cannot prove a distinct executable');

  assert.equal(windowLayoutPickForBoundCandidate([
    { id: 'm-legacy', descriptor: descriptorOn('Notepad', FINGERPRINT_A) },
  ], {
    descriptor: { version: 1, title: 'Unrelated app', windowInstanceId: 'W0000000000000002' },
    capability: capabilityFor('Unrelated app'),
  }), null, 'missing WID-side fingerprint cannot prove a mixed-generation add safe');

  assert.equal(windowLayoutPickForBoundCandidate([
    { id: 'm-wid', descriptor: widMember },
  ], {
    descriptor: descriptorOn('Unrelated app', 'invalid-fingerprint'),
    capability: capabilityFor('Unrelated app'),
  }), null, 'malformed legacy fingerprint cannot downgrade into an add');
});

test('a WID candidate cannot duplicate a matching legacy member after its title changes', () => {
  const legacyMember = descriptorOn('Old - VS Code', FINGERPRINT_A);
  const candidateWID = 'W0000000000000001';
  const pick = windowLayoutPickForBoundCandidate([
    { id: 'm-legacy-vscode', descriptor: legacyMember, state: 'normal', bounds: null },
  ], {
    descriptor: descriptorInstance('backpackProject - Visual Studio Code', candidateWID, FINGERPRINT_A),
    capability: capabilityFor('Visual Studio Code'),
  }, {
    title: 'backpackProject - Visual Studio Code',
    windowInstanceId: candidateWID,
  });
  assert.equal(pick, null,
    'the shared executable fingerprint makes the retitled cross-generation identity ambiguous');
});

test('the pick applier also refuses a legacy removal against an exact-identity member', async () => {
  const saved = descriptorInstance('Notepad', 'W0000000000000001');
  const h = makeHarness();
  h.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-notepad', descriptor: saved, state: 'normal', bounds: null },
  ];
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptorOn(saved.title, saved.executableFingerprint) }],
  });
  assert.equal(result.removed, 0);
  assert.equal(result.unmatched, 0);
  assert.equal(result.ambiguous, 1);
  assert.equal(h.getState().windowLayouts[0].arrangement.members[0].id, 'm-notepad');
  assert.equal(h.countCommits(), 0);
});

test('picker refuses malformed or stale bound identity before it can add or remove', () => {
  const first = descriptorInstance('Notepad', 'W0000000000000001');
  const second = descriptorInstance('Notepad', 'W0000000000000002');
  const members = [{ id: 'm-notepad', descriptor: first, state: 'normal', bounds: null }];
  const capability = capabilityFor('Notepad');

  assert.equal(windowLayoutPickForBoundCandidate(members, {
    descriptor: { ...descriptorOn(first.title, first.executableFingerprint), windowInstanceId: 'invalid' },
    capability,
  }), null, 'a malformed identifier is not downgraded to legacy matching');
  assert.equal(windowLayoutPickForBoundCandidate(members, {
    descriptor: second,
    capability,
  }, { title: first.title, windowInstanceId: first.windowInstanceId }), null,
  'binding a different instance than the listed row is rejected');
  assert.equal(windowLayoutPickForBoundCandidate(members, {
    descriptor: descriptorOn(first.title, first.executableFingerprint),
    capability,
  }, { title: first.title, windowInstanceId: first.windowInstanceId }), null,
  'a WID-qualified row cannot be rebound as a legacy descriptor');
  assert.equal(windowLayoutPickForBoundCandidate([
    { id: 'm-legacy', descriptor: descriptorOn('Unrelated app', FINGERPRINT_B) },
  ], {
    descriptor: descriptorInstance('Different app', 'W0000000000000003', FINGERPRINT_A),
    capability,
  }, { title: 'Different app', windowInstanceId: 'W0000000000000003' }).adds.length, 1,
  'a WID candidate with a distinct valid fingerprint can be added beside a legacy member');
});

test('legacy add rebased after observation refuses newly installed exact-identity members', async () => {
  let harness;
  harness = makeHarness({
    observe: async () => {
      harness.getState().windowLayouts[0].arrangement.members.push({
        id: 'm-new-exact',
        descriptor: descriptorInstance('Notepad', 'W0000000000000001'),
        state: 'normal',
        bounds: null,
      });
      return { outcome: 'success', observation: { bounds: null, state: 'normal' } };
    },
  });
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [{ descriptor: descriptorOn('Notepad', FINGERPRINT_A), capability: capabilityFor('Notepad') }],
    removes: [],
  });
  assert.equal(result.added, 0);
  assert.equal(result.failures, 1);
  assert.equal(harness.getState().windowLayouts[0].arrangement.members.length, 3,
    'only the newer exact-identity member is present; no legacy duplicate was appended');
  assert.equal(harness.countCommits(), 0);
});

test('WID add rebased after observation refuses a newly installed same-fingerprint legacy member', async () => {
  let harness;
  harness = makeHarness({
    observe: async () => {
      harness.getState().windowLayouts[0].arrangement.members.push({
        id: 'm-new-legacy',
        descriptor: descriptorOn('Retitled Paint', FINGERPRINT_A),
        state: 'normal',
        bounds: null,
      });
      return { outcome: 'success', observation: { bounds: null, state: 'normal' } };
    },
  });
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-existing-wid', descriptor: descriptorInstance('Other WID member', 'W0000000000000002', FINGERPRINT_A), state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [{
      descriptor: descriptorInstance('Paint', 'W0000000000000001'),
      capability: capabilityFor('Paint'),
    }],
    removes: [],
  });
  assert.equal(result.added, 0);
  assert.equal(result.failures, 1);
  assert.equal(harness.getState().windowLayouts[0].arrangement.members.length, 2,
    'the rebased WID member and newly installed legacy member remain; no duplicate was appended');
  assert.equal(harness.countCommits(), 0);
});

test('duplicate exact identities show as current and the commit refuses ambiguous removal', async () => {
  const instance = descriptorInstance('Notepad', 'W0000000000000001');
  const candidate = { title: 'Retitled Notepad', windowInstanceId: instance.windowInstanceId };
  assert.equal(windowLayoutCandidateIsMember([
    { id: 'm-first', descriptor: instance },
    { id: 'm-second', descriptor: instance },
  ], candidate), true, 'the exact window is present, even if corrupted state duplicated its identity');

  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-first', descriptor: instance, state: 'normal', bounds: null },
    { id: 'm-second', descriptor: instance, state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: instance }],
  });
  assert.equal(result.ambiguous, 1);
  assert.equal(result.removed, 0);
  assert.equal(harness.getState().windowLayouts[0].arrangement.members.length, 2,
    'an ambiguous exact-identity match cannot delete either member');
});

test('an instance-qualified removal removes only that sibling when title and executable are identical', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-first', descriptor: descriptorInstance('GitHub', 'W0000000000000001'), state: 'normal', bounds: null },
    { id: 'm-second', descriptor: descriptorInstance('GitHub', 'W0000000000000002'), state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptorInstance('GitHub', 'W0000000000000002') }],
  });
  assert.equal(result.removed, 1);
  assert.equal(result.ambiguous, 0);
  assert.deepEqual(
    harness.getState().windowLayouts[0].arrangement.members.map((member) => member.id),
    ['m-first'],
    'the exact sibling remains untouched',
  );
});

test('two members with the same title AND executable are refused, not guessed between', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-first', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
    { id: 'm-second', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
  ];
  const before = JSON.stringify(harness.getState());
  const commitsBefore = harness.countCommits();
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptor('GitHub') }],
  });
  assert.equal(result.removed, 0, 'nothing is removed when the pick cannot say which member it meant');
  assert.equal(result.ambiguous, 1, 'and the refusal is reported rather than passed off as a no-op');
  assert.equal(JSON.stringify(harness.getState()), before, 'byte-zero: no member moved');
  assert.equal(harness.countCommits(), commitsBefore, 'and nothing was written');
});

test('a retitled member is not removed by a stale descriptor, and the mismatch is reported', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-chrome', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
  ];
  const before = JSON.stringify(harness.getState());
  const commitsBefore = harness.countCommits();
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    // The window was retitled between the pick and the apply - the creator's own example is a browser tab.
    removes: [{ descriptor: descriptorOn('GitHub — a new tab', FINGERPRINT_A) }],
  });
  assert.equal(result.removed, 0);
  assert.equal(result.unmatched, 1, 'a removal that found no member says so');
  assert.equal(JSON.stringify(harness.getState()), before);
  assert.equal(harness.countCommits(), commitsBefore);
});
/* The wrapper's decision, as a pure function so it can be tested rather than string-matched.
 *
 * The wrapper itself lives in the workspace entry and cannot be constructed here, so the POLICY lives in the
 * module that owns pick semantics and the entry is a three-line caller of it. These tests therefore prove the
 * decision behaviourally; that the entry obeys it is asserted separately, by reading the entry, because the
 * alternative is a harness that copies the wrapper and tests the copy. */
test('a pure refusal is not a mutation: nothing to commit, nothing to activate', () => {
  // The blocker: an inactive layout must not become active, persist, or apply real windows because a removal
  // was refused. `mutated` is what gates noteCommitted and ensureRecording.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 1, ambiguous: 0 }),
    { mutated: false, statusText: 'That window has changed since the pick — nothing was removed' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 0, ambiguous: 1 }),
    { mutated: false, statusText: 'Two windows here match that one — nothing was removed' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 1, ambiguous: 2 }),
    { mutated: false, statusText: 'Nothing was removed — 2 matched two windows; 1 could not be matched' },
    'both reasons are named rather than one standing in for the other',
  );
  // A failed add changes nothing either, so it activates nothing - only the wording is unchanged.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 2, unmatched: 0, ambiguous: 0 }),
    { mutated: false, statusText: '2 members could not be added' },
  );
});

test('a pick that changed something says what it did, including the half that was refused', () => {
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 2, failures: 0, unmatched: 0, ambiguous: 0 }),
    { mutated: true, statusText: '' },
    'an ordinary removal says nothing extra',
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 1, removed: 0, failures: 0, unmatched: 0, ambiguous: 0 }),
    { mutated: true, statusText: '' },
  );
  // The second blocker: with one removal applied and one refused, "nothing was removed" is a lie.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 1, failures: 0, unmatched: 1, ambiguous: 0 }),
    { mutated: true, statusText: 'Removed 1 — 1 could not be matched' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 1, failures: 0, unmatched: 0, ambiguous: 1 }),
    { mutated: true, statusText: 'Removed 1 — 1 matched two windows' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 2, failures: 0, unmatched: 1, ambiguous: 1 }),
    { mutated: true, statusText: 'Removed 2 — 1 matched two windows; 1 could not be matched' },
  );
});

test('a missing or unusable result reads as no mutation and says nothing', () => {
  for (const applied of [null, undefined, {}, { outcome: 'committed' }, { outcome: 'cancelled' }]) {
    assert.deepEqual(windowLayoutPickApplyOutcome(applied), { mutated: false, statusText: '' }, JSON.stringify(applied));
  }
});
test('the workspace wrapper obeys that decision: a pure refusal notifies nothing and activates nothing', async () => {
  // The wrapper lives in the workspace entry and cannot be constructed in this suite, so what is proven here is
  // (a) the decision, behaviourally, above, and (b) that the entry gates BOTH calls on it and has no ungated
  // path left anywhere. The alternative - a harness that copies the wrapper - would test the copy.
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  // Scoped to the wrapper, because the entry legitimately notifies the channel from other paths - the
  // retirement writer's own removal does, after it has proved a member was removed.
  const start = source.indexOf('async function applyWindowLayoutPickSet(');
  assert.ok(start > 0, 'the pick wrapper is where this test thinks it is');
  const end = source.indexOf('/** 019C: Ning\'s onRetireMember intent', start);
  const wrapper = source.slice(start, end);
  assert.match(wrapper, /const outcome = windowLayoutPickApplyOutcome\(applied\);/);
  assert.match(wrapper, /if \(outcome\.mutated\) windowLayoutWidgetChannelWorkspace\.noteCommitted\(layoutId\);/,
    'the commit notification is gated on a real mutation');
  assert.match(wrapper, /if \(outcome\.mutated\) \{[\s\S]*if \(activateOnMutation\) \{[\s\S]*await windowLayoutRecording\.ensureRecording\(layoutId\);/,
    'recording activation is nested under a real mutation and the explicit activation policy');
  assert.match(wrapper, /else if \(isActiveRecordingContext\(layoutId\)\) \{[\s\S]*await windowLayoutRuntimeController\.reconcileActive\(\);/,
    'a data-only attached-list removal only reconciles when this layout is already active');
  // No unconditional call may remain inside the wrapper.
  assert.doesNotMatch(wrapper, /^\s*windowLayoutWidgetChannelWorkspace\.noteCommitted\(layoutId\);$/m);
});
test('the sentence a real refused or mixed pick produces is the one the widget receives, unabridged', async () => {
  // The end of the chain the widget blocker was about: the REAL applier's output, not a hand-written status.
  // The channel test proves the wire carries a status; this proves the string on it is the computed sentence.
  const refused = makeHarness();
  const refusedApplied = await refused.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Paint') }],
    adds: [],
  });
  const refusedOutcome = windowLayoutPickApplyOutcome(refusedApplied);
  assert.equal(refusedApplied.outcome, 'committed');
  assert.equal(refusedOutcome.mutated, false, 'a refusal changed nothing');
  assert.equal(refusedOutcome.statusText, 'That window has changed since the pick — nothing was removed');
  // The widget branch bounds that sentence before it sends it; a bound that altered a real sentence would
  // put truncated words on the creator's card.
  assert.equal(windowLayoutWidgetCommittedStatus(refusedOutcome.statusText), refusedOutcome.statusText);
  assert.equal(refused.countCommits(), 0, 'a refusal still commits nothing');

  const mixed = makeHarness();
  const mixedOutcome = windowLayoutPickApplyOutcome(await mixed.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }, { descriptor: descriptor('Paint') }],
    adds: [],
  }));
  assert.equal(mixedOutcome.mutated, true, 'one member really went');
  assert.equal(mixedOutcome.statusText, 'Removed 1 — 1 could not be matched');
  assert.equal(windowLayoutWidgetCommittedStatus(mixedOutcome.statusText), mixedOutcome.statusText);
  assert.equal(mixed.countCommits(), 1);
});

test('cancel is byte-zero: no commit, no mutation', async () => {
  const h = makeHarness();
  const before = JSON.stringify(h.getState());
  const result = await h.pickApplier.apply('L1', { outcome: 'cancelled' });
  assert.equal(result.outcome, 'cancelled');
  assert.equal(h.countCommits(), 0);
  assert.equal(JSON.stringify(h.getState()), before);
});

test('committed set removes data-only and adds every successful window in ONE commit', async () => {
  const h = makeHarness();
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [
      { descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } },
    ],
  });
  assert.equal(result.outcome, 'committed');
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(result.failures, 0);
  assert.equal(h.countCommits(), 1, 'persist exactly once');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Calculator', 'Paint']);
  assert.ok(h.capabilities.has(windowLayoutMemberKey('L1', layout.arrangement.members[1].id)), 'the added capability is cached');
  assert.equal(h.icons.get(windowLayoutMemberKey('L1', layout.arrangement.members[1].id)), 'data:paint', 'the candidate icon is cached');
});

test('mixed add/remove with partial add failures counts failures and still commits once', async () => {
  let calls = 0;
  const h = makeHarness({
    observe: async () => {
      calls += 1;
      // The first add's observe fails (window closed mid-pick).
      return calls === 1
        ? { outcome: 'missing' }
        : { outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 10, height: 10 }, state: 'minimized' } };
    },
  });
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Calculator') }],
    adds: [
      { descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint' } },
      { descriptor: descriptor('Wordpad'), capability: capabilityFor('Wordpad'), candidate: { id: 'c2', title: 'Wordpad' } },
    ],
  });
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(result.failures, 1);
  assert.equal(h.countCommits(), 1, 'still one durable commit');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Notepad', 'Wordpad']);
  assert.equal(layout.arrangement.members[1].state, 'minimized', 'the successful add captures its live state');
});

test('a failed or malformed pick result is reported without committing', async () => {
  const h = makeHarness();
  const failed = await h.pickApplier.apply('L1', { outcome: 'failed', error: 'no display' });
  assert.equal(failed.outcome, 'failed');
  assert.equal(h.countCommits(), 0);
  const missing = await h.pickApplier.apply('L1', { outcome: 'committed', adds: [{ descriptor: { title: 'X' } }], removes: [] });
  assert.equal(missing.added, 0);
  assert.equal(missing.failures, 1);
  assert.equal(h.countCommits(), 0, 'an add with no capability must not commit');
});

test('removes never close or move the window (data-only)', async () => {
  const h = makeHarness();
  await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }, { descriptor: descriptor('Calculator') }],
    adds: [],
  });
  assert.equal(h.countCommits(), 1);
  assert.equal(h.getState().windowLayouts[0].arrangement.members.length, 0);
});

test('retirement removes ONE member data-only and commits once', () => {
  const h = makeHarness();
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  const result = h.retirementWriter.retire('L1', 'm1');
  assert.equal(result.outcome, 'removed');
  assert.equal(h.countCommits(), 1);
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.id), ['m2']);
  assert.ok(!h.capabilities.has(windowLayoutMemberKey('L1', 'm1')), 'the retired member binding is deleted (composite key)');
  assert.ok(!h.icons.has(windowLayoutMemberKey('L1', 'm1')), 'the retired member icon is deleted (composite key)');
});

test('retirement ignores a missing member or layout without committing', () => {
  const h = makeHarness();
  const before = JSON.stringify(h.getState());
  assert.equal(h.retirementWriter.retire('L1', 'ghost').outcome, 'ignored');
  assert.equal(h.retirementWriter.retire('GHOST', 'm1').outcome, 'ignored');
  assert.equal(h.countCommits(), 0);
  assert.equal(JSON.stringify(h.getState()), before);
});

test('019DR: read-only begun during async observation returns superseded with zero commit', async () => {
  let readOnly = false;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const h = makeHarness({
    isReadOnly: () => readOnly,
    observe: async () => {
      await hold; // hold the observation open so the handoff can begin mid-apply
      return { outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 10, height: 10 }, state: 'normal' } };
    },
  });
  // Seed the runtime maps for the existing persisted members so we can prove a
  // superseded apply leaves them byte/entry-identical. 040: composite keys.
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  h.capabilities.set(windowLayoutMemberKey('L1', 'm2'), capabilityFor('Calculator'));
  h.icons.set(windowLayoutMemberKey('L1', 'm2'), 'data:calc');
  const beforeState = JSON.stringify(h.getState());
  const beforeCaps = JSON.stringify([...h.capabilities.entries()]);
  const beforeIcons = JSON.stringify([...h.icons.entries()]);
  const pending = h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [{ descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } }],
  });
  await new Promise((resolve) => setImmediate(resolve)); // observation is in flight
  readOnly = true; // detach/read-only handoff begins
  release();
  const result = await pending;
  assert.equal(result.outcome, 'superseded', 'a typed superseded result surfaces');
  assert.equal(h.countCommits(), 0, 'zero durable commit');
  assert.equal(JSON.stringify(h.getState()), beforeState, 'state byte-identical');
  assert.equal(JSON.stringify([...h.capabilities.entries()]), beforeCaps, 'capabilities entry-identical (no delete of a retained member, no orphan set)');
  assert.equal(JSON.stringify([...h.icons.entries()]), beforeIcons, 'icons entry-identical');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Notepad', 'Calculator'],
    'byte-zero mutation: Notepad still bound, Paint never added');
  assert.equal(layout.arrangement.members.length, 2);
});

test('019DR2: the committed path applies the staged runtime-map changes exactly once', async () => {
  const h = makeHarness();
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  h.capabilities.set(windowLayoutMemberKey('L1', 'm2'), capabilityFor('Calculator'));
  h.icons.set(windowLayoutMemberKey('L1', 'm2'), 'data:calc');
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [{ descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } }],
  });
  assert.equal(result.outcome, 'committed');
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(h.countCommits(), 1);
  const layout = h.getState().windowLayouts[0];
  const addedId = layout.arrangement.members.find((member) => member.descriptor.title === 'Paint').id;
  // Exactly once: the removed member's binding/icon are gone, the added
  // member's are present, and nothing orphaned remains. 040: composite keys.
  assert.ok(!h.capabilities.has(windowLayoutMemberKey('L1', 'm1')), 'the removed member binding is deleted exactly once');
  assert.ok(!h.icons.has(windowLayoutMemberKey('L1', 'm1')), 'the removed member icon is deleted exactly once');
  assert.equal(h.capabilities.get(windowLayoutMemberKey('L1', addedId))?.bindingId, capabilityFor('Paint').bindingId, 'the added member binding is set exactly once');
  assert.equal(h.icons.get(windowLayoutMemberKey('L1', addedId)), 'data:paint', 'the added member icon is set exactly once');
  assert.equal(h.capabilities.size, 2, 'capabilities holds exactly the two remaining members');
  assert.equal(h.icons.size, 2, 'icons holds exactly the two remaining members');
});

test('019I picker commit and retirement leave state a valid object while persistence occurs', async () => {
  // Real store contract/wiring: setState updates the lexical state; store.commit
  // INSTALLS state synchronously and RETURNS Promise<boolean> for persistence.
  // The entry's FIXED commitState invokes the commit WITHOUT assigning that
  // Promise to state (JSON.stringify(Promise) == "{}" would corrupt the durable
  // snapshot and the recording timer).
  const seed = normalizeState({
    schemaVersion: 1,
    windowLayouts: [{
      id: 'L1',
      name: 'L1',
      arrangement: { version: 2, members: [{ id: 'a1', descriptor: { version: 1, title: 'A', executableFingerprint: 'a'.repeat(64) }, state: 'normal', bounds: null }] },
    }],
  });
  let state = seed;
  const saved = [];
  const commitPromises = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: async (snapshot, metadata) => { saved.push(snapshot); },
    afterCommit: () => {},
  });
  const commitState = (next) => {
    const pending = store.commit(next); // 019I: never assign the Promise to state
    commitPromises.push(pending);
    return pending;
  };
  const applier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState,
    observeCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }),
    model: { addWindowLayoutMember, removeWindowLayoutMember },
    capabilities: new Map(),
    icons: new Map(),
  });
  const applied = await applier.apply('L1', {
    outcome: 'committed',
    adds: [{ descriptor: { version: 1, title: 'Paint', executableFingerprint: 'f'.repeat(64) }, capability: { version: 1, bindingId: 'b:paint' }, candidate: { icon: 'data:paint' } }],
    removes: [],
  });
  assert.equal(applied.outcome, 'committed');
  await Promise.all(commitPromises.splice(0));
  assert.ok(state && typeof state === 'object' && !Array.isArray(state) && !(state instanceof Promise),
    'picker commit leaves state a valid workspace object, never a Promise');
  assert.ok(JSON.stringify(state).includes('"Paint"'), 'the picker commit installed the new member into state');
  assert.equal(saved.length, 1, 'picker commit persists one real snapshot');
  assert.ok(saved[0].includes('"Paint"'), 'the persisted snapshot serializes the committed member (not {} from a Promise)');
  const pickedSnapshot = JSON.parse(saved[0]);
  assert.equal(pickedSnapshot.schemaVersion, 1, 'persisted picker state keeps the Papers schema version');
  assert.ok(Array.isArray(pickedSnapshot.groups), 'persisted picker state keeps the Papers groups array');
  assert.ok(Array.isArray(pickedSnapshot.shortcuts), 'persisted picker state keeps the Papers shortcuts array');
  assert.ok(Array.isArray(pickedSnapshot.windowLayouts), 'persisted picker state keeps the window-layout extension array');

  const writer = createWindowLayoutRetirementWriter({
    getState: () => state,
    commitState,
    model: { removeWindowLayoutMember },
    capabilities: new Map(),
    icons: new Map(),
  });
  assert.equal(writer.retire('L1', 'a1').outcome, 'removed');
  await Promise.all(commitPromises.splice(0));
  assert.ok(state && typeof state === 'object' && !(state instanceof Promise),
    'retirement leaves state a valid object');
  assert.equal(saved.length, 2, 'retirement persists a second snapshot');
  const retiredSnapshot = JSON.parse(saved[1]);
  assert.equal(retiredSnapshot.schemaVersion, 1, 'persisted retirement state keeps the Papers schema version');
  assert.ok(Array.isArray(retiredSnapshot.groups), 'persisted retirement state keeps the Papers groups array');
  assert.ok(Array.isArray(retiredSnapshot.shortcuts), 'persisted retirement state keeps the Papers shortcuts array');
  assert.ok(Array.isArray(retiredSnapshot.windowLayouts), 'persisted retirement state keeps the window-layout extension array');
  assert.ok(!retiredSnapshot.windowLayouts[0].arrangement.members.some((m) => m.id === 'a1'),
    'the retired member is gone from the persisted snapshot');
});

test('019I both production writer adapters invoke store.commit without assigning its Promise to state', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const pickStart = source.indexOf('const windowLayoutPickApplier = createWindowLayoutPickApplier({');
  const retirementStart = source.indexOf('const windowLayoutRetirementWriter = createWindowLayoutRetirementWriter({');
  const retirementEnd = source.indexOf('\n});', retirementStart);
  assert.ok(pickStart >= 0 && retirementStart > pickStart && retirementEnd > retirementStart,
    'both production writer adapter blocks are present');
  const pickAdapter = source.slice(pickStart, retirementStart);
  const retirementAdapter = source.slice(retirementStart, retirementEnd + 4);
  const safeAdapter = /commitState:\s*\(next\)\s*=>\s*store\.commit\(next\)/;
  const corruptingAdapter = /commitState:[^\n]*\bstate\s*=\s*store\.commit\(next\)/;
  assert.match(pickAdapter, safeAdapter, 'picker production adapter invokes the real store commit');
  assert.doesNotMatch(pickAdapter, corruptingAdapter, 'picker production adapter never stores the commit Promise in state');
  assert.match(retirementAdapter, safeAdapter, 'retirement production adapter invokes the real store commit');
  assert.doesNotMatch(retirementAdapter, corruptingAdapter, 'retirement production adapter never stores the commit Promise in state');
});

test('direct picker self-recovers orphaned Papers sessions before attached and widget starts', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const attachedStart = source.indexOf('async function beginWindowLayoutDirectPick(layoutId)');
  const widgetStart = source.indexOf('async function beginWidgetDirectPick()');
  assert.ok(attachedStart >= 0 && widgetStart > attachedStart, 'both direct-pick entry points exist');
  const attached = source.slice(attachedStart, widgetStart);
  const widget = source.slice(widgetStart, source.indexOf("window.addEventListener('keydown'", widgetStart));
  for (const [surface, block] of [['attached', attached], ['widget', widget]]) {
    const cancel = block.indexOf('await host.pickWindowCancel()');
    const begin = block.indexOf('host.pickWindowBegin(members)');
    assert.ok(cancel >= 0 && begin > cancel, `${surface} cancels an orphan before beginning`);
    assert.match(block, /begin\.error \|\| 'Direct pick is unavailable'/,
      `${surface} exposes the real begin failure instead of masking it`);
  }
  assert.match(widget, /result\.outcome !== 'committed'/,
    'widget direct pick does not submit a cancelled native result');
  assert.match(widget, /client\.sendCommandAndWait\([\s\S]*picker-commit/,
    'widget direct pick waits for the authoritative picker commit');
  assert.match(widget, /acknowledgement\?\.type === 'stale'/,
    'widget direct pick retries once after a revision race');
  assert.match(attached, /windowLayoutRuntime\.pickUnsubscribe === pickUnsubscribe/,
    'an older attached attempt cannot unsubscribe a newer attempt');
  assert.match(widget, /widgetState\.pickUnsubscribe === pickUnsubscribe/,
    'an older widget attempt cannot unsubscribe a newer attempt');
  assert.match(widget, /const pickAttempt = Symbol\('window-layout-widget-direct-pick'\)/,
    'widget direct pick owns a per-attempt token like the attached surface');
  assert.match(widget, /widgetState\.pickAttempt !== pickAttempt/,
    'a superseded widget attempt stops after awaited host/channel work');
  assert.match(widget, /widgetState\.pickAttempt === pickAttempt/,
    'only the current widget attempt may clear shared picker ownership');
  const saved = [
    { version: 1, title: 'Paint', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0123456789abcdef' },
    { version: 1, title: 'Paint', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0123456789abcdef' },
    { version: 1, title: 'Paint', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0123456789abcdee' },
  ];
  assert.deepEqual(windowLayoutPickMemberDescriptors(saved), [saved[0], saved[2]],
    'direct-pick seeds collapse duplicate persisted identities while retaining distinct exact windows');
  assert.equal(windowLayoutPickMemberDescriptors([{ ...saved[0], windowInstanceId: 'invalid' }]), null,
    'an invalid persisted runtime identity fails closed instead of being downgraded');
  assert.equal((source.match(/windowLayoutPickMemberDescriptors\(/g) ?? []).length, 2,
    'both attached and widget direct-pick entry points use the shared exact-identity seed builder');
});

test('pagehide explicitly releases active native direct-pick ownership on both surfaces', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

  const teardownStart = source.indexOf('function teardownWindowLayoutRecording()');
  const teardownEnd = source.indexOf('// 018X1: pagehide', teardownStart);
  const teardown = source.slice(teardownStart, teardownEnd);
  assert.match(teardown, /const hadActivePick = Boolean\(windowLayoutRuntime\.pickAttempt \|\| windowLayoutRuntime\.pickUnsubscribe\)/);
  assert.match(teardown, /host\.pickWindowCancel\(\)\.catch\(\(\) => undefined\)/,
    'workspace pagehide releases a still-owned Papers picker instead of only dropping its listener');

  const widgetStart = source.indexOf('function bootstrapWindowLayoutWidget()');
  const pagehideStart = source.indexOf("  window.addEventListener('pagehide', () => {", widgetStart);
  const pagehideEnd = source.indexOf('// 035/037/039:', pagehideStart);
  const widgetPagehide = source.slice(pagehideStart, pagehideEnd);
  assert.match(widgetPagehide, /const hadActivePick = Boolean\(widgetState\.pickAttempt \|\| widgetState\.pickUnsubscribe\)/);
  assert.match(widgetPagehide, /widgetState\.pickAttempt = null/);
  assert.match(widgetPagehide, /host\.pickWindowCancel\(\)\.catch\(\(\) => undefined\)/,
    'widget pagehide invalidates the attempt and releases native ownership before the surface disappears');
});

test('040 two layouts referencing the SAME window stay cache- and state-isolated', async () => {
  // Layout A and layout B both contain a member for the SAME real window
  // (same descriptor title/fingerprint). The pick applier adds a new window to
  // LAYOUT A only; its composite capability/icon keys must not touch layout B,
  // and removing the member from A must byte-preserve B's saved arrangement.
  const makeState = (layouts) => ({ windowLayouts: layouts });
  const layoutB = {
    id: 'L2',
    name: 'L2',
    arrangement: { members: [{
      id: 'b1',
      descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) },
      state: 'minimized',
      bounds: { x: 40, y: 40, width: 300, height: 220 },
    }] },
  };
  const two = (() => {
    let state = makeState([
      { id: 'L1', name: 'L1', arrangement: { members: [] } },
      layoutB,
    ]);
    let commits = 0;
    const capabilities = new Map();
    const icons = new Map();
    const model = {
      addWindowLayoutMember: (current, layoutId, member) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
          : layout),
      }),
      removeWindowLayoutMember: (current, layoutId, memberId) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: layout.arrangement.members.filter((member) => member.id !== memberId) } }
          : layout),
      }),
    };
    const pickApplier = createWindowLayoutPickApplier({
      getState: () => state,
      commitState: (next) => { state = next; commits += 1; },
      observeCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }),
      model,
      capabilities,
      icons,
    });
    return { getState: () => state, countCommits: () => commits, pickApplier, capabilities, icons };
  })();
  const beforeB = JSON.stringify(two.getState().windowLayouts[1]);
  const applied = await two.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [{
      descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) },
      capability: { version: 1, bindingId: 'b:notepad' },
      candidate: { icon: 'data:notepad' },
    }],
    removes: [],
  });
  assert.equal(applied.outcome, 'committed');
  const layoutA = two.getState().windowLayouts[0];
  const aId = layoutA.arrangement.members[0].id;
  assert.ok(aId !== 'b1', 'each layout mints its OWN member id for the same window');
  // Composite cache keys keep layout B untouched.
  assert.ok(two.capabilities.has(windowLayoutMemberKey('L1', aId)), 'layout A capability cached under composite key');
  assert.ok(two.icons.has(windowLayoutMemberKey('L1', aId)), 'layout A icon cached under composite key');
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L2', aId)), 'no layout-A capability leaks to layout B');
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L2', 'b1')), 'layout B has no capability yet');
  // Removing the member from layout A leaves layout B byte-identical.
  const removed = two.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) } }],
  });
  assert.equal((await removed).removed, 1);
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L1', aId)), 'layout A capability removed after its member is removed');
  assert.ok(!two.icons.has(windowLayoutMemberKey('L1', aId)), 'layout A icon removed after its member is removed');
  assert.equal(JSON.stringify(two.getState().windowLayouts[1]), beforeB, 'layout B saved arrangement byte-identical after layout A add+remove');
  assert.equal(two.getState().windowLayouts[0].arrangement.members.length, 0, 'layout A member removed data-only');
});

test('picker apply waits for the durable workspace commit and reports persistence failure', async () => {
  let state = makeState([makeLayout('L1', [{ id: 'kept', title: 'Notepad' }])]);
  let releaseCommit;
  const durable = new Promise((resolve) => { releaseCommit = resolve; });
  const capabilities = new Map([[windowLayoutMemberKey('L1', 'kept'), capabilityFor('Notepad')]]);
  const icons = new Map([[windowLayoutMemberKey('L1', 'kept'), 'data:notepad']]);
  const applier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState: (next) => { state = next; return durable; },
    observeCapability: async () => ({
      outcome: 'success',
      observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' },
    }),
    model: {
      addWindowLayoutMember: (current, layoutId, member) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
          : layout),
      }),
      removeWindowLayoutMember: (current, layoutId, memberId) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: layout.arrangement.members.filter((member) => member.id !== memberId) } }
          : layout),
      }),
    },
    capabilities,
    icons,
  });
  const pending = applier.apply('L1', {
    outcome: 'committed',
    adds: [{
      descriptor: descriptorOn('Chrome', FINGERPRINT_B),
      capability: capabilityFor('Chrome'),
      candidate: { icon: 'data:image/png;base64,AAAA' },
    }],
    removes: [{ descriptor: descriptor('Notepad') }],
  });
  let settled = false;
  void pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'the picker cannot ACK committed before the durable store promise settles');
  releaseCommit(false);
  const applied = await pending;
  assert.equal(applied.outcome, 'failed');
  assert.match(applied.error, /persistence/i);
  assert.equal(capabilities.has(windowLayoutMemberKey('L1', 'kept')), true, 'failed persistence keeps the existing capability');
  assert.equal(icons.get(windowLayoutMemberKey('L1', 'kept')), 'data:notepad', 'failed persistence keeps the existing icon');
  assert.equal(capabilities.size, 1, 'failed persistence does not install staged capabilities');
  assert.equal(icons.size, 1, 'failed persistence does not install staged icons');
});

test('bound list-pick identity treats same title on another executable as an add', () => {
  const members = makeLayout('L1', [{ id: 'chrome-a', title: 'Inbox', fingerprint: FINGERPRINT_A }]).arrangement.members;
  const differentExecutable = {
    descriptor: descriptorOn('Inbox', FINGERPRINT_B),
    capability: capabilityFor('Inbox'),
  };
  const add = windowLayoutPickForBoundCandidate(members, differentExecutable, { icon: 'data:second' });
  assert.equal(add.adds.length, 1);
  assert.equal(add.removes.length, 0);
  assert.equal(add.adds[0].descriptor.executableFingerprint, FINGERPRINT_B);

  const exact = {
    descriptor: descriptorOn('Inbox', FINGERPRINT_A),
    capability: capabilityFor('Inbox'),
  };
  const remove = windowLayoutPickForBoundCandidate(members, exact);
  assert.equal(remove.adds.length, 0);
  assert.deepEqual(remove.removes, [{ descriptor: exact.descriptor }]);
});

test('explicit remove intent never turns an absent bound window into an add', () => {
  const saved = descriptorInstance('Notepad', 'W0000000000000001', FINGERPRINT_A);
  const other = descriptorInstance('Calculator', 'W0000000000000002', FINGERPRINT_B);
  const members = [{ id: 'saved', descriptor: saved, state: 'normal', bounds: null }];

  const present = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: saved, capability: capabilityFor('Notepad') },
    null,
    'remove',
  );
  assert.deepEqual(present, {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: saved }],
  });

  const absent = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: other, capability: capabilityFor('Calculator') },
    null,
    'remove',
  );
  assert.deepEqual(absent, {
    outcome: 'committed',
    adds: [],
    removes: [],
  });
});

test('attached and detached list picks use bound descriptor identity and the shared durable writer', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const attachedPickerStart = source.indexOf('async function openWindowLayoutPicker(layoutId)');
  const attachedPickerEnd = source.indexOf('/** A tracking lifecycle refresh', attachedPickerStart);
  const attachedPicker = source.slice(attachedPickerStart, attachedPickerEnd);
  assert.match(attachedPicker, /toWindowLayoutPickerRows\([\s\S]*?windowLayoutFromState\(layoutId\)\?\.arrangement\?\.members \?\? \[\],[\s\S]*?windowLayoutCandidateIsMember/,
    'attached native rows mark membership from the current layout snapshot and exact identity rule');
  assert.doesNotMatch(attachedPicker, /currentTitles|currentTitles\.has\(candidate\.title\)/,
    'attached row status does not use mutable display titles');

  const attachedStart = source.indexOf('async function handleWindowLayoutPickCandidate(layoutId, candidateId)');
  const attachedEnd = source.indexOf('/** 019B: bounded concurrent group scheduling.', attachedStart);
  const attached = source.slice(attachedStart, attachedEnd);
  assert.match(attached, /windowLayoutPickForBoundCandidate\(/);
  assert.match(attached, /await applyWindowLayoutPickSet\(/);
  assert.match(attached, /if \(!pick\) \{\s*setWindowLayoutStatus\(layoutId, windowLayoutHasValidInstanceId\(bound\.descriptor\)[\s\S]*?return false;/,
    'an unavailable or changed identity reports no mutation before the writer can run');
  assert.ok(attached.indexOf('if (!pick)') < attached.indexOf('await applyWindowLayoutPickSet('),
    'the attached picker exits before applying an unsafe toggle');
  assert.doesNotMatch(attached, /store\.commit\(|saveWorkspaceView\(|descriptor\.title\s*===\s*row\.title/,
    'attached list picking has no title-only or side-channel persistence path');
  assert.match(attached, /windowLayoutPickForBoundCandidate\([\s\S]*?'remove'/,
    'explicit attached removal uses the same semantic bound-candidate path and cannot become an add');

  const widgetStart = source.indexOf('  async function handleWidgetListCandidate(candidateId, intent = \'toggle\')');
  const widgetEnd = source.indexOf('  async function beginWidgetDirectPick()', widgetStart);
  const widget = source.slice(widgetStart, widgetEnd);
  assert.match(widget, /windowLayoutPickForBoundCandidate\(/);
  assert.match(widget, /if \(!pick\) \{\s*setWindowLayoutStatus\(layoutId, windowLayoutHasValidInstanceId\(bound\.descriptor\)[\s\S]*?return false;/,
    'the detached picker reports identity failure without sending a mutation');
  assert.ok(widget.indexOf('if (!pick)') < widget.indexOf("const command = { kind: 'picker-commit', pick }"),
    'the detached picker exits before sending an unsafe toggle');
  assert.doesNotMatch(widget, /selectedOverride|descriptor\.title\s*===\s*bound\.descriptor\.title/,
    'detached list picking decides add/remove only after binding the persisted descriptor pair');
  assert.match(widget, /windowLayoutPickForBoundCandidate\([\s\S]*?intent/,
    'detached list picking passes its toggle/remove intent into the same semantic membership decision');

  const widgetPickerStart = source.indexOf('  async function openWidgetPicker()');
  const widgetPickerEnd = source.indexOf('  function windowLayoutWidgetPickerMarkup(candidates)', widgetPickerStart);
  const widgetPicker = source.slice(widgetPickerStart, widgetPickerEnd);
  assert.match(widgetPicker, /toWindowLayoutPickerRows\([\s\S]*?widgetState\.snapshot\.members \?\? \[\],[\s\S]*?windowLayoutCandidateIsMember/,
    'detached native rows mark membership from the widget snapshot and exact identity rule');
  assert.doesNotMatch(widgetPicker, /currentTitles|currentTitles\.has\(candidate\.title\)/,
    'detached row status does not use mutable display titles');
  const widgetMarkupStart = widgetPickerEnd;
  const widgetMarkupEnd = source.indexOf('  function closeWidgetPicker()', widgetMarkupStart);
  assert.match(source.slice(widgetMarkupStart, widgetMarkupEnd), /windowLayoutCandidateIsMember\(/,
    'fallback in-card picker uses the same identity rule');

  const commandStart = source.indexOf("    if (command.kind === 'picker-commit')");
  const commandEnd = source.indexOf("    return { ok: false, error: 'unknown command' };", commandStart);
  const command = source.slice(commandStart, commandEnd);
  assert.match(command, /applied\.outcome === 'failed'/);
  assert.match(command, /ok: false, error: applied\.error/,
    'a failed durable picker commit is an error ACK, never a false committed result');
});

test('a delayed add rebases on the latest state instead of dropping concurrent widget members', async () => {
  let releaseObservation;
  const waiting = new Promise((resolve) => { releaseObservation = resolve; });
  const h = makeHarness({
    observe: async () => {
      await waiting;
      return { outcome: 'success', observation: { bounds: null, state: 'normal' } };
    },
  });
  const pending = h.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [{ descriptor: descriptor('Paint'), capability: capabilityFor('Paint') }],
    removes: [],
  });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = addWindowLayoutMember(h.getState(), 'L1', {
    id: 'peer-added',
    descriptor: descriptor('Peer window'),
    bounds: null,
    state: 'normal',
  });
  h.installState(concurrent);
  releaseObservation();

  const result = await pending;
  assert.equal(result.added, 1);
  assert.deepEqual(
    h.getState().windowLayouts[0].arrangement.members.map((member) => member.descriptor.title),
    ['Notepad', 'Calculator', 'Peer window', 'Paint'],
    'the awaited add preserves every member installed while observation was in flight',
  );
});

test('middle-click splits data unlink from Ctrl+middle-click process close', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const attachedStart = source.indexOf("elements.grid.addEventListener('auxclick', (event) => {");
  const attachedEnd = source.indexOf('// A press on a member is a CONTROL intent', attachedStart);
  const attached = source.slice(attachedStart, attachedEnd);
  assert.match(attached, /if \(event\.ctrlKey\) \{[\s\S]*closeWindowLayoutMember\([\s\S]*\)[\s\S]*\} else \{[\s\S]*handleWindowLayoutUnlink\(/,
    'the attached card closes only for Ctrl+MMB and unlinks for plain MMB');

  const memberCloseStart = source.indexOf('async function closeWindowLayoutMember(layoutId, memberId)');
  const memberCloseEnd = source.indexOf('function closeWindowLayoutPicker()', memberCloseStart);
  const memberClose = source.slice(memberCloseStart, memberCloseEnd);
  assert.match(memberClose, /host\.closeWindowCapability\(capability\)/,
    'the member Ctrl+MMB gesture closes only the selected top-level window');
  assert.doesNotMatch(memberClose, /host\.endProcessWindowCapability\(/,
    'member Ctrl+MMB never ends the owning process');

  const widgetStart = source.indexOf('  function handleWidgetCardAuxClick(event)');
  const widgetEnd = source.indexOf('  async function handleWidgetCardContextMenu(event)', widgetStart);
  const widget = source.slice(widgetStart, widgetEnd);
  assert.match(widget, /const member = event\.target\.closest\('\[data-wl-member\]'\);/);
  assert.match(widget, /if \(event\.ctrlKey\) \{[\s\S]*closeWindowLayoutMember\(layoutId, member\.dataset\.wlMember\)[\s\S]*\} else \{[\s\S]*kind: 'remove-member'/,
    'the widget closes only for Ctrl+MMB and sends a scoped unlink for plain MMB');
});

test('the all-windows picker ends only the process behind the clicked row', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function closeWindowLayoutCandidate(layoutId, candidateId, candidates)');
  const end = source.indexOf('async function closeWindowLayoutMember', start);
  const action = source.slice(start, end);
  assert.match(action, /endExactWindowCandidateProcess\(/,
    'process termination uses the exact-row-only operation');
  assert.match(action, /bindWindowCandidate:\s*host\.bindWindowCandidate/,
    'the clicked candidate id is bound directly');
  assert.match(action, /endProcessWindowCapability:\s*host\.endProcessWindowCapability/,
    'only the capability returned by that exact bind reaches process termination');
  assert.doesNotMatch(action, /bindWindowLayoutPickerCandidate\(/,
    'title/application fallback remains outside the process-end path');
  assert.doesNotMatch(action, /host\.closeWindowCapability\(/,
    'all-windows row middle-click does not accidentally close only one top-level window');
  assert.match(action, /setWindowLayoutTransientStatus\(layoutId, 'Process ended'/);
});

test('a stale process-end row id never falls back to a unique same-title application', async () => {
  const initiallyDisplayed = [{ id: 'stale-id', title: 'Notepad', applicationLabel: 'Notepad' }];
  const replacementNowAvailable = [{ id: 'replacement-id', title: 'Notepad', applicationLabel: 'Notepad' }];
  const bindCalls = [];
  let refreshCalls = 0;
  let endCalls = 0;
  const result = await endExactWindowCandidateProcess({
    candidateId: 'stale-id',
    candidates: initiallyDisplayed,
    bindWindowCandidate: async (id) => {
      bindCalls.push(id);
      return { outcome: 'missing', error: 'candidate id expired' };
    },
    windowCandidates: async () => {
      refreshCalls += 1;
      return { outcome: 'success', candidates: replacementNowAvailable };
    },
    endProcessWindowCapability: async () => { endCalls += 1; return { outcome: 'success' }; },
  });
  assert.deepEqual(bindCalls, ['stale-id'], 'the helper makes only the exact clicked-id bind');
  assert.equal(replacementNowAvailable.length, 1, 'a unique title/application replacement exists');
  assert.equal(refreshCalls, 0, 'stale process-end identities do not enumerate replacements');
  assert.deepEqual(result, { outcome: 'missing', error: 'candidate id expired' });
  assert.equal(endCalls, 0, 'a stale row id never ends the replacement process');
});

test('startup opens non-docked layouts by default without creating implicit tracking', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const baselineStart = source.indexOf('async function reconcileTrackingBaseline(providedSnapshot = null)');
  const baselineEnd = source.indexOf('async function ensureStartupWindowLayoutWidget()', baselineStart);
  const baseline = source.slice(baselineStart, baselineEnd);
  assert.match(baseline, /reconcileWindowLayoutsAfterStartup\(state, \[\.\.\.live\]\)/);
  assert.match(baseline, /if \(windowLayoutDetachment\.isReadOnly\(\) \|\| !hasDocumentWriteAuthority\(\)[\s\S]*?surfaceCoordinator\?\.role !== SURFACE_ROLE\.WRITER\) return;/,
    'only the durable workspace writer may reconcile and accept a baseline');
  assert.match(baseline, /acceptBaseline\(snapshot, async \(\) =>/,
    'the baseline accepts its lifecycle delta only after the durable reconciliation callback succeeds');
  assert.match(baseline, /if \(next !== before && !\(await store\.commit\(next\)\)\) return false;/,
    'a refused durable reconciliation keeps the lifecycle baseline retryable');
  assert.doesNotMatch(baseline, /populateTrackingLayout\(/,
    'startup does not bulk-add every window that was already open');

  const startupStart = source.indexOf('async function ensureStartupWindowLayoutWidget()');
  const startupEnd = source.indexOf('async function populateTrackingLayout', startupStart);
  const startup = source.slice(startupStart, startupEnd);
  assert.doesNotMatch(startup, /createWindowLayout\(/,
    'startup does not manufacture a tracking layout when automatic tracking was not enabled');
  assert.match(startup, /const docked = new Set\(state\.windowLayoutPillIds \?\? \[\]\)/,
    'only layouts explicitly docked into the AYG pill tray stay out of widget startup');
  assert.match(startup, /await openWindowLayoutWidgetWithRetry\(layout\.id, \{ activate: false \}\)/,
    'startup ensures every other durable layout widget without stealing focus and retries transient host failures');
  assert.doesNotMatch(startup, /hasDocumentWriteAuthority\(\)/,
    'opening an existing widget is presentation-only and must not wait for document-writer authority');
  assert.match(source, /if \(!DETACHED_SURFACE && !SCOPE_ROOT_ID\) void ensureStartupWindowLayoutWidget\(\);/,
    'an ordinary AYG surface ensures its widgets immediately after durable state loads');
  assert.doesNotMatch(startup, /tracking\?\.enabled === true/,
    'automatic widget startup no longer depends on tracking being enabled');
});

test('a fresh compact widget defaults to fully opaque independent of workspace appearance', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const start = source.indexOf('function bootstrapWindowLayoutWidget()');
  const end = source.indexOf('// 019C: the compact-widget surface never runs', start);
  const widget = source.slice(start, end);
  assert.match(widget, /storedWidgetOpacity === null \? Number\.NaN : Number\(storedWidgetOpacity\)/,
    'an absent localStorage entry is not interpreted as numeric zero');
  assert.match(widget, /: 1;\s*\n\s*function applyWidgetOpacity\(\) \{\s*const opacity = widgetOpacity;/,
    'a fresh widget starts fully opaque and applies only its widget-specific opacity');
  assert.doesNotMatch(widget, /applyWidgetOpacity\(Number\(message\.snapshot\.appearance\.backdropOpacity\)/,
    'workspace transparency does not leak into a fresh widget');
});

test('closed-window safety reconciliation removes only positively missing exact instances', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const eventStart = source.indexOf('async function processTrackingLifecycleEvent(event)');
  const eventEnd = source.indexOf('async function drainTrackingLifecycleEvents()', eventStart);
  const lifecycle = source.slice(eventStart, eventEnd);
  const start = source.indexOf('async function reconcileClosedWindowMembers()');
  const end = source.indexOf('function scheduleClosedWindowReconcile()', start);
  const reconcile = source.slice(start, end);
  assert.match(lifecycle, /const tracked = [\s\S]*?member\.descriptor\?\.windowInstanceId === event\.windowInstanceId[\s\S]*?if \(!tracked\) return;/,
    'gone events for windows absent from all layouts do not consume an exact host probe');
  assert.match(lifecycle, /confirmed = await host\.resolveWindowInstance\(event\.windowInstanceId\)/,
    'a tracked lifecycle gone is corroborated immediately by the exact resolver');
  assert.match(lifecycle, /confirmed\?\.outcome === 'success'[\s\S]*?windowLayoutGoneConfirmations\.delete\(event\.windowInstanceId\)[\s\S]*?return;/,
    'a transient gone confirmed live is retained and clears its suspicion');
  assert.match(lifecycle, /confirmed\?\.outcome === 'missing'[\s\S]*?retireClosedWindowEverywhere\([\s\S]*?source: 'lifecycle-gone-confirmed'/,
    'a tracked gone plus independent missing result retires the exact window without waiting for a renderer timer');
  assert.match(lifecycle, /if \(retired\) windowLayoutGoneConfirmations\.delete\(event\.windowInstanceId\)/,
    'failed persistence keeps the seeded close confirmation retryable');
  assert.match(source, /descriptor: event\.descriptor \?\? pending\?\.descriptor \?\? null/,
    'a failed lifecycle open keeps the same-enumeration descriptor for bounded retries');
  assert.match(reconcile, /\.\.\.\(pending\.descriptor \? \{ descriptor: pending\.descriptor \} : \{\}\)/,
    'a retry reuses the lifecycle descriptor instead of falling back to a new existence race');
  assert.match(reconcile, /host\.resolveWindowInstance\(instanceId\)/);
  assert.match(reconcile, /result\?\.outcome !== 'missing'/,
    'helper outages, timeouts, and ambiguous matches are retained');
  assert.match(reconcile, /retireClosedWindowEverywhere\(\{ version: 1, windowInstanceId: instanceId \}, \{ source: 'periodic-resolve-missing'/,
    'the periodic sweep retires the exact instance and records that the sweep decided it');
  assert.match(source, /event\?\.kind === 'closed'/,
    'hosts using close/closed lifecycle vocabulary still retire the exact instance');
  assert.match(source, /scheduleClosedWindowReconcile\(\);/,
    'the writer starts a periodic safety check even without automatic tracking');
});

test('detached picker re-entry invalidates stale chooser ownership before starting again', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const start = source.indexOf('  let widgetPickerOpen = false;');
  const end = source.indexOf('  async function handleWidgetListCandidate', start);
  const widgetPicker = source.slice(start, end);
  assert.match(widgetPicker, /let widgetPickerGeneration = 0;/,
    'the widget chooser owns an explicit attempt generation');
  assert.match(widgetPicker, /if \(widgetPickerOpen\) \{[\s\S]*?closeWidgetPicker\(\);[\s\S]*?\}/,
    're-entering an apparently open chooser invalidates the old attempt');
  assert.match(widgetPicker, /const ownsPicker = \(\) => widgetPickerOpen && widgetPickerGeneration === generation;/,
    'late native replies are scoped to the current chooser attempt');
  assert.match(widgetPicker, /openWindowLayoutPickerSession\([\s\S]*?loadCandidates: \(\) => host\.windowCandidates\([\s\S]*?isCurrent: ownsPicker/,
    'enumeration and native chooser work are scoped to the active attempt');
  assert.match(widgetPicker, /if \(!ownsPicker\(\) \|\| session\.outcome === 'stale'\) return;/,
    'a late enumeration or update cannot mutate a retired attempt');
  assert.match(widgetPicker, /const picked = session\.outcome === 'action' \? session\.action : await session\.actionPromise;\s*if \(!ownsPicker\(\)\) return;/,
    'a late chooser result cannot mutate a retired attempt');
  assert.match(widgetPicker, /widgetPickerOpen = false;\s*widgetPickerGeneration \+= 1;\s*if \(pickerHost\) pickerHost\.innerHTML = '';/,
    'close synchronously clears ownership before awaiting native dismissal');
  assert.match(widgetPicker, /if \(ownsPicker\(\)\) closeWidgetPicker\(\);/,
    'the owning finally block performs one cleanup and retired attempts do not duplicate it');
});

test('widget member gestures map plain left click to activation and plain right click to toggle', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const clickStart = source.indexOf('  function handleWidgetCardClick(event)');
  const clickEnd = source.indexOf('  function resetWidgetClearArm()', clickStart);
  const click = source.slice(clickStart, clickEnd);
  assert.match(click, /windowLayoutRuntime\.isolateMode\.click\(layoutId, memberId, false\)[\s\S]*if \(isolationTargets !== null\)/,
    'plain left click preserves isolate-mode interception');
  assert.match(click, /if \(event\.ctrlKey\)[\s\S]*if \(event\.shiftKey\)[\s\S]*if \(!member\.disabled\) void activateWidgetMember\(memberId\)/,
    'modifier selection stays intact and disabled members cannot be activated');
  assert.doesNotMatch(click, /sendWidgetNativeActions\(\[\{ memberId, operation: 'toggle' \}\]\)/,
    'left click no longer toggles visibility');

  const activateStart = source.indexOf('  async function activateWidgetMember(memberId)');
  const activateEnd = source.indexOf('  function widgetGroupTargets()', activateStart);
  const activate = source.slice(activateStart, activateEnd);
  assert.match(activate, /host\.windowControlActivate\(layoutId, memberId\)/);
  assert.match(activate, /activated\?\.outcome !== 'activated'[\s\S]*setWindowLayoutStatus/,
    'activation refusal remains visible to the creator');

  const contextStart = source.indexOf('  async function handleWidgetCardContextMenu(event)');
  const contextEnd = source.indexOf('  let widgetPickerOpen = false;', contextStart);
  const context = source.slice(contextStart, contextEnd);
  assert.match(context, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
    'the browser context menu stays suppressed for this right-button gesture');
  assert.match(context, /if \(member && event\.ctrlKey[\s\S]*if \(member && event\.shiftKey[\s\S]*if \(member\)[\s\S]*if \(!memberId \|\| member\.disabled\) return[\s\S]*sendWidgetNativeActions\(\[\{ memberId, operation: 'toggle' \}\]\)/,
    'right click preserves Ctrl/Shift behavior and toggles only an enabled member');
  assert.doesNotMatch(context, /windowControlActivate/,
    'right click no longer activates the member');
});

test('widget list pick preserves the exact chooser row across candidate binding', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function handleWidgetListCandidate');
  const end = source.indexOf('  async function beginWidgetDirectPick', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = source.slice(start, end);
  assert.match(handler, /widgetState\.candidates[\s\S]*candidate\.id === candidateId/);
  assert.match(handler, /if \(!row\) return false;/);
  assert.match(handler, /bindWindowLayoutPickerCandidate\(candidateId, row\)/);
  assert.doesNotMatch(handler, /bindWindowLayoutPickerCandidate\(candidateId, null\)/,
    'the Oct 2 merge regression must not discard the chooser row again');
});
