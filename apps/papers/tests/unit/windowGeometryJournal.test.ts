import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createWindowGeometryJournal,
  WINDOW_GEOMETRY_JOURNAL_LIMIT,
} from '../../src/main/windows/windowGeometryJournal';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'papers-geometry-journal-'));
}

describe('window geometry journal', () => {
  it('records what was requested next to what the window actually had', () => {
    const dir = tempDir();
    const journal = createWindowGeometryJournal(dir);
    journal.record({
      kind: 'apply',
      title: 'Notepad',
      requested: { x: 100, y: 200, width: 800, height: 600 },
      observed: { x: 0, y: 0, width: 40, height: 30 },
      outcome: 'success',
    });
    const entries = journal.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Notepad',
      requested: { x: 100, y: 200, width: 800, height: 600 },
      observed: { x: 0, y: 0, width: 40, height: 30 },
      outcome: 'success',
    });
  });

  it('stays bounded to the newest entries', () => {
    const dir = tempDir();
    const journal = createWindowGeometryJournal(dir);
    for (let index = 0; index < WINDOW_GEOMETRY_JOURNAL_LIMIT + 8; index += 1) {
      journal.record({
        kind: 'apply',
        title: `window-${index}`,
        requested: { x: index, y: index, width: 100, height: 100 },
        observed: null,
        outcome: 'success',
      });
    }
    const entries = journal.read();
    expect(entries).toHaveLength(WINDOW_GEOMETRY_JOURNAL_LIMIT);
    expect(entries[0]!.title).toBe('window-8');
    expect(entries[entries.length - 1]!.title).toBe(`window-${WINDOW_GEOMETRY_JOURNAL_LIMIT + 7}`);
  });

  it('survives a damaged file instead of failing the caller', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'window-geometry-journal.json'), '{ not json', 'utf8');
    const journal = createWindowGeometryJournal(dir);
    expect(journal.read()).toEqual([]);
    journal.record({
      kind: 'apply',
      title: 'Chrome',
      requested: { x: 1, y: 2, width: 3, height: 4 },
      observed: null,
      outcome: 'timeout',
    });
    expect(journal.read()).toHaveLength(1);
  });

  it('records the Quick Run surface opening and closing with its reason', () => {
    const dir = tempDir();
    const journal = createWindowGeometryJournal(dir);
    journal.record({ kind: 'surface-open', detail: 'command surface', outcome: 'opening' });
    journal.record({ kind: 'surface-close', detail: 'dismissed', outcome: 'closed' });
    const entries = journal.read();
    expect(entries.map((entry) => entry.kind)).toEqual(['surface-open', 'surface-close']);
    expect(entries[1]).toMatchObject({ detail: 'dismissed', requested: null, observed: null });
    // A surface entry must not be mistaken for a rectangle Papers applied.
    expect(entries[0]!.requested).toBeNull();
  });
});
