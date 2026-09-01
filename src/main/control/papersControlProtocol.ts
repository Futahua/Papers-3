import { z } from 'zod';
import { workspaceTopologySchema } from '@shared/workspaceTopology';

export const PAPERS_CONTROL_PROTOCOL_VERSION = 1;

const emptyParamsSchema = z.object({}).strict().default({});

const safeBuildSchema = z.object({
  version: z.string(),
  commit: z.string(),
  branch: z.string(),
  builtAt: z.string(),
  packaged: z.boolean(),
}).strict();

const surfaceKindSchema = z.enum(['host', 'project', 'detached', 'widget']);
const surfacePresentationSchema = z.enum(['not-created', 'hidden', 'visible']);

/** The logical projection: identity, ownership and safe presentation state.
 * No sender ids, URLs, roots or layout keys -- a layout key is project-defined
 * opaque data and is not disclosed by default. */
const controlSurfaceSchema = z.object({
  surfaceId: z.string(),
  windowId: z.number().int(),
  projectId: z.string(),
  kind: surfaceKindSchema,
  presentation: surfacePresentationSchema,
}).strict();

/** A target names both, and both must agree with live state. */
const surfaceTargetSchema = z.object({
  windowId: z.number().int(),
  surfaceId: z.string().min(1).max(128),
}).strict();
const windowTargetSchema = z.object({ windowId: z.number().int() }).strict();

const controlWindowSchema = z.object({
  windowId: z.number().int(),
  hostAlive: z.boolean(),
  nativeWindowAlive: z.boolean(),
  enteredBackpackId: z.string().nullable(),
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  build: safeBuildSchema,
  windows: z.array(controlWindowSchema),
  // No `detail`. HermesSurface.detail is UI-facing human text and carries
  // machine-local absolute paths -- the missing-Hermes message lists every
  // location it searched. Forwarding it would disclose exactly the roots this
  // boundary promises to withhold. A safe error code can be added later if
  // programmatic diagnostics need one; UI prose is not that.
  hermes: z.object({
    placement: z.enum(['closed', 'docked', 'detached']),
    status: z.enum(['idle', 'starting', 'ready', 'error']),
    ownerWindowId: z.number().int().nullable(),
  }).strict(),
}).strict();

export const papersControlCommands = {
  'inspect.snapshot': { input: emptyParamsSchema, output: snapshotSchema, scope: 'app', effect: 'query' },
  'inspect.windows': { input: emptyParamsSchema, output: z.array(controlWindowSchema), scope: 'app', effect: 'query' },
  'inspect.surfaces': {
    input: emptyParamsSchema,
    output: z.array(controlSurfaceSchema),
    scope: 'app',
    effect: 'query',
  },
  'inspect.surface': {
    input: surfaceTargetSchema,
    output: controlSurfaceSchema,
    scope: 'surface',
    effect: 'query',
  },
  'inspect.workspace': {
    input: windowTargetSchema,
    output: z.object({ windowId: z.number().int(), revision: z.number().int().nonnegative(), topology: workspaceTopologySchema }).strict(),
    scope: 'window',
    effect: 'query',
  },
  'layout.restore': {
    input: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'window',
    effect: 'mutate',
  },
  'window.create': {
    input: emptyParamsSchema,
    output: z.object({ windowId: z.number().int() }).strict(),
    scope: 'app',
    effect: 'mutate',
  },
} as const;

export type PapersControlMethod = keyof typeof papersControlCommands;

export interface PapersControlDependencies {
  /** Every live logical surface, projected. */
  surfaces(): unknown;
  /**
   * The one surface a target names, or null.
   *
   * Refuses rather than resolving anything near it: a surface that exists in
   * another window is not this target, and there is no falling back to "the
   * window's only surface". Control authority is the authenticated session
   * plus explicit targets -- it never obtains or manufactures a sender id to
   * reuse sender-based authorization.
   */
  surface(target: { windowId: number; surfaceId: string }): unknown;
  workspace?(windowId: number): unknown;
  restoreWorkspace?(windowId: number, topology: z.infer<typeof workspaceTopologySchema>): unknown;
  snapshot(): unknown;
  windows(): unknown;
  createWindow(): Promise<unknown>;
}

const methodNames = Object.keys(papersControlCommands) as [PapersControlMethod, ...PapersControlMethod[]];
const methodSchema = z.enum(methodNames);

export const controlRequestSchema = z.object({
  id: z.union([z.string().min(1).max(128), z.number().int()]),
  token: z.string().min(1).max(512),
  protocolVersion: z.literal(PAPERS_CONTROL_PROTOCOL_VERSION),
  method: methodSchema,
  params: z.unknown().optional(),
}).strict();

export type PapersControlRequest = z.infer<typeof controlRequestSchema>;

/** Dispatch semantic commands without inventing a renderer sender identity.
 * Transport authentication happens before this boundary; every target-bearing
 * command added later must resolve explicit window/surface ids here. */
export async function dispatchPapersControl(
  dependencies: PapersControlDependencies,
  request: PapersControlRequest,
): Promise<unknown> {
  const definition = papersControlCommands[request.method];
  definition.input.parse(request.params ?? {});
  switch (request.method) {
    case 'inspect.surfaces': return papersControlCommands[request.method].output.parse(dependencies.surfaces());
    case 'inspect.surface': {
      const target = papersControlCommands[request.method].input.parse(request.params ?? {});
      const found = dependencies.surface(target);
      if (!found) throw new Error('That surface is not open in that Papers window.');
      return papersControlCommands[request.method].output.parse(found);
    }
    case 'inspect.workspace': {
      const { windowId } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const workspace = dependencies.workspace?.(windowId) ?? null;
      if (!workspace) throw new Error('That Papers window has not committed workspace topology.');
      return papersControlCommands[request.method].output.parse({ windowId, ...(workspace as object) });
    }
    case 'layout.restore': {
      const { windowId, topology } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const restored = dependencies.restoreWorkspace?.(windowId, topology);
      if (!restored) throw new Error('That Papers window cannot restore workspace topology.');
      return papersControlCommands[request.method].output.parse({ windowId, topology: restored });
    }
    case 'inspect.snapshot': return papersControlCommands[request.method].output.parse(dependencies.snapshot());
    case 'inspect.windows': return papersControlCommands[request.method].output.parse(dependencies.windows());
    case 'window.create': return papersControlCommands[request.method].output.parse(await dependencies.createWindow());
  }
}
