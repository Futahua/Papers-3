import { normalizeItemSets } from './sets-model.js';
import { normalizePromptLibrary } from './prompt-library-model.js';
import { normalizeViewPreferences } from './app/hotkeys-model.js';
import { appendWindowLayoutMembershipEntry, normalizeWindowLayoutMembershipLog } from './app/window-layout-membership-log.js';

export const ROOT_ID = 'root';
export const DEFAULT_ICON_SIZE = 96;
export const MIN_ICON_SIZE = 56;
export const MAX_ICON_SIZE = 176;
export const MIN_QUICK_RUN_WIDTH = 420;
export const MAX_QUICK_RUN_WIDTH = 1100;
export const MIN_QUICK_RUN_HEIGHT = 180;
export const MAX_QUICK_RUN_HEIGHT = 800;
const MAX_SURFACE_LOCATIONS = 128;

const id = (kind) => `${kind}-${globalThis.crypto.randomUUID()}`;
const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const stringIds = (value) => Array.isArray(value)
  ? [...new Set(value.filter((candidate) => typeof candidate === 'string'))]
  : [];

/** 035: the persisted shared card geometry of a window-layout record - the
 * detached widget's latest window content size, mirrored by the attached card
 * and reused as the next detach bounds. Bounded positive integers only; values
 * below 1 are rejected (consistent with the channel/IPC report bounds). */
export function normalizeWindowLayoutCardSize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const width = raw.width;
  const height = raw.height;
  if (!hasNumber(width) || !hasNumber(height)) return null;
  if (width < 1 || height < 1) return null;
  return { width: Math.round(Math.min(2000, width)), height: Math.round(Math.min(2000, height)) };
}

/** The project-owned Quick Run card geometry. The command-surface window is
 * host-sized; this preference only controls the in-workspace card. */
export function normalizeQuickRunCardSize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!hasNumber(raw.width) || !hasNumber(raw.height)) return null;
  return {
    width: Math.round(Math.min(MAX_QUICK_RUN_WIDTH, Math.max(MIN_QUICK_RUN_WIDTH, raw.width))),
    height: Math.round(Math.min(MAX_QUICK_RUN_HEIGHT, Math.max(MIN_QUICK_RUN_HEIGHT, raw.height))),
  };
}

export function emptyState() {
  return {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    windowLayouts: [],
    windowLayoutPillIds: [],
    // 017: the persisted active-recording layout id, independent of layout
    // contents. Defaults to null (no layout records); only one id is ever
    // stored and normalization keeps it only when it names an existing,
    // non-binned window-layout record.
    activeWindowLayoutId: null,
    startupWindowLayoutId: null,
    view: {
      iconSize: DEFAULT_ICON_SIZE,
      quickRunCardSize: null,
      currentGroupId: ROOT_ID,
      expandedGroupIds: [],
      graphExpandedGroupIds: [],
      selectedItemIds: [],
      binMode: false,
      layout: 'explorer',
      promptLibrary: [],
      graphPositions: {},
      graphRestPositions: {},
      toolbarPositions: {},
      preferences: {},
      itemSets: [],
    },
  };
}

function group(state, groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

/** A persisted window-layout record by its own id. Window layouts are
 * single-parent entities like groups (one record, one location), but they
 * are not folders: they hold no children and never navigate. */
function windowLayout(state, windowLayoutId) {
  return state.windowLayouts?.find((candidate) => candidate.id === windowLayoutId) ?? null;
}

/** The versioned, empty arrangement shape a window-layout record carries.
 * Version 2 holds the ordered membership: each member carries a stable
 * persisted descriptor (never a runtimeId, token or HWND) plus the
 * saved arrangement (bounds + normal/minimized intent) for this layout. */
function emptyWindowLayoutArrangement() {
  return { version: 2, members: [] };
}

/** Validates one persisted window-layout member. The descriptor is the
 * only persisted identity: runtimeId/HWND/token fields are rejected
 * outright (dropped), never stored. Bounds must be finite with positive
 * width/height; state must be normal or minimized; anything else is
 * dropped so a malformed member can never become authority. */
function normalizeWindowLayoutMember(member) {
  if (!member || typeof member !== 'object' || Array.isArray(member)) return null;
  const id = typeof member.id === 'string' && member.id ? member.id : null;
  const descriptor = member.descriptor;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
  if (descriptor.version !== 1) return null;
  const title = typeof descriptor.title === 'string' ? descriptor.title.trim() : '';
  const windowInstanceId = descriptor.windowInstanceId;
  const executableFingerprint = descriptor.executableFingerprint;
  if (!id || !title || typeof executableFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(executableFingerprint)
    || (windowInstanceId !== undefined && (typeof windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(windowInstanceId)))) {
    return null;
  }
  let bounds = null;
  if (member.bounds && typeof member.bounds === 'object' && !Array.isArray(member.bounds)) {
    const b = member.bounds;
    if (hasNumber(b.x) && hasNumber(b.y) && hasNumber(b.width) && hasNumber(b.height)
      && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height)
      && b.width > 0 && b.height > 0) {
      bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  const state = member.state === 'minimized' ? 'minimized' : 'normal';
  return {
    id,
    descriptor: {
      version: 1,
      title,
      executableFingerprint: executableFingerprint.toLowerCase(),
      ...(windowInstanceId !== undefined ? { windowInstanceId } : {}),
    },
    bounds,
    state,
  };
}

/** Normalizes one persisted arrangement: version 2 members are validated
 * deeply; legacy version 1 (008) and malformed shapes become the empty
 * version 2 arrangement so old records upgrade safely. */
function normalizeWindowLayoutArrangement(arrangement) {
  if (!arrangement || typeof arrangement !== 'object' || Array.isArray(arrangement)) {
    return emptyWindowLayoutArrangement();
  }
  if (arrangement.version !== 2) return emptyWindowLayoutArrangement();
  if (!Array.isArray(arrangement.members)) return emptyWindowLayoutArrangement();
  const members = [];
  const seen = new Set();
  const seenInstances = new Set();
  for (const rawMember of arrangement.members) {
    const member = normalizeWindowLayoutMember(rawMember);
    if (!member || seen.has(member.id)) continue;
    const instanceId = member.descriptor.windowInstanceId;
    if (instanceId && seenInstances.has(instanceId)) continue;
    seen.add(member.id);
    if (instanceId) seenInstances.add(instanceId);
    members.push(member);
  }
  return { version: 2, members };
}

/** Finds the shortcut record and one specific placement by that placement's
 * id, searching both active and binned placements. */
function findPlacement(state, placementId) {
  for (const candidate of state.shortcuts) {
    const placement = (candidate.placements ?? []).find((entry) => entry.id === placementId);
    if (placement) return { shortcut: candidate, placement };
  }
  return null;
}

function shortcutRecord(state, shortcutId) {
  return state.shortcuts.find((candidate) => candidate.id === shortcutId) ?? null;
}

/** Resolves an id the way the renderer sees it: a group by its own id, or a
 * shortcut placement (by placement id) expanded with its shared data and
 * that placement's own parentId/order — mirroring what itemsIn/binnedItems
 * emit, so callers can treat any selected id uniformly. */
function item(state, itemId) {
  const asGroup = group(state, itemId);
  if (asGroup) return { ...asGroup, kind: 'group' };
  const asWindowLayout = windowLayout(state, itemId);
  if (asWindowLayout) return { ...asWindowLayout, kind: 'window-layout' };
  const found = findPlacement(state, itemId);
  if (!found) return null;
  const { shortcut, placement } = found;
  return {
    ...shortcut,
    kind: 'shortcut',
    id: placement.id,
    shortcutId: shortcut.id,
    parentId: placement.bin ? 'bin' : placement.parentId,
    order: placement.order,
    ...(placement.bin ? { bin: placement.bin } : {}),
    linked: placementCount(shortcut) > 1,
    placements: undefined,
  };
}

function isUnderBinnedGroupId(state, parentId) {
  let cursor = group(state, parentId);
  while (cursor) {
    if (cursor.bin) return true;
    cursor = group(state, cursor.parentId);
  }
  return false;
}

function isUnderBinnedGroup(state, candidate) {
  return isUnderBinnedGroupId(state, candidate.parentId);
}

/** Whether an item is in the active tree at all: not binned itself, and not under a binned ancestor.
 * Exported because callers that reach a record by a route other than itemsIn — the Quick Run universe
 * reaches layout members through their layout — must ask the model rather than re-derive the rule. */
export function activeItem(state, candidate) {
  return !candidate.bin && !isUnderBinnedGroup(state, candidate);
}

/** Walks up from parentId past any binned ancestors to find the nearest
 * still-active folder (or ROOT_ID). Used to restore an item nested inside
 * a binned folder without un-binning that folder — e.g. binning 3 in the
 * chain 1>2>3>4>5 and then restoring 5 alone should land it directly under
 * 2, the nearest ancestor that's still active. */
function nearestActiveAncestorId(state, parentId) {
  if (parentId === ROOT_ID || parentId === 'bin') return ROOT_ID;
  let cursor = group(state, parentId);
  while (cursor) {
    if (!cursor.bin && !isUnderBinnedGroupId(state, cursor.parentId)) return cursor.id;
    cursor = group(state, cursor.parentId);
  }
  return ROOT_ID;
}

function activePlacements(shortcut) {
  return (shortcut.placements ?? []).filter((placement) => !placement.bin);
}

function binnedPlacements(shortcut) {
  return (shortcut.placements ?? []).filter((placement) => placement.bin);
}

/** Placement count across every non-bin location; used to decide whether an
 * edit needs the apply-everywhere-or-fork prompt. */
export function placementCount(shortcut) {
  return activePlacements(shortcut).length;
}

function sorted(items) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Expands each shortcut into one entry per active placement in `parentId`.
 * The emitted `id` IS the placement id — that's what gets selected, dragged,
 * moved, and binned. `shortcutId` is the shared record every placement of
 * the same shortcut has in common, used for edits, launching and reveal. */
function shortcutPlacementsIn(state, parentId) {
  const entries = [];
  for (const candidate of state.shortcuts) {
    for (const placement of activePlacements(candidate)) {
      if (placement.parentId !== parentId) continue;
      if (isUnderBinnedGroupId(state, placement.parentId)) continue;
      entries.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: placement.parentId,
        order: placement.order,
        linked: placementCount(candidate) > 1,
        placements: undefined,
      });
    }
  }
  return entries;
}

export function itemsIn(state, parentId = ROOT_ID) {
  return sorted([
    ...state.groups.filter((candidate) => candidate.parentId === parentId && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'group' })),
    ...windowLayoutsIn(state, parentId),
    ...shortcutPlacementsIn(state, parentId),
  ]);
}

/** Active (non-bin) window-layout records in a folder, in the same emitted
 * shape contract as groups — the itemsIn seam every downstream consumer
 * (graph walk, trail provenance, selection, marquee, Bin traversal) reads. */
function windowLayoutsIn(state, parentId) {
  return sorted(
    (state.windowLayouts ?? [])
      .filter((candidate) => candidate.parentId === parentId && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'window-layout' })),
  );
}

export function children(state, parentId = ROOT_ID) {
  const items = itemsIn(state, parentId);
  return {
    groups: items.filter((candidate) => candidate.kind === 'group').map(({ kind: _kind, ...candidate }) => candidate),
    shortcuts: items.filter((candidate) => candidate.kind === 'shortcut').map(({ kind: _kind, ...candidate }) => candidate),
  };
}

export function binnedItems(state) {
  const shortcutPlacements = [];
  for (const candidate of state.shortcuts) {
    for (const placement of binnedPlacements(candidate)) {
      shortcutPlacements.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: 'bin',
        order: placement.order ?? 0,
        bin: placement.bin,
        linked: placementCount(candidate) > 1,
        // Whether this shortcut had more than one placement in total
        // (active + binned) — unlike `linked` above (which only counts
        // currently-active placements, correct for the link badge/fork
        // prompt elsewhere), this stays true even when every placement
        // was binned at once, since the Bin still needs to distinguish
        // those otherwise-identical tiles from each other.
        wasLinked: (candidate.placements?.length ?? 0) > 1,
        placements: undefined,
      });
    }
  }
  return sorted([
    ...state.groups.filter((candidate) => candidate.bin).map((candidate) => ({ ...candidate, kind: 'group' })),
    ...(state.windowLayouts ?? [])
      .filter((candidate) => candidate.bin)
      .map((candidate) => ({ ...candidate, kind: 'window-layout', parentId: 'bin' })),
    ...shortcutPlacements,
  ]);
}

/** Lists the direct children of a binned folder, for expanding it inside
 * the Bin view. Nothing here was independently binned — a folder's
 * children are still fully intact, just hidden from the normal view
 * because their ancestor is binned (see isUnderBinnedGroup) — so this
 * intentionally skips the "hidden by binned ancestor" filter itemsIn()
 * applies, while still excluding anything that has since been
 * independently binned itself (it already has its own top-level Bin
 * tile and shouldn't also appear nested here). */
export function itemsInBinnedGroup(state, groupId) {
  const childGroups = state.groups
    .filter((candidate) => candidate.parentId === groupId && !candidate.bin)
    .map((candidate) => ({ ...candidate, kind: 'group' }));
  const childWindowLayouts = (state.windowLayouts ?? [])
    .filter((candidate) => candidate.parentId === groupId && !candidate.bin)
    .map((candidate) => ({ ...candidate, kind: 'window-layout' }));
  const childPlacements = [];
  for (const candidate of state.shortcuts) {
    for (const placement of activePlacements(candidate)) {
      if (placement.parentId !== groupId) continue;
      childPlacements.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: placement.parentId,
        order: placement.order,
        linked: placementCount(candidate) > 1,
        placements: undefined,
      });
    }
  }
  return sorted([...childGroups, ...childWindowLayouts, ...childPlacements]);
}

/** Validates and prunes persisted window-layout records. A record needs a
 * string id and a non-empty name; parentId defaults to the root, order and
 * the bin shape mirror groups, and the versioned arrangement defaults to
 * empty when missing or malformed. Legacy state with no collection becomes
 * []; unrelated records and unknown fields are preserved. */
function normalizeWindowLayouts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const records = [];
  let trackingOwnerSeen = false;
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : null;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const tracking = candidate.tracking;
    const trackingEnabled = Boolean(tracking && typeof tracking === 'object' && tracking.enabled === true);
    const suppressedInstanceIds = tracking && typeof tracking === 'object' && Array.isArray(tracking.suppressedInstanceIds)
      ? [...new Set(tracking.suppressedInstanceIds.filter((value) => typeof value === 'string' && /^W[0-9a-f]{16}$/i.test(value)))]
      : [];
    records.push({
      id,
      name,
      parentId: typeof candidate.parentId === 'string' ? candidate.parentId : ROOT_ID,
      order: hasNumber(candidate.order) ? candidate.order : 0,
      icon: candidate.icon ?? null,
      ...(candidate.bin && typeof candidate.bin === 'object' && !Array.isArray(candidate.bin)
        ? {
          bin: {
            parentId: typeof candidate.bin.parentId === 'string' ? candidate.bin.parentId : ROOT_ID,
            order: hasNumber(candidate.bin.order) ? candidate.bin.order : 0,
            binnedAt: typeof candidate.bin.binnedAt === 'string'
              ? candidate.bin.binnedAt
              : new Date(0).toISOString(),
          },
        }
        : {}),
      arrangement: normalizeWindowLayoutArrangement(candidate.arrangement),
      tracking: { enabled: trackingEnabled && !trackingOwnerSeen, suppressedInstanceIds },
      // 035: the shared attached/detached card geometry survives reloads (the
      // detached widget's latest window content size); malformed or missing
      // values stay null so an old record renders at the default width.
      ...(normalizeWindowLayoutCardSize(candidate.cardSize) ? { cardSize: normalizeWindowLayoutCardSize(candidate.cardSize) } : {}),
    });
    if (trackingEnabled && !trackingOwnerSeen) trackingOwnerSeen = true;
  }
  return records;
}

/** 017: normalizes the persisted active-recording layout id independently of
 * layout contents. It survives only when it names an existing, non-binned
 * window-layout record that is not nested under a binned folder; any legacy
 * absence, unknown, stale or binned id becomes null. */
function normalizeActiveWindowLayoutId(raw, windowLayouts, groups) {
  if (typeof raw !== 'string' || !raw) return null;
  const match = windowLayouts.find((candidate) => candidate.id === raw);
  if (!match || match.bin) return null;
  if (isUnderBinnedGroup({ groups }, match)) return null;
  return match.id;
}

function normalizeGraphPositions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = {};
  const entries = Object.entries(raw);
  for (const [ctxKey, ctxValue] of entries) {
    if (typeof ctxKey !== 'string' || !ctxValue || typeof ctxValue !== 'object' || Array.isArray(ctxValue)) continue;
    const ctx = {};
    let hasValid = false;
    for (const [itemId, pos] of Object.entries(ctxValue)) {
      if (typeof itemId !== 'string' || !pos || typeof pos !== 'object') continue;
      if (!hasNumber(pos.x) || !hasNumber(pos.y)) continue;
      ctx[itemId] = { x: pos.x, y: pos.y };
      hasValid = true;
    }
    if (hasValid) cleaned[ctxKey] = ctx;
  }
  return cleaned;
}

function normalizeFlatPositions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = {};
  for (const [key, pos] of Object.entries(raw)) {
    if (typeof key !== 'string' || !pos || typeof pos !== 'object') continue;
    if (!hasNumber(pos.x) || !hasNumber(pos.y)) continue;
    cleaned[key] = { x: pos.x, y: pos.y };
  }
  return cleaned;
}

function placementId() {
  return `placement-${globalThis.crypto.randomUUID()}`;
}

/** Accepts either the legacy single-location shape (`parentId`/`order`/`bin`
 * directly on the shortcut) or the current `placements` array, and always
 * returns a normalized `placements` array. A shortcut is migrated once, the
 * first time its file is loaded after this feature shipped; from then on it
 * only ever has `placements`. */
function normalizePlacements(raw) {
  if (Array.isArray(raw.placements)) {
    return raw.placements
      .filter((placement) => placement && typeof placement === 'object' && typeof placement.parentId === 'string')
      .map((placement) => ({
        id: typeof placement.id === 'string' ? placement.id : placementId(),
        parentId: placement.parentId,
        // Left as-is (possibly undefined) so the renumbering pass in
        // normalizeState can tell "no order yet" apart from an explicit 0,
        // exactly like it already does for groups.
        order: hasNumber(placement.order) ? placement.order : undefined,
        ...(placement.bin && typeof placement.bin === 'object'
          ? {
              bin: {
                parentId: typeof placement.bin.parentId === 'string' ? placement.bin.parentId : ROOT_ID,
                order: hasNumber(placement.bin.order) ? placement.bin.order : 0,
                binnedAt: typeof placement.bin.binnedAt === 'string' ? placement.bin.binnedAt : new Date(0).toISOString(),
              },
            }
          : {}),
      }));
  }
  if (typeof raw.parentId === 'string') {
    return [{
      id: placementId(),
      parentId: raw.parentId,
      order: hasNumber(raw.order) ? raw.order : undefined,
      ...(raw.bin && typeof raw.bin === 'object'
        ? {
            bin: {
              parentId: typeof raw.bin.parentId === 'string' ? raw.bin.parentId : ROOT_ID,
              order: hasNumber(raw.bin.order) ? raw.bin.order : 0,
              binnedAt: typeof raw.bin.binnedAt === 'string' ? raw.bin.binnedAt : new Date(0).toISOString(),
            },
          }
        : {}),
    }];
  }
  return [];
}

export function normalizeState(raw) {
  const groups = Array.isArray(raw?.groups)
    ? raw.groups.map((candidate) => ({ ...candidate, icon: candidate.icon ?? null }))
    : [];
  const windowLayouts = normalizeWindowLayouts(raw?.windowLayouts);
  const quickRunCardSize = normalizeQuickRunCardSize(raw?.view?.quickRunCardSize);
  let state = {
    schemaVersion: 1,
    groups,
    shortcuts: Array.isArray(raw?.shortcuts)
      ? raw.shortcuts.map((candidate) => {
          const { parentId: _parentId, order: _order, bin: _bin, ...rest } = candidate;
          return { ...rest, placements: normalizePlacements(candidate) };
        })
      : [],
    windowLayouts,
    // Layout widgets are native surfaces by default. This list records only
    // the layouts the user explicitly docked back into the AYG pill tray.
    windowLayoutPillIds: [...new Set(stringIds(raw?.windowLayoutPillIds))]
      .filter((layoutId) => windowLayouts.some((layout) => layout.id === layoutId)),
    // Diagnostic only: the last few membership changes, kept so an unexplained
    // ejection can be read back. Nothing consumes it.
    windowLayoutMembershipLog: normalizeWindowLayoutMembershipLog(raw?.windowLayoutMembershipLog),
    activeWindowLayoutId: normalizeActiveWindowLayoutId(raw?.activeWindowLayoutId, windowLayouts, groups),
    startupWindowLayoutId: normalizeActiveWindowLayoutId(raw?.startupWindowLayoutId, windowLayouts, groups),
    view: {
      iconSize: Math.min(
        MAX_ICON_SIZE,
        Math.max(MIN_ICON_SIZE, hasNumber(raw?.view?.iconSize) ? raw.view.iconSize : DEFAULT_ICON_SIZE),
      ),
      ...(quickRunCardSize ? { quickRunCardSize } : {}),
      currentGroupId:
        typeof raw?.view?.currentGroupId === 'string'
          ? raw.view.currentGroupId
          : ROOT_ID,
      ...(Object.keys(normalizeSurfaceLocations(raw?.view?.surfaceLocations)).length > 0
        ? { surfaceLocations: normalizeSurfaceLocations(raw?.view?.surfaceLocations) }
        : {}),
      expandedGroupIds: stringIds(raw?.view?.expandedGroupIds),
      graphExpandedGroupIds: stringIds(raw?.view?.graphExpandedGroupIds),
      selectedItemIds: stringIds(raw?.view?.selectedItemIds),
      binMode: raw?.view?.binMode === true,
      layout: raw?.view?.layout === 'graph' ? 'graph' : 'explorer',
      graphPositions: normalizeGraphPositions(raw?.view?.graphPositions),
      graphRestPositions: normalizeGraphPositions(raw?.view?.graphRestPositions),
      toolbarPositions: normalizeFlatPositions(raw?.view?.toolbarPositions),
      preferences: normalizeViewPreferences(raw?.view?.preferences),
      // promptLibrary replaces promptCards/pickupPrompt: the older shapes are
      // read here purely for migration (normalizePromptLibrary) and never
      // written again.
      promptLibrary: normalizePromptLibrary(
        raw?.view?.promptLibrary,
        raw?.view?.promptCards,
        raw?.view?.pickupPrompt,
      ),
      // Filled in below, once every item id is known: a set naming an item that
      // no longer exists must be pruned rather than left dangling, and that
      // cannot be decided until the groups and shortcuts are normalized.
      itemSets: [],
      // Filled in below, once every folder id is known (see
      // normalizeTrailExpansionByContext). Defaults to empty everywhere, so
      // legacy state without this field starts with every trail folder
      // collapsed.
      trailExpandedByContext: {},
    },
  };

  const groupParents = new Set([ROOT_ID, ...state.groups.map((candidate) => candidate.parentId)]);
  for (const parentId of groupParents) {
    const siblingGroups = state.groups.filter((candidate) => candidate.parentId === parentId);
    const siblingPlacements = state.shortcuts.flatMap((candidate) =>
      candidate.placements.filter((placement) => !placement.bin && placement.parentId === parentId)
        .map((placement) => ({ placement, candidate })));
    const combined = [
      ...siblingGroups.map((candidate) => ({ order: candidate.order, apply: (order) => { candidate.order = order; } })),
      ...siblingPlacements.map(({ placement }) => ({ order: placement.order, apply: (order) => { placement.order = order; } })),
    ].sort((a, b) => {
      if (hasNumber(a.order) && hasNumber(b.order)) return a.order - b.order;
      if (hasNumber(a.order)) return -1;
      if (hasNumber(b.order)) return 1;
      return 0;
    });
    combined.forEach((entry, order) => entry.apply(order));
  }

  // Sets reference items by id, so they are normalized once every item is
  // known. Membership is independent of folder location, so both groups and
  // shortcut records count as addressable members.
  state.view.itemSets = normalizeItemSets(raw?.view?.itemSets, [
    ...state.groups.map((candidate) => candidate.id),
    ...state.shortcuts.map((candidate) => candidate.id),
    ...state.windowLayouts.map((candidate) => candidate.id),
  ]);
  // A layout is a widget rather than a graph body. Retire legacy canvas pins
  // and rest positions so it has no hidden spatial influence. Set membership
  // remains valid model metadata, but is inert because layouts are not graph
  // nodes.
  state = forgetRestPositionsEverywhere(state, state.windowLayouts.map((layout) => layout.id));
  const layoutIds = new Set(state.windowLayouts.map((layout) => layout.id));
  state.view.graphPositions = Object.fromEntries(Object.entries(state.view.graphPositions ?? {}).flatMap(([contextId, positions]) => {
    const kept = Object.fromEntries(Object.entries(positions).filter(([id]) => !layoutIds.has(id)));
    return Object.keys(kept).length > 0 ? [[contextId, kept]] : [];
  }));
  // Per-view trail expansion is pruned once every folder id is known: ids
  // that are no longer valid folders are dropped, the `root` and `bin`
  // pseudo heads are preserved, and unrelated view fields are untouched.
  state.view.trailExpandedByContext = normalizeTrailExpansionByContext(
    raw?.view?.trailExpandedByContext,
    [ROOT_ID, 'bin', ...state.groups.map((candidate) => candidate.id)],
  );
  return state;
}

/** Replaces the whole set list. Sets live in the view rather than beside the
 * items because they are a way of looking at the workspace, not a container in
 * it — an item's place in the folder tree is untouched by what it belongs to.
 *
 * Members are pruned against the current items on the way in, not only on
 * load: a set that never holds an id the workspace cannot resolve is one that
 * cannot be saved holding one either. */
export function setItemSets(state, itemSets) {
  const knownItemIds = [
    ...state.groups.map((candidate) => candidate.id),
    ...state.shortcuts.map((candidate) => candidate.id),
    ...(state.windowLayouts ?? []).map((candidate) => candidate.id),
  ];
  return {
    ...state,
    view: { ...state.view, itemSets: normalizeItemSets(itemSets, knownItemIds) },
  };
}

/** The explicit view-context key for trail expansion. Normal explorer views
 * use `folder:<id>` (root included as `folder:root`) and Bin views use
 * `bin:<id>` (the Bin top level as `bin:bin`), so the two can never collide.
 * Trail expansion is remembered per key and defaults every trail folder to
 * collapsed when a key has no entry. */
export function trailContextKey(currentGroupId, binMode, binCurrentId) {
  return binMode ? `bin:${binCurrentId ?? 'bin'}` : `folder:${currentGroupId ?? ROOT_ID}`;
}

/** Normalizes the per-view trail expansion map. Malformed keys/values are
 * discarded, ids are deduped, ids that are no longer valid folders are
 * pruned, and the `root`/`bin` pseudo heads are preserved where meaningful.
 * An entry that ends up empty is dropped — "collapsed" is the same as
 * absent. Unknown fields elsewhere in `view` are left untouched. */
export function normalizeTrailExpansionByContext(value, validIds) {
  const valid = new Set(validIds);
  const map = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return map;
  for (const [key, entry] of Object.entries(value)) {
    // Only the explicit context keys are accepted: folder:<id> for explorer
    // views and bin:<id> for Bin views, pseudo heads included.
    if (typeof key !== 'string' || !(key.startsWith('folder:') || key.startsWith('bin:'))) continue;
    if (!Array.isArray(entry)) continue;
    const ids = [...new Set(entry.filter((id) => typeof id === 'string' && valid.has(id)))];
    if (ids.length === 0) continue;
    map[key] = ids;
  }
  return map;
}

/** Sets one view context's trail expansion ids. An empty list removes the
 * key, so a view with no saved choice behaves exactly like a fresh one. */
export function setTrailExpandedByContext(state, contextKey, ids) {
  const map = { ...(state.view?.trailExpandedByContext ?? {}) };
  const unique = [...new Set(ids)];
  if (unique.length > 0) map[contextKey] = unique;
  else delete map[contextKey];
  return { ...state, view: { ...state.view, trailExpandedByContext: map } };
}

export function migrateActions(actions) {
  const state = emptyState();
  state.shortcuts = (actions?.actions ?? []).map((action, order) => ({
    id: `shortcut-${action.id}`,
    placements: [{ id: placementId(), parentId: ROOT_ID, order }],
    name: action.id === 'clips' ? 'CLIPS' : action.id === 'sloptop-mode' ? 'SLOPTOP MODE' : action.id === 'slop-engine' ? 'slop_engine' : action.id,
    description: '',
    target: action.target,
    icon: null,
  }));
  return state;
}

function isDescendant(state, candidateId, ancestorId) {
  let current = group(state, candidateId);
  while (current) {
    if (current.parentId === ancestorId) return true;
    current = group(state, current.parentId);
  }
  return false;
}

function assertParent(state, parentId) {
  if (parentId !== ROOT_ID && !group(state, parentId)) {
    throw new Error('Destination group was not found.');
  }
}

function nextOrder(state, parentId) {
  return itemsIn(state, parentId).length;
}

export function createGroup(state, name, parentId = ROOT_ID, icon = null) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Group name must not be empty.');
  assertParent(state, parentId);
  return {
    ...state,
    groups: [...state.groups, {
      id: id('group'),
      parentId,
      order: nextOrder(state, parentId),
      name: trimmed,
      icon,
    }],
  };
}

/** Creates one persisted window-layout record in a folder. It is a
 * single-parent entity like a group — one record, one location, its own
 * id — and carries the versioned empty arrangement this proof uses. */
export function createWindowLayout(state, { name = 'Window layout', parentId = ROOT_ID } = {}) {
  const trimmed = String(name).trim() || 'Window layout';
  assertParent(state, parentId);
  return {
    ...state,
    windowLayouts: [...(state.windowLayouts ?? []), {
      id: id('window-layout'),
      parentId,
      order: nextOrder(state, parentId),
      name: trimmed,
      icon: null,
      arrangement: emptyWindowLayoutArrangement(),
      tracking: { enabled: false, suppressedInstanceIds: [] },
    }],
  };
}

/** Enables or disables the one durable auto-tracking owner. Enabling a layout
 * atomically disables every other layout; disabling leaves existing members
 * untouched and only stops future automatic additions. */
export function setWindowLayoutTracking(state, windowLayoutId, enabled) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const nextEnabled = enabled === true;
  return {
    ...state,
    startupWindowLayoutId: nextEnabled
      ? windowLayoutId
      : state.startupWindowLayoutId === windowLayoutId ? null : state.startupWindowLayoutId,
    windowLayouts: (state.windowLayouts ?? []).map((candidate) => ({
      ...candidate,
      tracking: {
        enabled: candidate.id === windowLayoutId ? nextEnabled : (nextEnabled ? false : Boolean(candidate.tracking?.enabled)),
        suppressedInstanceIds: [...(candidate.tracking?.suppressedInstanceIds ?? [])],
      },
    })),
  };
}

export function setWindowLayoutInstanceSuppressed(state, windowLayoutId, windowInstanceId, suppressed) {
  if (typeof windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(windowInstanceId)) {
    throw new Error('Window instance id is invalid.');
  }
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const current = new Set(layout.tracking?.suppressedInstanceIds ?? []);
  if (suppressed === true) current.add(windowInstanceId);
  else current.delete(windowInstanceId);
  return {
    ...state,
    windowLayouts: state.windowLayouts.map((candidate) => candidate.id === windowLayoutId
      ? { ...candidate, tracking: { enabled: Boolean(candidate.tracking?.enabled), suppressedInstanceIds: [...current] } }
      : candidate),
  };
}

/** Adds one member (from a host bind: stable descriptor + optional first
 * arrangement) to a window-layout's ordered membership. Data-only: nothing
 * here launches, moves or closes a window. */
export function addWindowLayoutMember(state, windowLayoutId, member, diagnostics = {}) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const normalized = normalizeWindowLayoutMember(member);
  if (!normalized) throw new Error('Window layout member is invalid.');
  if (layout.arrangement.members.some((existing) => existing.id === normalized.id)) {
    throw new Error('This window is already a member of the layout.');
  }
  const instanceId = normalized.descriptor.windowInstanceId;
  if (instanceId && layout.arrangement.members.some((existing) =>
    existing.descriptor.windowInstanceId === instanceId)) return state;
  const members = [...layout.arrangement.members, normalized];
  return {
    ...state,
    windowLayoutMembershipLog: appendWindowLayoutMembershipEntry(state.windowLayoutMembershipLog, {
      kind: 'added',
      layoutId: windowLayoutId,
      memberId: normalized.id,
      title: normalized.descriptor?.title,
      reason: 'added to the layout',
      source: diagnostics.source ?? 'add',
      windowInstanceId: normalized.descriptor?.windowInstanceId,
      operationId: diagnostics.operationId,
      membersBefore: layout.arrangement.members.length,
      membersAfter: members.length,
    }),
    windowLayouts: state.windowLayouts.map((candidate) =>
      candidate.id === windowLayoutId
        ? { ...candidate, arrangement: { version: 2, members } }
        : candidate),
  };
}

/** Removes one member by its membership id. Data-only: the window itself
 * is never closed or moved. */
/** A bounded diagnostic entry for something that failed BEFORE it could touch
 * membership. The log already records who decided what; this is how a refusal
 * that changes nothing can still be read afterwards instead of guessed at. */
export function noteWindowLayoutDiagnostic(state, { layoutId = '', memberId = '', reason = '', source = 'diagnostic' } = {}) {
  return {
    ...state,
    windowLayoutMembershipLog: appendWindowLayoutMembershipEntry(state.windowLayoutMembershipLog, {
      kind: 'unknown',
      layoutId,
      memberId,
      reason,
      source,
    }),
  };
}
export function removeWindowLayoutMember(state, windowLayoutId, memberId, diagnostics = {}) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const members = layout.arrangement.members.filter((member) => member.id !== memberId);
  return {
    ...state,
    windowLayoutMembershipLog: appendWindowLayoutMembershipEntry(state.windowLayoutMembershipLog, {
      kind: 'removed',
      layoutId: windowLayoutId,
      memberId,
      title: layout.arrangement.members.find((member) => member.id === memberId)?.descriptor?.title,
      reason: diagnostics.reason ?? 'removed from the layout',
      source: diagnostics.source ?? 'remove',
      windowInstanceId: layout.arrangement.members
        .find((member) => member.id === memberId)?.descriptor?.windowInstanceId,
      operationId: diagnostics.operationId,
      membersBefore: layout.arrangement.members.length,
      membersAfter: members.length,
    }),
    windowLayouts: state.windowLayouts.map((candidate) =>
      candidate.id === windowLayoutId
        ? { ...candidate, arrangement: { version: 2, members } }
        : candidate),
  };
}

/** Removes every membership that identifies the same closed native window.
 * A window may intentionally occur in several independent layouts, but once
 * its process/window is actually closed none of those records remains live.
 * One immutable state transition prevents inactive layouts retaining ghosts. */
export function removeClosedWindowFromAllLayouts(state, descriptor, diagnostics = {}) {
  const title = descriptor?.title;
  const fingerprint = descriptor?.executableFingerprint;
  const windowInstanceId = descriptor?.windowInstanceId;
  if ((windowInstanceId !== undefined && (typeof windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(windowInstanceId)))
    || (windowInstanceId === undefined && (typeof title !== 'string' || title.length === 0
      || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(fingerprint)))) {
    throw new Error('Closed window descriptor is invalid.');
  }
  const normalizedFingerprint = typeof fingerprint === 'string' ? fingerprint.toLowerCase() : null;
  let changed = false;
  let log = state.windowLayoutMembershipLog;
  const windowLayouts = (state.windowLayouts ?? []).map((layout) => {
    const members = layout.arrangement.members.filter((member) => {
      const same = windowInstanceId !== undefined
        ? member.descriptor.windowInstanceId === windowInstanceId
        : member.descriptor.title === title
          && member.descriptor.executableFingerprint.toLowerCase() === normalizedFingerprint;
      if (same) {
        changed = true;
        // One entry per ejected icon, with the count on each side: this is the
        // case the creator sees as "I added one and three others vanished".
        log = appendWindowLayoutMembershipEntry(log, {
          kind: 'closed-sweep',
          layoutId: layout.id,
          memberId: member.id,
          title: member.descriptor?.title,
          reason: diagnostics.reason ?? 'its window was reported closed',
          source: diagnostics.source ?? 'closed-descriptor',
          windowInstanceId: member.descriptor?.windowInstanceId,
          operationId: diagnostics.operationId,
          membersBefore: layout.arrangement.members.length,
          membersAfter: layout.arrangement.members.length - 1,
        });
      }
      return !same;
    });
    return members.length === layout.arrangement.members.length
      ? layout
      : { ...layout, arrangement: { version: 2, members } };
  });
  return changed ? { ...state, windowLayouts, windowLayoutMembershipLog: log } : state;
}

/** A layout's X is a direct, non-Bin deletion. It also clears native-surface
 * presentation state and stale graph coordinates so the deleted widget cannot
 * reappear through a remembered canvas position. */
export function deleteWindowLayout(state, windowLayoutId) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) return state;
  let next = forgetRestPositionsEverywhere(state, [windowLayoutId]);
  const graphPositions = {};
  for (const [contextId, positions] of Object.entries(next.view?.graphPositions ?? {})) {
    const kept = Object.fromEntries(Object.entries(positions).filter(([id]) => id !== windowLayoutId));
    if (Object.keys(kept).length > 0) graphPositions[contextId] = kept;
  }
  const itemSets = (next.view?.itemSets ?? []).map((set) => ({
    ...set,
    memberIds: (set.memberIds ?? []).filter((id) => id !== windowLayoutId),
  })).filter((set) => set.memberIds.length > 0);
  next = { ...next, view: { ...next.view, graphPositions, itemSets } };
  return {
    ...next,
    windowLayouts: (state.windowLayouts ?? []).filter((candidate) => candidate.id !== windowLayoutId),
    windowLayoutPillIds: (state.windowLayoutPillIds ?? []).filter((id) => id !== windowLayoutId),
    activeWindowLayoutId: state.activeWindowLayoutId === windowLayoutId ? null : state.activeWindowLayoutId,
    startupWindowLayoutId: state.startupWindowLayoutId === windowLayoutId ? null : state.startupWindowLayoutId,
  };
}

/** Record whether a layout is represented by its native widget or by the
 * reopen pill inside AYG. */
export function setWindowLayoutPill(state, windowLayoutId, docked) {
  if (!windowLayout(state, windowLayoutId)) return state;
  const current = new Set(state.windowLayoutPillIds ?? []);
  if (docked === true) current.add(windowLayoutId);
  else current.delete(windowLayoutId);
  return { ...state, windowLayoutPillIds: [...current] };
}

/** Reconciles persisted membership against the native window baseline
 * available when Papers starts. Exact instance identities are the only safe
 * startup proof: legacy members without one are retained rather than guessed
 * away. Non-tracking layouts that were populated but are now empty are
 * removed; the tracking owner remains as the durable home for programs that
 * start after Papers. */
export function reconcileWindowLayoutsAfterStartup(state, liveWindowInstanceIds) {
  if (!Array.isArray(liveWindowInstanceIds)) return state;
  const live = new Set(liveWindowInstanceIds.filter((id) =>
    typeof id === 'string' && /^W[0-9a-f]{16}$/i.test(id)));
  let changed = false;
  const windowLayouts = [];
  for (const layout of state.windowLayouts ?? []) {
    const originalMembers = layout.arrangement?.members ?? [];
    const exactMembers = originalMembers.filter((member) =>
      typeof member.descriptor?.windowInstanceId === 'string');
    const members = originalMembers.filter((member) => {
      const id = member.descriptor?.windowInstanceId;
      return typeof id !== 'string' || live.has(id);
    });
    const removeEmptyUntracked = layout.tracking?.enabled !== true
      && exactMembers.length > 0
      && members.length === 0;
    if (removeEmptyUntracked) {
      changed = true;
      continue;
    }
    if (members.length !== originalMembers.length) {
      changed = true;
      windowLayouts.push({ ...layout, arrangement: { version: 2, members } });
    } else {
      windowLayouts.push(layout);
    }
  }
  const survivingLayoutIds = new Set(windowLayouts.map((layout) => layout.id));
  const activeWindowLayoutId = survivingLayoutIds.has(state.activeWindowLayoutId)
    ? state.activeWindowLayoutId : null;
  const startupCandidate = windowLayouts.find((layout) =>
    layout.id === state.startupWindowLayoutId && layout.tracking?.enabled === true);
  const trackingCandidate = windowLayouts.find((layout) => layout.tracking?.enabled === true);
  const startupWindowLayoutId = startupCandidate?.id ?? trackingCandidate?.id ?? null;
  if (activeWindowLayoutId !== state.activeWindowLayoutId
    || startupWindowLayoutId !== state.startupWindowLayoutId) changed = true;
  return changed
    ? { ...state, windowLayouts, activeWindowLayoutId, startupWindowLayoutId }
    : state;
}

/** Patches one member's saved arrangement (bounds/state) for a layout.
 * Data-only; used by the bounded live observer. */
export function updateWindowLayoutMember(state, windowLayoutId, memberId, patch) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const members = layout.arrangement.members.map((member) => {
    if (member.id !== memberId) return member;
    const next = { ...member };
    if (patch && typeof patch === 'object') {
      if (patch.bounds === null || (patch.bounds && typeof patch.bounds === 'object')) {
        next.bounds = patch.bounds;
      }
      if (patch.state === 'minimized' || patch.state === 'normal') {
        next.state = patch.state;
      }
    }
    return next;
  });
  return {
    ...state,
    windowLayouts: state.windowLayouts.map((candidate) =>
      candidate.id === windowLayoutId
        ? { ...candidate, arrangement: { version: 2, members } }
        : candidate),
  };
}

/** 035: data-only shared-geometry writer. Stores the detached widget's latest
 * window content size on the layout's cardSize so the attached card mirrors it
 * on reattach and the next detach reuses it as its open bounds. Bounded to the
 * same [1, 2000] range as the channel/IPC report; returns the same state when
 * nothing changed. */
export function setWindowLayoutCardSize(state, windowLayoutId, width, height) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const cardSize = normalizeWindowLayoutCardSize({ width, height });
  if (!cardSize) throw new Error('Window layout card size is invalid.');
  if (layout.cardSize && layout.cardSize.width === cardSize.width && layout.cardSize.height === cardSize.height) {
    return state;
  }
  return {
    ...state,
    windowLayouts: state.windowLayouts.map((candidate) =>
      candidate.id === windowLayoutId
        ? { ...candidate, cardSize }
        : candidate),
  };
}

/** Reorders one member to a new index within the layout's persisted member
 * order (016 inner reorder drag). Data-only; never touches the window. */
export function reorderWindowLayoutMember(state, windowLayoutId, memberId, toIndex) {
  const layout = windowLayout(state, windowLayoutId);
  if (!layout) throw new Error('Window layout not found.');
  const members = [...layout.arrangement.members];
  const fromIndex = members.findIndex((member) => member.id === memberId);
  if (fromIndex === -1) throw new Error('Window layout member not found.');
  const targetIndex = Math.max(0, Math.min(toIndex, members.length - 1));
  if (fromIndex === targetIndex) return state;
  const [moved] = members.splice(fromIndex, 1);
  members.splice(targetIndex, 0, moved);
  return {
    ...state,
    windowLayouts: state.windowLayouts.map((candidate) =>
      candidate.id === windowLayoutId
        ? { ...candidate, arrangement: { version: 2, members } }
        : candidate),
  };
}

/** 017: data-only active-recording layout selector. Sets the persisted active
 * layout id to an existing, non-binned window layout, or clears it with null.
 * An unknown or binned id is rejected: the current value is retained and no
 * arrangement is touched (the layouts array reference is shared, so every
 * arrangement stays byte-identical). The runtime never persists contents into
 * this field; it records which layout owns the recording context. */
export function setActiveWindowLayoutId(state, idOrNull) {
  if (idOrNull === null) {
    if (state.activeWindowLayoutId === null) return state;
    return { ...state, activeWindowLayoutId: null };
  }
  if (typeof idOrNull !== 'string' || !idOrNull) return state;
  const layout = windowLayout(state, idOrNull);
  if (!layout || layout.bin || isUnderBinnedGroup(state, layout)) return state;
  if (state.activeWindowLayoutId === idOrNull) return state;
  return { ...state, activeWindowLayoutId: idOrNull };
}

export function createShortcut(state, shortcut) {
  const name = String(shortcut.name ?? '').trim();
  const target = String(shortcut.target ?? '').trim();
  if (!name) throw new Error('Shortcut name must not be empty.');
  if (!target) throw new Error('Shortcut target must not be empty.');
  const parentId = shortcut.parentId ?? ROOT_ID;
  assertParent(state, parentId);
  return {
    ...state,
    shortcuts: [...state.shortcuts, {
      id: id('shortcut'),
      placements: [{ id: placementId(), parentId, order: nextOrder(state, parentId) }],
      name,
      description: String(shortcut.description ?? '').trim(),
      target,
      icon: shortcut.icon ?? null,
    }],
  };
}

export function createDroppedShortcuts(state, droppedTargets, parentId = ROOT_ID) {
  assertParent(state, parentId);
  const existingTargets = new Set(
    itemsIn(state, parentId)
      .filter((candidate) => candidate.kind === 'shortcut')
      .map((candidate) => candidate.target.toLocaleLowerCase()),
  );
  let next = state;
  for (const dropped of droppedTargets) {
    const target = String(dropped?.target ?? '').trim();
    const key = target.toLocaleLowerCase();
    if (!target || existingTargets.has(key)) continue;
    next = createShortcut(next, {
      name: String(dropped?.name ?? '').trim() || target,
      target,
      parentId,
      description: '',
      icon: null,
    });
    existingTargets.add(key);
  }
  return next;
}

function normalizeWebTarget(target) {
  let raw = String(target ?? '').trim();
  if (!raw) throw new Error('Web address must not be empty.');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Web address must be a valid http or https URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Web address must use http or https.');
  }
  return parsed.toString();
}

export function isWebLink(candidate) {
  if (!candidate || typeof candidate.target !== 'string') return false;
  try {
    const parsed = new URL(candidate.target);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function webLinkIcon(candidate) {
  if (!isWebLink(candidate)) return null;
  return candidate.target;
}

export function createWebLink(state, webLink) {
  return createShortcut(state, {
    ...webLink,
    target: normalizeWebTarget(webLink.target),
  });
}

export function updateWebLink(state, shortcutId, changes) {
  return updateShortcut(state, shortcutId, {
    ...changes,
    target: normalizeWebTarget(changes.target),
  });
}

export function updateShortcut(state, shortcutId, changes) {
  const name = String(changes.name ?? '').trim();
  const target = String(changes.target ?? '').trim();
  if (!name) throw new Error('Shortcut name must not be empty.');
  if (!target) throw new Error('Shortcut target must not be empty.');
  let found = false;
  const shortcuts = state.shortcuts.map((candidate) => {
    if (candidate.id !== shortcutId) return candidate;
    found = true;
    return {
      ...candidate,
      name,
      description: String(changes.description ?? '').trim(),
      target,
      icon: changes.icon ?? null,
    };
  });
  if (!found) throw new Error('Shortcut was not found.');
  return { ...state, shortcuts };
}

/** Splits one placement of a linked shortcut off into a brand-new,
 * independent shortcut record carrying a copy of the current shared data.
 * The original record keeps its other placements untouched. Use this before
 * applying an edit that should only affect one location, not every place
 * the shortcut is linked into. */
export function forkPlacement(state, placementId_) {
  const found = findPlacement(state, placementId_);
  if (!found) throw new Error('Shortcut was not found.');
  const { shortcut, placement } = found;
  if (placementCount(shortcut) <= 1) return state;
  const newShortcut = {
    ...shortcut,
    id: id('shortcut'),
    placements: [{ id: placementId(), parentId: placement.parentId, order: placement.order }],
  };
  const shortcuts = state.shortcuts
    .map((candidate) => candidate.id === shortcut.id
      ? { ...candidate, placements: candidate.placements.filter((entry) => entry.id !== placementId_) }
      : candidate)
    .concat(newShortcut);
  return { ...state, shortcuts };
}

export function updateGroup(state, groupId, changes) {
  const name = String(changes.name ?? '').trim();
  if (!name) throw new Error('Group name must not be empty.');
  let found = false;
  const groups = state.groups.map((candidate) => {
    if (candidate.id !== groupId) return candidate;
    found = true;
    return {
      ...candidate,
      name,
      icon: changes.icon ?? null,
    };
  });
  // 024: layout name/icon customization is REMOVED. The persisted name/icon
  // fields stay for compatibility, but the group editor can no longer rename
  // or re-icon a window-layout record (the card is identified by content).
  const windowLayouts = (state.windowLayouts ?? []).map((candidate) => {
    if (candidate.id !== groupId) return candidate;
    throw new Error('Window layout name and icon are not customizable.');
  });
  if (!found) throw new Error('Group was not found.');
  return { ...state, groups, windowLayouts };
}

export function moveSelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(selectedRoots(state, ids));
  const selectedGroupIds = new Set();
  const selectedWindowLayoutIds = new Set();
  const selectedPlacementIds = new Set();
  for (const selectedId of selected) {
    const selectedGroup = group(state, selectedId);
    if (selectedGroup) {
      if (selectedGroup.id === destinationId || isDescendant(state, destinationId, selectedGroup.id)) {
        throw new Error('A group cannot be moved inside itself.');
      }
      selectedGroupIds.add(selectedId);
    } else if (windowLayout(state, selectedId)) {
      selectedWindowLayoutIds.add(selectedId);
    } else {
      selectedPlacementIds.add(selectedId);
    }
  }
  let order = nextOrder(state, destinationId);
  const groups = state.groups.map((candidate) => selectedGroupIds.has(candidate.id)
    ? { ...candidate, parentId: destinationId, order: order++, bin: undefined }
    : candidate);
  const windowLayouts = (state.windowLayouts ?? []).map((candidate) => selectedWindowLayoutIds.has(candidate.id)
    ? { ...candidate, parentId: destinationId, order: order++, bin: undefined }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, selectedPlacementIds, (placement) => ({
    ...placement,
    parentId: destinationId,
    order: order++,
    bin: undefined,
  }));
  return { ...state, groups, windowLayouts, shortcuts };
}

/** Collapses every one of a shortcut's active placements into a single new
 * placement at `destinationId`. Used when cutting a linked shortcut from a
 * view where all of its placements are currently visible at once (e.g. the
 * top-level graph showing every edge) — the whole shared thing moves,
 * rather than any one specific location. Binned placements are untouched. */
export function collapsePlacements(state, shortcutId, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const order = nextOrder(state, destinationId);
  const shortcuts = state.shortcuts.map((candidate) => {
    if (candidate.id !== shortcutId) return candidate;
    const binned = candidate.placements.filter((placement) => placement.bin);
    return {
      ...candidate,
      placements: [...binned, { id: placementId(), parentId: destinationId, order }],
    };
  });
  return { ...state, shortcuts };
}

/** Copying a shortcut always links: it gains a new placement in the
 * destination pointing at the same shared record, rather than becoming an
 * independent duplicate. `newPlacements` collects { shortcutId, parentId,
 * order } entries to fold into the existing records afterward. Groups still
 * fully clone, recursively, including a new placement for any linked
 * shortcut found inside. Window-layout records duplicate as independent
 * records with a new id — never shortcut-style linked placements. */
function copyGroup(state, source, parentId, order, copies, newPlacements) {
  const copied = { ...source, id: id('group'), parentId, order, bin: undefined };
  copies.groups.push(copied);
  for (const child of itemsIn(state, source.id)) {
    if (child.kind === 'group') copyGroup(state, child, copied.id, child.order, copies, newPlacements);
    else if (child.kind === 'window-layout') {
      const { kind: _kind, ...record } = child;
      copies.windowLayouts.push({
        ...record,
        id: id('window-layout'),
        parentId: copied.id,
        order: child.order,
        bin: undefined,
      });
    } else {
      newPlacements.push({ shortcutId: child.shortcutId, parentId: copied.id, order: child.order });
    }
  }
}

export function copySelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(selectedRoots(state, ids));
  const copies = { groups: [], windowLayouts: [] };
  const newPlacements = [];
  let order = nextOrder(state, destinationId);

  const selectedGroups = sorted(
    state.groups.filter((candidate) => selected.has(candidate.id) && activeItem(state, candidate)),
  );
  for (const sourceGroup of selectedGroups) {
    copyGroup(state, sourceGroup, destinationId, order++, copies, newPlacements);
  }

  const selectedWindowLayouts = sorted(
    (state.windowLayouts ?? [])
      .filter((candidate) => selected.has(candidate.id) && activeItem(state, candidate)),
  );
  for (const source of selectedWindowLayouts) {
    copies.windowLayouts.push({
      ...source,
      id: id('window-layout'),
      parentId: destinationId,
      order: order++,
      bin: undefined,
    });
  }

  const selectedPlacements = sorted(
    [...selected]
      .filter((selectedId) => !group(state, selectedId) && !windowLayout(state, selectedId))
      .map((selectedId) => findPlacement(state, selectedId))
      .filter((found) => found && !found.placement.bin)
      .map(({ shortcut, placement }) => ({ shortcutId: shortcut.id, order: placement.order })),
  );
  for (const { shortcutId } of selectedPlacements) {
    newPlacements.push({ shortcutId, parentId: destinationId, order: order++ });
  }

  const byShortcutId = new Map();
  for (const entry of newPlacements) {
    if (!byShortcutId.has(entry.shortcutId)) byShortcutId.set(entry.shortcutId, []);
    byShortcutId.get(entry.shortcutId).push(entry);
  }
  const shortcuts = state.shortcuts.map((candidate) => {
    const additions = byShortcutId.get(candidate.id);
    if (!additions) return candidate;
    return {
      ...candidate,
      placements: [
        ...candidate.placements,
        ...additions.map(({ parentId, order: placeOrder }) => ({ id: placementId(), parentId, order: placeOrder })),
      ],
    };
  });
  return {
    ...state,
    groups: [...state.groups, ...copies.groups],
    windowLayouts: [...(state.windowLayouts ?? []), ...copies.windowLayouts],
    shortcuts,
  };
}

export function reorderSelection(state, ids, parentId, beforeId = null) {
  const selected = new Set(ids);
  const siblings = itemsIn(state, parentId);
  if (![...selected].every((selectedId) => siblings.some((candidate) => candidate.id === selectedId))) {
    throw new Error('Only items in this folder can be reordered together.');
  }
  const moving = siblings.filter((candidate) => selected.has(candidate.id));
  const remaining = siblings.filter((candidate) => !selected.has(candidate.id));
  const index = beforeId ? remaining.findIndex((candidate) => candidate.id === beforeId) : remaining.length;
  if (beforeId && index < 0) throw new Error('The reorder destination was not found.');
  const reordered = [
    ...remaining.slice(0, index),
    ...moving,
    ...remaining.slice(index),
  ];
  const orders = new Map(reordered.map((candidate, order) => [candidate.id, order]));
  const groups = state.groups.map((candidate) => orders.has(candidate.id)
    ? { ...candidate, order: orders.get(candidate.id) }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, orders.keys(), (placement) => ({
    ...placement,
    order: orders.get(placement.id),
  }));
  return { ...state, groups, shortcuts };
}

/** Applies `transform(placement)` to each placement whose id is in
 * `placementIds`, returning a new `shortcuts` array. `transform` returning
 * `undefined` removes that placement entirely (used by permanent delete). */
function mapPlacements(shortcuts, placementIds, transform) {
  const ids = new Set(placementIds);
  return shortcuts.map((candidate) => {
    if (!candidate.placements?.some((placement) => ids.has(placement.id))) return candidate;
    const placements = candidate.placements
      .map((placement) => (ids.has(placement.id) ? transform(placement) : placement))
      .filter(Boolean);
    return { ...candidate, placements };
  });
}

function selectedRoots(state, ids) {
  const selected = new Set(ids);
  return [...selected].filter((selectedId) => {
    let candidate = item(state, selectedId);
    while (candidate && candidate.parentId !== ROOT_ID) {
      if (selected.has(candidate.parentId)) return false;
      candidate = group(state, candidate.parentId);
    }
    return true;
  });
}

export function binSelection(state, ids, binnedAt = new Date().toISOString()) {
  const roots = new Set(selectedRoots(state, ids));
  const groupRoots = new Set([...roots].filter((rootId) => group(state, rootId)));
  const windowLayoutRoots = new Set([...roots].filter((rootId) => windowLayout(state, rootId)));
  const placementRoots = [...roots].filter((rootId) => !groupRoots.has(rootId) && !windowLayoutRoots.has(rootId));
  const groups = state.groups.map((candidate) => groupRoots.has(candidate.id)
    ? {
        ...candidate,
        bin: { parentId: candidate.parentId, order: candidate.order ?? 0, binnedAt },
      }
    : candidate);
  const windowLayouts = (state.windowLayouts ?? []).map((candidate) => windowLayoutRoots.has(candidate.id)
    ? {
        ...candidate,
        bin: { parentId: candidate.parentId, order: candidate.order ?? 0, binnedAt },
      }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, placementRoots, (placement) => ({
    ...placement,
    bin: { parentId: placement.parentId, order: placement.order ?? 0, binnedAt },
  }));
  // 017: binning the active layout (directly or via its folder) clears the
  // persisted active-recording id immediately; restore never reactivates it.
  const active = state.activeWindowLayoutId;
  const activeBinned = typeof active === 'string' && active
    && (windowLayoutRoots.has(active)
      || (windowLayout(state, active) && isUnderBinnedGroup({ ...state, groups }, windowLayout(state, active))));
  return {
    ...state,
    groups,
    windowLayouts,
    shortcuts,
    activeWindowLayoutId: activeBinned ? null : state.activeWindowLayoutId,
  };
}

export function restoreSelection(state, ids) {
  const selected = new Set(ids);
  const restore = (candidate) => {
    if (!selected.has(candidate.id)) return candidate;
    if (candidate.bin) {
      const originalParent = candidate.bin.parentId;
      const canRestoreParent = originalParent === ROOT_ID
        || (group(state, originalParent) && activeItem(state, group(state, originalParent)));
      return {
        ...candidate,
        parentId: canRestoreParent ? originalParent : ROOT_ID,
        order: candidate.bin.order,
        bin: undefined,
      };
    }
    // Never itself binned — just nested inside a binned ancestor. Restoring
    // it alone reparents it to the nearest still-active ancestor, without
    // touching the binned folder it was pulled out of.
    if (!isUnderBinnedGroup(state, candidate)) return candidate;
    return { ...candidate, parentId: nearestActiveAncestorId(state, candidate.parentId) };
  };
  const groups = state.groups.map(restore);
  const windowLayouts = (state.windowLayouts ?? []).map(restore);
  const shortcuts = mapPlacements(state.shortcuts, ids, (placement) => {
    if (placement.bin) {
      const originalParent = placement.bin.parentId;
      const canRestoreParent = originalParent === ROOT_ID
        || (group(state, originalParent) && activeItem(state, group(state, originalParent)));
      return {
        id: placement.id,
        parentId: canRestoreParent ? originalParent : ROOT_ID,
        order: placement.bin.order,
      };
    }
    if (!isUnderBinnedGroupId(state, placement.parentId)) return placement;
    return { ...placement, parentId: nearestActiveAncestorId(state, placement.parentId) };
  });
  return { ...state, groups, windowLayouts, shortcuts };
}

function descendantGroupIds(state, roots) {
  const result = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of state.groups) {
      if (!result.has(candidate.id) && result.has(candidate.parentId)) {
        result.add(candidate.id);
        changed = true;
      }
    }
  }
  return result;
}

export function permanentlyDelete(state, ids) {
  const selected = ids.map((itemId) => item(state, itemId));
  const isDeletable = (candidate) => Boolean(candidate)
    && (Boolean(candidate.bin) || isUnderBinnedGroupId(state, candidate.parentId));
  if (selected.some((candidate) => !isDeletable(candidate))) {
    throw new Error('Only items in the Bin can be permanently deleted.');
  }
  const selectedIds = new Set(ids);
  const selectedGroupIds = new Set([...selectedIds].filter((selectedId) => group(state, selectedId)));
  const selectedPlacementIds = new Set([...selectedIds].filter((selectedId) => !selectedGroupIds.has(selectedId)));
  const groupsToDelete = descendantGroupIds(
    state,
    state.groups.filter((candidate) => selectedGroupIds.has(candidate.id)).map((candidate) => candidate.id),
  );
  const groups = state.groups.filter((candidate) => !groupsToDelete.has(candidate.id));
  // Window layouts die with their folder or when deleted outright; binned
  // ones can only be deleted when in the Bin (the guard above).
  const windowLayouts = (state.windowLayouts ?? [])
    .filter((candidate) => !selectedIds.has(candidate.id) && !groupsToDelete.has(candidate.parentId));
  const shortcuts = state.shortcuts
    .map((candidate) => ({
      ...candidate,
      placements: candidate.placements.filter((placement) => {
        if (selectedPlacementIds.has(placement.id)) return false;
        const homeParent = placement.bin ? placement.bin.parentId : placement.parentId;
        return !groupsToDelete.has(homeParent);
      }),
    }))
    .filter((candidate) => candidate.placements.length > 0);
  // 017: deleting the active layout (directly or via its folder) clears the
  // persisted active-recording id immediately; restore never reactivates it.
  const active = state.activeWindowLayoutId;
  const activeDeleted = typeof active === 'string' && active
    && !windowLayouts.some((candidate) => candidate.id === active);
  // Graph nodes are keyed by group id and by SHORTCUT id, while deletion works
  // on placement ids — so pruning by the ids passed in would miss every
  // shortcut. A shortcut is gone when its last placement went with it.
  const survivingShortcutIds = new Set(shortcuts.map((candidate) => candidate.id));
  const deletedShortcutIds = state.shortcuts
    .map((candidate) => candidate.id)
    .filter((shortcutId) => !survivingShortcutIds.has(shortcutId));
  const deletedIds = [
    ...selectedIds,
    ...groupsToDelete,
    ...deletedShortcutIds,
  ];
  const pruned = forgetRestPositionsEverywhere(state, deletedIds);
  return {
    ...pruned,
    groups,
    windowLayouts,
    shortcuts,
    activeWindowLayoutId: activeDeleted ? null : state.activeWindowLayoutId,
  };
}

export function renameItem(state, itemId, name) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Name must not be empty.');
  let found = false;
  const groups = state.groups.map((candidate) => candidate.id === itemId
    ? (found = true, { ...candidate, name: trimmed })
    : candidate);
  const shortcuts = state.shortcuts.map((candidate) => candidate.id === itemId
    ? (found = true, { ...candidate, name: trimmed })
    : candidate);
  if (!found) throw new Error('Item was not found.');
  return { ...state, groups, shortcuts };
}

export function setIconSize(state, size) {
  return {
    ...state,
    view: {
      ...state.view,
      iconSize: Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, Math.round(size))),
    },
  };
}

export function updateWorkspaceView(state, changes) {
  const has = (key) => Object.prototype.hasOwnProperty.call(changes, key);
  const layout =
    has('layout') && (changes.layout === 'graph' || changes.layout === 'explorer')
      ? changes.layout
      : (state.view?.layout === 'graph' ? 'graph' : 'explorer');
  return {
    ...state,
    view: {
      ...state.view,
      layout,
      iconSize: state.view?.iconSize ?? DEFAULT_ICON_SIZE,
      currentGroupId:
        has('currentGroupId') && typeof changes.currentGroupId === 'string'
          ? changes.currentGroupId
          : (state.view?.currentGroupId ?? ROOT_ID),
      ...(Object.keys(has('surfaceLocations')
        ? normalizeSurfaceLocations(changes.surfaceLocations)
        : normalizeSurfaceLocations(state.view?.surfaceLocations)).length > 0
        ? { surfaceLocations: has('surfaceLocations')
          ? normalizeSurfaceLocations(changes.surfaceLocations)
          : normalizeSurfaceLocations(state.view?.surfaceLocations) }
        : {}),
      expandedGroupIds: has('expandedGroupIds')
        ? stringIds(changes.expandedGroupIds)
        : (state.view?.expandedGroupIds ?? []),
      graphExpandedGroupIds: has('graphExpandedGroupIds')
        ? stringIds(changes.graphExpandedGroupIds)
        : (state.view?.graphExpandedGroupIds ?? []),
      selectedItemIds: has('selectedItemIds')
        ? stringIds(changes.selectedItemIds)
        : (state.view?.selectedItemIds ?? []),
      binMode: has('binMode')
        ? changes.binMode === true
        : (state.view?.binMode === true),
      graphPositions: has('graphPositions')
        ? normalizeGraphPositions(changes.graphPositions)
        : (state.view?.graphPositions ?? {}),
      graphRestPositions: has('graphRestPositions')
        ? normalizeGraphPositions(changes.graphRestPositions)
        : (state.view?.graphRestPositions ?? {}),
      toolbarPositions: has('toolbarPositions')
        ? normalizeFlatPositions(changes.toolbarPositions)
        : (state.view?.toolbarPositions ?? {}),
      promptLibrary: has('promptLibrary')
        ? normalizePromptLibrary(changes.promptLibrary)
        : (state.view?.promptLibrary ?? []),
    },
  };
}

/** Per-Papers-tab local navigation. The opaque key comes from the host; this
 * project only stores a folder id and never treats the key as authority. */
export function normalizeSurfaceLocations(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw)
    .filter(([key, value]) => typeof key === 'string' && key.length > 0 && key.length <= 128
      && value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.currentGroupId === 'string')
    .slice(-MAX_SURFACE_LOCATIONS);
  return Object.fromEntries(entries.map(([key, value]) => [key, { currentGroupId: value.currentGroupId }]));
}

export function surfaceLocationFor(state, surfaceKey) {
  if (typeof surfaceKey !== 'string' || surfaceKey.length === 0 || surfaceKey.length > 128) return null;
  return state.view?.surfaceLocations?.[surfaceKey] ?? null;
}

export function setSurfaceLocation(state, surfaceKey, currentGroupId) {
  if (typeof surfaceKey !== 'string' || surfaceKey.length === 0 || surfaceKey.length > 128
    || typeof currentGroupId !== 'string') return state;
  const locations = normalizeSurfaceLocations(state.view?.surfaceLocations);
  delete locations[surfaceKey];
  locations[surfaceKey] = { currentGroupId };
  return updateWorkspaceView(state, { surfaceLocations: locations });
}

export function setPromptLibrary(state, nodes) {
  return updateWorkspaceView(state, { promptLibrary: normalizePromptLibrary(nodes) });
}

export function graphContextId(currentGroupId, binMode) {
  return binMode ? 'bin' : (currentGroupId ?? ROOT_ID);
}

function readPosition(state, mapKey, contextId, itemId) {
  const ctx = state.view?.[mapKey]?.[contextId];
  if (!ctx || !ctx[itemId]) return null;
  return { x: ctx[itemId].x, y: ctx[itemId].y };
}

function writePositions(state, mapKey, contextId, updates) {
  const ctx = { ...(state.view?.[mapKey]?.[contextId] ?? {}) };
  for (const [itemId, pos] of Object.entries(updates)) {
    if (!hasNumber(pos?.x) || !hasNumber(pos?.y)) {
      delete ctx[itemId];
    } else {
      ctx[itemId] = { x: pos.x, y: pos.y };
    }
  }
  const map = { ...(state.view?.[mapKey] ?? {}) };
  if (Object.keys(ctx).length > 0) {
    map[contextId] = ctx;
  } else {
    delete map[contextId];
  }
  return updateWorkspaceView(state, { [mapKey]: map });
}

function dropPositions(state, mapKey, contextId, itemIds) {
  const ctx = { ...(state.view?.[mapKey]?.[contextId] ?? {}) };
  for (const itemId of itemIds) delete ctx[itemId];
  const map = { ...(state.view?.[mapKey] ?? {}) };
  if (Object.keys(ctx).length > 0) {
    map[contextId] = ctx;
  } else {
    delete map[contextId];
  }
  return updateWorkspaceView(state, { [mapKey]: map });
}

/** Forgets remembered positions for these ids in EVERY context.
 *
 * A remembered position is keyed by item id, so an id that no longer exists is
 * never read back — the entry is inert rather than harmful. It is still
 * removed, because a map that only ever grows is a slow leak in a file the
 * creator keeps for years, and because an id that came back would silently
 * inherit a position from something unrelated. */
function forgetRestPositionsEverywhere(state, itemIds) {
  const ids = new Set(itemIds);
  const map = state.view?.graphRestPositions ?? {};
  const next = {};
  let changed = false;
  for (const [contextId, ctx] of Object.entries(map)) {
    const kept = {};
    for (const [itemId, pos] of Object.entries(ctx)) {
      if (ids.has(itemId)) {
        changed = true;
        continue;
      }
      kept[itemId] = pos;
    }
    if (Object.keys(kept).length > 0) next[contextId] = kept;
    else if (Object.keys(ctx).length > 0) changed = true;
  }
  if (!changed) return state;
  return { ...state, view: { ...state.view, graphRestPositions: next } };
}
/** Where an UNPINNED node last came to rest.
 *
 * Distinct from graphPositions, which pins: a pinned position is applied as
 * fx/fy and the solver may never move the node again. A remembered position is
 * only a seed. The node still floats, still responds to every force, and can
 * still be pushed anywhere — it simply starts from where it was last seen
 * instead of from a generic ring, so reopening a workspace does not rearrange
 * everything the creator had learned the shape of. */
export function getGraphRestPosition(state, contextId, itemId) {
  return readPosition(state, 'graphRestPositions', contextId, itemId);
}

export function setGraphRestPositions(state, contextId, updates) {
  return writePositions(state, 'graphRestPositions', contextId, updates);
}

export function removeGraphRestPositions(state, contextId, itemIds) {
  return dropPositions(state, 'graphRestPositions', contextId, itemIds);
}
export function getGraphPosition(state, contextId, itemId) {
  const ctx = state.view?.graphPositions?.[contextId];
  if (!ctx || !ctx[itemId]) return null;
  return { x: ctx[itemId].x, y: ctx[itemId].y };
}

export function setGraphPositions(state, contextId, updates) {
  const ctx = { ...(state.view?.graphPositions?.[contextId] ?? {}) };
  for (const [itemId, pos] of Object.entries(updates)) {
    if (!hasNumber(pos?.x) || !hasNumber(pos?.y)) {
      delete ctx[itemId];
    } else {
      ctx[itemId] = { x: pos.x, y: pos.y };
    }
  }
  const graphPositions = { ...(state.view?.graphPositions ?? {}) };
  if (Object.keys(ctx).length > 0) {
    graphPositions[contextId] = ctx;
  } else {
    delete graphPositions[contextId];
  }
  return updateWorkspaceView(state, { graphPositions });
}

export function removeGraphPositions(state, contextId, itemIds) {
  const ctx = { ...(state.view?.graphPositions?.[contextId] ?? {}) };
  for (const itemId of itemIds) {
    delete ctx[itemId];
  }
  const graphPositions = { ...(state.view?.graphPositions ?? {}) };
  if (Object.keys(ctx).length > 0) {
    graphPositions[contextId] = ctx;
  } else {
    delete graphPositions[contextId];
  }
  return updateWorkspaceView(state, { graphPositions });
}

export { normalizeGraphPositions };

export function setToolbarPosition(state, key, pos) {
  const toolbarPositions = { ...(state.view?.toolbarPositions ?? {}) };
  if (!hasNumber(pos?.x) || !hasNumber(pos?.y)) {
    delete toolbarPositions[key];
  } else {
    toolbarPositions[key] = { x: pos.x, y: pos.y };
  }
  return updateWorkspaceView(state, { toolbarPositions });
}

export function getToolbarPosition(state, key) {
  const pos = state.view?.toolbarPositions?.[key];
  return pos ? { x: pos.x, y: pos.y } : null;
}

export function itemsIntersectingMarquee(items, rectangle) {
  const left = Math.min(rectangle.left, rectangle.right);
  const right = Math.max(rectangle.left, rectangle.right);
  const top = Math.min(rectangle.top, rectangle.bottom);
  const bottom = Math.max(rectangle.top, rectangle.bottom);

  return items
    .filter((candidate) =>
      candidate.right >= left
      && candidate.left <= right
      && candidate.bottom >= top
      && candidate.top <= bottom)
    .map((candidate) => candidate.id);
}
