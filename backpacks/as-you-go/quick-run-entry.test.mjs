// What Quick Run's keys are wired to, asserted where each half now lives.
//
// This file used to assert the wiring as source shape because the entry file cannot be imported here: it
// reads the document at load time and boots the whole workspace. That is still true of the entry, but the
// wiring has moved out of it - `public/app/quick-run/quick-run-workspace.js` is the composition seam, and
// `quick-run-workspace.test.mjs` drives it for real: production markup, a real store, the real command
// object, a typed query and a keypress. So the shape assertions here are about the seam's internals (which
// keys exist, which plan decides, that no second launcher was smuggled in) and about the one thing that is
// still entry-only: the element adapter that maps dom.js's registry keys onto the handles the surface takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
const binding = await readFile(new URL('./public/app/quick-run/quick-run-workspace.js', import.meta.url), 'utf8');

const regionStart = source.indexOf('// Quick Run (STAGE 5)');
const regionEnd = source.indexOf('const keyboard = createKeyboardController({');
const region = regionStart >= 0 && regionEnd > regionStart ? source.slice(regionStart, regionEnd) : '';

test('the workspace binding hands Quick Run an activation path (STAGE 5, step 4)', () => {
  assert.notEqual(region, '', 'the Quick Run region is where the seam is composed');
  assert.match(region, /bindQuickRunWorkspace\(\{/, 'the entry composes the binding rather than the wiring');
  assert.match(binding, /onActivate:/, 'Enter has somewhere to go');
  assert.match(
    binding,
    /revalidateQuickRunRow\(getState\(\), resultKey\)/,
    'the row is re-read from the current state by its stable key before anything happens (section 5)',
  );
  assert.match(
    binding,
    /commands\.activateItem\(itemId\)/,
    'execution names the workspace command Enter already uses (sections 1.5 and 6.4)',
  );
  assert.match(binding, /setStatus\(/, 'a row that cannot run says why instead of doing nothing (section 1.6)');
  assert.match(
    binding,
    /import \{[\s\S]*?\} from '\.\/quick-run-activation\.js';/,
    'the plan comes from the module that owns it rather than being rebuilt in the binding',
  );
  for (const imported of [
    'planQuickRunActivation',
    'planQuickRunCopyPath',
    'planQuickRunReveal',
    'quickRunWorkspaceItemId',
    'revalidateQuickRunRow',
  ]) {
    assert.match(binding, new RegExp(`${imported},`), `${imported} is imported from the activation module`);
  }
  // The entry keeps the adapter and the collaborators, and nothing else: a second plan or a second key
  // handler there would be the copy the seam exists to remove.
  for (const moved of ['onActivate', 'onReveal', 'planQuickRun']) {
    assert.equal(region.includes(moved), false, `${moved} lives in the binding, not in the entry`);
  }
});

test('Shift+Enter is cut, and nothing that carried it survives (CUT 2026-09-13)', async () => {
  // The gesture was removed rather than repaired: its only write went into memory without a commit, so a
  // surface without document-write authority could be told "added" after a refused write. A cut has to be a
  // cut in every layer, or the next reader finds a handler with no plan, or a plan with no key, and
  // reconnects it. The comments in these files may *name* the cut; the code may not carry it.
  const surface = await readFile(new URL('./public/app/quick-run/quick-run-surface.js', import.meta.url), 'utf8');
  const activation = await readFile(new URL('./public/app/quick-run/quick-run-activation.js', import.meta.url), 'utf8');
  for (const [name, text] of [['the binding', binding], ['the surface', surface]]) {
    for (const token of ['onShiftEnter', 'shiftEnterNotice', 'planQuickRunShiftEnter']) {
      assert.equal(text.includes(token), false, `${name} must not carry ${token} after the cut`);
    }
  }
  assert.equal(
    /event\.key === 'Enter' && event\.shiftKey/.test(surface),
    false,
    'the surface has no Shift+Enter branch to hand anywhere',
  );
  for (const token of [
    'planQuickRunShiftEnter',
    'quickRunDuplicateMemberId',
    'QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS',
    'QUICK_RUN_ADD_NO_ACTIVE_LAYOUT',
    'QUICK_RUN_ADD_ALREADY_PRESENT',
    'add-to-layout',
  ]) {
    assert.equal(activation.includes(token), false, `the activation module must not carry ${token}`);
  }
});

test('Quick Run never writes workspace state: the store is not a collaborator at all', () => {
  // The false-success path installed state through the store without committing it. The fix is structural:
  // the binding is not handed a store and calls no write, so no future key can grow one back in quietly.
  const parameters = binding.match(/export function bindQuickRunWorkspace\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
  assert.notEqual(parameters, '', 'the binding takes a named set of collaborators');
  for (const token of ['store', 'windowLayout', 'addWindowLayoutMember', 'commit', 'persist']) {
    assert.equal(parameters.includes(token), false, `the binding must not be handed ${token}`);
  }
  assert.equal(binding.includes('replace('), false, 'and it must not replace workspace state');
  assert.equal(region.includes('store,'), false, 'the entry must not hand it one');
  assert.match(region, /bindQuickRunWorkspace\(\{/, 'the entry still composes the binding');
});
test('Ctrl+Enter reveals the occurrence inside the workspace (section 1.6)', () => {
  assert.match(binding, /onReveal: \(resultKey\) =>/, 'the mount has somewhere to hand the key');
  assert.match(
    binding,
    /const reveal = planQuickRunReveal\(current\.row\)/,
    'the plan is what decides where the reveal goes, from the row re-read out of the current tree',
  );
  assert.match(
    binding,
    /commands\.goToWorkspaceFolder\(reveal\.navigateTo\)/,
    'it navigates to the folder the occurrence lives in, by the command that accepts the root and leaves the Bin',
  );
  assert.equal(
    binding.includes('commands.activateItem(reveal.navigateTo)'),
    false,
    'and not by activateItem, which walks past a destination that has no group record',
  );
  assert.match(binding, /commands\.selectItem\(reveal\.select,/, 'and selects the occurrence itself');
  assert.match(
    binding,
    /visibleItemIds: getVisibleItemIds\(\)/,
    'the workspace own selection command takes the visible ids, supplied by the entry rather than reinvented',
  );
  assert.match(binding, /if \(!reveal\)/, 'a row with no occurrence to reveal says so instead of selecting nothing');
});

test('Ctrl+Shift+C copies a shortcut path through the existing host clipboard seam', () => {
  assert.match(binding, /onCopyPath: \(resultKey\) =>/, 'the mount has somewhere to hand the copy key');
  assert.match(binding, /const copy = planQuickRunCopyPath\(current\.row\)/, 'the copy plan is made from the current row');
  assert.match(binding, /copyText\(copy\.target\.path\)/, 'the shortcut target path reaches the clipboard seam');
  assert.match(region, /copyText: quickRunCopyText/, 'the entry passes the host clipboard seam');
});

test('Quick Run cannot render the workspace or reheat the graph: it holds no reference to either', async () => {
  const modules = [
    'quick-run-types.js',
    'quick-run-search.js',
    'quick-run-index.js',
    'quick-run-session.js',
    'quick-run-presentation.js',
    'quick-run-surface.js',
    'quick-run-activation.js',
  ];
  const sources = await Promise.all(
    modules.map((name) => readFile(new URL(`./public/app/quick-run/${name}`, import.meta.url), 'utf8')),
  );
  for (const [index, text] of sources.entries()) {
    for (const forbidden of ['render(', 'reheat', 'MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame']) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${modules[index]} must not reference ${forbidden} (sections 6.2 and 6.3): a keystroke cannot rebuild the workspace or restart physics it cannot reach`,
      );
    }
  }
  // The typing guarantee is the module scan above: none of the seven modules contains `render(`, so a
  // keystroke cannot repaint the workspace. The binding used to be allowed exactly one render call, in the
  // Shift+Enter mutation; with that gesture cut there is none, because nothing Quick Run does changes
  // workspace state. The entry's region no longer hands its render over either.
  assert.equal(binding.split('render(').length - 1, 0, 'the binding never renders the workspace');
  assert.equal(binding.includes('reheat'), false);
  assert.equal(region.includes('render: () => render(),'), false, 'the entry hands no render over');
  assert.equal(region.includes('reheat'), false);
});

test('the four Quick Run elements meet their handles by name, checked across all three files', async () => {
  // A mismatch here does not fail a test anywhere else: the surface is driven by a harness that already
  // uses the short names, so only the real entry file can be wrong, and only the running app would show
  // it. This is the lockstep check for that seam - markup id, registry key, and the handle the surface
  // is handed.
  const [markup, registry] = await Promise.all([
    readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8'),
    readFile(new URL('./public/app/dom.js', import.meta.url), 'utf8'),
  ]);
  const ids = [...markup.matchAll(/id="(quick-run-[a-z-]+)"/g)].map((match) => match[1]).sort();
  const registered = [...registry.matchAll(/(\w+): requiredElement\(document, '#(quick-run-[a-z-]+)'\)/g)]
    .map((match) => ({ key: match[1], id: match[2] }));
  assert.deepEqual(
    registered.map((entry) => entry.id).sort(),
    ids,
    'every quick-run element in the markup is registered, and the registry invents none',
  );
  const mapped = region.match(/elements: \{([\s\S]*?)\},/);
  assert.notEqual(mapped, null, 'the entry file adapts the registry to the handles the surface takes');
  for (const { key } of registered) {
    assert.match(
      mapped[1],
      new RegExp(`${key.replace('quickRun', '').toLowerCase()}: elements\\.${key},`),
      `${key} is handed over as the handle the surface reads`,
    );
  }
});

test('Quick Run activation adds no second launcher and no reveal path (sections 1.6 and 6.4)', () => {
  for (const text of [region, binding]) {
    for (const forbidden of [
      'revealShortcut',
      'revealSelection',
      'launchShortcut',
      'openWebLink',
      'setInterval',
      'fetch(',
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${forbidden} must not appear in Quick Run's activation wiring`,
      );
    }
  }
  assert.match(region, /dismissCommandSurface: quickRunDismissCommandSurface/);
});

test('focused compact-widget typing routes to the owning project command surface, not widget-local empty state', () => {
  assert.match(source, /host\.widgetQuickRunInput\('open', plan\.seed\)/);
  assert.match(source, /host\.widgetQuickRunInput\('append', plan\.text\)/);
  assert.match(source, /opening: widgetQuickRunOpening/);
  assert.doesNotMatch(source, /quickRun\.open\(plan\.seed\)/);
});
