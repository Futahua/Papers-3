import { randomUUID } from 'node:crypto';

import type { VisualElementObservation } from '@shared/visualSemanticKeys';
import { assessVisualConsistency, type VisualConsistency, type VisualObservationFence } from './visualObservation';
import type { ProcessInstanceIdentity } from './processIdentity';
import type { VisualArtifactMetadata, VisualArtifactStore } from './visualArtifactStore';
import type { VisualSurfaceObservationState } from './visualSurfaceObservationState';
import { awaitVisualOperation, revokeVisualArtifact, throwIfVisualOperationAborted } from './visualCancellation';

export interface VisualCaptureTarget {
  windowId: number;
  surfaceId: string;
}

export interface VisualCaptureRuntime {
  senderId: number;
  capturePage(): Promise<Uint8Array>;
  requestFence(requestId: string, documentInstanceId: string): Promise<boolean>;
}

export interface VisualElementCaptureRequest {
  elementKey: string;
  paddingCssPx: number;
}

export interface VisualElementCropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualElementCropRequest {
  boundsCss: VisualElementObservation['boundsCss'];
  paddingCssPx: number;
  viewportCss: { width: number; height: number };
}

export interface VisualElementCropResult {
  bytes: Uint8Array;
  bounds: VisualElementCropBounds;
}

export function computeVisualElementCropBounds(
  imageSize: { width: number; height: number },
  request: VisualElementCropRequest,
): VisualElementCropBounds {
  if (!Number.isFinite(request.viewportCss.width) || !Number.isFinite(request.viewportCss.height)
    || request.viewportCss.width <= 0 || request.viewportCss.height <= 0) {
    throw new Error('That visual element has no accepted CSS viewport.');
  }
  const scaleX = imageSize.width / request.viewportCss.width;
  const scaleY = imageSize.height / request.viewportCss.height;
  const left = (request.boundsCss.x - request.paddingCssPx) * scaleX;
  const top = (request.boundsCss.y - request.paddingCssPx) * scaleY;
  const rightEdge = (request.boundsCss.x + request.boundsCss.width + request.paddingCssPx) * scaleX;
  const bottomEdge = (request.boundsCss.y + request.boundsCss.height + request.paddingCssPx) * scaleY;
  const x = Math.max(0, Math.min(imageSize.width, Math.floor(left)));
  const y = Math.max(0, Math.min(imageSize.height, Math.floor(top)));
  const right = Math.max(x, Math.min(imageSize.width, Math.ceil(rightEdge)));
  const bottom = Math.max(y, Math.min(imageSize.height, Math.ceil(bottomEdge)));
  if (right <= x || bottom <= y) throw new Error('That visual element is outside the captured surface.');
  return { x, y, width: right - x, height: bottom - y };
}

export interface VisualCaptureDependencies {
  processIdentity(): ProcessInstanceIdentity;
  topologyRevision(windowId: number): number;
  surface(target: VisualCaptureTarget): { projectId: string; presentation: 'not-created' | 'hidden' | 'visible' } | null;
  runtime(target: VisualCaptureTarget): VisualCaptureRuntime | null;
  observation(target: VisualCaptureTarget): VisualSurfaceObservationState | null;
  elementObservations?(target: VisualCaptureTarget): readonly VisualElementObservation[];
  elementViewportCss?(target: VisualCaptureTarget): { width: number; height: number } | null;
  cropPng?(bytes: Uint8Array, request: VisualElementCropRequest): VisualElementCropResult | Promise<VisualElementCropResult>;
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
  element?: VisualElementObservation;
  crop?: VisualElementCropBounds;
  png?: VisualArtifactMetadata;
}

function fenceFor(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  runtime: VisualCaptureRuntime,
  process: ProcessInstanceIdentity,
  state: VisualSurfaceObservationState | null = deps.observation(target),
): VisualObservationFence {
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
    documentInstanceId: state?.documentInstanceId ?? null,
  };
}

interface CaptureSnapshot {
  fence: VisualObservationFence;
  state: VisualSurfaceObservationState | null;
  projectId: string | null;
  presentation: VisualCaptureResult['presentation'];
}

function snapshotFor(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  runtime: VisualCaptureRuntime,
  process: ProcessInstanceIdentity,
): CaptureSnapshot {
  const state = deps.observation(target);
  const surface = deps.surface(target);
  return {
    fence: fenceFor(deps, target, runtime, process, state),
    state,
    projectId: surface?.projectId ?? null,
    presentation: surface?.presentation ?? 'not-created',
  };
}

function currentRendererChanged(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  expected: VisualCaptureRuntime,
  expectedDocumentInstanceId: string,
): boolean {
  const current = deps.runtime(target);
  const state = deps.observation(target);
  return !current || current.senderId !== expected.senderId
    || state?.senderId !== expected.senderId
    || state.documentInstanceId !== expectedDocumentInstanceId;
}

function unstableSnapshot(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  process: ProcessInstanceIdentity,
  previous: CaptureSnapshot,
): CaptureSnapshot {
  const runtime = deps.runtime(target);
  if (runtime) return snapshotFor(deps, target, runtime, process);
  const state = deps.observation(target);
  return {
    fence: {
      ...previous.fence,
      topologyRevision: deps.topologyRevision(target.windowId),
      senderBinding: null,
      documentInstanceId: state?.documentInstanceId ?? null,
    },
    state,
    projectId: deps.surface(target)?.projectId ?? null,
    presentation: deps.surface(target)?.presentation ?? 'not-created',
  };
}

function instabilityReason(
  before: CaptureSnapshot,
  after: CaptureSnapshot,
  initialProjectId: string,
): VisualConsistency {
  if (after.projectId !== null && after.projectId !== initialProjectId) return { status: 'unstable', reason: 'topology-changed' };
  return assessVisualConsistency(before.fence, after.fence);
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
  element?: VisualElementObservation,
  crop?: VisualElementCropBounds,
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
    ...(element ? { element } : {}),
    ...(crop ? { crop } : {}),
    ...(png ? { png } : {}),
  };
}

/** Capture one exact project WebContents with a bounded consistency retry.
 * This service never reloads, reopens, mutates, or searches for a nearby
 * window; failure is returned as an explicit unstable result. */
export async function captureVisualSurface(
  deps: VisualCaptureDependencies,
  target: VisualCaptureTarget,
  elementRequest?: VisualElementCaptureRequest,
  signal?: AbortSignal,
): Promise<VisualCaptureResult> {
  throwIfVisualOperationAborted(signal);
  const captureId = randomUUID();
  const process = deps.processIdentity();
  const initial = deps.surface(target);
  if (!initial) throw new Error('That visual surface is unavailable.');
  if (initial.presentation !== 'visible') throw new Error('That visual surface is not visibly presented.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfVisualOperationAborted(signal);
    const runtime = deps.runtime(target);
    if (!runtime) {
      const after = unstableSnapshot(deps, target, process, {
        fence: fenceFor(deps, target, { senderId: -1 } as VisualCaptureRuntime, process),
        state: deps.observation(target),
        projectId: deps.surface(target)?.projectId ?? null,
        presentation: deps.surface(target)?.presentation ?? 'not-created',
      });
      const reason = deps.surface(target) ? 'renderer-replaced' : 'topology-changed';
      return resultFor(target, initial.projectId, initial.presentation, captureId, new Date().toISOString(), process,
        { status: 'unstable', reason }, {
          workspaceTopologyRevision: after.fence.topologyRevision,
          documentStateRevision: after.fence.documentStateRevision,
          renderCycleId: after.fence.renderCycleId,
          layoutEpoch: after.fence.layoutEpoch,
        }, after.state);
    }
    const currentState = deps.observation(target);
    if (!currentState || currentState.senderId !== runtime.senderId) {
      const after = snapshotFor(deps, target, runtime, process);
      const consistency = { status: 'unstable', reason: 'renderer-replaced' } as const;
      if (attempt === 1) {
        return resultFor(target, initial.projectId, initial.presentation, captureId, new Date().toISOString(), process, consistency, {
          workspaceTopologyRevision: after.fence.topologyRevision,
          documentStateRevision: after.fence.documentStateRevision,
          renderCycleId: after.fence.renderCycleId,
          layoutEpoch: after.fence.layoutEpoch,
        }, after.state);
      }
      continue;
    }
    const documentInstanceId = currentState.documentInstanceId;
    if (!documentInstanceId) throw new Error('That visual surface has no current document instance.');
    throwIfVisualOperationAborted(signal);
    const preFenceAnswered = await awaitVisualOperation(
      runtime.requestFence(`${captureId}:pre:${attempt}`, documentInstanceId), signal,
    );
    throwIfVisualOperationAborted(signal);
    if (!preFenceAnswered) {
      if (!currentRendererChanged(deps, target, runtime, documentInstanceId)) {
        throw new Error('That visual surface renderer did not answer its fence.');
      }
      const after = unstableSnapshot(deps, target, process, snapshotFor(deps, target, runtime, process));
      if (attempt === 1) {
        return resultFor(target, initial.projectId, initial.presentation, captureId, new Date().toISOString(), process,
          { status: 'unstable', reason: 'renderer-replaced' }, {
            workspaceTopologyRevision: after.fence.topologyRevision,
            documentStateRevision: after.fence.documentStateRevision,
            renderCycleId: after.fence.renderCycleId,
            layoutEpoch: after.fence.layoutEpoch,
          }, after.state);
      }
      continue;
    }
    const before = snapshotFor(deps, target, runtime, process);
    let bytes: Uint8Array;
    try {
      bytes = await awaitVisualOperation(runtime.capturePage(), signal);
      throwIfVisualOperationAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!currentRendererChanged(deps, target, runtime, documentInstanceId)) throw error;
      const after = unstableSnapshot(deps, target, process, before);
      if (attempt === 1) {
        return resultFor(target, initial.projectId, initial.presentation, captureId, new Date().toISOString(), process,
          { status: 'unstable', reason: 'renderer-replaced' }, {
            workspaceTopologyRevision: after.fence.topologyRevision,
            documentStateRevision: after.fence.documentStateRevision,
            renderCycleId: after.fence.renderCycleId,
            layoutEpoch: after.fence.layoutEpoch,
          }, after.state);
      }
      continue;
    }
    const afterAlive = await awaitVisualOperation(
      runtime.requestFence(`${captureId}:post:${attempt}`, documentInstanceId), signal,
    );
    throwIfVisualOperationAborted(signal);
    if (!afterAlive && !currentRendererChanged(deps, target, runtime, documentInstanceId)) {
      throw new Error('That visual surface renderer did not answer its post-capture fence.');
    }
    const afterRuntime = afterAlive ? deps.runtime(target) : null;
    const after = afterRuntime ? snapshotFor(deps, target, afterRuntime, process) : unstableSnapshot(deps, target, process, before);
    const consistency = afterAlive && afterRuntime
      ? instabilityReason(before, after, initial.projectId)
      : { status: 'unstable', reason: deps.surface(target) ? 'renderer-replaced' : 'topology-changed' } as const;
    if (consistency.status === 'stable') {
      let artifactBytes = bytes;
      let element: VisualElementObservation | undefined;
      let crop: VisualElementCropBounds | undefined;
      if (elementRequest) {
        if (!after.state?.layoutStable) throw new Error('That visual element has no stable geometry.');
        element = deps.elementObservations?.(target).find((candidate) => candidate.key === elementRequest.elementKey);
        if (!element) throw new Error('That visual element is unavailable.');
        const viewportCss = deps.elementViewportCss?.(target);
        if (!viewportCss || viewportCss.width <= 0 || viewportCss.height <= 0) throw new Error('That visual element has no accepted CSS viewport.');
        if (!deps.cropPng) throw new Error('Visual element cropping is unavailable.');
        const cropped = await awaitVisualOperation(
          Promise.resolve(deps.cropPng(bytes, { boundsCss: element.boundsCss, paddingCssPx: elementRequest.paddingCssPx, viewportCss })), signal,
        );
        throwIfVisualOperationAborted(signal);
        crop = cropped.bounds;
        artifactBytes = cropped.bytes;
      }
      const artifact = await awaitVisualOperation(
        deps.artifacts.put(artifactBytes, 'image/png'),
        signal,
        revokeVisualArtifact(deps.artifacts.delete),
      );
      throwIfVisualOperationAborted(signal);
      const artifactFence = snapshotFor(deps, target, runtime, process);
      const artifactConsistency = instabilityReason(after, artifactFence, initial.projectId);
      if (artifactConsistency.status !== 'stable') {
        await deps.artifacts.delete(artifact.artifactId);
        if (attempt === 1) {
          return resultFor(target, initial.projectId, initial.presentation, captureId, new Date().toISOString(), process, artifactConsistency, {
            workspaceTopologyRevision: artifactFence.fence.topologyRevision,
            documentStateRevision: artifactFence.fence.documentStateRevision,
            renderCycleId: artifactFence.fence.renderCycleId,
            layoutEpoch: artifactFence.fence.layoutEpoch,
          }, artifactFence.state);
        }
        continue;
      }
      return resultFor(
        target,
        initial.projectId,
        initial.presentation,
        captureId,
        new Date().toISOString(),
        process,
        consistency,
        {
          workspaceTopologyRevision: after.fence.topologyRevision,
          documentStateRevision: after.fence.documentStateRevision,
          renderCycleId: after.fence.renderCycleId,
          layoutEpoch: after.fence.layoutEpoch,
        },
        after.state,
        artifact,
        element,
        crop,
      );
    }
    if (attempt === 1) {
      return resultFor(
        target,
        initial.projectId,
        initial.presentation,
        captureId,
        new Date().toISOString(),
        process,
        consistency,
        {
          workspaceTopologyRevision: after.fence.topologyRevision,
          documentStateRevision: after.fence.documentStateRevision,
          renderCycleId: after.fence.renderCycleId,
          layoutEpoch: after.fence.layoutEpoch,
        },
        after.state,
      );
    }
  }
  throw new Error('visual capture retry state is unreachable');
}
