/**
 * IPC surface for the trusted host frame renderer. Only the host view's
 * WebContents may call these channels.
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';

import { backpackNameSchema } from '@shared/schemas';
import type { PermissionDecision } from '@shared/types';

export interface HostFacade {
  isHostSender(sender: WebContents): boolean;

  listBackpacks(): unknown;
  createBackpack(name: string, type: string): Promise<unknown>;
  renameBackpack(id: string, name: string): Promise<void>;
  setBackpackArchived(id: string, archived: boolean): Promise<void>;
  enterBackpack(id: string): Promise<unknown>;
  leaveBackpack(): Promise<void>;
  lastActiveBackpackId(): string | null;

  programCatalog(): unknown;
  startProgram(programId: string): Promise<void>;
  stopProgram(): Promise<void>;
  restartProgram(programId: string): Promise<void>;
  clearQuarantine(programId: string): void;
  invokeProgramCommand(commandId: string): void;

  setProgramBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setOverlayActive(active: boolean): void;

  listPermissions(): unknown;
  revokePermission(backpackId: string, programId: string, capability: string): Promise<boolean>;
  respondToPrompt(promptId: string, decision: PermissionDecision): void;

  listRuns(): unknown;
  getRun(runId: string): unknown;
  cancelRun(runId: string): Promise<void>;
  respondRunInteraction(runId: string, requestId: string, optionId: string): Promise<void>;
  retryRun(runId: string): Promise<unknown>;
  inspectRunInHermes(runId: string): Promise<unknown>;
  returnToOrigin(runId: string): Promise<void>;
  respondInvocation(previewId: string, approved: boolean): void;
  replyToRun(runId: string, text: string): Promise<void>;
  composedPrompt(runId: string): string;

  hermesHealth(): unknown;
  hermesSurfaceStatus(): unknown;
  dockHermes(bounds: { x: number; y: number; width: number; height: number }): Promise<unknown>;
  setHermesDockBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  hideHermesDock(): void;
  showHermesWindow(): Promise<unknown>;
  hideHermesWindow(): void;
}

const boundsSchema = z
  .object({
    x: z.number().int().min(0).max(20_000),
    y: z.number().int().min(0).max(20_000),
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
  })
  .strict();

const idSchema = z.string().min(1).max(128);
const decisionSchema = z.enum(['allow-once', 'allow-program', 'deny']);

export function registerHostIpc(facade: HostFacade): void {
  const guard = (event: IpcMainInvokeEvent): void => {
    if (!facade.isHostSender(event.sender)) {
      throw new Error('host channel called from non-host sender');
    }
  };

  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      guard(event);
      return handler(event, ...args);
    });
  };

  handle('host:backpacks:list', () => facade.listBackpacks());
  handle('host:backpacks:create', (_e, name, type) =>
    facade.createBackpack(backpackNameSchema.parse(name), z.enum(['environment', 'canvas']).parse(type)),
  );
  handle('host:backpacks:rename', (_e, id, name) =>
    facade.renameBackpack(idSchema.parse(id), backpackNameSchema.parse(name)),
  );
  handle('host:backpacks:set-archived', (_e, id, archived) =>
    facade.setBackpackArchived(idSchema.parse(id), z.boolean().parse(archived)),
  );
  handle('host:backpacks:enter', (_e, id) => facade.enterBackpack(idSchema.parse(id)));
  handle('host:backpacks:leave', () => facade.leaveBackpack());
  handle('host:backpacks:last-active', () => facade.lastActiveBackpackId());

  handle('host:programs:catalog', () => facade.programCatalog());
  handle('host:programs:start', (_e, programId) => facade.startProgram(idSchema.parse(programId)));
  handle('host:programs:stop', () => facade.stopProgram());
  handle('host:programs:restart', (_e, programId) =>
    facade.restartProgram(idSchema.parse(programId)),
  );
  handle('host:programs:clear-quarantine', (_e, programId) =>
    facade.clearQuarantine(idSchema.parse(programId)),
  );
  handle('host:programs:invoke-command', (_e, commandId) =>
    facade.invokeProgramCommand(idSchema.parse(commandId)),
  );

  handle('host:layout:set-program-bounds', (_e, bounds) =>
    facade.setProgramBounds(boundsSchema.parse(bounds)),
  );
  handle('host:layout:set-overlay', (_e, active) =>
    facade.setOverlayActive(z.boolean().parse(active)),
  );

  handle('host:permissions:list', () => facade.listPermissions());
  handle('host:permissions:revoke', (_e, backpackId, programId, capability) =>
    facade.revokePermission(
      idSchema.parse(backpackId),
      idSchema.parse(programId),
      idSchema.parse(capability),
    ),
  );
  handle('host:permissions:respond', (_e, promptId, decision) =>
    facade.respondToPrompt(idSchema.parse(promptId), decisionSchema.parse(decision)),
  );

  handle('host:runs:list', () => facade.listRuns());
  handle('host:runs:get', (_e, runId) => facade.getRun(idSchema.parse(runId)));
  handle('host:runs:cancel', (_e, runId) => facade.cancelRun(idSchema.parse(runId)));
  handle('host:runs:respond-interaction', (_e, runId, requestId, optionId) =>
    facade.respondRunInteraction(
      idSchema.parse(runId),
      idSchema.parse(requestId),
      idSchema.parse(optionId),
    ),
  );
  handle('host:runs:retry', (_e, runId) => facade.retryRun(idSchema.parse(runId)));
  handle('host:runs:inspect-in-hermes', (_e, runId) =>
    facade.inspectRunInHermes(idSchema.parse(runId)),
  );
  handle('host:runs:return-to-origin', (_e, runId) =>
    facade.returnToOrigin(idSchema.parse(runId)),
  );
  handle('host:runs:respond-invocation', (_e, previewId, approved) =>
    facade.respondInvocation(idSchema.parse(previewId), z.boolean().parse(approved)),
  );
  handle('host:runs:reply', (_e, runId, text) =>
    facade.replyToRun(idSchema.parse(runId), z.string().min(1).max(10_000).parse(text)),
  );
  handle('host:runs:composed-prompt', (_e, runId) =>
    facade.composedPrompt(idSchema.parse(runId)),
  );

  handle('host:hermes:health', () => facade.hermesHealth());
  handle('host:hermes:surface-status', () => facade.hermesSurfaceStatus());
  handle('host:hermes:dock', (_e, bounds) => facade.dockHermes(boundsSchema.parse(bounds)));
  handle('host:hermes:set-dock-bounds', (_e, bounds) =>
    facade.setHermesDockBounds(boundsSchema.parse(bounds)),
  );
  handle('host:hermes:hide-dock', () => facade.hideHermesDock());
  handle('host:hermes:show-window', () => facade.showHermesWindow());
  handle('host:hermes:hide-window', () => facade.hideHermesWindow());
}
