/**
 * ResourceService — per-Backpack registry of granted external resources
 * (repositories, worktrees, artifacts). A program can only touch a resource
 * that was explicitly registered and granted to it.
 * Registering never copies the resource into Papers data.
 */
import { randomUUID } from 'node:crypto';

import { AtomicJsonStore } from '../persistence/atomicStore';
import { resourcesFile, type PapersPaths } from '../persistence/paths';

export type ResourceType = 'git-repository' | 'git-worktree' | 'artifact';

export interface ResourceEntry {
  id: string;
  type: ResourceType;
  name: string;
  path: string;
  addedAt: string;
  /** Program ids granted read access. */
  grants: string[];
  meta: Record<string, unknown>;
}

interface ResourcesState {
  schemaVersion: 1;
  resources: ResourceEntry[];
}

function validateResources(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return `unsupported schemaVersion ${String(v.schemaVersion)}`;
  if (!Array.isArray(v.resources)) return 'resources is not an array';
  return null;
}

export class ResourceService {
  private readonly stores = new Map<string, AtomicJsonStore>();
  private readonly cache = new Map<string, ResourcesState>();

  constructor(private readonly paths: PapersPaths) {}

  private storeFor(backpackId: string): AtomicJsonStore {
    let store = this.stores.get(backpackId);
    if (!store) {
      store = new AtomicJsonStore(resourcesFile(this.paths, backpackId), {
        recoveryDir: this.paths.recoveryDir,
        validate: validateResources,
      });
      this.stores.set(backpackId, store);
    }
    return store;
  }

  private async stateFor(backpackId: string): Promise<ResourcesState> {
    const cached = this.cache.get(backpackId);
    if (cached) return cached;
    const report = await this.storeFor(backpackId).load<ResourcesState>();
    const state = report.value ?? { schemaVersion: 1 as const, resources: [] };
    this.cache.set(backpackId, state);
    return state;
  }

  private async persist(backpackId: string): Promise<void> {
    const state = this.cache.get(backpackId);
    if (state) await this.storeFor(backpackId).save(state);
  }

  async register(
    backpackId: string,
    entry: Omit<ResourceEntry, 'id' | 'addedAt'>,
  ): Promise<ResourceEntry> {
    const state = await this.stateFor(backpackId);
    const existing = state.resources.find(
      (r) => r.type === entry.type && r.path.toLowerCase() === entry.path.toLowerCase(),
    );
    if (existing) {
      // Re-registering grants access to the requesting program(s).
      for (const grant of entry.grants) {
        if (!existing.grants.includes(grant)) existing.grants.push(grant);
      }
      await this.persist(backpackId);
      return { ...existing };
    }
    const full: ResourceEntry = {
      ...entry,
      id: `res-${randomUUID()}`,
      addedAt: new Date().toISOString(),
    };
    state.resources.push(full);
    await this.persist(backpackId);
    return { ...full };
  }

  async listGranted(backpackId: string, programId: string): Promise<ResourceEntry[]> {
    const state = await this.stateFor(backpackId);
    return state.resources.filter((r) => r.grants.includes(programId)).map((r) => ({ ...r }));
  }

  /** Resolve a resource the program has been granted, or throw. */
  async requireGranted(
    backpackId: string,
    programId: string,
    resourceId: string,
  ): Promise<ResourceEntry> {
    const state = await this.stateFor(backpackId);
    const entry = state.resources.find((r) => r.id === resourceId);
    if (!entry) throw new Error(`resource ${resourceId} does not exist`);
    if (!entry.grants.includes(programId)) {
      throw new Error(`program ${programId} has no grant for resource ${resourceId}`);
    }
    return { ...entry };
  }

  async remove(backpackId: string, resourceId: string): Promise<void> {
    const state = await this.stateFor(backpackId);
    state.resources = state.resources.filter((r) => r.id !== resourceId);
    await this.persist(backpackId);
  }
}
