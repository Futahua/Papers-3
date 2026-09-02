import { describe, expect, it, vi } from 'vitest';

import {
  installVisualDiagnosticListeners,
  VISUAL_RENDERER_DIAGNOSTIC_CHANNEL,
} from '../../src/preload/visualDiagnostics';

describe('opt-in main-world visual failure listeners', () => {
  it('exposes and installs the observer through the main-world bridge', () => {
    const mainWorld = { exposeInMainWorld: vi.fn() };
    installVisualDiagnosticListeners({ send: vi.fn() }, mainWorld);
    expect(mainWorld.exposeInMainWorld).toHaveBeenCalledOnce();
  });

  it('forwards only bounded failure kind/message payloads', () => {
    const send = vi.fn();
    const mainWorld = { exposeInMainWorld: vi.fn() };
    installVisualDiagnosticListeners({ send }, mainWorld);
    const api = mainWorld.exposeInMainWorld.mock.calls[0]?.[1] as { report(kind: string, message: string): void };

    api.report('uncaught-error', 'view failed');
    api.report('unhandled-rejection', 'promise failed');
    api.report('other', 'ignored');

    expect(send).toHaveBeenNthCalledWith(1, VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'uncaught-error', message: 'view failed',
    });
    expect(send).toHaveBeenNthCalledWith(2, VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'unhandled-rejection', message: 'promise failed',
    });
  });
});
