import { z } from 'zod';

export const PAPERS_CONTROL_PROTOCOL_VERSION = 1;

const emptyParamsSchema = z.object({}).strict().default({});

const safeBuildSchema = z.object({
  version: z.string(),
  commit: z.string(),
  branch: z.string(),
  builtAt: z.string(),
  packaged: z.boolean(),
}).strict();

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
  'window.create': {
    input: emptyParamsSchema,
    output: z.object({ windowId: z.number().int() }).strict(),
    scope: 'app',
    effect: 'mutate',
  },
} as const;

export type PapersControlMethod = keyof typeof papersControlCommands;

export interface PapersControlDependencies {
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
    case 'inspect.snapshot': return papersControlCommands[request.method].output.parse(dependencies.snapshot());
    case 'inspect.windows': return papersControlCommands[request.method].output.parse(dependencies.windows());
    case 'window.create': return papersControlCommands[request.method].output.parse(await dependencies.createWindow());
  }
}
