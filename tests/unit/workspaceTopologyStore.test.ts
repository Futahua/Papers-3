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
  it('serializes and coalesces validated Papers topology snapshots by stable workspace key', async () => {
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
      schemaVersion: number;
      workspaces: Array<{ workspaceKey: string; topology: typeof opened }>;
    };
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.workspaces.find((entry) => entry.workspaceKey === keyA)?.topology).toEqual(opened);
    expect(persisted.workspaces.find((entry) => entry.workspaceKey === keyB)?.topology).toEqual(empty);
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
});
