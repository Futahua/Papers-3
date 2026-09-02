import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';

import { assessVisualConsistency, type VisualConsistency } from './visualObservation';
import type { ProcessInstanceIdentity } from './processIdentity';
import type { VisualArtifactMetadata, VisualArtifactStore } from './visualArtifactStore';
import type { VisualNativeWindowCapture } from './visualWindowNativeCapture';
import type { VisualSurfaceObservationState } from './visualSurfaceObservationState';

export interface VisualWindowCaptureTarget {
  windowId: number;
}

export interface VisualWindowCaptureSurface {
  surfaceId: string;
  projectId: string;
  presentation: 'visible';
  observation: VisualSurfaceObservationState | null;
}

export interface VisualWindowCaptureNativeWindow {
  windowId: number;
  sourceId: string;
  visible: boolean;
  nativeBounds: { x: number; y: number; width: number; height: number };
  hostContents: WebContents;
}

export interface VisualWindowCaptureDependencies {
  processIdentity(): ProcessInstanceIdentity;
  window(target: VisualWindowCaptureTarget): VisualWindowCaptureNativeWindow | null;
  topologyRevision(windowId: number): number;
  visibleSurfaces(windowId: number): VisualWindowCaptureSurface[];
  requestCapture(
    window: VisualWindowCaptureNativeWindow,
    requestId: string,
    size: { width: number; height: number },
  ): Promise<VisualNativeWindowCapture | null>;
  artifacts: VisualArtifactStore;
}

export interface VisualWindowCaptureResult {
  captureId: string;
  target: VisualWindowCaptureTarget;
  observedAt: string;
  consistency: VisualConsistency;
  process: ProcessInstanceIdentity;
  revisions: { workspaceTopologyRevision: number };
  nativeBounds: { x: number; y: number; width: number; height: number };
  pixelSize: { width: number; height: number };
  surfaces: Array<{
    surfaceId: string;
    projectId: string;
    presentation: 'visible';
    revisions: {
      documentStateRevision: string | null;
      renderCycleId: string | null;
      layoutEpoch: number | null;
    };
  }>;
  png?: VisualArtifactMetadata;
}

interface WindowCaptureSnapshot {
  window: VisualWindowCaptureNativeWindow;
  process: ProcessInstanceIdentity;
  topologyRevision: number;
  surfaces: VisualWindowCaptureSurface[];
}

function senderBinding(observation: VisualSurfaceObservationState | null): string | null {
  return observation && observation.senderId !== null
    ? `${observation.senderId}:${observation.senderGeneration}`
    : null;
}

function sameProcess(left: ProcessInstanceIdentity, right: ProcessInstanceIdentity): boolean {
  return left.pid === right.pid
    && left.appInstanceId === right.appInstanceId
    && left.startedAt === right.startedAt
    && left.build.commit === right.build.commit
    && left.build.packaged === right.build.packaged
    && left.executableIdentity.status === right.executableIdentity.status
    && (left.executableIdentity.status === 'unavailable'
      || right.executableIdentity.status === 'unavailable'
      || left.executableIdentity.canonicalFileId === right.executableIdentity.canonicalFileId);
}

function sameBounds(left: VisualWindowCaptureNativeWindow['nativeBounds'], right: VisualWindowCaptureNativeWindow['nativeBounds']): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function reasonForChange(before: WindowCaptureSnapshot, after: WindowCaptureSnapshot): VisualConsistency {
  if (!sameProcess(before.process, after.process)) return { status: 'unstable', reason: 'renderer-replaced' };
  if (before.window.windowId !== after.window.windowId
    || before.window.sourceId !== after.window.sourceId
    || !sameBounds(before.window.nativeBounds, after.window.nativeBounds)
    || before.window.visible !== after.window.visible) {
    return { status: 'unstable', reason: 'topology-changed' };
  }
  if (before.topologyRevision !== after.topologyRevision
    || before.surfaces.length !== after.surfaces.length
    || before.surfaces.some((surface, index) => {
      const other = after.surfaces[index];
      return !other
        || surface.surfaceId !== other.surfaceId
        || surface.projectId !== other.projectId
        || surface.presentation !== other.presentation;
    })) {
    return { status: 'unstable', reason: 'topology-changed' };
  }
  if (before.surfaces.some((surface, index) => {
    const other = after.surfaces[index]!;
    return senderBinding(surface.observation) !== senderBinding(other.observation);
  })) {
    return { status: 'unstable', reason: 'renderer-replaced' };
  }
  if (before.surfaces.some((surface, index) => {
    const other = after.surfaces[index]!;
    const left = surface.observation;
    const right = other.observation;
    return left?.documentInstanceId !== right?.documentInstanceId
      || left?.renderCycleId !== right?.renderCycleId;
  })) {
    return { status: 'unstable', reason: 'state-changed' };
  }
  if (before.surfaces.some((surface, index) => {
    const other = after.surfaces[index]!;
    const left = surface.observation;
    const right = other.observation;
    return left?.documentStateRevision !== right?.documentStateRevision;
  })) return { status: 'unstable', reason: 'state-changed' };
  if (before.surfaces.some((surface, index) => surface.observation?.layoutEpoch !== after.surfaces[index]!.observation?.layoutEpoch)) {
    return { status: 'unstable', reason: 'layout-changed' };
  }
  return { status: 'stable' };
}

function snapshotFor(
  deps: VisualWindowCaptureDependencies,
  target: VisualWindowCaptureTarget,
  process: ProcessInstanceIdentity,
): WindowCaptureSnapshot | null {
  const window = deps.window(target);
  if (!window || !window.visible || window.hostContents.isDestroyed()) return null;
  return {
    window,
    process,
    topologyRevision: deps.topologyRevision(target.windowId),
    surfaces: deps.visibleSurfaces(target.windowId).map((surface) => ({ ...surface, observation: surface.observation ? { ...surface.observation } : null })),
  };
}

function publicSurfaces(surfaces: VisualWindowCaptureSurface[]): VisualWindowCaptureResult['surfaces'] {
  return surfaces.map((surface) => ({
    surfaceId: surface.surfaceId,
    projectId: surface.projectId,
    presentation: surface.presentation,
    revisions: {
      documentStateRevision: surface.observation?.documentStateRevision ?? null,
      renderCycleId: surface.observation?.renderCycleId ?? null,
      layoutEpoch: surface.observation?.layoutEpoch ?? null,
    },
  }));
}

function resultFor(
  target: VisualWindowCaptureTarget,
  captureId: string,
  process: ProcessInstanceIdentity,
  snapshot: WindowCaptureSnapshot,
  native: VisualNativeWindowCapture,
  consistency: VisualConsistency,
  png?: VisualArtifactMetadata,
): VisualWindowCaptureResult {
  return {
    captureId,
    target,
    observedAt: new Date().toISOString(),
    consistency,
    process,
    revisions: { workspaceTopologyRevision: snapshot.topologyRevision },
    nativeBounds: { ...snapshot.window.nativeBounds },
    pixelSize: { width: native.width, height: native.height },
    surfaces: publicSurfaces(snapshot.surfaces),
    ...(png ? { png } : {}),
  };
}

/** Capture the exact native Papers window through its opaque Electron source
 * id. The host renderer only performs desktopCapturer's renderer-only lookup;
 * main owns identity, consistency, artifact storage and bounded retry. */
export async function captureVisualWindow(
  deps: VisualWindowCaptureDependencies,
  target: VisualWindowCaptureTarget,
  requestedSize: { width: number; height: number } = { width: 4096, height: 4096 },
): Promise<VisualWindowCaptureResult> {
  const captureId = randomUUID();
  const process = deps.processIdentity();
  const initial = snapshotFor(deps, target, process);
  if (!initial) throw new Error('That Papers window is unavailable or not visible.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = snapshotFor(deps, target, process);
    if (!before) {
      throw new Error('That Papers window became unavailable during capture.');
    }
    const native = await deps.requestCapture(before.window, `${captureId}:native:${attempt}`, requestedSize);
    if (!native) throw new Error('The exact native Papers window could not be captured.');
    if (native.sourceId !== before.window.sourceId) {
      if (attempt === 1) throw new Error('The native capture source changed during capture.');
      continue;
    }
    const after = snapshotFor(deps, target, process);
    if (!after) {
      return resultFor(target, captureId, process, before, native, { status: 'unstable', reason: 'topology-changed' });
    }
    const consistency = reasonForChange(before, after);
    if (consistency.status === 'stable') {
      const artifact = await deps.artifacts.put(native.bytes, 'image/png');
      const artifactFence = snapshotFor(deps, target, process);
      const artifactConsistency = artifactFence ? reasonForChange(after, artifactFence) : { status: 'unstable', reason: 'topology-changed' } as const;
      if (artifactConsistency.status === 'stable') {
        return resultFor(target, captureId, process, after, native, consistency, artifact);
      }
      await deps.artifacts.delete(artifact.artifactId);
      if (attempt === 1) return resultFor(target, captureId, process, artifactFence ?? after, native, artifactConsistency);
      continue;
    }
    if (attempt === 1) return resultFor(target, captureId, process, after, native, consistency);
  }
  throw new Error('visual window capture retry state is unreachable');
}
