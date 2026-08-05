import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
  webUtils: { getPathForFile: mocks.getPathForFile },
}));

describe('host preload settings bridge', () => {
  beforeEach(() => {
    mocks.exposeInMainWorld.mockClear();
    mocks.invoke.mockReset();
  });

  it('exposes settings methods that reach the matching IPC channels', async () => {
    vi.resetModules();
    await import('../../src/preload/host');

    const exposure = mocks.exposeInMainWorld.mock.calls.at(-1);
    expect(exposure?.[0]).toBe('papersHost');
    const api = exposure?.[1] as {
      settings: {
        get: () => Promise<unknown>;
        setTransparentWindow: (enabled: boolean) => Promise<unknown>;
      };
    };

    await api.settings.get();
    await api.settings.setTransparentWindow(false);

    expect(mocks.invoke.mock.calls).toEqual([
      ['host:settings:get'],
      ['host:settings:set-transparent-window', false],
    ]);
  });
});
