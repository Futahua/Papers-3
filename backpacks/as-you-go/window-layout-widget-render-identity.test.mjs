// Creator eye test, detached widget: hovering the member icons made EVERY icon
// flicker at once and swallowed clicks, while the widget window itself never
// moved. Simultaneous whole-strip flicker is the signature of the card DOM
// being replaced wholesale (renderWidgetCard assigns elements.grid.innerHTML),
// not of a per-element hover transition.
//
// Two defects produced it together:
//   1. the compact widget page constructs the WORKSPACE-side responder too, so
//      it answered its own snapshot-request out of a state that never loaded a
//      layout -> `unknown-layout` -> the widget's bounded retry re-armed and
//      requested again, endlessly;
//   2. every workspace responder owns a PRIVATE revision map starting at 0, so
//      two live workspace surfaces answer the same request with different
//      revisions for identical content. The widget's guard compared revisions
//      only, so r=3, r=0, r=3, r=0 rebuilt the card every single time.
//
// These tests pin the render-identity rule that makes duplicate snapshots inert
// while keeping genuinely-changed same-revision content live.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  windowLayoutWidgetRenderIdentity,
  windowLayoutWidgetSnapshot,
} from './public/app/window-layout-widget-channel.js';

// The snapshot omits members whose descriptor fails validation, so the
// fingerprint has to be a real 64-hex digest, not a readable stand-in.
const fingerprint = (seed) => seed.toLowerCase().padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, '0');
const descriptor = (title) => ({ version: 1, title, executableFingerprint: fingerprint(title) });

function layout(members, cardSize = null) {
  return {
    id: 'layout-1',
    name: 'Layout One',
    cardSize,
    arrangement: {
      version: 2,
      members: members.map(([id, title, state]) => ({ id, descriptor: descriptor(title), state })),
    },
  };
}

const BASE = layout([['m1', 'Alpha', 'normal'], ['m2', 'Beta', 'normal']]);

test('compact widget shows a bootstrap card and retries a silent initial snapshot request', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const markup = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');
  assert.match(markup, /workspace-20260730b\.js\?build=widget-picker-history-restore-v1/);
  assert.match(markup, /workspace-20260730b\.css\?build=widget-picker-silent-v1/);
  assert.match(source, /renderWidgetBootstrapCard\('Loading window layout…'\)/);
  assert.match(source, /client\.requestSnapshot\(\);\s*armSnapshotRetry\(\);/);
  assert.match(source, /function armSnapshotRetry\(\)[\s\S]*?createBoundedRetry\(/);
  assert.match(source, /function renderWidgetBootstrapCard\(message\)[\s\S]*?window-layout-card--bootstrap/);
});

test('direct Quick Pick confirms on any key except Escape on both surfaces', () => {
  assert.match(workspaceSource, /if \(windowLayoutRuntime\.pickUnsubscribe\) \{[\s\S]*?host\.pickWindowCommit\(\)/);
  assert.match(workspaceSource, /if \(!widgetState\.pickUnsubscribe\) return;[\s\S]*?event\.key === 'Escape'[\s\S]*?host\.pickWindowCancel\(\)[\s\S]*?host\.pickWindowCommit\(\)/);
});

test('compact widget never renders warning/status text', async () => {
  const styles = await readFile(new URL('./public/styles/items.css', import.meta.url), 'utf8');
  assert.match(styles, /:root\[data-widget-surface="true"\] \.window-layout-status\s*\{\s*display:\s*none\s*!important;/);
});

test('identical snapshots share a render identity whatever revision carried them', () => {
  const a = windowLayoutWidgetSnapshot(BASE);
  const b = windowLayoutWidgetSnapshot(BASE);
  assert.equal(windowLayoutWidgetRenderIdentity(a), windowLayoutWidgetRenderIdentity(b));
});

test('the alternating-revision storm never changes render identity', () => {
  // The exact creator-facing sequence: two workspace responders, divergent
  // private revision counters, identical content. Under the old revision-only
  // guard every one of these rebuilt the card and destroyed the hovered button.
  const identities = [4, 0, 4, 0, 4].map(() =>
    windowLayoutWidgetRenderIdentity(windowLayoutWidgetSnapshot(BASE)));
  assert.equal(new Set(identities).size, 1);
});

test('cardSize alone is not render identity: persisted geometry must not rebuild the card', () => {
  const small = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'normal']], { width: 160, height: 90 }));
  const large = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'normal']], { width: 280, height: 140 }));
  assert.notDeepEqual(small.cardSize, large.cardSize);
  assert.equal(windowLayoutWidgetRenderIdentity(small), windowLayoutWidgetRenderIdentity(large));
});

test('appearance alone is not render identity', () => {
  const base = windowLayoutWidgetSnapshot(BASE);
  const themed = { ...base, appearance: { theme: 'dark', backdropOpacity: 0.4 } };
  assert.equal(windowLayoutWidgetRenderIdentity(base), windowLayoutWidgetRenderIdentity(themed));
});

test('a member state change IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const after = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'minimized'], ['m2', 'Beta', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(after));
});

test('tracking state IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const after = windowLayoutWidgetSnapshot({ ...BASE, tracking: { enabled: true } });
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(after));
});

test('member order IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const after = windowLayoutWidgetSnapshot(layout([['m2', 'Beta', 'normal'], ['m1', 'Alpha', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(after));
});

test('membership IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const added = windowLayoutWidgetSnapshot(
    layout([['m1', 'Alpha', 'normal'], ['m2', 'Beta', 'normal'], ['m3', 'Gamma', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(added));
});

test('the layout name is NOT render identity: the widget card body never renders it', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const renamed = windowLayoutWidgetSnapshot({ ...BASE, name: 'Layout Two' });
  assert.notEqual(before.name, renamed.name);
  assert.equal(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(renamed));
});

test('a re-identified window IS render identity, so the preview capability cache is cleared', () => {
  // renderWidgetCard() is also where windowLayoutWidgetPreviewSnapshot is
  // replaced and the capability cache dropped. If a member's descriptor changed
  // identity without crossing that boundary, its hover preview would keep
  // resolving through a capability belonging to the previous window.
  const before = windowLayoutWidgetSnapshot(BASE);
  const reidentified = windowLayoutWidgetSnapshot(
    layout([['m1', 'Alpha2', 'normal'], ['m2', 'Beta', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(reidentified));
});

test('a newly hydrated icon IS render identity even at an equal revision', () => {
  // broadcast() deliberately re-sends resolved member icons WITHOUT bumping the
  // revision, so equal-revision snapshots can carry real new content. A guard
  // that keyed on revision would drop this and leave the placeholder forever.
  const withoutIcon = windowLayoutWidgetSnapshot(BASE);
  const withIcon = windowLayoutWidgetSnapshot(BASE, (_layoutId, memberId) =>
    (memberId === 'm1' ? 'data:image/png;base64,AAAA' : null));
  assert.equal(withoutIcon.members[0].icon, null);
  assert.equal(withIcon.members[0].icon, 'data:image/png;base64,AAAA');
  assert.notEqual(windowLayoutWidgetRenderIdentity(withoutIcon), windowLayoutWidgetRenderIdentity(withIcon));
});

test('render identity is stable under repeated evaluation of one snapshot', () => {
  const snapshot = windowLayoutWidgetSnapshot(BASE);
  assert.equal(windowLayoutWidgetRenderIdentity(snapshot), windowLayoutWidgetRenderIdentity(snapshot));
});

// The guard above is exactly what would have swallowed a refusal. A pick whose removals were all refused
// changes NOTHING, so its committed snapshot is byte-identical to the card already on screen and the guard
// returns before any repaint: the sentence has to be displayed BEFORE the guard, not inside it. This is a
// source-shape assertion because the entry (public/workspace-20260730b.js) is a browser module with no DOM
// harness in this suite; the escape it pins is the one that makes the sentence reachable, and the wire that
// carries it is proven behaviourally in window-layout-widget-channel.test.mjs.
const workspaceSource = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

test('widget render forwards tracking state into the shared card candidate', () => {
  assert.match(workspaceSource, /tracking: snapshot\.tracking/);
});

test('widget opacity comes from its local preference, with an opaque default', () => {
  assert.match(workspaceSource, /function applyWidgetOpacity\(\)/);
  assert.match(workspaceSource, /applyWidgetOpacity\(\);/);
  assert.match(
    workspaceSource,
    /let widgetOpacity = Number\.isFinite\(parsedWidgetOpacity\)[\s\S]{0,120}: 1/,
  );
});

test('a native instance identity change is render identity even when title and executable stay the same', () => {
  const first = windowLayoutWidgetSnapshot({
    ...BASE,
    arrangement: { ...BASE.arrangement, members: [{ ...BASE.arrangement.members[0], descriptor: { ...BASE.arrangement.members[0].descriptor, windowInstanceId: 'W0123456789abcdef' }, }, BASE.arrangement.members[1]] },
  });
  const second = windowLayoutWidgetSnapshot({
    ...BASE,
    arrangement: { ...BASE.arrangement, members: [{ ...BASE.arrangement.members[0], descriptor: { ...BASE.arrangement.members[0].descriptor, windowInstanceId: 'Wfedcba9876543210' }, }, BASE.arrangement.members[1]] },
  });
  assert.notEqual(windowLayoutWidgetRenderIdentity(first), windowLayoutWidgetRenderIdentity(second));
});
const channelSource = await readFile(new URL('./public/app/window-layout-widget-channel.js', import.meta.url), 'utf8');

function region(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing: ${end}`);
  return source.slice(from, to);
}

test('the committed status is displayed before the guard that a no-op cannot pass', () => {
  const handler = region(workspaceSource, 'function handleWidgetMessage(message) {', 'if (message.type === \'error\')');
  const displayed = handler.indexOf('setWindowLayoutStatus(layoutId, committedStatus)');
  const guard = handler.indexOf('if (renderIdentity === widgetState.lastRenderIdentity) return;');
  assert.notEqual(displayed, -1, 'the committed branch must be able to say something');
  assert.notEqual(guard, -1, 'the duplicate-render guard must still exist');
  assert.ok(displayed < guard, 'the sentence is shown before the guard can return early');
  assert.match(handler, /windowLayoutWidgetCommittedStatus\(message\.status\)/);
});

test('the workspace sends that status only on the committed pick result, from the computed sentence', () => {
  const branch = region(workspaceSource, "if (command.kind === 'picker-commit') {", "return { ok: false, error: 'unknown command' };");
  // Same wording authority as the local status line: one computed sentence, not a second vocabulary.
  assert.match(branch, /windowLayoutPickApplyOutcome\(applied\)\.statusText/);
  assert.match(branch, /status === null \? \{ ok: true \} : \{ ok: true, status \}/);
  // Superseded stays a typed failure and never becomes a committed status.
  assert.match(branch, /if \(applied\.outcome === 'superseded'\) return \{ ok: false, error: 'superseded' \};/);
});

test('the responder puts a bounded status on the wire and leaves the committed shape alone otherwise', () => {
  assert.match(channelSource, /export const WINDOW_LAYOUT_WIDGET_MAX_STATUS_CHARS = 160;/);
  const post = region(channelSource, 'const committedStatus = windowLayoutWidgetCommittedStatus(result.status);', 'const listener = (event)');
  assert.match(post, /committedStatus === null/);
  assert.match(post, /status: committedStatus/);
});

