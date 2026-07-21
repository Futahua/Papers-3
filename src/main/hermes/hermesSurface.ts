/**
 * Papers-managed real Hermes Desktop surface.
 *
 * One Hermes experience, one backend. Papers starts exactly one Hermes backend
 * (`hermes dashboard` on 127.0.0.1:9119 with a Papers-generated session token)
 * and launches the real Hermes Desktop application pointed at that backend via
 * `HERMES_DESKTOP_REMOTE_URL` + `HERMES_DESKTOP_REMOTE_TOKEN`. The desktop then
 * connects to the single backend and never spawns its own — proven from the
 * Hermes Desktop source (apps/desktop/electron/main.cjs `resolveRemoteBackend`).
 *
 * The docked "sidebar" and the "detached" window are the SAME real Hermes
 * Desktop window, positioned by Papers. Docked = Papers pins the Hermes OS
 * window flush against Papers' right edge and keeps it aligned on move/resize.
 * Detached = the window floats freely. Hiding the dock never terminates Hermes
 * or discards its session; the window is simply moved offscreen/minimized so
 * the live conversation, scroll and draft survive.
 *
 * Papers does NOT reimplement chat, sessions, attachments, models, settings,
 * tool rendering, approvals, voice or file browsing. It launches, focuses and
 * arranges the existing Hermes product.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { type BaseWindow } from 'electron';

import { WindowMover, type WindowRect } from './windowMover';

export type HermesPlacement = 'closed' | 'docked' | 'detached';
export type HermesStatus = 'idle' | 'starting' | 'ready' | 'error';

export interface HermesSurfaceState {
  placement: HermesPlacement;
  status: HermesStatus;
  /** Present when status === 'error'. Short, actionable. */
  detail?: string;
}

export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DASHBOARD_HOST = '127.0.0.1';
const DASHBOARD_PORT = 9119;
const DASHBOARD_ORIGIN = `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;
const BACKEND_START_TIMEOUT_MS = 120_000;
const DESKTOP_WINDOW_TITLE = 'Hermes';
/** How long to wait for the Hermes Desktop OS window to appear after launch. */
const DESKTOP_WINDOW_TIMEOUT_MS = 60_000;

/**
 * Candidate install locations for the real Hermes Desktop executable, most
 * specific first. Resolved once; the batch handoff pins the primary path.
 */
function resolveHermesDesktopExe(): string | null {
  const candidates = [
    process.env['PAPERS_HERMES_DESKTOP_EXE'],
    'D:\\LapSlop brotherhood\\Programs\\Assistant\\HermesAI\\.hermes\\hermes-agent\\apps\\desktop\\release\\win-unpacked\\Hermes.exe',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class HermesSurface {
  private backendProcess: ChildProcess | null = null;
  private backendToken: string | null = null;
  private backendStartPromise: Promise<string> | null = null;

  private desktopProcess: ChildProcess | null = null;
  private desktopExited = false;

  private placement: HermesPlacement = 'closed';
  private status: HermesStatus = 'idle';
  private detail: string | undefined;

  private dockBounds: SurfaceBounds | null = null;
  private readonly mover = new WindowMover();
  /** Debounce for high-frequency realignment during Papers resize/move. */
  private realignTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: BaseWindow,
    /** Notifies the renderer so the SVG toggles reflect reality after a
     *  crash, manual close, dock or detach by any path. */
    private readonly onStateChange: (state: HermesSurfaceState) => void = () => {},
  ) {}

  get state(): HermesSurfaceState {
    return this.detail !== undefined
      ? { placement: this.placement, status: this.status, detail: this.detail }
      : { placement: this.placement, status: this.status };
  }

  private setState(next: Partial<HermesSurfaceState>): void {
    if (next.placement !== undefined) this.placement = next.placement;
    if (next.status !== undefined) this.status = next.status;
    this.detail = next.status === 'error' ? next.detail : undefined;
    this.onStateChange(this.state);
  }

  // ----------------------------------------------------------------- backend

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

  /**
   * Ensure exactly one Hermes backend is running and return its session token.
   *
   * If a Papers-owned backend is already up we reuse it. If an *external*
   * dashboard already answers on 9119 (e.g. one the creator started), we adopt
   * it: Hermes Desktop can still talk to it, and we avoid starting a second
   * backend — the whole point of this integration.
   */
  private ensureBackend(): Promise<string> {
    if (this.backendProcess && this.backendToken && this.backendProcess.exitCode === null) {
      return Promise.resolve(this.backendToken);
    }
    if (this.backendStartPromise) return this.backendStartPromise;

    this.backendStartPromise = (async () => {
      // Adopt an already-running dashboard rather than starting a rival one.
      if (await this.dashboardResponds()) {
        // An external dashboard we didn't start has an unknown token; Hermes
        // Desktop only needs a token when the backend enforces one. Use an
        // empty token so the desktop's env-remote path still engages while a
        // no-auth dashboard accepts it. A Papers-started backend below always
        // gets a real token.
        this.backendToken = this.backendToken ?? '';
        return this.backendToken;
      }

      const token = randomBytes(32).toString('base64url');
      const child = spawn(
        'hermes',
        ['dashboard', '--host', DASHBOARD_HOST, '--port', String(DASHBOARD_PORT), '--no-open'],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, HERMES_DASHBOARD_SESSION_TOKEN: token },
        },
      );
      this.backendProcess = child;
      this.backendToken = token;

      child.once('error', (error) => {
        this.setState({ status: 'error', detail: `Could not start Hermes: ${error.message}` });
      });
      child.once('exit', () => {
        if (this.backendProcess === child) {
          this.backendProcess = null;
          this.backendToken = null;
        }
      });

      const deadline = Date.now() + BACKEND_START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await this.dashboardResponds()) return token;
        if (child.exitCode !== null) throw new Error('Hermes backend exited before it became ready.');
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      throw new Error('Hermes backend did not become ready in time.');
    })().finally(() => {
      this.backendStartPromise = null;
    });

    return this.backendStartPromise;
  }

  // ----------------------------------------------------------------- desktop

  private desktopAlive(): boolean {
    return Boolean(this.desktopProcess && !this.desktopExited && this.desktopProcess.exitCode === null);
  }

  /**
   * Ensure the real Hermes Desktop window exists, pointed at our single
   * backend. Idempotent: if the window is already running we keep it.
   */
  private async ensureDesktop(): Promise<void> {
    if (this.desktopAlive()) return;

    const exe = resolveHermesDesktopExe();
    if (!exe) {
      throw new Error('Hermes Desktop is not installed where Papers expects it.');
    }
    const token = await this.ensureBackend();

    this.desktopExited = false;
    const child = spawn(exe, [], {
      detached: false,
      windowsHide: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        HERMES_DESKTOP_REMOTE_URL: DASHBOARD_ORIGIN,
        HERMES_DESKTOP_REMOTE_TOKEN: token,
      },
    });
    this.desktopProcess = child;

    child.once('error', (error) => {
      this.desktopExited = true;
      this.setState({ status: 'error', detail: `Could not launch Hermes Desktop: ${error.message}` });
    });
    child.once('exit', () => {
      this.desktopExited = true;
      if (this.desktopProcess === child) this.desktopProcess = null;
      // The creator closed or Hermes crashed. Correct our placement so the
      // toggles reflect reality; the session lives in the backend and returns
      // on next open.
      this.setState({ placement: 'closed', status: 'idle' });
      this.mover.reset();
    });

    // Wait for the OS window so we can position it when docking.
    await this.mover.waitForWindow(DESKTOP_WINDOW_TITLE, DESKTOP_WINDOW_TIMEOUT_MS);
  }

  // ------------------------------------------------------------- geometry

  /** Convert Papers content-relative dock bounds into absolute screen pixels. */
  private absoluteDockRect(bounds: SurfaceBounds): WindowRect {
    const content = this.window.getContentBounds();
    return {
      x: content.x + Math.round(bounds.x),
      y: content.y + Math.round(bounds.y),
      width: Math.max(320, Math.round(bounds.width)),
      height: Math.max(400, Math.round(bounds.height)),
    };
  }

  // -------------------------------------------------------------- placements

  /**
   * Dock the real Hermes Desktop window flush against Papers at `bounds`
   * (Papers content-relative). Starts Hermes if needed.
   */
  async dock(bounds: SurfaceBounds): Promise<HermesSurfaceState> {
    this.dockBounds = bounds;
    try {
      this.setState({ status: 'starting' });
      const freshlyStarted = !this.desktopAlive();
      await this.ensureDesktop();
      const rect = this.absoluteDockRect(bounds);
      await this.mover.dock(DESKTOP_WINDOW_TITLE, rect);
      // A freshly-launched Hermes window sets its own bounds during boot, which
      // can land after our first move. Re-apply a few times so the dock wins the
      // race without us having to guess the exact ready moment.
      if (freshlyStarted) {
        for (const delay of [250, 600, 1100, 1800]) {
          setTimeout(() => {
            if (this.placement === 'docked') this.mover.move(DESKTOP_WINDOW_TITLE, this.absoluteDockRect(this.dockBounds ?? bounds));
          }, delay);
        }
      }
      this.setState({ placement: 'docked', status: 'ready' });
    } catch (error) {
      this.setState({ status: 'error', detail: message(error) });
    }
    return this.state;
  }

  /** Reposition the docked window to follow Papers move/resize (debounced). */
  setDockBounds(bounds: SurfaceBounds): void {
    this.dockBounds = bounds;
    if (this.placement !== 'docked' || !this.desktopAlive()) return;
    if (this.realignTimer) clearTimeout(this.realignTimer);
    this.realignTimer = setTimeout(() => {
      this.realignTimer = null;
      void this.mover.move(DESKTOP_WINDOW_TITLE, this.absoluteDockRect(bounds));
    }, 16);
  }

  /**
   * Hide the docked placement without terminating Hermes. The window is
   * minimized so the live session, scroll and draft survive; re-docking
   * restores it in place.
   */
  hideDock(): void {
    if (this.placement !== 'docked') return;
    this.mover.minimize(DESKTOP_WINDOW_TITLE);
    this.setState({ placement: 'closed', status: this.desktopAlive() ? 'ready' : 'idle' });
  }

  /**
   * Detach Hermes into a free-floating window. Starts Hermes if needed;
   * otherwise releases any dock pinning and restores/focuses the window.
   */
  async showDetached(): Promise<HermesSurfaceState> {
    try {
      this.setState({ status: 'starting' });
      await this.ensureDesktop();
      this.mover.undock(DESKTOP_WINDOW_TITLE);
      this.mover.restore(DESKTOP_WINDOW_TITLE);
      this.setState({ placement: 'detached', status: 'ready' });
    } catch (error) {
      this.setState({ status: 'error', detail: message(error) });
    }
    return this.state;
  }

  /** Hide the detached window (minimize; keep Hermes + session alive). */
  hideDetached(): void {
    if (this.placement !== 'detached') return;
    this.mover.minimize(DESKTOP_WINDOW_TITLE);
    this.setState({ placement: 'closed', status: this.desktopAlive() ? 'ready' : 'idle' });
  }

  // ------------------------------------------------------------------ close

  /**
   * Full shutdown of Papers-owned Hermes processes. Called on Papers exit.
   * The Hermes session/history persists in Hermes-owned state; only our
   * launched processes are stopped.
   */
  shutdown(): void {
    if (this.realignTimer) clearTimeout(this.realignTimer);
    this.mover.dispose();
    if (this.desktopProcess && this.desktopProcess.exitCode === null) {
      try {
        this.desktopProcess.kill();
      } catch {
        /* already gone */
      }
    }
    this.desktopProcess = null;
    if (this.backendProcess && this.backendProcess.exitCode === null) {
      try {
        this.backendProcess.kill();
      } catch {
        /* already gone */
      }
    }
    this.backendProcess = null;
    this.backendToken = null;
    this.setState({ placement: 'closed', status: 'idle' });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
