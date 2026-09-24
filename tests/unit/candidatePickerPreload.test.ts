import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { send: mocks.send },
}));

describe('candidate picker preload bridge', () => {
  beforeEach(() => {
    mocks.exposeInMainWorld.mockReset();
    mocks.send.mockReset();
    vi.resetModules();
  });

  it('forwards plain middle-click termination and Ctrl+middle-click close actions', async () => {
    await import('../../src/preload/candidatePicker');
    const api = mocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      signal: (action: string, candidateId?: string) => void;
    } | undefined;

    expect(api).toBeDefined();
    api?.signal('terminate', 'window-candidate-1');
    api?.signal('close', 'window-candidate-2');

    expect(mocks.send.mock.calls).toEqual([
      ['papers:candidate-picker:signal', { action: 'terminate', candidateId: 'window-candidate-1' }],
      ['papers:candidate-picker:signal', { action: 'close', candidateId: 'window-candidate-2' }],
    ]);
  });

  it('keeps unknown actions and oversized candidate identities out of IPC', async () => {
    await import('../../src/preload/candidatePicker');
    const api = mocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      signal: (action: string, candidateId?: string) => void;
    } | undefined;

    api?.signal('arbitrary-action', 'window-candidate-1');
    api?.signal('terminate', 'x'.repeat(513));

    expect(mocks.send).not.toHaveBeenCalled();
  });
});
