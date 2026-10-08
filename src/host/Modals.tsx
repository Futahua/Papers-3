import React, { useEffect, useState } from 'react';

import type { PendingPermissionPrompt } from '@shared/types';
import { host, type InvocationPreviewPayload } from './bridge';

export function PermissionPromptModal(props: {
  prompt: PendingPermissionPrompt;
  onDecided: (promptId: string) => void;
}): React.JSX.Element {
  const { prompt } = props;
  const decide = async (decision: string): Promise<void> => {
    await host().permissions.respond(prompt.promptId, decision);
    props.onDecided(prompt.promptId);
  };
  return (
    <div className="overlay-backdrop">
      <div className="modal" style={{ width: 'min(520px, 92vw)' }}>
        <header>Permission request</header>
        <div className="body">
          <div className="kv">
            <span className="k">Program</span>
            <span>{prompt.request.programId}</span>
            <span className="k">Capability</span>
            <span>
              <code>{prompt.request.capability}</code>
            </span>
            <span className="k">Reason</span>
            <span>{prompt.request.reason}</span>
            <span className="k">Will do</span>
            <span>{prompt.summary}</span>
          </div>
        </div>
        <footer>
          <button className="danger" onClick={() => void decide('deny')}>
            Deny
          </button>
          <button onClick={() => void decide('allow-once')}>Allow once</button>
          <button className="primary" onClick={() => void decide('allow-program')}>
            Allow for this program
          </button>
        </footer>
      </div>
    </div>
  );
}

export function PermissionsPanel(props: { onClose: () => void }): React.JSX.Element {
  const [grants, setGrants] = useState<
    { backpackId: string; programId: string; capability: string; grantedAt: string }[]
  >([]);

  const refresh = async (): Promise<void> => {
    setGrants(await host().permissions.list());
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="overlay-backdrop" onClick={props.onClose}>
      <div className="modal" style={{ width: 'min(640px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <header>Permissions</header>
        <div className="body">
          {grants.length === 0 && <p style={{ color: '#9aa1af' }}>No standing grants.</p>}
          {grants.map((grant, i) => (
            <div key={i} className="run-card">
              <div className="row">
                <span className="label">
                  {grant.programId} · <code>{grant.capability}</code>
                </span>
                <span className="badge">{new Date(grant.grantedAt).toLocaleDateString()}</span>
                <button
                  className="danger"
                  onClick={() =>
                    void host()
                      .permissions.revoke(grant.backpackId, grant.programId, grant.capability)
                      .then(refresh)
                  }
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
        <footer>
          <button onClick={props.onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
