import React, { useState } from 'react';

import type { AgentRunSnapshot } from '@shared/types';
import { host } from './bridge';

function RunCard(props: { run: AgentRunSnapshot; onChanged: () => Promise<void> }): React.JSX.Element {
  const { run } = props;
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const [sessionInfo, setSessionInfo] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } finally {
      await props.onChanged();
    }
  };

  return (
    <div className="run-card">
      <div className="row">
        <span className="label" title={run.actionLabel}>
          {run.actionLabel}
        </span>
        <span className={`badge ${run.state}`}>{run.state}</span>
      </div>
      <div className="row" style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>
        <span>
          {run.programId} · {new Date(run.createdAt).toLocaleTimeString()}
          {run.sessionId ? ` · session ${run.sessionId.slice(0, 8)}…` : ''}
        </span>
      </div>

      {run.failure && (
        <div style={{ color: 'var(--danger)', fontSize: 12 }}>
          {run.failure.component} failed ({run.failure.code}): {run.failure.message}
          {run.failure.retryUseful ? ' — retry may help.' : ''}
        </div>
      )}

      {run.pendingInteraction && (
        <div className="interaction">
          <strong>{run.pendingInteraction.title}</strong>
          {run.pendingInteraction.detail && (
            <pre style={{ maxHeight: 120 }}>{run.pendingInteraction.detail}</pre>
          )}
          <div className="options">
            {run.pendingInteraction.options.map((option) => (
              <button
                key={option.optionId}
                className={/deny|reject/i.test(option.kind) ? 'danger' : 'primary'}
                onClick={() =>
                  void act(() =>
                    host().runs.respondInteraction(
                      run.runId,
                      run.pendingInteraction?.requestId ?? '',
                      option.optionId,
                    ),
                  )
                }
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div className="events">
          {run.events.length === 0
            ? '(no public events yet)'
            : run.events
                .map((e) => `[${e.kind}] ${e.text}`)
                .join('\n')}
        </div>
      )}

      {expanded && run.result && (
        <div className="events" style={{ borderLeft: '2px solid var(--ok)' }}>
          {run.result.summary || '(empty result)'}
        </div>
      )}

      {sessionInfo && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', userSelect: 'text' }}>{sessionInfo}</div>
      )}

      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button className="ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse' : 'Details'}
        </button>
        {(run.state === 'running' || run.state === 'queued' || run.state === 'waiting-approval') && (
          <button className="danger" onClick={() => void act(() => host().runs.cancel(run.runId))}>
            Stop
          </button>
        )}
        {(run.state === 'failed' || run.state === 'cancelled') && (
          <button onClick={() => void act(() => host().runs.retry(run.runId))}>Retry</button>
        )}
        <button
          className="ghost"
          onClick={() =>
            void host()
              .runs.inspectInHermes(run.runId)
              .then((info) =>
                setSessionInfo(
                  info.sessionId
                    ? `Authoritative Hermes session: ${info.sessionId} — open Hermes Desktop or run "hermes --resume ${info.sessionId}" to inspect.`
                    : 'No Hermes session was created for this run.',
                ),
              )
          }
        >
          Inspect in Hermes
        </button>
        <button className="ghost" onClick={() => void act(() => host().runs.returnToOrigin(run.runId))}>
          Go to origin
        </button>
      </div>

      {run.state === 'completed' && (
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="Reply / answer a clarification…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reply.trim()) {
                const text = reply.trim();
                setReply('');
                void act(() => host().runs.reply(run.runId, text));
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

export function RunsPanel(props: {
  runs: AgentRunSnapshot[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="side-panel">
      <header>
        Agent Runs
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={props.onClose}>
          Close
        </button>
      </header>
      <div className="body">
        {props.runs.length === 0 && (
          <p style={{ color: 'var(--text-dim)', padding: 8 }}>
            No agent runs in this Backpack yet. Programs create runs from exact selections.
          </p>
        )}
        {props.runs.map((run) => (
          <RunCard key={run.runId} run={run} onChanged={props.onChanged} />
        ))}
      </div>
    </div>
  );
}
