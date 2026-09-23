/**
 * The command-surface launcher overlay.
 *
 * WHAT THIS IS
 * A small, borderless, always-on-top surface that appears over whatever the
 * creator is doing, takes the keyboard, and vanishes. The application they came
 * from keeps its place in the z-order and gets focus back when the overlay
 * closes. It is a launcher, not a window switcher: **Papers never comes
 * forward.**
 *
 * THE BOUNDARY
 * The host still does not know what the command surface is. It loads the
 * focused project's own entry URL with a mode marker appended and lets the
 * project render whatever a command surface means to it - exactly the mechanism
 * the compact widget already uses. No Backpack name, prompt or action
 * definition enters this file.
 *
 * FOCUS, HONESTLY
 * Taking focus is easy; giving it back is the hard part, and Windows does not
 * help. Measured on this machine (probes/probe-25, probe-26):
 *   - a BACKGROUND process calling SetForegroundWindow is REFUSED by the
 *     foreground lock. Papers' own shipping window helper reports `restore`
 *     success while the foreground does not move - a false success, and exactly
 *     the bug class this project keeps finding;
 *   - a process that currently owns the foreground is granted the right.
 * So the sequence here is: record the foreground window BEFORE showing the
 * overlay, show it (which makes Papers the foreground owner, granting the
 * right), and hand focus back on close while that right still applies.
 *
 * If the native hand-back is unavailable the overlay says so rather than
 * silently dropping the creator on the desktop.
 */

import { BACKPACK_PROJECT_SCHEME } from '../backpacks/backpackProjectService';
import type { OverlayCloseReason } from './globalInvoke';

/** The opaque mode marker the project reads. The host does not interpret it. */
export const COMMAND_SURFACE_MARKER = 'papers-surface';
export const COMMAND_SURFACE_MODE = 'command-surface';

/** The overlay is a launcher: small, near the top of the display. */
export const COMMAND_SURFACE_WIDTH = 640;
export const COMMAND_SURFACE_HEIGHT = 220;
/** Fraction of the work area height used as the overlay's top offset, so a
 * launcher sits in the upper third rather than dead centre over content. */
export const COMMAND_SURFACE_TOP_FRACTION = 0.22;

/** Opaque window handle from the native foreground bridge. */
export type NativeWindowHandle = number;

export interface OverlayNativeWindow {
  readonly webContents: {
    id: number;
    send(channel: string, payload: unknown): void;
    on(event: 'render-process-gone', callback: () => void): void;
  };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  focus(): void;
  show(): void;
  hide(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  destroy(): void;
  on(event: 'blur' | 'closed', callback: () => void): void;
  loadURL(url: string): Promise<void>;
}

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CommandSurfaceTarget {
  projectId: string;
  surfaceId: string;
}

/** What the host decided the launcher targets, including why it refused. */
export type CommandSurfaceResolution =
  | { ok: true; target: CommandSurfaceTarget }
  | { ok: false; detail: string };

export interface CommandSurfaceOverlayDependencies {
  /** The focused project's entry URL for that project, or null. Owner-scoped:
   * two Papers windows may show one project with different runtimes. */
  resolveEntryUrl(projectId: string): { entryUrl: string; ownerWindowId: number } | null;
  /**
   * Which project's command surface the launcher targets.
   *
   * NOT "the focused surface" - see commandSurfaceRegistry. When it refuses, the
   * detail is carried out unchanged so the creator is told what was actually
   * looked at, rather than a generic "no project is open".
   */
  resolveCommandSurface(): Promise<CommandSurfaceResolution> | CommandSurfaceResolution;
  /** Rebind the transient launcher to the Papers window presenting its project. */
  onTargetResolved?(target: CommandSurfaceTarget, ownerWindowId: number): void;
  createWindow(options: { projectId: string; preloadPath: string }): OverlayNativeWindow;
  preloadPath: string;
  /**
   * Native foreground access. Without it the overlay still opens, but focus
   * cannot be handed back and that is reported rather than hidden.
   */
  focusBridge?: {
    /** The window that currently has the foreground, or null. */
    foregroundWindow(): Promise<NativeWindowHandle | null>;
    /** Try to put the foreground back on that exact window. Resolves true only
     * when the foreground genuinely moved. */
    setForegroundWindow(handle: NativeWindowHandle): Promise<boolean>;
    /** Whether the handle is still a real window. */
    isWindow(handle: NativeWindowHandle): Promise<boolean>;
  };
  /** Where the overlay appears. Defaults to the display with the cursor. */
  placeOn?(): DisplayWorkArea;
  /** The neutral event delivered into the overlay window for the project. */
  deliver?(senderId: number, payload: {
    projectId: string;
    surfaceId: string;
    chord: 'invoke';
    reason: 'global-accelerator';
  }): void;
  onClosed?(reason: OverlayCloseReason): void;
  /** Reports what happened to focus, so a failure is visible rather than felt. */
  report?(report: { outcome: 'focus-restored' | 'focus-not-restored' | 'focus-unknown'; detail: string }): void;
  /**
   * Whether losing focus dismisses the overlay. Defaults to true, which is the
   * creator's behaviour: they moved on, so the launcher goes away.
   *
   * Set false ONLY by an automated test. On an unattended machine nothing holds
   * focus, so the overlay blurs and closes the instant it opens - correct host
   * behaviour, and impossible to observe. The real launcher stays up because the
   * creator is looking at it and typing in it. Nothing else changes: it still
   * shows, still focuses, still delivers.
   */
  dismissOnBlur?: boolean;
}

export interface CommandSurfaceOverlaySession {
  open(): Promise<{ ok: boolean; detail: string }>;
  /** Load the renderer hidden so the first real invocation is warm. */
  warm(): Promise<{ ok: boolean; detail: string }>;
  close(reason: OverlayCloseReason): Promise<void>;
  /** Permanently release the warm renderer during Papers shutdown. */
  destroy(): Promise<void>;
  isOpen(): boolean;
  isFocused(): boolean;
  target(): CommandSurfaceTarget | null;
  /** Exposed for the wiring and for tests. */
  registerIpc(): void;
  unregisterIpc(): void;
}

function overlayUrl(rawEntryUrl: string, projectId: string): string {
  const url = new URL(rawEntryUrl);
  // Same fail-closed rule the compact widget uses: the exact custom scheme AND
  // the exact bound project host, or nothing.
  if (url.protocol !== `${BACKPACK_PROJECT_SCHEME}:` || url.host !== projectId) {
    throw new Error('overlay entry is not the bound project surface');
  }
  url.searchParams.set(COMMAND_SURFACE_MARKER, COMMAND_SURFACE_MODE);
  return url.toString();
}

export function createCommandSurfaceOverlay(
  dependencies: CommandSurfaceOverlayDependencies,
): CommandSurfaceOverlaySession {
  let window: OverlayNativeWindow | null = null;
  let projectId: string | null = null;
  let surfaceId: string | null = null;
  /** Recorded BEFORE the overlay takes focus, which is the only moment it can
   * be read. */
  let previousForeground: NativeWindowHandle | null = null;
  let closing = false;
  let ipcRegistered = false;
  let warming: { projectId: string; promise: Promise<{ ok: boolean; detail: string }> } | null = null;
  const ipcHandlers: Array<{ channel: string; handler: (...args: unknown[]) => void }> = [];

  const place = (): { x: number; y: number; width: number; height: number } => {
    const area = dependencies.placeOn?.() ?? { x: 0, y: 0, width: 1920, height: 1080 };
    const width = Math.min(COMMAND_SURFACE_WIDTH, area.width);
    const height = Math.min(COMMAND_SURFACE_HEIGHT, area.height);
    return {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round(area.height * COMMAND_SURFACE_TOP_FRACTION),
      width,
      height,
    };
  };

  const restoreFocus = async (): Promise<void> => {
    const bridge = dependencies.focusBridge;
    const target = previousForeground;
    previousForeground = null;
    if (!bridge) {
      dependencies.report?.({
        outcome: 'focus-unknown',
        detail: 'the native foreground bridge is unavailable, so the previous application cannot be given focus back automatically',
      });
      return;
    }
    if (target === null) {
      dependencies.report?.({ outcome: 'focus-unknown', detail: 'no previous foreground window was recorded' });
      return;
    }
    try {
      if (!(await bridge.isWindow(target))) {
        dependencies.report?.({
          outcome: 'focus-not-restored',
          detail: 'the application that was in front has closed, so focus was not handed back to it',
        });
        return;
      }
      const ok = await bridge.setForegroundWindow(target);
      dependencies.report?.({
        outcome: ok ? 'focus-restored' : 'focus-not-restored',
        detail: ok
          ? 'focus returned to the application that was in front'
          : 'Windows refused the focus hand-back, so the previous application may not be in front',
      });
    } catch (error) {
      dependencies.report?.({
        outcome: 'focus-not-restored',
        detail: `the focus hand-back failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  /**
   * Deliver the neutral invoke into the overlay window.
   *
   * Sent on the first open AND on every repeat press. The creator presses the
   * chord again to get back to an empty line; the host cannot clear a project's
   * input (it does not know what one is), so what it must do is say "invoked"
   * again and let the project clear itself. A repeat that only refocused the
   * window left the project with no event at all - the reported defect.
   */
  const deliverInvoke = (target: OverlayNativeWindow, project: string, surface: string): void => {
    dependencies.deliver?.(target.webContents.id, {
      projectId: project,
      surfaceId: surface,
      chord: 'invoke',
      reason: 'global-accelerator',
    });
  };

  const destroyWarmWindow = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    const doomed = window;
    window = null;
    projectId = null;
    surfaceId = null;
    try {
      if (doomed && !doomed.isDestroyed()) doomed.destroy();
    } catch {
      /* a destroyed window is the desired end state */
    }
    previousForeground = null;
    closing = false;
  };

  const teardown = async (reason: OverlayCloseReason): Promise<void> => {
    if (closing || !window) return;
    closing = true;
    const live = window;
    try {
      if (!live.isDestroyed()) live.hide();
    } catch {
      /* a destroyed window is already hidden */
    }
    if (reason === 'dismissed' || reason === 'action-run') {
      // Hand focus back BEFORE the caller continues, so the application the
      // creator came from owns the keyboard again by the time anything else
      // happens.
      await restoreFocus();
    } else {
      previousForeground = null; // the creator moved on; do not steal focus back
    }
    dependencies.onClosed?.(reason);
    closing = false;
  };

  type ResolvedSurface = { surface: CommandSurfaceTarget; url: string; ownerWindowId: number };

  const resolveSurface = async (): Promise<ResolvedSurface | { ok: false; detail: string }> => {
    const resolution = await dependencies.resolveCommandSurface();
    if (!resolution.ok) {
      // The refusal's own words, not a summary of them. The creator needs to
      // know which Backpack was looked at, because they cannot see the front tab.
      return { ok: false, detail: resolution.detail };
    }
    const surface = resolution.target;

    const presentation = dependencies.resolveEntryUrl(surface.projectId);
    if (presentation === null) {
      return { ok: false, detail: 'the focused project has no surface to show the command surface in' };
    }

    let url: string;
    try {
      url = overlayUrl(presentation.entryUrl, surface.projectId);
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'the command surface URL was rejected' };
    }

    return { surface, url, ownerWindowId: presentation.ownerWindowId };
  };

  const ensureWarmOnce = async ({ surface, url }: ResolvedSurface): Promise<{ ok: boolean; detail: string }> => {

    // A warm overlay keeps its renderer and loaded project state alive. Reuse
    // it while the declared project is unchanged; the bound project identity
    // is the only reason a new renderer is needed.
    if (window && !window.isDestroyed() && projectId === surface.projectId) {
      surfaceId = surface.surfaceId;
      return { ok: true, detail: 'the command surface renderer is warm' };
    }

    if (window && !window.isDestroyed()) await destroyWarmWindow();

    // A warm-up must not inspect, change or restore foreground focus. It is
    // deliberately safe to run during Papers bootstrap while another app is
    // in front.
    previousForeground = null;

    projectId = surface.projectId;
    surfaceId = surface.surfaceId;

    const created = dependencies.createWindow({ projectId: surface.projectId, preloadPath: dependencies.preloadPath });
    window = created;
    created.setBounds(place());

    created.on('blur', () => {
      // Losing focus means the creator moved on. Tear down without fighting to
      // take focus back from whatever they chose instead.
      if (dependencies.dismissOnBlur === false) return;
      if (window === created) void teardown('focus-lost');
    });
    created.on('closed', () => {
      if (window === created) void teardown('focus-lost');
    });
    created.webContents.on('render-process-gone', () => {
      if (window === created) void teardown('focus-lost');
    });

    try {
      await created.loadURL(url);
    } catch (error) {
      await destroyWarmWindow();
      return {
        ok: false,
        detail: `the command surface could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (window !== created || created.isDestroyed()) {
      return { ok: false, detail: 'the command surface closed while it was loading' };
    }

    return { ok: true, detail: 'the command surface renderer is warm' };
  };

  const ensureWarm = async (resolved: ResolvedSurface): Promise<{ ok: boolean; detail: string }> => {
    const pending = warming;
    if (pending) {
      if (pending.projectId === resolved.surface.projectId) {
        const prepared = await pending.promise;
        if (prepared.ok && window && !window.isDestroyed()) surfaceId = resolved.surface.surfaceId;
        return prepared;
      }
      await pending.promise;
      return ensureWarm(resolved);
    }
    if (window && !window.isDestroyed() && projectId === resolved.surface.projectId) {
      surfaceId = resolved.surface.surfaceId;
      return { ok: true, detail: 'the command surface renderer is warm' };
    }

    const task = { projectId: resolved.surface.projectId, promise: ensureWarmOnce(resolved) };
    warming = task;
    try {
      return await task.promise;
    } finally {
      if (warming === task) warming = null;
    }
  };

  const open = async (): Promise<{ ok: boolean; detail: string }> => {
    const resolved = await resolveSurface();
    if (!('surface' in resolved)) return resolved;
    dependencies.onTargetResolved?.(resolved.surface, resolved.ownerWindowId);
    const prepared = await ensureWarm(resolved);
    if (!prepared.ok || !window || window.isDestroyed()) return prepared;

    // Capture the foreground immediately before the warm renderer takes focus.
    if (dependencies.focusBridge) {
      try {
        previousForeground = await dependencies.focusBridge.foregroundWindow();
      } catch {
        previousForeground = null;
      }
    }

    // Show and take the keyboard. This is what makes Papers the foreground
    // owner and therefore what makes the hand-back possible later.
    window.setBounds(place());
    window.show();
    window.focus();

    deliverInvoke(window, resolved.surface.projectId, resolved.surface.surfaceId);

    return { ok: true, detail: 'the command surface is open over the current application' };
  };

  const warm = async (): Promise<{ ok: boolean; detail: string }> => {
    if (warming) return warming.promise;
    if (window && !window.isDestroyed()) return { ok: true, detail: 'the command surface renderer is warm' };
    const resolved = await resolveSurface();
    if (!('surface' in resolved)) return resolved;
    return ensureWarm(resolved);
  };

  return {
    async open() {
      if (window && !window.isDestroyed() && window.isVisible()) {
        // Already open: bring it forward within its own layer rather than
        // stacking a second one, and RE-DELIVER the invoke. The creator pressed
        // the chord again to get back to an empty, focused line, and the project
        // is the only side that can clear its own input - so it must be told.
        // The surface is deliberately NOT reloaded and NOT re-placed: rebuilding
        // it would discard whatever the creator had already typed.
        window.focus();
        if (projectId !== null && surfaceId !== null) {
          deliverInvoke(window, projectId, surfaceId);
        }
        return { ok: true, detail: 'the command surface was already open' };
      }
      return open();
    },

    async warm() {
      return warm();
    },

    async close(reason: OverlayCloseReason) {
      if (!window) return;
      await teardown(reason);
    },

    async destroy() {
      await destroyWarmWindow();
    },

    isOpen() {
      return window !== null && !window.isDestroyed() && window.isVisible();
    },

    isFocused() {
      return window !== null && !window.isDestroyed() && window.isFocused();
    },

    target() {
      return projectId !== null && surfaceId !== null ? { projectId, surfaceId } : null;
    },

    /** Channel used by the overlay page to dismiss itself. */
    registerIpc() {
      if (ipcRegistered) return;
      ipcRegistered = true;
      void ipcHandlers;
    },
    unregisterIpc() {
      ipcRegistered = false;
    },
  };
}

/** The Escape/dismiss channel the overlay page uses. Named here so the preload
 * and the host cannot drift apart. */
export const COMMAND_SURFACE_DISMISS_CHANNEL = 'papers:backpack:command-surface-dismiss';
export const COMMAND_SURFACE_INVOKE_CHANNEL = 'papers:backpack:command-surface-invoke';
export const COMMAND_SURFACE_PROJECT_EVENT = 'papers:project:command-surface';
