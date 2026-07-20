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

export function InvocationPreviewModal(props: {
  preview: InvocationPreviewPayload;
  onDecided: (previewId: string) => void;
}): React.JSX.Element {
  const { preview } = props;
  const [showPrompt, setShowPrompt] = useState(false);
  const invocation = preview.invocation;

  const decide = async (approved: boolean): Promise<void> => {
    await host().runs.respondInvocation(preview.previewId, approved);
    props.onDecided(preview.previewId);
  };

  return (
    <div className="overlay-backdrop">
      <div className="modal">
        <header>Agent invocation preview — {invocation.action.label}</header>
        <div className="body">
          <div className="kv">
            <span className="k">Origin</span>
            <span>
              {invocation.origin.programId} / {invocation.origin.commandId}
            </span>
            <span className="k">Selection</span>
            <span>
              {invocation.selection.type} — {invocation.selection.references.length} item(s)
            </span>
            <span className="k">Destination</span>
            <span>
              {invocation.destination.programId} ({invocation.destination.type})
            </span>
            <span className="k">Capabilities</span>
            <span>{invocation.permissions.join(', ') || 'none'}</span>
            {invocation.execution?.preferredWorker && (
              <>
                <span className="k">Preferred worker</span>
                <span>{invocation.execution.preferredWorker}</span>
              </>
            )}
            {invocation.execution?.cwd && (
              <>
                <span className="k">Working directory</span>
                <span>{invocation.execution.cwd}</span>
              </>
            )}
          </div>

          {preview.disclosures.length > 0 && (
            <div className="disclosures">
              {preview.disclosures.map((d, i) => (
                <div key={i}>⚠ {d}</div>
              ))}
            </div>
          )}

          <span className="section-label">
            Shared material ({invocation.sharedMaterial.length} item(s))
          </span>
          {invocation.sharedMaterial.map((item, i) => (
            <details key={i}>
              <summary>
                {item.title} · {item.mediaType} · sha256 {item.contentHash.slice(0, 12)}…
                {item.truncated ? ' · TRUNCATED' : ''}
                {item.content === undefined ? ' · CONTENT OMITTED' : ''}
              </summary>
              <pre>{item.content ?? `(preview) ${item.preview}`}</pre>
            </details>
          ))}

          <span className="section-label">Exact prompt to Hermes</span>
          {showPrompt ? (
            <pre>{preview.composedPrompt}</pre>
          ) : (
            <button onClick={() => setShowPrompt(true)}>
              Show the exact composed prompt ({preview.composedPrompt.length} chars)
            </button>
          )}
        </div>
        <footer>
          <button className="danger" onClick={() => void decide(false)}>
            Cancel
          </button>
          <button className="primary" onClick={() => void decide(true)}>
            Invoke Hermes
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
          {grants.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No standing grants.</p>}
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
