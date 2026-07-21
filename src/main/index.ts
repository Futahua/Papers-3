/**
 * Papers — Electron main process bootstrap and composition root.
 */
import { BaseWindow, WebContentsView, app, session } from 'electron';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

import { BackpackRegistry } from './backpacks/backpackRegistry';
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
import { ResourceService } from './resources/resourceService';
import { registerResourceExecutors } from './resources/resourceExecutors';
import { AgentRunService } from './agents/runService';
import { PapersHostFacade } from './hostFacade';
import { registerHostIpc } from './ipc/hostIpc';
import { registerProgramIpc } from './ipc/programIpc';
import { papersPaths } from './persistence/paths';
import { ProgramStateService } from './persistence/programStateService';
import {
  installProgramProtocolHandler,
  registerProgramSchemePrivileges,
} from './security/programScheme';

registerProgramSchemePrivileges();

app.setName('Papers');

// Keep every Papers-owned runtime file off C:. The packaged application lives
// in <Papers>/App and stores persistent state in <Papers>/Data, leaving one
// self-contained Papers master folder. Tests and development remain isolated.
if (process.env['PAPERS_TEST_USER_DATA']) {
  app.setPath('userData', process.env['PAPERS_TEST_USER_DATA']);
} else {
  const papersDataDir = app.isPackaged
    ? path.resolve(path.dirname(process.execPath), '..', 'Data')
    : path.join(app.getAppPath(), '.papers-dev-data');
  mkdirSync(papersDataDir, { recursive: true });
  app.setPath('userData', papersDataDir);
}

// Papers is a single-instance application (except under isolated test homes).
if (!process.env['PAPERS_TEST_USER_DATA'] && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BaseWindow | null = null;
let hostView: WebContentsView | null = null;

/** Width of the Papers top bar band the docked Hermes window sits below. */
const TOP_BAR_HEIGHT = 48;
/** Fraction of Papers width the docked Hermes sidebar occupies (clamped). */
const DOCK_WIDTH_FRACTION = 0.4;
const DOCK_MIN_WIDTH = 380;
const DOCK_MAX_WIDTH = 620;

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

  const registry = new BackpackRegistry(baseDir);
  const registryReport = await registry.initialize();

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

  // ------------------------------------------------------------------ window
  mainWindow = new BaseWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Papers',
    backgroundColor: '#efede7',
  });

  const preloadDir = path.join(app.getAppPath(), 'out', 'preload');
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
  const fitHost = (): void => {
    if (!mainWindow || !hostView) return;
    const { width, height } = mainWindow.getContentBounds();
    hostView.setBounds({ x: 0, y: 0, width, height });
  };
  fitHost();
  mainWindow.on('resize', fitHost);

  // The production Hermes experience IS the existing Hermes Desktop product.
  // Papers runs one Hermes backend and positions the real Hermes Desktop
  // window as a docked sidebar or a detached window — never a second chat UI.
  const hermesSurface = new HermesSurface(mainWindow, (state) => {
    hostView?.webContents.send('host:event:hermes-surface', state);
  });

  // Keep a docked Hermes window aligned to Papers as it moves or resizes.
  const realignHermesDock = (): void => {
    if (!mainWindow) return;
    const { width } = mainWindow.getContentBounds();
    hermesSurface.setDockBounds(dockBoundsFor(width));
  };
  mainWindow.on('resize', realignHermesDock);
  mainWindow.on('move', realignHermesDock);

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

  const facade = new PapersHostFacade({
    hostContents: () => hostView?.webContents ?? null,
    registry,
    runtime,
    canvasState,
    catalog: () => catalog,
    permissionStore,
    adapter,
    hermesSurface,
    runService: () => runService,
    paths,
  });

  registerCoreExecutors({ broker, paths, facade, stateService });
  registerResourceExecutors({ broker, resources: resourceService, git: gitService, paths });
  registerExternalExecutors({ broker, resources: resourceService });

  adapter.on('health-changed', () => facade.emitHermesHealth());

  registerHostIpc(facade);
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

  mainWindow.on('closed', () => {
    hermesSurface.shutdown();
    mainWindow = null;
    hostView = null;
  });
}

app.whenReady().then(() =>
  bootstrap().catch((err) => {
    // Surface bootstrap failures instead of dying silently.
    console.error('[papers] bootstrap failed:', err);
  }),
);

app.on('window-all-closed', () => {
  app.quit();
});

// Refuse any webContents the app did not explicitly create from acting up.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
