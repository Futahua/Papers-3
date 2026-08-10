import { describe, expect, it } from 'vitest';

import { createWindowCapabilityService } from '../../src/main/windows/windowCapabilityService';
import type { WindowHelperFactory } from '../../src/main/windows/windowHelperFactory';
import type { WindowCapabilityResult, WindowObservation, RuntimeWindowId } from '../../src/main/windows/windowCapabilityTypes';

const TOKEN_A = 'Ta'.padEnd(33, 'a');
const TOKEN_B = 'Tb'.padEnd(33, 'b');
const TOKEN_C = 'Tc'.padEnd(33, 'c');

function observation(partial: Partial<WindowObservation> & { runtimeId: RuntimeWindowId }): WindowObservation {
  return {
    title: 'Window A',
    processId: 1001,
    processPath: 'C:\\Apps\\a.exe',
    state: 'normal',
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    ...partial,
  };
}

function fakeFactory(overrides: Partial<WindowHelperFactory> = {}): WindowHelperFactory {
  const windows: WindowObservation[] = [
    observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\Apps\\a.exe' }),
    observation({ runtimeId: TOKEN_B as RuntimeWindowId, title: 'Window B', processId: 2002, processPath: 'C:\\Apps\\b.exe' }),
    observation({ runtimeId: TOKEN_C as RuntimeWindowId, title: 'Papers', processId: 9999, processPath: 'C:\\Papers\\Papers.exe' }),
    observation({ runtimeId: 'Td'.padEnd(33, 'd') as RuntimeWindowId, title: '', processId: 3003, processPath: 'C:\\Apps\\c.exe' }),
    observation({ runtimeId: 'Te'.padEnd(33, 'e') as RuntimeWindowId, title: 'No Path', processId: 4004, processPath: null }),
  ];
  let started = false;
  const listResult = (): WindowCapabilityResult => ({
    outcome: 'success',
    windows,
  });
  return {
    start: async () => {
      started = true;
      return 'ready';
    },
    stop: async () => undefined,
    isReady: () => started,
    list: async () => listResult(),
    observe: async (runtimeId) => {
      const found = windows.find((entry) => entry.runtimeId === runtimeId);
      return found ? { outcome: 'success', observation: found } : { outcome: 'missing' as const, error: 'gone' };
    },
    minimize: async (runtimeId) => {
      const found = windows.find((entry) => entry.runtimeId === runtimeId);
      return found ? { outcome: 'success', observation: { ...found, state: 'minimized' } } : { outcome: 'missing' as const, error: 'gone' };
    },
    restore: async (runtimeId) => {
      const found = windows.find((entry) => entry.runtimeId === runtimeId);
      return found ? { outcome: 'success', observation: { ...found, state: 'normal' } } : { outcome: 'missing' as const, error: 'gone' };
    },
    apply: async (runtimeId, bounds) => {
      const found = windows.find((entry) => entry.runtimeId === runtimeId);
      return found ? { outcome: 'success', observation: { ...found, bounds } } : { outcome: 'missing' as const, error: 'gone' };
    },
    close: async () => ({ outcome: 'success' }),
    ...overrides,
  };
}

function harness(overrides: Parameters<typeof createWindowCapabilityService>[0] = {}) {
  const factory = fakeFactory();
  const service = createWindowCapabilityService({
    createFactory: () => factory,
    currentPid: 9999,
    getFileIcon: async () => ({ toDataURL: () => 'data:image/png;base64,ICON' }) as never,
    observeCadenceMs: 10,
    ...overrides,
  });
  return { service, factory };
}

describe('windowCapabilityService candidates', () => {
  it('lists only trusted candidates: Papers itself, empty titles and missing paths are excluded', async () => {
    const { service } = harness();
    const result = await service.listCandidates();
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(['Window A', 'Window B']);
    expect(result.candidates[0]!.applicationLabel).toBe('a');
    expect(result.candidates[0]!.icon).toBe('data:image/png;base64,ICON');
  });

  it('bounds candidate count', async () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      observation({ runtimeId: `T${index}`.padEnd(33, 'x') as RuntimeWindowId, title: `W ${index}`, processId: 5000 + index, processPath: `C:\\Apps\\w${index}.exe` }));
    const factory = fakeFactory({ list: async () => ({ outcome: 'success', windows: many }) });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    const result = await service.listCandidates();
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.candidates.length).toBeLessThanOrEqual(64);
  });

  it('reports helper-unavailable when the factory cannot start', async () => {
    const factory = fakeFactory({ start: async () => 'helper-unavailable' });
    const service = createWindowCapabilityService({ createFactory: () => factory });
    const result = await service.listCandidates();
    expect(result).toEqual({ outcome: 'helper-unavailable', error: 'window helper is unavailable' });
  });
});

describe('windowCapabilityService bind and capabilities', () => {
  it('binds only a currently listed host-issued candidate id into capability + descriptor', async () => {
    const { service } = harness();
    await service.listCandidates();
    const bound = await service.bindCandidate('wl-candidate-1');
    expect(bound.outcome).toBe('success');
    if (bound.outcome !== 'success') return;
    expect(bound.capability).toMatchObject({ version: 1 });
    expect(bound.capability.bindingId).toBeTruthy();
    expect(bound.descriptor).toMatchObject({ version: 1, title: 'Window A', executableFingerprint: expect.any(String) });
    // The persisted descriptor is structurally distinct from the runtime
    // capability: no runtime token anywhere in it.
    expect(JSON.stringify(bound.descriptor)).not.toContain(TOKEN_A);
  });

  it('rejects a candidate that is not currently listed', async () => {
    const { service } = harness();
    const bound = await service.bindCandidate('wl-candidate-999');
    expect(bound.outcome).toBe('missing');
  });

  it('binds fail closed when the helper reports the candidate missing', async () => {
    const factory = fakeFactory({ observe: async () => ({ outcome: 'missing' as const, error: 'gone' }) });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    await service.listCandidates();
    const bound = await service.bindCandidate('wl-candidate-1');
    expect(bound.outcome).toBe('missing');
  });

  it('observe/minimize/restore/apply route to the issued capability only', async () => {
    const { service } = harness();
    await service.listCandidates();
    const bound = await service.bindCandidate('wl-candidate-2');
    expect(bound.outcome).toBe('success');
    if (bound.outcome !== 'success') return;
    expect((await service.observeCapability(bound.capability)).outcome).toBe('success');
    const minimized = await service.minimizeCapability(bound.capability);
    expect(minimized.outcome).toBe('success');
    if (minimized.outcome === 'success') expect(minimized.observation?.state).toBe('minimized');
    expect((await service.restoreCapability(bound.capability)).outcome).toBe('success');
    const applied = await service.applyCapability(bound.capability, { x: 1, y: 2, width: 400, height: 300 });
    expect(applied.outcome).toBe('success');
    if (applied.outcome === 'success') expect(applied.observation?.bounds).toEqual({ x: 1, y: 2, width: 400, height: 300 });
  });
});

describe('windowCapabilityService persisted re-resolution', () => {
  it('resolves a visible window by exact pid+title into a fresh capability', async () => {
    const { service } = harness();
    const resolved = await service.resolvePersisted({ version: 1, title: 'Window A', executableFingerprint: '6a992db418ddfbdab5743ccd05f2eb7822b6c6d25e294987bebd5969f8143609' });
    expect(resolved.outcome).toBe('success');
    if (resolved.outcome !== 'success') return;
    expect(resolved.capability).toMatchObject({ version: 1 });
  });

  it('returns missing when no visible window matches', async () => {
    const { service } = harness();
    const resolved = await service.resolvePersisted({ version: 1, title: 'Gone Window', executableFingerprint: 'a'.repeat(64) });
    expect(resolved.outcome).toBe('missing');
  });

  it('returns ambiguous when more than one visible window matches', async () => {
    const windows: WindowObservation[] = [
      observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Same Title', processId: 1001, processPath: 'C:\\a.exe' }),
      observation({ runtimeId: TOKEN_B as RuntimeWindowId, title: 'Same Title', processId: 1001, processPath: 'C:\\a.exe' }),
    ];
    const factory = fakeFactory({ list: async () => ({ outcome: 'success', windows }) });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    const resolved = await service.resolvePersisted({ version: 1, title: 'Same Title', executableFingerprint: '29cf5fa7376fcba828434127deca5110ba86498e390f02ff5b18e4519fc5a1d0' });
    expect(resolved.outcome).toBe('ambiguous');
  });
});

describe('windowCapabilityService lifecycle', () => {
  it('stop tears down the factory and further calls are unavailable', async () => {
    const { service, factory } = harness();
    await service.listCandidates();
    const stopSpy = factory.stop;
    await service.stop();
    expect(stopSpy).toBeDefined();
    expect((await service.listCandidates()).outcome).toBe('helper-unavailable');
    expect((await service.bindCandidate('wl-candidate-1')).outcome).toBe('helper-unavailable');
  });

  it('stop is idempotent', async () => {
    const { service } = harness();
    await service.stop();
    await service.stop();
  });
});

describe('windowCapabilityService first-list retry', () => {
  const windows: WindowObservation[] = [
    observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\Apps\\a.exe' }),
  ];

  it('retries exactly once when the very first list times out', async () => {
    let calls = 0;
    const factory = fakeFactory({
      list: async () => {
        calls += 1;
        if (calls === 1) return { outcome: 'timeout' as const, error: 'slow first enumeration' };
        return { outcome: 'success', windows };
      },
    });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    const result = await service.listCandidates();
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.candidates).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('declares the helper unavailable after the bounded retry also times out', async () => {
    const factory = fakeFactory({ list: async () => ({ outcome: 'timeout' as const, error: 'still slow' }) });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    const result = await service.listCandidates();
    expect(result.outcome).toBe('helper-unavailable');
  });
});
