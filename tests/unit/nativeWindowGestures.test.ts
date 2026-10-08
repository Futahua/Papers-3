import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'win32')('native window gestures', () => {
  it('compiles and verifies consumed input, latch lifecycle and private window geometry', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'papers-gesture-test-'));
    try {
      const compiler = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
      const executable = path.join(directory, 'gestures.exe');
      execFileSync(compiler, ['/nologo', '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
        `/out:${executable}`, path.resolve('resources/native/window-control.cs')], { windowsHide: true });
      const pure = execFileSync(executable, ['--gesture-selftest'], { windowsHide: true, encoding: 'utf8' });
      expect(pure).toContain('no hooks or input installed');
      const native = execFileSync(executable, ['--gesture-window-selftest'], { windowsHide: true, encoding: 'utf8' });
      expect(native).toContain('only hidden fixture windows used');
    } finally {
      if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir())) throw new Error('Fixture path escaped the temporary directory');
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
