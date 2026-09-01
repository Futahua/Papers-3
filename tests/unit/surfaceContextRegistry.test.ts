import { describe, expect, it } from 'vitest';

import { createSurfaceContextRegistry } from '../../src/main/windows/surfaceContextRegistry';

describe('surface context registry', () => {
  it('resolves a request through its own sender, never through ambient state', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(22, { projectId: 'bp-b', windowId: 2 });

    expect(registry.projectForSender(11)).toBe('bp-a');
    expect(registry.projectForSender(22)).toBe('bp-b');
  });

  it('is the fix for the cross-window save: the later window does not capture the earlier one', () => {
    const registry = createSurfaceContextRegistry();
    // Window A enters project A, then window B enters project B — the order
    // that made an application-global answer "B" for both of them.
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(22, { projectId: 'bp-b', windowId: 2 });

    expect(registry.projectForSender(11)).toBe('bp-a');
  });

  it('refuses an unknown sender rather than guessing', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    expect(registry.projectForSender(999)).toBeNull();
    expect(registry.contextForSender(999)).toBeNull();
  });

  it('rebinds a surface that leaves one Backpack and enters another', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(11, { projectId: 'bp-c', windowId: 1 });

    expect(registry.projectForSender(11)).toBe('bp-c');
    expect(registry.size).toBe(1);
    expect(registry.sendersForProject('bp-a')).toEqual([]);
  });

  it('binds several surfaces of one window to the same project', () => {
    const registry = createSurfaceContextRegistry();
    // A host view and the project frame it hosts are different senders.
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(12, { projectId: 'bp-a', windowId: 1 });

    expect(registry.sendersForProject('bp-a').sort()).toEqual([11, 12]);
  });

  it('lists only the senders of the project asked for', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(12, { projectId: 'bp-a', windowId: 1 });
    registry.bind(22, { projectId: 'bp-b', windowId: 2 });

    expect(registry.sendersForProject('bp-b')).toEqual([22]);
  });

  it('closing a window releases its surfaces and leaves the other window untouched', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(12, { projectId: 'bp-a', windowId: 1 });
    registry.bind(22, { projectId: 'bp-b', windowId: 2 });

    registry.unbindWindow(1);

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(12)).toBeNull();
    expect(registry.projectForSender(22)).toBe('bp-b');
  });

  it('closing a project releases every surface showing it, in any window', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(22, { projectId: 'bp-a', windowId: 2 });
    registry.bind(33, { projectId: 'bp-b', windowId: 3 });

    registry.unbindProject('bp-a');

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(22)).toBeNull();
    expect(registry.projectForSender(33)).toBe('bp-b');
  });

  it('unbinding one surface does not disturb its sibling in the same window', () => {
    const registry = createSurfaceContextRegistry();
    registry.bind(11, { projectId: 'bp-a', windowId: 1 });
    registry.bind(12, { projectId: 'bp-a', windowId: 1 });

    registry.unbind(11);

    expect(registry.projectForSender(11)).toBeNull();
    expect(registry.projectForSender(12)).toBe('bp-a');
  });

  it('hands back a copy, so a caller cannot mutate the binding it was told about', () => {
    const registry = createSurfaceContextRegistry();
    const context = { projectId: 'bp-a', windowId: 1 };
    registry.bind(11, context);

    context.projectId = 'bp-tampered';
    expect(registry.projectForSender(11)).toBe('bp-a');

    const read = registry.contextForSender(11)!;
    read.projectId = 'bp-tampered';
    expect(registry.projectForSender(11)).toBe('bp-a');
  });
});
