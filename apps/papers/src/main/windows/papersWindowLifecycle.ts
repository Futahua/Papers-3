import type { PapersWindowInstance } from './papersWindowFactory';

/** The operations needed to make a native Papers window authoritative. */
export interface PapersWindowLifecycleDependencies {
  register(instance: PapersWindowInstance): void;
  install?(instance: PapersWindowInstance): void;
  onClose?(instance: PapersWindowInstance): void | Promise<void>;
  finalize(windowId: number): void | Promise<void>;
}

export interface PreparedPapersWindow {
  readonly instance: PapersWindowInstance;
  readonly windowId: number;
  loadAndRollback(): Promise<PapersWindowInstance>;
}

/**
 * Separate ownership establishment from renderer activation. Registration is
 * complete before load, so the first window can participate in composition and
 * later windows can use the same path. Finalization is guarded because Electron
 * may emit `closed` after a failed load has already destroyed the window.
 */
export function preparePapersWindow(
  instance: PapersWindowInstance,
  dependencies: PapersWindowLifecycleDependencies,
): PreparedPapersWindow {
  const windowId = instance.window.id;
  let finalizePromise: Promise<void> | null = null;

  const finalize = (): Promise<void> => {
    if (!finalizePromise) finalizePromise = Promise.resolve(dependencies.finalize(windowId));
    return finalizePromise;
  };

  dependencies.register(instance);
  dependencies.install?.(instance);
  let closePreparationStarted = false;
  let closePreparationFinished = false;
  instance.window.on('close', (event?: { preventDefault?: () => void }) => {
    if (closePreparationFinished) return;
    // Keep the native window (and its project renderers) alive while each
    // project gets its bounded close-time durability opportunity. Every close
    // attempt remains fenced until the one preparation completes.
    event?.preventDefault?.();
    if (closePreparationStarted) return;
    closePreparationStarted = true;
    void Promise.resolve(dependencies.onClose?.(instance)).catch(() => undefined).finally(() => {
      closePreparationFinished = true;
      if (!instance.window.isDestroyed()) instance.window.destroy();
    });
  });
  instance.window.once('closed', () => { void finalize().catch(() => undefined); });

  return {
    instance,
    windowId,
    async loadAndRollback(): Promise<PapersWindowInstance> {
      try {
        await instance.loadHostRenderer();
        return instance;
      } catch (error) {
        await instance.projectSurfaces.hideAll();
        await finalize();
        if (!instance.window.isDestroyed()) instance.window.destroy();
        throw error;
      }
    },
  };
}

/** Create, register, and activate a later Papers window as one operation. */
export async function createRegisteredPapersWindow(
  create: () => PapersWindowInstance,
  dependencies: PapersWindowLifecycleDependencies,
): Promise<PapersWindowInstance> {
  const prepared = preparePapersWindow(create(), dependencies);
  return prepared.loadAndRollback();
}
