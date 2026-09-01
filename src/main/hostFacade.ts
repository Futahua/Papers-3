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

interface CanvasPersistedState {
  schemaVersion: 1;
  lastActiveProgramId: string | null;
}

export interface FacadeDeps {
  hostContents: () => WebContents | null;
  /** Phase 1A: which project a sender may act for. Supplied by the host so
   * project requests resolve through their own sender instead of ambient
   * state. */
  surfaces: SurfaceContextRegistry;
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
  showBackpackProjectSurface: (url: string) => Promise<void>;
  hideBackpackProjectSurface: () => void;
  runtime: CanvasRuntime;
  canvasState: CanvasSessionState;
  catalog: () => ProgramCatalog;
  permissionStore: PermissionStore;
  adapter: HermesAdapter;
  hermesSurface: HermesSurface;
  runService: () => AgentRunService;
  paths: PapersPaths;
  /** Repaint the native window-controls overlay to match the active theme. */
  setTitleBarOverlay: (color: string, symbolColor: string) => void;
  getSettings: () => unknown;
  setTransparentWindow: (enabled: boolean) => Promise<void>;
  /** Capture the window's current rectangle as the restore-on-launch preset. */
  saveWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  /** Forget the preset so Papers reopens at its default size. */
  clearWindowBounds: () => Promise<void>;
}

export class PapersHostFacade implements HostFacade, PermissionPrompter {
  private currentBackpackId: string | null = null;
  private readonly pendingPermissionPrompts = new Map<string, (d: PermissionDecision) => void>();
  private readonly pendingInvocationPreviews = new Map<string, (approved: boolean) => void>();

  constructor(private readonly deps: FacadeDeps) {}

  // ---------------------------------------------------------------- events
  /** Deliver to exactly one surface. Used where the answer belongs to the
   * window that asked, rather than to whichever host happens to be current. */
  private sendTo(senderId: number, channel: string, payload: unknown): void {
    const contents = webContents.fromId(senderId);
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  private send(channel: string, payload: unknown): void {
    const contents = this.deps.hostContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  emitBackpacksChanged(): void {
    this.send('host:event:backpacks-changed', this.listBackpacks());
  }
  emitProgramStatus(status: ProgramStatus): void {
    this.send('host:event:program-status', status);
  }
  emitShelfChanged(items: ShelfContribution[]): void {
    this.send('host:event:shelf-changed', items);
  }
  emitSaveStatus(status: SaveStatus, detail?: string): void {
    this.send('host:event:save-status', { status, detail: detail ?? null });
  }
  emitRunsChanged(snapshot: AgentRunSnapshot): void {
    this.send('host:event:runs-changed', snapshot);
  }
  emitHermesHealth(): void {
    this.send('host:event:hermes-health', this.deps.adapter.health);
  }

  isHostSender(sender: WebContents): boolean {
    const contents = this.deps.hostContents();
    return contents !== null && sender.id === contents.id;
  }

  isBackpackProjectSender(sender: WebContents): boolean {
    return this.deps.isBackpackProjectSender(sender);
  }

  get activeBackpackId(): string | null {
    return this.currentBackpackId;
  }

  // ------------------------------------------------------------- backpacks
  listBackpacks(): { backpacks: BackpackSummary[]; activeBackpackId: string | null } {
    return { backpacks: this.deps.registry.list(), activeBackpackId: this.currentBackpackId };
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
    if (archived && this.currentBackpackId === id) {
      await this.leaveBackpack();
    }
    // Archiving releases every surface bound to it, in any window; a surface
    // must not keep acting for a Backpack the creator has put away.
    if (archived) this.deps.surfaces.unbindProject(id);
    await this.deps.registry.setArchived(id, archived);
    this.emitBackpacksChanged();
  }

  async removeBackpack(id: string): Promise<void> {
    await this.deps.registry.remove(id);
    if (this.currentBackpackId === id) this.currentBackpackId = null;
    this.deps.surfaces.unbindProject(id);
    this.emitBackpacksChanged();
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

  async enterBackpack(id: string): Promise<{ backpack: BackpackSummary }> {
    const backpack = this.deps.registry.find(id);
    if (!backpack) throw new Error(`Backpack ${id} not found`);
    if (backpack.archived) throw new Error('Cannot enter an archived Backpack');
    if (this.currentBackpackId && this.currentBackpackId !== id) {
      await this.deps.runtime.stopActive();
    }
    this.currentBackpackId = id;
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

  async leaveBackpack(): Promise<void> {
    await this.deps.runtime.stopActive();
    this.currentBackpackId = null;
    await this.deps.registry.markLeft();
    this.emitBackpacksChanged();
  }

  lastActiveBackpackId(): string | null {
    return this.deps.registry.lastActiveBackpackId;
  }

  /**
   * Phase 1A: the project this sender may act for.
   *
   * The sender is the authority. An unbound sender is refused rather than
   * resolved against whatever project happens to be current, because that
   * fallback is exactly how one window's board reaches another window's file.
   */
  private requireProjectForSender(senderId: number): string {
    const id = this.deps.surfaces.projectForSender(senderId);
    if (!id) throw new Error('Enter a Backpack project before using it.');
    const backpack = this.deps.registry.find(id);
    if (!backpack || backpack.archived) {
      this.deps.surfaces.unbindProject(id);
      throw new Error('This Backpack project is no longer available.');
    }
    return id;
  }

  async openBackpackProject(senderId: number, id: string): Promise<OpenBackpackProject | null> {
    this.deps.surfaces.unbind(senderId);
    const backpack = this.deps.registry.find(id);
    if (!backpack) throw new Error(`Backpack ${id} not found`);
    if (backpack.archived) throw new Error('Restore this Backpack before entering it.');
    const project = await this.deps.backpackProjects.open(id);
    await this.deps.registry.markEntered(id);
    // Bind the asking host surface immediately, so every later request from
    // this window resolves through its own sender rather than ambient state.
    const windowId = project ? this.deps.windowIdForSender(senderId) : null;
    if (project && windowId !== null) {
      this.deps.surfaces.bind(senderId, { projectId: id, windowId, kind: 'host' });
    }
    this.emitBackpacksChanged();
    return project;
  }

  async closeBackpackProject(senderId: number): Promise<void> {
    this.deps.hideBackpackProjectSurface();
    this.deps.surfaces.unbind(senderId);
    await this.deps.registry.markLeft();
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
  async showBackpackProjectSurface(senderId: number, url: string): Promise<void> {
    const projectId = this.requireProjectForSender(senderId);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Backpack project surface URL is not valid.');
    }
    if (parsed.protocol !== `${BACKPACK_PROJECT_SCHEME}:` || parsed.host !== projectId) {
      throw new Error('This surface may not show another Backpack project.');
    }
    await this.deps.showBackpackProjectSurface(url);
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
  hideBackpackProjectSurface(senderId: number): void {
    if (!this.deps.surfaces.contextForSender(senderId)) return;
    this.deps.hideBackpackProjectSurface();
  }

  /**
   * A project frame asking Papers to leave it.
   *
   * Answered through the host renderer of the SAME window, never every host
   * showing this project: two windows may legitimately show one project, and
   * closing one surface must not close the other. Window identity is the
   * question here, not project identity.
   */
  requestCloseBackpackProject(senderId: number): void {
    const context = this.deps.surfaces.contextForSender(senderId);
    if (!context) return;
    const hostSender = this.deps.surfaces.hostSenderForWindow(context.windowId);
    if (hostSender === null) return;
    this.sendTo(hostSender, 'host:event:backpack-project-close-request', null);
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

  async startProgram(programId: string): Promise<void> {
    if (!this.currentBackpackId) throw new Error('No Backpack is active');
    const manifest = this.deps.catalog().programs.get(programId);
    if (!manifest) throw new Error(`Program ${programId} not found`);
    await this.deps.runtime.start(this.currentBackpackId, manifest);
    await this.persistLastProgram(this.currentBackpackId, programId);
  }

  async stopProgram(): Promise<void> {
    const active = this.deps.runtime.activeProgram;
    await this.deps.runtime.stopActive();
    if (active) {
      this.deps.canvasState.onProgramStopped(active.programId);
      if (this.currentBackpackId) {
        await this.persistLastProgram(this.currentBackpackId, null);
      }
    }
  }

  async restartProgram(programId: string): Promise<void> {
    if (!this.currentBackpackId) throw new Error('No Backpack is active');
    const manifest = this.deps.catalog().programs.get(programId);
    if (!manifest) throw new Error(`Program ${programId} not found`);
    await this.deps.runtime.stopActive();
    this.deps.canvasState.onProgramStopped(programId);
    await this.deps.runtime.start(this.currentBackpackId, manifest);
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
  setTitleBarOverlay(color: string, symbolColor: string): void {
    this.deps.setTitleBarOverlay(color, symbolColor);
  }

  getSettings(): unknown {
    return this.deps.getSettings();
  }

  setTransparentWindow(enabled: boolean): Promise<void> {
    return this.deps.setTransparentWindow(enabled);
  }

  saveWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.deps.saveWindowBounds();
  }

  clearWindowBounds(): Promise<void> {
    return this.deps.clearWindowBounds();
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
      this.send('host:event:permission-prompt', prompt);
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
      this.send('host:event:invocation-preview', preview);
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
  listRuns(): unknown {
    return this.deps.runService().list(this.currentBackpackId);
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

  async returnToOrigin(runId: string): Promise<void> {
    const run = this.deps.runService().get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    if (this.currentBackpackId !== run.backpackId) {
      await this.enterBackpack(run.backpackId);
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

  hermesSurfaceStatus(): unknown {
    return this.deps.hermesSurface.state;
  }

  /** Dock the real Hermes Desktop window at Papers-relative bounds. */
  dockHermes(bounds: SurfaceBounds): Promise<unknown> {
    return this.deps.hermesSurface.dock(bounds);
  }

  /** Keep the docked Hermes window aligned as Papers moves/resizes. */
  setHermesDockBounds(bounds: SurfaceBounds): void {
    this.deps.hermesSurface.setDockBounds(bounds);
  }

  /** Hide the docked placement without terminating Hermes or its session. */
  hideHermesDock(): Promise<void> {
    return this.deps.hermesSurface.hideDock();
  }

  /** Detach Hermes into a free-floating window (same experience, same session). */
  showHermesWindow(): Promise<unknown> {
    // Hermes stays global. Entering a Backpack never changes Hermes's working
    // directory, so the window launches with no Backpack-derived context.
    return this.deps.hermesSurface.showDetached();
  }

  /** Hide the detached window without terminating Hermes or its session. */
  hideHermesWindow(): Promise<void> {
    return this.deps.hermesSurface.hideDetached();
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
