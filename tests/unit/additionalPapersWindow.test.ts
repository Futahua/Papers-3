import { describe, expect, it, vi } from 'vitest';

const atomic = vi.hoisted(() => vi.fn(async (create: () => PapersWindowInstance, _deps: PapersWindowLifecycleDependencies) => {
  return create();
}));
vi.mock('../../src/main/windows/papersWindowLifecycle', () => ({ createRegisteredPapersWindow: atomic }));
import { createAdditionalPapersWindow } from '../../src/main/windows/additionalPapersWindow';
import type { PapersWindowInstance } from '../../src/main/windows/papersWindowFactory';
import type { PapersWindowLifecycleDependencies } from '../../src/main/windows/papersWindowLifecycle';

const fakeInstance = {} as PapersWindowInstance;

describe('additional Papers window composer', () => {
  it('uses fresh restore policy and the shared atomic lifecycle', async () => {
    const lifecycle = {} as PapersWindowLifecycleDependencies;
    const lifecycleDependencies = vi.fn(() => lifecycle);
    const createWindow = vi.fn(() => fakeInstance);

    const result = await createAdditionalPapersWindow({ createWindow, lifecycleDependencies });

    expect(result).toBe(fakeInstance);
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(lifecycleDependencies).toHaveBeenCalledWith(null);
  });
});
