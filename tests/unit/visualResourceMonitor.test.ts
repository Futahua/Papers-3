import { describe, expect, it, vi } from 'vitest';

import { createVisualDiagnosticBuffer } from '../../src/main/visual/visualDiagnostics';
import { attachVisualResourceMonitor, type VisualResourceSource } from '../../src/main/visual/visualResourceMonitor';

class FakeResourceSource implements VisualResourceSource {
  listener: ((details: { webContentsId?: number; resourceType?: string; error?: string }) => void) | null = null;
  onErrorOccurred = vi.fn((listener: typeof this.listener) => {
    this.listener = listener;
  });
  emit(details: { webContentsId?: number; resourceType?: string; error?: string }): void {
    this.listener?.(details);
  }
}

describe('visual resource monitor', () => {
  it('attributes failures to the exact current surface without retaining the URL', () => {
    const source = new FakeResourceSource();
    const buffer = createVisualDiagnosticBuffer();
    const resolveTarget = vi.fn((sender: { id: number }) => sender.id === 11
      ? { windowId: 3, surfaceId: 'surface-a' } : null);
    attachVisualResourceMonitor(source, resolveTarget, (windowId) => windowId === 3 ? buffer : null);

    source.emit({ webContentsId: 11, resourceType: 'stylesheet', error: 'net::ERR_FAILED https://private.example/app.css' });

    expect(resolveTarget).toHaveBeenCalledWith({ id: 11 });
    expect(buffer.snapshot()).toMatchObject([{
      target: { windowId: 3, surfaceId: 'surface-a' },
      payload: { kind: 'resource-failed', resourceKind: 'style', message: 'net::ERR_FAILED <url>' },
    }]);
    expect(JSON.stringify(buffer.snapshot())).not.toContain('private.example');
  });

  it('ignores missing or stale WebContents authority and maps unknown types safely', () => {
    const source = new FakeResourceSource();
    const buffer = createVisualDiagnosticBuffer();
    const resolveTarget = vi.fn((sender: { id: number }) => sender.id === 12 ? { windowId: 4 } : null);
    attachVisualResourceMonitor(source, resolveTarget, (windowId) => windowId === 4 ? buffer : null);

    source.emit({ resourceType: 'script', error: 'missing id' });
    source.emit({ webContentsId: 99, resourceType: 'image', error: 'stale sender' });
    source.emit({ webContentsId: 12, resourceType: 'webSocket' });

    expect(buffer.snapshot()).toMatchObject([{
      target: { windowId: 4 },
      payload: { kind: 'resource-failed', resourceKind: 'other', message: 'resource load failed' },
    }]);
  });

  it('bounds an overlong Electron error and never lets observation throw', () => {
    const source = new FakeResourceSource();
    const buffer = createVisualDiagnosticBuffer();
    attachVisualResourceMonitor(source, () => ({ windowId: 5 }), (windowId) => windowId === 5 ? buffer : null);

    expect(() => source.emit({ webContentsId: 13, resourceType: 'script', error: 'x'.repeat(4096) })).not.toThrow();

    const records = buffer.snapshot();
    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toMatchObject({ kind: 'resource-failed', resourceKind: 'script' });
    expect((records[0]?.payload as { message: string }).message).toHaveLength(2048);
  });

  it('detaches the single webRequest listener', () => {
    const source = new FakeResourceSource();
    const monitor = attachVisualResourceMonitor(source, () => null, () => null);

    monitor.detach();

    expect(source.onErrorOccurred).toHaveBeenLastCalledWith(null);
  });
});
