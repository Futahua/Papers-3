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
    // Results must satisfy the catalog's declared output shape: the boundary
    // validates what it is about to disclose rather than trusting whatever a
    // dependency returns.
    const window = { windowId: 1, hostAlive: true, nativeWindowAlive: true, enteredBackpackId: null };
    const snapshot = {
      schemaVersion: 1 as const,
      build: { version: '1.3.10', commit: 'abc1234', branch: 'main', builtAt: 'unknown', packaged: false },
      windows: [window],
      hermes: { placement: 'closed' as const, status: 'idle' as const, ownerWindowId: null },
    };
    const dependencies = {
      snapshot: vi.fn(() => snapshot),
      windows: vi.fn(() => [window]),
      createWindow: vi.fn(async () => ({ windowId: 3 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot')))
      .resolves.toEqual(snapshot);
    await expect(dispatchPapersControl(dependencies, request('inspect.windows')))
      .resolves.toEqual([window]);
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

  it('refuses to disclose Hermes error prose, which names the paths it searched', async () => {
    // describeMissingHermes() lists every location Hermes.exe was looked for.
    // That is the right message for the creator and exactly the wrong thing to
    // hand a control client.
    const leaky = {
      schemaVersion: 1 as const,
      build: { version: '1.3.10', commit: 'abc1234', branch: 'main', builtAt: 'unknown', packaged: false },
      windows: [],
      hermes: {
        placement: 'closed' as const,
        status: 'error' as const,
        detail: 'Papers could not find Hermes Desktop...\\n  • C:\\\\Users\\\\secret\\\\HermesAI\\\\Hermes.exe',
        ownerWindowId: null,
      },
    };
    const dependencies = {
      snapshot: vi.fn(() => leaky),
      windows: vi.fn(() => []),
      createWindow: vi.fn(async () => ({ windowId: 1 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot'))).rejects.toThrow();
  });

  it('refuses to disclose a snapshot carrying filesystem roots', async () => {
    // The contract is "no roots". Enforced here rather than trusted: widening
    // the renderer-facing build identity must not silently widen what the
    // control boundary discloses.
    const leaky = {
      schemaVersion: 1 as const,
      build: {
        version: '1.3.10',
        commit: 'abc1234',
        branch: 'main',
        builtAt: 'unknown',
        packaged: false,
        installDir: 'C:\Users\someone\AppData\Local\Papers',
        dataDir: 'C:\Users\someone\AppData\Roaming\Papers',
      },
      windows: [],
      hermes: { placement: 'closed' as const, status: 'idle' as const, ownerWindowId: null },
    };
    const dependencies = {
      snapshot: vi.fn(() => leaky),
      windows: vi.fn(() => []),
      createWindow: vi.fn(async () => ({ windowId: 1 })),
    };

    await expect(dispatchPapersControl(dependencies, request('inspect.snapshot'))).rejects.toThrow();
  });
});
