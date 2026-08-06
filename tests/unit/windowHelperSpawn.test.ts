import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildWindowHelperSpawnSpec,
  resolveWindowsPowerShellRuntime,
  WINDOW_HELPER_ARGUMENT_PREFIX,
  WINDOW_HELPER_EXECUTABLE,
} from '../../src/main/windows/windowHelperSpawn';

const REAL_SYSTEM_ROOT = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';

describe('windowHelperSpawn fixed spec', () => {
  const runtimePath = path.join(REAL_SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helperPath = 'C:\\Papers\\resources\\window-helper\\window-helper.ps1';
  const spec = buildWindowHelperSpawnSpec(runtimePath, helperPath);

  it('spawns the validated absolute runtime, never a bare executable', () => {
    expect(spec.file).toBe(runtimePath);
    expect(spec.file).not.toBe(WINDOW_HELPER_EXECUTABLE);
    expect(path.isAbsolute(spec.file)).toBe(true);
  });

  it('uses the fixed noninteractive/no-profile arguments with the resolved helper path', () => {
    expect(spec.args).toEqual([...WINDOW_HELPER_ARGUMENT_PREFIX, helperPath]);
    expect(WINDOW_HELPER_ARGUMENT_PREFIX).toEqual(['-NoProfile', '-NonInteractive', '-File']);
  });

  it('never uses a shell', () => {
    expect(spec.options.shell).toBe(false);
  });

  it('hides the child window and uses pipe-only stdio', () => {
    expect(spec.options.windowsHide).toBe(true);
    expect(spec.options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('carries no cwd, environment, limits or user-supplied values', () => {
    const options = spec.options as Record<string, unknown>;
    expect(options).not.toHaveProperty('cwd');
    expect(options).not.toHaveProperty('env');
    expect(options).not.toHaveProperty('maxBuffer');
    expect(options).not.toHaveProperty('uid');
    expect(options).not.toHaveProperty('gid');
    expect(options).not.toHaveProperty('detached');
    expect(options).not.toHaveProperty('timeout');
    expect(spec.args.some((arg) => arg.includes(';') || arg.includes('&') || arg.includes('|'))).toBe(false);
  });
});

describe('resolveWindowsPowerShellRuntime', () => {
  it('resolves the trusted absolute runtime under the real SystemRoot', () => {
    const result = resolveWindowsPowerShellRuntime({ systemRoot: REAL_SYSTEM_ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(path.isAbsolute(result.path)).toBe(true);
      expect(result.path.toLowerCase()).toBe(path.join(REAL_SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe').toLowerCase());
      expect(path.basename(result.path).toLowerCase()).toBe(WINDOW_HELPER_EXECUTABLE);
    }
  });

  it('rejects a missing runtime before any spawn', () => {
    const missing = path.join(os.tmpdir(), 'no-such-windows-root-' + Math.random().toString(36).slice(2));
    const result = resolveWindowsPowerShellRuntime({ systemRoot: missing });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toContain('not available');
  });

  it('rejects a non-Windows platform', () => {
    const result = resolveWindowsPowerShellRuntime({ systemRoot: REAL_SYSTEM_ROOT, platform: 'linux' });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing system root input', () => {
    const result = resolveWindowsPowerShellRuntime({ systemRoot: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-absolute derived runtime path', () => {
    const result = resolveWindowsPowerShellRuntime({ systemRoot: 'relative-root' });
    expect(result.ok).toBe(false);
  });
});
