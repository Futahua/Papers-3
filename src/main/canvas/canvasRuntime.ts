/**
 * CanvasRuntime — owns the sandboxed program surface: one active primary
 * program per Backpack, loaded in its own WebContentsView, crash-isolated
 * from the host frame (plan sections 5.2, 7).
 */
import { WebContentsView, session, type BaseWindow, type WebContents } from 'electron';
import * as path from 'node:path';

import type { ProgramManifest, ProgramRunState, ProgramStatus } from '@shared/types';
import {
  PROGRAM_SCHEME,
  installProgramProtocolOnSession,
  type ProgramProtocolHandler,
} from '../security/programScheme';

export interface ProgramSenderIdentity {
  backpackId: string;
  programId: string;
  manifest: ProgramManifest;
}

export interface CanvasRuntimeOptions {
  window: BaseWindow;
  preloadPath: string;
  /** Handler serving papers-program:// for program partition sessions. */
  protocolHandler: ProgramProtocolHandler;
  onStatusChange: (status: ProgramStatus) => void;
}

interface ActiveProgram {
  backpackId: string;
  programId: string;
  manifest: ProgramManifest;
  view: WebContentsView;
}

const QUARANTINE_THRESHOLD = 3;
const CRASH_WINDOW_MS = 60_000;

export class CanvasRuntime {
  private active: ActiveProgram | null = null;
  private bounds = { x: 0, y: 48, width: 800, height: 552 };
  private readonly senderRegistry = new Map<number, ProgramSenderIdentity>();
  private readonly crashHistory = new Map<string, number[]>();
  private readonly quarantined = new Map<string, string>();
  private readonly statuses = new Map<string, ProgramStatus>();

  constructor(private readonly options: CanvasRuntimeOptions) {}

  /** Resolve the program identity for a privileged request sender. */
  identify(sender: WebContents): ProgramSenderIdentity | null {
    return this.senderRegistry.get(sender.id) ?? null;
  }

  get activeProgram(): { backpackId: string; programId: string } | null {
    return this.active ? { backpackId: this.active.backpackId, programId: this.active.programId } : null;
  }

  status(programId: string): ProgramStatus {
    return (
      this.statuses.get(programId) ?? {
        programId,
        state: 'stopped',
        crashCount: 0,
        lastCrashAt: null,
        quarantineReason: null,
      }
    );
  }

  private setStatus(programId: string, patch: Partial<ProgramStatus>): void {
    const next = { ...this.status(programId), ...patch, programId };
    this.statuses.set(programId, next);
    this.options.onStatusChange(next);
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
    if (this.active) this.active.view.setBounds(this.bounds);
  }

  /** Hide the program surface while a host overlay (modal) is open. */
  setOverlayVisible(visible: boolean): void {
    this.active?.view.setVisible(visible);
  }

  /** Stop and remove the current program view, keeping status history. */
  async stopActive(): Promise<void> {
    if (!this.active) return;
    const { view, programId } = this.active;
    this.senderRegistry.delete(view.webContents.id);
    this.options.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false });
    }
    this.active = null;
    const current = this.status(programId).state;
    if (current === 'running' || current === 'loading') {
      this.setStatus(programId, { state: 'stopped' });
    }
  }

  clearQuarantine(programId: string): void {
    this.quarantined.delete(programId);
    this.crashHistory.delete(programId);
    this.setStatus(programId, { state: 'stopped', quarantineReason: null, crashCount: 0 });
  }

  /**
   * Start a program in a fresh sandboxed WebContentsView. Any previously
   * active program is stopped first (one primary program at a time).
   */
  async start(backpackId: string, manifest: ProgramManifest): Promise<void> {
    const quarantineReason = this.quarantined.get(manifest.id);
    if (quarantineReason) {
      throw new Error(`Program ${manifest.id} is quarantined: ${quarantineReason}`);
    }
    await this.stopActive();

    this.setStatus(manifest.id, { state: 'loading', quarantineReason: null });

    // Non-persistent, per-program-per-backpack session partition. Program
    // durable state must flow through the state API, never renderer storage.
    const programSession = session.fromPartition(`program:${backpackId}:${manifest.id}`);
    programSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    installProgramProtocolOnSession(programSession, this.options.protocolHandler);
    // Sandboxed renderers get their preload through the session API
    // (webPreferences.preload does not reach sandboxed custom partitions).
    if (!programSession.getPreloadScripts().some((s) => s.filePath === this.options.preloadPath)) {
      programSession.registerPreloadScript({
        type: 'frame',
        filePath: this.options.preloadPath,
      });
    }

    const view = new WebContentsView({
      webPreferences: {
        session: programSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        devTools: process.env['ELECTRON_RENDERER_URL'] !== undefined,
      },
    });

    const contents = view.webContents;

    // Deny all navigation away from the program origin and all new windows.
    const programOrigin = `${PROGRAM_SCHEME}://${manifest.id}`;
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${programOrigin}/`)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    contents.on('render-process-gone', (_event, details) => {
      this.handleCrash(manifest.id, `renderer gone: ${details.reason} (exit ${details.exitCode})`);
    });
    contents.on('unresponsive', () => {
      this.setStatus(manifest.id, { state: 'crashed' });
    });
    contents.on('responsive', () => {
      if (this.active?.programId === manifest.id) {
        this.setStatus(manifest.id, { state: 'running' });
      }
    });

    this.active = { backpackId, programId: manifest.id, manifest, view };
    this.senderRegistry.set(contents.id, { backpackId, programId: manifest.id, manifest });

    this.options.window.contentView.addChildView(view);
    view.setBounds(this.bounds);

    const entry = manifest.entry.replace(/\\/g, '/');
    try {
      await contents.loadURL(`${programOrigin}/${entry}`);
    } catch (err) {
      await this.stopActive();
      this.setStatus(manifest.id, { state: 'crashed' });
      throw new Error(`program ${manifest.id} failed to load: ${String(err)}`);
    }
    this.setStatus(manifest.id, { state: 'running' });
  }

  private handleCrash(programId: string, reason: string): void {
    const now = Date.now();
    const history = (this.crashHistory.get(programId) ?? []).filter(
      (t) => now - t < CRASH_WINDOW_MS,
    );
    history.push(now);
    this.crashHistory.set(programId, history);

    if (this.active?.programId === programId) {
      const { view } = this.active;
      this.senderRegistry.delete(view.webContents.id);
      this.options.window.contentView.removeChildView(view);
      this.active = null;
    }

    let state: ProgramRunState = 'crashed';
    let quarantineReason: string | null = null;
    if (history.length >= QUARANTINE_THRESHOLD) {
      state = 'quarantined';
      quarantineReason = `crashed ${history.length} times within a minute (${reason})`;
      this.quarantined.set(programId, quarantineReason);
    }
    this.setStatus(programId, {
      state,
      crashCount: this.status(programId).crashCount + 1,
      lastCrashAt: new Date(now).toISOString(),
      quarantineReason,
    });
  }

  /** For tests and the crash-test program: trigger renderer termination. */
  forceCrashActive(): void {
    this.active?.view.webContents.forcefullyCrashRenderer();
  }

  sendToActiveProgram(channel: string, payload: unknown): void {
    if (this.active && !this.active.view.webContents.isDestroyed()) {
      this.active.view.webContents.send(channel, payload);
    }
  }
}

export function defaultProgramsRoot(appPath: string, isPackaged: boolean, resourcesPath: string): string {
  return isPackaged ? path.join(resourcesPath, 'programs') : path.join(appPath, 'programs');
}
