import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createWindowInteractionJournal,
  WINDOW_INTERACTION_CRITICAL_LIMIT,
  WINDOW_INTERACTION_PREVIEW_LIMIT,
} from '../../src/main/windows/windowInteractionJournal';

describe('window interaction journal', () => {
  it('keeps critical outcomes across a burst of preview records in separate bounded rings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-interaction-journal-'));
    const journal = createWindowInteractionJournal(dir);
    journal.record({ kind: 'peek-begin', detail: 'live', outcome: 'timeout' });
    for (let index = 0; index < WINDOW_INTERACTION_PREVIEW_LIMIT + 80; index += 1) {
      journal.record({ kind: 'thumbnail-cache', detail: `cache ${index}ms`, outcome: 'cache-miss' });
    }
    const rows = journal.read();
    expect(rows.critical).toHaveLength(1);
    expect(rows.critical[0]).toMatchObject({ kind: 'peek-begin', outcome: 'timeout' });
    expect(rows.preview).toHaveLength(WINDOW_INTERACTION_PREVIEW_LIMIT);
    expect(rows.preview[0]!.detail).toBe('cache 80ms');
  });

  it('retains the newest critical outcomes up to its independent capacity', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-interaction-journal-'));
    const journal = createWindowInteractionJournal(dir);
    for (let index = 0; index < WINDOW_INTERACTION_CRITICAL_LIMIT + 12; index += 1) {
      journal.record({ kind: 'auto-add', detail: 'auto-add-commit', outcome: `result-${index}` });
    }
    const rows = journal.read();
    expect(rows.critical).toHaveLength(WINDOW_INTERACTION_CRITICAL_LIMIT);
    expect(rows.critical[0]!.outcome).toBe('result-12');
    expect(rows.critical.at(-1)!.outcome).toBe(`result-${WINDOW_INTERACTION_CRITICAL_LIMIT + 11}`);
  });

  it('drops unapproved properties and recovers from a corrupt file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-interaction-journal-'));
    fs.writeFileSync(path.join(dir, 'window-interaction-journal.json'), '{bad', 'utf8');
    const journal = createWindowInteractionJournal(dir);
    expect(journal.read()).toEqual({ critical: [], preview: [] });
    journal.record({
      kind: 'lifecycle-delivery', detail: 'baseline', outcome: 'sent',
      title: 'private title', path: 'private path',
    } as never);
    const text = fs.readFileSync(path.join(dir, 'window-interaction-journal.json'), 'utf8');
    expect(text).not.toContain('private');
    expect(journal.read().critical).toHaveLength(1);
  });
});
