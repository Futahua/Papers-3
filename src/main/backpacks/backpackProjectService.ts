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

interface ProjectManifest {
  backpackId: string;
  entry: string;
  root: string;
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
  | { ok: false; code: 'STALE_REVISION'; revision: BackpackProjectStateRevision };

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

const backpackIdPattern =
  /^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  private readonly stateSaveQueues = new Map<string, Promise<SaveStateResult>>();

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
      return { backpackId, entry, root: binding.root };
    } catch (error) {
      if (error instanceof Error && /does not match|outside|not public/.test(error.message)) {
        throw error;
      }
      throw new Error('Backpack project could not be read.');
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
  async loadState(backpackId: string): Promise<BackpackProjectState | null> {
    return (await this.loadStateVersioned(backpackId)).state;
  }

  /**
   * The same load, plus the revision the caller must present to save without
   * overwriting somebody else. A seeded default carries ABSENT_STATE_REVISION,
   * so the first save still has something exact to compare against.
   */
  async loadStateVersioned(backpackId: string): Promise<LoadedBackpackProjectState> {
    const manifest = await this.manifest(backpackId);
    if (!manifest) throw new Error('Backpack project is not bound on this machine.');
    while (true) {
      const pending = this.stateSaveQueues.get(backpackId);
      if (!pending) break;
      await pending.catch(() => undefined);
      if (this.stateSaveQueues.get(backpackId) === pending) break;
    }
    const statePath = path.join(manifest.root, 'state.json');
    let bytes: string;
    try {
      bytes = await fs.readFile(statePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Backpack project state could not be read.');
      const actions = await this.actions(backpackId);
      return {
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
    return { state: parsed, revision: revisionOfBytes(bytes) };
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
  ): Promise<SaveStateResult> {
    const previous = this.stateSaveQueues.get(backpackId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.saveStateNow(backpackId, rawState, expectedRevision));
    this.stateSaveQueues.set(backpackId, operation);
    try {
      return await operation;
    } finally {
      if (this.stateSaveQueues.get(backpackId) === operation) {
        this.stateSaveQueues.delete(backpackId);
      }
    }
  }

  private async saveStateNow(
    backpackId: string,
    rawState: string,
    expectedRevision?: BackpackProjectStateRevision,
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
    if (expectedRevision !== undefined) {
      const current = await this.currentRevision(manifest.root);
      if (current !== expectedRevision) return { ok: false, code: 'STALE_REVISION', revision: current };
    }
    const statePath = path.join(manifest.root, 'state.json');
    const tempPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
    const bytes = JSON.stringify(parsed, null, 2) + '\n';
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
