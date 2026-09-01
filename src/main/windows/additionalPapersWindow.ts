import {
  createRegisteredPapersWindow,
  type PapersWindowLifecycleDependencies,
} from './papersWindowLifecycle';
import type { PapersWindowInstance } from './papersWindowFactory';

export interface AdditionalPapersWindowComposer {
  createWindow(): PapersWindowInstance;
  lifecycleDependencies(restoreBackpackId: string | null): PapersWindowLifecycleDependencies;
}

/**
 * Compose a secondary Papers window without exposing a product entry point.
 * Secondary windows are always fresh: only bootstrap may consume the persisted
 * MRU restore candidate for the first window.
 */
export function createAdditionalPapersWindow(
  composer: AdditionalPapersWindowComposer,
): Promise<PapersWindowInstance> {
  return createRegisteredPapersWindow(
    () => composer.createWindow(),
    composer.lifecycleDependencies(null),
  );
}
