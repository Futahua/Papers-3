import { describe, expect, it } from 'vitest';

import { createVisualSurfaceObservationStore } from '../../src/main/visual/visualSurfaceObservationState';

describe('current per-surface visual observation state', () => {
  it('starts a fresh cycle on navigation and does not retain readiness', () => {
    const store = createVisualSurfaceObservationStore();
    store.bindSender(7, 'surface-a', 42);
    store.markDomReady(7, 'surface-a', 42);
    store.markHydrated(7, 'surface-a', 42, 'rev-a');
    store.markFirstPaint(7, 'surface-a', 42);
    store.markLayoutStable(7, 'surface-a', 42, 3);
    store.replaceSemanticKeys(7, 'surface-a', 42, ['canvas.root']);
    const before = store.snapshot(7, 'surface-a')!;

    store.startNavigation(7, 'surface-a', 42);
    const after = store.snapshot(7, 'surface-a')!;
    expect(after.senderId).toBe(42);
    expect(after.senderGeneration).toBe(before.senderGeneration);
    expect(after.renderCycleId).not.toBe(before.renderCycleId);
    expect(after.documentStateRevision).toBeNull();
    expect(after.domReady).toBe(false);
    expect(after.hydrated).toBe(false);
    expect(after.firstPaint).toBe(false);
    expect(after.layoutStable).toBe(false);
    expect(after.semanticKeys).toEqual([]);
  });

  it('rejects late signals from an old sender and invalidates renderer state', () => {
    const store = createVisualSurfaceObservationStore();
    store.bindSender(7, 'surface-a', 42);
    store.markHydrated(7, 'surface-a', 42, 'rev-a');
    store.bindSender(7, 'surface-a', 99);
    store.markHydrated(7, 'surface-a', 42, 'late-old-revision');
    store.markFirstPaint(7, 'surface-a', 42);
    expect(store.snapshot(7, 'surface-a')).toMatchObject({
      senderId: 99,
      documentStateRevision: null,
      hydrated: false,
      firstPaint: false,
    });

    store.markHydrated(7, 'surface-a', 99, 'rev-b');
    store.replaceSemanticKeys(7, 'surface-a', 99, ['title.main']);
    store.invalidateSender(7, 'surface-a', 99);
    expect(store.snapshot(7, 'surface-a')).toMatchObject({
      senderId: null,
      documentStateRevision: null,
      hydrated: false,
      renderFailed: false,
      semanticKeys: [],
    });
  });

  it('invalidates layout stability when a later epoch begins', () => {
    const store = createVisualSurfaceObservationStore();
    store.bindSender(7, 'surface-a', 42);
    store.markLayoutStable(7, 'surface-a', 42, 4);
    store.markLayoutEpoch(7, 'surface-a', 42, 5);
    expect(store.snapshot(7, 'surface-a')).toMatchObject({ layoutEpoch: 5, layoutStable: false });
    store.markLayoutStable(7, 'surface-a', 42, 5);
    expect(store.snapshot(7, 'surface-a')).toMatchObject({ layoutEpoch: 5, layoutStable: true });
  });

  it('accepts only the first document identity after same-WebContents navigation', () => {
    const store = createVisualSurfaceObservationStore();
    store.bindSender(7, 'surface-a', 42);
    store.bindDocumentInstance(7, 'surface-a', 42, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    store.startNavigation(7, 'surface-a', 42);
    store.bindDocumentInstance(7, 'surface-a', 42, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    store.bindDocumentInstance(7, 'surface-a', 42, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(store.snapshot(7, 'surface-a')?.documentInstanceId)
      .toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });
});
