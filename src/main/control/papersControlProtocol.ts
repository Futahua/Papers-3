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

export const papersControlEventNames = ['window.created', 'workspace.changed'] as const;
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
]);

export type PapersControlEventFrame = z.infer<typeof papersControlEventFrameSchema>;
const eventSubscriptionSchema = z.object({
  events: z.array(controlEventNameSchema).min(1).max(papersControlEventNames.length),
}).strict().superRefine((value, context) => {
  if (new Set(value.events).size !== value.events.length) {
    context.addIssue({ code: 'custom', message: 'events must not contain duplicates', path: ['events'] });
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
  closeWorkspace?(windowId: number, surfaceId: string, topology: z.infer<typeof workspaceTopologySchema>): unknown;
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
  windows(): unknown;
  createWindow(): Promise<unknown>;
  backpack?(projectId: string): unknown;
  archiveBackpack?(projectId: string, confirmedName: string): Promise<void>;
  removeBackpack?(projectId: string, confirmedName: string): Promise<void>;
  /** Publish only schema-validated, redacted semantic events to subscribed
   * control connections. The transport owns connection-local fan-out. */
  publishEvent?(event: PapersControlEventName, payload: unknown): void;
}

export interface PapersControlDispatchContext {
  connectionId?: string;
  confirmations?: PapersControlConfirmationBroker;
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
      return papersControlCommands[request.method].output.parse({ subscribed: params.events });
    }
    case 'inspect.process': {
      const identity = dependencies.processIdentity?.();
      if (!identity) throw new Error('Process identity is unavailable.');
      return papersControlCommands[request.method].output.parse(identity);
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
        const closed = dependencies.closeWorkspace?.(params.windowId, params.surfaceId, topology);
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
