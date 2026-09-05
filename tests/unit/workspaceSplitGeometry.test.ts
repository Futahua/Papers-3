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
      ['source', {
        outer: { left: 0, top: 0, width: 500, height: 440 },
        content: { left: 0, top: 40, width: 500, height: 400 },
      }],
      ['target', {
        outer: { left: 500, top: 0, width: 500, height: 440 },
        content: { left: 500, top: 40, width: 500, height: 400 },
      }],
    ]));
    expect(target).toEqual({ left: 0, top: 40, width: 1000, height: 400 });
    expect(splitPreviewRect(target!, 'right')).toEqual({ left: 500, top: 40, width: 500, height: 400 });
  });

  it('keeps the measured target when the source and target are the same group', () => {
    const measured = {
      outer: { left: 10, top: 20, width: 300, height: 240 },
      content: { left: 10, top: 60, width: 300, height: 200 },
    };
    expect(prospectiveTargetRectAfterSingletonRemoval(
      { kind: 'group', groupId: 'target' },
      'target',
      'target',
      new Map([['target', measured]]),
    )).toEqual(measured.content);
  });

  it('fails closed when an unrelated group has no trustworthy outer geometry', () => {
    const root = {
      kind: 'split' as const,
      orientation: 'vertical' as const,
      weights: [0.5, 0.5],
      children: [
        { kind: 'group' as const, groupId: 'source' },
        { kind: 'group' as const, groupId: 'target' },
      ],
    };
    expect(prospectiveTargetRectAfterSingletonRemoval(root, 'source', 'target', new Map([
      ['source', { outer: { left: 0, top: 0, width: 400, height: 300 }, content: { left: 0, top: 40, width: 400, height: 260 } }],
    ]))).toBeNull();
  });

  it('uses outer geometry for vertical stacks and nested mixed layouts', () => {
    const root = {
      kind: 'split' as const,
      orientation: 'horizontal' as const,
      weights: [0.25, 0.75],
      children: [
        { kind: 'group' as const, groupId: 'source' },
        {
          kind: 'split' as const,
          orientation: 'vertical' as const,
          weights: [0.5, 0.5],
          children: [
            { kind: 'group' as const, groupId: 'target' },
            { kind: 'group' as const, groupId: 'other' },
          ],
        },
      ],
    };
    const measured = new Map([
      ['source', { outer: { left: 0, top: 0, width: 250, height: 800 }, content: { left: 0, top: 40, width: 250, height: 760 } }],
      ['target', { outer: { left: 250, top: 0, width: 750, height: 400 }, content: { left: 250, top: 40, width: 750, height: 360 } }],
      ['other', { outer: { left: 250, top: 400, width: 750, height: 400 }, content: { left: 250, top: 440, width: 750, height: 360 } }],
    ]);
    const target = prospectiveTargetRectAfterSingletonRemoval(root, 'source', 'target', measured);
    expect(target).toEqual({ left: 0, top: 40, width: 1000, height: 360 });
  });
});
