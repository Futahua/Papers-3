/** Pure catalog and persistence rules for Backpack-owned keyboard actions.
 * Controllers and the Hotkeys page consume this registry; neither discovers
 * actions by inspecting DOM nodes or source branches. */

export const HOTKEY_SCOPE_WORKSPACE = 'workspace';
export const HOTKEY_SCOPE_PROMPTS = 'copy-prompts';
export const DEFAULT_EDGE_OPACITY = 0.5;
export const DEFAULT_OUTLINE_OPACITY = 1;
export const DEFAULT_REGION_OPACITY = 1;
/** Backdrop panel behind the canvas: 1 is the solid paper background (the
 * look before transparency existed), 0 lets the desktop through untinted. */
export const DEFAULT_BACKDROP_OPACITY = 1;
/** Ancestor (breadcrumb trail) bodies in the workspace. 1 shows them like any
 * other item; lower values let the trail recede behind real content without
 * removing it. */
export const DEFAULT_TRAIL_OPACITY = 1;
export const DEFAULT_BREADCRUMB_ROOT_SCALE = 0.3;
export const DEFAULT_BREADCRUMB_MIDDLE_SCALE = 0.6;

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MODIFIER_ALIASES = new Map([
  ['ctrl', 'Ctrl'],
  ['control', 'Ctrl'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['meta', 'Meta'],
  ['cmd', 'Meta'],
  ['command', 'Meta'],
  ['win', 'Meta'],
  ['windows', 'Meta'],
]);
const KEY_ALIASES = new Map([
  [' ', 'Space'],
  ['spacebar', 'Space'],
  ['esc', 'Escape'],
  ['del', 'Delete'],
  ['plus', 'Plus'],
  ['minus', 'Minus'],
  ['comma', 'Comma'],
  ['period', 'Period'],
  ['slash', 'Slash'],
  ['semicolon', 'Semicolon'],
  ['equal', 'Equal'],
  ['bracketleft', 'BracketLeft'],
  ['bracketright', 'BracketRight'],
  ['backslash', 'Backslash'],
  ['backquote', 'Backquote'],
  ['quote', 'Quote'],
]);
const MODIFIER_KEYS = new Set([
  'Alt', 'AltGraph', 'Control', 'Fn', 'Meta', 'OS', 'Shift',
]);

const BASE_ACTIONS = [
  {
    id: 'workspace.quick-run',
    label: 'Open Quick Run',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    // Alt+A: one modifier and one letter, which is the point - it is cheap to press. Cheap chords collide
    // more easily, so this default is pinned by a test that checks every default in every scope is claimed
    // once, and only this action claims Alt+A.
    defaults: ['Alt+A'],
  },
  {
    id: 'workspace.escape',
    label: 'Dismiss or clear current selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Escape'],
  },
  {
    id: 'workspace.group-selection',
    label: 'Create set from selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['G'],
  },
  {
    id: 'workspace.edit-set-membership',
    label: 'Edit selected items’ set memberships',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+G'],
  },
  {
    id: 'workspace.select-all',
    label: 'Select all in the current scope',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+A'],
  },
  {
    id: 'workspace.copy',
    label: 'Copy selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+C'],
  },
  {
    id: 'workspace.cut',
    label: 'Cut selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+X'],
  },
  {
    id: 'workspace.paste',
    label: 'Paste into the current destination',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+V'],
  },
  {
    id: 'workspace.undo',
    label: 'Undo',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+Z'],
  },
  {
    id: 'workspace.redo',
    label: 'Redo',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'],
  },
  {
    id: 'workspace.delete',
    label: 'Delete selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Delete'],
  },
  {
    id: 'workspace.reveal-selection',
    label: 'Reveal selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Ctrl+Enter'],
  },
  {
    id: 'workspace.open-selection',
    label: 'Open or confirm current selection',
    group: 'Workspace',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['Enter'],
  },
  {
    id: 'sets.rename-selected',
    label: 'Rename selected set',
    group: 'Sets',
    scope: HOTKEY_SCOPE_WORKSPACE,
    defaults: ['F2'],
  },
  {
    id: 'copy-prompts.focus-up',
    label: 'Focus previous prompt row',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['ArrowUp'],
  },
  {
    id: 'copy-prompts.focus-down',
    label: 'Focus next prompt row',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['ArrowDown'],
  },
  {
    id: 'copy-prompts.navigate-left',
    label: 'Collapse or focus parent',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['ArrowLeft'],
  },
  {
    id: 'copy-prompts.navigate-right',
    label: 'Expand or focus child',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['ArrowRight'],
  },
  {
    id: 'copy-prompts.open-or-toggle',
    label: 'Open prompt or toggle folder',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Enter'],
  },
  {
    id: 'copy-prompts.edit-or-rename',
    label: 'Edit prompt or rename folder',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['F2'],
  },
  {
    id: 'copy-prompts.delete',
    label: 'Delete selected prompt rows',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Delete', 'Backspace'],
  },
  {
    id: 'copy-prompts.undo',
    label: 'Undo prompt edit',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+Z'],
  },
  {
    id: 'copy-prompts.redo',
    label: 'Redo prompt edit',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'],
  },
  {
    id: 'copy-prompts.copy',
    label: 'Copy prompt rows',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+C'],
  },
  {
    id: 'copy-prompts.cut',
    label: 'Cut prompt rows',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+X'],
  },
  {
    id: 'copy-prompts.paste',
    label: 'Paste prompt rows',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+V'],
  },
  {
    id: 'copy-prompts.select-all',
    label: 'Select all visible prompt rows',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Ctrl+A'],
  },
  {
    id: 'copy-prompts.escape',
    label: 'Cancel or clear current prompt state',
    group: 'Copy Prompts',
    scope: HOTKEY_SCOPE_PROMPTS,
    defaults: ['Escape'],
  },
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
}

function normalizeKeyName(rawKey) {
  if (typeof rawKey !== 'string' || rawKey.length === 0) return null;
  if (MODIFIER_KEYS.has(rawKey) || MODIFIER_ALIASES.has(rawKey.toLowerCase())) return null;
  const alias = KEY_ALIASES.get(rawKey.toLowerCase());
  if (alias) return alias;
  if (rawKey.length === 1) {
    if (rawKey === '+') return 'Plus';
    if (rawKey === '-') return 'Minus';
    if (rawKey === ',') return 'Comma';
    if (rawKey === '.') return 'Period';
    if (rawKey === '/') return 'Slash';
    if (rawKey === ';') return 'Semicolon';
    if (rawKey === '=') return 'Equal';
    if (rawKey === '[') return 'BracketLeft';
    if (rawKey === ']') return 'BracketRight';
    if (rawKey === '\\') return 'Backslash';
    if (rawKey === '`') return 'Backquote';
    if (rawKey === "'") return 'Quote';
    return rawKey.toUpperCase();
  }
  if (/^F\d{1,2}$/i.test(rawKey)) return rawKey.toUpperCase();
  return rawKey[0].toUpperCase() + rawKey.slice(1);
}

function canonicalizeParts(key, modifiers) {
  const normalizedKey = normalizeKeyName(key);
  if (!normalizedKey) return null;
  const uniqueModifiers = [...new Set(modifiers)];
  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => uniqueModifiers.includes(modifier));
  return [...orderedModifiers, normalizedKey].join('+');
}

/** Converts a KeyboardEvent-like object or a display string to a stable name.
 * Modifier-only presses and malformed strings are intentionally incomplete. */
export function canonicalizeBinding(input) {
  if (isRecord(input) && typeof input.key === 'string') {
    const modifiers = [];
    if (input.ctrlKey === true) modifiers.push('Ctrl');
    if (input.altKey === true) modifiers.push('Alt');
    if (input.shiftKey === true) modifiers.push('Shift');
    if (input.metaKey === true) modifiers.push('Meta');
    return canonicalizeParts(input.key, modifiers);
  }
  if (typeof input !== 'string') return null;
  const parts = input.split('+');
  if (parts.some((part) => part.trim() === '')) return null;
  const rawKey = parts.pop()?.trim();
  const modifiers = [];
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.trim().toLowerCase());
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  return canonicalizeParts(rawKey, modifiers);
}

export function normalizeBindings(rawBindings) {
  const values = rawBindings === undefined ? [] : (Array.isArray(rawBindings) ? rawBindings : [rawBindings]);
  return [...new Set(values.map((value) => canonicalizeBinding(value)).filter(Boolean))];
}

function normalizeAction(action) {
  if (!isRecord(action) || typeof action.id !== 'string' || !action.id.trim()) {
    throw new TypeError('Hotkey actions need a stable id.');
  }
  if (typeof action.label !== 'string' || !action.label.trim()) {
    throw new TypeError(`Hotkey action ${action.id} needs a label.`);
  }
  if (typeof action.group !== 'string' || !action.group.trim()) {
    throw new TypeError(`Hotkey action ${action.id} needs a group.`);
  }
  if (typeof action.scope !== 'string' || !action.scope.trim()) {
    throw new TypeError(`Hotkey action ${action.id} needs a scope.`);
  }
  const defaults = normalizeBindings(action.defaults);
  if (defaults.length === 0) throw new TypeError(`Hotkey action ${action.id} needs a default binding.`);
  return {
    id: action.id,
    label: action.label,
    group: action.group,
    scope: action.scope,
    defaults,
  };
}

function freezeCatalog(catalog) {
  return Object.freeze(catalog.map((action) => Object.freeze({
    ...action,
    defaults: Object.freeze([...action.defaults]),
  })));
}

function normalizeCatalog(actions) {
  const normalized = actions.map(normalizeAction);
  const ids = new Set();
  for (const action of normalized) {
    if (ids.has(action.id)) throw new TypeError(`Duplicate hotkey action id: ${action.id}`);
    ids.add(action.id);
  }
  return normalized;
}

export const HOTKEY_CATALOG = freezeCatalog(normalizeCatalog(BASE_ACTIONS));

/** Returns a detached registry, optionally extended for a future action. */
export function createHotkeyCatalog(extraActions = []) {
  return normalizeCatalog([...HOTKEY_CATALOG, ...extraActions]);
}

function actionMap(catalog) {
  return new Map(catalog.map((action) => [action.id, action]));
}

function normalizedPreferences(rawPreferences, catalog) {
  const source = isRecord(rawPreferences) ? rawPreferences : {};
  const next = cloneValue(source);
  const actions = actionMap(catalog);
  const rawOverrides = isRecord(source.overrides) ? source.overrides : {};
  const overrides = {};
  for (const [actionId, rawBindings] of Object.entries(rawOverrides)) {
    if (!actions.has(actionId)) {
      // Unknown records survive a downgrade/upgrade round trip but are never
      // included by effectiveBindings or conflict checks.
      overrides[actionId] = cloneValue(rawBindings);
      continue;
    }
    if (Array.isArray(rawBindings) || typeof rawBindings === 'string') {
      overrides[actionId] = normalizeBindings(rawBindings);
    }
  }
  if (Object.keys(overrides).length > 0) next.overrides = overrides;
  else delete next.overrides;
  return next;
}

/** Normalizes the hotkeys object stored at `view.preferences.hotkeys`. */
export function normalizeHotkeyPreferences(rawPreferences, catalog = HOTKEY_CATALOG) {
  return normalizedPreferences(rawPreferences, catalog);
}

const OPACITY_DEFAULTS = Object.freeze({
  edgeOpacity: DEFAULT_EDGE_OPACITY,
  outlineOpacity: DEFAULT_OUTLINE_OPACITY,
  regionOpacity: DEFAULT_REGION_OPACITY,
  backdropOpacity: DEFAULT_BACKDROP_OPACITY,
  trailOpacity: DEFAULT_TRAIL_OPACITY,
});

export const DEFAULT_THEME = 'light';
export const DEFAULT_TRANSPARENT_BACKGROUND = false;

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : DEFAULT_THEME;
}

export function getTheme(rawPreferences) {
  return normalizeTheme(rawPreferences?.theme);
}

/** Stores only a non-default creator choice, preserving unrelated preferences. */
export function setTheme(rawPreferences, value) {
  const next = isRecord(rawPreferences) ? cloneValue(rawPreferences) : {};
  const theme = normalizeTheme(value);
  if (theme === DEFAULT_THEME) delete next.theme;
  else next.theme = theme;
  return next;
}

export function getTransparentBackground(rawPreferences) {
  return rawPreferences?.transparentBackground === true;
}

export function setTransparentBackground(rawPreferences, value) {
  const next = isRecord(rawPreferences) ? cloneValue(rawPreferences) : {};
  if (value === true) next.transparentBackground = true;
  else delete next.transparentBackground;
  return next;
}

function validOpacity(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeOpacity(key, value) {
  const fallback = OPACITY_DEFAULTS[key];
  return validOpacity(value) ? value : fallback;
}

function getOpacity(rawPreferences, key) {
  return normalizeOpacity(key, rawPreferences?.[key]);
}

/** Stores only a non-default creator choice, preserving unrelated preferences. */
function setOpacity(rawPreferences, key, value) {
  const next = isRecord(rawPreferences) ? cloneValue(rawPreferences) : {};
  const opacity = normalizeOpacity(key, value);
  if (opacity === OPACITY_DEFAULTS[key]) delete next[key];
  else next[key] = opacity;
  return next;
}

export const normalizeEdgeOpacity = (value) => normalizeOpacity('edgeOpacity', value);
export const getEdgeOpacity = (rawPreferences) => getOpacity(rawPreferences, 'edgeOpacity');
export const setEdgeOpacity = (rawPreferences, value) => setOpacity(rawPreferences, 'edgeOpacity', value);
export const normalizeOutlineOpacity = (value) => normalizeOpacity('outlineOpacity', value);
export const getOutlineOpacity = (rawPreferences) => getOpacity(rawPreferences, 'outlineOpacity');
export const setOutlineOpacity = (rawPreferences, value) => setOpacity(rawPreferences, 'outlineOpacity', value);
export const normalizeRegionOpacity = (value) => normalizeOpacity('regionOpacity', value);
export const getRegionOpacity = (rawPreferences) => getOpacity(rawPreferences, 'regionOpacity');
export const setRegionOpacity = (rawPreferences, value) => setOpacity(rawPreferences, 'regionOpacity', value);
export const normalizeBackdropOpacity = (value) => normalizeOpacity('backdropOpacity', value);
export const getBackdropOpacity = (rawPreferences) => getOpacity(rawPreferences, 'backdropOpacity');
export const setBackdropOpacity = (rawPreferences, value) => setOpacity(rawPreferences, 'backdropOpacity', value);
export const normalizeTrailOpacity = (value) => normalizeOpacity('trailOpacity', value);
export const getTrailOpacity = (rawPreferences) => getOpacity(rawPreferences, 'trailOpacity');
export const setTrailOpacity = (rawPreferences, value) => setOpacity(rawPreferences, 'trailOpacity', value);

function validBreadcrumbScale(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.3 && value <= 1;
}

function breadcrumbScales(rawPreferences) {
  const rawRoot = rawPreferences?.breadcrumbRootScale;
  const rawMiddle = rawPreferences?.breadcrumbMiddleScale;
  const middle = validBreadcrumbScale(rawMiddle) ? rawMiddle : DEFAULT_BREADCRUMB_MIDDLE_SCALE;
  const root = Math.min(
    validBreadcrumbScale(rawRoot) ? rawRoot : DEFAULT_BREADCRUMB_ROOT_SCALE,
    middle,
  );
  return { root, middle };
}

export function getBreadcrumbRootScale(rawPreferences) {
  return breadcrumbScales(rawPreferences).root;
}

export function getBreadcrumbMiddleScale(rawPreferences) {
  return breadcrumbScales(rawPreferences).middle;
}

function storeBreadcrumbScales(rawPreferences, root, middle) {
  const next = isRecord(rawPreferences) ? cloneValue(rawPreferences) : {};
  delete next.breadcrumbRootScale;
  delete next.breadcrumbMiddleScale;
  if (root !== DEFAULT_BREADCRUMB_ROOT_SCALE) next.breadcrumbRootScale = root;
  if (middle !== DEFAULT_BREADCRUMB_MIDDLE_SCALE) next.breadcrumbMiddleScale = middle;
  return next;
}

export function setBreadcrumbRootScale(rawPreferences, value) {
  const current = breadcrumbScales(rawPreferences);
  const requested = validBreadcrumbScale(value) ? value : DEFAULT_BREADCRUMB_ROOT_SCALE;
  return storeBreadcrumbScales(rawPreferences, Math.min(requested, current.middle), current.middle);
}

export function setBreadcrumbMiddleScale(rawPreferences, value) {
  const current = breadcrumbScales(rawPreferences);
  const requested = validBreadcrumbScale(value) ? value : DEFAULT_BREADCRUMB_MIDDLE_SCALE;
  return storeBreadcrumbScales(rawPreferences, current.root, Math.max(requested, current.root));
}

/** Normalizes the complete project-owned view/preferences object while leaving
 * unrelated future preference records untouched. */
export function normalizeViewPreferences(rawPreferences, catalog = HOTKEY_CATALOG) {
  const next = isRecord(rawPreferences) ? cloneValue(rawPreferences) : {};
  const hotkeys = normalizeHotkeyPreferences(next.hotkeys, catalog);
  if (Object.keys(hotkeys).length > 0) next.hotkeys = hotkeys;
  else delete next.hotkeys;
  if (Object.prototype.hasOwnProperty.call(next, 'theme')) {
    const theme = normalizeTheme(next.theme);
    if (theme === DEFAULT_THEME) delete next.theme;
    else next.theme = theme;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'transparentBackground')
    && next.transparentBackground !== true) delete next.transparentBackground;
  for (const [key, fallback] of Object.entries(OPACITY_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    const opacity = normalizeOpacity(key, next[key]);
    if (opacity === fallback) delete next[key];
    else next[key] = opacity;
  }
  const scales = breadcrumbScales(next);
  delete next.breadcrumbRootScale;
  delete next.breadcrumbMiddleScale;
  if (scales.root !== DEFAULT_BREADCRUMB_ROOT_SCALE) next.breadcrumbRootScale = scales.root;
  if (scales.middle !== DEFAULT_BREADCRUMB_MIDDLE_SCALE) next.breadcrumbMiddleScale = scales.middle;
  return next;
}

export function getAction(actionId, catalog = HOTKEY_CATALOG) {
  return catalog.find((action) => action.id === actionId) ?? null;
}

export function effectiveBindings(actionId, rawPreferences, catalog = HOTKEY_CATALOG) {
  const action = getAction(actionId, catalog);
  if (!action) return [];
  const preferences = normalizeHotkeyPreferences(rawPreferences, catalog);
  if (Object.prototype.hasOwnProperty.call(preferences.overrides ?? {}, actionId)) {
    return [...preferences.overrides[actionId]];
  }
  return [...action.defaults];
}

export function bindingMatchesAction(actionId, event, rawPreferences, catalog = HOTKEY_CATALOG) {
  const binding = canonicalizeBinding(event);
  return binding !== null && effectiveBindings(actionId, rawPreferences, catalog).includes(binding);
}

export function findHotkeyConflict(actionId, bindingInput, rawPreferences, catalog = HOTKEY_CATALOG) {
  const action = getAction(actionId, catalog);
  const binding = canonicalizeBinding(bindingInput);
  if (!action || !binding) return null;
  for (const candidate of catalog) {
    if (candidate.id === actionId || candidate.scope !== action.scope) continue;
    if (effectiveBindings(candidate.id, rawPreferences, catalog).includes(binding)) return candidate;
  }
  return null;
}

function withOverride(rawPreferences, actionId, bindings, catalog) {
  const preferences = normalizeHotkeyPreferences(rawPreferences, catalog);
  const overrides = { ...(preferences.overrides ?? {}), [actionId]: normalizeBindings(bindings) };
  return { ...preferences, overrides };
}

export function setHotkeyOverride(rawPreferences, actionId, bindings, catalog = HOTKEY_CATALOG) {
  if (!getAction(actionId, catalog)) throw new Error(`Unknown hotkey action: ${actionId}`);
  return withOverride(rawPreferences, actionId, bindings, catalog);
}

export function clearHotkeyOverride(rawPreferences, actionId, catalog = HOTKEY_CATALOG) {
  return setHotkeyOverride(rawPreferences, actionId, [], catalog);
}

export function resetHotkeyOverride(rawPreferences, actionId, catalog = HOTKEY_CATALOG) {
  const preferences = normalizeHotkeyPreferences(rawPreferences, catalog);
  if (!getAction(actionId, catalog)) return preferences;
  const overrides = { ...(preferences.overrides ?? {}) };
  delete overrides[actionId];
  if (Object.keys(overrides).length > 0) return { ...preferences, overrides };
  const { overrides: _removed, ...withoutOverrides } = preferences;
  return withoutOverrides;
}

/** Reset known actions only; unknown action records remain intact. */
export function resetAllHotkeyOverrides(rawPreferences, catalog = HOTKEY_CATALOG) {
  const preferences = normalizeHotkeyPreferences(rawPreferences, catalog);
  const known = new Set(catalog.map((action) => action.id));
  const overrides = Object.fromEntries(
    Object.entries(preferences.overrides ?? {}).filter(([actionId]) => !known.has(actionId)),
  );
  if (Object.keys(overrides).length > 0) return { ...preferences, overrides };
  const { overrides: _removed, ...withoutOverrides } = preferences;
  return withoutOverrides;
}

/** Attempts a complete captured binding. A conflict leaves the preferences
 * unchanged and identifies the action that owns the binding. */
export function assignHotkey(rawPreferences, actionId, bindingInput, catalog = HOTKEY_CATALOG) {
  const preferences = normalizeHotkeyPreferences(rawPreferences, catalog);
  const binding = canonicalizeBinding(bindingInput);
  const action = getAction(actionId, catalog);
  if (!action) return { ok: false, reason: 'unknown-action', preferences };
  if (!binding) return { ok: false, reason: 'incomplete-binding', preferences };
  const conflict = findHotkeyConflict(actionId, binding, preferences, catalog);
  if (conflict) return { ok: false, reason: 'conflict', conflict, preferences };
  return {
    ok: true,
    action,
    binding,
    preferences: setHotkeyOverride(preferences, actionId, [binding], catalog),
  };
}
