import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, statSync } from 'node:fs';
import * as path from 'node:path';

const FALLBACK_FORMATS = new Set([
  '.azw', '.azw3', '.azw4', '.cb7', '.cbc', '.cbr', '.cbz', '.chm', '.djv', '.djvu',
  '.epub', '.fb2', '.fbz', '.htmlz', '.kepub', '.lit', '.lrf', '.mobi', '.opf', '.pdb',
  '.pml', '.pmlz', '.pobi', '.prc', '.rb', '.snb', '.tcr', '.txtz', '.updb',
]);

export interface CalibrePreviewResult {
  ok: true;
  filePath: string;
  cleanup: () => Promise<void>;
  stateKey: string;
  cached: boolean;
}

export interface CalibrePreviewBridge {
  supports(extension: string): boolean;
  formats: readonly string[];
  convertToPdf(target: string): Promise<CalibrePreviewResult | { ok: false; error?: string }>;
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function candidateRoots(): string[] {
  const roots = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Calibre2'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Calibre2'),
  ];
  return [...new Set(roots)];
}

function discoverFormats(calibreDebug: string | null): Set<string> {
  if (!calibreDebug) return new Set(FALLBACK_FORMATS);
  try {
    const script = "from calibre.customize.ui import input_format_plugins; print(','.join(sorted(set().union(*[set(p.file_types) for p in input_format_plugins()]))))";
    const stdout = execFileSync(calibreDebug, ['-c', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    const formats = new Set(
      stdout.split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z0-9]+$/.test(value))
        .map((value) => `.${value}`),
    );
    return formats.size ? formats : new Set(FALLBACK_FORMATS);
  } catch {
    return new Set(FALLBACK_FORMATS);
  }
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

async function validPdf(target: string): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    if (!stats.isFile() || stats.size < 5) return false;
    const handle = await fs.open(target, 'r');
    try {
      const magic = Buffer.alloc(5);
      const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
      return bytesRead === 5 && magic.toString('ascii') === '%PDF-';
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export function createCalibrePreviewBridge(input: {
  cacheDirectory: string;
  timeoutMs?: number;
}): CalibrePreviewBridge | null {
  let convert: string | null = null;
  let debug: string | null = null;
  for (const root of candidateRoots()) {
    const candidate = path.join(root, 'ebook-convert.exe');
    if (!convert && isFile(candidate)) convert = candidate;
    const debugCandidate = path.join(root, 'calibre-debug.exe');
    if (!debug && isFile(debugCandidate)) debug = debugCandidate;
  }
  if (!convert) return null;

  const formats = discoverFormats(debug);
  const timeoutMs = input.timeoutMs ?? 90_000;
  const booksDirectory = path.join(input.cacheDirectory, 'calibre-books');
  const convertStats = statSync(convert);
  const converterIdentity = `${convertStats.size}:${convertStats.mtimeMs}`;
  const inFlight = new Map<string, Promise<CalibrePreviewResult | { ok: false; error?: string }>>();

  return {
    formats: Object.freeze([...formats].sort()),
    supports(extension) {
      return formats.has(extension.trim().toLowerCase());
    },
    async convertToPdf(target) {
      let sourceStats;
      try {
        sourceStats = await fs.stat(target);
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
      if (!sourceStats.isFile()) return { ok: false, error: 'Book preview source is not a file.' };

      const stateKey = createHash('sha256')
        .update(path.resolve(target).toLocaleLowerCase('en-US'))
        .update('\0')
        .update(String(sourceStats.size))
        .update('\0')
        .update(String(sourceStats.mtimeMs))
        .update('\0')
        .update(converterIdentity)
        .digest('hex');
      const output = path.join(booksDirectory, `${stateKey}.pdf`);
      if (await validPdf(output)) {
        return { ok: true, filePath: output, cleanup: async () => {}, stateKey, cached: true };
      }

      const existing = inFlight.get(stateKey);
      if (existing) return existing;

      const work = (async (): Promise<CalibrePreviewResult | { ok: false; error?: string }> => {
        await fs.mkdir(booksDirectory, { recursive: true });
        const temp = path.join(
          booksDirectory,
          `${stateKey}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp.pdf`,
        );
        try {
          await new Promise<void>((resolve, reject) => {
            execFile(convert!, [target, temp], {
              windowsHide: true,
              timeout: timeoutMs,
              maxBuffer: 2 * 1024 * 1024,
              encoding: 'utf8',
            }, (error) => error ? reject(error) : resolve());
          });
          if (!await validPdf(temp)) throw new Error('Calibre did not create a valid PDF preview.');
          await fs.rename(temp, output).catch(async (error: NodeJS.ErrnoException) => {
            if (error.code === 'EEXIST' && await validPdf(output)) {
              await fs.rm(temp, { force: true });
              return;
            }
            throw error;
          });
          return { ok: true, filePath: output, cleanup: async () => {}, stateKey, cached: false };
        } catch (error) {
          await fs.rm(temp, { force: true }).catch(() => undefined);
          return { ok: false, error: boundedError(error) };
        }
      })();
      inFlight.set(stateKey, work);
      try {
        return await work;
      } finally {
        if (inFlight.get(stateKey) === work) inFlight.delete(stateKey);
      }
    },
  };
}
