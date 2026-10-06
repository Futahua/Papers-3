import { describe, expect, it, vi } from 'vitest';

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
    windowLifecycleSnapshot: async () => ({ snapshot: { complete: true, trackerSessionId: 'test-session', sequence: 0, windows: [] } }),
    resolveWindowInstance: async () => ({ outcome: 'missing', error: 'gone' }),
    watchWindowLifecycle: () => () => undefined,
    holdWindowLifecycleRefresh: () => ({ release: () => undefined, drained: Promise.resolve() }),
    bindCandidate: async () => ({ outcome: 'missing', error: 'not listed' }),
    observeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    minimizeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    activateCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    observeInstances: async () => new Map(),
    restoreCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    toggleCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    closeCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    endProcessCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    beginPeekCapability: async () => ({ outcome: 'success' }),
    endPeek: async () => ({ outcome: 'success' }),
    applyCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    thumbnailCapability: async () => ({ outcome: 'missing', error: 'gone' }),
    cachedThumbnailCapability: async () => ({ outcome: 'cache-miss' }),
    resolvePersisted: async () => ({ outcome: 'missing', error: 'no match' }),
    hoverAt: async () => ({ outcome: 'success', candidate: null, bounds: null, descriptor: null }),
    pickAt: async () => ({ outcome: 'missing', error: 'changed' }),
    prepareNativePicker: async () => ({ outcome: 'success', seeds: [], seededIndices: [] }),
    bindNativePickerSelection: async () => ({ outcome: 'success', windows: [] }),
    stop: async () => undefined,
  };
}

/** Fake ipcMain capturing registered handlers so the test can drive them
 * with arbitrary events. */
function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
  const sent: Array<{ senderId: number; channel: string; payload: unknown }> = [];
  return {
    ipcMain: {
      handle(channel: string, fn: (event: never, raw: unknown) => Promise<unknown>) {
        handlers.set(channel, fn as (event: unknown, raw: unknown) => Promise<unknown>);
      },
    },
    invoke(channel: string, senderId: number, raw: unknown) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler({
      sender: {
        id: senderId,
        // The control sync resolves the sending surface, which needs a URL; other
        // channels never look at it.
        getURL: () => 'papers-project://as-you-go/index.html',
        once: () => undefined,
        isDestroyed: () => false,
        send: (sentChannel: string, payload: unknown) => { sent.push({ senderId, channel: sentChannel, payload }); },
      },
    }, raw);
    },
    channels: () => [...handlers.keys()],
    sent,
  };
}

const capability = { version: 1 as const, bindingId: 'wl-binding-test' };

describe('windowCapabilityIpc', () => {
  it('registers exactly the enumerated channels', () => {
    const ipc = fakeIpcMain();
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service: fakeService(), isSender: () => true });
    expect(ipc.channels()).toEqual([
      'papers:window-capability:list',
      'papers:window-capability:lifecycle-snapshot',
      'papers:window-capability:resolve-instance',
      'papers:window-layout:diagnostic',
      'papers:window-capability:subscribe-lifecycle',
      'papers:window-capability:bind',
      'papers:window-control:sync',
      'papers:window-control:activate',
      'papers:window-control:group',
      'papers:window-capability:observe',
      'papers:window-capability:minimize',
      'papers:window-capability:toggle',
      'papers:window-capability:activate',
      'papers:window-capability:restore',
      'papers:window-capability:close',
      'papers:window-capability:end-process',
      'papers:window-capability:peek-begin',
      'papers:window-capability:peek-end',
      'papers:window-capability:apply',
      'papers:window-capability:preview-show',
      'papers:window-capability:preview-hide',
      'papers:window-capability:resolve',
      'papers:window-capability:preview-hold',
      'papers:window-capability:preview-release',
      'papers:window-capability:thumbnail',
      'papers:window-capability:thumbnail-cache',
    ]);
  });

  it('records only allowlisted auto-add stages and outcomes without member identity', async () => {
    const ipc = fakeIpcMain();
    const records: Array<Record<string, unknown>> = [];
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service: fakeService(),
      isSender: () => true,
      diagnosticJournal: { record: (entry) => records.push(entry) },
    });

    await expect(ipc.invoke('papers:window-layout:diagnostic', 42, {
      stage: 'auto-add-resolve', outcome: 'ambiguous',
    })).resolves.toEqual({ outcome: 'success' });
    expect(records).toEqual([{
      kind: 'auto-add', detail: 'auto-add-resolve', outcome: 'ambiguous',
    }]);
    await expect(ipc.invoke('papers:window-layout:diagnostic', 42, {
      stage: 'auto-add-resolve', outcome: 'failed', memberId: 'private',
    })).rejects.toThrow('window layout diagnostic is malformed');
    await expect(ipc.invoke('papers:window-layout:diagnostic', 42, {
      stage: 'arbitrary', outcome: 'failed',
    })).rejects.toThrow('window layout diagnostic is malformed');
    expect(records).toHaveLength(1);
  });

  it('records lifecycle delivery and Peek outcomes without sender or window identifiers', async () => {
    const ipc = fakeIpcMain();
    const records: Array<Record<string, unknown>> = [];
    const service = fakeService();
    service.watchWindowLifecycle = (callbacks) => {
      callbacks.onBaseline({ complete: true, trackerSessionId: 'private-session', sequence: 1, windows: [] });
      return () => undefined;
    };
    service.beginLivePreviewCapability = async () => ({ outcome: 'timeout', error: 'private error' });
    service.endLivePreview = async () => ({ outcome: 'success' });
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service,
      isSender: () => true,
      resolveCallerHwnd: () => '12345',
      diagnosticJournal: { record: (entry) => records.push(entry) },
    });

    await ipc.invoke('papers:window-capability:subscribe-lifecycle', 42, {});
    expect(ipc.sent).toContainEqual(expect.objectContaining({ channel: 'papers:window-lifecycle:baseline' }));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lifecycle-delivery', detail: 'baseline', outcome: 'sent' }),
      expect.objectContaining({ kind: 'lifecycle-subscribe', detail: 'accepted', outcome: 'success' }),
    ]));

    await expect(ipc.invoke('papers:window-capability:peek-begin', 42, capability)).resolves.toEqual({ outcome: 'timeout', error: 'private error' });
    await expect(ipc.invoke('papers:window-capability:peek-end', 42, {})).resolves.toEqual({ outcome: 'success' });
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'peek-begin', detail: expect.stringMatching(/^live \d+ms$/), outcome: 'timeout' }),
    ]));
    expect(records.some((record) => record['kind'] === 'peek-end' && record['outcome'] === 'success')).toBe(false);
    expect(JSON.stringify(records)).not.toContain('private-session');
    expect(JSON.stringify(records)).not.toContain('12345');
    expect(JSON.stringify(records)).not.toContain('private error');
  });

  it('records broker Shift delivery without serializing project or member identifiers', async () => {
    const ipc = fakeIpcMain();
    const records: Array<Record<string, unknown>> = [];
    const shifts: Array<(held: boolean) => void> = [];
    const broker = {
      ready: true,
      sessionId: 'private-session',
      register: async () => true,
      clear: () => undefined,
      group: () => true,
      onEvent: () => () => undefined,
      onShift: (callback: (held: boolean) => void) => { shifts.push(callback); return () => undefined; },
      stop: () => undefined,
    };
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service: fakeService(),
      isSender: () => true,
      controlBroker: broker as never,
      resolveControlSurface: () => ({ ownerHwnd: 999, hit: { x: 0, y: 0, width: 10, height: 10 } }),
      diagnosticJournal: { record: (entry) => records.push(entry) },
      controlSenderForId: (senderId) => ({
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => { ipc.sent.push({ senderId, channel, payload }); },
      } as never),
    });
    await ipc.invoke('papers:window-control:sync', 42, []);
    shifts[0]?.(true);
    expect(records).toEqual([expect.objectContaining({
      kind: 'shift-delivery', detail: 'held', outcome: '1sent/0failed',
    })]);
    expect(ipc.sent).toContainEqual({ senderId: 42, channel: 'papers:window-control:shift', payload: true });
    expect(JSON.stringify(records)).not.toContain('private-session');
    expect(JSON.stringify(records)).not.toContain('layoutId');
  });

  it('does not treat an unchanged rectangle as the same window identity', async () => {
    // Readiness used to be answered whenever SOME registration existed and the
    // geometry was unchanged. The same member with the same rectangle can point at a
    // DIFFERENT native window, and the old short-circuit would have kept it ready
    // against a slot the broker ACKed for the previous one. Identity decides now.
    const ipc = fakeIpcMain();
    const service = fakeService();
    const observed = {
      windowInstanceId: 'W0000000000000001',
      runtimeId: 'R1', processId: 1234, processStartTicks: '1', windowClass: 'Chrome_WidgetWin_1',
      handle: 555, bounds: { x: 10, y: 10, width: 100, height: 100 }, state: 'normal',
    } as never;
    service.observeInstances = async (ids: string[]) => {
      const map = new Map<string, never>();
      for (const id of ids) map.set(id, observed);
      return map as never;
    };
    const registrations: unknown[] = [];
    const broker = {
      ready: true,
      sessionId: 'broker-1',
      register: async (slot: unknown) => { registrations.push(slot); return true; },
      clear: () => undefined,
      group: () => true,
      onEvent: () => () => undefined,
      onShift: () => () => undefined,
      stop: () => undefined,
    };
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service,
      isSender: () => true,
      controlBroker: broker as never,
      resolveControlSurface: () => ({ ownerHwnd: 999, hit: { x: 0, y: 0, width: 10, height: 10 } }),
    });
    const rect = { x: 1, y: 1, width: 10, height: 10 };
    const descriptor = { version: 1, title: 'A', executableFingerprint: 'a'.repeat(64), windowInstanceId: 'W0000000000000001' };
    const first = await ipc.invoke('papers:window-control:sync', 41, [
      { layoutId: 'L', memberId: 'M', descriptor, rect, restore: rect },
    ]);
    expect((first as { outcome: string }).outcome).toBe('success');
    // The registration is background work; give it a turn to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registrations.length).toBeGreaterThan(0);

    // Same member, same rectangle, a DIFFERENT native window identity.
    const other = { ...descriptor, windowInstanceId: 'W0000000000000002' };
    const second = await ipc.invoke('papers:window-control:sync', 41, [
      { layoutId: 'L', memberId: 'M', descriptor: other, rect, restore: rect },
    ]);
    const results = (second as { results?: Array<{ ready: boolean }> }).results ?? [];
    expect(results.length).toBe(1);
    // It must NOT be answered ready from the previous identity's registration.
    expect(results[0]!.ready).toBe(false);
  });
  it('answers document-neutral window lookup/observation without waiting for write authority', async () => {
    // The compact widget is not the writer, so waiting for document-write
    // authority parked its descriptor resolution forever - and a surface that
    // only needs to LOOK was starved. That starvation left the native control
    // broker with no slots at all. Reads answer; mutations still wait.
    const ipc = fakeIpcMain();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let listCalls = 0;
    let bindCalls = 0;
    let observeCalls = 0;
    let minimizeCalls = 0;
    const service = fakeService();
    service.listCandidates = async () => {
      listCalls += 1;
      return { outcome: 'success', candidates: [] };
    };
    service.bindCandidate = async () => {
      bindCalls += 1;
      return { outcome: 'success', capability, descriptor: {
        version: 1, title: 'Window', executableFingerprint: 'a'.repeat(64),
      } };
    };
    service.observeCapability = async () => {
      observeCalls += 1;
      return { outcome: 'success', observation: {
        runtimeId: 'R1' as RuntimeWindowId,
        processId: 1,
        processStartTicks: '1',
        windowClass: 'Test',
        handle: 1,
        title: 'Window',
        processPath: 'C:\\Test\\window.exe',
        bounds: { x: 1, y: 1, width: 100, height: 100 },
        state: 'normal',
      } };
    };
    service.minimizeCapability = async () => {
      minimizeCalls += 1;
      return { outcome: 'success' };
    };
    registerWindowCapabilityIpc({
      ipcMain: ipc.ipcMain,
      service,
      isSender: () => true,
      waitForAuthority: () => gate,
    });

    // A read answers immediately, with the authority gate still closed.
    await expect(ipc.invoke('papers:window-capability:list', 41, undefined))
      .resolves.toEqual({ outcome: 'success', candidates: [] });
    expect(listCalls).toBe(1);
    await expect(ipc.invoke('papers:window-capability:bind', 41, 'candidate-1'))
      .resolves.toEqual(expect.objectContaining({ outcome: 'success', capability }));
    expect(bindCalls).toBe(1);
    await expect(ipc.invoke('papers:window-capability:observe', 41, capability))
      .resolves.toEqual(expect.objectContaining({ outcome: 'success' }));
    expect(observeCalls).toBe(1);

    // A mutation still waits for the gate.
    const pending = ipc.invoke('papers:window-capability:minimize', 41, { version: 1, bindingId: 'binding-1' });
    await Promise.resolve();
    expect(minimizeCalls).toBe(0);
    release();
    await expect(pending).resolves.toEqual({ outcome: 'success' });
    expect(minimizeCalls).toBe(1);
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
  it('refuses late peek requests from a hidden widget without falling back',async()=>{
    const ipc=fakeIpcMain();const service=fakeService();
    service.beginLivePreviewCapability=vi.fn(async()=>({outcome:'success' as const}));
    service.beginPeekCapability=vi.fn(async()=>({outcome:'success' as const}));
    registerWindowCapabilityIpc({ipcMain:ipc.ipcMain,service,isSender:()=>true,resolveCallerHwnd:()=> '424242',canBeginPeek:()=>false});
    expect((await ipc.invoke('papers:window-capability:peek-begin',42,capability) as {outcome:string}).outcome).toBe('denied');
    expect(service.beginLivePreviewCapability).not.toHaveBeenCalled();expect(service.beginPeekCapability).not.toHaveBeenCalled();
  });

  it('uses reversible Peek when the host withholds an unsafe live-preview caller', async () => {
    const ipc = fakeIpcMain();
    const service = fakeService();
    const calls: string[] = [];
    service.beginLivePreviewCapability = async () => { calls.push('live'); return { outcome: 'success' }; };
    service.endLivePreview = async () => { calls.push('live-end'); return { outcome: 'success' }; };
    service.beginPeekCapability = async () => { calls.push('peek'); return { outcome: 'success' }; };
    service.endPeek = async () => { calls.push('peek-end'); return { outcome: 'success' }; };
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true, resolveCallerHwnd: () => null });
    await ipc.invoke('papers:window-capability:peek-begin', 42, capability);
    await ipc.invoke('papers:window-capability:peek-end', 42, {});
    expect(calls).toEqual(['peek', 'peek-end']);
  });

  it('keeps DWM release armed after a failed begin/end so a later cleanup can retry', async () => {
    const ipc = fakeIpcMain();
    const calls: string[] = [];
    const service = fakeService();
    service.beginLivePreviewCapability = async () => { calls.push('begin'); return { outcome: 'timeout' }; };
    let endings = 0;
    service.endLivePreview = async () => {
      calls.push('end');
      endings += 1;
      return endings === 1 ? { outcome: 'helper-unavailable' } : { outcome: 'success' };
    };
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true, resolveCallerHwnd: () => '424242' });
    await expect(ipc.invoke('papers:window-capability:peek-begin', 42, capability)).resolves.toEqual({ outcome: 'timeout' });
    await expect(ipc.invoke('papers:window-capability:peek-end', 42, {})).resolves.toEqual({ outcome: 'helper-unavailable' });
    await expect(ipc.invoke('papers:window-capability:peek-end', 42, {})).resolves.toEqual({ outcome: 'success' });
    expect(calls).toEqual(['begin', 'end', 'end']);
  });

  it('forwards exact-icon candidate list options and rejects malformed flags', async () => {
    const ipc = fakeIpcMain();
    const service = fakeService();
    let options: unknown;
    service.listCandidates = async (value) => { options = value; return { outcome: 'success', candidates: [] }; };
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });
    await ipc.invoke('papers:window-capability:list', 42, { includeNativeIcons: true });
    expect(options).toEqual({ includeNativeIcons: true });
    await expect(ipc.invoke('papers:window-capability:list', 42, { includeNativeIcons: 'yes' })).rejects.toThrow('boolean');
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
        if (['listCandidates', 'bindCandidate', 'observeCapability', 'minimizeCapability', 'restoreCapability', 'closeCapability', 'endProcessCapability', 'applyCapability', 'thumbnailCapability', 'resolvePersisted'].includes(name)) {
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
    const ended = await ipc.invoke('papers:window-capability:end-process', 42, capability) as { outcome: string };
    expect(ended.outcome).toBe('success');
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
      'restoreCapability', 'closeCapability', 'endProcessCapability', 'applyCapability', 'resolvePersisted', 'thumbnailCapability',
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

  it('reads a cached thumbnail with only a live capability and exposes cache-miss without an image', async () => {
    const ipc = fakeIpcMain();
    const image = pngWithSize(120, 68);
    let cached: Awaited<ReturnType<WindowCapabilityService['cachedThumbnailCapability']>> = {
      outcome: 'success', thumbnail: { image, width: 120, height: 68 },
    };
    const service = new Proxy(fakeService(), {
      get(target, property) {
        if (property === 'cachedThumbnailCapability') return async () => cached;
        return Reflect.get(target, property);
      },
    });
    registerWindowCapabilityIpc({ ipcMain: ipc.ipcMain, service, isSender: () => true });
    expect(await ipc.invoke('papers:window-capability:thumbnail-cache', 42, { capability })).toEqual({
      outcome: 'success', imageUrl: `data:image/png;base64,${image}`, width: 120, height: 68,
    });
    cached = { outcome: 'cache-miss' };
    expect(await ipc.invoke('papers:window-capability:thumbnail-cache', 42, { capability })).toEqual({ outcome: 'cache-miss' });
    await expect(ipc.invoke('papers:window-capability:thumbnail-cache', 42, { capability, extra: true }))
      .rejects.toThrow('exactly capability');
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
