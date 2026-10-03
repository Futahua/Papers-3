import React, { useEffect, useRef } from 'react';

import type { BackpackSummary, HermesHealth, ShelfContribution } from '@shared/types';
import { host, type CatalogInfo, type SaveStatusPayload } from './bridge';

export function CanvasFrame(props: {
  backpack: BackpackSummary;
  catalog: CatalogInfo;
  shelf: ShelfContribution[];
  saveStatus: SaveStatusPayload;
  hermes: HermesHealth;
  busyRuns: number;
  waitingRuns: number;
  onLeave: () => Promise<void>;
  onOpenRuns: () => void;
  onOpenPermissions: () => void;
  onCatalogChanged: () => Promise<void>;
}): React.JSX.Element {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const active = props.catalog.programs.find((p) => p.id === props.catalog.activeProgramId) ?? null;
  const activeStatus = props.catalog.statuses.find(
    (s) => s.programId === props.catalog.activeProgramId,
  );
  const crashed =
    activeStatus && (activeStatus.state === 'crashed' || activeStatus.state === 'quarantined');
  const showPlaceholder = !active || activeStatus?.state === 'stopped' || crashed;

  // Report the program surface bounds so the main process can position the
  // sandboxed program view under this area.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const report = (): void => {
      const rect = el.getBoundingClientRect();
      void host().layout.setProgramBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  // Escape returns focus to the host frame (focus recovery).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveChip = (() => {
    switch (props.saveStatus.status) {
      case 'saving':
        return { className: 'chip busy', text: 'Saving…' };
      case 'saved':
        return { className: 'chip ok', text: 'Saved' };
      case 'error':
        return { className: 'chip error', text: 'Save failed' };
      default:
        return { className: 'chip', text: 'Idle' };
    }
  })();

  const hermesChip = (() => {
    switch (props.hermes.state) {
      case 'connected':
        return { className: 'chip ok', text: 'Hermes' };
      case 'starting':
        return { className: 'chip busy', text: 'Hermes…' };
      case 'disconnected':
        return { className: 'chip warn', text: 'Hermes lost' };
      default:
        return { className: 'chip error', text: 'Hermes off' };
    }
  })();

  return (
    <div className="frame">
      <div className="topbar">
        <button onClick={() => void props.onLeave()} title="Leave this Backpack">
          ← Leave
        </button>
        <span className="backpack-name" title={props.backpack.name}>
          {props.backpack.name}
        </span>
        <div className="divider" />
        {props.catalog.programs.map((program) => (
          <button
            key={program.id}
            className={program.id === props.catalog.activeProgramId ? 'primary' : ''}
            title={program.description ?? program.name}
            onClick={() =>
              void host()
                .programs.start(program.id)
                .then(props.onCatalogChanged)
                .catch(() => props.onCatalogChanged())
            }
          >
            {program.name}
          </button>
        ))}
        {props.shelf.length > 0 && <div className="divider" />}
        <div className="shelf">
          {props.shelf.map((item) => (
            <button
              key={item.id}
              title={item.title ?? item.label}
              onClick={() => void host().programs.invokeCommand(item.commandId)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button
          className="ghost"
          onClick={props.onOpenRuns}
          title="Agent runs"
        >
          Runs{props.busyRuns > 0 ? ` (${props.busyRuns} active)` : ''}
          {props.waitingRuns > 0 ? ` ⚠ ${props.waitingRuns}` : ''}
        </button>
        <button className="ghost" onClick={props.onOpenPermissions} title="Permissions">
          Permissions
        </button>
        <span className={hermesChip.className} title={JSON.stringify(props.hermes)}>
          <span className="dot" /> {hermesChip.text}
        </span>
        <span className={saveChip.className} title={props.saveStatus.detail ?? ''}>
          <span className="dot" /> {saveChip.text}
        </span>
      </div>

      <div className="program-area" ref={areaRef}>
        {crashed && activeStatus && active ? (
          <div className="recovery">
            <div className="box">
              <h3>
                {activeStatus.state === 'quarantined' ? 'Program quarantined' : 'Program crashed'}
              </h3>
              <p>
                <strong>{active.name}</strong> failed
                {activeStatus.quarantineReason ? `: ${activeStatus.quarantineReason}` : '.'} The
                Canvas frame and your saved state are intact. Crash count:{' '}
                {activeStatus.crashCount}.
              </p>
              <div className="actions">
                {activeStatus.state === 'quarantined' ? (
                  <button
                    className="primary"
                    onClick={() =>
                      void host()
                        .programs.clearQuarantine(active.id)
                        .then(() => host().programs.restart(active.id))
                        .then(props.onCatalogChanged)
                    }
                  >
                    Clear quarantine and restart
                  </button>
                ) : (
                  <button
                    className="primary"
                    onClick={() =>
                      void host().programs.restart(active.id).then(props.onCatalogChanged)
                    }
                  >
                    Restart program
                  </button>
                )}
                <button onClick={() => void host().programs.stop().then(props.onCatalogChanged)}>
                  Close program
                </button>
              </div>
            </div>
          </div>
        ) : showPlaceholder ? (
          <div className="program-placeholder">
            <p>Choose a program for this Canvas.</p>
            <div className="cards">
              {props.catalog.programs.map((program) => (
                <div
                  key={program.id}
                  className="program-card"
                  onClick={() =>
                    void host()
                      .programs.start(program.id)
                      .then(props.onCatalogChanged)
                      .catch(() => props.onCatalogChanged())
                  }
                >
                  <div className="title">{program.name}</div>
                  <div className="desc">{program.description ?? `Version ${program.version}`}</div>
                  <div className="status">
                    {props.catalog.statuses.find((s) => s.programId === program.id)?.state ??
                      'stopped'}
                  </div>
                </div>
              ))}
              {props.catalog.programs.length === 0 && (
                <p>No programs are installed with this build.</p>
              )}
            </div>
            {props.catalog.issues.length > 0 && (
              <div style={{ color: 'var(--warn)', fontSize: 12 }}>
                {props.catalog.issues.map((issue) => (
                  <div key={issue.directory}>
                    {issue.directory}: {issue.problem}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
