import { describe, expect, it, vi } from 'vitest';

import { registerVisualDiagnosticsIpc, resolveVisualDiagnosticTarget, VISUAL_RENDERER_DIAGNOSTIC_CHANNEL } from '../../src/main/ipc/visualDiagnosticsIpc';
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
    listener({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'first-paint' });
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

  it('routes strict renderer failure diagnostics through the same sender authority', () => {
    const buffer = createVisualDiagnosticBuffer();
    const on = vi.fn();
    registerVisualDiagnosticsIpc({
      ipcMain: { on },
      resolveTarget: (sender) => sender.id === 7 ? { windowId: 2, surfaceId: 'surface-a' } : null,
      bufferForWindow: () => buffer,
    });
    const listener = on.mock.calls.find(([channel]) => channel === VISUAL_RENDERER_DIAGNOSTIC_CHANNEL)?.[1] as
      ((event: { sender: { id: number } }, payload: unknown) => void);

    listener({ sender: { id: 7 } }, { kind: 'unhandled-rejection', message: 'C:\\private\\view.js' });
    listener({ sender: { id: 7 } }, { kind: 'unhandled-rejection', message: 'spoofed target', target: { windowId: 99 } });
    listener({ sender: { id: 8 } }, { kind: 'uncaught-error', message: 'ignored sender' });
    listener({ sender: { id: 7 } }, { kind: 'uncaught-error', message: 'recorded after strict rejection' });

    expect(buffer.snapshot()).toMatchObject([{
      target: { windowId: 2, surfaceId: 'surface-a' },
      payload: { kind: 'unhandled-rejection', message: '<path>' },
    }, {
      target: { windowId: 2, surfaceId: 'surface-a' },
      payload: { kind: 'uncaught-error', message: 'recorded after strict rejection' },
    }]);
  });

  it('routes hydration success and failure through authenticated sender context', () => {
    const buffer = createVisualDiagnosticBuffer();
    const on = vi.fn();
    registerVisualDiagnosticsIpc({
      ipcMain: { on },
      resolveTarget: (sender) => sender.id === 7 ? { windowId: 2, surfaceId: 'surface-a' } : null,
      bufferForWindow: () => buffer,
    });
    const signal = on.mock.calls.find(([channel]) => channel === 'papers:visual:renderer-signal')?.[1] as
      ((event: { sender: { id: number } }, payload: unknown) => void);
    const diagnostic = on.mock.calls.find(([channel]) => channel === 'papers:visual:renderer-diagnostic')?.[1] as
      ((event: { sender: { id: number } }, payload: unknown) => void);

    signal({ sender: { id: 7 } }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1', summary: { cards: 2 },
    });
    signal({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1', detail: 'state bytes' });
    signal({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1', state: 'serialized state' });
    signal({ sender: { id: 7 } }, { kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-1', target: { windowId: 99 } });
    diagnostic({ sender: { id: 7 } }, {
      kind: 'hydration-failed', revision: 'rev-1', stage: 'parse', code: 'bad-envelope',
    });
    signal({ sender: { id: 7 } }, {
      kind: 'lifecycle', phase: 'render-failed', revision: 'rev-1', stage: 'parse', code: 'bad-envelope',
    });
    signal({ sender: { id: 7 } }, {
      kind: 'lifecycle', phase: 'render-failed', revision: 'rev-1', stage: 'parse', code: 'bad-envelope', target: { windowId: 99 },
    });
    signal({ sender: { id: 8 } }, { kind: 'lifecycle', phase: 'state-hydrated', revision: 'rev-2' });

    expect(buffer.snapshot()).toMatchObject([
      { target: { windowId: 2, surfaceId: 'surface-a' }, payload: { phase: 'state-hydrated', revision: 'rev-1', summary: { cards: 2 } } },
      { target: { windowId: 2, surfaceId: 'surface-a' }, payload: { kind: 'hydration-failed', revision: 'rev-1', stage: 'parse', code: 'bad-envelope' } },
      { target: { windowId: 2, surfaceId: 'surface-a' }, payload: { phase: 'render-failed', revision: 'rev-1', stage: 'parse', code: 'bad-envelope' } },
    ]);
  });

  it('rejects a late document-A signal after main has accepted document-B', () => {
    const buffer = createVisualDiagnosticBuffer();
    const on = vi.fn();
    const accepted = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    registerVisualDiagnosticsIpc({
      ipcMain: { on },
      resolveTarget: (sender) => sender.id === 7 ? { windowId: 2, surfaceId: 'surface-a' } : null,
      bufferForWindow: () => buffer,
      isCurrentDocumentInstance: (_senderId, _target, documentInstanceId) => documentInstanceId === accepted,
    });
    const signal = on.mock.calls.find(([channel]) => channel === 'papers:visual:renderer-signal')?.[1] as
      ((event: { sender: { id: number } }, payload: unknown) => void);
    signal({ sender: { id: 7 } }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'old-revision',
      documentInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    signal({ sender: { id: 7 } }, {
      kind: 'lifecycle', phase: 'state-hydrated', revision: 'new-revision',
      documentInstanceId: accepted,
    });
    expect(buffer.snapshot()).toHaveLength(1);
    expect(buffer.snapshot()[0]?.payload).toMatchObject({ phase: 'state-hydrated', revision: 'new-revision' });
  });
});
