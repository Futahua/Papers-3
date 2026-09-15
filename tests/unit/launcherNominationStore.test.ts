/**
 * The creator's launcher nomination, as stored.
 *
 * Written AFTER the module (recorded plainly: the implementation came first, so
 * this is not a red-then-green cycle). What it pins down is the fail-closed
 * direction, which is the part that could quietly go wrong: a missing, empty,
 * malformed or wrongly-versioned file must mean "no nomination", never a project
 * the creator did not choose.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LAUNCHER_NOMINATION_FILE,
  createLauncherNominationStore,
  parseNomination,
} from '../../src/main/backpacks/launcherNominationStore';

const PAPERS3 = 'bp-22222222-2222-4222-8222-222222222222';

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'papers-nomination-'));
}

describe('reading a nomination', () => {
  it('reads a well-formed nomination', () => {
    expect(parseNomination(JSON.stringify({ schemaVersion: 1, projectId: PAPERS3 }))).toBe(PAPERS3);
  });

  it('reads an explicit null as no nomination', () => {
    expect(parseNomination(JSON.stringify({ schemaVersion: 1, projectId: null }))).toBeNull();
  });

  it.each([
    ['an empty file', ''],
    ['not JSON', 'not json at all'],
    ['a JSON array', '[]'],
    ['a bare string', '"bp-22222222-2222-4222-8222-222222222222"'],
    ['a missing projectId', JSON.stringify({ schemaVersion: 1 })],
    ['a wrong schema version', JSON.stringify({ schemaVersion: 2, projectId: PAPERS3 })],
    ['a malformed project id', JSON.stringify({ schemaVersion: 1, projectId: 'papers-3' })],
    ['a non-string project id', JSON.stringify({ schemaVersion: 1, projectId: 7 })],
  ])('%s is no nomination, never a guessed one', (_label, raw) => {
    expect(parseNomination(raw)).toBeNull();
  });
});

describe('the nomination store', () => {
  it('starts with no nomination when no file exists', async () => {
    const directory = await temporaryDirectory();
    const store = createLauncherNominationStore(directory);
    await store.load();

    expect(store.nominatedProjectId()).toBeNull();
  });

  it('loads what a previous run wrote', async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(
      path.join(directory, LAUNCHER_NOMINATION_FILE),
      JSON.stringify({ schemaVersion: 1, projectId: PAPERS3 }),
    );
    const store = createLauncherNominationStore(directory);
    await store.load();

    expect(store.nominatedProjectId()).toBe(PAPERS3);
  });

  it('keeps the nomination in memory immediately, without waiting for the write', async () => {
    const directory = await temporaryDirectory();
    const store = createLauncherNominationStore(directory);

    store.set(PAPERS3);

    // Synchronous: a keypress path cannot await a disk write, and the launcher
    // must honour the creator's press that follows immediately.
    expect(store.nominatedProjectId()).toBe(PAPERS3);
  });

  it('round-trips a nomination through the file', async () => {
    const directory = await temporaryDirectory();
    const store = createLauncherNominationStore(directory);
    store.set(PAPERS3);
    // The write is deliberately not awaited by `set`; poll briefly for it.
    const file = path.join(directory, LAUNCHER_NOMINATION_FILE);
    await expect.poll(async () => {
      try {
        return parseNomination(await fs.readFile(file, 'utf8'));
      } catch {
        return null;
      }
    }, { timeout: 2000 }).toBe(PAPERS3);

    const reloaded = createLauncherNominationStore(directory);
    await reloaded.load();
    expect(reloaded.nominatedProjectId()).toBe(PAPERS3);
  });

  it('clears a nomination, in memory and on disk', async () => {
    const directory = await temporaryDirectory();
    const store = createLauncherNominationStore(directory);
    store.set(PAPERS3);
    const file = path.join(directory, LAUNCHER_NOMINATION_FILE);
    await expect.poll(async () => {
      try {
        return parseNomination(await fs.readFile(file, 'utf8'));
      } catch {
        return null;
      }
    }, { timeout: 2000 }).toBe(PAPERS3);

    store.set(null);

    expect(store.nominatedProjectId()).toBeNull();
    await expect.poll(async () => {
      try {
        return parseNomination(await fs.readFile(file, 'utf8'));
      } catch {
        return null;
      }
    }, { timeout: 2000 }).toBeNull();
  });

  it('creates the directory if the store is pointed somewhere new', async () => {
    const parent = await temporaryDirectory();
    const directory = path.join(parent, 'PapersData');
    const store = createLauncherNominationStore(directory);
    store.set(PAPERS3);

    const file = path.join(directory, LAUNCHER_NOMINATION_FILE);
    await expect.poll(async () => {
      try {
        return parseNomination(await fs.readFile(file, 'utf8'));
      } catch {
        return null;
      }
    }, { timeout: 2000 }).toBe(PAPERS3);
  });
});
