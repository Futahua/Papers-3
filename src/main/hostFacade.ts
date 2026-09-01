/**
 * PapersHostFacade — coordination between the host renderer, Backpack
 * registry, Canvas runtime, permissions, agent runs, and Hermes. Implements
 * the HostFacade IPC contract.
 */
import { randomUUID } from 'node:crypto';
import { clipboard, dialog, shell, webContents, type WebContents } from 'electron';

import type {
  AgentRunSnapshot,
  BackpackSummary,
  PendingPermissionPrompt,
  PermissionDecision,
  ProgramManifest,
  ProgramStatus,
  SaveStatus,
  ShelfContribution,
} from '@shared/types';
import { buildIdentity } from './buildIdentity';
import type { DelegateWaveRelay } from './delegateWave/delegateWaveRelay';
import type { PapersUpdater } from './papersUpdater';
import type { BackpackRegistry } from './backpacks/backpackRegistry';
import type {
  BackpackProjectService,
  LoadedBackpackProjectState,
  OpenBackpackProject,
  SaveStateResult,
} from './backpacks/backpackProjectService';
import { parseBackpackProjectWebUrl } from './backpacks/backpackProjectWebLink';
import type { LogicalSurfaceRegistry } from './windows/logicalSurfaceRegistry';
import type { SurfaceContextRegistry } from './windows/surfaceContextRegistry';
import { BACKPACK_PROJECT_SCHEME } from './backpacks/backpackProjectService';
import type { CanvasRuntime } from './canvas/canvasRuntime';
import type { CanvasSessionState } from './canvas/canvasState';
import type { ProgramCatalog } from './canvas/programLoader';
import type { PermissionStore } from './capabilities/permissionStore';
import type { HermesAdapter } from './hermes/hermesAdapter';
import type { HermesSurface, SurfaceBounds } from './hermes/hermesSurface';
import type { AgentRunService, InvocationPreview } from './agents/runService';
import type { PermissionPrompter } from './capabilities/capabilityBroker';
import { AtomicJsonStore } from './persistence/atomicStore';
import { backpackDir, canvasFile, type PapersPaths } from './persistence/paths';
import type { HostFacade } from './ipc/hostIpc';
import { assertValidWorkspaceTopology, closeWorkspaceSurface, type WorkspaceTopologyV1 } from '@shared/workspaceTopology';

interface CanvasPersistedState {
  schemaVersion: 1;
  lastActiveProgramId: string | null;
}

export interface FacadeDeps {
  /**
   * Phase 1B.3 delivery. Two primitives with explicit semantics, replacing a
   * single "the host" target:
   *
   *   broadcastToHosts  application-level facts every window must see
   *   sendToWindow      something that belongs to one window and would be
   *                     misleading anywhere else
   *
   * Neither is a substitute for the other, and neither is
   * `sendersForProject` -- project membership is a different question from
   * window membership.
   */
  broadcastToHosts: (channel: string, payload: unknown) => void;
  sendToWindow: (windowId: number, channel: string, payload: unknown) => void;
  /** The window a HOST renderer belongs to, or null if this sender is not a
   * live host. Every registered host is legitimate; there is no primary. */
  hostWindowForSender: (senderId: number) => number | null;
  /** Every live Papers window, for the per-recipient Hermes projection. */
  hostWindowIds: () => number[];
  /** The docking relationship lives in the window registry, never inside
   * HermesSurface -- one owner, one place. */
  hermesDockOwner: () => number | null;
  /** Per-window Backpack identity. "Entered" belongs to a window; the
   * persisted most-recent Backpack stays application-level. */
  enteredBackpack: (windowId: number) => string | null;
  setEnteredBackpack: (windowId: number, backpackId: string | null) => void;
  /** The focused logical project surface; enteredBackpack is only the
   * no-surface/legacy projection. */
  activeSurfaceId: (windowId: number) => string | null;
  setActiveSurfaceId: (windowId: number, surfaceId: string | null) => void;
  clearEnteredBackpackEverywhere: (backpackId: string) => void;
  /** Retire every logical surface showing a Backpack that has become
   * unavailable. Distinct from unbinding senders: the surfaces themselves end. */
  retireProjectSurfaces: (projectId: string) => void;
  /** The control-facing projection of live logical surfaces. */
  listLogicalSurfaces: () => Array<{ surfaceId: string; windowId: number; projectId: string; kind: string }>;
  /** Retire auxiliary project surfaces only when the project is unavailable. */
  retireBackpackProjectSurfaces: (backpackId: string) => Promise<void>;
  /** Tear down one attached workspace presentation by logical identity. The
   * host renderer is only a window actor and is never looked up as a project
   * surface. */
  closeAttachedProjectSurface: (windowId: number, surfaceId: string) => void;
  /** Semantic close removes the native runtime entry; hide preserves it for
   * renderer remount. */
  closeBackpackProjectSurface: (senderId: number, surfaceId: string) => void;
  restoreBackpack: (windowId: number) => string | null;
  setHermesDockOwner: (windowId: number | null) => void;
  /** The window whose Canvas runtime a program event belongs to. One runtime
   * today, so one answer -- but the relationship is recorded rather than
   * assumed, so per-window Canvas would keep the same delivery semantics. */
  canvasRuntimeWindow: () => number | null;
  /** Phase 1A: which project a sender may act for. Supplied by the host so
   * project requests resolve through their own sender instead of ambient
   * state. */
  surfaces: SurfaceContextRegistry;
  /** A0.1: the authority for which surfaces exist. */
  logicalSurfaces: LogicalSurfaceRegistry;
  /**
   * The Papers window a sender belongs to, or null when the host cannot say.
   *
   * Fails closed on purpose: manufacturing an id like 0 for an unknown sender
   * would bind it to a window that may not be the one it came from, which is
   * the same class of mistake as the ambient project global. Phase 1B replaces
   * the single-window answer with a real lookup.
   */
  windowIdForSender: (senderId: number) => number | null;
  updater: PapersUpdater;
  registry: BackpackRegistry;
  backpackProjects: BackpackProjectService;
  delegateWave: DelegateWaveRelay;
  isBackpackProjectSender: (sender: WebContents) => boolean;
  /** Phase 1B: both take the asking sender, so they act on THAT window's
   * project runtime instead of implicitly meaning "the one runtime". */
  showBackpackProjectSurface: (senderId: number, surfaceId: string, url: string) => Promise<void>;
  hideBackpackProjectSurface: (senderId: number, surfaceId: string) => void;
  setBackpackProjectSurfaceBounds: (
    senderId: number,
    surfaceId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;
  runtime: CanvasRuntime;
  canvasState: CanvasSessionState;
  catalog: () => ProgramCatalog;
  permissionStore: PermissionStore;
  adapter: HermesAdapter;
  hermesSurface: HermesSurface;
  runService: () => AgentRunService;
  paths: PapersPaths;
  /** Repaint the native window-controls overlay to match the active theme. */
  setTitleBarOverlay: (senderId: number, color: string, symbolColor: string) => void;
  getSettings: () => unknown;
  setTransparentWindow: (enabled: boolean) => Promise<void>;
  /** Capture the window's current rectangle as the restore-on-launch preset. */
  saveWindowBounds: (senderId: number) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  /** Forget the preset so Papers reopens at its default size. */
  clearWindowBounds: () => Promise<void>;
  setWorkspaceTopology: (windowId: number, topology: WorkspaceTopologyV1) => void;
}

export class PapersHostFacade implements HostFacade, PermissionPrompter {
  private readonly pendingPermissionPrompts = new Map<string, (d: PermissionDecision) => void>();
  private readonly pendingInvocationPreviews = new Map<string, (approved: boolean) => void>();
  private hermesPlacementTail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FacadeDeps) {}

  /** Hermes has one physical/global placement. Serialize every mutation from
   * request authorization through ownership commit/rollback and projection so
   * an older operation can never finish after and overwrite a newer one. */
  private runHermesPlacement<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.hermesPlacementTail.then(
      () => operation(),
      () => operation(),
    );
    this.hermesPlacementTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // ---------------------------------------------------------------- events
  /** Deliver to exactly one surface. Used where the answer belongs to the
   * window that asked, rather than to whichever host happens to be current. */
  private sendTo(senderId: number, channel: string, payload: unknown): void {
    const contents = webContents.fromId(senderId);
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  /** An application-level fact: every live host renderer must see it. */
  private broadcast(channel: string, payload: unknown): void {
    this.deps.broadcastToHosts(channel, payload);
  }

  /**
   * Something that belongs to the Canvas runtime's window. Delivered to that
   * window rather than broadcast, because a program's status, shelf, save
   * result or permission prompt shown in a window that is not running it
   * would be misleading.
   */
  private sendToRuntimeOwner(channel: string, payload: unknown): void {
    const windowId = this.deps.canvasRuntimeWindow();
    if (windowId === null) return;
    this.deps.sendToWindow(windowId, channel, payload);
  }

  /**
   * Globally triggered, but projected per recipient: the Backpack list is the
   * same everywhere while `activeBackpackId` differs by window. Broadcasting
   * one payload would put one window's active Backpack into every window.
   */
  emitBackpacksChanged(): void {
    for (const windowId of this.deps.hostWindowIds()) {
      this.deps.sendToWindow(windowId, 'host:event:backpacks-changed', this.listBackpacksFor(windowId));
    }
  }
  emitProgramStatus(status: ProgramStatus): void {
    this.sendToRuntimeOwner('host:event:program-status', status);
  }
  emitShelfChanged(items: ShelfContribution[]): void {
    this.sendToRuntimeOwner('host:event:shelf-changed', items);
  }
  emitSaveStatus(status: SaveStatus, detail?: string): void {
    // Program state save (programIpc), not the Backpack document path.
    this.sendToRuntimeOwner('host:event:save-status', { status, detail: detail ?? null });
  }
  emitRunsChanged(snapshot: AgentRunSnapshot): void {
    this.broadcast('host:event:runs-changed', snapshot);
  }
  emitHermesHealth(): void {
    this.broadcast('host:event:hermes-health', this.deps.adapter.health);
  }

  /** Every registered host renderer is legitimate. There is no primary host:
   * a second window's renderer must pass this guard exactly as the first
   * window's does. */
  isHostSender(sender: WebContents): boolean {
    return this.deps.hostWindowForSender(sender.id) !== null;
  }

  isBackpackProjectSender(sender: WebContents): boolean {
    return this.deps.isBackpackProjectSender(sender);
  }

  // ------------------------------------------------------------- backpacks
  /**
   * The Backpack list, as this window sees it.
   *
   * The list itself is application-level; `activeBackpackId` is not -- it is
   * whichever Backpack THIS window has entered. Two windows in different
   * Backpacks must each see their own, which is the same recipient-projection
   * shape as Hermes dock ownership.
   */
  listBackpacksFor(windowId: number | null): { backpacks: BackpackSummary[]; activeBackpackId: string | null } {
    return {
      backpacks: this.deps.registry.list(),
      activeBackpackId: windowId === null ? null : this.activeBackpackForWindow(windowId),
    };
  }

  private activeBackpackForWindow(windowId: number): string | null {
    const activeSurfaceId = this.deps.activeSurfaceId(windowId);
    if (activeSurfaceId) {
      const surface = this.deps.logicalSurfaces.get(activeSurfaceId);
      if (surface?.windowId === windowId) return surface.projectId;
    }
    return this.deps.enteredBackpack(windowId);
  }

  private isBackpackActiveAnywhere(backpackId: string): boolean {
    return this.deps.hostWindowIds()
      .some((windowId) => this.activeBackpackForWindow(windowId) === backpackId);
  }

  listBackpacks(senderId: number): { backpacks: BackpackSummary[]; activeBackpackId: string | null } {
    return this.listBackpacksFor(this.deps.hostWindowForSender(senderId));
  }

  async createBackpack(name: string, _type: string): Promise<BackpackSummary> {
    const summary = await this.deps.registry.create(name, _type === 'canvas' ? 'canvas' : 'environment');
    this.emitBackpacksChanged();
    return summary;
  }

  async renameBackpack(id: string, name: string): Promise<void> {
    await this.deps.registry.rename(id, name);
    this.emitBackpacksChanged();
  }

  async setBackpackArchived(id: string, archived: boolean): Promise<void> {
    if (archived) {
      // Persist first. If persistence fails, live windows must keep their
      // current project and identity because the Backpack is still available.
      await this.deps.registry.setArchived(id, archived);
      // The Backpack itself became unavailable, so EVERY window that entered
      // it must leave. This is one of the few operations that legitimately
      // reaches across windows; an ordinary leave touches only its own.
      this.closeAndRetireLogicalProjectSurfaces(id);
      await this.deps.retireBackpackProjectSurfaces(id);
      this.deps.clearEnteredBackpackEverywhere(id);
      this.deps.surfaces.unbindProject(id);
    } else {
      await this.deps.registry.setArchived(id, archived);
    }
    this.emitBackpacksChanged();
  }

  async removeBackpack(id: string): Promise<void> {
    await this.deps.registry.remove(id);
    this.closeAndRetireLogicalProjectSurfaces(id);
    await this.deps.retireBackpackProjectSurfaces(id);
    this.deps.clearEnteredBackpackEverywhere(id);
    this.deps.surfaces.unbindProject(id);
    this.emitBackpacksChanged();
  }

  /** Close every attached presentation before retiring its logical identity.
   * Capture first: retireProjectSurfaces intentionally removes the records. */
  private closeAndRetireLogicalProjectSurfaces(projectId: string): void {
    const targets = this.deps.listLogicalSurfaces()
      .filter((surface) => surface.projectId === projectId && surface.kind === 'project');
    for (const { windowId, surfaceId } of targets) {
      this.deps.closeAttachedProjectSurface(windowId, surfaceId);
      this.deps.sendToWindow(windowId, 'host:event:backpack-project-close-request', { surfaceId });
    }
    this.deps.retireProjectSurfaces(projectId);

    for (const windowId of new Set(targets.map((surface) => surface.windowId))) {
      const activeSurfaceId = this.deps.activeSurfaceId(windowId);
      if (activeSurfaceId && this.deps.logicalSurfaces.get(activeSurfaceId)) continue;
      const replacement = this.deps.logicalSurfaces.listForWindow(windowId)[0] ?? null;
      this.deps.setActiveSurfaceId(windowId, replacement?.surfaceId ?? null);
      this.deps.setEnteredBackpack(windowId, replacement?.projectId ?? null);
    }
  }

  private canvasStore(backpackId: string): AtomicJsonStore {
    return new AtomicJsonStore(canvasFile(this.deps.paths, backpackId), {
      recoveryDir: this.deps.paths.recoveryDir,
    });
  }

  private async persistLastProgram(backpackId: string, programId: string | null): Promise<void> {
    const state: CanvasPersistedState = { schemaVersion: 1, lastActiveProgramId: programId };
    await this.canvasStore(backpackId).save(state);
  }

  async enterBackpack(senderId: number, id: string): Promise<{ backpack: BackpackSummary }> {
    const windowId = this.deps.hostWindowForSender(senderId);
    if (windowId === null) throw new Error('Only a Papers window may enter a Backpack.');
    const backpack = this.deps.registry.find(id);
    if (!backpack) throw new Error(`Backpack ${id} not found`);
    if (backpack.archived) throw new Error('Cannot enter an archived Backpack');
    const previous = this.activeBackpackForWindow(windowId);
    if (previous && previous !== id) {
      await this.deps.runtime.stopActive();
    }
    this.deps.setEnteredBackpack(windowId, id);
    // Entering the Backpack shell has no focused project surface until a
    // project is opened. A previous surface may remain alive for later use.
    this.deps.setActiveSurfaceId(windowId, null);
    // Entering updates the application-level most-recent record, which is a
    // legitimate application fact -- unlike "what is active now", which is
    // per window.
    await this.deps.registry.markEntered(id);
    this.emitBackpacksChanged();

    const fixturePrograms = this.deps.catalog().programs;
    if (fixturePrograms.size > 0) {
      await this.deps.runService().loadBackpackRuns(id);

      // Legacy fixture mode restores its last test program. Product-mode
      // Backpacks are environments and never enter the program runtime.
      const report = await this.canvasStore(id).load<CanvasPersistedState>();
      const lastProgram = report.value?.lastActiveProgramId ?? null;
      if (lastProgram && fixturePrograms.has(lastProgram)) {
        try {
          await this.startProgram(lastProgram);
        } catch {
          // Recovery UI reflects the failure; the frame stays usable.
        }
      }
    }
    return { backpack };
  }

  async leaveBackpack(senderId: number): Promise<void> {
    const windowId = this.deps.hostWindowForSender(senderId);
    if (windowId === null) return;
    const left = this.activeBackpackForWindow(windowId);
    await this.deps.runtime.stopActive();
    this.deps.setEnteredBackpack(windowId, null);
    this.deps.setActiveSurfaceId(windowId, null);
    // "Back to Papers" clears the resumable selection (PRODUCT.md) -- but only
    // once no window is still in that Backpack. One window leaving must not
    // erase a fact another window is living in.
    if (left && !this.isBackpackActiveAnywhere(left)) {
      await this.deps.registry.markLeft(left);
    }
    this.emitBackpacksChanged();
  }

  /**
   * The Backpack this window may reopen on startup, or null.
   *
   * Only the first window at launch carries a candidate. A window opened later
   * gets null, so New Window gives a fresh window rather than a second copy of
   * whatever was open last.
   */
  startupRestoreBackpackId(senderId: number): string | null {
    const windowId = this.deps.hostWindowForSender(senderId);
    return windowId === null ? null : this.deps.restoreBackpack(windowId);
  }

  /**
   * A0.2: a PROJECT FRAME acting for the surface it actually renders.
   *
   * The sender's own binding is the authority and a payload cannot override
   * it. Strengthened beyond the binding alone: the logical surface must still
   * be live and its fields must agree with the binding, which catches a stale
   * sender whose surface has already been retired.
   */
  private requireProjectForSender(senderId: number): string {
    const context = this.deps.surfaces.contextForSender(senderId);
    const id = context?.projectId;
    if (!context || !id) throw new Error('Enter a Backpack project before using it.');
    if (context.surfaceId) {
      const surface = this.deps.logicalSurfaces.get(context.surfaceId);
      if (!surface) throw new Error('This surface is no longer open.');
      if (surface.projectId !== id || surface.windowId !== context.windowId) {
        throw new Error('This surface no longer matches its Papers window.');
      }
    }
    const backpack = this.deps.registry.find(id);
    if (!backpack || backpack.archived) {
      this.deps.surfaces.unbindProject(id);
      throw new Error('This Backpack project is no longer available.');
    }
    return id;
  }

  /**
   * A0.2: a HOST renderer naming an explicit target.
   *
   * A host sender proves which WINDOW it is and nothing more. It must name the
   * surface it means, and both ids must agree with current state.
   *
   * Deliberately no "if the window has exactly one surface, infer it" shortcut,
   * even temporarily: the same call would silently target a surface with one
   * open and become ambiguous with two, so a missing-target bug would work
   * throughout early development and break only once a second tab existed.
   */
  private requireHostSurfaceTarget(senderId: number, surfaceId: string): { surfaceId: string; projectId: string; windowId: number } {
    const windowId = this.deps.hostWindowForSender(senderId);
    if (windowId === null) throw new Error('Only a Papers window may act on a surface.');
    if (!this.deps.logicalSurfaces.isLiveIn(surfaceId, windowId)) {
      throw new Error('That surface is not open in this Papers window.');
    }
    const surface = this.deps.logicalSurfaces.get(surfaceId);
    if (!surface) throw new Error('That surface is not open in this Papers window.');
    const backpack = this.deps.registry.find(surface.projectId);
    if (!backpack || backpack.archived) throw new Error('This Backpack project is no longer available.');
    // The surface is authoritative for which project this is -- never
    // enteredBackpackId, which is a UI projection, not a target.
    return { surfaceId, projectId: surface.projectId, windowId };
  }

  /**
   * A0.2: a creation operation, so it does NOT require an existing surface.
   * Authority is the real host sender proving its window, plus an explicit
   * project id. It returns the surfaceId that every later operation on this
   * view must name.
   */
  async openBackpackProject(senderId: number, id: string): Promise<OpenBackpackProject | null> {
    const windowId = this.deps.hostWindowForSender(senderId);
    if (windowId === null) throw new Error('Only a Papers window may open a Backpack project.');
    const backpack = this.deps.registry.find(id);
    if (!backpack) throw new Error(`Backpack ${id} not found`);
    if (backpack.archived) throw new Error('Restore this Backpack before entering it.');
    const project = await this.deps.backpackProjects.open(id);
    await this.deps.registry.markEntered(id);
    // A null project is a successful entry into a valid empty Backpack. The
    // window must still become entered and the registry must still record the
    // application MRU; only the project-surface binding is conditional.
    this.deps.setEnteredBackpack(windowId, id);
    // Bind the asking host surface immediately, so every later request from
    // this window resolves through its own sender rather than ambient state.
    if (!project) {
      this.emitBackpacksChanged();
      return null;
    }
    // A0.2.1: the host renderer is NOT bound as a project surface. It proves
    // a window through the window registry; project authority belongs to the
    // frame that actually renders the project, and to explicitly targeted host
    // commands.
    // The creation operation allocates the logical surface and hands back its
    // id. Every later operation on this view names that id explicitly.
    const surface = this.deps.logicalSurfaces.create({ windowId, projectId: id, kind: 'project' });
    this.deps.setActiveSurfaceId(windowId, surface.surfaceId);
    this.emitBackpacksChanged();
    return { ...project, surfaceId: surface.surfaceId };
  }

  async closeBackpackProject(senderId: number, surfaceId: string): Promise<void> {
    // Leaving retires the surface: this is the creator closing the view, not a
    // renderer being rebuilt, so its id is spent for good.
    const { windowId } = this.requireHostSurfaceTarget(senderId, surfaceId);
    this.deps.closeBackpackProjectSurface(senderId, surfaceId);
    this.deps.logicalSurfaces.retire(surfaceId);
    if (this.deps.activeSurfaceId(windowId) === surfaceId) {
      const replacement = this.deps.logicalSurfaces.listForWindow(windowId)[0] ?? null;
      this.deps.setActiveSurfaceId(windowId, replacement?.surfaceId ?? null);
      this.deps.setEnteredBackpack(windowId, replacement?.projectId ?? null);
    }
    this.emitBackpacksChanged();
  }

  activateBackpackProjectSurface(senderId: number, surfaceId: string): void {
    const { windowId, projectId } = this.requireHostSurfaceTarget(senderId, surfaceId);
    this.deps.setActiveSurfaceId(windowId, surfaceId);
    this.deps.setEnteredBackpack(windowId, projectId);
    this.emitBackpacksChanged();
  }

  /**
   * Binding order, which is load-bearing:
   *
   *   open  -> binds the asking host surface to the project
   *   show  -> verifies the URL belongs to THAT project
   *   shown -> the created project frame is bound to the same context
   *
   * The check below is why the order is safe. Proving the host belongs to some
   * project is not enough: a host bound to A could otherwise pass a
   * `papers-backpack://B/...` URL and leave an A-host paired with a B-project.
   * The frame binding that follows is then a consequence of an identity
   * already checked, not a second source of truth.
   */
  async showBackpackProjectSurface(senderId: number, surfaceId: string, url: string): Promise<void> {
    const { projectId } = this.requireHostSurfaceTarget(senderId, surfaceId);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Backpack project surface URL is not valid.');
    }
    if (parsed.protocol !== `${BACKPACK_PROJECT_SCHEME}:` || parsed.host !== projectId) {
      throw new Error('This surface may not show another Backpack project.');
    }
    await this.deps.showBackpackProjectSurface(senderId, surfaceId, url);
  }

  /**
   * Take down the attached project surface in THIS window.
   *
   * Hiding is not leaving. `BackpackProjectFrame` hides on unmount and shows
   * again on mount, so the host must stay authorized to show once more --
   * unbinding it here would refuse the very next showSurface. Compact widgets
   * outlive a return to the Backpack list and carry the same owning window id,
   * so they must survive this too.
   *
   * What unbinds is therefore only what actually dies: the attached frame,
   * through its own `destroyed` event. Leaving the project is
   * `closeBackpackProject`, which unbinds the host; archiving or removing a
   * Backpack unbinds the whole project, because it genuinely becomes
   * unavailable.
   *
   * Idempotent: an unbound sender's hide is a no-op, not an error.
   */
  hideBackpackProjectSurface(senderId: number, surfaceId: string): void {
    // Hiding is still not leaving, so the surface stays live and bound; this
    // only takes down the view. An unknown target is refused rather than
    // silently hiding whatever this window happens to show.
    this.requireHostSurfaceTarget(senderId, surfaceId);
    this.deps.hideBackpackProjectSurface(senderId, surfaceId);
  }

  setBackpackProjectSurfaceBounds(
    senderId: number,
    surfaceId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    this.requireHostSurfaceTarget(senderId, surfaceId);
    this.deps.setBackpackProjectSurfaceBounds(senderId, surfaceId, bounds);
  }

  /**
   * A project frame asking Papers to leave it.
   *
   * Answered through the host renderer of the SAME window, never every host
   * showing this project: two windows may legitimately show one project, and
   * closing one surface must not close the other. Window identity is the
   * question here, not project identity.
   */
  /**
   * A project frame asking Papers to leave it.
   *
   * Carries the exact surface, taken from the frame's own binding. A close
   * request with no target would mean "whatever surface that host currently
   * has selected", which is wrong the moment a window holds more than one.
   *
   * Delivered to that surface's own window: two windows may show one project,
   * and closing here must not close there.
   */
  requestCloseBackpackProject(senderId: number): void {
    const context = this.deps.surfaces.contextForSender(senderId);
    if (!context?.surfaceId) return;
    const surface = this.deps.logicalSurfaces.get(context.surfaceId);
    if (!surface || surface.windowId !== context.windowId) return;
    this.deps.closeAttachedProjectSurface(context.windowId, context.surfaceId);
    this.deps.logicalSurfaces.retire(context.surfaceId);
    this.deps.surfaces.unbind(senderId);

    if (this.deps.activeSurfaceId(context.windowId) === context.surfaceId) {
      const replacement = this.deps.logicalSurfaces.listForWindow(context.windowId)[0] ?? null;
      this.deps.setActiveSurfaceId(context.windowId, replacement?.surfaceId ?? null);
      this.deps.setEnteredBackpack(context.windowId, replacement?.projectId ?? null);
    }
    this.deps.sendToWindow(
      context.windowId,
      'host:event:backpack-project-close-request',
      { surfaceId: context.surfaceId },
    );
  }

  async runBackpackProjectAction(senderId: number, actionId: string): Promise<void> {
    await this.deps.backpackProjects.runAction(this.requireProjectForSender(senderId), actionId);
  }

  copyBackpackProjectText(senderId: number, text: string): void {
    this.requireProjectForSender(senderId);
    clipboard.writeText(text);
  }

  /** Load with the revision needed to save safely afterwards. */
  async loadBackpackProjectStateVersioned(senderId: number): Promise<LoadedBackpackProjectState> {
    return this.deps.backpackProjects.loadStateVersioned(this.requireProjectForSender(senderId));
  }

  async loadBackpackProjectState(senderId: number): Promise<unknown> {
    return this.deps.backpackProjects.loadState(this.requireProjectForSender(senderId));
  }

  /**
   * Delegate Wave relay.
   *
   * Two values that must agree, and a third gate that decides. The registry
   * says which project this WebContents belongs to; the preload says which
   * `papers-backpack://<id>` origin it is serving. Since sender routing landed
   * these are no longer INDEPENDENT -- both descend from the surface identity
   * -- but they cross different boundaries, and if they ever disagree,
   * refusing is far safer than picking a winner. The relay then applies the
   * decisive check: whether this is the single Backpack Papers was configured
   * to permit.
   *
   * The relay is called with the registry-resolved id, never the payload's.
   */
  async callDelegateWave(
    senderId: number,
    backpackId: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const projectId = this.requireProjectForSender(senderId);
    if (backpackId !== projectId) {
      return { ok: false, code: 'NOT_PERMITTED', message: 'This Backpack may not use Delegate Wave.' };
    }
    return this.deps.delegateWave.call(projectId, operation, params);
  }

  async saveBackpackProjectState(senderId: number, rawState: string): Promise<void> {
    await this.deps.backpackProjects.saveState(this.requireProjectForSender(senderId), rawState);
  }

  /**
   * Compare-and-set save. The caller presents the revision it last read; a save
   * built on an older revision is refused instead of overwriting the newer one.
   *
   * Papers does not inspect the document to decide this -- the revision is a
   * hash of opaque bytes -- so the refusal stays a host-level safety property
   * and never becomes knowledge of what a Backpack document means.
   */
  async saveBackpackProjectStateChecked(
    senderId: number,
    rawState: string,
    expectedRevision: string,
  ): Promise<SaveStateResult> {
    return this.deps.backpackProjects.saveState(
      this.requireProjectForSender(senderId),
      rawState,
      expectedRevision,
    );
  }

  async pickBackpackProjectTarget(
    senderId: number,
    kind: 'file' | 'folder',
  ): Promise<{ target: string; icon: string | null } | null> {
    this.requireProjectForSender(senderId);
    const result = await dialog.showOpenDialog({
      title: kind === 'file' ? 'Choose a shortcut, script, app, or file' : 'Choose a folder',
      properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
    });
    const target = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!target) return null;
    return {
      target,
      icon: await this.deps.backpackProjects.targetIcon(target),
    };
  }

  async backpackProjectShortcutIcon(senderId: number, shortcutId: string): Promise<string | null> {
    return this.deps.backpackProjects.shortcutIcon(
      this.requireProjectForSender(senderId),
      shortcutId,
    );
  }

  async launchBackpackProjectShortcut(senderId: number, shortcutId: string): Promise<void> {
    await this.deps.backpackProjects.launchShortcut(this.requireProjectForSender(senderId), shortcutId);
  }

  async revealBackpackProjectShortcut(senderId: number, shortcutId: string): Promise<void> {
    await this.deps.backpackProjects.revealShortcut(this.requireProjectForSender(senderId), shortcutId);
  }

  async openBackpackProjectWebLink(senderId: number, url: string): Promise<void> {
    this.requireProjectForSender(senderId);
    await shell.openExternal(parseBackpackProjectWebUrl(url));
  }

  async resolveBackpackProjectDroppedTargets(
    senderId: number,
    paths: string[],
  ): Promise<Array<{ name: string; target: string; kind: 'file' | 'folder' }>> {
    this.requireProjectForSender(senderId);
    return this.deps.backpackProjects.describeDroppedTargets(paths);
  }

  async resolveBackpackProjectWebLinkIcon(
    senderId: number,
    url: string,
  ): Promise<{ icon: string | null; finalUrl: string; finalOrigin: string; title: string | null }> {
    return this.deps.backpackProjects.resolveWebLinkIcon(this.requireProjectForSender(senderId), url);
  }

  // -------------------------------------------------------------- programs
  programCatalog(): {
    programs: ProgramManifest[];
    issues: { directory: string; problem: string }[];
    statuses: ProgramStatus[];
    activeProgramId: string | null;
  } {
    const catalog = this.deps.catalog();
    const programs = [...catalog.programs.values()];
    return {
      programs,
      issues: catalog.issues,
      statuses: programs.map((p) => this.deps.runtime.status(p.id)),
      activeProgramId: this.deps.runtime.activeProgram?.programId ?? null,
    };
  }

  /**
   * The Backpack the Canvas runtime is working in.
   *
   * Canvas is fixture-gated and attached to one window, so it resolves against
   * that window's entered Backpack explicitly rather than reading whatever
   * some window happens to have open.
   */
  private requireCanvasBackpack(): string {
    const windowId = this.deps.canvasRuntimeWindow();
    const backpackId = windowId === null ? null : this.deps.enteredBackpack(windowId);
    if (!backpackId) throw new Error('No Backpack is active');
    return backpackId;
  }

  async startProgram(programId: string): Promise<void> {
    const backpackId = this.requireCanvasBackpack();
    const manifest = this.deps.catalog().programs.get(programId);
    if (!manifest) throw new Error(`Program ${programId} not found`);
    await this.deps.runtime.start(backpackId, manifest);
    await this.persistLastProgram(backpackId, programId);
  }

  async stopProgram(): Promise<void> {
    const active = this.deps.runtime.activeProgram;
    await this.deps.runtime.stopActive();
    if (active) {
      this.deps.canvasState.onProgramStopped(active.programId);
      const windowId = this.deps.canvasRuntimeWindow();
      const backpackId = windowId === null ? null : this.deps.enteredBackpack(windowId);
      if (backpackId) await this.persistLastProgram(backpackId, null);
    }
  }

  async restartProgram(programId: string): Promise<void> {
    const backpackId = this.requireCanvasBackpack();
    const manifest = this.deps.catalog().programs.get(programId);
    if (!manifest) throw new Error(`Program ${programId} not found`);
    await this.deps.runtime.stopActive();
    this.deps.canvasState.onProgramStopped(programId);
    await this.deps.runtime.start(backpackId, manifest);
  }

  clearQuarantine(programId: string): void {
    this.deps.runtime.clearQuarantine(programId);
  }

  invokeProgramCommand(commandId: string): void {
    this.deps.runtime.sendToActiveProgram('program:command', { commandId });
  }

  // ---------------------------------------------------------------- layout
  setProgramBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.deps.runtime.setBounds(bounds);
  }

  setOverlayActive(active: boolean): void {
    this.deps.runtime.setOverlayVisible(!active);
  }

  /** Match the native min/maximize/close overlay to the active Papers theme. */
  setTitleBarOverlay(senderId: number, color: string, symbolColor: string): void {
    this.deps.setTitleBarOverlay(senderId, color, symbolColor);
  }

  getSettings(): unknown {
    return this.deps.getSettings();
  }

  setTransparentWindow(enabled: boolean): Promise<void> {
    return this.deps.setTransparentWindow(enabled);
  }

  saveWindowBounds(senderId: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.deps.saveWindowBounds(senderId);
  }

  clearWindowBounds(): Promise<void> {
    return this.deps.clearWindowBounds();
  }

  commitWorkspaceTopology(senderId: number, topology: WorkspaceTopologyV1): void {
    const windowId = this.deps.hostWindowForSender(senderId);
    if (windowId === null) throw new Error('Only a Papers window may commit workspace topology.');
    this.validateWorkspaceTopology(windowId, topology);
    this.deps.setWorkspaceTopology(windowId, topology);
  }

  restoreWorkspaceTopology(windowId: number, topology: WorkspaceTopologyV1): void {
    this.validateWorkspaceTopology(windowId, topology);
    const focused = topology.groups.find((group) => group.groupId === topology.focusedGroupId);
    const activeSurfaceId = focused?.activeSurfaceId ?? null;
    const activeProject = activeSurfaceId
      ? topology.surfaces.find((surface) => surface.surfaceId === activeSurfaceId)?.projectId ?? null
      : null;
    this.deps.setActiveSurfaceId(windowId, activeSurfaceId);
    this.deps.setEnteredBackpack(windowId, activeProject);
    this.deps.setWorkspaceTopology(windowId, topology);
    this.deps.sendToWindow(windowId, 'host:event:workspace-topology', topology);
  }

  closeWorkspaceSurfaceFromControl(windowId: number, surfaceId: string, topology: WorkspaceTopologyV1): WorkspaceTopologyV1 {
    const surface = this.deps.logicalSurfaces.get(surfaceId);
    if (!surface || surface.windowId !== windowId || surface.kind !== 'project') {
      throw new Error('That surface is not open in that Papers window.');
    }
    this.validateWorkspaceTopology(windowId, topology);
    this.deps.closeAttachedProjectSurface(windowId, surfaceId);
    this.deps.logicalSurfaces.retire(surfaceId);
    for (const senderId of this.deps.surfaces.sendersForSurface(surfaceId)) this.deps.surfaces.unbind(senderId);
    const next = closeWorkspaceSurface(topology, surfaceId);
    this.restoreWorkspaceTopology(windowId, next);
    this.deps.sendToWindow(windowId, 'host:event:backpack-project-close-request', { surfaceId });
    return next;
  }

  private validateWorkspaceTopology(windowId: number, topology: WorkspaceTopologyV1): void {
    if (!this.deps.hostWindowIds().includes(windowId)) throw new Error('That Papers window is not live.');
    const live = this.deps.logicalSurfaces.listForWindow(windowId)
      .filter((surface) => surface.kind === 'project');
    if (topology.surfaces.length !== live.length) {
      throw new Error('Workspace topology must contain every live project surface in its Papers window.');
    }
    const liveById = new Map(live.map((surface) => [surface.surfaceId, surface.projectId]));
    if (topology.surfaces.some((surface) => liveById.get(surface.surfaceId) !== surface.projectId)) {
      throw new Error('Workspace topology surface identity does not match its Papers window.');
    }
    assertValidWorkspaceTopology(topology);
    const flatRoot = topology.root.kind === 'group'
      ? topology.groups.length === 1 && topology.root.groupId === topology.groups[0]?.groupId
      : topology.groups.length === 2
        && topology.root.children.length === 2
        && topology.root.children.every((child) => child.kind === 'group');
    if (!flatRoot) throw new Error('Only an exact flat one- or two-group workspace topology is currently supported.');
  }

  // ----------------------------------------------------------- permissions
  listPermissions(): unknown {
    return this.deps.permissionStore.listGrants();
  }

  async revokePermission(backpackId: string, programId: string, capability: string): Promise<boolean> {
    return this.deps.permissionStore.revoke(backpackId, programId, capability);
  }

  /** PermissionPrompter implementation used by the CapabilityBroker. */
  prompt(prompt: PendingPermissionPrompt): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPermissionPrompts.set(prompt.promptId, resolve);
      this.sendToRuntimeOwner('host:event:permission-prompt', prompt);
      // Deny automatically if the creator does not respond within 5 minutes.
      setTimeout(() => {
        const pending = this.pendingPermissionPrompts.get(prompt.promptId);
        if (pending) {
          this.pendingPermissionPrompts.delete(prompt.promptId);
          pending('deny');
        }
      }, 300_000);
    });
  }

  respondToPrompt(promptId: string, decision: PermissionDecision): void {
    const pending = this.pendingPermissionPrompts.get(promptId);
    if (!pending) throw new Error('prompt is no longer pending');
    this.pendingPermissionPrompts.delete(promptId);
    pending(decision);
  }

  /** Invocation preview confirmation used by the AgentRunService. */
  confirmInvocation(preview: InvocationPreview): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingInvocationPreviews.set(preview.previewId, resolve);
      this.sendToRuntimeOwner('host:event:invocation-preview', preview);
      setTimeout(() => {
        const pending = this.pendingInvocationPreviews.get(preview.previewId);
        if (pending) {
          this.pendingInvocationPreviews.delete(preview.previewId);
          pending(false);
        }
      }, 600_000);
    });
  }

  respondInvocation(previewId: string, approved: boolean): void {
    const pending = this.pendingInvocationPreviews.get(previewId);
    if (!pending) throw new Error('invocation preview is no longer pending');
    this.pendingInvocationPreviews.delete(previewId);
    pending(approved);
  }

  // ------------------------------------------------------------------ runs
  /** Runs are listed for the Backpack the asking window has entered. */
  listRuns(senderId: number): unknown {
    const windowId = this.deps.hostWindowForSender(senderId);
    return this.deps.runService().list(windowId === null ? null : this.activeBackpackForWindow(windowId));
  }

  getRun(runId: string): unknown {
    return this.deps.runService().get(runId);
  }

  async cancelRun(runId: string): Promise<void> {
    await this.deps.runService().cancel(runId);
  }

  async respondRunInteraction(runId: string, requestId: string, optionId: string): Promise<void> {
    await this.deps.runService().respondInteraction(runId, requestId, optionId);
  }

  async retryRun(runId: string): Promise<unknown> {
    return this.deps.runService().retry(runId);
  }

  async replyToRun(runId: string, text: string): Promise<void> {
    await this.deps.runService().continueRun(runId, text);
  }

  composedPrompt(runId: string): string {
    return this.deps.runService().composedPrompt(runId);
  }

  /**
   * Inspect in Hermes: no stable per-session deep link is documented for
   * Hermes Desktop, so open/focus the Desktop and give the creator the
   * authoritative session id to find or inspect.
   */
  async inspectRunInHermes(runId: string): Promise<{ sessionId: string | null; opened: boolean }> {
    const run = this.deps.runService().get(runId);
    const sessionId = run?.sessionId ?? null;
    return { sessionId, opened: false };
  }

  /** Returning to a run's origin happens in the window that asked, so it does
   * not drag another window into that Backpack. */
  async returnToOrigin(senderId: number, runId: string): Promise<void> {
    const run = this.deps.runService().get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const windowId = this.deps.hostWindowForSender(senderId);
    const entered = windowId === null ? null : this.activeBackpackForWindow(windowId);
    if (entered !== run.backpackId) {
      await this.enterBackpack(senderId, run.backpackId);
    }
    if (this.deps.runtime.activeProgram?.programId !== run.programId) {
      await this.startProgram(run.programId);
    }
  }

  /** Which build this is and where it runs from, for telling machines apart. */
  buildIdentity(): unknown {
    return buildIdentity();
  }

  updateStatus(): unknown {
    return this.deps.updater.current;
  }

  checkForUpdate(): Promise<unknown> {
    return this.deps.updater.checkNow();
  }

  installUpdate(): Promise<void> {
    return this.deps.updater.installNow();
  }

  hermesHealth(): unknown {
    return this.deps.adapter.health;
  }

  /**
   * Hermes presentation, as this particular window should read it.
   *
   * `placement` is global truth about Hermes -- closed, docked or detached.
   * `ownedByThisWindow` is relative to the recipient. If Hermes is docked to
   * window B, then B is told { docked, owned: true } and A is told
   * { docked, owned: false }, and A's dock button therefore offers to TAKE
   * Hermes rather than to hide someone else's. A fourth placement value would
   * have mixed global state with the recipient's perspective.
   *
   * Ownership does not apply to closed or detached, where it is simply false.
   */
  private hermesPresentationFor(windowId: number | null): unknown {
    const state = this.deps.hermesSurface.state;
    return {
      ...state,
      ownedByThisWindow: state.placement === 'docked' && windowId !== null && this.deps.hermesDockOwner() === windowId,
    };
  }

  hermesSurfaceStatus(senderId: number): unknown {
    return this.hermesPresentationFor(this.deps.hostWindowForSender(senderId));
  }

  /**
   * Dock the real Hermes Desktop window at Papers-relative bounds.
   *
   * This is the ONLY transfer of dock ownership, and it is deliberate: the
   * creator pressed Dock in this window. Focus never transfers ownership,
   * because a single global Hermes window that followed focus would move a
   * live agent session between windows by accident (D-021).
   */
  async dockHermes(senderId: number, bounds: SurfaceBounds): Promise<unknown> {
    return this.runHermesPlacement(async () => {
      const windowId = this.deps.hostWindowForSender(senderId);
      if (windowId === null) throw new Error('Only a Papers window may dock Hermes.');
      const previousOwner = this.deps.hermesDockOwner();
      this.deps.setHermesDockOwner(windowId);
      const result = await this.deps.hermesSurface.dock(bounds);
      if (result.placement !== 'docked' || result.status !== 'ready') {
        this.deps.setHermesDockOwner(previousOwner);
      }
      this.emitHermesSurface();
      return this.hermesPresentationFor(windowId);
    });
  }

  /** Keep the docked Hermes window aligned as Papers moves/resizes. Accepted
   * only from the current owner: a resize in one window must never reposition
   * a Hermes docked to another. */
  setHermesDockBounds(senderId: number, bounds: SurfaceBounds): void {
    if (!this.isHermesDockOwner(senderId)) return;
    this.deps.hermesSurface.setDockBounds(bounds);
  }

  /** Hide the docked placement without terminating Hermes or its session.
   * Only the owner may hide it; a non-owner that wants Hermes uses dock,
   * which transfers ownership rather than taking it away from someone. */
  async hideHermesDock(senderId: number): Promise<void> {
    return this.runHermesPlacement(async () => {
      if (!this.isHermesDockOwner(senderId)) return;
      await this.deps.hermesSurface.hideDock();
      this.deps.setHermesDockOwner(null);
      this.emitHermesSurface();
    });
  }

  /** Detach Hermes into a free-floating window (same experience, same session). */
  async showHermesWindow(): Promise<unknown> {
    return this.runHermesPlacement(async () => {
      // Hermes stays global. Entering a Backpack never changes Hermes's working
      // directory, so the window launches with no Backpack-derived context.
      const previousOwner = this.deps.hermesDockOwner();
      const result = await this.deps.hermesSurface.showDetached();
      if (result.placement === 'detached' && result.status === 'ready') {
        // A detached Hermes belongs to no Papers window.
        this.deps.setHermesDockOwner(null);
      } else {
        this.deps.setHermesDockOwner(previousOwner);
      }
      this.emitHermesSurface();
      return result;
    });
  }

  /** Hide the detached window without terminating Hermes or its session. */
  async hideHermesWindow(): Promise<void> {
    return this.runHermesPlacement(async () => {
      await this.deps.hermesSurface.hideDetached();
      this.emitHermesSurface();
    });
  }

  /** Reconcile the one global Hermes placement before its dock-owning Papers
   * window disappears. This shares the placement queue with renderer actions,
   * so close can neither interleave with nor roll back a later dock/detach. */
  async onPapersWindowClosing(windowId: number): Promise<void> {
    return this.runHermesPlacement(async () => {
      if (this.deps.hermesDockOwner() !== windowId) return;
      if (this.deps.hermesSurface.state.placement === 'docked') {
        await this.deps.hermesSurface.hideDock();
      }
      this.deps.setHermesDockOwner(null);
      this.emitHermesSurface();
    });
  }

  private isHermesDockOwner(senderId: number): boolean {
    const windowId = this.deps.hostWindowForSender(senderId);
    return windowId !== null && this.deps.hermesDockOwner() === windowId;
  }

  /** Every window hears the same placement, each with its own answer to
   * whether it owns the dock. */
  emitHermesSurface(): void {
    for (const windowId of this.deps.hostWindowIds()) {
      this.deps.sendToWindow(windowId, 'host:event:hermes-surface', this.hermesPresentationFor(windowId));
    }
  }

  defaultRunCwd(backpackId: string): string {
    return backpackDir(this.deps.paths, backpackId);
  }

  async openExternalUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('only http(s) URLs may be opened');
    }
    await shell.openExternal(parsed.toString());
  }
}
