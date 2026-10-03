import { describe, expect, it, vi } from 'vitest';

import {
  attachVisualLifecycleMonitor,
  recentRendererDiagnosticMatcherSnapshotForTest,
  recordRendererVisualDiagnostic,
  type VisualLifecycleSource,
} from '../../src/main/visual/visualLifecycleMonitor';
import { createVisualDiagnosticBuffer } from '../../src/main/visual/visualDiagnostics';

class FakeSource implements VisualLifecycleSource {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  on(event: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe('visual lifecycle monitor', () => {
  it('maps main-owned Electron events into exact bounded records', () => {
    const source = new FakeSource();
    const buffer = createVisualDiagnosticBuffer();
    const monitor = attachVisualLifecycleMonitor(source, { windowId: 3, surfaceId: 'surface-a' }, buffer);
    source.emit('did-start-loading');
    source.emit('dom-ready');
    source.emit('did-fail-load', {}, -6, 'C:\\private\\main.js', 'https://papers.local', true);
    source.emit('did-fail-load', {}, -105, 'C:\\private\\frame.js', 'https://papers.local/frame', false);
    source.emit('console-message', {}, 3, 'file:///C:/private/main.js', 1, 'C:\\private\\main.js');
    source.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(buffer.snapshot().map((record) => record.payload.kind)).toEqual([
      'lifecycle', 'lifecycle', 'navigation-failed', 'console', 'renderer-gone',
    ]);
    expect(buffer.snapshot()[2]?.payload).toMatchObject({ kind: 'navigation-failed', errorCode: -6, message: '<path>' });
    expect(buffer.snapshot()[3]?.payload).toMatchObject({ kind: 'console', message: '<url>' });
    const lifecycleSequences = buffer.snapshot()
      .filter((record): record is typeof record & { payload: { kind: 'lifecycle'; phase: string } } => record.payload.kind === 'lifecycle')
      .map((record) => record.payload.phase);
    expect(lifecycleSequences).toEqual(['navigation-started', 'dom-ready']);
    monitor.detach();
    source.emit('dom-ready');
    expect(buffer.snapshot()).toHaveLength(5);
  });

  it('accepts only the renderer-owned lifecycle phases and keeps target binding', () => {
    const buffer = createVisualDiagnosticBuffer();
    const monitor = attachVisualLifecycleMonitor(new FakeSource(), { windowId: 4, surfaceId: 'surface-b' }, buffer);
    monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'state-hydrated', revision: 'revision-4' });
    monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'first-paint' });
    monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'layout-stable' });
    expect(buffer.snapshot()).toHaveLength(3);
    expect(buffer.snapshot()[0]).toMatchObject({ target: { windowId: 4, surfaceId: 'surface-b' } });
    expect(() => monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'dom-ready' })).toThrow();
    expect(() => monitor.recordRendererSignal({ kind: 'arbitrary', phase: 'first-paint' })).toThrow();
    expect(() => monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'state-hydrated' })).toThrow();
    expect(() => monitor.recordRendererSignal({ kind: 'lifecycle', phase: 'first-paint', revision: 'rev-1' })).toThrow();
  });

  it('records structured hydration failures without accepting free-form state text', () => {
    const buffer = createVisualDiagnosticBuffer();
    recordRendererVisualDiagnostic(buffer, { windowId: 4, surfaceId: 'surface-b' }, {
      kind: 'hydration-failed', revision: 'rev-1', stage: 'normalize', code: 'empty-model',
    });
    expect(buffer.snapshot()[0]).toMatchObject({
      payload: { kind: 'hydration-failed', revision: 'rev-1', stage: 'normalize', code: 'empty-model' },
    });
    expect(() => recordRendererVisualDiagnostic(buffer, { windowId: 4, surfaceId: 'surface-b' }, {
      kind: 'hydration-failed', stage: 'normalize', code: 'C:\\private\\state.json', message: 'raw state',
    })).toThrow();
  });

  it('does not create timers or recovery side effects', () => {
    const source = new FakeSource();
    const buffer = createVisualDiagnosticBuffer();
    const spy = vi.spyOn(globalThis, 'setInterval');
    const monitor = attachVisualLifecycleMonitor(source, { windowId: 1 }, buffer);
    expect(spy).not.toHaveBeenCalled();
    monitor.detach();
    spy.mockRestore();
  });

  it('accepts only strict bounded renderer failure payloads and redacts before retention', () => {
    const buffer = createVisualDiagnosticBuffer();
    recordRendererVisualDiagnostic(buffer, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'C:\\private\\view.js token=secret',
    }, 'bootstrap-console');
    recordRendererVisualDiagnostic(buffer, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'C:\\private\\view.js token=secret',
    });
    recordRendererVisualDiagnostic(buffer, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'C:\\private\\view.js token=secret',
    });

    expect(buffer.snapshot()[0]).toMatchObject({
      target: { windowId: 8, surfaceId: 'surface-c' },
      payload: { kind: 'uncaught-error', message: '<path> token=<redacted>' },
    });
    expect(buffer.snapshot()).toHaveLength(2);
    const symmetric = createVisualDiagnosticBuffer();
    recordRendererVisualDiagnostic(symmetric, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'symmetric failure',
    });
    recordRendererVisualDiagnostic(symmetric, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'symmetric failure',
    }, 'bootstrap-console');
    recordRendererVisualDiagnostic(symmetric, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'symmetric failure',
    }, 'bootstrap-console');
    expect(symmetric.snapshot()).toHaveLength(2);
    const sameSource = createVisualDiagnosticBuffer();
    recordRendererVisualDiagnostic(sameSource, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'same failure',
    });
    recordRendererVisualDiagnostic(sameSource, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'same failure',
    });
    expect(sameSource.snapshot()).toHaveLength(2);
    const redactionCollision = createVisualDiagnosticBuffer();
    recordRendererVisualDiagnostic(redactionCollision, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'C:\\private\\a.js token=one',
    }, 'bootstrap-console');
    recordRendererVisualDiagnostic(redactionCollision, { windowId: 8, surfaceId: 'surface-c' }, {
      kind: 'uncaught-error', message: 'D:\\private\\b.js token=two',
    });
    expect(redactionCollision.snapshot()).toHaveLength(2);
    const bounded = createVisualDiagnosticBuffer();
    for (let index = 0; index < 100; index += 1) {
      recordRendererVisualDiagnostic(bounded, { windowId: 8, surfaceId: 'surface-c' }, {
        kind: 'uncaught-error', message: `C:\\private\\view-${index}.js token=${index}`,
      }, 'bootstrap-console');
    }
    const matcher = recentRendererDiagnosticMatcherSnapshotForTest(bounded);
    expect(matcher).toHaveLength(64);
    expect(JSON.stringify(matcher)).not.toContain('C:\\private\\');
    expect(JSON.stringify(matcher)).not.toContain('token=');
    expect(() => recordRendererVisualDiagnostic(buffer, { windowId: 8 }, {
      kind: 'uncaught-error', message: 'not retained', stack: 'must be ignored',
    })).toThrow();
    expect(() => recordRendererVisualDiagnostic(buffer, { windowId: 8 }, {
      kind: 'console', message: 'wrong kind',
    })).toThrow();
    expect(() => recordRendererVisualDiagnostic(buffer, { windowId: 8 }, {
      kind: 'unhandled-rejection', message: 'x'.repeat(4097),
    })).toThrow();
  });

});
