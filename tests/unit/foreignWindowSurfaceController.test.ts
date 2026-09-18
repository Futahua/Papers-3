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
  windowInstanceId: 'W0123456789abcdef',
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
}> = {}): ForeignWindowSurfaceControllerService {
  return {
    resolvePersisted: async () => overrides.resolve as never ?? { outcome: 'success', capability, descriptor },
    observeCapability: async () => overrides.observe ?? { outcome: 'success', observation: observation() },
  };
}

function broker(overrides: Partial<{
  createHost: boolean;
  adopt: boolean;
  setBounds: boolean;
  setVisible: boolean;
  release: boolean;
}> = {}): WindowLayoutBroker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createHost: async (surfaceId, host) => { calls.push(`create:${surfaceId}:${host}`); return overrides.createHost ?? true; },
    adopt: async (surfaceId, instanceId) => { calls.push(`adopt:${surfaceId}:${instanceId}`); return overrides.adopt ?? true; },
    setBounds: async (surfaceId, next) => { calls.push(`bounds:${surfaceId}:${next.x}:${next.y}:${next.width}:${next.height}`); return overrides.setBounds ?? true; },
    setVisible: async (surfaceId, visible) => { calls.push(`visible:${surfaceId}:${visible}`); return overrides.setVisible ?? true; },
    release: async (surfaceId) => { calls.push(`release:${surfaceId}`); return overrides.release ?? true; },
    releaseAll: async () => true,
    stop: async () => undefined,
  };
}

describe('foreignWindowSurfaceController', () => {
  it('keeps durable descriptor state separate from the ephemeral capability', () => {
    const controller = createForeignWindowSurfaceController(service(), undefined, broker());
    const created = controller.create({ surfaceId: 'foreign-1', descriptor, title: 'Notes', hostWindowId: 7 });
    expect(created).toEqual({
      surfaceId: 'foreign-1', descriptor, title: 'Notes', state: 'disconnected', paneBounds: null, originalBounds: null, hostWindowId: 7,
    });
    expect(JSON.stringify(created)).not.toContain('binding-1');
  });

  it('adopts a real native child host, uses Papers client bounds, and releases it', async () => {
    const native = broker();
    const controller = createForeignWindowSurfaceController(service(), undefined, native);
    controller.create({ surfaceId: 'foreign-1', descriptor, hostWindowId: 7 });
    expect((await controller.resolve('foreign-1')).outcome).toBe('success');
    expect(controller.snapshot()[0]?.originalBounds).toEqual(bounds);
    expect((await controller.follow('foreign-1', { x: 100, y: 110, width: 800, height: 600 }, '77')).outcome).toBe('success');
    expect(native.calls).toEqual([
      'create:foreign-1:77',
      'adopt:foreign-1:W0123456789abcdef',
      'bounds:foreign-1:100:110:800:600',
    ]);
    expect(controller.snapshot()[0]?.paneBounds).toEqual({ x: 100, y: 110, width: 800, height: 600 });
    expect((await controller.setVisible('foreign-1', false)).outcome).toBe('success');
    expect((await controller.release('foreign-1')).outcome).toBe('success');
    expect(native.calls.at(-2)).toBe('visible:foreign-1:false');
    expect(native.calls.at(-1)).toBe('release:foreign-1');
  });

  it('fails closed when the application cannot be hosted instead of teleporting it', async () => {
    const native = broker({ adopt: false });
    const controller = createForeignWindowSurfaceController(service(), undefined, native);
    controller.create({ surfaceId: 'foreign-1', descriptor, hostWindowId: 7 });
    await controller.resolve('foreign-1');
    const result = await controller.follow('foreign-1', { x: 1, y: 2, width: 300, height: 200 }, '77');
    expect(result.outcome).toBe('helper-unavailable');
    expect('error' in result && result.error).toContain('cannot be hosted');
    expect(controller.snapshot()[0]?.state).toBe('live-visible');
    expect(native.calls).toEqual(['create:foreign-1:77', 'adopt:foreign-1:W0123456789abcdef', 'release:foreign-1']);
  });

  it('supports multiple surfaces without switching or ejecting a Papers host', async () => {
    const native = broker();
    const second = { ...descriptor, windowInstanceId: 'Wfedcba9876543210' };
    const deps = service();
    deps.resolvePersisted = async (candidate) => ({ outcome: 'success' as const, capability, descriptor: candidate });
    const controller = createForeignWindowSurfaceController(deps, undefined, native);
    controller.create({ surfaceId: 'foreign-a', descriptor, hostWindowId: 1 });
    controller.create({ surfaceId: 'foreign-b', descriptor: second, hostWindowId: 2 });
    await controller.resolve('foreign-a');
    await controller.resolve('foreign-b');
    expect((await controller.follow('foreign-a', { x: 1, y: 2, width: 300, height: 200 }, '101')).outcome).toBe('success');
    expect((await controller.follow('foreign-b', { x: 3, y: 4, width: 300, height: 200 }, '202')).outcome).toBe('success');
    expect(native.calls).toContain('create:foreign-a:101');
    expect(native.calls).toContain('create:foreign-b:202');
  });

  it('fails resolution without creating a native host', async () => {
    const native = broker();
    const controller = createForeignWindowSurfaceController(service({ resolve: { outcome: 'missing', error: 'not running' } }), undefined, native);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect((await controller.resolve('foreign-1')).outcome).toBe('missing');
    expect(controller.snapshot()[0]?.state).toBe('disconnected');
    expect(native.calls).toHaveLength(0);
  });

  it('rejects an unhostable observed state before native adoption', async () => {
    const native = broker();
    const controller = createForeignWindowSurfaceController(service({ observe: { outcome: 'success', observation: observation({ state: 'minimized' }) } }), undefined, native);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect((await controller.resolve('foreign-1')).outcome).toBe('missing');
    expect(native.calls).toHaveLength(0);
  });

  it('reconnects without replacing the captured original rectangle', async () => {
    const native = broker();
    let resolutions = 0;
    const deps = service();
    deps.resolvePersisted = async () => {
      resolutions += 1;
      return { outcome: 'success' as const, capability: { version: 1, bindingId: `binding-${resolutions}` }, descriptor };
    };
    const controller = createForeignWindowSurfaceController(deps, undefined, native);
    controller.create({ surfaceId: 'foreign-1', descriptor });
    await controller.resolve('foreign-1');
    await controller.follow('foreign-1', { x: 100, y: 110, width: 800, height: 600 }, '77');
    expect((await controller.reconnect('foreign-1')).outcome).toBe('success');
    expect(resolutions).toBe(2);
    expect(controller.snapshot()[0]?.originalBounds).toEqual(bounds);
  });

  it('only released or disconnected surfaces can be retired', async () => {
    const controller = createForeignWindowSurfaceController(service(), undefined, broker());
    controller.create({ surfaceId: 'foreign-1', descriptor });
    expect(controller.retire('foreign-1')).toBe(true);
    expect(controller.snapshot()).toEqual([]);
  });
});
