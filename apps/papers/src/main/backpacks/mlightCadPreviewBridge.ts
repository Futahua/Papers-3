import { execFile, execFileSync } from 'node:child_process';
import { promises as fs, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { getOrCreateDerivedArtifact, getOrCreateSourceSnapshot } from './derivedPreviewCache';

const CAD_EXTENSIONS = new Set(['.dwg', '.dxf']);
const DEFAULT_ROOT = 'D:\\Programs\\MLightCADPreview';
const SHARED_PLAYWRIGHT_ROOT = 'D:\\Letters\\MatTroiSeConMoc\\HermesAI\\ms-playwright';

export interface MlightCadPreviewBridge {
  supports(extension: string): boolean;
  convertToHtml(target: string): Promise<
    { ok: true; filePath: string; stateKey: string; cached: boolean; provider: string }
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

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function findNode(): string | null {
  const explicit = process.env['PAPERS_NODE_EXE'];
  if (explicit && isFile(explicit)) return explicit;
  const standard = 'C:\\Program Files\\nodejs\\node.exe';
  if (isFile(standard)) return standard;
  try {
    const first = execFileSync('where.exe', ['node.exe'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 2_000,
    }).split(/\r?\n/).map((item) => item.trim()).find(Boolean);
    return first && isFile(first) ? first : null;
  } catch {
    return null;
  }
}

function findInstallationRoot(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env['PAPERS_MLIGHTCAD_PREVIEW_ROOT'],
    DEFAULT_ROOT,
  ].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    const cli = path.join(candidate, 'node_modules', '@mlightcad', 'cad-simple-viewer-cli', 'dist', 'cli.js');
    const script = path.join(candidate, 'node_modules', '@mlightcad', 'cad-simple-viewer-cli', 'examples', 'export-html.scr');
    if (isFile(cli) && isFile(script)) return candidate;
  }
  return null;
}

function findPlaywrightRoot(installationRoot: string, explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env['PLAYWRIGHT_BROWSERS_PATH'],
    path.join(installationRoot, 'ms-playwright'),
    SHARED_PLAYWRIGHT_ROOT,
  ].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    if (!isDirectory(candidate)) continue;
    try {
      if (readdirSync(candidate, { withFileTypes: true }).some((entry) => entry.isDirectory() && /^chromium(?:_headless_shell)?-\d+$/i.test(entry.name))) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 700);
}

async function validHtml(target: string): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    if (!stats.isFile() || stats.size < 512) return false;
    const handle = await fs.open(target, 'r');
    try {
      const sample = Buffer.alloc(Math.min(8_192, stats.size));
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const text = sample.subarray(0, bytesRead).toString('utf8').toLowerCase();
      return text.includes('<!doctype html') || text.includes('<html');
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export function createMlightCadPreviewBridge(input: {
  cacheDirectory: string;
  installationRoot?: string;
  playwrightRoot?: string;
  timeoutMs?: number;
}): MlightCadPreviewBridge | null {
  const installationRoot = findInstallationRoot(input.installationRoot);
  const node = findNode();
  if (!installationRoot || !node) return null;
  const playwrightRoot = findPlaywrightRoot(installationRoot, input.playwrightRoot);
  // Never allow Playwright to silently fall back to a C: user cache on this machine.
  if (!playwrightRoot || path.parse(playwrightRoot).root.toUpperCase() !== 'D:\\') return null;

  const packageRoot = path.join(installationRoot, 'node_modules', '@mlightcad', 'cad-simple-viewer-cli');
  const cli = path.join(packageRoot, 'dist', 'cli.js');
  const script = path.join(packageRoot, 'examples', 'export-html.scr');
  let version = 'unknown';
  try {
    const parsed = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version) version = parsed.version;
  } catch {
    // Version only affects cache identity.
  }
  const cliStats = statSync(cli);
  const providerKey = `mlightcad-html:${version}:${cliStats.size}:${cliStats.mtimeMs}`;
  const timeoutMs = input.timeoutMs ?? 150_000;

  return {
    supports(extension) {
      return CAD_EXTENSIONS.has(extension.trim().toLowerCase());
    },
    async convertToHtml(target) {
      try {
        const artifact = await getOrCreateDerivedArtifact({
          cacheDirectory: input.cacheDirectory,
          source: target,
          providerKey,
          extension: '.html',
          validate: validHtml,
          create: async (output) => {
            const snapshot = await getOrCreateSourceSnapshot({
              cacheDirectory: input.cacheDirectory,
              source: target,
            });
            const work = `${output}.work-${process.pid}-${Date.now()}`;
            await fs.mkdir(work, { recursive: true });
            try {
              await new Promise<void>((resolve, reject) => {
                execFile(
                  node,
                  [cli, '-i', snapshot.filePath, '-s', script, '-o', work, '--mode', 'read', '--open-view-mode', 'extents'],
                  {
                    windowsHide: true,
                    timeout: timeoutMs,
                    maxBuffer: 2 * 1024 * 1024,
                    encoding: 'utf8',
                    env: {
                      ...process.env,
                      PLAYWRIGHT_BROWSERS_PATH: playwrightRoot,
                      TEMP: process.env['TEMP']?.toUpperCase().startsWith('D:\\')
                        ? process.env['TEMP']
                        : path.dirname(installationRoot),
                      TMP: process.env['TMP']?.toUpperCase().startsWith('D:\\')
                        ? process.env['TMP']
                        : path.dirname(installationRoot),
                    },
                  },
                  (error, stdout, stderr) => {
                    if (error) reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
                    else resolve();
                  },
                );
              });
              const html = (await fs.readdir(work, { withFileTypes: true }))
                .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
                .map((entry) => path.join(work, entry.name))[0];
              if (!html || !(await validHtml(html))) {
                throw new Error('MLightCAD did not create a valid interactive HTML preview.');
              }
              await fs.copyFile(html, output);
            } finally {
              await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
            }
          },
        });
        return {
          ok: true,
          filePath: artifact.filePath,
          stateKey: artifact.key,
          cached: artifact.cached,
          provider: `mlightcad-${version}`,
        };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },
  };
}
