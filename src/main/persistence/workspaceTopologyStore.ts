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

/** Durable snapshots only. Loading never opens projects or resurrects a
 * persisted surface id; v1 lifetime keys migrate to fresh durable IDs. */
export class WorkspaceTopologyStore {
  private readonly store: AtomicJsonStore;
  private readonly workspaces = new Map<string, DurableRecord>();
  private lastWorkspaceId: string | null = null;
  private initialized: Promise<void> | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;

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
    await this.initialize();
    this.workspaces.set(workspaceId, {
      workspaceId, topology: parseWorkspaceTopology(topology), updatedAt: this.now(),
    });
    this.lastWorkspaceId = workspaceId;
    this.dirty = true;
    if (!this.writing) this.writing = this.drain().finally(() => { this.writing = null; });
    await this.writing;
  }

  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (this.dirty) {
      this.writing = this.drain().finally(() => { this.writing = null; });
      await this.writing;
    }
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      await this.store.save({ schemaVersion: 2, lastWorkspaceId: this.lastWorkspaceId, workspaces: [...this.workspaces.values()] });
    }
  }
}
