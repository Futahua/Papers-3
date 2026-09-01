import { describe, expect, it, vi } from 'vitest';

import {
  controlRequestSchema,
  dispatchPapersControl,
  PAPERS_CONTROL_PROTOCOL_VERSION,
} from '../../src/main/control/papersControlProtocol';

function request(method: 'inspect.snapshot' | 'inspect.windows' | 'window.create', params: unknown = {}) {
  return controlRequestSchema.parse({
    id: 'r1',
    token: 'secret',
    protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
    method,
    params,
  });
}

describe('Papers developer control protocol', () => {
  it('dispatches only the small semantic command catalog', async () => {
    const dependencies = {
      snapshot: vi.fn(() => ({ windows: 2 })),
      windows: vi.fn(() => [{ windowId: 1 }]),
      createWindow: vi.fn(async () => ({ windowId: 3 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot')))
      .resolves.toEqual({ windows: 2 });
    await expect(dispatchPapersControl(dependencies, request('inspect.windows')))
      .resolves.toEqual([{ windowId: 1 }]);
    await expect(dispatchPapersControl(dependencies, request('window.create')))
      .resolves.toEqual({ windowId: 3 });
  });

  it('rejects unknown methods and unexpected parameters', async () => {
    expect(() => controlRequestSchema.parse({
      id: 1,
      token: 'secret',
      protocolVersion: PAPERS_CONTROL_PROTOCOL_VERSION,
      method: 'renderer.executeJavaScript',
      params: {},
    })).toThrow();

    await expect(dispatchPapersControl({
      snapshot: () => ({}),
      windows: () => [],
      createWindow: async () => ({}),
    }, request('window.create', { senderId: 10 }))).rejects.toThrow();
  });
});
