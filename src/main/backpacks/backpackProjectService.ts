/**
 * Minimal host seam for independently maintained Backpack projects.
 *
 * Papers owns only a machine-local binding, static-project loading and action
 * mediation. Project HTML, labels, prompts and behavior stay outside app.asar.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseBackpackProjectWebUrl } from './backpackProjectWebLink';
import { resolveWebLinkIcon } from './backpackProjectSiteIcon';

export const BACKPACK_PROJECT_SCHEME = 'papers-backpack';

export interface OpenBackpackProject {
  url: string;
  /** Assigned by the host when the logical surface is created. */
  surfaceId?: string;
}

interface ProjectBinding {
  root: string;
}

/**
 * A project's private control record. Only the fields the host itself needs are
 * named: a project may state more (for example `launcherSurface`), and the host
 * carries such a statement without interpreting it.
 */
export interface ProjectManifest {
  backpackId: string;
  entry: string;
  root: string;
  /** Optional host-owned child workspace declaration. The renderer never
   * supplies the target Backpack; it is read from the bound manifest. */
  workspaceHost?: string;
  /** The record is open: a project may state more than the host needs. */
  [field: string]: unknown;
}

export interface BackpackProjectWorkspaceScope {
  /** The canonical Backpack whose document is being displayed. */
  backpackId: string;
  /** The real As you Go group that is the immutable visible root. */
  rootGroupId: string;
  /** A Papers-served entry URL for the canonical child surface. */
  url: string;
}

interface ProjectAction {
  id: string;
  target: string;
}

export interface BackpackProjectState {
  schemaVersion: 1;
  groups: unknown[];
  shortcuts: unknown[];
}

/**
 * Revision of the state file a reader observed, used for compare-and-set saves.
 *
 * It is the hash of the exact bytes on disk, so Papers keeps no parallel
 * bookkeeping that could drift from the file, and an edit made outside Papers
 * is caught by the same check as a second surface. Papers still never parses
 * meaning out of the document: the hash is over opaque bytes.
 */
export type BackpackProjectStateRevision = string;

/** Revision reported when no state file exists yet. A first writer passes this
 * to mean "create it only if it is still absent". */
export const ABSENT_STATE_REVISION: BackpackProjectStateRevision = 'absent';

export interface LoadedBackpackProjectState {
  state: BackpackProjectState;
  revision: BackpackProjectStateRevision;
}

/**
 * A save either lands, or is refused because someone else wrote first. A
 * refusal is a normal outcome, not an error: the caller reloads and decides
 * what to do. It is deliberately NOT an exception, so a stale writer cannot be
 * mistaken for a broken host.
 */
export type SaveStateResult =
  | { ok: true; revision: BackpackProjectStateRevision }
  | { ok: false; code: 'STALE_REVISION'; revision: BackpackProjectStateRevision }
  | { ok: false; code: 'SCOPE_VIOLATION'; revision: BackpackProjectStateRevision };

/** Hash of the exact file bytes. */
function revisionOfBytes(bytes: string): BackpackProjectStateRevision {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

/** Injectable boundary for the atomic state replacement. The rename and the
 * delay are injected so unit tests exercise real retry behavior without
 * real-time sleeps; production defaults touch the real fs. */
export interface AtomicReplaceOptions {
  rename?: (from: string, to: string) => Promise<void>;
  delay?: (ms: number) => Promise<void>;
}

/** Windows-style transient replacement contention, retried for a short
 * bounded interval. Everything else is a real error and surfaces at once. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

/** One initial attempt plus five retries after 25/50/100/200/400 ms —
 * a bounded total wait just under one second, then the original error. */
export const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

/**
 * Atomically replaces `to` with `from` via rename, retrying only transient
 * Windows replacement contention (EPERM, EBUSY, ENOTEMPTY) for a short
 * bounded interval. The old file is never deleted, truncated or copied
 * over: a failed rename leaves the prior complete state readable, and the
 * caller keeps the temp file for finally cleanup. Non-transient errors and
 * exhausted retries rethrow the original error with its code/path context.
 */
export async function replaceFileAtomically(
  from: string,
  to: string,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  const rename = options.rename ?? ((source, dest) => fs.rename(source, dest));
  const delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (typeof code !== 'string' || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      if (attempt === RENAME_RETRY_DELAYS_MS.length) throw error;
      await delay(RENAME_RETRY_DELAYS_MS[attempt] as number);
    }
  }
}

export interface DroppedBackpackProjectTarget {
  name: string;
  target: string;
  kind: 'file' | 'folder';
}

interface NativeSourceGrant {
  backpackId: string;
  target: string;
  dev: bigint;
  ino: bigint;
}

const backpackIdPattern =
  /^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nativeSourceRefPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const publicDirectory = 'public';
const openNamespace = '_papers-open';
const namespacedAssetPattern =
  /^_papers-open\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(.+)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedShortcutTarget(target: string): boolean {
  if (path.isAbsolute(target)) return true;
  try {
    parseBackpackProjectWebUrl(target);
    return true;
  } catch {
    return false;
  }
}

/** AYG persists an active placement without `bin`, but its binned form is an
 * object (`{ parentId, order, binnedAt }`). Treat any non-false marker as bin
 * state so malformed truthy values fail closed instead of becoming visible. */
function hasBinMarker(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function placementBelongsToScope(placement: Record<string, unknown>, scopeIds: Set<string>): boolean {
  const parentId = hasBinMarker(placement['bin']) && isRecord(placement['bin'])
    ? placement['bin']['parentId']
    : placement['parentId'];
  return typeof parentId === 'string' && scopeIds.has(parentId);
}

function layoutBelongsToScope(layout: Record<string, unknown>, scopeIds: Set<string>): boolean {
  const parentId = hasBinMarker(layout['bin']) && isRecord(layout['bin'])
    ? layout['bin']['parentId']
    : layout['parentId'];
  return typeof parentId === 'string' && scopeIds.has(parentId);
}

function workspaceScopeGroupIds(state: Record<string, unknown>, rootGroupId: string): Set<string> {
  const groups = Array.isArray(state['groups']) ? state['groups'].filter(isRecord) : [];
  const ids = new Set<string>([rootGroupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (typeof group['id'] !== 'string' || typeof group['parentId'] !== 'string') continue;
      if (ids.has(group['parentId']) && !ids.has(group['id'])) {
        ids.add(group['id']);
        changed = true;
      }
    }
  }
  return ids;
}

function scopeBoundaryProjection(state: Record<string, unknown>, rootGroupId: string): string {
  const groups = Array.isArray(state['groups']) ? state['groups'].filter(isRecord) : [];
  const shortcuts = Array.isArray(state['shortcuts']) ? state['shortcuts'].filter(isRecord) : [];
  const windowLayouts = Array.isArray(state['windowLayouts']) ? state['windowLayouts'].filter(isRecord) : [];
  const scopeIds = workspaceScopeGroupIds(state, rootGroupId);
  const groupInside = (groupId: unknown): boolean => typeof groupId === 'string' && scopeIds.has(groupId);
  const outsideShortcuts = shortcuts.filter((shortcut) => {
    const placements = Array.isArray(shortcut['placements']) ? shortcut['placements'].filter(isRecord) : [];
    return placements.some((placement) => !placementBelongsToScope(placement, scopeIds));
  });
  const outsideLayouts = windowLayouts.filter((layout) => !layoutBelongsToScope(layout, scopeIds));
  const topLevel = Object.fromEntries(Object.entries(state).filter(([key]) => !['groups', 'shortcuts', 'windowLayouts', 'view'].includes(key)));
  const view = isRecord(state['view']) ? JSON.parse(JSON.stringify(state['view'])) as Record<string, unknown> : null;
  if (view) {
    for (const key of ['currentGroupId', 'selectedItemIds', 'expandedGroupIds', 'graphExpandedGroupIds', 'binMode', 'surfaceLocations', 'toolbarPositions', 'preferences', 'trailExpandedByContext']) delete view[key];
    for (const key of ['graphPositions', 'graphRestPositions']) {
      const contexts = isRecord(view[key]) ? { ...(view[key] as Record<string, unknown>) } : {};
      for (const scopeId of scopeIds) delete contexts[scopeId];
      view[key] = contexts;
    }
  }
  return JSON.stringify({
    topLevel,
    groups: groups.filter((group) => typeof group['id'] !== 'string' || !scopeIds.has(group['id'])),
    shortcuts: outsideShortcuts,
    windowLayouts: outsideLayouts,
    view,
  });
}

function scopedStatePreservesBoundary(previous: BackpackProjectState, candidate: BackpackProjectState, rootGroupId: string): boolean {
  const previousRecord = previous as unknown as Record<string, unknown>;
  const candidateRecord = candidate as unknown as Record<string, unknown>;
  const previousRoot = Array.isArray(previous.groups) ? previous.groups.find((group) => isRecord(group) && group['id'] === rootGroupId) : null;
  const candidateRoot = Array.isArray(candidate.groups) ? candidate.groups.find((group) => isRecord(group) && group['id'] === rootGroupId) : null;
  if (!isRecord(previousRoot) || !isRecord(candidateRoot)) return false;
  if (candidateRoot['parentId'] !== 'root' || hasBinMarker(candidateRoot['bin'])) return false;
  return scopeBoundaryProjection(previousRecord, rootGroupId) === scopeBoundaryProjection(candidateRecord, rootGroupId);
}

function scopedStateProjection(state: BackpackProjectState, rootGroupId: string): BackpackProjectState {
  const source = state as unknown as Record<string, unknown>;
  const groups = Array.isArray(source['groups']) ? source['groups'].filter(isRecord) : [];
  const scopeIds = workspaceScopeGroupIds(source, rootGroupId);
  const scopedGroups = groups.filter((group) => typeof group['id'] === 'string' && scopeIds.has(group['id']));
  const scopedGroupIds = new Set(scopedGroups.map((group) => group['id']).filter((id): id is string => typeof id === 'string'));
  const shortcuts = Array.isArray(source['shortcuts']) ? source['shortcuts'].filter(isRecord) : [];
  const scopedShortcuts: Record<string, unknown>[] = shortcuts.flatMap((shortcut) => {
    const placements = Array.isArray(shortcut['placements']) ? shortcut['placements'].filter(isRecord) : [];
    const inside = placements.filter((placement) => placementBelongsToScope(placement, scopedGroupIds));
    return inside.length ? [{ ...shortcut, placements: inside } as Record<string, unknown>] : [];
  });
  const scopedItemIds = new Set<string>(scopedGroupIds);
  for (const shortcut of scopedShortcuts) {
    if (typeof shortcut['id'] === 'string') scopedItemIds.add(shortcut['id']);
    for (const placement of Array.isArray(shortcut['placements']) ? shortcut['placements'].filter(isRecord) : []) {
      if (typeof placement['id'] === 'string') scopedItemIds.add(placement['id']);
    }
  }
  const layouts = Array.isArray(source['windowLayouts']) ? source['windowLayouts'].filter(isRecord) : [];
  const scopedLayouts = layouts.filter((layout) => layoutBelongsToScope(layout, scopedGroupIds));
  const viewSource = isRecord(source['view']) ? source['view'] : {};
  const view: Record<string, unknown> = {
    iconSize: viewSource['iconSize'],
    quickRunCardSize: viewSource['quickRunCardSize'],
    currentGroupId: rootGroupId,
    expandedGroupIds: Array.isArray(viewSource['expandedGroupIds'])
      ? viewSource['expandedGroupIds'].filter((id): id is string => typeof id === 'string' && scopedGroupIds.has(id))
      : [],
    graphExpandedGroupIds: Array.isArray(viewSource['graphExpandedGroupIds'])
      ? viewSource['graphExpandedGroupIds'].filter((id): id is string => typeof id === 'string' && scopedGroupIds.has(id))
      : [],
    selectedItemIds: Array.isArray(viewSource['selectedItemIds'])
      ? viewSource['selectedItemIds'].filter((id): id is string => typeof id === 'string' && scopedItemIds.has(id))
      : [],
    binMode: false,
    layout: viewSource['layout'],
    graphPositions: isRecord(viewSource['graphPositions'])
      ? Object.fromEntries(Object.entries(viewSource['graphPositions']).filter(([id]) => scopedGroupIds.has(id)))
      : {},
    graphRestPositions: isRecord(viewSource['graphRestPositions'])
      ? Object.fromEntries(Object.entries(viewSource['graphRestPositions']).filter(([id]) => scopedGroupIds.has(id)))
      : {},
    toolbarPositions: viewSource['toolbarPositions'],
    preferences: viewSource['preferences'],
    trailExpandedByContext: isRecord(viewSource['trailExpandedByContext'])
      ? Object.fromEntries(Object.entries(viewSource['trailExpandedByContext'])
        .filter(([key]) => key.startsWith('folder:') && scopedGroupIds.has(key.slice('folder:'.length))))
      : {},
  };
  const activeLayoutId = source['activeWindowLayoutId'];
  const startupLayoutId = source['startupWindowLayoutId'];
  return {
    schemaVersion: 1,
    groups: scopedGroups,
    shortcuts: scopedShortcuts,
    windowLayouts: scopedLayouts,
    ...(typeof activeLayoutId === 'string' && scopedLayouts.some((layout) => layout['id'] === activeLayoutId)
      ? { activeWindowLayoutId: activeLayoutId }
      : {}),
    ...(typeof startupLayoutId === 'string' && scopedLayouts.some((layout) => layout['id'] === startupLayoutId)
      ? { startupWindowLayoutId: startupLayoutId }
      : {}),
    view,
  } as BackpackProjectState;
}

function mergeScopedState(previous: BackpackProjectState, candidate: BackpackProjectState, rootGroupId: string): BackpackProjectState | null {
  const previousRecord = previous as unknown as Record<string, unknown>;
  const candidateRecord = candidate as unknown as Record<string, unknown>;
  const previousGroups = Array.isArray(previousRecord['groups']) ? previousRecord['groups'].filter(isRecord) : [];
  const candidateGroups = Array.isArray(candidateRecord['groups']) ? candidateRecord['groups'].filter(isRecord) : [];
  const scopeIds = workspaceScopeGroupIds(previousRecord, rootGroupId);
  const candidateRoot = candidateGroups.find((group) => group['id'] === rootGroupId);
  // The scope root may live anywhere, including nested under another folder:
  // the scope is the subtree below it, and every check below already walks
  // that subtree. Only a missing or binned root breaks scoped saves.
  if (!candidateRoot || hasBinMarker(candidateRoot['bin'])) return null;
  const previousGroupIds = new Set(previousGroups.map((group) => group['id']).filter((id): id is string => typeof id === 'string'));
  const candidateGroupById = new Map<string, Record<string, unknown>>();
  for (const group of candidateGroups) {
    const id = group['id'];
    if (typeof id !== 'string' || candidateGroupById.has(id) || (previousGroupIds.has(id) && !scopeIds.has(id))) return null;
    candidateGroupById.set(id, group);
  }
  for (const group of candidateGroups) {
    const id = group['id'];
    if (id === rootGroupId) continue;
    let parentId = group['parentId'];
    const seen = new Set<string>([id as string]);
    while (parentId !== rootGroupId) {
      if (typeof parentId !== 'string' || seen.has(parentId)) return null;
      seen.add(parentId);
      const parent = candidateGroupById.get(parentId);
      if (!parent) return null;
      parentId = parent['parentId'];
    }
  }
  const candidateScopeIds = new Set(candidateGroupById.keys());

  const previousShortcuts = Array.isArray(previousRecord['shortcuts']) ? previousRecord['shortcuts'].filter(isRecord) : [];
  const candidateShortcuts = Array.isArray(candidateRecord['shortcuts']) ? candidateRecord['shortcuts'].filter(isRecord) : [];
  const candidateShortcutById = new Map(candidateShortcuts.map((shortcut) => [shortcut['id'], shortcut]));
  const mergedShortcuts: Record<string, unknown>[] = [];
  for (const previousShortcut of previousShortcuts) {
    const placements = Array.isArray(previousShortcut['placements']) ? previousShortcut['placements'].filter(isRecord) : [];
    const outside = placements.filter((placement) => !placementBelongsToScope(placement, scopeIds));
    const insideBefore = placements.some((placement) => placementBelongsToScope(placement, scopeIds));
    const candidateShortcut = candidateShortcutById.get(previousShortcut['id']);
    if (outside.length) {
      if (candidateShortcut) {
        if (!insideBefore) return null;
        const inside = Array.isArray(candidateShortcut['placements']) ? candidateShortcut['placements'].filter(isRecord) : [];
        if (inside.some((placement) => !placementBelongsToScope(placement, candidateScopeIds))) return null;
        mergedShortcuts.push({ ...candidateShortcut, placements: [...inside, ...outside] });
      } else {
        mergedShortcuts.push({ ...previousShortcut, placements: outside });
      }
    } else if (candidateShortcut) {
      const inside = Array.isArray(candidateShortcut['placements']) ? candidateShortcut['placements'].filter(isRecord) : [];
      if (inside.some((placement) => !placementBelongsToScope(placement, candidateScopeIds))) return null;
      mergedShortcuts.push({ ...candidateShortcut, placements: inside });
    }
  }
  for (const candidateShortcut of candidateShortcuts) {
    if (previousShortcuts.some((shortcut) => shortcut['id'] === candidateShortcut['id'])) continue;
    const placements = Array.isArray(candidateShortcut['placements']) ? candidateShortcut['placements'].filter(isRecord) : [];
    if (placements.some((placement) => !placementBelongsToScope(placement, candidateScopeIds))) return null;
    mergedShortcuts.push({ ...candidateShortcut, placements });
  }

  const previousLayouts = Array.isArray(previousRecord['windowLayouts']) ? previousRecord['windowLayouts'].filter(isRecord) : [];
  const candidateLayouts = Array.isArray(candidateRecord['windowLayouts']) ? candidateRecord['windowLayouts'].filter(isRecord) : [];
  const previousLayoutById = new Map(previousLayouts.map((layout) => [layout['id'], layout]));
  const candidateLayoutIdsSeen = new Set<unknown>();
  if (candidateLayouts.some((layout) => {
    if (candidateLayoutIdsSeen.has(layout['id'])) return true;
    candidateLayoutIdsSeen.add(layout['id']);
    const previousLayout = previousLayoutById.get(layout['id']);
    const previousInside = previousLayout && layoutBelongsToScope(previousLayout, scopeIds);
    if (previousLayout && !previousInside) return true;
    return !layoutBelongsToScope(layout, candidateScopeIds);
  })) return null;
  const candidateLayoutIds = new Set(candidateLayouts.map((layout) => layout['id']));
  const candidateItemIds = new Set<string>(candidateScopeIds);
  for (const layout of candidateLayouts) if (typeof layout['id'] === 'string') candidateItemIds.add(layout['id']);
  for (const shortcut of candidateShortcuts) {
    if (typeof shortcut['id'] === 'string') candidateItemIds.add(shortcut['id']);
    for (const placement of Array.isArray(shortcut['placements']) ? shortcut['placements'].filter(isRecord) : []) {
      if (typeof placement['id'] === 'string') candidateItemIds.add(placement['id']);
    }
  }
  const mergedLayouts = previousLayouts
    .filter((layout) => !layoutBelongsToScope(layout, scopeIds))
    .concat(candidateLayouts);
  const candidateView = isRecord(candidateRecord['view']) ? candidateRecord['view'] : {};
  const previousView = isRecord(previousRecord['view']) ? previousRecord['view'] : {};
  const mergedView: Record<string, unknown> = { ...previousView };
  for (const key of ['iconSize', 'quickRunCardSize', 'layout', 'preferences', 'toolbarPositions']) {
    if (Object.prototype.hasOwnProperty.call(candidateView, key)) mergedView[key] = candidateView[key];
  }
  const candidateCurrentGroup = candidateView['currentGroupId'];
  mergedView.currentGroupId = typeof candidateCurrentGroup === 'string' && candidateScopeIds.has(candidateCurrentGroup)
    ? candidateCurrentGroup
    : rootGroupId;
  for (const key of ['expandedGroupIds', 'graphExpandedGroupIds', 'selectedItemIds']) {
    const previousIds = Array.isArray(previousView[key]) ? previousView[key].filter((id): id is string => typeof id === 'string' && !scopeIds.has(id)) : [];
    const candidateIdsForKey = Array.isArray(candidateView[key]) ? candidateView[key].filter((id): id is string => typeof id === 'string' && candidateItemIds.has(id)) : [];
    mergedView[key] = [...previousIds, ...candidateIdsForKey];
  }
  for (const key of ['graphPositions', 'graphRestPositions']) {
    const previousPositions = isRecord(previousView[key]) ? Object.fromEntries(Object.entries(previousView[key]).filter(([id]) => !scopeIds.has(id))) : {};
    const candidatePositions = isRecord(candidateView[key]) ? Object.fromEntries(Object.entries(candidateView[key]).filter(([id]) => candidateScopeIds.has(id))) : {};
    mergedView[key] = { ...previousPositions, ...candidatePositions };
  }
  const previousTrail = isRecord(previousView['trailExpandedByContext']) ? previousView['trailExpandedByContext'] : {};
  const candidateTrail = isRecord(candidateView['trailExpandedByContext']) ? candidateView['trailExpandedByContext'] : {};
  const mergedTrail = { ...previousTrail };
  for (const key of Object.keys(mergedTrail)) {
    if (key.startsWith('folder:') && scopeIds.has(key.slice('folder:'.length))) delete mergedTrail[key];
  }
  for (const [key, value] of Object.entries(candidateTrail)) {
    if (key.startsWith('folder:') && candidateScopeIds.has(key.slice('folder:'.length))) mergedTrail[key] = value;
  }
  mergedView.trailExpandedByContext = mergedTrail;
  const merged: Record<string, unknown> = {
    ...previousRecord,
    groups: previousGroups.filter((group) => typeof group['id'] !== 'string' || !scopeIds.has(group['id'])).concat(candidateGroups),
    shortcuts: mergedShortcuts,
    windowLayouts: mergedLayouts,
    view: mergedView,
  };
  for (const key of ['activeWindowLayoutId', 'startupWindowLayoutId']) {
    const candidateId = candidateRecord[key];
    if (candidateLayoutIds.has(candidateId)) merged[key] = candidateId;
  }
  return merged as unknown as BackpackProjectState;
}

function safeProjectPath(root: string, requested: string): string {
  if (
    !requested ||
    requested.includes('\0') ||
    path.isAbsolute(requested) ||
    requested.split(/[\\/]+/).includes('..')
  ) {
    throw new Error('Backpack project path points outside its project.');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return resolved;
    throw new Error('Backpack project path points outside its project.');
  }
  return resolved;
}

async function containedExistingPath(root: string, requested: string): Promise<string> {
  try {
    const candidate = safeProjectPath(root, requested);
    const [realRoot, realCandidate] = await Promise.all([
      fs.realpath(root),
      fs.realpath(candidate),
    ]);
    const relative = path.relative(realRoot, realCandidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      if (!relative) return realCandidate;
      throw new Error('Backpack project path points outside its project.');
    }
    return realCandidate;
  } catch (error) {
    if (error instanceof Error && error.message === 'Backpack project path points outside its project.') {
      throw error;
    }
    throw new Error('Backpack project file could not be read.');
  }
}

async function containedPublicPath(root: string, requested: string): Promise<string> {
  try {
    const candidate = safeProjectPath(root, requested);
    const lexicalPublic = path.join(path.resolve(root), publicDirectory);
    const [realRoot, realPublic, realCandidate] = await Promise.all([
      fs.realpath(root),
      fs.realpath(lexicalPublic),
      fs.realpath(candidate),
    ]);
    const publicRelative = path.relative(realRoot, realPublic);
    const expectedPublic =
      process.platform === 'win32'
        ? publicRelative.toLowerCase() === publicDirectory
        : publicRelative === publicDirectory;
    if (!expectedPublic) {
      throw new Error('Backpack project path points outside its project.');
    }
    const candidateRelative = path.relative(realPublic, realCandidate);
    if (
      !candidateRelative ||
      candidateRelative.startsWith('..') ||
      path.isAbsolute(candidateRelative)
    ) {
      if (!candidateRelative) return realCandidate;
      throw new Error('Backpack project path points outside its project.');
    }
    return realCandidate;
  } catch (error) {
    if (error instanceof Error && error.message === 'Backpack project path points outside its project.') {
      throw error;
    }
    throw new Error('Backpack project file could not be read.');
  }
}

export class BackpackProjectService {
  private readonly stateQueues = new Map<string, Promise<unknown>>();
  private readonly nativeSourceGrants = new Map<string, NativeSourceGrant>();

  constructor(
    private readonly bindingsFile: string,
    private readonly openTarget?: (target: string) => Promise<string>,
    private readonly resolveTargetIcon?: (target: string) => Promise<string | null>,
    private readonly revealTarget?: (target: string) => Promise<void>,
    private readonly replaceOptions?: AtomicReplaceOptions,
  ) {}

  private async binding(backpackId: string): Promise<ProjectBinding | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.bindingsFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Backpack project bindings could not be read.');
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !isRecord(parsed['projects'])) {
        throw new Error('invalid bindings');
      }
      const candidate = parsed['projects'][backpackId];
      if (candidate === undefined) return null;
      if (!isRecord(candidate) || typeof candidate['root'] !== 'string') {
        throw new Error('invalid binding');
      }
      if (!path.isAbsolute(candidate['root'])) throw new Error('project root is not absolute');
      return { root: path.resolve(candidate['root']) };
    } catch {
      throw new Error('Backpack project bindings could not be read.');
    }
  }

  private async manifest(backpackId: string): Promise<ProjectManifest | null> {
    if (!backpackIdPattern.test(backpackId)) throw new Error('Invalid Backpack project ID.');
    const binding = await this.binding(backpackId);
    if (!binding) return null;

    try {
      const raw = await fs.readFile(path.join(binding.root, 'project.json'), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        !isRecord(parsed) ||
        parsed['schemaVersion'] !== 1 ||
        typeof parsed['backpackId'] !== 'string' ||
        typeof parsed['entry'] !== 'string'
      ) {
        throw new Error('invalid project manifest');
      }
      if (parsed['backpackId'] !== backpackId) {
        throw new Error('Bound Backpack project ID does not match its record.');
      }
      const entry = parsed['entry'].replace(/\\/g, '/');
      safeProjectPath(binding.root, entry);
      if (!entry.startsWith(`${publicDirectory}/`)) {
        throw new Error('Backpack project entry is not public.');
      }
      return { ...parsed, backpackId, entry, root: binding.root } as ProjectManifest;
    } catch (error) {
      if (error instanceof Error && /does not match|outside|not public/.test(error.message)) {
        throw error;
      }
      throw new Error('Backpack project could not be read.');
    }
  }

  /**
   * The project's root directory, or null when it is not bound on this machine.
   *
   * Exposed so a caller can read the project's OWN private control records from
   * the same validated location the host uses, rather than re-deriving the path
   * from a guessed convention. It grants nothing: those records were already
   * private to the main process, and a renderer is told about a capability, never
   * about a path.
   *
   * Two independent capabilities needed this and each added it: the launcher,
   * which reads a project's declared command surface, and the local-service
   * bridge, which reads its declared services. They are the same read, so they
   * are the same method - and the merge that joined those branches found exactly
   * that, two identical additions with different prose.
   */
  async root(backpackId: string): Promise<string | null> {
    const manifest = await this.manifest(backpackId);
    return manifest?.root ?? null;
  }

  async isProtectedRoot(backpackId: string): Promise<boolean> {
    const manifest = await this.manifest(backpackId);
    const policy = isRecord(manifest?.folderPolicy) ? manifest.folderPolicy : null;
    return policy?.['deletion'] === 'protected-root';
  }

  /** Move the binding without changing the project's stable identity. */
  async rebind(backpackId: string, requestedRoot: string): Promise<void> {
    if (!path.isAbsolute(requestedRoot)) throw new Error('The Backpack project root must be absolute.');
    const requestedRootPath = path.resolve(requestedRoot);
    let root: string;
    let manifest: Record<string, unknown>;
    try {
      root = await fs.realpath(requestedRootPath);
      manifest = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      throw new Error('The new Backpack project root is not valid.');
    }
    if (manifest['schemaVersion'] !== 1 || manifest['backpackId'] !== backpackId || typeof manifest['entry'] !== 'string') {
      throw new Error('The new Backpack project root has a different identity.');
    }
    const entry = manifest['entry'].replace(/\\/g, '/');
    if (!entry.startsWith(`${publicDirectory}/`)) throw new Error('The new Backpack project entry is not public.');
    await containedExistingPath(root, entry);
    let raw: string;
    try {
      raw = await fs.readFile(this.bindingsFile, 'utf8');
    } catch {
      throw new Error('Backpack project bindings could not be read.');
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !isRecord(parsed['projects'])) {
      throw new Error('Backpack project bindings could not be read.');
    }
    const projects = parsed['projects'] as Record<string, unknown>;
    if (!isRecord(projects[backpackId])) throw new Error('Backpack project is not bound on this machine.');
    projects[backpackId] = { ...(projects[backpackId] as Record<string, unknown>), root };
    const tempPath = `${this.bindingsFile}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      await replaceFileAtomically(tempPath, this.bindingsFile, this.replaceOptions);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async assertShortcutInScope(backpackId: string, shortcutId: string, rootGroupId: string): Promise<void> {
    const state = await this.loadState(backpackId);
    const scopeIds = workspaceScopeGroupIds(state as unknown as Record<string, unknown>, rootGroupId);
    const shortcut = state?.shortcuts.find((candidate) => isRecord(candidate) && candidate['id'] === shortcutId);
    const placements = isRecord(shortcut) && Array.isArray(shortcut['placements'])
      ? shortcut['placements'].filter(isRecord)
      : [];
    if (!placements.some((placement) => !hasBinMarker(placement['bin']) && typeof placement['parentId'] === 'string' && scopeIds.has(placement['parentId']))) {
      throw new Error('That shortcut is outside this project folder.');
    }
  }

  async assertWebLinkInScope(backpackId: string, target: string, rootGroupId: string): Promise<void> {
    const state = await this.loadState(backpackId);
    const scopeIds = workspaceScopeGroupIds(state as unknown as Record<string, unknown>, rootGroupId);
    const shortcut = state?.shortcuts.find((candidate) => isRecord(candidate) && candidate['target'] === target);
    const placements = isRecord(shortcut) && Array.isArray(shortcut['placements'])
      ? shortcut['placements'].filter(isRecord)
      : [];
    if (!placements.some((placement) => !hasBinMarker(placement['bin'])
      && typeof placement['parentId'] === 'string'
      && scopeIds.has(placement['parentId']))) {
      throw new Error('That web link is outside this project folder.');
    }
  }

  async open(backpackId: string): Promise<OpenBackpackProject | null> {
    const manifest = await this.manifest(backpackId);
    if (!manifest) return null;
    await containedExistingPath(manifest.root, manifest.entry);
    const projectUrl = new URL(`${BACKPACK_PROJECT_SCHEME}://${backpackId}/`);
    projectUrl.pathname = `${openNamespace}/${randomUUID()}/${manifest.entry.replace(/\\/g, '/')}`;
    return {
      url: projectUrl.toString(),
    };
  }

  /**
   * Resolve the canonical As you Go surface for a host project and provision
   * one empty, deterministic folder for the requested Proxima project.
   *
   * The binding is deliberately declared by the host project's manifest. A
   * renderer may name its own opaque project key, but it cannot choose an AYG
   * Backpack or group. The group is created only when absent; existing AYG
   * records are never imported or copied into the host project's store.
   */
  async workspaceScope(
    hostBackpackId: string,
    projectKey: string,
    projectName: string,
  ): Promise<BackpackProjectWorkspaceScope | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(projectKey)) {
      throw new Error('Invalid Backpack workspace project key.');
    }
    const host = await this.manifest(hostBackpackId);
    const canonicalBackpackId = typeof host?.workspaceHost === 'string' ? host.workspaceHost : null;
    if (!canonicalBackpackId || canonicalBackpackId === hostBackpackId) return null;
    const canonical = await this.manifest(canonicalBackpackId);
    if (!canonical) throw new Error('The canonical workspace Backpack is not available.');

    const rootGroupId = `group-proxima-${createHash('sha256')
      .update(`${hostBackpackId}\0${projectKey}`, 'utf8')
      .digest('hex')
      .slice(0, 32)}`;
    const name = String(projectName || projectKey).trim().slice(0, 120) || projectKey;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loaded = await this.loadStateVersioned(canonicalBackpackId);
      const state = loaded.state as BackpackProjectState & { groups: Array<Record<string, unknown>> };
      const groups = state.groups as Array<Record<string, unknown>>;
      if (!groups.some((candidate) => candidate && candidate.id === rootGroupId)) {
        const siblings = groups.filter((candidate) => candidate?.parentId === 'root');
        groups.push({
          id: rootGroupId,
          parentId: 'root',
          order: siblings.length,
          name,
          icon: null,
        });
        const saved = await this.saveState(
          canonicalBackpackId,
          JSON.stringify(state),
          loaded.revision,
        );
        if (!saved.ok) continue;
      }
      const opened = await this.open(canonicalBackpackId);
      if (!opened) throw new Error('The canonical workspace surface could not be opened.');
      return { backpackId: canonicalBackpackId, rootGroupId, url: opened.url };
    }
    throw new Error('The canonical workspace changed while its project folder was being created.');
  }

  /** Origins that a host project's CSP may embed. */
  async embeddedProjectOrigins(backpackId: string): Promise<string[]> {
    const manifest = await this.manifest(backpackId);
    return typeof manifest?.workspaceHost === 'string'
      ? [`${BACKPACK_PROJECT_SCHEME}://${manifest.workspaceHost}`]
      : [];
  }

  async resolveAsset(backpackId: string, requestPath: string): Promise<string> {
    const manifest = await this.manifest(backpackId);
    if (!manifest) throw new Error('Backpack project is not bound on this machine.');
    const relative = decodeURIComponent(requestPath).replace(/^\/+/, '') || manifest.entry;
    const requested = relative.replace(/\\/g, '/');
    const namespaced = requested.match(namespacedAssetPattern);
    const normalized = namespaced?.[1] ?? requested;
    if (!normalized.startsWith(`${publicDirectory}/`)) {
      throw new Error('Backpack project asset is not public.');
    }
    return containedPublicPath(manifest.root, normalized);
  }

  private async actions(backpackId: string): Promise<ProjectAction[]> {
    const manifest = await this.manifest(backpackId);
    if (!manifest) throw new Error('Backpack project is not bound on this machine.');
    try {
      const raw = await fs.readFile(path.join(manifest.root, 'actions.json'), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !Array.isArray(parsed['actions'])) {
        throw new Error('invalid actions');
      }
      const seen = new Set<string>();
      return parsed['actions'].map((candidate) => {
        if (!isRecord(candidate)) throw new Error('invalid action');
        const id = candidate['id'];
        const target = candidate['target'];
        if (
          typeof id !== 'string' ||
          !actionIdPattern.test(id) ||
          seen.has(id) ||
          typeof target !== 'string' ||
          !path.isAbsolute(target)
        ) {
          throw new Error('invalid action');
        }
        seen.add(id);
        return { id, target: path.resolve(target) };
      });
    } catch {
      throw new Error('Backpack project actions could not be read.');
    }
  }

  async runAction(backpackId: string, actionId: string): Promise<void> {
    if (!actionIdPattern.test(actionId)) throw new Error('Invalid Backpack project action.');
    const action = (await this.actions(backpackId)).find((candidate) => candidate.id === actionId);
    if (!action) throw new Error(`Backpack project action ${actionId} not found.`);
    try {
      await fs.access(action.target);
    } catch {
      throw new Error(`Backpack project action ${actionId} is unavailable on this machine.`);
    }
    if (!this.openTarget) throw new Error('Backpack project launching is unavailable.');
    const detail = await this.openTarget(action.target);
    if (detail) throw new Error(`Backpack project action ${actionId} could not be opened: ${detail}`);
  }

  /** Project-owned state for an independently maintained Backpack explorer. */
  async loadState(backpackId: string, scopeRootId?: string): Promise<BackpackProjectState | null> {
    return (await this.loadStateVersioned(backpackId, scopeRootId)).state;
  }

  /**
   * The same load, plus the revision the caller must present to save without
   * overwriting somebody else. A seeded default carries ABSENT_STATE_REVISION,
   * so the first save still has something exact to compare against.
   */
  async loadStateVersioned(backpackId: string, scopeRootId?: string): Promise<LoadedBackpackProjectState> {
    return this.enqueueStateOperation(backpackId, async () => {
      const manifest = await this.manifest(backpackId);
      if (!manifest) throw new Error('Backpack project is not bound on this machine.');
      const statePath = path.join(manifest.root, 'state.json');
      let bytes: string;
      try {
        bytes = await fs.readFile(statePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Backpack project state could not be read.');
        const actions = await this.actions(backpackId);
        const state: LoadedBackpackProjectState = {
          revision: ABSENT_STATE_REVISION,
          state: {
            schemaVersion: 1,
            groups: [],
            shortcuts: actions.map((action) => ({
              id: `shortcut-${action.id}`,
              parentId: 'root',
              name: action.id === 'clips' ? 'CLIPS' : action.id === 'sloptop-mode' ? 'SLOPTOP MODE' : action.id === 'slop-engine' ? 'slop_engine' : action.id,
              description: '',
              target: action.target,
              icon: null,
            })),
          },
        };
        return scopeRootId === undefined ? state : { ...state, state: scopedStateProjection(state.state, scopeRootId) };
      }
      let parsed: BackpackProjectState;
      try {
        parsed = JSON.parse(bytes) as BackpackProjectState;
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.groups) || !Array.isArray(parsed.shortcuts)) {
          throw new Error('invalid state');
        }
      } catch {
        throw new Error('Backpack project state could not be read.');
      }
      return {
        state: scopeRootId === undefined ? parsed : scopedStateProjection(parsed, scopeRootId),
        revision: revisionOfBytes(bytes),
      };
    });
  }

  /** The revision currently on disk, read inside the save queue so a
   * compare-and-set cannot straddle another write. */
  private async currentRevision(root: string): Promise<BackpackProjectStateRevision> {
    try {
      return revisionOfBytes(await fs.readFile(path.join(root, 'state.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ABSENT_STATE_REVISION;
      throw new Error('Backpack project state could not be read.');
    }
  }

  /**
   * Save the whole document.
   *
   * `expectedRevision` is the revision the caller last observed. When it is
   * supplied and no longer matches what is on disk, nothing is written and the
   * caller is told so. Without it the write proceeds unconditionally, which is
   * only safe while a project has a single writer.
   *
   * The queue alone cannot prevent loss: it serialises A1 -> B1 -> A2, and A2
   * still carries a whole board that predates B1. The revision check is what
   * turns that silent erase into a refusal.
   */
  async saveState(
    backpackId: string,
    rawState: string,
    expectedRevision?: BackpackProjectStateRevision,
    scopeRootId?: string,
  ): Promise<SaveStateResult> {
    return this.enqueueStateOperation(
      backpackId,
      () => this.saveStateNow(backpackId, rawState, expectedRevision, scopeRootId),
    );
  }

  /**
   * Serialize every state read and write for one Backpack. A read waits for
   * operations already ahead of it, but later writes wait behind the read;
   * this prevents a live writer from moving the queue tail forever.
   */
  private async enqueueStateOperation<T>(backpackId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.stateQueues.get(backpackId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.stateQueues.set(backpackId, tail);
    try {
      return await current;
    } finally {
      if (this.stateQueues.get(backpackId) === tail) {
        this.stateQueues.delete(backpackId);
      }
    }
  }

  private async saveStateNow(
    backpackId: string,
    rawState: string,
    expectedRevision?: BackpackProjectStateRevision,
    scopeRootId?: string,
  ): Promise<SaveStateResult> {
    if (rawState.length > 5_000_000) throw new Error('Backpack project state is too large.');
    const manifest = await this.manifest(backpackId);
    if (!manifest) throw new Error('Backpack project is not bound on this machine.');
    let parsed: BackpackProjectState;
    try {
      parsed = JSON.parse(rawState) as BackpackProjectState;
    } catch {
      throw new Error('Backpack project state is not valid JSON.');
    }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.groups) || !Array.isArray(parsed.shortcuts)) {
      throw new Error('Backpack project state has an unsupported shape.');
    }
    for (const shortcut of parsed.shortcuts) {
      const candidate = isRecord(shortcut) ? shortcut : null;
      if (
        !candidate
        || typeof candidate['target'] !== 'string'
        || !isAllowedShortcutTarget(candidate['target'])
      ) {
        throw new Error('Backpack project shortcut targets must be absolute paths or http(s) URLs.');
      }
    }
    let currentState: BackpackProjectState | null = null;
    let stateToWrite = parsed;
    if (expectedRevision !== undefined || scopeRootId !== undefined) {
      let currentBytes: string;
      try {
        currentBytes = await fs.readFile(path.join(manifest.root, 'state.json'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Backpack project state could not be read.');
        currentBytes = '';
      }
      const current = currentBytes ? revisionOfBytes(currentBytes) : ABSENT_STATE_REVISION;
      if (expectedRevision !== undefined && current !== expectedRevision) {
        return { ok: false, code: 'STALE_REVISION', revision: current };
      }
      if (scopeRootId !== undefined) {
        if (!currentBytes) return { ok: false, code: 'SCOPE_VIOLATION', revision: current };
        try {
          currentState = JSON.parse(currentBytes) as BackpackProjectState;
        } catch {
          throw new Error('Backpack project state could not be read.');
        }
        const merged = mergeScopedState(currentState, parsed, scopeRootId);
        if (!merged) {
          return { ok: false, code: 'SCOPE_VIOLATION', revision: current };
        }
        stateToWrite = merged;
      }
    }
    const statePath = path.join(manifest.root, 'state.json');
    const tempPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
    const bytes = JSON.stringify(stateToWrite, null, 2) + '\n';
    try {
      await fs.writeFile(tempPath, bytes, {
        encoding: 'utf8',
      });
      // Windows intermittently denies replacing the existing state.json with
      // EPERM while another process briefly holds a deny-delete/replace
      // handle. Retry only that transient contention for a bounded interval;
      // a failed attempt leaves the prior complete state untouched.
      await replaceFileAtomically(tempPath, statePath, this.replaceOptions);
      return { ok: true, revision: revisionOfBytes(bytes) };
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async shortcutTarget(backpackId: string, shortcutId: string): Promise<string> {
    if (!actionIdPattern.test(shortcutId)) {
      throw new Error('Backpack project shortcut was not found.');
    }
    const state = await this.loadState(backpackId);
    const shortcut = state?.shortcuts.find((candidate) => isRecord(candidate) && candidate['id'] === shortcutId);
    const candidate = isRecord(shortcut) ? shortcut : null;
    if (!candidate || typeof candidate['target'] !== 'string' || !path.isAbsolute(candidate['target'])) {
      throw new Error('Backpack project shortcut was not found.');
    }
    return path.resolve(candidate['target']);
  }

  async targetIcon(target: string): Promise<string | null> {
    if (!path.isAbsolute(target)) return null;
    try {
      await fs.access(target);
    } catch {
      return null;
    }
    if (!this.resolveTargetIcon) return null;
    try {
      return await this.resolveTargetIcon(path.resolve(target));
    } catch {
      return null;
    }
  }

  async describeDroppedTargets(paths: string[]): Promise<DroppedBackpackProjectTarget[]> {
    const targets: DroppedBackpackProjectTarget[] = [];
    for (const rawPath of paths) {
      if (!path.isAbsolute(rawPath)) {
        throw new Error('Dropped Backpack project targets must be absolute paths.');
      }
      const target = path.resolve(rawPath);
      const details = await fs.stat(target);
      targets.push({
        name: path.basename(target) || path.parse(target).root,
        target,
        kind: details.isDirectory() ? 'folder' : 'file',
      });
    }
    return targets;
  }

  async grantNativeSource(backpackId: string, target: string): Promise<string> {
    if (!backpackIdPattern.test(backpackId)) {
      throw new Error('Invalid Backpack project ID.');
    }
    if (!path.isAbsolute(target)) {
      throw new Error('Native source grants require an absolute machine path.');
    }

    const canonicalTarget = await fs.realpath(target).catch(() => {
      throw new Error('Native source is unavailable on this machine.');
    });
    const details = await fs.stat(canonicalTarget, { bigint: true }).catch(() => {
      throw new Error('Native source is unavailable on this machine.');
    });

    if (!details.isFile()) {
      throw new Error('Native source grant requires a file.');
    }

    const sourceRef = randomUUID();
    this.nativeSourceGrants.set(sourceRef, {
      backpackId,
      target: canonicalTarget,
      dev: details.dev,
      ino: details.ino,
    });
    return sourceRef;
  }

  private async nativeSourceTarget(backpackId: string, sourceRef: string): Promise<string> {
    if (!nativeSourceRefPattern.test(sourceRef)) {
      throw new Error('Native source is not granted.');
    }

    const grant = this.nativeSourceGrants.get(sourceRef);
    if (!grant || grant.backpackId !== backpackId) {
      throw new Error('Native source is not granted for this Backpack.');
    }

    try {
      const details = await fs.stat(grant.target, { bigint: true });
      if (!details.isFile() || details.dev !== grant.dev || details.ino !== grant.ino) {
        this.nativeSourceGrants.delete(sourceRef);
        throw new Error('Native source grant is stale.');
      }
    } catch (error) {
      this.nativeSourceGrants.delete(sourceRef);
      if (error instanceof Error && error.message === 'Native source grant is stale.') {
        throw error;
      }
      throw new Error('Native source grant is stale.');
    }

    return grant.target;
  }

  async openNativeSource(backpackId: string, sourceRef: string): Promise<void> {
    const target = await this.nativeSourceTarget(backpackId, sourceRef);
    if (!this.openTarget) {
      throw new Error('Native source opening is unavailable.');
    }
    const detail = await this.openTarget(target);
    if (detail) {
      throw new Error(detail);
    }
  }

  async revealNativeSource(backpackId: string, sourceRef: string): Promise<void> {
    const target = await this.nativeSourceTarget(backpackId, sourceRef);
    if (!this.revealTarget) {
      throw new Error('Native source reveal is unavailable.');
    }
    await this.revealTarget(target);
  }

  async shortcutIcon(backpackId: string, shortcutId: string): Promise<string | null> {
    return this.targetIcon(await this.shortcutTarget(backpackId, shortcutId));
  }

  async launchShortcut(backpackId: string, shortcutId: string): Promise<void> {
    const target = await this.shortcutTarget(backpackId, shortcutId);
    try {
      await fs.access(target);
    } catch {
      throw new Error('That shortcut target is unavailable on this machine.');
    }
    if (!this.openTarget) throw new Error('Backpack project launching is unavailable.');
    const detail = await this.openTarget(target);
    if (detail) throw new Error(detail);
  }

  async revealShortcut(backpackId: string, shortcutId: string): Promise<void> {
    const target = await this.shortcutTarget(backpackId, shortcutId);
    try {
      await fs.access(target);
    } catch {
      throw new Error('That shortcut target is unavailable on this machine.');
    }
    if (!this.revealTarget) throw new Error('Revealing a Backpack project shortcut is unavailable.');
    await this.revealTarget(target);
  }

  async resolveWebLinkIcon(backpackId: string, url: string): Promise<{ icon: string | null; finalUrl: string; finalOrigin: string; title: string | null }> {
    parseBackpackProjectWebUrl(url);
    await this.manifest(backpackId);
    return resolveWebLinkIcon(url);
  }
}
