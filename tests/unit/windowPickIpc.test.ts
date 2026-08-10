import { describe, expect, it, vi } from 'vitest';

import { registerWindowPickIpc } from '../../src/main/ipc/windowPickIpc';
import type { WindowPickSession } from '../../src/main/windows/windowPickSession';

function fakeSession(): WindowPickSession & { calls: unknown[]; results: Array<(r: unknown) => void> } {
  const calls: unknown[] = [];
  const results: Array<(r: unknown) => void> = [];
  return {
    calls,
    results,
    active: false,
    begin: async (options: { memberDescriptors: unknown[]; onResult: (r: unknown) => void }) => {
      calls.push(options);
      results.push(options.onResult);
      return { outcome: 'started' as const };
    },
    cancel: async () => undefined,
  } as unknown as WindowPickSession & { calls: unknown[]; results: Array<(r: unknown) => void> };
}

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
      return handler({ sender: { id: senderId, isDestroyed: () => false, send: vi.fn() } }, raw);
    },
  };
}

const DESCRIPTOR = { version: 1, title: 'Window A', executableFingerprint: 'a'.repeat(64) };

describe('window pick IPC', () => {
  it('begin validates exact keys, bounded members and strict descriptors', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const session = fakeSession();
    registerWindowPickIpc({ ipcMain, session, isSender: () => true });

    await expect(invoke('papers:window-pick:begin', 1, { members: [DESCRIPTOR], extra: 1 })).rejects.toThrow('unknown fields');
    await expect(invoke('papers:window-pick:begin', 1, { members: [{ ...DESCRIPTOR, title: 5 }] })).rejects.toThrow(/member descriptor|bounded non-empty string/);
    const many = Array.from({ length: 33 }, () => DESCRIPTOR);
    await expect(invoke('papers:window-pick:begin', 1, { members: many })).rejects.toThrow('exceeds the bound');
    await expect(invoke('papers:window-pick:begin', 1, { members: [{ version: 2, title: 'x', executableFingerprint: 'a'.repeat(64) }] })).rejects.toThrow('unsupported');
    await expect(invoke('papers:window-pick:begin', 1, { members: [{ version: 1, title: 'x', executableFingerprint: 'zz' }] })).rejects.toThrow('invalid');

    const ok = await invoke('papers:window-pick:begin', 1, { members: [DESCRIPTOR] });
    expect(ok).toEqual({ outcome: 'started' });
  });

  it('denies non-Backpack senders', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowPickIpc({ ipcMain, session: fakeSession(), isSender: () => false });
    await expect(invoke('papers:window-pick:begin', 1, { members: [] })).rejects.toThrow('not a Backpack project sender');
    await expect(invoke('papers:window-pick:cancel', 1, {})).rejects.toThrow('not a Backpack project sender');
  });

  it('cancel requires an empty payload', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerWindowPickIpc({ ipcMain, session: fakeSession(), isSender: () => true });
    await expect(invoke('papers:window-pick:cancel', 1, { x: 1 })).rejects.toThrow('must be empty');
    const ok = await invoke('papers:window-pick:cancel', 1, {});
    expect(ok).toEqual({ outcome: 'cancelled' });
  });

  it('bounds member strings by UTF-8 BYTES, not JS characters (016R)', async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    const session = fakeSession();
    registerWindowPickIpc({ ipcMain, session, isSender: () => true });

    // 300 multibyte characters = 600 UTF-8 bytes > 512: must be rejected even
    // though the JS string length is under 512.
    const wide = { version: 1, title: 'é'.repeat(300), executableFingerprint: 'a'.repeat(64) };
    await expect(invoke('papers:window-pick:begin', 1, { members: [wide] }))
      .rejects.toThrow(/bounded non-empty string/);

    // 250 multibyte characters = 500 UTF-8 bytes < 512: must be accepted.
    const okTitle = 'é'.repeat(250);
    const ok = await invoke('papers:window-pick:begin', 1, { members: [{ version: 1, title: okTitle, executableFingerprint: 'b'.repeat(64) }] });
    expect(ok).toEqual({ outcome: 'started' });
    const stored = (session.calls[0] as { memberDescriptors: Array<{ title: string }> }).memberDescriptors[0];
    expect(stored?.title).toBe(okTitle);

    // A 600-character ASCII title (600 bytes > 512) is also rejected.
    await expect(invoke('papers:window-pick:begin', 1, { members: [{ version: 1, title: 'x'.repeat(600), executableFingerprint: 'c'.repeat(64) }] }))
      .rejects.toThrow(/bounded non-empty string/);
  });
});
