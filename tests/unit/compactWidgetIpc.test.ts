import { describe, expect, it, vi } from 'vitest';

import { BackpackSurfaceRegistry, COMPACT_WIDGET_SURFACE_KIND, WORKSPACE_SURFACE_KIND } from '../../src/main/backpacks/backpackSurfaceRegistry';
import { registerCompactWidgetIpc } from '../../src/main/ipc/compactWidgetIpc';
import type { CompactWidgetSession } from '../../src/main/windows/compactWidgetSession';

function harness(waitForAuthority?: (sender: { id: number }) => Promise<void>) {
  const handlers = new Map<string, (event: { sender: { id: number } }, raw: unknown) => Promise<unknown>>();
  const ipcMain = { handle: vi.fn((channel: string, handler: (event: { sender: { id: number } }, raw: unknown) => Promise<unknown>) => handlers.set(channel, handler)) };
  const registry = new BackpackSurfaceRegistry();
  const session = {
    open: vi.fn(async () => ({ ok: true, reused: false })),
    focus: vi.fn(() => true),
    close: vi.fn(async () => undefined),
    closeFromSender: vi.fn(async () => undefined),
    resizeFromSender: vi.fn(),
  } as unknown as CompactWidgetSession;
  registerCompactWidgetIpc({
    ipcMain,
    registry,
    session,
    waitForAuthority,
    windowIdForWorkspaceSender: () => 1,
    isWorkspaceSender: (sender, projectId) => sender.id === 1 && projectId === 'bp-a',
    isWidgetSender: (sender, projectId) => sender.id === 2 && projectId === 'bp-a',
  });
  const invoke = (channel: string, senderId: number, raw: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing ${channel}`);
    return handler({ sender: { id: senderId } }, raw);
  };
  return { registry, session, invoke };
}

describe('compact widget IPC', () => {
  it('waits for staged authority before widget-open can execute', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness(() => gate);
    const pending = h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' });
    await Promise.resolve();
    expect(h.session.open).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toEqual({ ok: true, reused: false });
  });

  it('opens and focuses only from the registered workspace sender', async () => {
    const h = harness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).resolves.toEqual({ ok: true, reused: false });
    expect(h.session.open).toHaveBeenCalledWith({ projectId: 'bp-a', layoutKey: 'layout-a', owningWindowId: 1 });
    await expect(h.invoke('papers:backpack:widget-focus', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).resolves.toEqual({ ok: true });
    await expect(h.invoke('papers:backpack:widget-open', 9, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/denied/);
  });

  it('closes only with the registered widget token and rejects dead/stale senders', async () => {
    const h = harness();
    const token = h.registry.register(2, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    await expect(h.invoke('papers:backpack:widget-close', 2, { token })).resolves.toEqual({ ok: true });
    expect(h.session.closeFromSender).toHaveBeenCalledWith(2, token);
    await expect(h.invoke('papers:backpack:widget-close', 2, { token: 'stale' })).rejects.toThrow(/denied/);
    h.registry.unregister(2);
    await expect(h.invoke('papers:backpack:widget-close', 2, { token })).rejects.toThrow(/denied/);
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'x'.repeat(513) })).rejects.toThrow(/layoutKey/);
  });

  it('019C: registers the bound workspace sender on first widget-open and reuses it', async () => {
    const h = harness();
    expect(h.registry.surface(1)).toBeNull();
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).resolves.toEqual({ ok: true, reused: false });
    const surface = h.registry.surface(1);
    expect(surface?.kind).toBe(WORKSPACE_SURFACE_KIND);
    expect(surface?.projectId).toBe('bp-a');
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-b' })).resolves.toEqual({ ok: true, reused: false });
    expect(h.registry.size).toBe(1);
  });

  it('019C: a workspace sender already bound to another project or kind is denied', async () => {
    const h = harness();
    h.registry.register(1, 'bp-other', WORKSPACE_SURFACE_KIND);
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/denied/);
    const h2 = harness();
    h2.registry.register(1, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    await expect(h2.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/denied/);
  });

  it('019C: workspace widget-close uses the opaque layout key path', async () => {
    const h = harness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await expect(h.invoke('papers:backpack:widget-close', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).resolves.toEqual({ ok: true });
    expect(h.session.close).toHaveBeenCalledWith('bp-a', 'layout-a', 1);
    await expect(h.invoke('papers:backpack:widget-close', 9, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/denied/);
  });

  it('019F: focus requires an ALREADY registered workspace surface (no auto-register)', async () => {
    const h = harness();
    // Sender 1 passes isWorkspaceSender but is NOT registered: focus is denied
    // and the sender is NOT auto-registered.
    await expect(h.invoke('papers:backpack:widget-focus', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/not registered/);
    expect(h.registry.surface(1)).toBeNull();
    expect(h.session.focus).not.toHaveBeenCalled();
  });

  it('019F: focus rejects a wrong-kind (widget) sender and a cross-project sender', async () => {
    const h = harness();
    h.registry.register(1, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    await expect(h.invoke('papers:backpack:widget-focus', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/not registered/);
    const h2 = harness();
    h2.registry.register(1, 'bp-other', WORKSPACE_SURFACE_KIND);
    await expect(h2.invoke('papers:backpack:widget-focus', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/not registered/);
  });

  it('019F: close requires an ALREADY registered workspace surface (no auto-register)', async () => {
    const h = harness();
    await expect(h.invoke('papers:backpack:widget-close', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/not registered/);
    expect(h.registry.surface(1)).toBeNull();
    expect(h.session.close).not.toHaveBeenCalled();
    const h2 = harness();
    h2.registry.register(1, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    await expect(h2.invoke('papers:backpack:widget-close', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).rejects.toThrow(/not registered/);
  });

  it('019F: open retains its bounded registration path for a registered workspace', async () => {
    const h = harness();
    h.registry.register(1, 'bp-a', WORKSPACE_SURFACE_KIND);
    await expect(h.invoke('papers:backpack:widget-open', 1, { projectId: 'bp-a', layoutKey: 'layout-a' })).resolves.toEqual({ ok: true, reused: false });
    expect(h.registry.size).toBe(1);
  });

  it('024: widget-report-size is token-gated, bounded and refits via resizeFromSender', async () => {
    const h = harness();
    const token = h.registry.register(2, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token, width: 360, height: 220 })).resolves.toEqual({ ok: true });
    expect(h.session.resizeFromSender).toHaveBeenCalledWith(2, token, 360, 220);
    // Wrong sender / stale token / non-widget surface denied.
    await expect(h.invoke('papers:backpack:widget-report-size', 1, { token, width: 360, height: 220 })).rejects.toThrow(/denied/);
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token: 'stale', width: 360, height: 220 })).rejects.toThrow(/denied/);
    // Malformed payloads rejected.
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token, width: 360 })).rejects.toThrow(/malformed/);
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token, width: Number.NaN, height: 220 })).rejects.toThrow(/finite/);
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token, width: 4000, height: 220 })).rejects.toThrow(/range/);
    await expect(h.invoke('papers:backpack:widget-report-size', 2, { token, width: 360, height: 220, extra: true })).rejects.toThrow(/malformed/);
  });
});
