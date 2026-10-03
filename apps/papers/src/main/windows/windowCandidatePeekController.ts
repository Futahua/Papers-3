import type { WindowCapabilityResult } from './windowCapabilityTypes';

export interface WindowCandidatePeekControllerOptions {
  endLivePreview?: () => Promise<WindowCapabilityResult>;
  endPeek: () => Promise<WindowCapabilityResult>;
  /** Bounds how long a picker action waits for a helper operation. The helper
   * client has its own request timeout; this is a final UI-side guard. */
  timeoutMs?: number;
}

/** Coordinates the native picker's transient preview with row actions. A
 * stale begin is always followed by another release after it eventually
 * returns, even if the action already had to fail closed at the UI timeout. */
export function createWindowCandidatePeekController(options: WindowCandidatePeekControllerOptions) {
  // A real helper queue can include one window enumeration or icon request.
  // 750 ms was shorter than the observed warm enumeration alone and let the
  // chooser tear down its DWM caller before the queued release was handled.
  const timeoutMs = options.timeoutMs ?? 2500;
  let generation = 0;
  let beginQueue: Promise<void> = Promise.resolve();
  const pendingBegins = new Set<Promise<void>>();
  let releasePending: Promise<boolean> | null = null;
  let releaseNeeded = false;
  let lastReleaseSucceeded = true;

  const bounded = async (operation: Promise<WindowCapabilityResult>): Promise<WindowCapabilityResult | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const release = (): Promise<boolean> => {
    if (!releaseNeeded) return Promise.resolve(lastReleaseSucceeded);
    if (releasePending) return releasePending;
    const task = (async () => {
      let liveResult: WindowCapabilityResult | null = { outcome: 'success' };
      if (options.endLivePreview) {
        try { liveResult = await bounded(options.endLivePreview()); } catch { liveResult = null; }
      }
      let peekResult: WindowCapabilityResult | null;
      try { peekResult = await bounded(options.endPeek()); } catch { peekResult = null; }
      const succeeded = liveResult?.outcome === 'success' && peekResult?.outcome === 'success';
      releaseNeeded = !succeeded;
      lastReleaseSucceeded = succeeded;
      return succeeded;
    })();
    releasePending = task.finally(() => { releasePending = null; });
    return releasePending;
  };

  const begin = (operation: () => Promise<WindowCapabilityResult>): void => {
    const current = ++generation;
    const task = beginQueue.then(async () => {
      if (current !== generation) return;
      releaseNeeded = true;
      const result = await operation();
      if (current !== generation) {
        // The call may have enabled DWM even when its reply was late or timed
        // out. Release after completion, not just when the pointer leaves.
        releaseNeeded = true;
        await release();
        return;
      }
      if (result?.outcome !== 'success') await release();
    }).catch(async () => { releaseNeeded = true; await release(); });
    const wrapped = task.finally(() => {
      pendingBegins.delete(wrapped);
    });
    beginQueue = wrapped.catch(() => undefined);
    pendingBegins.add(wrapped);
  };

  const end = async (): Promise<boolean> => {
    generation += 1;
    const pending = [...pendingBegins];
    if (pending.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const completed = await Promise.race([
        Promise.allSettled(pending).then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!completed) {
        // The bounded picker action may cancel, but keep a late helper begin
        // from stranding Peek after it eventually replies.
        for (const beginPromise of pending) void beginPromise.then(() => release(), () => release());
        await release();
        return false;
      }
    }
    return release();
  };

  return { begin, end };
}
