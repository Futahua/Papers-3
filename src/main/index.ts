/**
 * Papers — Electron main process bootstrap and composition root.
 */
import { BaseWindow, Menu, Notification, WebContentsView, app, ipcMain, session, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
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
import { createWindowCapabilityService } from './windows/windowCapabilityService';
import { papersPaths } from './persistence/paths';
import { ProgramStateService } from './persistence/programStateService';
import { AtomicJsonStore } from './persistence/atomicStore';
import {
  OPAQUE_SURFACE_COLOR,
  TRANSPARENT_CHILD_SURFACE_COLOR,
  TRANSPARENT_SURFACE_COLOR,
} from './windowSurface';
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
  mainWindow = new BaseWindow({
    width: 1360,
    height: 860,
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
  const backpackProjectRuntime = new BackpackProjectRuntime(
    mainWindow,
    path.join(preloadDir, 'backpackProject.cjs'),
    papersSettings.transparentWindow,
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

  const facade = new PapersHostFacade({
    hostContents: () => hostView?.webContents ?? null,
    updater,
    registry,
    backpackProjects,
    isBackpackProjectSender: (sender) => backpackProjectRuntime.isSender(sender),
    showBackpackProjectSurface: (url) => backpackProjectRuntime.show(url),
    hideBackpackProjectSurface: () => backpackProjectRuntime.hide(),
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
    isSender: (sender) => backpackProjectRuntime.isSender(sender),
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
      capabilityQuitPromise = windowCapabilityService.stop().catch(() => undefined).then(() => {
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

  mainWindow.on('closed', () => {
    backpackProjectRuntime.hide();
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
