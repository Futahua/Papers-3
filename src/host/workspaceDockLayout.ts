import type { DockviewApi } from 'dockview-core';
import type { WorkspaceLayoutNode, WorkspaceTopologyV1 } from '@shared/workspaceTopology';

type SerializedGridObject = {
  type: 'leaf' | 'branch';
  data: unknown;
  size?: number;
  visible?: boolean;
};

type SerializedGroup = { id: string; views: string[]; activeView?: string };

function groupDockviewId(api: DockviewApi, papersGroupId: string, surfaceIds: readonly string[], mapping: ReadonlyMap<string, string>): string | undefined {
  const existing = mapping.get(papersGroupId);
  if (existing && api.groups.some((group) => group.id === existing)) return existing;
  return api.groups.find((group) => group.panels.some((panel) => surfaceIds.includes(panel.id)))?.id;
}

export function serializedRootForTopology(
  api: DockviewApi,
  topology: WorkspaceTopologyV1,
  mapping: ReadonlyMap<string, string>,
  existing: ReturnType<DockviewApi['toJSON']>,
): ReturnType<DockviewApi['toJSON']>['grid']['root'] {
  const byGroup = new Map(topology.groups.map((group) => [group.groupId, group]));
  const convert = (node: WorkspaceLayoutNode): SerializedGridObject => {
    if (node.kind === 'group') {
      const group = byGroup.get(node.groupId);
      if (!group) throw new Error(`Canonical group missing for ${node.groupId}`);
      const dockviewId = groupDockviewId(api, node.groupId, group.surfaceIds, mapping);
      if (!dockviewId) throw new Error(`Dockview group missing for ${node.groupId}`);
      const current = existing.panels[dockviewId];
      const data: SerializedGroup = {
        id: dockviewId,
        views: [...group.surfaceIds],
        ...(group.activeSurfaceId ? { activeView: group.activeSurfaceId } : {}),
      };
      return { type: 'leaf', data: current ? { ...current, ...data } : data, size: 1 };
    }
    const children = node.children.map((child, index) => {
      const converted = convert(child);
      return { ...converted, size: node.weights[index] ?? converted.size ?? 1 };
    });
    return { type: 'branch', data: children, size: children.reduce((sum, child) => sum + (child.size ?? 1), 0) };
  };
  return convert(topology.root) as ReturnType<DockviewApi['toJSON']>['grid']['root'];
}
