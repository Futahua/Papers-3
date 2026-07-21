/**
 * E2E helpers: launch the built Papers app under playwright-core's Electron
 * driver with an isolated userData directory, and drive host/program
 * WebContentsViews through the main process (WebContentsView pages are not
 * always surfaced as Playwright pages, so we evaluate through main).
 */
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface LaunchedApp {
  app: ElectronApplication;
  userDataDir: string;
  close: () => Promise<void>;
}

const repoRoot = path.resolve(__dirname, '..', '..');

export async function launchPapers(
  existingUserData?: string,
  options: { fixtures?: boolean } = { fixtures: true },
): Promise<LaunchedApp> {
  const userDataDir =
    existingUserData ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-e2e-')));
  // PAPERS_E2E_EXE switches the suite to a packaged binary (win-unpacked or
  // installed) so the same tests validate the packaged application.
  const packagedExe = process.env['PAPERS_E2E_EXE'];
  const app = await electron.launch({
    ...(packagedExe ? { executablePath: packagedExe, args: [] } : { args: [repoRoot] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      PAPERS_TEST_USER_DATA: userDataDir,
      PAPERS_ENABLE_FIXTURES: options.fixtures === false ? '0' : '1',
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  return {
    app,
    userDataDir,
    close: async () => {
      try {
        await app.close();
      } catch {
        // Window may already be gone at the end of a test.
      }
    },
  };
}

/** Run JS inside the host view's page and return the JSON-serializable result. */
export async function evalInHost<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ BaseWindow }, js) => {
    const win = BaseWindow.getAllWindows()[0];
    if (!win) throw new Error('no window');
    const views = win.contentView.children as Electron.WebContentsView[];
    const host = views[0];
    if (!host) throw new Error('no host view');
    return host.webContents.executeJavaScript(js, true);
  }, script) as Promise<T>;
}

/** Run JS inside the active program view's page. */
export async function evalInProgram<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ BaseWindow }, js) => {
    const win = BaseWindow.getAllWindows()[0];
    if (!win) throw new Error('no window');
    const views = win.contentView.children as Electron.WebContentsView[];
    if (views.length < 2) throw new Error('no program view attached');
    const program = views[views.length - 1];
    return program!.webContents.executeJavaScript(js, true);
  }, script) as Promise<T>;
}

export async function programViewCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(async ({ BaseWindow }) => {
    const win = BaseWindow.getAllWindows()[0];
    if (!win) return 0;
    return win.contentView.children.length - 1;
  });
}

export async function crashActiveProgram(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BaseWindow }) => {
    const win = BaseWindow.getAllWindows()[0];
    if (!win) throw new Error('no window');
    const views = win.contentView.children as Electron.WebContentsView[];
    if (views.length < 2) throw new Error('no program view');
    views[views.length - 1]!.webContents.forcefullyCrashRenderer();
  });
}

export async function waitFor(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (last error: ${String(lastError)})` : ''}`);
}

/** Click a DOM element in the host page by CSS selector + optional text match. */
export function clickScript(selector: string, textIncludes?: string): string {
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = ${
      textIncludes === undefined
        ? 'nodes[0]'
        : `nodes.find((n) => (n.textContent ?? '').includes(${JSON.stringify(textIncludes)}))`
    };
    if (!target) return false;
    target.click();
    return true;
  })()`;
}
