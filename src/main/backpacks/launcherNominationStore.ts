/**
 * The creator's launcher nomination, persisted.
 *
 * WHY THIS IS A FILE AND NOT A GUESS
 * When more than one open project declares a command surface there is no honest
 * way to pick between them: "the front one" is the defect this round fixes, and
 * "the most recently used one" turns one chord into two features the moment the
 * creator switches tabs. So the ambiguity is handed to the person it belongs to
 * - once - and remembered.
 *
 * The store is deliberately dumb, in the same shape as the Backpack project
 * bindings: a versioned record the main process owns. It records a project ID
 * and nothing about what that project is, so no Backpack's identity enters the
 * host. A missing, empty or malformed file means "no nomination", never a guess.
 *
 * It is also forgiving in the one direction that matters: an unreadable file
 * must not stop the launcher from working when exactly one project declares a
 * surface. The nomination only decides the ambiguous case.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const LAUNCHER_NOMINATION_FILE = 'launcher-project.json';

export interface LauncherNominationStore {
  /** The nominated project, or null. Synchronous: read on the keypress path. */
  nominatedProjectId(): string | null;
  /** Read the file once at startup. Never throws. */
  load(): Promise<void>;
  /** Record the creator's choice. `null` clears it. Writes through to disk. */
  set(projectId: string | null): void;
}

/** Same fail-closed ID shape the project bindings use. */
const PROJECT_ID_PATTERN =
  /^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseNomination(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record['schemaVersion'] !== 1) return null;
    const projectId = record['projectId'];
    if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) return null;
    return projectId;
  } catch {
    return null;
  }
}

export function createLauncherNominationStore(directory: string): LauncherNominationStore {
  const file = path.join(directory, LAUNCHER_NOMINATION_FILE);
  let nominated: string | null = null;

  return {
    nominatedProjectId: () => nominated,

    async load(): Promise<void> {
      try {
        nominated = parseNomination(await fs.readFile(file, 'utf8'));
      } catch {
        // No file yet, or unreadable: no nomination. The rule still resolves
        // the unambiguous case, so this must not be fatal.
        nominated = null;
      }
    },

    set(projectId: string | null): void {
      nominated = projectId;
      const body = JSON.stringify(
        projectId === null ? { schemaVersion: 1, projectId: null } : { schemaVersion: 1, projectId },
        null,
        2,
      );
      // Best-effort persistence: the in-memory value is authoritative for this
      // run, so a failed write must not throw on the way out of a keypress.
      void fs.mkdir(directory, { recursive: true })
        .then(() => fs.writeFile(file, body, 'utf8'))
        .catch(() => undefined);
    },
  };
}
