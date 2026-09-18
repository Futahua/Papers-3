/**
 * Adopted-window geometry follower: identity-fenced follow and release.
 *
 * Every test drives the follower through a scripted fake of the two service
 * methods it uses (observe/place-adopted). Nothing here spawns a process or touches
 * a real window.
 */
import { describe, expect, it } from 'vitest';

import { createAdoptedWindowFollower, type AdoptedWindowFollowerService } from '../../src/main/windows/adoptedWindowFollower';
import type { RuntimeWindowId, WindowCapabilityResult, WindowObservation } from '../../src/main/windows/windowCapabilityTypes';
import type { WindowRuntimeCapability } from '../../src/main/windows/windowCapabilityService';

const id = (value: string) => value as RuntimeWindowId;
const capability = (): WindowRuntimeCapability => ({ version: 1, bindingId: 'binding-1' });

function observation(overrides: Partial<WindowObservation> = {}): WindowObservation {
  return {
    runtimeId: id('token-1'),
    title: 'Victim',
    processId: 4242,
    processPath: 'C:\\apps\\victim.exe',
    windowClass: 'VictimMain',
    state: 'normal',
    bounds: { x: 10, y: 20, width: 640, height: 420 },
    ...overrides,
  };
}

function fakeService(script: {
  observations: Array<WindowCapabilityResult>;
  applies?: Array<WindowCapabilityResult>;
}): AdoptedWindowFollowerService & { appliedBounds: Array<{ x: number; y: number; width: number; height: number }>; applyCalls: number } {
  let observed = 0;
  let applyCalls = 0;
  const appliedBounds: Array<{ x: number; y: number; width: number; height: number }> = [];
  const applies = script.applies ?? [];
  return {
    appliedBounds,
    get applyCalls() {
      return applyCalls;
    },
    observeCapability: async () => script.observations[Math.min(observed++, script.observations.length - 1)] as WindowCapabilityResult,
    placeAdoptedCapability: async (_cap, bounds) => {
      applyCalls += 1;
      appliedBounds.push({ ...bounds });
      return applies[Math.min(applyCalls - 1, applies.length - 1)] ?? { outcome: 'success' };
    },
  };
}

const success = (obs: WindowObservation): WindowCapabilityResult => ({ outcome: 'success', observation: obs });

describe('adoptedWindowFollower', () => {
  it('adopts by capturing the pre-adoption rectangle for restore', async () => {
    const service = fakeService({ observations: [success(observation())] });
    const follower = createAdoptedWindowFollower(service);
    const adopted = await follower.adopt(capability());
    expect(adopted).toEqual({ outcome: 'adopted', originalBounds: { x: 10, y: 20, width: 640, height: 420 } });
    expect(follower.state).toBe('following');
  });

  it('refuses adoption when the window offers no restore rectangle', async () => {
    const service = fakeService({ observations: [success(observation({ bounds: null }))] });
    const follower = createAdoptedWindowFollower(service);
    expect(await follower.adopt(capability())).toMatchObject({ outcome: 'missing' });
    expect(follower.state).toBe('idle');
  });

  it('follows new bounds and dedupes identical bounds to zero helper traffic', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation())],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    expect(await follower.follow({ x: 100, y: 100, width: 800, height: 600 })).toEqual({ outcome: 'applied' });
    expect(await follower.follow({ x: 100, y: 100, width: 800, height: 600 })).toEqual({ outcome: 'unchanged' });
    expect(service.applyCalls).toBe(1);
  });

  it('a process change is terminal: no mutation, ever again', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation({ processId: 9999 }))],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    expect(await follower.follow({ x: 1, y: 1, width: 100, height: 100 })).toMatchObject({ outcome: 'missing' });
    expect(follower.state).toBe('identity-lost');
    expect(service.applyCalls).toBe(0);
    // Further attempts must not mutate either.
    expect(await follower.follow({ x: 2, y: 2, width: 100, height: 100 })).toMatchObject({ outcome: 'missing' });
    expect(service.applyCalls).toBe(0);
  });

  it('a vanished target ends adoption without applying', async () => {
    const service = fakeService({
      observations: [success(observation()), { outcome: 'missing' }],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    expect(await follower.follow({ x: 1, y: 1, width: 100, height: 100 })).toMatchObject({ outcome: 'missing' });
    expect(service.applyCalls).toBe(0);
  });

  it('release restores the original rectangle exactly', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation())],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    await follower.follow({ x: 100, y: 100, width: 800, height: 600 });
    expect(await follower.release()).toEqual({ outcome: 'released', restored: true });
    expect(service.appliedBounds.at(-1)).toEqual({ x: 10, y: 20, width: 640, height: 420 });
    expect(follower.state).toBe('released');
  });

  it('keeps a transient restore failure retryable and restores on the next attempt', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation()), success(observation())],
      applies: [{ outcome: 'helper-unavailable' }, { outcome: 'success' }],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    const first = await follower.release();
    expect(first).toMatchObject({ outcome: 'helper-unavailable' });
    expect(follower.state).toBe('following');
    expect(service.applyCalls).toBe(1);
    const second = await follower.release();
    expect(second).toEqual({ outcome: 'released', restored: true });
    expect(service.applyCalls).toBe(2);
    expect(service.appliedBounds.at(-1)).toEqual({ x: 10, y: 20, width: 640, height: 420 });
    expect(follower.state).toBe('released');
  });

  it('release after doubt performs no mutation', async () => {
    const service = fakeService({
      observations: [success(observation()), success(observation({ processId: 7777 }))],
    });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    await follower.follow({ x: 1, y: 1, width: 100, height: 100 });
    const callsAfterDoubt = service.applyCalls;
    expect(await follower.release()).toMatchObject({ outcome: 'missing' });
    expect(service.applyCalls).toBe(callsAfterDoubt);
  });

  it('malformed bounds fail before any native mutation', async () => {
    const service = fakeService({ observations: [success(observation())] });
    const follower = createAdoptedWindowFollower(service);
    await follower.adopt(capability());
    for (const bounds of [
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: -5, height: 100 },
      { x: Number.NaN, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 100000, height: 100 },
    ]) {
      expect(await follower.follow(bounds)).toMatchObject({ outcome: 'malformed' });
    }
    expect(service.applyCalls).toBe(0);
  });
});
