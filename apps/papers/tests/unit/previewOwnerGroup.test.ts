import { describe, expect, it, vi } from 'vitest';

import { createPreviewOwnerGroup } from '../../src/main/backpacks/previewOwnerGroup';

function provider({ raise = true } = {}) {
  return {
    closeOwner: vi.fn(),
    setOwnerVisible: vi.fn(),
    setOwnerSurfaceBounds: vi.fn(),
    ...(raise ? { raiseWindow: vi.fn() } : {}),
  };
}

describe('preview owner group', () => {
  it('fans owner presentation lifecycle to every registered provider', () => {
    const first = provider();
    const second = provider({ raise: false });
    const group = createPreviewOwnerGroup([first, null, second]);
    const bounds = { x: 1, y: 2, width: 300, height: 200 };

    group.setOwnerVisible('1:S1', false);
    group.setOwnerSurfaceBounds('1:S1', bounds);
    group.closeOwner('1:S1');
    group.raiseWindow(1);

    for (const item of [first, second]) {
      expect(item.setOwnerVisible).toHaveBeenCalledWith('1:S1', false);
      expect(item.setOwnerSurfaceBounds).toHaveBeenCalledWith('1:S1', bounds);
      expect(item.closeOwner).toHaveBeenCalledWith('1:S1');
    }
    expect(first.raiseWindow).toHaveBeenCalledWith(1);
  });

  it('is inert with no providers instead of inventing a fallback owner', () => {
    const group = createPreviewOwnerGroup([]);
    expect(() => {
      group.setOwnerVisible('1:S1', true);
      group.setOwnerSurfaceBounds('1:S1', { x: 0, y: 0, width: 1, height: 1 });
      group.closeOwner('1:S1');
      group.raiseWindow(1);
    }).not.toThrow();
  });
});
