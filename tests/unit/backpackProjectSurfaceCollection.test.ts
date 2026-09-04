import { describe, expect, it, vi } from 'vitest';

import { BackpackProjectSurfaceCollection } from '../../src/main/backpacks/backpackProjectSurfaceCollection';
import { createLogicalSurfaceRegistry } from '../../src/main/windows/logicalSurfaceRegistry';

type FakeRuntime = {
  hide: ReturnType<typeof vi.fn>;
  present: ReturnType<typeof vi.fn>;
  conceal: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
  setTransparent: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
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
        present: vi.fn(),
        conceal: vi.fn(),
        fit: vi.fn(),
        setTransparent: vi.fn(),
        setBounds: vi.fn(),
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
  it('keeps two surfaces independent and closes only the named one', async () => {
    const { collection, runtimes } = collectionWithFakes();
    const p = collection.ensure('surface-p');
    const q = collection.ensure('surface-q');

    collection.hide('surface-p');

    expect(p).not.toBe(q);
    expect(runtimes.get('surface-p')!.conceal).toHaveBeenCalledTimes(1);
    expect(runtimes.get('surface-q')!.conceal).not.toHaveBeenCalled();
    expect(collection.get('surface-q')).toBe(q);

    await collection.close('surface-p');

    expect(collection.get('surface-p')).toBeNull();
    expect(collection.get('surface-q')).toBe(q);
    expect(runtimes.get('surface-p')!.hide).toHaveBeenCalledTimes(1);
  });

  it('keeps same-project lookup separate from surface identity', () => {
    const { collection } = collectionWithFakes();
    const p = collection.ensure('surface-p');
    const q = collection.ensure('surface-q');

    expect(collection.all()).toEqual([p, q]);
    expect(collection.entryUrlForProject('project-x')).toBe('papers-backpack://project-x/entry.html');
  });

  it('composes two logical projects into one native-window collection', async () => {
    const logicalSurfaces = createLogicalSurfaceRegistry(() => `sf-${logicalSurfaces.size + 1}`);
    const { collection } = collectionWithFakes();
    const x = logicalSurfaces.create({ windowId: 7, projectId: 'project-x', kind: 'project' });
    const y = logicalSurfaces.create({ windowId: 7, projectId: 'project-y', kind: 'project' });

    collection.ensure(x.surfaceId);
    collection.ensure(y.surfaceId);
    logicalSurfaces.retire(x.surfaceId);
    await collection.close(x.surfaceId);

    expect(logicalSurfaces.listForWindow(7).map((surface) => surface.surfaceId)).toEqual([y.surfaceId]);
    expect(collection.get(x.surfaceId)).toBeNull();
    expect(collection.get(y.surfaceId)).not.toBeNull();
  });

  it('fans out window-wide presentation changes to every surface', async () => {
    const { collection, runtimes } = collectionWithFakes();
    collection.ensure('surface-p');
    collection.ensure('surface-q');

    collection.fit();
    collection.setTransparent(true);
    await collection.hideAll();

    for (const runtime of runtimes.values()) {
      expect(runtime.fit).toHaveBeenCalledTimes(1);
      expect(runtime.setTransparent).toHaveBeenCalledWith(true);
      expect(runtime.hide).toHaveBeenCalledTimes(1);
    }
  });

  it('applies pane bounds only to the named surface runtime', () => {
    const { collection, runtimes } = collectionWithFakes();
    collection.ensure('surface-p');
    collection.ensure('surface-q');
    const bounds = { x: 12, y: 78, width: 640, height: 480 };

    collection.setBounds('surface-p', bounds);

    expect(runtimes.get('surface-p')!.setBounds).toHaveBeenCalledWith(bounds);
    expect(runtimes.get('surface-q')!.setBounds).not.toHaveBeenCalled();
  });

  it('restores normal close lifecycle on adoption but keeps compensation silent', async () => {
    const closed = vi.fn();
    let stagedClose: ((projectId: string) => void) | undefined;
    const runtime = {
      hide: vi.fn(), present: vi.fn(), conceal: vi.fn(), fit: vi.fn(),
      setTransparent: vi.fn(), setBounds: vi.fn(), isSender: vi.fn(() => false),
      entryUrlForProject: vi.fn(() => null),
    } as unknown as FakeRuntime;
    const collection = new BackpackProjectSurfaceCollection(
      {} as never,
      '/tmp/preload.cjs',
      false,
      closed,
      (_surfaceId, onClosed) => {
        stagedClose = onClosed;
        return runtime as never;
      },
    );

    const prepared = collection.prepare('surface-p');
    prepared.adopt();
    expect(runtime.present).toHaveBeenCalledTimes(1);
    stagedClose?.('project-x');
    expect(closed).toHaveBeenCalledWith('surface-p', 'project-x');

    runtime.hide.mockImplementation(() => { throw new Error('destroyed'); });
    expect(() => prepared.discard()).not.toThrow();
    expect(runtime.hide).toHaveBeenCalledTimes(1);
    stagedClose?.('project-x');
    expect(closed).toHaveBeenCalledTimes(1);
    expect(collection.get('surface-p')).toBeNull();
  });

  it('removes canonical ownership before a throwing native close', async () => {
    const { collection, runtimes } = collectionWithFakes();
    collection.ensure('surface-p');
    runtimes.get('surface-p')!.hide.mockImplementation(() => { throw new Error('destroyed'); });

    await expect(collection.close('surface-p')).resolves.toBeUndefined();
    expect(collection.get('surface-p')).toBeNull();
  });

  it('retries native presentation after a first adoption failure', () => {
    const { collection } = collectionWithFakes();
    const prepared = collection.prepare('surface-q');
    const runtime = prepared.runtime as unknown as FakeRuntime;
    runtime.present.mockImplementationOnce(() => { throw new Error('addChildView failed'); });

    expect(() => prepared.adopt()).toThrow(/addChildView failed/);
    expect(collection.get('surface-q')).toBe(runtime);
    expect(() => prepared.adopt()).not.toThrow();
    expect(runtime.present).toHaveBeenCalledTimes(2);
  });
});
