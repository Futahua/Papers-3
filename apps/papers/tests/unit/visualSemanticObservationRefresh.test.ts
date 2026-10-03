import { describe, expect, it, vi } from 'vitest';

import { refreshCurrentVisualSemanticKeys } from '../../src/main/visual/visualSemanticObservationRefresh';

describe('current visual semantic observation refresh', () => {
  function createDeps(overrides: Partial<Parameters<typeof refreshCurrentVisualSemanticKeys>[0]> = {}) {
    const refreshVisualSemanticKeys = vi.fn();
    const bindSender = vi.fn();
    const deps: Parameters<typeof refreshCurrentVisualSemanticKeys>[0] = {
      isLiveIn: () => true,
      runtimeForSurface: () => ({ senderId: 42, refreshVisualSemanticKeys }),
      contextForSender: () => ({ windowId: 7, surfaceId: 'surface-a' }),
      bindSender,
      ...overrides,
    };
    return { deps, refreshVisualSemanticKeys, bindSender };
  }

  it('rebinds the current exact sender before refreshing a restored generation', () => {
    const { deps, refreshVisualSemanticKeys, bindSender } = createDeps();

    expect(refreshCurrentVisualSemanticKeys(deps, 7, 'surface-a')).toBe(true);
    expect(bindSender).toHaveBeenCalledWith(7, 'surface-a', 42);
    expect(refreshVisualSemanticKeys).toHaveBeenCalledTimes(1);
  });

  it('fails closed without refreshing a foreign or non-live target', () => {
    const foreign = createDeps({
      contextForSender: () => ({ windowId: 8, surfaceId: 'surface-a' }),
    });
    expect(refreshCurrentVisualSemanticKeys(foreign.deps, 7, 'surface-a')).toBe(false);
    expect(foreign.bindSender).not.toHaveBeenCalled();
    expect(foreign.refreshVisualSemanticKeys).not.toHaveBeenCalled();

    const retired = createDeps({ isLiveIn: () => false });
    expect(refreshCurrentVisualSemanticKeys(retired.deps, 7, 'surface-a')).toBe(false);
    expect(retired.bindSender).not.toHaveBeenCalled();
    expect(retired.refreshVisualSemanticKeys).not.toHaveBeenCalled();
  });

  it('swallows a renderer refresh failure after preserving the authority checks', () => {
    const failed = createDeps({
      runtimeForSurface: () => ({
        senderId: 42,
        refreshVisualSemanticKeys: () => { throw new Error('renderer unavailable'); },
      }),
    });

    expect(() => refreshCurrentVisualSemanticKeys(failed.deps, 7, 'surface-a')).not.toThrow();
    expect(refreshCurrentVisualSemanticKeys(failed.deps, 7, 'surface-a')).toBe(false);
    expect(failed.bindSender).toHaveBeenCalledWith(7, 'surface-a', 42);
  });
});
