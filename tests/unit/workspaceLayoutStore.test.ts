import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LoadReport } from '../../src/main/persistence/atomicStore';
import { papersPaths } from '../../src/main/persistence/paths';
import { WorkspaceLayoutStore } from '../../src/main/persistence/workspaceLayoutStore';
import { createWorkspaceTopology, openWorkspaceSurface } from '../../src/shared/workspaceTopology';

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-layout-store-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function topology(projectId = 'bp-alpha') {
  return openWorkspaceSurface(createWorkspaceTopology(), {
    surfaceId: 'surface-alpha', projectId, title: 'Alpha',
  });
}

describe('WorkspaceLayoutStore', () => {
  it('creates, clones and reloads an app-level named layout atomically', async () => {
    const paths = papersPaths(baseDir);
    const store = new WorkspaceLayoutStore(paths, () => '2026-09-01T00:00:00.000Z');
    const created = await store.create('  Work  ', topology());

    expect(created).toMatchObject({
      name: 'Work',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(created.layoutId).toMatch(/^[0-9a-f-]{36}$/i);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    listed[0]!.topology.surfaces[0]!.title = 'mutated clone';
    expect((await store.get(created.layoutId))?.topology.surfaces[0]?.title).toBe('Alpha');

    const restarted = new WorkspaceLayoutStore(paths);
    await expect(restarted.get(created.layoutId)).resolves.toMatchObject({ name: 'Work' });
    const persistedText = await fs.readFile(paths.workspaceLayoutsFile, 'utf8');
    expect(persistedText).not.toMatch(/workspaceId|windowId|webContents|sender|papers-backpack:/i);
  });

  it('serializes concurrent creates and rejects duplicate normalized names', async () => {
    const store = new WorkspaceLayoutStore(papersPaths(baseDir));
    const created = await Promise.all([
      store.create('Alpha', topology('bp-alpha')),
      store.create('Beta', topology('bp-beta')),
    ]);
    expect(new Set(created.map((layout) => layout.layoutId)).size).toBe(2);
    await expect(store.create(' alpha ', topology())).rejects.toThrow(/already exists/i);
    expect(await store.list()).toHaveLength(2);
  });

  it('rejects empty and overlong names without changing the store', async () => {
    const paths = papersPaths(baseDir);
    const store = new WorkspaceLayoutStore(paths);
    await expect(store.create('   ', topology())).rejects.toThrow(/empty/i);
    await expect(store.create('x'.repeat(121), topology())).rejects.toThrow(/long/i);
    expect(await store.list()).toEqual([]);
    await expect(fs.access(paths.workspaceLayoutsFile)).rejects.toThrow();
  });

  it('quarantines malformed duplicate-name layout state', async () => {
    const paths = papersPaths(baseDir);
    await fs.mkdir(paths.root, { recursive: true });
    const entry = {
      layoutId: '11111111-1111-4111-8111-111111111111',
      name: 'Work',
      topology: topology(),
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    await fs.writeFile(paths.workspaceLayoutsFile, JSON.stringify({
      schemaVersion: 1,
      layouts: [entry, { ...entry, layoutId: '22222222-2222-4222-8222-222222222222', name: ' work ' }],
    }));

    const store = new WorkspaceLayoutStore(paths);
    await expect(store.list()).resolves.toEqual([]);
    const recovered = await fs.readdir(paths.recoveryDir);
    expect(recovered.some((name) => name.startsWith('workspace-layouts.json.') && name.endsWith('.corrupt'))).toBe(true);
  });

  it('does not leave an in-memory phantom when durable creation fails', async () => {
    const persistence = {
      load: async <T>(): Promise<LoadReport<T>> => ({
        value: null, source: 'missing', quarantinedPath: null, corruptionDetail: null,
      }),
      save: vi.fn(async () => { throw new Error('disk unavailable'); }),
    };
    const store = new WorkspaceLayoutStore(
      papersPaths(baseDir),
      () => '2026-09-01T00:00:00.000Z',
      persistence,
    );

    await expect(store.create('Work', topology())).rejects.toThrow(/disk unavailable/);
    expect(await store.list()).toEqual([]);
    expect(persistence.save).toHaveBeenCalledTimes(1);
  });
});
