import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveWindowsCscPath } from '../windows/foregroundBridge';

/** One process that Windows Restart Manager reports as holding a file open. */
export interface FileLocker {
  pid: number;
  /** Restart Manager's friendly application name, e.g. "Microsoft Word". */
  name: string;
  /** Executable image name, e.g. "WINWORD.EXE"; empty when the process cannot be queried. */
  processName: string;
  imagePath: string;
  /** RM_APP_TYPE: 1 main window, 2 other window, 3 service, 4 Explorer, 5 console, 1000 critical. */
  applicationType: number;
}

export type FindFileLockers = (target: string) => Promise<FileLocker[]>;

const EXECUTABLE = 'papers-file-lockers.exe';
const STAMP = 'papers-file-lockers.stamp';

export function resolveFileLockerSourcePath(input: { appPath: string; resourcesPath: string; packaged: boolean }): string {
  const nativeRoot = input.packaged
    ? path.join(input.resourcesPath, 'native')
    : path.join(input.appPath, 'resources', 'native');
  return path.join(nativeRoot, 'file-lockers.cs');
}

function decode(value: string | undefined): string {
  try { return Buffer.from(value ?? '', 'base64').toString('utf8').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 400); }
  catch { return ''; }
}

/** Parses the helper's line protocol. Malformed output yields an error, never a guessed process. */
export function parseFileLockerOutput(stdout: string): { ok: true; lockers: FileLocker[] } | { ok: false; error: string } {
  const lockers: FileLocker[] = [];
  let done = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts[0] === 'ERR') return { ok: false, error: decode(parts[1]) || 'The file lock check failed.' };
    if (parts[0] === 'DONE') { done = true; continue; }
    if (parts[0] !== 'PROC' || parts.length !== 5) return { ok: false, error: 'The file lock helper returned malformed output.' };
    const pid = Number(parts[1]);
    const applicationType = Number(parts[4]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(applicationType)) {
      return { ok: false, error: 'The file lock helper returned an invalid process.' };
    }
    const imagePath = decode(parts[3]);
    const processName = imagePath ? path.win32.basename(imagePath) : '';
    lockers.push({ pid, name: decode(parts[2]) || processName || `pid ${pid}`, processName, imagePath, applicationType });
  }
  return done ? { ok: true, lockers } : { ok: false, error: 'The file lock helper did not finish.' };
}

/**
 * Restart Manager lookup, compiled lazily on the first failed recycle (never at startup) with the
 * same csc.exe + source-stamp convention as the other native helpers. Read-only: it never asks
 * Restart Manager to shut anything down.
 */
export function createFileLockerBridge(input: {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  timeoutMs?: number;
}): FindFileLockers | null {
  if (process.platform !== 'win32') return null;
  let source: Buffer;
  try { source = fs.readFileSync(input.sourcePath); } catch { return null; }
  const compiler = input.compilerPath
    ?? resolveWindowsCscPath(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows');
  if (!compiler) return null;
  const executable = path.join(input.cacheDirectory, EXECUTABLE);
  const stampFile = path.join(input.cacheDirectory, STAMP);
  const stamp = createHash('sha256').update(source).digest('hex');
  let ready: Promise<void> | null = null;

  const run = (file: string, args: string[], timeout: number): Promise<string> => new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => {
      // The helper prints ERR and exits 1 on a reported failure; let the parser carry that message.
      if (error && !String(stdout ?? '').trim()) reject(error); else resolve(String(stdout ?? ''));
    });
  });
  const ensure = (): Promise<void> => {
    ready ??= (async () => {
      try {
        if (fs.readFileSync(stampFile, 'utf8') === stamp && fs.statSync(executable).isFile()) return;
      } catch { /* compile below */ }
      await fs.promises.mkdir(input.cacheDirectory, { recursive: true });
      await fs.promises.rm(executable, { force: true });
      await run(compiler, ['/nologo', '/optimize+', '/platform:x64', '/target:exe', `/out:${executable}`, input.sourcePath], 20_000)
        .catch(() => undefined);
      if (!fs.statSync(executable).isFile()) throw new Error('The file lock helper could not be compiled.');
      await fs.promises.writeFile(stampFile, stamp, 'utf8');
    })().catch(error => { ready = null; throw error; });
    return ready;
  };

  return async target => {
    await ensure();
    const parsed = parseFileLockerOutput(await run(executable, [target], input.timeoutMs ?? 8_000));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.lockers;
  };
}
