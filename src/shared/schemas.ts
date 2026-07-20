/**
 * Zod schemas validating every payload that crosses a privileged boundary.
 * Validation happens in the main process even for first-party renderers.
 */
import { z } from 'zod';

const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const programIdSchema = z.string().regex(idPattern, 'invalid program id');
export const backpackIdSchema = z.string().regex(idPattern, 'invalid backpack id');

export const capabilityNames = [
  'storage.read-own',
  'storage.write-own',
  'resources.read-granted',
  'resources.create',
  'resources.register',
  'clipboard.write',
  'external.open',
  'external.launch-approved',
  'agent.invoke',
  'agent.cancel-own',
  'program.read-shared-summary',
] as const;

export const capabilitySchema = z.enum(capabilityNames);
export type CapabilityName = (typeof capabilityNames)[number];

export const programManifestSchema = z
  .object({
    id: programIdSchema,
    name: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    apiVersion: z.literal(1),
    entry: z
      .string()
      .min(1)
      .max(260)
      .refine(
        (v) => !v.includes('..') && !v.startsWith('/') && !/^[a-zA-Z]:/.test(v),
        'entry must be a relative path without traversal',
      ),
    stateSchemaVersion: z.number().int().min(1),
    capabilities: z.array(capabilitySchema).max(32),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

export const capabilityRequestSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
    backpackId: backpackIdSchema,
    programId: programIdSchema,
    capability: capabilitySchema,
    arguments: z.unknown(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const programReferenceSchema = z
  .object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(512),
    detail: z.unknown().optional(),
  })
  .strict();

export const sharedMaterialItemSchema = z
  .object({
    reference: programReferenceSchema,
    title: z.string().min(1).max(300),
    mediaType: z.string().min(1).max(100),
    preview: z.string().max(2_000),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    content: z.string().max(512_000).optional(),
    truncated: z.boolean().optional(),
    originalByteLength: z.number().int().min(0).optional(),
  })
  .strict();

export const agentInvocationSchema = z
  .object({
    version: z.literal(1),
    origin: z
      .object({
        backpackId: backpackIdSchema,
        programId: programIdSchema,
        viewId: z.string().max(128).optional(),
        commandId: z.string().min(1).max(128),
      })
      .strict(),
    action: z
      .object({
        id: z.string().min(1).max(128),
        label: z.string().min(1).max(200),
        creatorInstruction: z.string().max(10_000).optional(),
      })
      .strict(),
    selection: z
      .object({
        type: z.string().min(1).max(64),
        references: z.array(programReferenceSchema).max(200),
      })
      .strict(),
    sharedMaterial: z.array(sharedMaterialItemSchema).max(100),
    destination: z
      .object({
        programId: programIdSchema,
        type: z.string().min(1).max(64),
        reference: programReferenceSchema.optional(),
      })
      .strict(),
    permissions: z.array(capabilitySchema).max(16),
    execution: z
      .object({
        cwd: z.string().max(500).optional(),
        hermesProjectId: z.string().max(128).optional(),
        preferredWorker: z.enum(['hermes', 'codex', 'opencode']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Total shared content bytes permitted per invocation. */
export const maxSharedMaterialBytes = 1_500_000;

export const resultArtifactSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    mediaType: z.string().min(1).max(100),
    path: z.string().max(500).optional(),
    content: z.string().max(2_000_000).optional(),
  })
  .strict();

export const programOperationSchema = z
  .object({
    type: z.string().min(1).max(64),
    payload: z.unknown(),
  })
  .strict();

export const agentResultProposalSchema = z
  .object({
    invocationId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(200),
    summary: z.string().max(20_000),
    structuredOutput: z.unknown().optional(),
    artifacts: z.array(resultArtifactSchema).max(50).optional(),
    proposedOperations: z.array(programOperationSchema).max(500).optional(),
  })
  .strict();

export const shelfContributionSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(60),
    commandId: z.string().min(1).max(128),
    title: z.string().max(200).optional(),
  })
  .strict();

export const programCommandSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
  })
  .strict();

export const backpackNameSchema = z.string().min(1).max(120);
