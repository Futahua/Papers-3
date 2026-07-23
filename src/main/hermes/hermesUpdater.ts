import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { app, BrowserWindow } from 'electron';

const HELPER_FLAG = '--papers-hermes-update-helper';
const HERMES_ROOT_FLAG = '--papers-hermes-root=';
const WAIT_PID_FLAG = '--papers-wait-pid=';
const HERMES_PID_FLAG = '--papers-hermes-pid=';

export function isHermesUpdateHelper(): boolean {
  return process.argv.includes(HELPER_FLAG);
}

function valueOf(prefix: string): string | null {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function valuesOf(prefix: string): string[] {
  return process.argv.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length));
}

/**
 * Start a second Papers process whose only job is to update Hermes after this
 * Papers process and its Hermes children have released their Windows file
 * locks. The helper deliberately uses the packaged Papers executable, so the
 * product does not depend on Node, PowerShell, or another developer tool being
 * installed on the machine.
 */
export function launchHermesUpdateHelper(hermesRoot: string, hermesPids: number[] = []): boolean {
  const integrationDir = app.isPackaged
    ? join(process.resourcesPath, 'hermes-integration')
    : join(app.getAppPath(), 'hermes-skin');
  const patchFile = join(integrationDir, 'papers-integration.patch');
  const pluginFile = join(integrationDir, 'papers-theme-plugin.js');

  if (!existsSync(patchFile) || !existsSync(pluginFile)) return false;

  const child = spawn(
    process.execPath,
    [
      HELPER_FLAG,
      `${HERMES_ROOT_FLAG}${hermesRoot}`,
      `${WAIT_PID_FLAG}${process.pid}`,
      ...hermesPids
        .filter((pid) => Number.isInteger(pid) && pid > 0)
        .map((pid) => `${HERMES_PID_FLAG}${pid}`),
    ],
    {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        PAPERS_HERMES_INTEGRATION_DIR: integrationDir,
        PAPERS_HERMES_UPDATE_DATA: app.getPath('userData'),
      },
    },
  );
  child.unref();
  return true;
}

function updaterHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root { color-scheme: light; font-family: "Segoe UI Variable", "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f2ec; color: #20201e; }
  main { padding: 34px 38px 28px; }
  .eyebrow { color: #697069; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 8px 0 8px; font: 42px/1.05 Georgia, serif; }
  #status { margin: 0 0 22px; color: #55564f; font-size: 15px; }
  .track { height: 5px; overflow: hidden; border-radius: 10px; background: #dcd8ce; }
  #bar { width: 5%; height: 100%; background: #526b5a; transition: width .3s ease; }
  #log { height: 190px; margin-top: 20px; padding: 14px; overflow: auto; border: 1px solid #d2cec4; border-radius: 8px; background: rgba(255,255,255,.55); color: #4b4b46; font: 12px/1.5 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
  .note { margin-top: 14px; color: #74736c; font-size: 12px; }
</style></head><body><main>
  <div class="eyebrow">Papers · Hermes</div>
  <h1>Updating Hermes</h1>
  <p id="status">Waiting for Papers and Hermes to close…</p>
  <div class="track"><div id="bar"></div></div>
  <pre id="log"></pre>
  <div class="note">Your conversations, settings, credentials and Backpacks are not modified.</div>
</main><script>
  window.papersUpdate = (status, percent, line) => {
    document.getElementById('status').textContent = status;
    document.getElementById('bar').style.width = Math.max(5, Math.min(100, percent)) + '%';
    if (line) { const el = document.getElementById('log'); el.textContent += line + '\\n'; el.scrollTop = el.scrollHeight; }
  };
</script></body></html>`;
}

async function waitForExit(pid: number, timeoutMs = 30_000): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  // The normal close path should have completed. If it did not, terminate only
  // the exact Papers process tree whose PID the parent handed us.
  await runCaptured('taskkill', ['/PID', String(pid), '/T', '/F'], process.cwd(), () => {});
}

function runCaptured(
  command: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    const feed = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.once('error', reject);
    child.once('exit', (code) => resolveCode(code ?? 1));
  });
}

async function applyIntegration(
  hermesRoot: string,
  integrationDir: string,
  onLine: (line: string) => void,
): Promise<void> {
  const patchFile = join(integrationDir, 'papers-integration.patch');
  const pluginSource = join(integrationDir, 'papers-theme-plugin.js');
  if (!existsSync(patchFile) || !existsSync(pluginSource)) {
    throw new Error('The Papers Hermes integration files are missing.');
  }

  const check = await runCaptured('git', ['apply', '--check', patchFile], hermesRoot, onLine);
  if (check === 0) {
    const applied = await runCaptured('git', ['apply', patchFile], hermesRoot, onLine);
    if (applied !== 0) throw new Error('The Papers integration patch could not be applied.');
  } else {
    const already = await runCaptured('git', ['apply', '--reverse', '--check', patchFile], hermesRoot, onLine);
    if (already !== 0) {
      throw new Error('Hermes changed around the Papers integration seam; the small patch needs refreshing.');
    }
    onLine('Papers integration is already present.');
  }

  const hermesHome = resolve(hermesRoot, '..');
  const pluginDir = join(hermesHome, 'desktop-plugins', 'papers-theme');
  mkdirSync(pluginDir, { recursive: true });
  cpSync(pluginSource, join(pluginDir, 'plugin.js'));
}

export async function runHermesUpdateHelper(): Promise<void> {
  const hermesRoot = valueOf(HERMES_ROOT_FLAG);
  const waitPid = Number(valueOf(WAIT_PID_FLAG));
  const hermesPids = valuesOf(HERMES_PID_FLAG).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  const integrationDir = process.env['PAPERS_HERMES_INTEGRATION_DIR'];
  const dataDir = process.env['PAPERS_HERMES_UPDATE_DATA'];
  if (!hermesRoot || !integrationDir || !dataDir) {
    app.quit();
    return;
  }

  mkdirSync(dataDir, { recursive: true });
  const logPath = join(dataDir, 'hermes-update.log');
  const resultPath = join(dataDir, 'hermes-update-result.json');
  const log: string[] = [];
  const win = new BrowserWindow({
    width: 650,
    height: 470,
    minWidth: 560,
    minHeight: 400,
    title: 'Updating Hermes',
    backgroundColor: '#f4f2ec',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updaterHtml())}`);

  const report = (status: string, percent: number, line?: string): void => {
    if (line) {
      log.push(line);
      try {
        writeFileSync(logPath, `${log.join('\n')}\n`, 'utf8');
      } catch {
        /* the visible updater remains the source of truth */
      }
    }
    if (!win.isDestroyed()) {
      void win.webContents.executeJavaScript(
        `window.papersUpdate(${JSON.stringify(status)},${percent},${JSON.stringify(line ?? '')})`,
      );
    }
  };

  let ok = false;
  let detail = '';
  try {
    report('Waiting for Papers and Hermes to close…', 8);
    await waitForExit(waitPid);
    // Normal shutdown is graceful. These exact, parent-supplied process roots
    // are a bounded Windows backstop for backend grandchildren that would
    // otherwise keep hermes.exe or a native Python module mapped.
    for (const pid of hermesPids) {
      try {
        process.kill(pid, 0);
      } catch {
        continue;
      }
      await runCaptured('taskkill', ['/PID', String(pid), '/T', '/F'], process.cwd(), (line) =>
        report('Closing the previous Hermes processes…', 12, line),
      );
    }
    await new Promise((done) => setTimeout(done, 800));

    const hermesExe = join(hermesRoot, 'venv', 'Scripts', 'hermes.exe');
    if (!existsSync(hermesExe)) throw new Error(`Hermes updater was not found at ${hermesExe}`);

    report('Running the official Hermes updater…', 18, 'Starting: hermes update --yes');
    const updateCode = await runCaptured(
      hermesExe,
      ['update', '--yes'],
      hermesRoot,
      (line) => report('Running the official Hermes updater…', 42, line),
      { ...process.env, PYTHONUNBUFFERED: '1' },
    );
    if (updateCode !== 0) throw new Error(`Hermes updater exited with code ${updateCode}.`);

    report('Restoring the Papers appearance and window integration…', 72);
    await applyIntegration(hermesRoot, integrationDir, (line) =>
      report('Restoring the Papers appearance and window integration…', 76, line),
    );

    report('Building the updated Hermes Desktop…', 82);
    const buildCode = await runCaptured(
      hermesExe,
      ['desktop', '--build-only', '--force-build'],
      hermesRoot,
      (line) => report('Building the updated Hermes Desktop…', 91, line),
      { ...process.env, PYTHONUNBUFFERED: '1' },
    );
    if (buildCode !== 0) throw new Error(`Hermes Desktop rebuild exited with code ${buildCode}.`);

    ok = true;
    detail = 'Hermes and the Papers integration were updated successfully.';
    report('Finished. Reopening Papers…', 100, detail);
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
    report('The update needs attention. Reopening Papers…', 100, `ERROR: ${detail}`);
  }

  writeFileSync(
    resultPath,
    JSON.stringify({ ok, detail, at: new Date().toISOString(), logPath }, null, 2),
    'utf8',
  );
  await new Promise((done) => setTimeout(done, ok ? 1200 : 3500));
  const relaunched = spawn(process.execPath, [], { detached: true, stdio: 'ignore' });
  relaunched.unref();
  app.quit();
}
