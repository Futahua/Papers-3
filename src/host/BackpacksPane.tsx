import React, { useState } from 'react';

import { host, type BackpacksList } from './bridge';

/**
 * Backpacks — a name-only list of machine-wide environments.
 *
 * Creating a Backpack asks for a name and nothing else: no folder, cover,
 * canvas, Tool or conversation. Entering is handled by the shell, which shows
 * the honest empty-Backpack warning until a real content contract exists.
 */
export function BackpacksPane(props: {
  list: BackpacksList;
  onChanged: () => Promise<void>;
  onEnter: (id: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = props.list.backpacks.filter((b) => showArchived || !b.archived);
  const hasArchived = props.list.backpacks.some((b) => b.archived);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await props.onChanged();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const create = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      await host().backpacks.create(trimmed);
      setName('');
    });
  };

  return (
    <div className="pane">
      <div className="pane-inner">
        <div className="pane-head">
          <p className="eyebrow">Basic</p>
          <h1>Backpacks</h1>
          <p>
            Named environments that reach across your whole machine, its files, knowledge and Tools.
            A Backpack is not a folder or a boxed application — it is a way of working you shape
            through use.
          </p>
        </div>

        {error && <div className="inline-error">{error}</div>}

        <div className="create-row">
          <input
            placeholder="New Backpack name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
          <button className="primary" disabled={!name.trim()} onClick={create}>
            Add Backpack
          </button>
        </div>

        <div className="backpack-list">
          {visible.length === 0 && (
            <div className="list-empty">
              <strong>No Backpacks yet</strong>
              <p>Add a Backpack above to reserve a named environment. It starts empty and you shape it later.</p>
            </div>
          )}
          {visible.map((backpack) => (
            <div key={backpack.id} className={`backpack-card${backpack.archived ? ' archived' : ''}`}>
              <span className="mark" aria-hidden="true">
                {backpack.name.trim().charAt(0).toUpperCase() || 'B'}
              </span>
              {renaming === backpack.id ? (
                <>
                  <input
                    className="rename-input"
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
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={!renameValue.trim()}
                      onClick={() =>
                        run(async () => {
                          await host().backpacks.rename(backpack.id, renameValue.trim());
                          setRenaming(null);
                        })
                      }
                    >
                      Save
                    </button>
                    <button className="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="body">
                    <div className="name">{backpack.name}</div>
                    <div className="meta">
                      {backpack.archived ? 'Archived' : 'Environment'}
                      {backpack.lastEnteredAt ? ' · entered' : ' · never entered'}
                    </div>
                  </div>
                  <div className="actions">
                    {!backpack.archived && (
                      <button className="secondary" onClick={() => props.onEnter(backpack.id)}>
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
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {hasArchived && (
          <div className="pane-footer">
            <button className="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
