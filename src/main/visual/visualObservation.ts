import type { ProcessInstanceIdentity } from './processIdentity';

export interface VisualObservationFence {
  target: { windowId: number; surfaceId?: string };
  process: ProcessInstanceIdentity;
  topologyRevision: number;
  documentStateRevision: string | null;
  renderCycleId: string | null;
  layoutEpoch: number | null;
  senderBinding: string | null;
}

export type VisualConsistencyReason =
  | 'layout-changed'
  | 'state-changed'
  | 'topology-changed'
  | 'renderer-replaced';

export type VisualConsistency =
  | { status: 'stable' }
  | { status: 'unstable'; reason: VisualConsistencyReason };

/**
 * Compare the fences surrounding one screenshot.  The capture service should
 * call this after the PNG and renderer observation are collected; it must not
 * turn a changed fence into a plausible stable result.
 */
export function assessVisualConsistency(
  before: VisualObservationFence,
  after: VisualObservationFence,
): VisualConsistency {
  if (before.process.pid !== after.process.pid
    || before.process.appInstanceId !== after.process.appInstanceId
    || before.process.startedAt !== after.process.startedAt
    || before.process.executableIdentity.canonicalFileId !== after.process.executableIdentity.canonicalFileId
    || before.senderBinding !== after.senderBinding) {
    return { status: 'unstable', reason: 'renderer-replaced' };
  }
  if (before.target.windowId !== after.target.windowId
    || before.target.surfaceId !== after.target.surfaceId
    || before.topologyRevision !== after.topologyRevision) {
    return { status: 'unstable', reason: 'topology-changed' };
  }
  if (before.documentStateRevision !== after.documentStateRevision
    || before.renderCycleId !== after.renderCycleId) {
    return { status: 'unstable', reason: 'state-changed' };
  }
  if (before.layoutEpoch !== after.layoutEpoch) {
    return { status: 'unstable', reason: 'layout-changed' };
  }
  return { status: 'stable' };
}

