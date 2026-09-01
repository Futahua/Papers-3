export const WORKSPACE_TOPOLOGY_SCHEMA_VERSION = 1 as const;

export type WorkspaceSplitOrientation = 'horizontal' | 'vertical';

export interface WorkspaceSurface {
  surfaceId: string;
  projectId: string;
  title: string;
}

export interface WorkspaceTabGroup {
  groupId: string;
  surfaceIds: string[];
  activeSurfaceId: string | null;
}

export type WorkspaceLayoutNode =
  | { kind: 'group'; groupId: string }
  | {
    kind: 'split';
    orientation: WorkspaceSplitOrientation;
    weights: number[];
    children: WorkspaceLayoutNode[];
  };

/** Papers-owned durable product state. Dockview ids and serialized internals
 * never enter this model; the renderer derives a Dockview layout from it. */
export interface WorkspaceTopologyV1 {
  schemaVersion: typeof WORKSPACE_TOPOLOGY_SCHEMA_VERSION;
  surfaces: WorkspaceSurface[];
  groups: WorkspaceTabGroup[];
  root: WorkspaceLayoutNode;
  focusedGroupId: string;
}

const workspaceLayoutNodeSchema: z.ZodType<WorkspaceLayoutNode> = z.lazy(() => z.union([
  z.object({ kind: z.literal('group'), groupId: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal('split'),
    orientation: z.enum(['horizontal', 'vertical']),
    weights: z.array(z.number().positive()),
    children: z.array(workspaceLayoutNodeSchema).min(2),
  }).strict(),
]));

export const workspaceTopologySchema: z.ZodType<WorkspaceTopologyV1> = z.object({
  schemaVersion: z.literal(WORKSPACE_TOPOLOGY_SCHEMA_VERSION),
  surfaces: z.array(z.object({
    surfaceId: z.string().min(1), projectId: z.string().min(1), title: z.string(),
  }).strict()),
  groups: z.array(z.object({
    groupId: z.string().min(1),
    surfaceIds: z.array(z.string().min(1)),
    activeSurfaceId: z.string().min(1).nullable(),
  }).strict()).min(1),
  root: workspaceLayoutNodeSchema,
  focusedGroupId: z.string().min(1),
}).strict();

/** Shape plus cross-field invariants for untrusted control/disk ingress. */
export const validatedWorkspaceTopologySchema = workspaceTopologySchema.superRefine((topology, context) => {
  try {
    assertValidWorkspaceTopology(topology);
  } catch (caught) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: caught instanceof Error ? caught.message : String(caught) });
  }
});

export function parseWorkspaceTopology(value: unknown): WorkspaceTopologyV1 {
  return validatedWorkspaceTopologySchema.parse(value);
}

export function createWorkspaceTopology(groupId = 'group-main'): WorkspaceTopologyV1 {
  return {
    schemaVersion: WORKSPACE_TOPOLOGY_SCHEMA_VERSION,
    surfaces: [],
    groups: [{ groupId, surfaceIds: [], activeSurfaceId: null }],
    root: { kind: 'group', groupId },
    focusedGroupId: groupId,
  };
}

function assertIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be non-empty`);
}

export function assertValidWorkspaceTopology(topology: WorkspaceTopologyV1): void {
  if (topology.schemaVersion !== WORKSPACE_TOPOLOGY_SCHEMA_VERSION) throw new Error('unsupported workspace topology version');
  const surfaceIds = new Set<string>();
  for (const surface of topology.surfaces) {
    assertIdentity(surface.surfaceId, 'surfaceId');
    assertIdentity(surface.projectId, 'projectId');
    if (surfaceIds.has(surface.surfaceId)) throw new Error(`duplicate surface ${surface.surfaceId}`);
    surfaceIds.add(surface.surfaceId);
  }
  const groupIds = new Set<string>();
  const assigned = new Set<string>();
  for (const group of topology.groups) {
    assertIdentity(group.groupId, 'groupId');
    if (groupIds.has(group.groupId)) throw new Error(`duplicate group ${group.groupId}`);
    groupIds.add(group.groupId);
    for (const surfaceId of group.surfaceIds) {
      if (!surfaceIds.has(surfaceId)) throw new Error(`unknown surface ${surfaceId}`);
      if (assigned.has(surfaceId)) throw new Error(`surface ${surfaceId} belongs to multiple groups`);
      assigned.add(surfaceId);
    }
    if (group.activeSurfaceId !== null && !group.surfaceIds.includes(group.activeSurfaceId)) {
      throw new Error(`active surface is not in group ${group.groupId}`);
    }
  }
  if (assigned.size !== surfaceIds.size) throw new Error('every surface must belong to one group');
  if (!groupIds.has(topology.focusedGroupId)) throw new Error('focused group does not exist');

  const layoutGroups = new Set<string>();
  const visit = (node: WorkspaceLayoutNode): void => {
    if (node.kind === 'group') {
      if (!groupIds.has(node.groupId)) throw new Error(`layout references unknown group ${node.groupId}`);
      if (layoutGroups.has(node.groupId)) throw new Error(`layout repeats group ${node.groupId}`);
      layoutGroups.add(node.groupId);
      return;
    }
    if (node.children.length < 2 || node.weights.length !== node.children.length) throw new Error('split shape is invalid');
    if (node.weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) throw new Error('split weights must be positive');
    node.children.forEach(visit);
  };
  visit(topology.root);
  if (layoutGroups.size !== groupIds.size) throw new Error('every group must occur once in the layout');
}

export function openWorkspaceSurface(
  topology: WorkspaceTopologyV1,
  surface: WorkspaceSurface,
  groupId = topology.focusedGroupId,
): WorkspaceTopologyV1 {
  if (topology.surfaces.some((candidate) => candidate.surfaceId === surface.surfaceId)) {
    throw new Error(`surface ${surface.surfaceId} already exists`);
  }
  const group = topology.groups.find((candidate) => candidate.groupId === groupId);
  if (!group) throw new Error(`group ${groupId} does not exist`);
  const next: WorkspaceTopologyV1 = {
    ...topology,
    surfaces: [...topology.surfaces, { ...surface }],
    groups: topology.groups.map((candidate) => candidate.groupId === groupId
      ? { ...candidate, surfaceIds: [...candidate.surfaceIds, surface.surfaceId], activeSurfaceId: surface.surfaceId }
      : { ...candidate, surfaceIds: [...candidate.surfaceIds] }),
    focusedGroupId: groupId,
  };
  assertValidWorkspaceTopology(next);
  return next;
}

export function activateWorkspaceSurface(topology: WorkspaceTopologyV1, surfaceId: string): WorkspaceTopologyV1 {
  const group = topology.groups.find((candidate) => candidate.surfaceIds.includes(surfaceId));
  if (!group) throw new Error(`surface ${surfaceId} does not exist`);
  const next = {
    ...topology,
    groups: topology.groups.map((candidate) => candidate.groupId === group.groupId
      ? { ...candidate, surfaceIds: [...candidate.surfaceIds], activeSurfaceId: surfaceId }
      : { ...candidate, surfaceIds: [...candidate.surfaceIds] }),
    focusedGroupId: group.groupId,
  };
  assertValidWorkspaceTopology(next);
  return next;
}

export function reorderWorkspaceGroup(
  topology: WorkspaceTopologyV1,
  groupId: string,
  orderedSurfaceIds: string[],
): WorkspaceTopologyV1 {
  const group = topology.groups.find((candidate) => candidate.groupId === groupId);
  if (!group) throw new Error(`group ${groupId} does not exist`);
  if (orderedSurfaceIds.length !== group.surfaceIds.length
    || new Set(orderedSurfaceIds).size !== orderedSurfaceIds.length
    || orderedSurfaceIds.some((surfaceId) => !group.surfaceIds.includes(surfaceId))) {
    throw new Error(`reorder must contain every surface in group ${groupId} exactly once`);
  }
  const next = {
    ...topology,
    groups: topology.groups.map((candidate) => candidate.groupId === groupId
      ? { ...candidate, surfaceIds: [...orderedSurfaceIds] }
      : { ...candidate, surfaceIds: [...candidate.surfaceIds] }),
  };
  assertValidWorkspaceTopology(next);
  return next;
}

export function setRootWorkspaceSplitWeights(
  topology: WorkspaceTopologyV1,
  weights: number[],
): WorkspaceTopologyV1 {
  if (topology.root.kind !== 'split') return topology;
  if (weights.length !== topology.root.children.length || weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error('split weights must match the root children');
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const normalized = weights.map((weight) => weight / total);
  const next = { ...topology, root: { ...topology.root, weights: normalized } };
  assertValidWorkspaceTopology(next);
  return next;
}

function replaceGroupNode(
  node: WorkspaceLayoutNode,
  groupId: string,
  replacement: WorkspaceLayoutNode,
): WorkspaceLayoutNode {
  if (node.kind === 'group') return node.groupId === groupId ? replacement : { ...node };
  return { ...node, weights: [...node.weights], children: node.children.map((child) => replaceGroupNode(child, groupId, replacement)) };
}

function removeGroupNode(node: WorkspaceLayoutNode, groupId: string): WorkspaceLayoutNode | null {
  if (node.kind === 'group') return node.groupId === groupId ? null : { ...node };
  const children = node.children
    .map((child) => removeGroupNode(child, groupId))
    .filter((child): child is WorkspaceLayoutNode => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  const weight = 1 / children.length;
  return { ...node, children, weights: children.map(() => weight) };
}

export function moveWorkspaceSurface(
  topology: WorkspaceTopologyV1,
  surfaceId: string,
  targetGroupId: string,
  targetIndex: number,
): WorkspaceTopologyV1 {
  const source = topology.groups.find((group) => group.surfaceIds.includes(surfaceId));
  const target = topology.groups.find((group) => group.groupId === targetGroupId);
  if (!source) throw new Error(`surface ${surfaceId} does not exist`);
  if (!target) throw new Error(`group ${targetGroupId} does not exist`);
  const without = target.surfaceIds.filter((candidate) => candidate !== surfaceId);
  const index = Math.max(0, Math.min(Math.trunc(targetIndex), without.length));
  without.splice(index, 0, surfaceId);
  const removeEmptySource = source.groupId !== targetGroupId
    && source.surfaceIds.length === 1
    && topology.groups.length > 1;
  const groups = topology.groups
    .filter((group) => !removeEmptySource || group.groupId !== source.groupId)
    .map((group) => {
      if (group.groupId === targetGroupId) return { ...group, surfaceIds: without, activeSurfaceId: surfaceId };
      if (group.groupId !== source.groupId) return { ...group, surfaceIds: [...group.surfaceIds] };
      const surfaceIds = group.surfaceIds.filter((candidate) => candidate !== surfaceId);
      return {
        ...group,
        surfaceIds,
        activeSurfaceId: group.activeSurfaceId === surfaceId ? surfaceIds[0] ?? null : group.activeSurfaceId,
      };
    });
  const root = removeEmptySource ? removeGroupNode(topology.root, source.groupId) : topology.root;
  if (!root) throw new Error('workspace must retain one group');
  const next: WorkspaceTopologyV1 = {
    ...topology,
    groups,
    root,
    focusedGroupId: targetGroupId,
  };
  assertValidWorkspaceTopology(next);
  return next;
}

export function closeWorkspaceSurface(topology: WorkspaceTopologyV1, surfaceId: string): WorkspaceTopologyV1 {
  const source = topology.groups.find((group) => group.surfaceIds.includes(surfaceId));
  if (!source) throw new Error(`surface ${surfaceId} does not exist`);
  const remaining = source.surfaceIds.filter((candidate) => candidate !== surfaceId);
  const removeEmptyGroup = remaining.length === 0 && topology.groups.length > 1;
  const groups = topology.groups
    .filter((group) => !removeEmptyGroup || group.groupId !== source.groupId)
    .map((group) => {
      if (group.groupId !== source.groupId) return { ...group, surfaceIds: [...group.surfaceIds] };
      return {
        ...group,
        surfaceIds: remaining,
        activeSurfaceId: group.activeSurfaceId === surfaceId ? remaining[0] ?? null : group.activeSurfaceId,
      };
    });
  const root = removeEmptyGroup ? removeGroupNode(topology.root, source.groupId) : topology.root;
  if (!root || groups.length === 0) throw new Error('workspace must retain one group');
  const focusedGroupId = groups.some((group) => group.groupId === topology.focusedGroupId)
    ? topology.focusedGroupId
    : groups[0]!.groupId;
  const next: WorkspaceTopologyV1 = {
    ...topology,
    surfaces: topology.surfaces.filter((surface) => surface.surfaceId !== surfaceId),
    groups,
    root,
    focusedGroupId,
  };
  assertValidWorkspaceTopology(next);
  return next;
}

export function splitWorkspaceGroup(
  topology: WorkspaceTopologyV1,
  options: {
    groupId: string;
    newGroupId: string;
    surfaceId: string;
    orientation: WorkspaceSplitOrientation;
    position: 'before' | 'after';
  },
): WorkspaceTopologyV1 {
  assertIdentity(options.newGroupId, 'newGroupId');
  if (topology.groups.some((group) => group.groupId === options.newGroupId)) throw new Error('new group already exists');
  const source = topology.groups.find((group) => group.groupId === options.groupId);
  if (!source?.surfaceIds.includes(options.surfaceId)) throw new Error('surface is not in the source group');
  if (source.surfaceIds.length < 2) throw new Error('cannot split the only surface out of a group');
  const remaining = source.surfaceIds.filter((surfaceId) => surfaceId !== options.surfaceId);
  const newGroup: WorkspaceTabGroup = {
    groupId: options.newGroupId,
    surfaceIds: [options.surfaceId],
    activeSurfaceId: options.surfaceId,
  };
  const groupNodes: WorkspaceLayoutNode[] = [
    { kind: 'group', groupId: options.groupId },
    { kind: 'group', groupId: options.newGroupId },
  ];
  if (options.position === 'before') groupNodes.reverse();
  const next: WorkspaceTopologyV1 = {
    ...topology,
    groups: [
      ...topology.groups.map((group) => group.groupId === options.groupId
        ? { ...group, surfaceIds: remaining, activeSurfaceId: remaining.includes(group.activeSurfaceId ?? '') ? group.activeSurfaceId : remaining[0]! }
        : { ...group, surfaceIds: [...group.surfaceIds] }),
      newGroup,
    ],
    root: replaceGroupNode(topology.root, options.groupId, {
      kind: 'split',
      orientation: options.orientation,
      weights: [0.5, 0.5],
      children: groupNodes,
    }),
    focusedGroupId: options.newGroupId,
  };
  assertValidWorkspaceTopology(next);
  return next;
}

/** Pure persisted-snapshot identity rewrite. Project/group/layout identity is
 * preserved; every old surface must map exactly once to a unique fresh id. */
export function remapWorkspaceTopologySurfaceIds(
  topology: WorkspaceTopologyV1,
  oldToFresh: ReadonlyMap<string, string>,
): WorkspaceTopologyV1 {
  assertValidWorkspaceTopology(topology);
  const oldIds = new Set(topology.surfaces.map((surface) => surface.surfaceId));
  if (oldToFresh.size !== oldIds.size || [...oldToFresh.keys()].some((surfaceId) => !oldIds.has(surfaceId))) {
    throw new Error('surface identity mapping must contain every persisted surface exactly once');
  }
  const freshIds = [...oldToFresh.values()];
  if (freshIds.some((surfaceId) => typeof surfaceId !== 'string' || surfaceId.length === 0)
    || new Set(freshIds).size !== freshIds.length) {
    throw new Error('fresh surface identities must be non-empty and unique');
  }
  const remap = (surfaceId: string): string => {
    const fresh = oldToFresh.get(surfaceId);
    if (!fresh) throw new Error(`missing fresh identity for ${surfaceId}`);
    return fresh;
  };
  const next: WorkspaceTopologyV1 = {
    ...topology,
    surfaces: topology.surfaces.map((surface) => ({ ...surface, surfaceId: remap(surface.surfaceId) })),
    groups: topology.groups.map((group) => ({
      ...group,
      surfaceIds: group.surfaceIds.map(remap),
      activeSurfaceId: group.activeSurfaceId === null ? null : remap(group.activeSurfaceId),
    })),
  };
  assertValidWorkspaceTopology(next);
  return next;
}
import { z } from 'zod';
