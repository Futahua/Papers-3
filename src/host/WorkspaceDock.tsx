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
  activeSurfaceId: string | null;
  onActivate: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onSplit: (surfaceId: string, direction: 'right' | 'down') => void;
}): React.JSX.Element {
  const { projects, activeSurfaceId, onActivate, onClose, onSplit } = props;
  const apiRef = useRef<DockviewApi | null>(null);
  const projectsRef = useRef(projects);
  const synchronizingRemovals = useRef(new Set<string>());
  const disposing = useRef(false);
  const [nativeSuspended, setNativeSuspended] = useState(false);
  projectsRef.current = projects;

  useEffect(() => {
    disposing.current = false;
    return () => { disposing.current = true; };
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
    event.api.onDidActivePanelChange(({ panel }) => {
      if (panel) onActivate(panel.id);
    });
    event.api.onDidRemovePanel((panel) => {
      if (disposing.current) return;
      if (synchronizingRemovals.current.delete(panel.id)) return;
      onClose(panel.id);
    });
    event.api.onWillShowOverlay(() => {
      flushSync(() => setNativeSuspended(true));
    });
    event.api.onDidDrop(() => setNativeSuspended(false));
  }, [addMissingPanels, onActivate, onClose]);

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
  }, [activeSurfaceId, addMissingPanels, projects]);

  const splitActive = useCallback((direction: 'right' | 'down'): void => {
    const panel = apiRef.current?.activePanel;
    if (!panel) return;
    panel.api.moveTo({
      group: panel.group,
      position: direction === 'right' ? 'right' : 'bottom',
    });
    onSplit(panel.id, direction);
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
