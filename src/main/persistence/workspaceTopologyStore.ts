import { z } from 'zod';

import { workspaceTopologySchema, type WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { AtomicJsonStore } from './atomicStore';
import type { PapersPaths } from './paths';

const persistedWorkspaceTopologiesSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(z.object({
    workspaceKey: z.string().uuid(),
    topology: workspaceTopologySchema,
  }).strict()),
}).strict();

type PersistedWorkspaceTopologies = z.infer<typeof persistedWorkspaceTopologiesSchema>;

/** Serialized/coalesced durable writes. Persisted surface ids are snapshots
 * only until restart identity mapping is explicitly designed. */
export class WorkspaceTopologyStore {
  private readonly store: AtomicJsonStore;
  private readonly topologies = new Map<string, WorkspaceTopologyV1>();
  private initialized: Promise<void> | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;

  constructor(paths: PapersPaths) {
    this.store = new AtomicJsonStore(paths.workspaceTopologiesFile, {
      recoveryDir: paths.recoveryDir,
      validate: (value) => {
        const result = persistedWorkspaceTopologiesSchema.safeParse(value);
        return result.success ? null : result.error.message;
      },
    });
  }

  initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.store.load<PersistedWorkspaceTopologies>().then((report) => {
        for (const entry of report.value?.workspaces ?? []) {
          this.topologies.set(entry.workspaceKey, entry.topology);
        }
      });
    }
    return this.initialized;
  }

  async commit(workspaceKey: string, topology: WorkspaceTopologyV1): Promise<void> {
    await this.initialize();
    this.topologies.set(workspaceKey, topology);
    this.dirty = true;
    if (!this.writing) this.writing = this.drain().finally(() => { this.writing = null; });
    await this.writing;
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      await this.store.save({
        schemaVersion: 1,
        workspaces: [...this.topologies].map(([workspaceKey, topology]) => ({ workspaceKey, topology })),
      });
    }
  }
}
