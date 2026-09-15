/**
 * The native foreground bridge: reading which window has the foreground, and
 * handing it back.
 *
 * Electron exposes neither, and Papers' PowerShell window helper cannot do it
 * either, because a background process calling SetForegroundWindow is refused by
 * the Windows foreground lock. Measured, not assumed: the shipping helper
 * reports `restore` success while the foreground does not move
 * (LongHorizon probes/probe-25).
 *
 * The bridge is a single C# file compiled once with the compiler that ships with
 * Windows (`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) into the
 * Papers Data directory and reused after that. No new dependency, no node-gyp,
 * no packaged-layout change.
 *
 * FAIL-CLOSED, ALWAYS
 * If the compiler is missing, the source is unreadable, or compilation fails,
 * `createForegroundBridge` returns null. Callers must treat that as "focus
 * cannot be handed back" and say so - never as "assume it worked". The bridge
 * also refuses to report success when the foreground did not actually move: the
 * process exits non-zero unless `GetForegroundWindow()` really became the target.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ForegroundBridge {
  /** The window that currently has the foreground, or null. Returns null for
   * the shell/desktop, which is not an application to hand focus back to. */
  foregroundWindow(): Promise<number | null>;
  /** Whether the handle is still a real window. */
  isWindow(handle: number): Promise<boolean>;
  /** Try to put the foreground back on that exact window. Resolves true only
   * when the foreground genuinely moved. */
  setForegroundWindow(handle: number): Promise<boolean>;
  /** Whether that exact window currently owns the foreground. Lets the toggle
   * answer "is the window the creator is looking at a Papers window" instead of
   * guessing from visibility. */
  isForegroundWindow(handle: number): Promise<boolean>;
  /**
   * The next window BELOW that one in the z-order that a creator could
   * plausibly be looking at - the window that was underneath. Null when there
   * is nothing usable there.
   */
  nextWindowInZOrder(handle: number): Promise<number | null>;
}

export interface ForegroundBridgeOptions {
  /** Where the compiled executable is cached. Must be a Papers-owned directory. */
  cacheDirectory: string;
  /** The C# source. */
  sourcePath: string;
  /** Overridable for tests. */
  compilerPath?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

export function resolveWindowsCscPath(systemRoot: string): string | null {
  if (typeof systemRoot !== 'string' || systemRoot.length === 0) return null;
  const candidate = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  try {
    if (!fs.statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

export const FOREGROUND_BRIDGE_EXECUTABLE = 'papers-fg-bridge.exe';
export const FOREGROUND_BRIDGE_SOURCE_FILE = 'fg-bridge.cs';
export const FOREGROUND_BRIDGE_RESOURCE_DIRECTORY = 'native';

/**
 * Where the bridge source lives, for both layouts. Mirrors the window-helper
 * resource resolution rather than inventing a second convention: an explicit
 * packaged path (`process.resourcesPath/<dir>`) and an explicit dev path
 * (`appPath/resources/<dir>`). Nothing here reads renderer input or the working
 * directory.
 */
export function resolveForegroundBridgeSourcePath(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): string {
  const directory = input.packaged
    ? path.join(input.resourcesPath, FOREGROUND_BRIDGE_RESOURCE_DIRECTORY)
    : path.join(input.appPath, 'resources', FOREGROUND_BRIDGE_RESOURCE_DIRECTORY);
  return path.join(directory, FOREGROUND_BRIDGE_SOURCE_FILE);
}

/**
 * Why the bridge is unavailable, when it is. A bare `null` was not enough: a
 * compile failure with stdio ignored produced a silent, permanently broken
 * bridge. Callers surface this instead of guessing.
 */
let lastCompileError: string | null = null;

export function foregroundBridgeUnavailableReason(): string | null {
  return lastCompileError;
}

/**
 * Ensure the bridge is compiled, then return it. Returns null when it cannot be
 * built - never a stub that pretends to work.
 */
export function createForegroundBridge(options: ForegroundBridgeOptions): ForegroundBridge | null {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executable = path.join(options.cacheDirectory, FOREGROUND_BRIDGE_EXECUTABLE);

  let sourceBytes: Buffer;
  try {
    sourceBytes = fs.readFileSync(options.sourcePath);
  } catch {
    return null;
  }

  // Recompile when the shipped source changed, so a stale binary from an older
  // Papers build can never answer for the current one.
  const sourceStamp = `${sourceBytes.length}:${sourceBytes.subarray(0, 64).toString('latin1')}`;
  const stampPath = `${executable}.stamp`;
  let stampMatches = false;
  try {
    stampMatches = fs.readFileSync(stampPath, 'utf8') === sourceStamp && fs.statSync(executable).isFile();
  } catch {
    stampMatches = false;
  }

  let compileFailure: string | null = null;

  if (!stampMatches) {
    const compiler = options.compilerPath ?? resolveWindowsCscPath(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows');
    if (!compiler) {
      lastCompileError = 'the Windows C# compiler (csc.exe) is not available on this machine';
      return null;
    }
    try {
      fs.mkdirSync(options.cacheDirectory, { recursive: true });
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
      // stderr is CAPTURED, not discarded. The first version of this used
      // stdio: 'ignore', which hid a genuine compiler error (IntPtr.TryParse
      // does not exist in .NET Framework 4.0) behind a silent null - a bridge
      // that never worked and never said why. That is the bug class this whole
      // module is supposed to avoid.
      execFileSync(compiler, ['/nologo', '/optimize+', `/out:${executable}`, options.sourcePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout,
        windowsHide: true,
      });
      fs.writeFileSync(stampPath, sourceStamp, 'utf8');
    } catch (error) {
      const detail = error && typeof error === 'object' && 'stderr' in error
        ? Buffer.isBuffer((error as { stderr?: Buffer }).stderr)
          ? (error as { stderr: Buffer }).stderr.toString('utf8').trim()
          : String((error as { stderr?: unknown }).stderr ?? '')
        : '';
      const compileFailure = detail.length > 0
        ? detail.split('\n').slice(0, 3).join(' ').slice(0, 400)
        : (error instanceof Error ? error.message : String(error));
      lastCompileError = compileFailure;
      try {
        fs.rmSync(executable, { force: true });
        fs.rmSync(stampPath, { force: true });
      } catch {
        /* a stale binary is removed best-effort; the null return is the contract */
      }
      return null;
    }
  }

  if (!fs.existsSync(executable)) return null;

  const run = (args: string[]): Promise<string | null> =>
    new Promise((resolve) => {
      execFile(executable, args, { timeout, windowsHide: true }, (error, stdout) => {
        // A non-zero exit is a REFUSAL, not an error to swallow: `set` exits
        // non-zero precisely when the foreground did not move. The caller reads
        // the parsed output, so the text is returned either way and the exit
        // code is carried in it.
        const text = typeof stdout === 'string' ? stdout.trim() : '';
        if (text.length === 0) {
          resolve(null);
          return;
        }
        resolve(error && !text ? null : text);
      });
    });

  return {
    async foregroundWindow(): Promise<number | null> {
      const out = await run(['get']);
      if (!out) return null;
      const handle = /(?:^|\s)handle=(\d+)/.exec(out);
      if (!handle) return null;
      // The shell and the desktop are not applications to hand focus back to.
      if (/(?:^|\s)shell=1(?:\s|$)/.test(out)) return null;
      const value = Number(handle[1]);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    },

    async isWindow(handle: number): Promise<boolean> {
      if (!Number.isSafeInteger(handle) || handle <= 0) return false;
      const out = await run(['iswindow', String(handle)]);
      return out === '1';
    },

    async setForegroundWindow(handle: number): Promise<boolean> {
      if (!Number.isSafeInteger(handle) || handle <= 0) return false;
      const out = await run(['set', String(handle)]);
      if (!out) return false;
      // The bridge prints "moved=1" only when GetForegroundWindow() really
      // became the target. A `set=1` alone is the false success this whole
      // module exists to avoid.
      return /(?:^|\s)moved=1(?:\s|$)/.test(out);
    },

    async isForegroundWindow(handle: number): Promise<boolean> {
      if (!Number.isSafeInteger(handle) || handle <= 0) return false;
      const out = await run(['get']);
      if (!out) return false;
      const current = /(?:^|\s)handle=(\d+)/.exec(out);
      if (!current) return false;
      return Number(current[1]) === handle;
    },

    async nextWindowInZOrder(handle: number): Promise<number | null> {
      if (!Number.isSafeInteger(handle) || handle <= 0) return null;
      const out = await run(['next', String(handle)]);
      if (!out || out === 'none') return null;
      const found = /(?:^|\s)handle=(\d+)/.exec(out);
      if (!found) return null;
      const value = Number(found[1]);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    },
  };
}
