import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  parseWorkspaceTopology,
  validatedWorkspaceTopologySchema,
  type WorkspaceTopologyV1,
} from '@shared/workspaceTopology';
import { AtomicJsonStore, type LoadReport } from './atomicStore';
import type { PapersPaths } from './paths';

const MAX_LAYOUT_NAME_LENGTH = 120;

const namedLayoutSchema = z.object({
  layoutId: z.string().uuid(),
  name: z.string().min(1).max(MAX_LAYOUT_NAME_LENGTH),
  topology: validatedWorkspaceTopologySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  layouts: z.array(namedLayoutSchema),
}).strict().superRefine((value, context) => {
  const ids = value.layouts.map((layout) => layout.layoutId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'named layout ids must be unique' });
  }
  const names = value.layouts.map((layout) => normalizeLayoutName(layout.name));
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'named layout names must be unique after normalization' });
  }
  value.layouts.forEach((layout, index) => {
    if (layout.name !== layout.name.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['layouts', index, 'name'], message: 'layout names must be trimmed' });
    }
  });
});

export interface NamedWorkspaceLayout {
  layoutId: string;
  name: string;
  topology: WorkspaceTopologyV1;
  createdAt: string;
  updatedAt: string;
}

interface LayoutPersistence {
  load<T>(): Promise<LoadReport<T>>;
  save(value: unknown): Promise<void>;
}

function normalizeLayoutName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function cloneLayout(layout: NamedWorkspaceLayout): NamedWorkspaceLayout {
  return structuredClone(layout);
}

/** App-level reusable layout templates. Runtime workspace identity, native
 * identity, URLs and Dockview state deliberately never enter this store. */
export class WorkspaceLayoutStore {
  private readonly store: LayoutPersistence;
  private readonly layouts = new Map<string, NamedWorkspaceLayout>();
  private initialized: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    paths: PapersPaths,
    private readonly now = () => new Date().toISOString(),
    persistence?: LayoutPersistence,
  ) {
    this.store = persistence ?? new AtomicJsonStore(paths.workspaceLayoutsFile, {
      recoveryDir: paths.recoveryDir,
      validate: (value) => {
        const result = envelopeSchema.safeParse(value);
        return result.success ? null : result.error.message;
      },
    });
  }

  initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.store.load<z.infer<typeof envelopeSchema>>().then((report) => {
        if (!report.value) return;
        for (const layout of report.value.layouts) this.layouts.set(layout.layoutId, cloneLayout(layout));
      });
    }
    return this.initialized;
  }

  async list(): Promise<ReadonlyArray<NamedWorkspaceLayout>> {
    await this.initialize();
    return [...this.layouts.values()].map(cloneLayout);
  }

  async get(layoutId: string): Promise<NamedWorkspaceLayout | null> {
    await this.initialize();
    const layout = this.layouts.get(layoutId);
    return layout ? cloneLayout(layout) : null;
  }

  /** Create-only named layout persistence. Memory is updated only after the
   * atomic durable write succeeds, so failed saves cannot create phantoms. */
  create(name: string, topology: WorkspaceTopologyV1): Promise<NamedWorkspaceLayout> {
    return this.enqueue(async () => {
      await this.initialize();
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new Error('Layout name must not be empty.');
      if (trimmed.length > MAX_LAYOUT_NAME_LENGTH) throw new Error('Layout name is too long.');
      const normalized = normalizeLayoutName(trimmed);
      if ([...this.layouts.values()].some((layout) => normalizeLayoutName(layout.name) === normalized)) {
        throw new Error(`A layout named "${trimmed}" already exists.`);
      }
      const parsedTopology = parseWorkspaceTopology(topology);
      const timestamp = this.now();
      const layout: NamedWorkspaceLayout = {
        layoutId: randomUUID(),
        name: trimmed,
        topology: parsedTopology,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const next = [...this.layouts.values(), layout];
      await this.store.save({ schemaVersion: 1, layouts: next });
      this.layouts.set(layout.layoutId, cloneLayout(layout));
      return cloneLayout(layout);
    });
  }

  async flush(): Promise<void> {
    await this.initialize();
    await this.mutationTail;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
