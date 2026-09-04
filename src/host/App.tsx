import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { host, type BackpacksList, type HermesSurfaceStatus, type HostErrorPayload } from './bridge';
import { BackpacksPane } from './BackpacksPane';
import { BackpackSidebar } from './BackpackSidebar';
import { ToolsPane } from './ToolsPane';
import { SettingsPane } from './SettingsPane';
import { EmptyBackpackWarning } from './EmptyBackpackWarning';
import { HermesControls } from './HermesControls';
import { WorkspaceDock, type OpenWorkspaceProject } from './WorkspaceDock';
import {
  activateWorkspaceSurface,
  closeWorkspaceSurface,
  createWorkspaceTopology,
  moveWorkspaceSurface,
  reorderWorkspaceGroup,
  setRootWorkspaceSplitWeights,
  openWorkspaceSurface,
  splitWorkspaceGroup,
} from '@shared/workspaceTopology';

/** Papers content-relative docked-Hermes rectangle. Must match the main
 *  process dock geometry (the slim title-bar height) so the host UI reserves
 *  the same strip. */
const TOP_BAR_HEIGHT = 40;
function dockWidthOf(w: number): number {
  return Math.max(380, Math.min(620, Math.round(w * 0.4)));
}
function dockBounds(): { x: number; y: number; width: number; height: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const width = dockWidthOf(w);
  return { x: Math.max(0, w - width), y: TOP_BAR_HEIGHT, width, height: Math.max(400, h - TOP_BAR_HEIGHT) };
}

type BasicView = 'backpacks' | 'tools' | 'settings';

const VIEW_LABEL: Record<BasicView, string> = {
  backpacks: 'Backpacks',
  tools: 'Tools',
  settings: 'Settings',
};

function closeTopologySurface(topology: ReturnType<typeof createWorkspaceTopology>, surfaceId: string) {
  return topology.surfaces.some((surface) => surface.surfaceId === surfaceId)
    ? closeWorkspaceSurface(topology, surfaceId)
    : topology;
}

/**
 * Papers production shell.
 *
 * Basic is the permanent control that reaches Backpacks, Tools and Settings.
 * Hermes is global — the real Hermes Desktop in two placements, docked beside
 * Papers or detached, driven by the two symbol toggles in the top bar (D-011,
 * D-015). Nothing here starts a Backpack conversation, changes Hermes's working
 * directory, or fabricates Backpack contents.
 */
export function App(): React.JSX.Element {
  const [backpacks, setBackpacks] = useState<BackpacksList>({ backpacks: [], activeBackpackId: null });
  const [view, setView] = useState<BasicView>('backpacks');
  const [basicOpen, setBasicOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigationQueue = useRef(Promise.resolve());
  const [entered, setEntered] = useState<string | null>(null);
  const [projectUrl, setProjectUrl] = useState<string | null>(null);
  const [openProjects, setOpenProjects] = useState<OpenWorkspaceProject[]>([]);
  const openProjectsRef = useRef<OpenWorkspaceProject[]>([]);
  openProjectsRef.current = openProjects;
  const [workspaceTopology, setWorkspaceTopology] = useState(createWorkspaceTopology);
  const [hydrationReady, setHydrationReady] = useState(false);
  const topologyCommitArmed = useRef(false);
  // Track the exact object supplied by main. If a local interaction is
  // batched with an external update, the newer local topology must still be
  // persisted rather than being mistaken for the restore itself.
  const externallyRestoredTopology = useRef<ReturnType<typeof createWorkspaceTopology> | null>(null);
  /**
   * The logical surface this window is showing.
   *
   * Held here purely so the renderer can name its own target: main verifies
   * what we pass and never invents it, so a window with no open surface simply
   * has nothing to act on.
   */
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  /** Read inside subscriptions that outlive a render. */
  const surfaceIdRef = useRef<string | null>(null);
  surfaceIdRef.current = surfaceId;
  const [hermes, setHermes] = useState<HermesSurfaceStatus>({ placement: 'closed', status: 'idle', ownedByThisWindow: false });
  const [hostErrors, setHostErrors] = useState<HostErrorPayload[]>([]);
  const basicRef = useRef<HTMLDivElement | null>(null);

  const refreshBackpacks = useCallback(async () => {
    setBackpacks(await host().backpacks.list());
  }, []);

  useEffect(() => {
    void host().settings.get().then((settings) => {
      document.documentElement.dataset.transparentWindow = String(settings.transparentWindow);
    }).catch(() => undefined);
  }, [hydrationReady]);

  useEffect(() => {
    if (!hydrationReady || (!topologyCommitArmed.current && workspaceTopology.surfaces.length === 0)) return;
    if (externallyRestoredTopology.current === workspaceTopology) {
      externallyRestoredTopology.current = null;
      return;
    }
    externallyRestoredTopology.current = null;
    void host().layout.commitWorkspaceTopology(workspaceTopology).catch(() => undefined);
  }, [hydrationReady, workspaceTopology]);

  useEffect(() => {
    const bridge = host();
    void bridge.backpacks.list().then(setBackpacks).catch(() => undefined);
    void bridge
      .hermes.surfaceStatus()
      .then(setHermes)
      .catch(() => undefined);

    const subs = [
      bridge.events.onBackpacksChanged(setBackpacks),
      bridge.events.onBackpackProjectCloseRequest((payload) => {
        if (!payload?.surfaceId) return;
        // Another window may archive/remove the Backpack while this renderer
        // is showing it. Main already retired the exact surface; synchronize
        // every tab, including an inactive one whose panel is unmounted.
        setOpenProjects((projects) => {
          const remaining = projects.filter((project) => project.surfaceId !== payload.surfaceId);
          return remaining;
        });
        setWorkspaceTopology((topology) => closeTopologySurface(topology, payload.surfaceId));
      }),
      bridge.events.onWorkspaceTopology((topology) => {
        topologyCommitArmed.current = true;
        externallyRestoredTopology.current = topology;
        setWorkspaceTopology(topology);
        const focused = topology.groups.find((group) => group.groupId === topology.focusedGroupId);
        const nextSurfaceId = focused?.activeSurfaceId ?? null;
        const activeProject = openProjectsRef.current.find((project) => project.surfaceId === nextSurfaceId) ?? null;
        setSurfaceId(nextSurfaceId);
        setProjectUrl(activeProject?.url ?? null);
        setEntered(activeProject?.projectId ?? null);
      }),
      bridge.events.onWorkspaceProjectOpened(({ project, topology }) => {
        topologyCommitArmed.current = true;
        openProjectsRef.current = [
          ...openProjectsRef.current.filter((candidate) => candidate.surfaceId !== project.surfaceId),
          project,
        ];
        setOpenProjects(openProjectsRef.current);
        externallyRestoredTopology.current = topology;
        setWorkspaceTopology(topology);
        setSurfaceId(project.surfaceId);
        setProjectUrl(project.url);
        setEntered(project.projectId);
      }),
      bridge.events.onWorkspaceProjectReplaced(({ previousSurfaceId, project, topology }) => {
        topologyCommitArmed.current = true;
        externallyRestoredTopology.current = topology;
        openProjectsRef.current = openProjectsRef.current.map((candidate) =>
          candidate.surfaceId === previousSurfaceId ? project : candidate);
        setOpenProjects(openProjectsRef.current);
        setWorkspaceTopology(topology);
        surfaceIdRef.current = project.surfaceId;
        setSurfaceId(project.surfaceId);
        setProjectUrl(project.url);
        setEntered(project.projectId);
      }),
      bridge.events.onWorkspaceHydrated(({ projects, topology }) => {
        topologyCommitArmed.current = true;
        openProjectsRef.current = projects;
        setOpenProjects(projects);
        externallyRestoredTopology.current = topology;
        setWorkspaceTopology(topology);
        const focused = topology.groups.find((group) => group.groupId === topology.focusedGroupId);
        const active = projects.find((project) => project.surfaceId === focused?.activeSurfaceId) ?? null;
        setSurfaceId(active?.surfaceId ?? null);
        setProjectUrl(active?.url ?? null);
        setEntered(active?.projectId ?? null);
      }),
      bridge.events.onWorkspaceLayoutLoaded(({ projects, topology }) => {
        // The main-process replacement transaction has already validated and
        // committed the canonical topology. Consume its complete descriptor
        // set before Dockview derives any native presentation; this is the
        // same externally-restored boundary used by startup hydration.
        topologyCommitArmed.current = true;
        openProjectsRef.current = projects;
        setOpenProjects(projects);
        externallyRestoredTopology.current = topology;
        setWorkspaceTopology(topology);
        const focused = topology.groups.find((group) => group.groupId === topology.focusedGroupId);
        const active = projects.find((project) => project.surfaceId === focused?.activeSurfaceId) ?? null;
        setSurfaceId(active?.surfaceId ?? null);
        setProjectUrl(active?.url ?? null);
        setEntered(active?.projectId ?? null);
      }),
      bridge.events.onWorkspaceSurfaceMoved(({ projects, topology }) => {
        // Cross-window handoff is a complete renderer projection, not a
        // topology-only delta: descriptors and topology are separate state in
        // App and must converge together before Dockview/native presentation.
        topologyCommitArmed.current = true;
        openProjectsRef.current = projects;
        setOpenProjects(projects);
        externallyRestoredTopology.current = topology;
        setWorkspaceTopology(topology);
        const focused = topology.groups.find((group) => group.groupId === topology.focusedGroupId);
        const active = projects.find((project) => project.surfaceId === focused?.activeSurfaceId) ?? null;
        setSurfaceId(active?.surfaceId ?? null);
        setProjectUrl(active?.url ?? null);
        setEntered(active?.projectId ?? null);
      }),
      bridge.events.onHermesSurface(setHermes),
      bridge.events.onHostError((e) => setHostErrors((prev) => [...prev, e])),
    ];
    void bridge.layout.hydrateStartupWorkspace()
      .catch((caught) => setHostErrors((previous) => [...previous, {
        component: 'Backpack', what: 'Startup workspace could not be restored.',
        known: String(caught instanceof Error ? caught.message : caught),
        intact: 'Saved workspace data and Backpack files were not changed.', retryUseful: true,
        inspect: 'Open Backpacks and retry manually.', recover: 'Papers remains available at the Backpack list.',
      }]))
      .finally(() => setHydrationReady(true));
    return () => subs.forEach((unsub) => unsub());
  }, [refreshBackpacks]);

  // Match the native window-controls overlay to the active Papers theme, and
  // follow the system light/dark preference so the title bar always reads as
  // part of Papers. Papers ships a warm-paper light theme today; if a dark
  // theme is added this simply follows it.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const styles = getComputedStyle(document.documentElement);
      const bar = styles.getPropertyValue('--titlebar-bg').trim() || '#efede7';
      const symbol = styles.getPropertyValue('--titlebar-symbol').trim() || '#20201e';
      void host().layout.setTitleBarOverlay(bar, symbol).catch(() => undefined);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  // True toggles: dock/hide the sidebar and detach/hide the window. Hiding
  // never terminates Hermes; the same session returns on the next open.
  // Hiding only applies to a Hermes this window owns. When Hermes is docked to
  // another Papers window, pressing Dock here TAKES it -- an explicit transfer
  // the creator asked for -- rather than hiding a dock they cannot see.
  const reportHermesFailure = useCallback((caught: unknown): void => {
    setHostErrors((previous) => [
      ...previous,
      {
        component: 'Hermes',
        what: 'The Hermes window could not be hidden.',
        known: String(caught instanceof Error ? caught.message : caught),
        intact: 'Hermes and its current placement were not changed.',
        retryUseful: true,
        inspect: 'The Hermes window remains available in its current placement.',
        recover: 'Try hiding Hermes again.',
      },
    ]);
  }, []);

  const toggleDock = useCallback(() => {
    if (hermes.placement === 'docked' && hermes.ownedByThisWindow) {
      void host().hermes.hideDock().catch(reportHermesFailure);
    } else {
      void host().hermes.dock(dockBounds()).then(setHermes);
    }
  }, [hermes.placement, hermes.ownedByThisWindow, reportHermesFailure]);

  const toggleWindow = useCallback(() => {
    if (hermes.placement === 'detached') void host().hermes.hideWindow().catch(reportHermesFailure);
    else void host().hermes.showWindow().then(setHermes);
  }, [hermes.placement, reportHermesFailure]);

  const createNewWindow = useCallback((): void => {
    void host().app.newWindow().catch((caught) => {
      setHostErrors((previous) => [
        ...previous,
        {
          component: 'Papers',
          what: 'A new Papers window could not be opened.',
          known: String(caught instanceof Error ? caught.message : caught),
          intact: 'The current window and its Backpacks were not changed.',
          retryUseful: true,
          inspect: 'The current Papers window remains available.',
          recover: 'Try New Window again.',
        },
      ]);
    });
  }, []);


  // The Hermes surface (a native view) must sit behind renderer overlays.
  useEffect(() => {
    void host().layout.setOverlayActive(basicOpen || entered !== null);
  }, [basicOpen, entered]);

  // Dismiss the Basic menu on outside click.
  useEffect(() => {
    if (!basicOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (basicRef.current && !basicRef.current.contains(event.target as Node)) {
        setBasicOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [basicOpen]);


  const enteredBackpack = useMemo(
    () => (entered ? backpacks.backpacks.find((b) => b.id === entered) ?? null : null),
    [entered, backpacks],
  );

  const goto = (next: BasicView): void => {
    setView(next);
    setBasicOpen(false);
    setSidebarOpen(false);
  };

  const enterBackpack = (id: string, newTab = false): void => {
    setSidebarOpen(false);
    setBasicOpen(false);
    setView('backpacks');
    navigationQueue.current = navigationQueue.current.then(async () => {
      const active = openProjectsRef.current.find((project) => project.surfaceId === surfaceIdRef.current);
      if (!newTab && active?.projectId === id) {
        setProjectUrl(active.url);
        setEntered(id);
        await host().backpackProject.activateSurface(active.surfaceId);
        return;
      }
      if (!newTab && active) {
        const project = await host().backpackProject.replace(active.surfaceId, id);
        if (!project) { setEntered(id); setProjectUrl(null); }
        return;
      }
      const project = await host().backpackProject.open(id);
      setEntered(id);
      setProjectUrl(project?.url ?? null);
      if (!project) return;
      surfaceIdRef.current = project.surfaceId;
      setSurfaceId(project.surfaceId);
      topologyCommitArmed.current = true;
      const title = backpacks.backpacks.find((backpack) => backpack.id === id)?.name ?? id;
      openProjectsRef.current = [...openProjectsRef.current,
        { surfaceId: project.surfaceId, projectId: id, title, url: project.url }];
      setOpenProjects(openProjectsRef.current);
      setWorkspaceTopology((topology) => openWorkspaceSurface(topology,
        { surfaceId: project.surfaceId, projectId: id, title }));
    }).catch((caught) => setHostErrors((previous) => [...previous, {
      component: 'Backpack',
      what: 'The independent Backpack project could not be opened.',
      known: String(caught instanceof Error ? caught.message : caught),
      intact: 'The Backpack record and project files were not changed.',
      retryUseful: true,
      inspect: 'Return to Backpacks and enter it again.',
      recover: 'The independent project remains outside Papers.',
    }]));
  };

  const leaveEnteredBackpack = useCallback((): void => {
    // Dismissing an empty Backpack returns to the picker without retiring
    // the working tab that was selected before this navigation attempt.
    setProjectUrl(null);
    setEntered(null);
  }, []);

  const activateWorkspaceProject = useCallback((nextSurfaceId: string): void => {
    const project = openProjects.find((candidate) => candidate.surfaceId === nextSurfaceId);
    if (!project) return;
    setSurfaceId(project.surfaceId);
    setProjectUrl(project.url);
    setEntered(project.projectId);
    setWorkspaceTopology((topology) => activateWorkspaceSurface(topology, project.surfaceId));
    void host().backpackProject.activateSurface(project.surfaceId).catch(() => undefined);
  }, [openProjects]);

  const closeWorkspaceProject = useCallback((closingSurfaceId: string): void => {
    // Main owns the complete terminal-close transaction and emits canonical
    // topology before the cleanup event; the renderer must not pick a second
    // successor or locally commit a competing topology.
    void host().backpackProject.close(closingSurfaceId).catch(() => undefined);
  }, []);

  const splitWorkspaceProject = useCallback((splitSurfaceId: string, direction: 'right' | 'down'): void => {
    setWorkspaceTopology((topology) => {
      if (topology.root.kind === 'split') return topology;
      const source = topology.groups.find((group) => group.surfaceIds.includes(splitSurfaceId));
      if (!source || source.surfaceIds.length < 2) return topology;
      return splitWorkspaceGroup(topology, {
        groupId: source.groupId,
        newGroupId: `group-${splitSurfaceId}`,
        surfaceId: splitSurfaceId,
        orientation: direction === 'right' ? 'horizontal' : 'vertical',
        position: 'after',
      });
    });
  }, []);

  const moveWorkspaceProject = useCallback((movedSurfaceId: string, targetGroupId: string, targetIndex: number): void => {
    setWorkspaceTopology((topology) => moveWorkspaceSurface(topology, movedSurfaceId, targetGroupId, targetIndex));
  }, []);

  const commitWorkspaceLayout = useCallback((snapshot: {
    groups: Array<{ groupId: string; surfaceIds: string[] }>;
    rootWeights?: number[];
  }): void => {
    setWorkspaceTopology((current) => {
      let next = current;
      for (const group of snapshot.groups) {
        const existing = next.groups.find((candidate) => candidate.groupId === group.groupId);
        if (!existing || existing.surfaceIds.length !== group.surfaceIds.length) continue;
        if (existing.surfaceIds.every((surface, index) => surface === group.surfaceIds[index])) continue;
        next = reorderWorkspaceGroup(next, group.groupId, group.surfaceIds);
      }
      if (snapshot.rootWeights && next.root.kind === 'split') {
        const unchanged = next.root.weights.length === snapshot.rootWeights.length
          && next.root.weights.every((weight, index) => Math.abs(weight - (snapshot.rootWeights?.[index] ?? 0)) < 0.001);
        if (!unchanged) next = setRootWorkspaceSplitWeights(next, snapshot.rootWeights);
      }
      return next;
    });
  }, []);

  const openBasicOrReturnToBackpacks = (): void => {
    setSidebarOpen(false);
    if (entered !== null) {
      setView('backpacks');
      setBasicOpen(false);
      // This is a picker transition, not semantic close. Dockview unmounts
      // and hides the native presentation while the logical tabs stay alive.
      setEntered(null);
      setProjectUrl(null);
      return;
    }

    setBasicOpen((open) => !open);
  };

  const hermesBusy = hermes.status === 'starting';

  return (
    <div className={`app${sidebarOpen ? ' backpack-sidebar-open' : ''}`}>
      {/* Slim title bar: the whole band is an invisible OS drag region (so the
          window still moves), with interactive controls opting out. It replaces
          the generic dark Electron title bar and menu; the native
          minimize/maximize/close controls are painted by the OS in the reserved
          top-right inset. No wordmark, no File/Edit/View/Window menu. */}
      <header className="titlebar">
        <div className="titlebar-left" ref={basicRef}
          onMouseEnter={() => { if (view === 'backpacks' && !basicOpen) setSidebarOpen(true); }}
          onMouseLeave={() => setSidebarOpen(false)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setSidebarOpen(false); setBasicOpen(false); } }}>
          <button
            className={`pill-button${basicOpen ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={entered === null && basicOpen}
            aria-label={
              entered === null
                ? `${VIEW_LABEL[view]} — open Basic menu`
                : 'Backpacks — return to Backpack list'
            }
            onClick={openBasicOrReturnToBackpacks}
          >
            {VIEW_LABEL[view]}
          </button>
          {sidebarOpen && <BackpackSidebar list={backpacks} activeId={entered} onEnter={enterBackpack} />}
          {basicOpen && (
            <div className="basic-menu" role="menu">
              <p className="eyebrow">Basic</p>
              <button
                className={`basic-row${view === 'backpacks' ? ' active' : ''}`}
                role="menuitem"
                onClick={() => goto('backpacks')}
              >
                <span className="glyph">▤</span>
                <span className="copy">
                  <strong>Backpacks</strong>
                  <small>Named machine-wide environments.</small>
                </span>
                <span className="row-value">{backpacks.backpacks.filter((b) => !b.archived).length}</span>
              </button>
              <button
                className={`basic-row${view === 'tools' ? ' active' : ''}`}
                role="menuitem"
                onClick={() => goto('tools')}
              >
                <span className="glyph">⚙</span>
                <span className="copy">
                  <strong>Tools</strong>
                  <small>Reusable machine-wide capabilities.</small>
                </span>
              </button>
              <button
                className={`basic-row${view === 'settings' ? ' active' : ''}`}
                role="menuitem"
                onClick={() => goto('settings')}
              >
                <span className="glyph">◐</span>
                <span className="copy">
                  <strong>Settings</strong>
                  <small>Papers application settings.</small>
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="titlebar-drag" />

        <div className="titlebar-actions">
          <button
            type="button"
            className="titlebar-icon-button"
            aria-label="New window"
            title="New window"
            onClick={createNewWindow}
          >
            ⊞
          </button>
          <HermesControls
            placement={hermes.placement}
            busy={hermesBusy}
            onToggleDock={toggleDock}
            onToggleWindow={toggleWindow}
          />
          {/* Reserved inset the OS paints the native min/maximize/close over. */}
          <div className="titlebar-window-controls" aria-hidden="true" />
        </div>
      </header>

      {view === 'backpacks' && entered === null && (
        <BackpacksPane list={backpacks} onChanged={refreshBackpacks} onEnter={enterBackpack} />
      )}
      {view === 'tools' && <ToolsPane />}
      {view === 'settings' && <SettingsPane />}

      {openProjects.length > 0 && entered !== null && projectUrl !== null && (
        <WorkspaceDock
          projects={openProjects}
          topology={workspaceTopology}
          activeSurfaceId={surfaceId}
          onActivate={activateWorkspaceProject}
          onClose={closeWorkspaceProject}
          onSplit={splitWorkspaceProject}
          onMove={moveWorkspaceProject}
          onCommitLayout={commitWorkspaceLayout}
        />
      )}

      {enteredBackpack && !projectUrl &&
        (
          <EmptyBackpackWarning
            backpackName={enteredBackpack.name}
            onDismiss={leaveEnteredBackpack}
          />
        )}

      {hermes.status === 'error' && hermes.detail && (
        <div className="error-banner hermes-error">
          <div className="content">
            <div className="title">Hermes</div>
            <div className="detail">{hermes.detail}</div>
          </div>
          <button className="secondary" onClick={() => void host().hermes.showWindow().then(setHermes)}>
            Retry
          </button>
        </div>
      )}

      {hostErrors.length > 0 && hostErrors[0] && (
        <div className="error-banner">
          <div className="content">
            <div className="title">
              {hostErrors[0].component}: {hostErrors[0].what}
            </div>
            <div className="detail">{hostErrors[0].known}</div>
            <div className="detail">Intact: {hostErrors[0].intact}</div>
            <div className="detail">Recover: {hostErrors[0].recover}</div>
          </div>
          <button className="secondary" onClick={() => setHostErrors((prev) => prev.slice(1))}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
