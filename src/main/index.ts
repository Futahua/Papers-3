/**
 * Papers — Electron main process bootstrap and composition root.
 */
import { BaseWindow, BrowserWindow, Menu, Notification, WebContentsView, app, ipcMain, screen, session, shell, webContents, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { BackpackRegistry } from './backpacks/backpackRegistry';
import { BackpackProjectService } from './backpacks/backpackProjectService';
import { BackpackProjectRuntime } from './backpacks/backpackProjectRuntime';
import { CanvasRuntime, defaultProgramsRoot } from './canvas/canvasRuntime';
import { CanvasSessionState } from './canvas/canvasState';
import { loadProgramCatalog, type ProgramCatalog } from './canvas/programLoader';
import { CapabilityBroker } from './capabilities/capabilityBroker';
import { registerCoreExecutors } from './capabilities/coreExecutors';
import { PermissionStore } from './capabilities/permissionStore';
import { registerExternalExecutors } from './external/externalBridge';
import { GitService } from './git/gitService';
import { HermesAdapter } from './hermes/hermesAdapter';
import { HermesSurface } from './hermes/hermesSurface';
import { isHermesUpdateHelper, runHermesUpdateHelper } from './hermes/hermesUpdater';
import { startPhoneConnector } from './hermes/phoneConnector';
import { ResourceService } from './resources/resourceService';
import { registerResourceExecutors } from './resources/resourceExecutors';
import { AgentRunService } from './agents/runService';
import { PapersHostFacade } from './hostFacade';
import { PapersUpdater } from './papersUpdater';
import { papersDataDirArgument } from './papersDataDir';
import { randomUUID } from 'node:crypto';
import { DelegateWaveRelay, readConfigFromEnvironment } from './delegateWave/delegateWaveRelay';
import { registerHostIpc } from './ipc/hostIpc';
import { registerProgramIpc } from './ipc/programIpc';
import { registerWindowCapabilityIpc } from './ipc/windowCapabilityIpc';
import { registerWindowPickIpc } from './ipc/windowPickIpc';
import { registerWindowDetachIpc } from './ipc/windowDetachIpc';
import { registerCompactWidgetIpc } from './ipc/compactWidgetIpc';
import { BackpackSurfaceRegistry, DETACHED_SURFACE_KIND, COMPACT_WIDGET_SURFACE_KIND, isAllowedProjectSurfaceSender } from './backpacks/backpackSurfaceRegistry';
import { createPapersWindowRegistry } from './windows/papersWindowRegistry';
import { createSurfaceContextRegistry } from './windows/surfaceContextRegistry';
import { createWindowCapabilityService } from './windows/windowCapabilityService';
import { createSlopTopPickerSession } from './windows/slopTopPickerProtocol';
import { createWindowDetachSession, isAllowedDetachedNavigation, type WindowDetachSession } from './windows/windowDetachSession';
import {
  createCompactWidgetSession,
  COMPACT_WIDGET_MIN_WIDTH,
  COMPACT_WIDGET_MIN_HEIGHT,
  type CompactWidgetSession,
} from './windows/compactWidgetSession';
import { createPapersWindow } from './windows/papersWindowFactory';
import { preparePapersWindow } from './windows/papersWindowLifecycle';
import { papersPaths } from './persistence/paths';
import { ProgramStateService } from './persistence/programStateService';
import { AtomicJsonStore } from './persistence/atomicStore';
import {
  OPAQUE_SURFACE_COLOR,
  TRANSPARENT_CHILD_SURFACE_COLOR,
  TRANSPARENT_SURFACE_COLOR,
} from './windowSurface';
import { resolveWindowBounds, type WindowBounds } from './windowBounds';
import {
  installProgramProtocolHandler,
  registerProgramSchemePrivileges,
} from './security/programScheme';
import {
  installBackpackProjectProtocol,
  registerBackpackProjectSchemePrivileges,
} from './security/backpackProjectScheme';

const hermesUpdateHelperMode = isHermesUpdateHelper();

if (!hermesUpdateHelperMode) {
  registerProgramSchemePrivileges();
  registerBackpackProjectSchemePrivileges();
}

app.setName('Papers');

// Keep every Papers-owned runtime file off C:. The packaged application lives
// in <Papers>/App and stores persistent state in <Papers>/Data, leaving one
// self-contained Papers master folder. Tests and development remain isolated.
const explicitPapersDataDir = papersDataDirArgument(process.argv);
if (process.env['PAPERS_TEST_USER_DATA']) {
  app.setPath('userData', process.env['PAPERS_TEST_USER_DATA']);
} else if (explicitPapersDataDir) {
  mkdirSync(explicitPapersDataDir, { recursive: true });
  app.setPath('userData', explicitPapersDataDir);
} else {
  const papersDataDir = app.isPackaged
    ? path.resolve(path.dirname(process.execPath), '..', 'Data')
    : path.join(app.getAppPath(), '.papers-dev-data');
  mkdirSync(papersDataDir, { recursive: true });
  app.setPath('userData', papersDataDir);
}

// Papers is a single-instance application (except under isolated test homes).
if (
  !hermesUpdateHelperMode &&
  !process.env['PAPERS_TEST_USER_DATA'] &&
  !app.requestSingleInstanceLock()
) {
  app.quit();
}

let mainWindow: BaseWindow | null = null;
/** Phase 1A: which project each sender may act for. One registry for the
 * application; the bindings inside it are per surface. */
const surfaceContexts = createSurfaceContextRegistry();
/**
 * Phase 1B: what each Papers window owns. Its native window, its host view and
 * its project runtime are per-window; the Backpack registry, project service,
 * Delegate Wave, updater, capabilities and the single Hermes backend are not,
 * and stay application-level.
 */
interface PapersWindowOwned {
  window: BaseWindow;
  hostView: WebContentsView;
  backpackProjectRuntime: BackpackProjectRuntime;
}

const papersWindows = createPapersWindowRegistry<PapersWindowOwned>();

/** The project runtime belonging to the window this sender is in. A host
 * sender resolves through the window registry; a project frame resolves
 * through the surface binding it already carries. */
function runtimeForSender(senderId: number): BackpackProjectRuntime | null {
  const owned = papersWindows.ownedForSender(senderId);
  if (owned) return owned.backpackProjectRuntime;
  const windowId = surfaceContexts.contextForSender(senderId)?.windowId;
  if (windowId === undefined) return null;
  return papersWindows.get(windowId)?.owned.backpackProjectRuntime ?? null;
}

/** Every live project runtime — for the few operations that genuinely apply to
 * all of them, such as a settings change. */
function allRuntimes(): BackpackProjectRuntime[] {
  return papersWindows.all().map((context) => context.owned.backpackProjectRuntime);
}

/**
 * Phase 1A: bind a Papers-owned project surface so it can act for its project.
 *
 * The detach and compact-widget surfaces are authorized project senders --
 * `isAllowedProjectSurfaceSender` admits them -- so once every request resolves
 * through its own sender, an unbound one would be refused outright. The
 * `windowId` is the OWNING Papers window, never the detached BrowserWindow's
 * own id: ownership is what routing cares about. This is identity only; the
 * 018 handshake still decides when such a surface may write.
 */
/**
 * The Papers window a detach/widget surface belongs to.
 *
 * It is the window whose surface asked for it. The authenticated workspace
 * sender is resolved before the session call and the proven owning id is
 * carried through detach/widget creation.
 */
/**
 * The Papers window a project surface sender belongs to.
 *
 * Resolved from the sender's own binding, never inferred from its project: two
 * windows may show one project, so "which window owns this project" has no
 * answer while "which window is this sender in" always does.
 */
function windowIdForProjectSender(sender: WebContents): number | null {
  return surfaceContexts.contextForSender(sender.id)?.windowId ?? null;
}

function bindOwnedProjectSurface(
  window: BrowserWindow,
  projectId: string,
  kind: 'detached' | 'widget',
  owningWindowId: number,
): void {
  const senderId = window.webContents.id;
  surfaceContexts.bind(senderId, { projectId, windowId: owningWindowId, kind });
  // A dead sender can no longer act, and leaving its id bound would let a
  // recycled id inherit a project.
  window.webContents.once('destroyed', () => surfaceContexts.unbind(senderId));
}

let hostView: WebContentsView | null = null;

// A second launch belongs to the existing Papers window. Auxiliary Backpack
// surfaces must never be allowed to become an unreachable single-instance
// owner: if the main surface still exists, restore it; if it does not, retire
// the orphaned process so the next launch can start cleanly.
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  for (const context of papersWindows.all()) {
    if (!context.owned.window.isDestroyed()) {
      context.owned.window.show();
      context.owned.window.focus();
      return;
    }
  }
  app.quit();
});

/** Height of the slim custom title bar / native window-controls overlay. */
const TITLE_BAR_HEIGHT = 40;
/** Papers band the docked Hermes window sits below (the slim title bar). */
const TOP_BAR_HEIGHT = TITLE_BAR_HEIGHT;
/** Fraction of Papers width the docked Hermes sidebar occupies (clamped). */
const DOCK_WIDTH_FRACTION = 0.4;
const DOCK_MIN_WIDTH = 380;
const DOCK_MAX_WIDTH = 620;

interface PapersSettings {
  transparentWindow: boolean;
  /** Creator-captured window rectangle, restored on every later launch.
   * Absent until "Save current window size" is used. */
  windowBounds?: WindowBounds;
  [key: string]: unknown;
}

/**
 * The docked Hermes rectangle in Papers content coordinates: a right-hand strip
 * below the top bar. The renderer and main process must agree on this so the
 * host UI leaves room for the docked window and Papers realignment matches.
 */
/**
 * The dock strip, in the coordinates of the window that owns Hermes.
 *
 * Both dimensions come from that window. Taking the width from the owner and
 * the height from the primary window would size Hermes against two different
 * windows at once, which is invisible while there is one of them and wrong the
 * moment there are two.
 */
function dockBoundsFor(content: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(content.width * DOCK_WIDTH_FRACTION)));
  const height = Math.max(400, Math.round(content.height - TOP_BAR_HEIGHT));
  return { x: Math.max(0, content.width - width), y: TOP_BAR_HEIGHT, width, height };
}

async function bootstrap(): Promise<void> {
  const baseDir = app.getPath('userData');
  const paths = papersPaths(baseDir);
  const settingsStore = new AtomicJsonStore(paths.settingsFile, { recoveryDir: paths.recoveryDir });
  const settingsReport = await settingsStore.load<PapersSettings>();
  let papersSettings: PapersSettings = {
    ...(settingsReport.value && typeof settingsReport.value === 'object' ? settingsReport.value : {}),
    transparentWindow: settingsReport.value?.transparentWindow === true,
  };

  const registry = new BackpackRegistry(baseDir);
  const registryReport = await registry.initialize();
  const backpackProjects = new BackpackProjectService(
    path.join(paths.root, 'backpack-projects.json'),
    (target) => shell.openPath(target),
    async (target) => {
      const icon = await app.getFileIcon(target, { size: 'large' });
      return icon.isEmpty() ? null : icon.toDataURL();
    },
    async (target) => {
      shell.showItemInFolder(target);
    },
  );
  installBackpackProjectProtocol(backpackProjects);

  const permissionStore = new PermissionStore(paths);
  await permissionStore.initialize();

  const programsRoot = defaultProgramsRoot(app.getAppPath(), app.isPackaged, process.resourcesPath);
  const fixtureMode = process.env['PAPERS_ENABLE_FIXTURES'] === '1';
  let catalog: ProgramCatalog = fixtureMode
    ? await loadProgramCatalog(programsRoot)
    : { programs: new Map(), issues: [] };

  const programProtocolHandler = installProgramProtocolHandler({
    programsRoot,
    isKnownProgram: (programId) => catalog.programs.has(programId),
  });

  // No native application menu — Papers has no File/Edit/View/Window menu; the
  // shell is entirely the Papers UI.
  Menu.setApplicationMenu(null);

  // App icon: packaged copies it to <resources>/icon.png; dev reads assets/.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'assets', 'icon.png');
  const appIcon = existsSync(iconPath) ? iconPath : undefined;

  // ------------------------------------------------------------------ window
  // Frameless with a slim title-bar overlay: the OS paints only the standard
  // minimize / maximize / close controls flush in the top-right, and the rest
  // of the top band is Papers' own theme-matched bar (with an invisible drag
  // region). PAPERS_TITLEBAR_HEIGHT keeps the renderer and the overlay in sync.
  // A saved preset wins over the default size, but only after being checked
  // against the displays attached right now: a rectangle captured across
  // several monitors would otherwise reopen off-screen once one is unplugged.
  const savedBounds = resolveWindowBounds(
    papersSettings.windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  );

  const preloadDir = path.join(app.getAppPath(), 'out', 'preload');
  const detachRegistry = new BackpackSurfaceRegistry();
  let detachSession: WindowDetachSession | null = null;
  const widgetRegistry = new BackpackSurfaceRegistry();
  let widgetSession: CompactWidgetSession | null = null;
  const windowInstance = createPapersWindow({
    bounds: savedBounds ?? undefined,
    appIcon,
    transparent: papersSettings.transparentWindow,
    currentTransparent: () => papersSettings.transparentWindow,
    hostPreloadPath: path.join(preloadDir, 'host.cjs'),
    projectPreloadPath: path.join(preloadDir, 'backpackProject.cjs'),
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    rendererFile: path.join(app.getAppPath(), 'out', 'renderer', 'index.html'),
    onProjectSurfaceClosed: (projectId) => {
      detachSession?.closeProject(projectId).catch(() => undefined);
      detachRegistry.unregisterWorkspaceForProject(projectId);
      // Compact widgets are independent pet windows, not child views of the
      // entered Backpack. Returning to the Backpack list tears down only the
      // workspace surface; the widget and its capability token stay live so
      // it remains visible/usable and can reconnect when the project is
      // entered again. App shutdown still owns closeAll().
    },
  });
  const preparedWindow = preparePapersWindow(windowInstance, {
    register: (instance) => {
      mainWindow = instance.window;
      hostView = instance.hostView;
      papersWindows.add(
        instance.window.id,
        {
          window: instance.window,
          hostView: instance.hostView,
          backpackProjectRuntime: instance.backpackProjectRuntime,
        },
        registry.lastActiveBackpackId,
      );
      papersWindows.setHostSender(instance.window.id, instance.hostView.webContents.id);
    },
    onClose: (instance) => instance.backpackProjectRuntime.hide(),
    finalize: (windowId) => {
      void widgetSession?.closeOwnedByWindow(windowId);
      const ownedHostView = papersWindows.get(windowId)?.owned.hostView;
      surfaceContexts.unbindWindow(windowId);
      papersWindows.remove(windowId);
      if (mainWindow?.id === windowId) mainWindow = null;
      if (hostView === ownedHostView) hostView = null;
    },
  });
  mainWindow = windowInstance.window;
  hostView = windowInstance.hostView;
  const backpackProjectRuntime = windowInstance.backpackProjectRuntime;
  // Phase 1B: this window and its renderer are now addressable as a context
  // rather than as the module's single `mainWindow`/`hostView` pair.
  // Only the first window at launch may reopen the persisted most-recent
  // Backpack. A window created later carries null, so New Window opens fresh
  // rather than duplicating whatever was last used.
  const applyHostSurface = (transparent: boolean): void => {
    // The host view is a child surface: its zero alpha is not honoured, so a
    // white RGB payload paints literally and every transparent page above it
    // reads as a white panel. Verified over CDP — with the whole DOM computing
    // rgba(0,0,0,0), the canvas was still white until this base changed.
    const color = transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR;
    // This is an application-wide appearance setting. Repaint every live
    // Papers window, not only the bootstrap window captured by this closure.
    for (const context of papersWindows.all()) {
      if (!context.owned.hostView.webContents.isDestroyed()) {
        context.owned.hostView.setBackgroundColor(color);
      }
      if (!context.owned.window.isDestroyed()) {
        context.owned.window.setBackgroundColor(
          transparent ? TRANSPARENT_SURFACE_COLOR : OPAQUE_SURFACE_COLOR,
        );
      }
    }
  };
  applyHostSurface(papersSettings.transparentWindow);

  // The production Hermes experience IS the existing Hermes Desktop product.
  // Papers runs one Hermes backend and positions the real Hermes Desktop
  // window as a docked sidebar or a detached window — never a second chat UI.
  // Phase 1B.4: Hermes is told which live window to compute dock geometry
  // against; the docking relationship itself lives in the window registry.
  const hermesSurface = new HermesSurface(
    () => {
      const owner = papersWindows.hermesDockOwner();
      return owner === null ? null : papersWindows.get(owner)?.owned.window ?? null;
    },
    () => facade.emitHermesSurface(),
  );

  // Keep a docked Hermes window aligned to Papers as it moves or resizes.
  // setDockBounds also raises Hermes above Papers (non-topmost) so it follows
  // Papers to the front without becoming globally always-on-top.
  // Every Papers window may carry these handlers, but they are inert unless
  // that window owns the dock: moving or resizing a window that does not own
  // Hermes must not drag Hermes around.
  const realignHermesDock = (): void => {
    const owner = papersWindows.hermesDockOwner();
    if (owner === null || owner !== mainWindow?.id) return;
    hermesSurface.setDockBounds(dockBoundsFor(mainWindow.getContentBounds()));
  };
  mainWindow.on('resize', realignHermesDock);
  mainWindow.on('move', realignHermesDock);
  // When Papers is activated, raise the docked Hermes above it (moveTop), so
  // clicking Papers keeps the pair together — but only via non-topmost raise, so
  // switching to another application leaves both windows ordinary.
  // Focus raises a docked Hermes only for the window that owns it. Focus is
  // never an ownership transfer (D-021).
  mainWindow.on('focus', () => {
    if (papersWindows.hermesDockOwner() !== mainWindow?.id) return;
    hermesSurface.onPapersActivated();
  });

  // ------------------------------------------------------------ composition
  const canvasState = new CanvasSessionState((items) => facade.emitShelfChanged(items));

  const runtime = new CanvasRuntime({
    window: mainWindow,
    transparentWindow: papersSettings.transparentWindow,
    preloadPath: path.join(preloadDir, 'program.cjs'),
    protocolHandler: programProtocolHandler,
    onStatusChange: (status) => facade.emitProgramStatus(status),
    onEscapeToHost: () => hostView?.webContents.focus(),
  });

  const adapter = new HermesAdapter(paths);
  await adapter.initialize();

  const stateService = new ProgramStateService(paths);

  const broker = new CapabilityBroker({
    permissionStore,
    prompter: {
      prompt: (p) => facade.prompt(p),
    },
    logFile: path.join(paths.root, 'logs', 'capability-log.jsonl'),
  });

  const gitService = new GitService();
  const resourceService = new ResourceService(paths);

  const runService: AgentRunService = new AgentRunService({
    paths,
    adapter,
    previewConfirmer: (preview) => facade.confirmInvocation(preview),
    isKnownProgram: (programId) => catalog.programs.has(programId),
    onRunsChanged: (snapshot) => facade.emitRunsChanged(snapshot),
    notifyProgram: (programId, channel, payload) => {
      if (runtime.activeProgram?.programId === programId) {
        runtime.sendToActiveProgram(channel, payload);
      }
    },
    defaultCwd: (backpackId) => facade.defaultRunCwd(backpackId),
    resolveExecutionCwd: async (backpackId, programId, resourceId) => {
      const resource = await resourceService.requireGranted(backpackId, programId, resourceId);
      if (resource.type !== 'git-worktree') {
        throw new Error('agent execution resource is not a git worktree');
      }
      return path.resolve(resource.path);
    },
  });

  // Application-level state, so every live host hears it. The updater itself
  // holds no window reference.
  const updater = new PapersUpdater((next) => {
    for (const context of papersWindows.all()) {
      const contents = context.owned.hostView.webContents;
      if (!contents.isDestroyed()) contents.send('host:event:update-status', next);
    }
  });
  const isProjectSurfaceSender = (sender: WebContents): boolean =>
    isAllowedProjectSurfaceSender({
      senderId: sender.id,
      url: sender.mainFrame.url,
      isWorkspaceSender: runtimeForSender(sender.id)?.isSender(sender) ?? false,
      detachRegistry,
      widgetRegistry,
    });

  const facade = new PapersHostFacade({
    // Phase 1B.3: delivery with explicit semantics. Broadcast reaches every
    // live host renderer; sendToWindow reaches exactly one.
    broadcastToHosts: (channel, payload) => {
      for (const context of papersWindows.all()) {
        const contents = context.owned.hostView.webContents;
        if (!contents.isDestroyed()) contents.send(channel, payload);
      }
    },
    sendToWindow: (windowId, channel, payload) => {
      const contents = papersWindows.get(windowId)?.owned.hostView.webContents;
      if (contents && !contents.isDestroyed()) contents.send(channel, payload);
    },
    hostWindowForSender: (senderId) => papersWindows.windowForSender(senderId),
    hostWindowIds: () => papersWindows.windowIds,
    hermesDockOwner: () => papersWindows.hermesDockOwner(),
    enteredBackpack: (windowId) => papersWindows.enteredBackpack(windowId),
    setEnteredBackpack: (windowId, backpackId) => papersWindows.setEnteredBackpack(windowId, backpackId),
    clearEnteredBackpackEverywhere: (backpackId) => papersWindows.clearEnteredBackpackEverywhere(backpackId),
    retireBackpackProjectSurfaces: async (backpackId) => {
      await Promise.all([
        detachSession?.closeProject(backpackId).catch(() => undefined),
        widgetSession?.closeProject(backpackId).catch(() => undefined),
      ]);
    },
    restoreBackpack: (windowId) => papersWindows.restoreBackpack(windowId),
    setHermesDockOwner: (windowId) => papersWindows.setHermesDockOwner(windowId),
    // The Canvas runtime is still application-level and attached to the first
    // window, so this has one answer today. Recording the relationship rather
    // than assuming it means per-window Canvas would need no delivery change.
    canvasRuntimeWindow: () => mainWindow?.id ?? null,
    updater,
    registry,
    backpackProjects,
    // Environment-only: URL, operator token and the one permitted Backpack id
    // live in main and are never persisted, logged or exposed to a renderer.
    delegateWave: new DelegateWaveRelay(
      readConfigFromEnvironment(),
      (url, init) => fetch(url, init),
      () => randomUUID(),
    ),
    isBackpackProjectSender: isProjectSurfaceSender,
    surfaces: surfaceContexts,
    // Phase 1B: a real lookup, with no singleton fallback left. A host
    // renderer resolves through the window registry; a project, detached or
    // widget sender resolves through the surface binding it already carries.
    // Anything else is refused.
    windowIdForSender: (senderId) => papersWindows.windowForSender(senderId)
      ?? surfaceContexts.contextForSender(senderId)?.windowId
      ?? null,
    showBackpackProjectSurface: async (senderId, url) => {
      const runtime = runtimeForSender(senderId);
      if (!runtime) throw new Error('This surface has no Papers window.');
      await runtime.show(url);
      // Phase 1A: bind both senders that may act for this project — the host
      // view that opened it and the project frame it hosts. The project id is
      // the surface origin's host, so the binding is derived from the surface
      // itself rather than from whatever was opened most recently.
      // The host surface was bound when the project opened; this binds the
      // project frame it now hosts, in the same window.
      const projectId = runtime.liveProjectId;
      const frameSender = runtime.senderId;
      const owningWindowId = papersWindows.windowForSender(senderId)
        ?? surfaceContexts.contextForSender(senderId)?.windowId;
      if (projectId && frameSender !== null && owningWindowId !== undefined) {
        surfaceContexts.bind(frameSender, { projectId, windowId: owningWindowId, kind: 'project' });
        // show() replaces a live surface by hiding the old one first, so
        // without this a dead frame's id would stay bound.
        runtime.onFrameDestroyed(frameSender, () => surfaceContexts.unbind(frameSender));
      }
    },
    hideBackpackProjectSurface: (senderId) => {
      // Only this window's surface comes down. Unbinding is the facade's job.
      runtimeForSender(senderId)?.hide();
    },
    runtime,
    canvasState,
    catalog: () => catalog,
    permissionStore,
    adapter,
    hermesSurface,
    runService: () => runService,
    paths,
    setTitleBarOverlay: (senderId, color, symbolColor) => {
      // Repaint the native window controls to match the active Papers theme.
      const windowId = papersWindows.windowForSender(senderId);
      const context = windowId === null ? null : papersWindows.get(windowId);
      if (!context || context.owned.window.isDestroyed() || context.owned.hostView.webContents.isDestroyed()) {
        return;
      }
      context.owned.window.setTitleBarOverlay?.({ color, symbolColor, height: TITLE_BAR_HEIGHT });
      context.owned.window.setBackgroundColor(
        papersSettings.transparentWindow ? TRANSPARENT_SURFACE_COLOR : color,
      );
      context.owned.hostView.setBackgroundColor(
        papersSettings.transparentWindow ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR,
      );
    },
    getSettings: () => ({ ...papersSettings }),
    setTransparentWindow: async (enabled) => {
      papersSettings = { ...papersSettings, transparentWindow: enabled };
      await settingsStore.save(papersSettings);
      applyHostSurface(enabled);
      // The program view is a separate child surface; the host repaint above
      // does not reach it. BaseWindow `transparent`/`frame` remain
      // construction-only, so a full effect still needs a restart.
      runtime.setTransparentWindow(enabled);
      for (const runtime of allRuntimes()) runtime.setTransparent(enabled);
    },
    saveWindowBounds: async (senderId) => {
      // getBounds(), not getContentBounds(): the saved rectangle is restored
      // through the BaseWindow constructor, which takes outer window bounds.
      const windowId = papersWindows.windowForSender(senderId);
      const bounds = windowId === null ? undefined : papersWindows.get(windowId)?.owned.window.getBounds();
      if (!bounds) return null;
      papersSettings = { ...papersSettings, windowBounds: bounds };
      await settingsStore.save(papersSettings);
      return bounds;
    },
    clearWindowBounds: async () => {
      const { windowBounds: _dropped, ...rest } = papersSettings;
      papersSettings = rest as PapersSettings;
      await settingsStore.save(papersSettings);
    },
  });

  registerCoreExecutors({ broker, paths, facade, stateService });
  registerResourceExecutors({ broker, resources: resourceService, git: gitService, paths });
  registerExternalExecutors({ broker, resources: resourceService });

  adapter.on('health-changed', () => facade.emitHermesHealth());

  registerHostIpc(facade);
  const windowCapabilityService = createWindowCapabilityService({
    // Papers itself is a useful saved layout member. Admit only the real main
    // shell by its fixed native title; same-process picker, widget, preview and
    // overlay utility windows retain empty/data titles and remain ineligible.
    allowCurrentProcessWindow: (observation) => observation.title === 'Papers',
  });
  registerWindowCapabilityIpc({
    ipcMain,
    service: windowCapabilityService,
    isSender: isProjectSurfaceSender,
    resolveCallerHwnd: (sender) => {
      const owner = BrowserWindow.fromWebContents(sender);
      if (!owner || owner.isDestroyed()) return null;
      const handle = owner.getNativeWindowHandle();
      return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
    },
  });
  // One global direct-onscreen pick session. Papers sends one authenticated
  // initial-member snapshot to the creator's already-running SlopTop AHK. AHK
  // owns hover/click/rendering locally and returns one final green-set snapshot
  // on Enter; no pointer event or click is routed through Papers.
  const nativeSignalRoot = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', 'PapersNativeBridgeReceipts');
  const nativePickerSignal = path.join(nativeSignalRoot, 'picker-activate.signal');
  const nativePickerAck = path.join(nativeSignalRoot, 'picker-ack.signal');
  const nativePickerResult = path.join(nativeSignalRoot, 'picker-result.signal');
  const nativePickerCancel = path.join(nativeSignalRoot, 'picker-cancel.signal');
  const removeSignal = (file: string): void => { try { unlinkSync(file); } catch { /* absent is clean */ } };
  const writeSignal = (file: string, value: unknown): void => {
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8' });
    removeSignal(file);
    renameSync(temp, file);
  };
  const readSignal = (file: string): unknown => {
    // Tolerate one legacy AHK BOM while all new signals use UTF-8-RAW.
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  };
  const windowPickSession = createSlopTopPickerSession(windowCapabilityService, {
    activate: (request) => {
      mkdirSync(nativeSignalRoot, { recursive: true });
      removeSignal(nativePickerAck);
      removeSignal(nativePickerResult);
      removeSignal(nativePickerCancel);
      writeSignal(nativePickerSignal, request);
    },
    readAck: () => readSignal(nativePickerAck),
    readResult: () => readSignal(nativePickerResult),
    requestCancel: (token) => writeSignal(nativePickerCancel, { version: 2, token, cancel: true }),
    cleanup: () => {
      removeSignal(nativePickerSignal);
      removeSignal(nativePickerAck);
      removeSignal(nativePickerResult);
    },
  });
  registerWindowPickIpc({
    ipcMain,
    session: windowPickSession,
    isSender: isProjectSurfaceSender,
  });
  // 018H1: generic Papers-owned detached Backpack surface seam - one
  // sandboxed BrowserWindow per registered project/surface request, an
  // allowed-sender registry, an ownership-transfer handshake and display
  // clamping. Papers routes bounded opaque state/commands only between
  // registered surfaces and never interprets the Backpack document.
  detachSession = createWindowDetachSession({
    registry: detachRegistry,
    screen: {
      getAllDisplays: () => screen.getAllDisplays().map((display) => ({
        x: display.workArea.x,
        y: display.workArea.y,
        width: display.workArea.width,
        height: display.workArea.height,
      })),
      getPrimaryDisplay: () => {
        const display = screen.getPrimaryDisplay();
        return { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height };
      },
      on: (event, callback) => {
        screen.on(event as 'display-metrics-changed', callback);
      },
      removeListener: (event, callback) => {
        screen.removeListener(event as 'display-metrics-changed', callback);
      },
    },
    ipcMain,
    // Routed to the OWNING window's workspace. surfaceForProject returns the
    // first workspace showing a project, which is ambiguous once two windows
    // do -- so the owner recorded at detach time decides.
    sendToWorkspace: (projectId, owningWindowId, channel, payload) => {
      const workspace = detachRegistry.surfaceForProject(projectId, 'workspace');
      if (!workspace) return false;
      if (surfaceContexts.contextForSender(workspace.id)?.windowId !== owningWindowId) return false;
      const contents = webContents.fromId(workspace.id);
      if (!contents || contents.isDestroyed()) return false;
      contents.send(channel, payload);
      return true;
    },
    isSurfaceOrigin: (senderId, projectId) => {
      const contents = webContents.fromId(senderId);
      if (!contents || contents.isDestroyed()) return false;
      try {
        const origin = new URL(contents.mainFrame.url);
        return origin.protocol === 'papers-backpack:' && origin.host === projectId;
      } catch {
        return false;
      }
    },
    preloadPath: path.join(preloadDir, 'backpackProject.cjs'),
    createWindow: ({ bounds, preloadPath: detachedPreloadPath, projectId, owningWindowId }) => {
      const detachedWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        // Let the Backpack page's own transparent-background/backdrop-opacity
        // customization remain authoritative in detached widget mode.
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        webPreferences: {
          preload: detachedPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
        },
      });
      detachedWindow.setMenuBarVisibility(false);
      detachedWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      detachedWindow.webContents.on('will-navigate', (event, target) => {
        if (!isAllowedDetachedNavigation(target, projectId)) event.preventDefault();
      });
      detachedWindow.once('ready-to-show', () => {
        if (!detachedWindow.isDestroyed()) detachedWindow.showInactive();
      });
      bindOwnedProjectSurface(detachedWindow, projectId, 'detached', owningWindowId);
      return detachedWindow;
    },
    // Cancelling the 016 pick when a registered surface goes away is safe:
    // cancel is a no-op when no session is active.
    onSurfaceClosed: () => {},
  });
  detachSession!.registerDetachIpc();
  registerWindowDetachIpc({
    ipcMain,
    registry: detachRegistry,
    session: detachSession!,
    // Resolved against the SENDER's own window runtime, not the bootstrap one:
    // with two windows, "is this the workspace" has a different answer in each.
    isWorkspaceSender: (sender, projectId) => {
      if (!runtimeForSender(sender.id)?.isSender(sender)) return false;
      try {
        return new URL(sender.mainFrame.url).host === projectId;
      } catch {
        return false;
      }
    },
    windowIdForWorkspaceSender: windowIdForProjectSender,
    isDetachedSender: (sender, projectId) => {
      const surface = detachRegistry.surface(sender.id);
      if (!surface || surface.kind !== DETACHED_SURFACE_KIND || surface.projectId !== projectId) return false;
      try {
        const origin = new URL(sender.mainFrame.url);
        return origin.protocol === 'papers-backpack:' && origin.host === projectId;
      } catch {
        return false;
      }
    },
    resolveEntryUrl: (sender, projectId) => runtimeForSender(sender.id)?.entryUrlFor(sender, projectId) ?? null,
  });
  // 019C: generic compact widget host - one fixed compact BrowserWindow per
  // (projectId, layoutKey), opened/focused by the registered live workspace via
  // opaque bounded keys. Papers binds identities and routes bounded opaque
  // messages only; it never parses AYG state or commands.
  widgetSession = createCompactWidgetSession({
    registry: widgetRegistry,
    screen: {
      getAllDisplays: () => screen.getAllDisplays().map((display) => ({
        x: display.workArea.x,
        y: display.workArea.y,
        width: display.workArea.width,
        height: display.workArea.height,
      })),
      getPrimaryDisplay: () => {
        const display = screen.getPrimaryDisplay();
        return { x: display.workArea.x, y: display.workArea.y, width: display.workArea.width, height: display.workArea.height };
      },
      on: (event, callback) => {
        screen.on(event as 'display-metrics-changed', callback);
      },
      removeListener: (event, callback) => {
        screen.removeListener(event as 'display-metrics-changed', callback);
      },
    },
    ipcMain,
    preloadPath: path.join(preloadDir, 'backpackProject.cjs'),
    // Owner-scoped: the entry URL comes from that window's own runtime.
    resolveEntryUrl: (projectId, owningWindowId) =>
      papersWindows.get(owningWindowId)?.owned.backpackProjectRuntime.entryUrlForProject(projectId) ?? null,
    createWindow: ({ bounds, preloadPath: widgetPreloadPath, projectId, owningWindowId }) => {
      const widgetWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        // 019G/021: the frameless compact widget carries NO redundant OS title;
        // the card shows the real layout name itself.
        title: '',
        // The Backpack page owns the visible card colour/opacity. An opaque
        // native backing surface would remain white even when every DOM layer
        // is transparent.
        transparent: true,
        backgroundColor: '#00000000',
        // 035: the compact widget is USER-resizable. The shared card fills the
        // window and reflows from the available width; the small floor keeps a
        // degenerate size from being unrecoverable. No max: the upper bound is
        // the bounded report ceiling in the IPC/preload, not a window option.
        resizable: true,
        // Codex-pet behavior: the detached control remains available above
        // ordinary application windows without stealing focus.
        alwaysOnTop: true,
        skipTaskbar: true,
        minWidth: COMPACT_WIDGET_MIN_WIDTH,
        minHeight: COMPACT_WIDGET_MIN_HEIGHT,
        show: false,
        webPreferences: {
          preload: widgetPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
        },
      });
      widgetWindow.setMenuBarVisibility(false);
      widgetWindow.setAlwaysOnTop(true, 'floating');
      widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // 019F: fail-closed widget navigation guard - allow ONLY the exact
      // papers-backpack: scheme with the exact registered project host; every
      // other navigation (http, file, cross-project) is prevented.
      widgetWindow.webContents.on('will-navigate', (event, targetUrl) => {
        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== 'papers-backpack:' || parsed.host !== projectId) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      widgetWindow.once('ready-to-show', () => {
        if (!widgetWindow.isDestroyed()) widgetWindow.showInactive();
      });
      bindOwnedProjectSurface(widgetWindow, projectId, 'widget', owningWindowId);
      return widgetWindow;
    },
    isSurfaceOrigin: (senderId, projectId) => {
      const contents = webContents.fromId(senderId);
      if (!contents || contents.isDestroyed()) return false;
      try {
        const origin = new URL(contents.mainFrame.url);
        return origin.protocol === 'papers-backpack:' && origin.host === projectId;
      } catch {
        return false;
      }
    },
  });
  widgetSession.registerIpc();
  const widgetPreviewWindows = new Map<number, BrowserWindow>();
  type CandidatePickerSession = {
    window: BrowserWindow;
    candidateIds: Set<string>;
    resolve: ((result: { action: 'select' | 'close' | 'cancel' | 'direct-pick'; candidateId: string | null }) => void) | null;
  };
  const candidatePickerSessions = new Map<number, CandidatePickerSession>();
  const hideWidgetPreview = (senderId: number): void => {
    const preview = widgetPreviewWindows.get(senderId);
    widgetPreviewWindows.delete(senderId);
    if (preview && !preview.isDestroyed()) preview.destroy();
  };
  registerCompactWidgetIpc({
    ipcMain,
    registry: widgetRegistry,
    session: widgetSession,
    windowIdForWorkspaceSender: windowIdForProjectSender,
    hidePreview: hideWidgetPreview,
    dismissCandidatePicker: (sender) => {
      const active = candidatePickerSessions.get(sender.id);
      if (active && !active.window.isDestroyed()) active.window.destroy();
    },
    showContextMenu: async (sender) => {
      const owner = BrowserWindow.fromWebContents(sender);
      if (!owner || owner.isDestroyed()) return 'cancel';
      return new Promise<'remove' | 'cancel'>((resolve) => {
        let settled = false;
        const finish = (action: 'remove' | 'cancel'): void => {
          if (settled) return;
          settled = true;
          resolve(action);
        };
        const menu = Menu.buildFromTemplate([{
          label: 'Remove from this layout',
          click: () => finish('remove'),
        }]);
        menu.popup({ window: owner, callback: () => finish('cancel') });
      });
    },
    showCandidatePicker: async (sender, candidates) => {
      const active = candidatePickerSessions.get(sender.id);
      if (active && !active.window.isDestroyed()) {
        active.candidateIds = new Set(candidates.map((candidate) => candidate.id));
        const update = JSON.stringify(candidates).replace(/</g, '\\u003c');
        await active.window.webContents.executeJavaScript(
          `window.__papersPickerUpdate?.(${update})`, true).catch(() => undefined);
        if (!active.window.isVisible()) active.window.show();
        active.window.focus();
        return new Promise<{ action: 'select' | 'close' | 'cancel' | 'direct-pick'; candidateId: string | null }>((resolve) => {
          // The Backpack requests the next choice only after the previous one
          // settled. Fail closed if a malformed caller overlaps requests.
          active.resolve?.({ action: 'cancel', candidateId: null });
          active.resolve = resolve;
        });
      }
      const cursor = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const width = Math.min(420, area.width);
      const height = Math.min(440, area.height);
      const x = Math.max(area.x, Math.min(area.x + area.width - width, cursor.x - Math.round(width / 2)));
      const y = Math.max(area.y, Math.min(area.y + area.height - height, cursor.y - 36));
      const picker = new BrowserWindow({
        title: 'Papers Window Chooser',
        x, y, width, height,
        frame: false,
        resizable: true,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#161b22',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(preloadDir, 'candidatePicker.cjs'),
        },
      });
      picker.setAlwaysOnTop(true, 'pop-up-menu');
      const encoded = JSON.stringify(candidates).replace(/</g, '\\u003c');
      const html = `<!doctype html><meta charset="utf-8"><title>Papers Window Chooser</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
 *{box-sizing:border-box}html,body{margin:0;height:100%;background:#161b22;color:#dbe7f3;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}body{border:1px solid #465462;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 14px 38px #0009}.head{padding:7px 13px 10px;border-bottom:1px solid #2b3742}.titleline{display:flex;align-items:center;justify-content:space-between;min-height:27px;margin-bottom:4px;-webkit-app-region:drag}.close,.search,.row,.empty,.filters,.state-filter,.direct-pick,.list{-webkit-app-region:no-drag}.filters{display:flex;align-items:center;gap:8px}.state-filter{display:grid;place-items:center;width:18px;height:18px;margin:0;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;appearance:none}.state-filter:checked::after{content:'✓';font-size:13px;font-weight:800;line-height:1;color:currentColor}.state-filter.current-filter{color:#ef9c77}.state-filter.available-filter{color:#72a7d5}.state-filter:hover,.state-filter:focus-visible{background:currentColor;box-shadow:0 0 0 2px #ffffff18;outline:none}.state-filter:hover::after,.state-filter:focus-visible::after{color:#161b22}.direct-pick{display:grid;place-items:center;width:18px;height:18px;margin:0 0 0 2px;padding:0;border:1px solid #b782f0;border-radius:4px;background:#8f4bd129;color:#d9b8ff;cursor:pointer}.direct-pick:hover,.direct-pick:focus-visible{background:#8f4bd152;color:#fff;box-shadow:0 0 9px #9d55f699;outline:none}.direct-pick svg{display:block;width:12px;height:12px}.close{border:0;background:transparent;color:#9cacba;font-size:19px;line-height:20px;border-radius:5px;cursor:pointer}.close:hover{background:#31404b;color:#fff}.search{width:100%;height:34px;border:1px solid #536372;border-radius:8px;background:#0e141a;color:#f3f8fc;padding:0 11px;outline:none}.search:focus{border-color:#72a7d5;box-shadow:0 0 0 2px #72a7d533}.list{padding:7px;overflow:auto;flex:1;scrollbar-color:#4b5b68 transparent;display:flex;flex-direction:column}.row,.empty{flex:0 0 auto}.row{width:100%;border:0;background:transparent;color:inherit;display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border-radius:8px;text-align:left;cursor:pointer}.row:hover,.row:focus-visible{background:#273540;outline:none}.busy .row{pointer-events:none;opacity:.68}.icon{width:20px;height:20px;object-fit:contain}.fallback{width:16px;height:16px;border:1px solid #83919d;border-radius:3px}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#72a7d5}.state{font-size:11px;color:#72a7d5}.current .label,.current .state{color:#ef9c77}.empty{padding:24px;text-align:center;color:#8898a7}.drag-space{flex:1 0 28px;min-height:28px;-webkit-app-region:drag}
</style><div class="head"><div class="titleline"><div class="filters" aria-label="Filter window states"><input class="state-filter current-filter" type="checkbox" aria-label="Show layout members" title="Show layout members (remove)"><input class="state-filter available-filter" type="checkbox" aria-label="Show available windows" title="Show available windows (add)"><button class="direct-pick" type="button" aria-label="Pick windows directly" title="Pick windows directly"><svg viewBox="0 0 24 24" aria-hidden="true"><path transform="translate(-1 1)" d="M6.5 3.5l13.5 6.5-6.3 2.1-2.1 6.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button></div><button class="close" aria-label="Close">×</button></div><input class="search" type="search" placeholder="Search windows…" autocomplete="off" spellcheck="false"></div><div class="list"></div><script id="data" type="application/json">${encoded}</script><script>
 let all=JSON.parse(document.getElementById('data').textContent);const list=document.querySelector('.list'),search=document.querySelector('.search'),currentFilter=document.querySelector('.current-filter'),availableFilter=document.querySelector('.available-filter');
function signal(path,id=''){window.candidatePicker.signal(path,id)}
 function appendDragSpace(){const d=document.createElement('div');d.className='drag-space';d.setAttribute('aria-hidden','true');list.append(d)}
 function render(){const q=search.value.trim().toLowerCase(),filtering=currentFilter.checked||availableFilter.checked,rows=all.filter(x=>x.title.toLowerCase().includes(q)&&(!filtering||(currentFilter.checked&&x.current)||(availableFilter.checked&&!x.current)));list.replaceChildren();if(!rows.length){const e=document.createElement('div');e.className='empty';e.textContent='No matching windows';list.append(e);appendDragSpace();return}for(const c of rows){const b=document.createElement('button');b.className='row'+(c.current?' current':'');b.type='button';if(c.icon){const i=document.createElement('img');i.className='icon';i.src=c.icon;b.append(i)}else{const i=document.createElement('span');i.className='fallback';b.append(i)}const l=document.createElement('span');l.className='label';l.textContent=c.title;b.append(l);const s=document.createElement('span');s.className='state';s.textContent=c.current?'remove':'add';b.append(s);b.onpointerenter=()=>signal('peek',c.id);b.onpointerleave=()=>signal('peek-end');b.onclick=()=>{document.body.classList.add('busy');signal('select',c.id)};b.onauxclick=e=>{if(e.button!==1||!e.ctrlKey)return;e.preventDefault();document.body.classList.add('busy');signal('close',c.id)};list.append(b)}appendDragSpace()}
 window.__papersPickerUpdate=(next)=>{all=next;document.body.classList.remove('busy');render()};
const setExclusiveFilter=(selected,other)=>{if(selected.checked)other.checked=false;render()};const cancel=()=>signal('cancel');document.querySelector('.close').onclick=cancel;document.querySelector('.direct-pick').onclick=()=>{document.body.classList.add('busy');signal('direct-pick')};search.oninput=render;currentFilter.onchange=()=>setExclusiveFilter(currentFilter,availableFilter);availableFilter.onchange=()=>setExclusiveFilter(availableFilter,currentFilter);document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel()}else if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('.row')?.focus()}});render();search.focus();
</script>`;
      return new Promise<{ action: 'select' | 'close' | 'cancel' | 'direct-pick'; candidateId: string | null }>((resolve) => {
        const pickerOpenedAt = Date.now();
        let pickerPointerEntered = false;
        let pickerOutsideSince: number | null = null;
        let pickerPointerWatch: NodeJS.Timeout | null = null;
        let pickerShowAnimation: NodeJS.Timeout | null = null;
        let peekGeneration = 0;
        let peekTimer: NodeJS.Timeout | null = null;
        let peekEndTimer: NodeJS.Timeout | null = null;
        let candidatePeekUsesLivePreview = false;
        const nativeHandle = picker.getNativeWindowHandle();
        const callerHwnd = nativeHandle.length >= 8
          ? nativeHandle.readBigUInt64LE(0).toString()
          : String(nativeHandle.readUInt32LE(0));
        const endCandidatePeek = (): void => {
          peekGeneration += 1;
          if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          if (candidatePeekUsesLivePreview && windowCapabilityService.endLivePreview) {
            candidatePeekUsesLivePreview = false;
            void windowCapabilityService.endLivePreview().catch(() => undefined);
          } else {
            void windowCapabilityService.endPeek().catch(() => undefined);
          }
        };
        const beginCandidatePeek = (candidateId: string): void => {
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          if (peekTimer) clearTimeout(peekTimer);
          const generation = ++peekGeneration;
          peekTimer = setTimeout(() => {
            peekTimer = null;
            void windowCapabilityService.bindCandidate(candidateId).then(async (bound) => {
              if (generation !== peekGeneration || bound.outcome !== 'success') return;
              const live = windowCapabilityService.beginLivePreviewCapability
                ? await windowCapabilityService.beginLivePreviewCapability(bound.capability, callerHwnd).catch(() => null)
                : null;
              if (live?.outcome === 'success') candidatePeekUsesLivePreview = true;
              // Never fall back to hide/show. A failed DWM preview should be a
              // quiet no-op, not a cascade that flashes every other window.
              if (generation !== peekGeneration) {
                if (candidatePeekUsesLivePreview && windowCapabilityService.endLivePreview) {
                  candidatePeekUsesLivePreview = false;
                  void windowCapabilityService.endLivePreview().catch(() => undefined);
                } else {
                  void windowCapabilityService.endPeek().catch(() => undefined);
                }
              }
            });
          }, 32);
        };
        const deferCandidatePeekEnd = (): void => {
          if (peekEndTimer) clearTimeout(peekEndTimer);
          peekEndTimer = setTimeout(endCandidatePeek, 80);
        };
        const session: CandidatePickerSession = {
          window: picker,
          candidateIds: new Set(candidates.map((candidate) => candidate.id)),
          resolve,
        };
        candidatePickerSessions.set(sender.id, session);
        const finishAction = (action: 'select' | 'close', candidateId: string): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker || !current.resolve) return;
          endCandidatePeek();
          const settle = current.resolve;
          current.resolve = null;
          settle({ action, candidateId });
        };
        const finishDirectPick = (): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker || !current.resolve) return;
          endCandidatePeek();
          const settle = current.resolve;
          current.resolve = null;
          settle({ action: 'direct-pick', candidateId: null });
          // Backpack owns the transition: it closes this chooser only after
          // receiving the typed result and before starting direct pick.
        };
        const closePicker = (): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker) return;
          candidatePickerSessions.delete(sender.id);
          endCandidatePeek();
          const settle = current.resolve;
          current.resolve = null;
          settle?.({ action: 'cancel', candidateId: null });
          if (!picker.isDestroyed()) picker.destroy();
        };
        sender.once('destroyed', closePicker);
        // Renderer mouseleave is unreliable over -webkit-app-region:drag:
        // Chromium can report the lower drag-space as outside even while the
        // native pointer remains within this BrowserWindow. Use native screen
        // bounds instead. A short initial bridge lets the pointer travel from
        // the hover opener into the chooser; after entry, only leaving the
        // actual native window for a bounded interval closes it.
        pickerPointerWatch = setInterval(() => {
          if (picker.isDestroyed()) return;
          const point = screen.getCursorScreenPoint();
          const bounds = picker.getBounds();
          const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width
            && point.y >= bounds.y && point.y < bounds.y + bounds.height;
          if (inside) {
            pickerPointerEntered = true;
            pickerOutsideSince = null;
            return;
          }
          const now = Date.now();
          if (!pickerPointerEntered && now - pickerOpenedAt < 650) return;
          pickerOutsideSince ??= now;
          if (now - pickerOutsideSince >= 140) closePicker();
        }, 40);
        pickerPointerWatch.unref?.();
        const handlePickerUrl = (target: string): void => {
          try {
            const url = new URL(target);
            if (url.host === 'papers-picker.invalid' && url.pathname === '/cancel') { closePicker(); return; }
            if (url.host === 'papers-picker.invalid' && url.pathname === '/direct-pick') { finishDirectPick(); return; }
            if (url.host === 'papers-picker.invalid' && url.pathname === '/peek-end') { deferCandidatePeekEnd(); return; }
            if (url.host === 'papers-picker.invalid' && url.pathname.startsWith('/peek/')) {
              const candidateId = decodeURIComponent(url.pathname.slice('/peek/'.length));
              if (session.candidateIds.has(candidateId)) beginCandidatePeek(candidateId);
              return;
            }
            if (url.host !== 'papers-picker.invalid') return;
            const action = url.pathname.startsWith('/select/') ? 'select'
              : url.pathname.startsWith('/close/') ? 'close' : null;
            if (!action) return;
            const candidateId = decodeURIComponent(url.pathname.slice(`/${action}/`.length));
            if (session.candidateIds.has(candidateId)) finishAction(action, candidateId);
          } catch { /* malformed navigation is ignored */ }
        };
        picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const pickerSignal = (event: Electron.IpcMainEvent, raw: unknown): void => {
          if (event.sender.id !== picker.webContents.id || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
          const record = raw as Record<string, unknown>;
          if (Object.keys(record).some((key) => key !== 'action' && key !== 'candidateId')) return;
          const action = record.action;
          const candidateId = record.candidateId;
          if (typeof action !== 'string' || !['select', 'close', 'cancel', 'peek', 'peek-end', 'direct-pick'].includes(action)) return;
          if (typeof candidateId !== 'string' || Buffer.byteLength(candidateId, 'utf8') > 512) return;
          handlePickerUrl(`https://papers-picker.invalid/${action}${candidateId ? `/${encodeURIComponent(candidateId)}` : ''}`);
        };
        ipcMain.on('papers:candidate-picker:signal', pickerSignal);
        picker.webContents.on('will-navigate', (event, target) => {
          event.preventDefault();
          handlePickerUrl(target);
        });
        picker.webContents.on('before-input-event', (event, input) => {
          if (input.key === 'Escape') { event.preventDefault(); closePicker(); }
        });
        picker.once('closed', () => {
          if (pickerPointerWatch) { clearInterval(pickerPointerWatch); pickerPointerWatch = null; }
          if (pickerShowAnimation) { clearInterval(pickerShowAnimation); pickerShowAnimation = null; }
          ipcMain.removeListener('papers:candidate-picker:signal', pickerSignal);
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker) return;
          candidatePickerSessions.delete(sender.id);
          endCandidatePeek();
          const settle = current.resolve;
          current.resolve = null;
          settle?.({ action: 'cancel', candidateId: null });
        });
        picker.once('ready-to-show', () => {
          if (picker.isDestroyed()) return;
          const finalBounds = picker.getBounds();
          const startY = Math.min(area.y + area.height - finalBounds.height, finalBounds.y + 12);
          picker.setPosition(finalBounds.x, startY, false);
          picker.setOpacity(0);
          picker.show();
          picker.focus();
          const startedAt = Date.now();
          pickerShowAnimation = setInterval(() => {
            if (picker.isDestroyed()) return;
            const progress = Math.min(1, (Date.now() - startedAt) / 120);
            const eased = 1 - ((1 - progress) ** 3);
            const animatedY = Math.round(startY + ((finalBounds.y - startY) * eased));
            picker.setPosition(finalBounds.x, animatedY, false);
            picker.setOpacity(Math.max(0.01, eased));
            if (progress >= 1 && pickerShowAnimation) {
              clearInterval(pickerShowAnimation);
              pickerShowAnimation = null;
              picker.setPosition(finalBounds.x, finalBounds.y, false);
              picker.setOpacity(1);
            }
          }, 16);
          pickerShowAnimation.unref?.();
        });
        void picker.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`).catch(() => closePicker());
      });
    },
    showPreview: (sender, preview) => {
      hideWidgetPreview(sender.id);
      const pad = 4;
      const titleHeight = 24;
      const width = preview.width + (pad * 2);
      const height = preview.height + titleHeight + (pad * 2);
      const display = screen.getDisplayMatching({
        x: Math.round(preview.anchor.x),
        y: Math.round(preview.anchor.y),
        width: Math.max(1, Math.round(preview.anchor.width)),
        height: Math.max(1, Math.round(preview.anchor.height)),
      });
      const area = display.workArea;
      let x = Math.round(preview.anchor.x + (preview.anchor.width / 2) - (width / 2));
      // Position relative to the WHOLE widget, not the hovered icon/name card.
      // At the screen top the fallback begins below the widget's bottom edge,
      // so the name surface can never sit over the preview.
      const owner = BrowserWindow.fromWebContents(sender);
      const ownerBounds = owner && !owner.isDestroyed()
        ? owner.getBounds()
        : { x: preview.anchor.x, y: preview.anchor.y, width: preview.anchor.width, height: preview.anchor.height };
      let y = Math.round(ownerBounds.y - height - 8);
      if (y < area.y) y = Math.round(ownerBounds.y + ownerBounds.height + 8);
      x = Math.max(area.x, Math.min(area.x + area.width - width, x));
      y = Math.max(area.y, Math.min(area.y + area.height - height, y));
      const previewWindow = new BrowserWindow({
        x, y, width, height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        focusable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        hasShadow: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      widgetPreviewWindows.set(sender.id, previewWindow);
      previewWindow.setIgnoreMouseEvents(true);
      previewWindow.setAlwaysOnTop(true, 'floating');
      previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      previewWindow.on('closed', () => {
        if (widgetPreviewWindows.get(sender.id) === previewWindow) widgetPreviewWindows.delete(sender.id);
      });
      sender.once('destroyed', () => hideWidgetPreview(sender.id));
      const safeTitle = preview.title
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      const html = `<!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
        .preview{box-sizing:border-box;margin:${pad}px;width:${preview.width}px;height:${preview.height + titleHeight}px;
          border:1px solid rgba(140,132,116,.72);border-radius:7px;overflow:hidden;
          background:#26231f;box-shadow:0 3px 10px rgba(0,0,0,.38);
          animation:rise 180ms cubic-bezier(.2,.8,.2,1) both}
        .title{box-sizing:border-box;height:${titleHeight}px;padding:5px 7px;color:#eee9df;
          font:11px/14px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        img{display:block;width:${preview.width}px;height:${preview.height}px;object-fit:contain;background:#26231f}
        @keyframes rise{from{transform:translateY(12px)}to{transform:translateY(0)}}
      </style><div class="preview"><div class="title">${safeTitle}</div><img src="${preview.imageUrl}" alt=""></div>`;
      void previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        if (!previewWindow.isDestroyed()) previewWindow.showInactive();
      }).catch(() => hideWidgetPreview(sender.id));
    },
    isWorkspaceSender: (sender, projectId) => {
      if (!runtimeForSender(sender.id)?.isSender(sender)) return false;
      try {
        return new URL(sender.mainFrame.url).host === projectId;
      } catch {
        return false;
      }
    },
    isWidgetSender: (sender, projectId) => {
      const surface = widgetRegistry.surface(sender.id);
      if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || surface.projectId !== projectId) return false;
      try {
        const origin = new URL(sender.mainFrame.url);
        return origin.protocol === 'papers-backpack:' && origin.host === projectId;
      } catch {
        return false;
      }
    },
  });
  // Best-effort owned shutdown before app exit; the helper factory stop
  // owns stdin close, termination escalation and exactly-once terminal
  // reporting (Assignment 015).
  let capabilityQuitComplete = false;
  let capabilityQuitPromise: Promise<void> | null = null;
  app.on('before-quit', (event) => {
    if (capabilityQuitComplete) return;
    event.preventDefault();
    if (!capabilityQuitPromise) {
      const detachClose = detachSession!.closeAll().catch(() => undefined);
      const widgetClose = widgetSession!.closeAll().catch(() => undefined);
      windowPickSession.cancel().catch(() => undefined);
      capabilityQuitPromise = Promise.all([detachClose, widgetClose, windowCapabilityService.stop().catch(() => undefined)]).then(() => {
        hermesSurface.shutdown();
        capabilityQuitComplete = true;
        app.quit();
      });
    }
  });
  registerProgramIpc({
    runtime,
    canvasState,
    broker,
    stateService,
    emitSaveStatus: (status, detail) => facade.emitSaveStatus(status, detail),
    agentInvoke: (identity, invocation) =>
      runService.invoke(identity.backpackId, identity.programId, invocation),
    agentCancel: async (identity, runId) => {
      const run = runService.get(runId);
      if (!run) throw new Error(`run ${runId} not found`);
      if (run.programId !== identity.programId || run.backpackId !== identity.backpackId) {
        throw new Error('programs may only cancel their own runs');
      }
      await runService.cancel(runId);
    },
  });

  // Surface registry corruption honestly on startup.
  if (registryReport.corruptionDetail) {
    hostView.webContents.once('did-finish-load', () => {
      facade.emitBackpacksChanged();
      hostView?.webContents.send('host:event:host-error', {
        component: 'BackpackRegistry',
        what: 'The Backpack registry file was corrupt.',
        known: `Detail: ${registryReport.corruptionDetail}. Source used: ${registryReport.source}.`,
        intact:
          registryReport.source === 'backup'
            ? 'The previous good registry was restored from backup.'
            : 'A fresh registry was created; the corrupt file was quarantined in PapersData/recovery.',
        retryUseful: false,
        inspect: `See ${registryReport.quarantinedPath ?? 'PapersData/recovery'}.`,
        recover: 'Recreate any missing Backpacks; program state remains on disk.',
      });
    });
  }

  // ACP is retained only for the opt-in legacy integration fixtures. The
  // production UI never recreates Hermes sessions or approvals inside Papers.
  if (fixtureMode) {
    void adapter.connect().catch(() => {
      /* health event carries the fixture failure detail */
    });
  }

  // ---------------------------------------------------------------- load UI
  await preparedWindow.loadAndRollback();

  // Look for a newer Papers once the interface is up. Silent unless a real
  // update is downloaded and ready; a packaged build only.
  updater.start();

  // The detached updater writes one result before it reopens Papers. Success is
  // a quiet native notification; failure is kept visible in Papers with the log
  // path so a non-coder never has to inspect a terminal to understand it.
  const updateResultPath = path.join(baseDir, 'hermes-update-result.json');
  if (existsSync(updateResultPath)) {
    try {
      const result = JSON.parse(readFileSync(updateResultPath, 'utf8')) as {
        ok?: boolean;
        detail?: string;
        logPath?: string;
      };
      unlinkSync(updateResultPath);
      if (result.ok) {
        new Notification({
          title: 'Hermes updated',
          body: result.detail ?? 'Hermes and its Papers integration are ready.',
        }).show();
      } else {
        hostView.webContents.send('host:event:host-error', {
          component: 'hermes',
          what: 'Hermes did not finish updating.',
          known: result.detail ?? 'The update helper reported an unknown error.',
          intact: 'Your conversations, settings, credentials and Backpacks were not changed.',
          retryUseful: true,
          inspect: result.logPath ? `Update log: ${result.logPath}` : 'See the Papers Data folder.',
          recover: 'Open Hermes again and retry the update from its Settings page.',
        });
      }
    } catch {
      // A malformed status file must never prevent Papers from starting.
    }
  }

  // Start the phone connector ("Run on Computer") so the Apers Android app can
  // auto-discover this PC on the LAN and run tasks on the same Hermes. Best
  // effort, own single-instance, decoupled from the Hermes Desktop surface.
  startPhoneConnector();

  // Per-window close/finalize ownership is installed by preparePapersWindow;
  // bootstrap only retains these aliases for primary/fixture compatibility.
}

app.whenReady().then(() => {
  if (hermesUpdateHelperMode) {
    return runHermesUpdateHelper().catch((err) => {
      console.error('[papers] Hermes update helper failed:', err);
      app.quit();
    });
  }
  return bootstrap().catch((err) => {
    // Surface bootstrap failures instead of dying silently.
    console.error('[papers] bootstrap failed:', err);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Refuse any webContents the app did not explicitly create from acting up.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
