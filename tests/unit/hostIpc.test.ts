import { describe, expect, it } from 'vitest';

import { hostWorkspaceSurfaceMoveTargetSchema } from '../../src/main/ipc/hostIpc';

describe('authenticated host workspace-move IPC shape', () => {
  it('accepts only the logical surface and explicit destination fields', () => {
    expect(hostWorkspaceSurfaceMoveTargetSchema.parse({
      surfaceId: 'sf-moved', targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    })).toEqual({
      surfaceId: 'sf-moved', targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    });
  });

  it('rejects a renderer-supplied source window', () => {
    expect(() => hostWorkspaceSurfaceMoveTargetSchema.parse({
      surfaceId: 'sf-moved', sourceWindowId: 99,
      targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    })).toThrow();
  });
});
