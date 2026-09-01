import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { parseWorkspaceTopology, validatedWorkspaceTopologySchema, type WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { AtomicJsonStore } from './atomicStore';
import type { PapersPaths } from './paths';

const legacySchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(z.object({ workspaceKey: z.string().uuid(), topology: validatedWorkspaceTopologySchema }).strict()),
}).strict().superRefine((value, context) => {
  const keys = value.workspaces.map((entry) => entry.workspaceKey);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'legacy workspace keys must be unique' });
  }
});
const durableSchema = z.object({
  schemaVersion: z.literal(2),
  lastWorkspaceId: z.string().uuid().nullable(),
  workspaces: z.array(z.object({
    workspaceId: z.string().uuid(), topology: validatedWorkspaceTopologySchema, updatedAt: z.string().datetime(),
  }).strict()),
}).strict().superRefine((value, context) => {
  const ids = value.workspaces.map((entry) => entry.workspaceId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'durable workspace ids must be unique' });
  }
  if (value.lastWorkspaceId !== null && !idSet.has(value.lastWorkspaceId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'lastWorkspaceId must reference an existing workspace' });
  }
});
const readableSchema = z.union([legacySchema, durableSchema]);
type DurableRecord = z.infer<typeof durableSchema>['workspaces'][number];
export type SelectedWorkspaceSnapshot = Readonly<DurableRecord>;

export interface WorkspacePairCommit {
  source: { workspaceId: string; topology: WorkspaceTopologyV1 };
  target: { workspaceId: string; topology: WorkspaceTopologyV1 };
  /** Cross-window moves must not change startup selection as a side effect. */
  lastWorkspaceId: string | null;
}

export interface WorkspacePairSnapshot {
  source: DurableRecord | null;
  target: DurableRecord | null;
  lastWorkspaceId: string | null;
}

/** Durable snapshots only. Loading never opens projects or resurrects a
 * persisted surface id; v1 lifetime keys migrate to fresh durable IDs. */
export class WorkspaceTopologyStore {
  private readonly store: AtomicJsonStore;
  private readonly workspaces = new Map<string, DurableRecord>();
  private lastWorkspaceId: string | null = null;
  private initialized: Promise<void> | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;
  private mutationTail: Promise<void> = Promise.resolve();

  /** Serialize state mutation as well as the resulting file save. Sharing
   * only `writing` is insufficient: a queued ordinary commit could otherwise
   * mutate the in-memory map while a pair save is awaiting disk. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  constructor(paths: PapersPaths, private readonly now = () => new Date().toISOString()) {
    this.store = new AtomicJsonStore(paths.workspaceTopologiesFile, {
      recoveryDir: paths.recoveryDir,
      validate: (value) => {
        const result = readableSchema.safeParse(value);
        return result.success ? null : result.error.message;
      },
    });
  }

  initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.store.load<z.infer<typeof readableSchema>>().then(async (report) => {
        const value = report.value;
        if (!value) return;
        if (value.schemaVersion === 2) {
          this.lastWorkspaceId = value.lastWorkspaceId;
          for (const entry of value.workspaces) this.workspaces.set(entry.workspaceId, entry);
          return;
        }
        let soleMigratedId: string | null = null;
        for (const entry of value.workspaces) {
          const workspaceId = randomUUID();
          this.workspaces.set(workspaceId, { workspaceId, topology: entry.topology, updatedAt: this.now() });
          soleMigratedId = workspaceId;
        }
        this.lastWorkspaceId = value.workspaces.length === 1 ? soleMigratedId : null;
        this.dirty = true;
        await this.flush();
      });
    }
    return this.initialized;
  }

  async commit(workspaceId: string, topology: WorkspaceTopologyV1): Promise<void> {
    return this.enqueue(async () => {
      await this.initialize();
      this.workspaces.set(workspaceId, {
        workspaceId, topology: parseWorkspaceTopology(topology), updatedAt: this.now(),
      });
      this.lastWorkspaceId = workspaceId;
      await this.persistDirty();
    });
  }

  /**
   * Replace two workspace records in one durable JSON save. A cross-window
   * move must never persist its source and target as two independently visible
   * writes, because a process death between ordinary commits would leave a
   * half-move on disk.
   */
  async commitPair(pair: WorkspacePairCommit): Promise<void> {
    if (pair.source.workspaceId === pair.target.workspaceId) {
      throw new Error('workspace pair must name two distinct workspaces');
    }
    return this.enqueue(async () => {
      await this.initialize();
      const sourceTopology = parseWorkspaceTopology(pair.source.topology);
      const targetTopology = parseWorkspaceTopology(pair.target.topology);
      if (pair.lastWorkspaceId !== null
        && pair.lastWorkspaceId !== pair.source.workspaceId
        && pair.lastWorkspaceId !== pair.target.workspaceId
        && !this.workspaces.has(pair.lastWorkspaceId)) {
        throw new Error('lastWorkspaceId must reference an existing workspace');
      }
      const previousSource = this.workspaces.get(pair.source.workspaceId);
      const previousTarget = this.workspaces.get(pair.target.workspaceId);
      const previousLastWorkspaceId = this.lastWorkspaceId;
      const previousDirty = this.dirty;
      this.workspaces.set(pair.source.workspaceId, {
        workspaceId: pair.source.workspaceId,
        topology: sourceTopology,
        updatedAt: this.now(),
      });
      this.workspaces.set(pair.target.workspaceId, {
        workspaceId: pair.target.workspaceId,
        topology: targetTopology,
        updatedAt: this.now(),
      });
      this.lastWorkspaceId = pair.lastWorkspaceId;
      try {
        await this.persistDirty();
      } catch (error) {
        if (previousSource) this.workspaces.set(pair.source.workspaceId, previousSource);
        else this.workspaces.delete(pair.source.workspaceId);
        if (previousTarget) this.workspaces.set(pair.target.workspaceId, previousTarget);
        else this.workspaces.delete(pair.target.workspaceId);
        this.lastWorkspaceId = previousLastWorkspaceId;
        this.dirty = previousDirty;
        throw error;
      }
    });
  }

  /** Capture the exact records needed to compensate a pair transaction. */
  async snapshotPair(sourceWorkspaceId: string, targetWorkspaceId: string): Promise<WorkspacePairSnapshot> {
    if (sourceWorkspaceId === targetWorkspaceId) throw new Error('workspace pair must name two distinct workspaces');
    return this.enqueue(async () => {
      await this.initialize();
      const clone = (record: DurableRecord | undefined): DurableRecord | null => record ? structuredClone(record) : null;
      return {
        source: clone(this.workspaces.get(sourceWorkspaceId)),
        target: clone(this.workspaces.get(targetWorkspaceId)),
        lastWorkspaceId: this.lastWorkspaceId,
      };
    });
  }

  /** Restore a pair when one side was absent and its ID therefore needs to be
   * supplied explicitly for deletion. */
  async restorePairWithIds(
    snapshot: WorkspacePairSnapshot,
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
  ): Promise<void> {
    if (sourceWorkspaceId === targetWorkspaceId) throw new Error('workspace pair must name two distinct workspaces');
    if (snapshot.source && snapshot.source.workspaceId !== sourceWorkspaceId) {
      throw new Error('workspace pair source snapshot does not match its identity');
    }
    if (snapshot.target && snapshot.target.workspaceId !== targetWorkspaceId) {
      throw new Error('workspace pair target snapshot does not match its identity');
    }
    return this.enqueue(async () => {
      await this.initialize();
      const currentSource = this.workspaces.get(sourceWorkspaceId);
      const currentTarget = this.workspaces.get(targetWorkspaceId);
      const currentLastWorkspaceId = this.lastWorkspaceId;
      const currentDirty = this.dirty;
      const apply = (record: DurableRecord | null, id: string): void => {
        if (record) this.workspaces.set(record.workspaceId, structuredClone(record));
        else this.workspaces.delete(id);
      };
      apply(snapshot.source, sourceWorkspaceId);
      apply(snapshot.target, targetWorkspaceId);
      this.lastWorkspaceId = snapshot.lastWorkspaceId;
      try {
        await this.persistDirty();
      } catch (error) {
        if (currentSource) this.workspaces.set(sourceWorkspaceId, currentSource);
        else this.workspaces.delete(sourceWorkspaceId);
        if (currentTarget) this.workspaces.set(targetWorkspaceId, currentTarget);
        else this.workspaces.delete(targetWorkspaceId);
        this.lastWorkspaceId = currentLastWorkspaceId;
        this.dirty = currentDirty;
        throw error;
      }
    });
  }

  /** Read-only startup selection. Does not reorder, consume or persist. */
  async selectedSnapshot(): Promise<SelectedWorkspaceSnapshot | null> {
    await this.initialize();
    if (!this.lastWorkspaceId) return null;
    const selected = this.workspaces.get(this.lastWorkspaceId);
    return selected ? structuredClone(selected) : null;
  }

  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (this.dirty) {
      this.writing = this.drain().finally(() => { this.writing = null; });
      await this.writing;
    }
  }

  private async persistDirty(): Promise<void> {
    this.dirty = true;
    if (!this.writing) this.writing = this.drain().finally(() => { this.writing = null; });
    await this.writing;
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      await this.store.save({ schemaVersion: 2, lastWorkspaceId: this.lastWorkspaceId, workspaces: [...this.workspaces.values()] });
    }
  }
}
