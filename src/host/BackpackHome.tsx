import React, { useState } from 'react';

import { host, type BackpacksList } from './bridge';

export function BackpackHome(props: {
  list: BackpacksList;
  onChanged: () => Promise<void>;
  onEntered: () => Promise<void>;
  onOpenHermes?: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = props.list.backpacks.filter((b) => showArchived || !b.archived);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await props.onChanged();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <div className="home">
      <header className="home-bar">
        <h1>Papers</h1>
        <span className="spacer" />
        <button onClick={() => void host().hermes.openDesktop()}>Hermes window</button>
        {props.onOpenHermes && <button className="primary" onClick={props.onOpenHermes}>Hermes sidebar</button>}
      </header>
      <div className="home-intro">
        <h2>Backpacks</h2>
        <p className="subtitle">Visual working environments spanning your desktop.</p>
      </div>

      <div className="create-row">
        <input
          placeholder="New Backpack name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              void run(async () => {
                await host().backpacks.create(name.trim(), 'environment');
                setName('');
              });
            }
          }}
        />
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await host().backpacks.create(name.trim(), 'environment');
              setName('');
            })
          }
        >
          Create Backpack
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="backpack-list">
        {visible.length === 0 && (
          <p className="subtitle" style={{ textAlign: 'center' }}>
            No Backpacks yet.
          </p>
        )}
        {visible.map((backpack) => (
          <div key={backpack.id} className={`backpack-card${backpack.archived ? ' archived' : ''}`}>
            <div className="scene-preview" aria-hidden="true">
              <span className="scene-window wide" />
              <span className="scene-window left" />
              <span className="scene-window right" />
            </div>
            {renaming === backpack.id ? (
              <>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      void run(async () => {
                        await host().backpacks.rename(backpack.id, renameValue.trim());
                        setRenaming(null);
                      });
                    }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
                <button
                  onClick={() =>
                    run(async () => {
                      await host().backpacks.rename(backpack.id, renameValue.trim());
                      setRenaming(null);
                    })
                  }
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <div>
                  <div className="name">{backpack.name}</div>
                  <div className="meta">
                    Machine-wide environment
                    {backpack.lastEnteredAt
                      ? ` · last entered ${new Date(backpack.lastEnteredAt).toLocaleString()}`
                      : ' · never entered'}
                    {backpack.workspacePath ? ` · ${backpack.workspacePath}` : ''}
                    {backpack.archived ? ' · archived' : ''}
                  </div>
                </div>
                <div className="spacer" />
                {!backpack.archived && (
                  <button
                    className="primary"
                    onClick={() =>
                      run(async () => {
                        await host().backpacks.enter(backpack.id);
                        await props.onEntered();
                      })
                    }
                  >
                    Enter
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => {
                    setRenaming(backpack.id);
                    setRenameValue(backpack.name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="ghost"
                  onClick={() => run(() => host().backpacks.setArchived(backpack.id, !backpack.archived))}
                >
                  {backpack.archived ? 'Restore' : 'Archive'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <button className="ghost" onClick={() => setShowArchived((v) => !v)}>
        {showArchived ? 'Hide archived' : 'Show archived'}
      </button>
    </div>
  );
}
