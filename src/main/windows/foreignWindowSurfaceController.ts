import { randomUUID } from 'node:crypto';

import type { WindowLayoutBroker, WindowLayoutHostBounds } from './windowLayoutBroker';
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
  /** Retained for the separate Alt+D dock tool; foreign workspace surfaces do
   * not use top-level placement anymore. */
  placeAdoptedCapability?(capability: WindowRuntimeCapability, bounds: WindowBounds, hostWindow?: string): Promise<WindowCapabilityResult>;
  minimizeCapability?(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
  restoreCapability?(capability: WindowRuntimeCapability): Promise<WindowCapabilityResult>;
}

export type ForeignSurfaceActionResult =
  | { outcome: 'success'; surface: ForeignWindowSurfaceSnapshot }
  | { outcome: 'missing' | 'ambiguous' | 'denied' | 'malformed' | 'helper-unavailable' | 'timeout'; error?: string; surface?: ForeignWindowSurfaceSnapshot };

export interface ForeignWindowSurfaceController {
  create(input: { surfaceId?: string; descriptor: PersistedWindowMemberDescriptor; title?: string; hostWindowId?: number }): ForeignWindowSurfaceSnapshot;
  resolve(surfaceId: string): Promise<ForeignSurfaceActionResult>;
  reconnect(surfaceId: string): Promise<ForeignSurfaceActionResult>;
  /** Bounds are Papers client coordinates. The native broker resizes a child
   * host HWND; it never converts them to desktop coordinates. */
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

function validBounds(bounds: WindowBounds): boolean {
  return Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
    && bounds.width > 0 && bounds.height > 0
    && bounds.width <= 32768 && bounds.height <= 32768
    && Math.abs(bounds.x) <= 32768 && Math.abs(bounds.y) <= 32768;
}

export function createForeignWindowSurfaceController(
  service: ForeignWindowSurfaceControllerService,
  collection = createForeignWindowSurfaceCollection(),
  nativeBroker?: WindowLayoutBroker | null,
  options: { allowLegacyPlacement?: boolean } = {},
): ForeignWindowSurfaceController {
  const hosted = new Set<string>();
  // Only the separate Alt+D dock tool may use this legacy placement path. The
  // workspace controller always receives a native broker and never falls back
  // to teleporting a top-level window.
  const legacyPlaced = new Set<string>();
  let brokerActive = nativeBroker !== null && nativeBroker !== undefined;
  const allowLegacyPlacement = options.allowLegacyPlacement === true;

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

  async function releaseNative(surfaceId: string): Promise<boolean> {
    if (!nativeBroker || !hosted.has(surfaceId)) return true;
    const released = await nativeBroker.release(surfaceId).catch(() => false);
    if (released) hosted.delete(surfaceId);
    return released;
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
      const observed = await service.observeCapability(resolved.capability).catch(() => ({ outcome: 'helper-unavailable' as const, error: 'window observation failed' }));
      if (observed.outcome !== 'success' || !observed.observation?.bounds || observed.observation.state !== 'normal') {
        record.state = 'disconnected';
        return failure(observed.outcome === 'success' ? { outcome: 'missing', error: 'window is not hostable in its current state' } : observed, snapshotOf(surfaceId));
      }
      record.descriptor = { ...resolved.descriptor };
      record.capability = resolved.capability;
      if (!record.originalBounds) record.originalBounds = { ...observed.observation.bounds };
      record.state = 'live-visible';
      return { outcome: 'success', surface: snapshotOf(surfaceId) };
    },

    async reconnect(surfaceId) {
      const record = recordFor(surfaceId);
      if (record.state === 'live-visible') {
        await releaseNative(surfaceId).catch(() => undefined);
        record.state = 'disconnected';
        record.capability = null;
      }
      if (record.state !== 'disconnected') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      return this.resolve(surfaceId);
    },

    async follow(surfaceId, bounds, hostWindow) {
      const record = recordFor(surfaceId);
      if (record.state !== 'live-visible') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      if (!validBounds(bounds)) {
        return { outcome: 'helper-unavailable', error: 'this window cannot be hosted inside Papers', surface: snapshotOf(surfaceId) };
      }
      if (!nativeBroker && allowLegacyPlacement) {
        if (!service.placeAdoptedCapability || !record.capability) {
          return { outcome: 'helper-unavailable', error: 'native hosting is unavailable', surface: snapshotOf(surfaceId) };
        }
        const placed = await service.placeAdoptedCapability(record.capability, bounds, hostWindow).catch(() => ({ outcome: 'helper-unavailable' as const }));
        if (placed.outcome !== 'success') return failure(placed, snapshotOf(surfaceId));
        legacyPlaced.add(surfaceId);
        record.paneBounds = { ...bounds };
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      }
      if (!nativeBroker) {
        return { outcome: 'helper-unavailable', error: 'native hosting is unavailable', surface: snapshotOf(surfaceId) };
      }
      if (!brokerActive || !hostWindow || !record.descriptor.windowInstanceId) {
        return { outcome: 'helper-unavailable', error: 'this window cannot be hosted inside Papers', surface: snapshotOf(surfaceId) };
      }
      try {
        if (!hosted.has(surfaceId)) {
          if (!await nativeBroker.createHost(surfaceId, hostWindow)) {
            brokerActive = false;
            return { outcome: 'helper-unavailable', error: 'Papers could not create a native pane host', surface: snapshotOf(surfaceId) };
          }
          if (!await nativeBroker.adopt(surfaceId, record.descriptor.windowInstanceId)) {
            await nativeBroker.release(surfaceId).catch(() => undefined);
            return { outcome: 'helper-unavailable', error: 'This application cannot be hosted inside Papers', surface: snapshotOf(surfaceId) };
          }
          hosted.add(surfaceId);
        }
        if (!await nativeBroker.setBounds(surfaceId, bounds as WindowLayoutHostBounds)) {
          return { outcome: 'helper-unavailable', error: 'the native pane host rejected its bounds', surface: snapshotOf(surfaceId) };
        }
        record.paneBounds = { ...bounds };
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      } catch {
        brokerActive = false;
        return { outcome: 'helper-unavailable', error: 'the native pane host stopped', surface: snapshotOf(surfaceId) };
      }
    },

    async setVisible(surfaceId, visible) {
      const record = recordFor(surfaceId);
      if (record.state !== 'live-visible') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      if (!hosted.has(surfaceId)) return { outcome: 'success', surface: snapshotOf(surfaceId) };
      if (!nativeBroker || !await nativeBroker.setVisible(surfaceId, visible).catch(() => false)) {
        return { outcome: 'helper-unavailable', error: 'the native pane host could not change visibility', surface: snapshotOf(surfaceId) };
      }
      return { outcome: 'success', surface: snapshotOf(surfaceId) };
    },

    async release(surfaceId, hostWindow) {
      const record = recordFor(surfaceId);
      if (record.state !== 'live-visible') {
        return { outcome: 'malformed', error: `surface is ${record.state}`, surface: snapshotOf(surfaceId) };
      }
      record.state = 'releasing';
      if (!nativeBroker) {
        if (!legacyPlaced.has(surfaceId) || !service.placeAdoptedCapability || !record.capability || !record.originalBounds) {
          record.state = 'released';
          record.capability = null;
          return { outcome: 'success', surface: snapshotOf(surfaceId) };
        }
        const restored = await service.placeAdoptedCapability(record.capability, record.originalBounds, hostWindow).catch(() => ({ outcome: 'helper-unavailable' as const }));
        if (restored.outcome !== 'success') {
          record.state = 'live-visible';
          return failure(restored, snapshotOf(surfaceId));
        }
        legacyPlaced.delete(surfaceId);
        record.state = 'released';
        record.capability = null;
        return { outcome: 'success', surface: snapshotOf(surfaceId) };
      }
      const released = await releaseNative(surfaceId);
      if (!released) {
        record.state = 'live-visible';
        return { outcome: 'helper-unavailable', error: 'the hosted window could not be safely restored', surface: snapshotOf(surfaceId) };
      }
      record.state = 'released';
      record.capability = null;
      return { outcome: 'success', surface: snapshotOf(surfaceId) };
    },

    markDisconnected(surfaceId) {
      const record = collection.get(surfaceId);
      if (!record) return null;
      void releaseNative(surfaceId).catch(() => undefined);
      record.state = 'disconnected';
      record.capability = null;
      return snapshotOf(surfaceId);
    },

    retire(surfaceId) {
      const record = collection.get(surfaceId);
      if (!record || (record.state !== 'released' && record.state !== 'disconnected')) return false;
      hosted.delete(surfaceId);
      return collection.remove(surfaceId);
    },

    snapshot() {
      return collection.snapshot();
    },
  };
}
