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
const MAX_RESERVED_CONTROL_REQUESTS = 8;

interface PendingEntry {
  resolve: (result: WindowCapabilityResult) => void;
  timer: NodeJS.Timeout | null;
  method: WindowCapabilityMethod;
  message: WindowRequestMessage;
  dispatched: boolean;
  /** The runtime id the request was issued for; a response carrying an
   * observation for a DIFFERENT id must never satisfy this request. */
  target: RuntimeWindowId | undefined;
}

export interface WindowCapabilityClient {
  list(): Promise<WindowCapabilityResult>;
  observe(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  minimize(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  restore(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  /** One request: read the live state, then minimize or restore accordingly. */
  toggle(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  cloak(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  uncloak(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  cloakMany(runtimeIds: RuntimeWindowId[]): Promise<WindowCapabilityResult>;
  uncloakMany(runtimeIds: RuntimeWindowId[]): Promise<WindowCapabilityResult>;
  livePreview(runtimeId: RuntimeWindowId, caller: string, enabled: boolean): Promise<WindowCapabilityResult>;
  apply(runtimeId: RuntimeWindowId, bounds: WindowBounds, state?: WindowState): Promise<WindowCapabilityResult>;
  close(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  endProcess(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  /** 016 direct pick: resolve the topmost task-worthy window at a screen
   * point (helper-owned eligibility). No target - the helper resolves. */
  hover(x: number, y: number): Promise<WindowCapabilityResult>;
  /** 019G real-window thumbnail: bounded PrintWindow capture scaled to fit
   * (maxWidth, maxHeight). Dimensions are positive integers (maxWidth <= 320,
   * maxHeight <= 180); the service validates them before reaching this. */
  thumbnail(runtimeId: RuntimeWindowId, maxWidth?: number, maxHeight?: number): Promise<WindowCapabilityResult>;
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
  const reservedControlSlots = Math.min(MAX_RESERVED_CONTROL_REQUESTS, Math.max(1, Math.floor(maxPending / 4)));
  const maxPendingThumbnails = Math.max(0, maxPending - reservedControlSlots);
  const deferredThumbnails: number[] = [];
  let activeThumbnailRequestId: number | null = null;

  function dispatch(entry: PendingEntry): void {
    if (stopped || entry.dispatched || !pending.has(entry.message.requestId)) return;
    entry.dispatched = true;
    entry.timer = setTimeout(() => {
      if (!pending.has(entry.message.requestId)) return;
      finish(entry.message.requestId, {
        outcome: 'timeout',
        error: `request ${entry.message.requestId} (${entry.method}) timed out`,
      });
    }, timeoutMs);
    if (entry.method === 'thumbnail') activeThumbnailRequestId = entry.message.requestId;
    transport.send(entry.message).catch(() => {
      // The helper never accepted the request: fail this one closed, exactly
      // once, without disturbing any other pending request.
      if (!pending.has(entry.message.requestId)) return;
      finish(entry.message.requestId, { outcome: 'helper-unavailable', error: 'transport send failed' });
    });
  }

  function dispatchDeferredThumbnail(): void {
    if (stopped || activeThumbnailRequestId !== null) return;
    // A control request should be able to follow the one thumbnail already
    // dispatched, but speculative captures never queue ahead of controls.
    for (const entry of pending.values()) {
      if (entry.method !== 'thumbnail') return;
    }
    while (deferredThumbnails.length > 0) {
      const requestId = deferredThumbnails.shift()!;
      const entry = pending.get(requestId);
      if (entry && !entry.dispatched) {
        dispatch(entry);
        return;
      }
    }
  }

  function finish(requestId: number, result: WindowCapabilityResult): void {
    const entry = pending.get(requestId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(requestId);
    if (entry.method === 'thumbnail' && activeThumbnailRequestId === requestId) activeThumbnailRequestId = null;
    entry.resolve(result);
    dispatchDeferredThumbnail();
  }

  function request(
    method: WindowCapabilityMethod,
    detail: {
      target?: RuntimeWindowId;
      targets?: RuntimeWindowId[];
      caller?: string;
      enabled?: boolean;
      bounds?: WindowBounds;
      state?: WindowState;
      x?: number;
      y?: number;
      maxWidth?: number;
      maxHeight?: number;
    } = {},
  ): Promise<WindowCapabilityResult> {
    if (stopped) {
      return Promise.resolve({ outcome: 'helper-unavailable', error: 'client is stopped' });
    }
    if (method === 'thumbnail') {
      let thumbnailCount = 0;
      for (const entry of pending.values()) if (entry.method === 'thumbnail') thumbnailCount += 1;
      if (thumbnailCount >= maxPendingThumbnails) {
        return Promise.resolve({ outcome: 'helper-unavailable', error: 'speculative thumbnail limit reached' });
      }
    }
    if (pending.size >= maxPending) {
      return Promise.resolve({ outcome: 'helper-unavailable', error: 'pending-request limit reached' });
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    const message: WindowRequestMessage = {
      requestId,
      method,
      ...(detail.target !== undefined ? { target: detail.target } : {}),
      ...(detail.targets !== undefined ? { targets: detail.targets } : {}),
      ...(detail.caller !== undefined ? { caller: detail.caller } : {}),
      ...(detail.enabled !== undefined ? { enabled: detail.enabled } : {}),
      ...(detail.bounds !== undefined ? { bounds: detail.bounds } : {}),
      ...(detail.state !== undefined ? { state: detail.state } : {}),
      ...(detail.x !== undefined ? { x: detail.x } : {}),
      ...(detail.y !== undefined ? { y: detail.y } : {}),
      ...(detail.maxWidth !== undefined ? { maxWidth: detail.maxWidth } : {}),
      ...(detail.maxHeight !== undefined ? { maxHeight: detail.maxHeight } : {}),
    };
    const result = new Promise<WindowCapabilityResult>((resolve) => {
      const entry: PendingEntry = { resolve, timer: null, method, message, dispatched: false, target: detail.target };
      pending.set(requestId, entry);
      if (method === 'thumbnail') {
        deferredThumbnails.push(requestId);
        dispatchDeferredThumbnail();
      } else {
        // Control requests pass any deferred thumbnails immediately. At most
        // one thumbnail may already be ahead because captures are serialized.
        dispatch(entry);
      }
    });
    return result;
  }

  function handleMessage(raw: unknown): void {
    const response = parseWindowResponse(raw);
    if (!response) return; // malformed / unknown: ignored, nothing satisfied
    const entry = pending.get(response.requestId);
    if (!entry) return; // stale, duplicate or unknown id: ignored
    if (entry.method !== response.method) return; // mismatched: never satisfy the wrong request
    if (entry.method === 'thumbnail') {
      // 019GR3: a thumbnail response resolves ONLY when the echoed helper
      // target matches the token the request was issued for. A wrong-target
      // response with the same requestId and method is ignored. The target is
      // a strict main-internal correlation field and is NEVER forwarded into
      // the result.
      if (response.target === undefined || response.target !== entry.target) return;
    } else if (response.observation !== undefined
      && entry.target !== undefined
      && response.observation.runtimeId !== entry.target) {
      // Same method, same request id, but the observation is for a
      // DIFFERENT window: fail closed and keep the request pending.
      return;
    }
    finish(response.requestId, {
      outcome: response.outcome,
      ...(response.windows !== undefined ? { windows: response.windows } : {}),
      ...(response.observation !== undefined ? { observation: response.observation } : {}),
      ...(response.window !== undefined ? { window: response.window } : {}),
      ...(response.thumbnail !== undefined ? { thumbnail: response.thumbnail } : {}),
      ...(response.action !== undefined ? { action: response.action } : {}),
      ...(response.error !== undefined ? { error: response.error } : {}),
    });
  }

  function rejectAllPending(outcome: WindowCapabilityResult['outcome'], error = 'helper unavailable'): void {
    for (const [requestId, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve({ outcome, error });
    }
    deferredThumbnails.length = 0;
    activeThumbnailRequestId = null;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    rejectAllPending('helper-unavailable', 'client stopped');
  }

  transport.onMessage(handleMessage);

  return {
    list: () => request('list'),
    observe: (runtimeId) => request('observe', { target: runtimeId }),
    minimize: (runtimeId) => request('minimize', { target: runtimeId }),
    restore: (runtimeId) => request('restore', { target: runtimeId }),
    toggle: (runtimeId) => request('toggle', { target: runtimeId }),
    cloak: (runtimeId) => request('cloak', { target: runtimeId }),
    uncloak: (runtimeId) => request('uncloak', { target: runtimeId }),
    cloakMany: (runtimeIds) => request('cloak-many', { targets: runtimeIds }),
    uncloakMany: (runtimeIds) => request('uncloak-many', { targets: runtimeIds }),
    livePreview: (runtimeId, caller, enabled) => request('live-preview', { target: runtimeId, caller, enabled }),
    apply: (runtimeId, bounds, state) => request('apply', { target: runtimeId, bounds, state }),
    close: (runtimeId) => request('close', { target: runtimeId }),
    endProcess: (runtimeId) => request('end-process', { target: runtimeId }),
    hover: (x, y) => request('hover', { x, y }),
    thumbnail: (runtimeId, maxWidth, maxHeight) => request('thumbnail', { target: runtimeId, maxWidth, maxHeight }),
    handleMessage,
    rejectAllPending,
    stop,
    get pendingCount() {
      return pending.size;
    },
  };
}
