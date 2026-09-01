import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { host, type BackpacksList, type HermesSurfaceStatus, type HostErrorPayload } from './bridge';
import { BackpackProjectFrame } from './BackpackProjectFrame';
import { BackpacksPane } from './BackpacksPane';
import { ToolsPane } from './ToolsPane';
import { SettingsPane } from './SettingsPane';
import { EmptyBackpackWarning } from './EmptyBackpackWarning';
import { HermesControls } from './HermesControls';

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
  const [entered, setEntered] = useState<string | null>(null);
  const [projectUrl, setProjectUrl] = useState<string | null>(null);
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
  }, []);

  useEffect(() => {
    const bridge = host();
    const restoreBackpack = async (): Promise<void> => {
      const list = await bridge.backpacks.list();
      setBackpacks(list);
      const id = await bridge.backpacks.startupRestore();
      if (!id || !list.backpacks.some((backpack) => backpack.id === id && !backpack.archived)) {
        return;
      }
      try {
        const project = await bridge.backpackProject.open(id);
        setProjectUrl(project?.url ?? null);
        setEntered(id);
      } catch (caught) {
        setHostErrors((previous) => [
          ...previous,
          {
            component: 'Backpack',
            what: 'The last active Backpack could not be restored.',
            known: String(caught instanceof Error ? caught.message : caught),
            intact: 'The Backpack record and project files were not changed.',
            retryUseful: true,
            inspect: 'Open the Backpack again from Backpacks.',
            recover: 'Papers remains available at the Backpack list.',
          },
        ]);
      }
    };

    void restoreBackpack();
    void bridge
      .hermes.surfaceStatus()
      .then(setHermes)
      .catch(() => undefined);

    const subs = [
      bridge.events.onBackpacksChanged(setBackpacks),
      bridge.events.onBackpackProjectCloseRequest(() => {
        // Another window may archive/remove the Backpack while this renderer
        // is showing it. The main process already tore down the surface; this
        // synchronizes the local React state with that authoritative event.
        setProjectUrl(null);
        setEntered(null);
        setView('backpacks');
      }),
      bridge.events.onHermesSurface(setHermes),
      bridge.events.onHostError((e) => setHostErrors((prev) => [...prev, e])),
    ];
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
  const toggleDock = useCallback(() => {
    if (hermes.placement === 'docked' && hermes.ownedByThisWindow) {
      void host().hermes.hideDock().then(() => undefined);
    } else {
      void host().hermes.dock(dockBounds()).then(setHermes);
    }
  }, [hermes.placement, hermes.ownedByThisWindow]);

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

  const enterBackpack = (id: string): void => {
    void host()
      .backpackProject.open(id)
      .then((project) => {
        setProjectUrl(project?.url ?? null);
        setEntered(id);
      })
      .catch((caught) =>
        setHostErrors((previous) => [
          ...previous,
          {
            component: 'Backpack',
            what: 'The independent Backpack project could not be opened.',
            known: String(caught instanceof Error ? caught.message : caught),
            intact: 'The Backpack record and project files were not changed.',
            retryUseful: true,
            inspect: 'Return to Backpacks and enter it again.',
            recover: 'The independent project remains outside Papers.',
          },
        ]),
      );
  };

  const leaveEnteredBackpack = useCallback((): void => {
    void host()
      .backpackProject.close()
      .catch(() => undefined)
      .finally(() => {
        setProjectUrl(null);
        setEntered(null);
      });
  }, []);

  const openBasicOrReturnToBackpacks = (): void => {
    if (entered !== null) {
      setView('backpacks');
      setBasicOpen(false);
      leaveEnteredBackpack();
      return;
    }

    setBasicOpen((open) => !open);
  };

  const hermesBusy = hermes.status === 'starting';

  return (
    <div className="app">
      {/* Slim title bar: the whole band is an invisible OS drag region (so the
          window still moves), with interactive controls opting out. It replaces
          the generic dark Electron title bar and menu; the native
          minimize/maximize/close controls are painted by the OS in the reserved
          top-right inset. No wordmark, no File/Edit/View/Window menu. */}
      <header className="titlebar">
        <div className="titlebar-left" ref={basicRef}>
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

      {enteredBackpack &&
        (projectUrl ? (
          <BackpackProjectFrame url={projectUrl} onDismiss={leaveEnteredBackpack} />
        ) : (
          <EmptyBackpackWarning
            backpackName={enteredBackpack.name}
            onDismiss={leaveEnteredBackpack}
          />
        ))}

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
