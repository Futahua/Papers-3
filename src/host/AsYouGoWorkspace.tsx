import React, { useCallback, useEffect, useState } from 'react';

import type { AsYouGoAction } from '@shared/asYouGo';
import { host } from './bridge';

/**
 * The finished, machine-local workflow for the creator's "As you Go" Backpack.
 *
 * Its actions are prepared outside the UI. Normal use is simply entering the
 * Backpack and choosing one; Papers exposes no editor or filesystem target.
 */
export function AsYouGoWorkspace(props: { onDismiss: () => void }): React.JSX.Element {
  const [actions, setActions] = useState<AsYouGoAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setActions(await host().asYouGo.listActions());
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const launch = async (action: AsYouGoAction): Promise<void> => {
    setBusy(action.id);
    setError(null);
    try {
      await host().asYouGo.launchAction(action.id);
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="as-you-go-workspace" aria-label="As you Go Backpack">
      <div className="as-you-go-inner">
        <header className="as-you-go-head">
          <div>
            <p className="eyebrow">Local Backpack</p>
            <h1>As you Go</h1>
            <p className="as-you-go-intro">Your prepared actions on this machine.</p>
          </div>
          <button className="ghost" onClick={props.onDismiss}>
            Back to Papers
          </button>
        </header>

        {error && (
          <div className="inline-error" role="alert">
            <span>{error}</span>
            <button className="ghost" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="as-you-go-status">Opening As you Go…</div>
        ) : actions.length === 0 ? (
          <div className="as-you-go-status">
            <strong>No prepared actions are available on this machine.</strong>
          </div>
        ) : (
          <div className="as-you-go-actions">
            {actions.map((action) => (
              <button
                className="as-you-go-action"
                key={action.id}
                disabled={busy !== null}
                onClick={() => void launch(action)}
              >
                <span className="as-you-go-mark" aria-hidden="true">↗</span>
                <span className="label">{action.label}</span>
                <span className="kind">Local action</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
