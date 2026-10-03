import { describe, expect, it } from 'vitest';

import { rebuildWorkspaceGroupMap } from '../../src/host/workspaceGroupMapping';

describe('workspace Dockview group mapping', () => {
  it('preserves known group identity while topology state trails a committed move', () => {
    const previous = new Map([['dock-target', 'papers-target'], ['dock-source', 'papers-source']]);
    const result = rebuildWorkspaceGroupMap(previous, [
      { id: 'dock-target', panelIds: ['b', 'a'] },
      { id: 'dock-source', panelIds: ['c', 'd'] },
    ], [
      { groupId: 'papers-target', surfaceIds: ['b'], activeSurfaceId: 'b' },
      { groupId: 'papers-source', surfaceIds: ['a', 'c', 'd'], activeSurfaceId: 'a' },
    ]);

    expect(result).toEqual(previous);
  });

  it('drops dead mappings and maps only genuinely new groups', () => {
    const result = rebuildWorkspaceGroupMap(new Map([['dock-dead', 'papers-dead']]), [
      { id: 'dock-main', panelIds: ['a'] },
    ], [
      { groupId: 'papers-main', surfaceIds: ['a'], activeSurfaceId: 'a' },
    ]);
    expect([...result]).toEqual([['dock-main', 'papers-main']]);
  });

  it('drops a surviving dock id when its panels no longer overlap the canonical group', () => {
    const result = rebuildWorkspaceGroupMap(new Map([['dock-shared', 'papers-a']]), [
      { id: 'dock-shared', panelIds: ['b'] },
      { id: 'dock-b', panelIds: ['b'] },
    ], [
      { groupId: 'papers-a', surfaceIds: ['a'], activeSurfaceId: 'a' },
      { groupId: 'papers-b', surfaceIds: ['b'], activeSurfaceId: 'b' },
    ]);
    expect([...result]).toEqual([['dock-shared', 'papers-b']]);
  });
});
