import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  planQuickRunActivation,
  planQuickRunCopyPath,
  planQuickRunReveal,
  QUICK_RUN_TARGET_GONE,
  revalidateQuickRunRow,
  quickRunWorkspaceItemId,
  QUICK_RUN_DEFERRED_WINDOW_ACTIVATION,
  QUICK_RUN_ENTER_COMMAND,
} from './public/app/quick-run/quick-run-activation.js';

const state = {
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-root', order: 1 }] },
    { id: 's-2', name: 'Office', target: '/tmp/office.md', placements: [{ id: 'p-2', parentId: 'g-root', order: 2 }] },
  ],
  windowLayouts: [
    { id: 'l-1', parentId: 'g-root', name: 'Focus', arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] } },
  ],
};

const rowsFor = (query) => quickRunSessionWithQuery(openQuickRunSession(state), query).rows;

test('a folder row plans navigation through the command the workspace already owns', () => {
  const plan = planQuickRunActivation(rowsFor('workspace')[0]);
  assert.deepEqual(plan, { action: 'navigate-folder', command: QUICK_RUN_ENTER_COMMAND, target: { groupId: 'g-root' } });
});

test('a shortcut and a link plan the launch and the URL, each naming its occurrence', () => {
  const link = planQuickRunActivation(rowsFor('docs')[0]);
  assert.equal(link.action, 'open-link');
  assert.equal(link.target.url, 'https://example.com/docs');
  assert.deepEqual(link.target, { shortcutId: 's-1', placementId: 'p-1', url: 'https://example.com/docs' });

  const shortcut = planQuickRunActivation(rowsFor('office')[0]);
  assert.equal(shortcut.action, 'launch-shortcut');
  assert.deepEqual(shortcut.target, { shortcutId: 's-2', placementId: 'p-2' });
  assert.equal(shortcut.command, QUICK_RUN_ENTER_COMMAND, 'one implementation, not a Quick Run copy');
});

test('a layout member plans a window activation that is marked deferred, and says why', () => {
  const plan = planQuickRunActivation(rowsFor('chrome')[0]);
  assert.equal(plan.action, 'activate-window');
  assert.equal(plan.command, null, 'there is no existing command to reuse for this one');
  assert.equal(plan.deferred, QUICK_RUN_DEFERRED_WINDOW_ACTIVATION);
  assert.deepEqual(plan.target, { layoutId: 'l-1', memberId: 'm-1' });
});

test('an unknown row type plans nothing rather than something arbitrary', () => {
  assert.equal(planQuickRunActivation({ type: 'mystery' }), null);
  assert.equal(planQuickRunActivation(null), null);
  assert.equal(planQuickRunActivation(undefined), null);
});

test('a target is re-read from the current state by stable key, not trusted from the index (section 5)', () => {
  const row = rowsFor('docs')[0];
  // The state as drawn: the re-read returns the same occurrence, freshly built.
  const fresh = revalidateQuickRunRow(state, row.resultKey);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.row.resultKey, row.resultKey);
  assert.equal(fresh.row.name, 'Docs');

  // The workspace moves under the index: the shortcut is renamed. The re-read is what an action would
  // plan from, so it carries the new name while the indexed row still carries the old one.
  const renamed = {
    ...state,
    shortcuts: state.shortcuts.map((entry) => (entry.id === 's-1' ? { ...entry, name: 'Handbook' } : entry)),
  };
  const after = revalidateQuickRunRow(renamed, row.resultKey);
  assert.equal(after.ok, true);
  assert.equal(after.row.name, 'Handbook', 'the current state wins over the indexed payload');
  assert.equal(row.name, 'Docs', 'and the indexed row is left as it was, as a snapshot should be');

  // The occurrence is gone: the caller gets a reason rather than an action built on stale data.
  const removed = { ...state, shortcuts: state.shortcuts.filter((entry) => entry.id !== 's-1') };
  assert.deepEqual(revalidateQuickRunRow(removed, row.resultKey), { ok: false, reason: QUICK_RUN_TARGET_GONE });
  assert.deepEqual(revalidateQuickRunRow(state, ''), { ok: false, reason: QUICK_RUN_TARGET_GONE });
  assert.deepEqual(revalidateQuickRunRow(state, 'link:p-999'), { ok: false, reason: QUICK_RUN_TARGET_GONE });
});

test('Ctrl+Enter reveals the occurrence inside the workspace and never through the host (section 1.6)', () => {
  const folder = planQuickRunReveal({
    type: 'folder', resultKey: 'folder:g-2', groupId: 'g-2', containerId: 'g-1', breadcrumbIds: ['root', 'g-1'],
  });
  assert.deepEqual(folder, {
    action: 'reveal-folder', navigateTo: 'g-1', select: 'g-2', hostReveal: false,
  });

  const link = planQuickRunReveal({
    type: 'link', resultKey: 'link:p-2', shortcutId: 's-1', placementId: 'p-2', containerId: 'root', breadcrumbIds: ['root'],
  });
  assert.equal(link.action, 'reveal-placement');
  assert.equal(link.select, 's-1', 'the shared record is what gets selected');
  assert.equal(link.placementId, 'p-2', 'and the occurrence travels with it, so the reader sees which one');
  assert.equal(link.navigateTo, 'root');

  // A Layout Item's container is the folder holding its layout - never the layout id, which the workspace's
  // open-selection command does not understand as a destination.
  const member = planQuickRunReveal({
    type: 'layout-item', resultKey: 'layout-member:l-1:m-1', layoutId: 'l-1', memberId: 'm-1',
    containerId: 'g-1', breadcrumbIds: ['root', 'g-1', 'l-1'],
  });
  assert.equal(member.action, 'reveal-layout-member');
  assert.equal(member.select, 'l-1', 'the containing layout');
  assert.equal(member.memberId, 'm-1', 'and the member inside it');
  assert.equal(member.navigateTo, 'g-1', 'the folder that holds the layout, not the layout id');
  assert.notEqual(member.navigateTo, 'l-1', 'navigating to a layout id is what silently did nothing before');

  // The boundary, asserted on every branch rather than once: a caller following this plan cannot reach the
  // host file manager, which is what section 1.6 forbids.
  for (const plan of [folder, link, member]) {
    assert.equal(plan.hostReveal, false);
  }
  assert.equal(planQuickRunReveal({ type: 'unknown-thing' }), null, 'an unknown type reveals nothing');
  assert.equal(planQuickRunReveal(null), null);
  assert.equal(
    planQuickRunReveal({ type: 'folder', groupId: 'g-9' }).navigateTo,
    null,
    'a row that carries no container at all has nowhere to navigate to, and says so rather than guessing',
  );
});

test('a root-level occurrence reveals by returning to the root, not by staying put (section 1.6)', () => {
  // The defect this holds: navigation used to be the last entry of the breadcrumb chain, and a root-level
  // occurrence has no ancestors at all - so revealing one while inside another folder left the reader in
  // that folder, with the occurrence they asked for nowhere on screen.
  for (const row of [
    { type: 'folder', resultKey: 'folder:g-top', groupId: 'g-top', containerId: 'root', breadcrumbIds: [] },
    { type: 'shortcut', resultKey: 'shortcut:p-top', shortcutId: 's-top', placementId: 'p-top', containerId: 'root', breadcrumbIds: [] },
    { type: 'link', resultKey: 'link:p-top', shortcutId: 's-top', placementId: 'p-top', containerId: 'root', breadcrumbIds: [] },
  ]) {
    assert.equal(planQuickRunReveal(row).navigateTo, 'root', `${row.type} at the root navigates back to the root`);
  }
});

test('a plan names the workspace item the existing open-selection command takes (section 6.4)', () => {
  const folder = planQuickRunActivation({ type: 'folder', groupId: 'g-2' });
  const shortcut = planQuickRunActivation({ type: 'shortcut', shortcutId: 's-1', placementId: 'p-1' });
  const link = planQuickRunActivation({ type: 'link', shortcutId: 's-1', placementId: 'p-2', target: 'https://example.com' });
  const layoutItem = planQuickRunActivation({ type: 'layout-item', layoutId: 'l-1', memberId: 'm-1' });

  assert.equal(quickRunWorkspaceItemId(folder), 'g-2', 'a folder is opened by its group id');
  assert.equal(quickRunWorkspaceItemId(shortcut), 's-1', 'a shortcut is launched by its record, not by the placement');
  assert.equal(quickRunWorkspaceItemId(link), 's-1', 'a link is the same record with a web target');
  assert.equal(quickRunWorkspaceItemId(layoutItem), null, 'a deferred Layout Item has no workspace id to hand over');
  assert.equal(quickRunWorkspaceItemId(null), null);
  assert.equal(quickRunWorkspaceItemId({ action: 'launch-shortcut', target: {} }), null);
});

test('Ctrl+Shift+C plans a shortcut or link target, never another row type', () => {
  const shortcut = planQuickRunCopyPath({
    type: 'shortcut', shortcutId: 's-2', placementId: 'p-2', target: 'C:/Program Files/Editor/editor.exe',
  });
  assert.deepEqual(shortcut, {
    action: 'copy-shortcut-path',
    target: { path: 'C:/Program Files/Editor/editor.exe', shortcutId: 's-2', placementId: 'p-2' },
  });
  assert.deepEqual(planQuickRunCopyPath({
    type: 'link', shortcutId: 's-1', placementId: 'p-1', target: 'https://example.com',
  }), {
    action: 'copy-shortcut-path',
    target: { path: 'https://example.com', shortcutId: 's-1', placementId: 'p-1' },
  });
  assert.equal(planQuickRunCopyPath({ type: 'folder', groupId: 'g-1' }), null);
  assert.equal(planQuickRunCopyPath({ type: 'shortcut', target: '' }), null);
});
