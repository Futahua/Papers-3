import { z } from 'zod';
import {
  activateWorkspaceSurface,
  moveWorkspaceSurface,
  splitWorkspaceGroup,
  validatedWorkspaceTopologySchema,
  workspaceTopologySchema,
} from '@shared/workspaceTopology';
import type {
  PapersControlConfirmationBroker,
  PapersControlDestructiveAction,
} from './papersControlConfirmation';
import { visualDiagnosticRecordSchema } from '../visual/visualDiagnostics';
import { visualTimelineEntrySchema } from '../visual/visualTimeline';
import { type VisualReportRequest } from '../visual/visualReport';
import { visualElementObservationSchema, visualSemanticKeyListSchema, visualSemanticKeySchema } from '@shared/visualSemanticKeys';

export const PAPERS_CONTROL_PROTOCOL_VERSION = 1;

const emptyParamsSchema = z.object({}).strict().default({});

const safeBuildSchema = z.object({
  version: z.string(),
  commit: z.string(),
  branch: z.string(),
  builtAt: z.string(),
  packaged: z.boolean(),
}).strict();

const processInstanceIdentitySchema = z.object({
  pid: z.number().int().positive(),
  appInstanceId: z.string().min(1).max(128),
  startedAt: z.string().datetime(),
  build: z.object({
    version: z.string(),
    commit: z.string(),
    packaged: z.boolean(),
  }).strict(),
  executableIdentity: z.object({
    // This is an opaque volume/file identity, never a canonical path.
    status: z.literal('available'),
    canonicalFileId: z.string().min(1).max(256),
  }).strict().or(z.object({ status: z.literal('unavailable') }).strict()),
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
export const visualEventTargetSchema = z.object({
  windowId: z.number().int(),
  surfaceId: z.string().min(1).max(128).optional(),
}).strict();
export type VisualEventTarget = z.infer<typeof visualEventTargetSchema>;
const visualElementIdentitySchema = z.object({ key: visualSemanticKeySchema }).strict();
const visualElementsInspectionSchema = z.object({
  windowId: z.number().int(),
  surfaceId: z.string().min(1).max(128),
  layoutEpoch: z.number().int().nonnegative().nullable().optional(),
  elements: z.array(z.union([visualElementIdentitySchema, visualElementObservationSchema])).max(256),
}).strict();
const visualAssertionSchema = z.union([
  z.object({ kind: z.literal('visible'), elementKey: visualSemanticKeySchema }).strict(),
  z.object({ kind: z.literal('not-clipped'), elementKey: visualSemanticKeySchema, maxClippedPercent: z.number().finite().min(0).max(100) }).strict(),
  z.object({ kind: z.literal('inside'), elementKey: visualSemanticKeySchema, containerKey: visualSemanticKeySchema }).strict(),
  z.object({ kind: z.literal('no-overlap'), a: visualSemanticKeySchema, b: visualSemanticKeySchema, maxIntersectionPercent: z.number().finite().min(0).max(100) }).strict(),
  z.object({ kind: z.literal('min-contrast'), elementKey: visualSemanticKeySchema, ratio: z.number().finite().min(1).max(21) }).strict(),
]);
const visualAssertResultSchema = z.object({
  kind: z.enum(['visible', 'not-clipped', 'inside', 'no-overlap', 'min-contrast']),
  passed: z.boolean(),
  reason: z.enum(['missing-element', 'not-visible', 'clipped', 'outside-container', 'overlap', 'unknown-contrast', 'contrast-too-low']).optional(),
}).strict();
const visualAssertOutputSchema = z.object({
  windowId: z.number().int(), surfaceId: z.string().min(1).max(128),
  layoutEpoch: z.number().int().nonnegative().nullable(), available: z.boolean().optional(),
  reason: z.literal('geometry-unavailable').optional(), allPassed: z.boolean(),
  assertions: z.array(visualAssertResultSchema).max(64),
}).strict();
const visualArtifactIdSchema = z.string().regex(/^va-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const visualArtifactMetadataSchema = z.object({
  artifactId: visualArtifactIdSchema,
  mimeType: z.string().min(1).max(128),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
const visualCaptureResultSchema = z.object({
  captureId: z.string().uuid(),
  target: z.object({ windowId: z.number().int(), surfaceId: z.string().min(1).max(128), projectId: z.string().min(1).max(128) }).strict(),
  observedAt: z.string().datetime(),
  consistency: z.union([
    z.object({ status: z.literal('stable') }).strict(),
    z.object({ status: z.literal('unstable'), reason: z.enum(['layout-changed', 'state-changed', 'topology-changed', 'renderer-replaced']) }).strict(),
  ]),
  process: processInstanceIdentitySchema,
  revisions: z.object({
    workspaceTopologyRevision: z.number().int().nonnegative(),
    documentStateRevision: z.string().max(256).nullable(),
    renderCycleId: z.string().uuid().nullable(),
    layoutEpoch: z.number().int().nonnegative().nullable(),
  }).strict(),
  presentation: surfacePresentationSchema,
  summary: z.object({
    domReady: z.boolean(),
    hydrated: z.boolean(),
    firstPaint: z.boolean(),
    layoutStable: z.boolean(),
    renderFailed: z.boolean(),
    semanticKeys: visualSemanticKeyListSchema,
  }).strict(),
  png: visualArtifactMetadataSchema.optional(),
}).strict();
const visualElementCaptureResultSchema = visualCaptureResultSchema.extend({
  element: visualElementObservationSchema.optional(),
  crop: z.object({
    x: z.number().int(), y: z.number().int(),
    width: z.number().int().positive(), height: z.number().int().positive(),
  }).strict().optional(),
});
const visualWindowCaptureResultSchema = z.object({
  captureId: z.string().uuid(),
  target: z.object({ windowId: z.number().int() }).strict(),
  observedAt: z.string().datetime(),
  consistency: z.union([
    z.object({ status: z.literal('stable') }).strict(),
    z.object({ status: z.literal('unstable'), reason: z.enum(['layout-changed', 'state-changed', 'topology-changed', 'renderer-replaced']) }).strict(),
  ]),
  process: processInstanceIdentitySchema,
  revisions: z.object({ workspaceTopologyRevision: z.number().int().nonnegative() }).strict(),
  nativeBounds: z.object({
    x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive(),
  }).strict(),
  pixelSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  surfaces: z.array(z.object({
    surfaceId: z.string().min(1).max(128),
    projectId: z.string().min(1).max(128),
    presentation: z.literal('visible'),
    revisions: z.object({
      documentStateRevision: z.string().max(256).nullable(),
      renderCycleId: z.string().uuid().nullable(),
      layoutEpoch: z.number().int().nonnegative().nullable(),
    }).strict(),
  }).strict()).max(256),
  png: visualArtifactMetadataSchema.optional(),
}).strict();
const visualReportIncludeSchema = z.object({
  surfaceCapture: z.boolean().default(false),
  elementCaptures: z.boolean().default(false),
  semanticElements: z.boolean().default(true),
  recentLifecycle: z.boolean().default(true),
  recentDiagnostics: z.boolean().default(true),
  timeline: z.boolean().default(true),
}).strict();
const visualReportResultSchema = z.object({
  reportId: z.string().uuid(),
  artifactId: visualArtifactIdSchema,
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().datetime(),
  manifestSummary: z.object({
    entryCount: z.number().int().positive().max(32),
    byteSize: z.number().int().positive(),
    includes: visualReportIncludeSchema,
  }).strict(),
}).strict();
const visualWaitRequestSchema = z.object({
  windowId: z.number().int(),
  surfaceId: z.string().min(1).max(128),
  until: z.enum(['layout-stable', 'render-failed']),
  timeoutMs: z.number().int().positive().max(5_000).default(5_000),
}).strict();
const visualWaitResultSchema = z.object({
  windowId: z.number().int(),
  surfaceId: z.string().min(1).max(128),
  status: z.enum(['layout-stable', 'render-failed', 'timeout', 'retired']),
  terminal: visualDiagnosticRecordSchema.optional(),
}).strict();
const layoutTargetSchema = z.object({ windowId: z.number().int(), layoutId: z.string().uuid() }).strict();
const namedLayoutSchema = z.object({
  layoutId: z.string().uuid(),
  name: z.string().min(1).max(120),
  topology: validatedWorkspaceTopologySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
const movedWorkspaceSchema = z.object({
  surfaceId: z.string().min(1),
  sourceWindowId: z.number().int(),
  targetWindowId: z.number().int(),
  sourceTopology: workspaceTopologySchema,
  targetTopology: workspaceTopologySchema,
}).strict();
const destructiveActionSchema = z.enum(['backpack.archive', 'backpack.remove']);
const confirmationChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  action: destructiveActionSchema,
  target: z.object({ projectId: z.string().min(1), name: z.string().min(1) }).strict(),
  confirmationText: z.string().min(1).max(512),
  expiresAt: z.string().datetime(),
}).strict();
const destructiveActionResultSchema = z.object({
  action: destructiveActionSchema,
  projectId: z.string().min(1),
  name: z.string().min(1),
}).strict();

export const papersControlEventNames = [
  'window.created',
  'workspace.changed',
  'visual.lifecycle',
  'visual.diagnostic',
] as const;
export const controlEventNameSchema = z.enum(papersControlEventNames);
export type PapersControlEventName = z.infer<typeof controlEventNameSchema>;

const windowCreatedEventPayloadSchema = z.object({
  windowId: z.number().int(),
}).strict();

const workspaceChangedEventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('open'),
    windowId: z.number().int(),
    surfaceId: z.string().min(1),
    projectId: z.string().min(1),
    topology: workspaceTopologySchema,
  }).strict(),
  z.object({
    kind: z.enum(['activate', 'close', 'load', 'move', 'restore', 'split']),
    windowId: z.number().int(),
    topology: workspaceTopologySchema,
    layoutId: z.string().uuid().optional(),
    surfaceId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('move-to-window'),
    surfaceId: z.string().min(1),
    sourceWindowId: z.number().int(),
    targetWindowId: z.number().int(),
    sourceTopology: workspaceTopologySchema,
    targetTopology: workspaceTopologySchema,
  }).strict(),
]);

const visualLifecycleEventPayloadSchema = visualDiagnosticRecordSchema.refine(
  (record) => record.payload.kind === 'lifecycle',
  { message: 'visual.lifecycle payload must be a lifecycle record' },
);
const visualDiagnosticEventPayloadSchema = visualDiagnosticRecordSchema.refine(
  (record) => record.payload.kind !== 'lifecycle',
  { message: 'visual.diagnostic payload must be a non-lifecycle record' },
);

export const papersControlEventFrameSchema = z.discriminatedUnion('event', [
  z.object({
    type: z.literal('event'),
    event: z.literal('window.created'),
    payload: windowCreatedEventPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal('event'),
    event: z.literal('workspace.changed'),
    payload: workspaceChangedEventPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal('event'),
    event: z.literal('visual.lifecycle'),
    payload: visualLifecycleEventPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal('event'),
    event: z.literal('visual.diagnostic'),
    payload: visualDiagnosticEventPayloadSchema,
  }).strict(),
]);

export type PapersControlEventFrame = z.infer<typeof papersControlEventFrameSchema>;
const eventSubscriptionSchema = z.object({
  events: z.array(controlEventNameSchema).min(1).max(papersControlEventNames.length),
  visualTarget: visualEventTargetSchema.optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.events).size !== value.events.length) {
    context.addIssue({ code: 'custom', message: 'events must not contain duplicates', path: ['events'] });
  }
  const visualRequested = value.events.some((event) => event === 'visual.lifecycle' || event === 'visual.diagnostic');
  if (visualRequested !== (value.visualTarget !== undefined)) {
    context.addIssue({
      code: 'custom',
      message: visualRequested ? 'visualTarget is required for visual events' : 'visualTarget is only valid for visual events',
      path: ['visualTarget'],
    });
  }
});

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
  'inspect.process': { input: emptyParamsSchema, output: processInstanceIdentitySchema, scope: 'app', effect: 'query' },
  'inspect.visual.diagnostics': {
    input: z.object({ windowId: z.number().int(), surfaceId: z.string().min(1).max(128).optional() }).strict(),
    output: z.array(visualDiagnosticRecordSchema),
    scope: 'window',
    effect: 'query',
  },
  'inspect.visual.elements': {
    input: z.object({
      windowId: z.number().int(),
      surfaceId: z.string().min(1).max(128),
      keys: visualSemanticKeyListSchema.optional(),
    }).strict(),
    output: visualElementsInspectionSchema,
    scope: 'surface',
    effect: 'query',
  },
  'inspect.visual.timeline': {
    input: z.object({
      windowId: z.number().int(), surfaceId: z.string().min(1).max(128),
      beforeMs: z.number().int().nonnegative().max(10_000).default(10_000),
    }).strict(),
    output: z.array(visualTimelineEntrySchema).max(256),
    scope: 'surface', effect: 'query',
  },
  'visual.report.create': {
    input: surfaceTargetSchema.extend({
      beforeMs: z.number().int().nonnegative().max(10_000).default(10_000),
      elementKeys: visualSemanticKeyListSchema.max(8).default([]),
      include: visualReportIncludeSchema.default({
        surfaceCapture: false,
        elementCaptures: false,
        semanticElements: true,
        recentLifecycle: true,
        recentDiagnostics: true,
        timeline: true,
      }),
    }).strict(),
    output: visualReportResultSchema,
    scope: 'surface', effect: 'query',
  },
  'visual.wait': {
    input: visualWaitRequestSchema,
    output: visualWaitResultSchema,
    scope: 'surface', effect: 'query',
  },
  'visual.assert': {
    input: z.object({
      windowId: z.number().int(), surfaceId: z.string().min(1).max(128),
      assertions: z.array(visualAssertionSchema).min(1).max(64),
    }).strict(),
    output: visualAssertOutputSchema,
    scope: 'surface', effect: 'query',
  },
  'visual.artifact.read': {
    input: z.object({
      artifactId: visualArtifactIdSchema,
      offset: z.number().int().nonnegative(),
      length: z.number().int().positive().max(1024 * 1024),
    }).strict(),
    output: z.object({
      metadata: visualArtifactMetadataSchema,
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative(),
      done: z.boolean(),
      bytesBase64: z.string().max(1_500_000),
    }).strict(),
    scope: 'app',
    effect: 'query',
  },
  'capture.surface': {
    input: z.object({ windowId: z.number().int(), surfaceId: z.string().min(1).max(128) }).strict(),
    output: visualCaptureResultSchema,
    scope: 'surface',
    effect: 'query',
  },
  'capture.element': {
    input: z.object({
      windowId: z.number().int(), surfaceId: z.string().min(1).max(128),
      elementKey: visualSemanticKeySchema,
      paddingCssPx: z.number().finite().min(0).max(32).default(0),
    }).strict(),
    output: visualElementCaptureResultSchema,
    scope: 'surface',
    effect: 'query',
  },
  'capture.window': {
    input: windowTargetSchema,
    output: visualWindowCaptureResultSchema,
    scope: 'window',
    effect: 'query',
  },
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
  'layout.list': {
    input: emptyParamsSchema,
    output: z.array(namedLayoutSchema),
    scope: 'app',
    effect: 'query',
  },
  'layout.save': {
    input: z.object({ windowId: z.number().int(), name: z.string().min(1).max(120) }).strict(),
    output: namedLayoutSchema,
    scope: 'window',
    effect: 'mutate',
  },
  'layout.load': {
    input: layoutTargetSchema,
    output: z.object({ windowId: z.number().int(), layoutId: z.string().uuid(), topology: workspaceTopologySchema }).strict(),
    scope: 'window',
    effect: 'mutate',
  },
  'layout.restore': {
    input: z.object({ windowId: z.number().int(), topology: validatedWorkspaceTopologySchema }).strict(),
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'window',
    effect: 'mutate',
  },
  'workspace.activate': {
    input: surfaceTargetSchema,
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'surface', effect: 'mutate',
  },
  'workspace.open': {
    input: z.object({ windowId: z.number().int(), projectId: z.string().min(1) }).strict(),
    output: z.object({
      windowId: z.number().int(), surfaceId: z.string().min(1), projectId: z.string().min(1), topology: workspaceTopologySchema,
    }).strict(),
    scope: 'window', effect: 'mutate',
  },
  'workspace.close': {
    input: surfaceTargetSchema,
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'surface', effect: 'mutate',
  },
  'layout.moveSurface': {
    input: surfaceTargetSchema.extend({ targetGroupId: z.string().min(1), targetIndex: z.number().int().nonnegative() }).strict(),
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'surface', effect: 'mutate',
  },
  'layout.moveSurfaceToWindow': {
    input: z.object({
      sourceWindowId: z.number().int(),
      surfaceId: z.string().min(1).max(128),
      targetWindowId: z.number().int(),
      targetGroupId: z.string().min(1).max(128),
      targetIndex: z.number().int().nonnegative(),
    }).strict(),
    output: movedWorkspaceSchema,
    scope: 'app', effect: 'mutate',
  },
  'events.subscribe': {
    input: eventSubscriptionSchema,
    output: z.object({ subscribed: z.array(controlEventNameSchema) }).strict(),
    scope: 'app', effect: 'query',
  },
  'backpack.archive.prepare': {
    input: z.object({ projectId: z.string().min(1).max(128) }).strict(),
    output: confirmationChallengeSchema,
    scope: 'app', effect: 'query',
  },
  'backpack.remove.prepare': {
    input: z.object({ projectId: z.string().min(1).max(128) }).strict(),
    output: confirmationChallengeSchema,
    scope: 'app', effect: 'query',
  },
  'confirmation.execute': {
    input: z.object({
      challengeId: z.string().uuid(),
      confirmationText: z.string().min(1).max(512),
    }).strict(),
    output: destructiveActionResultSchema,
    scope: 'app', effect: 'mutate',
  },
  'layout.split': {
    input: surfaceTargetSchema.extend({ direction: z.enum(['right', 'down']) }).strict(),
    output: z.object({ windowId: z.number().int(), topology: workspaceTopologySchema }).strict(),
    scope: 'surface', effect: 'mutate',
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
  closeWorkspace?(windowId: number, surfaceId: string, topology: z.infer<typeof workspaceTopologySchema>): unknown | Promise<unknown>;
  openWorkspace?(windowId: number, projectId: string): Promise<unknown>;
  listWorkspaceLayouts?(): Promise<unknown>;
  saveWorkspaceLayout?(windowId: number, name: string): Promise<unknown>;
  loadWorkspaceLayout?(windowId: number, layoutId: string): Promise<unknown>;
  moveWorkspaceSurfaceAcrossWindows?(request: {
    sourceWindowId: number;
    surfaceId: string;
    targetWindowId: number;
    targetGroupId: string;
    targetIndex: number;
  }): Promise<unknown>;
  snapshot(): unknown;
  /** A safe process-instance projection; it must contain no filesystem path. */
  processIdentity?(): unknown;
  /** Bounded, redacted records for one exact live window/surface target. */
  visualDiagnostics?(target: { windowId: number; surfaceId?: string }): unknown;
  /** Bounded opaque semantic identities observed by predefined project code. */
  visualElements?(target: { windowId: number; surfaceId: string }, keys?: string[]): unknown;
  visualTimeline?(target: { windowId: number; surfaceId: string }, beforeMs: number): unknown;
  visualReportCreate?(request: VisualReportRequest, signal?: AbortSignal): Promise<unknown>;
  visualWait?(request: { windowId: number; surfaceId: string; until: 'layout-stable' | 'render-failed'; timeoutMs: number }, signal?: AbortSignal): Promise<unknown>;
  visualAssert?(target: { windowId: number; surfaceId: string }, assertions: unknown[]): unknown;
  visualArtifactRead?(artifactId: string, offset: number, length: number): Promise<{
    metadata: unknown;
    offset: number;
    nextOffset: number;
    done: boolean;
    bytes: Uint8Array;
  }>;
  captureSurface?(target: { windowId: number; surfaceId: string }, signal?: AbortSignal): Promise<unknown>;
  captureElement?(target: { windowId: number; surfaceId: string }, elementKey: string, paddingCssPx: number, signal?: AbortSignal): Promise<unknown>;
  captureWindow?(target: { windowId: number }, signal?: AbortSignal): Promise<unknown>;
  windows(): unknown;
  createWindow(): Promise<unknown>;
  backpack?(projectId: string): unknown;
  archiveBackpack?(projectId: string, confirmedName: string): Promise<void>;
  removeBackpack?(projectId: string, confirmedName: string): Promise<void>;
  /** Publish only schema-validated, redacted semantic events to subscribed
   * control connections. The transport owns connection-local fan-out. */
  publishEvent?(event: PapersControlEventName, payload: unknown): void;
  /** Validate a live exact target before a visual event subscription activates. */
  validateVisualEventTarget?(target: VisualEventTarget): boolean;
}

export interface PapersControlDispatchContext {
  connectionId?: string;
  confirmations?: PapersControlConfirmationBroker;
  signal?: AbortSignal;
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

/** The server uses this before full request parsing so a refusal for an
 * unknown method or malformed envelope can still be correlated to its caller.
 * Values that are not valid request ids remain intentionally uncorrelatable. */
export const controlRequestIdSchema = z.union([z.string().min(1).max(128), z.number().int()]);

export type PapersControlRequest = z.infer<typeof controlRequestSchema>;

/** Dispatch semantic commands without inventing a renderer sender identity.
 * Transport authentication happens before this boundary; every target-bearing
 * command added later must resolve explicit window/surface ids here. */
export async function dispatchPapersControl(
  dependencies: PapersControlDependencies,
  request: PapersControlRequest,
  context: PapersControlDispatchContext = {},
): Promise<unknown> {
  const definition = papersControlCommands[request.method];
  definition.input.parse(request.params ?? {});
  switch (request.method) {
    case 'backpack.archive.prepare':
    case 'backpack.remove.prepare': {
      if (!context.connectionId || !context.confirmations) {
        throw new Error('Destructive confirmation is unavailable outside an authenticated control connection.');
      }
      const { projectId } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const backpack = dependencies.backpack?.(projectId) as { id?: unknown; name?: unknown; archived?: unknown } | null | undefined;
      if (!backpack || backpack.id !== projectId || typeof backpack.name !== 'string' || typeof backpack.archived !== 'boolean') {
        throw new Error('That Backpack is not available.');
      }
      const action: PapersControlDestructiveAction = request.method === 'backpack.archive.prepare'
        ? 'backpack.archive'
        : 'backpack.remove';
      if (action === 'backpack.archive' && backpack.archived) throw new Error('That Backpack is already archived.');
      if (action === 'backpack.remove' && !backpack.archived) throw new Error('Archive the Backpack before deleting it.');
      return papersControlCommands[request.method].output.parse(context.confirmations.issue(
        context.connectionId,
        action,
        { projectId, name: backpack.name },
      ));
    }
    case 'confirmation.execute': {
      if (!context.connectionId || !context.confirmations) {
        throw new Error('Destructive confirmation is unavailable outside an authenticated control connection.');
      }
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const challenge = context.confirmations.consume(
        context.connectionId,
        params.challengeId,
        params.confirmationText,
      );
      const backpack = dependencies.backpack?.(challenge.target.projectId) as { id?: unknown; name?: unknown; archived?: unknown } | null | undefined;
      if (!backpack || backpack.id !== challenge.target.projectId || backpack.name !== challenge.target.name || typeof backpack.archived !== 'boolean') {
        throw new Error('The confirmed Backpack changed or is no longer available.');
      }
      if (challenge.action === 'backpack.archive') {
        if (backpack.archived) throw new Error('The confirmed Backpack is already archived.');
        if (!dependencies.archiveBackpack) throw new Error('Backpack archiving is unavailable.');
        await dependencies.archiveBackpack(challenge.target.projectId, challenge.target.name);
      } else {
        if (!backpack.archived) throw new Error('The confirmed Backpack is no longer archived.');
        if (!dependencies.removeBackpack) throw new Error('Backpack deletion is unavailable.');
        await dependencies.removeBackpack(challenge.target.projectId, challenge.target.name);
      }
      return papersControlCommands[request.method].output.parse({
        action: challenge.action,
        projectId: challenge.target.projectId,
        name: challenge.target.name,
      });
    }
  case 'events.subscribe': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const visualRequested = params.events.some((event) => event === 'visual.lifecycle' || event === 'visual.diagnostic');
      if (visualRequested && (!params.visualTarget || !dependencies.validateVisualEventTarget?.(params.visualTarget))) {
        throw new Error('That Papers visual event target is unavailable.');
      }
      return papersControlCommands[request.method].output.parse({ subscribed: params.events });
    }
    case 'inspect.process': {
      const identity = dependencies.processIdentity?.();
      if (!identity) throw new Error('Process identity is unavailable.');
      return papersControlCommands[request.method].output.parse(identity);
    }
    case 'inspect.visual.diagnostics': {
      const target = papersControlCommands[request.method].input.parse(request.params ?? {});
      const records = dependencies.visualDiagnostics?.(target);
      if (!records) throw new Error('That Papers visual diagnostic target is unavailable.');
      return papersControlCommands[request.method].output.parse(records);
    }
    case 'inspect.visual.elements': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const elements = dependencies.visualElements?.(target, params.keys);
      if (!elements) throw new Error('That Papers visual element target is unavailable.');
      return papersControlCommands[request.method].output.parse(elements);
    }
    case 'inspect.visual.timeline': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const timeline = dependencies.visualTimeline?.(target, params.beforeMs);
      if (!timeline) throw new Error('That Papers visual timeline target is unavailable.');
      return papersControlCommands[request.method].output.parse(timeline);
    }
    case 'visual.report.create': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const report = await (context.signal
        ? dependencies.visualReportCreate?.(params, context.signal)
        : dependencies.visualReportCreate?.(params));
      if (!report) throw new Error('Visual report generation is unavailable.');
      return papersControlCommands[request.method].output.parse(report);
    }
    case 'visual.wait': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const result = await (context.signal
        ? dependencies.visualWait?.(params, context.signal)
        : dependencies.visualWait?.(params));
      if (!result) throw new Error('Visual wait is unavailable.');
      return papersControlCommands[request.method].output.parse(result);
    }
    case 'visual.assert': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const result = dependencies.visualAssert?.(target, params.assertions);
      if (!result) throw new Error('Visual assertions are unavailable.');
      return papersControlCommands[request.method].output.parse(result);
    }
    case 'visual.artifact.read': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const chunk = await dependencies.visualArtifactRead?.(params.artifactId, params.offset, params.length);
      if (!chunk) throw new Error('That visual artifact is unavailable.');
      return papersControlCommands[request.method].output.parse({
        metadata: chunk.metadata,
        offset: chunk.offset,
        nextOffset: chunk.nextOffset,
        done: chunk.done,
        bytesBase64: Buffer.from(chunk.bytes).toString('base64'),
      });
    }
    case 'capture.surface': {
      const target = papersControlCommands[request.method].input.parse(request.params ?? {});
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const captured = await (context.signal
        ? dependencies.captureSurface?.(target, context.signal)
        : dependencies.captureSurface?.(target));
      if (!captured) throw new Error('Visual surface capture is unavailable.');
      return papersControlCommands[request.method].output.parse(captured);
    }
    case 'capture.element': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const target = { windowId: params.windowId, surfaceId: params.surfaceId };
      if (!dependencies.surface(target)) throw new Error('That surface is not open in that Papers window.');
      const captured = await (context.signal
        ? dependencies.captureElement?.(target, params.elementKey, params.paddingCssPx, context.signal)
        : dependencies.captureElement?.(target, params.elementKey, params.paddingCssPx));
      if (!captured) throw new Error('Visual element capture is unavailable.');
      return papersControlCommands[request.method].output.parse(captured);
    }
    case 'capture.window': {
      const target = papersControlCommands[request.method].input.parse(request.params ?? {});
      const captured = await (context.signal
        ? dependencies.captureWindow?.(target, context.signal)
        : dependencies.captureWindow?.(target));
      if (!captured) throw new Error('Visual window capture is unavailable.');
      return papersControlCommands[request.method].output.parse(captured);
    }
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
    case 'layout.list': {
      const layouts = await dependencies.listWorkspaceLayouts?.();
      if (!layouts) throw new Error('Named workspace layouts are unavailable.');
      return papersControlCommands[request.method].output.parse(layouts);
    }
    case 'layout.save': {
      const { windowId, name } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const layout = await dependencies.saveWorkspaceLayout?.(windowId, name);
      if (!layout) throw new Error('That Papers window cannot save a named workspace layout.');
      return papersControlCommands[request.method].output.parse(layout);
    }
    case 'layout.load': {
      const { windowId, layoutId } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const loaded = await dependencies.loadWorkspaceLayout?.(windowId, layoutId);
      if (!loaded) throw new Error('That Papers window cannot load a named workspace layout.');
      const result = papersControlCommands[request.method].output.parse(loaded);
      dependencies.publishEvent?.('workspace.changed', { kind: 'load', ...result });
      return result;
    }
    case 'layout.moveSurfaceToWindow': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      const moved = await dependencies.moveWorkspaceSurfaceAcrossWindows?.(params);
      if (!moved) throw new Error('Cross-window workspace moves are unavailable.');
      const movedResult = moved as {
        surfaceId: string;
        sourceWindowId: number;
        targetWindowId: number;
        source: { topology: z.infer<typeof workspaceTopologySchema> };
        target: { topology: z.infer<typeof workspaceTopologySchema> };
      };
      const result = papersControlCommands[request.method].output.parse({
        surfaceId: movedResult.surfaceId,
        sourceWindowId: movedResult.sourceWindowId,
        targetWindowId: movedResult.targetWindowId,
        sourceTopology: movedResult.source.topology,
        targetTopology: movedResult.target.topology,
      });
      dependencies.publishEvent?.('workspace.changed', { kind: 'move-to-window', ...result });
      return result;
    }
    case 'layout.restore': {
      const { windowId, topology } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const current = dependencies.workspace?.(windowId) as { topology?: z.infer<typeof workspaceTopologySchema> } | null;
      if (!current?.topology) throw new Error('That Papers window has not committed workspace topology.');
      if (current.topology.root.kind === 'split' && topology.root.kind === 'split') {
        const currentOrder = current.topology.root.children.map((child) => child.kind === 'group' ? child.groupId : '').join('\0');
        const requestedOrder = topology.root.children.map((child) => child.kind === 'group' ? child.groupId : '').join('\0');
        if (current.topology.root.orientation !== topology.root.orientation || currentOrder !== requestedOrder) {
          throw new Error('Changing an existing split orientation or root order is not supported exactly yet.');
        }
      }
      const restored = dependencies.restoreWorkspace?.(windowId, topology);
      if (!restored) throw new Error('That Papers window cannot restore workspace topology.');
      const result = papersControlCommands[request.method].output.parse({ windowId, topology: restored });
      dependencies.publishEvent?.('workspace.changed', { kind: 'restore', ...result });
      return result;
    }
    case 'workspace.open': {
      const { windowId, projectId } = papersControlCommands[request.method].input.parse(request.params ?? {});
      const opened = await dependencies.openWorkspace?.(windowId, projectId);
      if (!opened) throw new Error('That Papers window cannot open the workspace project.');
      const result = papersControlCommands[request.method].output.parse(opened);
      dependencies.publishEvent?.('workspace.changed', { kind: 'open', ...result });
      return result;
    }
    case 'workspace.activate':
    case 'workspace.close':
    case 'layout.moveSurface':
    case 'layout.split': {
      const params = papersControlCommands[request.method].input.parse(request.params ?? {});
      if (!dependencies.surface({ windowId: params.windowId, surfaceId: params.surfaceId })) {
        throw new Error('That surface is not open in that Papers window.');
      }
      const workspace = dependencies.workspace?.(params.windowId) as { topology?: z.infer<typeof workspaceTopologySchema> } | null;
      if (!workspace?.topology) throw new Error('That Papers window has not committed workspace topology.');
      let topology = workspace.topology;
      if (request.method === 'workspace.activate') {
        topology = activateWorkspaceSurface(topology, params.surfaceId);
      } else if (request.method === 'workspace.close') {
        const closed = await dependencies.closeWorkspace?.(params.windowId, params.surfaceId, topology);
        if (!closed) throw new Error('That Papers window cannot close the workspace surface.');
        const result = papersControlCommands[request.method].output.parse({ windowId: params.windowId, topology: closed });
        dependencies.publishEvent?.('workspace.changed', { kind: 'close', ...result });
        return result;
      } else if (request.method === 'layout.moveSurface') {
        const move = papersControlCommands['layout.moveSurface'].input.parse(request.params ?? {});
        topology = moveWorkspaceSurface(topology, move.surfaceId, move.targetGroupId, move.targetIndex);
      } else {
        const split = papersControlCommands['layout.split'].input.parse(request.params ?? {});
        if (topology.root.kind === 'split') throw new Error('Nested workspace splits are not supported yet.');
        const source = topology.groups.find((group) => group.surfaceIds.includes(params.surfaceId));
        if (!source) throw new Error('That surface is not represented in workspace topology.');
        let newGroupId = `group-${params.surfaceId}`;
        for (let suffix = 2; topology.groups.some((group) => group.groupId === newGroupId); suffix += 1) {
          newGroupId = `group-${params.surfaceId}-${suffix}`;
        }
        topology = splitWorkspaceGroup(topology, {
          groupId: source.groupId,
          newGroupId,
          surfaceId: params.surfaceId,
          orientation: split.direction === 'right' ? 'horizontal' : 'vertical',
          position: 'after',
        });
      }
      const restored = dependencies.restoreWorkspace?.(params.windowId, topology);
      if (!restored) throw new Error('That Papers window cannot mutate workspace topology.');
      const result = papersControlCommands[request.method].output.parse({ windowId: params.windowId, topology: restored });
      const kind = request.method === 'workspace.activate'
        ? 'activate'
        : request.method === 'layout.moveSurface' ? 'move' : 'split';
      dependencies.publishEvent?.('workspace.changed', {
        kind,
        ...result,
        ...(request.method === 'workspace.activate' || request.method === 'layout.moveSurface'
          ? { surfaceId: params.surfaceId }
          : {}),
      });
      return result;
    }
    case 'inspect.snapshot': return papersControlCommands[request.method].output.parse(dependencies.snapshot());
    case 'inspect.windows': return papersControlCommands[request.method].output.parse(dependencies.windows());
    case 'window.create': {
      const result = papersControlCommands[request.method].output.parse(await dependencies.createWindow());
      dependencies.publishEvent?.('window.created', result);
      return result;
    }
  }
}
