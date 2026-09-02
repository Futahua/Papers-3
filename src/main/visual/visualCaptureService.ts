import { randomUUID } from 'node:crypto';

import { assessVisualConsistency, type VisualConsistency, type VisualObservationFence } from './visualObservation';
import type { ProcessInstanceIdentity } from './processIdentity';
import type { VisualArtifactMetadata, VisualArtifactStore } from './visualArtifactStore';
import type { VisualSurfaceObservationState } from './visualSurfaceObservationState';

export interface VisualCaptureTarget {
  windowId: number;
  surfaceId: string;
}

export interface VisualCaptureRuntime {
  senderId: number;
  capturePage(): Promise<Uint8Array>;
  requestFence(requestId: string): Promise<boolean>;
}

export interface VisualCaptureDependencies {
  processIdentity(): ProcessInstanceIdentity;
  topologyRevision(windowId: number): number;
  surface(target: VisualCaptureTarget): { projectId: string; presentation: 'not-created' | 'hidden' | 'visible' } | null;
  runtime(target: VisualCaptureTarget): VisualCaptureRuntime | null;
  observation(target: VisualCaptureTarget): VisualSurfaceObservationState | null;
  artifacts: VisualArtifactStore;
}

export interface VisualCaptureResult {
  captureId: string;
  target: VisualCaptureTarget & { projectId: string };
  observedAt: string;
  consistency: VisualConsistency;
  process: ProcessInstanceIdentity;
  revisions: {
    workspaceTopologyRevision: number;
    documentStateRevision: string | null;
    renderCycleId: string | null;
    layoutEpoch: number | null;
  };
  presentation: 'not-created' | 'hidden' | 'visible';
  summary: {
    domReady: boolean;
    hydrated: boolean;
    firstPaint: boolean;
    layoutStable: boolean;
    renderFailed: boolean;
    semanticKeys: string[];
  };
  png?: VisualArtifactMetadata;
}

function fenceFor(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  runtime: VisualCaptureRuntime,
  process: ProcessInstanceIdentity,
): VisualObservationFence {
  const state = deps.observation(target);
  return {
    target,
    process,
    topologyRevision: deps.topologyRevision(target.windowId),
    documentStateRevision: state?.documentStateRevision ?? null,
    renderCycleId: state?.renderCycleId ?? null,
    layoutEpoch: state?.layoutEpoch ?? null,
    senderBinding: state && state.senderId === runtime.senderId
      ? `${runtime.senderId}:${state.senderGeneration}`
      : null,
  };
}

function resultFor(
  target: VisualCaptureTarget,
  projectId: string,
  presentation: VisualCaptureResult['presentation'],
  captureId: string,
  observedAt: string,
  process: ProcessInstanceIdentity,
  consistency: VisualConsistency,
  revisions: VisualCaptureResult['revisions'],
  state: VisualSurfaceObservationState | null,
  png?: VisualArtifactMetadata,
): VisualCaptureResult {
  return {
    captureId,
    target: { ...target, projectId },
    observedAt,
    consistency,
    process,
    revisions,
    presentation,
    summary: {
      domReady: state?.domReady ?? false,
      hydrated: state?.hydrated ?? false,
      firstPaint: state?.firstPaint ?? false,
      layoutStable: state?.layoutStable ?? false,
      renderFailed: state?.renderFailed ?? false,
      semanticKeys: state?.semanticKeys ?? [],
    },
    ...(png ? { png } : {}),
  };
}

/** Capture one exact project WebContents with a bounded consistency retry.
 * This service never reloads, reopens, mutates, or searches for a nearby
 * window; failure is returned as an explicit unstable result. */
export async function captureVisualSurface(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
): Promise<VisualCaptureResult> {
  const captureId = randomUUID();
  const process = deps.processIdentity();
  const initial = deps.surface(target);
  if (!initial) throw new Error('That visual surface is unavailable.');
  if (initial.presentation !== 'visible') throw new Error('That visual surface is not visibly presented.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const runtime = deps.runtime(target);
    if (!runtime) throw new Error('That visual surface has no current renderer.');
    const currentState = deps.observation(target);
    if (!currentState || currentState.senderId !== runtime.senderId) {
      throw new Error('That visual surface has no current observation generation.');
    }
    if (!await runtime.requestFence(`${captureId}:pre:${attempt}`)) {
      throw new Error('That visual surface renderer did not answer its fence.');
    }
    const before = fenceFor(deps, target, runtime, process);
    const bytes = await runtime.capturePage();
    const afterAlive = await runtime.requestFence(`${captureId}:post:${attempt}`);
    const afterRuntime = afterAlive ? deps.runtime(target) : null;
    const after = afterRuntime ? fenceFor(deps, target, afterRuntime, process) : {
      ...before,
      senderBinding: null,
    };
    const consistency = assessVisualConsistency(before, after);
    if (consistency.status === 'stable') {
      const artifact = await deps.artifacts.put(bytes, 'image/png');
      const state = deps.observation(target);
      return resultFor(
        target,
        initial.projectId,
        initial.presentation,
        captureId,
        new Date().toISOString(),
        process,
        consistency,
        {
          workspaceTopologyRevision: after.topologyRevision,
          documentStateRevision: after.documentStateRevision,
          renderCycleId: after.renderCycleId,
          layoutEpoch: after.layoutEpoch,
        },
        state,
        artifact,
      );
    }
    if (attempt === 1) {
      const state = deps.observation(target);
      return resultFor(
        target,
        initial.projectId,
        initial.presentation,
        captureId,
        new Date().toISOString(),
        process,
        consistency,
        {
          workspaceTopologyRevision: after.topologyRevision,
          documentStateRevision: after.documentStateRevision,
          renderCycleId: after.renderCycleId,
          layoutEpoch: after.layoutEpoch,
        },
        state,
      );
    }
  }
  throw new Error('visual capture retry state is unreachable');
}
