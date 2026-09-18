/**
 * Adopted-window geometry follower (foreign windows, first usable slice).
 *
 * A main-owned, capability-scoped controller that moves ONE verified foreign
 * top-level window to a caller-supplied screen rectangle and restores its
 * original rectangle on release. Deliberately narrow:
 *
 * - geometry only (`placeAdoptedCapability`, a dedicated helper method that
 *   performs SWP_NOZORDER | SWP_NOACTIVATE without raising). No Z-order write, no hide/cloak, no
 *   minimize/restore, no close, no style change. The worst case a crash
 *   leaves behind is a window sitting at its last pane rectangle, which the
 *   creator can drag away; nothing is hidden or stranded.
 * - every `follow` re-observes and revalidates identity (process id and
 *   window class) BEFORE applying. Any mismatch is terminal: no further
 *   mutation for this adoption, ever. A numeric-HWND/token reuse can only
 *   produce a typed failure, never a move of a different window.
 * - release after doubt performs NO mutation: restoring the remembered
 *   rectangle onto a window that failed verification would move whatever
 *   happens to hold the token now.
 * - no persistence, no timers, no polling inside. The caller (pane layout)
 *   drives `follow` on geometry change; identical bounds dedupe to zero
 *   helper traffic.
 *
 * New files only: this module touches no shared seam (capability service,
 * helper scripts, IPC, preload, topology), so it merges cleanly beside the
 * window-layout activation work on the same seams.
 */

import type {
  WindowBounds,
  WindowCapabilityResult,
  WindowObservation,
} from './windowCapabilityTypes';
import type { WindowRuntimeCapability } from './windowCapabilityService';

/** Minimal capability surface the follower needs; the real
 * `WindowCapabilityService` satisfies this structurally. */
export interface AdoptedWindowFollowerService {
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  placeAdoptedCapability(capability: WindowRuntimeCapability, bounds: WindowBounds, hostWindow?: string): Promise<WindowCapabilityResult>;
}

export type AdoptedWindowFollowerState = 'idle' | 'following' | 'identity-lost' | 'released';

/** Any non-success service outcome, passed through verbatim (fail closed). */
type FailureOutcome = Exclude<WindowCapabilityResult['outcome'], 'success'>;

export type AdoptedWindowAdoptOutcome =
  | { outcome: 'adopted'; originalBounds: WindowBounds }
  | { outcome: FailureOutcome; error?: string };

export type AdoptedWindowFollowOutcome =
  | { outcome: 'applied' | 'unchanged' }
  | { outcome: FailureOutcome; error?: string };

export type AdoptedWindowReleaseOutcome =
  | { outcome: 'released'; restored: boolean }
  | { outcome: FailureOutcome; error?: string };

const BOUND_LIMIT = 32768;

function validBounds(bounds: WindowBounds): boolean {
  for (const value of [bounds.x, bounds.y, bounds.width, bounds.height]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  }
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  if (bounds.width > BOUND_LIMIT || bounds.height > BOUND_LIMIT) return false;
  if (Math.abs(bounds.x) > BOUND_LIMIT || Math.abs(bounds.y) > BOUND_LIMIT) return false;
  return true;
}

function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

interface IdentitySnapshot {
  processId: number | null;
  windowClass?: string;
}

function identityMismatch(snapshot: IdentitySnapshot, observed: WindowObservation): string | null {
  if (snapshot.processId !== null && observed.processId !== null && snapshot.processId !== observed.processId) {
    return `process changed (was ${snapshot.processId}, now ${observed.processId})`;
  }
  if (snapshot.windowClass !== undefined && observed.windowClass !== undefined && snapshot.windowClass !== observed.windowClass) {
    return `window class changed (was ${snapshot.windowClass}, now ${observed.windowClass})`;
  }
  return null;
}

export function createAdoptedWindowFollower(service: AdoptedWindowFollowerService) {
  let state: AdoptedWindowFollowerState = 'idle';
  let capability: WindowRuntimeCapability | null = null;
  let identity: IdentitySnapshot | null = null;
  let originalBounds: WindowBounds | null = null;
  let lastApplied: WindowBounds | null = null;

  /** Observe and capture the pre-adoption rectangle. Refuses (never coerces)
   * when the window cannot be observed or offers no restore rectangle. */
  async function adopt(candidate: WindowRuntimeCapability): Promise<AdoptedWindowAdoptOutcome> {
    if (state !== 'idle') return { outcome: 'malformed', error: 'follower is already adopted' };
    if (!candidate || typeof candidate !== 'object' || candidate.version !== 1) {
      return { outcome: 'malformed', error: 'capability is malformed' };
    }
    const observed = await service.observeCapability(candidate);
    if (observed.outcome !== 'success' || !observed.observation) {
      return { outcome: observed.outcome as FailureOutcome, ...(observed.error !== undefined ? { error: observed.error } : {}) };
    }
    const current = observed.observation;
    if (current.state === 'missing' || current.bounds === null) {
      return { outcome: 'missing', error: 'original bounds are unavailable' };
    }
    capability = candidate;
    identity = { processId: current.processId, ...(current.windowClass !== undefined ? { windowClass: current.windowClass } : {}) };
    originalBounds = { ...current.bounds };
    lastApplied = null;
    state = 'following';
    return { outcome: 'adopted', originalBounds: { ...originalBounds } };
  }

  /** Move the adopted window to `bounds` after revalidating identity.
   * Identical-to-last-applied bounds dedupe to zero helper traffic. */
  async function follow(bounds: WindowBounds, hostWindow?: string): Promise<AdoptedWindowFollowOutcome> {
    if (state !== 'following' || !capability || !identity) {
      if (state === 'identity-lost' || state === 'released') {
        return { outcome: 'missing', error: 'adoption is terminal; no further mutation' };
      }
      return { outcome: 'malformed', error: 'follower is not adopted' };
    }
    if (!validBounds(bounds)) return { outcome: 'malformed', error: 'bounds are malformed' };
    if (lastApplied && sameBounds(lastApplied, bounds)) return { outcome: 'unchanged' };
    const observed = await service.observeCapability(capability);
    if (observed.outcome !== 'success' || !observed.observation) {
      if (observed.outcome === 'missing') state = 'identity-lost';
      return { outcome: observed.outcome as FailureOutcome, ...(observed.error !== undefined ? { error: observed.error } : {}) };
    }
    const current = observed.observation;
    if (current.state === 'missing') {
      state = 'identity-lost';
      return { outcome: 'missing', error: 'target window is gone' };
    }
    const mismatch = identityMismatch(identity, current);
    if (mismatch) {
      state = 'identity-lost';
      capability = null;
      return { outcome: 'missing', error: mismatch };
    }
    const applied = await service.placeAdoptedCapability(capability, bounds, hostWindow);
    if (applied.outcome !== 'success') return { outcome: applied.outcome as FailureOutcome, ...(applied.error !== undefined ? { error: applied.error } : {}) };
    lastApplied = { ...bounds };
    return { outcome: 'applied' };
  }

  /** Restore the pre-adoption rectangle and retire. After doubt
   * (`identity-lost`) this performs NO mutation: the token no longer names a
   * verified window. */
  async function release(hostWindow?: string): Promise<AdoptedWindowReleaseOutcome> {
    if (state === 'identity-lost' || capability === null || originalBounds === null) {
      state = 'released';
      return { outcome: 'missing', error: 'nothing verified left to restore' };
    }
    if (state !== 'following') return { outcome: 'malformed', error: 'follower is not adopted' };
    const observed = await service.observeCapability(capability);
    if (observed.outcome === 'success' && observed.observation && identity) {
      const mismatch = identityMismatch(identity, observed.observation);
      if (mismatch || observed.observation.state === 'missing') {
        state = 'released';
        capability = null;
        return { outcome: 'missing', error: mismatch ?? 'target window is gone' };
      }
    } else if (observed.outcome !== 'success') {
      return { outcome: observed.outcome as FailureOutcome, ...(observed.error !== undefined ? { error: observed.error } : {}) };
    }
    const restored = await service.placeAdoptedCapability(capability, originalBounds, hostWindow);
    if (restored.outcome !== 'success') {
      // Keep the verified capability and original rectangle alive when the
      // helper has a transient failure.  The caller can retry the restore;
      // clearing authority here would strand the foreign window at its dock
      // rectangle with no safe way back.
      return { outcome: restored.outcome as FailureOutcome, ...(restored.error !== undefined ? { error: restored.error } : {}) };
    }
    state = 'released';
    capability = null;
    return { outcome: 'released', restored: true };
  }

  /** Discard an adopted capability before any presentation mutation. This is
   * used when durable recovery could not be armed; unlike release(), it never
   * sends a native placement request. */
  function abandon(): void {
    state = 'released';
    capability = null;
    identity = null;
    originalBounds = null;
    lastApplied = null;
  }

  return {
    adopt,
    follow,
    release,
    abandon,
    get state(): AdoptedWindowFollowerState {
      return state;
    },
  };
}
