import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveWindowsCscPath } from '../windows/foregroundBridge';

const EXECUTABLE = 'papers-shell-thumbnail.exe';
const STAMP = 'papers-shell-thumbnail.stamp';
const MAX_PNG_BYTES = 32 * 1024 * 1024;

export interface ShellThumbnailBridge {
  preview(
    target: string,
    size?: number,
  ): Promise<{ ok: true; png: Buffer; width: number; height: number } | { ok: false; error?: string }>;
}

export function resolveShellThumbnailSourcePath(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): string {
  const nativeRoot = input.packaged
    ? path.join(input.resourcesPath, 'native')
    : path.join(input.appPath, 'resources', 'native');
  return path.join(nativeRoot, 'shell-thumbnail.cs');
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 400);
}

function validPng(buffer: Buffer): boolean {
  return buffer.length >= 8
    && buffer.length <= MAX_PNG_BYTES
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function parseOutput(
  stdout: string,
): { ok: true; png: Buffer; width: number; height: number } | { ok: false; error?: string } {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? '';
  if (!line || line === 'NONE') return { ok: false };
  const parts = line.split('\t');
  if (parts[0] === 'ERR') {
    let error = 'Windows thumbnail extraction failed.';
    try {
      const decoded = Buffer.from(parts[1] ?? '', 'base64').toString('utf8').replace(/\s+/g, ' ').trim();
      if (decoded) error = decoded.slice(0, 400);
    } catch { /* bounded default above */ }
    return { ok: false, error };
  }
  if (parts[0] !== 'PNG' || parts.length !== 4) {
    return { ok: false, error: 'Windows thumbnail helper returned a malformed response.' };
  }
  const width = Number(parts[1]);
  const height = Number(parts[2]);
  const encoded = parts[3] ?? '';
  if (!Number.isSafeInteger(width) || width < 1 || width > 4096
    || !Number.isSafeInteger(height) || height < 1 || height > 4096
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { ok: false, error: 'Windows thumbnail helper returned invalid dimensions or image data.' };
  }
  try {
    const png = Buffer.from(encoded, 'base64');
    return validPng(png)
      ? { ok: true, png, width, height }
      : { ok: false, error: 'Windows thumbnail helper returned an invalid PNG.' };
  } catch {
    return { ok: false, error: 'Windows thumbnail helper returned invalid base64.' };
  }
}

export function createShellThumbnailBridge(input: {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  timeoutMs?: number;
}): ShellThumbnailBridge | null {
  const timeoutMs = input.timeoutMs ?? 6_000;
  let source: Buffer;
  try {
    source = fs.readFileSync(input.sourcePath);
  } catch {
    return null;
  }

  const compiler = input.compilerPath
    ?? resolveWindowsCscPath(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows');
  if (!compiler) return null;

  const executable = path.join(input.cacheDirectory, EXECUTABLE);
  const stampFile = path.join(input.cacheDirectory, STAMP);
  const stamp = createHash('sha256').update(source).digest('hex');

  let ready = false;
  try {
    ready = fs.readFileSync(stampFile, 'utf8') === stamp
      && fs.statSync(executable).isFile();
  } catch {
    ready = false;
  }

  if (!ready) {
    try {
      fs.mkdirSync(input.cacheDirectory, { recursive: true });
      execFileSync(compiler, [
        '/nologo',
        '/optimize+',
        '/platform:x64',
        '/target:exe',
        '/r:System.Drawing.dll',
        `/out:${executable}`,
        input.sourcePath,
      ], {
        timeout: 15_000,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      fs.writeFileSync(stampFile, stamp, 'utf8');
    } catch {
      try {
        fs.rmSync(executable, { force: true });
        fs.rmSync(stampFile, { force: true });
      } catch { /* best effort */ }
      return null;
    }
  }

  return {
    preview(target, size = 1600) {
      const boundedSize = Math.min(Math.max(Math.round(size), 64), 4096);
      return new Promise((resolve) => {
        execFile(executable, [target, String(boundedSize)], {
          cwd: input.cacheDirectory,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 48 * 1024 * 1024,
          encoding: 'utf8',
        }, (error, stdout) => {
          const parsed = parseOutput(typeof stdout === 'string' ? stdout : '');
          if (error && !parsed.ok && !parsed.error) {
            resolve({ ok: false, error: boundedError(error) });
            return;
          }
          resolve(parsed);
        });
      });
    },
  };
}
