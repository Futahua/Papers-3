import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

const NativePresentationSuspended = createContext(false);

function WorkspacePanel(props: IDockviewPanelProps<WorkspacePanelParams>): React.JSX.Element {
  const { params, api } = props;
  const [visible, setVisible] = useState(api.isVisible);
  const suspended = useContext(NativePresentationSuspended);
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
      occluded={suspended}
    />
  );
}

export function WorkspaceDock(props: {
  projects: OpenWorkspaceProject[];
  topology: WorkspaceTopologyV1;
  activeSurfaceId: string | null;
  onActivate: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: 'right' | 'down') => void;
  onMove: (surfaceId: string, targetGroupId: string, targetIndex: number) => void;
  interactionDisabled?: boolean;
  onCommitLayout: (snapshot: {
    groups: Array<{ groupId: string; surfaceIds: string[] }>;
    rootWeights?: number[];
  }) => void;
}): React.JSX.Element {
  const { projects, topology, activeSurfaceId, onActivate, onClose, onSplit, onMove, onCommitLayout,
    interactionDisabled = false } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const projectsRef = useRef(projects);
  const topologyRef = useRef(topology);
  const synchronizingRemovals = useRef(new Set<string>());
  const disposing = useRef(false);
  const groupIds = useRef(new Map<string, string>());
  const apiSubscriptions = useRef<Array<{ dispose(): void }>>([]);
  const reconciliationFeedback = useRef(createWorkspaceReconciliationFeedbackGate());
  const [nativeSuspended, setNativeSuspended] = useState(false);
  const resizing = useRef(false);
  const interactionDisabledRef = useRef(false);
  projectsRef.current = projects;
  topologyRef.current = topology;
  interactionDisabledRef.current = interactionDisabled;

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
      setNativeSuspended(false);
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

  useEffect(() => {
    const restore = (): void => setNativeSuspended(false);
    window.addEventListener('dragend', restore);
    window.addEventListener('drop', restore);
    return () => {
      window.removeEventListener('dragend', restore);
      window.removeEventListener('drop', restore);
    };
  }, []);

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
      if (interactionDisabledRef.current || resizing.current || reconciliationFeedback.current.isSuppressed() || origin === 'api') return;
      commitLayout(event.api);
      setNativeSuspended(false);
    }));
    apiSubscriptions.current.push(event.api.onDidLayoutChange(() => {
      if (!interactionDisabledRef.current && !resizing.current && !reconciliationFeedback.current.isSuppressed()) commitLayout(event.api);
    }));
    apiSubscriptions.current.push(event.api.onWillShowOverlay((overlay) => {
      if ((overlay.kind === 'content' || overlay.kind === 'edge') && overlay.position !== 'center') {
        overlay.preventDefault();
        return;
      }
      flushSync(() => setNativeSuspended(true));
    }));
    apiSubscriptions.current.push(event.api.onDidDrop(() => {
      refreshGroupIds(event.api);
      setNativeSuspended(false);
    }));
  }, [addMissingPanels, commitLayout, onActivate, onClose, onMove, refreshGroupIds]);

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

  const splitActive = useCallback((direction: 'right' | 'down'): void => {
    if (interactionDisabled) return;
    const panel = apiRef.current?.activePanel;
    if (!panel) return;
    const source = topologyRef.current.groups.find((group) => group.surfaceIds.includes(panel.id));
    if (!source || source.surfaceIds.length < 2) return;
    panel.api.moveTo({
      group: panel.group,
      position: direction === 'right' ? 'right' : 'bottom',
    });
    onSplit(panel.id, direction);
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
      data-split={topology.root.kind === 'split' ? '' : undefined}
      aria-busy={interactionDisabled || undefined}
      onKeyDownCapture={(event) => {
        if (!interactionDisabled) return;
        event.preventDefault();
        event.stopPropagation();
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
        flushSync(() => setNativeSuspended(true));
      }}>
      <div className="workspace-layout-actions" aria-label="Workspace layout actions">
        <button type="button" onClick={() => splitActive('right')} disabled={!canSplit}>Split Right</button>
        <button type="button" onClick={() => splitActive('down')} disabled={!canSplit}>Split Down</button>
      </div>
      <NativePresentationSuspended.Provider value={nativeSuspended}>
        <DockviewReact
          className="dockview-theme-light"
          components={components}
          onReady={onReady}
          disableFloatingGroups
        />
        {interactionDisabled && <div className="workspace-interaction-shield" aria-hidden="true" />}
      </NativePresentationSuspended.Provider>
    </section>
  );
}
