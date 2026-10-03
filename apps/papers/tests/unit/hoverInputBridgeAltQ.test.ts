import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '../..');
const HELPER_SOURCE = path.join(REPO_ROOT, 'resources', 'native', 'hover-input-bridge.cs');
const STATE_TEST_SOURCE = path.join(__dirname, '../native/hover-input-bridge-altq.test.cs');

describe('native Alt+Q hold release watchdog', () => {
  it('admits injected Alt+Q into only the WM_HOTKEY-correlated tracker', () => {
    const source = fs.readFileSync(HELPER_SOURCE, 'utf8');
    const observeDown = source.indexOf('altQChords.ObserveQDown');
    const injectedPassThrough = source.indexOf('if (injected) return CallNextHookEx', observeDown);
    expect(observeDown).toBeGreaterThan(-1);
    expect(injectedPassThrough).toBeGreaterThan(observeDown);
    expect(source).toContain('if (up && altQHotkeyRegistered && altQChords.ObserveKeyUp');
    expect(source).toMatch(/if \(message\.message == WM_HOTKEY[\s\S]*altQChords\.TryStartNext[\s\S]*Emit\("ALTQ\\t"/);
    expect(source).toMatch(/if \(injected\) return CallNextHookEx[\s\S]*WidgetPolicy policy = HitWidget\(\)/);
  });

  it('recovers a key-up that arrives before WM_HOTKEY and releases normally on either key-up', () => {
    if (process.platform !== 'win32') return;
    const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR'];
    expect(systemRoot).toBeTruthy();
    const compiler = path.join(systemRoot!, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    expect(fs.statSync(compiler).isFile()).toBe(true);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-altq-release-test-'));
    const executable = path.join(directory, 'altq-release-test.exe');
    try {
      execFileSync(compiler, [
        '/nologo', '/target:exe', '/main:HoverInputBridgeAltQTests',
        `/out:${executable}`, HELPER_SOURCE, STATE_TEST_SOURCE,
      ], { stdio: 'pipe' });
      execFileSync(executable, [], { stdio: 'pipe' });
      expect(fs.statSync(executable).isFile()).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
