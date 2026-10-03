const UNRESOLVED_TARGET_PLACEHOLDER =
  'https://invalid.invalid/as-you-go/unresolved-shortcut';
const UNRESOLVED_TARGET_FIELD = '__asYouGoUnresolvedTarget';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors the Windows host's accepted target shapes without granting the
 * project any launching authority. The host still validates every launch. */
function isAcceptedTarget(target) {
  if (typeof target !== 'string') return false;
  if (/^(?:[a-z]:[\\/]|[\\/])/i.test(target)) return true;
  try {
    const url = new URL(target);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function encodeShortcut(shortcut) {
  if (!isRecord(shortcut)) return shortcut;
  const next = { ...shortcut };
  delete next[UNRESOLVED_TARGET_FIELD];
  if (isAcceptedTarget(shortcut.target)) return next;

  next.target = UNRESOLVED_TARGET_PLACEHOLDER;
  next[UNRESOLVED_TARGET_FIELD] = {
    version: 1,
    target: typeof shortcut.target === 'string' ? shortcut.target : '',
  };
  return next;
}

function decodeShortcut(shortcut) {
  if (!isRecord(shortcut)) return shortcut;
  const unresolved = shortcut[UNRESOLVED_TARGET_FIELD];
  if (
    shortcut.target !== UNRESOLVED_TARGET_PLACEHOLDER
    || !isRecord(unresolved)
    || unresolved.version !== 1
    || typeof unresolved.target !== 'string'
  ) {
    return shortcut;
  }

  const next = { ...shortcut, target: unresolved.target };
  delete next[UNRESOLVED_TARGET_FIELD];
  return next;
}

function transformState(value, transformShortcut) {
  if (!isRecord(value) || !Array.isArray(value.shortcuts)) return value;
  return {
    ...value,
    shortcuts: value.shortcuts.map(transformShortcut),
  };
}

/** Makes an As you Go snapshot acceptable to the current Papers host while
 * retaining unresolved shortcut text in reversible project-owned metadata. */
export function encodeWorkspaceState(snapshot) {
  const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  const encoded = transformState(parsed, encodeShortcut);
  if (encoded === parsed) return snapshot;
  return typeof snapshot === 'string' ? JSON.stringify(encoded) : encoded;
}

/** Restores unresolved shortcut text before the workspace normalizes and
 * renders the project state. */
export function decodeWorkspaceState(snapshot) {
  const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  const decoded = transformState(parsed, decodeShortcut);
  if (decoded === parsed) return snapshot;
  return typeof snapshot === 'string' ? JSON.stringify(decoded) : decoded;
}
