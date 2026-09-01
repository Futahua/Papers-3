import { describe, expect, it } from 'vitest';

import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';

describe('surface context registry', () => {
  it('resolves a request through its own sender, never through ambient state', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(22, { projectId: 'bp-b', windowId: 2, kind: 'host' });

    expect(registry.projectForSender(11)).toBe('bp-a');
    expect(registry.projectForSender(22)).toBe('bp-b');
  });

  it('is the fix for the cross-window save: the later window does not capture the earlier one', () => {
    const registry = createSurfaceContextRegistry();
    // Window A enters project A, then window B enters project B — the order
    // that made an application-global answer "B" for both of them.
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(22, { projectId: 'bp-b', windowId: 2, kind: 'host' });

    expect(registry.projectForSender(11)).toBe('bp-a');
  });

  it('refuses an unknown sender rather than guessing', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    expect(registry.projectForSender(999)).toBeNull();
    expect(registry.contextForSender(999)).toBeNull();
  });

  it('rebinds a surface that leaves one Backpack and enters another', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(11, { projectId: 'bp-c', windowId: 1, kind: 'host' });

    expect(registry.projectForSender(11)).toBe('bp-c');
    expect(registry.size).toBe(1);
    expect(registry.sendersForProject('bp-a')).toEqual([]);
  });

  it('binds several surfaces of one window to the same project', () => {
    const registry = createSurfaceContextRegistry();
    // A host view and the project frame it hosts are different senders.
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });

    expect(registry.sendersForProject('bp-a').sort()).toEqual([11, 12]);
  });

  it('lists only the senders of the project asked for', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });
    registry.bind(22, { projectId: 'bp-b', windowId: 2, kind: 'host' });

    expect(registry.sendersForProject('bp-b')).toEqual([22]);
  });

  it('closing a window releases its surfaces and leaves the other window untouched', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });
    registry.bind(22, { projectId: 'bp-b', windowId: 2, kind: 'host' });

    registry.unbindWindow(1);

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(12)).toBeNull();
    expect(registry.projectForSender(22)).toBe('bp-b');
  });

  it('closing a project releases every surface showing it, in any window', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(22, { projectId: 'bp-a', windowId: 2, kind: 'host' });
    registry.bind(33, { projectId: 'bp-b', windowId: 3, kind: 'host' });

    registry.unbindProject('bp-a');

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(22)).toBeNull();
    expect(registry.projectForSender(33)).toBe('bp-b');
  });

  it('unbinding one surface does not disturb its sibling in the same window', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });

    registry.unbind(11);

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(12)).toBe('bp-a');
  });

  it('answers a project frame through its OWN window host, not every host showing that project', () => {
    const registry = createSurfaceContextRegistry();
    // Two windows legitimately showing the SAME project.
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });
    registry.bind(21, { projectId: 'bp-a', windowId: 2, kind: 'host' });
    registry.bind(22, { projectId: 'bp-a', windowId: 2, kind: 'project' });

    // Window 1's project frame asks to close. Only window 1's host may hear it;
    // closing one surface must not close the other window showing the same
    // project. This is the bug that using projectId where window identity is
    // required would produce.
    const asking = registry.contextForSender(12)!;
    expect(asking.windowId).toBe(1);
    expect(registry.hostSenderForWindow(asking.windowId)).toBe(11);
    expect(registry.hostSenderForWindow(2)).toBe(21);

    // And the broadcast answer would have been wrong: it names both hosts.
    expect(registry.hostSendersForProject('bp-a').sort()).toEqual([11, 21]);

    // Window 2 stays bound and untouched.
    expect(registry.projectForSender(21)).toBe('bp-a');
    expect(registry.projectForSender(22)).toBe('bp-a');
  });

  it('separates the two kinds of sender bound to one project', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });

    expect(registry.hostSendersForProject('bp-a')).toEqual([11]);
    expect(registry.projectSendersForProject('bp-a')).toEqual([12]);
  });

  it('has no host to answer through once a window is gone', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.unbindWindow(1);
    expect(registry.hostSenderForWindow(1)).toBeNull();
  });

  it('hiding one window leaves the other window showing the same project intact', () => {
    const registry = createSurfaceContextRegistry();
    // Both windows show bp-a. Window 1 hides it.
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });
    registry.bind(21, { projectId: 'bp-a', windowId: 2, kind: 'host' });
    registry.bind(22, { projectId: 'bp-a', windowId: 2, kind: 'project' });

    // Scoped by window, which is the whole point: unbindProject would have
    // stripped window 2's routing authority as well.
    const hiding = registry.contextForSender(11)!;
    registry.unbindWindow(hiding.windowId);

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(12)).toBeNull();
    expect(registry.projectForSender(21)).toBe('bp-a');
    expect(registry.projectForSender(22)).toBe('bp-a');
    expect(registry.hostSenderForWindow(2)).toBe(21);
  });

  it('unbinding a window twice is a no-op, because the renderer hides again after closing', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.unbindWindow(1);
    expect(() => registry.unbindWindow(1)).not.toThrow();
    expect(registry.size).toBe(0);
  });

  it('binds the detach and widget surfaces, which are authorized project senders too', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1, kind: 'host' });
    registry.bind(12, { projectId: 'bp-a', windowId: 1, kind: 'project' });
    // Their windowId is the OWNING Papers window, not their own native window.
    registry.bind(13, { projectId: 'bp-a', windowId: 1, kind: 'detached' });
    registry.bind(14, { projectId: 'bp-a', windowId: 1, kind: 'widget' });

    // Every one of them can act for the project; an unbound authorized sender
    // would be refused by every sender-resolved request.
    for (const sender of [11, 12, 13, 14]) {
      expect(registry.projectForSender(sender)).toBe('bp-a');
    }
    // They belong to the owning window, so closing it releases them all.
    registry.unbindWindow(1);
    expect(registry.size).toBe(0);
  });

  it('hands back a copy, so a caller cannot mutate the binding it was told about', () => {
    const registry = createSurfaceContextRegistry();
    const context = { projectId: 'bp-a', windowId: 1, kind: 'host' as const };
    registry.bind(11, context);

    context.projectId = 'bp-tampered';
    expect(registry.projectForSender(11)).toBe('bp-a');

    const read = registry.contextForSender(11)!;
    read.projectId = 'bp-tampered';
    expect(registry.projectForSender(11)).toBe('bp-a');
  });
});

describe('sender bindings point at logical surfaces', () => {
  it('resolves the logical surface a sender is rendering', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { surfaceId: 'sf-1', projectId: 'bp-a', windowId: 1, kind: 'project' });

    expect(registry.surfaceForSender(11)).toBe('sf-1');
    expect(registry.sendersForSurface('sf-1')).toEqual([11]);
  });

  it('lets a renderer die and come back as the same surface', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { surfaceId: 'sf-1', projectId: 'bp-a', windowId: 1, kind: 'project' });

    // The WebContentsView crashed. Its binding goes; the surface does not,
    // because the surface is not this registry's to end.
    registry.unbind(11);
    expect(registry.sendersForSurface('sf-1')).toEqual([]);

    // The replacement view binds to the SAME logical surface.
    registry.bind(12, { surfaceId: 'sf-1', projectId: 'bp-a', windowId: 1, kind: 'project' });
    expect(registry.surfaceForSender(12)).toBe('sf-1');
    expect(registry.sendersForSurface('sf-1')).toEqual([12]);
  });

  it('keeps two surfaces of one project distinguishable', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { surfaceId: 'sf-1', projectId: 'bp-a', windowId: 1, kind: 'project' });
    registry.bind(21, { surfaceId: 'sf-2', projectId: 'bp-a', windowId: 2, kind: 'project' });

    // Same project, different surfaces: project identity alone can no longer
    // answer "which one".
    expect(registry.surfaceForSender(11)).toBe('sf-1');
    expect(registry.surfaceForSender(21)).toBe('sf-2');
    expect(registry.sendersForSurface('sf-1')).toEqual([11]);
  });

  it('reports no surface for a sender bound without one', () => {
    const registry = createSurfaceContextRegistry();
    // Detached and widget surfaces are bound before they have a logical
    // identity of their own; they must not borrow someone else's.
    registry.bind(31, { projectId: 'bp-a', windowId: 1, kind: 'widget' });
    expect(registry.surfaceForSender(31)).toBeNull();
    expect(registry.sendersForSurface('sf-1')).toEqual([]);
  });
});
