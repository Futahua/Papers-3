import { visualDiagnosticRecordSchema, type VisualDiagnosticRecord } from './visualDiagnostics';

export type VisualWaitUntil = 'layout-stable' | 'render-failed';
export interface VisualWaitTarget { windowId: number; surfaceId: string }
export interface VisualWaitResult {
  windowId: number;
  surfaceId: string;
  status: VisualWaitUntil | 'timeout' | 'retired';
  terminal?: VisualDiagnosticRecord;
}

interface Waiter {
  target: VisualWaitTarget;
  until: VisualWaitUntil;
  navigationSequence: number;
  resolve: (result: VisualWaitResult) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
}

export interface VisualWaitService {
  wait(target: VisualWaitTarget, until: VisualWaitUntil, timeoutMs: number, signal?: AbortSignal): Promise<VisualWaitResult>;
  append(record: VisualDiagnosticRecord): void;
  retire(target: VisualWaitTarget): void;
  forget(target: VisualWaitTarget): void;
  retireWindow(windowId: number): void;
  pendingCount(): number;
}

function key(target: VisualWaitTarget): string { return `${target.windowId}\0${target.surfaceId}`; }
function targetMatches(record: VisualDiagnosticRecord, target: VisualWaitTarget): boolean {
  return record.target.windowId === target.windowId && record.target.surfaceId === target.surfaceId;
}
function terminal(record: VisualDiagnosticRecord, until: VisualWaitUntil, navigationSequence: number): boolean {
  return record.sequence > navigationSequence
    && record.payload.kind === 'lifecycle' && record.payload.phase === until;
}

export function createVisualWaitService({
  isLive,
  snapshot,
}: {
  isLive(target: VisualWaitTarget): boolean;
  snapshot(target: VisualWaitTarget): VisualDiagnosticRecord[];
}): VisualWaitService {
  const waiters = new Map<string, Set<Waiter>>();

  const remove = (waiter: Waiter): void => {
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
    const bucket = waiters.get(key(waiter.target));
    bucket?.delete(waiter);
    if (bucket?.size === 0) waiters.delete(key(waiter.target));
  };
  const settle = (waiter: Waiter, result: VisualWaitResult): void => { remove(waiter); waiter.resolve(result); };
  const fail = (waiter: Waiter, error: unknown): void => { remove(waiter); waiter.reject(error); };
  const inspect = (waiter: Waiter, records: VisualDiagnosticRecord[]): void => {
    const ordered = records.filter((record) => targetMatches(record, waiter.target)).sort((left, right) => left.sequence - right.sequence);
    for (const record of ordered) {
      if (record.payload.kind === 'lifecycle' && record.payload.phase === 'navigation-started') waiter.navigationSequence = Math.max(waiter.navigationSequence, record.sequence);
    }
    const found = ordered.filter((record) => terminal(record, waiter.until, waiter.navigationSequence)).at(-1);
    if (found) settle(waiter, { windowId: waiter.target.windowId, surfaceId: waiter.target.surfaceId, status: waiter.until, terminal: found });
  };
  const append = (record: VisualDiagnosticRecord): void => {
    for (const waiter of [...(waiters.get(key(record.target as VisualWaitTarget)) ?? [])]) {
      if (record.payload.kind === 'lifecycle' && record.payload.phase === 'navigation-started') waiter.navigationSequence = Math.max(waiter.navigationSequence, record.sequence);
      if (terminal(record, waiter.until, waiter.navigationSequence)) settle(waiter, {
        windowId: waiter.target.windowId, surfaceId: waiter.target.surfaceId, status: waiter.until, terminal: record,
      });
    }
  };
  const wait = (target: VisualWaitTarget, until: VisualWaitUntil, timeoutMs: number, signal?: AbortSignal): Promise<VisualWaitResult> => {
    if (!Number.isInteger(target.windowId) || target.windowId < 1 || !target.surfaceId || !['layout-stable', 'render-failed'].includes(until)) return Promise.reject(new Error('visual.wait target or phase is invalid'));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) return Promise.reject(new Error('visual.wait timeout must be from 1 to 5000 milliseconds'));
    if (!isLive(target)) return Promise.reject(new Error('That visual wait target is not open.'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { target, until, navigationSequence: 0, resolve, reject, timer: undefined as unknown as ReturnType<typeof setTimeout>, signal };
      waiter.timer = setTimeout(() => settle(waiter, { windowId: target.windowId, surfaceId: target.surfaceId, status: 'timeout' }), timeoutMs);
      waiter.abort = () => fail(waiter, new Error('visual.wait was cancelled'));
      if (signal?.aborted) { fail(waiter, new Error('visual.wait was cancelled')); return; }
      signal?.addEventListener('abort', waiter.abort, { once: true });
      const bucket = waiters.get(key(target)) ?? new Set<Waiter>();
      bucket.add(waiter); waiters.set(key(target), bucket);
      // Registration precedes this snapshot, so an append racing the read is
      // observed by the same waiter rather than lost between two operations.
      try { inspect(waiter, visualDiagnosticRecordSchema.array().parse(snapshot(target))); }
      catch (error) { fail(waiter, error); }
    });
  };
  const retire = (target: VisualWaitTarget): void => {
    for (const waiter of [...(waiters.get(key(target)) ?? [])]) settle(waiter, { windowId: target.windowId, surfaceId: target.surfaceId, status: 'retired' });
  };
  const forget = (target: VisualWaitTarget): void => {
    retire(target);
  };
  return {
    wait, append, retire, forget,
    retireWindow(windowId) {
      for (const [targetKey, bucket] of waiters) if (targetKey.startsWith(`${windowId}\0`)) for (const waiter of [...bucket]) settle(waiter, { windowId, surfaceId: waiter.target.surfaceId, status: 'retired' });
    },
    pendingCount() { return [...waiters.values()].reduce((count, bucket) => count + bucket.size, 0); },
  };
}
