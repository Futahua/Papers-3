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
