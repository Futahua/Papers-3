import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMMAND_SURFACE_INVOKE_CHANNEL,
  COMMAND_SURFACE_INVOKE_REASON,
  COMMAND_SURFACE_MARKER,
  COMMAND_SURFACE_MODE,
  COMMAND_SURFACE_PARAM,
  commandSurfaceModeFromUrl,
  planCommandSurfaceInvoke,
  QUICK_RUN_INVOKE_IGNORE,
} from './public/app/quick-run/quick-run-command-surface.js';

/**
 * The launcher overlay's mode marker and its one event.
 *
 * The creator's correction: Alt+A is a LAUNCHER, not a window switcher. The overlay renders the command
 * surface on top of whatever they are using, and Papers does not come forward. The host opens a 640x220
 * window on the project URL with a marker on it, and that marker is what says "you are the command surface
 * now" - there is no second product and no second page. This file holds the parts of that contract this
 * project owns.
 */

const OVERLAY_URL = `papers-backpack://bp-1/_papers-open/abc/public/workspace-20260730b.html?${COMMAND_SURFACE_PARAM}=${COMMAND_SURFACE_MODE}`;

test('the mode marker is read from the URL, and only the exact marker counts', () => {
  assert.equal(COMMAND_SURFACE_PARAM, 'papers-surface', 'the param name the host sets');
  assert.equal(COMMAND_SURFACE_MODE, 'command-surface', 'and the value it sets');
  assert.equal(commandSurfaceModeFromUrl(OVERLAY_URL), 'overlay');
  // The workspace is the default: anything else - no marker, another surface kind, a typo - is the ordinary
  // canvas, because rendering a chrome-less palette where the workspace should be is the worse failure.
  assert.equal(commandSurfaceModeFromUrl('papers-backpack://bp-1/_papers-open/abc/public/workspace.html'), 'workspace');
  assert.equal(commandSurfaceModeFromUrl(`papers-backpack://bp-1/x?${COMMAND_SURFACE_PARAM}=widget`), 'workspace');
  assert.equal(commandSurfaceModeFromUrl(`papers-backpack://bp-1/x?${COMMAND_SURFACE_PARAM}=`), 'workspace');
  assert.equal(commandSurfaceModeFromUrl('not a url at all'), 'workspace');
  assert.equal(commandSurfaceModeFromUrl(undefined), 'workspace');
});

test('the marker survives the other things a URL carries', () => {
  assert.equal(commandSurfaceModeFromUrl(`${OVERLAY_URL}&as-you-go-folder=g-1#frag`), 'overlay');
  assert.equal(
    commandSurfaceModeFromUrl(`papers-backpack://bp-1/x?as-you-go-folder=g-1&${COMMAND_SURFACE_PARAM}=${COMMAND_SURFACE_MODE}`),
    'overlay',
    'order does not matter',
  );
});

test('the invoked event means focus-and-clear, and only for the accelerator reason', () => {
  assert.deepEqual(
    planCommandSurfaceInvoke({ reason: 'global-accelerator', chord: 'invoke' }),
    { kind: 'focus-and-clear', reload: false },
  );
  assert.deepEqual(
    planCommandSurfaceInvoke({ reason: 'bring-to-front' }),
    { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.reason },
    'the same wire carries other neutral events',
  );
  assert.deepEqual(planCommandSurfaceInvoke(null), { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.malformed });
});

test('an invocation asks for the items again when the boot load did not land', () => {
  // Measured in the installed host: the launcher opened, took the keystroke, and had no items to search. One
  // of the ways that happens is the boot load losing a race with the overlay window coming up, and the
  // cheapest honest answer to that is to ask again on the invocation - the same single source of items, the
  // same channel, no cache and no second store. A load that never failed is not repeated.
  assert.deepEqual(
    planCommandSurfaceInvoke({ reason: 'global-accelerator' }),
    { kind: 'focus-and-clear', reload: false },
  );
  assert.deepEqual(
    planCommandSurfaceInvoke({ reason: 'global-accelerator' }, { loadFailed: true }),
    { kind: 'focus-and-clear', reload: true },
  );
  assert.deepEqual(
    planCommandSurfaceInvoke({ reason: 'something-else' }, { loadFailed: true }),
    { kind: 'ignore', reason: QUICK_RUN_INVOKE_IGNORE.reason },
    'and an event that is not the chord reloads nothing',
  );
});

test('hover capture opens on its verified first character and appends later keys without reopening', () => {
  assert.deepEqual(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run', initialText: 'v', captureId: '101',
  }), { kind: 'open-seeded', seed: 'v' });
  assert.deepEqual(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run-append', appendText: 'i', captureId: '102',
  }), { kind: 'append-text', text: 'i' });
  assert.equal(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run', initialText: 'vi', captureId: '101',
  }).kind, 'ignore', 'only one bounded captured key can seed the command surface');
});

test('host-namespaced capture ids preserve the first key and ordered follow-up keys', () => {
  assert.deepEqual(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run', initialText: 'a', captureId: 'papers-1790193380123-1',
  }), { kind: 'open-seeded', seed: 'a' });
  assert.deepEqual(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run-append', appendText: 'g', captureId: 'papers-1790193380124-2',
  }), { kind: 'append-text', text: 'g' });
  assert.deepEqual(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run-append', appendText: 'h', captureId: 'papers-1790193380124-3',
  }), { kind: 'append-text', text: 'h' });
  assert.equal(planCommandSurfaceInvoke({
    reason: 'hover-type-to-run', initialText: 'a', captureId: 'bad id',
  }).kind, 'ignore', 'correlation ids remain bounded and protocol-safe');
});

test('the ids do not decide it, because a receiving surface cannot verify them', () => {
  // Measured on the host's own payload: `surfaceId` is host-generated (`sf-...`) and appears nowhere in the
  // surface's URL, which carries a different uuid. The overlay is a window the host opened for this project,
  // so anything arriving on that window is for it - filtering on an id it cannot check would only drop real
  // invocations.
  const withIds = planCommandSurfaceInvoke({ reason: 'global-accelerator', projectId: 'bp-1', surfaceId: 'sf-1' });
  assert.deepEqual(withIds, { kind: 'focus-and-clear', reload: false });
  assert.deepEqual(planCommandSurfaceInvoke({ reason: 'global-accelerator' }), withIds);
});

test('the three names are the contract’s, pinned here rather than read from the host', async () => {
  // These came from the creator's brief and from the host commit that implements it - 5acc506, whose
  // `src/main/windows/commandSurfaceOverlay.ts` declares COMMAND_SURFACE_MARKER = 'papers-surface',
  // COMMAND_SURFACE_MODE = 'command-surface' and COMMAND_SURFACE_INVOKE_CHANNEL =
  // 'papers:backpack:command-surface-invoke', with the preload relaying it under the project-side name.
  //
  // They were first asserted by reading that file out of the host checkout, and that was a mistake worth
  // recording: mid-round the host checkout was switched to another branch, the file stopped existing, the
  // read threw, the guard returned early and the test passed without checking anything. A test whose input
  // can vanish is a test that lies, so the values are pinned here and the host evidence is named in this
  // comment instead. The project's suite must not depend on another repository's checked-out branch.
  assert.equal(COMMAND_SURFACE_PARAM, 'papers-surface');
  assert.equal(COMMAND_SURFACE_MODE, 'command-surface');
  assert.equal(COMMAND_SURFACE_INVOKE_CHANNEL, 'papers:project:command-surface-invoke', 'the project-side name the preload posts');
  assert.equal(COMMAND_SURFACE_INVOKE_REASON, 'global-accelerator', 'the only reason the host sends for this event');
});

test('the command surface does not build its own dismissal', async () => {
  // The host owns Escape, in `before-input-event` on the overlay window, so that dismissal works even if the
  // page is still loading. A second dismissal path in the page would empty a window the host still has up.
  const surface = await readFile(new URL('./public/app/quick-run/quick-run-surface.js', import.meta.url), 'utf8');
  assert.match(surface, /commandSurface/, 'the surface knows the mode');
  const entry = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.equal(
    /command-surface-dismiss/.test(entry),
    false,
    'the page never sends the host dismissal channel: Escape is the host’s',
  );
});
