import { describe, expect, it, vi } from 'vitest';

import { registerPapersWindowIpc } from '../../src/main/ipc/papersWindowIpc';

function harness() {
  let handler: ((event: { sender: object }) => Promise<unknown>) | undefined;
  const ipcMain = { handle: vi.fn((_channel: string, current: typeof handler) => { handler = current; }) };
  return { ipcMain, getHandler: () => handler! };
}

describe('Papers window IPC', () => {
  it('creates a secondary window only for a trusted host sender', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => ({ window: { id: 22 } }));
    registerPapersWindowIpc({ ipcMain: h.ipcMain, isHostSender: () => true, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).resolves.toEqual({ windowId: 22 });
    expect(createAdditionalWindow).toHaveBeenCalledTimes(1);
  });

  it('rejects non-host senders before constructing a window', async () => {
    const h = harness();
    const createAdditionalWindow = vi.fn(async () => ({ window: { id: 22 } }));
    registerPapersWindowIpc({ ipcMain: h.ipcMain, isHostSender: () => false, createAdditionalWindow });

    await expect(h.getHandler()({ sender: {} })).rejects.toThrow('non-host sender');
    expect(createAdditionalWindow).not.toHaveBeenCalled();
  });
});
