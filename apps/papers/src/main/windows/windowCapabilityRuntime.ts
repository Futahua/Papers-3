import {
  registerWindowCapabilityIpc,
  type WindowCapabilityIpcDependencies,
} from '../ipc/windowCapabilityIpc';
import {
  createWindowCapabilityService,
  type WindowCapabilityService,
  type WindowCapabilityServiceOptions,
} from './windowCapabilityService';
import {
  createWindowControlBroker,
  type WindowControlBroker,
} from './windowControlBroker';

export interface WindowCapabilityRuntimeOptions {
  serviceOptions?: WindowCapabilityServiceOptions;
  brokerOptions: Parameters<typeof createWindowControlBroker>[0];
  ipc: Omit<WindowCapabilityIpcDependencies, 'service' | 'controlBroker'>;
  /** Private construction seam for unit tests. */
  factories?: {
    createService?: (options?: WindowCapabilityServiceOptions) => WindowCapabilityService;
    createBroker?: (options: Parameters<typeof createWindowControlBroker>[0]) => WindowControlBroker;
    registerIpc?: (dependencies: WindowCapabilityIpcDependencies) => void;
  };
}

/**
 * One owner for Papers' window-capability runtime.
 *
 * The resident native broker is an implementation detail of this capability,
 * not a second authority that callers coordinate independently. Product callers
 * receive the semantic WindowCapabilityService; IPC registration and teardown
 * are owned here.
 */
export function createWindowCapabilityRuntime(options: WindowCapabilityRuntimeOptions) {
  const createService = options.factories?.createService ?? createWindowCapabilityService;
  const createBroker = options.factories?.createBroker ?? createWindowControlBroker;
  const registerIpc = options.factories?.registerIpc ?? registerWindowCapabilityIpc;

  const service = createService(options.serviceOptions);
  const broker = createBroker(options.brokerOptions);
  registerIpc({
    ...options.ipc,
    service,
    controlBroker: broker,
  });

  let stopped = false;
  return {
    service,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await Promise.all([
        service.stop(),
        Promise.resolve(broker.stop()),
      ]);
    },
  };
}

export type WindowCapabilityRuntime = ReturnType<typeof createWindowCapabilityRuntime>;
