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
  isBackpackProjectSender(sender: WebContents): boolean;

  buildIdentity(): unknown;
  updateStatus(): unknown;
  checkForUpdate(): Promise<unknown>;
  installUpdate(): Promise<void>;

  listBackpacks(): unknown;
  createBackpack(name: string, type: string): Promise<unknown>;
  renameBackpack(id: string, name: string): Promise<void>;
  setBackpackArchived(id: string, archived: boolean): Promise<void>;
  removeBackpack(id: string): Promise<void>;
  enterBackpack(id: string): Promise<unknown>;
  leaveBackpack(): Promise<void>;
  lastActiveBackpackId(): string | null;

  openBackpackProject(id: string): Promise<unknown>;
  closeBackpackProject(): Promise<void>;
  showBackpackProjectSurface(url: string): Promise<void>;
  hideBackpackProjectSurface(): void;
  requestCloseBackpackProject(): void;
  runBackpackProjectAction(actionId: string): Promise<void>;
  copyBackpackProjectText(text: string): void;
  loadBackpackProjectState(): Promise<unknown>;
  saveBackpackProjectState(rawState: string): Promise<void>;
  pickBackpackProjectTarget(
    kind: 'file' | 'folder',
  ): Promise<{ target: string; icon: string | null } | null>;
  backpackProjectShortcutIcon(shortcutId: string): Promise<string | null>;
  launchBackpackProjectShortcut(shortcutId: string): Promise<void>;
  revealBackpackProjectShortcut(shortcutId: string): Promise<void>;
  openBackpackProjectWebLink(url: string): Promise<void>;
  resolveBackpackProjectDroppedTargets(
    paths: string[],
  ): Promise<Array<{ name: string; target: string; kind: 'file' | 'folder' }>>;
  resolveBackpackProjectWebLinkIcon(
    url: string,
  ): Promise<{ icon: string | null; finalUrl: string; finalOrigin: string }>;

  programCatalog(): unknown;
  startProgram(programId: string): Promise<void>;
  stopProgram(): Promise<void>;
  restartProgram(programId: string): Promise<void>;
  clearQuarantine(programId: string): void;
  invokeProgramCommand(commandId: string): void;

  setProgramBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setOverlayActive(active: boolean): void;
  setTitleBarOverlay(color: string, symbolColor: string): void;
  getSettings(): unknown;
  setTransparentWindow(enabled: boolean): Promise<void>;
  saveWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  clearWindowBounds(): Promise<void>;

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
  hideHermesDock(): Promise<void>;
  showHermesWindow(): Promise<unknown>;
  hideHermesWindow(): Promise<void>;
}

const boundsSchema = z
  .object({
    x: z.number().int().min(0).max(20_000),
    y: z.number().int().min(0).max(20_000),
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
  })
  .strict();

/** Only #rrggbb / #rgb hex colours — the titleBarOverlay repaint takes no other form. */
const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

const idSchema = z.string().min(1).max(128);
const backpackRemovalIdSchema = z
  .string()
  .regex(/^bp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const backpackProjectActionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i);
const backpackProjectStateSchema = z.string().min(2).max(5_000_000);
const backpackProjectTextSchema = z.string().min(1).max(50_000);
const backpackProjectWebUrlSchema = z.string().min(8).max(2_048);
const backpackProjectDroppedPathsSchema = z.array(z.string().min(1).max(32_768)).min(1).max(64);
const decisionSchema = z.enum(['allow-once', 'allow-program', 'deny']);

export function registerHostIpc(facade: HostFacade): void {
  const guard = (event: IpcMainInvokeEvent, projectAllowed = false): void => {
    if (!facade.isHostSender(event.sender) && !(projectAllowed && facade.isBackpackProjectSender(event.sender))) {
      throw new Error('host channel called from non-host sender');
    }
  };

  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    projectAllowed = false,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      const projectAction = channel.startsWith('host:backpack-project:') &&
        !channel.endsWith(':open') && !channel.endsWith(':close') &&
        !channel.endsWith(':show-surface') && !channel.endsWith(':hide-surface');
      guard(event, projectAllowed || projectAction);
      return handler(event, ...args);
    });
  };

  handle('host:app:build-identity', () => facade.buildIdentity());
  handle('host:app:update-status', () => facade.updateStatus());
  handle('host:app:check-for-update', () => facade.checkForUpdate());
  handle('host:app:install-update', () => facade.installUpdate());

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
  handle('host:backpacks:remove', (_e, id) =>
    facade.removeBackpack(backpackRemovalIdSchema.parse(id)),
  );
  handle('host:backpacks:enter', (_e, id) => facade.enterBackpack(idSchema.parse(id)));
  handle('host:backpacks:leave', () => facade.leaveBackpack());
  handle('host:backpacks:last-active', () => facade.lastActiveBackpackId());

  handle('host:backpack-project:open', (_e, id) =>
    facade.openBackpackProject(backpackRemovalIdSchema.parse(id)),
  );
  handle('host:backpack-project:close', () => facade.closeBackpackProject());
  handle('host:backpack-project:show-surface', (_e, url) =>
    facade.showBackpackProjectSurface(z.string().url().max(2_048).parse(url)),
  );
  handle('host:backpack-project:hide-surface', () => facade.hideBackpackProjectSurface());
  handle('host:backpack-project:run-action', (_e, actionId) =>
    facade.runBackpackProjectAction(backpackProjectActionIdSchema.parse(actionId)),
  );
  handle('host:backpack-project:copy-text', (_e, text) =>
    facade.copyBackpackProjectText(backpackProjectTextSchema.parse(text)),
  );
  handle('host:backpack-project:state-load', () => facade.loadBackpackProjectState());
  handle('host:backpack-project:state-save', (_e, state) =>
    facade.saveBackpackProjectState(backpackProjectStateSchema.parse(state)),
  );
  handle('host:backpack-project:pick-target', (_e, kind) =>
    facade.pickBackpackProjectTarget(z.enum(['file', 'folder']).parse(kind)),
  );
  handle('host:backpack-project:shortcut-icon', (_e, shortcutId) =>
    facade.backpackProjectShortcutIcon(backpackProjectActionIdSchema.parse(shortcutId)),
  );
  handle('host:backpack-project:launch-shortcut', (_e, shortcutId) =>
    facade.launchBackpackProjectShortcut(backpackProjectActionIdSchema.parse(shortcutId)),
  );
  handle('host:backpack-project:reveal-shortcut', (_e, shortcutId) =>
    facade.revealBackpackProjectShortcut(backpackProjectActionIdSchema.parse(shortcutId)),
  );
  handle('host:backpack-project:open-web-link', (_e, url) =>
    facade.openBackpackProjectWebLink(backpackProjectWebUrlSchema.parse(url)),
  );
  handle('host:backpack-project:resolve-dropped-targets', (_e, paths) =>
    facade.resolveBackpackProjectDroppedTargets(backpackProjectDroppedPathsSchema.parse(paths)),
  );
  handle('host:backpack-project:resolve-web-link-icon', (_e, url) =>
    facade.resolveBackpackProjectWebLinkIcon(backpackProjectWebUrlSchema.parse(url)),
  );
  ipcMain.on('host:backpack-project:request-close', (event) => {
    if (!facade.isBackpackProjectSender(event.sender)) return;
    facade.requestCloseBackpackProject();
  });

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
  handle('host:layout:set-titlebar', (_e, color, symbolColor) =>
    facade.setTitleBarOverlay(colorSchema.parse(color), colorSchema.parse(symbolColor)),
  );
  handle('host:settings:get', () => facade.getSettings());
  handle('host:settings:set-transparent-window', (_e, enabled) =>
    facade.setTransparentWindow(z.boolean().parse(enabled)),
  );
  handle('host:settings:save-window-bounds', () => facade.saveWindowBounds());
  handle('host:settings:clear-window-bounds', () => facade.clearWindowBounds());

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
