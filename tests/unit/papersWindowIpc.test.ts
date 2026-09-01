import { describe, expect, it, vi } from 'vitest';

import { registerPapersWindowIpc } from '../../src/main/ipc/papersWindowIpc';
import type { PapersWindowIpcDependencies } from '../../src/main/ipc/papersWindowIpc';

function harness() {
  let handler: ((event: { sender: object }) => Promise<unknown>) | undefined;
  const ipcMain = { handle: vi.fn((_channel: string, current: typeof handler) => { handler = current; }) };
  return { ipcMain, getHandler: () => handler! };
}

describe('Papers window IPC', () => {
  it('creates a secondary window only for a trusted host sender', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => true, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('rejects non-host senders before constructing a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    registerPapersWindowIpc({ ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'], isHostSender: () => false, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('non-host sender');
    expect(createAdditionalWindow).not.toHaveBeenCalled();
  });

  it('allows a second legitimate host sender to request a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => undefined);
    const hostSenders = new Set<object>([{}]);
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: (sender) => hostSenders.has(sender),
      createAdditionalWindow,
    });
    const secondHost = {};
    hostSenders.add(secondHost);

    await expect(h.getHandler()({ sender: secondHost })).resolves.toBeUndefined();
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('propagates secondary-window construction failures', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => { throw new Error('construction failed'); });
    registerPapersWindowIpc({
      ipcMain: h.ipcMain as PapersWindowIpcDependencies['ipcMain'],
      isHostSender: () => true,
      createAdditionalWindow,
    });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('construction failed');
  });
});
