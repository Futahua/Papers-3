import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveWindowsCscPath } from '../windows/foregroundBridge';
import { getOrCreateSourceSnapshot } from './derivedPreviewCache';

const EXECUTABLE = 'papers-revit-preview.exe';
const STAMP = 'papers-revit-preview.stamp';
const MAX_PNG_BYTES = 16 * 1024 * 1024;

export interface RevitPreviewBridge {
  preview(target: string): Promise<{ ok: true; png: Buffer } | { ok: false; error?: string }>;
}

export function resolveRevitPreviewBridgeSourcePath(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): string {
  const nativeRoot = input.packaged
    ? path.join(input.resourcesPath, 'native')
    : path.join(input.appPath, 'resources', 'native');
  return path.join(nativeRoot, 'revit-preview.cs');
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

function parseOutput(stdout: string): { ok: true; png: Buffer } | { ok: false; error?: string } {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? '';
  if (!line || line === 'NONE') return { ok: false };
  const [kind, encoded = ''] = line.split('\t', 2);
  if (kind === 'ERR') {
    let error = 'Revit preview extraction failed.';
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8').replace(/\s+/g, ' ').trim();
      if (decoded) error = decoded.slice(0, 400);
    } catch { /* bounded default above */ }
    return { ok: false, error };
  }
  if (kind !== 'PNG' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { ok: false, error: 'Revit preview helper returned a malformed response.' };
  try {
    const png = Buffer.from(encoded, 'base64');
    return validPng(png)
      ? { ok: true, png }
      : { ok: false, error: 'Revit preview helper returned an invalid PNG.' };
  } catch {
    return { ok: false, error: 'Revit preview helper returned invalid base64.' };
  }
}

export function createRevitPreviewBridge(input: {
  cacheDirectory: string;
  sourcePath: string;
  compilerPath?: string;
  timeoutMs?: number;
}): RevitPreviewBridge | null {
  const timeoutMs = input.timeoutMs ?? 5_000;
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
    async preview(target) {
      try {
        const snapshot = await getOrCreateSourceSnapshot({
          cacheDirectory: input.cacheDirectory,
          source: target,
        });
        return await new Promise((resolve) => {
        execFile(executable, [snapshot.filePath], {
          cwd: input.cacheDirectory,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 24 * 1024 * 1024,
          encoding: 'utf8',
        }, (error, stdout) => {
          const parsed = parseOutput(typeof stdout === 'string' ? stdout : '');
          if (error) {
            if (parsed.ok) {
              resolve({ ok: false, error: boundedError(error) });
              return;
            }
            if (!parsed.error) {
              resolve({ ok: false, error: boundedError(error) });
              return;
            }
          }
          resolve(parsed);
        });
      });
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },
  };
}
