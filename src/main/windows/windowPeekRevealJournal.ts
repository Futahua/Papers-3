/**
 * Narrow DURABLE owed-reveal journal for Peek-hidden windows.
 *
 * A Peek hides other applications' real top-level windows. Memory alone cannot
 * survive a hard kill: if Papers dies while a hide is outstanding, the next
 * launch has no way to learn that a reveal is still owed, and the window can
 * stay hidden forever. This journal is that durable record, and it is
 * deliberately tiny and non-identifying:
 *
 *  - it stores ONLY stable window instance identities (`W` + 16 hex, the
 *    reconciliation key derived from HWND, owning PID, that process's creation
 *    time and window class) - never a session token, HWND, process path, title
 *    or any secret;
 *  - it is versioned JSON, de-duplicated and bounded, written with an atomic
 *    temp+rename so a crash mid-write cannot leave a half-written record;
 *  - an absent, unreadable, malformed or wrong-version file reads as EMPTY, so a
 *    damaged journal can never block startup.
 *
 * The ordering contract is the durable form of the in-memory rule: record the
 * identity BEFORE the native hide is attempted (`add`), and remove it only after
 * a reveal has been CONFIRMED successful (`remove`). `add` reports whether the
 * debt is durably recorded; a caller must NOT hide a window it could not record.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const WINDOW_PEEK_REVEAL_JOURNAL_VERSION = 1;
export const WINDOW_PEEK_REVEAL_JOURNAL_FILE = 'peek-reveal-journal.json';
/** Bounded: an owed identity costs one reveal attempt per launch, so the list is
 * capped. At the cap `add` refuses (the caller then does not hide the window)
 * rather than silently evicting an older owed reveal. */
export const WINDOW_PEEK_REVEAL_JOURNAL_MAX_ENTRIES = 256;

export interface WindowPeekRevealJournal {
  /** Every identity currently owed a reveal, validated and de-duplicated. */
  read(): string[];
  /** Durably record one owed identity BEFORE the native hide. Returns true when
   * the debt is now durable (including "already recorded"); false when it could
   * not be recorded, in which case the caller must not hide the window. */
  add(windowInstanceId: string): boolean;
  /** Durably drop one identity, only after a CONFIRMED reveal. */
  remove(windowInstanceId: string): void;
}

export interface WindowPeekRevealJournalOptions {
  file: string;
}

const IDENTITY_PATTERN = /^W[0-9a-f]{16}$/;

export function createWindowPeekRevealJournal(options: WindowPeekRevealJournalOptions): WindowPeekRevealJournal {
  const file = options.file;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* best effort: a failing directory shows up as a failed add */
  }

  function readOwed(): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const record = raw as { version?: unknown; owed?: unknown };
      if (record.version !== WINDOW_PEEK_REVEAL_JOURNAL_VERSION) return [];
      if (!Array.isArray(record.owed)) return [];
      const owed: string[] = [];
      for (const entry of record.owed) {
        if (typeof entry !== 'string' || !IDENTITY_PATTERN.test(entry)) continue;
        if (owed.includes(entry)) continue;
        owed.push(entry);
        if (owed.length >= WINDOW_PEEK_REVEAL_JOURNAL_MAX_ENTRIES) break;
      }
      return owed;
    } catch {
      // Absent, unreadable, malformed or wrong-version: owe nothing rather than
      // break the caller.
      return [];
    }
  }

  function writeOwed(owed: string[]): boolean {
    const temp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: WINDOW_PEEK_REVEAL_JOURNAL_VERSION, owed }), 'utf8');
      fs.renameSync(temp, file);
      return true;
    } catch {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  return {
    read(): string[] {
      return readOwed();
    },
    add(windowInstanceId: string): boolean {
      if (!IDENTITY_PATTERN.test(windowInstanceId)) return false;
      const owed = readOwed();
      if (owed.includes(windowInstanceId)) return true;
      if (owed.length >= WINDOW_PEEK_REVEAL_JOURNAL_MAX_ENTRIES) return false;
      owed.push(windowInstanceId);
      return writeOwed(owed);
    },
    remove(windowInstanceId: string): void {
      const owed = readOwed();
      if (!owed.includes(windowInstanceId)) return;
      writeOwed(owed.filter((entry) => entry !== windowInstanceId));
    },
  };
}

/** Durability DEGRADED: used only when no Papers userData directory can be
 * resolved, so the journal stays in memory for this process. Peeks keep working
 * and the ordering rule is unchanged within the process; a HARD kill can no
 * longer be recovered across launches (the same degradation the durable frame
 * store documents when its directory is unavailable). */
export function createMemoryWindowPeekRevealJournal(): WindowPeekRevealJournal {
  const owed = new Set<string>();
  return {
    read: () => [...owed],
    add(windowInstanceId: string): boolean {
      if (!IDENTITY_PATTERN.test(windowInstanceId)) return false;
      owed.add(windowInstanceId);
      return true;
    },
    remove(windowInstanceId: string): void {
      owed.delete(windowInstanceId);
    },
  };
}
