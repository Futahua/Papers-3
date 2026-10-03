import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, normalizeState } from './public/workspace-model-20260730b.js';
import {
  DEFAULT_BACKDROP_OPACITY,
  DEFAULT_BREADCRUMB_MIDDLE_SCALE,
  DEFAULT_BREADCRUMB_ROOT_SCALE,
  DEFAULT_EDGE_OPACITY,
  DEFAULT_OUTLINE_OPACITY,
  DEFAULT_REGION_OPACITY,
  DEFAULT_THEME,
  DEFAULT_TRANSPARENT_BACKGROUND,
  HOTKEY_CATALOG,
  HOTKEY_SCOPE_PROMPTS,
  HOTKEY_SCOPE_WORKSPACE,
  assignHotkey,
  canonicalizeBinding,
  clearHotkeyOverride,
  createHotkeyCatalog,
  effectiveBindings,
  getBackdropOpacity,
  getBreadcrumbMiddleScale,
  getBreadcrumbRootScale,
  getEdgeOpacity,
  getOutlineOpacity,
  getRegionOpacity,
  getTheme,
  getTransparentBackground,
  findHotkeyConflict,
  normalizeHotkeyPreferences,
  normalizeBackdropOpacity,
  normalizeEdgeOpacity,
  normalizeOutlineOpacity,
  normalizeRegionOpacity,
  normalizeViewPreferences,
  resetAllHotkeyOverrides,
  resetHotkeyOverride,
  setHotkeyOverride,
  setBackdropOpacity,
  setBreadcrumbMiddleScale,
  setBreadcrumbRootScale,
  setEdgeOpacity,
  setOutlineOpacity,
  setRegionOpacity,
  setTheme,
  setTransparentBackground,
} from './public/app/hotkeys-model.js';

test('no two actions in one scope share a default chord, and the cheap chord is claimed exactly once', () => {
  // Alt+A is a single letter with a single modifier, which is what makes it cheap to press and easy to
  // collide with. Every default in a scope is checked, not just the one that changed.
  const claimed = new Map();
  for (const action of HOTKEY_CATALOG) {
    for (const binding of action.defaults) {
      const key = `${action.scope}:${binding}`;
      assert.equal(claimed.has(key), false, `${binding} is claimed twice in the ${action.scope} scope`);
      claimed.set(key, action.id);
    }
  }
  assert.equal(claimed.get(`${HOTKEY_SCOPE_WORKSPACE}:Alt+A`), 'workspace.quick-run', 'Alt+A opens Quick Run');
  assert.equal(claimed.has(`${HOTKEY_SCOPE_WORKSPACE}:Alt+Shift+X`), false, 'and nothing claims the chord it replaced');
});

test('a stored override keeps its binding when a catalog default changes', () => {
  // Changing a DEFAULT must not rewrite a stored preference, in either direction: the override replaces the
  // defaults outright, so someone who rebound this action keeps their binding and does not also get the new
  // default, and nothing here writes to the stored value.
  const preferences = { overrides: { 'workspace.quick-run': ['Alt+Q'] } };
  assert.deepEqual(effectiveBindings('workspace.quick-run', preferences), ['Alt+Q'], 'the override is what applies');
  assert.deepEqual(
    effectiveBindings('workspace.quick-run', {}),
    ['Alt+A'],
    'and someone with no override simply gets the catalog default',
  );
  assert.equal(canonicalizeBinding({ key: 'q', altKey: true }), 'Alt+Q', 'the stored chord is the one that matches');
  assert.equal(effectiveBindings('workspace.quick-run', preferences).includes('Alt+A'), false, 'the new default does not join an overridden action');
});

test('the explicit catalog contains every current Backpack action exactly once', () => {
  assert.deepEqual(HOTKEY_CATALOG.map(({ id, group, scope, defaults }) => ({ id, group, scope, defaults })), [
    { id: 'workspace.quick-run', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Alt+A'] },
  { id: 'workspace.escape', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Escape'] },
    { id: 'workspace.group-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['G'] },
    { id: 'workspace.edit-set-membership', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+G'] },
    { id: 'workspace.select-all', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+A'] },
    { id: 'workspace.copy', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+C'] },
    { id: 'workspace.cut', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+X'] },
    { id: 'workspace.paste', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+V'] },
    { id: 'workspace.undo', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Z'] },
    { id: 'workspace.redo', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    { id: 'workspace.delete', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Delete'] },
    { id: 'workspace.reveal-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Ctrl+Enter'] },
    { id: 'workspace.open-selection', group: 'Workspace', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['Enter'] },
    { id: 'sets.rename-selected', group: 'Sets', scope: HOTKEY_SCOPE_WORKSPACE, defaults: ['F2'] },
    { id: 'copy-prompts.focus-up', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowUp'] },
    { id: 'copy-prompts.focus-down', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowDown'] },
    { id: 'copy-prompts.navigate-left', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowLeft'] },
    { id: 'copy-prompts.navigate-right', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['ArrowRight'] },
    { id: 'copy-prompts.open-or-toggle', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Enter'] },
    { id: 'copy-prompts.edit-or-rename', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['F2'] },
    { id: 'copy-prompts.delete', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Delete', 'Backspace'] },
    { id: 'copy-prompts.undo', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+Z'] },
    { id: 'copy-prompts.redo', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
    { id: 'copy-prompts.copy', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+C'] },
    { id: 'copy-prompts.cut', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+X'] },
    { id: 'copy-prompts.paste', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+V'] },
    { id: 'copy-prompts.select-all', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Ctrl+A'] },
    { id: 'copy-prompts.escape', group: 'Copy Prompts', scope: HOTKEY_SCOPE_PROMPTS, defaults: ['Escape'] },
  ]);
  assert.equal(new Set(HOTKEY_CATALOG.map((action) => action.id)).size, HOTKEY_CATALOG.length);
});

test('canonicalizeBinding produces stable modifier and key names', () => {
  assert.equal(canonicalizeBinding({ key: 'z', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z');
  assert.equal(canonicalizeBinding('control+shift+z'), 'Ctrl+Shift+Z');
  assert.equal(canonicalizeBinding({ key: 'Esc' }), 'Escape');
  assert.equal(canonicalizeBinding({ key: ' ', altKey: true }), 'Alt+Space');
  assert.equal(canonicalizeBinding({ key: '+', ctrlKey: true }), 'Ctrl+Plus');
});

test('modifier-only presses are incomplete bindings', () => {
  for (const input of [
    { key: 'Control', ctrlKey: true },
    { key: 'Shift', shiftKey: true },
    { key: 'Alt', altKey: true },
    { key: 'Meta', metaKey: true },
    'Ctrl',
    'Ctrl+',
    'Ctrl+Shift',
  ]) assert.equal(canonicalizeBinding(input), null, String(input));
});

test('effective bindings use defaults until an override replaces the complete alias list', () => {
  const redo = effectiveBindings('workspace.redo', {});
  assert.deepEqual(redo, ['Ctrl+Y', 'Ctrl+Shift+Z']);
  const customized = setHotkeyOverride({}, 'workspace.redo', ['Alt+R']);
  assert.deepEqual(effectiveBindings('workspace.redo', customized), ['Alt+R']);
  assert.equal(effectiveBindings('workspace.redo', customized).includes('Ctrl+Y'), false);
});

test('clearing stores an explicit empty override and disables the default', () => {
  const cleared = clearHotkeyOverride({}, 'workspace.group-selection');
  assert.deepEqual(cleared, { overrides: { 'workspace.group-selection': [] } });
  assert.deepEqual(effectiveBindings('workspace.group-selection', cleared), []);
});

test('resetting one override restores defaults and removes the last known override payload', () => {
  const customized = setHotkeyOverride({}, 'workspace.group-selection', ['Alt+G']);
  assert.deepEqual(resetHotkeyOverride(customized, 'workspace.group-selection'), {});
  assert.deepEqual(effectiveBindings('workspace.group-selection', customized), ['Alt+G']);
  assert.deepEqual(effectiveBindings('workspace.group-selection', resetHotkeyOverride(customized, 'workspace.group-selection')), ['G']);
});

test('reset all removes known overrides but preserves unknown action records', () => {
  const preferences = normalizeHotkeyPreferences({
    overrides: {
      'workspace.group-selection': ['Alt+G'],
      'future.action': { bindings: ['Ctrl+K'], note: 'keep me' },
    },
  });
  assert.deepEqual(resetAllHotkeyOverrides(preferences), {
    overrides: { 'future.action': { bindings: ['Ctrl+K'], note: 'keep me' } },
  });
});

test('normalization canonicalizes known records, drops malformed known values, and keeps unknown values', () => {
  const normalized = normalizeHotkeyPreferences({
    version: 7,
    overrides: {
      'workspace.redo': ['control+y', 'Ctrl+Shift+z', 'Shift', null],
      'workspace.undo': 42,
      'removed.action': ['Ctrl+K'],
    },
  });
  assert.equal(normalized.version, 7);
  assert.deepEqual(normalized.overrides['workspace.redo'], ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.overrides, 'workspace.undo'), false);
  assert.deepEqual(normalized.overrides['removed.action'], ['Ctrl+K']);
});

test('same-scope conflicts identify the existing action and leave both choices available', () => {
  const conflict = findHotkeyConflict('workspace.cut', 'Ctrl+C', {});
  assert.equal(conflict?.id, 'workspace.copy');
  const attempt = assignHotkey({}, 'workspace.cut', 'Ctrl+C');
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'conflict');
  assert.equal(attempt.conflict.id, 'workspace.copy');
  assert.deepEqual(attempt.preferences, {});
});

test('mutually exclusive scopes may use the same binding', () => {
  const attempt = assignHotkey({}, 'copy-prompts.copy', 'Ctrl+C');
  assert.equal(attempt.ok, true);
  assert.deepEqual(effectiveBindings('copy-prompts.copy', attempt.preferences), ['Ctrl+C']);
});

test('assignment rejects incomplete bindings and unknown action ids without mutation', () => {
  assert.equal(assignHotkey({}, 'workspace.copy', { key: 'Control', ctrlKey: true }).reason, 'incomplete-binding');
  const unknown = assignHotkey({}, 'removed.action', 'Alt+X');
  assert.equal(unknown.reason, 'unknown-action');
  assert.deepEqual(unknown.preferences, {});
});

test('an injected catalog action is registered through the same model path', () => {
  const catalog = createHotkeyCatalog([{
    id: 'future.preview',
    label: 'Preview future action',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Alt+P'],
  }]);
  assert.equal(catalog.some((action) => action.id === 'future.preview'), true);
  assert.deepEqual(effectiveBindings('future.preview', {}, catalog), ['Alt+P']);
  const attempt = assignHotkey({}, 'future.preview', 'Alt+Q', catalog);
  assert.equal(attempt.ok, true);
  assert.deepEqual(effectiveBindings('future.preview', attempt.preferences, catalog), ['Alt+Q']);
});

test('workspace state owns hotkeys under view.preferences and normalizes unknown records', () => {
  assert.deepEqual(emptyState().view.preferences, {});
  const restored = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: {
      preferences: {
        hotkeys: {
          overrides: {
            'workspace.group-selection': ['control+g'],
            'removed.action': { raw: true },
          },
        },
        futurePreference: { keep: true },
      },
    },
  });
  assert.deepEqual(restored.view.preferences, {
    hotkeys: {
      overrides: {
        'workspace.group-selection': ['Ctrl+G'],
        'removed.action': { raw: true },
      },
    },
    futurePreference: { keep: true },
  });
});

test('normalizing view preferences removes empty known containers and repairs malformed theme', () => {
  assert.deepEqual(normalizeViewPreferences({ hotkeys: { overrides: {} }, theme: 'paper' }), {});
});

test('theme preference defaults to light, persists dark, removes light, and preserves unknown records', () => {
  assert.equal(DEFAULT_THEME, 'light');
  assert.equal(getTheme({}), 'light');
  assert.equal(getTheme({ theme: 'invalid' }), 'light');
  const dark = setTheme({ future: { keep: true } }, 'dark');
  assert.deepEqual(dark, { future: { keep: true }, theme: 'dark' });
  assert.equal(getTheme(dark), 'dark');
  assert.deepEqual(setTheme(dark, 'light'), { future: { keep: true } });
  assert.deepEqual(normalizeViewPreferences({ theme: 'dark', future: { keep: true } }), dark);
  assert.deepEqual(normalizeViewPreferences({ theme: 'light', future: { keep: true } }), { future: { keep: true } });
});

test('transparent background defaults off, round-trips, removes its default, and preserves unknowns', () => {
  assert.equal(DEFAULT_TRANSPARENT_BACKGROUND, false);
  assert.equal(getTransparentBackground({}), false);
  assert.equal(getTransparentBackground({ transparentBackground: 'yes' }), false);
  const enabled = setTransparentBackground({ future: { keep: true } }, true);
  assert.deepEqual(enabled, { future: { keep: true }, transparentBackground: true });
  assert.equal(getTransparentBackground(enabled), true);
  assert.deepEqual(setTransparentBackground(enabled, false), { future: { keep: true } });
  assert.deepEqual(normalizeViewPreferences({ transparentBackground: true, future: { keep: true } }), enabled);
  assert.deepEqual(normalizeViewPreferences({ transparentBackground: 'yes', future: { keep: true } }), { future: { keep: true } });
});

test('edge opacity defaults safely and stores only a non-default view override', () => {
  assert.equal(DEFAULT_EDGE_OPACITY, 0.5);
  assert.equal(normalizeEdgeOpacity(undefined), 0.5);
  assert.equal(normalizeEdgeOpacity('0.8'), 0.5);
  assert.equal(normalizeEdgeOpacity(-0.1), 0.5);
  assert.equal(normalizeEdgeOpacity(1.1), 0.5);
  assert.deepEqual(setEdgeOpacity({ theme: 'paper' }, 0.5), { theme: 'paper' });
  assert.deepEqual(setEdgeOpacity({ theme: 'paper' }, 0.8), { theme: 'paper', edgeOpacity: 0.8 });
  assert.deepEqual(setEdgeOpacity({ theme: 'paper', edgeOpacity: 0.8 }, 0.5), { theme: 'paper' });
  assert.equal(getEdgeOpacity({ edgeOpacity: 0.8 }), 0.8);
});

test('visual opacity preferences normalize, persist, and remove defaults independently', () => {
  assert.equal(DEFAULT_OUTLINE_OPACITY, 1);
  assert.equal(DEFAULT_REGION_OPACITY, 1);
  assert.equal(normalizeOutlineOpacity('bad'), 1);
  assert.equal(normalizeRegionOpacity(2), 1);
  assert.equal(getOutlineOpacity({ outlineOpacity: 0.35 }), 0.35);
  assert.equal(getRegionOpacity({ regionOpacity: 0.65 }), 0.65);
  assert.deepEqual(setOutlineOpacity({ edgeOpacity: 0.8, future: true }, 0.35), { edgeOpacity: 0.8, future: true, outlineOpacity: 0.35 });
  assert.deepEqual(setRegionOpacity({ outlineOpacity: 0.35 }, 0.65), { outlineOpacity: 0.35, regionOpacity: 0.65 });
  assert.deepEqual(setOutlineOpacity({ outlineOpacity: 0.35 }, 1), {});
  assert.deepEqual(setRegionOpacity({ regionOpacity: 0.65 }, 1), {});
});

test('backdrop opacity normalizes, persists, and drops its opaque default', () => {
  assert.equal(DEFAULT_BACKDROP_OPACITY, 1);
  assert.equal(normalizeBackdropOpacity('bad'), 1);
  assert.equal(normalizeBackdropOpacity(-1), 1);
  assert.equal(getBackdropOpacity(undefined), 1);
  assert.equal(getBackdropOpacity({ backdropOpacity: 0 }), 0);
  assert.equal(getBackdropOpacity({ backdropOpacity: 0.4 }), 0.4);
  assert.deepEqual(setBackdropOpacity({ edgeOpacity: 0.8 }, 0.4), { edgeOpacity: 0.8, backdropOpacity: 0.4 });
  // Fully opaque is the default, so it is stored as an absence.
  assert.deepEqual(setBackdropOpacity({ backdropOpacity: 0.4 }, 1), {});
  // Fully transparent is a real choice and must survive a round trip.
  assert.deepEqual(normalizeViewPreferences({ backdropOpacity: 0 }), { backdropOpacity: 0 });
});

test('breadcrumb hierarchy scales persist with a 30% floor and ordered handles', () => {
  assert.equal(DEFAULT_BREADCRUMB_ROOT_SCALE, 0.3);
  assert.equal(DEFAULT_BREADCRUMB_MIDDLE_SCALE, 0.6);
  assert.equal(getBreadcrumbRootScale({}), 0.3);
  assert.equal(getBreadcrumbMiddleScale({}), 0.6);
  const customRoot = setBreadcrumbRootScale({ future: true }, 0.45);
  assert.deepEqual(customRoot, { future: true, breadcrumbRootScale: 0.45 });
  const customBoth = setBreadcrumbMiddleScale(customRoot, 0.75);
  assert.equal(getBreadcrumbRootScale(customBoth), 0.45);
  assert.equal(getBreadcrumbMiddleScale(customBoth), 0.75);
  assert.equal(getBreadcrumbRootScale(setBreadcrumbRootScale(customBoth, 0.1)), 0.3,
    'invalid values below the 30% floor return to the root default');
  assert.equal(getBreadcrumbRootScale(setBreadcrumbRootScale(customBoth, 0.9)), 0.75,
    'the root handle cannot cross the middle handle');
  assert.equal(getBreadcrumbMiddleScale(setBreadcrumbMiddleScale(customBoth, 0.35)), 0.45,
    'the middle handle cannot cross the root handle');
  assert.deepEqual(normalizeViewPreferences({ breadcrumbRootScale: 0.1, breadcrumbMiddleScale: 2 }), {},
    'invalid persisted scales repair to defaults');
});

test('view preference normalization preserves unknown records and repairs edge opacity', () => {
  assert.deepEqual(normalizeViewPreferences({ edgeOpacity: 0.75, future: { keep: true } }), {
    edgeOpacity: 0.75,
    future: { keep: true },
  });
  assert.deepEqual(normalizeViewPreferences({ edgeOpacity: 'bad', future: { keep: true } }), {
    future: { keep: true },
  });
});

test('view preference normalization repairs all opacity records while preserving unknowns', () => {
  assert.deepEqual(normalizeViewPreferences({ edgeOpacity: 0.75, outlineOpacity: 'bad', regionOpacity: 0.25, future: { keep: true } }), {
    edgeOpacity: 0.75,
    regionOpacity: 0.25,
    future: { keep: true },
  });
});
