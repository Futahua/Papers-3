import { describe, expect, it, vi } from 'vitest';

import {
  createProjectVisualDiagnosticBridge,
  VISUAL_RENDERER_DIAGNOSTIC_CHANNEL,
  VISUAL_RENDERER_SIGNAL_CHANNEL,
} from '../../src/preload/projectVisualDiagnostics';

describe('opt-in project hydration diagnostic bridge', () => {
  it('forwards bounded hydration success metadata without state bytes', () => {
    const send = vi.fn();
    const bridge = createProjectVisualDiagnosticBridge({ send });

    bridge.reportStateHydrated('rev-42', { cards: 3, groups: 1 });

    expect(send).toHaveBeenCalledWith(VISUAL_RENDERER_SIGNAL_CHANNEL, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-42', summary: { cards: 3, groups: 1 },
    });
  });

  it('forwards bounded hydration failure metadata and refuses unsafe values', () => {
    const send = vi.fn();
    const bridge = createProjectVisualDiagnosticBridge({ send });

    bridge.reportHydrationFailed('rev-42', 'parse', 'invalid-envelope');
    bridge.reportHydrationFailed('C:\\private\\state.json', 'parse', 'bad');
    bridge.reportHydrationFailed(undefined, 'parse', 'bad/code');
    bridge.reportStateHydrated('rev-42', { state: 'serialized bytes' });
    bridge.reportStateHydrated('rev-42', Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, 1])));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'hydration-failed', revision: 'rev-42', stage: 'parse', code: 'invalid-envelope',
    });
  });

  it('keeps the existing failure bridge strict', () => {
    const send = vi.fn();
    const bridge = createProjectVisualDiagnosticBridge({ send });
    bridge.report('uncaught-error', 'view failed');
    bridge.report('other', 'ignored');
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(VISUAL_RENDERER_DIAGNOSTIC_CHANNEL, {
      kind: 'uncaught-error', message: 'view failed',
    });
  });
});
