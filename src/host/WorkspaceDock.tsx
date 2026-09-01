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
      visible={visible && !suspended}
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
}): React.JSX.Element {
  const { projects, topology, activeSurfaceId, onActivate, onClose, onSplit, onMove } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const projectsRef = useRef(projects);
  const topologyRef = useRef(topology);
  const synchronizingRemovals = useRef(new Set<string>());
  const disposing = useRef(false);
  const groupIds = useRef(new Map<string, string>());
  const apiSubscriptions = useRef<Array<{ dispose(): void }>>([]);
  const [nativeSuspended, setNativeSuspended] = useState(false);
  projectsRef.current = projects;
  topologyRef.current = topology;

  useEffect(() => {
    disposing.current = false;
    return () => {
      disposing.current = true;
      apiSubscriptions.current.splice(0).forEach((subscription) => subscription.dispose());
    };
  }, []);

  const refreshGroupIds = useCallback((api: DockviewApi): void => {
    for (const group of topologyRef.current.groups) {
      const matchingPanel = group.surfaceIds
        .map((id) => api.getPanel(id))
        .find((panel) => panel !== undefined);
      if (matchingPanel) groupIds.current.set(matchingPanel.group.id, group.groupId);
    }
  }, []);

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
    apiSubscriptions.current.push(event.api.onDidActivePanelChange(({ panel }) => {
      if (panel) onActivate(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidRemovePanel((panel) => {
      if (disposing.current) return;
      if (synchronizingRemovals.current.delete(panel.id)) return;
      onClose(panel.id);
    }));
    apiSubscriptions.current.push(event.api.onDidMovePanel(({ panel, to }) => {
      const targetGroupId = groupIds.current.get(to.id);
      if (!targetGroupId) return;
      const targetIndex = to.panels.findIndex((candidate) => candidate.id === panel.id);
      if (targetIndex >= 0) onMove(panel.id, targetGroupId, targetIndex);
    }));
    apiSubscriptions.current.push(event.api.onWillShowOverlay(() => {
      flushSync(() => setNativeSuspended(true));
    }));
    apiSubscriptions.current.push(event.api.onDidDrop(() => {
      refreshGroupIds(event.api);
      setNativeSuspended(false);
    }));
  }, [addMissingPanels, onActivate, onClose, onMove, refreshGroupIds]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    addMissingPanels(api);
    const desired = new Set(projects.map((project) => project.surfaceId));
    for (const panel of [...api.panels]) {
      if (desired.has(panel.id)) continue;
      synchronizingRemovals.current.add(panel.id);
      api.removePanel(panel);
    }
    const active = activeSurfaceId ? api.getPanel(activeSurfaceId) : undefined;
    if (active && api.activePanel?.id !== active.id) active.api.setActive();
    refreshGroupIds(api);
  }, [activeSurfaceId, addMissingPanels, projects, refreshGroupIds]);

  const splitActive = useCallback((direction: 'right' | 'down'): void => {
    const panel = apiRef.current?.activePanel;
    if (!panel) return;
    panel.api.moveTo({
      group: panel.group,
      position: direction === 'right' ? 'right' : 'bottom',
    });
    onSplit(panel.id, direction);
    groupIds.current.set(panel.group.id, `group-${panel.id}`);
  }, [onSplit]);

  return (
    <section className="workspace-dock" aria-label="Workspace tabs">
      <div className="workspace-layout-actions" aria-label="Workspace layout actions">
        <button type="button" onClick={() => splitActive('right')} disabled={!activeSurfaceId}>Split Right</button>
        <button type="button" onClick={() => splitActive('down')} disabled={!activeSurfaceId}>Split Down</button>
      </div>
      <NativePresentationSuspended.Provider value={nativeSuspended}>
        <DockviewReact
          className="dockview-theme-light"
          components={components}
          onReady={onReady}
        />
      </NativePresentationSuspended.Provider>
    </section>
  );
}
