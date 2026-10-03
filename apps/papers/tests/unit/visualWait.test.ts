import { describe, expect, it } from 'vitest';
import type { VisualDiagnosticRecord } from '../../src/main/visual/visualDiagnostics';
import { createVisualWaitService } from '../../src/main/visual/visualWait';

const target = { windowId: 4, surfaceId: 'surface-a' };
const record = (sequence: number, phase: 'navigation-started' | 'layout-stable' | 'render-failed'): VisualDiagnosticRecord => ({
  sequence, observedAt: '2026-09-03T00:00:00.000Z', target,
  payload: { kind: 'lifecycle', phase },
});

function setup(history: VisualDiagnosticRecord[] = []) {
  const service = createVisualWaitService({ isLive: (candidate) => candidate.windowId === target.windowId && candidate.surfaceId === target.surfaceId, snapshot: () => history });
  return service;
}

describe('bounded exact-target visual wait', () => {
  it('completes immediately from the current target history', async () => {
    await expect(setup([record(1, 'layout-stable')]).wait(target, 'layout-stable', 100)).resolves.toMatchObject({ status: 'layout-stable', terminal: { sequence: 1 } });
  });

  it('waits for a later exact-target terminal and ignores another surface', async () => {
    const service = setup([record(1, 'navigation-started')]);
    const pending = service.wait(target, 'layout-stable', 500);
    expect(service.pendingCount()).toBe(1);
    service.append({ ...record(2, 'layout-stable'), target: { windowId: 4, surfaceId: 'surface-b' } });
    setTimeout(() => service.append(record(3, 'layout-stable')), 5);
    await expect(pending).resolves.toMatchObject({ status: 'layout-stable', terminal: { sequence: 3 } });
    expect(service.pendingCount()).toBe(0);
  });

  it('does not let a pre-navigation terminal satisfy the new cycle', async () => {
    const service = setup([record(1, 'layout-stable'), record(2, 'navigation-started')]);
    const pending = service.wait(target, 'layout-stable', 500);
    setTimeout(() => service.append(record(3, 'layout-stable')), 5);
    await expect(pending).resolves.toMatchObject({ status: 'layout-stable', terminal: { sequence: 3 } });
  });

  it('requires new history across move-away/move-back adoption without a navigation marker', async () => {
    const history = [record(1, 'layout-stable')];
    const service = setup(history);
    service.retire(target);
    history.length = 0;
    const pending = service.wait(target, 'layout-stable', 30);
    await expect(pending).resolves.toMatchObject({ status: 'timeout' });
    const next = service.wait(target, 'layout-stable', 500);
    setTimeout(() => service.append(record(2, 'layout-stable')), 5);
    await expect(next).resolves.toMatchObject({ status: 'layout-stable', terminal: { sequence: 2 } });
  });

  it('settles timeout, cancellation, and retirement without leaked waiters', async () => {
    const service = setup();
    await expect(service.wait(target, 'render-failed', 5)).resolves.toMatchObject({ status: 'timeout' });
    const controller = new AbortController();
    const cancelled = service.wait(target, 'render-failed', 500, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    const retired = service.wait(target, 'render-failed', 500);
    service.retire(target);
    await expect(retired).resolves.toMatchObject({ status: 'retired' });
    expect(service.pendingCount()).toBe(0);
  });

  it('does not use retained history while the exact renderer is gone', async () => {
    const service = createVisualWaitService({
      isLive: () => true,
      snapshot: () => [record(1, 'layout-stable')],
      currentState: () => null,
    });
    const pending = service.wait(target, 'layout-stable', 20);
    await expect(pending).resolves.toMatchObject({ status: 'timeout' });
  });

  it('does not let an older terminal override a current incomplete state', async () => {
    const service = createVisualWaitService({
      isLive: () => true,
      snapshot: () => [record(1, 'layout-stable')],
      currentState: () => ({ layoutStable: false, renderFailed: false }),
    });
    await expect(service.wait(target, 'layout-stable', 20)).resolves.toMatchObject({ status: 'timeout' });
  });

  it('rejects retired or invalid targets before registering a waiter', async () => {
    const service = createVisualWaitService({ isLive: () => false, snapshot: () => [] });
    await expect(service.wait(target, 'layout-stable', 100)).rejects.toThrow('not open');
    expect(service.pendingCount()).toBe(0);
  });
});
