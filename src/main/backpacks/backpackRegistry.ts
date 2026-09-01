/**
 * BackpackRegistry — owns Backpack identity, creation, rename, archive,
 * enter/leave bookkeeping, and last-active restoration.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { BackpackRegistryState, BackpackSummary, BackpackType } from '@shared/types';
import { AtomicJsonStore, type LoadReport } from '../persistence/atomicStore';
import { papersPaths, backpackDir, backpackFile, type PapersPaths } from '../persistence/paths';

const emptyState: BackpackRegistryState = {
  schemaVersion: 1,
  backpacks: [],
  lastActiveBackpackId: null,
};

const generatedBackpackId = /^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateRegistry(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return `unsupported schemaVersion ${String(v.schemaVersion)}`;
  if (!Array.isArray(v.backpacks)) return 'backpacks is not an array';
  for (const b of v.backpacks) {
    if (typeof b !== 'object' || b === null) return 'backpack entry is not an object';
    const e = b as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.name !== 'string') return 'backpack entry missing id/name';
  }
  return null;
}

export class BackpackRegistry {
  private readonly store: AtomicJsonStore;
  private readonly paths: PapersPaths;
  private state: BackpackRegistryState = structuredClone(emptyState);
  private lastLoadReport: LoadReport<BackpackRegistryState> | null = null;

  constructor(baseDir: string) {
    this.paths = papersPaths(baseDir);
    this.store = new AtomicJsonStore(this.paths.registryFile, {
      recoveryDir: this.paths.recoveryDir,
      validate: validateRegistry,
    });
  }

  async initialize(): Promise<LoadReport<BackpackRegistryState>> {
    const report = await this.store.load<BackpackRegistryState>();
    this.lastLoadReport = report;
    this.state = report.value ?? structuredClone(emptyState);
    // Schema v1 predates machine-wide environments and workspace association.
    // Keep old creator data readable without a destructive migration.
    this.state.backpacks = this.state.backpacks.map((backpack) => ({
      ...backpack,
      workspacePath: typeof backpack.workspacePath === 'string' ? backpack.workspacePath : null,
    }));
    return report;
  }

  get loadReport(): LoadReport<BackpackRegistryState> | null {
    return this.lastLoadReport;
  }

  list(): BackpackSummary[] {
    return this.state.backpacks.map((b) => ({ ...b }));
  }

  get lastActiveBackpackId(): string | null {
    return this.state.lastActiveBackpackId;
  }

  find(id: string): BackpackSummary | null {
    const found = this.state.backpacks.find((b) => b.id === id);
    return found ? { ...found } : null;
  }

  private async persist(): Promise<void> {
    await this.store.save(this.state);
  }

  async create(name: string, type: BackpackType): Promise<BackpackSummary> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Backpack name must not be empty');
    const summary: BackpackSummary = {
      id: `bp-${randomUUID()}`,
      name: trimmed,
      type,
      createdAt: new Date().toISOString(),
      lastEnteredAt: null,
      archived: false,
      workspacePath: null,
    };
    this.state.backpacks.push(summary);
    await fs.mkdir(backpackDir(this.paths, summary.id), { recursive: true });
    const file = new AtomicJsonStore(backpackFile(this.paths, summary.id), {
      recoveryDir: this.paths.recoveryDir,
    });
    await file.save({ schemaVersion: 1, ...summary });
    await this.persist();
    return { ...summary };
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Backpack name must not be empty');
    const entry = this.state.backpacks.find((b) => b.id === id);
    if (!entry) throw new Error(`Backpack ${id} not found`);
    entry.name = trimmed;
    await this.persist();
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const entry = this.state.backpacks.find((b) => b.id === id);
    if (!entry) throw new Error(`Backpack ${id} not found`);
    entry.archived = archived;
    if (archived && this.state.lastActiveBackpackId === id) {
      this.state.lastActiveBackpackId = null;
    }
    await this.persist();
  }

  /**
   * Remove an archived Backpack from Papers while preserving its internal
   * record under recovery. External files and applications are never touched.
   */
  async remove(id: string): Promise<void> {
    if (!generatedBackpackId.test(id)) throw new Error('Invalid Backpack id');
    const index = this.state.backpacks.findIndex((backpack) => backpack.id === id);
    if (index === -1) throw new Error(`Backpack ${id} not found`);
    const entry = this.state.backpacks[index]!;
    if (!entry.archived) throw new Error('Archive the Backpack before deleting it');

    const source = backpackDir(this.paths, id);
    const deletedRoot = path.join(this.paths.recoveryDir, 'deleted-backpacks');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preserved = path.join(deletedRoot, `${id}-${stamp}-${randomUUID()}`);
    let moved = false;

    await fs.mkdir(deletedRoot, { recursive: true });
    try {
      await fs.rename(source, preserved);
      moved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const previousActive = this.state.lastActiveBackpackId;
    this.state.backpacks.splice(index, 1);
    if (previousActive === id) this.state.lastActiveBackpackId = null;

    try {
      await this.persist();
    } catch (error) {
      this.state.backpacks.splice(index, 0, entry);
      this.state.lastActiveBackpackId = previousActive;
      if (moved) await fs.rename(preserved, source);
      throw error;
    }
  }

  async setWorkspace(id: string, workspacePath: string | null): Promise<void> {
    const entry = this.state.backpacks.find((b) => b.id === id);
    if (!entry) throw new Error(`Backpack ${id} not found`);
    entry.workspacePath = workspacePath;
    await this.persist();
  }

  async markEntered(id: string): Promise<void> {
    const entry = this.state.backpacks.find((b) => b.id === id);
    if (!entry) throw new Error(`Backpack ${id} not found`);
    if (entry.archived) throw new Error(`Backpack ${id} is archived`);
    entry.lastEnteredAt = new Date().toISOString();
    this.state.lastActiveBackpackId = id;
    await this.persist();
  }

  /**
   * Deliberately no longer clears `lastActiveBackpackId`.
   *
   * That field is an application-level most-recent record, and one window
   * leaving its Backpack says nothing about it -- another window may still be
   * living in one. Clearing it here would erase a fact that is not this
   * window's to erase. Kept as a no-op so the call sites and their meaning
   * stay visible rather than silently disappearing.
   */
  async markLeft(): Promise<void> {
    // Intentionally empty: see above.
  }
}
