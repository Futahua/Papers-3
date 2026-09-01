import type { PapersWindowInstance } from './papersWindowFactory';

/** The operations needed to make a native Papers window authoritative. */
export interface PapersWindowLifecycleDependencies {
  register(instance: PapersWindowInstance): void;
  onClose?(instance: PapersWindowInstance): void;
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
  let finalized = false;

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    void dependencies.finalize(windowId);
  };

  dependencies.register(instance);
  instance.window.once('close', () => dependencies.onClose?.(instance));
  instance.window.once('closed', finalize);

  return {
    instance,
    windowId,
    async loadAndRollback(): Promise<PapersWindowInstance> {
      try {
        await instance.loadHostRenderer();
        return instance;
      } catch (error) {
        instance.backpackProjectRuntime.hide();
        finalize();
        if (!instance.window.isDestroyed()) instance.window.destroy();
        throw error;
      }
    },
  };
}
