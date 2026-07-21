/**
 * Thin host for the existing Hermes products.
 *
 * Papers does not implement chat, sessions, attachments, models, settings,
 * tool rendering, or approvals. The sidebar displays Hermes Dashboard's own
 * /chat surface; pop-out launches Hermes Desktop with an optional cwd.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { shell, WebContentsView, type BaseWindow } from 'electron';

export type HermesSurfaceState =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'ready'; url: string }
  | { state: 'error'; detail: string };

export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DASHBOARD_ORIGIN = 'http://127.0.0.1:9119';
const CHAT_URL = `${DASHBOARD_ORIGIN}/chat`;
const START_TIMEOUT_MS = 120_000;

export class HermesSurface {
  private view: WebContentsView | null = null;
  private attached = false;
  private dashboardProcess: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private currentState: HermesSurfaceState = { state: 'idle' };
  private bounds: SurfaceBounds = { x: 0, y: 48, width: 480, height: 700 };

  constructor(private readonly window: BaseWindow) {}

  get state(): HermesSurfaceState {
    return this.currentState;
  }

  private setState(state: HermesSurfaceState): void {
    this.currentState = state;
  }

  private async dashboardResponds(): Promise<boolean> {
    try {
      const response = await fetch(`${DASHBOARD_ORIGIN}/api/status`, {
        signal: AbortSignal.timeout(1_000),
        redirect: 'manual',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async ensureDashboard(): Promise<void> {
    if (await this.dashboardResponds()) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.setState({ state: 'starting' });
      const child = spawn(
        'hermes',
        ['dashboard', '--host', '127.0.0.1', '--port', '9119', '--no-open'],
        { windowsHide: true, stdio: 'ignore' },
      );
      this.dashboardProcess = child;
      child.once('error', (error) => {
        this.setState({ state: 'error', detail: `Could not launch Hermes Dashboard: ${error.message}` });
      });
      child.once('exit', (code) => {
        if (this.dashboardProcess === child) this.dashboardProcess = null;
        if (code !== null && code !== 0 && this.currentState.state !== 'ready') {
          this.setState({ state: 'error', detail: `Hermes Dashboard exited with code ${code}` });
        }
      });

      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await this.dashboardResponds()) return;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error('Hermes Dashboard did not become ready within two minutes');
    })().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
      },
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          void shell.openExternal(target.toString());
        }
      } catch {
        // Malformed and non-web targets stay closed.
      }
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      try {
        if (new URL(url).origin !== DASHBOARD_ORIGIN) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    return view;
  }

  setBounds(bounds: SurfaceBounds): void {
    this.bounds = bounds;
    if (this.attached && this.view) this.view.setBounds(bounds);
  }

  async show(bounds?: SurfaceBounds): Promise<HermesSurfaceState> {
    if (bounds) this.setBounds(bounds);
    try {
      await this.ensureDashboard();
      if (!this.view || this.view.webContents.isDestroyed()) this.view = this.createView();
      if (this.view.webContents.getURL() !== CHAT_URL) await this.view.webContents.loadURL(CHAT_URL);
      if (!this.attached) {
        this.window.contentView.addChildView(this.view);
        this.attached = true;
      }
      this.view.setBounds(this.bounds);
      this.setState({ state: 'ready', url: CHAT_URL });
    } catch (error) {
      this.setState({ state: 'error', detail: String(error instanceof Error ? error.message : error) });
    }
    return this.state;
  }

  hide(): void {
    if (this.attached && this.view) {
      this.window.contentView.removeChildView(this.view);
      this.attached = false;
    }
  }

  /**
   * Launch the existing Hermes Desktop as its own window.
   *
   * Hermes is global: Papers never derives a working directory from a Backpack
   * and never passes `--cwd`. A Hermes context (folder, file, path) belongs to
   * Hermes and is chosen by the creator inside Hermes itself.
   */
  async openDesktop(): Promise<{ opened: true }> {
    const child = spawn('hermes', ['desktop'], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    return { opened: true };
  }

  shutdown(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
    if (this.dashboardProcess && this.dashboardProcess.exitCode === null) this.dashboardProcess.kill();
    this.dashboardProcess = null;
  }
}
