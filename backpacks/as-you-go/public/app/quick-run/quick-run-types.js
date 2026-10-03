/**
 * Quick Run — type-filter vocabulary and cycle.
 *
 * The contract's first export, because it is the only part of Quick Run that is fully specified and
 * entirely pure. Section 1.4 of the checklist fixes: the cycle All, Folders, Shortcuts, Links, Layout
 * Items with Tab forward and Shift+Tab backward; only result types with at least one current query match
 * receive type chips; All is shown whenever there is at least one result; and an active filter that loses
 * all matches falls back to All immediately.
 *
 * No DOM, no host, no hotkey, no persisted state: every later stage consumes this.
 */

export const QUICK_RUN_FILTERS = Object.freeze([
  'All',
  'Folders',
  'Shortcuts',
  'Links',
  'Layout Items',
]);

/** The result kinds the searchable universe produces (section 2.1). */
export const QUICK_RUN_RESULT_KINDS = Object.freeze([
  'folder',
  'shortcut',
  'link',
  'layout-item',
]);

const KIND_BY_FILTER = Object.freeze({
  Folders: 'folder',
  Shortcuts: 'shortcut',
  Links: 'link',
  'Layout Items': 'layout-item',
});

/**
 * Section 0.6's pinned normalization, and the only copy of it in the tree.
 *
 * It lives here, in the module every other Quick Run module already imports, because both the search
 * rows (normalizedName) and the query path need it — and a second copy would be exactly the drift the
 * contract's "pin a single normalization function" forbids. Unicode NFKC, tone-fold, case-fold, trim,
 * collapse repeated whitespace: the comparison is normalized, never the string shown.
 *
 * Tone-folding is a decided product rule, not a nicety. Quick Run's promise is hotkey, type, Enter, gone,
 * so composing a tone mark to find something you are about to open is friction at the exact moment the
 * feature exists to remove: someone searching their own items already knows what they are called, and is
 * locating rather than spelling. Tones therefore come off BOTH sides of the comparison, and so does case.
 * đ folds to d by the creator's own request.
 *
 * What folding must never do is change which base letter a Vietnamese reader sees. Only marks are removed
 * — the tone, the horn in ơ/ư, the breve in ă, the circumflex in â — plus the stroke in đ, which is a
 * letter's own shape rather than a mark and is named in the ruling. Nothing is transliterated: bài does
 * not answer to "pai", and the length of the string in base letters is preserved. This is a search
 * convenience and never a rewrite: the names shown stay exactly as the state stores them.
 */
export function normaliseQueryText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}
/**
 * The fields a persisted window-layout descriptor declares as the window's durable identity.
 *
 * This is the ONE copy of that vocabulary. `normalizeWindowLayoutMember` in the model persists exactly
 * `title` and `executableFingerprint` and nothing else, so these are the fields anything comparing two
 * descriptors may read — and the only ones, because a descriptor that names a fingerprint is not the same
 * window as one that differs in it. The resolution module and the presentation layer both read this list
 * rather than each keeping a private copy: two copies is how they drifted apart before (resolution compared
 * `executable`/`fingerprint`, which are never persisted, while availability was keyed on the display name).
 */
export const DESCRIPTOR_IDENTITY_FIELDS = Object.freeze(['title', 'executableFingerprint']);

/** The identity fields a descriptor actually declares, in the pinned order. A blank field declares nothing. */
export function declaredDescriptorFields(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return [];
  return DESCRIPTOR_IDENTITY_FIELDS.filter((field) => (
    typeof descriptor[field] === 'string' && descriptor[field].trim() !== ''
  ));
}

/**
 * The identity a descriptor declares, as one comparable string, or '' when it declares nothing.
 *
 * Availability is noted against this rather than against the row's display name: a member whose
 * executable fingerprint changed while its title stayed the same is a *different* window, and an answer
 * noted for the old one must not survive onto it (section 10.5's reset).
 */
export function descriptorIdentityKey(descriptor) {
  const declared = declaredDescriptorFields(descriptor);
  if (declared.length === 0) return '';
  return declared.map((field) => descriptor[field]).join('\u0000');
}

export function isQuickRunFilter(value) {
  return QUICK_RUN_FILTERS.includes(value);
}

/** An unknown or missing filter is All: a bad value never hides results. */
export function normaliseFilter(value) {
  return isQuickRunFilter(value) ? value : 'All';
}

/** Tab (direction 1) and Shift+Tab (direction -1), wrapping at both ends. */
export function nextFilter(current, direction = 1) {
  const index = QUICK_RUN_FILTERS.indexOf(normaliseFilter(current));
  const step = direction < 0 ? -1 : 1;
  return QUICK_RUN_FILTERS[(index + step + QUICK_RUN_FILTERS.length) % QUICK_RUN_FILTERS.length];
}

/**
 * Tab and Shift+Tab over the chips the reader can actually see, which is the AUTHOR's ruling of
 * 2026-09-12 on a box that had been read the other way.
 *
 * The five names are the vocabulary and its order; the chips are the subset with a current match. So a
 * step moves to the next name **that has a chip**, in canonical order, and never lands on a name the
 * query has emptied - the fallback-to-All rule elsewhere is for a filter that becomes unavailable
 * because the query changed, not for keyboard traversal. With nothing available the filter does not move.
 */
export function nextAvailableFilter(current, direction = 1, available = ['All']) {
  const offered = QUICK_RUN_FILTERS.filter((label) => available.includes(label));
  if (offered.length === 0) return normaliseFilter(current);
  const active = normaliseFilter(current);
  const index = offered.indexOf(active);
  const step = direction < 0 ? -1 : 1;
  if (index === -1) return offered[0];
  return offered[(index + step + offered.length) % offered.length];
}

/** The rows a filter shows. All shows everything, in the order the search ranked it. */
export function rowsForFilter(rows, filter) {
  const active = normaliseFilter(filter);
  if (active === 'All') return rows.slice();
  const kind = KIND_BY_FILTER[active];
  return rows.filter((row) => row.type === kind);
}

/**
 * What the surface should show after a keystroke.
 *
 * fellBack is reported so the caller can move the highlight to the first All result, which is the next
 * sentence of the same rule.
 */
export function resolveFilter(rows, filter) {
  const active = normaliseFilter(filter);
  if (active === 'All') return { filter: 'All', rows: rows.slice(), fellBack: false };
  const filtered = rowsForFilter(rows, active);
  if (filtered.length === 0) return { filter: 'All', rows: rows.slice(), fellBack: true };
  return { filter: active, rows: filtered, fellBack: false };
}

/** The chips to draw: All whenever there is a result, then one per type that has a match. */
export function chipsFor(rows) {
  if (rows.length === 0) return [];
  const chips = ['All'];
  for (const filter of QUICK_RUN_FILTERS) {
    if (filter === 'All') continue;
    const kind = KIND_BY_FILTER[filter];
    if (rows.some((row) => row.type === kind)) chips.push(filter);
  }
  return chips;
}