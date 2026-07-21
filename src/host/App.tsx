import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HermesHealth } from '@shared/types';
import { host, type BackpacksList, type HostErrorPayload } from './bridge';
import { BackpacksPane } from './BackpacksPane';
import { ToolsPane } from './ToolsPane';
import { SettingsPane } from './SettingsPane';
import { EmptyBackpackWarning } from './EmptyBackpackWarning';
import { HermesDock } from './HermesDock';

type BasicView = 'backpacks' | 'tools' | 'settings';

const VIEW_LABEL: Record<BasicView, string> = {
  backpacks: 'Backpacks',
  tools: 'Tools',
  settings: 'Settings',
};

/**
 * Papers 3 production shell.
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
  const [hermesOpen, setHermesOpen] = useState(false);
  const [entered, setEntered] = useState<string | null>(null);
  const [hermes, setHermes] = useState<HermesHealth>({ state: 'unavailable', detail: 'starting' });
  const [hostErrors, setHostErrors] = useState<HostErrorPayload[]>([]);
  const basicRef = useRef<HTMLDivElement | null>(null);

  const refreshBackpacks = useCallback(async () => {
    setBackpacks(await host().backpacks.list());
  }, []);

  useEffect(() => {
    void refreshBackpacks();
    void host()
      .hermes.health()
      .then(setHermes)
      .catch(() => undefined);

    const bridge = host();
    const subs = [
      bridge.events.onBackpacksChanged(setBackpacks),
      bridge.events.onHermesHealth(setHermes),
      bridge.events.onHostError((e) => setHostErrors((prev) => [...prev, e])),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [refreshBackpacks]);

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

  const hermesReady = hermes.state === 'connected';
  const hermesLabel =
    hermes.state === 'connected'
      ? 'Hermes ready'
      : hermes.state === 'starting'
        ? 'Hermes starting'
        : 'Hermes';

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
          <span className={`hermes-badge${hermesReady ? ' ready' : hermes.state === 'unavailable' || hermes.state === 'disconnected' ? '' : ''}`}>
            <i />
            {hermesLabel}
          </span>
          <button className="pill-button" onClick={() => void host().hermes.openDesktop()}>
            Hermes window
          </button>
          <button className="pill-button solid" onClick={() => setHermesOpen(true)}>
            Hermes
          </button>
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

      {hermesOpen && <HermesDock onClose={() => setHermesOpen(false)} />}

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
