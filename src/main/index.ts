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
import { registerHostIpc } from './ipc/hostIpc';
import { registerProgramIpc } from './ipc/programIpc';
import { registerWindowCapabilityIpc } from './ipc/windowCapabilityIpc';
import { registerWindowPickIpc } from './ipc/windowPickIpc';
import { registerWindowDetachIpc } from './ipc/windowDetachIpc';
import { registerCompactWidgetIpc } from './ipc/compactWidgetIpc';
import { BackpackSurfaceRegistry, DETACHED_SURFACE_KIND, COMPACT_WIDGET_SURFACE_KIND, isAllowedProjectSurfaceSender } from './backpacks/backpackSurfaceRegistry';
import { createWindowCapabilityService } from './windows/windowCapabilityService';
import { createSlopTopPickerSession } from './windows/slopTopPickerProtocol';
import { createWindowDetachSession, isAllowedDetachedNavigation, type WindowDetachSession } from './windows/windowDetachSession';
import {
  createCompactWidgetSession,
  COMPACT_WIDGET_MIN_WIDTH,
  COMPACT_WIDGET_MIN_HEIGHT,
  type CompactWidgetSession,
} from './windows/compactWidgetSession';
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
let hostView: WebContentsView | null = null;

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
function dockBoundsFor(contentWidth: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(contentWidth * DOCK_WIDTH_FRACTION)));
  const height = Math.max(
    400,
    Math.round((mainWindow?.getContentBounds().height ?? 860) - TOP_BAR_HEIGHT),
  );
  return { x: Math.max(0, contentWidth - width), y: TOP_BAR_HEIGHT, width, height };
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

  mainWindow = new BaseWindow({
    ...(savedBounds ?? { width: 1360, height: 860 }),
    minWidth: 900,
    minHeight: 600,
    title: 'Papers',
    frame: !papersSettings.transparentWindow,
    transparent: papersSettings.transparentWindow,
    backgroundColor: papersSettings.transparentWindow ? TRANSPARENT_SURFACE_COLOR : '#efede7',
    ...(appIcon ? { icon: appIcon } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // The native overlay is a painted Windows region, not a composited page
      // surface. Keep it opaque and theme-matched even when the rest of the
      // window is transparent; Electron/Windows does not reliably preserve a
      // zero-alpha overlay colour and can expose its channel payload as cyan.
      color: '#efede7',
      symbolColor: '#20201e',
      height: TITLE_BAR_HEIGHT,
    },
  });

  const preloadDir = path.join(app.getAppPath(), 'out', 'preload');
  const detachRegistry = new BackpackSurfaceRegistry();
  let detachSession: WindowDetachSession | null = null;
  const widgetRegistry = new BackpackSurfaceRegistry();
  let widgetSession: CompactWidgetSession | null = null;
  const backpackProjectRuntime = new BackpackProjectRuntime(
    mainWindow,
    path.join(preloadDir, 'backpackProject.cjs'),
    papersSettings.transparentWindow,
    (projectId) => {
      detachSession?.closeProject(projectId).catch(() => undefined);
      detachRegistry.unregisterWorkspaceForProject(projectId);
      widgetSession?.closeProject(projectId).catch(() => undefined);
      widgetRegistry.unregisterAllForProject(projectId);
    },
  );
  hostView = new WebContentsView({
    webPreferences: {
      preload: path.join(preloadDir, 'host.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.contentView.addChildView(hostView);
  const applyHostSurface = (transparent: boolean): void => {
    // The host view is a child surface: its zero alpha is not honoured, so a
    // white RGB payload paints literally and every transparent page above it
    // reads as a white panel. Verified over CDP — with the whole DOM computing
    // rgba(0,0,0,0), the canvas was still white until this base changed.
    const color = transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR;
    hostView?.setBackgroundColor(color);
  };
  applyHostSurface(papersSettings.transparentWindow);
  const fitHost = (): void => {
    if (!mainWindow || !hostView) return;
    const { width, height } = mainWindow.getContentBounds();
    hostView.setBounds({ x: 0, y: 0, width, height });
  };
  fitHost();
  mainWindow.on('resize', fitHost);
  mainWindow.on('resize', () => backpackProjectRuntime.fit());

  // The production Hermes experience IS the existing Hermes Desktop product.
  // Papers runs one Hermes backend and positions the real Hermes Desktop
  // window as a docked sidebar or a detached window — never a second chat UI.
  const hermesSurface = new HermesSurface(mainWindow, (state) => {
    hostView?.webContents.send('host:event:hermes-surface', state);
  });

  // Keep a docked Hermes window aligned to Papers as it moves or resizes.
  // setDockBounds also raises Hermes above Papers (non-topmost) so it follows
  // Papers to the front without becoming globally always-on-top.
  const realignHermesDock = (): void => {
    if (!mainWindow) return;
    const { width } = mainWindow.getContentBounds();
    hermesSurface.setDockBounds(dockBoundsFor(width));
  };
  mainWindow.on('resize', realignHermesDock);
  mainWindow.on('move', realignHermesDock);
  // When Papers is activated, raise the docked Hermes above it (moveTop), so
  // clicking Papers keeps the pair together — but only via non-topmost raise, so
  // switching to another application leaves both windows ordinary.
  mainWindow.on('focus', () => hermesSurface.onPapersActivated());

  hostView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hostView.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const allowedPrefix = devUrl ?? 'file://';
    if (!url.startsWith(allowedPrefix)) event.preventDefault();
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

  const updater = new PapersUpdater(() => hostView?.webContents ?? null);
  const isProjectSurfaceSender = (sender: WebContents): boolean =>
    isAllowedProjectSurfaceSender({
      senderId: sender.id,
      url: sender.mainFrame.url,
      isWorkspaceSender: backpackProjectRuntime.isSender(sender),
      detachRegistry,
      widgetRegistry,
    });

  const facade = new PapersHostFacade({
    hostContents: () => hostView?.webContents ?? null,
    updater,
    registry,
    backpackProjects,
    isBackpackProjectSender: isProjectSurfaceSender,
    showBackpackProjectSurface: (url) => backpackProjectRuntime.show(url),
    hideBackpackProjectSurface: () => {
      windowPickSession.cancel().catch(() => undefined);
      backpackProjectRuntime.hide();
    },
    runtime,
    canvasState,
    catalog: () => catalog,
    permissionStore,
    adapter,
    hermesSurface,
    runService: () => runService,
    paths,
    setTitleBarOverlay: (color, symbolColor) => {
      // Repaint the native window controls to match the active Papers theme.
      mainWindow?.setTitleBarOverlay?.({ color, symbolColor, height: TITLE_BAR_HEIGHT });
      // Keep the surrounding window background in step so a theme switch has no
      // flash of the old colour behind the controls.
      const windowSurfaceColor = papersSettings.transparentWindow ? TRANSPARENT_SURFACE_COLOR : color;
      mainWindow?.setBackgroundColor(windowSurfaceColor);
      applyHostSurface(papersSettings.transparentWindow);
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
      backpackProjectRuntime.setTransparent(enabled);
    },
    saveWindowBounds: async () => {
      // getBounds(), not getContentBounds(): the saved rectangle is restored
      // through the BaseWindow constructor, which takes outer window bounds.
      const bounds = mainWindow?.getBounds();
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
  const windowCapabilityService = createWindowCapabilityService();
  registerWindowCapabilityIpc({
    ipcMain,
    service: windowCapabilityService,
    isSender: isProjectSurfaceSender,
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
    sendToWorkspace: (projectId, channel, payload) => {
      const workspace = detachRegistry.surfaceForProject(projectId, 'workspace');
      if (!workspace) return false;
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
    createWindow: ({ bounds, preloadPath: detachedPreloadPath, projectId }) => {
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
      return detachedWindow;
    },
    // Cancelling the 016 pick when a registered surface goes away is safe:
    // cancel is a no-op when no session is active.
    onSurfaceClosed: () => {
      windowPickSession.cancel().catch(() => undefined);
    },
  });
  detachSession!.registerDetachIpc();
  registerWindowDetachIpc({
    ipcMain,
    registry: detachRegistry,
    session: detachSession!,
    isWorkspaceSender: (sender, projectId) => {
      if (!backpackProjectRuntime.isSender(sender)) return false;
      try {
        return new URL(sender.mainFrame.url).host === projectId;
      } catch {
        return false;
      }
    },
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
    resolveEntryUrl: (sender, projectId) => backpackProjectRuntime.entryUrlFor(sender, projectId),
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
    resolveEntryUrl: (projectId) => backpackProjectRuntime.entryUrlForProject(projectId),
    createWindow: ({ bounds, preloadPath: widgetPreloadPath, projectId }) => {
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
    resolve: ((result: { action: 'select' | 'close' | 'cancel'; candidateId: string | null }) => void) | null;
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
        return new Promise<{ action: 'select' | 'close' | 'cancel'; candidateId: string | null }>((resolve) => {
          // The Backpack requests the next choice only after the previous one
          // settled. Fail closed if a malformed caller overlaps requests.
          active.resolve?.({ action: 'cancel', candidateId: null });
          active.resolve = resolve;
        });
      }
      const owner = BrowserWindow.fromWebContents(sender);
      const cursor = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const width = Math.min(420, area.width);
      const height = Math.min(440, area.height);
      const x = Math.max(area.x, Math.min(area.x + area.width - width, cursor.x - Math.round(width / 2)));
      const y = Math.max(area.y, Math.min(area.y + area.height - height, cursor.y - 36));
      const picker = new BrowserWindow({
        ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
        x, y, width, height,
        frame: false,
        resizable: true,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        backgroundColor: '#161b22',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      picker.setAlwaysOnTop(true, 'pop-up-menu');
      const encoded = JSON.stringify(candidates).replace(/</g, '\\u003c');
      const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
 *{box-sizing:border-box}html,body{margin:0;height:100%;background:#161b22;color:#dbe7f3;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}body{border:1px solid #465462;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 14px 38px #0009}.head{padding:13px 13px 10px;border-bottom:1px solid #2b3742}.titleline{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.title{font-weight:650}.close{border:0;background:transparent;color:#9cacba;font-size:19px;line-height:20px;border-radius:5px;cursor:pointer}.close:hover{background:#31404b;color:#fff}.search{width:100%;height:34px;border:1px solid #536372;border-radius:8px;background:#0e141a;color:#f3f8fc;padding:0 11px;outline:none}.search:focus{border-color:#72a7d5;box-shadow:0 0 0 2px #72a7d533}.list{padding:7px;overflow:auto;flex:1;scrollbar-color:#4b5b68 transparent;-webkit-app-region:drag}.row,.empty{ -webkit-app-region:no-drag}.row{width:100%;border:0;background:transparent;color:inherit;display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border-radius:8px;text-align:left;cursor:pointer}.row:hover,.row:focus-visible{background:#273540;outline:none}.busy .row{pointer-events:none;opacity:.68}.icon{width:20px;height:20px;object-fit:contain}.fallback{width:16px;height:16px;border:1px solid #83919d;border-radius:3px}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state{font-size:11px;color:#8fb1cb}.current .state{color:#ef9c77}.empty{padding:24px;text-align:center;color:#8898a7}
</style><div class="head"><div class="titleline"><div class="title">Choose an onscreen window</div><button class="close" aria-label="Close">×</button></div><input class="search" type="search" placeholder="Search windows…" autocomplete="off" spellcheck="false"></div><div class="list"></div><script id="data" type="application/json">${encoded}</script><script>
 let all=JSON.parse(document.getElementById('data').textContent);const list=document.querySelector('.list'),search=document.querySelector('.search');
function signal(path,id=''){window.open('https://papers-picker.invalid/'+path+(id?'/'+encodeURIComponent(id):''),'_blank','noopener')}
 function render(){const q=search.value.trim().toLowerCase(),rows=all.filter(x=>x.title.toLowerCase().includes(q));list.replaceChildren();if(!rows.length){const e=document.createElement('div');e.className='empty';e.textContent='No matching windows';list.append(e);return}for(const c of rows){const b=document.createElement('button');b.className='row'+(c.current?' current':'');b.type='button';if(c.icon){const i=document.createElement('img');i.className='icon';i.src=c.icon;b.append(i)}else{const i=document.createElement('span');i.className='fallback';b.append(i)}const l=document.createElement('span');l.className='label';l.textContent=c.title;b.append(l);const s=document.createElement('span');s.className='state';s.textContent=c.current?'remove':'add';b.append(s);b.onpointerenter=()=>signal('peek',c.id);b.onpointerleave=()=>signal('peek-end');b.onclick=()=>{document.body.classList.add('busy');c.current=!c.current;render();signal('select',c.id)};b.onauxclick=e=>{if(e.button!==1||!e.ctrlKey)return;e.preventDefault();document.body.classList.add('busy');signal('close',c.id)};list.append(b)}}
 window.__papersPickerUpdate=(next)=>{all=next;document.body.classList.remove('busy');render()};
const cancel=()=>signal('cancel');document.querySelector('.close').onclick=cancel;search.oninput=render;document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel()}else if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('.row')?.focus()}});render();search.focus();
</script>`;
      return new Promise<{ action: 'select' | 'close' | 'cancel'; candidateId: string | null }>((resolve) => {
        let peekGeneration = 0;
        let peekTimer: NodeJS.Timeout | null = null;
        let peekEndTimer: NodeJS.Timeout | null = null;
        const endCandidatePeek = (): void => {
          peekGeneration += 1;
          if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          void windowCapabilityService.endPeek().catch(() => undefined);
        };
        const beginCandidatePeek = (candidateId: string): void => {
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          if (peekTimer) clearTimeout(peekTimer);
          const generation = ++peekGeneration;
          peekTimer = setTimeout(() => {
            peekTimer = null;
            void windowCapabilityService.bindCandidate(candidateId).then(async (bound) => {
              if (generation !== peekGeneration || bound.outcome !== 'success') return;
              await windowCapabilityService.beginPeekCapability(bound.capability).catch(() => undefined);
              if (generation !== peekGeneration) void windowCapabilityService.endPeek().catch(() => undefined);
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
        const handlePickerUrl = (target: string): void => {
          try {
            const url = new URL(target);
            if (url.host === 'papers-picker.invalid' && url.pathname === '/cancel') { closePicker(); return; }
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
        picker.webContents.setWindowOpenHandler(({ url }) => {
          handlePickerUrl(url);
          return { action: 'deny' };
        });
        picker.webContents.on('will-navigate', (event, target) => {
          event.preventDefault();
          handlePickerUrl(target);
        });
        picker.webContents.on('before-input-event', (event, input) => {
          if (input.key === 'Escape') { event.preventDefault(); closePicker(); }
        });
        picker.once('closed', () => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker) return;
          candidatePickerSessions.delete(sender.id);
          endCandidatePeek();
          const settle = current.resolve;
          current.resolve = null;
          settle?.({ action: 'cancel', candidateId: null });
        });
        picker.once('ready-to-show', () => { if (!picker.isDestroyed()) { picker.show(); picker.focus(); } });
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
      if (!backpackProjectRuntime.isSender(sender)) return false;
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
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    await hostView.webContents.loadURL(devUrl);
  } else {
    await hostView.webContents.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }

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

  // Detach the Backpack child surface before the BaseWindow is destroyed:
  // `closed` fires after native destruction, where removeChildView throws
  // "Object has been destroyed" (the cleanup landed there with the
  // transparent surfaces, bf15f93). `close` still runs while the window is
  // alive, and hide() is idempotent, so an earlier host-IPC hide followed
  // by this one is harmless. Post-destruction bookkeeping stays in `closed`.
  mainWindow.on('close', () => {
    backpackProjectRuntime.hide();
  });

  mainWindow.on('closed', () => {
    hermesSurface.shutdown();
    mainWindow = null;
    hostView = null;
  });
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
