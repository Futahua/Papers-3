/**
 * Atomic, versioned, human-inspectable JSON persistence.
 *
 * Guarantees:
 * - temp-file plus rename writes (never partial main files);
 * - backup of the previous good state before every overwrite;
 * - corrupt files are quarantined into a recovery directory, never deleted;
 * - last-known-good restoration from the backup when the main file is corrupt;
 * - no destructive automatic migration (unknown top-level fields preserved by
 *   callers that round-trip the parsed object).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface LoadReport<T> {
  value: T | null;
  /** Where the value came from. */
  source: 'main' | 'backup' | 'missing';
  /** Set when the main file existed but could not be used. */
  quarantinedPath: string | null;
  corruptionDetail: string | null;
}

export interface AtomicStoreOptions {
  /** Directory for quarantined corrupt files. */
  recoveryDir: string;
  /** Validate parsed JSON; throw or return an error string to reject. */
  validate?: (value: unknown) => string | null;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class AtomicJsonStore {
  constructor(
    private readonly filePath: string,
    private readonly options: AtomicStoreOptions,
  ) {}

  get backupPath(): string {
    return `${this.filePath}.backup`;
  }

  private async readCandidate(candidatePath: string): Promise<{ value: unknown } | { error: string }> {
    let raw: string;
    try {
      raw = await fs.readFile(candidatePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { error: 'missing' };
      return { error: `unreadable: ${String(err)}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { error: `invalid JSON: ${String(err)}` };
    }
    const validationError = this.options.validate?.(parsed) ?? null;
    if (validationError) return { error: `failed validation: ${validationError}` };
    return { value: parsed };
  }

  /** Move a corrupt file into the recovery directory. Never deletes data. */
  private async quarantine(candidatePath: string, reason: string): Promise<string | null> {
    try {
      await fs.mkdir(this.options.recoveryDir, { recursive: true });
      const target = path.join(
        this.options.recoveryDir,
        `${path.basename(candidatePath)}.${timestampSlug()}.corrupt`,
      );
      await fs.rename(candidatePath, target);
      await fs.writeFile(`${target}.reason.txt`, reason, 'utf8');
      return target;
    } catch {
      return null;
    }
  }

  async load<T>(): Promise<LoadReport<T>> {
    const main = await this.readCandidate(this.filePath);
    if ('value' in main) {
      return { value: main.value as T, source: 'main', quarantinedPath: null, corruptionDetail: null };
    }
    if (main.error === 'missing') {
      return { value: null, source: 'missing', quarantinedPath: null, corruptionDetail: null };
    }

    // Main file is corrupt: quarantine it, then try the backup.
    const quarantinedPath = await this.quarantine(this.filePath, main.error);
    const backup = await this.readCandidate(this.backupPath);
    if ('value' in backup) {
      // Restore last known good as the new main file.
      await this.writeAtomic(JSON.stringify(backup.value, null, 2));
      return {
        value: backup.value as T,
        source: 'backup',
        quarantinedPath,
        corruptionDetail: main.error,
      };
    }
    return { value: null, source: 'missing', quarantinedPath, corruptionDetail: main.error };
  }

  private async writeAtomic(serialized: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, this.filePath);
  }

  async save(value: unknown): Promise<void> {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) throw new Error('value is not serializable');
    // Preserve the current good main file as the backup before overwriting.
    const current = await this.readCandidate(this.filePath);
    if ('value' in current) {
      await fs.copyFile(this.filePath, this.backupPath);
    }
    await this.writeAtomic(serialized);
  }
}
