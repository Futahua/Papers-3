import React, { useCallback, useEffect, useState } from 'react';

import type { BackpackButton, BackpackSummary } from '@shared/types';
import { host } from './bridge';

function defaultLabel(target: string): string {
  const name = target.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  return name.replace(/\.[^.]+$/, '') || name;
}

/** The first real Backpack content: small creator-authored Windows launch buttons. */
export function BackpackWorkspace(props: {
  backpack: BackpackSummary;
  onDismiss: () => void;
}): React.JSX.Element {
  const [buttons, setButtons] = useState<BackpackButton[]>([]);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setButtons(await host().backpacks.listButtons(props.backpack.id));
  }, [props.backpack.id]);

  useEffect(() => {
    void refresh().catch((err) => setError(String(err instanceof Error ? err.message : err)));
  }, [refresh]);

  const choose = async (kind: 'file' | 'folder'): Promise<void> => {
    setError(null);
    try {
      const selected = await host().backpacks.pickButtonTarget(kind);
      if (!selected) return;
      setTarget(selected);
      if (!label.trim()) setLabel(defaultLabel(selected));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const save = async (): Promise<void> => {
    if (!label.trim() || !target.trim()) return;
    setError(null);
    try {
      await host().backpacks.createButton(props.backpack.id, label.trim(), target.trim());
      setLabel('');
      setTarget('');
      setEditing(false);
      await refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const launch = async (button: BackpackButton): Promise<void> => {
    setBusy(button.id);
    setError(null);
    try {
      await host().backpacks.launchButton(props.backpack.id, button.id);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (button: BackpackButton): Promise<void> => {
    setError(null);
    try {
      await host().backpacks.removeButton(props.backpack.id, button.id);
      await refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <section className="backpack-workspace" aria-label={`${props.backpack.name} Backpack`}>
      <div className="backpack-workspace-inner">
        <header className="backpack-head">
          <div>
            <p className="eyebrow">Backpack</p>
            <h1>{props.backpack.name}</h1>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => setEditing(true)}>
              Add button
            </button>
            <button className="ghost" onClick={props.onDismiss}>
              Back to Papers
            </button>
          </div>
        </header>

        {error && <div className="inline-error">{error}</div>}

        {editing && (
          <div className="button-editor">
            <label>
              <span>Name</span>
              <input
                name="label"
                autoFocus
                placeholder="Button name"
                value={label}
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label className="target-field">
              <span>Target</span>
              <input
                name="target"
                placeholder="Shortcut, script, app, file, or folder path"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </label>
            <div className="button-editor-actions">
              <button className="ghost" onClick={() => void choose('file')}>Choose file</button>
              <button className="ghost" onClick={() => void choose('folder')}>Choose folder</button>
              <span className="spacer" />
              <button
                className="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button className="primary" disabled={!label.trim() || !target.trim()} onClick={() => void save()}>
                Save button
              </button>
            </div>
          </div>
        )}

        {buttons.length === 0 && !editing ? (
          <div className="buttons-empty">
            <strong>Nothing here yet.</strong>
            <p>Add a button for a shortcut, script, app, file, or folder.</p>
            <button className="primary" onClick={() => setEditing(true)}>Add button</button>
          </div>
        ) : (
          <div className="launch-grid">
            {buttons.map((button) => (
              <div className="launch-card" key={button.id}>
                <button
                  className="launch-button"
                  disabled={busy === button.id}
                  title={button.target}
                  onClick={() => void launch(button)}
                >
                  <span className="launch-mark" aria-hidden="true">↗</span>
                  <span className="label">{button.label}</span>
                  <span className="target">{button.target}</span>
                </button>
                <button className="remove-button" aria-label={`Remove ${button.label}`} onClick={() => void remove(button)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
