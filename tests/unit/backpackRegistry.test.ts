import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { BackpackRegistry } from '../../src/main/backpacks/backpackRegistry';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-registry-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function freshRegistry(): Promise<BackpackRegistry> {
  const registry = new BackpackRegistry(dir);
  await registry.initialize();
  return registry;
}

describe('BackpackRegistry', () => {
  it('creates, lists, renames, archives', async () => {
    const registry = await freshRegistry();
    const created = await registry.create('Research', 'canvas');
    expect(created.id).toMatch(/^bp-/);

    await registry.rename(created.id, 'Deep Research');
    await registry.setArchived(created.id, true);

    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Deep Research');
    expect(listed[0]?.archived).toBe(true);
  });

  it('persists across instances (restart restoration)', async () => {
    const first = await freshRegistry();
    const created = await first.create('Persistent', 'canvas');
    await first.markEntered(created.id);

    const second = await freshRegistry();
    expect(second.list()).toHaveLength(1);
    expect(second.lastActiveBackpackId).toBe(created.id);
  });

  it('associates an optional desktop workspace without redefining the Backpack', async () => {
    const first = await freshRegistry();
    const created = await first.create('Writing', 'environment');
    await first.setWorkspace(created.id, 'D:\\Letters\\Writing');

    const second = await freshRegistry();
    expect(second.find(created.id)?.workspacePath).toBe('D:\\Letters\\Writing');
    await second.setWorkspace(created.id, null);
    expect(second.find(created.id)?.workspacePath).toBeNull();
  });

  it('clears last-active when leaving and when archiving the active backpack', async () => {
    const registry = await freshRegistry();
    const created = await registry.create('Active', 'canvas');
    await registry.markEntered(created.id);
    expect(registry.lastActiveBackpackId).toBe(created.id);

    await registry.markLeft();
    expect(registry.lastActiveBackpackId).toBeNull();

    await registry.markEntered(created.id);
    await registry.setArchived(created.id, true);
    expect(registry.lastActiveBackpackId).toBeNull();
  });

  it('rejects entering an archived backpack', async () => {
    const registry = await freshRegistry();
    const created = await registry.create('Archived', 'canvas');
    await registry.setArchived(created.id, true);
    await expect(registry.markEntered(created.id)).rejects.toThrow(/archived/);
  });

  it('removes only an archived Backpack and preserves its internal record in recovery', async () => {
    const registry = await freshRegistry();
    const kept = await registry.create('Keep', 'environment');
    const removed = await registry.create('Remove', 'environment');

    await expect(registry.remove(removed.id)).rejects.toThrow(/archive/i);
    await registry.setArchived(removed.id, true);
    await registry.remove(removed.id);

    expect(registry.list().map((backpack) => backpack.id)).toEqual([kept.id]);
    await expect(fs.access(path.join(dir, 'PapersData', 'backpacks', removed.id))).rejects.toThrow();

    const deletedDir = path.join(dir, 'PapersData', 'recovery', 'deleted-backpacks');
    const preserved = (await fs.readdir(deletedDir)).find((name) => name.startsWith(`${removed.id}-`));
    expect(preserved).toBeDefined();
    await expect(fs.access(path.join(deletedDir, preserved!, 'backpack.json'))).resolves.toBeUndefined();

    const restarted = await freshRegistry();
    expect(restarted.find(removed.id)).toBeNull();
    expect(restarted.find(kept.id)?.name).toBe('Keep');
  });

  it('rejects a traversal-shaped id before it can form a filesystem path', async () => {
    const registry = await freshRegistry();
    const sentinel = path.join(dir, 'sentinel.txt');
    await fs.writeFile(sentinel, 'untouched');

    await expect(registry.remove('../../sentinel')).rejects.toThrow(/invalid Backpack id/i);
    await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('untouched');
  });

  it('recovers from a corrupt registry file via backup', async () => {
    const first = await freshRegistry();
    await first.create('One', 'canvas');
    await first.create('Two', 'canvas');
    const registryFile = path.join(dir, 'PapersData', 'registry.json');
    await fs.writeFile(registryFile, 'corrupt!!', 'utf8');

    const second = new BackpackRegistry(dir);
    const report = await second.initialize();
    expect(report.source).toBe('backup');
    // Backup was taken before the second create persisted.
    expect(second.list().length).toBeGreaterThanOrEqual(1);
    expect(report.quarantinedPath).not.toBeNull();
  });
});
