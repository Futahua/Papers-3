/**
 * Papers-owned window-helper FACTORY (Assignment 014/014R).
 *
 * The single main-process-internal composition root: it composes the
 * accepted typed capability client, supervisor and owned process transport
 * with a child created ONLY by Papers via the fixed spawn spec.
 *
 * One start attempt resolves the Windows PowerShell runtime AND the
 * resource paths EXACTLY ONCE, validates that immutable snapshot, and
 * creates the child from the SAME snapshot: the transport closure never
 * calls either resolver again. Concurrent starts coalesce onto one
 * attempt; an already-ready start performs no second resolve, validation
 * or spawn; a post-crash restart performs one fresh validation and
 * creates one fresh child with no replay. Platform, runtime and resource
 * validation happen BEFORE any spawn; resolver/stat/hash/read exceptions
 * and every failure path return the existing typed 'helper-unavailable'
 * outcome/state with zero child attempts, never throwing into the app.
 * Stop inherits stdin close, bounded termination escalation and
 * exactly-once terminal reporting from the accepted adapter: no child
 * survives an owned stop.
 *
 * The EXPORTED product surface is the capability methods plus
 * start/stop/isReady ONLY. `spawn`, the child, the transport, raw `send`,
 * the command line and the resource paths are never exposed. Dependency
 * injection (paths resolution, process creation, platform, system root)
 * is private test tooling; the production defaults are explicit and
 * guarded.
 */

import { createHelperProcessTransport, type ChildLikeProcess } from './helperProcessTransport';
import { createWindowCapabilitySupervisor, type WindowCapabilitySupervisor } from './windowCapabilitySupervisor';
import {
  resolveWindowsPowerShellRuntime,
  spawnWindowHelperProcess,
} from './windowHelperSpawn';
import {
  resolveWindowHelperResourcePaths,
  validateWindowHelperResource,
  type WindowHelperResourcePaths,
} from './windowHelperResource';
import type {
  RuntimeWindowId,
  WindowBounds,
  WindowCapabilityResult,
  WindowState,
} from './windowCapabilityTypes';

export type WindowHelperStartOutcome = 'ready' | 'helper-unavailable';

/** Immutable per-start snapshot: the validated runtime + resource paths
 * the child is created from. */
export interface WindowHelperStartSnapshot {
  runtimePath: string;
  paths: WindowHelperResourcePaths;
}

export interface WindowHelperFactory {
  start(): Promise<WindowHelperStartOutcome>;
  stop(): Promise<void>;
  isReady(): boolean;
  list(): Promise<WindowCapabilityResult>;
  observe(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  minimize(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  restore(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  cloak?(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  uncloak?(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  apply(runtimeId: RuntimeWindowId, bounds: WindowBounds, state?: WindowState): Promise<WindowCapabilityResult>;
  close(runtimeId: RuntimeWindowId): Promise<WindowCapabilityResult>;
  /** 016 direct pick: topmost task-worthy window at a screen point. */
  hover(x: number, y: number): Promise<WindowCapabilityResult>;
  /** 019G real-window thumbnail: bounded PrintWindow capture scaled to fit
   * (maxWidth, maxHeight). */
  thumbnail(runtimeId: RuntimeWindowId, maxWidth?: number, maxHeight?: number): Promise<WindowCapabilityResult>;
  /** Monotonic session revision: incremented every time a FRESH helper
   * session is created (first start and every post-crash/post-stop restart).
   * The service uses it to invalidate the bounded thumbnail cache on helper
   * replacement, so a cached image from a previous session is never served. */
  readonly revision: number;
}

export interface WindowHelperFactoryOptions {
  /** Private DI for tests; default resolves the explicit dev/packaged
   * layouts (Electron app paths when present). */
  resolvePaths?: () => WindowHelperResourcePaths;
  /** Private DI for tests; default spawns the fixed Papers command. */
  createProcess?: (snapshot: WindowHelperStartSnapshot) => ChildLikeProcess;
  /** Private DI for tests; default is the real platform. */
  platform?: NodeJS.Platform;
  /** Private DI for tests; default is the main-process SystemRoot. */
  systemRoot?: string;
  /** Private DI for tests: a gate held while a stop is in flight, so
   * stop/start serialization can be exercised deterministically. */
  stopGate?: () => Promise<void>;
  timeoutMs?: number;
  maxPending?: number;
  maxLineBytes?: number;
  maxReceiveBufferBytes?: number;
  maxStderrBytes?: number;
}

const HELPER_NOT_READY: WindowCapabilityResult = {
  outcome: 'helper-unavailable',
  error: 'helper is not ready',
};

function defaultResolvePaths(): WindowHelperResourcePaths {
  let appPath = '';
  let resourcesPath = process.resourcesPath ?? '';
  let packaged = false;
  try {
    // Lazy, guarded: only the Electron main process has `app`; unit tests
    // always inject resolvePaths and never reach this path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getAppPath(): string; isPackaged: boolean } };
    appPath = electron?.app?.getAppPath() ?? '';
    packaged = Boolean(electron?.app?.isPackaged);
  } catch {
    // Outside Electron.
  }
  return resolveWindowHelperResourcePaths({ appPath, resourcesPath, packaged });
}

export function createWindowHelperFactory(options: WindowHelperFactoryOptions = {}): WindowHelperFactory {
  const resolvePaths = options.resolvePaths ?? defaultResolvePaths;
  const createProcess = options.createProcess ?? ((snapshot) => spawnWindowHelperProcess(snapshot.runtimePath, snapshot.paths.helperPath));
  const platform = options.platform ?? process.platform;
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? '';

  let currentSnapshot: WindowHelperStartSnapshot | null = null;
  let starting: Promise<WindowHelperStartOutcome> | null = null;
  let stopping: Promise<void> | null = null;
  let revision = 0;
  const stopGate = options.stopGate ?? (async () => undefined);

  const supervisor: WindowCapabilitySupervisor = createWindowCapabilitySupervisor({
    createTransport: () =>
      createHelperProcessTransport({
        // The child is created from the SAME validated snapshot; this
        // closure NEVER calls resolvePaths/runtime resolution again.
        createProcess: () => {
          const snapshot = currentSnapshot;
          if (!snapshot) {
            throw new Error('window helper snapshot is not initialized');
          }
          return createProcess(snapshot);
        },
        maxLineBytes: options.maxLineBytes,
        maxReceiveBufferBytes: options.maxReceiveBufferBytes,
        maxStderrBytes: options.maxStderrBytes,
      }),
    timeoutMs: options.timeoutMs,
    maxPending: options.maxPending,
  });

  /** One resolve+validate pass; every exception becomes unavailable and
   * nothing is spawned. */
  function buildSnapshot(): WindowHelperStartSnapshot | null {
    try {
      if (platform !== 'win32') return null;
      const runtime = resolveWindowsPowerShellRuntime({ systemRoot, platform });
      if (!runtime.ok) return null;
      const paths = resolvePaths();
      const validation = validateWindowHelperResource(paths);
      if (!validation.ok) return null;
      return { runtimePath: runtime.path, paths };
    } catch {
      return null;
    }
  }

  async function start(): Promise<WindowHelperStartOutcome> {
    // A stop that is in flight invalidates starts: helper-unavailable with
    // ZERO new resolve/validation/spawn; the caller may retry after the
    // stop settles.
    if (stopping) return 'helper-unavailable';
    if (supervisor.getState() === 'ready') return 'ready';
    if (starting) return starting;
    starting = (async () => {
      const snapshot = buildSnapshot();
      if (!snapshot) return 'helper-unavailable';
      currentSnapshot = snapshot;
      try {
        await supervisor.start();
      } catch {
        return 'helper-unavailable';
      }
      // Deterministic overlap semantics: a stop() that overtook this
      // start invalidates it - the overtaken start never reports ready,
      // whatever state the stop reached ('stopping' or 'stopped').
      if (supervisor.getState() !== 'ready') {
        return 'helper-unavailable';
      }
      // A fresh helper session now owns the client/transport: bump the
      // session revision so helper-replacement invalidates any cached
      // thumbnail from a previous session.
      revision += 1;
      return 'ready';
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  /** Coalesced stop: every caller shares ONE in-flight stop promise; one
   * transport is closed/killed exactly once and the factory is not
   * restartable until the shared stop settles. supervisor.stop() is
   * invoked synchronously so the transition begins immediately; the
   * (test) gate then holds the shared stop promise in flight. */
  function stop(): Promise<void> {
    if (supervisor.getState() === 'stopped' && stopping === null) return Promise.resolve();
    if (stopping) return stopping;
    stopping = (async () => {
      try {
        const stopPromise = supervisor.stop();
        await stopGate();
        await stopPromise;
      } finally {
        stopping = null;
      }
    })();
    return stopping;
  }

  function withClient<T>(
    action: (client: NonNullable<ReturnType<typeof supervisor.getClient>>) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    const client = supervisor.getClient();
    if (!client) return Promise.resolve(fallback);
    return Promise.resolve(action(client));
  }

  return {
    start,
    stop,
    isReady: () => supervisor.getState() === 'ready',
    list: () => withClient((client) => client.list(), HELPER_NOT_READY),
    observe: (runtimeId) => withClient((client) => client.observe(runtimeId), HELPER_NOT_READY),
    minimize: (runtimeId) => withClient((client) => client.minimize(runtimeId), HELPER_NOT_READY),
    restore: (runtimeId) => withClient((client) => client.restore(runtimeId), HELPER_NOT_READY),
    cloak: (runtimeId) => withClient((client) => client.cloak(runtimeId), HELPER_NOT_READY),
    uncloak: (runtimeId) => withClient((client) => client.uncloak(runtimeId), HELPER_NOT_READY),
    apply: (runtimeId, bounds, state) => withClient((client) => client.apply(runtimeId, bounds, state), HELPER_NOT_READY),
    close: (runtimeId) => withClient((client) => client.close(runtimeId), HELPER_NOT_READY),
    hover: (x, y) => withClient((client) => client.hover(x, y), HELPER_NOT_READY),
    thumbnail: (runtimeId, maxWidth, maxHeight) => withClient((client) => client.thumbnail(runtimeId, maxWidth, maxHeight), HELPER_NOT_READY),
    get revision() {
      return revision;
    },
  };
}
