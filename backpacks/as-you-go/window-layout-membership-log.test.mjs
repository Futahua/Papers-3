// Diagnostic membership log: the last few layout changes, with the reason and
// the member count on each side, so an unexplained ejection can be read back.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendWindowLayoutMembershipEntry,
  normalizeWindowLayoutMembershipLog,
  WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT,
} from './public/app/window-layout-membership-log.js';
import {
  addWindowLayoutMember,
  createWindowLayout,
  normalizeState,
  removeClosedWindowFromAllLayouts,
  removeWindowLayoutMember,
} from './public/workspace-model-20260730b.js';

const INSTANCE = 'W0123456789abcdef';
const descriptor = {
  version: 1,
  title: 'Notepad',
  executableFingerprint: 'a'.repeat(64),
  windowInstanceId: INSTANCE,
};

function layoutState() {
  const created = createWindowLayout({ groups: [], shortcuts: [], windowLayouts: [] }, { name: 'Diag' });
  return { state: created, layoutId: created.windowLayouts[0].id };
}

function member(id, instanceId = INSTANCE) {
  return { id, descriptor: { ...descriptor, windowInstanceId: instanceId } };
}

test('the log keeps only the newest entries', () => {
  let log = [];
  for (let index = 0; index < WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT + 6; index += 1) {
    log = appendWindowLayoutMembershipEntry(log, { kind: 'added', memberId: `m${index}` });
  }
  assert.equal(log.length, WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT);
  assert.equal(log[0].memberId, 'm6', 'oldest entries fall out first');
  assert.equal(log[log.length - 1].memberId, `m${WINDOW_LAYOUT_MEMBERSHIP_LOG_LIMIT + 5}`);
});

test('unknown entries normalize to a bounded, typed log instead of failing state', () => {
  const normalized = normalizeWindowLayoutMembershipLog([{ kind: 'nonsense' }, null, 'junk']);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].kind, 'unknown');
  assert.equal(normalized[0].membersBefore, null);
  assert.deepEqual(normalizeWindowLayoutMembershipLog('not an array'), []);
});

test('adding and removing a member each leave one counted entry', () => {
  const { state, layoutId } = layoutState();
  const added = addWindowLayoutMember(state, layoutId, member('member-1'));
  const addEntry = added.windowLayoutMembershipLog.at(-1);
  assert.equal(addEntry.kind, 'added');
  assert.equal(addEntry.title, 'Notepad');
  assert.equal(addEntry.membersBefore, 0);
  assert.equal(addEntry.membersAfter, 1);

  const removed = removeWindowLayoutMember(added, layoutId, 'member-1');
  const removeEntry = removed.windowLayoutMembershipLog.at(-1);
  assert.equal(removeEntry.kind, 'removed');
  assert.equal(removeEntry.membersBefore, 1);
  assert.equal(removeEntry.membersAfter, 0);
});

test('a closed-window sweep records one entry per ejected icon', () => {
  const { state, layoutId } = layoutState();
  let next = addWindowLayoutMember(state, layoutId, member('member-1', 'W1111111111111111'));
  next = addWindowLayoutMember(next, layoutId, member('member-2', 'W2222222222222222'));
  next = addWindowLayoutMember(next, layoutId, member('member-3', 'W3333333333333333'));
  const before = next.windowLayoutMembershipLog.length;

  const swept = removeClosedWindowFromAllLayouts(next, { ...descriptor, windowInstanceId: 'W2222222222222222' });
  const entries = swept.windowLayoutMembershipLog.slice(before);
  assert.equal(entries.length, 1, 'exactly the ejected icon is recorded');
  assert.equal(entries[0].kind, 'closed-sweep');
  assert.equal(entries[0].reason, 'its window was reported closed');
  assert.equal(entries[0].membersBefore, 3);
  assert.equal(entries[0].membersAfter, 2);
});

test('the log survives a state round trip and stays diagnostic-only', () => {
  const { state, layoutId } = layoutState();
  const added = addWindowLayoutMember(state, layoutId, member('member-1'));
  const normalized = normalizeState(JSON.parse(JSON.stringify(added)));
  assert.equal(normalized.windowLayoutMembershipLog.length, 1);
  assert.equal(normalized.windowLayoutMembershipLog[0].kind, 'added');
  // Membership itself is unchanged by the log.
  assert.equal(normalized.windowLayouts[0].arrangement.members.length, 1);
});
