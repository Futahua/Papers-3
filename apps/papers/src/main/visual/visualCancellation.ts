import type { VisualArtifactMetadata } from './visualArtifactStore';

export function visualCancellationError(): Error {
  return new Error('Visual operation was cancelled.');
}

export function throwIfVisualOperationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw visualCancellationError();
}

/** Race an uncancellable native/renderer promise against the control request.
 * Late successful values are handed to onLate so an artifact can be revoked
 * even after the caller has already received cancellation. */
export function awaitVisualOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onLate?: (value: T) => void | Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  const promise = Promise.resolve(operation);
  if (signal.aborted) {
    void promise.then((value) => onLate?.(value), () => undefined).catch(() => undefined);
    return Promise.reject(visualCancellationError());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const revokeLate = (value: T): void => { void Promise.resolve(onLate?.(value)).catch(() => undefined); };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void promise.then(revokeLate, () => undefined);
      reject(visualCancellationError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((value) => {
      if (settled) {
        revokeLate(value);
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

export function revokeVisualArtifact(
  deleteArtifact: (artifactId: string) => Promise<boolean>,
): (metadata: VisualArtifactMetadata) => Promise<void> {
  return async (metadata) => { await deleteArtifact(metadata.artifactId); };
}
