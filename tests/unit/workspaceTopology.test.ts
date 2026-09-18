import { describe, expect, it } from 'vitest';

import {
  activateWorkspaceSurface,
  assertValidWorkspaceTopology,
  closeWorkspaceSurface,
  createWorkspaceTopology,
  insertWorkspaceSurface,
  openWorkspaceSurface,
  moveWorkspaceSurface,
  remapWorkspaceTopologySurfaceIds,
  reorderWorkspaceGroup,
  setRootWorkspaceSplitWeights,
  normalizeWorkspaceLayout,
  splitWorkspaceGroup,
  splitWorkspaceSurfaceAtTarget,
  activateWorkspaceSurfaceV2,
  closeWorkspaceSurfaceV2,
  migrateWorkspaceTopologyV1,
  openWorkspaceSurfaceV2,
  parseWorkspaceTopologyV2,
  insertWorkspaceSurfaceV2,
  moveWorkspaceSurfaceV2,
  reorderWorkspaceGroupV2,
  splitWorkspaceGroupV2,
  setWorkspaceLayoutRootV2,
  splitWorkspaceSurfaceAtTargetV2,
  setRootWorkspaceSplitWeightsV2,
} from '../../src/shared/workspaceTopology';
import type { WorkspaceTopologyV1 } from '../../src/shared/workspaceTopology';

describe('workspace topology', () => {
  it('inserts a cross-window surface at an explicit destination index', () => {
    let target = createWorkspaceTopology();
    target = openWorkspaceSurface(target, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    target = openWorkspaceSurface(target, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });

    const inserted = insertWorkspaceSurface(
      target,
      { surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved' },
      'group-main',
      1,
    );

    expect(inserted.groups[0]?.surfaceIds).toEqual(['sf-a', 'sf-moved', 'sf-b']);
    expect(inserted.groups[0]?.activeSurfaceId).toBe('sf-moved');
    expect(inserted.focusedGroupId).toBe('group-main');
    expect(() => insertWorkspaceSurface(inserted, {
      surfaceId: 'sf-moved', projectId: 'bp-other', title: 'Other',
    })).toThrow(/already exists/);
  });

  it('migrates v1 project topology losslessly and round-trips a foreign surface', () => {
    let v1 = createWorkspaceTopology();
    v1 = openWorkspaceSurface(v1, { surfaceId: 'project-a', surfaceKey: 'key-a', projectId: 'bp-a', title: 'A' });
    const migrated = migrateWorkspaceTopologyV1(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.groups).toEqual(v1.groups);
    expect(migrated.root).toEqual(v1.root);
    expect(migrated.focusedGroupId).toBe(v1.focusedGroupId);
    expect(migrated.surfaces).toEqual([{ kind: 'project', ...v1.surfaces[0] }]);

    const foreign = openWorkspaceSurfaceV2(migrated, {
      kind: 'foreign-window',
      surfaceId: 'foreign-notepad',
      surfaceKey: 'foreign-key',
      title: 'Notepad',
      descriptor: { version: 1, title: 'Untitled - Notepad', executableFingerprint: 'abc' },
    });
    const parsed = parseWorkspaceTopologyV2(JSON.parse(JSON.stringify(foreign)));
    expect(parsed.surfaces.find((surface) => surface.surfaceId === 'foreign-notepad')).toMatchObject({
      kind: 'foreign-window',
      title: 'Notepad',
    });
    expect(parsed.groups[0]?.surfaceIds).toEqual(['project-a', 'foreign-notepad']);
    expect(parsed.groups[0]?.activeSurfaceId).toBe('foreign-notepad');
  });

  it('activates and closes foreign surfaces using the same group geometry operations', () => {
    const base = migrateWorkspaceTopologyV1(createWorkspaceTopology());
    const withForeign = openWorkspaceSurfaceV2(base, {
      kind: 'foreign-window',
      surfaceId: 'foreign-a',
      title: 'Calculator',
      descriptor: { version: 1, title: 'Calculator' },
    });
    const activated = activateWorkspaceSurfaceV2(withForeign, 'foreign-a');
    expect(activated.groups[0]?.activeSurfaceId).toBe('foreign-a');
    const closed = closeWorkspaceSurfaceV2(activated, 'foreign-a');
    expect(closed.surfaces).toEqual([]);
    expect(closed.groups[0]?.surfaceIds).toEqual([]);
  });

  it('moves, reorders, splits, and preserves foreign surfaces without project ids', () => {
    let topology = migrateWorkspaceTopologyV1(createWorkspaceTopology());
    topology = openWorkspaceSurfaceV2(topology, {
      kind: 'foreign-window', surfaceId: 'foreign-a', title: 'Calculator',
      descriptor: { version: 1, title: 'Calculator' },
    });
    topology = insertWorkspaceSurfaceV2(topology, {
      kind: 'foreign-window', surfaceId: 'foreign-b', title: 'Notepad',
      descriptor: { version: 1, title: 'Untitled - Notepad' },
    });
    topology = reorderWorkspaceGroupV2(topology, 'group-main', ['foreign-b', 'foreign-a']);
    expect(topology.groups[0]?.surfaceIds).toEqual(['foreign-b', 'foreign-a']);

    topology = splitWorkspaceGroupV2(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'foreign-a',
      orientation: 'horizontal', position: 'after',
    });
    topology = moveWorkspaceSurfaceV2(topology, 'foreign-a', 'group-main', 0);
    expect(topology.groups).toEqual([
      { groupId: 'group-main', surfaceIds: ['foreign-a', 'foreign-b'], activeSurfaceId: 'foreign-a' },
    ]);
    expect(topology.surfaces.every((surface) => surface.kind === 'foreign-window')).toBe(true);

    const laidOut = setWorkspaceLayoutRootV2(topology, { kind: 'group', groupId: 'group-main' });
    expect(laidOut.root).toEqual({ kind: 'group', groupId: 'group-main' });
    expect(laidOut.surfaces).toEqual(topology.surfaces);
  });

  it('supports direct foreign-tab splits and durable root weights', () => {
    let topology = migrateWorkspaceTopologyV1(createWorkspaceTopology());
    topology = openWorkspaceSurfaceV2(topology, {
      kind: 'foreign-window', surfaceId: 'foreign-a', title: 'A', descriptor: { version: 1, title: 'A' },
    });
    topology = openWorkspaceSurfaceV2(topology, {
      kind: 'foreign-window', surfaceId: 'foreign-b', title: 'B', descriptor: { version: 1, title: 'B' },
    });
    topology = splitWorkspaceGroupV2(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'foreign-b', orientation: 'horizontal', position: 'after',
    });
    const split = splitWorkspaceSurfaceAtTargetV2(topology, {
      sourceGroupId: 'group-main', targetGroupId: 'group-right', newGroupId: 'group-bottom',
      surfaceId: 'foreign-a', orientation: 'vertical', position: 'after',
    });
    const weighted = setRootWorkspaceSplitWeightsV2(split, [2, 1]);
    expect(weighted.root).toMatchObject({ orientation: 'vertical', weights: [2 / 3, 1 / 3] });
    expect(weighted.surfaces.every((surface) => surface.kind === 'foreign-window')).toBe(true);
  });

  it('owns stable product identities without Dockview state', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });

    expect(topology.schemaVersion).toBe(1);
    expect(topology.groups[0]?.surfaceIds).toEqual(['sf-a', 'sf-b']);
    expect(topology.groups[0]?.activeSurfaceId).toBe('sf-b');
    expect(JSON.stringify(topology)).not.toMatch(/dockview/i);
    expect(() => assertValidWorkspaceTopology(topology)).not.toThrow();
  });

  it('activates a surface and its owning group', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = activateWorkspaceSurface(topology, 'sf-a');

    expect(topology.focusedGroupId).toBe('group-main');
    expect(topology.groups[0]?.activeSurfaceId).toBe('sf-a');
  });

  it('splits right or down using Papers groups and normalized weights', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main',
      newGroupId: 'group-right',
      surfaceId: 'sf-b',
      orientation: 'horizontal',
      position: 'after',
    });

    expect(topology.groups).toEqual([
      { groupId: 'group-main', surfaceIds: ['sf-a'], activeSurfaceId: 'sf-a' },
      { groupId: 'group-right', surfaceIds: ['sf-b'], activeSurfaceId: 'sf-b' },
    ]);
    expect(topology.root).toEqual({
      kind: 'split',
      orientation: 'horizontal',
      weights: [0.5, 0.5],
      children: [
        { kind: 'group', groupId: 'group-main' },
        { kind: 'group', groupId: 'group-right' },
      ],
    });
  });

  it('rejects duplicate surfaces and invalid split identities', () => {
    const topology = openWorkspaceSurface(
      createWorkspaceTopology(),
      { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' },
    );
    expect(() => openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-b', title: 'B' }))
      .toThrow(/already exists/);
    expect(() => splitWorkspaceGroup(topology, {
      groupId: 'group-main',
      newGroupId: 'group-right',
      surfaceId: 'sf-a',
      orientation: 'vertical',
      position: 'after',
    })).toThrow(/only surface/);
  });

  it('splits a measured target group when a tab comes from another group', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-b',
      orientation: 'horizontal', position: 'after',
    });
    const split = splitWorkspaceSurfaceAtTarget(topology, {
      sourceGroupId: 'group-main', targetGroupId: 'group-right', newGroupId: 'group-bottom',
      surfaceId: 'sf-a', orientation: 'vertical', position: 'after',
    });
    expect(split.groups).toEqual([
      { groupId: 'group-right', surfaceIds: ['sf-b'], activeSurfaceId: 'sf-b' },
      { groupId: 'group-bottom', surfaceIds: ['sf-a'], activeSurfaceId: 'sf-a' },
    ]);
    expect(split.root).toEqual({
      kind: 'split', orientation: 'vertical', weights: [0.5, 0.5],
      children: [
        { kind: 'group', groupId: 'group-right' }, { kind: 'group', groupId: 'group-bottom' },
      ],
    });
    expect(() => assertValidWorkspaceTopology(split)).not.toThrow();
  });

  it('reorders tabs and collapses an empty split group on close', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-c', projectId: 'bp-c', title: 'C' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-c',
      orientation: 'horizontal', position: 'after',
    });
    topology = moveWorkspaceSurface(topology, 'sf-b', 'group-main', 0);
    expect(topology.groups[0]?.surfaceIds).toEqual(['sf-b', 'sf-a']);

    topology = closeWorkspaceSurface(topology, 'sf-c');
    expect(topology.groups.map((group) => group.groupId)).toEqual(['group-main']);
    expect(topology.root).toEqual({ kind: 'group', groupId: 'group-main' });
    expect(topology.surfaces.map((surface) => surface.surfaceId)).toEqual(['sf-a', 'sf-b']);
  });

  it('collapses a source group when its final surface moves away', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-b',
      orientation: 'horizontal', position: 'after',
    });

    topology = moveWorkspaceSurface(topology, 'sf-b', 'group-main', 1);

    expect(topology.groups).toEqual([{
      groupId: 'group-main', surfaceIds: ['sf-a', 'sf-b'], activeSurfaceId: 'sf-b',
    }]);
    expect(topology.root).toEqual({ kind: 'group', groupId: 'group-main' });
  });

  it('commits exact tab order and normalized split weights', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'sf-b', projectId: 'bp-b', title: 'B' });
    topology = reorderWorkspaceGroup(topology, 'group-main', ['sf-b', 'sf-a']);
    expect(topology.groups[0]?.surfaceIds).toEqual(['sf-b', 'sf-a']);
    expect(() => reorderWorkspaceGroup(topology, 'group-main', ['sf-a'])).toThrow(/every surface/);

    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'sf-a',
      orientation: 'horizontal', position: 'after',
    });
    topology = setRootWorkspaceSplitWeights(topology, [3, 1]);
    expect(topology.root).toMatchObject({ weights: [0.75, 0.25] });
  });

  it('flattens same-axis nested splits while preserving proportional area', () => {
    expect(normalizeWorkspaceLayout({
      kind: 'split', orientation: 'horizontal', weights: [0.25, 0.75], children: [
        { kind: 'group', groupId: 'a' },
        { kind: 'split', orientation: 'horizontal', weights: [0.2, 0.8], children: [
          { kind: 'group', groupId: 'b' },
          { kind: 'group', groupId: 'c' },
        ] },
      ],
    })).toMatchObject({
      kind: 'split', orientation: 'horizontal', children: [
        { kind: 'group', groupId: 'a' },
        { kind: 'group', groupId: 'b' },
        { kind: 'group', groupId: 'c' },
      ],
    });
    const normalized = normalizeWorkspaceLayout({
      kind: 'split', orientation: 'horizontal', weights: [0.25, 0.75], children: [
        { kind: 'group', groupId: 'a' },
        { kind: 'split', orientation: 'horizontal', weights: [0.2, 0.8], children: [
          { kind: 'group', groupId: 'b' }, { kind: 'group', groupId: 'c' },
        ] },
      ],
    });
    expect(normalized.kind === 'split' ? normalized.weights : []).toEqual([0.25, 0.15, 0.6].map((weight) => expect.closeTo(weight, 10)));
  });

  it('renormalizes surviving sibling geometry after nested group removal', () => {
    const topology = {
      schemaVersion: 1 as const,
      surfaces: [
        { surfaceId: 'a', projectId: 'pa', title: 'A' },
        { surfaceId: 'b', projectId: 'pb', title: 'B' },
        { surfaceId: 'c', projectId: 'pc', title: 'C' },
      ],
      groups: [
        { groupId: 'a', surfaceIds: ['a'], activeSurfaceId: 'a' },
        { groupId: 'b', surfaceIds: ['b'], activeSurfaceId: 'b' },
        { groupId: 'c', surfaceIds: ['c'], activeSurfaceId: 'c' },
      ],
      root: { kind: 'split' as const, orientation: 'horizontal' as const, weights: [0.2, 0.3, 0.5], children: [
        { kind: 'group' as const, groupId: 'a' }, { kind: 'group' as const, groupId: 'b' }, { kind: 'group' as const, groupId: 'c' },
      ] },
      focusedGroupId: 'a',
    } satisfies WorkspaceTopologyV1;
    const closed = closeWorkspaceSurface(topology, 'b');
    expect(closed.root.kind).toBe('split');
    if (closed.root.kind === 'split') {
      expect(closed.root.weights[0]).toBeCloseTo(2 / 7, 10);
      expect(closed.root.weights[1]).toBeCloseTo(5 / 7, 10);
    }
  });

  it('purely remaps split surface identity while preserving project and layout semantics', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'old-a', projectId: 'bp-same', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'old-b', projectId: 'bp-same', title: 'B' });
    topology = splitWorkspaceGroup(topology, {
      groupId: 'group-main', newGroupId: 'group-right', surfaceId: 'old-b',
      orientation: 'vertical', position: 'after',
    });
    topology = setRootWorkspaceSplitWeights(topology, [1, 3]);
    const remapped = remapWorkspaceTopologySurfaceIds(topology, new Map([
      ['old-a', 'fresh-x'], ['old-b', 'fresh-y'],
    ]));
    expect(remapped.surfaces.map((surface) => [surface.surfaceId, surface.projectId]))
      .toEqual([['fresh-x', 'bp-same'], ['fresh-y', 'bp-same']]);
    expect(remapped.surfaces.map((surface) => surface.surfaceKey))
      .toEqual(['old-a', 'old-b']);
    expect(remapped.groups.map((group) => [group.groupId, group.surfaceIds, group.activeSurfaceId]))
      .toEqual([['group-main', ['fresh-x'], 'fresh-x'], ['group-right', ['fresh-y'], 'fresh-y']]);
    expect(remapped.root).toEqual(topology.root);
    expect(remapped.focusedGroupId).toBe(topology.focusedGroupId);
    expect(() => assertValidWorkspaceTopology(remapped)).not.toThrow();
  });

  it('refuses incomplete, extra, duplicate or empty fresh surface mappings', () => {
    let topology = createWorkspaceTopology();
    topology = openWorkspaceSurface(topology, { surfaceId: 'old-a', projectId: 'bp-a', title: 'A' });
    topology = openWorkspaceSurface(topology, { surfaceId: 'old-b', projectId: 'bp-b', title: 'B' });
    expect(() => remapWorkspaceTopologySurfaceIds(topology, new Map([['old-a', 'fresh-a']]))).toThrow(/every persisted/);
    expect(() => remapWorkspaceTopologySurfaceIds(topology, new Map([
      ['old-a', 'fresh-a'], ['old-b', 'fresh-b'], ['old-extra', 'fresh-c'],
    ]))).toThrow(/every persisted/);
    expect(() => remapWorkspaceTopologySurfaceIds(topology, new Map([
      ['old-a', 'fresh'], ['old-b', 'fresh'],
    ]))).toThrow(/unique/);
    expect(() => remapWorkspaceTopologySurfaceIds(topology, new Map([
      ['old-a', 'fresh-a'], ['old-b', ''],
    ]))).toThrow(/non-empty/);
  });
});
