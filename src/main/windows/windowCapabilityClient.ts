/**
 * The typed window-capability CLIENT (Assignment 010).
 *
 * Owns request ids, schema validation, bounded timeouts and correlation.
 * It exposes only the enumerated capability methods — never raw protocol
 * send, arbitrary Win32, shell execution or process launch. Inbound
 * responses that are malformed, unknown, duplicate, stale or mismatched are
 * ignored without satisfying any request.
 */

import {
  parseWindowResponse,
  type RuntimeWindowId,
  type WindowBounds,
  type WindowCapabilityMethod,
  type WindowCapabilityResult,
  type WindowRequestMessage,
  type WindowState,
  type WindowTransport,
} from './windowCapabilityTypes';

export const DEFAULT_WINDOW_CAPABILITY_TIMEOUT_MS = 2000;
export const DEFAULT_WINDOW_CAPABILITY_MAX_PENDING = 64;

interface PendingEntry {
  resolve: (result: WindowCapabilityResult) => void;
  timer: NodeJS.Timeout;
  method: WindowCapabilityMethod;
  /** The runtime id the request was issued for; a response carrying an
   * observation for a DIFFERENT id must never satisfy this request. */
  target: RuntimeWindowId | undefined;
}

export interface WindowCapabilityClient {
  list(): Promise<WindowCapabilityResult>;
  observe(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  minimize(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  restore(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  apply(runtimeId: RuntimeWindowId, bounds: WindowBounds, state?: WindowState): Promise<WindowCapabilityResult>;
  close(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  /** Inbound message path the transport delivers into. */
  handleMessage(raw: unknown): void;
  /** Rejects every pending request exactly once (supervisor crash/stop). */
  rejectAllPending(outcome: WindowCapabilityResult['outcome'], error?: string): void;
  /** Clears timers and rejects pendings; the client is unusable afterwards. */
  stop(): void;
  readonly pendingCount: number;
}

export function createWindowCapabilityClient({
  transport,
  timeoutMs = DEFAULT_WINDOW_CAPABILITY_TIMEOUT_MS,
  maxPending = DEFAULT_WINDOW_CAPABILITY_MAX_PENDING,
}: {
  transport: WindowTransport;
  timeoutMs?: number;
  maxPending?: number;
}): WindowCapabilityClient {
  let nextRequestId = 1;
  let stopped = false;
  const pending = new Map<number, PendingEntry>();

  function request(
    method: WindowCapabilityMethod,
    target?: RuntimeWindowId,
    bounds?: WindowBounds,
    state?: WindowState,
  ): Promise<WindowCapabilityResult> {
    if (stopped) {
      return Promise.resolve({ outcome: 'helper-unavailable', error: 'client is stopped' });
    }
    if (pending.size >= maxPending) {
      return Promise.resolve({ outcome: 'helper-unavailable', error: 'pending-request limit reached' });
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    const message: WindowRequestMessage = {
      requestId,
      method,
      ...(target !== undefined ? { target } : {}),
      ...(bounds !== undefined ? { bounds } : {}),
      ...(state !== undefined ? { state } : {}),
    };
    const result = new Promise<WindowCapabilityResult>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(requestId)) {
          resolve({ outcome: 'timeout', error: `request ${requestId} (${method}) timed out` });
        }
      }, timeoutMs);
      pending.set(requestId, { resolve, timer, method, target });
    });
    transport.send(message).catch(() => {
      // The helper never accepted the request: fail this one closed, exactly
      // once, without disturbing any other pending request.
      const entry = pending.get(requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve({ outcome: 'helper-unavailable', error: 'transport send failed' });
    });
    return result;
  }

  function handleMessage(raw: unknown): void {
    const response = parseWindowResponse(raw);
    if (!response) return; // malformed / unknown: ignored, nothing satisfied
    const entry = pending.get(response.requestId);
    if (!entry) return; // stale, duplicate or unknown id: ignored
    if (entry.method !== response.method) return; // mismatched: never satisfy the wrong request
    if (response.observation !== undefined
      && entry.target !== undefined
      && response.observation.runtimeId !== entry.target) {
      // Same method, same request id, but the observation is for a
      // DIFFERENT window: fail closed and keep the request pending.
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(response.requestId);
    entry.resolve({
      outcome: response.outcome,
      ...(response.windows !== undefined ? { windows: response.windows } : {}),
      ...(response.observation !== undefined ? { observation: response.observation } : {}),
      ...(response.error !== undefined ? { error: response.error } : {}),
    });
  }

  function rejectAllPending(outcome: WindowCapabilityResult['outcome'], error = 'helper unavailable'): void {
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve({ outcome, error });
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    rejectAllPending('helper-unavailable', 'client stopped');
  }

  transport.onMessage(handleMessage);

  return {
    list: () => request('list'),
    observe: (runtimeId) => request('observe', runtimeId),
    minimize: (runtimeId) => request('minimize', runtimeId),
    restore: (runtimeId) => request('restore', runtimeId),
    apply: (runtimeId, bounds, state) => request('apply', runtimeId, bounds, state),
    close: (runtimeId) => request('close', runtimeId),
    handleMessage,
    rejectAllPending,
    stop,
    get pendingCount() {
      return pending.size;
    },
  };
}
