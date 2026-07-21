import React, { useState } from 'react';

import type { BackpackSummary } from '@shared/types';
import { host } from './bridge';

export function WorkspaceFrame(props: {
  backpack: BackpackSummary;
  onLeave: () => Promise<void>;
  onChanged: () => Promise<void>;
  onOpenHermes: () => void;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const chooseWorkspace = async (): Promise<void> => {
    setError(null);
    try {
      await host().backpacks.chooseWorkspace();
      await props.onChanged();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    }
  };

  return (
    <div className="environment-frame">
      <header className="environment-bar">
        <button className="ghost" onClick={() => void props.onLeave()}>← Backpacks</button>
        <span className="backpack-name">{props.backpack.name}</span>
        <span className="spacer" />
        {props.backpack.workspacePath ? (
          <>
            <button className="workspace-chip" title={props.backpack.workspacePath} onClick={() => void chooseWorkspace()}>
              Folder · {props.backpack.workspacePath.split(/[\\/]/).filter(Boolean).at(-1)}
            </button>
            <button
              className="ghost"
              onClick={() => void host().backpacks.clearWorkspace().then(props.onChanged)}
            >
              Clear
            </button>
          </>
        ) : (
          <button className="ghost" onClick={() => void chooseWorkspace()}>Choose folder</button>
        )}
        <button onClick={() => void host().hermes.openDesktop()}>Hermes window</button>
        <button className="primary" onClick={props.onOpenHermes}>Hermes sidebar</button>
      </header>
      <main className="environment-space">
        <p>(machine wide complex capability)</p>
      </main>
      {error && <div className="environment-error">{error}</div>}
    </div>
  );
}
