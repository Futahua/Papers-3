import { describe, expect, it } from 'vitest';

import {
  prospectiveTargetRectAfterSingletonRemoval,
  splitPreviewRect,
} from '../../src/host/workspaceSplitGeometry';

describe('workspace split preview geometry', () => {
  it('expands the target into a singleton source group before splitting it', () => {
    const root = {
      kind: 'split' as const,
      orientation: 'horizontal' as const,
      weights: [0.5, 0.5],
      children: [
        { kind: 'group' as const, groupId: 'source' },
        { kind: 'group' as const, groupId: 'target' },
      ],
    };
    const target = prospectiveTargetRectAfterSingletonRemoval(root, 'source', 'target', new Map([
      ['source', { left: 0, top: 0, width: 500, height: 400 }],
      ['target', { left: 500, top: 0, width: 500, height: 400 }],
    ]));
    expect(target).toEqual({ left: 0, top: 0, width: 1000, height: 400 });
    expect(splitPreviewRect(target!, 'right')).toEqual({ left: 500, top: 0, width: 500, height: 400 });
  });

  it('keeps the measured target when the source and target are the same group', () => {
    const measured = { left: 10, top: 20, width: 300, height: 200 };
    expect(prospectiveTargetRectAfterSingletonRemoval(
      { kind: 'group', groupId: 'target' },
      'target',
      'target',
      new Map([['target', measured]]),
    )).toEqual(measured);
  });
});
