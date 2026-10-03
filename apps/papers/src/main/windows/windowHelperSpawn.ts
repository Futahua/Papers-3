/**
 * Fixed spawn spec and real-child adapter for the window helper
 * (Assignment 014/014R).
 *
 * The helper is launched ONLY by Papers with a FIXED command: the
 * VALIDATED ABSOLUTE Windows PowerShell 5.1 executable beneath the
 * trusted Windows directory (SystemRoot/System32/WindowsPowerShell/v1.0/
 * powershell.exe), fixed noninteractive/no-profile arguments and the
 * resolved Papers-owned helper path. `shell: false`, hidden window and
 * pipe-only stdio; the options carry NO cwd, environment, limits or
 * user-supplied values, and the spec never derives from renderer input.
 * PATH lookup is never used: a same-named executable beside or ahead of
 * Papers is not eligible.
 *
 * The spawn spec is a pure function (unit-tested without launching
 * anything); `spawnWindowHelperProcess` maps the real child onto the
 * accepted ChildLikeProcess seam so no Node child/stream type leaks into
 * the transport surface. 014 does not launch this from Papers: tests
 * inject a fake child; product wiring comes later.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Readable } from 'node:stream';

import type { ChildLikeProcess } from './helperProcessTransport';
import type { TransportSource } from './jsonLineTransport';

export const WINDOW_HELPER_EXECUTABLE = 'powershell.exe';
export const WINDOW_HELPER_ARGUMENT_PREFIX = ['-NoProfile', '-NonInteractive', '-File'] as const;

export interface WindowHelperSpawnSpec {
  file: string;
  args: string[];
  options: {
    shell: false;
    windowsHide: true;
    stdio: ['pipe', 'pipe', 'pipe'];
  };
}

export function buildWindowHelperSpawnSpec(runtimePath: string, helperPath: string): WindowHelperSpawnSpec {
  return {
    file: runtimePath,
    args: [...WINDOW_HELPER_ARGUMENT_PREFIX, helperPath],
    options: { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

export type WindowPowerShellRuntime =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/** Resolve the trusted ABSOLUTE Windows PowerShell 5.1 executable from
 * main-process-owned environment/platform input. Missing, non-absolute or
 * unexpected paths are rejected BEFORE any child creation. */
export function resolveWindowsPowerShellRuntime(input: {
  systemRoot: string;
  platform?: NodeJS.Platform;
}): WindowPowerShellRuntime {
  if (input.platform !== undefined && input.platform !== 'win32') {
    return { ok: false, reason: 'window helper requires Windows' };
  }
  if (typeof input.systemRoot !== 'string' || input.systemRoot.length === 0) {
    return { ok: false, reason: 'windows system root is unavailable' };
  }
  const candidate = path.join(input.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!path.isAbsolute(candidate)) {
    return { ok: false, reason: 'windows powershell runtime path is not absolute' };
  }
  if (path.basename(candidate).toLowerCase() !== WINDOW_HELPER_EXECUTABLE.toLowerCase()) {
    return { ok: false, reason: 'windows powershell runtime path is unexpected' };
  }
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      return { ok: false, reason: 'windows powershell runtime is not available' };
    }
  } catch {
    return { ok: false, reason: 'windows powershell runtime is not available' };
  }
  return { ok: true, path: candidate };
}

function adaptSource(stream: Readable): TransportSource {
  return {
    onChunk: (callback) => {
      stream.on('data', (chunk: Buffer) => {
        callback(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      });
    },
    onEnd: (callback) => {
      stream.once('end', () => callback());
      stream.once('error', (error) => callback(error instanceof Error ? error : new Error(String(error))));
    },
    end: () => {
      stream.destroy();
    },
  };
}

export function spawnWindowHelperProcess(runtimePath: string, helperPath: string): ChildLikeProcess {
  const spec = buildWindowHelperSpawnSpec(runtimePath, helperPath);
  const child = spawn(spec.file, spec.args, spec.options);
  return {
    stdin: {
      write: (bytes) => child.stdin.write(Buffer.from(bytes)),
      onDrain: (callback) => {
        child.stdin.once('drain', callback);
      },
      onError: (callback) => {
        child.stdin.once('error', (error) => callback(error instanceof Error ? error : new Error(String(error))));
      },
      end: () => {
        child.stdin.end();
      },
    },
    stdout: adaptSource(child.stdout),
    stderr: adaptSource(child.stderr),
    onExit: (callback) => {
      child.once('exit', (code, signal) => callback(code, signal));
    },
    onError: (callback) => {
      child.once('error', (error) => callback(error instanceof Error ? error : new Error(String(error))));
    },
    kill: () => {
      child.kill();
    },
  };
}
