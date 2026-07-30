/**
 * Minimal host seam for independently maintained Backpack projects.
 *
 * Papers owns only a machine-local binding, static-project loading and action
 * mediation. Project HTML, labels, prompts and behavior stay outside app.asar.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const BACKPACK_PROJECT_SCHEME = 'papers-backpack';

export interface OpenBackpackProject {
  url: string;
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

const backpackIdPattern =
  /^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const publicDirectory = 'public';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  constructor(
    private readonly bindingsFile: string,
    private readonly openTarget?: (target: string) => Promise<string>,
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
    projectUrl.pathname = manifest.entry.replace(/\\/g, '/');
    return {
      url: projectUrl.toString(),
    };
  }

  async resolveAsset(backpackId: string, requestPath: string): Promise<string> {
    const manifest = await this.manifest(backpackId);
    if (!manifest) throw new Error('Backpack project is not bound on this machine.');
    const relative = decodeURIComponent(requestPath).replace(/^\/+/, '') || manifest.entry;
    const normalized = relative.replace(/\\/g, '/');
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
}
