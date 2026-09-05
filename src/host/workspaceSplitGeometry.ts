import type { WorkspaceLayoutNode } from '@shared/workspaceTopology';

export type WorkspacePreviewRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorkspaceMeasuredGroup = {
  outer: WorkspacePreviewRect;
  content: WorkspacePreviewRect;
};

function unionRect(a: WorkspacePreviewRect | undefined, b: WorkspacePreviewRect | undefined): WorkspacePreviewRect | undefined {
  if (!a) return b;
  if (!b) return a;
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: right - left, height: bottom - top };
}

function removeGroup(node: WorkspaceLayoutNode, groupId: string): WorkspaceLayoutNode | null {
  if (node.kind === 'group') return node.groupId === groupId ? null : node;
  const children: WorkspaceLayoutNode[] = [];
  const weights: number[] = [];
  node.children.forEach((child, index) => {
    const next = removeGroup(child, groupId);
    if (!next) return;
    children.push(next);
    weights.push(node.weights[index] ?? 1);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    kind: 'split',
    orientation: node.orientation,
    children,
    weights: total > 0 ? weights.map((weight) => weight / total) : children.map(() => 1 / children.length),
  };
}

function layoutRects(
  node: WorkspaceLayoutNode,
  rect: WorkspacePreviewRect,
  output: Map<string, WorkspacePreviewRect>,
): void {
  if (node.kind === 'group') {
    output.set(node.groupId, rect);
    return;
  }
  const total = node.weights.reduce((sum, weight) => sum + weight, 0);
  const weights = total > 0 ? node.weights.map((weight) => weight / total) : node.children.map(() => 1 / node.children.length);
  let offset = 0;
  node.children.forEach((child, index) => {
    const fraction = weights[index] ?? 0;
    const childRect = node.orientation === 'horizontal'
      ? { left: rect.left + offset, top: rect.top, width: rect.width * fraction, height: rect.height }
      : { left: rect.left, top: rect.top + offset, width: rect.width, height: rect.height * fraction };
    layoutRects(child, childRect, output);
    offset += node.orientation === 'horizontal' ? childRect.width : childRect.height;
  });
}

function collectGroupIds(node: WorkspaceLayoutNode, output: Set<string>): void {
  if (node.kind === 'group') {
    output.add(node.groupId);
    return;
  }
  node.children.forEach((child) => collectGroupIds(child, output));
}

/**
 * Returns the target group's predicted content rectangle after a singleton
 * source group is removed and its target group is left in place. The root
 * rectangle is reconstructed from the currently measured group rectangles;
 * this keeps the helper independent of Dockview and makes the preview testable.
 */
export function prospectiveTargetRectAfterSingletonRemoval(
  root: WorkspaceLayoutNode,
  sourceGroupId: string,
  targetGroupId: string,
  measuredGroups: ReadonlyMap<string, WorkspaceMeasuredGroup>,
): WorkspacePreviewRect | null {
  const source = measuredGroups.get(sourceGroupId);
  const target = measuredGroups.get(targetGroupId);
  if (!source || !target || sourceGroupId === targetGroupId) return target?.content ?? null;
  const requiredGroupIds = new Set<string>();
  collectGroupIds(root, requiredGroupIds);
  if ([...requiredGroupIds].some((groupId) => !measuredGroups.has(groupId))) return null;
  const rootRect = [...measuredGroups.values()].reduce<WorkspacePreviewRect | undefined>((current, measured) => unionRect(current, measured.outer), undefined);
  if (!rootRect) return null;
  const withoutSource = removeGroup(root, sourceGroupId);
  if (!withoutSource) return null;
  const predicted = new Map<string, WorkspacePreviewRect>();
  layoutRects(withoutSource, rootRect, predicted);
  const targetOuter = predicted.get(targetGroupId);
  if (!targetOuter) return null;
  const leftInset = target.content.left - target.outer.left;
  const topInset = target.content.top - target.outer.top;
  const rightInset = target.outer.left + target.outer.width - target.content.left - target.content.width;
  const bottomInset = target.outer.top + target.outer.height - target.content.top - target.content.height;
  const width = targetOuter.width - leftInset - rightInset;
  const height = targetOuter.height - topInset - bottomInset;
  if (width < 2 || height < 2 || ![leftInset, topInset, rightInset, bottomInset].every(Number.isFinite)) return null;
  return {
    left: targetOuter.left + leftInset,
    top: targetOuter.top + topInset,
    width,
    height,
  };
}

export function splitPreviewRect(base: WorkspacePreviewRect, position: 'top' | 'bottom' | 'left' | 'right'): WorkspacePreviewRect {
  const horizontal = position === 'left' || position === 'right';
  const size = horizontal ? base.width / 2 : base.height / 2;
  return {
    left: position === 'right' ? base.left + size : base.left,
    top: position === 'bottom' ? base.top + size : base.top,
    width: horizontal ? size : base.width,
    height: horizontal ? base.height : size,
  };
}
