import { describe, expect, it } from 'vitest';

import { registerWindowCapabilityIpc } from '../../src/main/ipc/windowCapabilityIpc';
import {
  createWindowCapabilityService,
  type WindowCandidateListResult,
} from '../../src/main/windows/windowCapabilityService';
import type { WindowCapabilityService } from '../../src/main/windows/windowCapabilityService';
import type { WindowHelperFactory } from '../../src/main/windows/windowHelperFactory';
import type { RuntimeWindowId } from '../../src/main/windows/windowCapabilityTypes';

const TOKEN_A = 'Ta'.padEnd(33, 'a');

function fakeService(): WindowCapabilityService {
  return {
    listCandidates: async () => ({ outcome: 'success', candidates: [] }),
    bindCandidate: async () => ({ outcome: 'missing', error: 'not listed' }),
    observeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    minimizeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    restoreCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    applyCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    resolvePersisted: async () => ({ outcome: 'missing', error: 'no match' }),
    hoverAt: async () => ({ outcome: 'success', candidate: null, bounds: null, descriptor: null }),
    pickAt: async () => ({ outcome: 'missing', error: 'changed' }),
    stop: async () => undefined,
  };
}

/** Fake ipcMain capturing registered handlers so the test can drive them
 * with arbitrary events. */
function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle(channel: string, fn: (event: never, raw: unknown) => Promise<unknown>) {
        handlers.set(channel, fn as (event: unknown, raw: unknown) => Promise<unknown>);
      },
    },
    invoke(channel: string, senderId: number, raw: unknown) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler({ sender: { id: senderId } }, raw);
    },
    channels: () => [...handlers.keys()],
  };
}

const capability = { version: 1, bindingId: 'wl-binding-test' };

describe('windowCapabilityIpc', () => {
  it('registers exactly the enumerated channels', () => {
    const ipc = fakeIpcMain();
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service: fakeService(), isSender: () => true });
    expect(ipc.channels()).toEqual([
      'papers:window-capability:list',
      'papers:window-capability:bind',
      'papers:window-capability:observe',
      'papers:window-capability:minimize',
      'papers:window-capability:restore',
      'papers:window-capability:apply',
      'papers:window-capability:resolve',
    ]);
  });

  it('enforces the Backpack project sender gate on every channel', async () => {
    const ipc = fakeIpcMain();
    let calls = 0;
    const service = fakeService();
    const proxied = new Proxy(service, {
      get(target, property) {
        if (property === 'listCandidates') {
          return async () => {
            calls += 1;
            return { outcome: 'success', candidates: [] };
          };
        }
        return Reflect.get(target, property);
      },
    });
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service: proxied,
      isSender: (sender) => sender.id === 42,
    });
    await expect(ipc.invoke('papers:window-capability:list', 1, undefined)).rejects.toThrow('denied');
    expect(calls).toBe(0);
    const result = await ipc.invoke('papers:window-capability:list', 42, undefined);
    expect(result).toEqual({ outcome: 'success', candidates: [] });
    expect(calls).toBe(1);
  });

  it('validates inputs deeply and rejects unknown or malformed fields', async () => {
    const ipc = fakeIpcMain();
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service: fakeService(), isSender: () => true });

    await expect(ipc.invoke('papers:window-capability:bind', 42, '')).rejects.toThrow('bounded');
    await expect(ipc.invoke('papers:window-capability:bind', 42, 'x'.repeat(600))).rejects.toThrow('bounded');
    await expect(ipc.invoke('papers:window-capability:observe', 42, { version: 2, bindingId: 'x' })).rejects.toThrow('version');
    await expect(ipc.invoke('papers:window-capability:observe', 42, { version: 1, bindingId: 123 })).rejects.toThrow('bindingId');
    await expect(ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 0, y: 0, width: 0, height: 10 } })).rejects.toThrow('positive');
    await expect(ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 0, y: 0, width: 1e9, height: 10 } })).rejects.toThrow('range');
    await expect(ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 0, y: 0, width: NaN, height: 10 } })).rejects.toThrow('finite');
    await expect(ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 0, y: 0, width: 10 } })).rejects.toThrow('height');
    await expect(ipc.invoke('papers:window-capability:resolve', 42, { version: 1, title: '', executableFingerprint: 'a'.repeat(64) })).rejects.toThrow('title');
    await expect(ipc.invoke('papers:window-capability:resolve', 42, { version: 1, title: 'x', executableFingerprint: 'bad' })).rejects.toThrow('invalid');
    await expect(ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 0, y: 0, width: 10, height: 10 }, extra: 'command' })).rejects.toThrow('payload');
  });

  it('returns typed bounded outcomes through every channel', async () => {
    const ipc = fakeIpcMain();
    const calls: string[] = [];
    const service = new Proxy(fakeService(), {
      get(target, property) {
        const name = String(property);
        if (['listCandidates', 'bindCandidate', 'observeCapability', 'minimizeCapability', 'restoreCapability', 'applyCapability', 'resolvePersisted'].includes(name)) {
          return async (...args: unknown[]) => {
            calls.push(name);
            if (name === 'listCandidates') return { outcome: 'success', candidates: [{ id: 'c1', title: 'W', applicationLabel: 'W', icon: null, state: 'normal' }] };
            if (name === 'bindCandidate') return { outcome: 'success', capability, descriptor: { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) } };
            if (name === 'resolvePersisted') return { outcome: 'missing', error: 'no match' };
            return { outcome: 'success', observation: null };
          };
        }
        return Reflect.get(target, property);
      },
    });
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });

    const listed = await ipc.invoke('papers:window-capability:list', 42, undefined) as WindowCandidateListResult;
    expect(listed.outcome).toBe('success');
    if (listed.outcome === 'success') expect(listed.candidates[0]!.title).toBe('W');

    const bound = await ipc.invoke('papers:window-capability:bind', 42, 'wl-candidate-1') as { outcome: string; capability?: unknown };
    expect(bound.outcome).toBe('success');
    expect(bound.capability).toMatchObject({ version: 1 });

    const observed = await ipc.invoke('papers:window-capability:observe', 42, capability) as { outcome: string };
    expect(observed.outcome).toBe('success');
    const minimized = await ipc.invoke('papers:window-capability:minimize', 42, capability) as { outcome: string };
    expect(minimized.outcome).toBe('success');
    const restored = await ipc.invoke('papers:window-capability:restore', 42, capability) as { outcome: string };
    expect(restored.outcome).toBe('success');
    const applied = await ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 1, y: 2, width: 300, height: 200 } }) as { outcome: string };
    expect(applied.outcome).toBe('success');
    const resolved = await ipc.invoke('papers:window-capability:resolve', 42, { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) });
    expect(resolved).toEqual({ outcome: 'missing', error: 'no match' });
    expect(calls).toEqual([
      'listCandidates', 'bindCandidate', 'observeCapability', 'minimizeCapability',
      'restoreCapability', 'applyCapability', 'resolvePersisted',
    ]);
  });

  it('composes with the real service over a fake factory end to end', async () => {
    const ipc = fakeIpcMain();
    const factory = {
      start: async () => 'ready' as const,
      stop: async () => undefined,
      isReady: () => true,
      list: async () => ({
        outcome: 'success' as const,
        windows: [{ runtimeId: TOKEN_A as RuntimeWindowId, title: 'Window A', processId: 1001, processPath: 'C:\\a.exe', state: 'normal', bounds: { x: 0, y: 0, width: 100, height: 100 } }],
      }),
      observe: async () => ({ outcome: 'success' as const, observation: null }),
      minimize: async () => ({ outcome: 'success' as const, observation: null }),
      restore: async () => ({ outcome: 'success' as const, observation: null }),
      apply: async () => ({ outcome: 'success' as const, observation: null }),
      close: async () => undefined,
    } as unknown as WindowHelperFactory;
    const service = createWindowCapabilityService({
      createFactory: () => factory,
      currentPid: 9999,
      getFileIcon: async () => ({ toDataURL: () => 'icon' }) as never,
    });
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });

    const listed = await ipc.invoke('papers:window-capability:list', 42, undefined) as WindowCandidateListResult;
    expect(listed.outcome).toBe('success');
    if (listed.outcome !== 'success') return;
    expect(listed.candidates).toHaveLength(1);
    const candidateId = listed.candidates[0]!.id;
    const bound = await ipc.invoke('papers:window-capability:bind', 42, candidateId) as { outcome: string };
    expect(bound.outcome).toBe('success');
  });
});
