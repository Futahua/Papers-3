import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { AtomicJsonStore } from '../../src/main/persistence/atomicStore';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-store-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeStore(validate?: (v: unknown) => string | null) {
  return new AtomicJsonStore(path.join(dir, 'state.json'), {
    recoveryDir: path.join(dir, 'recovery'),
    validate,
  });
}

describe('AtomicJsonStore', () => {
  it('returns missing for a nonexistent file', async () => {
    const report = await makeStore().load();
    expect(report.source).toBe('missing');
    expect(report.value).toBeNull();
  });

  it('round-trips saved values', async () => {
    const store = makeStore();
    await store.save({ schemaVersion: 1, items: ['a'] });
    const report = await store.load<{ schemaVersion: number; items: string[] }>();
    expect(report.source).toBe('main');
    expect(report.value).toEqual({ schemaVersion: 1, items: ['a'] });
  });

  it('preserves unknown fields round-tripped through load/save', async () => {
    const store = makeStore();
    await store.save({ schemaVersion: 1, futureField: { nested: true } });
    const report = await store.load<Record<string, unknown>>();
    expect(report.value?.futureField).toEqual({ nested: true });
  });

  it('quarantines corrupt main file and restores from backup', async () => {
    const store = makeStore();
    await store.save({ schemaVersion: 1, generation: 1 });
    await store.save({ schemaVersion: 1, generation: 2 });
    // Corrupt the main file out-of-band.
    await fs.writeFile(path.join(dir, 'state.json'), '{ this is not JSON', 'utf8');

    const report = await store.load<{ generation: number }>();
    expect(report.source).toBe('backup');
    // Backup holds the previous good generation.
    expect(report.value?.generation).toBe(1);
    expect(report.quarantinedPath).toContain('recovery');
    // Quarantined file is retained, not deleted.
    const recovered = await fs.readdir(path.join(dir, 'recovery'));
    expect(recovered.some((f) => f.endsWith('.corrupt'))).toBe(true);
    // The restored value now loads from main.
    const second = await store.load<{ generation: number }>();
    expect(second.source).toBe('main');
  });

  it('quarantines values failing validation', async () => {
    const validate = (v: unknown) =>
      typeof v === 'object' && v !== null && (v as { schemaVersion?: unknown }).schemaVersion === 1
        ? null
        : 'wrong schemaVersion';
    const store = makeStore(validate);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8');

    const report = await store.load();
    expect(report.value).toBeNull();
    expect(report.corruptionDetail).toContain('failed validation');
  });

  it('does not leave temp files behind after save', async () => {
    const store = makeStore();
    await store.save({ schemaVersion: 1 });
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
});
