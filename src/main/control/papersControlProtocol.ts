import { z } from 'zod';

export const PAPERS_CONTROL_PROTOCOL_VERSION = 1;

const emptyParamsSchema = z.object({}).strict().default({});

export const papersControlCommands = {
  'inspect.snapshot': { input: emptyParamsSchema },
  'inspect.windows': { input: emptyParamsSchema },
  'window.create': { input: emptyParamsSchema },
} as const;

export type PapersControlMethod = keyof typeof papersControlCommands;

export interface PapersControlDependencies {
  snapshot(): unknown;
  windows(): unknown;
  createWindow(): Promise<unknown>;
}

const methodSchema = z.enum(['inspect.snapshot', 'inspect.windows', 'window.create']);

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
    case 'inspect.snapshot': return dependencies.snapshot();
    case 'inspect.windows': return dependencies.windows();
    case 'window.create': return dependencies.createWindow();
  }
}
