/**
 * Papers 3 — Electron main process bootstrap and composition root.
 */
import { BaseWindow, WebContentsView, app, session } from 'electron';
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

// Test harnesses point userData at a disposable directory so creator data is
// never touched by fixtures (plan section 27).
if (process.env['PAPERS_TEST_USER_DATA']) {
  app.setPath('userData', process.env['PAPERS_TEST_USER_DATA']);
}

// Papers is a single-instance application (except under isolated test homes).
if (!process.env['PAPERS_TEST_USER_DATA'] && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BaseWindow | null = null;
let hostView: WebContentsView | null = null;

async function bootstrap(): Promise<void> {
  const baseDir = app.getPath('userData');
  const paths = papersPaths(baseDir);

  const registry = new BackpackRegistry(baseDir);
  const registryReport = await registry.initialize();

  const permissionStore = new PermissionStore(paths);
  await permissionStore.initialize();

  const programsRoot = defaultProgramsRoot(app.getAppPath(), app.isPackaged, process.resourcesPath);
  let catalog: ProgramCatalog = await loadProgramCatalog(programsRoot);

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
    title: 'Papers 3',
    backgroundColor: '#14161a',
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
  });

  const facade = new PapersHostFacade({
    hostContents: () => hostView?.webContents ?? null,
    registry,
    runtime,
    canvasState,
    catalog: () => catalog,
    permissionStore,
    adapter,
    runService: () => runService,
    paths,
  });

  registerCoreExecutors({ broker, paths, facade, stateService });
  const gitService = new GitService();
  const resourceService = new ResourceService(paths);
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

  // Connect to Hermes in the background; the app is usable without it.
  void adapter.connect().catch(() => {
    /* health event carries the failure detail */
  });

  // ---------------------------------------------------------------- load UI
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    await hostView.webContents.loadURL(devUrl);
  } else {
    await hostView.webContents.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    hostView = null;
  });
}

app.whenReady().then(() =>
  bootstrap().catch((err) => {
    // Surface bootstrap failures instead of dying silently.
    console.error('[papers3] bootstrap failed:', err);
  }),
);

app.on('window-all-closed', () => {
  app.quit();
});

// Refuse any webContents the app did not explicitly create from acting up.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
