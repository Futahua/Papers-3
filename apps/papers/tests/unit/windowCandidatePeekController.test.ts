import { describe, expect, it, vi } from 'vitest';

import { createWindowCandidatePeekController } from '../../src/main/windows/windowCandidatePeekController';
import type { WindowCapabilityResult } from '../../src/main/windows/windowCapabilityTypes';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const ok: WindowCapabilityResult = { outcome: 'success' };

describe('window candidate preview lifecycle', () => {
  it.each(['LMB selection', 'MMB process end'])('%s waits for pending begin and releases before action', async (label) => {
    const begin = deferred<WindowCapabilityResult>();
    const calls: string[] = [];
    const controller = createWindowCandidatePeekController({
      endLivePreview: async () => { calls.push('end-live'); return ok; },
      endPeek: async () => { calls.push('end-peek'); return ok; },
      timeoutMs: 50,
    });
    controller.begin(() => begin.promise);
    await Promise.resolve();
    const action = vi.fn(() => { calls.push(label); });
    const finished = controller.end().then((released) => { if (released) action(); return released; });
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    begin.resolve(ok);
    await expect(finished).resolves.toBe(true);
    expect(calls).toEqual(['end-live', 'end-peek', label]);
    expect(action).toHaveBeenCalledOnce();
  });

  it('pointer leave cancels a pending begin and releases once it completes', async () => {
    const begin = deferred<WindowCapabilityResult>();
    const endLive = vi.fn(async () => ok);
    const endPeek = vi.fn(async () => ok);
    const controller = createWindowCandidatePeekController({ endLivePreview: endLive, endPeek, timeoutMs: 50 });
    controller.begin(() => begin.promise);
    await Promise.resolve();
    const left = controller.end();
    begin.resolve(ok);
    await expect(left).resolves.toBe(true);
    expect(endLive).toHaveBeenCalledOnce();
    expect(endPeek).toHaveBeenCalledOnce();
  });

  it('serializes rapid row changes and waits for every begun preview before an action', async () => {
    const first = deferred<WindowCapabilityResult>();
    const second = vi.fn(async () => ok);
    const calls: string[] = [];
    const controller = createWindowCandidatePeekController({
      endLivePreview: async () => { calls.push('release'); return ok; },
      endPeek: async () => ok,
      timeoutMs: 50,
    });
    controller.begin(() => first.promise);
    await Promise.resolve();
    controller.begin(second);
    expect(second).not.toHaveBeenCalled();
    const ending = controller.end();
    first.resolve(ok);
    await expect(ending).resolves.toBe(true);
    expect(second).not.toHaveBeenCalled(); // queued stale row was invalidated
    expect(calls).toEqual(['release']);
  });

  it('picker close releases an already active preview', async () => {
    const endLive = vi.fn(async () => ok);
    const endPeek = vi.fn(async () => ok);
    const controller = createWindowCandidatePeekController({ endLivePreview: endLive, endPeek });
    controller.begin(async () => ok);
    await Promise.resolve();
    await expect(controller.end()).resolves.toBe(true);
    expect(endLive).toHaveBeenCalledOnce();
    expect(endPeek).toHaveBeenCalledOnce();
  });

  it('late begin success after action timeout is released and the action stays cancelled', async () => {
    const begin = deferred<WindowCapabilityResult>();
    const endLive = vi.fn(async () => ok);
    const endPeek = vi.fn(async () => ok);
    const action = vi.fn();
    const controller = createWindowCandidatePeekController({ endLivePreview: endLive, endPeek, timeoutMs: 10 });
    controller.begin(() => begin.promise);
    await Promise.resolve();
    const released = await controller.end();
    if (released) action();
    expect(released).toBe(false);
    expect(action).not.toHaveBeenCalled();
    begin.resolve(ok);
    await vi.waitFor(() => expect(endLive).toHaveBeenCalled());
    expect(endPeek).toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('does not run a row action when release fails or times out', async () => {
    const never = new Promise<WindowCapabilityResult>(() => undefined);
    const action = vi.fn();
    const failureController = createWindowCandidatePeekController({
      endLivePreview: async () => ({ outcome: 'denied', error: 'release denied' }),
      endPeek: async () => ok,
      timeoutMs: 5,
    });
    failureController.begin(async () => ok);
    await Promise.resolve();
    const failed = await failureController.end();
    if (failed) action();
    expect(failed).toBe(false);
    expect(action).not.toHaveBeenCalled();

    const timeoutController = createWindowCandidatePeekController({ endPeek: () => never, timeoutMs: 5 });
    timeoutController.begin(async () => ok);
    await Promise.resolve();
    const started = Date.now();
    await expect(timeoutController.end()).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
    expect(action).not.toHaveBeenCalled();
  });

  it('MMB release failure prevents the process-end action', async () => {
    const calls: string[] = [];
    let attempts = 0;
    const began = deferred<void>();
    const controller = createWindowCandidatePeekController({
      endLivePreview: async () => { calls.push('release'); attempts += 1; return { outcome: 'denied' }; },
      endPeek: async () => { calls.push('peek-release'); return ok; },
      timeoutMs: 25,
    });
    controller.begin(async () => { began.resolve(); return ok; });
    await began.promise;
    const first = await controller.end();
    const action = vi.fn(async () => { calls.push('process-end'); return { outcome: 'denied' }; });
    if (first) await action();
    expect(first).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(calls).toEqual(['release', 'peek-release', 'release', 'peek-release']);
  });

  it('releases before a process-end failure is reported to the picker', async () => {
    const calls: string[] = [];
    const controller = createWindowCandidatePeekController({
      endLivePreview: async () => { calls.push('release'); return ok; },
      endPeek: async () => { calls.push('peek-release'); return ok; },
    });
    controller.begin(async () => ok);
    await Promise.resolve();
    const released = await controller.end();
    const endProcess = vi.fn(async () => { calls.push('process-end'); return { outcome: 'denied' as const, error: 'identity changed' }; });
    const result = released ? await endProcess() : null;
    expect(result).toEqual({ outcome: 'denied', error: 'identity changed' });
    expect(calls).toEqual(['release', 'peek-release', 'process-end']);
  });

  it('releases after a begin operation error', async () => {
    const endLive = vi.fn(async () => ok);
    const endPeek = vi.fn(async () => ok);
    const controller = createWindowCandidatePeekController({ endLivePreview: endLive, endPeek });
    controller.begin(async () => { throw new Error('begin transport failed'); });
    await vi.waitFor(() => expect(endLive).toHaveBeenCalledOnce());
    expect(endPeek).toHaveBeenCalledOnce();
    await expect(controller.end()).resolves.toBe(true);
  });
});
