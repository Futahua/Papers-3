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
  placement: HermesPlacement;
  status: HermesStatusKind;
  detail?: string;
  /** true → show the narrow dock-edge highlight (a detached window is being
   *  dragged toward the Papers docking edge). */
  dockHint?: boolean;
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

interface HostBridge {
  /** True only when launched with PAPERS_ENABLE_FIXTURES=1 (historical demos). */
  fixtureMode: boolean;
  backpacks: {
    list(): Promise<BackpacksList>;
    /**
     * Name-only creation. Papers creates no folder, cover, canvas or context.
     * `type` is passed only by historical fixtures; production omits it.
     */
    create(name: string, type?: string): Promise<BackpackSummary>;
    rename(id: string, name: string): Promise<void>;
    setArchived(id: string, archived: boolean): Promise<void>;
    enter(id: string): Promise<{ backpack: BackpackSummary }>;
    leave(): Promise<void>;
    lastActive(): Promise<string | null>;
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
    setProgramBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    setOverlayActive(active: boolean): Promise<void>;
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
    onProgramStatus(cb: (p: ProgramStatus) => void): () => void;
    onShelfChanged(cb: (p: ShelfContribution[]) => void): () => void;
    onSaveStatus(cb: (p: SaveStatusPayload) => void): () => void;
    onPermissionPrompt(cb: (p: PendingPermissionPrompt) => void): () => void;
    onInvocationPreview(cb: (p: InvocationPreviewPayload) => void): () => void;
    onRunsChanged(cb: (p: AgentRunSnapshot) => void): () => void;
    onHermesHealth(cb: (p: HermesHealth) => void): () => void;
    onHermesSurface(cb: (p: HermesSurfaceStatus) => void): () => void;
    onHostError(cb: (p: HostErrorPayload) => void): () => void;
  };
}

declare global {
  interface Window {
    papersHost: HostBridge;
  }
}

export const host = (): HostBridge => window.papersHost as unknown as HostBridge;
