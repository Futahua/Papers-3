import { randomUUID } from 'node:crypto';

import { createAdoptedWindowFollower } from './adoptedWindowFollower';
import {
  createForeignWindowSurfaceCollection,
  type ForeignWindowSurfaceCollection,
  type ForeignWindowSurfaceSnapshot,
} from './foreignWindowSurfaceCollection';
export type { ForeignWindowSurfaceSnapshot } from './foreignWindowSurfaceCollection';
import type {
  PersistedWindowMemberDescriptor,
  WindowResolveResult,
  WindowRuntimeCapability,
} from './windowCapabilityService';
import type { WindowBounds, WindowCapabilityResult } from './windowCapabilityTypes';

export interface ForeignWindowSurfaceControllerService {
  resolvePersisted(descriptor: PersistedWindowMemberDescriptor): Promise<WindowResolveResult>;
  observeCapability(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  placeAdoptedCapability(capability: WindowRuntimeCapability, bounds: WindowBounds, hostWindow?: string): Promise<WindowCapabilityResult>;
  minimizeCapability?(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  restoreCapability?(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
}

export type ForeignSurfaceActionResult =
  | { outcome: 'success'; surface: ForeignWindowSurfaceSnapshot }
  | { outcome: 'missing' | 'ambiguous' | 'denied' | 'malformed' | 'helper-unavailable' | 'timeout'; error?: string; surface?: ForeignWindowSurfaceSnapshot };

export interface ForeignWindowSurfaceController {
  create(input: { surfaceId?: string; descriptor: PersistedWindowMemberDescriptor; title?: string; hostWindowId?: number }): ForeignWindowSurfaceSnapshot;
  resolve(surfaceId: string): Promise<ForeignSurfaceActionResult>;
  /** Re-issue a fresh capability after helper restart without replacing the
   * captured pre-adoption rectangle. */
  reconnect(surfaceId: string): Promise<ForeignSurfaceActionResult>;
  follow(surfaceId: string, bounds: WindowBounds, hostWindow?: string): Promise<ForeignSurfaceActionResult>;
  setVisible(surfaceId: string, visible: boolean): Promise<ForeignSurfaceActionResult>;
  release(surfaceId: string, hostWindow?: string): Promise<ForeignSurfaceActionResult>;
  markDisconnected(surfaceId: string): ForeignWindowSurfaceSnapshot | null;
  retire(surfaceId: string): boolean;
  snapshot(): ForeignWindowSurfaceSnapshot[];
}

function publicSnapshot(record: ReturnType<ForeignWindowSurfaceCollection['get']>): ForeignWindowSurfaceSnapshot | null {
  if (!record) return null;
  return {
    surfaceId: record.surfaceId,
    descriptor: { ...record.descriptor },
    title: record.title,
    state: record.state,
    paneBounds: record.paneBounds ? { ...record.paneBounds } : null,
    originalBounds: record.originalBounds ? { ...record.originalBounds } : null,
    hostWindowId: record.hostWindowId,
  };
}

function failure(result: { outcome: string; error?: string }, surface?: ForeignWindowSurfaceSnapshot): ForeignSurfaceActionResult {
  return { outcome: result.outcome as Exclude<ForeignSurfaceActionResult['outcome'], 'success'>, ...(result.error ? { error: result.error } : {}), ...(surface ? { surface } : {}) };
}

export function createForeignWindowSurfaceController(
  service: ForeignWindowSurfaceControllerService,
  collection = createForeignWindowSurfaceCollection(),
): ForeignWindowSurfaceController {
  const followers = new Map<string, ReturnType<typeof createAdoptedWindowFollower>>();

  function recordFor(surfaceId: string) {
    const record = collection.get(surfaceId);
    if (!record) throw new Error(`foreign surface ${surfaceId} does not exist`);
    return record;
  }

  function snapshotOf(surfaceId: string): ForeignWindowSurfaceSnapshot {
    const snapshot = publicSnapshot(recordFor(surfaceId));
    if (!snapshot) throw new Error(`foreign surface ${surfaceId} does not exist`);
    return snapshot;
  }

  return {
    create(input) {
      const surfaceId = input.surfaceId ?? `foreign-${randomUUID()}`;
      collection.add({
        surfaceId,
        descriptor: { ...input.descriptor },
        title: input.title ?? input.descriptor.title,
        state: 'disconnected',
        paneBounds: null,
        originalBounds: null,
        hostWindowId: input.hostWindowId ?? null,
        capability: null,
      });
      return snapshotOf(surfaceId);
    },

    async resolve(surfaceId) {
      const record = recordFor(surfaceId);
      if (record.state !== 'disconnected') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      record.state = 'resolving';
      const resolved = await service.resolvePersisted(record.descriptor).catch(() => ({ outcome: 'helper-unavailable' as const, error: 'window resolution failed' }));
      if (resolved.outcome !== 'success') {
        record.state = 'disconnected';
        return failure(resolved, snapshotOf(surfaceId));
      }
      const follower = createAdoptedWindowFollower(service);
      const adopted = await follower.adopt(resolved.capability);
      if (adopted.outcome !== 'adopted') {
        record.state = 'disconnected';
        return failure(adopted, snapshotOf(surfaceId));
      }
      record.descriptor = { ...resolved.descriptor };
      record.capability = resolved.capability;
      if (!record.originalBounds) record.originalBounds = { ...adopted.originalBounds };
      record.state = 'live-visible';
      followers.set(surfaceId, follower);
      return { outcome: 'success', surface: snapshotOf(surfaceId) };
    },

    async reconnect(surfaceId) {
      const record = recordFor(surfaceId);
      if (record.state === 'live-visible') {
        record.state = 'disconnected';
        record.capability = null;
        followers.delete(surfaceId);
      }
      if (record.state !== 'disconnected') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      return this.resolve(surfaceId);
    },

    async follow(surfaceId, bounds, hostWindow) {
      const record = recordFor(surfaceId);
      const follower = followers.get(surfaceId);
      if (record.state !== 'live-visible' || !follower) {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      const moved = await follower.follow(bounds, hostWindow);
      if (moved.outcome === 'applied' || moved.outcome === 'unchanged') {
        record.paneBounds = { ...bounds };
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      }
      if (moved.outcome === 'missing') {
        record.state = 'disconnected';
        record.capability = null;
        followers.delete(surfaceId);
      }
      return failure(moved, snapshotOf(surfaceId));
    },

    async setVisible(surfaceId, visible) {
      const record = recordFor(surfaceId);
      if (record.state !== 'live-visible' || !record.capability) {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      const action = visible ? service.restoreCapability : service.minimizeCapability;
      if (!action) return { outcome: 'malformed', error: 'visibility control is unavailable', surface: snapshotOf(surfaceId) };
      const result = await action.call(service, record.capability);
      if (result.outcome === 'success') {
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      }
      if (result.outcome === 'missing') {
        record.state = 'disconnected';
        record.capability = null;
        followers.delete(surfaceId);
      }
      return failure(result, snapshotOf(surfaceId));
    },

    async release(surfaceId, hostWindow) {
      const record = recordFor(surfaceId);
      const follower = followers.get(surfaceId);
      if (record.state !== 'live-visible' || !follower) {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      record.state = 'releasing';
      const released = await follower.release(hostWindow);
      if (released.outcome === 'released' || released.outcome === 'missing') {
        record.state = 'released';
        record.capability = null;
        followers.delete(surfaceId);
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      }
      record.state = 'live-visible';
      return failure(released, snapshotOf(surfaceId));
    },

    markDisconnected(surfaceId) {
      const record = collection.get(surfaceId);
      if (!record) return null;
      record.state = 'disconnected';
      record.capability = null;
      followers.delete(surfaceId);
      return snapshotOf(surfaceId);
    },

    retire(surfaceId) {
      const record = collection.get(surfaceId);
      if (!record || (record.state !== 'released' && record.state !== 'disconnected')) return false;
      followers.delete(surfaceId);
      return collection.remove(surfaceId);
    },

    snapshot() {
      return collection.snapshot();
    },
  };
}
