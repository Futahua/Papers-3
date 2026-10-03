import { describe, expect, it, vi } from 'vitest';

import type { WindowCapabilityIpcDependencies } from '../../src/main/ipc/windowCapabilityIpc';
import type { WindowCapabilityService } from '../../src/main/windows/windowCapabilityService';
import type { WindowControlBroker } from '../../src/main/windows/windowControlBroker';
import { createWindowCapabilityRuntime } from '../../src/main/windows/windowCapabilityRuntime';

describe('window capability runtime', () => {
  it('owns service + resident broker wiring and exposes only the semantic service', async () => {
    const serviceStop = vi.fn(async () => {});
    const brokerStop = vi.fn();
    const service = { stop: serviceStop } as unknown as WindowCapabilityService;
    const broker = { stop: brokerStop } as unknown as WindowControlBroker;
    const registerIpc = vi.fn<(deps: WindowCapabilityIpcDependencies) => void>();

    const runtime = createWindowCapabilityRuntime({
      brokerOptions: {
        cacheDirectory: 'cache',
        sourcePath: 'window-control.cs',
        onUnavailable: () => {},
      },
      ipc: {
        ipcMain: { handle: vi.fn() },
        isSender: () => true,
      },
      factories: {
        createService: () => service,
        createBroker: () => broker,
        registerIpc,
      },
    });

    expect(runtime.service).toBe(service);
    expect('broker' in runtime).toBe(false);
    expect(registerIpc).toHaveBeenCalledOnce();
    expect(registerIpc.mock.calls[0]![0].service).toBe(service);
    expect(registerIpc.mock.calls[0]![0].controlBroker).toBe(broker);

    await runtime.stop();
    await runtime.stop();
    expect(serviceStop).toHaveBeenCalledOnce();
    expect(brokerStop).toHaveBeenCalledOnce();
  });
});
