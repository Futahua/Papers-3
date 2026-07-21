/**
 * PapersHostFacade — coordination between the host renderer, Backpack
 * registry, Canvas runtime, permissions, agent runs, and Hermes. Implements
 * the HostFacade IPC contract.
 */
import { randomUUID } from 'node:crypto';
import { dialog, shell, type WebContents } from 'electron';

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
import type { BackpackRegistry } from './backpacks/backpackRegistry';
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
  registry: BackpackRegistry;
  runtime: CanvasRuntime;
  canvasState: CanvasSessionState;
  catalog: () => ProgramCatalog;
  permissionStore: PermissionStore;
  adapter: HermesAdapter;
  hermesSurface: HermesSurface;
  runService: () => AgentRunService;
  paths: PapersPaths;
}

export class PapersHostFacade implements HostFacade, PermissionPrompter {
  private currentBackpackId: string | null = null;
  private readonly pendingPermissionPrompts = new Map<string, (d: PermissionDecision) => void>();
  private readonly pendingInvocationPreviews = new Map<string, (approved: boolean) => void>();

  constructor(private readonly deps: FacadeDeps) {}

  // ---------------------------------------------------------------- events
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
    await this.deps.registry.setArchived(id, archived);
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

  async chooseWorkspace(): Promise<string | null> {
    if (!this.currentBackpackId) throw new Error('Enter a Backpack before choosing its workspace');
    const result = await dialog.showOpenDialog({
      title: 'Choose the folder associated with this Backpack',
      properties: ['openDirectory'],
    });
    const selected = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selected) {
      await this.deps.registry.setWorkspace(this.currentBackpackId, selected);
      this.emitBackpacksChanged();
    }
    return selected;
  }

  async clearWorkspace(): Promise<void> {
    if (!this.currentBackpackId) throw new Error('No Backpack is active');
    await this.deps.registry.setWorkspace(this.currentBackpackId, null);
    this.emitBackpacksChanged();
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
   * authoritative session id to find/inspect (plan section 15 fallback).
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

  hermesHealth(): unknown {
    return this.deps.adapter.health;
  }

  hermesSurfaceStatus(): unknown {
    return this.deps.hermesSurface.state;
  }

  showHermesSurface(bounds: SurfaceBounds): Promise<unknown> {
    return this.deps.hermesSurface.show(bounds);
  }

  hideHermesSurface(): void {
    this.deps.hermesSurface.hide();
  }

  setHermesSurfaceBounds(bounds: SurfaceBounds): void {
    this.deps.hermesSurface.setBounds(bounds);
  }

  async openHermesDesktop(): Promise<unknown> {
    const workspacePath = this.currentBackpackId
      ? this.deps.registry.find(this.currentBackpackId)?.workspacePath ?? null
      : null;
    return this.deps.hermesSurface.openDesktop(workspacePath);
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
