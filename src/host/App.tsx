import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AgentRunSnapshot,
  HermesHealth,
  PendingPermissionPrompt,
  ProgramStatus,
  ShelfContribution,
} from '@shared/types';
import {
  host,
  type BackpacksList,
  type CatalogInfo,
  type HostErrorPayload,
  type InvocationPreviewPayload,
  type SaveStatusPayload,
} from './bridge';
import { BackpackHome } from './BackpackHome';
import { CanvasFrame } from './CanvasFrame';
import { InvocationPreviewModal, PermissionPromptModal, PermissionsPanel } from './Modals';
import { RunsPanel } from './RunsPanel';
import { HermesDock } from './HermesDock';
import { WorkspaceFrame } from './WorkspaceFrame';

export function App(): React.JSX.Element {
  const [backpacks, setBackpacks] = useState<BackpacksList>({ backpacks: [], activeBackpackId: null });
  const [catalog, setCatalog] = useState<CatalogInfo>({
    programs: [],
    issues: [],
    statuses: [],
    activeProgramId: null,
  });
  const [shelf, setShelf] = useState<ShelfContribution[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatusPayload>({ status: 'idle', detail: null });
  const [hermes, setHermes] = useState<HermesHealth>({ state: 'unavailable', detail: 'starting' });
  const [permissionPrompts, setPermissionPrompts] = useState<PendingPermissionPrompt[]>([]);
  const [invocationPreviews, setInvocationPreviews] = useState<InvocationPreviewPayload[]>([]);
  const [runs, setRuns] = useState<Map<string, AgentRunSnapshot>>(new Map());
  const [runsOpen, setRunsOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [hostErrors, setHostErrors] = useState<HostErrorPayload[]>([]);
  const [hermesOpen, setHermesOpen] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setCatalog(await host().programs.catalog());
  }, []);

  const refreshBackpacks = useCallback(async () => {
    setBackpacks(await host().backpacks.list());
  }, []);

  const refreshRuns = useCallback(async () => {
    const list = await host().runs.list();
    setRuns(new Map(list.map((r) => [r.runId, r])));
  }, []);

  useEffect(() => {
    void refreshBackpacks();
    void refreshCatalog();
    void refreshRuns();
    void host()
      .hermes.health()
      .then(setHermes)
      .catch(() => undefined);

    const bridge = host();
    const subs = [
      bridge.events.onBackpacksChanged(setBackpacks),
      bridge.events.onProgramStatus((status: ProgramStatus) => {
        setCatalog((prev) => ({
          ...prev,
          statuses: [...prev.statuses.filter((s) => s.programId !== status.programId), status],
          activeProgramId:
            status.state === 'running' || status.state === 'loading'
              ? status.programId
              : prev.activeProgramId === status.programId
                ? status.state === 'stopped' || status.state === 'crashed' || status.state === 'quarantined'
                  ? prev.activeProgramId
                  : prev.activeProgramId
                : prev.activeProgramId,
        }));
      }),
      bridge.events.onShelfChanged(setShelf),
      bridge.events.onSaveStatus(setSaveStatus),
      bridge.events.onPermissionPrompt((p) => setPermissionPrompts((prev) => [...prev, p])),
      bridge.events.onInvocationPreview((p) => setInvocationPreviews((prev) => [...prev, p])),
      bridge.events.onRunsChanged((snapshot) =>
        setRuns((prev) => {
          const next = new Map(prev);
          next.set(snapshot.runId, snapshot);
          return next;
        }),
      ),
      bridge.events.onHermesHealth(setHermes),
      bridge.events.onHostError((e) => setHostErrors((prev) => [...prev, e])),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, [refreshBackpacks, refreshCatalog, refreshRuns]);

  // Auto-restore the last active Backpack on launch.
  useEffect(() => {
    void (async () => {
      const lastActive = await host().backpacks.lastActive();
      if (lastActive) {
        try {
          await host().backpacks.enter(lastActive);
          await refreshBackpacks();
          await refreshCatalog();
          await refreshRuns();
        } catch {
          // The backpack may have been archived or removed; stay on Home.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayActive =
    permissionPrompts.length > 0 || invocationPreviews.length > 0 || runsOpen || permissionsOpen || hermesOpen;

  useEffect(() => {
    void host().layout.setOverlayActive(overlayActive);
  }, [overlayActive]);

  const activeBackpack = useMemo(
    () => backpacks.backpacks.find((b) => b.id === backpacks.activeBackpackId) ?? null,
    [backpacks],
  );

  const runList = useMemo(
    () => [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [runs],
  );
  const busyRuns = runList.filter(
    (r) => r.state === 'running' || r.state === 'queued' || r.state === 'waiting-approval',
  ).length;
  const waitingRuns = runList.filter(
    (r) => r.state === 'waiting-approval' || r.state === 'waiting-clarification',
  ).length;
  const fixtureMode = catalog.programs.length > 0;

  return (
    <div className="app">
      {activeBackpack ? (
        fixtureMode ? (
          <CanvasFrame
            backpack={activeBackpack}
            catalog={catalog}
            shelf={shelf}
            saveStatus={saveStatus}
            hermes={hermes}
            busyRuns={busyRuns}
            waitingRuns={waitingRuns}
            onLeave={async () => {
              await host().backpacks.leave();
              await refreshBackpacks();
              await refreshCatalog();
            }}
            onOpenRuns={() => setRunsOpen((v) => !v)}
            onOpenPermissions={() => setPermissionsOpen(true)}
            onCatalogChanged={refreshCatalog}
          />
        ) : (
          <WorkspaceFrame
            backpack={activeBackpack}
            onChanged={refreshBackpacks}
            onOpenHermes={() => setHermesOpen(true)}
            onLeave={async () => {
              await host().backpacks.leave();
              await refreshBackpacks();
            }}
          />
        )
      ) : (
        <BackpackHome list={backpacks} onChanged={refreshBackpacks} onEntered={async () => {
          await refreshBackpacks();
          await refreshCatalog();
          await refreshRuns();
        }} onOpenHermes={() => setHermesOpen(true)} />
      )}

      {hermesOpen && <HermesDock onClose={() => setHermesOpen(false)} />}

      {fixtureMode && runsOpen && (
        <RunsPanel
          runs={runList}
          onClose={() => setRunsOpen(false)}
          onChanged={refreshRuns}
        />
      )}

      {fixtureMode && permissionsOpen && <PermissionsPanel onClose={() => setPermissionsOpen(false)} />}

      {fixtureMode && permissionPrompts.length > 0 && permissionPrompts[0] && (
        <PermissionPromptModal
          prompt={permissionPrompts[0]}
          onDecided={(promptId) =>
            setPermissionPrompts((prev) => prev.filter((p) => p.promptId !== promptId))
          }
        />
      )}

      {fixtureMode && invocationPreviews.length > 0 && invocationPreviews[0] && (
        <InvocationPreviewModal
          preview={invocationPreviews[0]}
          onDecided={(previewId) =>
            setInvocationPreviews((prev) => prev.filter((p) => p.previewId !== previewId))
          }
        />
      )}

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
          <button onClick={() => setHostErrors((prev) => prev.slice(1))}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
