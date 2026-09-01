/**
 * Typed access to the host preload bridge.
 */
import type {
  AgentRunSnapshot,
  BackpackSummary,
  HermesHealth,
  PendingPermissionPrompt,
  ProgramManifest,
  ProgramStatus,
  ShelfContribution,
} from '@shared/types';
import type { WorkspaceTopologyV1 } from '@shared/workspaceTopology';

export interface BackpacksList {
  backpacks: BackpackSummary[];
  activeBackpackId: string | null;
}

export interface CatalogInfo {
  programs: ProgramManifest[];
  issues: { directory: string; problem: string }[];
  statuses: ProgramStatus[];
  activeProgramId: string | null;
}

export interface InvocationPreviewPayload {
  previewId: string;
  runId: string;
  invocation: import('@shared/types').AgentInvocation;
  composedPrompt: string;
  disclosures: string[];
}

export interface SaveStatusPayload {
  status: 'idle' | 'saving' | 'saved' | 'error';
  detail: string | null;
}

export type HermesPlacement = 'closed' | 'docked' | 'detached';
export type HermesStatusKind = 'idle' | 'starting' | 'ready' | 'error';

export interface HermesSurfaceStatus {
  /** Global truth about Hermes: there is one Hermes, in one placement. */
  placement: HermesPlacement;
  status: HermesStatusKind;
  detail?: string;
  /**
   * Whether THIS window owns the docked Hermes. Relative to the recipient, not
   * a property of Hermes: with Hermes docked to another window, this window
   * sees `docked` with `ownedByThisWindow: false`, and its dock control offers
   * to take Hermes rather than to hide someone else's. False for closed and
   * detached, where ownership does not apply.
   */
  ownedByThisWindow: boolean;
}

export interface HostErrorPayload {
  component: string;
  what: string;
  known: string;
  intact: string;
  retryUseful: boolean;
  inspect: string;
  recover: string;
}

/** Which build Papers is, and where it runs from. See `src/main/buildIdentity.ts`. */
export interface BuildIdentity {
  version: string;
  /** Short git commit, or `unknown` for a build made before commit stamping. */
  commit: string;
  branch: string;
  builtAt: string;
  packaged: boolean;
  installDir: string;
  dataDir: string;
  machine: string;
  /** One short line, e.g. `1.0.0 · a1b2c3d · MINH-DESKTOP`. */
  summary: string;
}

/** Where Papers is in checking for, downloading, or holding a newer version. */
export type UpdateStage = 'idle' | 'checking' | 'downloading' | 'ready' | 'unavailable';

export interface UpdateState {
  stage: UpdateStage;
  version?: string;
  percent?: number;
  detail?: string;
}

interface HostBridge {
  /** True only when launched with PAPERS_ENABLE_FIXTURES=1 (historical demos). */
  fixtureMode: boolean;
  app: {
    /** Identify this build so two machines can be compared. */
    buildIdentity(): Promise<BuildIdentity>;
    updateStatus(): Promise<UpdateState>;
    checkForUpdate(): Promise<UpdateState>;
    /** Restart into the downloaded update; only acts once stage is `ready`. */
    installUpdate(): Promise<void>;
    /** Create one fresh secondary Papers window. */
    newWindow(): Promise<void>;
  };
  backpacks: {
    list(): Promise<BackpacksList>;
    /**
     * Name-only creation. Papers creates no folder, cover, canvas or context.
     * `type` is passed only by historical fixtures; production omits it.
     */
    create(name: string, type?: string): Promise<BackpackSummary>;
    rename(id: string, name: string): Promise<void>;
    setArchived(id: string, archived: boolean): Promise<void>;
    remove(id: string): Promise<void>;
    enter(id: string): Promise<{ backpack: BackpackSummary }>;
    leave(): Promise<void>;
    /** The Backpack THIS window may reopen on startup, or null. Only the
     * first window at launch has one: a window opened later starts fresh
     * rather than duplicating the most recently used Backpack. */
    startupRestore(): Promise<string | null>;
  };
  /** Host seam for an independently maintained, machine-bound Backpack project. */
  backpackProject: {
    /** Opening allocates the logical surface and returns its id. Every later
     * operation on that view names the id explicitly: main never infers the
     * target from "the window's only surface". */
    open(id: string): Promise<{ url: string; surfaceId: string } | null>;
    close(surfaceId: string): Promise<void>;
    /** Focus this already-open logical surface in its owning Papers window. */
    activateSurface(surfaceId: string): Promise<void>;
    showSurface(surfaceId: string, url: string): Promise<void>;
    setSurfaceBounds(surfaceId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    hideSurface(surfaceId: string): Promise<void>;
    // Project-scoped operations live on the project frame's own bridge; the
    // host renderer cannot act on a project without naming a surface.
  };
  programs: {
    catalog(): Promise<CatalogInfo>;
    start(programId: string): Promise<void>;
    stop(): Promise<void>;
    restart(programId: string): Promise<void>;
    clearQuarantine(programId: string): Promise<void>;
    invokeCommand(commandId: string): Promise<void>;
  };
  layout: {
    hydrateStartupWorkspace(): Promise<{ hydrated: boolean }>;
    list(): Promise<Array<{
      layoutId: string; name: string; topology: WorkspaceTopologyV1; createdAt: string; updatedAt: string;
    }>>;
    save(name: string): Promise<{
      layoutId: string; name: string; topology: WorkspaceTopologyV1; createdAt: string; updatedAt: string;
    }>;
    load(layoutId: string): Promise<{ windowId: number; layoutId: string; topology: WorkspaceTopologyV1 }>;
    setProgramBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    setOverlayActive(active: boolean): Promise<void>;
    setTitleBarOverlay(color: string, symbolColor: string): Promise<void>;
    commitWorkspaceTopology(topology: WorkspaceTopologyV1): Promise<void>;
  };
  settings: {
    get(): Promise<{
      transparentWindow: boolean;
      windowBounds?: { x: number; y: number; width: number; height: number };
    }>;
    setTransparentWindow(enabled: boolean): Promise<void>;
    saveWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    clearWindowBounds(): Promise<void>;
  };
  permissions: {
    list(): Promise<
      { backpackId: string; programId: string; capability: string; grantedAt: string }[]
    >;
    revoke(backpackId: string, programId: string, capability: string): Promise<boolean>;
    respond(promptId: string, decision: string): Promise<void>;
  };
  runs: {
    list(): Promise<AgentRunSnapshot[]>;
    get(runId: string): Promise<AgentRunSnapshot | null>;
    cancel(runId: string): Promise<void>;
    respondInteraction(runId: string, requestId: string, optionId: string): Promise<void>;
    retry(runId: string): Promise<{ runId: string }>;
    inspectInHermes(runId: string): Promise<{ sessionId: string | null; opened: boolean }>;
    returnToOrigin(runId: string): Promise<void>;
    respondInvocation(previewId: string, approved: boolean): Promise<void>;
    reply(runId: string, text: string): Promise<void>;
    composedPrompt(runId: string): Promise<string>;
  };
  hermes: {
    health(): Promise<HermesHealth>;
    surfaceStatus(): Promise<HermesSurfaceStatus>;
    /** Dock the real Hermes Desktop window at Papers-relative bounds. */
    dock(bounds: { x: number; y: number; width: number; height: number }): Promise<HermesSurfaceStatus>;
    setDockBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    /** Hide the docked placement; Hermes and its session stay alive. */
    hideDock(): Promise<void>;
    /** Show the same Hermes as a detached window. */
    showWindow(): Promise<HermesSurfaceStatus>;
    /** Hide the detached window; Hermes and its session stay alive. */
    hideWindow(): Promise<void>;
  };
  events: {
    onBackpacksChanged(cb: (p: BackpacksList) => void): () => void;
    /** The project frame asked Papers to leave it. Carries the exact surface,
     * so a window holding several does not close the wrong one. */
    onBackpackProjectCloseRequest(cb: (payload: { surfaceId: string }) => void): () => void;
    onWorkspaceTopology(cb: (topology: WorkspaceTopologyV1) => void): () => void;
    onWorkspaceProjectOpened(cb: (payload: {
      project: { surfaceId: string; projectId: string; title: string; url: string };
      topology: WorkspaceTopologyV1;
    }) => void): () => void;
    onWorkspaceHydrated(cb: (payload: {
      projects: Array<{ surfaceId: string; projectId: string; title: string; url: string }>;
      topology: WorkspaceTopologyV1;
    }) => void): () => void;
    onWorkspaceLayoutLoaded(cb: (payload: {
      layoutId: string;
      projects: Array<{ surfaceId: string; projectId: string; title: string; url: string }>;
      topology: WorkspaceTopologyV1;
    }) => void): () => void;
    onWorkspaceSurfaceMoved(cb: (payload: {
      surfaceId: string;
      sourceWindowId: number;
      targetWindowId: number;
      projects: Array<{ surfaceId: string; projectId: string; title: string; url: string }>;
      topology: WorkspaceTopologyV1;
      compensating?: boolean;
    }) => void): () => void;
    onProgramStatus(cb: (p: ProgramStatus) => void): () => void;
    onShelfChanged(cb: (p: ShelfContribution[]) => void): () => void;
    onSaveStatus(cb: (p: SaveStatusPayload) => void): () => void;
    onPermissionPrompt(cb: (p: PendingPermissionPrompt) => void): () => void;
    onInvocationPreview(cb: (p: InvocationPreviewPayload) => void): () => void;
    onRunsChanged(cb: (p: AgentRunSnapshot) => void): () => void;
    onHermesHealth(cb: (p: HermesHealth) => void): () => void;
    onHermesSurface(cb: (p: HermesSurfaceStatus) => void): () => void;
    onHostError(cb: (p: HostErrorPayload) => void): () => void;
    onUpdateStatus(cb: (p: UpdateState) => void): () => void;
  };
}

declare global {
  interface Window {
    papersHost: HostBridge;
  }
}

export const host = (): HostBridge => window.papersHost as unknown as HostBridge;
