import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { FileLocker, FindFileLockers } from './fileLockerBridge';

/** One selected item's outcome, so a batch reports partial success the way Explorer does. */
export interface RecycleItemResult {
  path: string;
  name: string;
  ok: boolean;
  code?: 'NOT_FOUND' | 'FILE_LOCKED' | 'RECYCLE_FAILED';
  /** Short reason for this item, e.g. "Open in Microsoft Word (WINWORD.EXE, pid 4312)". */
  reason?: string;
  lockers?: FileLocker[];
}

export interface RecycleOptions {
  trash: (target: string) => Promise<void>;
  findLockers?: FindFileLockers | null;
  /** Waits between attempts for one item; transient locks (indexer, antivirus, previews) usually clear. */
  retryDelaysMs?: readonly number[];
  /** Total retry waiting for the whole batch, so many locked items cannot stall the caller. */
  retryBudgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_DELAYS_MS = [200, 500] as const;
const DEFAULT_RETRY_BUDGET_MS = 4_000;

async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 300) || 'Windows refused the operation.';
}

export function describeLocker(locker: FileLocker): string {
  const process = locker.processName && locker.processName.toLowerCase() !== `${locker.name.toLowerCase()}.exe`
    && locker.processName.toLowerCase() !== locker.name.toLowerCase()
    ? `${locker.processName}, ` : '';
  return `${locker.name} (${process}pid ${locker.pid})`;
}

export function describeLockers(lockers: FileLocker[]): string {
  return 'Open in ' + lockers.slice(0, 4).map(describeLocker).join(', ') + (lockers.length > 4 ? ` and ${lockers.length - 4} more` : '');
}

/** One sentence per failure, readable on its own in a toast or a dialog row. */
export function recycleFailureSentence(item: RecycleItemResult): string {
  if (item.lockers?.length) return `${item.name} is ${describeLockers(item.lockers).replace(/^Open/, 'open')}.`;
  if (item.code === 'NOT_FOUND') return `${item.name} is no longer there.`;
  return `${item.name} could not be recycled: ${item.reason ?? 'Windows refused the operation.'}`;
}

export function summarizeRecycle(results: RecycleItemResult[]): Record<string, unknown> {
  const failed = results.filter(item => !item.ok);
  const recycled = results.filter(item => item.ok).map(item => item.path);
  const base = { provider: 'windows-recycle-bin', operation: 'delete', recycle: true, results, recycled, failed: failed.map(item => item.path) };
  if (!failed.length) return { ok: true, ...base };
  const sentences = failed.slice(0, 3).map(recycleFailureSentence).join(' ') + (failed.length > 3 ? ` ${failed.length - 3} more were not recycled.` : '');
  const prefix = recycled.length ? `Recycled ${recycled.length} of ${results.length}. ` : '';
  const code = recycled.length ? 'DELETE_PARTIAL' : failed.every(item => item.code === 'FILE_LOCKED') ? 'FILE_LOCKED' : 'DELETE_FAILED';
  return { ok: false, code, message: prefix + sentences, ...base };
}

/**
 * Recycles each selected item independently: one locked file never hides the others' outcome.
 * A failure is retried briefly; if it persists, Restart Manager names the processes holding it.
 * Nothing here closes or signals another process.
 */
export async function recycleTargets(targets: string[], options: RecycleOptions): Promise<Record<string, unknown>> {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let budget = options.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS;
  const results: RecycleItemResult[] = [];
  for (const target of [...new Set(targets)]) {
    const name = path.win32.basename(target) || target;
    if (!await exists(target)) { results.push({ path: target, name, ok: false, code: 'NOT_FOUND', reason: 'It was moved or deleted already.' }); continue; }
    let lastError: unknown = null;
    for (let attempt = 0; ; attempt++) {
      try { await options.trash(target); lastError = null; break; }
      catch (error) { lastError = error; }
      // Some shell failures arrive after the item has actually gone to the Recycle Bin.
      if (!await exists(target)) { lastError = null; break; }
      const wait = delays[attempt];
      if (wait === undefined || budget < wait) break;
      budget -= wait;
      await sleep(wait);
    }
    if (!lastError) { results.push({ path: target, name, ok: true }); continue; }
    let lockers: FileLocker[] = [];
    try { lockers = options.findLockers ? await options.findLockers(target) : []; }
    catch { lockers = []; }
    results.push(lockers.length
      ? { path: target, name, ok: false, code: 'FILE_LOCKED', reason: describeLockers(lockers), lockers }
      : { path: target, name, ok: false, code: 'RECYCLE_FAILED', reason: errorText(lastError) });
  }
  return summarizeRecycle(results);
}
