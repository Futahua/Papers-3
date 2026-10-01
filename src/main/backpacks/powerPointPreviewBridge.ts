import { execFile } from 'node:child_process';
import { promises as fs, statSync } from 'node:fs';
import * as path from 'node:path';

import { getOrCreateDerivedArtifact, getOrCreateSourceSnapshot } from './derivedPreviewCache';

const PRESENTATION_EXTENSIONS = new Set(['.ppt', '.pptx', '.pptm']);

export interface PowerPointPreviewBridge {
  supports(extension: string): boolean;
  convertToPdf(target: string): Promise<
    { ok: true; filePath: string; cleanup: () => Promise<void>; stateKey: string; cached: boolean }
    | { ok: false; error?: string }
  >;
}

function candidateExecutables(): string[] {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  return [
    path.join(programFiles, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
    path.join(programFilesX86, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
  ];
}

function findExecutable(): string | null {
  for (const candidate of candidateExecutables()) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try next install location.
    }
  }
  return null;
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
      const { bytesRead } = await handle.read(magic, 0, 5, 0);
      return bytesRead === 5 && magic.toString('ascii') === '%PDF-';
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function powershellScript(source: string, output: string): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  return [
    '$ErrorActionPreference = "Stop"',
    '$app=$null;$pres=$null',
    'try {',
    '  $app=New-Object -ComObject PowerPoint.Application',
    `  $pres=$app.Presentations.Open(${quote(source)},$true,$true,$false)`,
    `  $pres.SaveAs(${quote(output)},32)`,
    '} finally {',
    '  if($pres){try{$pres.Close()}catch{}}',
    '  if($app){try{$app.Quit()}catch{}}',
    '  if($pres){try{[Runtime.InteropServices.Marshal]::FinalReleaseComObject($pres)|Out-Null}catch{}}',
    '  if($app){try{[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null}catch{}}',
    '}',
  ].join('; ');
}

export function createPowerPointPreviewBridge(input: {
  cacheDirectory: string;
  executablePath?: string;
  timeoutMs?: number;
}): PowerPointPreviewBridge | null {
  const executable = input.executablePath ?? findExecutable();
  if (!executable) return null;
  let identity;
  try {
    const stats = statSync(executable);
    identity = `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
  const timeoutMs = input.timeoutMs ?? 60_000;

  return {
    supports(extension) {
      return PRESENTATION_EXTENSIONS.has(extension.trim().toLowerCase());
    },
    async convertToPdf(target) {
      try {
        const artifact = await getOrCreateDerivedArtifact({
          cacheDirectory: input.cacheDirectory,
          source: target,
          providerKey: `powerpoint-pdf:${identity}`,
          extension: '.pdf',
          validate: validPdf,
          create: async (output) => {
            const snapshot = await getOrCreateSourceSnapshot({
              cacheDirectory: input.cacheDirectory,
              source: target,
            });
            await new Promise<void>((resolve, reject) => {
              execFile(
                'powershell.exe',
                ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript(snapshot.filePath, output)],
                { windowsHide: true, timeout: timeoutMs, maxBuffer: 512 * 1024, encoding: 'utf8' },
                (error, _stdout, stderr) => {
                  if (error) reject(new Error(stderr?.trim() || error.message));
                  else resolve();
                },
              );
            });
          },
        });
        return {
          ok: true,
          filePath: artifact.filePath,
          cleanup: async () => {},
          stateKey: artifact.key,
          cached: artifact.cached,
        };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },
  };
}
