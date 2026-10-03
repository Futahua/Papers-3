/**
 * Phone connector launcher.
 *
 * Starts the "Run on Computer" PC connector (vendored in
 * `tools/hermes-companion`, installed per-user to `~/.hermes/mesh/`) so the Apers
 * Android app can auto-discover this machine on the LAN and run tasks on the same
 * Hermes Papers already uses. It talks to Hermes via the hermes-agent venv CLI
 * (`hermes -z`) against the default `~/.hermes` home — it does NOT start a second
 * dashboard/backend and does not touch Papers' 127.0.0.1:9119 process.
 *
 * Best-effort and fully decoupled from the Hermes Desktop surface: if the
 * connector isn't installed or fails to start, Papers is unaffected. The
 * connector enforces its own single-instance (fixed companion TCP port), so
 * relaunching Papers never spawns a duplicate.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function meshDir(): string {
  return join(homedir(), '.hermes', 'mesh');
}

function resolvePythonw(): string | null {
  const candidates = [
    process.env['APERS_CONNECTOR_PYTHONW'],
    join(meshDir(), 'venv', 'Scripts', 'pythonw.exe'),
    join(meshDir(), 'venv', 'bin', 'python3'),
  ].filter((v): v is string => Boolean(v));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function resolveScript(): string | null {
  const script = join(meshDir(), 'companion', 'apers_connector.py');
  return existsSync(script) ? script : null;
}

/**
 * Launch the phone connector in the background. Returns silently if it isn't
 * installed (the creator hasn't run `install-connector.ps1` yet) or on any
 * spawn error — never throws into Papers bootstrap.
 */
export function startPhoneConnector(): void {
  try {
    const py = resolvePythonw();
    const script = resolveScript();
    if (!py || !script) {
      console.info('[papers] phone connector not installed; skipping (Run on Computer stays manual).');
      return;
    }
    const child = spawn(py, [script], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      cwd: join(meshDir(), 'companion'),
    });
    child.on('error', (err) => {
      console.warn('[papers] phone connector failed to start:', err.message);
    });
    child.unref();
    console.info('[papers] phone connector launched (Run on Computer auto-discovery).');
  } catch (err) {
    console.warn('[papers] phone connector launch error:', err);
  }
}
