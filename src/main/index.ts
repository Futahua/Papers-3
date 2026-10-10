import {consumeReloadWindows,createPapersReload,shouldFlushReloadSurface} from './windows/papersReload';
/**
 * Papers — Electron main process bootstrap and composition root.
 */
import { BaseWindow, BrowserWindow, Menu, Notification, WebContentsView, app, dialog, globalShortcut, ipcMain, nativeImage, net, protocol, screen, session, shell, webContents, type WebContents } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { BackpackRegistry } from './backpacks/backpackRegistry';
import { BackpackProjectService } from './backpacks/backpackProjectService';
import { createEverythingSearchBridge, resolveEverythingSearchBridgePaths } from './backpacks/everythingSearchBridge';
import { createFileCapabilityService, resolveDirectoryOpusRtPath, resolveLibreOfficePath } from './backpacks/fileCapabilityService';
import { FILE_PREVIEW_SCHEME, createFilePreviewProtocolHandler, createFilePreviewResourceRegistry } from './backpacks/filePreviewResources';
import { createPdfPreviewHostBridge } from './backpacks/pdfPreviewHostBridge';
import { createHtmlPreviewHostBridge } from './backpacks/htmlPreviewHostBridge';
import {createPaneBackpackPages,type PanePage} from './backpacks/paneBackpackPages';
import { createChromePaneBridge } from './backpacks/chromePaneBridge';
import { createWebBrowserHostBridge } from './backpacks/webBrowserHostBridge';
import { createRevitPreviewBridge, resolveRevitPreviewBridgeSourcePath } from './backpacks/revitPreviewBridge';
import { createShellThumbnailBridge, resolveShellThumbnailSourcePath } from './backpacks/shellThumbnailBridge';
import { createCalibrePreviewBridge } from './backpacks/calibrePreviewBridge';
import { createAutoCadPreviewBridge } from './backpacks/autoCadPreviewBridge';
import { createMlightCadPreviewBridge } from './backpacks/mlightCadPreviewBridge';
import { createPowerPointPreviewBridge } from './backpacks/powerPointPreviewBridge';
import { createLibreOfficeEditorBridge, resolveLibreOfficeEditorSourcePath } from './backpacks/libreOfficeEditorBridge';
import { createCapabilityRuntimeService } from './backpacks/capabilityRuntimeService';
import { createWindowsPreviewHandlerBridge, resolveWindowsPreviewHostSourcePath } from './backpacks/windowsPreviewHandlerBridge';
import { createLocalServiceBridge, loadLocalServiceDeclaration, type LocalServiceResponse } from './backpacks/localServiceBridge';
import { BackpackProjectRuntime } from './backpacks/backpackProjectRuntime';
import { BackpackProjectSurfaceCollection } from './backpacks/backpackProjectSurfaceCollection';
import { withProjectSurfaceKey } from './backpacks/projectSurfaceUrl';
import { CanvasRuntime, defaultProgramsRoot } from './canvas/canvasRuntime';
import { CanvasSessionState } from './canvas/canvasState';
import { loadProgramCatalog, type ProgramCatalog } from './canvas/programLoader';
import { CapabilityBroker } from './capabilities/capabilityBroker';
import { registerCoreExecutors } from './capabilities/coreExecutors';
import { PermissionStore } from './capabilities/permissionStore';
import { registerExternalExecutors } from './external/externalBridge';
import { GitService } from './git/gitService';
import { ResourceService } from './resources/resourceService';
import { registerResourceExecutors } from './resources/resourceExecutors';
import { PapersHostFacade } from './hostFacade';
import { PapersUpdater } from './papersUpdater';
import { createPapersControlEventHub, startPapersControlServer, type PapersControlEventHub, type PapersControlServer } from './control/papersControlServer';
import { papersDataDirArgument } from './papersDataDir';
import { createHash, randomUUID } from 'node:crypto';
import { createCandidatePickerDelivery, type CandidatePickerDeliveryResult } from './windows/candidatePickerDelivery';
import { DelegateWaveRelay, readConfigFromMachine } from './delegateWave/delegateWaveRelay';
import { registerHostIpc } from './ipc/hostIpc';
import { registerProgramIpc } from './ipc/programIpc';
import { registerWindowCapabilityIpc } from './ipc/windowCapabilityIpc';
import { registerWindowPickIpc } from './ipc/windowPickIpc';
import { registerWindowDetachIpc } from './ipc/windowDetachIpc';
import { registerCompactWidgetIpc } from './ipc/compactWidgetIpc';
import { registerVisualDiagnosticsIpc, resolveVisualDiagnosticTarget } from './ipc/visualDiagnosticsIpc';
import { registerVisualSemanticKeysIpc } from './ipc/visualSemanticKeysIpc';
import { registerPapersWindowIpc } from './ipc/papersWindowIpc';
import {swapPapersWindows} from './windows/papersWindowSwap';
import {savedPageDropFits,savedPageDropArea} from './windows/savedPageDrop';
import {closeWorkspaceSurface} from '@shared/workspaceTopology';
import { BackpackSurfaceRegistry, DETACHED_SURFACE_KIND, COMPACT_WIDGET_SURFACE_KIND, isAllowedProjectSurfaceSender, decideProjectSurfaceRequest } from './backpacks/backpackSurfaceRegistry';
import { createProjectSurfaceAuthorityBarrier } from './backpacks/projectSurfaceAuthorityBarrier';
import { controlBuildIdentity } from './buildIdentity';
import { createProcessInstanceIdentity, currentProcessInstanceSeed, type ProcessInstanceIdentity } from './visual/processIdentity';
import { attachVisualLifecycleMonitor, recordRendererVisualDiagnostic, visualConsoleLevel, type VisualLifecycleMonitor } from './visual/visualLifecycleMonitor';
import { createVisualDiagnosticBuffer, type VisualDiagnosticBuffer } from './visual/visualDiagnostics';
import { createVisualSemanticKeyRegistry, type VisualElementObservation, type VisualSemanticKeyRegistry } from '@shared/visualSemanticKeys';
import { attachVisualResourceMonitor, type VisualResourceMonitor } from './visual/visualResourceMonitor';
import { refreshCurrentVisualSemanticKeys } from './visual/visualSemanticObservationRefresh';
import { createVisualSurfaceObservationStore } from './visual/visualSurfaceObservationState';
import { createVisualArtifactStore, type VisualArtifactMetadata } from './visual/visualArtifactStore';
import { captureVisualSurface, computeVisualElementCropBounds } from './visual/visualCaptureService';
import { createVisualTimeline, visualTimelineContextForRecord, type VisualTimeline } from './visual/visualTimeline';
import { createVisualReport } from './visual/visualReport';
import { createVisualRendererFenceService } from './visual/visualRendererFence';
import { createVisualWindowNativeCaptureService } from './visual/visualWindowNativeCapture';
import { captureVisualWindow } from './visual/visualCaptureWindowService';
import { evaluateVisualAssertions, type VisualAssertion } from './visual/visualAssertions';
import { createVisualWaitService } from './visual/visualWait';
import { createLogicalSurfaceRegistry } from './windows/logicalSurfaceRegistry';
import { createPapersWindowRegistry } from './windows/papersWindowRegistry';
import {
  createDeferredCommandSurfaceOverlay,
  createGlobalInvoke,
  type DeferredCommandSurfaceOverlay,
  type GlobalInvoke,
  type GlobalInvokeRegistrationReport,
} from './windows/globalInvoke';
import { createAdoptedWindowDock } from './windows/adoptedWindowDockSession';
import {
  createManifestDeclarationReader,
  createCommandSurfaceRegistry,
  readProjectControlRecord,
  type CommandSurfaceRegistry,
} from './backpacks/commandSurfaceRegistry';
import { createLauncherNominationStore } from './backpacks/launcherNominationStore';
import { bringFirstWindowToFront, bringWindowToFront } from './windows/windowFront';
import { defaultWindowGeometryJournal } from './windows/windowGeometryJournal';
import {
  COMMAND_SURFACE_HEIGHT as COMMAND_SURFACE_OVERLAY_HEIGHT,
  COMMAND_SURFACE_INVOKE_CHANNEL,
  COMMAND_SURFACE_WIDTH as COMMAND_SURFACE_OVERLAY_WIDTH,
  createCommandSurfaceOverlay,
  type CommandSurfaceOverlaySession,
} from './windows/commandSurfaceOverlay';
import { createForegroundBridge, resolveForegroundBridgeSourcePath } from './windows/foregroundBridge';
import { COMPACT_WIDGET_TOPMOST_LEVEL, focusSurfaceForForeignActivation } from './windows/activationSurfaceFocus';
import { createHoverInputBridge, resolveHoverInputBridgeSourcePath, type HoverInputBridge } from './windows/hoverInputBridge';
import { runNativeFileDrag } from './windows/nativeFileDrag';
import { createSurfaceContextRegistry } from './windows/surfaceContextRegistry';
import { createWindowCapabilityService } from './windows/windowCapabilityService';
import { createWindowControlBroker, resolveWindowControlSourcePath } from './windows/windowControlBroker';
import { createWindowCandidatePeekController } from './windows/windowCandidatePeekController';
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
import { createAdditionalPapersWindow as composeAdditionalPapersWindow } from './windows/additionalPapersWindow';
import { finalizePapersWindow } from './windows/papersWindowFinalization';
import { papersPaths } from './persistence/paths';
import { ProgramStateService } from './persistence/programStateService';
import { AtomicJsonStore } from './persistence/atomicStore';
import { WorkspaceTopologyStore, type SelectedWorkspaceSnapshot } from './persistence/workspaceTopologyStore';
import { WorkspaceLayoutStore } from './persistence/workspaceLayoutStore';
import { hydrateStartupWorkspace } from './persistence/startupWorkspaceHydration';
import { activateWorkspaceSurface, createWorkspaceTopology, type WorkspaceTopologyV1 } from '@shared/workspaceTopology';
import { workspaceTopologyMatchesSurfaceSet } from './workspaceTopologyAuthority';
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

registerProgramSchemePrivileges();
registerBackpackProjectSchemePrivileges();

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
const ownsSingleInstanceLock = Boolean(process.env['PAPERS_TEST_USER_DATA']) || app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();
let foregroundBridge: ReturnType<typeof createForegroundBridge> = null;

let mainWindow: BaseWindow | null = null;
/** Phase 1A: which project each sender may act for. One registry for the
 * application; the bindings inside it are per surface. */
const surfaceContexts = createSurfaceContextRegistry();
const projectSurfaceAuthority = createProjectSurfaceAuthorityBarrier();
/**
 * A0.1: the authority for which surfaces exist. Sender bindings above point at
 * these; a renderer dying ends a binding, not a surface.
 */
const logicalSurfaces = createLogicalSurfaceRegistry();

interface PapersWindowOwned {
  window: BaseWindow;
  hostView: WebContentsView;
  projectSurfaces: BackpackProjectSurfaceCollection;
}

  const papersWindows = createPapersWindowRegistry<PapersWindowOwned>();
  const hostOverlayOwners = new Map<number, Set<'picker' | 'workspace-drag' | 'workspace-resize' | 'window-drag' | 'legacy'>>();
const workspaceTopologies = new Map<number, WorkspaceTopologyV1>();
const workspaceTopologyRevisions = new Map<number, number>();
/** Live-only association. Durable workspace IDs persist; native window IDs do not. */
const workspaceIds = new Map<number, string>();
const closingPapersWindows = new Set<number>();
const visualDiagnosticsByWindow = new Map<number, VisualDiagnosticBuffer>();
const visualLifecycleMonitors = new Map<number, VisualLifecycleMonitor>();
const visualTimelinesBySurface = new Map<string, VisualTimeline>();
const visualWaitService = createVisualWaitService({
  isLive: ({ windowId, surfaceId }) => logicalSurfaces.isLiveIn(surfaceId, windowId),
  snapshot: ({ windowId, surfaceId }) => visualDiagnosticsByWindow.get(windowId)?.snapshot()
    .filter((record) => record.target.windowId === windowId && record.target.surfaceId === surfaceId) ?? [],
  currentState: ({ windowId, surfaceId }) => {
    const state = visualSurfaceObservationState.snapshot(windowId, surfaceId);
    const runtime = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId);
    if (!state || state.senderId === null || runtime?.senderId !== state.senderId) return null;
    return { layoutStable: state.layoutStable, renderFailed: state.renderFailed };
  },
});
interface VisualSemanticKeySurfaceState {
  registry: VisualSemanticKeyRegistry;
  currentSenderId: number | null;
  observations: VisualElementObservation[];
  viewportCss: { width: number; height: number } | null;
}

const visualSemanticKeysBySurface = new Map<string, VisualSemanticKeySurfaceState>();
const visualSurfaceObservationState = createVisualSurfaceObservationStore();
let visualResourceMonitor: VisualResourceMonitor | null = null;

function currentWorkspaceTopology(windowId: number): WorkspaceTopologyV1 | null {
  const topology = workspaceTopologies.get(windowId);
  if (!topology || !papersWindows.has(windowId)) return null;
  const liveProjectSurfaces = logicalSurfaces.listForWindow(windowId)
    .filter((surface) => surface.kind === 'project')
    .map(({ surfaceId, projectId }) => ({ surfaceId, projectId }));
  return workspaceTopologyMatchesSurfaceSet(topology, liveProjectSurfaces) ? topology : null;
}

function visualSemanticKeyMapKey(windowId: number, surfaceId: string): string {
  return `${windowId}\0${surfaceId}`;
}

function visualTimelineForSurface(windowId: number, surfaceId: string): VisualTimeline {
  const key = visualSemanticKeyMapKey(windowId, surfaceId);
  let timeline = visualTimelinesBySurface.get(key);
  if (!timeline) {
    timeline = createVisualTimeline();
    visualTimelinesBySurface.set(key, timeline);
  }
  return timeline;
}

function semanticKeyStateForSurface(windowId: number, surfaceId: string): VisualSemanticKeySurfaceState {
  const key = visualSemanticKeyMapKey(windowId, surfaceId);
  let state = visualSemanticKeysBySurface.get(key);
  if (!state) {
    state = { registry: createVisualSemanticKeyRegistry(), currentSenderId: null, observations: [], viewportCss: null };
    visualSemanticKeysBySurface.set(key, state);
  }
  return state;
}

function bindVisualSemanticKeySender(windowId: number, surfaceId: string, senderId: number): void {
  visualSurfaceObservationState.bindSender(windowId, surfaceId, senderId);
  const state = semanticKeyStateForSurface(windowId, surfaceId);
  if (state.currentSenderId !== senderId) {
    state.currentSenderId = senderId;
    state.registry.clear();
    state.observations = [];
    state.viewportCss = null;
  }
}

function invalidateVisualSemanticKeySender(windowId: number, surfaceId: string, senderId: number): void {
  visualSurfaceObservationState.invalidateSender(windowId, surfaceId, senderId);
  const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
  if (!state || state.currentSenderId !== senderId) return;
  state.currentSenderId = null;
  state.registry.clear();
  state.observations = [];
  state.viewportCss = null;
}

function resetVisualSemanticKeyObservation(windowId: number, surfaceId: string, senderId: number): void {
  const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
  if (!state || state.currentSenderId !== senderId) return;
  state.registry.clear();
  state.observations = [];
  state.viewportCss = null;
}

function retireVisualSemanticKeySurface(surfaceId: string): void {
  visualSurfaceObservationState.retireSurface(surfaceId);
  for (const key of visualSemanticKeysBySurface.keys()) {
    if (key.endsWith(`\0${surfaceId}`)) visualSemanticKeysBySurface.delete(key);
  }
  for (const key of visualTimelinesBySurface.keys()) {
    if (key.endsWith(`\0${surfaceId}`)) visualTimelinesBySurface.delete(key);
  }
}

function retireVisualSemanticKeySurfaceAt(windowId: number, surfaceId: string): void {
  visualWaitService.retire({ windowId, surfaceId });
  // The surface may be compensated back to this window with its original
  // renderer. Keep the observation state as the current-state source for that
  // exact renderer; sender authority still rejects it while moved away.
  visualSemanticKeysBySurface.delete(visualSemanticKeyMapKey(windowId, surfaceId));
  visualTimelinesBySurface.delete(visualSemanticKeyMapKey(windowId, surfaceId));
}

function retireLogicalSurface(surfaceId: string): boolean {
  const current = logicalSurfaces.get(surfaceId);
  const retired = logicalSurfaces.retire(surfaceId);
  if (retired) {
    if (current) visualWaitService.forget({ windowId: current.windowId, surfaceId });
    retireVisualSemanticKeySurface(surfaceId);
  }
  return retired;
}

function moveLogicalSurface(surfaceId: string, targetWindowId: number): boolean {
  const current = logicalSurfaces.get(surfaceId);
  const moved = logicalSurfaces.moveToWindow(surfaceId, targetWindowId);
  if (moved && current && current.windowId !== targetWindowId) {
    visualDiagnosticsByWindow.get(current.windowId)?.clearTarget({ windowId: current.windowId, surfaceId });
    retireVisualSemanticKeySurfaceAt(current.windowId, surfaceId);
  }
  return moved;
}

function retireLogicalSurfacesInWindow(windowId: number): string[] {
  const retired = logicalSurfaces.retireWindow(windowId);
  visualWaitService.retireWindow(windowId);
  for (const surfaceId of retired) retireVisualSemanticKeySurface(surfaceId);
  return retired;
}

function retireLogicalProjectSurfaces(projectId: string): string[] {
  const targets = logicalSurfaces.project().filter((surface) => surface.projectId === projectId)
    .map((surface) => ({ windowId: surface.windowId, surfaceId: surface.surfaceId }));
  const retired = logicalSurfaces.retireProject(projectId);
  for (const target of targets) visualWaitService.forget(target);
  for (const surfaceId of retired) retireVisualSemanticKeySurface(surfaceId);
  return retired;
}

/** The exact project runtime belonging to a bound project-frame sender. A host
 * sender is only a window actor and must use an explicit surface id. */
function runtimeForSender(senderId: number): BackpackProjectRuntime | null {
  const context = surfaceContexts.contextForSender(senderId);
  if (!context?.surfaceId) return null;
  return papersWindows.get(context.windowId)?.owned.projectSurfaces.get(context.surfaceId) ?? null;
}

/** Resolve a host request to the exact native presentation it names. */
function runtimeForHostSurface(senderId: number, surfaceId: string): BackpackProjectRuntime | null {
  const windowId = papersWindows.windowForSender(senderId);
  if (windowId === null || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
  return papersWindows.get(windowId)?.owned.projectSurfaces.ensure(surfaceId) ?? null;
}

/** Every live project runtime — for the few operations that genuinely apply to
 * all of them, such as a settings change. */
function allRuntimes(): BackpackProjectRuntime[] {
  return papersWindows.all().flatMap((context) => context.owned.projectSurfaces.all());
}

function projectSurfaceControlSnapshot(surface: {
  surfaceId: string;
  windowId: number;
  projectId: string;
  kind: string;
}): {
  surfaceId: string;
  windowId: number;
  projectId: string;
  kind: string;
  presentation: 'not-created' | 'hidden' | 'visible';
} {
  const runtime = papersWindows.get(surface.windowId)?.owned.projectSurfaces.get(surface.surfaceId);
  return {
    surfaceId: surface.surfaceId,
    windowId: surface.windowId,
    projectId: surface.projectId,
    kind: surface.kind,
    presentation: !runtime
      ? 'not-created'
      : runtime.liveProjectId === surface.projectId && runtime.isPresented ? 'visible' : 'hidden',
  };
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
  kind: 'detached' | 'widget' | 'launcher',
  owningWindowId: number,
): void {
  const senderId = window.webContents.id;
  surfaceContexts.bind(senderId, { projectId, windowId: owningWindowId, kind });
  // A dead sender can no longer act, and leaving its id bound would let a
  // recycled id inherit a project.
  window.webContents.once('destroyed', () => surfaceContexts.unbind(senderId));
}

let hostView: WebContentsView | null = null;

/**
 * Papers owns both system-wide chords while running. Alt+A raises the
 * existing window directly; a separate launch routes through second-instance.
 */
let globalInvoke: GlobalInvoke | null = null;
let startupCommandSurfaceGate: DeferredCommandSurfaceOverlay | null = null;
/** The outcome of the one registration attempt, kept so the control snapshot
 * can report a refused chord instead of leaving it invisible. */
let globalShortcutReport: GlobalInvokeRegistrationReport | null = null;

/**
 * The launcher overlay. Application-level, like the chords themselves: there is
 * one launcher for the process, and pressing the chord again dismisses it.
 */
let commandSurfaceOverlay: CommandSurfaceOverlaySession | null = null;
let commandSurfaceSenderId: number | null = null;
/**
 * Test-only seam for the invoke chord.
 *
 * Why it exists: the launcher is a real system-wide chord, and the only honest
 * way to test "press it twice" is to press it again. Synthesising the global
 * accelerator needs Windows SendInput, which would seize the keyboard of the
 * machine the creator is sitting at. The seam publishes the SAME
 * `openCommandSurface` the chord calls, and only when
 * PAPERS_TEST_INVOKE_CHANNEL=1 - never in a normal build.
 */
const TEST_INVOKE_ENABLED = process.env['PAPERS_TEST_INVOKE_CHANNEL'] === '1';
export const TEST_OPEN_COMMAND_SURFACE_KEY = '__papersTestOpenCommandSurface';

// A second launch belongs to the existing Papers window. Auxiliary Backpack
// surfaces must never be allowed to become an unreachable single-instance
// owner: if the main surface still exists, restore it; if it does not, retire
// the orphaned process so the next launch can start cleanly.
app.on('second-instance', () => {
  const candidates = [
    ...(mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : []),
    ...papersWindows.all().map((context) => context.owned.window).filter((window) => !window.isDestroyed()),
  ];
  void bringFirstWindowToFront(candidates, {
    platform: process.platform,
    nativeForeground: foregroundBridge ?? undefined,
    nativeActivationAttempts: 10,
    nativeActivationRetryDelayMs: 75,
  }).then((result) => {
    if (!result.ok) console.warn(`[papers] second-instance activation failed: ${result.detail}`);
  }).catch((error: unknown) => {
    console.warn('[papers] second-instance activation rejected', error);
  }).finally(() => {
    if (candidates.length === 0) app.quit();
  });
});

/** Height of the slim custom title bar / native window-controls overlay. */
const TITLE_BAR_HEIGHT = 40;

interface PapersSettings {
  transparentWindow: boolean;
  /** Creator-captured window rectangle, restored on every later launch.
   * Absent until "Save current window size" is used. */
  windowBounds?: WindowBounds;
  [key: string]: unknown;
}

function discoverDelegateWaveBackpackId(projectBindingsFile: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(projectBindingsFile, 'utf8')) as {
      projects?: Record<string, { root?: unknown }>;
    };
    for (const [backpackId, binding] of Object.entries(parsed.projects ?? {})) {
      if (!/^bp-[0-9a-f-]{36}$/i.test(backpackId) || typeof binding?.root !== 'string') continue;
      try {
        const projectPackage = JSON.parse(readFileSync(path.join(binding.root, 'package.json'), 'utf8')) as {
          name?: unknown;
        };
        if (projectPackage.name === 'pencilcase-backpack') return backpackId;
      } catch {
        // A missing project package is not the Pencilcase coder binding.
      }
    }
  } catch {
    // The relay remains fail-closed if project bindings are unavailable.
  }
  return undefined;
}

async function bootstrap(): Promise<void> {
  // Claim Alt+S before any restored project renderer can receive keyboard
  // input. The first press may arrive before the command-surface window exists;
  // the gate holds it and opens the real overlay as soon as it is attached.
  const commandSurfaceGate = createDeferredCommandSurfaceOverlay();
  startupCommandSurfaceGate = commandSurfaceGate;
  let earlyShortcutRegistered = false;
  try {
    earlyShortcutRegistered = globalShortcut.register('Alt+S', () => {
      void commandSurfaceGate.overlay.open().then((opened) => {
        if (!opened.ok) {
          hostView?.webContents.send('host:event:host-error', {
            component: 'Global shortcut',
            what: 'The command surface shortcut could not open the launcher.',
            known: opened.detail,
            intact: 'Nothing was changed, and no other application was affected. Papers did not come forward.',
            retryUseful: true,
            inspect: 'Shortcuts: bring Papers forward is Alt+A; open the command surface is Alt+S.',
            recover: 'Open a Backpack in Papers, then press the shortcut again.',
          });
        }
      }).catch((error: unknown) => {
        console.error('[papers] startup Alt+S dispatch failed:', error);
      });
    });
  } catch {
    // The regular registration below records and reports the exact refusal.
  }

  const baseDir = app.getPath('userData');
  const paths = papersPaths(baseDir);
  const workspaceTopologyStore = new WorkspaceTopologyStore(paths);
  await workspaceTopologyStore.initialize();
  const oldSessionPages = await workspaceTopologyStore.sessionSnapshots();
  const reloadIntentFile=path.join(paths.root,'reload-once.json');
  const startupWindowSnapshots = consumeReloadWindows(reloadIntentFile,process.argv,oldSessionPages) ?? await workspaceTopologyStore.startupWindowSnapshots();
  const startupPageSnapshot = startupWindowSnapshots[0] ?? null;
  const legacyPageClaims = new Map<string,string>();
  for(const window of oldSessionPages)if(!window.window&&!window.session)for(const page of window.topology.surfaces)
    if(!legacyPageClaims.has(page.projectId))legacyPageClaims.set(page.projectId,page.surfaceKey??page.surfaceId);
  const windowRestoreSnapshots = new Map<number, SelectedWorkspaceSnapshot>();
  const hydrationPromises = new Map<number, Promise<{ hydrated: boolean }>>();
  const workspaceLayoutStore = new WorkspaceLayoutStore(paths);
  await workspaceLayoutStore.initialize();
  // Opt-in diagnostics get one process identity for the lifetime of this
  // Papers instance. Ordinary runs do not touch the visual-debug contract.
  const processInstanceIdentity: ProcessInstanceIdentity | null = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? await createProcessInstanceIdentity({
      pid: process.pid,
      executablePath: process.execPath,
      build: controlBuildIdentity(),
      ...currentProcessInstanceSeed(),
    })
    : null;
  const visualArtifactStore = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? createVisualArtifactStore(path.join(paths.root, 'visual-artifacts'))
    : null;
  await visualArtifactStore?.cleanup();
  const visualRendererFence = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? createVisualRendererFenceService(ipcMain)
    : null;
  const visualWindowNativeCapture = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? createVisualWindowNativeCaptureService()
    : null;
  const settingsStore = new AtomicJsonStore(paths.settingsFile, { recoveryDir: paths.recoveryDir });
  const settingsReport = await settingsStore.load<PapersSettings>();
  let papersSettings: PapersSettings = {
    ...(settingsReport.value && typeof settingsReport.value === 'object' ? settingsReport.value : {}),
    transparentWindow: settingsReport.value?.transparentWindow === true,
  };
  const applyHostViewBackground = (windowId: number, view: WebContentsView): void => {
    const workspaceDragActive = hostOverlayOwners.get(windowId)?.has('workspace-drag') ?? false;
    const workspaceResizeActive = hostOverlayOwners.get(windowId)?.has('workspace-resize') ?? false;
    view.setBackgroundColor(
      workspaceDragActive || workspaceResizeActive || papersSettings.transparentWindow
        ? TRANSPARENT_CHILD_SURFACE_COLOR
        : OPAQUE_SURFACE_COLOR,
    );
  };

  const registry = new BackpackRegistry(baseDir);
  const registryReport = await registry.initialize();
  const backpackProjectBindingsFile = path.join(paths.root, 'backpack-projects.json');
  const backpackProjects = new BackpackProjectService(
    backpackProjectBindingsFile,
    (target) => shell.openPath(target),
    async (target) => {
      const icon = await app.getFileIcon(target, { size: 'large' });
      return icon.isEmpty() ? null : icon.toDataURL();
    },
    async (target) => {
      shell.showItemInFolder(target);
    },
  );
  const delegateWaveConfig = await readConfigFromMachine({
    backpackId: discoverDelegateWaveBackpackId(backpackProjectBindingsFile),
  });
  installBackpackProjectProtocol(backpackProjects);
  const filePreviewResources = createFilePreviewResourceRegistry();
  protocol.handle(FILE_PREVIEW_SCHEME, createFilePreviewProtocolHandler(filePreviewResources));
  app.once('will-quit', () => { void filePreviewResources.dispose(); });

  const everythingPaths = resolveEverythingSearchBridgePaths({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });
  const fileCapabilityCacheDirectory = path.join(paths.root, 'native', 'file-capability');
  const everythingSearch = createEverythingSearchBridge({
    cacheDirectory: fileCapabilityCacheDirectory,
    sourcePath: everythingPaths.sourcePath,
    dllPath: everythingPaths.dllPath,
  });
  const revitPreview = createRevitPreviewBridge({
    cacheDirectory: fileCapabilityCacheDirectory,
    sourcePath: resolveRevitPreviewBridgeSourcePath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    }),
  });
  const shellThumbnail = createShellThumbnailBridge({
    cacheDirectory: fileCapabilityCacheDirectory,
    sourcePath: resolveShellThumbnailSourcePath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    }),
  });
  const calibrePreview = createCalibrePreviewBridge({ cacheDirectory: fileCapabilityCacheDirectory });
  const autoCadPreview = createAutoCadPreviewBridge({ cacheDirectory: fileCapabilityCacheDirectory });
  const mlightCadPreview = createMlightCadPreviewBridge({ cacheDirectory: fileCapabilityCacheDirectory });
  const powerPointPreview = createPowerPointPreviewBridge({ cacheDirectory: fileCapabilityCacheDirectory });
  const windowsPreview = createWindowsPreviewHandlerBridge({
    cacheDirectory: fileCapabilityCacheDirectory,
    sourcePath: resolveWindowsPreviewHostSourcePath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    }),
  });
  const officeEditor = createLibreOfficeEditorBridge({
    officePath: resolveLibreOfficePath(),
    cacheDirectory: fileCapabilityCacheDirectory,
    sourcePath: resolveLibreOfficeEditorSourcePath({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, packaged: app.isPackaged }),
  });
  app.once('will-quit', () => { windowsPreview?.dispose(); void officeEditor?.dispose().catch(() => undefined); });
  const pdfPreview = createPdfPreviewHostBridge({
    resolveWindow: (ownerKey) => {
      const separator = ownerKey.indexOf(':');
      if (separator <= 0) return null;
      const windowId = Number(ownerKey.slice(0, separator));
      if (!Number.isSafeInteger(windowId)) return null;
      return papersWindows.get(windowId)?.owned.window ?? null;
    },
    stateDirectory: path.join(paths.root, 'preview-state', 'pdf'),
  });
  app.once('will-quit', () => pdfPreview.dispose());
  const htmlPreview = createHtmlPreviewHostBridge({
    resolveWindow: (ownerKey) => {
      const separator = ownerKey.indexOf(':');
      if (separator <= 0) return null;
      const windowId = Number(ownerKey.slice(0, separator));
      if (!Number.isSafeInteger(windowId)) return null;
      return papersWindows.get(windowId)?.owned.window ?? null;
    },
  });
  app.once('will-quit', () => htmlPreview.dispose());
  let hoverInputBridge: HoverInputBridge | null = null;
  const nativeFileDrag = (window: BaseWindow | null, start: () => void) => runNativeFileDrag({
    window, tracker: hoverInputBridge, start,
    activateDestination: handle => foregroundBridge?.setForegroundWindow(handle) ?? Promise.resolve(false),
    onError: error => console.error('[papers] native drag reveal:', error instanceof Error ? error.message : String(error)),
  });
  let pageDragActive=false,pageDragId:string|null=null;
  let pageDragExpiry:ReturnType<typeof setTimeout>|undefined;
  let panePages:ReturnType<typeof createPaneBackpackPages>|undefined;
  const outerPagePresentation=new Map<string,{bounds:import('./backpacks/nativePaneBridge').PaneRect|null;visible:boolean}>();
  const chromePane = createChromePaneBridge({
    cacheDirectory: path.join(paths.root, 'native-helpers'),
    nativeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(app.getAppPath(), 'resources', 'native'),
    windowInstanceId: (handle, pid) => windowCapabilityService.windowInstanceIdForHandle?.(handle, pid),
    ownerLabel: owner => {
      const [window, surface] = owner.split(':');
      return (currentWorkspaceTopology(Number(window))?.surfaces.find(page => page.surfaceId === surface)?.title ?? 'Papers page') + ` · window ${window}`;
    },
    revealOwner: async owner => {
      const [window, surface] = owner.split(':'); const windowId = Number(window);
      const context = papersWindows.get(windowId), current = currentWorkspaceTopology(windowId);
      if (!context || !current || !surface) throw new Error('That Papers page is closed.');
      facade.assertWorkspaceMutationAvailable(windowId);
      const topology = activateWorkspaceSurface(current, surface);
      workspaceTopologies.set(windowId, topology);
      context.owned.hostView.webContents.send('host:event:workspace-topology', topology);
      if (context.owned.window.isMinimized()) context.owned.window.restore();
      context.owned.window.focus();
    },
    onSnapshot: (owner, snapshot) => {
      const livePages=papersWindows.windowIds.flatMap(id=>currentWorkspaceTopology(id)?.surfaces??[]);
      snapshot={...snapshot,groups:snapshot.groups.map(g=>({...g,tabs:g.tabs.map(t=>t.preview?.PageKey?{...t,preview:{...t.preview,Name:livePages.find(p=>(p.surfaceKey??p.surfaceId)===t.preview!.PageKey)?.title??t.preview.Name}}:t)}))};
      panePages?.accept(owner,snapshot);
      const separator = owner.indexOf(':');
      const contents = papersWindows.get(Number(owner.slice(0, separator)))?.owned.projectSurfaces.get(owner.slice(separator + 1))?.webContents;
      if (!contents || contents.isDestroyed()) return;
      contents.send('papers:pane-layout:changed', snapshot);
    },
    onLayout: (owner, rect) => {
      const separator = owner.indexOf(':');
      const runtime = papersWindows.get(Number(owner.slice(0, separator)))?.owned.projectSurfaces.get(owner.slice(separator + 1));
      const contents = runtime?.webContents;
      if (contents && !contents.isDestroyed()) contents.send('papers:chrome-layout:changed', rect);
    },
    onTabs: (owner, tabs) => {
      const separator = owner.indexOf(':');
      const runtime = papersWindows.get(Number(owner.slice(0, separator)))?.owned.projectSurfaces.get(owner.slice(separator + 1));
      const contents = runtime?.webContents;
      if (contents && !contents.isDestroyed()) contents.send('papers:pane-tabs:changed', tabs.map(tab => ({
        id: tab.id, title: tab.title, active: tab.active, icon: tab.icon,
        windowInstanceId: tab.handle && tab.pid ? windowCapabilityService.windowInstanceIdForHandle?.(tab.handle, tab.pid) : undefined,
      })));
    },
  });
  app.once('will-quit', () => chromePane?.dispose());
  const webBrowser = createWebBrowserHostBridge({
    nativeDrag: nativeFileDrag,
    resolveWindow: (ownerKey) => {
      const separator = ownerKey.indexOf(':');
      if (separator <= 0) return null;
      const windowId = Number(ownerKey.slice(0, separator));
      if (!Number.isSafeInteger(windowId)) return null;
      return papersWindows.get(windowId)?.owned.window ?? null;
    },
    onReservedTab: (ownerKey) => {
      const separator = ownerKey.indexOf(':');
      if (separator <= 0) return;
      const windowId = Number(ownerKey.slice(0, separator));
      const surfaceId = ownerKey.slice(separator + 1);
      if (!Number.isSafeInteger(windowId) || !surfaceId) return;
      const contents = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.webContents;
      if (!contents || contents.isDestroyed()) return;
      contents.send('papers:backpack-project:reserved-tab');
    },
    downloadHistoryFile: path.join(paths.root, 'browser-downloads.json'),
    diagnosticLogFile: path.join(paths.root, 'diagnostics', 'browser-errors.ndjson'),
    downloadRecoveryDir: paths.recoveryDir,
  });
  app.once('will-quit', () => webBrowser.dispose());
  const capabilityRuntimes = createCapabilityRuntimeService(path.join(paths.root, 'native', 'capability-runtimes'), officeEditor ? { officeEditor } : {});
  await capabilityRuntimes.initialize();
  app.once('will-quit', () => { void capabilityRuntimes.stopRecording(); });
  const presentPanePage=(page:PanePage,bounds:import('./backpacks/nativePaneBridge').PaneRect|null,visible:boolean):void=>{
    const runtime=papersWindows.get(page.windowId)?.owned.projectSurfaces.get(page.surfaceId);if(!runtime)return;
    if(runtime.isPresented===visible&&(!bounds||JSON.stringify(runtime.currentBounds)===JSON.stringify({x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height})))return;
    if(bounds)runtime.setBounds(bounds);if(visible)runtime.present();else runtime.conceal();
    const owner=`${page.windowId}:${page.surfaceId}`;
    officeEditor?.setOwnerVisible(owner,visible);windowsPreview?.setOwnerVisible(owner,visible);pdfPreview.setOwnerVisible(owner,visible);htmlPreview.setOwnerVisible(owner,visible);webBrowser.setOwnerVisible(owner,visible);chromePane?.setOwnerVisible(owner,visible);
    if(bounds){officeEditor?.setOwnerSurfaceBounds(owner,bounds);windowsPreview?.setOwnerSurfaceBounds(owner,bounds);pdfPreview.setOwnerSurfaceBounds(owner,bounds);htmlPreview.setOwnerSurfaceBounds(owner,bounds);webBrowser.setOwnerSurfaceBounds(owner,bounds);chromePane?.setOwnerSurfaceBounds(owner,bounds);}
  };
  panePages=createPaneBackpackPages({exists:async key=>(await workspaceTopologyStore.sessionSnapshots()).some(record=>record.topology.surfaces.some(page=>(page.surfaceKey??page.surfaceId)===key)),bridge:()=>chromePane?.coordinator,pages:()=>papersWindows.windowIds.flatMap(windowId=>(currentWorkspaceTopology(windowId)?.surfaces??[]).map(p=>({windowId,surfaceId:p.surfaceId,key:p.surfaceKey??p.surfaceId,projectId:p.projectId,title:p.title,tabStyle:registry.list().find(b=>b.id===p.projectId)?.name.toLowerCase().includes('proxima')?'proxima':undefined}))),
    outer:page=>outerPagePresentation.get(`${page.windowId}:${page.surfaceId}`)??{bounds:papersWindows.get(page.windowId)?.owned.projectSurfaces.get(page.surfaceId)?.currentBounds??null,visible:false},present:presentPanePage,
    adopt:async(page,parent)=>{const windowId=parent.windowId;const hostId=papersWindows.get(windowId)?.owned.hostView.webContents.id;if(hostId===undefined)throw Error('Destination window closed.');await facade.adoptWorkspaceSurfaceFromHost(hostId,page.surfaceId,currentWorkspaceTopology(windowId)?.focusedGroupId??'group-main',2147483647);facade.activateBackpackProjectSurface(hostId,parent.surfaceId);}});
  const fileCapability = createFileCapabilityService({
    panePageDrag:()=>pageDragId,
    panePages:{check:(...args)=>panePages!.check(...args),attach:async(...args)=>{
      const source=papersWindows.windowIds.map(id=>({id,page:currentWorkspaceTopology(id)?.surfaces.find(p=>p.surfaceId===args[1]||(p.surfaceKey??p.surfaceId)===args[1])})).find(p=>p.page);
      const result=await panePages!.attach(...args);if(!result.ok&&source){const wc=papersWindows.get(source.id)?.owned.hostView.webContents;if(wc&&!wc.isDestroyed())wc.send('host:event:move-rejected',{surfaceId:source.page!.surfaceId});}return result;
    }},
    trashPath: target => shell.trashItem(target),
    runtimeControl: capabilityRuntimes,
    cacheDirectory: fileCapabilityCacheDirectory,
    everythingSearch,
    previewResources: filePreviewResources,
    pdfPreview,
    revitPreview,
    shellThumbnail,
    calibrePreview,
    autoCadPreview,
    mlightCadPreview,
    htmlPreview,
    webBrowser,
    chromePane,
    resolvePaneWindow: async bindingId => {
      const result = await windowCapabilityService.observeCapability({ version: 1, bindingId }, { seedFrame: false });
      const observed = result.observation;
      return result.outcome === 'success' && observed?.handle && observed.processId
        ? { handle: observed.handle, pid: observed.processId } : null;
    },
    powerPointPreview,
    windowsPreview,
    officeEditor,
    dopusrtPath: resolveDirectoryOpusRtPath(),
    libreOfficePath: resolveLibreOfficePath(),
    openPath: (target) => shell.openPath(target),
    revealPath: (target) => shell.showItemInFolder(target),
    fileIcon: async (target) => {
      const icon = await app.getFileIcon(target, { size: 'small' });
      return icon.isEmpty() ? null : icon.toDataURL();
    },
  });

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
  let controlEventHub: PapersControlEventHub | null = null;
  const onProjectSurfaceClosed = (windowId: number, _surfaceId: string, projectId: string): void => {
    visualSemanticKeysBySurface.delete(visualSemanticKeyMapKey(windowId, _surfaceId));
    visualTimelinesBySurface.delete(visualSemanticKeyMapKey(windowId, _surfaceId));
    detachSession?.closeProjectForOwner(projectId, windowId).catch(() => undefined);
    const workspace = detachRegistry.surfaceForProject(
      projectId,
      'workspace',
      (senderId) => surfaceContexts.contextForSender(senderId)?.windowId === windowId,
    );
    if (workspace) detachRegistry.unregister(workspace.id);
  };
  const onProjectConsoleMessage = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? (windowId: number, surfaceId: string, senderId: number, level: number, message: string, isBootstrap: boolean): void => {
      if (message.length === 0) return;
      const target = resolveVisualTarget({ id: senderId });
      if (!target || target.windowId !== windowId || target.surfaceId !== surfaceId) return;
      const buffer = visualDiagnosticsByWindow.get(target.windowId);
      if (!buffer) return;
      try {
        const boundedMessage = message.slice(0, 4096);
        buffer.append(target, { kind: 'console', level: visualConsoleLevel(level), message: boundedMessage });
        if (!isBootstrap || level !== 3) return;
        const isUnhandledRejection = message.startsWith('Uncaught (in promise)');
        const isUncaughtError = message.startsWith('Uncaught');
        if (!isUnhandledRejection && !isUncaughtError) return;
        const prefix = isUnhandledRejection ? 'Uncaught (in promise)' : 'Uncaught';
        const detail = isUnhandledRejection
          ? (boundedMessage.slice(prefix.length).trim().replace(/^Error:\s*/i, '') || 'unhandled rejection')
          : (boundedMessage || 'uncaught error');
        recordRendererVisualDiagnostic(buffer, target, {
          kind: isUnhandledRejection ? 'unhandled-rejection' : 'uncaught-error',
          message: detail,
        }, 'bootstrap-console');
      } catch {
        // Diagnostic collection is best effort and must never affect the
        // project renderer or normal Papers startup.
      }
    }
    : undefined;
  const onProjectLifecycleEvent = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? (windowId: number, surfaceId: string, senderId: number, event: 'did-start-loading' | 'dom-ready' | 'did-finish-load', documentInstanceId?: string): void => {
      if (event === 'did-finish-load' && documentInstanceId) {
        // Prepared cross-window renderers finish before adoption, when the
        // ordinary sender-to-live-surface resolver must still fail closed.
        // Bind only the exact callback-provided identity; adoption later
        // reuses this already-current sender generation.
        visualSurfaceObservationState.bindSender(windowId, surfaceId, senderId);
        visualSurfaceObservationState.bindDocumentInstance(windowId, surfaceId, senderId, documentInstanceId);
        // The main-issued document token and the renderer's queued initial
        // observation are separate IPC messages. Ask for one deterministic
        // resend after the token is installed, covering either delivery order.
        papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.refreshVisualSemanticKeys();
        return;
      }
      const target = resolveVisualTarget({ id: senderId });
      if (!target || target.windowId !== windowId || target.surfaceId !== surfaceId) return;
      if (event === 'did-start-loading') {
        resetVisualSemanticKeyObservation(windowId, surfaceId, senderId);
        visualSurfaceObservationState.startNavigation(windowId, surfaceId, senderId);
      } else if (event === 'dom-ready') {
        visualSurfaceObservationState.markDomReady(windowId, surfaceId, senderId);
      }
      if (event === 'did-finish-load') return;
      const buffer = visualDiagnosticsByWindow.get(windowId);
      if (!buffer) return;
      try {
        buffer.append(target, {
          kind: 'lifecycle',
          phase: event === 'did-start-loading' ? 'navigation-started' : 'dom-ready',
        });
      } catch {
        // Lifecycle collection is best effort and must never affect startup.
      }
    }
    : undefined;
  const onProjectRendererGone = process.env['PAPERS_DEV_CONTROL'] === '1'
    ? (windowId: number, surfaceId: string, senderId: number, reason: string): void => {
      const target = resolveVisualTarget({ id: senderId });
      if (!target || target.windowId !== windowId || target.surfaceId !== surfaceId) return;
      invalidateVisualSemanticKeySender(windowId, surfaceId, senderId);
      const buffer = visualDiagnosticsByWindow.get(windowId);
      if (!buffer) return;
      try {
        buffer.append(target, { kind: 'renderer-gone', reason: reason.slice(0, 256) || 'unknown' });
      } catch {
        // Renderer exit collection is best effort and must never affect teardown.
      }
    }
    : undefined;
  const onProjectTitleChanged = (windowId: number, surfaceId: string, senderId: number, title: string): void => {
    void facade.updateWorkspaceSurfaceTitle(windowId, surfaceId, senderId, title);
  };
  const onProjectFaviconChanged = (windowId: number, surfaceId: string, senderId: number, urls: string[]): void => {
    const runtime = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId);
    if (!runtime || runtime.senderId !== senderId) return;
    const icon = urls.find((url) => /^data:image\/(?:png|webp|svg\+xml);base64,/i.test(url) && url.length <= 256 * 1024) ?? null;
    papersWindows.get(windowId)?.owned.hostView.webContents.send('host:event:workspace-project-icon', { surfaceId, icon });
  };
  const makePapersWindow = (bounds?: WindowBounds) => {
    const instance = createPapersWindow({
      bounds,
      appIcon,
      transparent: papersSettings.transparentWindow,
      currentTransparent: () => papersSettings.transparentWindow,
      hostPreloadPath: path.join(preloadDir, process.env['PAPERS_DEV_CONTROL'] === '1' ? 'hostDevControl.cjs' : 'host.cjs'),
      projectPreloadPath: path.join(preloadDir, process.env['PAPERS_DEV_CONTROL'] === '1' ? 'backpackProjectDevControl.cjs' : 'backpackProject.cjs'),
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      rendererFile: path.join(app.getAppPath(), 'out', 'renderer', 'index.html'),
      onProjectSurfaceClosed,
      onProjectConsoleMessage,
      onProjectLifecycleEvent,
      onProjectRendererGone,
      onProjectTitleChanged,
      onProjectFaviconChanged,
    });
    if (process.env['PAPERS_DEV_CONTROL'] === '1') {
      const windowId = instance.window.id;
      const buffer = createVisualDiagnosticBuffer({
        onAppend: (record) => {
          if (record.target.surfaceId) {
            const state = visualSurfaceObservationState.snapshot(windowId, record.target.surfaceId);
            visualTimelineForSurface(windowId, record.target.surfaceId).append(record, visualTimelineContextForRecord(record, {
              renderCycleId: state?.renderCycleId ?? null,
              documentStateRevision: state?.documentStateRevision ?? null,
              layoutEpoch: state?.layoutEpoch ?? null,
              workspaceTopologyRevision: workspaceTopologyRevisions.get(windowId) ?? 0,
            }));
          }
          visualWaitService.append(record);
          const event = record.payload.kind === 'lifecycle' ? 'visual.lifecycle' : 'visual.diagnostic';
          controlEventHub?.publish(event, record);
        },
      });
      const monitor = attachVisualLifecycleMonitor(
        instance.hostView.webContents as unknown as Parameters<typeof attachVisualLifecycleMonitor>[0],
        { windowId },
        buffer,
      );
      visualDiagnosticsByWindow.set(windowId, buffer);
      visualLifecycleMonitors.set(windowId, monitor);
      instance.window.once('closed', () => {
        monitor.detach();
        visualLifecycleMonitors.delete(windowId);
        visualDiagnosticsByWindow.delete(windowId);
        for (const key of visualSemanticKeysBySurface.keys()) {
          if (key.startsWith(`${windowId}\0`)) visualSemanticKeysBySurface.delete(key);
        }
        for (const key of visualTimelinesBySurface.keys()) {
          if (key.startsWith(`${windowId}\0`)) visualTimelinesBySurface.delete(key);
        }
        visualSurfaceObservationState.retireWindow(windowId);
      });
    }
    return instance;
  };
  const displays = () => screen.getAllDisplays().map(display => display.workArea);
  const windowInstance = makePapersWindow(resolveWindowBounds(startupPageSnapshot?.window?.bounds, displays()) ?? savedBounds ?? undefined);
  let preservingShutdown = false;
  app.on('before-quit', () => { preservingShutdown = true; });
  const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const saveSessionWindow = async (instance: Pick<Parameters<typeof preparePapersWindow>[0], 'window'>, parked = false): Promise<void> => {
    const id = workspaceIds.get(instance.window.id);
    if (!id || instance.window.isDestroyed()) return;
    const topology = workspaceTopologies.get(instance.window.id) ?? windowRestoreSnapshots.get(instance.window.id)?.topology ?? createWorkspaceTopology();
    await workspaceTopologyStore.savePages(id, topology, {bounds: instance.window.getNormalBounds(), parked});
  };
  const lifecycleDependencies = (restoreBackpackId: string | null, snapshot?: SelectedWorkspaceSnapshot) => ({
    register: (instance: Parameters<typeof preparePapersWindow>[0]) => {
      papersWindows.add(instance.window.id, {
        window: instance.window,
        hostView: instance.hostView,
        projectSurfaces: instance.projectSurfaces,
      }, restoreBackpackId);
      papersWindows.setHostSender(instance.window.id, instance.hostView.webContents.id);
      workspaceIds.set(instance.window.id, snapshot?.workspaceId ?? randomUUID());
      if (snapshot) windowRestoreSnapshots.set(instance.window.id, snapshot);
      const saveGeometry = () => {
        const id = instance.window.id;
        const previous = saveTimers.get(id);
        if (previous) clearTimeout(previous);
        saveTimers.set(id, setTimeout(() => {
          saveTimers.delete(id);
          void saveSessionWindow(instance).catch(error => console.error('[session] geometry save failed', error));
        }, 500));
      };
      instance.window.on('move', saveGeometry);
      instance.window.on('resize', saveGeometry);
      instance.window.on('query-session-end', () => { preservingShutdown = true; });
      void saveSessionWindow(instance).catch(error => console.error('[session] register failed', error));
    },
    install: (instance: Parameters<typeof preparePapersWindow>[0]) => {
      const window = instance.window;
      const windowId = window.id;
      let officeClosePending = false;
      window.on('close', (event) => {
        if (!officeEditor?.hasWindow(windowId)) return;
        event.preventDefault();
        if (officeClosePending) return;
        officeClosePending = true;
        void officeEditor.closeWindow(windowId).then(() => {
          if (!window.isDestroyed()) window.close();
        }).catch((error: unknown) => {
          void dialog.showMessageBox(window, { type: 'warning', title: 'Document still open',
            message: error instanceof Error ? error.message : 'Save your document before closing Papers.' });
        }).finally(() => { officeClosePending = false; });
      });
    },
    onClose: async (instance: Parameters<typeof preparePapersWindow>[0]) => {
      traceQuit('window:' + instance.window.id + ':flush:start');
      closingPapersWindows.add(instance.window.id);
      const timer = saveTimers.get(instance.window.id);
      if (timer) clearTimeout(timer);
      saveTimers.delete(instance.window.id);
      await facade.waitForWorkspaceMutation(instance.window.id);
      await instance.projectSurfaces.hideAll();
      await saveSessionWindow(instance, !preservingShutdown);
      traceQuit('window:' + instance.window.id + ':flush:done');
    },
    finalize: async (windowId: number) => {
      traceQuit('window:' + windowId + ':finalize:start');
      await facade.waitForWorkspaceMutation(windowId);
      traceQuit('window:' + windowId + ':finalize:unlocked');
      try {
        await finalizePapersWindow(windowId, {
          closeOwnedWidgets: async (id) => { await widgetSession?.closeOwnedByWindow(id);traceQuit('window:'+id+':finalize:widgets'); },
          unbindSurfaceSenders: (id) => surfaceContexts.unbindWindow(id),
          retireLogicalSurfaces: (id) => { retireLogicalSurfacesInWindow(id); },
          clearWorkspaceTopology: (id) => {
            workspaceTopologies.delete(id);
            workspaceTopologyRevisions.delete(id);
            workspaceIds.delete(id);
            hydrationPromises.delete(id);
            windowRestoreSnapshots.delete(id);
          },
          removeWindow: (id) => {
            hostOverlayOwners.delete(id);
            papersWindows.remove(id);
            if (papersWindows.windowIds.length === 0) {
              void commandSurfaceOverlay?.destroy().catch(() => undefined);
              // Closed-event finalization can run inside an earlier quit pass.
              // Defer until Electron has left that pass before requesting exit.
              setImmediate(() => { if(papersWindows.windowIds.length===0)app.quit(); });
            }
          },
        });
        traceQuit('window:'+windowId+':finalize:done');
      } catch(error) {traceQuit('window:'+windowId+':finalize:failed:'+String(error));throw error;} finally {
        closingPapersWindows.delete(windowId);
      }
    },
  });
  const createAdditionalPapersWindow = async (snapshot?: SelectedWorkspaceSnapshot): Promise<number> => {
    const created = await composeAdditionalPapersWindow({
      createWindow: () => makePapersWindow(resolveWindowBounds(snapshot?.window?.bounds, displays()) ?? undefined),
      lifecycleDependencies: () => lifecycleDependencies(null, snapshot),
    });
    return created.window.id;
  };
  const preparedWindow = preparePapersWindow(windowInstance, lifecycleDependencies(registry.lastActiveBackpackId, startupPageSnapshot??undefined));
  mainWindow = windowInstance.window;
  hostView = windowInstance.hostView;
  const primaryWindow = windowInstance.window;
  // These aliases are bootstrap/fixture compatibility only. Their cleanup is
  // deliberately first-window-specific; reusable window finalization must not
  // let a later window rewrite or clear the primary fixture relationship.
  windowInstance.window.once('closed', () => {
    if (mainWindow === primaryWindow) mainWindow = null;
    if (hostView === windowInstance.hostView) hostView = null;
  });
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
    // This is an application-wide appearance setting. Repaint every live
    // Papers window, not only the bootstrap window captured by this closure.
    for (const context of papersWindows.all()) {
      if (!context.owned.hostView.webContents.isDestroyed()) {
        applyHostViewBackground(context.owned.window.id, context.owned.hostView);
      }
      if (!context.owned.window.isDestroyed()) {
        context.owned.window.setBackgroundColor(
          transparent ? TRANSPARENT_SURFACE_COLOR : OPAQUE_SURFACE_COLOR,
        );
      }
    }
  };
  applyHostSurface(papersSettings.transparentWindow);

  // window as a docked sidebar or a detached window — never a second chat UI.
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
      // The registry that binds EVERY Papers-owned surface, so trust is asked of
      // the authority rather than of a feature's lookup table.
      surfaces: surfaceContexts,
      detachRegistry,
      widgetRegistry,
    });

  /**
   * May this sender use THIS channel?
   *
   * Trust and authorization are separate questions, and the channel decides the
   * second one. Without this, admitting a kind of surface to host project
   * channels also hands it window enumeration and native dialogs.
   */
  const projectSurfaceRequestDecision = (
    sender: WebContents,
    channel: string,
  ): 'allow' | 'not-a-project-sender' | 'capability-not-granted' =>
    decideProjectSurfaceRequest({
      senderId: sender.id,
      url: sender.mainFrame.url,
      isWorkspaceSender: runtimeForSender(sender.id)?.isSender(sender) ?? false,
      surfaces: surfaceContexts,
      detachRegistry,
      widgetRegistry,
      channel,
    });

  /**
   * The local-service capability, assembled from the project's own declaration.
   *
   * The host contributes only mechanics: the request is made from the MAIN
   * process, where there is no page origin for CORS to police and no CSP, and the
   * credential is a file the project names. Nothing here knows any project's
   * name, port or protocol, and the declaration is re-read on every request so
   * an edited `local-service.json` takes effect without restarting Papers - the
   * same property project files already have.
   *
   * The service still authenticates. A 401 comes back as a 401; the bridge only
   * ever reports its OWN failures, so a caller's honest "the service is not
   * reachable" banner keeps meaning exactly that.
   */
  const fetchLocalServiceFor = async (projectId: string, request: unknown): Promise<LocalServiceResponse> => {
    const root = await backpackProjects.root(projectId);
    if (!root) return { ok: false, detail: 'this project is not bound on this machine' };
    const declaration = loadLocalServiceDeclaration(root);
    if (!declaration) {
      return { ok: false, detail: 'this project declares no local service (no readable local-service.json)' };
    }
    const bridge = createLocalServiceBridge({
      declaration,
      // THE SCOPE A DECLARED CREDENTIAL MAY BE READ FROM. Both are locations the
      // host itself decides: the project's own tree, and the host's per-project
      // config directory (where `backpack.json` already lives). A declaration is
      // project-authored input, so without this it could name any readable file on
      // the machine and have it attached to a request.
      secretRoots: [
        root,
        path.join(app.getPath('userData'), 'PapersData', 'backpacks', projectId),
      ],
      readSecretFile: (file) => {
        // The top-level `readFileSync` import, not a fresh `require`: the merge
        // brought the bridge in beside code that already imports it, and two
        // spellings of one dependency drift.
        try {
          return readFileSync(file, 'utf8').trim();
        } catch {
          return null;
        }
      },
      performRequest: async ({ url, method, headers, body, redirect }) => {
        const response = await net.fetch(url, {
          method,
          headers,
          // THE REDIRECT FIX. `net.fetch` follows redirects by default, which
          // would send this machine to a destination nothing validated - the
          // declaration and the loopback check only ever saw the FIRST url.
          // MEASURED against a real Electron: with `manual`, a 3xx makes
          // `net.fetch` throw "Redirect was cancelled" rather than handing the
          // response back. So the hop is refused and never chased, which is the
          // property that matters; the bridge's own hop checks still apply to any
          // Location that does reach it.
          redirect,
          ...(body === null ? {} : { body }),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      },
      report: (report) => {
        if (report.outcome === 'proxied') return;
        console.error(`[papers] local service: ${report.detail}`);
      },
    });
    const shape = (request ?? {}) as Record<string, unknown>;
    return bridge.fetch({
      url: typeof shape['url'] === 'string' ? shape['url'] : '',
      ...(typeof shape['method'] === 'string' ? { method: shape['method'] } : {}),
      ...(shape['headers'] !== undefined && shape['headers'] !== null && typeof shape['headers'] === 'object'
        ? { headers: shape['headers'] as Record<string, string> }
        : {}),
      ...(typeof shape['body'] === 'string' ? { body: shape['body'] } : {}),
    });
  };

  const facade = new PapersHostFacade({
    localServiceFetch: fetchLocalServiceFor,
    dismissCommandSurface: async (senderId, destination) => {
      const context = surfaceContexts.contextForSender(senderId);
      if (!context || context.kind !== 'launcher') {
        throw new Error('Only the command-surface launcher may dismiss itself.');
      }
      const overlay = commandSurfaceOverlay;
      if (!overlay) throw new Error('The command-surface overlay is unavailable.');
      if (destination === 'papers') {
        // If the creator already moved to another application, do not steal
        // focus back. Otherwise the still-focused overlay is the foreground
        // owner, so Papers may activate the exact window that opened the result.
        if (overlay.isFocused()) {
          const target = papersWindows.get(context.windowId)?.owned.window;
          const activated = await bringWindowToFront(target, {
            platform: process.platform,
            nativeForeground: foregroundBridge ?? undefined,
          });
          if (!activated.ok) throw new Error(activated.detail);
          await overlay.close('action-host');
        } else {
          await overlay.close('action-external');
        }
        return;
      }
      await overlay.close(destination === 'external' ? 'action-external' : 'action-run');
    },
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
    sendToWindowOrThrow: (windowId, channel, payload) => {
      const contents = papersWindows.get(windowId)?.owned.hostView.webContents;
      if (!contents || contents.isDestroyed()) throw new Error('That Papers window host is unavailable.');
      contents.send(channel, payload);
    },
    hostWindowForSender: (senderId) => papersWindows.windowForSender(senderId),
    hostWindowIds: () => papersWindows.windowIds,
    enteredBackpack: (windowId) => papersWindows.enteredBackpack(windowId),
    setEnteredBackpack: (windowId, backpackId) => papersWindows.setEnteredBackpack(windowId, backpackId),
    workspaceTopology: (windowId) => currentWorkspaceTopology(windowId),
    hydrateStartupWorkspace: (windowId) => {
      if (!windowRestoreSnapshots.has(windowId)) return Promise.resolve({ hydrated: false });
      const pending = hydrationPromises.get(windowId);
      if (pending) return pending;
      const hydration = (async () => {
        const result = await hydrateStartupWorkspace(windowId, {
        snapshot: windowRestoreSnapshots.get(windowId) ?? null,
        findAvailableBackpack: (projectId) => {
          const backpack = registry.find(projectId);
          return backpack && !backpack.archived ? { name: backpack.name } : null;
        },
        openProject: (projectId) => backpackProjects.open(projectId),
        createSurface: ({ windowId: targetWindowId, projectId }) => logicalSurfaces.create({ windowId: targetWindowId, projectId, kind: 'project' }),
        retireSurface: (surfaceId) => retireLogicalSurface(surfaceId),
        validate: (topology) => facade.validateWorkspaceTopologyForStartup(windowId, topology),
        deliver: (projects, topology) => {
          const contents = papersWindows.get(windowId)?.owned.hostView.webContents;
          if (!contents || contents.isDestroyed()) throw new Error('That Papers window host is unavailable.');
          const keyedProjects = projects.map((project) => {
            const surface = topology.surfaces.find((candidate) => candidate.surfaceId === project.surfaceId);
            return surface
              ? { ...project, url: (() => { const url = new URL(withProjectSurfaceKey(project.url, surface.surfaceKey ?? surface.surfaceId)); if (legacyPageClaims.get(surface.projectId)===(surface.surfaceKey??surface.surfaceId)) url.searchParams.set('papers-pane-legacy', '1'); return url.toString(); })() }
              : project;
          });
          contents.send('host:event:workspace-hydrated', { projects: keyedProjects, topology });
        },
        commit: (workspaceId, topology) => {
          workspaceIds.set(windowId, workspaceId);
          papersWindows.setActiveSurfaceId(windowId, topology.groups.find((group) => group.groupId === topology.focusedGroupId)?.activeSurfaceId ?? null);
          const active = topology.groups.find((group) => group.groupId === topology.focusedGroupId)?.activeSurfaceId;
          const projectId = topology.surfaces.find((surface) => surface.surfaceId === active)?.projectId ?? null;
          papersWindows.setEnteredBackpack(windowId, projectId);
          workspaceTopologies.set(windowId, topology);
          workspaceTopologyRevisions.set(windowId, (workspaceTopologyRevisions.get(windowId) ?? 0) + 1);
          void workspaceTopologyStore.commit(workspaceId, topology).catch((error) => {
            console.error('[workspace-topology] hydration durable commit failed', error);
          });
        },
        runWithProjectOwnershipGates: (projectIds, operation) =>
          facade.withProjectOwnershipGates(projectIds, operation),
        assertWorkspaceMutationAvailable: (targetWindowId) =>
          facade.assertWorkspaceMutationAvailable(targetWindowId),
        });
        return { hydrated: Boolean(result) };
      })();
      hydrationPromises.set(windowId, hydration);
      return hydration;
    },
    setWorkspaceTopology: (windowId, topology) => {
      workspaceTopologies.set(windowId, topology);
      workspaceTopologyRevisions.set(windowId, (workspaceTopologyRevisions.get(windowId) ?? 0) + 1);
      let workspaceId = workspaceIds.get(windowId);
      if (!workspaceId) {
        workspaceId = randomUUID();
        workspaceIds.set(windowId, workspaceId);
      }
      void workspaceTopologyStore.commit(workspaceId, topology).catch((error) => {
        console.error('[workspace-topology] durable commit failed', error);
      });
    },
    workspaceLayouts: workspaceLayoutStore,
    workspaceMove: {
      workspaceId: (windowId) => workspaceIds.get(windowId) ?? null,
      isWindowClosing: (windowId) => closingPapersWindows.has(windowId),
      workspaceState: (windowId) => ({
        topology: workspaceTopologies.get(windowId) ?? null,
        revision: workspaceTopologyRevisions.get(windowId) ?? 0,
        workspaceId: workspaceIds.get(windowId) ?? null,
        activeSurfaceId: papersWindows.activeSurfaceId(windowId),
        enteredBackpackId: papersWindows.enteredBackpack(windowId),
      }),
      setWorkspaceState: (windowId, state) => {
        if (state.topology) workspaceTopologies.set(windowId, state.topology);
        else workspaceTopologies.delete(windowId);
        if (state.revision > 0 || state.topology) workspaceTopologyRevisions.set(windowId, state.revision);
        else workspaceTopologyRevisions.delete(windowId);
        if (state.workspaceId) workspaceIds.set(windowId, state.workspaceId);
        else workspaceIds.delete(windowId);
        papersWindows.setActiveSurfaceId(windowId, state.activeSurfaceId);
        papersWindows.setEnteredBackpack(windowId, state.enteredBackpackId);
      },
      commitPair: (pair) => workspaceTopologyStore.commitPair(pair),
      snapshotPair: (sourceWorkspaceId, targetWorkspaceId) =>
        workspaceTopologyStore.snapshotPair(sourceWorkspaceId, targetWorkspaceId),
      restorePair: (snapshot, sourceWorkspaceId, targetWorkspaceId) =>
        workspaceTopologyStore.restorePairWithIds(snapshot, sourceWorkspaceId, targetWorkspaceId),
      projectEntryUrl: (windowId, projectId) =>
        papersWindows.get(windowId)?.owned.projectSurfaces.entryUrlForProject(projectId) ?? null,
      prepareProjectSurface: async (windowId, surfaceId, url) => {
        const collection = papersWindows.get(windowId)?.owned.projectSurfaces;
        if (!collection) throw new Error('That Papers target window has no project-surface collection.');
        const prepared = collection.prepare(surfaceId);
        let authority: ReturnType<typeof projectSurfaceAuthority.stage> | null = null;
        let senderId: number | null = null;
        try {
          await prepared.runtime.show(url, {
            present: false,
            beforeLoad: (id) => {
              senderId = id;
              authority = projectSurfaceAuthority.stage(id);
            },
          });
          if (senderId === null || authority === null) throw new Error('Destination project surface did not create a sender.');
          return {
            senderId,
            adopt: () => {
              prepared.adopt();
              const projectId = prepared.runtime.liveProjectId;
              if (!projectId) throw new Error('Destination project surface has no project identity.');
              // Release queued project IPC only after its sender is bound to
              // the newly adopted logical surface. The page can issue its
              // first state-load while navigation is still in flight.
              surfaceContexts.bind(senderId!, {
                surfaceId,
                projectId,
                windowId,
                kind: 'project',
              });
              authority?.adopt();
              bindVisualSemanticKeySender(windowId, surfaceId, senderId!);
              prepared.runtime.onFrameDestroyed(senderId!, () => {
                invalidateVisualSemanticKeySender(windowId, surfaceId, senderId!);
                surfaceContexts.unbind(senderId!);
              });
              prepared.runtime.refreshVisualSemanticKeys();
              projectSurfaceAuthority.forget(senderId!);
            },
            discard: () => {
              authority?.discard();
              if (senderId !== null) surfaceContexts.unbind(senderId);
              prepared.discard();
              if (senderId !== null) projectSurfaceAuthority.forget(senderId);
            },
          };
        } catch (caught) {
          (authority as ReturnType<typeof projectSurfaceAuthority.stage> | null)?.discard();
          prepared.discard();
          if (senderId !== null) projectSurfaceAuthority.forget(senderId);
          throw caught;
        }
      },
    },
    activeSurfaceId: (windowId) => papersWindows.activeSurfaceId(windowId),
    setActiveSurfaceId: (windowId, surfaceId) => papersWindows.setActiveSurfaceId(windowId, surfaceId),
    clearEnteredBackpackEverywhere: (backpackId) => papersWindows.clearEnteredBackpackEverywhere(backpackId),
    // Archiving or removing a Backpack retires every surface showing it, in
    // any window: the thing itself became unavailable.
    retireProjectSurfaces: (projectId) => { retireLogicalProjectSurfaces(projectId); },
    listLogicalSurfaces: () => logicalSurfaces.project(),
    retireBackpackProjectSurfaces: async (backpackId) => {
      await Promise.all([
        detachSession?.closeProject(backpackId).catch(() => undefined),
        widgetSession?.closeProject(backpackId).catch(() => undefined),
      ]);
    },
    pageClosed: async (surfaceId) => { await panePages?.removePage(surfaceId); },
    closeAttachedProjectSurface: async (windowId, surfaceId, options) => {
      await officeEditor?.closeOwner(`${windowId}:${surfaceId}`);
      windowsPreview?.closeOwner(`${windowId}:${surfaceId}`);
      pdfPreview.closeOwner(`${windowId}:${surfaceId}`);
      htmlPreview.closeOwner(`${windowId}:${surfaceId}`);
      webBrowser.closeOwner(`${windowId}:${surfaceId}`); await chromePane?.closeOwner(`${windowId}:${surfaceId}`);
      await papersWindows.get(windowId)?.owned.projectSurfaces.close(surfaceId, options);
    },
    projectEntryUrlForSurface: (windowId, surfaceId) =>
      papersWindows.get(windowId)?.owned.projectSurfaces.entryUrlForSurface(surfaceId) ?? null,
    closeBackpackProjectSurface: async (senderId, surfaceId) => {
      const windowId = papersWindows.windowForSender(senderId);
      if (windowId !== null) {
        await officeEditor?.closeOwner(`${windowId}:${surfaceId}`);
        windowsPreview?.closeOwner(`${windowId}:${surfaceId}`);
        pdfPreview.closeOwner(`${windowId}:${surfaceId}`);
        htmlPreview.closeOwner(`${windowId}:${surfaceId}`);
        webBrowser.closeOwner(`${windowId}:${surfaceId}`); await chromePane?.closeOwner(`${windowId}:${surfaceId}`);
        await papersWindows.get(windowId)?.owned.projectSurfaces.close(surfaceId);
      }
    },
    restoreBackpack: (windowId) => papersWindows.restoreBackpack(windowId),
    // The Canvas runtime is still application-level and attached to the first
    // window, so this has one answer today. Recording the relationship rather
    // than assuming it means per-window Canvas would need no delivery change.
    canvasRuntimeWindow: () => mainWindow?.id ?? null,
    updater,
    registry,
    backpackProjects,
    fileCapability,
    filePreviewHostForSender: (senderId) => {
      const context = surfaceContexts.contextForSender(senderId);
      if (!context?.surfaceId) return null;
      const owner = papersWindows.get(context.windowId)?.owned;
      const runtime = owner?.projectSurfaces.get(context.surfaceId);
      const surfaceBounds = runtime?.currentBounds;
      if (!owner || !surfaceBounds || owner.window.isDestroyed()) return null;
      const handle = owner.window.getNativeWindowHandle();
      const parentHwnd = handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : BigInt(handle.readUInt32LE(0)).toString();
      const page = currentWorkspaceTopology(context.windowId)?.surfaces.find(surface => surface.surfaceId === context.surfaceId);
      return { ownerKey: `${context.windowId}:${context.surfaceId}`, paneGroup: context.projectId,
        layoutKey: `${context.projectId}:${page?.surfaceKey ?? context.surfaceId}`, parentHwnd, surfaceBounds };
    },
    // The operator token comes from the launcher environment when present, or
    // from Delegate Wave's existing DPAPI-protected operator record otherwise.
    // Plaintext stays in main and is never persisted, logged, or exposed.
    delegateWave: new DelegateWaveRelay(
      delegateWaveConfig,
      (url, init) => fetch(url, init),
      () => randomUUID(),
    ),
    isBackpackProjectSender: isProjectSurfaceSender,
    decideProjectSurfaceRequest: projectSurfaceRequestDecision,
    surfaces: surfaceContexts,
    waitForBackpackProjectAuthority: (senderId) => projectSurfaceAuthority.wait(senderId),
    logicalSurfaces,
    retireLogicalSurface,
    moveLogicalSurface,
    refreshVisualSemanticKeys: (windowId, surfaceId) => {
      refreshCurrentVisualSemanticKeys({
        isLiveIn: (candidateSurfaceId, candidateWindowId) =>
          papersWindows.has(candidateWindowId) && logicalSurfaces.isLiveIn(candidateSurfaceId, candidateWindowId),
        runtimeForSurface: (candidateWindowId, candidateSurfaceId) =>
          papersWindows.get(candidateWindowId)?.owned.projectSurfaces.get(candidateSurfaceId) ?? null,
        contextForSender: (senderId) => {
          const context = surfaceContexts.contextForSender(senderId);
          return context?.surfaceId
            ? { windowId: context.windowId, surfaceId: context.surfaceId }
            : null;
        },
        bindSender: bindVisualSemanticKeySender,
      }, windowId, surfaceId);
    },
    // Phase 1B: a real lookup, with no singleton fallback left. A host
    // renderer resolves through the window registry; a project, detached or
    // widget sender resolves through the surface binding it already carries.
    // Anything else is refused.
    windowIdForSender: (senderId) => papersWindows.windowForSender(senderId)
      ?? surfaceContexts.contextForSender(senderId)?.windowId
      ?? null,
    showBackpackProjectSurface: async (senderId, surfaceId, url, present = true) => {
      const runtime = runtimeForHostSurface(senderId, surfaceId);
      if (!runtime) throw new Error('This surface has no Papers window.');
      const owningWindowId = papersWindows.windowForSender(senderId)
        ?? surfaceContexts.contextForSender(senderId)?.windowId
        ?? null;
      let stagedFrameSender: number | null = null;
      try {
        await runtime.show(url, {
          present,
          beforeLoad: (nextFrameSender) => {
            stagedFrameSender = nextFrameSender;
            const projectId = runtime.liveProjectId;
            if (!projectId || owningWindowId === null) return;
            // Bind before navigation so a bootstrap diagnostic can be
            // resolved through the same sender-authority path as a later IPC
            // signal. A staged cross-window runtime has no logical binding yet
            // and therefore remains fail-closed in that resolver.
            surfaceContexts.bind(nextFrameSender, {
              surfaceId,
              projectId,
              windowId: owningWindowId,
              kind: 'project',
            });
            bindVisualSemanticKeySender(owningWindowId, surfaceId, nextFrameSender);
          },
        });
        if (owningWindowId !== null) {
          const state=outerPagePresentation.get(`${owningWindowId}:${surfaceId}`);outerPagePresentation.set(`${owningWindowId}:${surfaceId}`,{bounds:state?.bounds??runtime.currentBounds,visible:present});
          officeEditor?.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present);
          windowsPreview?.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present);
          pdfPreview.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present);
          htmlPreview.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present);
          webBrowser.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present); chromePane?.setOwnerVisible(`${owningWindowId}:${surfaceId}`, present);panePages?.refresh();
        }
      } catch (caught) {
        if (stagedFrameSender !== null) surfaceContexts.unbind(stagedFrameSender);
        throw caught;
      }
      // Phase 1A: bind both senders that may act for this project — the host
      // view that opened it and the project frame it hosts. The project id is
      // the surface origin's host, so the binding is derived from the surface
      // itself rather than from whatever was opened most recently.
      // The host surface was bound when the project opened; this binds the
      // project frame it now hosts, in the same window.
      const projectId = runtime.liveProjectId;
      const frameSender = runtime.senderId;
      if (projectId && frameSender !== null && owningWindowId !== null) {
        // The surface already exists: the host created it when the project
        // was opened and named it in this call. Binding the frame is attaching
        // a transport to a known identity, never allocating a new one -- "same
        // project" must never come to mean "same surface".
        surfaceContexts.bind(frameSender, {
          surfaceId,
          projectId,
          windowId: owningWindowId,
          kind: 'project',
        });
        bindVisualSemanticKeySender(owningWindowId, surfaceId, frameSender);
        // show() replaces a live surface by hiding the old one first, so
        // without this a dead frame's id would stay bound.
        runtime.onFrameDestroyed(frameSender, () => {
          invalidateVisualSemanticKeySender(owningWindowId, surfaceId, frameSender);
          surfaceContexts.unbind(frameSender);
        });
        runtime.refreshVisualSemanticKeys();
      }
    },
    hideBackpackProjectSurface: (senderId, surfaceId) => {
      // The facade has already validated the target; resolve it again here so
      // one host can never hide another surface in the same native window.
      const windowId = papersWindows.windowForSender(senderId);
      if (windowId !== null) {
        const state=outerPagePresentation.get(`${windowId}:${surfaceId}`);outerPagePresentation.set(`${windowId}:${surfaceId}`,{bounds:state?.bounds??null,visible:false});
        if(panePages?.controls(surfaceId)){panePages.refresh();return;}
        papersWindows.get(windowId)?.owned.projectSurfaces.hide(surfaceId);
        officeEditor?.setOwnerVisible(`${windowId}:${surfaceId}`, false);
        windowsPreview?.setOwnerVisible(`${windowId}:${surfaceId}`, false);
        pdfPreview.setOwnerVisible(`${windowId}:${surfaceId}`, false);
        htmlPreview.setOwnerVisible(`${windowId}:${surfaceId}`, false);
        webBrowser.setOwnerVisible(`${windowId}:${surfaceId}`, false); chromePane?.setOwnerVisible(`${windowId}:${surfaceId}`, false);panePages?.refresh();
      }
    },
    setBackpackProjectSurfaceBounds: (senderId, surfaceId, bounds) => {
      const windowId = papersWindows.windowForSender(senderId);
      if (windowId !== null) {
        const state=outerPagePresentation.get(`${windowId}:${surfaceId}`);outerPagePresentation.set(`${windowId}:${surfaceId}`,{bounds,visible:state?.visible??false});
        if(panePages?.controls(surfaceId)){panePages.refresh();return;}
        papersWindows.get(windowId)?.owned.projectSurfaces.setBounds(surfaceId, bounds);
        officeEditor?.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds);
        windowsPreview?.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds);
        pdfPreview.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds);
        htmlPreview.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds);
        webBrowser.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds); chromePane?.setOwnerSurfaceBounds(`${windowId}:${surfaceId}`, bounds);panePages?.refresh();
      }
    },
    setHostOverlayActive: (windowId, active, owner = 'legacy') => {
      const context = papersWindows.get(windowId);
      if (!context || context.owned.window.isDestroyed()) return;
      const owners = hostOverlayOwners.get(windowId) ?? new Set<'picker' | 'workspace-drag' | 'workspace-resize' | 'window-drag' | 'legacy'>();
      if (active) owners.add(owner);
      else owners.delete(owner);
      if (owners.size === 0) hostOverlayOwners.delete(windowId);
      else hostOverlayOwners.set(windowId, owners);

      void chromePane?.coordinator?.setHostOverlayActive?.(windowId, owners.size > 0||pageDragActive);

      applyHostViewBackground(windowId, context.owned.hostView);
      if (owners.size > 0) context.owned.window.contentView.addChildView(context.owned.hostView);
      else {
        context.owned.projectSurfaces.raisePresented();
        pdfPreview.raiseWindow(windowId);
        htmlPreview.raiseWindow(windowId);
        webBrowser.raiseWindow(windowId);
        chromePane?.raiseWindow(windowId);
      }
    },
    runtime,
    canvasState,
    catalog: () => catalog,
    permissionStore,
    paths,
    setTitleBarOverlay: (senderId, color, symbolColor) => {
      // Repaint the native window controls to match the active Papers theme.
      const windowId = papersWindows.windowForSender(senderId);
      const context = windowId === null ? null : papersWindows.get(windowId);
      if (windowId === null || !context || context.owned.window.isDestroyed() || context.owned.hostView.webContents.isDestroyed()) {
        return;
      }
      context.owned.window.setTitleBarOverlay?.({ color, symbolColor, height: TITLE_BAR_HEIGHT });
      context.owned.window.setBackgroundColor(
        papersSettings.transparentWindow ? TRANSPARENT_SURFACE_COLOR : color,
      );
      applyHostViewBackground(windowId, context.owned.hostView);
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

  registerHostIpc(facade, (sender, start) => {
    const id = papersWindows.windowForSender(sender.id);
    return nativeFileDrag(id === null ? BrowserWindow.fromWebContents(sender) : papersWindows.get(id)?.owned.window ?? null, start);
  });
  const windowCapabilityService = createWindowCapabilityService({
    // Papers itself is a useful saved layout member. Admit only the real main
    // shell by its fixed native title; same-process picker, widget, preview and
    // overlay utility windows retain empty/data titles and remain ineligible.
    allowCurrentProcessWindow: (observation) => observation.title === 'Papers',
    // Bringing a member's window forward is done by Papers itself, because
    // Papers owns the click that asked for it. Windows refuses a foreground
    // switch from a background worker, and a refusal flashes the taskbar button
    // instead of raising the window.
    foregroundBridge: () => foregroundBridge,
  });
  const windowControlBroker = createWindowControlBroker({
    cacheDirectory: path.join(app.getPath('userData'), 'native-helpers'),
    sourcePath: resolveWindowControlSourcePath({
      appPath: app.getAppPath(), resourcesPath: process.resourcesPath, packaged: app.isPackaged,
    }),
    onUnavailable: (reason) => {
      for (const sender of webContents.getAllWebContents()) {
        if (isProjectSurfaceSender(sender) && !sender.isDestroyed()) {
          sender.send('papers:window-control:unavailable', reason);
        }
      }
    },
  });
  registerWindowCapabilityIpc({
    ipcMain,
    service: windowCapabilityService,
    decorateCandidates: (sender,candidates) => {
      const context = surfaceContexts.contextForSender(sender.id);
      const owner = context?.surfaceId ? `${context.windowId}:${context.surfaceId}` : undefined;
      return candidates.map(candidate => {
        const inUse = candidate.windowInstanceId ? chromePane?.coordinator?.ownership(candidate.windowInstanceId,owner) : undefined;
        return inUse ? {...candidate,inUse} : candidate;
      });
    },
    isSender: isProjectSurfaceSender,
    waitForAuthority: (sender) => projectSurfaceAuthority.wait(sender.id),
    controlBroker: windowControlBroker,
    // The native foreground bridge takes a HANDLE, and the broker's registration has
    // already proved one for every member - so activation costs one native process
    // and never touches the window helper.
    activateForeground: () => foregroundBridge,
    // PAPERS TAKES THE FOREGROUND FOR THE ONE PRESS THAT NEEDS ACTIVATION.
    //
    // Windows hands the foreground only to a process that is foreground-eligible, and
    // a resident background broker never is. The bridge is spawned BY Papers, so if
    // Papers owns the foreground at that instant the child inherits the eligibility.
    // Released immediately afterwards, so the widget does not stay focusable and
    // ordinary icon clicks still never steal focus.
    focusForActivation: async (sender) => {
      const owner = BrowserWindow.fromWebContents(sender);
      if (!owner || owner.isDestroyed()) return null;
      const surface = widgetRegistry.surface(sender.id);
      return focusSurfaceForForeignActivation(
        owner,
        surface?.kind === COMPACT_WIDGET_SURFACE_KIND ? COMPACT_WIDGET_TOPMOST_LEVEL : 'floating',
      );
    },
    resolveControlSurface: (sender, rect) => {
      const owner = BrowserWindow.fromWebContents(sender);
      if (!owner || owner.isDestroyed() || !owner.isVisible()) return null;
      const handle = owner.getNativeWindowHandle();
      const ownerHwnd = Number(handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0)));
      const content = owner.getContentBounds();
      const a = screen.dipToScreenPoint({ x: Math.round(content.x + rect.x), y: Math.round(content.y + rect.y) });
      const b = screen.dipToScreenPoint({ x: Math.round(content.x + rect.x + rect.width), y: Math.round(content.y + rect.y + rect.height) });
      return { ownerHwnd, hit: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } };
    },
    // A project hover preview uses Papers' own always-on-top preview window
    // instead of an in-page popover, which could only ever be as visible as the
    // project window itself. Same primitive the compact widget uses; placed
    // from the hovered element rather than from the whole window.
    showProjectPreview: (sender, preview) => showPreviewWindow(sender, preview, 'anchor'),
    hideProjectPreview: (senderId) => hideWidgetPreview(senderId),
    resolveCallerHwnd: (sender) => {
      const owner = BrowserWindow.fromWebContents(sender);
      if (!owner || owner.isDestroyed()) return null;
      const handle = owner.getNativeWindowHandle();
      return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
    },
    canBeginPeek: sender => {
      const owner = BrowserWindow.fromWebContents(sender);
      return !owner || (!owner.isDestroyed() && owner.isVisible());
    },
  });
  // One global direct-onscreen pick session. The resident native control
  // service owns input and temporary feedback, then returns identities to
  // Papers for capability validation. No AHK process or renderer pointer RPC.
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
    // Resolve project and owner together. Looking up the first project match
    // and checking ownership afterwards would miss a later exact match.
    sendToWorkspace: (projectId, owningWindowId, channel, payload) => {
      const workspace = detachRegistry.surfaceForProject(
        projectId,
        'workspace',
        (senderId) => surfaceContexts.contextForSender(senderId)?.windowId === owningWindowId,
      );
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
    waitForAuthority: (sender) => projectSurfaceAuthority.wait(sender.id),
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
  // Widgets can be restored before the native Alt+Q helper is constructed.
  // Keep those HWND registrations instead of silently dropping them; otherwise
  // the helper sees the cursor over a live widget as "outside" until that widget
  // is recreated.
  const pendingHoverWidgetRegistrations = new Map<number, Buffer>();
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
      getCursorScreenPoint: () => screen.getCursorScreenPoint(),
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
    resolveEntryUrl: (projectId, owningWindowId, workspaceSenderId) => {
      const surfaces = papersWindows.get(owningWindowId)?.owned.projectSurfaces;
      if (workspaceSenderId !== undefined) {
        const runtime = surfaces?.all().find(candidate => candidate.senderId === workspaceSenderId);
        return runtime?.liveProjectId === projectId ? runtime.liveEntryUrl : null;
      }
      return surfaces?.entryUrlForProject(projectId) ?? null;
    },
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
        // Legacy mode starts non-focusable. Alt+Q enables mouse activation so
        // Windows delivers icon presses, while showInactive preserves the
        // current foreground window when the widget is summoned.
        focusable: false,
        skipTaskbar: true,
        minWidth: COMPACT_WIDGET_MIN_WIDTH,
        minHeight: COMPACT_WIDGET_MIN_HEIGHT,
        show: false,
        webPreferences: {
          // Hidden/offscreen compact widgets are summoned immediately again.
          // Chromium's visibility throttling can retain the hidden renderer
          // state after showInactive(), presenting a stale frame on reopen.
          backgroundThrottling: false,
          preload: widgetPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
        },
      });
      widgetWindow.setMenuBarVisibility(false);
      widgetWindow.setAlwaysOnTop(true, COMPACT_WIDGET_TOPMOST_LEVEL);
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
        if (!widgetWindow.isDestroyed() && !widgetWindow.isMinimized()) {
          widgetWindow.showInactive();
          // Re-assert topmost AFTER the window is shown. `alwaysOnTop: true` and
          // the setAlwaysOnTop call at construction stopped taking effect once
          // the window became non-activating: measured with the native styles,
          // the widget came up with NOACTIVATE set and TOPMOST CLEARED, so it
          // sank behind ordinary windows and clicks landed on whatever was in
          // front of it. Being in front and being focusable are independent, and
          // this is the pair the creator actually wants.
          widgetWindow.setAlwaysOnTop(true, COMPACT_WIDGET_TOPMOST_LEVEL);
        }
      });
      bindOwnedProjectSurface(widgetWindow, projectId, 'widget', owningWindowId);
      return widgetWindow;
    },
    onWidgetRegistered: (senderId, handle) => {
      if (hoverInputBridge) hoverInputBridge.registerWidget(senderId, handle);
      else pendingHoverWidgetRegistrations.set(senderId, Buffer.from(handle));
    },
    onWidgetHidden: () => {
      void windowCapabilityService.endLivePreview?.().catch(error => console.error('[papers] widget peek dismissal:', error));
      void windowCapabilityService.endPeek().catch(error => console.error('[papers] widget peek dismissal:', error));
    },
    onWidgetRemoved: (senderId) => {
      const pending = pendingHoverCaptures.get(senderId);
      if (pending?.opening) {
        pendingHoverCaptures.delete(senderId);
        for (const item of pending.buffer) item.resolve?.({ ok: false, detail: 'the source widget closed during Quick Run handoff' });
        for (const wake of pending.wake) wake();
        void hoverInputBridge?.setOverlayOpen(false);
      }
      for (const [key, seal] of pendingWidgetSeals) {
        if (seal.senderId !== senderId) continue;
        clearTimeout(seal.timer);
        pendingWidgetSeals.delete(key);
        seal.reject(new Error('the source widget closed during Quick Run handoff'));
      }
      pendingHoverWidgetRegistrations.delete(senderId);
      hoverInputBridge?.removeWidget(senderId);
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
  type QuickRunCapture = { captureId: string; text: string; resolve?: (result: { ok: boolean; detail: string }) => void };
  type PendingHoverCapture = { projectId: string; opening: boolean; buffer: QuickRunCapture[]; wake: Array<() => void> };
  const pendingHoverCaptures = new Map<number, PendingHoverCapture>();
  const pendingCommandSurfaceAcks = new Map<string, { projectId: string; senderId: number; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const pendingWidgetSeals = new Map<string, { senderId: number; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  let quickRunDeliverySequence = 0;
  let quickRunSealSequence = 0;
  const nextQuickRunDeliveryId = (): string => `papers-${Date.now()}-${++quickRunDeliverySequence}`;
  const appendHoverCapture = async (senderId: number, text: string, waitForReceipt: boolean): Promise<{ ok: boolean; detail: string }> => {
    const pending = pendingHoverCaptures.get(senderId);
    if (!pending) return { ok: false, detail: 'there is no Quick Run handoff for this widget' };
    if (pending.opening) {
      if (pending.buffer.length >= 64) return { ok: false, detail: 'the Quick Run opening buffer is full' };
      if (!waitForReceipt) {
        pending.buffer.push({ captureId: nextQuickRunDeliveryId(), text });
        for (const wake of pending.wake.splice(0)) wake();
        return { ok: true, detail: 'the character was queued for Quick Run' };
      }
      return new Promise((resolve) => {
        pending.buffer.push({ captureId: nextQuickRunDeliveryId(), text, resolve });
        for (const wake of pending.wake.splice(0)) wake();
      });
    }
    const result = await commandSurfaceOverlay?.appendForProject(pending.projectId, text, nextQuickRunDeliveryId());
    return result ?? { ok: false, detail: 'the command surface is unavailable' };
  };
  const requestWidgetQuickRunSeal = (senderId: number, generation: number): Promise<void> => {
    const surface = widgetRegistry.surface(senderId);
    const contents = webContents.fromId(senderId);
    if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND || !contents || contents.isDestroyed()) {
      return Promise.reject(new Error('the Quick Run source widget is no longer available'));
    }
    const key = `${senderId}:${generation}`;
    if (pendingWidgetSeals.has(key)) return Promise.reject(new Error('a Quick Run seal is already pending'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingWidgetSeals.delete(key);
        reject(new Error('the widget did not seal its queued Quick Run characters'));
      }, 3000);
      pendingWidgetSeals.set(key, { senderId, resolve, reject, timer });
      contents.send('papers:backpack:widget-quick-run-seal-request', { generation });
    });
  };
  const acknowledgeWidgetQuickRunSeal = (senderId: number, generation: number): boolean => {
    const key = `${senderId}:${generation}`;
    const pending = pendingWidgetSeals.get(key);
    if (!pending || pending.senderId !== senderId) return false;
    clearTimeout(pending.timer);
    pendingWidgetSeals.delete(key);
    pending.resolve();
    return true;
  };
  ipcMain.handle('papers:backpack:command-surface-input-ack', async (event, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1
      || typeof raw.captureId !== 'string' || raw.captureId.length > 128) {
      throw new Error('command-surface input acknowledgement is malformed');
    }
    const context = surfaceContexts.contextForSender(event.sender.id);
    const pending = pendingCommandSurfaceAcks.get(raw.captureId);
    if (!pending || event.sender.id !== commandSurfaceSenderId || pending.senderId !== event.sender.id
      || context?.kind !== 'launcher' || context.projectId !== pending.projectId) {
      throw new Error('command-surface input acknowledgement is stale or unauthorized');
    }
    clearTimeout(pending.timer);
    pendingCommandSurfaceAcks.delete(raw.captureId);
    pending.resolve();
    return { ok: true };
  });
  const deliverQueuedHoverCaptures = async (pending: PendingHoverCapture): Promise<void> => {
    while (pending.buffer.length > 0) {
      const next = pending.buffer.shift()!;
      try {
        const delivered = await commandSurfaceOverlay?.appendForProject(pending.projectId, next.text, next.captureId);
        const result = delivered ?? { ok: false, detail: 'the command surface is unavailable' };
        next.resolve?.(result);
        if (!result.ok) throw new Error(result.detail);
      } catch (error) {
        next.resolve?.({ ok: false, detail: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  };
  const drainHoverCapture = async (senderId: number, pending: PendingHoverCapture, ready: Promise<void>): Promise<void> => {
    let readyComplete = false;
    void ready.then(() => { readyComplete = true; for (const wake of pending.wake.splice(0)) wake(); });
    while (pendingHoverCaptures.get(senderId) === pending && (!readyComplete || pending.buffer.length > 0)) {
      if (pending.buffer.length > 0) {
        await deliverQueuedHoverCaptures(pending);
        continue;
      }
      await Promise.race([ready, new Promise<void>((resolve) => pending.wake.push(resolve))]);
    }
    pending.opening = false;
  };
  const beginHoverCapture = async (senderId: number, text: string, nativeCapture: boolean): Promise<{ ok: boolean; detail: string }> => {
    const surface = widgetRegistry.surface(senderId);
    if (!surface || surface.kind !== COMPACT_WIDGET_SURFACE_KIND) return { ok: false, detail: 'the widget is no longer registered' };
    const existing = pendingHoverCaptures.get(senderId);
    if (existing && (existing.opening || commandSurfaceOverlay?.isOpen())) {
      return appendHoverCapture(senderId, text, nativeCapture);
    }
    // A hidden launcher can outlive an interrupted close notification. Its
    // old handoff must not absorb the first key of every later Quick Run.
    if (existing) pendingHoverCaptures.delete(senderId);
    if (!commandSurfaceOverlay) return { ok: false, detail: 'the command surface is unavailable' };
    const pending: PendingHoverCapture = { projectId: surface.projectId, opening: true, buffer: [], wake: [] };
    // Publish the queue before the OPENING_READY round-trip. The focused widget
    // can deliver more prevented keydowns while the native helper arms; those
    // appends must have somewhere ordered to wait.
    pendingHoverCaptures.set(senderId, pending);
    try {
      if (!nativeCapture) await hoverInputBridge?.setCaptureOpening(senderId);
      const opened = await commandSurfaceOverlay.openForProject(surface.projectId, text, nextQuickRunDeliveryId());
      if (!opened.ok) throw new Error(opened.detail);
      const generation = ++quickRunSealSequence;
      await requestWidgetQuickRunSeal(senderId, generation);
      // The seal means every widget-originated append has reached this process;
      // apply that queue before the helper may stop capturing. Native-hook
      // characters that arrive just after this drain remain outstanding in the
      // helper and are drained/acknowledged by the live pump below.
      await deliverQueuedHoverCaptures(pending);
      const ready = hoverInputBridge?.setOverlayOpen(true) ?? Promise.resolve();
      const drain = drainHoverCapture(senderId, pending, ready);
      if (nativeCapture) {
        void drain.catch((error: unknown) => {
          console.warn('[papers] Quick Run input handoff failed:', error);
          pendingHoverCaptures.delete(senderId);
          void hoverInputBridge?.setOverlayOpen(false);
        });
        return opened;
      }
      await drain;
      await ready;
      return opened;
    } catch (error) {
      const pending = pendingHoverCaptures.get(senderId);
      pendingHoverCaptures.delete(senderId);
      for (const item of pending?.buffer ?? []) item.resolve?.({ ok: false, detail: 'the Quick Run handoff failed' });
      for (const wake of pending?.wake ?? []) wake();
      void hoverInputBridge?.setOverlayOpen(false);
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  };
  hoverInputBridge = createHoverInputBridge({
    cacheDirectory: path.join(app.getPath('userData'), 'native-helpers'),
    sourcePath: resolveHoverInputBridgeSourcePath({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, packaged: app.isPackaged }),
    onAltQ: (widgetSenderId) => {
      const activation = widgetSession?.beginAltQGesture(widgetSenderId, 'peek');
      if (activation) {
        void activation.then((activated) => {
          if (!activated) console.info('[papers] Alt+Q pressed with no live window-layout widget to activate');
        }).catch((error: unknown) => console.warn('[papers] Alt+Q widget activation rejected', error));
      }
    },
    onAltQRelease: () => widgetSession?.endAltQGesture(),
    onAltW: (senderId) => { void widgetSession?.beginAltQGesture(senderId,'legacy'); },
    onAltWRelease: () => widgetSession?.endAltQGesture(),
    onCaptured: async (senderId, _captureId, text) => {
      const result = await beginHoverCapture(senderId, text, true);
      if (!result.ok) throw new Error(result.detail);
    },
    onAppended: async (senderId, _captureId, text) => {
      const result = await appendHoverCapture(senderId, text, true);
      if (!result.ok) throw new Error(result.detail);
    },
    onError: (message) => console.warn(`[papers] ${message}`),
  });
  if (hoverInputBridge) {
    for (const [senderId, handle] of pendingHoverWidgetRegistrations) {
      hoverInputBridge.registerWidget(senderId, handle);
    }
    pendingHoverWidgetRegistrations.clear();
  }
  const widgetPreviewWindows = new Map<number, BrowserWindow>();
  type PickerCandidate = { id: string; title: string; icon: string | null; current: boolean; inUse?: {transferId:string;label:string;samePage:boolean} };
  type CandidatePickerSession = {
    window: BrowserWindow;
    pickerId: string;
    candidateIds: Set<string>;
    documentReady: boolean;
    delivery?: ReturnType<typeof createCandidatePickerDelivery<PickerCandidate>>;
    resolve: ((result: { action: 'select' | 'close' | 'cancel' | 'direct-pick' | 'move'; candidateId: string | null }) => void) | null;
    dismiss?: () => void;
  };
  const candidatePickerSessions = new Map<number, CandidatePickerSession>();
  const makeCandidatePickerDelivery = (senderId: number, session: CandidatePickerSession) =>
    createCandidatePickerDelivery<PickerCandidate>(async (candidates) => {
      if (candidatePickerSessions.get(senderId) !== session || session.window.isDestroyed()) return false;
      const update = JSON.stringify(candidates).replace(/</g, '\\u003c');
      const applied = await session.window.webContents.executeJavaScript(
        `typeof window.__papersPickerUpdate === 'function' && (window.__papersPickerUpdate(${update}), true)`, true,
      );
      return applied === true && candidatePickerSessions.get(senderId) === session && !session.window.isDestroyed();
    });
  const hideWidgetPreview = (senderId: number): void => {
    const preview = widgetPreviewWindows.get(senderId);
    widgetPreviewWindows.delete(senderId);
    // The signature goes with the window: a later hover must paint, not be
    // skipped as "already showing".
    lastPreviewSignature.delete(senderId);
    previewRevisions.delete(senderId);
    if (preview && !preview.isDestroyed()) preview.destroy();
  };
  /** Papers' own preview window: transparent, never focused, always on top, and
   * never in the page - so a hover preview cannot be hidden behind another
   * window. A widget preview hangs above or below the whole compact widget; a
   * project preview sits beside the hovered element's own screen rectangle. */
  /** What the preview currently shows per sender, so an identical repaint is
   * skipped rather than flashed again. */
  const lastPreviewSignature = new Map<number, string>();
  const previewRevisions = new Map<number, number>();
  const showPreviewWindow = (sender: Electron.WebContents, preview: { imageUrl: string; title: string; width: number; height: number; anchor: { x: number; y: number; width: number; height: number } }, placement: 'widget' | 'anchor'): void => {
    const previewSignature = createHash('sha256').update(preview.imageUrl).digest('hex')
      + `|${preview.width}x${preview.height}|${preview.title}`;
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
      // A widget preview hangs above or below the WHOLE widget, not the hovered
      // icon: at the screen top the fallback begins below the widget's bottom
      // edge, so the name surface can never sit over the preview. A project
      // preview has no owner to hang from - it sits beside the hovered element's
      // own screen rectangle.
      const owner = BrowserWindow.fromWebContents(sender);
      const ownerBounds = owner && !owner.isDestroyed()
        ? owner.getBounds()
        : { x: preview.anchor.x, y: preview.anchor.y, width: preview.anchor.width, height: preview.anchor.height };
      let y: number;
      if (placement === 'anchor') {
        y = Math.round(preview.anchor.y + preview.anchor.height + 8);
        if (y + height > area.y + area.height) y = Math.round(preview.anchor.y - height - 8);
      } else {
        y = Math.round(ownerBounds.y - height - 8);
        if (y < area.y) y = Math.round(ownerBounds.y + ownerBounds.height + 8);
      }
      x = Math.max(area.x, Math.min(area.x + area.width - width, x));
      y = Math.max(area.y, Math.min(area.y + area.height - height, y));
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
      const existing = widgetPreviewWindows.get(sender.id);
      if (existing && !existing.isDestroyed()) {
        if (existing.getBounds().x !== x || existing.getBounds().y !== y) {
          existing.setPosition(x, y);
        }
        if (lastPreviewSignature.get(sender.id) === previewSignature) return;
        lastPreviewSignature.set(sender.id, previewSignature);
        const revision = (previewRevisions.get(sender.id) ?? 0) + 1;
        previewRevisions.set(sender.id, revision);
        const paint = (): void => {
          if (existing.isDestroyed() || widgetPreviewWindows.get(sender.id) !== existing
            || previewRevisions.get(sender.id) !== revision) return;
          const payload = JSON.stringify({ imageUrl: preview.imageUrl, title: preview.title,
            width: preview.width, height: preview.height, revision });
          // Decode offscreen, then swap only the image node. The cached frame
          // stays visible until the fresh frame is ready; the native window and
          // its one-time entrance animation are never recreated.
          void existing.webContents.executeJavaScript(`(() => {
            const next = ${payload}; window.__previewRevision = next.revision;
            const image = new Image(); image.src = next.imageUrl;
            return image.decode().then(() => {
              if (window.__previewRevision !== next.revision) return false;
              const visible = document.querySelector('img');
              const title = document.querySelector('.title');
              const frame = document.querySelector('.preview');
              if (!visible || !title || !frame) return false;
              title.textContent = next.title;
              visible.src = next.imageUrl;
              visible.style.width = next.width + 'px';
              visible.style.height = next.height + 'px';
              frame.style.width = next.width + 'px';
              frame.style.height = (next.height + ${titleHeight}) + 'px';
              return true;
            }).catch(() => false);
          })();`).then((painted) => {
            if (!painted || existing.isDestroyed() || widgetPreviewWindows.get(sender.id) !== existing
              || previewRevisions.get(sender.id) !== revision) return;
            const bounds = existing.getBounds();
            if (bounds.x !== x || bounds.y !== y || bounds.width !== width || bounds.height !== height) {
              existing.setBounds({ x, y, width, height });
            }
          }).catch(() => undefined);
        };
        if (existing.webContents.isLoadingMainFrame()) existing.webContents.once('did-finish-load', paint);
        else paint();
        return;
      }
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
      lastPreviewSignature.set(sender.id, previewSignature);
      void previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(async () => {
        if (previewWindow.isDestroyed() || widgetPreviewWindows.get(sender.id) !== previewWindow) return;
        // The first frame is the cached preview. Wait for its image decode so
        // the preview appears already painted instead of flashing an empty box.
        await previewWindow.webContents.executeJavaScript(
          'document.querySelector("img")?.decode().then(() => true, () => false) ?? false',
        ).catch(() => false);
        if (!previewWindow.isDestroyed() && widgetPreviewWindows.get(sender.id) === previewWindow) {
          previewWindow.showInactive();
        }
      }).catch(() => hideWidgetPreview(sender.id));
  };

  registerCompactWidgetIpc({
    ipcMain,
    registry: widgetRegistry,
    session: widgetSession,
    waitForAuthority: (sender) => projectSurfaceAuthority.wait(sender.id),
    windowIdForWorkspaceSender: windowIdForProjectSender,
    setHoverPolicy: (senderId, enabled, blockedBindings) => {
      if (!hoverInputBridge) return Promise.reject(new Error('native hover-input policy bridge is unavailable'));
      return hoverInputBridge.setPolicy(senderId, enabled, blockedBindings);
    },
    requestHoverQuickRun: (senderId, phase, text) => phase === 'open'
      ? beginHoverCapture(senderId, text, false)
      : appendHoverCapture(senderId, text, false),
    acknowledgeHoverQuickRunSeal: acknowledgeWidgetQuickRunSeal,
    hidePreview: hideWidgetPreview,
    dismissCandidatePicker: async (sender) => {
      const active = candidatePickerSessions.get(sender.id);
      if (!active || active.window.isDestroyed()) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('window chooser did not close')), 8000);
        active.window.once('closed', () => {
          clearTimeout(timer);
          resolve();
        });
        active.dismiss?.();
      });
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
    showCandidatePicker: async (sender, candidates, pickerId) => {
      const active = candidatePickerSessions.get(sender.id);
      if (active && !active.window.isDestroyed()) {
        if (active.pickerId !== pickerId) {
          active.resolve?.({ action: 'cancel', candidateId: null });
          active.delivery?.close();
          active.pickerId = pickerId;
          active.delivery = makeCandidatePickerDelivery(sender.id, active);
          if (active.documentReady) await active.delivery.markReady();
        }
        active.pickerId = pickerId;
        active.candidateIds = new Set(candidates.map((candidate) => candidate.id));
        const delivered = await active.delivery!.update(candidates);
        if (delivered === 'failed' || delivered === 'stale') return { action: 'cancel', candidateId: null };
        if (!active.window.isVisible()) active.window.show();
        active.window.focus();
        return new Promise<{ action: 'select' | 'close' | 'cancel' | 'direct-pick' | 'move'; candidateId: string | null }>((resolve) => {
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
      // A live chooser holds the periodic desktop enumeration off: hover work
      // shares the helper's single request slot with it, and the chooser's own
      // list already carries the snapshot it needs. The release is registered
      // here, not later, so a synchronous failure during setup cannot strand it.
      const lifecycleHold = windowCapabilityService.holdWindowLifecycleRefresh();
      picker.once('closed', lifecycleHold.release);
      const encoded = JSON.stringify(candidates).replace(/</g, '\\u003c');
      const html = `<!doctype html><meta charset="utf-8"><title>Papers Window Chooser</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
 *{box-sizing:border-box}html,body{margin:0;height:100%;background:#161b22;color:#dbe7f3;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}body{border:1px solid #465462;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 14px 38px #0009}.head{padding:7px 13px 10px;border-bottom:1px solid #2b3742}.titleline{display:flex;align-items:center;justify-content:space-between;min-height:27px;margin-bottom:4px;-webkit-app-region:drag}.close,.search,.row,.empty,.filters,.state-filter,.direct-pick,.list{-webkit-app-region:no-drag}.filters{display:flex;align-items:center;gap:8px}.state-filter{display:grid;place-items:center;width:18px;height:18px;margin:0;border:1px solid currentColor;border-radius:4px;background:transparent;cursor:pointer;appearance:none}.state-filter:checked::after{content:'✓';font-size:13px;font-weight:800;line-height:1;color:currentColor}.state-filter.current-filter{color:#ef9c77}.state-filter.available-filter{color:#72a7d5}.state-filter:hover,.state-filter:focus-visible{background:currentColor;box-shadow:0 0 0 2px #ffffff18;outline:none}.state-filter:hover::after,.state-filter:focus-visible::after{color:#161b22}.direct-pick{display:grid;place-items:center;width:18px;height:18px;margin:0 0 0 2px;padding:0;border:1px solid #b782f0;border-radius:4px;background:#8f4bd129;color:#d9b8ff;cursor:pointer}.direct-pick:hover,.direct-pick:focus-visible{background:#8f4bd152;color:#fff;box-shadow:0 0 9px #9d55f699;outline:none}.direct-pick svg{display:block;width:12px;height:12px}.close{border:0;background:transparent;color:#9cacba;font-size:19px;line-height:20px;border-radius:5px;cursor:pointer}.close:hover{background:#31404b;color:#fff}.search{width:100%;height:34px;border:1px solid #536372;border-radius:8px;background:#0e141a;color:#f3f8fc;padding:0 11px;outline:none}.search:focus{border-color:#72a7d5;box-shadow:0 0 0 2px #72a7d533}.list{padding:7px;overflow:auto;flex:1;scrollbar-color:#4b5b68 transparent;display:flex;flex-direction:column}.row,.empty{flex:0 0 auto}.row{width:100%;border:0;background:transparent;color:inherit;display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px;border-radius:8px;text-align:left;cursor:pointer}.row:hover,.row:focus-visible{background:#273540;outline:none}.busy .row{pointer-events:none;opacity:.68}.icon{width:20px;height:20px;object-fit:contain}.fallback{width:16px;height:16px;border:1px solid #83919d;border-radius:3px}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#72a7d5}.state{font-size:11px;color:#72a7d5}.row:has(button){grid-template-columns:24px minmax(0,1fr) auto auto}.row>button{border:1px solid #536372;border-radius:4px;color:#dbe7f3;background:transparent;padding:4px;cursor:pointer}.current .label,.current .state{color:#ef9c77}.empty{padding:24px;text-align:center;color:#8898a7}.drag-space{flex:1 0 28px;min-height:28px;-webkit-app-region:drag}
</style><div class="head"><div class="titleline"><div class="filters" aria-label="Filter window states"><input class="state-filter current-filter" type="checkbox" aria-label="Show layout members" title="Show layout members (remove)"><input class="state-filter available-filter" type="checkbox" aria-label="Show available windows" title="Show available windows (add)"><button class="direct-pick" type="button" aria-label="Pick windows directly" title="Pick windows directly"><svg viewBox="0 0 24 24" aria-hidden="true"><path transform="translate(-1 1)" d="M6.5 3.5l13.5 6.5-6.3 2.1-2.1 6.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button></div><button class="close" aria-label="Close">×</button></div><input class="search" type="search" placeholder="Search windows…" autocomplete="off" spellcheck="false"></div><div class="list" aria-live="polite"></div><script id="data" type="application/json">${encoded}</script><script>
 let all=JSON.parse(document.getElementById('data').textContent),loading=${candidates.length === 0};const list=document.querySelector('.list'),search=document.querySelector('.search'),currentFilter=document.querySelector('.current-filter'),availableFilter=document.querySelector('.available-filter');
function signal(path,id=''){window.candidatePicker.signal(path,id)}
 function appendDragSpace(){const d=document.createElement('div');d.className='drag-space';d.setAttribute('aria-hidden','true');list.append(d)}
function render(){const q=search.value.trim().toLowerCase(),filtering=currentFilter.checked||availableFilter.checked,rows=all.filter(x=>x.title.toLowerCase().includes(q)&&(!filtering||(currentFilter.checked&&x.current)||(availableFilter.checked&&!x.current)));list.replaceChildren();if(!rows.length){const e=document.createElement('div');e.className='empty';e.textContent=loading?'Loading windows…':'No matching windows';list.append(e);appendDragSpace();return}for(const c of rows){const b=document.createElement(c.inUse&&!c.current?'div':'button');b.className='row'+(c.current?' current':'');b.type='button';if(c.icon){const i=document.createElement('img');i.className='icon';i.src=c.icon;b.append(i)}else{const i=document.createElement('span');i.className='fallback';b.append(i)}const l=document.createElement('span');l.className='label';l.textContent=c.title;b.append(l);const s=document.createElement('span');s.className='state';s.textContent=c.current?'Remove':c.inUse?'In use · '+c.inUse.label:'Add';b.append(s);b.onpointerenter=()=>signal('peek',c.id);b.onclick=()=>{if(document.body.classList.contains('busy'))return;document.body.classList.add('busy');signal('select',c.id)};b.onmousedown=e=>{if(e.button===1){e.preventDefault();e.stopPropagation()}};b.onmouseup=e=>{if(e.button!==1)return;e.preventDefault();e.stopPropagation();if(document.body.classList.contains('busy'))return;document.body.classList.add('busy');signal('close',c.id)};b.onauxclick=e=>{if(e.button===1){e.preventDefault();e.stopPropagation()}};if(c.inUse&&!c.current){const m=document.createElement('button');m.type='button';m.textContent='Move here';m.title='Move this window from '+c.inUse.label;m.onclick=e=>{e.preventDefault();e.stopPropagation();if(document.body.classList.contains('busy'))return;document.body.classList.add('busy');signal('move',c.id)};b.append(m)}list.append(b)}appendDragSpace()}
 list.onpointerleave=()=>signal('peek-end');
 window.__papersPickerUpdate=(next)=>{all=next;loading=false;document.body.classList.remove('busy');render()};
const setExclusiveFilter=(selected,other)=>{if(selected.checked)other.checked=false;render()};const cancel=()=>signal('cancel');document.querySelector('.close').onclick=cancel;document.querySelector('.direct-pick').onclick=()=>{document.body.classList.add('busy');signal('direct-pick')};search.oninput=render;currentFilter.onchange=()=>setExclusiveFilter(currentFilter,availableFilter);availableFilter.onchange=()=>setExclusiveFilter(availableFilter,currentFilter);document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel()}else if(e.key==='Enter'&&document.activeElement===search){e.preventDefault();if(!loading&&!document.body.classList.contains('busy'))list.querySelector('.row')?.click()}else if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('.row')?.focus()}});render();search.focus();
</script>`;
      return new Promise<{ action: 'select' | 'close' | 'cancel' | 'direct-pick' | 'move'; candidateId: string | null }>((resolve) => {
        const pickerOpenedAt = Date.now();
        let pickerPointerEntered = false;
        let pickerOutsideSince: number | null = null;
        let pickerPointerWatch: NodeJS.Timeout | null = null;
        let peekGeneration = 0;
        let peekTimer: NodeJS.Timeout | null = null;
        let peekEndTimer: NodeJS.Timeout | null = null;
        const nativeHandle = picker.getNativeWindowHandle();
        const callerHwnd = nativeHandle.length >= 8
          ? nativeHandle.readBigUInt64LE(0).toString()
          : String(nativeHandle.readUInt32LE(0));
        const peekController = createWindowCandidatePeekController({
          endLivePreview: windowCapabilityService.endLivePreview,
          endPeek: () => windowCapabilityService.endPeek(),
        });
        let actionFinishing = false;
        let pickerClosing = false;
        let pickerReleaseConfirmed = false;
        const endCandidatePeek = (): Promise<boolean> => {
          peekGeneration += 1;
          if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          return peekController.end();
        };
        const beginCandidatePeek = (candidateId: string): void => {
          // Keep the isolated eye-test usable if a compositor-specific DWM
          // transition is flashing; the normal product path keeps Peek on.
          if (process.env['PAPERS_DISABLE_LIST_PEEK'] === '1') return;
          if (actionFinishing || pickerClosing) return;
          if (peekEndTimer) { clearTimeout(peekEndTimer); peekEndTimer = null; }
          if (peekTimer) clearTimeout(peekTimer);
          const generation = ++peekGeneration;
          peekTimer = setTimeout(() => {
            peekTimer = null;
            peekController.begin(async () => {
              const bound = await windowCapabilityService.bindCandidate(candidateId);
              if (generation !== peekGeneration || bound.outcome !== 'success') return { outcome: 'missing' };
              // Never fall back to hide/show. A failed DWM preview should be a
              // quiet no-op, not a cascade that flashes every other window.
              return windowCapabilityService.beginLivePreviewCapability
                ? windowCapabilityService.beginLivePreviewCapability(bound.capability, callerHwnd)
                : { outcome: 'helper-unavailable' };
            });
          }, 32);
        };
        const deferCandidatePeekEnd = (): void => {
          if (peekEndTimer) clearTimeout(peekEndTimer);
          peekEndTimer = setTimeout(endCandidatePeek, 80);
        };
        const session: CandidatePickerSession = {
          window: picker,
          pickerId,
          candidateIds: new Set(candidates.map((candidate) => candidate.id)),
          documentReady: false,
          resolve,
        };
        session.delivery = makeCandidatePickerDelivery(sender.id, session);
        candidatePickerSessions.set(sender.id, session);
        const finishAction = (action: 'select' | 'close' | 'move', candidateId: string): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker || !current.resolve || actionFinishing) return;
          actionFinishing = true;
          void endCandidatePeek().then((released) => {
            const latest = candidatePickerSessions.get(sender.id);
            if (!latest || latest.window !== picker || !latest.resolve) return;
            const settle = latest.resolve;
            latest.resolve = null;
            // A requested selection/process end must never race a live preview.
            settle(released ? { action, candidateId } : { action: 'cancel', candidateId: null });
          });
        };
        const finishDirectPick = (): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker || !current.resolve || actionFinishing) return;
          actionFinishing = true;
          void endCandidatePeek().then((released) => {
            const latest = candidatePickerSessions.get(sender.id);
            if (!latest || latest.window !== picker || !latest.resolve) return;
            const settle = latest.resolve;
            latest.resolve = null;
            settle(released ? { action: 'direct-pick', candidateId: null } : { action: 'cancel', candidateId: null });
          });
          // Backpack owns the transition: it closes this chooser only after
          // receiving the typed result and before starting direct pick.
        };
        const closePicker = (): void => {
          const current = candidatePickerSessions.get(sender.id);
          if (!current || current.window !== picker || pickerClosing) return;
          pickerClosing = true;
          void endCandidatePeek().then((released) => {
            if (!released) {
              // Keep the caller HWND alive: DWM needs that exact window for a
              // later disable attempt. Retry without requiring another click.
              pickerClosing = false;
              if (!picker.isDestroyed()) setTimeout(closePicker, 250);
              return;
            }
            const latest = candidatePickerSessions.get(sender.id);
            if (!latest || latest.window !== picker) return;
            candidatePickerSessions.delete(sender.id);
            const settle = latest.resolve;
            latest.resolve = null;
            settle?.({ action: 'cancel', candidateId: null });
            pickerReleaseConfirmed = true;
            if (!picker.isDestroyed()) picker.destroy();
          }).catch(() => { pickerClosing = false; });
        };
        session.dismiss = closePicker;
        sender.once('destroyed', closePicker);
        picker.on('close', (event) => {
          if (pickerReleaseConfirmed) return;
          event.preventDefault();
          closePicker();
        });
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
              : url.pathname.startsWith('/close/') ? 'close' : url.pathname.startsWith('/move/') ? 'move' : null;
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
          if (typeof action !== 'string' || !['select', 'close', 'move', 'cancel', 'peek', 'peek-end', 'direct-pick'].includes(action)) return;
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
          session.delivery?.close();
          // Belt and braces with the release registered at acquisition; both are
          // idempotent. Release first, unconditionally: closePicker() deletes the
          // session before destroying the window, so a session check above this
          // line would silently strand the hold.
          lifecycleHold.release();
          if (pickerPointerWatch) { clearInterval(pickerPointerWatch); pickerPointerWatch = null; }
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
          // Present the picker as soon as its document is ready. A slide/fade
          // added another ~260 ms before it felt usable on the creator's machine.
          picker.show();
          picker.focus();
        });
        picker.webContents.once('did-finish-load', () => {
          const current = candidatePickerSessions.get(sender.id);
          if (current !== session || picker.isDestroyed()) return;
          session.documentReady = true;
          void session.delivery?.markReadyWithRetry().then((result) => {
            // A buffered receipt has already been sent. If all bounded apply
            // attempts fail, dismiss the loading shell instead of stranding it.
            if (result === 'failed' && candidatePickerSessions.get(sender.id) === session) closePicker();
          });
        });
        void picker.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`).catch(() => closePicker());
      });
    },
    updateCandidatePicker: async (sender, candidates, pickerId): Promise<CandidatePickerDeliveryResult> => {
      const active = candidatePickerSessions.get(sender.id);
      if (!active || active.pickerId !== pickerId || active.window.isDestroyed()) return 'stale';
      active.candidateIds = new Set(candidates.map((candidate) => candidate.id));
      return active.delivery!.update(candidates);
    },
    showPreview: (sender, preview) => { showPreviewWindow(sender, preview, 'widget'); },
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
  // Keep the constructor behind the complete application-global composition
  // barrier. A newly loaded host may call any registered bridge immediately.
  let windowDragFailed=false;
  let windowDragSource:number|null=null;
  let windowDragPage:string|undefined;
  let windowDragTimer:ReturnType<typeof setTimeout>|undefined;
  const clearWindowDrag=():void=>{
    if(windowDragTimer)clearTimeout(windowDragTimer);windowDragSource=null;windowDragPage=undefined;
    for(const id of papersWindows.windowIds){const wc=papersWindows.get(id)?.owned.hostView.webContents;if(wc&&!wc.isDestroyed())facade.setHostOverlayActive(wc.id,false,'window-drag');}
  };
  const savedPageMoves=new Set<string>();
  const savedWorkspaceMoves=new Set<string>();
  let drainCapabilitiesForReload: (() => Promise<void>) | undefined;
  const reloadPapers=createPapersReload({file:reloadIntentFile,args:process.argv.slice(1),
    flush:async()=>{
      for(const id of papersWindows.windowIds)await facade.waitForWorkspaceMutation(id);
      const frames=webContents.getAllWebContents().filter(w=>!w.isDestroyed()&&w.getURL().startsWith('papers-backpack://')).flatMap(w=>[w.mainFrame,...w.mainFrame.frames]);
      for(const frame of frames){
        if(!shouldFlushReloadSurface(frame.url))continue;
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{const result=await Promise.race([frame.executeJavaScript('globalThis.__papersFlushBeforeClose?.()'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A page did not finish saving. Papers remains open.')),8000);})]);
          if(result&&typeof result==='object'&&(result as {ok?:boolean}).ok===false)throw Error('A page could not save. Papers remains open.');
        }finally{if(timer)clearTimeout(timer);}
      }
    },save:async()=>{
      const instances=papersWindows.windowIds.map(id=>papersWindows.get(id)!.owned);
      for(const instance of instances)await saveSessionWindow(instance);
      await workspaceTopologyStore.flush();await workspaceLayoutStore.flush();
      return instances.map(instance=>workspaceIds.get(instance.window.id)!);
    },restart:args=>{if(!drainCapabilitiesForReload)throw Error('Reload is not ready.');app.relaunch({args});setImmediate(()=>{void drainCapabilitiesForReload!().then(()=>app.exit(0));});},
  });
  registerPapersWindowIpc({
    reload:reloadPapers,
    ipcMain,
    isHostSender: (sender) => facade.isHostSender(sender),
    createAdditionalWindow: async () => { await createAdditionalPapersWindow(); },
    pageDrag:async(sender,active,pageId)=>{const id=papersWindows.windowForSender(sender.id);if(active&&(id===null||!pageId||!logicalSurfaces.isLiveIn(pageId,id)))throw Error('That page is not available to drag.');pageDragActive=active;pageDragId=active?pageId!:null;if(pageDragExpiry)clearTimeout(pageDragExpiry);if(active)pageDragExpiry=setTimeout(()=>{pageDragActive=false;pageDragId=null;for(const id of papersWindows.windowIds)void chromePane?.coordinator?.setHostOverlayActive?.(id,Boolean(hostOverlayOwners.get(id)?.size));},30000);await Promise.all(papersWindows.windowIds.map(id=>chromePane?.coordinator?.setHostOverlayActive?.(id,active||Boolean(hostOverlayOwners.get(id)?.size))));},
    moveFailed:(sender,item)=>{
      const id=item.surfaceId?papersWindows.windowIds.find(id=>currentWorkspaceTopology(id)?.surfaces.some(p=>p.surfaceId===item.surfaceId))
        :item.sourceId??papersWindows.windowForSender(sender.id);
      const wc=id==null?undefined:papersWindows.get(id)?.owned.hostView.webContents;
      if(wc&&!wc.isDestroyed())wc.send('host:event:move-rejected',{key:item.key,surfaceId:item.surfaceId,window:!item.key&&!item.surfaceId});
    },
    dragOutcome:ok=>{windowDragFailed=!ok;},
    dragState:()=>windowDragSource===null?null:{sourceId:windowDragSource,key:windowDragPage},
    drag:async(sender,active,key,cancelled)=>{
      const id=papersWindows.windowForSender(sender.id);if(id===null)throw Error('Papers window unavailable.');
      if(!active){if(windowDragSource===id){if(windowDragFailed&&!cancelled){const wc=papersWindows.get(id)?.owned.hostView.webContents;if(wc&&!wc.isDestroyed())wc.send('host:event:move-rejected',{key:windowDragPage,window:!windowDragPage});}clearWindowDrag();windowDragFailed=false;}return;}
      if(windowDragSource!==null&&windowDragSource!==id)throw Error('Another drag is active.');
      if(windowDragSource!==id||windowDragPage!==key)windowDragFailed=false;windowDragSource=id;windowDragPage=key;if(windowDragTimer)clearTimeout(windowDragTimer);
      windowDragTimer=setTimeout(clearWindowDrag,30000);
      for(const target of papersWindows.windowIds)facade.setHostOverlayActive(papersWindows.get(target)!.owned.hostView.webContents.id,true,'window-drag');
    },
    swapWindow:async(sender,sourceId,commit)=>{
      const targetId=papersWindows.windowForSender(sender.id);
      const source=papersWindows.get(sourceId)?.owned.window,target=targetId===null?undefined:papersWindows.get(targetId)?.owned.window;
      if(windowDragSource!==sourceId||!source||!target)return {ok:false,error:'That window drag is no longer active.'};
      if(screen.getDisplayMatching(source.getBounds()).scaleFactor!==screen.getDisplayMatching(target.getBounds()).scaleFactor)
        return {ok:false,error:'These windows use different display scales.'};
      return swapPapersWindows(source,target,async(window,bounds)=>{
        const id=window===source?sourceId:targetId!;const old=window.getBounds();
        return await chromePane?.coordinator?.canFitWindow(id,bounds.width-old.width,bounds.height-old.height)??true;
      },commit);
    },
    dropSavedPage:async(sender,key,groupId,side,commit)=>{
      const targetId=papersWindows.windowForSender(sender.id);
      const topology=targetId===null?null:currentWorkspaceTopology(targetId);
      const window=targetId===null?undefined:papersWindows.get(targetId)?.owned.window;
      const saved=(await workspaceTopologyStore.sessionSnapshots()).find(record=>record.topology.surfaces.some(page=>(page.surfaceKey??page.surfaceId)===key));
      if(!topology||!window||window.isDestroyed()||!saved||[...workspaceIds.values()].includes(saved.workspaceId))return {ok:false,error:'That saved page or destination is no longer available.'};
      const bounds=window.getContentBounds();
      if(!savedPageDropFits(topology,groupId,side,bounds.width,bounds.height-32))return {ok:false,error:'There is not enough room for that split.'};
      const area=savedPageDropArea(topology,groupId,side,bounds.width,bounds.height-32)!;
      if(side!=='center'&&chromePane?.coordinator&&!await chromePane.coordinator.canFitPageGroup(targetId!,topology.groups.find(g=>g.groupId===groupId)!.surfaceIds,area.width,area.height-32))
        return {ok:false,error:'The existing applications cannot fit in that split.'};
      if(!commit)return {ok:true};
      if(savedPageMoves.has(key)||savedWorkspaceMoves.has(saved.workspaceId))throw Error('That page is already moving.');savedPageMoves.add(key);savedWorkspaceMoves.add(saved.workspaceId);
      try{
        const targetWorkspaceId=workspaceIds.get(targetId!)!;
        const before=await workspaceTopologyStore.snapshotPair(saved.workspaceId,targetWorkspaceId);
        const page=saved.topology.surfaces.find(page=>(page.surfaceKey??page.surfaceId)===key)!;
        await facade.openSavedPageFromControl(targetId!,{projectId:page.projectId,surfaceKey:key,title:page.title},{groupId,side},
          async next=>{if([...workspaceIds.values()].includes(saved.workspaceId))throw Error('That saved window reopened during the drag.');
            const current=window.getContentBounds();
            // The prepared page already exists in the logical registry, but is not
            // adopted into the canonical tree yet. Compare that committed tree.
            if(JSON.stringify(workspaceTopologies.get(targetId!))!==JSON.stringify(topology)||current.width!==bounds.width||current.height!==bounds.height)
              throw Error('The destination layout changed during the drag. Try again.');
            await workspaceTopologyStore.commitPair({source:{workspaceId:saved.workspaceId,topology:closeWorkspaceSurface(saved.topology,page.surfaceId)},target:{workspaceId:targetWorkspaceId,topology:next},lastWorkspaceId:before.lastWorkspaceId},key,saved.topology);},
          ()=>workspaceTopologyStore.restorePairWithIds(before,saved.workspaceId,targetWorkspaceId));
        return {ok:true};
      }finally{savedPageMoves.delete(key);savedWorkspaceMoves.delete(saved.workspaceId);}
    },
    adoptPage: async (sender,surfaceId) => {
      const targetWindowId = papersWindows.windowForSender(sender.id);
      if(targetWindowId===null)throw new Error('Papers window is unavailable.');
      return facade.adoptWorkspaceSurfaceFromHost(sender.id,surfaceId,
        currentWorkspaceTopology(targetWindowId)?.focusedGroupId??'group-main',2147483647);
    },
    detachPage: async (sender,surfaceId) => {
      const sourceWindowId = papersWindows.windowForSender(sender.id);
      if(sourceWindowId===null || !logicalSurfaces.isLiveIn(surfaceId,sourceWindowId))throw new Error('That page is no longer here.');
      const targetWindowId = await createAdditionalPapersWindow();
      try {
        return await facade.moveWorkspaceSurfaceFromHost(sender.id,{surfaceId,targetWindowId,targetGroupId:'group-main',targetIndex:0});
      } catch(error) {
        if(!currentWorkspaceTopology(targetWindowId)?.surfaces.length)papersWindows.get(targetWindowId)?.owned.window.close();
        throw error;
      }
    },
    listWindows: async sender => papersWindows.windowIds.map(windowId=>({
      windowId,current:papersWindows.windowForSender(sender.id)===windowId,
      title:currentWorkspaceTopology(windowId)?.surfaces.map(page=>page.title).join(' · ')||'Papers',
      groupId:currentWorkspaceTopology(windowId)?.groups[0]?.groupId??'group-main',
    })),
    listPages: async sender => (await workspaceTopologyStore.sessionSnapshots()).flatMap(record=>record.topology.surfaces.map(page=>{
      const windowId=[...workspaceIds].find(([,id])=>id===record.workspaceId)?.[0]??null;
      return {key:page.surfaceKey??page.surfaceId,title:page.title,workspaceId:record.workspaceId,windowId,current:windowId===papersWindows.windowForSender(sender.id)};
    })),
    closePage: async key => {
      const record=(await workspaceTopologyStore.sessionSnapshots()).find(r=>r.topology.surfaces.some(p=>(p.surfaceKey??p.surfaceId)===key));
      if(savedPageMoves.has(key)||record&&savedWorkspaceMoves.has(record.workspaceId))throw Error('Wait for the page move to finish.');
      for(const windowId of papersWindows.windowIds){const page=currentWorkspaceTopology(windowId)?.surfaces.find(page=>(page.surfaceKey??page.surfaceId)===key);
        if(page){const sender=papersWindows.get(windowId)!.owned.hostView.webContents.id;await facade.closeBackpackProject(sender,page.surfaceId);await workspaceTopologyStore.closeSavedPage(key);return;}
      }
      await workspaceTopologyStore.closeSavedPage(key);
    },
    showPage: async key => {
      for(const windowId of papersWindows.windowIds){const page=currentWorkspaceTopology(windowId)?.surfaces.find(page=>(page.surfaceKey??page.surfaceId)===key);
        if(page){await facade.activateBackpackProjectSurface(papersWindows.get(windowId)!.owned.hostView.webContents.id,page.surfaceId);const window=papersWindows.get(windowId)!.owned.window;if(window.isMinimized())window.restore();window.focus();return;}
      }
      // A window explicitly closed with X stays parked after reboot. The
      // Pages menu can reopen that saved window on demand, with its other
      // pages and native layout still associated with the same workspace ID.
      const saved=(await workspaceTopologyStore.sessionSnapshots()).find(record=>record.topology.surfaces.some(page=>(page.surfaceKey??page.surfaceId)===key));
      if(!saved)throw new Error('That saved page no longer exists.');
      if(savedWorkspaceMoves.has(saved.workspaceId))throw Error('Wait for the page move to finish.');
      const id=await createAdditionalPapersWindow(saved);
      const window=papersWindows.get(id)?.owned.window;
      if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.focus();}
    },
  });
  const resolveVisualTarget = (sender: { id: number }) => resolveVisualDiagnosticTarget(sender, {
    hostWindowForSender: (senderId) => papersWindows.windowForSender(senderId),
    isCurrentHostSender: (candidate, windowId) => papersWindows.get(windowId)?.owned.hostView.webContents.id === candidate.id,
    projectContextForSender: (senderId) => {
      const context = surfaceContexts.contextForSender(senderId);
      return context?.surfaceId ? { windowId: context.windowId, surfaceId: context.surfaceId } : null;
    },
    isLiveSurface: (surfaceId, windowId) => logicalSurfaces.isLiveIn(surfaceId, windowId),
    isCurrentProjectSender: (candidate, windowId, surfaceId) =>
      papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.isSender(candidate as WebContents) === true,
  });
  registerVisualDiagnosticsIpc({
    ipcMain,
    resolveTarget: resolveVisualTarget,
    bufferForWindow: (windowId) => visualDiagnosticsByWindow.get(windowId) ?? null,
    onDocumentInstance: (senderId, target, documentInstanceId) => {
      if (target.surfaceId) visualSurfaceObservationState.bindDocumentInstance(target.windowId, target.surfaceId, senderId, documentInstanceId);
    },
    isCurrentDocumentInstance: (senderId, target, documentInstanceId) => {
      if (!target.surfaceId) return false;
      const state = visualSurfaceObservationState.snapshot(target.windowId, target.surfaceId);
      if (!state) {
        return false;
      }
      if (state.senderId !== senderId) return false;
      if (state.documentInstanceId === documentInstanceId) return true;
      return false;
    },
    onRendererSignal: (senderId, target, payload) => {
      if (!target.surfaceId || payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
      const phase = (payload as { phase?: unknown }).phase;
      if (phase === 'state-hydrated') {
        const revision = (payload as { revision?: unknown }).revision;
        if (typeof revision === 'string') {
          visualSurfaceObservationState.markHydrated(target.windowId, target.surfaceId, senderId, revision);
        }
      } else if (phase === 'first-paint') {
        visualSurfaceObservationState.markFirstPaint(target.windowId, target.surfaceId, senderId);
      } else if (phase === 'layout-epoch') {
        const epoch = (payload as { epoch?: unknown }).epoch;
        if (typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch >= 0) {
          visualSurfaceObservationState.markLayoutEpoch(target.windowId, target.surfaceId, senderId, epoch);
          resetVisualSemanticKeyObservation(target.windowId, target.surfaceId, senderId);
        }
      } else if (phase === 'layout-stable') {
        const epoch = (payload as { epoch?: unknown }).epoch;
        visualSurfaceObservationState.markLayoutStable(target.windowId, target.surfaceId, senderId,
          typeof epoch === 'number' && Number.isSafeInteger(epoch) ? epoch : undefined);
      } else if (phase === 'render-failed') {
        visualSurfaceObservationState.markRenderFailed(target.windowId, target.surfaceId, senderId);
      }
    },
  });
  registerVisualSemanticKeysIpc({
    ipcMain,
    resolveTarget: resolveVisualTarget,
    registryForTarget: ({ windowId, surfaceId }, senderId) => {
      if (!papersWindows.has(windowId) || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
      const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
      return state?.currentSenderId === senderId ? state.registry : null;
    },
    onObserved: ({ windowId, surfaceId }, senderId, keys, observations, layoutEpoch, viewportCss) => {
      visualSurfaceObservationState.replaceSemanticKeys(windowId, surfaceId, senderId, keys);
      const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
      const current = visualSurfaceObservationState.snapshot(windowId, surfaceId);
      if (state?.currentSenderId === senderId && observations && current?.layoutStable
        && layoutEpoch === current.layoutEpoch) {
        state.observations = observations.map((observation) => ({ ...observation }));
        state.viewportCss = viewportCss ? { ...viewportCss } : null;
      } else if (state?.currentSenderId === senderId) {
        state.observations = [];
        state.viewportCss = null;
      }
    },
    isCurrentDocumentInstance: ({ windowId, surfaceId }, senderId, documentInstanceId) => {
      const state = visualSurfaceObservationState.snapshot(windowId, surfaceId);
      if (!state) {
        return false;
      }
      if (state.senderId !== senderId) return false;
      if (state.documentInstanceId === documentInstanceId) return true;
      return state.documentInstanceId === documentInstanceId;
    },
  });
  if (process.env['PAPERS_DEV_CONTROL'] === '1') {
    visualResourceMonitor = attachVisualResourceMonitor(
      session.defaultSession.webRequest,
      resolveVisualTarget,
      (windowId) => visualDiagnosticsByWindow.get(windowId) ?? null,
    );
  }
  let papersControlServer: PapersControlServer | null = null;
  if (process.env['PAPERS_DEV_CONTROL'] === '1') {
    const descriptorPath = process.env['PAPERS_DEV_CONTROL_DESCRIPTOR']
      ?? path.join(baseDir, 'dev-control.json');
    const windowsSnapshot = () => papersWindows.all().map((context) => ({
      windowId: context.windowId,
      hostAlive: !context.owned.hostView.webContents.isDestroyed(),
      nativeWindowAlive: !context.owned.window.isDestroyed(),
      enteredBackpackId: context.enteredBackpackId,
    }));
    const eventHub = createPapersControlEventHub();
    controlEventHub = eventHub;
    const captureProjectVisual = visualArtifactStore && processInstanceIdentity
      ? (target: { windowId: number; surfaceId: string }, elementRequest?: { elementKey: string; paddingCssPx: number }, signal?: AbortSignal) => captureVisualSurface({
        processIdentity: () => processInstanceIdentity,
        topologyRevision: (windowId) => workspaceTopologyRevisions.get(windowId) ?? 0,
        surface: ({ windowId, surfaceId }) => {
          const found = logicalSurfaces.get(surfaceId);
          if (!found || found.windowId !== windowId || found.kind !== 'project') return null;
          const runtime = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId);
          return {
            projectId: found.projectId,
            presentation: runtime?.isPresented ? 'visible' : runtime ? 'hidden' : 'not-created',
          };
        },
        runtime: ({ windowId, surfaceId }) => {
          const runtime = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId);
          if (!runtime || runtime.senderId === null) return null;
          return {
            senderId: runtime.senderId,
            capturePage: async () => new Uint8Array((await runtime.capturePage()).toPNG()),
            requestFence: (requestId: string, documentInstanceId: string) => {
              const contents = runtime.webContents;
              return contents && visualRendererFence
                ? visualRendererFence.request(contents, requestId, documentInstanceId)
                : Promise.resolve(false);
            },
          };
        },
        observation: ({ windowId, surfaceId }) => visualSurfaceObservationState.snapshot(windowId, surfaceId),
        elementObservations: ({ windowId, surfaceId }) => {
          const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
          const currentSenderId = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.senderId;
          const observationState = visualSurfaceObservationState.snapshot(windowId, surfaceId);
          return state && state.currentSenderId === currentSenderId && observationState?.layoutStable
            ? state.observations
            : [];
        },
        elementViewportCss: ({ windowId, surfaceId }) => {
          const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
          const currentSenderId = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.senderId;
          const observationState = visualSurfaceObservationState.snapshot(windowId, surfaceId);
          return state && state.currentSenderId === currentSenderId && observationState?.layoutStable
            ? state.viewportCss
            : null;
        },
        cropPng: (bytes, request) => {
          const image = nativeImage.createFromBuffer(Buffer.from(bytes));
          const size = image.getSize();
          const bounds = computeVisualElementCropBounds(size, request);
          return {
            bytes: new Uint8Array(image.crop(bounds).toPNG()),
            bounds,
          };
        },
        artifacts: visualArtifactStore,
      }, target, elementRequest, signal)
      : undefined;
    papersControlServer = await startPapersControlServer({
      descriptorPath,
      eventHub,
      dependencies: {
        windows: windowsSnapshot,
        snapshot: () => ({
          schemaVersion: 1,
          // A dedicated control-safe projection, never the renderer-facing
          // identity: that one carries installDir, dataDir and a
          // machine-stamped summary.
          build: controlBuildIdentity(),
          windows: windowsSnapshot(),
          // What Papers actually holds of the two invocation chords. A refusal
          // here is the honest record that a shortcut is unavailable.
          globalShortcuts: {
            registered: [...(globalShortcutReport?.registered ?? [])],
            failures: (globalShortcutReport?.failures ?? []).map((failure) => ({
              accelerator: failure.accelerator,
              chord: failure.chord,
              reason: failure.reason,
            })),
          },
        }),
        processIdentity: () => processInstanceIdentity,
        visualDiagnostics: ({ windowId, surfaceId }) => {
          if (!papersWindows.has(windowId)) return null;
          if (surfaceId && !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
          const buffer = visualDiagnosticsByWindow.get(windowId);
          if (!buffer) return [];
          return buffer.snapshot().filter((record) => surfaceId === undefined || record.target.surfaceId === surfaceId);
        },
        visualElements: ({ windowId, surfaceId }, keys) => {
          if (!papersWindows.has(windowId) || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
          const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
          const currentSenderId = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.senderId;
          const observed = state && state.currentSenderId === currentSenderId
            ? state.registry.snapshot(keys)
            : [];
          const requested = keys ? new Set(keys) : null;
          const elements = state && state.currentSenderId === currentSenderId
            ? state.observations.filter((observation) => !requested || requested.has(observation.key))
            : [];
          const layoutEpoch = visualSurfaceObservationState.snapshot(windowId, surfaceId)?.layoutEpoch ?? null;
          return {
            windowId,
            surfaceId,
            ...(layoutEpoch !== null ? { layoutEpoch } : {}),
            elements: elements.length > 0 ? elements : observed.map((key) => ({ key })),
          };
        },
        visualTimeline: ({ windowId, surfaceId }, beforeMs) => {
          if (!papersWindows.has(windowId) || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
          return visualTimelinesBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId))?.snapshot(beforeMs) ?? [];
        },
        visualReportCreate: async (request, signal) => {
          if (!visualArtifactStore || !processInstanceIdentity
            || !papersWindows.has(request.windowId)
            || !logicalSurfaces.isLiveIn(request.surfaceId, request.windowId)) return null;
          const surface = logicalSurfaces.project().find((candidate) =>
            candidate.windowId === request.windowId && candidate.surfaceId === request.surfaceId);
          const buffer = visualDiagnosticsByWindow.get(request.windowId);
          const records = buffer?.snapshot().filter((record) =>
            record.target.windowId === request.windowId && record.target.surfaceId === request.surfaceId) ?? [];
          const semanticState = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(request.windowId, request.surfaceId));
          const currentSenderId = papersWindows.get(request.windowId)?.owned.projectSurfaces.get(request.surfaceId)?.senderId;
          const observationState = visualSurfaceObservationState.snapshot(request.windowId, request.surfaceId);
          const surfaceCapture = captureProjectVisual
            ? async (captureSignal?: AbortSignal): Promise<{ result: unknown; png?: VisualArtifactMetadata }> => {
              const result = await captureProjectVisual({ windowId: request.windowId, surfaceId: request.surfaceId }, undefined, captureSignal);
              const png = (result as { png?: VisualArtifactMetadata }).png;
              return png ? { result, png } : { result };
            }
            : undefined;
          const elementCapture = captureProjectVisual
            ? async (elementKey: string, captureSignal?: AbortSignal): Promise<{ result: unknown; png?: VisualArtifactMetadata }> => {
              const result = await captureProjectVisual(
                { windowId: request.windowId, surfaceId: request.surfaceId },
                { elementKey, paddingCssPx: 0 },
                captureSignal,
              );
              const png = (result as { png?: VisualArtifactMetadata }).png;
              return png ? { result, png } : { result };
            }
            : undefined;
          return createVisualReport({
            process: processInstanceIdentity,
            snapshot: {
              schemaVersion: 1,
              build: controlBuildIdentity(),
              windows: windowsSnapshot(),
            },
            surface: surface ? projectSurfaceControlSnapshot(surface) : null,
            lifecycle: records.filter((record) => record.payload.kind === 'lifecycle'),
            diagnostics: records.filter((record) => record.payload.kind !== 'lifecycle'),
            timeline: visualTimelinesBySurface.get(visualSemanticKeyMapKey(request.windowId, request.surfaceId))?.snapshot(request.beforeMs) ?? [],
            semanticElements: semanticState && semanticState.currentSenderId === currentSenderId
              ? {
                windowId: request.windowId,
                surfaceId: request.surfaceId,
                layoutEpoch: observationState?.layoutEpoch ?? null,
                elements: semanticState.observations,
              }
            : { windowId: request.windowId, surfaceId: request.surfaceId, elements: [] },
            captureSurface: surfaceCapture,
            captureElement: elementCapture,
            artifacts: visualArtifactStore,
            signal,
          }, request);
        },
        visualWait: (request, signal) => visualWaitService.wait(request, request.until, request.timeoutMs, signal),
        visualAssert: ({ windowId, surfaceId }, assertions) => {
          if (!papersWindows.has(windowId) || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
          const state = visualSemanticKeysBySurface.get(visualSemanticKeyMapKey(windowId, surfaceId));
          const currentSenderId = papersWindows.get(windowId)?.owned.projectSurfaces.get(surfaceId)?.senderId;
          const elements = state && state.currentSenderId === currentSenderId ? state.observations : [];
          const observationState = visualSurfaceObservationState.snapshot(windowId, surfaceId);
          const layoutEpoch = observationState?.layoutEpoch ?? null;
          if (!state || state.currentSenderId !== currentSenderId || !observationState?.layoutStable || elements.length === 0) {
            return { windowId, surfaceId, layoutEpoch, available: false, reason: 'geometry-unavailable', allPassed: false, assertions: [] };
          }
          return {
            windowId, surfaceId, layoutEpoch, available: true,
            ...evaluateVisualAssertions(elements, assertions as VisualAssertion[]),
          };
        },
        visualArtifactRead: visualArtifactStore
          ? (artifactId, offset, length) => visualArtifactStore.read(artifactId, offset, length)
          : undefined,
        captureSurface: captureProjectVisual ? (target, signal) => captureProjectVisual(target, undefined, signal) : undefined,
        captureElement: captureProjectVisual
          ? (target, elementKey, paddingCssPx, signal) => captureProjectVisual(target, { elementKey, paddingCssPx }, signal)
          : undefined,
        captureWindow: visualArtifactStore && processInstanceIdentity && visualWindowNativeCapture
          ? (target, signal) => captureVisualWindow({
            processIdentity: () => processInstanceIdentity,
            window: ({ windowId }) => {
              const context = papersWindows.get(windowId);
              const window = context?.owned.window;
              const hostContents = context?.owned.hostView.webContents;
              if (!window || !hostContents || window.isDestroyed() || !window.isVisible() || hostContents.isDestroyed()) return null;
              try {
                return {
                  windowId,
                  sourceId: window.getMediaSourceId(),
                  visible: window.isVisible(),
                  nativeBounds: window.getBounds(),
                  hostContents,
                };
              } catch {
                return null;
              }
            },
            topologyRevision: (windowId) => workspaceTopologyRevisions.get(windowId) ?? 0,
            visibleSurfaces: (windowId) => logicalSurfaces.project()
              .filter((surface) => surface.windowId === windowId && surface.kind === 'project')
              .map((surface) => {
                const runtime = papersWindows.get(windowId)?.owned.projectSurfaces.get(surface.surfaceId);
                return {
                  surfaceId: surface.surfaceId,
                  projectId: surface.projectId,
                  presentation: 'visible' as const,
                  observation: runtime?.isPresented
                    ? visualSurfaceObservationState.snapshot(windowId, surface.surfaceId)
                    : null,
                };
              })
              .filter((surface) => surface.observation !== null || papersWindows.get(windowId)?.owned.projectSurfaces.get(surface.surfaceId)?.isPresented === true),
            requestCapture: (window, requestId, size) => visualWindowNativeCapture.request(window.sourceId, size),
            artifacts: visualArtifactStore,
          }, target, undefined, signal)
          : undefined,
        surfaces: () => logicalSurfaces.project().map(projectSurfaceControlSnapshot),
        workspace: (windowId) => {
          const topology = currentWorkspaceTopology(windowId);
          return topology
            ? { topology, revision: workspaceTopologyRevisions.get(windowId) ?? 0 }
            : null;
        },
        restoreWorkspace: (windowId, topology) => {
          facade.restoreWorkspaceTopology(windowId, topology);
          return topology;
        },
        focusWorkspace: (windowId, surfaceId) => {
          if (!papersWindows.has(windowId) || !logicalSurfaces.isLiveIn(surfaceId, windowId)) return false;
          return papersWindows.get(windowId)?.owned.projectSurfaces.focus(surfaceId) ?? false;
        },
        closeWorkspace: (windowId, surfaceId, topology) =>
          facade.closeWorkspaceSurfaceFromControl(windowId, surfaceId, topology),
        openWorkspace: (windowId, projectId) => facade.openWorkspaceSurfaceFromControl(windowId, projectId),
        listWorkspaceLayouts: () => facade.listWorkspaceLayouts(),
        saveWorkspaceLayout: (windowId, name) => facade.saveWorkspaceLayoutFromControl(windowId, name),
        loadWorkspaceLayout: (windowId, layoutId) => facade.loadWorkspaceLayoutFromControl(windowId, layoutId),
        moveWorkspaceSurfaceAcrossWindows: (request) => facade.moveWorkspaceSurfaceAcrossWindows(request),
        /**
         * The shared control-side target resolver: the window must be live and
         * the surface must be live IN that window. Nothing is resolved by
         * proximity -- a surface in another window is simply not this target.
         */
        surface: ({ windowId, surfaceId }) => {
          if (!papersWindows.has(windowId)) return null;
          if (!logicalSurfaces.isLiveIn(surfaceId, windowId)) return null;
          const found = logicalSurfaces.get(surfaceId);
          return found ? projectSurfaceControlSnapshot(found) : null;
        },
        createWindow: async () => ({ windowId: await createAdditionalPapersWindow() }),
        backpack: (projectId) => registry.find(projectId),
        archiveBackpack: (projectId, confirmedName) => facade.archiveBackpackFromControl(projectId, confirmedName),
        removeBackpack: (projectId, confirmedName) => facade.removeBackpackFromControl(projectId, confirmedName),
        publishEvent: (event, payload) => eventHub.publish(event, payload),
        validateVisualEventTarget: ({ windowId, surfaceId }) =>
          papersWindows.has(windowId) && (surfaceId === undefined || logicalSurfaces.isLiveIn(surfaceId, windowId)),
      },
    });
  }
  // Best-effort owned shutdown before app exit; the helper factory stop
  // owns stdin close, termination escalation and exactly-once terminal
  // reporting (Assignment 015).
  const traceQuit = (stage: string): void => {
    try { mkdirSync(path.join(baseDir, 'diagnostics'), { recursive: true }); appendFileSync(path.join(baseDir, 'diagnostics', 'shutdown.ndjson'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, stage }) + '\n'); } catch { /* diagnostics cannot block shutdown */ }
  };
  const quitStage = async (name: string, work: () => Promise<unknown> | unknown): Promise<void> => {
    traceQuit(name + ':start');
    try { await work(); traceQuit(name + ':done'); } catch (error) { traceQuit(name + ':failed:' + String(error)); }
  };
  let capabilityQuitComplete = false;
  let capabilityQuitPromise: Promise<void> | null = null;
  const drainCapabilities = (): Promise<void> => {
    if (capabilityQuitComplete) return Promise.resolve();
    if (!capabilityQuitPromise) {
      // Release the global chords FIRST. They are a claim on every other
      // application's keyboard, and nothing may be left captured after Papers
      // exits - not even while the rest of teardown is still draining.
      globalInvoke?.release();
      globalInvoke = null;
      if (earlyShortcutRegistered) globalShortcut.unregister('Alt+S');
      startupCommandSurfaceGate?.fail('Papers is shutting down before the command surface finished starting');
      startupCommandSurfaceGate = null;
      hoverInputBridge?.close();
      hoverInputBridge = null;
      // A launcher left open would be a focus-holding window with no owner.
      void commandSurfaceOverlay?.destroy().catch(() => undefined);
      commandSurfaceOverlay = null;
      visualResourceMonitor?.detach();
      visualResourceMonitor = null;
      windowPickSession.cancel().catch(() => undefined);
      // Control drains FIRST. A control mutation already in flight must not
      // overlap teardown of the services a newly created window depends on, so
      // the developer command plane is fully quiet before global shutdown
      // begins.
      capabilityQuitPromise = quitStage('control', () => papersControlServer?.close())
        .then(() => Promise.all([
          workspaceTopologyStore.flush().catch((error) => console.error('[workspace-topology] shutdown flush failed', error)),
          workspaceLayoutStore.flush().catch((error) => console.error('[workspace-layout] shutdown flush failed', error)),
          quitStage('detached-windows', () => detachSession!.closeAll()),
          quitStage('widget', () => widgetSession!.closeAll()),
          quitStage('native-panes', () => chromePane?.coordinator?.dispose()),
          quitStage('window-capabilities', () => windowCapabilityService.stop()),
          quitStage('window-control', () => windowControlBroker.stop()),
        ]))
        .then(() => {
        traceQuit('complete');
        capabilityQuitComplete = true;
      });
    }
    return capabilityQuitPromise;
  };
  drainCapabilitiesForReload = drainCapabilities;
  app.on('before-quit', event => {
    if (capabilityQuitComplete) return;
    event.preventDefault();
    void drainCapabilities().then(()=>app.quit());
  });
  registerProgramIpc({
    runtime,
    canvasState,
    broker,
    stateService,
    emitSaveStatus: (status, detail) => facade.emitSaveStatus(status, detail),
    agentInvoke: async () => { throw new Error("No agent invocation provider is installed."); },
    agentCancel: async () => { throw new Error("No agent invocation provider is installed."); },
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

  // ---------------------------------------------------------------- load UI
  await preparedWindow.loadAndRollback();
  // Retain each unclosed window as its own page partition; never flatten them
  // into one strip. A failed restore stays durable for later recovery.
  for (const snapshot of startupWindowSnapshots.slice(1)) {
    try { await createAdditionalPapersWindow(snapshot); }
    catch (error) { console.error('[session] secondary restore failed:', snapshot.workspaceId, error); }
  }

  // Look for a newer Papers once the interface is up. Silent unless a real
  // update is downloaded and ready; a packaged build only.
  updater.start();

  // ------------------------------------------------- global invocation chords
  // Two system-wide chords, live while Papers runs, working from inside any
  // other application:
  //   Alt+A        raises the existing Papers window directly.
  //   Alt+S  pops the command surface OVER whatever the creator is doing.
  //                Papers does NOT come forward - this is a launcher, not a
  //                window switcher. The application they came from keeps its
  //                place and gets focus back when the overlay closes.
  //
  // The host stays generic. It does not know what any Backpack's command
  // surface is called, what it does, or that "Quick Run" exists. It loads the
  // focused project's own entry URL with an opaque mode marker and delivers a
  // neutral event; the project decides what that means.
  //
  // Registration CAN fail - another application may already own the chord - and
  // a silent failure here is the bug this codebase keeps repeating: the creator
  // presses the key, nothing happens, and nothing says why. Every failure is
  // therefore surfaced through the same host-error channel the rest of the app
  // uses, naming the chord and saying it is taken. No substitute chord is
  // chosen, ever.
  const bringPapersWindowForward = async (windowId: number): Promise<{ ok: boolean; detail: string }> => {
    const context = papersWindows.get(windowId);
    const result = await bringWindowToFront(context?.owned.window, {
      platform: process.platform,
      nativeForeground: foregroundBridge ?? undefined,
    });
    return { ok: result.ok, detail: result.detail };
  };

  // The launcher overlay has its OWN host window: a small borderless surface
  // that appears over whatever the creator is doing. It does not raise Papers.
  //
  // Focus is the hard half. The foreground window is recorded BEFORE the
  // overlay takes focus, because after that the original is unrecoverable. The
  // native bridge is the only component that can hand focus back: a background
  // process calling SetForegroundWindow is refused by the Windows foreground
  // lock, which was measured rather than assumed.
  foregroundBridge = createForegroundBridge({
    cacheDirectory: app.getPath('userData'),
    sourcePath: resolveForegroundBridgeSourcePath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
    }),
  });
  if (!foregroundBridge) {
    console.error('[papers] native foreground bridge unavailable: focus cannot be handed back to the previous application');
  }

  const launcherNomination = createLauncherNominationStore(app.getPath('userData'));
  await launcherNomination.load();

  /**
   * WHICH PROJECT ALT+A LAUNCHES.
   *
   * Not the active tab. The creator presses this from outside Papers, so the
   * front tab is invisible to them - it used to decide the target, and rendered
   * Proxima's task board (a project with no command surface at all) into the
   * launcher's letterbox. The rule is now: the project that DECLARES a command
   * surface, the creator's nomination when there is one, and a visible refusal
   * when the answer would otherwise be a guess. See commandSurfaceRegistry.
   */
  const readLauncherDeclaration = createManifestDeclarationReader(
    (projectId) => backpackProjects.root(projectId),
    readProjectControlRecord,
  );

  const commandSurfaceRegistry: CommandSurfaceRegistry = createCommandSurfaceRegistry({
    openProjects: () => {
      const seen = new Set<string>();
      const open: Array<{ projectId: string; root: string }> = [];
      for (const windowId of papersWindows.windowIds) {
        for (const runtime of papersWindows.get(windowId)?.owned.projectSurfaces.all() ?? []) {
          const projectId = runtime.liveProjectId;
          if (!projectId || seen.has(projectId)) continue;
          seen.add(projectId);
          open.push({ projectId, root: '' });
        }
      }
      for (const { projectId } of widgetSession.liveProjectOwners()) {
        if (seen.has(projectId)) continue;
        seen.add(projectId);
        open.push({ projectId, root: '' });
      }
      return open;
    },
    readDeclaration: readLauncherDeclaration,
    nominatedProjectId: () => launcherNomination.nominatedProjectId(),
    nominate: (projectId) => launcherNomination.set(projectId),
  });

  commandSurfaceOverlay = createCommandSurfaceOverlay({
    // The registry's refusal is carried out verbatim: it names the Backpacks it
    // looked at, which is the only thing the creator cannot check for themselves.
    resolveCommandSurface: () => commandSurfaceRegistry.resolve(),
    resolveProjectCommandSurface: async (projectId) => {
      const target = await commandSurfaceRegistry.resolveProject(projectId);
      return target ? { ok: true, target } : null;
    },
    onClosed: (closeReason) => {
      // Diagnostic: the Quick Run surface closing is the moment the creator sees
      // as 'it got cancelled immediately', so the reason and time are recorded.
      try {
        defaultWindowGeometryJournal().record({ kind: 'surface-close', detail: String(closeReason ?? ''), outcome: 'closed' });
      } catch { /* diagnostics never fail the close */ }
      for (const pending of pendingHoverCaptures.values()) {
        for (const item of pending.buffer) item.resolve?.({ ok: false, detail: 'the command surface closed during Quick Run handoff' });
        for (const wake of pending.wake) wake();
      }
      pendingHoverCaptures.clear();
      for (const [captureId, pending] of pendingCommandSurfaceAcks) {
        clearTimeout(pending.timer);
        pending.reject(new Error('the command surface closed before acknowledging input'));
        pendingCommandSurfaceAcks.delete(captureId);
      }
      for (const [key, pending] of pendingWidgetSeals) {
        clearTimeout(pending.timer);
        pending.reject(new Error('the command surface closed during widget input handoff'));
        pendingWidgetSeals.delete(key);
      }
      void hoverInputBridge?.setOverlayOpen(false);
    },
    onTargetResolved: (target, ownerWindowId) => {
      const owner = papersWindows.get(ownerWindowId);
      const hasLiveProjectEntry = owner?.owned.projectSurfaces.entryUrlForProject(target.projectId)
        || widgetSession.entryUrlForOwner(target.projectId, ownerWindowId);
      if (!hasLiveProjectEntry) {
        throw new Error('the selected command surface no longer belongs to a live Papers window');
      }
      if (commandSurfaceSenderId !== null) {
        surfaceContexts.bind(commandSurfaceSenderId, {
          projectId: target.projectId,
          windowId: ownerWindowId,
          kind: 'launcher',
        });
      }
    },
    resolveEntryUrl: (projectId) => {
      for (const windowId of papersWindows.windowIds) {
        const owner = papersWindows.get(windowId);
        const url = owner?.owned.projectSurfaces.entryUrlForProject(projectId)
          ?? widgetSession.entryUrlForOwner(projectId, windowId);
        if (url) return { entryUrl: url, ownerWindowId: windowId };
      }
      return null;
    },
    preloadPath: path.join(preloadDir, 'backpackProject.cjs'),
    // An automated test cannot hold focus, so the real behaviour would close the
    // overlay before it could be observed. Only PAPERS_TEST_INVOKE_CHANNEL
    // relaxes this, and only in a build launched for testing.
    ...(TEST_INVOKE_ENABLED ? { dismissOnBlur: false } : {}),
    focusBridge: foregroundBridge ?? undefined,
    // Where the creator is working, by cursor: the pointer is the best
    // cross-process signal for "the screen they are looking at", and it needs
    // no native call to read.
    placeOn: () => {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      return { x: area.x, y: area.y, width: area.width, height: area.height };
    },
    createWindow: ({ projectId, preloadPath: overlayPreloadPath }) => {
      const overlayWindow = new BrowserWindow({
        width: COMMAND_SURFACE_OVERLAY_WIDTH,
        height: COMMAND_SURFACE_OVERLAY_HEIGHT,
        frame: false,
        title: '',
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        // A launcher sits above ordinary windows, and is NOT taskbar or
        // alt-tab material: the creator does not own it as a window.
        alwaysOnTop: true,
        skipTaskbar: true,
        minimizable: false,
        maximizable: false,
        // A launcher is not a window the creator manages: no fullscreen, no
        // maximise, no minimise. Measured: Electron's default leaves a
        // frameless window fullscreenable, which would let a stray F11 turn the
        // launcher into a full-screen surface.
        fullscreenable: false,
        show: false,
        webPreferences: {
          preload: overlayPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false,
        },
      });
      overlayWindow.setMenuBarVisibility(false);
      overlayWindow.setAlwaysOnTop(true, 'floating');
      overlayWindow.setSkipTaskbar(true);
      // Escape is handled by the HOST, not the project page: dismissing the
      // launcher is host behaviour, and it must work even if the page is still
      // loading or its own key handling never runs.
      overlayWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          void commandSurfaceOverlay?.close('dismissed').catch(() => undefined);
        }
      });
      overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // Fail-closed navigation guard: only the exact scheme and the exact
      // bound project host, the same rule the compact widget uses.
      overlayWindow.webContents.on('will-navigate', (event, targetUrl) => {
        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== 'papers-backpack:' || parsed.host !== projectId) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      // Bound as a Papers-owned project surface so the project's own IPC is
      // allowed from it.
      //
      // This binding previously said `widget`, on the reasoning that "the gate
      // treats every non-detached kind alike, so a third kind would change
      // nothing". Both halves of that were wrong, and the launcher did not work
      // at all because of it:
      //   - the gate did NOT treat kinds alike. It asked the detach and widget
      //     registries, which the launcher is in neither of, so every project
      //     channel was refused with "host channel called from non-host sender";
      //   - the kind is not cosmetic. It now decides which capabilities the
      //     surface may use, so calling the launcher a widget would have granted
      //     it a compact widget's window picking and state writing.
      // It has its own kind because a reader of a kind is entitled to a
      // different answer for a launcher.
      bindOwnedProjectSurface(overlayWindow, projectId, 'launcher', papersWindows.windowIds[0] ?? 0);
      commandSurfaceSenderId = overlayWindow.webContents.id;
      overlayWindow.webContents.once('destroyed', () => {
        if (commandSurfaceSenderId === overlayWindow.webContents.id) commandSurfaceSenderId = null;
      });
      return overlayWindow;
    },
    deliver: (senderId, payload) => {
      if (payload.reason === 'global-accelerator') void hoverInputBridge?.setOverlayOpen(true);
      const contents = webContents.fromId(senderId);
      if (!contents || contents.isDestroyed()) {
        if (typeof payload.captureId === 'string') throw new Error('the command-surface renderer is unavailable for captured input');
        return;
      }
      if (typeof payload.captureId === 'string') {
        if (pendingCommandSurfaceAcks.has(payload.captureId)) throw new Error('duplicate command-surface input receipt id');
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const receipt = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
        const timer = setTimeout(() => {
          pendingCommandSurfaceAcks.delete(payload.captureId!);
          reject(new Error('Quick Run did not acknowledge the delivered character'));
        }, 5000);
        const pending = {
          projectId: payload.projectId,
          senderId,
          resolve,
          reject,
          timer,
        };
        pendingCommandSurfaceAcks.set(payload.captureId, pending);
        try {
          contents.send(COMMAND_SURFACE_INVOKE_CHANNEL, payload);
        } catch (error) {
          clearTimeout(timer);
          pendingCommandSurfaceAcks.delete(payload.captureId);
          reject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
        return receipt;
      }
      contents.send(COMMAND_SURFACE_INVOKE_CHANNEL, payload);
    },
    report: (report) => {
      // Focus failures are reported; a clean hand-back is not news.
      if (report.outcome === 'focus-restored') return;
      console.error(`[papers] command surface focus: ${report.detail}`);
    },
  });
  // Load the launcher renderer while Papers is settling, without showing it or
  // touching foreground focus. Later Alt+S presses reuse this hidden surface.
  const startupOverlay = commandSurfaceOverlay;
  void startupOverlay.warm().catch((error) => {
    console.error('[papers] command surface warm-up failed:', error);
  }).finally(() => {
    // Startup presses wait until warm-up settles, so the first open joins a
    // fully-loaded renderer instead of racing a second window creation.
    if (startupCommandSurfaceGate === commandSurfaceGate) commandSurfaceGate.attach(startupOverlay);
  });

  // The chord's own open path, shared by the real accelerator and the test seam
  // below, so a test exercises exactly what a keypress does.
  const openCommandSurface = async (): Promise<{ ok: boolean; detail: string }> => {
    if (!commandSurfaceOverlay) {
      return { ok: false, detail: 'the command surface overlay is not available in this build' };
    }
    try {
      defaultWindowGeometryJournal().record({ kind: 'surface-open', detail: 'command surface', outcome: 'opening' });
    } catch { /* diagnostics never fail the open */ }
    return commandSurfaceOverlay.open();
  };
  if (TEST_INVOKE_ENABLED) {
    // Published ONLY under the test flag, so no shipping build carries it and no
    // page can reach the launcher without a real keypress. It is the same
    // function the accelerator calls, not a reimplementation of it.
    (globalThis as Record<string, unknown>)['__papersTestOpenCommandSurface'] = openCommandSurface;
  }

  // Alt+A is raise-only. It never minimizes Papers.
  /* Legacy toggle implementation retained below for historical tests; the
     shipping Alt+A path is raise-only and does not wire it. */
  /* windowToggle = createWindowToggle({
    foregroundPapersWindowId,
    currentWindowId: () => {
      const windows = papersWindows.windowIds;
      const visible = windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed() && owned.isVisible();
      });
      if (visible !== undefined) return visible;
      const live = windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed();
      });
      return live ?? null;
    },
    // Deliberately NOT reading a cache: the answer must be as fresh as the
    // handle it is compared against, so the caller refreshes it first.
    isForeground: () => foregroundPapersWindowId() !== null,
    minimize: (windowId) => {
      const owned = papersWindows.get(windowId)?.owned.window;
      if (!owned || owned.isDestroyed()) return false;
      // The launcher is not a Papers window the creator manages. If it is up,
      // it comes down with the window rather than floating over whatever they
      // moved on to.
      void commandSurfaceOverlay?.close('dismissed').catch(() => undefined);
      try {
        owned.minimize();
      } catch {
        return false;
      }
      // Electron's minimize() returns void, so reporting true without checking
      // would be a claim rather than an observation - and a failed minimise that
      // reported success is the worst outcome here. Verify it, so the toggle
      // falls back to raising when the hide did not actually happen.
      return owned.isMinimized();
    },
    bringToFront: bringPapersWindowForward,
    nextWindowInZOrder: async () => {
      if (!foregroundBridge) return null;
      const windowId = foregroundPapersWindowId();
      const owned = windowId === null ? undefined : papersWindows.get(windowId)?.owned.window;
      const handle = owned ? nativeHandleOf(owned) : null;
      if (handle === null) return null;
      // "The window underneath the one being hidden" - the sensible place for
      // focus to land, and the reason the bridge walks the z-order.
      return foregroundBridge.nextWindowInZOrder(handle).catch(() => null);
    },
    focusWindow: async (handle) => {
      if (!foregroundBridge) return false;
      return foregroundBridge.setForegroundWindow(handle).catch(() => false);
    },
    report: (report) => {
      if (report.outcome !== 'minimized') return;
      console.error(`[papers] bring-to-front toggle: ${report.detail}`);
    },
  }); */
  globalInvoke = createGlobalInvoke({
    // Alt+A belongs to the resident launcher, which survives Papers exiting.
    accelerators: { invoke: 'Alt+S' },
    shortcut: globalShortcut,
    currentWindowId: () => {
      // Prefer an actually visible window, so a hidden or auxiliary surface is
      // not what answers the chord; then any live window; then nothing.
      const windows = papersWindows.windowIds;
      const visible = windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed() && owned.isVisible();
      });
      if (visible !== undefined) return visible;
      const live = windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed();
      });
      return live ?? null;
    },
    bringToFront: bringPapersWindowForward,
    resolveCommandSurface: () => {
      const windowId = papersWindows.windowIds.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed() && owned.isVisible();
      });
      if (windowId === undefined) return null;
      const surfaceId = papersWindows.activeSurfaceId(windowId);
      if (surfaceId === null) return null;
      // The host resolves the surface to its project through the sender
      // binding. It never reads a project's private records to guess this.
      for (const senderId of surfaceContexts.sendersForSurface(surfaceId)) {
        const projectId = surfaceContexts.projectForSender(senderId);
        if (projectId) return { projectId, surfaceId };
      }
      return null;
    },
    invokeCommandSurface: () => ({ ok: true, detail: 'delivered by the overlay' }),
    overlay: commandSurfaceOverlay ?? undefined,
    report: (report) => {
      // Only failures reach the creator. A successful chord is its own feedback.
      if (report.outcome === 'overlay-opened' || report.outcome === 'brought-forward' || report.outcome === 'launched') return;
      hostView?.webContents.send('host:event:host-error', {
        component: 'Global shortcut',
        what: report.outcome === 'window-unavailable'
          ? 'Papers could not be brought to the front.'
          : 'The command surface shortcut could not open the launcher.',
        known: report.detail,
        intact: 'Nothing was changed, and no other application was affected. Papers did not come forward.',
        retryUseful: true,
        inspect: 'Shortcuts: bring Papers forward is Alt+A; open the command surface is Alt+S.',
        recover: report.outcome === 'window-unavailable'
          ? 'Open a Papers window, then press the shortcut again.'
          : 'Open a Backpack in Papers, then press the shortcut again.',
      });
    },
  });

  // Transfer the already-held chord to the normal dispatcher without yielding
  // to the event loop; the startup callback above has been swallowing and
  // queueing the first press until the real overlay is available.
  if (earlyShortcutRegistered) globalShortcut.unregister('Alt+S');
  const shortcutReport = globalInvoke.register();
  globalShortcutReport = shortcutReport;
  if (!shortcutReport.ok) {
    for (const failure of shortcutReport.failures) {
      console.error(`[papers] global shortcut refused: ${failure.message}`);
    }
    for (const failure of shortcutReport.failures) {
      hostView.webContents.send('host:event:host-error', {
        component: 'Global shortcut',
        what: failure.reason === 'already-registered-by-another-application'
          ? 'A shortcut key is already taken by another application.'
          : 'A shortcut key could not be registered.',
        known: failure.message,
        intact: 'Papers is running normally; only this shortcut is unavailable.',
        retryUseful: failure.reason === 'already-registered-by-another-application',
        inspect: `Requested key: ${failure.accelerator}`,
        recover: 'Close whichever application owns that key combination, then restart Papers. Papers deliberately does not choose a different key on its own.',
      });
    }
  }

  // Window-dock: hover any ordinary application window and press the chord
  // to tile it right of the focused Papers window, following moves/resizes
  // until the chord is pressed again. Geometry only (no hide, no Z-order
  // write), so a crash leaves a visible window behind, never a stranded one.
  const adoptedDock = createAdoptedWindowDock({
    service: windowCapabilityService,
    screen,
    shortcut: globalShortcut,
  });
  const adoptedDockReport = adoptedDock.register({
    focusedWindow: () => {
      const windows = papersWindows.windowIds;
      const visible = windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed() && owned.isVisible();
      });
      const target = visible ?? windows.find((id) => {
        const owned = papersWindows.get(id)?.owned.window;
        return owned !== undefined && !owned.isDestroyed();
      });
      if (target === undefined) return null;
      return papersWindows.get(target)?.owned.window ?? null;
    },
    notify: (outcome) => {
      // Docking and release are their own visible feedback: the window
      // moves. Only a refusal must speak, so a dead chord never looks like
      // nothing happened.
      if (outcome.outcome === 'refused') {
        console.error(`[papers] window-dock refused: ${outcome.detail}`);
        hostView?.webContents.send('host:event:host-error', {
          component: 'Window dock',
          what: 'The window under the cursor could not be docked.',
          known: outcome.detail,
          intact: 'Nothing was changed, and no other application was affected.',
          retryUseful: true,
          inspect: 'Shortcut: hover an ordinary application window, then press CommandOrControl+Alt+D.',
          recover: 'Hover the window and press the shortcut again.',
        });
        return;
      }
      console.error(`[papers] window-dock ${outcome.outcome} @${new Date().toISOString()}: ${outcome.detail}`);
    },
  });
  if (!adoptedDockReport.registered) {
    console.error(`[papers] window-dock unavailable: ${adoptedDockReport.detail}`);
  }

  // Per-window close/finalize ownership is installed by preparePapersWindow;
  // bootstrap only retains these aliases for primary/fixture compatibility.
}

app.whenReady().then(() => {
  if (!ownsSingleInstanceLock) return;
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


