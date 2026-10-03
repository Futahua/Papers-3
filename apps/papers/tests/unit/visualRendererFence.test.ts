import { describe, expect, it, vi } from 'vitest';

import { createVisualRendererFenceService } from '../../src/main/visual/visualRendererFence';

describe('fixed renderer visual fence', () => {
  it('correlates a response to the requesting WebContents', async () => {
    let receive: ((event: { sender: { id: number } }, payload: unknown) => void) | undefined;
    const ipcMain = { on: vi.fn((_channel: string, listener: typeof receive) => { receive = listener; }) };
    const service = createVisualRendererFenceService(ipcMain as never);
    const contents = {
      id: 42,
      isDestroyed: () => false,
      send: vi.fn((_channel: string, payload: { requestId: string; documentInstanceId: string }) => {
        receive?.({ sender: { id: 42 } }, { requestId: payload.requestId, documentInstanceId: payload.documentInstanceId, ready: true });
      }),
    };

    await expect(service.request(contents as never, 'request-1', '33333333-3333-4333-8333-333333333333', 100)).resolves.toBe(true);
    expect(contents.send).toHaveBeenCalledWith('papers:visual:fence-request', { requestId: 'request-1', documentInstanceId: '33333333-3333-4333-8333-333333333333' });
  });

  it('ignores a foreign sender and times out without throwing', async () => {
    let receive: ((event: { sender: { id: number } }, payload: unknown) => void) | undefined;
    const ipcMain = { on: (_channel: string, listener: typeof receive) => { receive = listener; } };
    const service = createVisualRendererFenceService(ipcMain as never);
    const contents = {
      id: 42,
      isDestroyed: () => false,
      send: vi.fn((_channel: string, payload: { requestId: string; documentInstanceId: string }) => {
        receive?.({ sender: { id: 99 } }, { requestId: payload.requestId, documentInstanceId: payload.documentInstanceId, ready: true });
      }),
    };

    await expect(service.request(contents as never, 'request-2', '33333333-3333-4333-8333-333333333333', 10)).resolves.toBe(false);
  });
});
