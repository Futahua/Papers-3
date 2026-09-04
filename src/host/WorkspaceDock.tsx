import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { BackpackProjectFrame } from './BackpackProjectFrame';
import type { WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { rebuildWorkspaceGroupMap } from './workspaceGroupMapping';
import { createWorkspaceReconciliationFeedbackGate } from './workspaceReconciliationFeedback';

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
type SplitPreview = {
  position: SplitEdge;
  allowed: boolean;
  armed: boolean;
  message: string;
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
  onSplit: (surfaceId: string, direction: 'right' | 'down', position?: 'before' | 'after') => string | void;
  onMove: (surfaceId: string, targetGroupId: string, targetIndex: number) => void;
  onOverlayActiveChange?: (active: boolean) => void;
  interactionDisabled?: boolean;
  onCommitLayout: (snapshot: {
    groups: Array<{ groupId: string; surfaceIds: string[] }>;
    rootWeights?: number[];
  }) => void;
}): React.JSX.Element {
  const { projects, topology, activeSurfaceId, onActivate, onClose, onSplit, onMove, onOverlayActiveChange, onCommitLayout,
    interactionDisabled = false } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const projectsRef = useRef(projects);
  const topologyRef = useRef(topology);
  const synchronizingRemovals = useRef(new Set<string>());
  const disposing = useRef(false);
  const groupIds = useRef(new Map<string, string>());
  const apiSubscriptions = useRef<Array<{ dispose(): void }>>([]);
  const reconciliationFeedback = useRef(createWorkspaceReconciliationFeedbackGate());
  const resizing = useRef(false);
  const sideDrop = useRef<{ surfaceId: string; position: SplitEdge } | null>(null);
  const previewRef = useRef<SplitPreview | null>(null);
  const previewCandidate = useRef<{ surfaceId: string; position: SplitEdge; generation: number } | null>(null);
  const previewGeneration = useRef(0);
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const interactionDisabledRef = useRef(false);
  projectsRef.current = projects;
  topologyRef.current = topology;
  interactionDisabledRef.current = interactionDisabled;

  const setHostOverlay = useCallback((active: boolean): void => {
    onOverlayActiveChange?.(active);
  }, [onOverlayActiveChange]);

  const clearPreview = useCallback((releaseHost = true): void => {
    previewGeneration.current += 1;
    previewCandidate.current = null;
    previewRef.current = null;
    setPreview(null);
    if (releaseHost) setHostOverlay(false);
  }, [setHostOverlay]);

  const showPreview = useCallback((next: SplitPreview): void => {
    previewRef.current = next;
    setPreview(next);
  }, []);

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
    const root = topologyRef.current.root;
    let rootWeights: number[] | undefined;
    if (root.kind === 'split' && root.children.every((child) => child.kind === 'group')) {
      const byPapersId = new Map([...groupIds.current].map(([dockviewId, papersId]) => [papersId, dockviewId]));
      const sizes = root.children.map((child) => {
        if (child.kind !== 'group') return 0;
        const dockviewId = byPapersId.get(child.groupId);
        const group = dockviewId ? api.groups.find((candidate) => candidate.id === dockviewId) : undefined;
        return root.orientation === 'horizontal' ? group?.api.width ?? 0 : group?.api.height ?? 0;
      });
      if (sizes.every((size) => size > 0)) {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        rootWeights = sizes.map((size) => size / total);
      }
    }
    onCommitLayout({ groups, ...(rootWeights ? { rootWeights } : {}) });
  }, [onCommitLayout, refreshGroupIds]);

  useEffect(() => {
    const finishResize = (): void => {
      if (!resizing.current) return;
      resizing.current = false;
      if (apiRef.current) commitLayout(apiRef.current);
    };
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      window.removeEventListener('blur', finishResize);
    };
  }, [commitLayout]);

  useEffect(() => {
    const finishDrop = (): void => clearPreview();
    window.addEventListener('dragend', finishDrop);
    window.addEventListener('drop', finishDrop);
    window.addEventListener('pointerup', finishDrop);
    window.addEventListener('blur', finishDrop);
    return () => {
      window.removeEventListener('dragend', finishDrop);
      window.removeEventListener('drop', finishDrop);
      window.removeEventListener('pointerup', finishDrop);
      window.removeEventListener('blur', finishDrop);
      clearPreview();
    };
  }, [clearPreview]);

  const reconcileFromTopology = useCallback((api: DockviewApi): void => {
    refreshGroupIds(api);
    const desired = topologyRef.current;
    const desiredGroups = desired.groups;
    const splitRoot = desired.root.kind === 'split' ? desired.root : null;
    if (desiredGroups.length > 2 || (splitRoot
      && !splitRoot.children.every((child) => child.kind === 'group'))) return;
    const firstSplitGroupId = splitRoot && splitRoot.children[0]?.kind === 'group'
      ? splitRoot.children[0].groupId
      : null;

    const mutate = (operation: () => void): void => {
      reconciliationFeedback.current.apply(operation);
    };
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

  const onReady = useCallback((event: DockviewReadyEvent): void => {
    apiRef.current = event.api;
    addMissingPanels(event.api);
    refreshGroupIds(event.api);
    apiSubscriptions.current.push(event.api.onDidActivePanelChange(({ panel, origin }) => {
      if (panel && !interactionDisabledRef.current && !reconciliationFeedback.current.isSuppressed() && origin !== 'api') onActivate(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidRemovePanel((panel) => {
      if (disposing.current) return;
      if (synchronizingRemovals.current.delete(panel.id)) return;
      onClose(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidMovePanel(({ panel, to }) => {
      if (reconciliationFeedback.current.isSuppressed()) return;
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
        if (interactionDisabledRef.current || resizing.current) {
          reconcileFromTopology(event.api);
          showPreview({ position: pending.position, allowed: false, armed: true, message: 'Split cancelled — workspace is busy' });
          setHostOverlay(true);
          window.setTimeout(() => clearPreview(), 900);
          return;
        }
        const panel = event.api.getPanel(pending.surfaceId);
        const destinationDockviewId = panel?.group.id;
        if (!panel || !destinationDockviewId) {
          reconcileFromTopology(event.api);
          showPreview({ position: pending.position, allowed: false, armed: true, message: 'Split cancelled — workspace changed' });
          setHostOverlay(true);
          window.setTimeout(() => clearPreview(), 900);
          return;
        }
        const direction = pending.position === 'left' || pending.position === 'right' ? 'right' : 'down';
        const position = pending.position === 'left' || pending.position === 'top' ? 'before' : 'after';
        const newGroupId = onSplit(pending.surfaceId, direction, position);
        if (newGroupId) groupIds.current.set(destinationDockviewId, newGroupId);
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
      if ((overlay.kind === 'content' || overlay.kind === 'edge') && overlay.position !== 'center') {
        const nativeTarget = overlay.nativeEvent.target;
        if (nativeTarget instanceof Element && nativeTarget.closest('.dv-tab, .dv-tabs-and-actions-container')) {
          overlay.preventDefault();
          sideDrop.current = null;
          clearPreview();
          return;
        }
        const surfaceId = overlay.getData()?.panelId ?? overlay.panel?.id ?? null;
        const source = surfaceId
          ? topologyRef.current.groups.find((group) => group.surfaceIds.includes(surfaceId))
          : undefined;
        const allowSideDrop = !interactionDisabledRef.current
          && topologyRef.current.root.kind === 'group'
          && topologyRef.current.groups.length === 1
          && Boolean(source && source.surfaceIds.length >= 2)
          && Boolean(surfaceId);
        if (!allowSideDrop || !surfaceId) {
          overlay.preventDefault();
          sideDrop.current = null;
          showPreview({
            position: overlay.position as SplitEdge,
            allowed: false,
            armed: true,
            message: interactionDisabledRef.current
              ? 'Split unavailable — workspace is busy'
              : topologyRef.current.root.kind !== 'group' || topologyRef.current.groups.length !== 1
                ? 'Split unavailable — layout is already split'
                : 'Split unavailable — keep another tab in this group',
          });
          setHostOverlay(true);
          return;
        }
        const position = overlay.position as SplitEdge;
        const generation = ++previewGeneration.current;
        previewCandidate.current = { surfaceId, position, generation };
        showPreview({
          position,
          allowed: true,
          armed: false,
          message: `Move to split ${position === 'right' ? 'right' : position === 'left' ? 'left' : position === 'top' ? 'above' : 'below'}`,
        });
        setHostOverlay(true);
        requestAnimationFrame(() => {
          const candidate = previewCandidate.current;
          if (!candidate || candidate.generation !== generation || candidate.surfaceId !== surfaceId || candidate.position !== position) return;
          const armed = { position, allowed: true, armed: true, message: `Release to split ${position === 'right' ? 'right' : position === 'left' ? 'left' : position === 'top' ? 'above' : 'below'}` } as SplitPreview;
          showPreview(armed);
        });
      }
      else if (overlay.position === 'center') clearPreview();
    }));
    apiSubscriptions.current.push(event.api.onWillDrop((drop) => {
      if ((drop.kind !== 'content' && drop.kind !== 'edge') || drop.position === 'center') return;
      const nativeTarget = drop.nativeEvent.target;
      if (nativeTarget instanceof Element && nativeTarget.closest('.dv-tab, .dv-tabs-and-actions-container')) {
        drop.preventDefault();
        sideDrop.current = null;
        return;
      }
      const surfaceId = drop.getData()?.panelId ?? drop.panel?.id ?? null;
      const source = surfaceId
        ? topologyRef.current.groups.find((group) => group.surfaceIds.includes(surfaceId))
        : undefined;
      const allowSideDrop = !interactionDisabledRef.current
        && topologyRef.current.root.kind === 'group'
        && topologyRef.current.groups.length === 1
        && Boolean(source && source.surfaceIds.length >= 2)
        && Boolean(surfaceId);
      if (!allowSideDrop || !surfaceId) {
        drop.preventDefault();
        sideDrop.current = null;
        showPreview({
          position: drop.position as SplitEdge,
          allowed: false,
          armed: true,
          message: interactionDisabledRef.current ? 'Split unavailable — workspace is busy' : 'Split unavailable — layout changed',
        });
        return;
      }
      const position = drop.position as SplitEdge;
      const armed = previewRef.current;
      if (!armed || !armed.allowed || !armed.armed || armed.position !== position || armed.message.indexOf('Release to split') !== 0) {
        drop.preventDefault();
        sideDrop.current = null;
        showPreview({ position, allowed: false, armed: true, message: 'Split cancelled — preview was not armed' });
        return;
      }
      setHostOverlay(true);
      sideDrop.current = {
        surfaceId,
        position,
      };
    }));
    apiSubscriptions.current.push(event.api.onDidDrop(() => {
      refreshGroupIds(event.api);
    }));
    apiSubscriptions.current.push(event.api.onWillDragPanel(({ panel }) => {
      // Raise the host before the pointer can enter a native WebContentsView;
      // otherwise Dockview cannot paint a guaranteed preview over the view.
      previewGeneration.current += 1;
      previewCandidate.current = null;
      previewRef.current = null;
      sideDrop.current = null;
      setPreview(null);
      setHostOverlay(true);
      // Keep the source identity available for the first overlay callback.
      previewCandidate.current = { surfaceId: panel.id, position: 'right', generation: previewGeneration.current };
    }));
  }, [addMissingPanels, clearPreview, commitLayout, onActivate, onClose, onMove, reconcileFromTopology, refreshGroupIds, setHostOverlay, showPreview]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    reconciliationFeedback.current.apply(() => {
      addMissingPanels(api);
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
  }, [activeSurfaceId, addMissingPanels, projects, reconcileFromTopology, topology]);

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
    !interactionDisabled && activeSurfaceId && activeGroup && activeGroup.surfaceIds.length > 1 && topology.root.kind === 'group',
  );

  return (
    <section className="workspace-dock" aria-label="Workspace tabs"
      tabIndex={0}
      data-split={topology.root.kind === 'split' ? '' : undefined}
      aria-busy={interactionDisabled || undefined}
      onKeyDownCapture={(event) => {
        if (interactionDisabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.ctrlKey && event.altKey && canSplit) {
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
            splitActive(command[0], command[1]);
          }
        }
      }}
      onMouseDownCapture={(event) => {
        if (interactionDisabled) {
          if (event.target instanceof Element && event.target.closest('.dv-sash')) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (event.button !== 0 || !(event.target instanceof Element)
          || !event.target.closest('.dv-sash')) return;
        resizing.current = true;
      }}>
      <p className="workspace-split-help" aria-live="polite">
        Drag a tab to an edge to preview a split. Keyboard: Control+Alt+Arrow keys split the focused tab.
      </p>
      {preview && (
        <div
          className={`workspace-split-preview${preview.allowed ? '' : ' is-rejected'}${preview.armed ? ' is-armed' : ''}`}
          data-position={preview.position}
          role="status"
          aria-live="polite"
          aria-label={preview.message}
        >
          <span>{preview.message}</span>
        </div>
      )}
      <DockviewReact
        className="dockview-theme-light"
        components={components}
        onReady={onReady}
        disableFloatingGroups
      />
      {interactionDisabled && <div className="workspace-interaction-shield" aria-hidden="true" />}
    </section>
  );
}
