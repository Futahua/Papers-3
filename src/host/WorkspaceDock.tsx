import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type PositionResolver,
} from 'dockview-react';
import { Orientation } from 'dockview-core';
import 'dockview-react/dist/styles/dockview.css';

import { BackpackProjectFrame } from './BackpackProjectFrame';
import type { HostOverlayOwner } from './bridge';
import type { WorkspaceLayoutNode, WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { rebuildWorkspaceGroupMap } from './workspaceGroupMapping';
import { createWorkspaceReconciliationFeedbackGate } from './workspaceReconciliationFeedback';
import { serializedRootForTopology, workspaceRootFromDockview } from './workspaceDockLayout';

export interface OpenWorkspaceProject {
  surfaceId: string;
  projectId: string;
  title: string;
  url: string;
}

interface WorkspacePanelParams {
  surfaceId: string;
  url: string;
}

type SplitEdge = 'top' | 'bottom' | 'left' | 'right';
type PreviewRect = { left: number; top: number; width: number; height: number };
type SplitPreview = {
  position: SplitEdge;
  allowed: true;
  armed: boolean;
  message: string;
  targetGroupId: string;
  rect: PreviewRect;
};
type ArmedSplitCandidate = { surfaceId: string; position: SplitEdge; targetGroupId: string; generation: number };

type WorkspaceGroupSurface = { element: HTMLElement };

export function resolveContentSplitEdge(
  position: SplitEdge | 'center',
  sourceGroup: WorkspaceGroupSurface | undefined,
  targetGroup: WorkspaceGroupSurface | undefined,
  nativeEvent?: Event,
): SplitEdge {
  if (position !== 'center') return position;
  const targetRect = targetGroup?.element.getBoundingClientRect();
  const sourceRect = sourceGroup?.element.getBoundingClientRect();
  if (targetRect && sourceRect && targetRect.width > 1 && targetRect.height > 1) {
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const dx = (sourceCenterX - targetCenterX) / targetRect.width;
    const dy = (sourceCenterY - targetCenterY) / targetRect.height;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 0.01) return dx > 0 ? 'right' : 'left';
    if (Math.abs(dy) > 0.01) return dy > 0 ? 'bottom' : 'top';
    if (nativeEvent && 'clientX' in nativeEvent && 'clientY' in nativeEvent) {
      const clientX = Number(nativeEvent.clientX);
      const clientY = Number(nativeEvent.clientY);
      const pointerDx = (clientX - targetCenterX) / targetRect.width;
      const pointerDy = (clientY - targetCenterY) / targetRect.height;
      if (Math.abs(pointerDx) >= Math.abs(pointerDy)) return pointerDx >= 0 ? 'right' : 'left';
      return pointerDy >= 0 ? 'bottom' : 'top';
    }
  }
  return 'right';
}

export function isCurrentArmedSplitCandidate(
  candidate: ArmedSplitCandidate | null,
  tuple: Pick<ArmedSplitCandidate, 'surfaceId' | 'position' | 'targetGroupId'>,
  currentGeneration: number,
): boolean {
  return Boolean(candidate
    && candidate.generation === currentGeneration
    && candidate.surfaceId === tuple.surfaceId
    && candidate.position === tuple.position
    && candidate.targetGroupId === tuple.targetGroupId);
}

const resolveWorkspaceDropPosition: PositionResolver = {
  resolve: ({ x, y, width, height, zones }) => {
    const xBand = Math.min(180, Math.max(72, width * 0.22));
    const yBand = Math.min(160, Math.max(72, height * 0.2));
    if (zones.has('left') && x <= xBand) return { position: 'left' };
    if (zones.has('right') && x >= width - xBand) return { position: 'right' };
    if (zones.has('top') && y <= yBand) return { position: 'top' };
    if (zones.has('bottom') && y >= height - yBand) return { position: 'bottom' };
    return zones.has('center') ? { position: 'center' } : null;
  },
};

function WorkspacePanel(props: IDockviewPanelProps<WorkspacePanelParams>): React.JSX.Element {
  const { params, api } = props;
  const [visible, setVisible] = useState(api.isVisible);
  useEffect(() => {
    setVisible(api.isVisible);
    const disposable = api.onDidVisibilityChange((event) => setVisible(event.isVisible));
    return () => disposable.dispose();
  }, [api]);
  return (
    <BackpackProjectFrame
      url={params.url}
      surfaceId={params.surfaceId}
      visible={visible}
    />
  );
}

export function WorkspaceDock(props: {
  projects: OpenWorkspaceProject[];
  topology: WorkspaceTopologyV1;
  activeSurfaceId: string | null;
  onActivate: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: 'right' | 'down', position?: 'before' | 'after', targetGroupId?: string) => string | void;
  onMove: (surfaceId: string, targetGroupId: string, targetIndex: number) => void;
  onOverlayActiveChange?: (active: boolean, owner?: HostOverlayOwner) => void | Promise<void>;
  splitNotice?: { id: number; message: string } | null;
  interactionDisabled?: boolean;
  onCommitLayout: (snapshot: {
    groups: Array<{ groupId: string; surfaceIds: string[] }>;
    root?: WorkspaceLayoutNode;
    rootWeights?: number[];
  }) => void;
}): React.JSX.Element {
  const { projects, topology, activeSurfaceId, onActivate, onClose, onSplit, onMove, onOverlayActiveChange, splitNotice, onCommitLayout,
    interactionDisabled = false } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const projectsRef = useRef(projects);
  const topologyRef = useRef(topology);
  const synchronizingRemovals = useRef(new Set<string>());
  const disposing = useRef(false);
  const groupIds = useRef(new Map<string, string>());
  const apiSubscriptions = useRef<Array<{ dispose(): void }>>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const reconciliationFeedback = useRef(createWorkspaceReconciliationFeedbackGate());
  const resizing = useRef(false);
  const resizeSession = useRef<{ pointerId: number; generation: number; terminal: 'active' | 'success' | 'cancelled'; focusedGroupId: string; activeByGroup: Map<string, string | null>; captureTarget: HTMLElement | null } | null>(null);
  const resizeUiGeneration = useRef(0);
  const finishResizeRef = useRef<((cancelled?: boolean) => void) | null>(null);
  const [resizeActive, setResizeActive] = useState(false);
  const sideDrop = useRef<{ surfaceId: string; position: SplitEdge; targetGroupId: string } | null>(null);
  const previewRef = useRef<SplitPreview | null>(null);
  const previewCandidate = useRef<{ surfaceId: string; position: SplitEdge; targetGroupId: string; generation: number; rect: PreviewRect } | null>(null);
  const armedCandidate = useRef<ArmedSplitCandidate | null>(null);
  const previewGeneration = useRef(0);
  const dragActive = useRef(false);
  const pointerDragCleanup = useRef<(() => void) | null>(null);
  const dragSessionGeneration = useRef(0);
  const hostRaised = useRef(false);
  const statusTimer = useRef<number | null>(null);
  const statusKey = useRef<string | null>(null);
  const statusGeneration = useRef(0);
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [dragStatus, setDragStatus] = useState<string | null>(null);
  const interactionDisabledRef = useRef(false);
  projectsRef.current = projects;
  topologyRef.current = topology;
  interactionDisabledRef.current = interactionDisabled;

  const setHostOverlay = useCallback((active: boolean, owner: HostOverlayOwner = 'workspace-drag'): void => {
    void onOverlayActiveChange?.(active, owner);
  }, [onOverlayActiveChange]);

  const setDragSurfaceActive = useCallback((active: boolean): void => {
    document.documentElement.dataset.workspaceDrag = active ? 'true' : 'false';
  }, []);

  const measureSplitRect = useCallback((group: { element: HTMLElement }, position: SplitEdge): PreviewRect | null => {
    const workspace = workspaceRef.current;
    const content = group.element.querySelector<HTMLElement>(':scope > .dv-content-container')
      ?? group.element.querySelector<HTMLElement>('.dv-content-container');
    if (!workspace || !content) return null;
    const workspaceBox = workspace.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    if (contentBox.width < 2 || contentBox.height < 2 || workspaceBox.width < 2 || workspaceBox.height < 2) return null;
    const half = position === 'left' || position === 'right' ? contentBox.width / 2 : contentBox.height / 2;
    const viewport = {
      left: position === 'right' ? contentBox.left + half : contentBox.left,
      top: position === 'bottom' ? contentBox.top + half : contentBox.top,
      width: position === 'left' || position === 'right' ? half : contentBox.width,
      height: position === 'top' || position === 'bottom' ? half : contentBox.height,
    };
    return {
      left: Math.max(0, viewport.left - workspaceBox.left),
      top: Math.max(0, viewport.top - workspaceBox.top),
      width: Math.max(0, Math.min(viewport.width, workspaceBox.right - viewport.left)),
      height: Math.max(0, Math.min(viewport.height, workspaceBox.bottom - viewport.top)),
    };
  }, []);

  const setHostOverlayAwaited = useCallback((active: boolean, guard?: () => boolean, owner: HostOverlayOwner = 'workspace-drag'): Promise<void> => {
    return Promise.resolve(onOverlayActiveChange?.(active, owner)).then(() => {
      if (!guard || guard()) hostRaised.current = active;
    });
  }, [onOverlayActiveChange]);

  const clearPreview = useCallback((releaseHost = true): void => {
    previewGeneration.current += 1;
    previewCandidate.current = null;
    armedCandidate.current = null;
    previewRef.current = null;
    setPreview(null);
    if (releaseHost && !dragActive.current) {
      hostRaised.current = false;
      setHostOverlay(false);
    }
  }, [setHostOverlay]);

  const clearDragStatus = useCallback((): void => {
    statusGeneration.current += 1;
    statusKey.current = null;
    if (statusTimer.current !== null) {
      window.clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
    setDragStatus(null);
  }, []);

  // A successful semantic split is a terminal drag boundary in its own
  // right. Dockview may not emit dragend/drop/pointerup after the topology
  // mutation, so release every drag-owned resource explicitly here. This is
  // idempotent and safe to call from any success path.
  const finishSuccessfulDrop = useCallback((): void => {
    pointerDragCleanup.current?.();
    pointerDragCleanup.current = null;
    dragActive.current = false;
    dragSessionGeneration.current += 1;
    setDragSurfaceActive(false);
    sideDrop.current = null;
    clearPreview();
    clearDragStatus();
  }, [clearDragStatus, clearPreview, setDragSurfaceActive]);

  const showPreview = useCallback((next: SplitPreview): void => {
    previewRef.current = next;
    setPreview(next);
  }, []);

  const showRejected = useCallback((position: SplitEdge, message: string): void => {
    const nextStatusKey = `${dragSessionGeneration.current}:${position}:${message}`;
    if (statusKey.current === nextStatusKey) return;
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusKey.current = nextStatusKey;
    const statusId = ++statusGeneration.current;
    const statusSession = dragSessionGeneration.current;
    const generation = ++previewGeneration.current;
    previewCandidate.current = null;
    armedCandidate.current = null;
    sideDrop.current = null;
    previewRef.current = null;
    setPreview(null);
    setDragStatus(null);
    // A rejection can arrive after normal drag cleanup. Await the host raise
    // before displaying or timing the status so it stays above native project
    // WebContentsViews for its brief, fadeaway interval.
    void setHostOverlayAwaited(true, () => previewGeneration.current === generation
      && !previewCandidate.current).then(() => {
      if (previewGeneration.current !== generation || statusGeneration.current !== statusId) return;
      setDragStatus(message);
      statusTimer.current = window.setTimeout(() => {
        if (statusGeneration.current !== statusId) return;
        statusTimer.current = null;
        setDragStatus(null);
        // Keyboard and post-drag rejections temporarily raise the host so the
        // warning is visible above native project views. Release that lease
        // when this warning expires, but never steal a lease from a newer drag
        // or lower the host during an active tab drag.
        if (!dragActive.current && dragSessionGeneration.current === statusSession) {
          hostRaised.current = false;
          setHostOverlay(false);
        }
      }, 1100);
    });
  }, [setHostOverlay, setHostOverlayAwaited]);

  useEffect(() => {
    if (splitNotice) showRejected('right', splitNotice.message);
  }, [showRejected, splitNotice?.id]);

  useEffect(() => {
    disposing.current = false;
    return () => {
      disposing.current = true;
      apiSubscriptions.current.splice(0).forEach((subscription) => subscription.dispose());
    };
  }, []);

  const refreshGroupIds = useCallback((api: DockviewApi): void => {
    groupIds.current = rebuildWorkspaceGroupMap(
      groupIds.current,
      api.groups.map((group) => ({ id: group.id, panelIds: group.panels.map((panel) => panel.id) })),
      topologyRef.current.groups,
    );
  }, []);

  const commitLayout = useCallback((api: DockviewApi): void => {
    refreshGroupIds(api);
    const groups = api.groups.flatMap((group) => {
      const groupId = groupIds.current.get(group.id);
      return groupId ? [{ groupId, surfaceIds: group.panels.map((panel) => panel.id) }] : [];
    });
    let root: WorkspaceLayoutNode | undefined;
    try { root = workspaceRootFromDockview(api, topologyRef.current, new Map([...groupIds.current].map(([dockviewId, papersId]) => [papersId, dockviewId]))); }
    catch { root = undefined; }
    let rootWeights: number[] | undefined;
    const canonicalRoot = topologyRef.current.root;
    if (canonicalRoot.kind === 'split' && canonicalRoot.children.every((child) => child.kind === 'group')) {
      const byPapersId = new Map([...groupIds.current].map(([dockviewId, papersId]) => [papersId, dockviewId]));
      const sizes = canonicalRoot.children.map((child) => {
        if (child.kind !== 'group') return 0;
        const dockviewId = byPapersId.get(child.groupId);
        const group = dockviewId ? api.groups.find((candidate) => candidate.id === dockviewId) : undefined;
        return canonicalRoot.orientation === 'horizontal' ? group?.api.width ?? 0 : group?.api.height ?? 0;
      });
      if (sizes.every((size) => size > 0)) {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        rootWeights = sizes.map((size) => size / total);
      }
    }
    onCommitLayout({ groups, ...(root ? { root } : {}), ...(rootWeights ? { rootWeights } : {}) });
  }, [onCommitLayout, refreshGroupIds]);

  const reconcileFromTopology = useCallback((api: DockviewApi): void => {
    refreshGroupIds(api);
    const desired = topologyRef.current;
    const desiredGroups = desired.groups;
    const splitRoot = desired.root.kind === 'split' ? desired.root : null;
    const mutate = (operation: () => void): void => {
      reconciliationFeedback.current.apply(operation);
    };
    const hasNestedLayout = desired.root.kind === 'split'
      && desired.root.children.some((child) => child.kind === 'split');
    let twoGroupShapeMismatch = false;
    if (desired.root.kind === 'split' && desiredGroups.length === 2 && api.groups.length === 2) {
      try {
        const live = api.toJSON();
        const expectedOrientation = desired.root.orientation === 'vertical' ? Orientation.VERTICAL : Orientation.HORIZONTAL;
        const liveRoot = live.grid.root as { type?: string; data?: Array<{ type?: string; data?: { id?: string } }> };
        const expectedIds = desired.root.children.map((child) => child.kind === 'group'
          ? [...groupIds.current].find(([, papersId]) => papersId === child.groupId)?.[0]
          : undefined);
        const liveIds = liveRoot.type === 'branch' && Array.isArray(liveRoot.data)
          ? liveRoot.data.map((child) => child.data?.id)
          : [];
        twoGroupShapeMismatch = live.grid.orientation !== expectedOrientation
          || liveIds.length !== expectedIds.length
          || expectedIds.some((id, index) => id === undefined || liveIds[index] !== id);
      } catch { twoGroupShapeMismatch = true; }
    }
    const needsRecursiveProjection = desiredGroups.length > 2 || hasNestedLayout
      || api.groups.length < desiredGroups.length || twoGroupShapeMismatch;
    if (needsRecursiveProjection) {
      try {
        const current = api.toJSON();
        const canonicalToDockview = new Map([...groupIds.current].map(([dockviewId, papersGroupId]) => [papersGroupId, dockviewId]));
        const root = serializedRootForTopology(api, desired, canonicalToDockview, current);
        const orientation: typeof current.grid.orientation = desired.root.kind === 'split'
          ? desired.root.orientation === 'vertical' ? Orientation.VERTICAL : Orientation.HORIZONTAL
          : current.grid.orientation;
        mutate(() => api.fromJSON({ ...current, grid: { ...current.grid, root, orientation } }, { reuseExistingPanels: true }));
        refreshGroupIds(api);
        const focused = desiredGroups.find((group) => group.groupId === desired.focusedGroupId);
        const focusedPanel = focused?.activeSurfaceId ? api.getPanel(focused.activeSurfaceId) : undefined;
        if (focusedPanel) mutate(() => focusedPanel.api.setActive());
      } catch {
        // Keep the existing live projection intact if Dockview rejects a
        // serialized shape; the canonical topology remains authoritative and
        // the next external reconciliation will retry.
      }
      return;
    }
    const firstSplitGroupId = splitRoot && splitRoot.children[0]?.kind === 'group'
      ? splitRoot.children[0].groupId
      : null;

    const dockGroupFor = (papersGroupId: string) => {
      const dockviewId = [...groupIds.current].find(([, id]) => id === papersGroupId)?.[0];
      return dockviewId ? api.groups.find((group) => group.id === dockviewId) : undefined;
    };

    if (splitRoot && firstSplitGroupId && desiredGroups.length === 2) {
      const second = desiredGroups.find((group) => group.groupId !== firstSplitGroupId)!;
      if (!dockGroupFor(second.groupId)) {
        const panel = api.getPanel(second.surfaceIds[0]!);
        const reference = dockGroupFor(firstSplitGroupId);
        if (panel && reference) {
          mutate(() => panel.api.moveTo({
            group: reference,
            position: splitRoot.orientation === 'horizontal' ? 'right' : 'bottom',
          }));
          groupIds.current.set(panel.group.id, second.groupId);
        }
      }
    }

    for (const group of desiredGroups) {
      let target = dockGroupFor(group.groupId);
      if (!target && desiredGroups.length === 1) target = api.groups[0];
      if (!target) continue;
      group.surfaceIds.forEach((surfaceId, index) => {
        const panel = api.getPanel(surfaceId);
        if (!panel) return;
        const currentIndex = target!.panels.findIndex((candidate) => candidate.id === surfaceId);
        if (panel.group.id !== target!.id || currentIndex !== index) {
          mutate(() => panel.api.moveTo({ group: target, position: 'center', index, skipSetActive: true }));
        }
      });
      const active = group.activeSurfaceId ? api.getPanel(group.activeSurfaceId) : undefined;
      if (active && target.activePanel?.id !== active.id) mutate(() => active.api.setActive());
    }

    const focused = desiredGroups.find((group) => group.groupId === desired.focusedGroupId);
    const focusedPanel = focused?.activeSurfaceId ? api.getPanel(focused.activeSurfaceId) : undefined;
    if (focusedPanel && api.activePanel?.id !== focusedPanel.id) mutate(() => focusedPanel.api.setActive());

    if (splitRoot && firstSplitGroupId) {
      const first = dockGroupFor(firstSplitGroupId);
      const weight = splitRoot.weights[0];
      const total = splitRoot.orientation === 'horizontal' ? api.width : api.height;
      const current = splitRoot.orientation === 'horizontal' ? first?.api.width : first?.api.height;
      const targetSize = total * (weight ?? 0);
      if (first && current !== undefined && total > 0 && Math.abs(current - targetSize) > 2) {
        mutate(() => first.api.setSize(splitRoot.orientation === 'horizontal'
          ? { width: Math.round(targetSize) }
          : { height: Math.round(targetSize) }));
      }
    }

  }, [refreshGroupIds]);

  useEffect(() => {
    const finishResize = (cancelled = false): void => {
      const session = resizeSession.current;
      if (!resizing.current || !session) return;
      if (cancelled) session.terminal = 'cancelled';
      if (cancelled && typeof PointerEvent !== 'undefined') {
        // Dockview owns a document-level sash session of its own. Deliver a
        // real terminal before releasing our capture so its old handler cannot
        // continue applying stale geometry after a remote reconcile.
        try {
          session.captureTarget?.dispatchEvent(new PointerEvent('pointercancel', {
            bubbles: true, cancelable: true, pointerId: session.pointerId,
          }));
        } catch { /* the browser may already have torn down the target */ }
      }
      resizing.current = false;
      resizeSession.current = null;
      try { session.captureTarget?.releasePointerCapture(session.pointerId); } catch { /* capture may already be released */ }
      const api = apiRef.current;
      if (api) {
        for (const [groupId, activeSurfaceId] of session.activeByGroup) {
          const dockviewId = [...groupIds.current].find(([, papersId]) => papersId === groupId)?.[0];
          const panel = activeSurfaceId ? api.getPanel(activeSurfaceId) : undefined;
          if (dockviewId && panel && panel.group.id !== dockviewId) continue;
          if (panel && panel.group.activePanel?.id !== panel.id) reconciliationFeedback.current.apply(() => panel.api.setActive());
        }
        const focusedSurfaceId = session.activeByGroup.get(session.focusedGroupId);
        const focusedPanel = focusedSurfaceId ? api.getPanel(focusedSurfaceId) : undefined;
        if (focusedPanel && api.activePanel?.id !== focusedPanel.id) {
          reconciliationFeedback.current.apply(() => focusedPanel.api.setActive());
        }
        if (cancelled) reconcileFromTopology(api);
        else commitLayout(api);
      }
      const generation = session.generation;
      void setHostOverlayAwaited(false, () => true, 'workspace-resize').then(() => {
        if (resizeUiGeneration.current === generation && !resizeSession.current) {
          setResizeActive(false);
          document.documentElement.dataset.workspaceResize = 'false';
        }
      }, () => {
        // Remain fail-closed when owner release is uncertain.
      });
    };
    finishResizeRef.current = finishResize;
    const onPointerUp = (event: PointerEvent): void => {
      const session = resizeSession.current;
      if (session?.pointerId === event.pointerId && session.terminal === 'active') {
        session.terminal = 'success';
        const generation = session.generation;
        window.setTimeout(() => {
          if (resizeSession.current?.generation === generation) finishResize();
        }, 0);
      }
    };
    const onPointerCancel = (event: PointerEvent): void => {
      const session = resizeSession.current;
      if (session?.pointerId === event.pointerId && session.terminal === 'active') {
        session.terminal = 'cancelled';
        const generation = session.generation;
        window.setTimeout(() => {
          if (resizeSession.current?.generation === generation) finishResize(true);
        }, 0);
      }
    };
    const onBlur = (): void => {
      const session = resizeSession.current;
      if (session?.terminal === 'active') { session.terminal = 'cancelled'; finishResize(true); }
    };
    const onLostPointerCapture = (event: PointerEvent): void => {
      const session = resizeSession.current;
      if (session?.pointerId === event.pointerId && session.terminal === 'active') {
        session.terminal = 'cancelled';
        finishResize(true);
      }
    };
    const onContextMenu = (): void => {
      const session = resizeSession.current;
      if (session?.terminal === 'active') { session.terminal = 'cancelled'; finishResize(true); }
    };
    const onMouseUp = (event: MouseEvent): void => {
      const session = resizeSession.current;
      const target = event.target;
      // Chromium normally delivers pointerup, but retain a narrowly scoped
      // legacy fallback for Dockview's mouse backend.  An unrelated mouseup
      // outside the captured workspace is never allowed to terminate a newer
      // resize session.
      if (session && event.button === 0 && target instanceof Node && session.captureTarget?.contains(target)
        && session.terminal === 'active') {
        session.terminal = 'success';
        finishResize();
      }
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    return () => {
      finishResize(true);
      finishResizeRef.current = null;
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [commitLayout, reconcileFromTopology, setHostOverlay]);

  const consumePendingSplit = useCallback((): void => {
    const pending = sideDrop.current;
    const api = apiRef.current;
    if (!pending || !api || interactionDisabledRef.current || resizing.current) return;
    const armed = previewRef.current;
    const remembered = armedCandidate.current;
    const dropWasArmed = Boolean(armed?.allowed && armed.armed && armed.position === pending.position && armed.targetGroupId === pending.targetGroupId)
      || isCurrentArmedSplitCandidate(remembered, pending, previewGeneration.current);
    if (!dropWasArmed) {
      sideDrop.current = null;
      previewGeneration.current += 1;
      previewCandidate.current = null;
      showRejected(pending.position, 'Split cancelled — preview was not armed');
      return;
    }
    sideDrop.current = null;
    const panel = api.getPanel(pending.surfaceId);
    const destinationDockviewId = panel?.group.id;
    if (!panel || !destinationDockviewId || !pending.targetGroupId) {
      reconcileFromTopology(api);
      showRejected(pending.position, 'Split cancelled — workspace changed');
      return;
    }
    const direction = pending.position === 'left' || pending.position === 'right' ? 'right' : 'down';
    const position = pending.position === 'left' || pending.position === 'top' ? 'before' : 'after';
    const newGroupId = onSplit(pending.surfaceId, direction, position, pending.targetGroupId);
    if (newGroupId) {
      groupIds.current.set(destinationDockviewId, newGroupId);
      finishSuccessfulDrop();
    }
  }, [finishSuccessfulDrop, onSplit, reconcileFromTopology, showRejected]);

  const finishDrop = useCallback((): void => {
      if (!dragActive.current && !previewRef.current && !sideDrop.current) return;
      pointerDragCleanup.current?.();
      pointerDragCleanup.current = null;
      dragActive.current = false;
      dragSessionGeneration.current += 1;
      setDragSurfaceActive(false);
      const current = previewRef.current;
      if (current?.allowed) clearPreview();
      else if (current) showRejected(current.position, current.message);
      else if (current) clearPreview();
      else clearPreview();
  }, [clearPreview, setDragSurfaceActive, showRejected]);

  useEffect(() => {
    window.addEventListener('dragend', finishDrop);
    window.addEventListener('drop', finishDrop);
    window.addEventListener('blur', finishDrop);
    return () => {
      window.removeEventListener('dragend', finishDrop);
      window.removeEventListener('drop', finishDrop);
      window.removeEventListener('blur', finishDrop);
      pointerDragCleanup.current?.();
      pointerDragCleanup.current = null;
      dragActive.current = false;
      dragSessionGeneration.current += 1;
      setDragSurfaceActive(false);
      clearPreview();
      clearDragStatus();
    };
  }, [clearDragStatus, clearPreview, finishDrop, setDragSurfaceActive]);

  const components = useMemo(() => ({ workspace: WorkspacePanel }), []);
  const addMissingPanels = useCallback((api: DockviewApi): void => {
    for (const project of projectsRef.current) {
      if (api.getPanel(project.surfaceId)) continue;
      api.addPanel<WorkspacePanelParams>({
        id: project.surfaceId,
        component: 'workspace',
        title: project.title,
        renderer: 'onlyWhenVisible',
        params: {
          surfaceId: project.surfaceId,
          url: project.url,
        },
      });
    }
  }, [onClose]);

  const syncPanelTitles = useCallback((api: DockviewApi): void => {
    for (const project of projectsRef.current) {
      const panel = api.getPanel(project.surfaceId);
      if (!panel) continue;
      if (panel.api.title !== project.title) panel.api.setTitle(project.title);
      const tab = workspaceRef.current?.querySelector<HTMLElement>(
        `.dv-tab[data-tab-panel-id="${CSS.escape(project.surfaceId)}"]`,
      );
      if (tab) {
        tab.setAttribute('title', project.title);
        tab.setAttribute('aria-label', project.title);
      }
    }
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent): void => {
    apiRef.current = event.api;
    addMissingPanels(event.api);
    syncPanelTitles(event.api);
    refreshGroupIds(event.api);
    // Empty header space must never pick up an entire group.
    apiSubscriptions.current.push(event.api.onWillDragGroup(({ nativeEvent }) => {
      nativeEvent.preventDefault();
    }));
    apiSubscriptions.current.push(event.api.onDidActivePanelChange(({ panel, origin }) => {
      if (resizing.current) {
        const frozen = panel ? resizeSession.current?.activeByGroup.get(groupIds.current.get(panel.group.id) ?? '') : null;
        if (panel && frozen && frozen !== panel.id) {
          const expected = event.api.getPanel(frozen);
          if (expected) reconciliationFeedback.current.apply(() => expected.api.setActive());
        }
        return;
      }
      if (panel && !interactionDisabledRef.current && !reconciliationFeedback.current.isSuppressed() && origin !== 'api') onActivate(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidRemovePanel((panel) => {
      if (disposing.current) return;
      if (synchronizingRemovals.current.delete(panel.id)) return;
      onClose(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidMovePanel(({ panel, to }) => {
      if (resizing.current) return;
      if (reconciliationFeedback.current.isSuppressed()) return;
      // Dockview's provisional side move is only the visual half of a
      // semantic split. The guarded sideDrop consumer owns its canonical
      // mutation; never persist that transient group move as an ordinary
      // cross-group reorder first.
      if (sideDrop.current?.surfaceId === panel.id) return;
      const targetGroupId = groupIds.current.get(to.id);
      if (!targetGroupId) return;
      const targetIndex = to.panels.findIndex((candidate) => candidate.id === panel.id);
      if (targetIndex >= 0 && !interactionDisabledRef.current) onMove(panel.id, targetGroupId, targetIndex);
    }));
    apiSubscriptions.current.push(event.api.onDidMutateLayout(({ origin }) => {
      if (origin === 'api' || reconciliationFeedback.current.isSuppressed()) return;
      const pending = sideDrop.current;
      if (pending) {
        sideDrop.current = null;
        const armed = previewRef.current;
        const remembered = armedCandidate.current;
        const dropWasArmed = Boolean(armed?.allowed && armed.armed && armed.position === pending.position && armed.targetGroupId === pending.targetGroupId)
          || isCurrentArmedSplitCandidate(remembered, pending, previewGeneration.current);
        if (!dropWasArmed) {
          showRejected(pending.position, 'Split cancelled — preview was not armed');
          return;
        }
        if (interactionDisabledRef.current || resizing.current) {
          reconcileFromTopology(event.api);
          showRejected(pending.position, 'Split cancelled — workspace is busy');
          setHostOverlay(true);
          return;
        }
        const panel = event.api.getPanel(pending.surfaceId);
        const destinationDockviewId = panel?.group.id;
        if (!panel || !destinationDockviewId || !pending.targetGroupId) {
          reconcileFromTopology(event.api);
          showRejected(pending.position, 'Split cancelled — workspace changed');
          setHostOverlay(true);
          return;
        }
        const direction = pending.position === 'left' || pending.position === 'right' ? 'right' : 'down';
        const position = pending.position === 'left' || pending.position === 'top' ? 'before' : 'after';
        const newGroupId = onSplit(pending.surfaceId, direction, position, pending.targetGroupId);
        if (newGroupId) {
          groupIds.current.set(destinationDockviewId, newGroupId);
          finishSuccessfulDrop();
        }
        else reconcileFromTopology(event.api);
        return;
      }
      if (interactionDisabledRef.current || resizing.current) return;
      commitLayout(event.api);
    }));
    apiSubscriptions.current.push(event.api.onDidLayoutChange(() => {
      if (!interactionDisabledRef.current && !resizing.current && !reconciliationFeedback.current.isSuppressed()) commitLayout(event.api);
    }));
    apiSubscriptions.current.push(event.api.onWillShowOverlay((overlay) => {
      if (overlay.kind === 'edge') {
        // Dockview's root-layout edge is not a Papers split target. It can be
        // re-emitted after a group-content edge has armed; ignore it without
        // touching the current group-local candidate or visual rectangle.
        overlay.preventDefault();
        return;
      }
      if (overlay.kind === 'content') {
        const nativeTarget = overlay.nativeEvent.target;
        if (nativeTarget instanceof Element && nativeTarget.closest('.dv-tab, .dv-tabs-and-actions-container')) {
          overlay.preventDefault();
          sideDrop.current = null;
          clearPreview();
          return;
        }
        const surfaceId = overlay.getData()?.panelId ?? overlay.panel?.id ?? null;
        const targetDockviewGroupId = overlay.group?.id ?? null;
        const targetGroupId = targetDockviewGroupId
          ? groupIds.current.get(targetDockviewGroupId)
            ?? topologyRef.current.groups.find((candidate) => overlay.group?.panels.some((panel) => candidate.surfaceIds.includes(panel.id)))?.groupId
            ?? null
          : null;
        const sourceDockviewGroup = surfaceId ? apiRef.current?.getPanel(surfaceId)?.group : undefined;
        const position = resolveContentSplitEdge(overlay.position as SplitEdge | 'center', sourceDockviewGroup, overlay.group, overlay.nativeEvent);
        const rect = overlay.group ? measureSplitRect(overlay.group, position) : null;
        const source = surfaceId
          ? topologyRef.current.groups.find((group) => group.surfaceIds.includes(surfaceId))
          : undefined;
      const allowSideDrop = !interactionDisabledRef.current
          && !resizing.current
          && Boolean(source && source.surfaceIds.length >= 2)
          && Boolean(surfaceId && targetGroupId && rect);
        if (!allowSideDrop || !surfaceId) {
          overlay.preventDefault();
          sideDrop.current = null;
          showRejected(
            position,
            interactionDisabledRef.current
              ? 'Split unavailable — workspace is busy'
              : !source || source.surfaceIds.length < 2
                ? 'Split unavailable — keep another tab in this group'
                : !targetGroupId || !rect
                  ? 'Split unavailable — target group is not measurable'
                  : 'Split unavailable — layout is busy',
          );
          setHostOverlay(true);
          return;
        }
        const sameCandidate = previewCandidate.current?.surfaceId === surfaceId
          && previewCandidate.current?.position === position
          && previewCandidate.current?.targetGroupId === targetGroupId;
        if (sameCandidate) {
          // Dockview can re-emit the same edge candidate while its native
          // overlay is repainting. Do not allocate a new generation for the
          // identical surface/group/edge tuple: the existing acknowledgement
          // (or in-flight acknowledgement) remains authoritative.
          const current = previewCandidate.current;
          const remembered = armedCandidate.current;
          if (current && isCurrentArmedSplitCandidate(remembered, current, current.generation)) {
            showPreview({
              position: current.position,
              allowed: true,
              armed: true,
              message: `Release to split ${current.position === 'right' ? 'right' : current.position === 'left' ? 'left' : current.position === 'top' ? 'above' : 'below'}`,
              targetGroupId: current.targetGroupId,
              rect: current.rect,
            });
          }
          return;
        }
        const generation = ++previewGeneration.current;
        // A new edge/group candidate must not inherit acknowledgement from a
        // prior candidate, even if the pointer later returns to the same edge.
        armedCandidate.current = null;
        if (!targetGroupId || !rect) {
          sideDrop.current = null;
          clearPreview(false);
          return;
        }
        previewCandidate.current = { surfaceId, position, targetGroupId, generation, rect };
        clearDragStatus();
        showPreview({
          position,
          allowed: true,
          armed: false,
          message: `Move to split ${position === 'right' ? 'right' : position === 'left' ? 'left' : position === 'top' ? 'above' : 'below'}`,
          targetGroupId,
          rect,
        });
        const isCurrentCandidate = (): boolean => {
          const candidate = previewCandidate.current;
          return Boolean(candidate
            && candidate.generation === generation
            && candidate.surfaceId === surfaceId
            && candidate.position === position
            && candidate.targetGroupId === targetGroupId);
        };
        void setHostOverlayAwaited(true, isCurrentCandidate).then(() => {
          // Do not resurrect semantic intent when the pointer has already
          // moved to center/tab-strip or another edge while IPC was pending.
          if (!hostRaised.current || !isCurrentCandidate()) return;
          requestAnimationFrame(() => {
            if (!hostRaised.current || !isCurrentCandidate()) return;
            sideDrop.current = { surfaceId, position, targetGroupId };
            armedCandidate.current = { surfaceId, position, targetGroupId, generation };
            const armed = { position, allowed: true, armed: true, targetGroupId, rect, message: `Release to split ${position === 'right' ? 'right' : position === 'left' ? 'left' : position === 'top' ? 'above' : 'below'}` } as SplitPreview;
            showPreview(armed);
          });
        });
      }
      else if (overlay.position === 'center') {
        // Invalidate any edge acknowledgement that may still be in flight;
        // otherwise its delayed RAF could resurrect sideDrop after the cursor
        // has already returned to the neutral center target.
        sideDrop.current = null;
        clearPreview(false);
        clearDragStatus();
        setHostOverlay(true);
      }
      else if (overlay.kind === 'tab') {
        // Dockview reports tab-strip/header hover with a different kind than
        // content/edge. Tab drops remain ordinary reorder operations.
        sideDrop.current = null;
        clearPreview(false);
      }
      else if (overlay.kind === 'header_space') {
        // The blank strip to the right of the tabs is a valid Dockview target,
        // but it is not a split target. Keep the host raised and make that
        // otherwise ambiguous no-op explicit instead of silently clearing the
        // preview while the user is still dragging.
        sideDrop.current = null;
        clearPreview(false);
        clearDragStatus();
        setHostOverlay(true);
      }
    }));
    apiSubscriptions.current.push(event.api.onWillDrop((drop) => {
      if (drop.kind === 'tab' || drop.kind === 'header_space') {
        sideDrop.current = null;
        clearPreview(false);
        return;
      }
      if (drop.kind === 'edge') {
        // Whole-layout edges are outside the group-local split contract.
        drop.preventDefault();
        sideDrop.current = null;
        return;
      }
      if (drop.kind !== 'content') {
        return;
      }
      const nativeTarget = drop.nativeEvent.target;
      if (nativeTarget instanceof Element && nativeTarget.closest('.dv-tab, .dv-tabs-and-actions-container')) {
        drop.preventDefault();
        sideDrop.current = null;
        return;
      }
      const surfaceId = drop.getData()?.panelId ?? drop.panel?.id ?? null;
      const targetDockviewGroupId = drop.group?.id ?? null;
      const targetGroupId = targetDockviewGroupId
        ? groupIds.current.get(targetDockviewGroupId)
          ?? topologyRef.current.groups.find((candidate) => drop.group?.panels.some((panel) => candidate.surfaceIds.includes(panel.id)))?.groupId
          ?? null
        : null;
      const source = surfaceId
        ? topologyRef.current.groups.find((group) => group.surfaceIds.includes(surfaceId))
        : undefined;
      const sourceDockviewGroup = surfaceId ? apiRef.current?.getPanel(surfaceId)?.group : undefined;
      const position = resolveContentSplitEdge(drop.position as SplitEdge | 'center', sourceDockviewGroup, drop.group, drop.nativeEvent);
      const allowSideDrop = !interactionDisabledRef.current
        && !resizing.current
        && Boolean(source && source.surfaceIds.length >= 2)
        && Boolean(surfaceId && targetGroupId);
      if (!allowSideDrop || !surfaceId) {
        drop.preventDefault();
        sideDrop.current = null;
        showRejected(position,
          interactionDisabledRef.current ? 'Split unavailable — workspace is busy' : 'Split unavailable — layout changed');
        return;
      }
      const armed = previewRef.current;
      const remembered = armedCandidate.current;
      const rememberedMatches = isCurrentArmedSplitCandidate(remembered, {
        surfaceId,
        position,
        targetGroupId: targetGroupId ?? '',
      }, previewGeneration.current);
      const visualMatches = Boolean(armed?.allowed
        && armed.armed
        && armed.message.indexOf('Release to split') === 0
        && armed.targetGroupId === targetGroupId
        && armed.position === position);
      if ((!visualMatches && !rememberedMatches) || !targetGroupId) {
        drop.preventDefault();
        sideDrop.current = null;
        armedCandidate.current = null;
        previewGeneration.current += 1;
        previewCandidate.current = null;
        showRejected(position, 'Split cancelled — preview was not armed');
        return;
      }
      const acceptedPosition: SplitEdge = visualMatches ? armed!.position as SplitEdge : remembered!.position;
      setHostOverlay(true);
      sideDrop.current = {
        surfaceId,
        position: acceptedPosition,
        targetGroupId,
      };
      // Make the accepted drop deterministic across Dockview's HTML5 and
      // pointer backends: the event is the cancellable drop boundary, so move
      // the panel once here and let the existing onDidMutateLayout consumer
      // translate the same logical intent into Papers topology.
      drop.preventDefault();
      const panel = apiRef.current?.getPanel(surfaceId);
      const targetGroup = targetDockviewGroupId ? apiRef.current?.groups.find((group) => group.id === targetDockviewGroupId) : undefined;
      if (panel) {
        const movePosition = acceptedPosition === 'left' ? 'left' : acceptedPosition === 'right' ? 'right' : acceptedPosition === 'top' ? 'top' : 'bottom';
        panel.api.moveTo({ group: targetGroup ?? panel.group, position: movePosition });
        queueMicrotask(consumePendingSplit);
      } else {
        consumePendingSplit();
      }
    }));
    apiSubscriptions.current.push(event.api.onDidDrop(() => {
      refreshGroupIds(event.api);
      // Pointer-backed Dockview versions can emit onDidDrop without the
      // corresponding layout mutation event. Consume the accepted semantic
      // intent here as a guarded fallback; the normal path has already nulled
      // sideDrop and therefore remains exactly-once.
      const pending = sideDrop.current;
      if (!pending || interactionDisabledRef.current || resizing.current) return;
      const armed = previewRef.current;
      if (!armed || !armed.allowed || !armed.armed || armed.position !== pending.position
        || armed.targetGroupId !== pending.targetGroupId
        || !armed.message.startsWith('Release to split')) {
        // A delayed acknowledgement or a center/tab reorder must never turn
        // an obsolete edge intent into a split after the visible preview is
        // gone. Drop the stale intent and preserve ordinary reorder behavior.
        sideDrop.current = null;
        return;
      }
      sideDrop.current = null;
      const panel = event.api.getPanel(pending.surfaceId);
      const destinationDockviewId = panel?.group.id;
      if (!panel || !destinationDockviewId) {
        reconcileFromTopology(event.api);
        showRejected(pending.position, 'Split cancelled — workspace changed');
        return;
      }
      const direction = pending.position === 'left' || pending.position === 'right' ? 'right' : 'down';
      const position = pending.position === 'left' || pending.position === 'top' ? 'before' : 'after';
      const newGroupId = onSplit(pending.surfaceId, direction, position, pending.targetGroupId);
      if (newGroupId) {
        groupIds.current.set(destinationDockviewId, newGroupId);
        finishSuccessfulDrop();
      }
    }));
    apiSubscriptions.current.push(event.api.onWillDragPanel(({ panel, nativeEvent }) => {
      // Track the drag from its first pointer event. The host is raised and
      // acknowledged as soon as Dockview identifies an eligible edge target;
      // keeping this start hook state-only preserves tab-strip reordering.
      previewGeneration.current += 1;
      previewCandidate.current = null;
      previewRef.current = null;
      sideDrop.current = null;
      if (statusTimer.current !== null) {
        window.clearTimeout(statusTimer.current);
        statusTimer.current = null;
      }
      clearDragStatus();
      setPreview(null);
      dragActive.current = true;
      hostRaised.current = false;
      const session = ++dragSessionGeneration.current;
      setDragSurfaceActive(true);
      // Let Dockview finish establishing its drag backend before requesting
      // native child-view reordering. The acknowledgement is generation
      // guarded so a fast cancellation cannot resurrect host ownership.
      requestAnimationFrame(() => {
        if (!dragActive.current || dragSessionGeneration.current !== session) return;
        void setHostOverlayAwaited(true, () => dragActive.current && dragSessionGeneration.current === session);
      });
      pointerDragCleanup.current?.();
      pointerDragCleanup.current = null;
      // Dockview's pointer backend (touch/pen, and all input on coarse
      // systems) terminates on its own window pointerup and does not emit a
      // native HTML5 dragend/drop. Mirror that terminal boundary locally so
      // the host overlay cannot remain raised forever after a successful
      // pointer-backed drop or cancellation.
      if (typeof PointerEvent !== 'undefined' && nativeEvent instanceof PointerEvent) {
        const pointerId = nativeEvent.pointerId;
        const onPointerUp = (event: PointerEvent): void => {
          // Dockview registers its pointerup listener immediately after the
          // synchronous onWillDragPanel callback. Defer to a macrotask so its
          // onWillDrop/onDidDrop work and Papers' semantic-consumption
          // microtask both complete before teardown.
          if (event.pointerId === pointerId) window.setTimeout(finishDrop, 0);
        };
        const onPointerCancel = (event: PointerEvent): void => {
          if (event.pointerId === pointerId) window.setTimeout(finishDrop, 0);
        };
        // Register in the normal bubble phase so Dockview's own pointer
        // backend receives the terminal event first and can dispatch
        // onWillDrop/onDidDrop while the preview is still armed.
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        pointerDragCleanup.current = () => {
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerCancel);
        };
      }
      // Keep the source identity available for the first overlay callback.
    }));
  }, [addMissingPanels, clearDragStatus, clearPreview, commitLayout, consumePendingSplit, finishDrop, finishSuccessfulDrop, measureSplitRect, onActivate, onClose, onMove, reconcileFromTopology, refreshGroupIds, setDragSurfaceActive, setHostOverlay, setHostOverlayAwaited, showPreview, showRejected, syncPanelTitles]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    // A canonical revision arriving from another window wins deterministically
    // over a local sash gesture; cancel before reconciling so stale local
    // weights can never be committed after the remote mutation.
    if (resizing.current) finishResizeRef.current?.(true);
    reconciliationFeedback.current.apply(() => {
      addMissingPanels(api);
      syncPanelTitles(api);
      const desired = new Set(projects.map((project) => project.surfaceId));
      for (const panel of [...api.panels]) {
        if (desired.has(panel.id)) continue;
        synchronizingRemovals.current.add(panel.id);
        api.removePanel(panel);
      }
      const active = activeSurfaceId ? api.getPanel(activeSurfaceId) : undefined;
      if (active && api.activePanel?.id !== active.id) active.api.setActive();
      reconcileFromTopology(api);
    });
  }, [activeSurfaceId, addMissingPanels, projects, reconcileFromTopology, syncPanelTitles, topology]);

  const splitActive = useCallback((direction: 'right' | 'down', position: 'before' | 'after' = 'after'): void => {
    if (interactionDisabled) return;
    const panel = apiRef.current?.activePanel;
    if (!panel) return;
    const source = topologyRef.current.groups.find((group) => group.surfaceIds.includes(panel.id));
    if (!source || source.surfaceIds.length < 2) return;
    panel.api.moveTo({
      group: panel.group,
      position: direction === 'right' ? (position === 'before' ? 'left' : 'right') : (position === 'before' ? 'top' : 'bottom'),
    });
    onSplit(panel.id, direction, position);
    groupIds.current.set(panel.group.id, `group-${panel.id}`);
  }, [interactionDisabled, onSplit]);

  const activeGroup = activeSurfaceId
    ? topology.groups.find((group) => group.surfaceIds.includes(activeSurfaceId))
    : undefined;
  const canSplit = Boolean(
    !interactionDisabled && activeSurfaceId && activeGroup && activeGroup.surfaceIds.length > 1,
  );

  return (
    <section ref={workspaceRef} className="workspace-dock" aria-label="Workspace tabs"
      tabIndex={0}
      data-split={topology.root.kind === 'split' ? '' : undefined}
      aria-busy={interactionDisabled || undefined}
      onAuxClickCapture={(event) => {
        if (event.button !== 1 || !(event.target instanceof Element)) return;
        const tab = event.target.closest('.dv-tab');
        if (!tab) return;
        event.preventDefault();
        event.stopPropagation();
        if (interactionDisabled || resizing.current) return;
        const panel = apiRef.current?.groups
          .map((group) => group.model.getPanelForTab(tab))
          .find(Boolean);
        if (panel) onClose(panel.id);
      }}
      onKeyDownCapture={(event) => {
        if (interactionDisabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.ctrlKey && event.altKey) {
          const commands: Record<string, ['right' | 'down', 'before' | 'after']> = {
            ArrowLeft: ['right', 'before'],
            ArrowRight: ['right', 'after'],
            ArrowUp: ['down', 'before'],
            ArrowDown: ['down', 'after'],
          };
          const command = commands[event.key];
          if (command) {
            event.preventDefault();
            event.stopPropagation();
            if (canSplit) splitActive(command[0], command[1]);
            else showRejected(
              command[0] === 'right' ? (command[1] === 'before' ? 'left' : 'right') : (command[1] === 'before' ? 'top' : 'bottom'),
              interactionDisabled ? 'Split unavailable — workspace is busy' : 'Split unavailable — keep another tab in this group',
            );
          }
        }
      }}
      onPointerDownCapture={(event) => {
        if (interactionDisabled) {
          if (event.target instanceof Element && event.target.closest('.dv-sash')) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (resizing.current && event.target instanceof Element
          && event.target.closest('.dv-sash, .dv-tab, .dv-tabs-and-actions-container')) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        if (dragActive.current && event.target instanceof Element && event.target.closest('.dv-sash')) {
          // A second pointer must not acquire the resize owner while a tab
          // drag owns the workspace gesture and compositor lease.
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        if (event.button !== 0 || !(event.target instanceof Element)
          || !event.target.closest('.dv-sash')) return;
        if (resizing.current) {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        resizing.current = true;
        const generation = resizeUiGeneration.current + 1;
        resizeUiGeneration.current = generation;
        resizeSession.current = {
          pointerId: event.pointerId,
          generation,
          terminal: 'active',
          focusedGroupId: topologyRef.current.focusedGroupId,
          activeByGroup: new Map(topologyRef.current.groups.map((group) => [group.groupId, group.activeSurfaceId])),
          captureTarget: event.currentTarget,
        };
        let captured = false;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          // Chromium does not guarantee that hasPointerCapture() is observable
          // until the next task; a non-throwing call is the synchronous
          // acquisition boundary we can safely establish here.
          captured = true;
        } catch { /* fail closed below */ }
        if (!captured) {
          resizing.current = false;
          resizeSession.current = null;
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
          return;
        }
        setResizeActive(true);
        document.documentElement.dataset.workspaceResize = 'true';
        void setHostOverlayAwaited(true, () => resizeSession.current?.generation === generation, 'workspace-resize')
          .catch(() => {
            if (resizeSession.current?.generation === generation) finishResizeRef.current?.(true);
          });
      }}
      onDragLeaveCapture={(event) => {
        if (!dragActive.current) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        // Leaving the drop surface invalidates the armed candidate, but keep
        // the host raised for the remainder of the tab drag so a later return
        // can establish a fresh, compositor-visible preview.
        clearPreview(false);
        clearDragStatus();
      }}>
      {preview && preview.allowed && preview.targetGroupId && preview.rect && (
        <div
          className={`workspace-split-preview${preview.armed ? ' is-armed' : ''}`}
          data-position={preview.position}
          data-target-group={preview.targetGroupId}
          style={{
            left: `${preview.rect.left}px`,
            top: `${preview.rect.top}px`,
            width: `${preview.rect.width}px`,
            height: `${preview.rect.height}px`,
          }}
          role="status"
          aria-live="polite"
          aria-label={preview.message}
        />
      )}
      {dragStatus && (
        <div className="workspace-drag-status" role="status" aria-live="polite">
          {dragStatus}
        </div>
      )}
      <DockviewReact
        className="dockview-theme-light"
        components={components}
        onReady={onReady}
        disableFloatingGroups
        dropPositionResolver={resolveWorkspaceDropPosition}
      />
      {resizeActive && <div className="workspace-resize-shield" aria-hidden="true" />}
      {interactionDisabled && <div className="workspace-interaction-shield" aria-hidden="true" />}
    </section>
  );
}
