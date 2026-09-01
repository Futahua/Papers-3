import { describe, expect, it } from 'vitest';

import {
  BackpackSurfaceRegistry,
  COMPACT_WIDGET_SURFACE_KIND,
  DETACHED_SURFACE_KIND,
  isAllowedProjectSurfaceSender,
  MAX_REGISTERED_SURFACES,
  WORKSPACE_SURFACE_KIND,
} from '../../src/main/backpacks/backpackSurfaceRegistry';

describe('backpack surface registry', () => {
  it('registers a surface with a unique opaque token and returns it', () => {
    const registry = new BackpackSurfaceRegistry();
    const token = registry.register(101, 'bp-project', WORKSPACE_SURFACE_KIND);
    expect(typeof token).toBe('string');
    expect(token.startsWith('ds-')).toBe(true);
    expect(registry.surface(101)).toEqual({ projectId: 'bp-project', kind: 'workspace', token });
    expect(registry.size).toBe(1);
  });

  it('issues distinct tokens per surface', () => {
    const registry = new BackpackSurfaceRegistry();
    const a = registry.register(101, 'bp-a', WORKSPACE_SURFACE_KIND);
    const b = registry.register(102, 'bp-a', DETACHED_SURFACE_KIND);
    expect(a).not.toBe(b);
  });

  it('validSender requires one live registration binding sender, project and token', () => {
    const registry = new BackpackSurfaceRegistry();
    const token = registry.register(101, 'bp-project', WORKSPACE_SURFACE_KIND);
    expect(registry.validSender(101, 'bp-project', token)).toBe(true);
    expect(registry.validSender(101, 'bp-project', 'ds-wrong')).toBe(false);
    expect(registry.validSender(101, 'bp-other', token)).toBe(false);
    expect(registry.validSender(999, 'bp-project', token)).toBe(false);
  });

  it('allows generic project capabilities from exact workspace, detached and compact-widget surfaces only', () => {
    const detachRegistry = new BackpackSurfaceRegistry();
    const widgetRegistry = new BackpackSurfaceRegistry();
    detachRegistry.register(102, 'bp-a', DETACHED_SURFACE_KIND);
    widgetRegistry.register(103, 'bp-a', COMPACT_WIDGET_SURFACE_KIND, 'layout-a');
    const allowed = (senderId: number, url: string, isWorkspaceSender = false) =>
      isAllowedProjectSurfaceSender({ senderId, url, isWorkspaceSender, detachRegistry, widgetRegistry });

    expect(allowed(101, 'papers-backpack://bp-a/entry', true)).toBe(true);
    expect(allowed(102, 'papers-backpack://bp-a/entry?detach=1')).toBe(true);
    expect(allowed(103, 'papers-backpack://bp-a/entry?papers-surface=compact-widget')).toBe(true);
    expect(allowed(103, 'papers-backpack://bp-other/entry?papers-surface=compact-widget')).toBe(false);
    expect(allowed(103, 'https://bp-a.example/')).toBe(false);
    expect(allowed(999, 'papers-backpack://bp-a/entry')).toBe(false);
  });

  it('rejects invalid registration inputs and duplicate webContents ids', () => {
    const registry = new BackpackSurfaceRegistry();
    expect(() => registry.register(0, 'bp', WORKSPACE_SURFACE_KIND)).toThrow(/webContents id/);
    expect(() => registry.register(1.5, 'bp', WORKSPACE_SURFACE_KIND)).toThrow(/webContents id/);
    expect(() => registry.register(101, '', WORKSPACE_SURFACE_KIND)).toThrow(/project id/);
    registry.register(101, 'bp', WORKSPACE_SURFACE_KIND);
    expect(() => registry.register(101, 'bp-2', DETACHED_SURFACE_KIND)).toThrow(/already registered/);
  });

  it('unregister removes the surface and its token', () => {
    const registry = new BackpackSurfaceRegistry();
    const token = registry.register(101, 'bp-project', WORKSPACE_SURFACE_KIND);
    const removed = registry.unregister(101);
    expect(removed?.projectId).toBe('bp-project');
    expect(registry.surface(101)).toBeNull();
    expect(registry.validSender(101, 'bp-project', token)).toBe(false);
    expect(registry.unregister(101)).toBeNull();
  });

  it('unregisterAllForProject removes only that project and returns the ids', () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(101, 'bp-a', WORKSPACE_SURFACE_KIND);
    registry.register(102, 'bp-a', DETACHED_SURFACE_KIND);
    registry.register(103, 'bp-b', WORKSPACE_SURFACE_KIND);
    const removed = registry.unregisterAllForProject('bp-a');
    expect(removed.sort()).toEqual([101, 102]);
    expect(registry.size).toBe(1);
    expect(registry.hasSurface('bp-b', WORKSPACE_SURFACE_KIND)).toBe(true);
    expect(registry.hasSurface('bp-a', DETACHED_SURFACE_KIND)).toBe(false);
  });

  it('hasSurface reports per project and kind', () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(101, 'bp-project', WORKSPACE_SURFACE_KIND);
    expect(registry.hasSurface('bp-project', WORKSPACE_SURFACE_KIND)).toBe(true);
    expect(registry.hasSurface('bp-project', DETACHED_SURFACE_KIND)).toBe(false);
    expect(registry.hasSurface('bp-other', WORKSPACE_SURFACE_KIND)).toBe(false);
  });

  it('finds the exact accepted workspace when a project has multiple owners', () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(101, 'bp-project', WORKSPACE_SURFACE_KIND);
    registry.register(202, 'bp-project', WORKSPACE_SURFACE_KIND);

    expect(registry.surfaceForProject('bp-project', WORKSPACE_SURFACE_KIND, (id) => id === 202)?.id).toBe(202);
  });

  it('clear empties every registration', () => {
    const registry = new BackpackSurfaceRegistry();
    registry.register(101, 'bp-a', WORKSPACE_SURFACE_KIND);
    registry.register(102, 'bp-b', DETACHED_SURFACE_KIND);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.surface(101)).toBeNull();
    expect(registry.surface(102)).toBeNull();
  });

  it('enforces a bounded capacity (no unbounded growth)', () => {
    const registry = new BackpackSurfaceRegistry();
    for (let id = 1; id <= MAX_REGISTERED_SURFACES; id += 1) {
      registry.register(id, 'bp', WORKSPACE_SURFACE_KIND);
    }
    expect(() => registry.register(MAX_REGISTERED_SURFACES + 1, 'bp', WORKSPACE_SURFACE_KIND))
      .toThrow(/capacity/);
  });
});
