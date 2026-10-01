import { execFile, execFileSync } from 'node:child_process';
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

  return {
    formats: Object.freeze([...formats].sort()),
    supports(extension) {
      return formats.has(extension.trim().toLowerCase());
    },
    async convertToPdf(target) {
      await fs.mkdir(input.cacheDirectory, { recursive: true });
      const tempRoot = await fs.mkdtemp(path.join(input.cacheDirectory, 'calibre-preview-'));
      const output = path.join(tempRoot, 'preview.pdf');
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(convert!, [target, output], {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            encoding: 'utf8',
          }, (error) => error ? reject(error) : resolve());
        });
        const stats = await fs.stat(output);
        if (!stats.isFile() || stats.size < 5) throw new Error('Calibre did not create a PDF preview.');
        return {
          ok: true,
          filePath: output,
          cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
        };
      } catch (error) {
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        return { ok: false, error: boundedError(error) };
      }
    },
  };
}
