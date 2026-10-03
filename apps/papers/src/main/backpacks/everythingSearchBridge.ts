import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveWindowsCscPath } from '../windows/foregroundBridge';

export interface EverythingSearchResult {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  size: number | null;
  modifiedAt: number | null;
  attributes: number;
}

export interface EverythingSearchResponse extends Record<string, unknown> {
  ok: boolean;
  provider: 'everything';
  version: string | null;
  total: number;
  results: EverythingSearchResult[];
  error?: string;
}

export interface EverythingSearchBridge {
  search(query: string, limit: number): Promise<EverythingSearchResponse>;
}

export interface EverythingSearchBridgePaths {
  sourcePath: string;
  dllPath: string;
}

const EXECUTABLE = 'papers-everything-search.exe';
const DLL_NAME = 'Everything64.dll';
const STAMP = 'papers-everything-search.stamp';

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 400);
}

function decodeBase64Utf8(raw: string): string {
  try { return Buffer.from(raw, 'base64').toString('utf8'); } catch { return ''; }
}

function parseOutput(stdout: string): EverythingSearchResponse {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const first = lines[0]?.split('\t') ?? [];
  if (first[0] === 'ERR') {
    return {
      ok: false,
      provider: 'everything',
      version: null,
      total: 0,
      results: [],
      error: decodeBase64Utf8(first[1] ?? '') || 'Everything search failed.',
    };
  }
  if (first[0] !== 'META' || first.length < 4) {
    return {
      ok: false,
      provider: 'everything',
      version: null,
      total: 0,
      results: [],
      error: 'Everything search returned a malformed response.',
    };
  }
  const total = Number(first[2]);
  const version = first[3] || null;
  const results: EverythingSearchResult[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split('\t');
    if (fields[0] !== 'R' || fields.length < 6) continue;
    const fullPath = decodeBase64Utf8(fields[5] ?? '');
    if (!fullPath || !path.isAbsolute(fullPath)) continue;
    const size = Number(fields[2]);
    const modifiedAt = Number(fields[3]);
    const attributes = Number(fields[4]);
    results.push({
      path: fullPath,
      name: path.basename(fullPath) || fullPath,
      kind: fields[1] === 'd' ? 'folder' : 'file',
      size: Number.isSafeInteger(size) && size >= 0 ? size : null,
      modifiedAt: Number.isFinite(modifiedAt) && modifiedAt >= 0 ? modifiedAt : null,
      attributes: Number.isSafeInteger(attributes) && attributes >= 0 ? attributes : 0,
    });
  }
  return {
    ok: true,
    provider: 'everything',
    version,
    total: Number.isSafeInteger(total) && total >= 0 ? total : results.length,
    results,
  };
}

export function resolveEverythingSearchBridgePaths(input: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): EverythingSearchBridgePaths {
  const nativeRoot = input.packaged
    ? path.join(input.resourcesPath, 'native')
    : path.join(input.appPath, 'resources', 'native');
  return {
    sourcePath: path.join(nativeRoot, 'everything-search.cs'),
    dllPath: path.join(nativeRoot, 'everything', DLL_NAME),
  };
}

export function createEverythingSearchBridge(input: {
  cacheDirectory: string;
  sourcePath: string;
  dllPath: string;
  compilerPath?: string;
  timeoutMs?: number;
}): EverythingSearchBridge | null {
  const timeoutMs = input.timeoutMs ?? 10_000;
  let source: Buffer;
  let dll: Buffer;
  try {
    source = fs.readFileSync(input.sourcePath);
    dll = fs.readFileSync(input.dllPath);
  } catch {
    return null;
  }

  const compiler = input.compilerPath
    ?? resolveWindowsCscPath(process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows');
  if (!compiler) return null;

  const executable = path.join(input.cacheDirectory, EXECUTABLE);
  const cachedDll = path.join(input.cacheDirectory, DLL_NAME);
  const stampFile = path.join(input.cacheDirectory, STAMP);
  const stamp = createHash('sha256').update(source).update(dll).digest('hex');

  let ready = false;
  try {
    ready = fs.readFileSync(stampFile, 'utf8') === stamp
      && fs.statSync(executable).isFile()
      && fs.statSync(cachedDll).isFile();
  } catch {
    ready = false;
  }

  if (!ready) {
    try {
      fs.mkdirSync(input.cacheDirectory, { recursive: true });
      fs.copyFileSync(input.dllPath, cachedDll);
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
        fs.rmSync(cachedDll, { force: true });
        fs.rmSync(stampFile, { force: true });
      } catch { /* best effort */ }
      return null;
    }
  }

  return {
    search(query, limit) {
      const boundedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
      return new Promise<EverythingSearchResponse>((resolve) => {
        execFile(executable, [String(boundedLimit), query], {
          cwd: input.cacheDirectory,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          encoding: 'utf8',
        }, (error, stdout) => {
          const text = typeof stdout === 'string' ? stdout : '';
          if (text.trim()) {
            const parsed = parseOutput(text);
            if (error && parsed.ok) {
              resolve({ ...parsed, ok: false, error: boundedError(error) });
              return;
            }
            resolve(parsed);
            return;
          }
          resolve({
            ok: false,
            provider: 'everything',
            version: null,
            total: 0,
            results: [],
            error: error ? boundedError(error) : 'Everything search returned no response.',
          });
        });
      });
    },
  };
}
