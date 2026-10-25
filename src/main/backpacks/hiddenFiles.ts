import { execFile } from 'node:child_process';

/**
 * Names of the hidden items in a folder (Windows' Hidden attribute, which also covers protected system
 * files), so the Files view can leave them out the way Explorer does unless "Show hidden items" is on.
 * Node does not expose file attributes, so this asks cmd's own `dir` once per folder; `/u` makes it
 * write UTF-16 so every name survives. Anything that goes wrong means "none hidden", never a failed
 * listing. Elsewhere hidden means a leading dot.
 */
export async function hiddenNames(folder: string, names: readonly string[] = []): Promise<Set<string>> {
  if (process.platform !== 'win32') return new Set(names.filter(name => name.startsWith('.')));
  if (/["\r\n]/.test(folder)) return new Set();
  const output = await new Promise<Buffer | null>(resolve => {
    execFile('cmd.exe', ['/d', '/u', '/c', `dir /a:h /b "${folder.replace(/[\\/]+$/, '') || folder}\\"`], { encoding: 'buffer', windowsHide: true, windowsVerbatimArguments: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error && !stdout?.length ? null : stdout));
  });
  if (!output) return new Set();
  return new Set(output.toString('utf16le').split(/\r?\n/).map(line => line.trim()).filter(Boolean));
}
