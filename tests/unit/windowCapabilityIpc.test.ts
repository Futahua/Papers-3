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

/** ONE complete valid PNG byte buffer (signature + IHDR claiming the given
 * dimensions) base64-encoded whole, so the strict IHDR check passes. */
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

function fakeService(): WindowCapabilityService {
  return {
    listCandidates: async () => ({ outcome: 'success', candidates: [] }),
    bindCandidate: async () => ({ outcome: 'missing', error: 'not listed' }),
    observeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    minimizeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    restoreCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    closeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    beginPeekCapability: async () => ({ outcome: 'success' }),
    endPeek: async () => ({ outcome: 'success' }),
    applyCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    thumbnailCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    resolvePersisted: async () => ({ outcome: 'missing', error: 'no match' }),
    hoverAt: async () => ({ outcome: 'success', candidate: null, bounds: null, descriptor: null }),
    pickAt: async () => ({ outcome: 'missing', error: 'changed' }),
    prepareNativePicker: async () => ({ outcome: 'success', seeds: [] }),
    bindNativePickerSelection: async () => ({ outcome: 'success', windows: [] }),
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
      'papers:window-capability:close',
      'papers:window-capability:peek-begin',
      'papers:window-capability:peek-end',
      'papers:window-capability:apply',
      'papers:window-capability:resolve',
      'papers:window-capability:thumbnail',
    ]);
  });

  it('waits for staged authority before running capability operations', async () => {
    const ipc = fakeIpcMain();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const service = fakeService();
    service.listCandidates = async () => {
      calls += 1;
      return { outcome: 'success', candidates: [] };
    };
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service,
      isSender: () => true,
      waitForAuthority: () => gate,
    });

    const pending = ipc.invoke('papers:window-capability:list', 41, undefined);
    await Promise.resolve();
    expect(calls).toBe(0);
    release();
    await expect(pending).resolves.toEqual({ outcome: 'success', candidates: [] });
    expect(calls).toBe(1);
  });

  it('uses native DWM live preview for widget Shift-hover when its trusted host HWND resolves', async () => {
    const ipc = fakeIpcMain();
    const calls: Array<[string, unknown, unknown?]> = [];
    const service = fakeService();
    service.beginLivePreviewCapability = async (input, caller) => {
      calls.push(['begin', input, caller]);
      return { outcome: 'success' };
    };
    service.endLivePreview = async () => {
      calls.push(['end', null]);
      return { outcome: 'success' };
    };
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service,
      isSender: () => true,
      resolveCallerHwnd: () => '424242',
    });

    await expect(ipc.invoke('papers:window-capability:peek-begin', 42, capability)).resolves.toEqual({ outcome: 'success' });
    await expect(ipc.invoke('papers:window-capability:peek-end', 42, {})).resolves.toEqual({ outcome: 'success' });
    expect(calls).toEqual([
      ['begin', capability, '424242'],
      ['end', null],
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
        if (['listCandidates', 'bindCandidate', 'observeCapability', 'minimizeCapability', 'restoreCapability', 'closeCapability', 'applyCapability', 'thumbnailCapability', 'resolvePersisted'].includes(name)) {
          return async (...args: unknown[]) => {
            calls.push(name);
            if (name === 'listCandidates') return { outcome: 'success', candidates: [{ id: 'c1', title: 'W', applicationLabel: 'W', icon: null, state: 'normal' }] };
            if (name === 'bindCandidate') return { outcome: 'success', capability, descriptor: { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) } };
            if (name === 'thumbnailCapability') return { outcome: 'success', thumbnail: { image: pngWithSize(240, 135), width: 240, height: 135 } };
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
    const closed = await ipc.invoke('papers:window-capability:close', 42, capability) as { outcome: string };
    expect(closed.outcome).toBe('success');
    const applied = await ipc.invoke('papers:window-capability:apply', 42, { capability, bounds: { x: 1, y: 2, width: 300, height: 200 } }) as { outcome: string };
    expect(applied.outcome).toBe('success');
    const resolved = await ipc.invoke('papers:window-capability:resolve', 42, { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) });
    expect(resolved).toEqual({ outcome: 'missing', error: 'no match' });
    const thumbImage = pngWithSize(240, 135);
    const thumb = await ipc.invoke('papers:window-capability:thumbnail', 42, {
      capability,
      options: { maxWidth: 240, maxHeight: 135 },
    }) as { outcome: string; imageUrl?: string; width?: number; height?: number };
    expect(thumb.outcome).toBe('success');
    expect(thumb.imageUrl).toBe(`data:image/png;base64,${thumbImage}`);
    expect(thumb.width).toBe(240);
    expect(thumb.height).toBe(135);
    expect(calls).toEqual([
      'listCandidates', 'bindCandidate', 'observeCapability', 'minimizeCapability',
      'restoreCapability', 'closeCapability', 'applyCapability', 'resolvePersisted', 'thumbnailCapability',
    ]);
  });

  it('enforces the exact 019G thumbnail input shape and dimension bounds', async () => {
    const ipc = fakeIpcMain();
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service: fakeService(), isSender: () => true });

    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability })).rejects.toThrow('exactly capability and options');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 240, maxHeight: 135 }, extra: 'x' })).rejects.toThrow('exactly capability and options');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability: { version: 1, bindingId: 123 }, options: { maxWidth: 240, maxHeight: 135 } })).rejects.toThrow('bindingId');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 321, maxHeight: 135 } })).rejects.toThrow('maxWidth');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 240, maxHeight: 181 } })).rejects.toThrow('maxHeight');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 0, maxHeight: 135 } })).rejects.toThrow('maxWidth');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 240.5, maxHeight: 135 } })).rejects.toThrow('maxWidth');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: '240', maxHeight: 135 } })).rejects.toThrow('maxWidth');
    await expect(ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 240, maxHeight: 135, zoom: 2 } })).rejects.toThrow('unknown fields');
    // Absent options default to 240x135 (the service applies the default).
    await ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: {} });
    await ipc.invoke('papers:window-capability:thumbnail', 42, { capability, options: { maxWidth: 240 } });
  });

  it('maps typed fallback outcomes to payload-free page results (019G)', async () => {
    const ipc = fakeIpcMain();
    const fallbacks = [
      { outcome: 'minimized', error: 'window is minimized' },
      { outcome: 'missing', error: 'gone' },
      { outcome: 'denied', error: 'PrintWindow is not supported' },
      { outcome: 'helper-unavailable', error: 'window helper is unavailable' },
    ] as const;
    let index = 0;
    const service = new Proxy(fakeService(), {
      get(target, property) {
        if (property === 'thumbnailCapability') {
          return async () => fallbacks[index++ % fallbacks.length];
        }
        return Reflect.get(target, property);
      },
    });
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });
    const raw = { capability, options: { maxWidth: 240, maxHeight: 135 } };
    const first = await ipc.invoke('papers:window-capability:thumbnail', 42, raw) as { outcome: string; error?: string };
    expect(first).toEqual({ outcome: 'minimized', error: 'window is minimized' });
    expect(first).not.toHaveProperty('imageUrl');
    const second = await ipc.invoke('papers:window-capability:thumbnail', 42, raw) as { outcome: string };
    expect(second).toEqual({ outcome: 'missing', error: 'gone' });
    const third = await ipc.invoke('papers:window-capability:thumbnail', 42, raw) as { outcome: string };
    expect(third).toEqual({ outcome: 'denied', error: 'PrintWindow is not supported' });
  });

  it('bounds a page-facing fallback error to 256 UTF-8 bytes without splitting multibyte chars (019GR3)', async () => {
    const ipc = fakeIpcMain();
    // 300 'é' = 600 UTF-8 bytes: must be truncated to <= 256 whole characters,
    // and a long ASCII string must be truncated too.
    const multibyte = 'é'.repeat(300);
    const ascii = 'x'.repeat(400);
    const calls: string[] = [];
    const service = new Proxy(fakeService(), {
      get(target, property) {
        if (property === 'thumbnailCapability') {
          return async () => {
            const error = calls.length === 0 ? multibyte : ascii;
            calls.push('thumbnail');
            return { outcome: 'denied', error };
          };
        }
        return Reflect.get(target, property);
      },
    });
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });
    const raw = { capability, options: { maxWidth: 240, maxHeight: 135 } };
    const first = await ipc.invoke('papers:window-capability:thumbnail', 42, raw) as { outcome: string; error?: string };
    expect(first.outcome).toBe('denied');
    expect(first.error).toBeDefined();
    expect(Buffer.byteLength(first.error!, 'utf8')).toBeLessThanOrEqual(256);
    // No multibyte character is ever split: the result must be a prefix of
    // whole 'é' characters.
    expect(/^é*$/.test(first.error!)).toBe(true);
    const second = await ipc.invoke('papers:window-capability:thumbnail', 42, raw) as { outcome: string; error?: string };
    expect(second.outcome).toBe('denied');
    expect(Buffer.byteLength(second.error!, 'utf8')).toBe(256);
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
