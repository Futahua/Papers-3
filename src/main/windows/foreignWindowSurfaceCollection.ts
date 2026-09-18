import type { PersistedWindowMemberDescriptor, WindowRuntimeCapability } from './windowCapabilityService';
import type { WindowBounds } from './windowCapabilityTypes';

export type ForeignWindowSurfaceState =
  | 'disconnected'
  | 'resolving'
  | 'live-visible'
  | 'releasing'
  | 'released';

/** Durable identity plus deliberately non-durable presentation state. The
 * runtime capability is kept out of this public shape: helper tokens die with
 * the helper session and are never persisted or sent to a renderer. */
export interface ForeignWindowSurfaceSnapshot {
  surfaceId: string;
  descriptor: PersistedWindowMemberDescriptor;
  title: string;
  state: ForeignWindowSurfaceState;
  paneBounds: WindowBounds | null;
  originalBounds: WindowBounds | null;
  hostWindowId: number | null;
}

export interface ForeignWindowSurfaceRecord extends ForeignWindowSurfaceSnapshot {
  capability: WindowRuntimeCapability | null;
}

export function createForeignWindowSurfaceCollection() {
  const surfaces = new Map<string, ForeignWindowSurfaceRecord>();

  function add(record: ForeignWindowSurfaceRecord): void {
    if (surfaces.has(record.surfaceId)) throw new Error(`foreign surface ${record.surfaceId} already exists`);
    surfaces.set(record.surfaceId, record);
  }

  function get(surfaceId: string): ForeignWindowSurfaceRecord | null {
    return surfaces.get(surfaceId) ?? null;
  }

  function remove(surfaceId: string): boolean {
    return surfaces.delete(surfaceId);
  }

  function snapshot(): ForeignWindowSurfaceSnapshot[] {
    return [...surfaces.values()].map(({ capability: _capability, ...publicRecord }) => ({
      ...publicRecord,
      descriptor: { ...publicRecord.descriptor },
      paneBounds: publicRecord.paneBounds ? { ...publicRecord.paneBounds } : null,
      originalBounds: publicRecord.originalBounds ? { ...publicRecord.originalBounds } : null,
    }));
  }

  return { add, get, remove, snapshot };
}

export type ForeignWindowSurfaceCollection = ReturnType<typeof createForeignWindowSurfaceCollection>;
