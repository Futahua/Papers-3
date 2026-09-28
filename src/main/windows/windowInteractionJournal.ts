/** Bounded, redacted diagnostics for window interaction flows. Kept separate
 * from the geometry journal so routine picker activity cannot evict failures. */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const WINDOW_INTERACTION_CRITICAL_LIMIT = 128;
export const WINDOW_INTERACTION_PREVIEW_LIMIT = 64;

export type WindowInteractionKind =
  | 'lifecycle-subscribe' | 'lifecycle-delivery' | 'shift-delivery'
  | 'peek-begin' | 'peek-end' | 'auto-add' | 'candidate-list'
  | 'thumbnail-cache' | 'thumbnail-capture';
export interface WindowInteractionEntry {
  at: number;
  kind: WindowInteractionKind;
  detail: string;
  outcome: string;
}
export interface WindowInteractionJournal {
  record(entry: { at?: number; kind: WindowInteractionKind; detail?: string; outcome?: string }): void;
  read(): { critical: WindowInteractionEntry[]; preview: WindowInteractionEntry[] };
}

function cleanRows(value: unknown, allowed: readonly WindowInteractionKind[], limit: number): WindowInteractionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): WindowInteractionEntry[] => {
    if (!row || typeof row !== 'object') return [];
    const raw = row as Record<string, unknown>;
    if (!allowed.includes(raw.kind as WindowInteractionKind)) return [];
    return [{
      at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
      kind: raw.kind as WindowInteractionKind,
      detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 80) : '',
      outcome: typeof raw.outcome === 'string' ? raw.outcome.slice(0, 40) : '',
    }];
  }).slice(-limit);
}
const CRITICAL_KINDS: readonly WindowInteractionKind[] = [
  'lifecycle-subscribe', 'lifecycle-delivery', 'shift-delivery', 'peek-begin', 'peek-end', 'auto-add', 'candidate-list',
];
const PREVIEW_KINDS: readonly WindowInteractionKind[] = ['thumbnail-cache', 'thumbnail-capture'];

export function createWindowInteractionJournal(dir: string): WindowInteractionJournal {
  const file = path.join(dir, 'window-interaction-journal.json');
  const read = (): { critical: WindowInteractionEntry[]; preview: WindowInteractionEntry[] } => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      return {
        critical: cleanRows(parsed.critical, CRITICAL_KINDS, WINDOW_INTERACTION_CRITICAL_LIMIT),
        preview: cleanRows(parsed.preview, PREVIEW_KINDS, WINDOW_INTERACTION_PREVIEW_LIMIT),
      };
    } catch { return { critical: [], preview: [] }; }
  };
  return {
    record(entry) {
      try {
        const rows = read();
        const bounded: WindowInteractionEntry = {
          at: typeof entry.at === 'number' ? entry.at : Date.now(),
          kind: entry.kind,
          detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 80) : '',
          outcome: typeof entry.outcome === 'string' ? entry.outcome.slice(0, 40) : '',
        };
        if (CRITICAL_KINDS.includes(entry.kind)) rows.critical.push(bounded);
        else if (PREVIEW_KINDS.includes(entry.kind)) rows.preview.push(bounded);
        else return;
        rows.critical = rows.critical.slice(-WINDOW_INTERACTION_CRITICAL_LIMIT);
        rows.preview = rows.preview.slice(-WINDOW_INTERACTION_PREVIEW_LIMIT);
        fs.mkdirSync(dir, { recursive: true });
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ version: 1, ...rows }), 'utf8');
        fs.renameSync(temp, file);
      } catch { /* diagnostics never fail the action they describe */ }
    },
    read,
  };
}

let defaultJournal: WindowInteractionJournal | null = null;
export function defaultWindowInteractionJournal(): WindowInteractionJournal {
  if (defaultJournal) return defaultJournal;
  try {
    const electron = require('electron') as { app?: { getPath(name: string): string } };
    const userData = electron.app?.getPath('userData');
    if (userData) {
      defaultJournal = createWindowInteractionJournal(path.join(userData, 'ayg-window-frames'));
      return defaultJournal;
    }
  } catch { /* fall through to no-op */ }
  defaultJournal = { record: () => undefined, read: () => ({ critical: [], preview: [] }) };
  return defaultJournal;
}
