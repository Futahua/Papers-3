import type { DockviewApi } from 'dockview-core';
import type { WorkspaceLayoutNode, WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { normalizeWorkspaceLayout } from '@shared/workspaceTopology';

type SerializedGridObject = {
  type: 'leaf' | 'branch';
  data: unknown;
  size?: number;
  visible?: boolean;
};

type SerializedGroup = { id: string; views: string[]; activeView?: string };

function groupDockviewId(api: DockviewApi, papersGroupId: string, surfaceIds: readonly string[], mapping: ReadonlyMap<string, string>, used: ReadonlySet<string>): string {
  const existing = mapping.get(papersGroupId);
  if (existing && api.groups.some((group) => group.id === existing)) return existing;
  const matching = api.groups.find((group) => !used.has(group.id) && group.panels.some((panel) => surfaceIds.includes(panel.id)));
  if (matching) return matching.id;
  const base = papersGroupId;
  if (!api.groups.some((group) => group.id === base) && !used.has(base)) return base;
  let suffix = 1;
  while (api.groups.some((group) => group.id === `${base}-dock-${suffix}`) || used.has(`${base}-dock-${suffix}`)) suffix += 1;
  return `${base}-dock-${suffix}`;
}

export function serializedRootForTopology(
  api: DockviewApi,
  topology: WorkspaceTopologyV1,
  mapping: ReadonlyMap<string, string>,
  existing: ReturnType<DockviewApi['toJSON']>,
): ReturnType<DockviewApi['toJSON']>['grid']['root'] {
  const byGroup = new Map(topology.groups.map((group) => [group.groupId, group]));
  const usedDockviewIds = new Set<string>();
  const convert = (node: WorkspaceLayoutNode): SerializedGridObject => {
    if (node.kind === 'group') {
      const group = byGroup.get(node.groupId);
      if (!group) throw new Error(`Canonical group missing for ${node.groupId}`);
      const dockviewId = groupDockviewId(api, node.groupId, group.surfaceIds, mapping, usedDockviewIds);
      usedDockviewIds.add(dockviewId);
    const data: SerializedGroup = {
      id: dockviewId,
      views: [...group.surfaceIds],
      ...(group.activeSurfaceId ? { activeView: group.activeSurfaceId } : {}),
    };
      return { type: 'leaf', data, size: 1 };
    }
    const children = node.children.map((child, index) => {
      const converted = convert(child);
      return { ...converted, size: node.weights[index] ?? converted.size ?? 1 };
    });
    return { type: 'branch', data: children, size: children.reduce((sum, child) => sum + (child.size ?? 1), 0) };
  };
  return convert(normalizeWorkspaceLayout(topology.root)) as ReturnType<DockviewApi['toJSON']>['grid']['root'];
}

/** Convert Dockview's alternating grid tree back to Papers' explicit geometry tree. */
export function workspaceRootFromDockview(
  api: DockviewApi,
  topology: WorkspaceTopologyV1,
  mapping: ReadonlyMap<string, string>,
): WorkspaceLayoutNode {
  const serialized = api.toJSON();
  const dockToPapers = new Map<string, string>();
  for (const [papersId, dockviewId] of mapping) dockToPapers.set(dockviewId, papersId);
  const orientation = serialized.grid.orientation === 'VERTICAL' ? 'vertical' : 'horizontal';
  const convert = (node: any, axis: 'horizontal' | 'vertical'): WorkspaceLayoutNode => {
    if (node.type === 'leaf') {
      const dockviewId = node.data?.id;
      const groupId = typeof dockviewId === 'string' ? dockToPapers.get(dockviewId) : undefined;
      if (!groupId) throw new Error(`Dockview layout references unknown group ${String(dockviewId)}`);
      return { kind: 'group', groupId };
    }
    if (node.type !== 'branch' || !Array.isArray(node.data) || node.data.length < 2) {
      throw new Error('Dockview layout contains an invalid grid node');
    }
    const children = node.data.map((child: any) => convert(child, axis === 'horizontal' ? 'vertical' : 'horizontal'));
    const rawWeights = node.data.map((child: any) => Number(child.size));
    const weights = rawWeights.every((size: number) => Number.isFinite(size) && size > 0)
      ? rawWeights
      : rawWeights.map(() => 1);
    const total = weights.reduce((sum: number, size: number) => sum + size, 0);
    return {
      kind: 'split',
      orientation: axis,
      children,
      weights: weights.map((size: number) => size / total),
    };
  };
  const root = normalizeWorkspaceLayout(convert(serialized.grid.root, orientation));
  const known = new Set(topology.groups.map((group) => group.groupId));
  const seen = new Set<string>();
  const visit = (node: WorkspaceLayoutNode): void => {
    if (node.kind === 'group') { seen.add(node.groupId); return; }
    node.children.forEach(visit);
  };
  visit(root);
  if (seen.size !== known.size || [...known].some((groupId) => !seen.has(groupId))) {
    throw new Error('Dockview layout does not contain every canonical workspace group');
  }
  return root;
}
