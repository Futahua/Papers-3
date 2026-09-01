import { describe, expect, it, vi } from 'vitest';

import { BackpackProjectSurfaceCollection } from '../../src/main/backpacks/backpackProjectSurfaceCollection';

type FakeRuntime = {
  hide: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
  setTransparent: ReturnType<typeof vi.fn>;
  isSender: ReturnType<typeof vi.fn>;
  entryUrlForProject: ReturnType<typeof vi.fn>;
};

function collectionWithFakes() {
  const runtimes = new Map<string, FakeRuntime>();
  const collection = new BackpackProjectSurfaceCollection(
    {} as never,
    '/tmp/preload.cjs',
    false,
    undefined,
    (surfaceId) => {
      const runtime: FakeRuntime = {
        hide: vi.fn(),
        fit: vi.fn(),
        setTransparent: vi.fn(),
        isSender: vi.fn(() => false),
        entryUrlForProject: vi.fn(() => surfaceId === 'surface-p' ? 'papers-backpack://project-x/entry.html' : null),
      };
      runtimes.set(surfaceId, runtime);
      return runtime as never;
    },
  );
  return { collection, runtimes };
}

describe('BackpackProjectSurfaceCollection', () => {
  it('keeps two surfaces independent and closes only the named one', () => {
    const { collection, runtimes } = collectionWithFakes();
    const p = collection.ensure('surface-p');
    const q = collection.ensure('surface-q');

    collection.hide('surface-p');

    expect(p).not.toBe(q);
    expect(runtimes.get('surface-p')!.hide).toHaveBeenCalledTimes(1);
    expect(runtimes.get('surface-q')!.hide).not.toHaveBeenCalled();
    expect(collection.get('surface-q')).toBe(q);

    collection.close('surface-p');

    expect(collection.get('surface-p')).toBeNull();
    expect(collection.get('surface-q')).toBe(q);
    expect(runtimes.get('surface-p')!.hide).toHaveBeenCalledTimes(2);
  });

  it('keeps same-project lookup separate from surface identity', () => {
    const { collection } = collectionWithFakes();
    const p = collection.ensure('surface-p');
    const q = collection.ensure('surface-q');

    expect(collection.all()).toEqual([p, q]);
    expect(collection.entryUrlForProject('project-x')).toBe('papers-backpack://project-x/entry.html');
  });

  it('fans out window-wide presentation changes to every surface', () => {
    const { collection, runtimes } = collectionWithFakes();
    collection.ensure('surface-p');
    collection.ensure('surface-q');

    collection.fit();
    collection.setTransparent(true);
    collection.hideAll();

    for (const runtime of runtimes.values()) {
      expect(runtime.fit).toHaveBeenCalledTimes(1);
      expect(runtime.setTransparent).toHaveBeenCalledWith(true);
      expect(runtime.hide).toHaveBeenCalledTimes(1);
    }
  });
});
