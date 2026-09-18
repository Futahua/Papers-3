import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createAdoptedWindowRecoveryJournal,
  recoverAdoptedWindows,
} from '../../src/main/windows/adoptedWindowRecoveryJournal';
import type { WindowRuntimeCapability } from '../../src/main/windows/windowCapabilityService';

const descriptor = { version: 1 as const, title: 'Notepad', executableFingerprint: 'abc' };
const bounds = { x: 20, y: 30, width: 400, height: 300 };
const capability: WindowRuntimeCapability = { version: 1, bindingId: 'fresh' };

describe('adopted window recovery journal', () => {
  it('arms and clears entries with atomic durable snapshots', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'papers-adopted-recovery-'));
    try {
      const file = path.join(dir, 'recovery.json');
      const journal = createAdoptedWindowRecoveryJournal(file);
      await journal.arm({ recoveryId: 'r1', descriptor, originalBounds: bounds, recordedAt: 1 });
      expect(journal.entries()).toEqual([{ version: 1, recoveryId: 'r1', descriptor, originalBounds: bounds, recordedAt: 1 }]);
      expect(JSON.parse(await readFile(file, 'utf8')).entries).toHaveLength(1);
      await journal.clear('r1');
      expect(journal.entries()).toEqual([]);
      expect(JSON.parse(await readFile(file, 'utf8')).entries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores malformed entries without preventing valid recovery', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'papers-adopted-recovery-'));
    try {
      const file = path.join(dir, 'recovery.json');
      await writeFile(file, JSON.stringify({ version: 1, entries: [
        { version: 1, recoveryId: 'bad', descriptor: { version: 1 }, originalBounds: bounds, recordedAt: 1 },
        { version: 1, recoveryId: 'good', descriptor, originalBounds: bounds, recordedAt: 2 },
      ] }));
      const journal = createAdoptedWindowRecoveryJournal(file);
      expect(journal.entries().map((entry) => entry.recoveryId)).toEqual(['good']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('restores uniquely resolved windows and keeps ambiguous/helper failures', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'papers-adopted-recovery-'));
    try {
      const file = path.join(dir, 'recovery.json');
      const journal = createAdoptedWindowRecoveryJournal(file);
      await journal.arm({ recoveryId: 'restore', descriptor, originalBounds: bounds, recordedAt: 1 });
      await journal.arm({ recoveryId: 'defer', descriptor: { ...descriptor, title: 'Ambiguous' }, originalBounds: bounds, recordedAt: 2 });
      const placed: unknown[] = [];
      const report = await recoverAdoptedWindows(journal, {
        resolvePersisted: async (requested) => requested.title === 'Ambiguous'
          ? { outcome: 'ambiguous', error: 'two matches' }
          : { outcome: 'success', capability, descriptor: requested },
        observeCapability: async () => ({ outcome: 'success', observation: { bounds, state: 'normal', processId: 42, runtimeId: 'token' as never, title: descriptor.title, processPath: 'notepad.exe', windowClass: 'Notepad' } }),
        placeAdoptedCapability: async (_cap, target) => { placed.push(target); return { outcome: 'success' }; },
      });
      expect(report).toEqual({ restored: 1, missing: 0, deferred: 1 });
      expect(placed).toEqual([bounds]);
      expect(journal.entries().map((entry) => entry.recoveryId)).toEqual(['defer']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
