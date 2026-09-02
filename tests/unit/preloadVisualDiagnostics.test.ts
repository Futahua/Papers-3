import { describe, expect, it, vi } from 'vitest';

import {
  installVisualDiagnosticListeners,
  VISUAL_RENDERER_DIAGNOSTIC_CHANNEL,
} from '../../src/preload/visualDiagnostics';

describe('opt-in preload visual failure listeners', () => {
  it('does not install listeners unless visual diagnostics are enabled', () => {
    const target = { addEventListener: vi.fn() };
    installVisualDiagnosticListeners({ send: vi.fn() }, false, target);
    expect(target.addEventListener).not.toHaveBeenCalled();
  });

  it('forwards only bounded failure kind/message payloads', () => {
    const target = { addEventListener: vi.fn() };
    const send = vi.fn();
    installVisualDiagnosticListeners({ send }, true, target);
    const errorListener = target.addEventListener.mock.calls.find(([type]) => type === 'error')?.[1];
    const rejectionListener = target.addEventListener.mock.calls.find(([type]) => type === 'unhandledrejection')?.[1];

    errorListener?.({ message: 'view failed', error: new Error('ignored stack') });
    rejectionListener?.({ reason: { message: 'promise failed' } });

    expect(send).toHaveBeenNthCalledWith(1, VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'uncaught-error', message: 'view failed',
    });
    expect(send).toHaveBeenNthCalledWith(2, VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'unhandled-rejection', message: 'promise failed',
    });
  });
});
