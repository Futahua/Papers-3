import type { WindowBounds, WindowState } from './windowCapabilityTypes';

export type WindowLifecycleEventKind = 'upsert' | 'destroy';

export interface WindowLifecycleObservation {
  windowInstanceId: string;
  title: string;
  processId: number;
  processPath: string | null;
  windowClass: string;
  state: WindowState;
  bounds: WindowBounds | null;
}

export interface WindowLifecycleEvent {
  trackerSessionId: string;
  sequence: number;
  kind: WindowLifecycleEventKind;
  windowInstanceId: string;
  observation?: WindowLifecycleObservation;
}

export interface WindowLifecycleBaseline {
  trackerSessionId: string;
  sequence: number;
  complete: true;
  windows: WindowLifecycleObservation[];
}

export type WindowLifecycleMessage =
  | ({ type: 'baseline' } & WindowLifecycleBaseline)
  | ({ type: 'event' } & WindowLifecycleEvent);

export function parseWindowLifecycleMessage(raw: unknown): WindowLifecycleMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.type !== 'string' || typeof value.trackerSessionId !== 'string'
    || !/^L[0-9a-f]{32}$/.test(value.trackerSessionId)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) <= 0) return null;
  if (value.type === 'baseline') {
    if (value.complete !== true || !Array.isArray(value.windows)) return null;
    const windows = value.windows.map(parseObservation);
    if (windows.some((entry) => entry === null)) return null;
    return { type: 'baseline', trackerSessionId: value.trackerSessionId, sequence: value.sequence as number, complete: true, windows: windows as WindowLifecycleObservation[] };
  }
  if (value.type !== 'event' || (value.kind !== 'upsert' && value.kind !== 'destroy')
    || typeof value.windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/.test(value.windowInstanceId)) return null;
  if (value.kind === 'upsert') {
    const observation = parseObservation(value.observation);
    if (!observation || observation.windowInstanceId !== value.windowInstanceId) return null;
    return { type: 'event', trackerSessionId: value.trackerSessionId, sequence: value.sequence as number, kind: 'upsert', windowInstanceId: value.windowInstanceId, observation };
  }
  return { type: 'event', trackerSessionId: value.trackerSessionId, sequence: value.sequence as number, kind: 'destroy', windowInstanceId: value.windowInstanceId };
}

function parseObservation(raw: unknown): WindowLifecycleObservation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/.test(value.windowInstanceId)
    || typeof value.title !== 'string' || typeof value.processId !== 'number' || !Number.isSafeInteger(value.processId) || value.processId <= 0
    || (value.processPath !== null && typeof value.processPath !== 'string')
    || typeof value.windowClass !== 'string'
    || !(['normal', 'minimized', 'maximized', 'missing'] as unknown[]).includes(value.state)) return null;
  let bounds: WindowBounds | null = null;
  if (value.bounds !== null) {
    if (!value.bounds || typeof value.bounds !== 'object') return null;
    const b = value.bounds as Record<string, unknown>;
    if (![b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    bounds = { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number };
  }
  return { windowInstanceId: value.windowInstanceId, title: value.title, processId: value.processId, processPath: value.processPath as string | null, windowClass: value.windowClass, state: value.state as WindowState, bounds };
}
