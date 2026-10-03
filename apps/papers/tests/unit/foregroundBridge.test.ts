import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FOREGROUND_BRIDGE_EXECUTABLE,
  createForegroundBridge,
  resolveWindowsCscPath,
} from '../../src/main/windows/foregroundBridge';

const REPO_ROOT = path.join(__dirname, '../..');
const BRIDGE_SOURCE = path.join(REPO_ROOT, 'resources', 'native', 'fg-bridge.cs');

function cacheDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fg-bridge-'));
}

describe('resolveWindowsCscPath', () => {
  it('resolves the compiler that ships with Windows', () => {
    const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR'];
    if (!systemRoot) return; // not Windows: nothing to assert
    const resolved = resolveWindowsCscPath(systemRoot);
    expect(resolved).not.toBeNull();
    expect(fs.statSync(resolved!).isFile()).toBe(true);
  });

  it('returns null for a missing or empty system root rather than guessing', () => {
    expect(resolveWindowsCscPath('')).toBeNull();
    expect(resolveWindowsCscPath('C:\\definitely-not-a-windows-root')).toBeNull();
  });
});

describe('createForegroundBridge', () => {
  it('refuses to exist when the shipped source is unreadable', () => {
    const bridge = createForegroundBridge({
      cacheDirectory: cacheDir(),
      sourcePath: path.join(REPO_ROOT, 'resources', 'native', 'not-a-real-file.cs'),
    });
    expect(bridge).toBeNull();
  });

  it('refuses to exist when there is no compiler, instead of returning a stub', () => {
    const bridge = createForegroundBridge({
      cacheDirectory: cacheDir(),
      sourcePath: BRIDGE_SOURCE,
      compilerPath: 'C:\\definitely-not-a-compiler\\csc.exe',
    });
    expect(bridge).toBeNull();
  });

  it('compiles once and caches the executable', () => {
    const dir = cacheDir();
    const first = createForegroundBridge({ cacheDirectory: dir, sourcePath: BRIDGE_SOURCE });
    if (first === null) return; // no compiler on this machine: nothing to assert

    const executable = path.join(dir, FOREGROUND_BRIDGE_EXECUTABLE);
    expect(fs.existsSync(executable)).toBe(true);
    expect(fs.existsSync(`${executable}.stamp`)).toBe(true);

    // A second call reuses the cached binary rather than recompiling.
    const stampBefore = fs.statSync(executable).mtimeMs;
    const second = createForegroundBridge({ cacheDirectory: dir, sourcePath: BRIDGE_SOURCE });
    expect(second).not.toBeNull();
    expect(fs.statSync(executable).mtimeMs).toBe(stampBefore);
  });

  it('rebuilds when the shipped source changes, so a stale binary cannot answer', () => {
    const dir = cacheDir();
    const copy = path.join(dir, 'fg-bridge.cs');
    fs.writeFileSync(copy, fs.readFileSync(BRIDGE_SOURCE));
    const first = createForegroundBridge({ cacheDirectory: dir, sourcePath: copy });
    if (first === null) return;

    const executable = path.join(dir, FOREGROUND_BRIDGE_EXECUTABLE);
    const stampBefore = fs.readFileSync(`${executable}.stamp`, 'utf8');

    // Change the source and confirm the stamp no longer matches it.
    fs.appendFileSync(copy, '\n// changed\n');
    const second = createForegroundBridge({ cacheDirectory: dir, sourcePath: copy });
    expect(second).not.toBeNull();
    const stampAfter = fs.readFileSync(`${executable}.stamp`, 'utf8');
    expect(stampAfter).not.toBe(stampBefore);
  });

  it('reports the current foreground window as a positive handle', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    const handle = await bridge.foregroundWindow();
    // There is always a foreground window while a desktop session is running.
    // It may legitimately be null when the shell owns it, so accept either but
    // require a sane value when present.
    if (handle !== null) {
      expect(Number.isSafeInteger(handle)).toBe(true);
      expect(handle).toBeGreaterThan(0);
    }
  });

  it('reports a known-live window as a window and a bogus handle as not', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    expect(await bridge.isWindow(0)).toBe(false);
    expect(await bridge.isWindow(-1)).toBe(false);
    expect(await bridge.isWindow(1)).toBe(false);

    const foreground = await bridge.foregroundWindow();
    if (foreground !== null) {
      expect(await bridge.isWindow(foreground)).toBe(true);
    }
  });

  it('refuses to claim focus was set for an invalid or dead handle', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    expect(await bridge.setForegroundWindow(0)).toBe(false);
    expect(await bridge.setForegroundWindow(-5)).toBe(false);
    // A handle that is not a window must never read as success.
    expect(await bridge.setForegroundWindow(1)).toBe(false);
  });

  it('setting focus on a window that ALREADY has it answers promptly instead of hanging', async () => {
    // Measured: SetForegroundWindow on the window that already owns the
    // foreground can block indefinitely, which turned a real verification run
    // into a timeout. The bridge short-circuits that case.
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    const foreground = await bridge.foregroundWindow();
    if (foreground === null) return; // the shell owns it: nothing to assert

    expect(await bridge.isForegroundWindow(foreground)).toBe(true);
    const started = Date.now();
    const result = await bridge.setForegroundWindow(foreground);
    const elapsed = Date.now() - started;
    expect(result).toBe(true);
    // The timeout is 8s; a genuine hang would sit there until it fired.
    expect(elapsed).toBeLessThan(4000);
  });

  it('reports whether an arbitrary handle owns the foreground rather than guessing', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    expect(await bridge.isForegroundWindow(0)).toBe(false);
    expect(await bridge.isForegroundWindow(1)).toBe(false);

    const foreground = await bridge.foregroundWindow();
    if (foreground !== null) {
      expect(await bridge.isForegroundWindow(foreground)).toBe(true);
    }
  });

  it('finds the next window in the z-order, or reports none', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    expect(await bridge.nextWindowInZOrder(0)).toBeNull();
    expect(await bridge.nextWindowInZOrder(1)).toBeNull();

    const foreground = await bridge.foregroundWindow();
    if (foreground === null) return;
    // There is always a desktop behind the foreground window, so this either
    // finds a real window or honestly reports none. It must never hang.
    const next = await bridge.nextWindowInZOrder(foreground);
    if (next !== null) {
      expect(next).toBeGreaterThan(0);
      expect(next).not.toBe(foreground);
    }
  });

  it('does not claim activation when the requested Papers process has no window', async () => {
    const bridge = createForegroundBridge({ cacheDirectory: cacheDir(), sourcePath: BRIDGE_SOURCE });
    if (bridge === null) return;

    const unrelatedExecutable = path.join(os.tmpdir(), `papers-no-live-process-${process.pid}-${Date.now()}.exe`);
    const result = await bridge.activatePapersProcess(unrelatedExecutable);
    expect(result).toMatchObject({ found: false, activated: false, foregroundGranted: false });
  });
});
