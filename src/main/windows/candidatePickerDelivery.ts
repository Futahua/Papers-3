/** Keeps the newest candidate rows until the picker's document has installed
 * its update hook. A fast enumeration must never be lost during loadURL. */
export type CandidatePickerDeliveryResult = 'applied' | 'buffered' | 'failed' | 'stale';

export function createCandidatePickerDelivery<T>(apply: (rows: T[]) => Promise<boolean>) {
  let ready = false;
  let closed = false;
  let pending: T[] | null = null;
  let flushing: Promise<CandidatePickerDeliveryResult> | null = null;

  async function flush(): Promise<CandidatePickerDeliveryResult> {
    if (closed) return 'stale';
    if (!ready) return 'buffered';
    if (flushing) return 'buffered';
    const work = (async (): Promise<CandidatePickerDeliveryResult> => {
      while (!closed && pending !== null) {
        const rows = pending;
        pending = null;
        let applied = false;
        try { applied = await apply(rows); } catch { /* reported below */ }
        if (!applied) {
          // A newer update may have arrived during the failed call. Try that
          // one now instead of leaving the picker stuck on its loading shell.
          if (pending !== null) continue;
          pending = rows;
          return 'failed';
        }
      }
      return closed ? 'stale' : 'applied';
    })();
    flushing = work;
    try { return await work; } finally { flushing = null; }
  }

  return {
    update(rows: T[]): Promise<CandidatePickerDeliveryResult> {
      if (closed) return Promise.resolve('stale');
      pending = rows;
      return flush();
    },
    markReady(): Promise<CandidatePickerDeliveryResult> {
      ready = true;
      return flush();
    },
    close(): void { closed = true; pending = null; },
  };
}
