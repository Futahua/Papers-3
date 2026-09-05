import { describe, expect, it } from 'vitest';

import { isCurrentArmedSplitCandidate } from '../../src/host/WorkspaceDock';

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
});
