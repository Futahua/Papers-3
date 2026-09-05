import { describe, expect, it } from 'vitest';

import { isCurrentArmedSplitCandidate, resolveContentSplitEdge } from '../../src/host/WorkspaceDock';

describe('workspace split arm authority', () => {
  it('rejects an acknowledged right edge after right-to-bottom-to-right re-entry', () => {
    const candidate = {
      surfaceId: 'surface-a',
      position: 'right' as const,
      targetGroupId: 'group-a',
      generation: 10,
    };
    const tuple = { surfaceId: 'surface-a', position: 'right' as const, targetGroupId: 'group-a' };

    expect(isCurrentArmedSplitCandidate(candidate, tuple, 10)).toBe(true);

    // The pointer leaves right for bottom (generation 11), then returns to
    // right before that new candidate reaches the host acknowledgement/RAF
    // barrier (generation 12). The old right arm must not authorize it.
    expect(isCurrentArmedSplitCandidate(candidate, { ...tuple, position: 'bottom' }, 11)).toBe(false);
    expect(isCurrentArmedSplitCandidate(candidate, tuple, 12)).toBe(false);
    expect(isCurrentArmedSplitCandidate(candidate, { ...tuple, targetGroupId: 'group-b' }, 10)).toBe(false);
  });

  it('resolves content-center drops to a real edge from source/target geometry', () => {
    const group = (left: number, top: number) => ({
      element: { getBoundingClientRect: () => ({ left, top, width: 100, height: 100, right: left + 100, bottom: top + 100 }) } as HTMLElement,
    });
    const target = group(300, 300);
    expect(resolveContentSplitEdge('center', group(450, 300), target)).toBe('right');
    expect(resolveContentSplitEdge('center', group(150, 300), target)).toBe('left');
    expect(resolveContentSplitEdge('center', group(300, 450), target)).toBe('bottom');
    expect(resolveContentSplitEdge('center', group(300, 150), target)).toBe('top');
    expect(resolveContentSplitEdge('center', target, target, { clientX: 395, clientY: 350 } as MouseEvent)).toBe('right');
    expect(resolveContentSplitEdge('center', target, target, { clientX: 305, clientY: 350 } as MouseEvent)).toBe('left');
  });
});
