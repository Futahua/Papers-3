/**
 * Papers-managed real Hermes Desktop surface.
 *
 * One Hermes experience, one backend. Papers starts exactly one Hermes backend
 * (`hermes dashboard` on 127.0.0.1:9119 with a Papers-generated session token)
 * and launches the real Hermes Desktop application pointed at that backend via
 * `HERMES_DESKTOP_REMOTE_URL` + `HERMES_DESKTOP_REMOTE_TOKEN`. The desktop then
 * connects to the single backend and never spawns its own.
 *
 * Docking is a DELIBERATE action via the sidebar SVG toggle: dragging a
 * detached Hermes window never docks it (the creator can leave it anywhere).
 * Papers passes `HERMES_DESKTOP_PAPERS_DOCK_URL` (a loopback endpoint Papers
 * listens on) plus `HERMES_DESKTOP_PAPERS_DOCK_TOKEN` (a random shared secret).
 * The Hermes main process reports its OWN window bounds on move/resize and
 * accepts `setBounds`/`focus`/`minimize`/`raise` commands back. Both directions
 * authenticate with the token (401 on mismatch), cap the body size, and validate
 * bounds; the token is never logged. So Papers always knows where the real
 * Hermes window is (DPI- and multi-monitor-correct, from Electron `getBounds()`)
 * to keep a DOCKED window aligned + raised above Papers (via non-topmost
 * moveTop, never global always-on-top) on Papers move/resize; dragging a docked
 * window off its strip frees it. There is no drag-to-dock and no edge highlight.
 *
 * Papers does NOT reimplement chat, sessions, attachments, models, settings,
 * tool rendering, approvals, voice or file browsing. It launches, focuses and
 * arranges the existing Hermes product.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { app, type BaseWindow, screen } from 'electron';

import { launchHermesUpdateHelper } from './hermesUpdater';

export type HermesPlacement = 'closed' | 'docked' | 'detached';
export type HermesStatus = 'idle' | 'starting' | 'ready' | 'error';

export interface HermesSurfaceState {
  placement: HermesPlacement;
  status: HermesStatus;
  detail?: string;
}

export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DASHBOARD_HOST = '127.0.0.1';
const DASHBOARD_PORT = 9119;
const DASHBOARD_ORIGIN = `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;
const BACKEND_START_TIMEOUT_MS = 120_000;
/**
 * Docking is a deliberate action via the sidebar SVG toggle — Papers never
 * docks a window merely because it was dragged near the edge, so the creator can
 * leave a detached Hermes anywhere. This slop only governs the opposite: while
 * DOCKED, dragging the window more than this far (in DIP; Electron bounds are
 * device-independent on Windows) off its strip frees it, so a drag wins over
 * Papers' realignment instead of the window snapping back.
 */
const DOCK_DETACH_SLOP_DIP = 24;
/** Hard cap on any loopback request body (reports and control replies are tiny). */
const DOCK_MAX_BODY = 4096;

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

function resolveHermesRoot(desktopExe: string): string {
  const configured = process.env['PAPERS_HERMES_ROOT'];
  if (configured) return resolve(configured);
  // <root>/apps/desktop/release/win-unpacked/Hermes.exe
  return resolve(dirname(desktopExe), '..', '..', '..', '..');
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

  /** Papers-relative dock strip the docked window should occupy. */
  private dockBounds: SurfaceBounds | null = null;
  /** Last reported real Hermes window rect (absolute screen px). */
  private hermesRect: Rect | null = null;
  /** Hermes' control server port (from its 'hello'). */
  private controlPort: number | null = null;

  /** Papers' own loopback server that receives Hermes window reports. */
  private reportServer: Server | null = null;
  private reportPort: number | null = null;
  /** Timestamp until which we ignore move echoes caused by our own setBounds. */
  private suppressReportsUntil = 0;

  /** Shared secret for the Papers<->Hermes loopback channel. Generated per
   *  desktop launch, passed to Hermes via env, required on every report and
   *  control request in both directions. Never logged. */
  private dockToken: string | null = null;
  private updateHandedOff = false;
  /** True while another Papers-level activation should raise the docked Hermes
   *  above Papers (moveTop) without making it globally topmost. */
  private lastRaiseAt = 0;

  constructor(
    private readonly window: BaseWindow,
    private readonly onStateChange: (state: HermesSurfaceState) => void = () => {},
  ) {}

  get state(): HermesSurfaceState {
    const base: HermesSurfaceState = { placement: this.placement, status: this.status };
    if (this.detail !== undefined) base.detail = this.detail;
    return base;
  }

  private setState(next: Partial<HermesSurfaceState>): void {
    if (next.placement !== undefined) this.placement = next.placement;
    if (next.status !== undefined) this.status = next.status;
    if (this.status === 'error') {
      if (next.detail !== undefined) this.detail = next.detail;
    } else {
      this.detail = undefined;
    }
    this.onStateChange(this.state);
  }

  // ----------------------------------------------------------- report server

  private ensureReportServer(): Promise<number> {
    if (this.reportServer && this.reportPort) return Promise.resolve(this.reportPort);
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        // Authenticate every report against the shared docking token, so another
        // local process cannot spoof window positions into our dock logic. Drain
        // the body before replying 401 so the client reads the status cleanly.
        if (!this.dockTokenOk(req.headers['x-papers-dock-token'])) {
          req.on('data', () => {});
          req.on('end', () => {
            res.writeHead(401);
            res.end();
          });
          return;
        }
        let raw = '';
        let tooBig = false;
        req.on('data', (c) => {
          if (tooBig) return;
          raw += c;
          if (raw.length > DOCK_MAX_BODY) {
            tooBig = true;
            res.writeHead(413);
            res.end();
          }
        });
        req.on('end', () => {
          if (tooBig) return;
          res.writeHead(200);
          res.end();
          try {
            this.onHermesReport(JSON.parse(raw || '{}'));
          } catch {
            /* ignore malformed report */
          }
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        this.reportServer = server;
        this.reportPort = addr && typeof addr === 'object' ? addr.port : null;
        if (this.reportPort) resolve(this.reportPort);
        else reject(new Error('Papers dock endpoint failed to bind.'));
      });
    });
  }

  /** Constant-time comparison of a presented token header against ours. */
  private dockTokenOk(candidate: unknown): boolean {
    if (!this.dockToken || typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.dockToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Handle one report from the real Hermes window. */
  private onHermesReport(msg: {
    phase?: string;
    bounds?: Rect;
    controlPort?: number;
  }): void {
    if (msg.phase === 'update-request') {
      this.beginManagedUpdate();
      return;
    }
    if (msg.phase === 'hello' && typeof msg.controlPort === 'number') {
      this.controlPort = msg.controlPort;
    }
    if (msg.phase === 'closed') {
      this.desktopExited = true;
      this.controlPort = null;
      this.hermesRect = null;
      this.setState({ placement: 'closed', status: 'idle' });
      return;
    }
    if (msg.bounds) this.hermesRect = msg.bounds;

    const isSelfMove = Date.now() < this.suppressReportsUntil;

    // Dragging a DETACHED window does NOT dock it — the creator can leave Hermes
    // wherever they drop it. Docking is a deliberate action via the sidebar SVG
    // toggle. So there is no drag-to-dock and no edge highlight here.

    // While DOCKED, dragging the window off the strip frees it (so a drag
    // wins over Papers' realignment instead of the window snapping back). Only
    // the toggle re-docks it.
    if (
      this.placement === 'docked' &&
      !isSelfMove &&
      msg.bounds &&
      (msg.phase === 'move' || msg.phase === 'settle') &&
      this.draggedOffStrip(msg.bounds)
    ) {
      this.setState({ placement: 'detached' });
    }
  }

  /**
   * Hermes' normal remote-backend updater cannot replace its Windows runtime
   * while the Papers-owned dashboard is using it. The Papers-patched desktop
   * reports an update request here; a separate visible Papers helper then waits
   * for both apps to exit, runs Hermes' own updater, restores the tiny Papers
   * overlay and relaunches Papers.
   */
  private beginManagedUpdate(): void {
    if (this.updateHandedOff) return;
    const desktopExe = resolveHermesDesktopExe();
    if (!desktopExe) {
      this.setState({ status: 'error', detail: 'Hermes Desktop could not be located for updating.' });
      return;
    }
    const launched = launchHermesUpdateHelper(
      resolveHermesRoot(desktopExe),
      [this.desktopProcess?.pid, this.backendProcess?.pid].filter(
        (pid): pid is number => typeof pid === 'number',
      ),
    );
    if (!launched) {
      this.setState({
        status: 'error',
        detail: 'The Papers Hermes update helper is missing. Reinstall Papers and try again.',
      });
      return;
    }
    this.updateHandedOff = true;
    this.setState({ status: 'starting' });
    // Give the authenticated loopback response time to reach Hermes before the
    // normal Papers shutdown releases the desktop/backend file locks.
    setTimeout(() => app.quit(), 600);
  }

  // ------------------------------------------------------------- geometry

  private contentRect(): Rect {
    const c = this.window.getContentBounds();
    return { x: c.x, y: c.y, width: c.width, height: c.height };
  }

  private absoluteDockRect(bounds: SurfaceBounds): Rect {
    const c = this.contentRect();
    return {
      x: c.x + Math.round(bounds.x),
      y: c.y + Math.round(bounds.y),
      width: Math.max(320, Math.round(bounds.width)),
      height: Math.max(400, Math.round(bounds.height)),
    };
  }

  private defaultDockBounds(): SurfaceBounds {
    const c = this.contentRect();
    const width = Math.max(380, Math.min(620, Math.round(c.width * 0.4)));
    return { x: Math.max(0, c.width - width), y: 48, width, height: Math.max(400, c.height - 48) };
  }

  /** True when a docked window has been dragged meaningfully off its strip. */
  private draggedOffStrip(rect: Rect): boolean {
    const target = this.absoluteDockRect(this.dockBounds ?? this.defaultDockBounds());
    return (
      Math.abs(rect.x - target.x) > DOCK_DETACH_SLOP_DIP ||
      Math.abs(rect.y - target.y) > DOCK_DETACH_SLOP_DIP
    );
  }

  // --------------------------------------------------------- Hermes control

  private controlHermes(cmd: Record<string, unknown>): Promise<{ ok: boolean; bounds?: Rect } | null> {
    const port = this.controlPort;
    const dockToken = this.dockToken;
    if (!port || !dockToken) return Promise.resolve(null);
    return new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify(cmd));
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': body.length,
            // Authenticate every control request; the token is never logged.
            'x-papers-dock-token': dockToken,
          },
          timeout: 1_000,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => {
            raw += c;
            if (raw.length > DOCK_MAX_BODY) req.destroy();
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw || 'null'));
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(body);
      req.end();
    });
  }

  /** Move the docked window and (optionally) raise it above Papers. */
  private async moveHermesTo(rect: Rect, opts: { focus?: boolean; raise?: boolean } = {}): Promise<void> {
    this.suppressReportsUntil = Date.now() + 400;
    await this.controlHermes({ op: 'setBounds', bounds: rect, focus: opts.focus, raise: opts.raise });
  }

  /**
   * Raise the docked Hermes above Papers WITHOUT global always-on-top, so it
   * never covers unrelated apps. Debounced so rapid Papers move/resize streams
   * don't spam the control channel.
   */
  private async raiseHermes(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRaiseAt < 120) return;
    this.lastRaiseAt = now;
    await this.controlHermes({ op: 'raise' });
  }

  private async waitForControl(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.controlPort) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  // ----------------------------------------------------------------- backend

  /** True if the dashboard on 9119 answers /api/status at all (public). */
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
   * Prove a running dashboard on 9119 is Papers-owned by authenticating a
   * PROTECTED endpoint with `token`. /api/status is public, but /api/sessions
   * returns 401 without the correct session token and 200 with it, so a
   * successful authed call proves the backend was started with our token.
   * Returns true only on 200; false on 401/anything else.
   */
  private async dashboardAcceptsToken(token: string): Promise<boolean> {
    if (!token) return false;
    try {
      const response = await fetch(`${DASHBOARD_ORIGIN}/api/sessions`, {
        headers: { 'X-Hermes-Session-Token': token },
        signal: AbortSignal.timeout(2_000),
        redirect: 'manual',
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private ensureBackend(): Promise<string> {
    if (this.backendProcess && this.backendToken && this.backendProcess.exitCode === null) {
      return Promise.resolve(this.backendToken);
    }
    if (this.backendStartPromise) return this.backendStartPromise;

    this.backendStartPromise = (async () => {
      // Port 9119 already occupied?
      if (await this.dashboardResponds()) {
        // Adopt it ONLY if we can prove it's the Papers-owned backend using our
        // persisted token. Never adopt with an empty/unknown token, and never
        // silently start a rival backend on another port.
        const stored = this.readStoredBackendToken();
        if (stored && (await this.dashboardAcceptsToken(stored))) {
          this.backendToken = stored;
          return stored;
        }
        throw new Error(
          'Another program is already using Hermes port 9119 and Papers cannot verify it started it. ' +
            'Close that Hermes/dashboard process (or restart Hermes from Papers) and try again — ' +
            'Papers will not start a second backend or connect without proof of ownership.',
        );
      }

      const token = randomBytes(32).toString('base64url');
      const child = spawn(
        'hermes',
        ['dashboard', '--host', DASHBOARD_HOST, '--port', String(DASHBOARD_PORT), '--no-open'],
        { windowsHide: true, stdio: 'ignore', env: { ...process.env, HERMES_DASHBOARD_SESSION_TOKEN: token } },
      );
      this.backendProcess = child;
      this.backendToken = token;
      // Persist so a relaunched Papers can prove ownership of a still-running
      // backend it started (rather than being locked out of its own port).
      this.writeStoredBackendToken(token);
      child.once('error', (error) =>
        this.setState({ status: 'error', detail: `Could not start Hermes: ${error.message}` }),
      );
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
        await new Promise((r) => setTimeout(r, 350));
      }
      throw new Error('Hermes backend did not become ready in time.');
    })().finally(() => {
      this.backendStartPromise = null;
    });
    return this.backendStartPromise;
  }

  /** Path where the Papers-owned dashboard session token is persisted. */
  private backendTokenPath(): string {
    return join(app.getPath('userData'), 'hermes-backend-token');
  }

  private readStoredBackendToken(): string | null {
    try {
      const value = readFileSync(this.backendTokenPath(), 'utf8').trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private writeStoredBackendToken(token: string): void {
    try {
      writeFileSync(this.backendTokenPath(), token, { encoding: 'utf8', mode: 0o600 });
    } catch {
      /* best-effort; adoption after a restart simply won't be possible */
    }
  }

  // ----------------------------------------------------------------- desktop

  private desktopAlive(): boolean {
    return Boolean(this.desktopProcess && !this.desktopExited && this.desktopProcess.exitCode === null);
  }

  private async ensureDesktop(): Promise<void> {
    if (this.desktopAlive()) {
      if (!this.controlPort) await this.waitForControl(8_000);
      return;
    }

    const exe = resolveHermesDesktopExe();
    if (!exe) throw new Error('Hermes Desktop is not installed where Papers expects it.');
    const token = await this.ensureBackend();
    const reportPort = await this.ensureReportServer();
    // Fresh random docking secret for this launch, authenticating both
    // directions of the loopback channel. Never logged.
    this.dockToken = randomBytes(32).toString('base64url');

    this.desktopExited = false;
    this.controlPort = null;
    const child = spawn(exe, [], {
      detached: false,
      windowsHide: false,
      stdio: 'ignore',
      env: {
        ...process.env,
        HERMES_DESKTOP_REMOTE_URL: DASHBOARD_ORIGIN,
        HERMES_DESKTOP_REMOTE_TOKEN: token,
        HERMES_DESKTOP_PAPERS_DOCK_URL: `http://127.0.0.1:${reportPort}/`,
        HERMES_DESKTOP_PAPERS_DOCK_TOKEN: this.dockToken,
        // Papers is the canonical launcher: always start a fresh, dock-seam-
        // enabled Hermes we own, rather than re-focusing a stale instance that
        // was launched without the seam env (its window would never report to
        // us and could never dock).
        HERMES_DESKTOP_IGNORE_EXISTING: '1',
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
      this.controlPort = null;
      this.hermesRect = null;
      this.setState({ placement: 'closed', status: 'idle' });
    });

    const ok = await this.waitForControl(60_000);
    if (!ok) throw new Error('Hermes Desktop did not report its window in time.');
  }

  // -------------------------------------------------------------- placements

  async dock(bounds: SurfaceBounds): Promise<HermesSurfaceState> {
    this.dockBounds = bounds;
    try {
      this.setState({ status: 'starting' });
      await this.ensureDesktop();
      const rect = this.absoluteDockRect(bounds);
      // Place the strip and raise it above Papers (non-topmost), not globally
      // always-on-top — so it sits above Papers but never over other apps.
      await this.moveHermesTo(rect, { focus: true, raise: true });
      // Re-assert once after Hermes settles any boot geometry.
      setTimeout(() => {
        if (this.placement === 'docked') {
          void this.moveHermesTo(this.absoluteDockRect(this.dockBounds ?? bounds), { raise: true });
        }
      }, 400);
      this.setState({ placement: 'docked', status: 'ready' });
    } catch (error) {
      this.setState({ status: 'error', detail: message(error) });
    }
    return this.state;
  }

  /** Reposition the docked window to follow Papers move/resize, raising it so it
   *  stays above Papers as Papers is dragged/resized. */
  setDockBounds(bounds: SurfaceBounds): void {
    this.dockBounds = bounds;
    if (this.placement !== 'docked' || !this.controlPort) return;
    void this.moveHermesTo(this.absoluteDockRect(bounds), { raise: true });
  }

  /** Papers was activated/focused: raise the docked Hermes above Papers, but
   *  only while docked, and only via non-topmost moveTop. */
  onPapersActivated(): void {
    if (this.placement !== 'docked' || !this.controlPort) return;
    void this.raiseHermes();
  }

  /** Hide the docked placement without terminating Hermes or its session. */
  async hideDock(): Promise<void> {
    if (this.placement !== 'docked') return;
    await this.controlHermes({ op: 'minimize' });
    this.setState({ placement: 'closed', status: this.desktopAlive() ? 'ready' : 'idle' });
  }

  /** Detach Hermes into a free-floating window. */
  async showDetached(): Promise<HermesSurfaceState> {
    try {
      this.setState({ status: 'starting' });
      await this.ensureDesktop();
      await this.controlHermes({ op: 'focus' });
      this.setState({ placement: 'detached', status: 'ready' });
    } catch (error) {
      this.setState({ status: 'error', detail: message(error) });
    }
    return this.state;
  }

  /** Hide the detached window (minimize; keep Hermes + session alive). */
  async hideDetached(): Promise<void> {
    if (this.placement !== 'detached') return;
    await this.controlHermes({ op: 'minimize' });
    this.setState({ placement: 'closed', status: this.desktopAlive() ? 'ready' : 'idle' });
  }

  // ------------------------------------------------------------------ close

  shutdown(): void {
    if (this.reportServer) {
      try {
        this.reportServer.close();
      } catch {
        /* already closed */
      }
      this.reportServer = null;
    }
    if (this.desktopProcess && this.desktopProcess.exitCode === null) {
      try {
        this.desktopProcess.kill();
      } catch {
        /* already gone */
      }
    }
    this.desktopProcess = null;
    this.controlPort = null;
    if (this.backendProcess && this.backendProcess.exitCode === null) {
      try {
        this.backendProcess.kill();
      } catch {
        /* already gone */
      }
    }
    this.backendProcess = null;
    this.backendToken = null;
    this.dockToken = null;
    this.setState({ placement: 'closed', status: 'idle' });
  }

  /** Informational: which display the real Hermes window currently sits on. */
  displayForHermes(): number | null {
    if (!this.hermesRect) return null;
    try {
      return screen.getDisplayMatching(this.hermesRect).id;
    } catch {
      return null;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
