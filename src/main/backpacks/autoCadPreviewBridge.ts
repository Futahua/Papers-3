import { execFile } from 'node:child_process';
import { promises as fs, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { getOrCreateDerivedArtifact, getOrCreateSourceSnapshot } from './derivedPreviewCache';

const AUTOCAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.dws', '.dwt']);
const MAX_PNG_BYTES = 64 * 1024 * 1024;

export interface AutoCadPreviewBridge {
  supports(extension: string): boolean;
  preview(target: string): Promise<
    { ok: true; png: Buffer; width: number; height: number; provider: string; cached?: boolean }
    | { ok: false; error?: string }
  >;
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function findCoreConsole(): string | null {
  const roots = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Autodesk'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Autodesk'),
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    try {
      const entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' });
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^AutoCAD\s+\d{4}$/i.test(entry.name)) continue;
        const candidate = path.join(root, entry.name, 'accoreconsole.exe');
        if (isFile(candidate)) candidates.push(candidate);
      }
    } catch {
      continue;
    }
  }
  candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
  return candidates[0] ?? null;
}

function quoteScriptPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.length > MAX_PNG_BYTES) return null;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47
    || buffer[4] !== 0x0d || buffer[5] !== 0x0a || buffer[6] !== 0x1a || buffer[7] !== 0x0a) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 16_384 || height > 16_384) return null;
  return { width, height };
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

export function createAutoCadPreviewBridge(input: {
  cacheDirectory: string;
  executablePath?: string;
  timeoutMs?: number;
}): AutoCadPreviewBridge | null {
  const executable = input.executablePath ?? findCoreConsole();
  if (!executable || !isFile(executable)) return null;
  const timeoutMs = input.timeoutMs ?? 45_000;
  const executableStats = statSync(executable);
  const providerKey = `autocad-png:${executableStats.size}:${executableStats.mtimeMs}`;

  return {
    supports(extension) {
      return AUTOCAD_EXTENSIONS.has(extension.trim().toLowerCase());
    },
    async preview(target) {
      try {
        const artifact = await getOrCreateDerivedArtifact({
          cacheDirectory: input.cacheDirectory,
          source: target,
          providerKey,
          extension: '.png',
          validate: async (candidate) => {
            try { return readPngDimensions(await fs.readFile(candidate)) !== null; } catch { return false; }
          },
          create: async (output) => {
            const snapshot = await getOrCreateSourceSnapshot({
              cacheDirectory: input.cacheDirectory,
              source: target,
            });
            const script = `${output}.scr`;
            const scriptText = [
              'FILEDIA',
              '0',
              'CMDDIA',
              '0',
              '_.ZOOM',
              '_E',
              '_.PNGOUT',
              quoteScriptPath(output),
              '_ALL',
              '',
              '_.QUIT',
              '_Y',
              '',
            ].join('\r\n');
            await fs.writeFile(script, scriptText, 'utf8');
            try {
              await new Promise<void>((resolve, reject) => {
                execFile(executable, ['/i', snapshot.filePath, '/s', script, '/l', 'en-US'], {
                  windowsHide: true,
                  timeout: timeoutMs,
                  maxBuffer: 8 * 1024 * 1024,
                  encoding: 'buffer',
                }, (error) => error ? reject(error) : resolve());
              });
            } finally {
              await fs.rm(script, { force: true }).catch(() => undefined);
            }
          },
        });
        const png = await fs.readFile(artifact.filePath);
        const dimensions = readPngDimensions(png);
        if (!dimensions) throw new Error('AutoCAD did not create a valid PNG preview.');
        return {
          ok: true,
          png,
          width: dimensions.width,
          height: dimensions.height,
          provider: path.basename(path.dirname(executable)),
          cached: artifact.cached,
        };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },
  };
}
