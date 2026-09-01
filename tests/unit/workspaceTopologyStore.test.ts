import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceTopologyStore } from '../../src/main/persistence/workspaceTopologyStore';
import { papersPaths } from '../../src/main/persistence/paths';
import { createWorkspaceTopology, openWorkspaceSurface } from '../../src/shared/workspaceTopology';

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-workspace-topology-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('WorkspaceTopologyStore', () => {
  it('reuses durable workspace ids across commits and records last selection metadata', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const empty = createWorkspaceTopology();
    const opened = openWorkspaceSurface(empty, { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    const keyA = '11111111-1111-4111-8111-111111111111';
    const keyB = '22222222-2222-4222-8222-222222222222';

    await Promise.all([
      store.commit(keyA, empty),
      store.commit(keyA, opened),
      store.commit(keyB, empty),
    ]);

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      schemaVersion: number; lastWorkspaceId: string;
      workspaces: Array<{ workspaceId: string; topology: typeof opened; updatedAt: string }>;
    };
    expect(persisted.schemaVersion).toBe(2);
    expect(persisted.lastWorkspaceId).toBe(keyB);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === keyA)?.topology).toEqual(opened);
    expect(persisted.workspaces.filter((entry) => entry.workspaceId === keyA)).toHaveLength(1);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === keyB)?.topology).toEqual(empty);
    const selected = await store.selectedSnapshot();
    expect(selected).toMatchObject({ workspaceId: keyB, topology: empty });
    if (selected) selected.topology.groups[0]!.groupId = 'mutated-copy';
    expect((await store.selectedSnapshot())?.topology.groups[0]?.groupId).toBe('group-main');
  });

  it('returns no selected snapshot when selection metadata is null', async () => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 2, lastWorkspaceId: null, workspaces: [] }));
    await expect(new WorkspaceTopologyStore(paths).selectedSnapshot()).resolves.toBeNull();
  });

  it('commits both workspace records atomically without changing startup selection', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths, () => '2026-09-02T00:00:00.000Z');
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    const source = openWorkspaceSurface(createWorkspaceTopology(), {
      surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source',
    });
    const target = createWorkspaceTopology('target-group');
    await store.commit(sourceId, source);
    await store.commit(targetId, target);

    await store.commitPair({
      source: { workspaceId: sourceId, topology: createWorkspaceTopology() },
      target: { workspaceId: targetId, topology: openWorkspaceSurface(target, {
        surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source',
      }) },
      lastWorkspaceId: sourceId,
    });

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      lastWorkspaceId: string;
      workspaces: Array<{ workspaceId: string; topology: typeof source }>;
    };
    expect(persisted.lastWorkspaceId).toBe(sourceId);
    expect(persisted.workspaces).toHaveLength(2);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === sourceId)?.topology.surfaces).toEqual([]);
    expect(persisted.workspaces.find((entry) => entry.workspaceId === targetId)?.topology.surfaces)
      .toEqual([{ surfaceId: 'sf-source', projectId: 'bp-source', title: 'Source' }]);
  });

  it('restores a pair and removes a newly minted target workspace on compensation', async () => {
    const paths = papersPaths(directory);
    const store = new WorkspaceTopologyStore(paths);
    const sourceId = '33333333-3333-4333-8333-333333333333';
    const targetId = '44444444-4444-4444-8444-444444444444';
    const original = createWorkspaceTopology();
    await store.commit(sourceId, original);
    const before = await store.snapshotPair(sourceId, targetId);

    await store.commitPair({
      source: { workspaceId: sourceId, topology: openWorkspaceSurface(original, {
        surfaceId: 'sf-moved', projectId: 'bp-moved', title: 'Moved',
      }) },
      target: { workspaceId: targetId, topology: createWorkspaceTopology('target') },
      lastWorkspaceId: sourceId,
    });
    await store.restorePairWithIds(before, sourceId, targetId);

    const persisted = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      workspaces: Array<{ workspaceId: string; topology: typeof original }>;
    };
    expect(persisted.workspaces.map((entry) => entry.workspaceId)).toEqual([sourceId]);
    expect(persisted.workspaces[0]?.topology).toEqual(original);
  });

  it('quarantines structurally invalid persisted topology instead of consuming it', async () => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 1, workspaces: [{ workspaceKey: 'bad' }] }));

    const store = new WorkspaceTopologyStore(paths);
    await expect(store.initialize()).resolves.toBeUndefined();
    const recovered = await fs.readdir(paths.recoveryDir);
    expect(recovered.some((name) => name.includes('workspace-topologies.json') && name.endsWith('.corrupt'))).toBe(true);
  });

  it('quarantines topology that is shaped correctly but violates cross-field invariants', async () => {
    const paths = papersPaths(directory);
    const valid = openWorkspaceSurface(createWorkspaceTopology(), { surfaceId: 'sf-a', projectId: 'bp-a', title: 'A' });
    const invalid = { ...valid, groups: [{ ...valid.groups[0]!, surfaceIds: ['sf-a', 'sf-a'] }] };
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({
      schemaVersion: 1,
      workspaces: [{ workspaceKey: '11111111-1111-4111-8111-111111111111', topology: invalid }],
    }));
    const store = new WorkspaceTopologyStore(paths);
    await expect(store.initialize()).resolves.toBeUndefined();
    expect((await fs.readdir(paths.recoveryDir)).some((name) => name.endsWith('.corrupt'))).toBe(true);
  });

  it('migrates v1 lifetime keys to fresh explicit durable identities', async () => {
    const paths = papersPaths(directory);
    const topology = createWorkspaceTopology();
    const legacyKey = '11111111-1111-4111-8111-111111111111';
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({
      schemaVersion: 1, workspaces: [{ workspaceKey: legacyKey, topology }],
    }));
    const store = new WorkspaceTopologyStore(paths, () => '2026-09-01T00:00:00.000Z');
    await store.initialize();
    const migrated = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as {
      schemaVersion: number; lastWorkspaceId: string; workspaces: Array<{ workspaceId: string; updatedAt: string }>;
    };
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.workspaces[0]?.workspaceId).not.toBe(legacyKey);
    expect(migrated.lastWorkspaceId).toBe(migrated.workspaces[0]?.workspaceId);
    expect(migrated.workspaces[0]?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not invent last-workspace selection when migrating multiple legacy snapshots', async () => {
    const paths = papersPaths(directory);
    const topology = createWorkspaceTopology();
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify({ schemaVersion: 1, workspaces: [
      { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
      { workspaceKey: '22222222-2222-4222-8222-222222222222', topology },
    ] }));
    await new WorkspaceTopologyStore(paths).initialize();
    const migrated = JSON.parse(await fs.readFile(paths.workspaceTopologiesFile, 'utf8')) as { lastWorkspaceId: string | null };
    expect(migrated.lastWorkspaceId).toBeNull();
  });

  it.each([
    ['duplicate durable ids', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 2, lastWorkspaceId: null, workspaces: [
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
      ],
    })],
    ['orphan last workspace id', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 2, lastWorkspaceId: '22222222-2222-4222-8222-222222222222', workspaces: [
        { workspaceId: '11111111-1111-4111-8111-111111111111', topology, updatedAt: '2026-09-01T00:00:00.000Z' },
      ],
    })],
    ['duplicate legacy keys', (topology: ReturnType<typeof createWorkspaceTopology>) => ({
      schemaVersion: 1, workspaces: [
        { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
        { workspaceKey: '11111111-1111-4111-8111-111111111111', topology },
      ],
    })],
  ])('quarantines %s instead of collapsing relationally invalid identity', async (_name, envelope) => {
    const paths = papersPaths(directory);
    await fs.mkdir(path.dirname(paths.workspaceTopologiesFile), { recursive: true });
    await fs.writeFile(paths.workspaceTopologiesFile, JSON.stringify(envelope(createWorkspaceTopology())));
    await new WorkspaceTopologyStore(paths).initialize();
    expect((await fs.readdir(paths.recoveryDir)).some((name) => name.endsWith('.corrupt'))).toBe(true);
  });
});
