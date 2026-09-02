import { describe, expect, it, vi } from 'vitest';

import { registerVisualDiagnosticsIpc, resolveVisualDiagnosticTarget } from '../../src/main/ipc/visualDiagnosticsIpc';
import { createVisualDiagnosticBuffer } from '../../src/main/visual/visualDiagnostics';

describe('visual diagnostics renderer IPC', () => {
  it('resolves the target from the authenticated sender, not renderer payload', () => {
    const buffer = createVisualDiagnosticBuffer();
    const on = vi.fn();
    registerVisualDiagnosticsIpc({
      ipcMain: { on },
      resolveTarget: (sender) => sender.id === 7 ? { windowId: 2, surfaceId: 'surface-a' } : null,
      bufferForWindow: (windowId) => windowId === 2 ? buffer : null,
    });
    const listener = on.mock.calls[0]?.[1] as ((event: { sender: { id: number } }, payload: unknown) => void);
    listener({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'first-paint', target: { windowId: 99, surfaceId: 'foreign' } });
    expect(buffer.snapshot()[0]).toMatchObject({ target: { windowId: 2, surfaceId: 'surface-a' }, payload: { phase: 'first-paint' } });
  });

  it('ignores unbound senders and malformed or main-owned renderer phases', () => {
    const buffer = createVisualDiagnosticBuffer();
    const on = vi.fn();
    registerVisualDiagnosticsIpc({
      ipcMain: { on },
      resolveTarget: (sender) => sender.id === 7 ? { windowId: 2 } : null,
      bufferForWindow: () => buffer,
    });
    const listener = on.mock.calls[0]?.[1] as ((event: { sender: { id: number } }, payload: unknown) => void);
    listener({ sender: { id: 8 } }, { kind: 'lifecycle', phase: 'first-paint' });
    listener({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'dom-ready' });
    listener({ sender: { id: 7 } }, { kind: 'arbitrary', phase: 'first-paint' });
    expect(buffer.snapshot()).toEqual([]);
  });

  it('rejects an old project sender while its logical binding is still live', () => {
    const oldSender = { id: 7 };
    const newSender = { id: 8 };
    const authority = {
      hostWindowForSender: () => null,
      isCurrentHostSender: () => false,
      projectContextForSender: (senderId: number) => senderId === 7 || senderId === 8
        ? { windowId: 2, surfaceId: 'surface-a' } : null,
      isLiveSurface: () => true,
      isCurrentProjectSender: (sender: { id: number }) => sender.id === newSender.id,
    };
    expect(resolveVisualDiagnosticTarget(oldSender, authority)).toBeNull();
    expect(resolveVisualDiagnosticTarget(newSender, authority)).toEqual({ windowId: 2, surfaceId: 'surface-a' });
  });
});
