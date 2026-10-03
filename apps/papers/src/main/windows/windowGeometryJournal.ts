/**
 * Durable, bounded journal of window rectangle changes Papers performs.
 *
 * Why: a member window sometimes ends up tiny in the corner of another monitor.
 * The question is always the same - did the layout ask for that rectangle, or
 * did the helper's offscreen clamp turn a bad one into it? Recording what was
 * requested and what the window actually had afterwards answers it without
 * guessing, and survives the app being restarted before anyone looks.
 *
 * Machine-local, bounded, best effort: a failed write never fails the action it
 * describes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const WINDOW_GEOMETRY_JOURNAL_LIMIT = 24;

export interface WindowGeometryJournalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowGeometryJournalEntry {
  at: number;
  /** 'apply' is a rectangle Papers set; the surface kinds are the Quick Run
   * overlay opening and closing, with the reason it closed. */
  kind: 'apply' | 'surface-open' | 'surface-close' | 'restore' | 'minimize' | 'picker-open' | 'picker-fail' | 'picker-commit' | 'observe-fail' | 'activate' | 'activate-refused';
  title: string;
  /** Free-form reason: the close reason for a surface, the outcome otherwise. */
  detail: string;
  requested: WindowGeometryJournalBounds | null;
  observed: WindowGeometryJournalBounds | null;
  /** The monitor work areas in force at the time, so a clamped rectangle can be
   * read against the space the clamp had to work with. */
  workAreas: WindowGeometryJournalBounds[];
  outcome: string;
}

export interface WindowGeometryJournal {
  record(entry: {
    at?: number;
    kind: WindowGeometryJournalEntry['kind'];
    title?: string;
    detail?: string;
    requested?: WindowGeometryJournalBounds | null;
    observed?: WindowGeometryJournalBounds | null;
    workAreas?: WindowGeometryJournalBounds[];
    outcome?: string;
  }): void;
  read(): WindowGeometryJournalEntry[];
}

function boundedWorkAreas(value: unknown): WindowGeometryJournalBounds[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): WindowGeometryJournalBounds[] => {
    const bounds = boundedBounds(candidate);
    return bounds ? [bounds] : [];
  }).slice(0, 8);
}

function boundedBounds(value: unknown): WindowGeometryJournalBounds | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const numbers = ['x', 'y', 'width', 'height'].map((key) => raw[key]);
  if (!numbers.every((number) => typeof number === 'number' && Number.isFinite(number))) return null;
  return {
    x: Math.round(numbers[0] as number),
    y: Math.round(numbers[1] as number),
    width: Math.round(numbers[2] as number),
    height: Math.round(numbers[3] as number),
  };
}

function readEntries(file: string): WindowGeometryJournalEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries.flatMap((candidate): WindowGeometryJournalEntry[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const raw = candidate as Record<string, unknown>;
      const rawKind = raw['kind'];
      const kind = rawKind === 'surface-open' || rawKind === 'surface-close' || rawKind === 'restore' || rawKind === 'minimize'
        || rawKind === 'picker-open' || rawKind === 'picker-fail' || rawKind === 'picker-commit' || rawKind === 'observe-fail' || rawKind === 'activate' || rawKind === 'activate-refused'
        ? rawKind
        : 'apply';
      return [{
        at: typeof raw['at'] === 'number' ? raw['at'] : 0,
        kind,
        title: typeof raw['title'] === 'string' ? raw['title'].slice(0, 120) : '',
        detail: typeof raw['detail'] === 'string' ? raw['detail'].slice(0, 80) : '',
        requested: boundedBounds(raw['requested']),
        observed: boundedBounds(raw['observed']),
        workAreas: boundedWorkAreas(raw['workAreas']),
        outcome: typeof raw['outcome'] === 'string' ? raw['outcome'].slice(0, 40) : '',
      }];
    }).slice(-WINDOW_GEOMETRY_JOURNAL_LIMIT);
  } catch {
    return [];
  }
}

export function createWindowGeometryJournal(dir: string): WindowGeometryJournal {
  const file = path.join(dir, 'window-geometry-journal.json');
  return {
    record(entry) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const entries = readEntries(file);
        entries.push({
          at: typeof entry.at === 'number' ? entry.at : Date.now(),
          kind: entry.kind,
          title: typeof entry.title === 'string' ? entry.title.slice(0, 120) : '',
          detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 80) : '',
          requested: boundedBounds(entry.requested ?? null),
          observed: boundedBounds(entry.observed ?? null),
          workAreas: boundedWorkAreas(entry.workAreas),
          outcome: typeof entry.outcome === 'string' ? entry.outcome.slice(0, 40) : '',
        });
        const bounded = entries.slice(-WINDOW_GEOMETRY_JOURNAL_LIMIT);
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ version: 1, entries: bounded }), 'utf8');
        fs.renameSync(temp, file);
      } catch {
        /* diagnostics never fail the action they describe */
      }
    },
    read() {
      return readEntries(file);
    },
  };
}

let defaultJournal: WindowGeometryJournal | null = null;

/** The monitor work areas in force right now, so a clamped rectangle can be read
 * against the space the clamp had to work with. Empty when unavailable. */
export function monitorWorkAreas(): WindowGeometryJournalBounds[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as {
      screen?: { getAllDisplays?: () => Array<{ workArea?: { x: number; y: number; width: number; height: number } }> };
    };
    const displays = electron?.screen?.getAllDisplays?.() ?? [];
    return boundedWorkAreas(displays.map((display) => display?.workArea));
  } catch {
    return [];
  }
}

/** The same machine-local home the retained window frames use. */
export function defaultWindowGeometryJournal(): WindowGeometryJournal {
  if (defaultJournal) return defaultJournal;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath(name: string): string } };
    const userData = electron?.app?.getPath?.('userData');
    if (typeof userData === 'string' && userData.length > 0) {
      defaultJournal = createWindowGeometryJournal(path.join(userData, 'ayg-window-frames'));
      return defaultJournal;
    }
  } catch {
    /* fall through to the no-op journal */
  }
  const noop: WindowGeometryJournal = { record: () => undefined, read: () => [] };
  defaultJournal = noop;
  return noop;
}
