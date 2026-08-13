import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createWindowCapabilityService } from '../../src/main/windows/windowCapabilityService';
import { createThumbnailFrameStore } from '../../src/main/windows/thumbnailFrameStore';
import type { WindowHelperFactory } from '../../src/main/windows/windowHelperFactory';
import type { WindowCapabilityResult, WindowObservation, RuntimeWindowId } from '../../src/main/windows/windowCapabilityTypes';

const TOKEN_A = 'Ta'.padEnd(33, 'a');
const TOKEN_B = 'Tb'.padEnd(33, 'b');
const TOKEN_C = 'Tc'.padEnd(33, 'c');

/** ONE complete valid PNG byte buffer (signature + IHDR claiming the given
 * dimensions) base64-encoded whole, so the strict IHDR check passes when the
 * claimed width/height match. */
function pngWithSize(width: number, height: number): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]).toString('base64');
}

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
    hover: async (x, y) => {
      if (x === -999 && y === -999) return { outcome: 'success', window: null };
      return { outcome: 'success', window: windows[0] };
    },
    thumbnail: async (runtimeId, maxWidth = 240, maxHeight = 135) => {
      const found = windows.find((entry) => entry.runtimeId === runtimeId);
      if (!found) return { outcome: 'missing', error: 'gone' };
      if (found.state === 'minimized') return { outcome: 'minimized', error: 'window is minimized' };
      return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight } };
    },
    get revision() {
      return 0;
    },
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
  it('temporarily reveals a minimized Peek target and returns it to minimized on end', async () => {
    const target = observation({
      runtimeId: TOKEN_A as RuntimeWindowId,
      title: 'Window A',
      processId: 1001,
      processPath: 'C:\\Apps\\a.exe',
      state: 'minimized',
    });
    const other = observation({
      runtimeId: TOKEN_B as RuntimeWindowId,
      title: 'Window B',
      processId: 2002,
      processPath: 'C:\\Apps\\b.exe',
    });
    const revealed: RuntimeWindowId[] = [];
    const minimized: RuntimeWindowId[] = [];
    const cloaked: RuntimeWindowId[] = [];
    const factory = fakeFactory({
      list: async () => ({ outcome: 'success', windows: [target, other] }),
      uncloak: async (runtimeId) => { revealed.push(runtimeId); return { outcome: 'success' }; },
      cloak: async (runtimeId) => { cloaked.push(runtimeId); return { outcome: 'success' }; },
      minimize: async (runtimeId) => { minimized.push(runtimeId); return { outcome: 'success' }; },
    });
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success') throw new Error('list failed');
    const row = listed.candidates.find((candidate) => candidate.title === 'Window A');
    if (!row) throw new Error('minimized target missing');
    const bound = await service.bindCandidate(row.id);
    if (bound.outcome !== 'success') throw new Error('bind failed');

    expect((await service.beginPeekCapability(bound.capability)).outcome).toBe('success');
    expect(revealed).toEqual([TOKEN_A]);
    expect(cloaked).toEqual([TOKEN_B]);
    expect(minimized).toEqual([]);

    expect((await service.endPeek()).outcome).toBe('success');
    expect(minimized).toEqual([TOKEN_A]);
  });

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

describe('windowCapabilityService native picker snapshots', () => {
  it('seeds and rebinds the complete PID/bounds set without point hit-testing', async () => {
    const { service } = harness();
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success') throw new Error('list failed');
    const target = listed.candidates.find((entry) => entry.title === 'Window A');
    if (!target) throw new Error('candidate missing');
    const original = await service.bindCandidate(target.id);
    if (original.outcome !== 'success') throw new Error('bind failed');

    const prepared = await service.prepareNativePicker([original.descriptor]);
    expect(prepared).toEqual({
      outcome: 'success',
      seeds: [{ processId: 1001, x: 10, y: 20, width: 300, height: 200 }],
    });
    if (prepared.outcome !== 'success') return;

    const rebound = await service.bindNativePickerSelection(prepared.seeds);
    expect(rebound.outcome).toBe('success');
    if (rebound.outcome === 'success') {
      expect(rebound.windows).toHaveLength(1);
      expect(rebound.windows[0]!.descriptor).toEqual(original.descriptor);
      expect(rebound.windows[0]!.candidate.title).toBe('Window A');
    }
  });

  it('fails the whole commit when a PID/bounds identity is absent', async () => {
    const { service } = harness();
    await expect(service.bindNativePickerSelection([
      { processId: 1001, x: 999, y: 20, width: 300, height: 200 },
    ])).resolves.toEqual({ outcome: 'missing', error: 'a selected window changed before commit' });
  });
});

describe('windowCapabilityService bind and capabilities', () => {
  it('binds only a currently listed host-issued candidate id into capability + descriptor', async () => {
    const { service } = harness();
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const bound = await service.bindCandidate(listed.candidates[0]!.id);
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
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const bound = await service.bindCandidate(listed.candidates[0]!.id);
    expect(bound.outcome).toBe('missing');
  });

  it('observe/minimize/restore/apply route to the issued capability only', async () => {
    const { service } = harness();
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length < 2) throw new Error('no candidates');
    const bound = await service.bindCandidate(listed.candidates[1]!.id);
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

describe('windowCapabilityService thumbnail (019G)', () => {
  /** A factory whose thumbnail calls are recorded and whose session revision
   * is mutable, so cache hit / TTL / LRU / helper-replacement invalidation
   * are all observable. */
  function thumbnailHarness(fallback?: WindowCapabilityResult) {
    const windows: WindowObservation[] = [
      observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\Apps\\a.exe', state: 'normal' }),
      observation({ runtimeId: TOKEN_B as RuntimeWindowId, title: 'Window B', processId: 2002, processPath: 'C:\\Apps\\b.exe', state: 'minimized' }),
    ];
    const calls: Array<{ token: string; width: number; height: number }> = [];
    let revision = 0;
    const factory: WindowHelperFactory = {
      start: async () => 'ready',
      stop: async () => undefined,
      isReady: () => true,
      list: async () => ({ outcome: 'success', windows }),
      observe: async (runtimeId) => {
        const found = windows.find((entry) => entry.runtimeId === runtimeId);
        return found ? { outcome: 'success', observation: found } : { outcome: 'missing' as const, error: 'gone' };
      },
      minimize: async () => ({ outcome: 'missing', error: 'gone' }),
      restore: async () => ({ outcome: 'missing', error: 'gone' }),
      apply: async () => ({ outcome: 'missing', error: 'gone' }),
      close: async () => ({ outcome: 'success' }),
      hover: async () => ({ outcome: 'success', window: null }),
      thumbnail: async (runtimeId, maxWidth = 240, maxHeight = 135) => {
        calls.push({ token: String(runtimeId), width: maxWidth, height: maxHeight });
        const found = windows.find((entry) => entry.runtimeId === runtimeId);
        if (!found) return { outcome: 'missing', error: 'gone' };
        if (found.state === 'minimized') return { outcome: 'minimized', error: 'window is minimized' };
        if (fallback) return fallback;
        return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight } };
      },
      get revision() {
        return revision;
      },
    };
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    return {
      service,
      factory,
      calls,
      windows,
      bumpRevision: () => { revision += 1; },
    };
  }

  async function bindA(service: ReturnType<typeof thumbnailHarness>['service']) {
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const bound = await service.bindCandidate(listed.candidates[0]!.id);
    if (bound.outcome !== 'success') throw new Error('bind failed');
    return bound.capability;
  }

  it('routes to the issued capability and returns a strictly validated thumbnail', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    const result = await h.service.thumbnailCapability(capability, { maxWidth: 160, maxHeight: 90 });
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.thumbnail).toEqual({ image: pngWithSize(160, 90), width: 160, height: 90 });
    expect(h.calls).toEqual([{ token: TOKEN_A, width: 160, height: 90 }]);
  });

  it('defaults absent dimensions to 240x135 and rejects out-of-range/non-integer dimensions', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    expect((await h.service.thumbnailCapability(capability)).outcome).toBe('success');
    expect(h.calls).toEqual([{ token: TOKEN_A, width: 240, height: 135 }]);
    expect((await h.service.thumbnailCapability(capability, { maxWidth: 0, maxHeight: 135 })).outcome).toBe('malformed');
    expect((await h.service.thumbnailCapability(capability, { maxWidth: 321, maxHeight: 135 })).outcome).toBe('malformed');
    expect((await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 181 })).outcome).toBe('malformed');
    expect((await h.service.thumbnailCapability(capability, { maxWidth: 1.5, maxHeight: 135 })).outcome).toBe('malformed');
    expect(h.calls).toHaveLength(1);
  });

  it('returns missing for a capability whose binding is not issued', async () => {
    const h = thumbnailHarness();
    const result = await h.service.thumbnailCapability({ version: 1, bindingId: 'wl-binding-none' });
    expect(result.outcome).toBe('missing');
    expect(h.calls).toHaveLength(0);
  });

  it('propagates honest typed fallbacks and never caches them', async () => {
    const h = thumbnailHarness();
    const listed = await h.service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length < 2) throw new Error('no candidates');
    const boundB = await h.service.bindCandidate(listed.candidates[1]!.id);
    if (boundB.outcome !== 'success') throw new Error('bind B failed');
    const minimized = await h.service.thumbnailCapability(boundB.capability);
    expect(minimized.outcome).toBe('minimized');
    const again = await h.service.thumbnailCapability(boundB.capability);
    expect(again.outcome).toBe('minimized');
    expect(h.calls).toHaveLength(2);
  });

  it('uses the main cache as a duplicate-request shield: identical requests hit the helper once', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    // A different dimension is a different key and must hit the helper.
    await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(h.calls).toHaveLength(2);
  });

  it('expires cache entries after the TTL so a fresh capture runs', async () => {
    vi.useFakeTimers();
    try {
      const h = thumbnailHarness();
      const capability = await bindA(h.service);
      await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
      expect(h.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(751);
      await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
      expect(h.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the cache to 8 LRU entries and evicts the oldest', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    for (let width = 1; width <= 9; width += 1) {
      await h.service.thumbnailCapability(capability, { maxWidth: width, maxHeight: 135 });
    }
    expect(h.calls).toHaveLength(9);
    // Re-request the OLDEST key (width=1): evicted, so a fresh capture runs.
    await h.service.thumbnailCapability(capability, { maxWidth: 1, maxHeight: 135 });
    expect(h.calls).toHaveLength(10);
    // A recently-touched key (width=8) is still cached.
    await h.service.thumbnailCapability(capability, { maxWidth: 8, maxHeight: 135 });
    expect(h.calls).toHaveLength(10);
  });

  it('invalidates the cache on helper replacement (factory session revision)', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    h.bumpRevision();
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(2);
  });

  it('clears the ENTIRE cache on a revision change: two distinct old-revision entries are both invalidated (019GR3)', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    // Two distinct cache entries under the old revision.
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(h.calls).toHaveLength(2);
    h.bumpRevision();
    // Both keys must be re-captured - the whole cache was cleared, not just
    // the entry that happened to be consulted.
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(h.calls).toHaveLength(4);
  });

  it('never caches a malformed/denied/helper-unavailable thumbnail', async () => {
    const h = thumbnailHarness({ outcome: 'denied', error: 'PrintWindow is not supported' });
    const capability = await bindA(h.service);
    const first = await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(first.outcome).toBe('denied');
    const second = await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(second.outcome).toBe('denied');
    expect(h.calls).toHaveLength(2);
  });

  it('stop clears the thumbnail cache', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    await h.service.stop();
    expect((await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 })).outcome).toBe('helper-unavailable');
  });

  it('touches/reinserts a cached entry on hit so eviction is TRUE LRU, not FIFO', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    // w1 and w2 inserted (w1 is the oldest INSERTED entry).
    await h.service.thumbnailCapability(capability, { maxWidth: 1, maxHeight: 135 });
    await h.service.thumbnailCapability(capability, { maxWidth: 2, maxHeight: 135 });
    // Re-touch w1 (a cache hit): w1 is now the MOST recently used entry.
    await h.service.thumbnailCapability(capability, { maxWidth: 1, maxHeight: 135 });
    expect(h.calls).toHaveLength(2); // hit only, no fresh capture
    // Fill to 9 entries (w3..w9): the LEAST-recently-USED entry (w2, never
    // touched again) is evicted - NOT w1, which was touched on its hit. A
    // FIFO implementation would have evicted the first INSERTED entry (w1).
    for (let width = 3; width <= 9; width += 1) {
      await h.service.thumbnailCapability(capability, { maxWidth: width, maxHeight: 135 });
    }
    expect(h.calls).toHaveLength(9);
    // w1 survived the eviction (touched on hit): served from cache.
    await h.service.thumbnailCapability(capability, { maxWidth: 1, maxHeight: 135 });
    expect(h.calls).toHaveLength(9);
    // w2 was the evicted LRU entry: re-requesting it needs a fresh capture.
    await h.service.thumbnailCapability(capability, { maxWidth: 2, maxHeight: 135 });
    expect(h.calls).toHaveLength(10);
  });

  it('purges cached thumbnails for a binding that is no longer issued (019GR2)', async () => {
    const h = thumbnailHarness();
    const listed = await h.service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const candidateId = listed.candidates[0]!.id;
    const first = await h.service.bindCandidate(candidateId);
    if (first.outcome !== 'success') throw new Error('bind failed');
    const firstCapability = first.capability;
    await h.service.thumbnailCapability(firstCapability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    // Evict the first binding from the 128-entry bindings LRU by issuing 128
    // more binds for the SAME candidate (129 total).
    for (let i = 0; i < 128; i += 1) {
      const bound = await h.service.bindCandidate(candidateId);
      if (bound.outcome !== 'success') throw new Error('bind failed');
    }
    // The first binding is gone: its cached thumbnails must be purged and the
    // call fails closed as `missing` - never a stale cached success.
    const missing = await h.service.thumbnailCapability(firstCapability, { maxWidth: 240, maxHeight: 135 });
    expect(missing.outcome).toBe('missing');
  });

  it('021 retains the last validated success and serves it as the useful minimized preview', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    const live = await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(live.outcome).toBe('success');
    expect(h.calls).toHaveLength(1);
    // The window minimizes. A DIFFERENT dimension misses the 750ms shield, so
    // the live capture reports `minimized` and the retained 240x135 frame is
    // served as a success preview (never a fabricated image).
    h.windows[0]!.state = 'minimized';
    const preview = await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(preview.outcome).toBe('success');
    if (preview.outcome !== 'success') return;
    expect(preview.thumbnail).toEqual({ image: pngWithSize(240, 135), width: 240, height: 135 });
    expect(h.calls).toHaveLength(2); // one minimized probe, then the retained frame
    // A second minimized request serves the retained frame again.
    const again = await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(again.outcome).toBe('success');
    expect(h.calls).toHaveLength(3);
  });

  it('021 minimize/restore cycle: minimized serves the retained frame, restore refreshes it', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    h.windows[0]!.state = 'minimized';
    const minimized = await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(minimized.outcome).toBe('success');
    // Restore: the window is live again, so a fresh capture runs and refreshes
    // the retained last frame.
    h.windows[0]!.state = 'normal';
    const restored = await h.service.thumbnailCapability(capability, { maxWidth: 320, maxHeight: 180 });
    expect(restored.outcome).toBe('success');
    expect(h.calls).toHaveLength(3);
  });

  it('021 a helper revision change clears the retained last frame (honest fallback after restart)', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    h.windows[0]!.state = 'minimized';
    h.bumpRevision();
    // The last frame from the previous helper session must never be served.
    const result = await h.service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
    expect(result.outcome).toBe('minimized');
    expect(h.calls).toHaveLength(2);
  });

  it('021 a lost binding clears the retained last frame and fails closed as missing', async () => {
    const h = thumbnailHarness();
    const listed = await h.service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const candidateId = listed.candidates[0]!.id;
    const first = await h.service.bindCandidate(candidateId);
    if (first.outcome !== 'success') throw new Error('bind failed');
    const firstCapability = first.capability;
    await h.service.thumbnailCapability(firstCapability, { maxWidth: 240, maxHeight: 135 });
    expect(h.calls).toHaveLength(1);
    h.windows[0]!.state = 'minimized';
    for (let i = 0; i < 128; i += 1) {
      const bound = await h.service.bindCandidate(candidateId);
      if (bound.outcome !== 'success') throw new Error('bind failed');
    }
    // The binding is gone: its retained last frame is purged; the minimized
    // request fails closed as `missing` - never a stale frame.
    const result = await h.service.thumbnailCapability(firstCapability, { maxWidth: 240, maxHeight: 135 });
    expect(result.outcome).toBe('missing');
  });

  it('021 the retained last-frame cache is bounded to 8 LRU entries per binding', async () => {
    const h = thumbnailHarness();
    const listed = await h.service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const candidateId = listed.candidates[0]!.id;
    const bound = [];
    for (let i = 0; i < 9; i += 1) {
      const b = await h.service.bindCandidate(candidateId);
      if (b.outcome !== 'success') throw new Error('bind failed');
      bound.push(b.capability);
      const captured = await h.service.thumbnailCapability(b.capability, { maxWidth: 240, maxHeight: 135 });
      expect(captured.outcome).toBe('success');
    }
    h.windows[0]!.state = 'minimized';
    // 9 bindings retained 9 last frames; the oldest (first) was LRU-evicted.
    const evicted = await h.service.thumbnailCapability(bound[0]!, { maxWidth: 320, maxHeight: 180 });
    expect(evicted.outcome).toBe('minimized');
    // The newest binding's last frame is still served.
    const served = await h.service.thumbnailCapability(bound[8]!, { maxWidth: 320, maxHeight: 180 });
    expect(served.outcome).toBe('success');
  });

  it('025: a minimized terminal-icon preview prefers the retained real frame and is never retained itself', async () => {
    let clock = 0;
    let iconMode = false;
    const windows: WindowObservation[] = [
      observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\Apps\\a.exe', state: 'normal' }),
    ];
    const factory: WindowHelperFactory = {
      start: async () => 'ready',
      stop: async () => undefined,
      isReady: () => true,
      list: async () => ({ outcome: 'success', windows }),
      observe: async (runtimeId) => {
        const found = windows.find((entry) => entry.runtimeId === runtimeId);
        return found ? { outcome: 'success', observation: found } : { outcome: 'missing', error: 'gone' };
      },
      minimize: async () => ({ outcome: 'missing', error: 'gone' }),
      restore: async () => ({ outcome: 'missing', error: 'gone' }),
      apply: async () => ({ outcome: 'missing', error: 'gone' }),
      close: async () => ({ outcome: 'success' }),
      hover: async () => ({ outcome: 'success', window: null }),
      thumbnail: async (runtimeId, maxWidth = 240, maxHeight = 135) => {
        if (iconMode) return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight, source: 'icon', minimized: true } };
        return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight, source: 'capture', minimized: false } };
      },
      get revision() { return 0; },
    };
    const service = createWindowCapabilityService({ createFactory: () => factory, currentPid: 9999, getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never, now: () => clock });
    const listed = await service.listCandidates();
    if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
    const bound = await service.bindCandidate(listed.candidates[0]!.id);
    if (bound.outcome !== 'success') throw new Error('bind failed');
    // 1) A real capture is retained as the last frame.
    const real = await service.thumbnailCapability(bound.capability, { maxWidth: 240, maxHeight: 135 });
    expect(real.outcome).toBe('success');
    if (real.outcome === 'success') expect(real.thumbnail?.source).toBe('capture');
    // 2) The duplicate-request shield expires; the helper now reports a
    // minimized terminal icon, but the service PREFERS the retained real frame.
    clock = 1000;
    iconMode = true;
    const minimized = await service.thumbnailCapability(bound.capability, { maxWidth: 240, maxHeight: 135 });
    expect(minimized.outcome).toBe('success');
    if (minimized.outcome === 'success') expect(minimized.thumbnail?.source).toBe('capture');
    // 3) A fresh binding with NO retained frame returns the terminal icon.
    iconMode = true;
    const fresh = createWindowCapabilityService({ createFactory: () => factory, currentPid: 9999, getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never, now: () => 2000 });
    const listed2 = await fresh.listCandidates();
    if (listed2.outcome !== 'success' || listed2.candidates.length === 0) throw new Error('no candidates');
    const bound2 = await fresh.bindCandidate(listed2.candidates[0]!.id);
    if (bound2.outcome !== 'success') throw new Error('bind failed');
    const terminal = await fresh.thumbnailCapability(bound2.capability, { maxWidth: 240, maxHeight: 135 });
    expect(terminal.outcome).toBe('success');
    if (terminal.outcome === 'success') expect(terminal.thumbnail?.source).toBe('icon');
  });

  it('028: a minimized member with a DURABLE frame serves real content instead of the terminal icon, across bindings/services', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'));
    const durableFrames = createThumbnailFrameStore({ dir });
    let mode: 'normal' | 'icon' = 'normal';
    const windows: WindowObservation[] = [
      observation({ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\Apps\\a.exe', state: 'normal' }),
    ];
    const factory: WindowHelperFactory = {
      start: async () => 'ready',
      stop: async () => undefined,
      isReady: () => true,
      list: async () => ({ outcome: 'success', windows }),
      observe: async (runtimeId) => {
        const found = windows.find((entry) => entry.runtimeId === runtimeId);
        return found ? { outcome: 'success', observation: found } : { outcome: 'missing', error: 'gone' };
      },
      minimize: async () => ({ outcome: 'missing', error: 'gone' }),
      restore: async () => ({ outcome: 'missing', error: 'gone' }),
      apply: async () => ({ outcome: 'missing', error: 'gone' }),
      close: async () => ({ outcome: 'success' }),
      hover: async () => ({ outcome: 'success', window: null }),
      thumbnail: async (runtimeId, maxWidth = 240, maxHeight = 135) => {
        if (mode === 'icon') return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight, source: 'icon', minimized: true } };
        return { outcome: 'success', thumbnail: { image: pngWithSize(maxWidth, maxHeight), width: maxWidth, height: maxHeight, source: 'capture', minimized: false } };
      },
      get revision() { return 0; },
    };
    const make = (clock: number) => createWindowCapabilityService({ createFactory: () => factory, currentPid: 9999, getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never, durableFrames, now: () => clock });
    async function bind(service: ReturnType<typeof make>) {
      const listed = await service.listCandidates();
      if (listed.outcome !== 'success' || listed.candidates.length === 0) throw new Error('no candidates');
      const bound = await service.bindCandidate(listed.candidates[0]!.id);
      if (bound.outcome !== 'success') throw new Error('bind failed');
      return bound.capability;
    }
    try {
      // Service 1 captures real content while normal (writes the durable frame).
      const service = make(0);
      const capability = await bind(service);
      const real = await service.thumbnailCapability(capability, { maxWidth: 240, maxHeight: 135 });
      expect(real.outcome).toBe('success');
      if (real.outcome === 'success') expect(real.thumbnail?.source).toBe('capture');
      // Service 2 (fresh bindings, empty in-memory caches) hits the terminal
      // icon from the helper, but the DURABLE frame (stable descriptor key)
      // supplies real content instead of the icon.
      mode = 'icon';
      const service2 = make(100000);
      const capability2 = await bind(service2);
      const minimized = await service2.thumbnailCapability(capability2, { maxWidth: 240, maxHeight: 135 });
      expect(minimized.outcome).toBe('success');
      if (minimized.outcome === 'success') expect(minimized.thumbnail?.source).toBe('dwm');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('028: observing a NORMAL member seeds a bounded background frame capture (capture-before-minimize)', async () => {
    const h = thumbnailHarness();
    const capability = await bindA(h.service);
    await h.service.observeCapability(capability);
    // Allow the background seed (a thumbnail capture for the observed binding)
    // to run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.calls.some((call) => call.token === TOKEN_A && call.width === 240)).toBe(true);
  });
});
