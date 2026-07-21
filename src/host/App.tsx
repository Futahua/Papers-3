import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { host, type BackpacksList, type HermesSurfaceStatus, type HostErrorPayload } from './bridge';
import { BackpacksPane } from './BackpacksPane';
import { ToolsPane } from './ToolsPane';
import { SettingsPane } from './SettingsPane';
import { EmptyBackpackWarning } from './EmptyBackpackWarning';
import { HermesControls } from './HermesControls';
import { HermesDockZone } from './HermesDockZone';

/** Papers content-relative docked-Hermes rectangle. Must match the main
 *  process `dockBoundsFor` so the host UI reserves the same strip. */
const TOP_BAR_HEIGHT = 48;
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

/**
 * Papers production shell.
 *
 * Basic is the permanent control that reaches Backpacks, Tools and Settings.
 * Hermes is global — a sidebar embedding the existing Hermes Dashboard /chat,
 * plus a button that pops out the existing Hermes Desktop window. Nothing here
 * starts a Backpack conversation, changes Hermes's working directory, or
 * fabricates Backpack contents.
 */
export function App(): React.JSX.Element {
  const [backpacks, setBackpacks] = useState<BackpacksList>({ backpacks: [], activeBackpackId: null });
  const [view, setView] = useState<BasicView>('backpacks');
  const [basicOpen, setBasicOpen] = useState(false);
  const [entered, setEntered] = useState<string | null>(null);
  const [hermes, setHermes] = useState<HermesSurfaceStatus>({ placement: 'closed', status: 'idle' });
  const [hostErrors, setHostErrors] = useState<HostErrorPayload[]>([]);
  const basicRef = useRef<HTMLDivElement | null>(null);

  const refreshBackpacks = useCallback(async () => {
    setBackpacks(await host().backpacks.list());
  }, []);

  useEffect(() => {
    void refreshBackpacks();
    void host()
      .hermes.surfaceStatus()
      .then(setHermes)
      .catch(() => undefined);

    const bridge = host();
    const subs = [
      bridge.events.onBackpacksChanged(setBackpacks),
      bridge.events.onHermesSurface(setHermes),
      bridge.events.onHostError((e) => setHostErrors((prev) => [...prev, e])),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [refreshBackpacks]);

  // True toggles: dock/hide the sidebar and detach/hide the window. Hiding
  // never terminates Hermes; the same session returns on the next open.
  const toggleDock = useCallback(() => {
    if (hermes.placement === 'docked') void host().hermes.hideDock().then(() => undefined);
    else void host().hermes.dock(dockBounds()).then(setHermes);
  }, [hermes.placement]);

  const toggleWindow = useCallback(() => {
    if (hermes.placement === 'detached') void host().hermes.hideWindow().then(() => undefined);
    else void host().hermes.showWindow().then(setHermes);
  }, [hermes.placement]);

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
  };

  const hermesBusy = hermes.status === 'starting';
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left" ref={basicRef}>
          <div className="wordmark">
            <span className="glyph">P</span>
            Papers
          </div>
          <button
            className={`pill-button${basicOpen ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={basicOpen}
            onClick={() => setBasicOpen((v) => !v)}
          >
            Basic · {VIEW_LABEL[view]}
          </button>
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

        <div className="topbar-center" />

        <div className="topbar-actions">
          <HermesControls
            placement={hermes.placement}
            busy={hermesBusy}
            onToggleDock={toggleDock}
            onToggleWindow={toggleWindow}
          />
        </div>
      </header>

      {view === 'backpacks' && (
        <BackpacksPane list={backpacks} onChanged={refreshBackpacks} onEnter={(id) => setEntered(id)} />
      )}
      {view === 'tools' && <ToolsPane />}
      {view === 'settings' && <SettingsPane />}

      {enteredBackpack && (
        <EmptyBackpackWarning backpackName={enteredBackpack.name} onDismiss={() => setEntered(null)} />
      )}

      <HermesDockZone
        placement={hermes.placement}
        dockWidth={dockWidthOf(viewportWidth)}
        onDetach={() => void host().hermes.showWindow().then(setHermes)}
        onDock={() => void host().hermes.dock(dockBounds()).then(setHermes)}
      />

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
