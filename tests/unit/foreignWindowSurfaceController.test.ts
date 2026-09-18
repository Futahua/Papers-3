import { describe, expect, it } from 'vitest';

import {
  createForeignWindowSurfaceController,
  type ForeignWindowSurfaceControllerService,
} from '../../src/main/windows/foreignWindowSurfaceController';
import type {
  PersistedWindowMemberDescriptor,
  WindowRuntimeCapability,
} from '../../src/main/windows/windowCapabilityService';
import type { WindowCapabilityResult, WindowObservation } from '../../src/main/windows/windowCapabilityTypes';
import type { WindowLayoutBroker } from '../../src/main/windows/windowLayoutBroker';

const descriptor: PersistedWindowMemberDescriptor = {
  version: 1,
  title: 'Notepad',
  executableFingerprint: 'a'.repeat(64),
};
const capability: WindowRuntimeCapability = { version: 1, bindingId: 'binding-1' };
const bounds = { x: 10, y: 20, width: 640, height: 420 };

function observation(overrides: Partial<WindowObservation> = {}): WindowObservation {
  return {
    runtimeId: 'T11111111111111111111111111111111' as WindowObservation['runtimeId'],
    title: 'Notepad',
    processId: 4242,
    processPath: 'C:\\Windows\\notepad.exe',
    windowClass: 'Notepad',
    state: 'normal',
    bounds,
    ...overrides,
  };
}

function service(overrides: Partial<{
  resolve: WindowCapabilityResult;
  observe: WindowCapabilityResult;
  place: WindowCapabilityResult;
}> = {}): ForeignWindowSurfaceControllerService & { placed: Array<{ bounds: typeof bounds; host?: string }> } {
  const placed: Array<{ bounds: typeof bounds; host?: string }> = [];
  return {
    placed,
    resolvePersisted: async () => overrides.resolve as never ?? { outcome: 'success', capability, descriptor },
    observeCapability: async () => overrides.observe ?? { outcome: 'success', observation: observation() },
    placeAdoptedCapability: async (_cap, nextBounds, host) => {
      placed.push({ bounds: { ...nextBounds }, ...(host ? { host } : {}) });
      return overrides.place ?? { outcome: 'success', observation: observation({ bounds: nextBounds }) };
    },
  };
}

describe('foreignWindowSurfaceController', () => {
  it('keeps durable descriptor state separate from the ephemeral capability', () => {
    const controller = createForeignWindowSurfaceController(service());
    const created = controller.create({ surfaceId: 'foreign-1', descriptor, title: 'Notes', hostWindowId: 7 });
    expect(created).toEqual({
      surfaceId: 'foreign-1',
      descriptor,
      title: 'Notes',
      state: 'disconnected',
      paneBounds: null,
      originalBounds: null,
      hostWindowId: 7,
    });
    expect(JSON.stringify(created)).not.toContain('binding-1');
  });

  it('resolves, follows with host context, and releases without exposing runtime identity', async () => {
    const deps = service();
    const controller = createForeignWindowSurfaceController(deps);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect((await controller.resolve('foreign-1')).outcome).toBe('success');
    expect(controller.snapshot()[0]?.state).toBe('live-visible');
    expect((await controller.follow('foreign-1', { x: 100, y: 110, width: 800, height: 600 }, '77')).outcome).toBe('success');
    expect(deps.placed).toEqual([{ bounds: { x: 100, y: 110, width: 800, height: 600 }, host: '77' }]);
    expect(controller.snapshot()[0]?.paneBounds).toEqual({ x: 100, y: 110, width: 800, height: 600 });
    expect((await controller.release('foreign-1', '77')).outcome).toBe('success');
    expect(controller.snapshot()[0]?.state).toBe('released');
    expect(deps.placed.at(-1)?.bounds).toEqual(bounds);
  });

  it('uses the native broker for host-relative hot placement and keeps the follower as fallback', async () => {
    const calls: string[] = [];
    const broker: WindowLayoutBroker = {
      setHost: async (hwnd) => { calls.push(`host:${hwnd}`); return true; },
      bind: async (surfaceId, instanceId) => { calls.push(`bind:${surfaceId}:${instanceId}`); return true; },
      layout: (items) => { calls.push(`layout:${items.map((item) => `${item.id}:${item.x}`).join(',')}`); return true; },
      release: async (surfaceId) => { calls.push(`release:${surfaceId}`); return true; },
      releaseAll: async () => true,
      stop: async () => undefined,
    };
    const member = { ...descriptor, windowInstanceId: 'W0123456789abcdef' };
    const deps = service({});
    deps.resolvePersisted = async () => ({ outcome: 'success' as const, capability, descriptor: member });
    const controller = createForeignWindowSurfaceController(deps, undefined, broker);
    controller.create({ surfaceId: 'foreign-1', descriptor: member, hostWindowId: 7 });
    await controller.resolve('foreign-1');
    expect((await controller.follow('foreign-1', { x: 100, y: 110, width: 800, height: 600 }, '77')).outcome).toBe('success');
    expect(deps.placed).toHaveLength(0);
    expect(calls).toEqual([
      'host:77',
      'bind:foreign-1:W0123456789abcdef',
      'layout:foreign-1:100',
    ]);
    expect((await controller.release('foreign-1', '77')).outcome).toBe('success');
    expect(calls.at(-1)).toBe('release:foreign-1');
  });

  it('does not eject an accelerated surface when a second Papers host follows', async () => {
    const calls: string[] = [];
    const broker: WindowLayoutBroker = {
      setHost: async (hwnd) => { calls.push(`host:${hwnd}`); return true; },
      bind: async (surfaceId) => { calls.push(`bind:${surfaceId}`); return true; },
      layout: (items) => { calls.push(`layout:${items.map((item) => item.id).join(',')}`); return true; },
      release: async (surfaceId) => { calls.push(`release:${surfaceId}`); return true; },
      releaseAll: async () => { calls.push('releaseAll'); return true; },
      stop: async () => undefined,
    };
    const first = { ...descriptor, windowInstanceId: 'W0123456789abcdef' };
    const second = { ...descriptor, windowInstanceId: 'Wfedcba9876543210' };
    const deps = service({});
    deps.resolvePersisted = async (candidate) => ({ outcome: 'success' as const, capability, descriptor: candidate });
    const controller = createForeignWindowSurfaceController(deps, undefined, broker);
    controller.create({ surfaceId: 'foreign-a', descriptor: first, hostWindowId: 1 });
    controller.create({ surfaceId: 'foreign-b', descriptor: second, hostWindowId: 2 });
    await controller.resolve('foreign-a');
    await controller.resolve('foreign-b');
    await controller.follow('foreign-a', { x: 1, y: 2, width: 300, height: 200 }, '101');
    await controller.follow('foreign-b', { x: 3, y: 4, width: 300, height: 200 }, '202');
    expect(calls).not.toContain('releaseAll');
    expect(deps.placed.at(-1)?.bounds).toEqual({ x: 3, y: 4, width: 300, height: 200 });
  });

  it('failed resolution returns to disconnected without a native placement', async () => {
    const deps = service({ resolve: { outcome: 'missing', error: 'not running' } });
    const controller = createForeignWindowSurfaceController(deps);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect((await controller.resolve('foreign-1')).outcome).toBe('missing');
    expect(controller.snapshot()[0]?.state).toBe('disconnected');
    expect(deps.placed).toHaveLength(0);
  });

  it('identity loss becomes disconnected and blocks later mutation', async () => {
    const deps = service();
    const controller = createForeignWindowSurfaceController(deps);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    await controller.resolve('foreign-1');
    deps.observeCapability = async () => ({ outcome: 'missing', error: 'identity changed' });
    const followed = await controller.follow('foreign-1', { x: 1, y: 2, width: 300, height: 200 });
    expect(followed.outcome).toBe('missing');
    expect(controller.snapshot()[0]?.state).toBe('disconnected');
    expect((await controller.follow('foreign-1', { x: 3, y: 4, width: 300, height: 200 })).outcome).toBe('malformed');
    expect(deps.placed).toHaveLength(0);
  });

  it('transient release failure remains live and retryable', async () => {
    let places = 0;
    const deps = service();
    deps.placeAdoptedCapability = async (_cap, nextBounds, host) => {
      places += 1;
      deps.placed.push({ bounds: { ...nextBounds }, ...(host ? { host } : {}) });
      return places === 1 ? { outcome: 'helper-unavailable', error: 'restart' } : { outcome: 'success' };
    };
    const controller = createForeignWindowSurfaceController(deps);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    await controller.resolve('foreign-1');
    const first = await controller.release('foreign-1');
    expect(first.outcome).toBe('helper-unavailable');
    expect(controller.snapshot()[0]?.state).toBe('live-visible');
    expect((await controller.release('foreign-1')).outcome).toBe('success');
    expect(controller.snapshot()[0]?.state).toBe('released');
  });

  it('reconnects after helper restart without replacing the original restore rectangle', async () => {
    const deps = service();
    let resolutions = 0;
    deps.resolvePersisted = async () => {
      resolutions += 1;
      return { outcome: 'success' as const, capability: { version: 1, bindingId: `binding-${resolutions}` }, descriptor };
    };
    const controller = createForeignWindowSurfaceController(deps);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    await controller.resolve('foreign-1');
    await controller.follow('foreign-1', { x: 100, y: 110, width: 800, height: 600 });
    const before = controller.snapshot()[0];
    expect(before?.originalBounds).toEqual(bounds);
    expect((await controller.reconnect('foreign-1')).outcome).toBe('success');
    expect(resolutions).toBe(2);
    expect(controller.snapshot()[0]?.originalBounds).toEqual(bounds);
    expect(controller.snapshot()[0]?.state).toBe('live-visible');
  });

  it('only released or disconnected surfaces can be retired', async () => {
    const controller = createForeignWindowSurfaceController(service());
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect(controller.retire('foreign-1')).toBe(true);
    expect(controller.snapshot()).toEqual([]);
  });
});
